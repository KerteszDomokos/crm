// Usage: DATABASE_URL=... [CSV_DIR=...] [WORKSPACE_ID=...] tsx apps/api/src/import-legacy.ts [--commit]
// Without --commit this reads and summarizes the import plan without writing to the database.

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { loadLocalEnv } from './env.js'

loadLocalEnv()

const SOURCE_SYSTEM = 'legacy-csv-v1'
const IMPORT_TYPE = 'legacy_csv'
const IMPORTER_PACKAGE = '@resoloon/importer'
const FILES = [
  { entityType: 'person', name: 'person.csv' },
  { entityType: 'company', name: 'company.csv' },
  { entityType: 'note', name: 'note.csv' },
] as const
type FileEntityType = (typeof FILES)[number]['entityType']
type PlannedRecord = PersonRecord | CompanyRecord | NoteRecord
type RowStatus = 'PENDING' | 'VALID' | 'CREATED' | 'UPDATED' | 'SKIPPED' | 'ERROR' | 'REVIEW_REQUIRED'
type ReviewState = 'NOT_REQUIRED' | 'PENDING'

type ImportStatus = 'READY' | 'UPDATE' | 'REVIEW_REQUIRED' | 'SKIPPED'
type EntityType = FileEntityType

interface CsvRecord {
  rowNumber: number
  values: Record<string, string>
  rawCells: string[]
}

interface LegacyProvenance {
  sourceFile: string
  sourceId: string
  sourceType: 'LEGACY_CSV'
  source: string | null
  actor: Record<string, unknown>
  createdAt: string | null
  updatedAt: string | null
  rawRow: Record<string, string>
  rawCells: string[]
}

interface PersonRecord {
  legacyId: string
  fullName: string
  normalizedName: string
  categories: string[]
  emails: Array<{ raw: string; normalized: string; primary: boolean }>
  phones: Array<{ raw: string; normalized: string; countryCode: string | null; callingCode: string | null; primary: boolean }>
  links: Array<{ label: string | null; url: string; canonicalUrl: string; kind: 'linkedin' | 'website' | 'other'; primary: boolean }>
  importance: string | null
  jobTitle: string | null
  description: string | null
  companyIds: string[]
  location: LegacyLocation
  nextFollowUp: string | null
  provenance: LegacyProvenance
  importStatus: ImportStatus
}

interface CompanyRecord {
  legacyId: string
  name: string
  normalizedName: string
  domains: Array<{ raw: string; normalized: string; label: string | null; primary: boolean }>
  links: PersonRecord['links']
  categories: string[]
  industries: string[]
  customerProfile: string | null
  businessRole: string | null
  description: string | null
  accountOwnerLegacyId: string | null
  personIds: string[]
  location: LegacyLocation
  provenance: LegacyProvenance
  importStatus: ImportStatus
}

interface NoteRecord {
  legacyId: string
  title: string
  bodyMarkdown: string
  legacyRichText: { blockNote: string | null; tipTap: string | null }
  relationshipStatus: 'UNASSIGNED_REVIEW'
  personIds: []
  companyIds: []
  opportunityIds: []
  provenance: LegacyProvenance
  importStatus: ImportStatus
}

interface LegacyLocation {
  street: string | null
  street2: string | null
  city: string | null
  region: string | null
  country: string | null
  postalCode: string | null
  latitude: number | null
  longitude: number | null
}

interface DuplicateProfile {
  legacyId: string
  name: string
  emails?: string[]
  phones?: string[]
  domains?: string[]
  linkedinUrls?: string[]
}

interface ImportIssue {
  entityType: EntityType
  legacyId: string | null
  rowNumber: number
  severity: 'warning' | 'error'
  code: string
  message: string
  field?: string
}

interface ImportPlan {
  people: PersonRecord[]
  companies: CompanyRecord[]
  notes: NoteRecord[]
  relationships: Array<{ personLegacyId: string; companyLegacyId: string; primary: boolean; sources: string[] }>
  issues: ImportIssue[]
  summary: {
    people: { total: number; created: number; updated: number; skipped: number; reviewRequired: number }
    companies: { total: number; created: number; updated: number; skipped: number; reviewRequired: number }
    notes: { total: number; created: number; updated: number; skipped: number; reviewRequired: number }
    relationships: { total: number; primary: number; unresolved: number }
    issueCount: number
    duplicateCandidateCount: number
  }
}

interface ImporterApi {
  parseCsv(input: string): { headers: string[]; records: CsvRecord[] }
  cleanText(input: string | null | undefined): string | null
  createImportPlan(
    bundle: { people: string; companies: string; notes: string },
    options?: {
      sourceFiles?: Partial<Record<EntityType, string>>
      existingPeople?: DuplicateProfile[]
      existingCompanies?: DuplicateProfile[]
    },
  ): ImportPlan
  normalizeName(input: string): string
}

interface InputFile {
  entityType: FileEntityType
  name: string
  bytes: Buffer
  text: string
  headers: string[]
  rows: CsvRecord[]
}

interface PreparedRow {
  entityType: FileEntityType
  fileName: string
  fileRowNumber: number
  batchRowNumber: number
  headers: string[]
  sourceKey: string | null
  raw: CsvRecord
  record?: PlannedRecord
  projection: Record<string, unknown>
  provenance: Record<string, unknown>
  issues: ImportIssue[]
  status: RowStatus
  reviewState: ReviewState
  targetRecordId: string | null
  shouldImport: boolean
  recordId?: string
  isUpdate?: boolean
  importRowId?: string
}

interface ExistingReference {
  objectType: string
  externalId: string
  recordId: string
  recordType: string
  archived: boolean
}

interface ExistingData {
  people: DuplicateProfile[]
  companies: DuplicateProfile[]
  references: Map<string, ExistingReference>
}

interface InputFiles {
  person: InputFile
  company: InputFile
  note: InputFile
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseArguments(args: string[]): { commit: boolean; help: boolean } {
  let commit = false
  let help = false
  for (const arg of args) {
    if (arg === '--commit') commit = true
    else if (arg === '--help' || arg === '-h') help = true
    else fail(`Unknown option: ${arg}. Use --help for usage.`)
  }
  return { commit, help }
}

function usage(): void {
  console.log('Legacy CSV import (dry-run by default)')
  console.log('  DATABASE_URL=... [CSV_DIR=...] [WORKSPACE_ID=...] tsx apps/api/src/import-legacy.ts [--commit]')
  console.log('  CSV_DIR defaults to the repository data/ directory; it must contain person.csv, company.csv, and note.csv.')
  console.log('  WORKSPACE_ID is optional only when the database contains exactly one workspace.')
  console.log('  --commit is required to create or update CRM records.')
}

async function loadImporter(): Promise<ImporterApi> {
  const importer = await import(IMPORTER_PACKAGE)
  return importer as unknown as ImporterApi
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function parseSourceDate(value: string | null): Date | null {
  if (!value?.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function sourceRowKey(entityType: FileEntityType, externalId: string): string {
  return `${entityType}\0${externalId}`
}

function planRecords(plan: ImportPlan, entityType: FileEntityType): PlannedRecord[] {
  if (entityType === 'person') return plan.people
  if (entityType === 'company') return plan.companies
  return plan.notes
}

function planIssues(plan: ImportPlan, entityType: FileEntityType, rowNumber: number): ImportIssue[] {
  return plan.issues.filter((issue) => issue.entityType === entityType && issue.rowNumber === rowNumber)
}

function fallbackProvenance(file: InputFile, row: CsvRecord, sourceKey: string | null): Record<string, unknown> {
  return {
    sourceFile: file.name,
    sourceId: sourceKey ?? `invalid-row-${row.rowNumber}`,
    sourceType: 'LEGACY_CSV',
    rawRow: { ...row.values },
    rawCells: [...row.rawCells],
  }
}

function rowState(record: PlannedRecord | undefined, issues: ImportIssue[]): { status: RowStatus; reviewState: ReviewState; shouldImport: boolean } {
  if (record?.importStatus === 'READY' || record?.importStatus === 'UPDATE') {
    return { status: 'VALID', reviewState: 'NOT_REQUIRED', shouldImport: true }
  }
  if (record?.importStatus === 'REVIEW_REQUIRED') {
    return { status: 'REVIEW_REQUIRED', reviewState: 'PENDING', shouldImport: false }
  }
  if (issues.some((issue) => issue.severity === 'error')) {
    return { status: 'ERROR', reviewState: 'NOT_REQUIRED', shouldImport: false }
  }
  return { status: 'SKIPPED', reviewState: 'NOT_REQUIRED', shouldImport: false }
}

function prepareRows(files: InputFiles, plan: ImportPlan, importer: ImporterApi): PreparedRow[] {
  const prepared: PreparedRow[] = []
  let batchRowNumber = 0

  for (const definition of FILES) {
    const file = files[definition.entityType]
    const records = new Map(planRecords(plan, definition.entityType).map((record) => [record.legacyId, record]))
    const assigned = new Set<string>()

    for (const raw of file.rows) {
      batchRowNumber += 1
      const sourceKey = importer.cleanText(raw.values.Id)
      // The importer keeps the first duplicate ID and emits an error for each later row.
      const record = sourceKey && !assigned.has(sourceKey) ? records.get(sourceKey) : undefined
      if (sourceKey) assigned.add(sourceKey)
      const issues = planIssues(plan, definition.entityType, raw.rowNumber)
      const state = rowState(record, issues)
      // Legacy notes have no reliable attachments. Import their Markdown as
      // unassigned notes, while keeping their review state visible in staging.
      const importUnassignedNote = definition.entityType === 'note' && !!record && state.status === 'REVIEW_REQUIRED'
      const projection = record
        ? { ...record, importStatus: record.importStatus }
        : { normalizationStatus: 'UNAVAILABLE', sourceId: sourceKey, importStatus: state.status }
      prepared.push({
        entityType: definition.entityType,
        fileName: file.name,
        fileRowNumber: raw.rowNumber,
        batchRowNumber,
        headers: file.headers,
        sourceKey,
        raw,
        record,
        projection,
        provenance: (record?.provenance ?? fallbackProvenance(file, raw, sourceKey)) as unknown as Record<string, unknown>,
        issues,
        status: state.status,
        reviewState: state.reviewState,
        targetRecordId: null,
        shouldImport: state.shouldImport || importUnassignedNote,
      })
    }
  }
  return prepared
}

async function readFiles(directory: string, importer: ImporterApi): Promise<InputFiles> {
  const result = {} as InputFiles
  for (const definition of FILES) {
    const bytes = await readFile(resolve(directory, definition.name))
    const text = bytes.toString('utf8')
    const parsed = importer.parseCsv(text)
    result[definition.entityType] = {
      entityType: definition.entityType,
      name: definition.name,
      bytes,
      text,
      headers: parsed.headers,
      rows: parsed.records,
    }
  }
  return result
}

function sourceHash(files: InputFiles): Buffer {
  const hash = createHash('sha256')
  // Hash the original bytes in a fixed, documented file order; do not hash decoded text.
  for (const definition of FILES) hash.update(files[definition.entityType].bytes)
  return hash.digest()
}

async function resolveWorkspaceId(client: PoolClient, requested: string | undefined): Promise<string> {
  if (requested) {
    if (!validUuid(requested)) throw new Error('WORKSPACE_ID must be a UUID.')
    const found = await client.query<{ id: string }>('SELECT id FROM workspaces WHERE id = $1', [requested])
    if (!found.rowCount) throw new Error('WORKSPACE_ID does not identify a workspace.')
    return found.rows[0]!.id
  }

  const workspaces = await client.query<{ id: string }>('SELECT id FROM workspaces ORDER BY id LIMIT 2')
  if (workspaces.rowCount !== 1) throw new Error('Set WORKSPACE_ID unless the database contains exactly one workspace.')
  return workspaces.rows[0]!.id
}

async function loadExistingData(client: PoolClient, workspaceId: string): Promise<ExistingData> {
  const peopleResult = await client.query<{
    legacyId: string
    name: string
    emails: string[]
    phones: string[]
    linkedinUrls: string[]
  }>(
    `SELECT er.external_id AS "legacyId", p.full_name AS name,
       COALESCE((SELECT array_agg(e.normalized_email) FROM person_emails e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id), ARRAY[]::text[]) AS emails,
       COALESCE((SELECT array_agg(COALESCE(ph.e164, ph.raw_phone)) FROM person_phones ph WHERE ph.workspace_id = p.workspace_id AND ph.person_id = p.id), ARRAY[]::text[]) AS phones,
       COALESCE((SELECT array_agg(l.canonical_url) FROM person_links l WHERE l.workspace_id = p.workspace_id AND l.person_id = p.id AND l.kind = 'linkedin'), ARRAY[]::text[]) AS "linkedinUrls"
     FROM external_references er
     JOIN records r ON r.id = er.record_id AND r.workspace_id = er.workspace_id
     JOIN people p ON p.id = r.id AND p.workspace_id = r.workspace_id
     WHERE er.workspace_id = $1 AND er.source_system = $2 AND er.object_type = 'person'
       AND r.record_type = 'PERSON' AND r.archived_at IS NULL`,
    [workspaceId, SOURCE_SYSTEM],
  )
  const companiesResult = await client.query<{
    legacyId: string
    name: string
    domains: string[]
    linkedinUrls: string[]
  }>(
    `SELECT er.external_id AS "legacyId", c.name,
       COALESCE((SELECT array_agg(d.normalized_domain) FROM company_domains d WHERE d.workspace_id = c.workspace_id AND d.company_id = c.id), ARRAY[]::text[]) AS domains,
       COALESCE((SELECT array_agg(l.canonical_url) FROM company_links l WHERE l.workspace_id = c.workspace_id AND l.company_id = c.id AND l.kind = 'linkedin'), ARRAY[]::text[]) AS "linkedinUrls"
     FROM external_references er
     JOIN records r ON r.id = er.record_id AND r.workspace_id = er.workspace_id
     JOIN companies c ON c.id = r.id AND c.workspace_id = r.workspace_id
     WHERE er.workspace_id = $1 AND er.source_system = $2 AND er.object_type = 'company'
       AND r.record_type = 'COMPANY' AND r.archived_at IS NULL`,
    [workspaceId, SOURCE_SYSTEM],
  )
  const referencesResult = await client.query<{
    objectType: string
    externalId: string
    recordId: string
    recordType: string
    archived: boolean
  }>(
    `SELECT er.object_type AS "objectType", er.external_id AS "externalId", er.record_id AS "recordId",
       r.record_type AS "recordType", (r.archived_at IS NOT NULL) AS archived
     FROM external_references er
     LEFT JOIN records r ON r.id = er.record_id AND r.workspace_id = er.workspace_id
     WHERE er.workspace_id = $1 AND er.source_system = $2 AND er.object_type IN ('person', 'company', 'note')`,
    [workspaceId, SOURCE_SYSTEM],
  )
  const references = new Map<string, ExistingReference>()
  for (const reference of referencesResult.rows) {
    references.set(sourceRowKey(reference.objectType as FileEntityType, reference.externalId), reference)
  }
  return {
    people: peopleResult.rows,
    companies: companiesResult.rows,
    references,
  }
}

function createPlan(files: InputFiles, existing: ExistingData, importer: ImporterApi): ImportPlan {
  return importer.createImportPlan(
    {
      people: files.person.text,
      companies: files.company.text,
      notes: files.note.text,
    },
    {
      sourceFiles: { person: files.person.name, company: files.company.name, note: files.note.name },
      existingPeople: existing.people,
      existingCompanies: existing.companies,
    },
  )
}

function addReviewIssue(row: PreparedRow, code: string, message: string): void {
  row.issues.push({
    entityType: row.entityType,
    legacyId: row.sourceKey,
    rowNumber: row.fileRowNumber,
    severity: 'warning',
    code,
    message,
    field: 'Id',
  })
  row.status = 'REVIEW_REQUIRED'
  row.reviewState = 'PENDING'
  row.shouldImport = false
  row.projection = { ...row.projection, importStatus: 'REVIEW_REQUIRED' }
}

async function resolveRecordTargets(
  client: PoolClient,
  workspaceId: string,
  rows: PreparedRow[],
  references: Map<string, ExistingReference>,
): Promise<void> {
  const validIds: string[] = []
  for (const row of rows) {
    if (!row.shouldImport || !row.record || !row.sourceKey) continue
    const reference = references.get(sourceRowKey(row.entityType, row.sourceKey))
    const expectedType = row.entityType === 'person' ? 'PERSON' : row.entityType === 'company' ? 'COMPANY' : 'NOTE'
    if (reference) {
      if (reference.recordType !== expectedType || reference.archived) {
        addReviewIssue(row, 'UNSAFE_EXISTING_REFERENCE', 'The legacy ID already maps to an incompatible or archived CRM record.')
        continue
      }
      if (row.record.importStatus !== 'UPDATE') {
        addReviewIssue(row, 'UNEXPECTED_EXISTING_REFERENCE', 'The legacy ID is already mapped; the existing record was not changed.')
        continue
      }
      row.recordId = reference.recordId
      row.isUpdate = true
      continue
    }

    if (row.record.importStatus === 'UPDATE') {
      addReviewIssue(row, 'MISSING_EXISTING_REFERENCE', 'The import plan requested an update, but no legacy mapping exists.')
      continue
    }
    const candidate = row.sourceKey.toLowerCase()
    if (validUuid(candidate)) {
      row.recordId = candidate
      validIds.push(candidate)
    } else {
      row.recordId = randomUUID()
    }
    row.isUpdate = false
  }

  if (validIds.length) {
    const collisions = await client.query<{ id: string }>('SELECT id FROM records WHERE id = ANY($1::uuid[])', [
      [...new Set(validIds)],
    ])
    const collisionIds = new Set(collisions.rows.map((row) => row.id))
    for (const row of rows) {
      if (row.shouldImport && !row.isUpdate && row.recordId && collisionIds.has(row.recordId)) {
        addReviewIssue(row, 'RECORD_ID_CONFLICT', 'The proposed source UUID is already used by a CRM record; it was left for review.')
        row.recordId = undefined
      }
    }
  }

  const claimed = new Map<string, PreparedRow>()
  for (const row of rows) {
    if (!row.shouldImport || !row.recordId) continue
    const earlier = claimed.get(row.recordId)
    if (earlier) {
      addReviewIssue(row, 'RECORD_ID_CONFLICT', 'Another source row proposed the same CRM UUID; this row was left for review.')
      row.recordId = undefined
    } else claimed.set(row.recordId, row)
  }
}

async function createImportActor(client: PoolClient, workspaceId: string): Promise<string> {
  const actor = await client.query<{ id: string }>(
    `INSERT INTO actors (workspace_id, actor_type, external_actor_key, display_name)
     VALUES ($1, 'IMPORT', $2, 'Legacy CSV Import')
     ON CONFLICT (workspace_id, actor_type, external_actor_key) WHERE external_actor_key IS NOT NULL
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [workspaceId, SOURCE_SYSTEM],
  )
  return actor.rows[0]!.id
}

async function createOrLoadBatch(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  hash: Buffer,
  files: InputFiles,
  totalRows: number,
): Promise<{ id: string; status: string; reused: boolean }> {
  const sourceProvenance = {
    files: FILES.map(({ entityType, name }) => ({ name, byteLength: files[entityType].bytes.byteLength })),
    hashAlgorithm: 'sha256',
  }
  const created = await client.query<{ id: string; status: string }>(
    `INSERT INTO import_batches (
       workspace_id, import_type, source_name, source_sha256, source_provenance,
       created_by_actor_id, total_rows, status
     ) VALUES ($1, $2, 'person.csv,company.csv,note.csv', $3, $4::jsonb, $5, $6, 'IMPORTING')
     ON CONFLICT (workspace_id, import_type, source_sha256) DO NOTHING
     RETURNING id, status`,
    [workspaceId, IMPORT_TYPE, hash, json(sourceProvenance), actorId, totalRows],
  )
  if (created.rowCount) return { id: created.rows[0]!.id, status: 'IMPORTING', reused: false }

  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM import_batches
     WHERE workspace_id = $1 AND import_type = $2 AND source_sha256 = $3 FOR UPDATE`,
    [workspaceId, IMPORT_TYPE, hash],
  )
  if (!existing.rowCount) throw new Error('Could not load the existing import batch.')
  return { ...existing.rows[0]!, reused: true }
}

function importProvenance(row: PreparedRow): Record<string, unknown> {
  return {
    sourceSystem: SOURCE_SYSTEM,
    sourceFile: row.fileName,
    sourceRowNumber: row.fileRowNumber,
    source: row.provenance,
  }
}

async function persistRows(
  client: PoolClient,
  workspaceId: string,
  batchId: string,
  rows: PreparedRow[],
): Promise<void> {
  for (const row of rows) {
    const sourceData = {
      sourceFile: row.fileName,
      sourceRowNumber: row.fileRowNumber,
      headers: row.headers,
      values: row.raw.values,
      rawCells: row.raw.rawCells,
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO import_rows (
         workspace_id, batch_id, row_number, source_key, status, review_state,
         source_data, normalized_data, issues, provenance
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
       ON CONFLICT (workspace_id, batch_id, row_number) DO NOTHING
       RETURNING id`,
      [
        workspaceId,
        batchId,
        row.batchRowNumber,
        row.sourceKey,
        row.status,
        row.reviewState,
        json(sourceData),
        json(row.projection),
        json(row.issues),
        json(importProvenance(row)),
      ],
    )
    if (inserted.rowCount) {
      row.importRowId = inserted.rows[0]!.id
      continue
    }
    const prior = await client.query<{ id: string }>(
      `SELECT id FROM import_rows WHERE workspace_id = $1 AND batch_id = $2 AND row_number = $3`,
      [workspaceId, batchId, row.batchRowNumber],
    )
    if (!prior.rowCount) throw new Error('Could not load a staged import row.')
    row.importRowId = prior.rows[0]!.id
  }
}

function recordSourceDates(record: PlannedRecord): { createdAt: Date | null; updatedAt: Date | null } {
  return {
    createdAt: parseSourceDate(record.provenance.createdAt),
    updatedAt: parseSourceDate(record.provenance.updatedAt),
  }
}

async function writeRecordBase(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  row: PreparedRow,
): Promise<void> {
  const record = row.record!
  const recordType = row.entityType === 'person' ? 'PERSON' : row.entityType === 'company' ? 'COMPANY' : 'NOTE'
  const dates = recordSourceDates(record)
  if (row.isUpdate) {
    await client.query(
      `UPDATE records SET updated_at = COALESCE($1, now()), updated_by_actor_id = $2, version = version + 1
       WHERE id = $3 AND workspace_id = $4 AND record_type = $5`,
      [dates.updatedAt, actorId, row.recordId, workspaceId, recordType],
    )
  } else {
    await client.query(
      `INSERT INTO records (id, workspace_id, record_type, created_at, updated_at, created_by_actor_id, updated_by_actor_id)
       VALUES ($1, $2, $3, COALESCE($4, now()), COALESCE($5, $4, now()), $6, $6)`,
      [row.recordId, workspaceId, recordType, dates.createdAt, dates.updatedAt, actorId],
    )
  }
}

function boundedImportance(raw: string | null): number | null {
  if (!raw) return null
  const rating = /^(?:RATING_)?([0-5])$/i.exec(raw.trim())
  const parsed = Number(rating?.[1] ?? raw)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null
}

function validCoordinate(value: number | null, low: number, high: number): number | null {
  return value !== null && value >= low && value <= high ? value : null
}

function locationValues(location: PersonRecord['location']): [string | null, string | null, string | null, string | null, string | null, string | null, string | null, number | null, number | null] {
  const street = [location.street, location.street2].filter((part): part is string => Boolean(part)).join('\n') || null
  const rawCountry = location.country?.trim() ?? ''
  const countryCode = /^[a-z]{2}$/i.test(rawCountry) ? rawCountry.toUpperCase() : null
  return [
    street,
    location.city,
    location.region,
    location.postalCode,
    countryCode,
    rawCountry || null,
    null,
    validCoordinate(location.latitude, -90, 90),
    validCoordinate(location.longitude, -180, 180),
  ]
}

async function replacePersonDetails(
  client: PoolClient,
  workspaceId: string,
  person: PersonRecord,
  id: string,
  importer: ImporterApi,
): Promise<void> {
  await client.query('DELETE FROM person_emails WHERE workspace_id = $1 AND person_id = $2', [workspaceId, id])
  await client.query('DELETE FROM person_phones WHERE workspace_id = $1 AND person_id = $2', [workspaceId, id])
  await client.query('DELETE FROM person_links WHERE workspace_id = $1 AND person_id = $2', [workspaceId, id])
  await client.query('DELETE FROM person_addresses WHERE workspace_id = $1 AND person_id = $2', [workspaceId, id])
  await client.query('DELETE FROM record_taxonomies WHERE workspace_id = $1 AND record_id = $2', [workspaceId, id])

  await client.query(
    `INSERT INTO people (id, workspace_id, full_name, normalized_name, job_title, description, importance)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, normalized_name = EXCLUDED.normalized_name,
       job_title = EXCLUDED.job_title, description = EXCLUDED.description, importance = EXCLUDED.importance`,
    [id, workspaceId, person.fullName, person.normalizedName || importer.normalizeName(person.fullName), person.jobTitle, person.description, boundedImportance(person.importance)],
  )

  for (const email of person.emails) {
    if (!email.raw.trim() || !email.normalized.trim()) continue
    await client.query(
      `INSERT INTO person_emails (workspace_id, person_id, raw_email, normalized_email, is_primary, provenance)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING`,
      [workspaceId, id, email.raw, email.normalized, email.primary, json({ source: 'legacy-csv', sourceField: email.primary ? 'Emails / Primary Email' : 'Emails / Additional Emails' })],
    )
  }
  for (const phone of person.phones) {
    if (!phone.raw.trim()) continue
    const e164 = /^\+[1-9][0-9]{1,14}$/.test(phone.normalized) ? phone.normalized : null
    await client.query(
      `INSERT INTO person_phones (workspace_id, person_id, raw_phone, e164, is_primary, provenance)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING`,
      [workspaceId, id, phone.raw, e164, phone.primary, json({ source: 'legacy-csv' })],
    )
  }
  const seenLinks = new Set<string>()
  for (const link of person.links) {
    if (!link.url.trim() || !link.canonicalUrl.trim() || seenLinks.has(link.canonicalUrl)) continue
    seenLinks.add(link.canonicalUrl)
    await client.query(
      `INSERT INTO person_links (workspace_id, person_id, kind, raw_url, canonical_url, is_primary, provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT DO NOTHING`,
      [workspaceId, id, link.kind, link.url, link.canonicalUrl, link.primary, json({ source: 'legacy-csv', label: link.label })],
    )
  }
  const address = locationValues(person.location)
  if (address.slice(0, 6).some(Boolean) || address[7] !== null || address[8] !== null) {
    await client.query(
      `INSERT INTO person_addresses (workspace_id, person_id, street, city, region, postal_code, country_code, country_name, provider_place_id, latitude, longitude, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) ON CONFLICT DO NOTHING`,
      [workspaceId, id, address[0], address[1], address[2], address[3], address[4], address[5], address[6], address[7], address[8]],
    )
  }
  await insertTaxonomies(client, workspaceId, id, 'PERSON_CATEGORY', person.categories, importer)
}

async function replaceCompanyDetails(
  client: PoolClient,
  workspaceId: string,
  company: CompanyRecord,
  id: string,
  importer: ImporterApi,
): Promise<void> {
  await client.query('DELETE FROM company_domains WHERE workspace_id = $1 AND company_id = $2', [workspaceId, id])
  await client.query('DELETE FROM company_links WHERE workspace_id = $1 AND company_id = $2', [workspaceId, id])
  await client.query('DELETE FROM company_addresses WHERE workspace_id = $1 AND company_id = $2', [workspaceId, id])
  await client.query('DELETE FROM record_taxonomies WHERE workspace_id = $1 AND record_id = $2', [workspaceId, id])

  await client.query(
    `INSERT INTO companies (id, workspace_id, name, normalized_name, description, customer_profile, business_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name,
       description = EXCLUDED.description, customer_profile = EXCLUDED.customer_profile, business_role = EXCLUDED.business_role`,
    [id, workspaceId, company.name, company.normalizedName || importer.normalizeName(company.name), company.description, company.customerProfile, company.businessRole],
  )
  for (const domain of company.domains) {
    if (!domain.raw.trim() || !domain.normalized.trim() || /[/@: ]/.test(domain.normalized) || domain.normalized.startsWith('www.')) continue
    await client.query(
      `INSERT INTO company_domains (workspace_id, company_id, raw_domain, normalized_domain, is_primary, provenance)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING`,
      [workspaceId, id, domain.raw, domain.normalized.toLowerCase(), domain.primary, json({ source: 'legacy-csv', label: domain.label })],
    )
  }
  const seenLinks = new Set<string>()
  for (const link of company.links) {
    if (!link.url.trim() || !link.canonicalUrl.trim() || seenLinks.has(link.canonicalUrl)) continue
    seenLinks.add(link.canonicalUrl)
    await client.query(
      `INSERT INTO company_links (workspace_id, company_id, kind, raw_url, canonical_url, is_primary, provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT DO NOTHING`,
      [workspaceId, id, link.kind, link.url, link.canonicalUrl, link.primary, json({ source: 'legacy-csv', label: link.label })],
    )
  }
  const address = locationValues(company.location)
  if (address.slice(0, 6).some(Boolean) || address[7] !== null || address[8] !== null) {
    await client.query(
      `INSERT INTO company_addresses (workspace_id, company_id, street, city, region, postal_code, country_code, country_name, provider_place_id, latitude, longitude, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) ON CONFLICT DO NOTHING`,
      [workspaceId, id, address[0], address[1], address[2], address[3], address[4], address[5], address[6], address[7], address[8]],
    )
  }
  await insertTaxonomies(client, workspaceId, id, 'COMPANY_CATEGORY', company.categories, importer)
  await insertTaxonomies(client, workspaceId, id, 'INDUSTRY', company.industries, importer)
}

async function insertTaxonomies(
  client: PoolClient,
  workspaceId: string,
  recordId: string,
  taxonomy: 'PERSON_CATEGORY' | 'COMPANY_CATEGORY' | 'INDUSTRY',
  labels: string[],
  importer: ImporterApi,
): Promise<void> {
  const seen = new Set<string>()
  for (const label of labels) {
    const normalizedLabel = importer.normalizeName(label)
    if (!label.trim() || !normalizedLabel || seen.has(normalizedLabel)) continue
    seen.add(normalizedLabel)
    const term = await client.query<{ id: string }>(
      `INSERT INTO taxonomy_terms (workspace_id, taxonomy, label, normalized_label)
       VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, taxonomy, normalized_label) DO NOTHING RETURNING id`,
      [workspaceId, taxonomy, label.trim(), normalizedLabel],
    )
    const termId = term.rows[0]?.id ?? (await client.query<{ id: string }>(
      `SELECT id FROM taxonomy_terms WHERE workspace_id = $1 AND taxonomy = $2 AND normalized_label = $3`,
      [workspaceId, taxonomy, normalizedLabel],
    )).rows[0]?.id
    if (!termId) throw new Error('Could not resolve a taxonomy term.')
    await client.query(
      `INSERT INTO record_taxonomies (workspace_id, record_id, taxonomy_term_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [workspaceId, recordId, termId],
    )
  }
}

async function writeNote(client: PoolClient, workspaceId: string, note: NoteRecord, id: string): Promise<void> {
  await client.query(
    `INSERT INTO notes (id, workspace_id, note_type, title, body_markdown, legacy_content)
     VALUES ($1, $2, 'GENERAL', $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body_markdown = EXCLUDED.body_markdown,
       legacy_content = EXCLUDED.legacy_content`,
    [id, workspaceId, note.title, note.bodyMarkdown, json(note.legacyRichText)],
  )
}

async function writeEntity(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  row: PreparedRow,
  importer: ImporterApi,
): Promise<void> {
  await writeRecordBase(client, workspaceId, actorId, row)
  if (row.entityType === 'person') await replacePersonDetails(client, workspaceId, row.record as PersonRecord, row.recordId!, importer)
  else if (row.entityType === 'company') await replaceCompanyDetails(client, workspaceId, row.record as CompanyRecord, row.recordId!, importer)
  else await writeNote(client, workspaceId, row.record as NoteRecord, row.recordId!)
}

async function writeExternalReference(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  batchId: string,
  row: PreparedRow,
): Promise<void> {
  if (!row.sourceKey || !row.recordId || !row.importRowId) throw new Error('An imported row is missing durable source identity.')
  const existing = await client.query<{ record_id: string }>(
    `SELECT record_id FROM external_references
     WHERE workspace_id = $1 AND source_system = $2 AND object_type = $3 AND external_id = $4 FOR UPDATE`,
    [workspaceId, SOURCE_SYSTEM, row.entityType, row.sourceKey],
  )
  if (existing.rowCount) {
    if (existing.rows[0]!.record_id !== row.recordId) throw new Error('A legacy source ID is already mapped to a different record.')
    await client.query(
      `UPDATE external_references SET last_seen_at = now(), updated_at = now(), updated_by_actor_id = $1, provenance = $2::jsonb
       WHERE workspace_id = $3 AND source_system = $4 AND object_type = $5 AND external_id = $6`,
      [actorId, json(importProvenance(row)), workspaceId, SOURCE_SYSTEM, row.entityType, row.sourceKey],
    )
    return
  }
  await client.query(
    `INSERT INTO external_references (
       workspace_id, source_system, object_type, external_id, record_id, import_batch_id, import_row_id,
       provenance, created_by_actor_id, updated_by_actor_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9)`,
    [workspaceId, SOURCE_SYSTEM, row.entityType, row.sourceKey, row.recordId, batchId, row.importRowId, json(importProvenance(row)), actorId],
  )
}

async function writeRelationships(
  client: PoolClient,
  workspaceId: string,
  rows: PreparedRow[],
  plan: ImportPlan,
): Promise<number> {
  const people = new Map(rows.filter((row) => row.entityType === 'person' && row.status === 'CREATED' || row.entityType === 'person' && row.status === 'UPDATED')
    .filter((row) => row.recordId && row.sourceKey).map((row) => [row.sourceKey!, row]))
  const companies = new Map(rows.filter((row) => row.entityType === 'company' && row.status === 'CREATED' || row.entityType === 'company' && row.status === 'UPDATED')
    .filter((row) => row.recordId && row.sourceKey).map((row) => [row.sourceKey!, row]))
  let written = 0
  const primaries = new Set<string>()
  for (const relationship of plan.relationships) {
    const personRow = people.get(relationship.personLegacyId)
    const companyRow = companies.get(relationship.companyLegacyId)
    if (!personRow?.recordId || !companyRow?.recordId) continue
    const current = await client.query<{ company_id: string }>(
      `SELECT company_id FROM person_companies
       WHERE workspace_id = $1 AND person_id = $2 AND is_primary AND ended_on IS NULL FOR UPDATE`,
      [workspaceId, personRow.recordId],
    )
    const requestedPrimary = relationship.primary && !primaries.has(personRow.recordId)
    const isPrimary = requestedPrimary && (!current.rowCount || current.rows[0]!.company_id === companyRow.recordId)
    if (isPrimary) primaries.add(personRow.recordId)
    await client.query(
      `INSERT INTO person_companies (workspace_id, person_id, company_id, job_title, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, person_id, company_id) DO UPDATE SET job_title = EXCLUDED.job_title,
         is_primary = CASE WHEN EXCLUDED.is_primary THEN true ELSE person_companies.is_primary END`,
      [workspaceId, personRow.recordId, companyRow.recordId, (personRow.record as PersonRecord).jobTitle, isPrimary],
    )
    written += 1
  }
  return written
}

function countStatuses(rows: PreparedRow[]): { total: number; created: number; updated: number; skipped: number; errors: number; reviewRequired: number } {
  return {
    total: rows.length,
    created: rows.filter((row) => row.status === 'CREATED').length,
    updated: rows.filter((row) => row.status === 'UPDATED').length,
    skipped: rows.filter((row) => row.status === 'SKIPPED').length,
    errors: rows.filter((row) => row.status === 'ERROR').length,
    reviewRequired: rows.filter((row) => row.status === 'REVIEW_REQUIRED').length,
  }
}

async function finalizeRows(client: PoolClient, workspaceId: string, rows: PreparedRow[]): Promise<void> {
  for (const row of rows) {
    if (!row.importRowId) throw new Error('A staged import row has no ID.')
    await client.query(
      `UPDATE import_rows SET status = $1, review_state = $2, normalized_data = $3::jsonb, issues = $4::jsonb,
         target_record_id = $5, processed_at = now(), updated_at = now()
       WHERE id = $6 AND workspace_id = $7`,
      [row.status, row.reviewState, json(row.projection), json(row.issues), row.targetRecordId, row.importRowId, workspaceId],
    )
  }
}

async function printDryRun(client: PoolClient, workspaceId: string, files: InputFiles, importer: ImporterApi): Promise<void> {
  const existing = await loadExistingData(client, workspaceId)
  const plan = createPlan(files, existing, importer)
  console.log(JSON.stringify({
    mode: 'dry-run',
    workspaceId,
    sourceSha256: sourceHash(files).toString('hex'),
    rows: { people: files.person.rows.length, companies: files.company.rows.length, notes: files.note.rows.length },
    plan: {
      people: plan.summary.people,
      companies: plan.summary.companies,
      notes: plan.summary.notes,
      relationships: plan.summary.relationships,
      issueCount: plan.summary.issueCount,
      duplicateCandidateCount: plan.summary.duplicateCandidateCount,
    },
    writes: false,
  }, null, 2))
}

async function commitImport(client: PoolClient, workspaceId: string, files: InputFiles, importer: ImporterApi): Promise<void> {
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['legacy-csv-import', workspaceId])
    const existing = await loadExistingData(client, workspaceId)
    const plan = createPlan(files, existing, importer)
    const rows = prepareRows(files, plan, importer)
    await resolveRecordTargets(client, workspaceId, rows, existing.references)

    const actorId = await createImportActor(client, workspaceId)
    const digest = sourceHash(files)
    const batch = await createOrLoadBatch(client, workspaceId, actorId, digest, files, rows.length)
    if (batch.status === 'COMPLETED') {
      const prior = await client.query<{
        total_rows: number
        created_count: number
        updated_count: number
        skipped_count: number
        error_count: number
        review_count: number
      }>(
        `SELECT total_rows, created_count, updated_count, skipped_count, error_count, review_count
         FROM import_batches WHERE id = $1 AND workspace_id = $2`,
        [batch.id, workspaceId],
      )
      await client.query('COMMIT')
      console.log(JSON.stringify({ mode: 'commit', workspaceId, batchId: batch.id, reused: true, counts: prior.rows[0] }, null, 2))
      return
    }
    if (batch.status === 'FAILED' || batch.status === 'CANCELLED') {
      throw new Error('This source batch is terminal and cannot be recommitted.')
    }
    if (batch.reused) {
      await client.query(
        `UPDATE import_batches SET status = 'IMPORTING', started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE id = $1 AND workspace_id = $2`,
        [batch.id, workspaceId],
      )
    } else {
      await client.query(
        `UPDATE import_batches SET started_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2`,
        [batch.id, workspaceId],
      )
    }

    await persistRows(client, workspaceId, batch.id, rows)
    for (const row of rows) {
      if (!row.shouldImport || !row.recordId || !row.record) continue
      await writeEntity(client, workspaceId, actorId, row, importer)
      if (row.reviewState !== 'PENDING') row.status = row.record.importStatus === 'UPDATE' ? 'UPDATED' : 'CREATED'
      row.targetRecordId = row.recordId
      await writeExternalReference(client, workspaceId, actorId, batch.id, row)
      const activity = await client.query<{ id: string }>(
        `INSERT INTO activity_events (workspace_id, actor_id, action, primary_record_id, source, changed_fields)
         VALUES ($1, $2, $3, $4, 'IMPORT', $5::jsonb) RETURNING id`,
        [workspaceId, actorId, row.record.importStatus === 'UPDATE' ? 'RECORD_IMPORTED_UPDATE' : 'RECORD_IMPORTED', row.recordId,
          json({ fields: ['legacyImport'], sourceFile: row.fileName })],
      )
      await client.query(
        `INSERT INTO activity_records (workspace_id, activity_event_id, record_id) VALUES ($1, $2, $3)`,
        [workspaceId, activity.rows[0]!.id, row.recordId],
      )
    }
    const relationships = await writeRelationships(client, workspaceId, rows, plan)
    await finalizeRows(client, workspaceId, rows)

    const counts = countStatuses(rows)
    await client.query(
      `UPDATE import_batches SET status = 'COMPLETED', total_rows = $1, created_count = $2,
         updated_count = $3, skipped_count = $4, error_count = $5, review_count = $6,
         finished_at = now(), updated_at = now()
       WHERE id = $7 AND workspace_id = $8`,
      [counts.total, counts.created, counts.updated, counts.skipped, counts.errors, counts.reviewRequired, batch.id, workspaceId],
    )
    await client.query('COMMIT')
    console.log(JSON.stringify({ mode: 'commit', workspaceId, batchId: batch.id, reused: batch.reused, counts, relationships }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function main(): Promise<void> {
  const { commit, help } = parseArguments(process.argv.slice(2))
  if (help) {
    usage()
    return
  }
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) fail('DATABASE_URL must be set.')
  const sourceDirectory = process.env.CSV_DIR?.trim()
    ? resolve(process.env.CSV_DIR.trim())
    : resolve(dirname(fileURLToPath(import.meta.url)), '../../../data')

  let files: InputFiles
  const importer = await loadImporter()
  try {
    files = await readFiles(sourceDirectory, importer)
  } catch {
    fail('Could not read or parse person.csv, company.csv, and note.csv from CSV_DIR.')
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'resoloon-legacy-csv-import' })
  try {
    const client = await pool.connect()
    try {
      const workspaceId = await resolveWorkspaceId(client, process.env.WORKSPACE_ID?.trim() || undefined)
      if (commit) await commitImport(client, workspaceId, files, importer)
      else await printDryRun(client, workspaceId, files, importer)
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

try {
  await main()
} catch {
  // Database and row-level errors can contain source data; keep CLI output aggregate-only.
  console.error('Legacy CSV import failed. No source contents were logged.')
  process.exitCode = 1
}
