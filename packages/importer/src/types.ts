export type EntityType = 'person' | 'company' | 'note'
export type ImportStatus = 'READY' | 'UPDATE' | 'REVIEW_REQUIRED' | 'SKIPPED'
export type IssueSeverity = 'warning' | 'error'

export interface CsvRecord {
  rowNumber: number
  values: Record<string, string>
  /** Decoded cells in source order, including cells beyond the declared header. */
  rawCells: string[]
}

export interface CsvIssue {
  rowNumber: number
  code: string
  message: string
}

export interface CsvParseResult {
  headers: string[]
  records: CsvRecord[]
  issues: CsvIssue[]
}

export interface ImportIssue {
  entityType: EntityType
  legacyId: string | null
  rowNumber: number
  severity: IssueSeverity
  code: string
  message: string
  field?: string
}

export interface LegacyActorProvenance {
  source: string | null
  name: string | null
  workspaceMemberId: string | null
  contextRaw: string | null
  context: unknown | null
}

export interface LegacyProvenance {
  sourceFile: string
  sourceId: string
  sourceType: 'LEGACY_CSV'
  source: string | null
  actor: LegacyActorProvenance
  createdAt: string | null
  updatedAt: string | null
  /** Original decoded cell values, retained for audit and later remapping. */
  rawRow: Record<string, string>
  rawCells: string[]
}

export interface ContactEmail {
  raw: string
  normalized: string
  primary: boolean
}

export interface ContactPhone {
  raw: string
  normalized: string
  countryCode: string | null
  callingCode: string | null
  primary: boolean
}

export interface RecordLink {
  label: string | null
  url: string
  canonicalUrl: string
  kind: 'linkedin' | 'website' | 'other'
  primary: boolean
}

export interface PersonRecord {
  legacyId: string
  fullName: string
  normalizedName: string
  categories: string[]
  emails: ContactEmail[]
  phones: ContactPhone[]
  links: RecordLink[]
  importance: string | null
  jobTitle: string | null
  description: string | null
  companyIds: string[]
  location: {
    street: string | null
    street2: string | null
    city: string | null
    region: string | null
    country: string | null
    postalCode: string | null
    latitude: number | null
    longitude: number | null
  }
  nextFollowUp: string | null
  provenance: LegacyProvenance
  importStatus: ImportStatus
}

export interface CompanyRecord {
  legacyId: string
  name: string
  normalizedName: string
  domains: Array<{ raw: string; normalized: string; label: string | null; primary: boolean }>
  links: RecordLink[]
  categories: string[]
  industries: string[]
  customerProfile: string | null
  businessRole: string | null
  description: string | null
  accountOwnerLegacyId: string | null
  personIds: string[]
  location: {
    street: string | null
    street2: string | null
    city: string | null
    region: string | null
    country: string | null
    postalCode: string | null
    latitude: number | null
    longitude: number | null
  }
  provenance: LegacyProvenance
  importStatus: ImportStatus
}

export interface NoteRecord {
  legacyId: string
  title: string
  bodyMarkdown: string
  /** Rich-text exports are retained as source provenance, never treated as canonical content. */
  legacyRichText: { blockNote: string | null; tipTap: string | null }
  relationshipStatus: 'UNASSIGNED_REVIEW'
  personIds: []
  companyIds: []
  opportunityIds: []
  provenance: LegacyProvenance
  importStatus: ImportStatus
}

export interface PersonCompanyRelationship {
  personLegacyId: string
  companyLegacyId: string
  primary: boolean
  sources: Array<'person.companyId' | 'company.otherPeopleId'>
}

export interface DuplicateProfile {
  legacyId: string
  name: string
  emails?: string[]
  phones?: string[]
  domains?: string[]
  linkedinUrls?: string[]
}

export interface DuplicateCandidate {
  entityType: 'person' | 'company'
  first: { source: 'incoming' | 'existing'; legacyId: string }
  second: { source: 'incoming' | 'existing'; legacyId: string }
  match: 'EXACT' | 'FUZZY'
  score: number
  reasons: string[]
}

export interface EntitySummary {
  total: number
  created: number
  updated: number
  skipped: number
  reviewRequired: number
}

export interface ImportSummary {
  people: EntitySummary
  companies: EntitySummary
  notes: EntitySummary
  relationships: { total: number; primary: number; unresolved: number }
  issueCount: number
  duplicateCandidateCount: number
}

export interface CsvBundle {
  people: string
  companies: string
  notes: string
}

export interface ImportOptions {
  sourceFiles?: Partial<Record<EntityType, string>>
  existingPeople?: DuplicateProfile[]
  existingCompanies?: DuplicateProfile[]
}

export interface ImportPlan {
  people: PersonRecord[]
  companies: CompanyRecord[]
  notes: NoteRecord[]
  relationships: PersonCompanyRelationship[]
  issues: ImportIssue[]
  duplicateCandidates: DuplicateCandidate[]
  summary: ImportSummary
}
