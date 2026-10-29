import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createImportPlan as publicCreateImportPlan } from '@resoloon/importer'
import { createImportPlan } from '../src/importer.ts'
import type { CsvBundle } from '../src/types.ts'

const personHeaders = [
  'Id', 'Name / First Name', 'Name / Last Name', 'Category', 'Emails / Primary Email',
  'Emails / Additional Emails', 'Importance', 'Company Id', 'Linkedin / Link Label',
  'Linkedin / Link URL', 'Linkedin / Secondary Links', 'Phones / Primary Phone Number',
  'Phones / Primary Phone Country Code', 'Phones / Primary Phone Calling Code',
  'Phones / Additional Phones', 'Note', 'Job Title', 'Created by / Source', 'Created by / Name',
  'Created by / Workspace Member', 'Created by / Context', 'Creation date', 'Location / City',
]
const companyHeaders = [
  'Id', 'Name', 'Domain Name / Link Label', 'Domain Name / Link URL', 'Domain Name / Secondary Links',
  'Created by / Source', 'Created by / Name', 'Created by / Workspace Member', 'Created by / Context',
  'Account Owner Id', 'Creation date', 'Linkedin / Link Label', 'Linkedin / Link URL',
  'Linkedin / Secondary Links', 'Address / City', 'Category', 'Other people Id', 'Last update',
  'Customer Profile', 'Role', 'Industry-old', 'Company Description', 'Industry',
]
const noteHeaders = [
  'Id', 'Title', 'Body / BlockNote', 'Body / Markdown', 'Body / TipTap', 'Created by / Source',
  'Created by / Name', 'Created by / Workspace Member', 'Created by / Context', 'Creation date',
]

test('exposes the documented package entry point', () => {
  assert.equal(publicCreateImportPlan, createImportPlan)
})

function csv(headers: string[], rows: string[][]): string {
  const encode = (cell: string) => `"${cell.replaceAll('"', '""')}"`
  return [headers, ...rows].map((row) => row.map(encode).join(',')).join('\r\n')
}

function bundle(
  personRows: string[][] = [],
  companyRows: string[][] = [],
  noteRows: string[][] = [],
): CsvBundle {
  return {
    people: csv(personHeaders, personRows),
    companies: csv(companyHeaders, companyRows),
    notes: csv(noteHeaders, noteRows),
  }
}

function personRow(overrides: Record<string, string> = {}): string[] {
  const values: Record<string, string> = {
    Id: 'p1',
    'Name / First Name': 'Ada',
    'Name / Last Name': 'Lovelace',
    Category: '["VC","STARTUP"]',
    'Emails / Primary Email': 'ada@Example.COM',
    'Emails / Additional Emails': '[]',
    Importance: 'RATING_4',
    'Company Id': 'c1',
    'Linkedin / Link Label': '',
    'Linkedin / Link URL': 'https://www.linkedin.com/in/ada?trk=export',
    'Linkedin / Secondary Links': '[]',
    'Phones / Primary Phone Number': '30 123 4567',
    'Phones / Primary Phone Country Code': 'HU',
    'Phones / Primary Phone Calling Code': '\u200d+36',
    'Phones / Additional Phones': '[]',
    Note: '',
    'Job Title': '',
    'Created by / Source': 'AGENT',
    'Created by / Name': 'Legacy Actor',
    'Created by / Workspace Member': 'member-legacy',
    'Created by / Context': '{"provider":"google"}',
    'Creation date': '2026-10-01T12:00:00.000Z',
    'Location / City': 'Budapest',
    ...overrides,
  }
  return personHeaders.map((header) => values[header] ?? '')
}

function companyRow(overrides: Record<string, string> = {}): string[] {
  const values: Record<string, string> = {
    Id: 'c1',
    Name: 'Example Ltd',
    'Domain Name / Link Label': '',
    'Domain Name / Link URL': 'https://www.example.com/company',
    'Domain Name / Secondary Links': '[]',
    'Created by / Source': 'MANUAL',
    'Created by / Name': 'Legacy Actor',
    'Created by / Workspace Member': '',
    'Created by / Context': '',
    'Account Owner Id': '',
    'Creation date': '2026-10-01T12:00:00.000Z',
    'Linkedin / Link Label': '',
    'Linkedin / Link URL': '',
    'Linkedin / Secondary Links': '[]',
    'Address / City': 'Budapest',
    Category: '["INSURANCE"]',
    'Other people Id': '["p1","p2"]',
    'Last update': '',
    'Customer Profile': '',
    Role: '',
    'Industry-old': 'INSURANCE_REINSURANCE',
    'Company Description': 'Company description',
    Industry: '["INSURANCE_SOFTWARE"]',
    ...overrides,
  }
  return companyHeaders.map((header) => values[header] ?? '')
}

function noteRow(overrides: Record<string, string> = {}): string[] {
  const values: Record<string, string> = {
    Id: 'n1',
    Title: 'An unassigned note',
    'Body / BlockNote': '[{"type":"paragraph"}]',
    'Body / Markdown': 'Line one\nLine two',
    'Body / TipTap': '{"type":"doc"}',
    'Created by / Source': 'API',
    'Created by / Name': 'Old user',
    'Created by / Workspace Member': '',
    'Created by / Context': '',
    'Creation date': '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
  return noteHeaders.map((header) => values[header] ?? '')
}

test('normalizes names and arrays, preserves provenance, and reconciles relationships from both sides', () => {
  const plan = createImportPlan(bundle([
    personRow(),
    personRow({
      Id: 'p2',
      'Name / First Name': 'Dr. Jan',
      'Name / Last Name': 'Mehnen',
      'Company Id': '',
      'Emails / Primary Email': '',
      'Phones / Primary Phone Number': '',
    }),
  ], [companyRow()], [noteRow()]))

  assert.equal(plan.people[0]?.fullName, 'Ada Lovelace')
  assert.deepEqual(plan.people[0]?.categories, ['VC', 'STARTUP'])
  assert.equal(plan.people[0]?.emails[0]?.normalized, 'ada@example.com')
  assert.equal(plan.people[0]?.phones[0]?.callingCode, '+36')
  assert.equal(plan.people[0]?.phones[0]?.normalized, '+36301234567')
  assert.equal(plan.people[0]?.provenance.sourceId, 'p1')
  assert.equal(plan.people[0]?.provenance.source, 'AGENT')
  assert.deepEqual(plan.people[0]?.provenance.actor.context, { provider: 'google' })
  assert.equal(plan.people[0]?.provenance.rawRow['Phones / Primary Phone Calling Code'], '\u200d+36')

  const p1Company = plan.relationships.find((relationship) => relationship.personLegacyId === 'p1')
  const p2Company = plan.relationships.find((relationship) => relationship.personLegacyId === 'p2')
  assert.deepEqual(p1Company?.sources, ['person.companyId', 'company.otherPeopleId'])
  assert.equal(p1Company?.primary, true)
  assert.deepEqual(p2Company?.sources, ['company.otherPeopleId'])
  assert.deepEqual(plan.companies[0]?.personIds, ['p1', 'p2'])
  assert.deepEqual(plan.people[1]?.companyIds, ['c1'])
  assert.deepEqual(plan.companies[0]?.industries, ['INSURANCE_SOFTWARE', 'INSURANCE_REINSURANCE'])
})

test('does not duplicate a name already combined in the first-name cell', () => {
  const plan = createImportPlan(bundle([
    personRow({ 'Name / First Name': 'Ada Lovelace', 'Name / Last Name': 'Lovelace', 'Company Id': '' }),
  ]))
  assert.equal(plan.people[0]?.fullName, 'Ada Lovelace')
})

test('reports exact and fuzzy duplicate candidates and requires review', () => {
  const plan = createImportPlan(bundle([
    personRow(),
    personRow({
      Id: 'p2',
      'Name / First Name': 'Ada Lovelace',
      'Name / Last Name': '',
      'Company Id': '',
      'Emails / Primary Email': '',
      'Linkedin / Link URL': '',
      'Phones / Primary Phone Number': '',
    }),
  ]), {
    existingPeople: [{ legacyId: 'crm-person-1', name: 'Ada Lovelace', emails: ['ada@example.com'] }],
  })

  assert.ok(plan.duplicateCandidates.some((candidate) => candidate.match === 'EXACT' && candidate.first.source === 'incoming' && candidate.second.source === 'existing'))
  assert.ok(plan.duplicateCandidates.some((candidate) => candidate.match === 'FUZZY' && candidate.first.legacyId === 'p1' && candidate.second.legacyId === 'p2'))
  assert.equal(plan.people[0]?.importStatus, 'REVIEW_REQUIRED')
  assert.ok(plan.issues.some((entry) => entry.code === 'DUPLICATE_CANDIDATE'))
})

test('classifies a matching legacy source ID as an update rather than a duplicate', () => {
  const plan = createImportPlan(bundle([personRow({ 'Company Id': '' })]), {
    existingPeople: [{ legacyId: 'p1', name: 'Ada Lovelace', emails: ['ada@example.com'] }],
  })
  assert.equal(plan.people[0]?.importStatus, 'UPDATE')
  assert.equal(plan.summary.people.created, 0)
  assert.equal(plan.summary.people.updated, 1)
  assert.equal(plan.summary.duplicateCandidateCount, 0)
})

test('malformed JSON becomes a row issue and notes remain unassigned review items', () => {
  const plan = createImportPlan(bundle(
    [personRow({ Category: '{bad json}', 'Company Id': '' })],
    [],
    [noteRow()],
  ))
  assert.ok(plan.issues.some((entry) => entry.code === 'INVALID_JSON_ARRAY' && entry.field === 'Category'))
  assert.equal(plan.people[0]?.importStatus, 'REVIEW_REQUIRED')
  assert.equal(plan.notes[0]?.relationshipStatus, 'UNASSIGNED_REVIEW')
  assert.deepEqual(plan.notes[0]?.personIds, [])
  assert.deepEqual(plan.notes[0]?.companyIds, [])
  assert.deepEqual(plan.notes[0]?.opportunityIds, [])
  assert.equal(plan.notes[0]?.bodyMarkdown, 'Line one\nLine two')
  assert.equal(plan.notes[0]?.legacyRichText.blockNote, '[{"type":"paragraph"}]')
  assert.equal(plan.notes[0]?.importStatus, 'REVIEW_REQUIRED')
  assert.equal(plan.summary.notes.reviewRequired, 1)
})

test('counts missing IDs and invalid CSV row widths as skipped instead of losing them from the report', () => {
  const malformedPeople = `${csv(personHeaders, [personRow({ Id: '' })])}\r\nextra,short`
  const plan = createImportPlan({
    people: malformedPeople,
    companies: csv(companyHeaders, []),
    notes: csv(noteHeaders, []),
  })
  assert.equal(plan.summary.people.total, 2)
  assert.equal(plan.summary.people.skipped, 2)
  assert.ok(plan.issues.some((entry) => entry.code === 'MISSING_LEGACY_ID'))
  assert.ok(plan.issues.some((entry) => entry.code === 'COLUMN_COUNT_MISMATCH'))
})

test('ingests the checked-in exports with their real row counts and leaves every note unattached', async () => {
  const [people, companies, notes] = await Promise.all([
    readFile(new URL('../../../data/person.csv', import.meta.url), 'utf8'),
    readFile(new URL('../../../data/company.csv', import.meta.url), 'utf8'),
    readFile(new URL('../../../data/note.csv', import.meta.url), 'utf8'),
  ])
  const plan = createImportPlan({ people, companies, notes })
  assert.equal(plan.summary.people.total, 460)
  assert.equal(plan.summary.companies.total, 300)
  assert.equal(plan.summary.notes.total, 25)
  assert.ok(plan.people.some((person) => person.phones.some((phone) => phone.callingCode === '+36')))
  assert.ok(plan.relationships.length > 0)
  assert.ok(plan.notes.every((note) => note.relationshipStatus === 'UNASSIGNED_REVIEW' && note.personIds.length === 0 && note.companyIds.length === 0))
})
