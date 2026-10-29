import assert from 'node:assert/strict'
import test from 'node:test'
import { CsvSyntaxError, parseCsv } from '../src/csv.ts'
import { canonicalUrl, normalizeUnicode, parseJsonArrayCell } from '../src/normalize.ts'

test('parses escaped quotes, CRLF, and quoted multiline fields with physical row numbers', () => {
  const result = parseCsv('\uFEFFid,body\r\n1,"first line\r\nsecond line"\r\n2,"say ""hello"""')
  assert.deepEqual(result.headers, ['id', 'body'])
  assert.equal(result.records.length, 2)
  assert.equal(result.records[0]?.rowNumber, 2)
  assert.equal(result.records[0]?.values.body, 'first line\r\nsecond line')
  assert.equal(result.records[1]?.rowNumber, 4)
  assert.equal(result.records[1]?.values.body, 'say "hello"')
  assert.deepEqual(result.issues, [])
})

test('reports rows with a different number of cells', () => {
  const result = parseCsv('id,name\n1,Ada,extra\n2')
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.issues.map((entry) => entry.code), ['COLUMN_COUNT_MISMATCH', 'COLUMN_COUNT_MISMATCH'])
  assert.equal(result.issues[0]?.rowNumber, 2)
  assert.deepEqual(result.records[0]?.rawCells, ['1', 'Ada', 'extra'])
})

test('rejects malformed quoting instead of silently shifting later columns', () => {
  assert.throws(() => parseCsv('id,name\n1,"Ada'), CsvSyntaxError)
  assert.throws(() => parseCsv('id,name\n1,Ad"a'), CsvSyntaxError)
})

test('safely handles malformed JSON-array cells and rejects non-array JSON', () => {
  assert.deepEqual(parseJsonArrayCell(' ["one", "two"] '), { value: ['one', 'two'] })
  const malformed = parseJsonArrayCell('not-json')
  assert.deepEqual(malformed.value, [])
  assert.match(malformed.error ?? '', /Invalid JSON array/)
  assert.match(parseJsonArrayCell('{"one":1}').error ?? '', /Expected a JSON array/)
  assert.deepEqual(parseJsonArrayCell(''), { value: [] })
})

test('normalizes invisible Unicode artifacts and canonicalizes LinkedIn URL tracking data', () => {
  assert.equal(normalizeUnicode('a\u200d\u00a0b\ufeff'), 'a b')
  assert.equal(canonicalUrl('https://www.linkedin.com/in/example/?trk=export#top'), 'linkedin.com/in/example')
})
