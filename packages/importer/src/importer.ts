import { parseCsv } from './csv.ts'
import {
  canonicalUrl,
  cleanText,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeUnicode,
  parseFiniteNumber,
  parseJsonArrayCell,
  stringSimilarity,
} from './normalize.ts'
import type {
  CompanyRecord,
  CsvBundle,
  CsvRecord,
  DuplicateCandidate,
  DuplicateProfile,
  EntitySummary,
  EntityType,
  ImportIssue,
  ImportOptions,
  ImportPlan,
  ImportStatus,
  LegacyProvenance,
  PersonCompanyRelationship,
  PersonRecord,
  NoteRecord,
  RecordLink,
} from './types.ts'

type RowState = { review: boolean; skip: boolean }
type SourceContext = {
  entityType: EntityType
  sourceFile: string
  rowStates: Map<number, RowState>
  issues: ImportIssue[]
}

const PERSON_HEADERS = ['Id', 'Name / First Name', 'Name / Last Name']
const COMPANY_HEADERS = ['Id', 'Name']
const NOTE_HEADERS = ['Id', 'Title', 'Body / Markdown']

function value(row: CsvRecord, key: string): string {
  return row.values[key] ?? ''
}

function issue(
  context: SourceContext,
  row: CsvRecord | null,
  severity: ImportIssue['severity'],
  code: string,
  message: string,
  field?: string,
): void {
  const rowNumber = row?.rowNumber ?? 1
  const legacyId = row ? cleanText(value(row, 'Id')) : null
  context.issues.push({ entityType: context.entityType, legacyId, rowNumber, severity, code, message, field })
  if (row) {
    const state = context.rowStates.get(row.rowNumber) ?? { review: false, skip: false }
    state.review = true
    if (severity === 'error') state.skip = true
    context.rowStates.set(row.rowNumber, state)
  }
}

function rowState(context: SourceContext, row: CsvRecord): RowState {
  return context.rowStates.get(row.rowNumber) ?? { review: false, skip: false }
}

function importStatus(context: SourceContext, row: CsvRecord, forceReview = false): ImportStatus {
  const state = rowState(context, row)
  if (state.skip) return 'SKIPPED'
  return state.review || forceReview ? 'REVIEW_REQUIRED' : 'READY'
}

function addJsonIssue<T>(
  context: SourceContext,
  row: CsvRecord,
  field: string,
  raw: string,
): T[] {
  const parsed = parseJsonArrayCell<T>(raw)
  if (parsed.error) {
    issue(context, row, 'warning', 'INVALID_JSON_ARRAY', `${field}: ${parsed.error} The raw cell is retained in provenance.`, field)
  }
  return parsed.value
}

function stringArray(
  context: SourceContext,
  row: CsvRecord,
  field: string,
): string[] {
  return addJsonIssue<unknown>(context, row, field, value(row, field))
    .flatMap((entry) => {
      if (typeof entry === 'string') return cleanText(entry) ?? []
      issue(context, row, 'warning', 'NON_STRING_ARRAY_ITEM', `${field} contains an item that is not text.`, field)
      return []
    })
}

function recordArray(
  context: SourceContext,
  row: CsvRecord,
  field: string,
): unknown[] {
  return addJsonIssue<unknown>(context, row, field, value(row, field))
}

function extractActorContext(context: SourceContext, row: CsvRecord): unknown | null {
  const raw = value(row, 'Created by / Context')
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    issue(context, row, 'warning', 'INVALID_ACTOR_CONTEXT', 'Legacy actor context is not valid JSON; the original text is retained.', 'Created by / Context')
    return null
  }
}

function provenance(context: SourceContext, row: CsvRecord, sourceId: string): LegacyProvenance {
  const actorContextRaw = cleanText(value(row, 'Created by / Context'))
  return {
    sourceFile: context.sourceFile,
    sourceId,
    sourceType: 'LEGACY_CSV',
    source: cleanText(value(row, 'Created by / Source')),
    actor: {
      source: cleanText(value(row, 'Created by / Source')),
      name: cleanText(value(row, 'Created by / Name')),
      workspaceMemberId: cleanText(value(row, 'Created by / Workspace Member')),
      contextRaw: actorContextRaw,
      context: extractActorContext(context, row),
    },
    createdAt: cleanText(value(row, 'Creation date')),
    updatedAt: cleanText(value(row, 'Last update')),
    rawRow: { ...row.values },
    rawCells: [...row.rawCells],
  }
}

function parseSource(
  entityType: EntityType,
  csv: string,
  sourceFile: string,
  requiredHeaders: string[],
  issues: ImportIssue[],
): { context: SourceContext; rows: CsvRecord[] } {
  const parsed = parseCsv(csv)
  const context: SourceContext = { entityType, sourceFile, rowStates: new Map(), issues }
  for (const csvIssue of parsed.issues) {
    const row = parsed.records.find((candidate) => candidate.rowNumber === csvIssue.rowNumber) ?? null
    issue(context, row, 'error', csvIssue.code, csvIssue.message)
    if (!row) {
      for (const parsedRow of parsed.records) {
        const state = context.rowStates.get(parsedRow.rowNumber) ?? { review: false, skip: false }
        state.skip = true
        context.rowStates.set(parsedRow.rowNumber, state)
      }
    }
  }

  const missing = requiredHeaders.filter((header) => !parsed.headers.includes(header))
  if (missing.length > 0) {
    issue(context, null, 'error', 'MISSING_REQUIRED_HEADERS', `Missing required CSV columns: ${missing.join(', ')}.`)
    for (const row of parsed.records) {
      const state = context.rowStates.get(row.rowNumber) ?? { review: false, skip: false }
      state.skip = true
      context.rowStates.set(row.rowNumber, state)
    }
  }
  return { context, rows: parsed.records }
}

function sourceId(context: SourceContext, row: CsvRecord): string | null {
  const id = cleanText(value(row, 'Id'))
  if (!id) issue(context, row, 'error', 'MISSING_LEGACY_ID', 'Row has no legacy ID and cannot be imported.', 'Id')
  return id
}

function uniqueLegacyIds<T extends { legacyId: string; importStatus: ImportStatus }>(
  records: T[],
  context: SourceContext,
  rowsById: Map<string, CsvRecord>,
): T[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    if (!seen.has(record.legacyId)) {
      seen.add(record.legacyId)
      return true
    }
    const row = rowsById.get(record.legacyId) ?? null
    issue(context, row, 'error', 'DUPLICATE_LEGACY_ID', `Legacy ID "${record.legacyId}" occurs more than once; later row skipped.`, 'Id')
    record.importStatus = 'SKIPPED'
    return false
  })
}

function combinePersonName(firstCell: string, lastCell: string): string {
  const first = cleanText(firstCell) ?? ''
  const last = cleanText(lastCell) ?? ''
  if (!first) return last
  if (!last) return first

  const normalizedFirst = normalizeName(first)
  const normalizedLast = normalizeName(last)
  if (normalizedFirst === normalizedLast || normalizedFirst.endsWith(` ${normalizedLast}`)) return first
  return `${first} ${last}`.replace(/\s+/g, ' ').trim()
}

function parseReferenceIds(
  context: SourceContext,
  row: CsvRecord,
  field: string,
): string[] {
  const raw = value(row, field).trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    return addJsonIssue<unknown>(context, row, field, raw).flatMap((entry) => {
      if (typeof entry === 'string' && cleanText(entry)) return [cleanText(entry)!]
      issue(context, row, 'warning', 'INVALID_RELATION_ID', `${field} contains a relationship ID that is not text.`, field)
      return []
    })
  }
  return raw.split(',').map((entry) => cleanText(entry)).filter((entry): entry is string => entry !== null)
}

function link(
  labelValue: string,
  urlValue: string,
  kind: RecordLink['kind'],
  primary: boolean,
): RecordLink | null {
  const label = cleanText(labelValue)
  const url = cleanText(urlValue)
  if (!url) return null
  return { label, url, canonicalUrl: canonicalUrl(url), kind, primary }
}

function linksFromArray(
  context: SourceContext,
  row: CsvRecord,
  field: string,
  kind: RecordLink['kind'],
): RecordLink[] {
  return recordArray(context, row, field).flatMap((entry) => {
    if (typeof entry === 'string') {
      const result = link('', entry, kind, false)
      return result ? [result] : []
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issue(context, row, 'warning', 'INVALID_LINK_ITEM', `${field} contains an unsupported link item.`, field)
      return []
    }
    const object = entry as Record<string, unknown>
    const label = typeof object.label === 'string' ? object.label : typeof object.name === 'string' ? object.name : ''
    const url = typeof object.url === 'string' ? object.url : typeof object.value === 'string' ? object.value : ''
    const result = link(label, url, kind, false)
    if (!result) issue(context, row, 'warning', 'INVALID_LINK_ITEM', `${field} has a link item without a URL.`, field)
    return result ? [result] : []
  })
}

function location(
  context: SourceContext,
  row: CsvRecord,
  prefix: 'Location' | 'Address',
): PersonRecord['location'] {
  const field = (name: string) => value(row, `${prefix} / ${name}`)
  const numeric = (name: string): number | null => {
    const raw = cleanText(field(name))
    if (!raw) return null
    const parsed = parseFiniteNumber(raw)
    if (parsed === null) issue(context, row, 'warning', 'INVALID_COORDINATE', `${name} is not a finite number.`, `${prefix} / ${name}`)
    return parsed
  }
  return {
    street: cleanText(field('Address 1')),
    street2: cleanText(field('Address 2')),
    city: cleanText(field('City')),
    region: cleanText(field('State')),
    country: cleanText(field('Country')),
    postalCode: cleanText(field('Post Code')),
    latitude: numeric('Latitude'),
    longitude: numeric('Longitude'),
  }
}

function personEmailList(context: SourceContext, row: CsvRecord): PersonRecord['emails'] {
  const emails: PersonRecord['emails'] = []
  const primaryRaw = cleanText(value(row, 'Emails / Primary Email'))
  if (primaryRaw) emails.push({ raw: primaryRaw, normalized: normalizeEmail(primaryRaw), primary: true })
  for (const email of stringArray(context, row, 'Emails / Additional Emails')) {
    emails.push({ raw: email, normalized: normalizeEmail(email), primary: false })
  }
  return deduplicate(emails, (email) => email.normalized)
}

function personPhoneList(context: SourceContext, row: CsvRecord): PersonRecord['phones'] {
  const countryCode = cleanText(value(row, 'Phones / Primary Phone Country Code'))
  const callingCode = cleanText(value(row, 'Phones / Primary Phone Calling Code'))
  const phones: PersonRecord['phones'] = []
  const primary = cleanText(value(row, 'Phones / Primary Phone Number'))
  if (primary) phones.push({ raw: primary, normalized: normalizePhone(primary, callingCode), countryCode, callingCode, primary: true })

  for (const entry of recordArray(context, row, 'Phones / Additional Phones')) {
    if (typeof entry === 'string') {
      const raw = cleanText(entry)
      if (raw) phones.push({ raw, normalized: normalizePhone(raw), countryCode: null, callingCode: null, primary: false })
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issue(context, row, 'warning', 'INVALID_PHONE_ITEM', 'Phones / Additional Phones contains an unsupported item.', 'Phones / Additional Phones')
      continue
    }
    const object = entry as Record<string, unknown>
    const raw = typeof object.number === 'string' ? cleanText(object.number) : typeof object.value === 'string' ? cleanText(object.value) : null
    if (!raw) {
      issue(context, row, 'warning', 'INVALID_PHONE_ITEM', 'An additional phone item has no phone number.', 'Phones / Additional Phones')
      continue
    }
    const itemCallingCode = typeof object.callingCode === 'string' ? cleanText(object.callingCode) : null
    const itemCountryCode = typeof object.countryCode === 'string' ? cleanText(object.countryCode) : null
    phones.push({
      raw,
      normalized: normalizePhone(raw, itemCallingCode),
      countryCode: itemCountryCode,
      callingCode: itemCallingCode,
      primary: false,
    })
  }
  return deduplicate(phones, (phone) => phone.normalized)
}

function deduplicate<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item)
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function buildPeople(
  csv: string,
  sourceFile: string,
  issues: ImportIssue[],
): { records: PersonRecord[]; context: SourceContext; rowsById: Map<string, CsvRecord>; totalRows: number } {
  const { context, rows } = parseSource('person', csv, sourceFile, PERSON_HEADERS, issues)
  const rowsById = new Map<string, CsvRecord>()
  const records: PersonRecord[] = []
  for (const row of rows) {
    const id = sourceId(context, row)
    if (id) rowsById.set(id, row)
    const fullName = combinePersonName(value(row, 'Name / First Name'), value(row, 'Name / Last Name'))
    if (!fullName) issue(context, row, 'error', 'MISSING_PERSON_NAME', 'Person has no first or last name.', 'Name / First Name')
    const category = stringArray(context, row, 'Category')
    const links: RecordLink[] = []
    const primaryLink = link(
      value(row, 'Linkedin / Link Label'),
      value(row, 'Linkedin / Link URL'),
      'linkedin',
      true,
    )
    if (primaryLink) links.push(primaryLink)
    links.push(...linksFromArray(context, row, 'Linkedin / Secondary Links', 'other'))

    const idReferences = parseReferenceIds(context, row, 'Company Id')
    const record: PersonRecord = {
      legacyId: id ?? `invalid-row-${row.rowNumber}`,
      fullName,
      normalizedName: normalizeName(fullName),
      categories: category,
      emails: personEmailList(context, row),
      phones: personPhoneList(context, row),
      links,
      importance: cleanText(value(row, 'Importance')),
      jobTitle: cleanText(value(row, 'Job Title')),
      description: cleanText(value(row, 'Note')),
      companyIds: idReferences,
      location: location(context, row, 'Location'),
      nextFollowUp: cleanText(value(row, 'Next followup')),
      provenance: provenance(context, row, id ?? `invalid-row-${row.rowNumber}`),
      importStatus: 'READY',
    }
    record.importStatus = importStatus(context, row)
    if (id) records.push(record)
  }
  return { records: uniqueLegacyIds(records, context, rowsById), context, rowsById, totalRows: rows.length }
}

function buildCompanies(
  csv: string,
  sourceFile: string,
  issues: ImportIssue[],
): { records: CompanyRecord[]; context: SourceContext; rowsById: Map<string, CsvRecord>; totalRows: number } {
  const { context, rows } = parseSource('company', csv, sourceFile, COMPANY_HEADERS, issues)
  const rowsById = new Map<string, CsvRecord>()
  const records: CompanyRecord[] = []
  for (const row of rows) {
    const id = sourceId(context, row)
    if (id) rowsById.set(id, row)
    const name = cleanText(value(row, 'Name')) ?? ''
    if (!name) issue(context, row, 'error', 'MISSING_COMPANY_NAME', 'Company has no name.', 'Name')

    const domains: CompanyRecord['domains'] = []
    const rawDomain = cleanText(value(row, 'Domain Name / Link URL'))
    const domainLabel = cleanText(value(row, 'Domain Name / Link Label'))
    const domainSource = rawDomain ?? domainLabel
    if (domainSource) {
      domains.push({
        raw: domainSource,
        normalized: normalizeDomain(domainSource),
        label: domainLabel,
        primary: true,
      })
    }
    for (const entry of recordArray(context, row, 'Domain Name / Secondary Links')) {
      const object = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : null
      const raw = typeof entry === 'string'
        ? cleanText(entry)
        : object && typeof object.url === 'string' ? cleanText(object.url) : null
      if (!raw) {
        issue(context, row, 'warning', 'INVALID_DOMAIN_ITEM', 'A secondary domain item has no text URL.', 'Domain Name / Secondary Links')
        continue
      }
      domains.push({
        raw,
        normalized: normalizeDomain(raw),
        label: object && typeof object.label === 'string' ? cleanText(object.label) : null,
        primary: false,
      })
    }

    const links: RecordLink[] = []
    const linkedIn = link(value(row, 'Linkedin / Link Label'), value(row, 'Linkedin / Link URL'), 'linkedin', true)
    if (linkedIn) links.push(linkedIn)
    links.push(...linksFromArray(context, row, 'Linkedin / Secondary Links', 'other'))
    const peopleRefs = parseReferenceIds(context, row, 'Other people Id')

    const record: CompanyRecord = {
      legacyId: id ?? `invalid-row-${row.rowNumber}`,
      name,
      normalizedName: normalizeName(name),
      domains: deduplicate(domains, (domain) => domain.normalized),
      links,
      categories: stringArray(context, row, 'Category'),
      industries: deduplicate(
        [...stringArray(context, row, 'Industry'), ...[cleanText(value(row, 'Industry-old'))].filter((entry): entry is string => entry !== null)],
        (industry) => industry,
      ),
      customerProfile: cleanText(value(row, 'Customer Profile')),
      businessRole: cleanText(value(row, 'Role')),
      description: cleanText(value(row, 'Company Description')),
      accountOwnerLegacyId: cleanText(value(row, 'Account Owner Id')),
      personIds: peopleRefs,
      location: location(context, row, 'Address'),
      provenance: provenance(context, row, id ?? `invalid-row-${row.rowNumber}`),
      importStatus: 'READY',
    }
    record.importStatus = importStatus(context, row)
    if (id) records.push(record)
  }
  return { records: uniqueLegacyIds(records, context, rowsById), context, rowsById, totalRows: rows.length }
}

function buildNotes(csv: string, sourceFile: string, issues: ImportIssue[]): { records: NoteRecord[]; context: SourceContext; totalRows: number } {
  const { context, rows } = parseSource('note', csv, sourceFile, NOTE_HEADERS, issues)
  const records: NoteRecord[] = []
  const rowsById = new Map<string, CsvRecord>()
  for (const row of rows) {
    const id = sourceId(context, row)
    if (id) rowsById.set(id, row)
    const title = cleanText(value(row, 'Title')) ?? ''
    if (!title) issue(context, row, 'error', 'MISSING_NOTE_TITLE', 'Note has no title.', 'Title')
    const bodyMarkdown = normalizeUnicode(value(row, 'Body / Markdown')).replace(/\r\n?/g, '\n')
    if (!bodyMarkdown.trim()) issue(context, row, 'warning', 'EMPTY_NOTE_MARKDOWN', 'Note has no Markdown body; legacy rich text remains in provenance.', 'Body / Markdown')

    if (id) {
      records.push({
        legacyId: id,
        title,
        bodyMarkdown,
        legacyRichText: {
          blockNote: cleanText(value(row, 'Body / BlockNote')),
          tipTap: cleanText(value(row, 'Body / TipTap')),
        },
        relationshipStatus: 'UNASSIGNED_REVIEW',
        personIds: [],
        companyIds: [],
        opportunityIds: [],
        provenance: provenance(context, row, id),
        // The notes export has no trustworthy relation columns; require review instead of guessing.
        importStatus: importStatus(context, row, true),
      })
    }
  }
  return { records: uniqueLegacyIds(records, context, rowsById), context, totalRows: rows.length }
}

function profilesFromPeople(records: PersonRecord[]): DuplicateProfile[] {
  return records.map((person) => ({
    legacyId: person.legacyId,
    name: person.fullName,
    emails: person.emails.map((email) => email.normalized),
    phones: person.phones.map((phone) => phone.normalized),
    linkedinUrls: person.links.filter((entry) => entry.kind === 'linkedin').map((entry) => entry.canonicalUrl),
  }))
}

function profilesFromCompanies(records: CompanyRecord[]): DuplicateProfile[] {
  return records.map((company) => ({
    legacyId: company.legacyId,
    name: company.name,
    domains: company.domains.map((domain) => domain.normalized),
    linkedinUrls: company.links.filter((entry) => entry.kind === 'linkedin').map((entry) => entry.canonicalUrl),
  }))
}

function normalizedSet(values: string[] | undefined, transform: (value: string) => string): Set<string> {
  return new Set((values ?? []).map(transform).filter(Boolean))
}

function shared(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((entry) => right.has(entry))
}

function candidatePairs(
  entityType: 'person' | 'company',
  incoming: DuplicateProfile[],
  existing: DuplicateProfile[],
): DuplicateCandidate[] {
  const all = [
    ...incoming.map((profile) => ({ profile, source: 'incoming' as const })),
    ...existing.map((profile) => ({ profile, source: 'existing' as const })),
  ]
  const result: DuplicateCandidate[] = []
  const seen = new Set<string>()

  for (let leftIndex = 0; leftIndex < all.length; leftIndex += 1) {
    const left = all[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < all.length; rightIndex += 1) {
      const right = all[rightIndex]!
      if (left.source === 'existing' || left.profile.legacyId === right.profile.legacyId) continue

      const reasons: string[] = []
      let strong = false
      if (entityType === 'person') {
        const emails = shared(normalizedSet(left.profile.emails, normalizeEmail), normalizedSet(right.profile.emails, normalizeEmail))
        const phones = shared(normalizedSet(left.profile.phones, normalizePhone), normalizedSet(right.profile.phones, normalizePhone))
        const linkedin = shared(normalizedSet(left.profile.linkedinUrls, canonicalUrl), normalizedSet(right.profile.linkedinUrls, canonicalUrl))
        if (emails.length) { reasons.push(`exact email: ${emails.join(', ')}`); strong = true }
        if (phones.length) { reasons.push(`exact phone: ${phones.join(', ')}`); strong = true }
        if (linkedin.length) { reasons.push(`exact LinkedIn URL: ${linkedin.join(', ')}`); strong = true }
      } else {
        const domains = shared(normalizedSet(left.profile.domains, normalizeDomain), normalizedSet(right.profile.domains, normalizeDomain))
        const linkedin = shared(normalizedSet(left.profile.linkedinUrls, canonicalUrl), normalizedSet(right.profile.linkedinUrls, canonicalUrl))
        if (domains.length) { reasons.push(`exact domain: ${domains.join(', ')}`); strong = true }
        if (linkedin.length) { reasons.push(`exact LinkedIn URL: ${linkedin.join(', ')}`); strong = true }
      }

      const leftName = normalizeName(left.profile.name)
      const rightName = normalizeName(right.profile.name)
      const similarity = stringSimilarity(leftName, rightName)
      if (!strong && leftName && rightName && similarity >= 0.88) {
        reasons.push(similarity === 1 ? 'same normalized name' : `similar normalized name (${similarity.toFixed(2)})`)
      }
      if (!strong && reasons.length === 0) continue

      const first = { source: left.source, legacyId: left.profile.legacyId }
      const second = { source: right.source, legacyId: right.profile.legacyId }
      const key = `${entityType}:${first.source}:${first.legacyId}:${second.source}:${second.legacyId}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        entityType,
        first,
        second,
        match: strong ? 'EXACT' : 'FUZZY',
        score: strong ? 1 : similarity,
        reasons,
      })
    }
  }
  return result
}

function markDuplicateReview(
  candidates: DuplicateCandidate[],
  people: PersonRecord[],
  companies: CompanyRecord[],
  issues: ImportIssue[],
  contexts: { person: SourceContext; company: SourceContext },
  rowsById: { person: Map<string, CsvRecord>; company: Map<string, CsvRecord> },
): void {
  for (const candidate of candidates) {
    for (const side of [candidate.first, candidate.second]) {
      if (side.source !== 'incoming') continue
      const record = candidate.entityType === 'person'
        ? people.find((entry) => entry.legacyId === side.legacyId)
        : companies.find((entry) => entry.legacyId === side.legacyId)
      if (!record || record.importStatus === 'SKIPPED') continue
      record.importStatus = 'REVIEW_REQUIRED'
      const row = rowsById[candidate.entityType].get(side.legacyId)
      if (row) issue(contexts[candidate.entityType], row, 'warning', 'DUPLICATE_CANDIDATE', `Possible ${candidate.entityType} duplicate: ${candidate.reasons.join('; ')}.`, undefined)
    }
  }
}

function markExistingUpdates(
  people: PersonRecord[],
  companies: CompanyRecord[],
  existingPeople: DuplicateProfile[],
  existingCompanies: DuplicateProfile[],
): void {
  const personIds = new Set(existingPeople.map((record) => record.legacyId))
  const companyIds = new Set(existingCompanies.map((record) => record.legacyId))
  for (const person of people) {
    if (person.importStatus === 'READY' && personIds.has(person.legacyId)) person.importStatus = 'UPDATE'
  }
  for (const company of companies) {
    if (company.importStatus === 'READY' && companyIds.has(company.legacyId)) company.importStatus = 'UPDATE'
  }
}

function resolveRelationships(
  people: PersonRecord[],
  companies: CompanyRecord[],
  personRows: Map<string, CsvRecord>,
  companyRows: Map<string, CsvRecord>,
  personContext: SourceContext,
  companyContext: SourceContext,
): { relationships: PersonCompanyRelationship[]; unresolved: number } {
  const peopleById = new Map(people.filter((person) => person.importStatus !== 'SKIPPED').map((person) => [person.legacyId, person]))
  const companiesById = new Map(companies.filter((company) => company.importStatus !== 'SKIPPED').map((company) => [company.legacyId, company]))
  const relationshipMap = new Map<string, PersonCompanyRelationship>()
  let unresolved = 0

  const addRelationship = (
    personId: string,
    companyId: string,
    source: PersonCompanyRelationship['sources'][number],
  ) => {
    const key = `${personId}\0${companyId}`
    const previous = relationshipMap.get(key)
    if (previous) {
      if (!previous.sources.includes(source)) previous.sources.push(source)
      return
    }
    relationshipMap.set(key, {
      personLegacyId: personId,
      companyLegacyId: companyId,
      primary: source === 'person.companyId',
      sources: [source],
    })
  }

  for (const person of people) {
    if (!peopleById.has(person.legacyId)) continue
    const row = personRows.get(person.legacyId)
    for (const companyId of person.companyIds) {
      if (!companiesById.has(companyId)) {
        unresolved += 1
        if (row) issue(personContext, row, 'warning', 'UNRESOLVED_COMPANY_REFERENCE', `Company ID "${companyId}" is not present in this import.`, 'Company Id')
      } else addRelationship(person.legacyId, companyId, 'person.companyId')
    }
  }
  for (const company of companies) {
    if (!companiesById.has(company.legacyId)) continue
    const row = companyRows.get(company.legacyId)
    for (const personId of company.personIds) {
      if (!peopleById.has(personId)) {
        unresolved += 1
        if (row) issue(companyContext, row, 'warning', 'UNRESOLVED_PERSON_REFERENCE', `Person ID "${personId}" is not present in this import.`, 'Other people Id')
      } else addRelationship(personId, company.legacyId, 'company.otherPeopleId')
    }
  }

  const relationships = [...relationshipMap.values()]
  for (const person of people) {
    person.companyIds = relationships.filter((rel) => rel.personLegacyId === person.legacyId).map((rel) => rel.companyLegacyId)
    const row = personRows.get(person.legacyId)
    if (row) person.importStatus = importStatus(personContext, row, person.importStatus === 'REVIEW_REQUIRED')
  }
  for (const company of companies) {
    company.personIds = relationships.filter((rel) => rel.companyLegacyId === company.legacyId).map((rel) => rel.personLegacyId)
    const row = companyRows.get(company.legacyId)
    if (row) company.importStatus = importStatus(companyContext, row, company.importStatus === 'REVIEW_REQUIRED')
  }
  return { relationships, unresolved }
}

function entitySummary<T extends { importStatus: ImportStatus }>(records: T[], total: number): EntitySummary {
  const omitted = Math.max(0, total - records.length)
  return {
    total,
    created: records.filter((record) => record.importStatus === 'READY').length,
    updated: records.filter((record) => record.importStatus === 'UPDATE').length,
    skipped: records.filter((record) => record.importStatus === 'SKIPPED').length + omitted,
    reviewRequired: records.filter((record) => record.importStatus === 'REVIEW_REQUIRED').length,
  }
}

/**
 * Normalize the three legacy CSV exports into a reviewable, write-free import
 * plan. No CRM records are created or mutated by this function.
 */
export function createImportPlan(bundle: CsvBundle, options: ImportOptions = {}): ImportPlan {
  const issues: ImportIssue[] = []
  const names = {
    person: options.sourceFiles?.person ?? 'person.csv',
    company: options.sourceFiles?.company ?? 'company.csv',
    note: options.sourceFiles?.note ?? 'note.csv',
  }
  const peopleBuilt = buildPeople(bundle.people, names.person, issues)
  const companiesBuilt = buildCompanies(bundle.companies, names.company, issues)
  const notesBuilt = buildNotes(bundle.notes, names.note, issues)

  const relationshipsBuilt = resolveRelationships(
    peopleBuilt.records,
    companiesBuilt.records,
    peopleBuilt.rowsById,
    companiesBuilt.rowsById,
    peopleBuilt.context,
    companiesBuilt.context,
  )

  const duplicateCandidates = [
    ...candidatePairs('person', profilesFromPeople(peopleBuilt.records.filter((record) => record.importStatus !== 'SKIPPED')), options.existingPeople ?? []),
    ...candidatePairs('company', profilesFromCompanies(companiesBuilt.records.filter((record) => record.importStatus !== 'SKIPPED')), options.existingCompanies ?? []),
  ]
  markExistingUpdates(
    peopleBuilt.records,
    companiesBuilt.records,
    options.existingPeople ?? [],
    options.existingCompanies ?? [],
  )
  markDuplicateReview(
    duplicateCandidates,
    peopleBuilt.records,
    companiesBuilt.records,
    issues,
    { person: peopleBuilt.context, company: companiesBuilt.context },
    { person: peopleBuilt.rowsById, company: companiesBuilt.rowsById },
  )

  const peopleSummary = entitySummary(peopleBuilt.records, peopleBuilt.totalRows)
  const companySummary = entitySummary(companiesBuilt.records, companiesBuilt.totalRows)
  const noteSummary = entitySummary(notesBuilt.records, notesBuilt.totalRows)
  return {
    people: peopleBuilt.records,
    companies: companiesBuilt.records,
    notes: notesBuilt.records,
    relationships: relationshipsBuilt.relationships,
    issues,
    duplicateCandidates,
    summary: {
      people: peopleSummary,
      companies: companySummary,
      notes: noteSummary,
      relationships: {
        total: relationshipsBuilt.relationships.length,
        primary: relationshipsBuilt.relationships.filter((relationship) => relationship.primary).length,
        unresolved: relationshipsBuilt.unresolved,
      },
      issueCount: issues.length,
      duplicateCandidateCount: duplicateCandidates.length,
    },
  }
}

export function getImportStatus(plan: ImportPlan, entityType: EntityType, legacyId: string): ImportStatus | null {
  const records = entityType === 'person' ? plan.people : entityType === 'company' ? plan.companies : plan.notes
  return records.find((record) => record.legacyId === legacyId)?.importStatus ?? null
}

export function asDuplicateProfile(record: PersonRecord | CompanyRecord): DuplicateProfile {
  if ('fullName' in record) {
    return {
      legacyId: record.legacyId,
      name: record.fullName,
      emails: record.emails.map((email) => email.normalized),
      phones: record.phones.map((phone) => phone.normalized),
      linkedinUrls: record.links.filter((entry) => entry.kind === 'linkedin').map((entry) => entry.canonicalUrl),
    }
  }
  return {
    legacyId: record.legacyId,
    name: record.name,
    domains: record.domains.map((domain) => domain.normalized),
    linkedinUrls: record.links.filter((entry) => entry.kind === 'linkedin').map((entry) => entry.canonicalUrl),
  }
}
