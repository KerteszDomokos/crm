import type { ColumnType, Generated } from 'kysely'

export type UUID = string
export type ActorType = 'USER' | 'SYSTEM' | 'INTEGRATION' | 'MCP_CLIENT' | 'IMPORT'
export type RecordType = 'PERSON' | 'COMPANY' | 'OPPORTUNITY' | 'NOTE'
export type UserRole = 'ADMIN' | 'USER'
export type UserState = 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
export type OpportunityStage = 'LEAD' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST'
export type NoteType = 'GENERAL' | 'MEETING'
export type TokenPurpose = 'SETUP' | 'PASSWORD_RESET'
export type TaxonomyType = 'PERSON_CATEGORY' | 'COMPANY_CATEGORY' | 'INDUSTRY'
export type ImportBatchStatus =
  | 'STAGED'
  | 'VALIDATING'
  | 'REVIEW_REQUIRED'
  | 'READY'
  | 'IMPORTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
export type ImportRowStatus =
  | 'PENDING'
  | 'VALID'
  | 'CREATED'
  | 'UPDATED'
  | 'SKIPPED'
  | 'ERROR'
  | 'REVIEW_REQUIRED'
  | 'IGNORED'
export type ImportReviewState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED'

/** PostgreSQL timestamptz is returned as a Date by node-postgres. */
export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
/** PostgreSQL date is returned as a string by node-postgres by default. */
export type DateOnly = ColumnType<string, string | Date, string | Date>
export type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>
export type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
export type NullableDateOnly = ColumnType<string | null, string | Date | null | undefined, string | Date | null>
export type NullableJsonObject = ColumnType<
  Record<string, unknown> | null,
  Record<string, unknown> | string | null | undefined,
  Record<string, unknown> | string | null
>
export type NullableNumeric = ColumnType<string | null, string | number | null | undefined, string | number | null>
export type JsonObject = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | string | undefined,
  Record<string, unknown> | string
>
export type JsonArray = ColumnType<unknown[], unknown[] | string | undefined, unknown[] | string>
export type Bytea = ColumnType<Buffer, Buffer | Uint8Array, Buffer | Uint8Array>

export interface WorkspacesTable {
  id: Generated<UUID>
  name: string
  default_timezone: Generated<string>
  default_currency: Generated<string>
  workflow_settings: JsonObject
  settings_version: Generated<number>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface UsersTable {
  id: Generated<UUID>
  workspace_id: UUID
  full_name: string
  email: string
  email_normalized: Generated<string>
  role: Generated<UserRole>
  state: Generated<UserState>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PasswordCredentialsTable {
  user_id: UUID
  workspace_id: UUID
  algorithm: Generated<'scrypt'>
  password_hash: Bytea
  salt: Bytea
  parameters: JsonObject
  force_reset: Generated<boolean>
  updated_at: Timestamp
}

export interface SessionsTable {
  id: Generated<UUID>
  workspace_id: UUID
  user_id: UUID
  token_hash: Bytea
  created_at: Timestamp
  last_used_at: Timestamp
  expires_at: Timestamp
  revoked_at: NullableTimestamp
  user_agent: Nullable<string>
}

export interface AccountTokensTable {
  id: Generated<UUID>
  workspace_id: UUID
  user_id: UUID
  purpose: TokenPurpose
  token_hash: Bytea
  created_by_actor_id: Nullable<UUID>
  created_at: Timestamp
  expires_at: Timestamp
  consumed_at: NullableTimestamp
}

export interface ActorsTable {
  id: Generated<UUID>
  workspace_id: UUID
  actor_type: ActorType
  user_id: Nullable<UUID>
  owner_user_id: Nullable<UUID>
  external_actor_key: Nullable<string>
  display_name: string
  created_at: Timestamp
}

export interface RecordsTable {
  id: Generated<UUID>
  workspace_id: UUID
  record_type: RecordType
  created_at: Timestamp
  updated_at: Timestamp
  created_by_actor_id: UUID
  updated_by_actor_id: UUID
  version: Generated<number>
  archived_at: NullableTimestamp
  merged_into_record_id: Nullable<UUID>
}

export interface PeopleTable {
  id: UUID
  workspace_id: UUID
  full_name: string
  normalized_name: string
  job_title: Nullable<string>
  description: Nullable<string>
  importance: Nullable<number>
  introduced_by_person_id: Nullable<UUID>
}

export interface PersonEmailsTable {
  id: Generated<UUID>
  workspace_id: UUID
  person_id: UUID
  raw_email: string
  normalized_email: string
  is_primary: Generated<boolean>
  match_enabled: Generated<boolean>
  provenance: JsonObject
  created_at: Timestamp
}

export interface PersonPhonesTable {
  id: Generated<UUID>
  workspace_id: UUID
  person_id: UUID
  raw_phone: string
  e164: Nullable<string>
  is_primary: Generated<boolean>
  provenance: JsonObject
  created_at: Timestamp
}

export interface PersonLinksTable {
  id: Generated<UUID>
  workspace_id: UUID
  person_id: UUID
  kind: string
  raw_url: string
  canonical_url: string
  is_primary: Generated<boolean>
  provenance: JsonObject
}

export interface PersonAddressesTable {
  id: Generated<UUID>
  workspace_id: UUID
  person_id: UUID
  label: Nullable<string>
  street: Nullable<string>
  city: Nullable<string>
  region: Nullable<string>
  postal_code: Nullable<string>
  country_code: Nullable<string>
  latitude: Nullable<number>
  longitude: Nullable<number>
  provider_place_id: Nullable<string>
  is_primary: Generated<boolean>
}

export interface CompaniesTable {
  id: UUID
  workspace_id: UUID
  name: string
  normalized_name: string
  description: Nullable<string>
  owner_user_id: Nullable<UUID>
  customer_profile: Nullable<string>
  business_role: Nullable<string>
}

export interface CompanyDomainsTable {
  id: Generated<UUID>
  workspace_id: UUID
  company_id: UUID
  raw_domain: string
  normalized_domain: string
  is_primary: Generated<boolean>
  provenance: JsonObject
}

export interface CompanyLinksTable {
  id: Generated<UUID>
  workspace_id: UUID
  company_id: UUID
  kind: string
  raw_url: string
  canonical_url: string
  is_primary: Generated<boolean>
  provenance: JsonObject
}

export interface CompanyAddressesTable {
  id: Generated<UUID>
  workspace_id: UUID
  company_id: UUID
  label: Nullable<string>
  street: Nullable<string>
  city: Nullable<string>
  region: Nullable<string>
  postal_code: Nullable<string>
  country_code: Nullable<string>
  latitude: Nullable<number>
  longitude: Nullable<number>
  provider_place_id: Nullable<string>
  is_primary: Generated<boolean>
}

export interface PersonCompaniesTable {
  id: Generated<UUID>
  workspace_id: UUID
  person_id: UUID
  company_id: UUID
  job_title: Nullable<string>
  role: Nullable<string>
  is_primary: Generated<boolean>
  started_on: NullableDateOnly
  ended_on: NullableDateOnly
  created_at: Timestamp
}

export interface OpportunitiesTable {
  id: UUID
  workspace_id: UUID
  name: string
  description: Nullable<string>
  stage: Generated<OpportunityStage>
  value: NullableNumeric
  currency: Generated<string>
  owner_user_id: Nullable<UUID>
  expected_close_date: NullableDateOnly
  next_action: Nullable<string>
  next_follow_up_at: NullableTimestamp
  won_at: NullableTimestamp
  lost_at: NullableTimestamp
  lost_reason: Nullable<string>
}

export interface OpportunityPeopleTable {
  workspace_id: UUID
  opportunity_id: UUID
  person_id: UUID
  relationship: Nullable<string>
  created_at: Timestamp
}

export interface OpportunityCompaniesTable {
  workspace_id: UUID
  opportunity_id: UUID
  company_id: UUID
  relationship: Nullable<string>
  created_at: Timestamp
}

export interface NotesTable {
  id: UUID
  workspace_id: UUID
  note_type: Generated<NoteType>
  title: string
  body_markdown: Generated<string>
  legacy_content: NullableJsonObject
}

export interface NotePeopleTable {
  workspace_id: UUID
  note_id: UUID
  person_id: UUID
}

export interface NoteCompaniesTable {
  workspace_id: UUID
  note_id: UUID
  company_id: UUID
}

export interface NoteOpportunitiesTable {
  workspace_id: UUID
  note_id: UUID
  opportunity_id: UUID
}

export interface TaxonomyTermsTable {
  id: Generated<UUID>
  workspace_id: UUID
  taxonomy: TaxonomyType
  label: string
  normalized_label: string
  created_at: Timestamp
}

export interface RecordTaxonomiesTable {
  workspace_id: UUID
  record_id: UUID
  taxonomy_term_id: UUID
  created_at: Timestamp
}

export interface ImportBatchesTable {
  id: Generated<UUID>
  workspace_id: UUID
  import_type: string
  source_name: string
  source_sha256: Bytea
  status: Generated<ImportBatchStatus>
  total_rows: Generated<number>
  created_count: Generated<number>
  updated_count: Generated<number>
  skipped_count: Generated<number>
  error_count: Generated<number>
  review_count: Generated<number>
  source_provenance: JsonObject
  created_by_actor_id: UUID
  created_at: Timestamp
  updated_at: Timestamp
  started_at: NullableTimestamp
  finished_at: NullableTimestamp
}

export interface ImportRowsTable {
  id: Generated<UUID>
  workspace_id: UUID
  batch_id: UUID
  row_number: number
  source_key: Nullable<string>
  status: Generated<ImportRowStatus>
  review_state: Generated<ImportReviewState>
  source_data: JsonObject
  normalized_data: JsonObject
  issues: JsonArray
  provenance: JsonObject
  target_record_id: Nullable<UUID>
  reviewed_by_actor_id: Nullable<UUID>
  reviewed_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
  processed_at: NullableTimestamp
}

export interface ExternalReferencesTable {
  id: Generated<UUID>
  workspace_id: UUID
  source_system: string
  object_type: string
  external_id: string
  record_id: UUID
  import_batch_id: Nullable<UUID>
  import_row_id: Nullable<UUID>
  provenance: JsonObject
  created_by_actor_id: UUID
  updated_by_actor_id: UUID
  first_seen_at: Timestamp
  last_seen_at: Timestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ActivityEventsTable {
  id: Generated<UUID>
  workspace_id: UUID
  actor_id: UUID
  owner_user_id: Nullable<UUID>
  action: string
  primary_record_id: Nullable<UUID>
  source: string
  occurred_at: Timestamp
  request_id: Nullable<string>
  correlation_id: Nullable<string>
  idempotency_key: Nullable<string>
  changed_fields: JsonObject
}

export interface ActivityRecordsTable {
  workspace_id: UUID
  activity_event_id: UUID
  record_id: UUID
}

export interface OutboxEventsTable {
  id: Generated<UUID>
  workspace_id: UUID
  event_type: string
  deduplication_key: Nullable<string>
  payload: JsonObject
  correlation_id: Nullable<string>
  created_at: Timestamp
  available_at: Timestamp
  attempts: Generated<number>
  claimed_at: NullableTimestamp
  published_at: NullableTimestamp
  last_error: Nullable<string>
}

export interface SchemaMigrationsTable {
  filename: string
  sha256: string
  applied_at: Timestamp
}

/** Kysely database shape. All record mutations, activity, and outbox writes share one transaction. */
export interface Database {
  workspaces: WorkspacesTable
  users: UsersTable
  password_credentials: PasswordCredentialsTable
  sessions: SessionsTable
  account_tokens: AccountTokensTable
  actors: ActorsTable
  records: RecordsTable
  people: PeopleTable
  person_emails: PersonEmailsTable
  person_phones: PersonPhonesTable
  person_links: PersonLinksTable
  person_addresses: PersonAddressesTable
  companies: CompaniesTable
  company_domains: CompanyDomainsTable
  company_links: CompanyLinksTable
  company_addresses: CompanyAddressesTable
  person_companies: PersonCompaniesTable
  opportunities: OpportunitiesTable
  opportunity_people: OpportunityPeopleTable
  opportunity_companies: OpportunityCompaniesTable
  notes: NotesTable
  note_people: NotePeopleTable
  note_companies: NoteCompaniesTable
  note_opportunities: NoteOpportunitiesTable
  taxonomy_terms: TaxonomyTermsTable
  record_taxonomies: RecordTaxonomiesTable
  import_batches: ImportBatchesTable
  import_rows: ImportRowsTable
  external_references: ExternalReferencesTable
  activity_events: ActivityEventsTable
  activity_records: ActivityRecordsTable
  outbox_events: OutboxEventsTable
  schema_migrations: SchemaMigrationsTable
}
