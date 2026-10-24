export interface FilePickerRules {
  /** Comma-separated extensions, MIME types, or MIME wildcards. */
  accept?: string
  multiple?: boolean
  maxFiles?: number
  /** Maximum bytes per file. */
  maxSize?: number
  /** Maximum bytes across the resulting selection. */
  maxTotalSize?: number
}

export interface FileRejection {
  file: File
  code: 'type' | 'size' | 'count' | 'total-size' | 'duplicate'
  message: string
}

/** Includes metadata so equally named files with different metadata can coexist. */
export function fileKey(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified, file.type])
}

export function formatFileSize(bytes: number): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (size < 1024) return `${Math.floor(size)} B`

  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)) - 1, units.length - 1)
  const value = size / 1024 ** (unitIndex + 1)
  return `${Number(value.toFixed(value < 10 ? 2 : 1))} ${units[unitIndex]}`
}

/** Omitted limits are unlimited; explicitly invalid limits fail closed at zero. */
function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function acceptsFile(file: File, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true

  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase().split(';', 1)[0]?.trim() ?? ''

  return tokens.some((token) => {
    if (/^\.[^\s/,]+$/.test(token)) return name.endsWith(token)
    if (token === '*/*') return true

    // Invalid accept tokens never silently widen the permitted file types.
    const match = /^([a-z0-9!#$&^_.+-]+)\/(\*|[a-z0-9!#$&^_.+-]+)$/.exec(token)
    if (!match || !mime) return false
    if (match[2] === '*') return mime.startsWith(`${match[1]}/`)
    return mime === token
  })
}

/**
 * Existing files are an already accepted selection. Invalid incoming files do
 * not clear it. Multiple mode appends; single mode replaces it only after a
 * valid candidate is found. Existing selections are preserved when limits or
 * mode change, including a previous multi-file selection in single mode. The
 * caller can show validation errors until the user removes or replaces files.
 *
 * This is a client-side convenience check of names and browser MIME metadata;
 * servers must independently validate uploaded content and size limits.
 */
export function validateFiles(
  incoming: readonly File[],
  existing: readonly File[],
  rules: FilePickerRules,
): { files: File[]; rejected: FileRejection[] } {
  const multiple = rules.multiple ?? false
  let files = [...existing]
  const rejected: FileRejection[] = []
  const keys = new Set(files.map(fileKey))
  const tokens = (rules.accept ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
  const countLimit = Math.min(normalizeLimit(rules.maxFiles), multiple ? Infinity : 1)
  const sizeLimit = normalizeLimit(rules.maxSize)
  const totalLimit = normalizeLimit(rules.maxTotalSize)
  let totalSize = multiple ? files.reduce((total, file) => total + file.size, 0) : 0
  let acceptedSingle = false

  function reject(file: File, code: FileRejection['code'], message: string): void {
    rejected.push({ file, code, message })
  }

  for (const file of incoming) {
    if (!multiple && acceptedSingle) {
      reject(file, 'count', '单选模式最多选择 1 个文件，已保留本次选择的首个有效文件。')
      continue
    }

    if (!acceptsFile(file, tokens)) {
      reject(file, 'type', `文件格式不符合要求，允许：${tokens.join('、')}。`)
      continue
    }

    if (file.size > sizeLimit) {
      reject(file, 'size', `文件大小为 ${formatFileSize(file.size)}，单个文件不得超过 ${formatFileSize(sizeLimit)}。`)
      continue
    }

    const key = fileKey(file)
    if (keys.has(key)) {
      reject(file, 'duplicate', '该文件已经在选择列表中，请勿重复添加。')
      continue
    }

    const nextCount = multiple ? files.length + 1 : 1
    if (nextCount > countLimit) {
      reject(file, 'count', countLimit === 0
        ? '当前数量限制为 0，无法添加文件。'
        : `最多选择 ${countLimit} 个文件，请先移除部分已选文件。`)
      continue
    }

    const nextTotalSize = totalSize + file.size
    if (nextTotalSize > totalLimit) {
      reject(file, 'total-size', `添加后总大小为 ${formatFileSize(nextTotalSize)}，不得超过 ${formatFileSize(totalLimit)}。`)
      continue
    }

    if (multiple) files.push(file)
    else {
      files = [file]
      acceptedSingle = true
    }
    keys.add(key)
    totalSize = nextTotalSize
  }

  return { files, rejected }
}
