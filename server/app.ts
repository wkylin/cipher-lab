import Koa, { type Context } from 'koa'
import { createHash, randomUUID } from 'node:crypto'
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader, exportJWK, generateKeyPair } from 'jose'
import {
  CONTEXT_METHODS, MAX_BODY_BYTES, MAX_CLOCK_SKEW_SECONDS, MAX_CONTEXT_BYTES,
  MAX_WIRE_BYTES, METHODS, PROFILE, REQUEST_TTL_SECONDS, REQUEST_TYP, RESPONSE_TYP,
  packedBodySchema, requestEnvelopeSchema, type Method, type PackedBody, type RequestEnvelope, type ResponseEnvelope,
} from '../shared/protocol.js'

export interface AppOptions { allowPlaintext?: boolean }
interface Output { status: number; body: PackedBody; headers?: Record<string, string> }
class HttpError extends Error {
  constructor(public status: number, message: string, public code = status) { super(message) }
}
const encoder = new TextEncoder()
const now = () => Math.floor(Date.now() / 1000)
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('base64url')
const json = (data: unknown, status = 200): Output => ({ status, body: { kind: 'json', value: data } })
const ok = (data: unknown, status = 200) => json({ code: 0, message: 'ok', data }, status)
const errorOutput = (error: unknown): Output => {
  const known = error instanceof HttpError
  return json({ code: known ? error.code : 500, message: known ? error.message : '服务端处理失败', data: null }, known ? error.status : 500)
}

function decodeBase64(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64url')
  if (!/^[A-Za-z0-9_-]*$/.test(value) || bytes.toString('base64url') !== value) {
    throw new HttpError(400, 'binary/form 必须使用规范的无填充 Base64URL 编码')
  }
  return bytes
}

/** 既限制 HTTP 密文，也限制解码后的实际业务数据，避免 Base64 绕过限额。 */
function assertBodySize(body: PackedBody) {
  let size = 0
  switch (body.kind) {
    case 'empty': return
    case 'json': size = Buffer.byteLength(JSON.stringify(body.value) ?? 'null'); break
    case 'text': size = Buffer.byteLength(body.value); break
    case 'binary': size = decodeBase64(body.base64).length; break
    case 'form':
      for (const entry of body.entries) size += 'value' in entry ? Buffer.byteLength(entry.value) : decodeBase64(entry.base64).length
      break
  }
  if (size > MAX_BODY_BYTES) throw new HttpError(413, '业务数据超过 1 MiB 限额')
}

async function readRaw(ctx: Context): Promise<Buffer> {
  const declared = Number(ctx.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_WIRE_BYTES) throw new HttpError(413, 'HTTP 请求超过 2 MiB 限额')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of ctx.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_WIRE_BYTES) throw new HttpError(413, 'HTTP 请求超过 2 MiB 限额')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

async function parsePlainBody(ctx: Context): Promise<PackedBody> {
  const bytes = await readRaw(ctx)
  if (!bytes.length && !ctx.get('content-type')) return { kind: 'empty' }
  const type = ctx.get('content-type') || 'application/octet-stream'
  let body: PackedBody
  // 上传路由的原生 body 是文件字节，text/plain / application/json 也可能是文件 MIME。
  // 以端点契约决定解析方式，避免与加密 PackedBody.binary 的语义不同。
  if (ctx.path === '/api/upload' && !type.startsWith('multipart/form-data') && !type.startsWith('application/x-www-form-urlencoded')) {
    body = { kind: 'binary', base64: bytes.toString('base64url'), contentType: type }
  } else if (type.startsWith('application/json') || /^application\/[^;]+\+json(?:;|$)/i.test(type)) {
    try { body = { kind: 'json', value: JSON.parse(bytes.toString('utf8')) } }
    catch { throw new HttpError(400, '无效的 JSON 请求体') }
  } else if (type.startsWith('multipart/form-data') || type.startsWith('application/x-www-form-urlencoded')) {
    try {
      // Node 24 原生 multipart 解析；文件留在内存，演示服务不写入用户文件。
      const request = new Request('http://localhost/body', { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(bytes) })
      const form = await request.formData()
      const entries: Extract<PackedBody, { kind: 'form' }>['entries'] = []
      for (const [name, value] of form.entries()) {
        entries.push(typeof value === 'string' ? { name, value } : {
          name, filename: value.name, contentType: value.type || 'application/octet-stream',
          base64: Buffer.from(await value.arrayBuffer()).toString('base64url'),
        })
      }
      if (entries.length > 100) throw new Error('too many entries')
      body = { kind: 'form', entries }
    } catch { throw new HttpError(400, '无法解析表单，最多允许 100 个字段') }
  } else if (type.startsWith('text/')) body = { kind: 'text', value: bytes.toString('utf8'), contentType: type }
  else body = { kind: 'binary', base64: bytes.toString('base64url'), contentType: type }
  if (!packedBodySchema.safeParse(body).success) throw new HttpError(400, '请求体结构或字段长度超出限制')
  assertBodySize(body)
  return body
}

function inspectBody(body: PackedBody): unknown {
  if (body.kind === 'empty') return null
  if (body.kind === 'json') return body.value
  if (body.kind === 'text') return body.value
  if (body.kind === 'binary') return { kind: body.kind, contentType: body.contentType, size: decodeBase64(body.base64).length, sha256: sha256(decodeBase64(body.base64)) }
  return { kind: body.kind, entries: body.entries.map(entry => 'value' in entry ? entry : {
    name: entry.name, filename: entry.filename, contentType: entry.contentType, size: decodeBase64(entry.base64).length,
  }) }
}

/** URLSearchParams 在浏览器按文本传送，进入业务层时还原为表单字段。 */
function normalizeBusinessBody(body: PackedBody): PackedBody {
  if (body.kind !== 'text' || !body.contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) return body
  const entries = [...new URLSearchParams(body.value)].map(([name, value]) => ({ name, value }))
  if (entries.length > 100) throw new HttpError(400, '表单最多允许 100 个字段')
  const parsed = packedBodySchema.safeParse({ kind: 'form', entries })
  if (!parsed.success) throw new HttpError(400, '表单字段名或内容超出限制')
  return parsed.data
}

function queryObject(raw: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null)
  for (const [key, value] of new URLSearchParams(raw)) {
    const previous = result[key]
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value]
  }
  return result
}

const ROUTES: Record<string, readonly Method[]> = {
  '/api/echo': METHODS,
  '/api/profile': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  '/api/upload': ['POST'],
  '/api/download': ['GET'],
  '/api/error': ['GET'],
  '/api/delay': ['GET'],
}

/** 私钥只在 Koa 进程内。真实系统应换成 KMS/密钥存储，并支持 kid 轮换。 */
export async function createApp(options: AppOptions = {}): Promise<Koa> {
  const allowPlaintext = options.allowPlaintext ?? process.env.ALLOW_PLAINTEXT !== 'false'
  const { publicKey, privateKey } = await generateKeyPair('RSA-OAEP-256', { modulusLength: 2048 })
  const kid = `demo-${randomUUID()}`
  const publicJwk = { ...await exportJWK(publicKey), kid, use: 'enc', alg: 'RSA-OAEP-256' }
  const seen = new Map<string, number>()
  const profileInitial = { name: 'Ada Chen', role: 'Frontend Engineer', note: '学习应用层加密，让请求的每一步都可见。' }
  let profile = { ...profileInitial }
  const app = new Koa()

  async function business(ctx: Context, method: Method, body: PackedBody, query: string, encrypted: boolean): Promise<Output> {
    const allowed = ROUTES[ctx.path]
    if (!allowed) throw new HttpError(404, '接口不存在')
    if (!allowed.includes(method)) throw new HttpError(405, '此接口不支持该 HTTP 方法')
    if (ctx.path === '/api/echo') {
      if (method === 'HEAD') return { status: 200, body: { kind: 'empty' }, headers: { 'x-echo-method': 'HEAD', 'x-demo-mode': encrypted ? 'encrypted' : 'plain' } }
      const output = ok({ method, query: queryObject(query), body: inspectBody(body), receivedAt: new Date().toISOString(), mode: encrypted ? 'encrypted' : 'plain', ...(method === 'OPTIONS' ? { allowedMethods: METHODS } : {}) })
      if (method === 'OPTIONS') output.headers = { allow: METHODS.join(', ') }
      return output
    }
    if (ctx.path === '/api/profile') {
      if (ctx.get('authorization') !== 'Bearer demo-token') throw new HttpError(401, '演示接口需要 Authorization: Bearer demo-token')
      if (method === 'DELETE') { profile = { ...profileInitial }; return ok({ deleted: true, profile }) }
      if (method !== 'GET') {
        if (body.kind !== 'json' || typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) throw new HttpError(400, '请提交 JSON 对象')
        const value = body.value as Record<string, unknown>
        const fields = ['name', 'role', 'note'] as const
        if (Object.keys(value).some(key => !fields.includes(key as typeof fields[number]))) throw new HttpError(400, '只接受 name、role、note 字段')
        if (method !== 'PATCH' && fields.some(key => typeof value[key] !== 'string')) throw new HttpError(400, 'POST/PUT 需要完整 name、role、note')
        for (const key of fields) {
          if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 500)) throw new HttpError(400, '资料字段应为不超过 500 字符的字符串')
        }
        profile = { ...profile, ...value } as typeof profile
      }
      return ok(profile, method === 'POST' ? 201 : 200)
    }
    if (ctx.path === '/api/upload') {
      const fields: Array<{ name: string; value: string }> = []
      const files: Array<{ name: string; filename: string; contentType: string; size: number; sha256: string; preview: string }> = []
      const addFile = (name: string, filename: string, contentType: string, base64: string) => {
        const bytes = decodeBase64(base64)
        files.push({ name, filename, contentType, size: bytes.length, sha256: sha256(bytes), preview: contentType.startsWith('text/') ? bytes.subarray(0, 160).toString('utf8') : `${bytes.subarray(0, 24).toString('hex')} (hex)` })
      }
      if (body.kind === 'form') {
        for (const entry of body.entries) {
          if ('value' in entry) fields.push(entry)
          else addFile(entry.name, entry.filename, entry.contentType, entry.base64)
        }
      } else if (body.kind === 'binary') addFile('file', body.filename ?? 'upload.bin', body.contentType, body.base64)
      else throw new HttpError(415, '请提交 FormData 或二进制文件')
      return ok({ fields, files, totalBytes: files.reduce((total, file) => total + file.size, 0) })
    }
    if (ctx.path === '/api/download') return {
      status: 200,
      body: { kind: 'binary', base64: Buffer.from('name,role\nAda,Engineer\nLin,Designer\n').toString('base64url'), contentType: 'text/csv; charset=utf-8', filename: 'cipher-lab.csv' },
      headers: { 'content-disposition': 'attachment; filename="cipher-lab.csv"' },
    }
    if (ctx.path === '/api/error') throw new HttpError(422, '这是一个用于演示的业务错误；加密模式下错误响应同样加密。', 42201)
    if (ctx.path === '/api/delay') {
      const requested = Number(new URLSearchParams(query).get('ms') ?? 1500)
      const ms = Number.isFinite(requested) ? Math.max(0, Math.min(requested, 15000)) : 1500
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, ms); ctx.res.once('close', () => { clearTimeout(timer); resolve() }) })
      return ok({ delayedMs: ms })
    }
    throw new HttpError(404, '接口不存在')
  }

  async function send(ctx: Context, output: Output, envelope?: RequestEnvelope) {
    const headers = { ...(output.headers ?? {}) }
    ctx.status = output.status
    ctx.set('Cache-Control', 'no-store')
    ctx.set('X-Content-Type-Options', 'nosniff')
    if (envelope) {
      const response: ResponseEnvelope = {
        v: 1, id: envelope.id, iat: now(), method: ctx.method as Method,
        path: ctx.path, status: output.status, body: output.body, headers,
      }
      // 响应直接使用请求中的独立 replyKey。它没有出现在请求头或明文中。
      const compact = await new CompactEncrypt(encoder.encode(JSON.stringify(response)))
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: RESPONSE_TYP, cty: 'application/json' })
        .encrypt(Buffer.from(envelope.replyKey, 'base64url'))
      ctx.set('X-Crypto-Version', '1')
      ctx.set('X-Request-ID', envelope.id)
      ctx.type = 'application/jose'
      if (ctx.method === 'HEAD') {
        if (Buffer.byteLength(compact) > MAX_CONTEXT_BYTES) throw new HttpError(500, 'HEAD 加密响应头过大')
        ctx.set('X-Crypto-Response', compact)
      } else ctx.body = compact
      return
    }
    for (const [key, value] of Object.entries(headers)) ctx.set(key, value)
    switch (output.body.kind) {
      case 'empty': ctx.body = ''; break
      case 'json': ctx.type = 'application/json'; ctx.body = output.body.value; break
      case 'text': ctx.type = output.body.contentType; ctx.body = output.body.value; break
      case 'binary': ctx.type = output.body.contentType; ctx.body = decodeBase64(output.body.base64); break
      case 'form': ctx.type = 'application/json'; ctx.body = inspectBody(output.body); break
    }
    ctx.status = output.status
  }

  app.use(async (ctx, next) => {
    if (!ctx.path.startsWith('/api/')) return next()
    let envelope: RequestEnvelope | undefined
    try {
      if (ctx.path === '/api/crypto/jwks' && ctx.method === 'GET') {
        // 公钥不是秘密；经 HTTPS 建立来源真实性。演示密钥在进程存活期间可用。
        ctx.set('Cache-Control', 'no-store')
        ctx.body = { profile: PROFILE, activeKid: kid, expiresAt: now() + 300, keys: [publicJwk] }
        return
      }
      if (ctx.path === '/api/health' && ctx.method === 'GET') { ctx.body = { ok: true, allowPlaintext }; return }
      if (!METHODS.includes(ctx.method as Method)) throw new HttpError(405, '只支持 GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS')
      const method = ctx.method as Method
      const encrypted = !!ctx.get('x-crypto-version') || !!ctx.get('x-crypto-context') || ctx.get('content-type').startsWith('application/jose')
      let body: PackedBody
      let query = ctx.querystring
      if (encrypted) {
        if (ctx.get('x-crypto-version') !== '1') throw new HttpError(400, '不支持的加密协议版本')
        const contextMethod = CONTEXT_METHODS.includes(method)
        const raw = await readRaw(ctx)
        if (contextMethod && raw.length > 0) throw new HttpError(400, 'GET / HEAD / OPTIONS 不接受 HTTP body')
        if (!contextMethod && (!ctx.get('content-type').startsWith('application/jose') || ctx.get('x-crypto-context'))) throw new HttpError(400, '加密写入请求必须使用 application/jose body')
        const compact = contextMethod ? ctx.get('x-crypto-context') : raw.toString('utf8')
        if (contextMethod && Buffer.byteLength(compact) > MAX_CONTEXT_BYTES) throw new HttpError(431, '加密请求上下文超过 8 KiB')
        try {
          const header = decodeProtectedHeader(compact)
          if (header.alg !== 'RSA-OAEP-256' || header.enc !== 'A256GCM' || header.typ !== REQUEST_TYP || header.cty !== 'application/json' || header.kid !== kid || Object.keys(header).some(key => !['alg', 'enc', 'typ', 'kid', 'cty'].includes(key))) throw new Error('invalid protected header')
          const decrypted = await compactDecrypt(compact, privateKey, { keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A256GCM'] })
          envelope = requestEnvelopeSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted.plaintext)))
          const replyBytes = Buffer.from(envelope.replyKey, 'base64url')
          if (replyBytes.length !== 32 || replyBytes.toString('base64url') !== envelope.replyKey) { envelope = undefined; throw new Error('invalid reply key') }
        } catch {
          envelope = undefined
          throw new HttpError(400, '无法验证加密请求（JWE、密钥或协议结构无效）')
        }
        // 从这里开始，错误也能用已验证的 replyKey 返回密文。
        if (ctx.querystring) throw new HttpError(400, '加密请求的查询参数必须放入密文')
        if (envelope.id !== ctx.get('x-request-id') || envelope.method !== method || envelope.path !== ctx.path) throw new HttpError(400, '请求 ID、HTTP 方法或路径绑定不匹配')
        const timestamp = now()
        if (envelope.exp <= timestamp || envelope.iat > timestamp + MAX_CLOCK_SKEW_SECONDS || envelope.exp <= envelope.iat || envelope.exp - envelope.iat > REQUEST_TTL_SECONDS) throw new HttpError(400, '请求已过期或时间窗口无效')
        if (envelope.authHash !== sha256(ctx.get('authorization'))) throw new HttpError(401, 'Authorization 摘要绑定不匹配')
        for (const [id, expiresAt] of seen) if (expiresAt <= timestamp) seen.delete(id)
        if (seen.has(envelope.id)) throw new HttpError(409, '检测到重复 request ID，请重新生成加密请求')
        if (seen.size >= 10000) throw new HttpError(503, '演示重放缓存已满，请稍后重试')
        seen.set(envelope.id, envelope.exp)
        body = envelope.body
        assertBodySize(body)
        if (CONTEXT_METHODS.includes(method) && body.kind !== 'empty') throw new HttpError(400, 'GET / HEAD / OPTIONS 的业务 body 必须为空')
        query = envelope.query
      } else {
        if (!allowPlaintext) throw new HttpError(426, '服务器已关闭明文模式，请启用应用层加密')
        body = await parsePlainBody(ctx)
        if (CONTEXT_METHODS.includes(method) && body.kind !== 'empty') throw new HttpError(400, 'GET / HEAD / OPTIONS 不接受 body')
      }
      await send(ctx, await business(ctx, method, normalizeBusinessBody(body), query, encrypted), envelope)
    } catch (error) {
      if (!(error instanceof HttpError)) app.emit('error', error, ctx)
      await send(ctx, errorOutput(error), envelope)
    }
  })
  app.on('error', error => console.error('[koa] unexpected error:', error.message))
  return app
}
