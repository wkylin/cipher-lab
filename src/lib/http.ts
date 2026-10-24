import axios, { AxiosHeaders, type AxiosAdapter } from 'axios';
import { CompactEncrypt, compactDecrypt, importJWK, base64url, type JWK } from 'jose';
import { responseEnvelopeSchema, type Method, type PackedBody, type RequestEnvelope } from '../../shared/protocol';
import { packBody, nativeBody, unpackBody, describeBody } from './body';

export type { Method } from '../../shared/protocol';
export type ResponseType = 'json' | 'text' | 'blob' | 'arraybuffer';
export interface RequestTrace {
  id: string; method: string; path: string; encrypted: boolean; startedAt: number; durationMs?: number; stage: string;
  steps: Array<{ label: string; detail: string; ms: number }>;
  plainRequest?: unknown;
  wireRequest?: { url: string; headers: Record<string, string>; body?: string };
  wireResponse?: { status: number; headers: Record<string, string>; body?: string };
  plainResponse?: unknown; error?: string;
}
export interface RequestOptions {
  url: string; method?: Method; params?: Record<string, string | number | boolean | string[]>;
  data?: unknown; encrypted?: boolean; responseType?: ResponseType; timeout?: number; signal?: AbortSignal;
  onTrace?: (trace: RequestTrace) => void;
}
export interface HttpResult<T> { data: T; status: number; headers: Record<string, string>; trace: RequestTrace }
export class HttpError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number, readonly trace?: RequestTrace) { super(message); this.name = 'HttpError'; }
}
const PROFILE = 'cipher-lab/1';
const encoder = new TextEncoder();
const MAX_WIRE = 2 * 1024 * 1024;
const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const HEADER_METHODS: Method[] = ['GET', 'HEAD', 'OPTIONS'];
const PUBLIC_PATHS = ['/api/echo', '/api/profile', '/api/upload', '/api/download', '/api/error', '/api/delay'];

/** 有界读响应，避免在浏览器里无限缓冲；同样用于 JWKS。 */
async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('响应超过大小限制'); }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new Error('响应超过大小限制'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
/** Axios 仍负责请求生命周期；adapter 让 HTTPS 重定向、读取上限、取消行为显式可见。 */
const boundedAdapter: AxiosAdapter = async config => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(AxiosHeaders.from(config.headers).toJSON())) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }
  if (config.data instanceof FormData || config.data === undefined) headers.delete('content-type');
  const response = await fetch(config.url!, {
    method: config.method?.toUpperCase(), headers, body: config.data as BodyInit | undefined,
    signal: config.signal as AbortSignal, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  const data = await boundedBytes(response, MAX_WIRE);
  return { data, status: response.status, statusText: response.statusText, headers: AxiosHeaders.from(Object.fromEntries(response.headers)), config };
};
const snapshot = (trace: RequestTrace) => structuredClone(trace);
const safeHeaders = (headers: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k.toLowerCase() === 'authorization' ? 'Bearer [已隐藏]' : v]));
function bodyPreview(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (body instanceof FormData) return '[原生 multipart/form-data；boundary 由浏览器生成]';
  if (body instanceof ArrayBuffer) return `[${body.byteLength} binary bytes]`;
  return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function createHttpClient(settings: { baseURL?: string; allowInsecureLocalhost?: boolean; encrypted?: boolean; token?: string } = {}) {
  const base = settings.baseURL ?? (typeof window !== 'undefined' ? window.location.origin : 'https://localhost:5178');
  const origin = new URL(base).origin;
  let encrypted = settings.encrypted ?? true;
  let token = settings.token ?? 'demo-token';
  let cachedKey: { kid: string; key: CryptoKey | Uint8Array; expiresAt: number; cachedUntil: number } | undefined;
  const transport = axios.create({ adapter: boundedAdapter, transformRequest: [value => value], transformResponse: [value => value], validateStatus: () => true });
  // 通用请求/响应扩展入口；加密在 request() 中按固定顺序执行，避免 interceptor 顺序改变认证快照。
  transport.interceptors.request.use(config => { config.headers.set('Accept', config.headers.get('Accept') || 'application/json'); return config; });
  transport.interceptors.response.use(response => response);
  async function getKey(signal: AbortSignal) {
    const now = Math.floor(Date.now() / 1000);
    if (cachedKey && cachedKey.cachedUntil > now && cachedKey.expiresAt > now) return cachedKey;
    const response = await fetch(new URL('/api/crypto/jwks', origin), { headers: { Accept: 'application/json' }, signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('无法取得服务端 JWKS 公钥');
    const jwks: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 32 * 1024)));
    if (!isRecord(jwks) || jwks.profile !== PROFILE || typeof jwks.activeKid !== 'string' || typeof jwks.expiresAt !== 'number' || jwks.expiresAt <= now || !Array.isArray(jwks.keys)) throw new Error('公钥集合无效或已经过期');
    const keys = jwks.keys.filter((k: unknown) => isRecord(k) && k.kid === jwks.activeKid) as JWK[];
    const jwk = keys[0];
    if (keys.length !== 1 || !jwk || jwk.kty !== 'RSA' || jwk.alg !== 'RSA-OAEP-256' || jwk.use !== 'enc' || !jwk.n || base64url.decode(jwk.n).length < 256 || ['d','p','q','dp','dq','qi','oth','k'].some(k => k in jwk)) throw new Error('公钥必须是至少 2048 位的 RSA 加密公钥');
    const key = await importJWK(jwk, 'RSA-OAEP-256');
    cachedKey = { kid: jwks.activeKid, key, expiresAt: jwks.expiresAt, cachedUntil: Math.min(jwks.expiresAt, now + 300) };
    return cachedKey;
  }

  async function request<T = unknown>(options: RequestOptions): Promise<HttpResult<T>> {
    const method = options.method ?? 'GET';
    const mode = options.encrypted ?? encrypted;
    const trace: RequestTrace = { id: crypto.randomUUID(), method, path: options.url, encrypted: mode, startedAt: Date.now(), stage: 'prepare', steps: [] };
    const emit = (label: string, detail: string, stage = trace.stage) => {
      trace.stage = stage; trace.steps.push({ label, detail, ms: Date.now() - trace.startedAt });
      try { options.onTrace?.(snapshot(trace)); } catch { /* 观察者不能改变传输行为 */ }
    };
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timeout = options.timeout ?? 10000;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, timeout));
    let replyKey: Uint8Array | undefined;
    const issuedAt = Math.floor(Date.now() / 1000);
    try {
      const url = new URL(options.url, base);
      if (url.origin !== origin || !PUBLIC_PATHS.includes(url.pathname) || url.hash || url.username || url.password || !METHODS.includes(method)) throw new Error('请求必须匹配本应用同源 API 路由');
      if (url.protocol !== 'https:' && !(settings.allowInsecureLocalhost && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('浏览器 API 请求必须使用 HTTPS；请用 npm run dev 启动');
      trace.path = url.pathname;
      for (const [name, value] of Object.entries(options.params ?? {})) {
        url.searchParams.delete(name);
        for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(entry));
      }
      if (HEADER_METHODS.includes(method) && options.data !== undefined) throw new Error(`${method} 不接受 body，请将参数放入 params`);
      controller.signal.throwIfAborted();
      const packed = await packBody(options.data);
      trace.plainRequest = { method, path: url.pathname, query: url.search.slice(1), body: describeBody(packed) };
      emit('业务数据', '序列化 body，保留查询参数、表单字段顺序和文件字节。', 'prepare');
      // token 在异步密钥获取前取得快照；后续 HTTP 头和摘要始终使用同一值。
      const authorization = token ? `Bearer ${token}` : '';
      const headers: Record<string, string> = { 'X-Request-ID': trace.id, Accept: mode ? 'application/jose' : '*/*' };
      if (authorization) headers.Authorization = authorization;
      let body: BodyInit | undefined;
      if (mode) {
        const serverKey = await getKey(controller.signal);
        replyKey = crypto.getRandomValues(new Uint8Array(32));
        const authHash = base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(authorization))));
        const envelope: RequestEnvelope = { v: 1, id: trace.id, iat: issuedAt, exp: issuedAt + 120, method, path: url.pathname, query: url.search.slice(1), authHash, replyKey: base64url.encode(replyKey), body: packed };
        const compact = await new CompactEncrypt(encoder.encode(JSON.stringify(envelope))).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: serverKey.kid, typ: 'cipher-lab-request+jwe', cty: 'application/json' }).encrypt(serverKey.key);
        if (compact.length > MAX_WIRE) throw new Error('加密后的请求超过 2 MiB 限制');
        url.search = '';
        headers['X-Crypto-Version'] = '1';
        if (HEADER_METHODS.includes(method)) {
          if (compact.length > 8192) throw new Error('GET/HEAD/OPTIONS 加密上下文超过 8 KiB，请缩短查询参数');
          headers['X-Crypto-Context'] = compact;
        } else { body = compact; headers['Content-Type'] = 'application/jose'; }
        emit('加密封装', `RSA-OAEP-256 + A256GCM；公钥 ${serverKey.kid}。独立响应密钥仅留在本次请求内存中。`, 'seal');
      } else {
        const plain = nativeBody(packed); body = plain.data;
        if (plain.contentType) headers['Content-Type'] = plain.contentType;
        emit('明文对照', '业务数据按原生格式发送；连接仍使用 HTTPS。', 'seal');
      }
      controller.signal.throwIfAborted();
      trace.wireRequest = { url: url.href, headers: safeHeaders(headers), body: bodyPreview(body) };
      emit('网络传输', `${method} ${url.pathname}；${mode ? '查询串已移入密文' : '保留原始查询串'}。`, 'wire');
      const response = await transport.request<Uint8Array>({ url: url.href, method, headers, data: body, signal: controller.signal });
      const wireHeaders = Object.fromEntries(Object.entries(response.headers).map(([k,v]) => [k.toLowerCase(), String(v)]));
      const contentType = wireHeaders['content-type'] ?? '';
      const raw = mode && method === 'HEAD' ? wireHeaders['x-crypto-response'] ?? '' : new TextDecoder().decode(response.data);
      trace.wireResponse = { status: response.status, headers: wireHeaders, body: method === 'HEAD' ? undefined : contentType.includes('jose') || /json|text/.test(contentType) ? raw : `[${response.data.length} binary bytes]` };
      let decodedBody: PackedBody;
      let businessHeaders = wireHeaders;
      if (mode) {
        if (wireHeaders['x-crypto-version'] !== '1' || wireHeaders['x-request-id'] !== trace.id || (method !== 'HEAD' && !contentType.startsWith('application/jose')) || !raw) throw new Error(`加密请求收到非协议响应（HTTP ${response.status}），已拒绝明文降级`);
        const opened = await compactDecrypt(raw, replyKey!, { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
        if (opened.protectedHeader.typ !== 'cipher-lab-response+jwe' || opened.protectedHeader.cty !== 'application/json' || Object.keys(opened.protectedHeader).some(k => !['alg', 'enc', 'typ', 'cty'].includes(k))) throw new Error('响应 JWE 类型不匹配');
        const envelope = responseEnvelopeSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(opened.plaintext)));
        const now = Math.floor(Date.now() / 1000);
        if (envelope.id !== trace.id || envelope.method !== method || envelope.path !== url.pathname || envelope.status !== response.status || envelope.iat < issuedAt - 30 || envelope.iat > now + 30) throw new Error('响应与原请求的 ID、方法、路径、状态或时间不匹配');
        if (Object.entries(envelope.headers).some(([name, value]) => !/^[a-z0-9-]+$/i.test(name) || /[\r\n]/.test(value))) throw new Error('业务响应头包含无效字符');
        decodedBody = envelope.body; businessHeaders = envelope.headers;
        emit('响应解密', 'A256GCM 校验通过，request ID、method、path、HTTP status 与时间绑定通过。', 'open');
      } else {
        decodedBody = response.data.length === 0 ? { kind: 'empty' } : contentType.includes('application/json') ? { kind: 'json', value: JSON.parse(raw) as unknown } : contentType.startsWith('text/') ? { kind: 'text', value: raw, contentType } : { kind: 'binary', base64: base64url.encode(response.data), contentType };
        emit('响应解析', '根据响应 Content-Type 恢复 JSON、文本或文件。', 'open');
      }
      controller.signal.throwIfAborted();
      const business = unpackBody(decodedBody);
      trace.plainResponse = decodedBody.kind === 'binary' ? describeBody(decodedBody) : business;
      if (response.status >= 400 || (isRecord(business) && 'code' in business && business.code !== 0)) {
        throw new HttpError(isRecord(business) && typeof business.message === 'string' ? business.message : `HTTP ${response.status}`, isRecord(business) && 'code' in business ? String(business.code) : 'HTTP_ERROR', response.status, trace);
      }
      let data = unpackBody(decodedBody, options.responseType);
      if ((!options.responseType || options.responseType === 'json') && isRecord(data) && data.code === 0 && 'data' in data) data = data.data;
      trace.durationMs = Date.now() - trace.startedAt;
      emit('页面可用', '业务 envelope 已解包，返回类型化结果；Vue 更新响应式状态。', 'done');
      return { data: data as T, status: response.status, headers: businessHeaders, trace: snapshot(trace) };
    } catch (error) {
      // 热重启/轮换后下次显式请求重新取钥；绝不自动重放可能已有副作用的请求。
      if (mode && !(error instanceof HttpError)) cachedKey = undefined;
      const failure = error instanceof HttpError ? error : new HttpError(timedOut ? '请求超时（包括公钥获取与加密准备）' : controller.signal.aborted ? '请求已取消' : error instanceof Error ? error.message : '请求失败', timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'CANCELLED' : 'PROTOCOL_ERROR', undefined, trace);
      trace.error = failure.message; trace.durationMs = Date.now() - trace.startedAt;
      emit('请求停止', failure.message, 'error');
      throw failure;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      replyKey?.fill(0); // 不放入 trace、Vue 状态、localStorage 或可枚举的 Axios config。
    }
  }
  type Options = Omit<RequestOptions, 'url' | 'method' | 'data'>;
  return {
    request, setEncrypted(value: boolean) { encrypted = value; }, setToken(value: string) { token = value; },
    get: <T = unknown>(url: string, options: Options = {}) => request<T>({ ...options, url, method: 'GET' }),
    post: <T = unknown>(url: string, data?: unknown, options: Options = {}) => request<T>({ ...options, url, method: 'POST', data }),
    put: <T = unknown>(url: string, data?: unknown, options: Options = {}) => request<T>({ ...options, url, method: 'PUT', data }),
    patch: <T = unknown>(url: string, data?: unknown, options: Options = {}) => request<T>({ ...options, url, method: 'PATCH', data }),
    delete: <T = unknown>(url: string, data?: unknown, options: Options = {}) => request<T>({ ...options, url, method: 'DELETE', data }),
    head: <T = unknown>(url: string, options: Options = {}) => request<T>({ ...options, url, method: 'HEAD' }),
    options: <T = unknown>(url: string, options: Options = {}) => request<T>({ ...options, url, method: 'OPTIONS' }),
  };
}
export const http = createHttpClient({ encrypted: import.meta.env?.VITE_API_ENCRYPTED !== 'false', token: import.meta.env?.VITE_DEMO_TOKEN ?? 'demo-token' });
