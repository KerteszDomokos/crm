import type { CsvIssue, CsvParseResult, CsvRecord } from './types.ts'

export class CsvSyntaxError extends Error {
  readonly rowNumber: number

  constructor(message: string, rowNumber: number) {
    super(`${message} (starting at line ${rowNumber})`)
    this.name = 'CsvSyntaxError'
    this.rowNumber = rowNumber
  }
}

/**
 * Parse RFC 4180-style CSV, including escaped quotes, CRLF, and quoted fields
 * containing newlines. Cell content is not trimmed or otherwise modified.
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input
  const matrix: Array<{ line: number; cells: string[] }> = []
  const issues: CsvIssue[] = []
  let cells: string[] = []
  let field = ''
  let line = 1
  let rowStartLine = 1
  let quoted = false
  let closedQuote = false
  let touched = false

  const finishField = () => {
    cells.push(field)
    field = ''
    closedQuote = false
  }
  const finishRow = () => {
    finishField()
    if (cells.some((cell) => cell.length > 0)) matrix.push({ line: rowStartLine, cells })
    cells = []
    rowStartLine = line + 1
    touched = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    const next = text[index + 1]

    if (quoted) {
      if (char === '"') {
        if (next === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
          closedQuote = true
        }
      } else {
        field += char
        if (char === '\n') line += 1
        else if (char === '\r' && next !== '\n') line += 1
      }
      touched = true
      continue
    }

    if (closedQuote) {
      if (char === ',') {
        finishField()
        touched = true
        continue
      }
      if (char === '\r' || char === '\n') {
        finishRow()
        if (char === '\r' && next === '\n') index += 1
        line += 1
        rowStartLine = line
        continue
      }
      if (char === ' ' || char === '\t') continue
      throw new CsvSyntaxError('Unexpected character after a closing quote', rowStartLine)
    }

    if (char === '"') {
      if (field.length !== 0) throw new CsvSyntaxError('Quote inside an unquoted field', rowStartLine)
      quoted = true
      touched = true
      continue
    }
    if (char === ',') {
      finishField()
      touched = true
      continue
    }
    if (char === '\r' || char === '\n') {
      finishRow()
      if (char === '\r' && next === '\n') index += 1
      line += 1
      rowStartLine = line
      continue
    }

    field += char
    touched = true
  }

  if (quoted) throw new CsvSyntaxError('Unclosed quoted field', rowStartLine)
  if (touched || cells.length > 0 || field.length > 0 || closedQuote) finishRow()

  if (matrix.length === 0) return { headers: [], records: [], issues }

  const headers = matrix[0]!.cells.map((header) => header.trim())
  if (headers.some((header) => header.length === 0)) {
    issues.push({ rowNumber: matrix[0]!.line, code: 'EMPTY_HEADER', message: 'CSV contains an empty column header.' })
  }
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  for (const header of new Set(duplicates)) {
    issues.push({
      rowNumber: matrix[0]!.line,
      code: 'DUPLICATE_HEADER',
      message: `CSV contains the duplicate column header "${header}".`,
    })
  }

  const records: CsvRecord[] = []
  for (const row of matrix.slice(1)) {
    if (row.cells.length !== headers.length) {
      issues.push({
        rowNumber: row.line,
        code: 'COLUMN_COUNT_MISMATCH',
        message: `Expected ${headers.length} cells but found ${row.cells.length}.`,
      })
    }
    const values: Record<string, string> = {}
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index]!
      if (header) values[header] = row.cells[index] ?? ''
    }
    records.push({ rowNumber: row.line, values, rawCells: [...row.cells] })
  }

  return { headers, records, issues }
}
