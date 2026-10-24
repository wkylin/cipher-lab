import { base64url } from 'jose';
import type { PackedBody } from '../../shared/protocol';

export const BODY_LIMIT = 1024 * 1024;
const encoder = new TextEncoder();
export function assertSize(bytes: number) {
  if (bytes > BODY_LIMIT) throw new Error('请求内容超过 1 MiB 教学限制');
}
export function describeBody(body: PackedBody): unknown {
  if (body.kind === 'binary') return { ...body, base64: `<${base64url.decode(body.base64).byteLength} bytes>` };
  if (body.kind === 'form') return { ...body, entries: body.entries.map(e => 'base64' in e ? { ...e, base64: `<${base64url.decode(e.base64).byteLength} bytes>` } : e) };
  return body;
}
/** 先保留内容语义，再加密。FormData 中同名字段和文件顺序都保留。 */
export async function packBody(data: unknown): Promise<PackedBody> {
  if (data === undefined) return { kind: 'empty' };
  if (data instanceof FormData) {
    const entries: Extract<PackedBody, { kind: 'form' }>['entries'] = [];
    let size = 0;
    for (const [name, value] of data.entries()) {
      size += encoder.encode(name).length;
      if (typeof value === 'string') {
        size += encoder.encode(value).length;
        entries.push({ name, value });
      } else {
        size += value.size;
        assertSize(size);
        entries.push({ name, filename: value.name, contentType: value.type || 'application/octet-stream', base64: base64url.encode(new Uint8Array(await value.arrayBuffer())) });
      }
      assertSize(size);
    }
    return { kind: 'form', entries };
  }
  if (data instanceof URLSearchParams) {
    const value = data.toString(); assertSize(encoder.encode(value).length);
    return { kind: 'text', value, contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
  }
  if (data instanceof Blob) {
    assertSize(data.size);
    return { kind: 'binary', base64: base64url.encode(new Uint8Array(await data.arrayBuffer())), contentType: data.type || 'application/octet-stream', ...(typeof File !== 'undefined' && data instanceof File ? { filename: data.name } : {}) };
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    assertSize(bytes.byteLength);
    return { kind: 'binary', base64: base64url.encode(bytes), contentType: 'application/octet-stream' };
  }
  if (typeof data === 'string') {
    assertSize(encoder.encode(data).length);
    return { kind: 'text', value: data, contentType: 'text/plain;charset=UTF-8' };
  }
  const json = JSON.stringify(data);
  if (json === undefined) throw new Error('请求体必须是 JSON、文本、表单或二进制内容');
  assertSize(encoder.encode(json).length);
  return { kind: 'json', value: JSON.parse(json) as unknown };
}
export function nativeBody(body: PackedBody): { data?: BodyInit; contentType?: string } {
  switch (body.kind) {
    case 'empty': return {};
    case 'json': return { data: JSON.stringify(body.value), contentType: 'application/json;charset=UTF-8' };
    case 'text': return { data: body.value, contentType: body.contentType };
    case 'binary': return { data: base64url.decode(body.base64).slice().buffer as ArrayBuffer, contentType: body.contentType };
    case 'form': {
      const form = new FormData();
      for (const entry of body.entries) {
        if ('value' in entry) form.append(entry.name, entry.value);
        else form.append(entry.name, new Blob([base64url.decode(entry.base64).slice().buffer as ArrayBuffer], { type: entry.contentType }), entry.filename);
      }
      return { data: form }; // 浏览器负责 multipart boundary，不能手工写 Content-Type。
    }
  }
}
export function unpackBody(body: PackedBody, responseType: 'json' | 'text' | 'blob' | 'arraybuffer' = 'json'): unknown {
  if (body.kind === 'empty') return undefined;
  if (body.kind === 'form') return body.entries;
  const type = body.kind === 'json' ? 'application/json' : body.contentType;
  const bytes = body.kind === 'binary' ? base64url.decode(body.base64) : encoder.encode(body.kind === 'json' ? JSON.stringify(body.value) : body.value);
  if (responseType === 'blob') return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
  if (responseType === 'arraybuffer') return bytes.slice().buffer;
  if (responseType === 'text') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (body.kind === 'json') return body.value;
  if (body.kind === 'text') return body.value;
  return bytes;
}
