export function readable(value: unknown): string {
  if (value === undefined) return '等待请求数据…'
  if (typeof value === 'string') return value
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof File) return { name: item.name, type: item.type, bytes: item.size }
    if (item instanceof Blob) return { type: item.type, bytes: item.size }
    if (item instanceof FormData) return Object.fromEntries(item.entries())
    if (item instanceof URLSearchParams) return Object.fromEntries(item.entries())
    if (item instanceof ArrayBuffer) return { bytes: item.byteLength }
    if (ArrayBuffer.isView(item)) return { bytes: item.byteLength, preview: Array.from(new Uint8Array(item.buffer, item.byteOffset, Math.min(item.byteLength, 48))) }
    return item
  }, 2) ?? String(value)
}
