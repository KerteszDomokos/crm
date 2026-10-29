# Database foundation

PostgreSQL 17 schema for the shared Resoloon CRM workspace. The initial migration
is `migrations/001_core.sql`; Kysely-compatible database interfaces are in
`src/types.ts`.

## ERD (core)

```mermaid
erDiagram
  WORKSPACES ||--o{ USERS : contains
  USERS ||--o| PASSWORD_CREDENTIALS : authenticates
  USERS ||--o{ SESSIONS : owns
  USERS ||--o{ ACCOUNT_TOKENS : receives
  WORKSPACES ||--o{ ACTORS : attributes
  USERS ||--o{ ACTORS : represents
  ACTORS ||--o{ RECORDS : creates_or_updates
  WORKSPACES ||--o{ RECORDS : shares
  RECORDS ||--o| PEOPLE : typed_as
  RECORDS ||--o| COMPANIES : typed_as
  RECORDS ||--o| OPPORTUNITIES : typed_as
  RECORDS ||--o| NOTES : typed_as
  PEOPLE ||--o{ PERSON_EMAILS : has
  PEOPLE ||--o{ PERSON_PHONES : has
  PEOPLE ||--o{ PERSON_LINKS : has
  PEOPLE }o--o{ COMPANIES : person_companies
  OPPORTUNITIES }o--o{ PEOPLE : opportunity_people
  OPPORTUNITIES }o--o{ COMPANIES : opportunity_companies
  NOTES }o--o{ PEOPLE : note_people
  NOTES }o--o{ COMPANIES : note_companies
  NOTES }o--o{ OPPORTUNITIES : note_opportunities
  RECORDS }o--o{ TAXONOMY_TERMS : record_taxonomies
  WORKSPACES ||--o{ IMPORT_BATCHES : tracks
  ACTORS ||--o{ IMPORT_BATCHES : starts
  IMPORT_BATCHES ||--o{ IMPORT_ROWS : stages
  ACTORS ||--o{ IMPORT_ROWS : reviews
  IMPORT_ROWS }o--o| RECORDS : resolves
  WORKSPACES ||--o{ EXTERNAL_REFERENCES : scopes
  RECORDS ||--o{ EXTERNAL_REFERENCES : maps
  IMPORT_ROWS o|--o{ EXTERNAL_REFERENCES : provenance
  ACTORS ||--o{ EXTERNAL_REFERENCES : attributes
  ACTORS ||--o{ ACTIVITY_EVENTS : performs
  ACTIVITY_EVENTS }o--o{ RECORDS : activity_records
  WORKSPACES ||--o{ OUTBOX_EVENTS : queues
```

All business objects use a `records` identity row for workspace, type, actor
attribution, archive/merge tombstone, timestamps, and optimistic `version`.
Typed tables share the identity UUID and have composite workspace foreign keys;
database triggers ensure the typed row matches `records.record_type`. Junctions
also carry the workspace key, preventing cross-workspace relationships.

## Apply migrations

This folder is self-contained. Install its declared dependencies, set
`DATABASE_URL` to a PostgreSQL 17 database, then run `npm run migrate` from this
directory. Each numbered SQL file is applied in its own transaction under a
PostgreSQL advisory lock. Applied files are SHA-256 checked; never edit an
applied migration—add the next numbered file. `002_import_tracking.sql` adds
workspace-scoped import staging and external source mappings. The runner creates
`public.schema_migrations`.

## Mutation and security contracts

- Generate setup/reset/session tokens in the application and persist only their
  32-byte SHA-256 hashes. `password_credentials` stores a scrypt hash, separate
  random salt, and versioned parameters; never store plaintext credentials.
- Create one `USER` actor per user. Non-user actors use `SYSTEM`, `INTEGRATION`,
  `MCP_CLIENT`, or `IMPORT` plus a stable `external_actor_key`; set
  `owner_user_id` when automation is owned by a user. The key intentionally
  leaves room for integration/client/import tables added in later slices.
- Create/update the `records` identity and typed row in the same transaction.
  For optimistic edits, lock or conditionally update the identity using
  `WHERE id = $id AND workspace_id = $workspace AND version = $expected`, set
  `version = version + 1`, `updated_at`, and `updated_by_actor_id`, and require
  exactly one returned row. Write the matching `activity_events` (and
  `activity_records`) and any `outbox_events` in that same transaction. A
  zero-row update is a conflict. The database requires every identity-row
  update to increment the version by exactly one but does not increment it
  automatically: callers must perform the version check in the same transaction
  as the business mutation.
- Activity rows and record identities cannot be hard-deleted; archive or merge
  records instead. Keep activity diffs small and exclude note bodies, email
  content, tokens, and credentials. Outbox payloads must not contain secrets.
- User emails are case-insensitively unique per workspace. Contact email/domain
  normalization (including IDNA and URL canonicalization) is performed by the
  application and stored in the corresponding normalized columns. Partial unique
  indexes block duplicate active email identities, E.164 phones, domains, and
  canonical links.
- Import batches are idempotently identified by workspace, import type, and the
  SHA-256 digest of the original source bytes (stored as 32-byte `bytea`, not a
  filename hash). On a uniqueness conflict, reuse the existing batch rather than
  creating duplicate staging rows. `import_rows.row_number` is one-based and
  unique within its batch; raw source data and provenance are immutable, while
  normalized values, issues, review decisions, target records, batch status, and
  current outcome counts can progress. The outcome counters are disjoint current
  row buckets and their total cannot exceed `total_rows`. Batch and row history
  cannot be hard-deleted.
- `external_references` provides a stable unique mapping per workspace/source
  system/object type/external ID (source system and object type use lowercase
  canonical names). Its record, actor, and optional import-row provenance links
  are workspace-scoped; mappings can be retargeted during a record merge, but
  their source identity and origin cannot be rewritten.

This slice covers core CRM records, notes/taxonomies, identity, activity,
transactional outbox, and import tracking. Events, meeting-note state machines,
follow-ups, email, integration credentials, MCP-client administration, search
projections, and operations are later schema slices.
