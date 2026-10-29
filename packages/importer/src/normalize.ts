export interface SafeArrayParse<T = unknown> {
  value: T[]
  error?: string
}

const INVISIBLE_ARTIFACTS = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g

/** Remove common copied/exported invisible characters without removing meaningful text. */
export function normalizeUnicode(value: string): string {
  return value
    .normalize('NFC')
    .replace(INVISIBLE_ARTIFACTS, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .normalize('NFC')
}

export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null
  const cleaned = normalizeUnicode(value).trim()
  return cleaned.length > 0 ? cleaned : null
}

/** Parse JSON array cells without throwing on malformed exports or non-array JSON. */
export function parseJsonArrayCell<T = unknown>(raw: string | null | undefined): SafeArrayParse<T> {
  const value = raw?.trim() ?? ''
  if (value === '') return { value: [] }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return { value: [], error: 'Expected a JSON array.' }
    return { value: parsed as T[] }
  } catch (error) {
    return {
      value: [],
      error: error instanceof Error ? `Invalid JSON array: ${error.message}` : 'Invalid JSON array.',
    }
  }
}

/** Accent-insensitive key suitable for name comparisons and duplicate suggestions. */
export function normalizeName(value: string): string {
  return normalizeUnicode(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeEmail(value: string): string {
  const email = normalizeUnicode(value).trim()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return email
  return `${email.slice(0, at)}@${email.slice(at + 1).toLocaleLowerCase('en')}`
}

export function normalizePhone(value: string, callingCode?: string | null): string {
  const phone = normalizeUnicode(value).trim()
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  if (phone.startsWith('+')) return `+${digits}`
  if (phone.startsWith('00')) return `+${digits.slice(2)}`

  const code = callingCode ? normalizeUnicode(callingCode).replace(/[^\d+]/g, '') : ''
  if (code) {
    const prefix = code.startsWith('+') ? code : `+${code}`
    const national = digits.replace(/^0+/, '')
    return `${prefix}${national}`
  }
  return digits
}

export function canonicalUrl(value: string): string {
  const raw = normalizeUnicode(value).trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    url.hostname = url.hostname.toLocaleLowerCase('en').replace(/^www\./, '')
    url.search = ''
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || (url.pathname === '/' ? '' : '/')
    return `${url.hostname}${url.pathname}`
  } catch {
    return raw.replace(/\/+$/, '').toLocaleLowerCase('en')
  }
}

export function normalizeDomain(value: string): string {
  const raw = normalizeUnicode(value).trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.toLocaleLowerCase('en').replace(/^www\./, '')
  } catch {
    return raw.toLocaleLowerCase('en').replace(/^www\./, '').replace(/\/+$/, '')
  }
}

export function normalizedPhoneKey(value: string): string {
  return normalizePhone(value)
}

export function stringSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (!left || !right) return 0
  const a = [...left]
  const b = [...right]
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let row = 1; row <= a.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + substitutionCost,
      )
    }
    previous = current
  }

  return 1 - previous[b.length]! / Math.max(a.length, b.length)
}

export function parseFiniteNumber(value: string | null | undefined): number | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  const result = Number(cleaned)
  return Number.isFinite(result) ? result : null
}
