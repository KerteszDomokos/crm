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
export type EventStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
export type EventSource = 'LOCAL' | 'SYNCED'
export type EventAttendeeResponseStatus = 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'UNKNOWN'
export type EventAttendeeReviewState = 'NOT_REQUIRED' | 'PENDING' | 'CONFIRMED' | 'IGNORED'
export type MeetingNoteStatus = 'REQUIRED' | 'COMPLETED' | 'CANCELLED'
export type FollowUpStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'
export type FollowUpSource = string
export type ReminderStatus = 'SCHEDULED' | 'DELIVERED' | 'DISMISSED' | 'CANCELLED' | 'FAILED'
export type IntroductionChainStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
export type IntroductionStepStatus =
  | 'PLANNED'
  | 'PENDING'
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'INTRODUCED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'SKIPPED'

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
  country_name: Nullable<string>
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
  country_name: Nullable<string>
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

export interface EventsTable {
  id: Generated<UUID>
  workspace_id: UUID
  title: string
  description: Nullable<string>
  starts_at: Timestamp
  ends_at: Timestamp
  all_day: Generated<boolean>
  source_timezone: Generated<string>
  organizer: Nullable<string>
  organizer_name: Nullable<string>
  organizer_email: Nullable<string>
  organizer_user_id: Nullable<UUID>
  owner_user_id: Nullable<UUID>
  location: Nullable<string>
  meeting_url: Nullable<string>
  status: Generated<EventStatus>
  source: Generated<EventSource>
  is_read_only: boolean
  recurrence_identity: Nullable<string>
  workflow_eligible: Generated<boolean>
  exclusion_reason: Nullable<string>
  settings_version: Generated<number>
  created_by_actor_id: Nullable<UUID>
  updated_by_actor_id: Nullable<UUID>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface EventAttendeesTable {
  id: Generated<UUID>
  workspace_id: UUID
  event_id: UUID
  display_name: Nullable<string>
  email: Nullable<string>
  normalized_email: Nullable<string>
  response_status: Generated<EventAttendeeResponseStatus>
  is_internal: Generated<boolean>
  is_organizer: Generated<boolean>
  matched_person_id: Nullable<UUID>
  matched_user_id: Nullable<UUID>
  review_state: Generated<EventAttendeeReviewState>
  reviewed_by_actor_id: Nullable<UUID>
  reviewed_at: NullableTimestamp
  created_by_actor_id: UUID
  updated_by_actor_id: UUID
  created_at: Timestamp
  updated_at: Timestamp
}

export interface EventPeopleTable {
  workspace_id: UUID
  event_id: UUID
  person_id: UUID
  created_by_actor_id: Nullable<UUID>
  created_at: Timestamp
}

export interface EventCompaniesTable {
  workspace_id: UUID
  event_id: UUID
  company_id: UUID
  created_by_actor_id: Nullable<UUID>
  created_at: Timestamp
}

export interface EventOpportunitiesTable {
  workspace_id: UUID
  event_id: UUID
  opportunity_id: UUID
  created_by_actor_id: Nullable<UUID>
  created_at: Timestamp
}

export interface MeetingNotesTable {
  note_id: UUID
  workspace_id: UUID
  event_id: UUID
  summary: Generated<string>
  next_steps_markdown: Generated<string>
  follow_up_date: NullableDateOnly
  status: Generated<MeetingNoteStatus>
  cancellation_reason: Nullable<string>
  completed_by_actor_id: Nullable<UUID>
  completed_at: NullableTimestamp
  cancelled_by_actor_id: Nullable<UUID>
  cancelled_at: NullableTimestamp
  created_by_actor_id: Nullable<UUID>
  updated_by_actor_id: Nullable<UUID>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface FollowUpsTable {
  id: Generated<UUID>
  workspace_id: UUID
  title: string
  body: Nullable<string>
  due_at: NullableTimestamp
  assignee_user_id: Nullable<UUID>
  status: Generated<FollowUpStatus>
  source: FollowUpSource
  source_event_id: Nullable<UUID>
  source_meeting_note_id: Nullable<UUID>
  completed_by_actor_id: Nullable<UUID>
  completed_at: NullableTimestamp
  cancelled_by_actor_id: Nullable<UUID>
  cancelled_at: NullableTimestamp
  cancellation_reason: Nullable<string>
  created_by_actor_id: Nullable<UUID>
  updated_by_actor_id: Nullable<UUID>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface FollowUpRecordsTable {
  workspace_id: UUID
  follow_up_id: UUID
  record_id: UUID
  relationship: Generated<'RELATED' | 'SOURCE'>
  created_by_actor_id: Nullable<UUID>
  created_at: Timestamp
}

export interface RemindersTable {
  id: Generated<UUID>
  workspace_id: UUID
  follow_up_id: UUID
  scheduled_at: Timestamp
  status: Generated<ReminderStatus>
  delivered_at: NullableTimestamp
  dismissed_at: NullableTimestamp
  dismissed_by_actor_id: Nullable<UUID>
  cancelled_at: NullableTimestamp
  cancelled_by_actor_id: Nullable<UUID>
  failure_reason: Nullable<string>
  created_by_actor_id: UUID
  updated_by_actor_id: UUID
  created_at: Timestamp
  updated_at: Timestamp
}

export interface IntroductionChainsTable {
  id: Generated<UUID>
  workspace_id: UUID
  target_person_id: UUID
  owner_user_id: UUID
  status: Generated<IntroductionChainStatus>
  created_by_actor_id: Nullable<UUID>
  updated_by_actor_id: Nullable<UUID>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface IntroductionStepsTable {
  id: Generated<UUID>
  workspace_id: UUID
  chain_id: UUID
  position: number
  from_person_id: Nullable<UUID>
  to_person_id: UUID
  responsible_user_id: Nullable<UUID>
  responsible_person_id: Nullable<UUID>
  status: Generated<IntroductionStepStatus>
  notes: Nullable<string>
  requested_at: NullableTimestamp
  follow_up_at: NullableTimestamp
  created_by_actor_id: Nullable<UUID>
  updated_by_actor_id: Nullable<UUID>
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
  events: EventsTable
  event_attendees: EventAttendeesTable
  event_people: EventPeopleTable
  event_companies: EventCompaniesTable
  event_opportunities: EventOpportunitiesTable
  meeting_notes: MeetingNotesTable
  follow_ups: FollowUpsTable
  follow_up_records: FollowUpRecordsTable
  reminders: RemindersTable
  introduction_chains: IntroductionChainsTable
  introduction_steps: IntroductionStepsTable
  activity_events: ActivityEventsTable
  activity_records: ActivityRecordsTable
  outbox_events: OutboxEventsTable
  schema_migrations: SchemaMigrationsTable
}
