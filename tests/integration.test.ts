import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CompactEncrypt, compactDecrypt, importJWK } from 'jose'
import { createApp } from '../server/app.js'
import { createHttpClient, HttpError } from '../src/lib/http.js'
import { METHODS, REQUEST_TYP, RESPONSE_TYP, type RequestEnvelope, type ResponseEnvelope } from '../shared/protocol.js'

let server: Server
let baseURL: string
let client: ReturnType<typeof createHttpClient>
const encoder = new TextEncoder()
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('base64url')
const clientFor = (origin: string) => createHttpClient({ baseURL: origin, allowInsecureLocalhost: true })
async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
before(async () => {
  const app = await createApp({ allowPlaintext: true })
  server = createServer(app.callback())
  baseURL = await listen(server)
  client = clientFor(baseURL)
})
after(async () => { if (server) await close(server) })

interface Echo { method: string; query: Record<string, string | string[]>; body: unknown; mode: string }
interface Upload { fields: Array<{ name: string; value: string }>; files: Array<{ filename: string; contentType: string; size: number; sha256: string; preview: string }>; totalBytes: number }

test('plain + encrypted: all seven HTTP methods, query duplicates, HEAD semantics and safe trace', async t => {
  for (const encrypted of [false, true]) {
    for (const method of METHODS) {
      await t.test(`${encrypted ? 'encrypted' : 'plain'} ${method}`, async () => {
        const contextOnly = ['GET', 'HEAD', 'OPTIONS'].includes(method)
        const result = await client.request<Echo>({
          url: '/api/echo', method, encrypted,
          params: { search: '足球 & café', tag: ['a', 'b'] },
          ...(contextOnly ? {} : { data: { name: 'Ada', nested: { valid: true } } }),
        })
        assert.equal(result.status, 200)
        if (method === 'HEAD') {
          assert.equal(result.data, undefined)
          assert.equal(result.headers['x-echo-method'], 'HEAD')
          if (encrypted) assert.ok(result.trace.wireResponse?.headers['x-crypto-response'])
          assert.equal(result.trace.wireResponse?.body, undefined)
        } else {
          assert.equal(result.data.method, method)
          assert.deepEqual(result.data.query, { search: '足球 & café', tag: ['a', 'b'] })
          assert.equal(result.data.mode, encrypted ? 'encrypted' : 'plain')
          assert.deepEqual(result.data.body, contextOnly ? null : { name: 'Ada', nested: { valid: true } })
        }
        assert.equal(new URL(result.trace.wireRequest!.url).search.length === 0, encrypted)
        assert.equal(result.trace.stage, 'done')
        const serialized = JSON.stringify(result.trace)
        assert.equal(serialized.includes('replyKey'), false)
        assert.equal(serialized.includes('demo-token'), false)
        if (encrypted) {
          const compact = contextOnly ? result.trace.wireRequest?.headers['X-Crypto-Context'] : result.trace.wireRequest?.body
          assert.equal(compact?.split('.').length, 5)
          assert.equal(compact?.includes('足球'), false)
        }
      })
    }
  }
})

test('JSON, text, URL encoded fields, multipart files and raw bytes survive both modes', async t => {
  for (const encrypted of [false, true]) await t.test(encrypted ? 'encrypted' : 'plain', async () => {
    const text = await client.post<Echo>('/api/echo', '你好，Cipher Lab', { encrypted })
    assert.equal(text.data.body, '你好，Cipher Lab')
    const urlForm = new URLSearchParams([['label', 'first'], ['label', '中文 & second']])
    const encoded = await client.post<Echo>('/api/echo', urlForm, { encrypted })
    assert.deepEqual(encoded.data.body, { kind: 'form', entries: [{ name: 'label', value: 'first' }, { name: 'label', value: '中文 & second' }] })

    const fileContent = 'Hello 世界\nSecond line'
    const form = new FormData()
    form.append('label', 'first')
    form.append('label', 'second')
    form.append('file', new Blob([fileContent], { type: 'text/plain' }), 'hello.txt')
    const upload = await client.post<Upload>('/api/upload', form, { encrypted })
    assert.deepEqual(upload.data.fields, [{ name: 'label', value: 'first' }, { name: 'label', value: 'second' }])
    assert.equal(upload.data.files[0]?.filename, 'hello.txt')
    assert.equal(upload.data.files[0]?.sha256, digest(fileContent))
    assert.equal(upload.data.files[0]?.size, Buffer.byteLength(fileContent))
    assert.equal(upload.data.files[0]?.preview, fileContent)

    const rawBytes = new Uint8Array([0, 255, 128, 13, 10, 42])
    const binary = await client.post<Upload>('/api/upload', rawBytes, { encrypted })
    assert.equal(binary.data.files[0]?.sha256, digest(rawBytes))
    assert.equal(binary.data.totalBytes, rawBytes.length)

    const textFile = await client.post<Upload>('/api/upload', new Blob([fileContent], { type: 'text/plain' }), { encrypted })
    assert.equal(textFile.data.files[0]?.sha256, digest(fileContent))
    assert.equal(textFile.data.files[0]?.contentType, 'text/plain')
    const emptyFile = await client.post<Upload>('/api/upload', new Blob([], { type: 'text/plain' }), { encrypted })
    assert.equal(emptyFile.data.files[0]?.size, 0)
    assert.equal(emptyFile.data.files[0]?.sha256, digest(''))
    const emptyText = await client.post<Echo>('/api/echo', '', { encrypted })
    assert.equal(emptyText.data.body, '')
    const absentBody = await client.post<Echo>('/api/echo', undefined, { encrypted })
    assert.equal(absentBody.data.body, null)
  })
})

test('downloads preserve exact file bytes and protected download headers', async () => {
  const expected = 'name,role\nAda,Engineer\nLin,Designer\n'
  for (const encrypted of [false, true]) {
    const result = await client.get<ArrayBuffer>('/api/download', { encrypted, responseType: 'arraybuffer' })
    assert.ok(result.data instanceof ArrayBuffer)
    assert.equal(new TextDecoder().decode(result.data), expected)
    assert.match(result.headers['content-disposition']!, /cipher-lab\.csv/)
    const blob = await client.get<Blob>('/api/download', { encrypted, responseType: 'blob' })
    assert.equal(await blob.data.text(), expected)
  }
})

test('profile mutation → read → reset and encrypted 422/401 errors use the same client', async () => {
  const updated = await client.patch<{ name: string }>('/api/profile', { name: 'Cipher Student' })
  assert.equal(updated.data.name, 'Cipher Student')
  const read = await client.get<{ name: string }>('/api/profile')
  assert.equal(read.data.name, 'Cipher Student')
  const reset = await client.delete<{ deleted: boolean }>('/api/profile')
  assert.equal(reset.data.deleted, true)
  await assert.rejects(client.get('/api/error'), error => {
    assert.ok(error instanceof HttpError)
    assert.equal(error.status, 422)
    assert.equal(error.code, '42201')
    assert.match(error.trace?.wireResponse?.headers['content-type'] ?? '', /application\/jose/)
    return true
  })
  const unauthorized = createHttpClient({ baseURL, allowInsecureLocalhost: true, token: 'wrong-token' })
  await assert.rejects(unauthorized.get('/api/profile'), error => error instanceof HttpError && error.status === 401)
})

test('timeout and AbortSignal stop requests without switching to plaintext', async () => {
  await client.get('/api/echo') // Warm the key cache so the timeout exercises delayed business work.
  await assert.rejects(client.get('/api/delay', { params: { ms: 1000 }, timeout: 30 }), error => error instanceof HttpError && error.code === 'TIMEOUT')
  const controller = new AbortController()
  const pending = client.get('/api/delay', { params: { ms: 1000 }, signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, error => error instanceof HttpError && error.code === 'CANCELLED')
})

test('server can reject plaintext independently of client defaults', async () => {
  const app = await createApp({ allowPlaintext: false })
  const strictServer = createServer(app.callback())
  const strictClient = clientFor(await listen(strictServer))
  try {
    await assert.rejects(strictClient.get('/api/echo', { encrypted: false }), error => error instanceof HttpError && error.status === 426)
    assert.equal((await strictClient.get('/api/echo')).status, 200)
  } finally { await close(strictServer) }
})

async function rawRequest(overrides: Partial<RequestEnvelope> = {}) {
  const jwks = await (await fetch(`${baseURL}/api/crypto/jwks`)).json()
  const key = await importJWK(jwks.keys[0], 'RSA-OAEP-256')
  const timestamp = Math.floor(Date.now() / 1000)
  const replyKey = randomBytes(32)
  const envelope: RequestEnvelope = {
    v: 1, id: randomUUID(), iat: timestamp, exp: timestamp + 120,
    method: 'POST', path: '/api/echo', query: '', authHash: digest('Bearer demo-token'),
    replyKey: replyKey.toString('base64url'), body: { kind: 'json', value: { test: true } }, ...overrides,
  }
  const compact = await new CompactEncrypt(encoder.encode(JSON.stringify(envelope)))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: REQUEST_TYP, kid: jwks.activeKid, cty: 'application/json' }).encrypt(key)
  const headers = { 'Content-Type': 'application/jose', 'X-Crypto-Version': '1', 'X-Request-ID': envelope.id, Authorization: 'Bearer demo-token' }
  const send = (changes: { path?: string; method?: string; compact?: string; authorization?: string } = {}) => fetch(`${baseURL}${changes.path ?? envelope.path}`, {
    method: changes.method ?? envelope.method, headers: { ...headers, Authorization: changes.authorization ?? headers.Authorization }, body: changes.compact ?? compact,
  })
  const open = async (response: Response) => {
    assert.match(response.headers.get('content-type') ?? '', /application\/jose/)
    const { plaintext, protectedHeader } = await compactDecrypt(await response.text(), replyKey)
    assert.equal(protectedHeader.typ, RESPONSE_TYP)
    return JSON.parse(new TextDecoder().decode(plaintext)) as ResponseEnvelope
  }
  return { send, open, compact }
}

test('valid encrypted replay is rejected; auth, path, method and expiry bindings are enforced', async () => {
  const replay = await rawRequest()
  assert.equal((await replay.send()).status, 200)
  const repeated = await replay.send()
  assert.equal(repeated.status, 409)
  assert.equal((await replay.open(repeated)).status, 409)
  const auth = await rawRequest()
  const changedAuth = await auth.send({ authorization: 'Bearer altered' })
  assert.equal(changedAuth.status, 401)
  assert.equal((await auth.open(changedAuth)).status, 401)
  const path = await rawRequest()
  assert.equal((await path.send({ path: '/api/profile' })).status, 400)
  const method = await rawRequest()
  assert.equal((await method.send({ method: 'PUT' })).status, 400)
  const now = Math.floor(Date.now() / 1000)
  const expired = await rawRequest({ iat: now - 130, exp: now - 10 })
  assert.equal((await expired.send()).status, 400)
})

test('mutating authenticated ciphertext fails before business execution', async () => {
  const request = await rawRequest()
  const parts = request.compact.split('.')
  parts[3] = (parts[3]![0] === 'A' ? 'B' : 'A') + parts[3]!.slice(1)
  const response = await request.send({ compact: parts.join('.') })
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
})

test('client rejects plaintext substitution and HTTP status tampering without downgrade', async t => {
  for (const mode of ['plaintext', 'status'] as const) await t.test(mode, async () => {
    let businessRequests = 0
    const proxy = createServer(async (req, res) => {
      try {
        const upstream = await fetch(`${baseURL}${req.url}`, { headers: Object.fromEntries(Object.entries(req.headers).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) })
        if (req.url?.startsWith('/api/crypto/jwks')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(await upstream.text())
          return
        }
        businessRequests += 1
        if (mode === 'plaintext') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ code: 0, message: 'substituted', data: { injected: true } }))
        } else {
          for (const [key, value] of upstream.headers) res.setHeader(key, value)
          res.statusCode = 201 // The JWE remains intact and still binds HTTP 200.
          res.end(await upstream.text())
        }
      } catch (error) { res.statusCode = 500; res.end(String(error)) }
    })
    const hostileClient = clientFor(await listen(proxy))
    try {
      await assert.rejects(hostileClient.get('/api/echo'), error => error instanceof HttpError && error.code === 'PROTOCOL_ERROR')
      assert.equal(businessRequests, 1)
    } finally { await close(proxy) }
  })
})
