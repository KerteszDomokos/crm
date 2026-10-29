# Resoloon CRM — Technical Implementation Plan

This plan turns `FUNCTIONAL_PLAN.md` into an implementation program for multiple coding agents. `FUNCTIONAL_PLAN.md` remains the product source of truth; this document defines architecture, contracts, sequencing, ownership, and technical acceptance gates.

## 1. Confirmed decisions

| Area | Decision |
| --- | --- |
| Architecture | TypeScript modular monolith with separate API and worker processes |
| Web application | React 19, Vite, TypeScript, TanStack Router/Query/Table |
| API | Fastify 5 REST API under `/api/v1`, documented with OpenAPI |
| Database | PostgreSQL 17 with Kysely migrations and repositories |
| Background work | `pg-boss` using PostgreSQL; no Redis |
| Search | PostgreSQL full-text search, `unaccent`, and `pg_trgm`; no external search service |
| Authentication | Email/password with opaque server-side sessions |
| Account setup/reset | Admin generates a single-use link and shares it outside the CRM |
| Calendar | Read-only Google Calendar synchronization |
| Email | Gmail and Google Workspace only; the CRM never sends email |
| Integration updates | Polling only; no publicly exposed webhook endpoint |
| Email history | Initial metadata-first scan of all available mailbox history |
| Email attachments | Not imported in the first release |
| Email exclusions | An excluded participant is ignored for matching/person creation but does not veto an otherwise eligible thread |
| MCP | Remote Streamable HTTP over Tailscale with per-client credentials/scopes |
| Location autocomplete | Configurable OpenStreetMap-compatible provider |
| Manual backup | Admin downloads a versioned ZIP; no restore UI or restore CLI in the first release |
| Workspace defaults | `Europe/Budapest` timezone and `EUR` currency |
| Deployment | ARM64-compatible containers for Kubernetes; cluster configuration remains in the separate infrastructure repository |

## 2. Delivery principles

1. Build a modular monolith, not microservices.
2. PostgreSQL is the source of truth for business data, jobs, search, and synchronization state.
3. The browser, future native clients, and MCP adapter call the same application services.
4. Every external synchronization and long-running operation is idempotent, retryable, and observable.
5. Authentication, authorization, privacy checks, validation, and attribution are enforced server-side.
6. Deliver vertical slices: migration → domain service → API → UI → jobs → tests.
7. Freeze shared contracts before parallel feature agents begin.
8. One schema owner sequences migrations. Feature agents propose schema changes instead of independently editing migration history.
9. A feature is not complete without permission checks, activity history, error states, and automated tests.
10. Follow `DESIGN.md` for all user-facing surfaces.

## 3. Target repository layout

```text
apps/
  web/                  React SPA
  api/                  Fastify API and production SPA host
  worker/               pg-boss workers and scheduled polling
  mcp/                  Streamable HTTP MCP entry point
packages/
  contracts/            TypeBox schemas, OpenAPI source, generated client types
  db/                   Kysely schema types, migrations, repositories, fixtures
  domain/               Entities, policies, services, state machines
  integrations/         Google, Gmail, Linear, OSM and storage adapters
  jobs/                 Job names, payload contracts, handlers, retry policy
  auth/                 Passwords, sessions, setup/reset links, RBAC
  search/               Index projection and query implementation
  backup/               Versioned export and ZIP generation
  ui/                   Shared design-system components and tokens
  config/               Typed environment and runtime configuration
  test-support/         Factories, provider fakes, fixtures, test database helpers
data/                    Existing source CSV files; never bundled into production images
docs/
  adr/                   Architecture decision records
  api/                   Generated OpenAPI and integration notes
  runbooks/              Operations, import, backup and troubleshooting guides
```

Use a `pnpm` workspace with one lockfile. The API and worker use the same domain and repository packages but run as separate processes. The API serves the compiled SPA in production so the browser and API share one origin.

## 4. Runtime architecture

### 4.1 Processes

- **API process:** REST API, authentication, admin actions, upload/download streaming, health and metrics endpoints, and compiled SPA assets.
- **Worker process:** imports, polling, workflow deadlines, search indexing, duplicate scoring, and backup generation.
- **MCP process:** authenticated MCP transport calling the same application service layer. It may initially run in the same image as the API but remains a separate entry point.
- **PostgreSQL:** business data, sessions, synchronization cursors, outbox, job queue, and search projections.
- **File volume:** uploaded CSVs and generated backup archives on a Kubernetes PVC through a storage abstraction.

### 4.2 Deployment outputs

This repository must produce:

- A multi-stage `linux/amd64` and `linux/arm64` application image.
- Commands for API, worker, MCP, migrations, and initial-admin bootstrap.
- `/health/live` and `/health/ready` endpoints.
- `/metrics` in Prometheus format.
- A documented environment-variable contract.
- Graceful shutdown for API requests and in-flight jobs.

Kubernetes manifests, PostgreSQL provisioning, ingress, Tailscale, PVC creation, and scheduled infrastructure backups remain outside this repository.

### 4.3 Baseline dependencies

- Node.js 24 LTS on Debian Bookworm Slim.
- React 19 and Vite.
- Fastify 5.
- TypeBox for runtime schemas and OpenAPI generation.
- Kysely and `node-postgres`.
- `pg-boss` for jobs.
- Tailwind CSS using `DESIGN.md` tokens, Radix primitives, and `lucide-react`.
- React Hook Form for forms.
- Markdown rendering with raw HTML disabled and sanitized output.
- Pino structured logging.
- Vitest and Playwright.

Avoid dependencies requiring architecture-specific binaries unless an ARM64 build is tested in CI.

## 5. Contracts that must be frozen before feature work

### 5.1 Identity and authorization

Roles:

- `ADMIN`: shared CRM access plus user management, workspace settings, integrations, MCP clients, imports, and backups.
- `USER`: shared CRM access plus own profile, password, and connected Google account.

Rules:

- There is no public registration.
- A bootstrap command creates the first administrator.
- Admin-created accounts begin in `SETUP_REQUIRED` state.
- Setup/reset links are random, single-use, hashed in storage, expire, and are displayed only once to the administrator.
- Deactivation immediately revokes all sessions and pauses the user's integration accounts.
- Historical attribution and ownership survive deactivation.
- All business records are shared between active users; role differences apply to administration, not CRM record visibility.

Actor types:

- `USER`
- `SYSTEM`
- `INTEGRATION`
- `MCP_CLIENT`
- `IMPORT`

Automated activity records both the actor and, when applicable, the owning user/integration account.

### 5.2 Common record contract

Use UUID primary keys and UTC `timestamptz` values. Display dates in the workspace timezone.

Business records share a `records` identity row:

```text
id
workspace_id
record_type
created_at / updated_at
created_by_actor_id / updated_by_actor_id
version
archived_at
merged_into_record_id
```

Typed tables use `records.id` as their primary key. `version` increments on mutation and supports optimistic concurrency. Merged records remain as tombstones so old URLs and external references resolve to the survivor.

Critical domain relationships use explicit junction tables. Generic timeline attachments may use `record_relations`, with both sides referencing `records`.

### 5.3 Mutation and activity contract

Every successful mutation writes an append-only activity event in the same transaction:

```text
actor_type / actor_id
owner_user_id when relevant
action
primary_record_id
related_record_ids
source
timestamp
request_id / correlation_id
idempotency_key when relevant
changed-field summary
```

Do not place note bodies, email bodies, tokens, or large payloads in activity diffs.

### 5.4 API contract

- Base path: `/api/v1`.
- JSON uses `camelCase`; database naming remains `snake_case`.
- Cursor pagination for large collections.
- Explicit filter and sort allowlists.
- `PATCH` for partial updates.
- RFC 9457 problem details for errors.
- Record `version` or `ETag`/`If-Match` for conflicting edits.
- `Idempotency-Key` for imports, backups, integration commands, MCP writes, and destructive commands.
- `202 Accepted` plus an operation resource for asynchronous work.
- Merge and other destructive commands require a preview/confirmation token.
- OpenAPI is generated from runtime request/response schemas.
- The web client is generated from OpenAPI and must not hand-code duplicate DTO types.

### 5.5 Job contract

Each job defines:

- Versioned payload schema.
- Deterministic deduplication key.
- Related workspace, record, operation, and integration account.
- Retry policy and terminal/dead-letter behavior.
- Correlation ID.
- User-visible failure summary where applicable.

API transactions enqueue work through a transactional outbox. Job handlers re-read current state and remain safe under retries, delays, and duplicate delivery.

### 5.6 Integration contract

All provider adapters implement:

- Connect/disconnect status.
- Incremental cursor storage.
- Poll execution and health reporting.
- Stable mapping from provider IDs to CRM records.
- Idempotent upsert behavior.
- Exponential retry and terminal error classification.
- Credential access through an encrypted credential repository.

OAuth tokens are encrypted with AES-256-GCM using a versioned key supplied by Kubernetes Secret. Credentials, sessions, setup/reset tokens, and MCP secrets never enter logs or backup archives.

## 6. Database and domain model

The schema owner must publish an entity relationship diagram before Phase 1 exits.

### 6.1 Workspace, users, and security

- `workspaces`: name, default timezone, default currency, workflow settings/version.
- `users`: name, case-insensitive unique email, role, state, timestamps.
- `password_credentials`: password hash and forced-reset state.
- `sessions`: hashed opaque token, expiry, last use, user-agent metadata.
- `account_tokens`: hashed setup/reset token, purpose, expiry, consumed timestamp.
- `actors`: actor type and links to user, integration account, MCP client, or import batch.
- `mcp_clients`: name, scopes, active state, hashed credential metadata.

Use Node's `crypto.scrypt` with per-password salt and versioned parameters. Never store or display plaintext passwords.

### 6.2 People and companies

- `people`: full name, normalized name, job title, description, importance, introduced-by person.
- `person_emails`: raw/normalized address, primary flag, match-enabled flag, provenance.
- `person_phones`: raw/E.164 value, primary flag, provenance.
- `person_links`: kind, raw/canonical URL, primary flag, provenance.
- `person_addresses`: structured address, city, country, coordinates, provider place ID.
- `companies`: name, normalized name, description, owner user, customer profile, business role.
- `company_domains`, `company_links`, `company_addresses`.
- `person_companies`: person, company, title/role, primary flag, optional dates.
- `taxonomy_terms` and `record_taxonomies`: categories and industries.

Normalization:

- Email: trim, case-normalize domain, preserve local-part semantics.
- Phone: normalize to E.164 when country context exists; preserve raw input.
- Domain: hostname only, lowercase, IDNA, strip `www.`.
- LinkedIn: canonical host/path without query string or trailing slash.

### 6.3 Opportunities

- `opportunities`: name, description, stage, value, ISO currency, owner, expected close date, next action, next follow-up, won/lost timestamp and reason.
- `opportunity_people` and `opportunity_companies`.

Stages are fixed for the first release: `LEAD`, `QUALIFIED`, `PROPOSAL`, `NEGOTIATION`, `WON`, `LOST`.

### 6.4 Notes and meeting notes

- `notes`: type, title, canonical Markdown, optional preserved legacy JSON.
- `note_people`, `note_companies`, `note_opportunities`.
- `meeting_notes`: note ID, unique event ID, summary, next-steps Markdown, follow-up date, status, cancellation reason, completion/cancellation actor and timestamp.

Cancelled meeting notes require a reason. Raw HTML in Markdown is disabled.

### 6.5 Events and attendees

- `events`: title, description, start/end, all-day flag, source timezone, organizer, location/meeting URL, status, recurrence identity, owner, workflow eligibility, exclusion reason/settings version.
- `event_attendees`: name, normalized email, response status, internal/organizer flags, matched person/user, review state.
- `event_people`, `event_companies`, `event_opportunities`.

Google events are read-only. Events manually created in the CRM remain local and are not written to Google.

Unknown external attendees become dashboard review candidates. A person is created only after user confirmation. Excluded meetings create neither review candidates nor meeting-note/Linear work.

### 6.6 Follow-ups and reminders

- `follow_ups`: title, body, due time, assignee, status, source, completion/cancellation metadata.
- `reminders`: follow-up, schedule, delivery/status metadata.
- Related records use explicit junctions or validated `record_relations`.

Statuses: `OPEN`, `COMPLETED`, `CANCELLED`.

### 6.7 Warm introductions

- `introduction_chains`: target person, owner, overall status, current step.
- `introduction_steps`: ordered position, introducer/from person, destination person, responsible user/person, status, notes, requested date, follow-up date.

Step positions are unique within a chain. Current step is the first nonterminal step. Person pages query active steps to display introduction obligations.

### 6.8 Email and sales tracking

- `email_private_probes`: owning account, remote thread ID, dates, and HMAC participant identities only.
- `email_threads`: eligible shared thread metadata.
- `email_thread_sources`: Gmail account and remote thread mapping.
- `email_messages`: provider ID, RFC Message-ID, dates, direction, sanitized text/HTML.
- `email_participants`: normalized address, display name, role, optional matched person.
- `email_thread_people`, `email_thread_companies`, `email_thread_opportunities`.
- `sales_tracking`: thread, anchor sent message, deadline/version, status, reply timestamp, resolution override, linked follow-up/Linear state.

No raw MIME or attachment body is stored in the first release.

### 6.9 LinkedIn and imports

- `import_batches`: type, source file, SHA-256, state, counts, actor, timestamps.
- `import_rows`: raw source, normalized projection, state, error/review reason.
- `linkedin_connections`: canonical profile identity, raw LinkedIn values, first/last seen, matched person, ignored state.
- `enrichment_suggestions`: target field, existing value, proposed value, resolution.
- `external_references`: source system/type/ID mapped to a CRM record.

Repeated LinkedIn imports preserve prior match/ignore decisions and never treat absence from a later file as deletion.

### 6.10 Integrations and synchronization

- `integration_accounts`: provider, owner, state, nonsecret configuration.
- `integration_credentials`: encrypted credential payload and key version.
- `external_objects`: provider account/type/external ID mapped to a record.
- `sync_cursors`, `sync_runs`, `sync_errors`.
- `outbox_events`.
- `linear_links`: CRM record/purpose, issue ID/key, state, mapped status, last versions/timestamps.

Unique constraints prevent duplicate provider objects and duplicate active Linear links.

### 6.11 Search, duplicates, activity, and files

- `search_documents`: record, type, weighted title/identity/body text, `tsvector`, match metadata, indexed record version.
- `merge_candidates`: two records, component scores, reasons, status.
- `activity_events` and `activity_records`.
- `stored_files`: storage key, original name, MIME type, size, SHA-256, purpose, retention state.
- `operations`: async operation type, progress, result/error, requesting actor.

Activity rows are append-only. Search projections and generated backup archives are rebuildable and may be excluded from logical backup content.

## 7. API surface

Initial route groups:

```text
/api/v1/auth/*
/api/v1/me
/api/v1/admin/users/*
/api/v1/admin/mcp-clients/*
/api/v1/people/*
/api/v1/companies/*
/api/v1/opportunities/*
/api/v1/notes/*
/api/v1/events/*
/api/v1/follow-ups/*
/api/v1/introductions/*
/api/v1/email/*
/api/v1/linkedin-connections/*
/api/v1/search
/api/v1/imports/*
/api/v1/merge-candidates/*
/api/v1/backups/*
/api/v1/operations/*
/api/v1/integrations/google/*
/api/v1/integrations/linear/*
/api/v1/settings/*
```

Command-style operations include:

- Merge preview and confirmed merge.
- Confirm/reject attendee person creation.
- Complete/cancel meeting note.
- Mark/unmark sales tracking and override reply resolution.
- Retry integration operation.
- Match/convert/ignore LinkedIn connection.
- Generate account setup/reset link.
- Start import or backup.

List/detail endpoints must expose only required display fields. Email bodies are returned only for eligible shared threads to authenticated users.

## 8. Authentication and application security

### 8.1 Browser sessions

- Generate opaque random session tokens.
- Store only token hashes in PostgreSQL.
- Use `Secure`, `HttpOnly`, `SameSite=Lax` cookies.
- Enforce origin checks and CSRF protection for cookie-authenticated mutations.
- Rotate session on login and password changes.
- Revoke every session on account deactivation/reset.
- Apply rate limits to login, setup/reset validation, imports, backups, and MCP.
- Use generic login/reset responses that do not reveal account existence.

### 8.2 Setup/reset without outbound email

1. Admin creates or resets a user.
2. API generates a short-lived, single-use setup URL.
3. UI displays it once with a copy button and expiry warning.
4. Admin shares it outside the CRM.
5. User sets a password; all older links and sessions are revoked.

A login-page reset request records an admin-visible request and returns generic instructions to contact an administrator. The system does not send email.

### 8.3 Sensitive-data controls

- Redact authorization headers, cookies, OAuth payloads, email bodies, and tokens from logs.
- Encrypt provider credentials at rest.
- Apply server-side RBAC to every admin route and service command.
- Sanitize email HTML and Markdown output.
- Enforce upload type/size limits and safe generated filenames.
- Treat CSV formula prefixes as untrusted when creating downloadable reports.
- Validate outbound provider URLs to prevent SSRF.

## 9. Search and duplicate handling

### 9.1 Search

Use PostgreSQL `simple` text search with accent-normalized text because records contain Hungarian and English.

- GIN index on `tsvector`.
- Trigram indexes for names, domains, short queries, and typo tolerance.
- Exact normalized email, phone, domain, and LinkedIn matching receives highest rank.
- Search results are grouped by record type with escaped match snippets.
- Header suggestions use a small result limit and strict latency budget.
- Enter opens the detailed search page with filters and pagination.
- Eligible email content is indexed; private probes are never indexed.
- Index jobs are version-aware and idempotent.

### 9.2 Duplicate candidates

Strong blockers:

- People: exact normalized email, canonical LinkedIn URL, or valid unique E.164 phone.
- Companies: exact normalized domain or canonical LinkedIn URL.

Fuzzy suggestions use trigram similarity plus company, title, and city context. Fuzzy matches never auto-merge.

Confirmed merge transaction:

1. Lock both records and verify versions.
2. Apply user-selected survivor values.
3. Repoint and deduplicate relationships.
4. Move external references and provenance.
5. Mark the losing record as merged.
6. Emit a detailed activity event.
7. Enqueue search and duplicate recalculation.

Merge reversal is not part of the first release.

## 10. Initial and LinkedIn imports

### 10.1 Import pipeline

1. Stream upload to file storage and calculate SHA-256.
2. Parse into staging/import rows without mutating CRM records.
3. Normalize names, JSON-array cells, emails, phones, domains, links, and dates.
4. Validate references and build a dry-run summary.
5. Present duplicate and unresolved rows for review.
6. Commit approved records in bounded transactions.
7. Preserve raw rows and legacy IDs as provenance/external references.
8. Enqueue search and duplicate projections.

### 10.2 Existing data specifics

- `person.csv`: 460 records; combine first/last names while tolerating rows where the first-name field already contains a complete name.
- `company.csv`: 300 records.
- `note.csv`: 25 Markdown notes without reliable record relationships; import them into an unassigned-note review list instead of guessing attachments.
- Parse multiline CSV fields and JSON arrays correctly.
- Normalize zero-width and other Unicode artifacts in phone metadata.
- Restore both person-side company IDs and company-side “Other people” IDs.
- Preserve legacy BlockNote/TipTap data only as provenance; Markdown is canonical.
- Map legacy workspace members to current users during import. Unmapped actors remain named legacy import actors and can be mapped later.

### 10.3 LinkedIn import

- File SHA-256 prevents accidental duplicate processing.
- Canonical LinkedIn profile URL is the strongest row identity.
- Re-import updates `lastSeenAt` and source-side values.
- Existing match/ignore decisions persist.
- Better CRM values are never overwritten automatically; create field-level suggestions.
- Rows without stable profile URLs enter review rather than receiving a guessed identity.

## 11. Google Calendar and meeting workflow

### 11.1 Polling

- Connect one or more Google calendars per user through OAuth.
- Poll incrementally with Google sync tokens every 2–5 minutes.
- Use `googleAccount + calendarId + eventId` as the provider mapping key.
- Use `iCalUID + recurrence instance` to recognize shared meetings seen in multiple users' calendars.
- Handle cancellation, rescheduling, recurrence, cursor expiry, and full resynchronization.
- Never write CRM changes back to Google Calendar.

### 11.2 Eligibility order

For each ended event:

1. Deduplicate shared copies.
2. Evaluate excluded words/phrases and excluded people.
3. Ignore cancelled events and events declined by the owning user.
4. Require at least one external attendee.
5. Match known attendees by normalized email.
6. Add unknown attendees to the dashboard confirmation queue.
7. Create one required meeting-note workflow and one Linear issue with deterministic keys.

Save the settings version and exclusion reason used. Changing exclusions does not retroactively cancel existing work in the first release; an administrator may cancel it manually.

### 11.3 Completion

- Required meeting note, cancellation, next steps, and follow-up date use an explicit state machine.
- CRM completion/cancellation updates Linear.
- Linear completion/cancellation updates CRM without creating an echo loop.
- Completing a note may create follow-ups with idempotency keys.
- Conflicting simultaneous status changes become a visible integration conflict.

## 12. Gmail ingestion and sales workflow

### 12.1 Privacy boundary

Email processing must separate private metadata probes from shared content.

1. Poll Gmail history for each connected user.
2. Fetch only IDs and participant headers required for matching.
3. Normalize external addresses and ignore internal workspace users.
4. Ignore excluded addresses for person matching and automatic person creation.
5. A thread is eligible when at least one nonexcluded external participant exactly matches an active CRM person email.
6. An excluded participant does not veto an otherwise eligible thread.
7. Only after eligibility succeeds, fetch and store the thread subject and sanitized message bodies.
8. Do not fetch or store attachments or raw MIME.

Private probe rows contain only account ID, remote thread ID, dates, and HMAC participant identities. They are excluded from shared search, MCP, activity feeds, and backups.

Because the selected backfill is **all available history**:

- Run the first scan as a throttled, resumable background operation.
- Show per-account progress and allow pause/retry.
- Process oldest/newest batches without blocking normal incremental polling.
- Apply the same privacy gate to historical and new messages.
- Creating or changing a person's email enqueues reevaluation across all private probes.

The application does not send, reply to, forward, or draft email.

### 12.2 Deduplication

- Primary identity: Gmail account plus provider message/thread ID.
- Secondary cross-account message identity: RFC Message-ID.
- Shared threads retain each source account and clearly show the account owner.
- Replayed history and overlapping backfill/incremental polling must not duplicate messages.

### 12.3 Sales tracking

- A user marks one eligible sent thread as sales-related.
- The CRM proposes matched recipients and companies.
- One tracking record may relate to multiple people/companies.
- Deadline defaults from workspace settings and is editable per thread.
- Only an external reply after the selected anchor message resolves no-reply tracking.
- Auto-replies and bounces are classified separately.
- A user may mark a reply as not resolving the follow-up.
- Deadline expiry creates one dashboard reminder and one Linear issue.
- A qualifying reply completes both unless manually overridden.

Use a key such as `sales-no-reply:{trackingId}:{deadlineVersion}` to prevent duplicate reminders.

## 13. Linear integration

- Administrators connect one Linear workspace and choose the team and management label.
- The settings UI maps Linear statuses to CRM open/completed/cancelled states.
- Poll Linear changes every 2–5 minutes.
- Embed a deterministic CRM marker in created issue descriptions and check for it before retry creation.
- CRM owns relationships, source details, deadline, and full content.
- Linear status synchronizes in both directions; CRM title updates may flow outward.
- Inbound changes are integration-attributed and do not immediately echo back.
- A Linear status may reopen a CRM item only when the configured mapping represents an open state.
- Concurrent edits that cannot be reconciled produce an admin-visible conflict.

## 14. Location autocomplete

- Define a geocoding provider interface and configure its base URL.
- Use an OpenStreetMap-compatible provider with required attribution.
- Debounce requests, cache results, and enforce provider rate limits.
- Store provider place ID, normalized city/country, and coordinates while preserving user-entered display text.
- If the provider is unavailable, forms continue to accept free text.
- Do not hardcode reliance on the public Nominatim endpoint for production traffic.

## 15. Manual backup

### 15.1 Archive generation

An administrator starts an asynchronous backup operation. The worker creates a timestamped ZIP from a repeatable-read snapshot.

Archive layout:

```text
manifest.json
tables/*.ndjson
files/<sha256>
imports/<sha256>-<safe-original-name>
checksums.sha256
```

The manifest includes application version, export/schema version, workspace ID, creation time, table/file counts, load-order metadata, and omitted-secret list.

Include all business records, relationships, activity, users/account states, nonsecret workspace/integration settings, retained imports, and stored files. Exclude:

- Password hashes
- Sessions
- Setup/reset tokens
- OAuth/API credentials
- MCP credentials
- Encryption/HMAC keys
- Job queue rows
- Private email probes
- Derived search projections
- Temporary generated archives

Future restoration must require password resets and integration reconnection.

### 15.2 Download behavior

- Show operation progress and failure details.
- Stream the completed ZIP rather than loading it into memory.
- Use unguessable download authorization tied to the requesting admin session.
- Record backup creation/download in activity history.
- Verify archive checksums before marking the operation complete.
- Delete generated server-side archives after 24 hours.
- Automated scheduled backup and restoration tooling are explicitly deferred.

## 16. MCP interface

- Expose Streamable HTTP over the Tailscale-only service endpoint.
- Admins create named clients and receive a credential once.
- Store only a credential hash; support revocation and scope changes.
- Define scopes for read, records write, workflow write, and administration. Do not grant administration by default.
- Route tools through the same domain services, validation, authorization, activity, and idempotency paths as REST.
- Apply request/result size limits and rate limits.
- Attribute every mutation to the MCP client.
- Merge/delete requests create expiring pending confirmations for the CRM UI instead of executing directly.
- Never expose private email probes or secrets through MCP.

## 17. Observability and operations

- Pino JSON logs to stdout with request, operation, job, and correlation IDs.
- Redact sensitive headers and payload fields.
- Metrics: API latency/error rate, job depth/age/failures, polling duration, last successful sync, search indexing lag, backup duration, and provider throttling.
- Admin integration page shows account state, last success, last error, cursor reset, and retry action.
- Failed jobs retain a user-safe summary and restricted diagnostic details.
- Do not deploy an ELK stack on the Raspberry Pi.

## 18. Test strategy

### 18.1 Required for every vertical slice

- Unit tests for policies, validation, state transitions, and matching.
- Repository tests against real PostgreSQL, never SQLite.
- API authorization and contract tests.
- UI tests for loading, empty, success, validation, conflict, permission, and failure states.
- At least one Playwright journey for the primary workflow.
- Activity-attribution assertion for every mutation.

### 18.2 Cross-system tests

- Sanitized/synthetic provider fixtures; CI does not call live Google or Linear APIs.
- Poll replay, duplicate delivery, cursor expiry, backoff, and dead-letter tests.
- Privacy test proving an unmatched Gmail body never reaches database storage, logs, search, MCP, or backup.
- Test that a thread remains eligible when another participant is excluded, matching the confirmed product decision.
- All-history Gmail backfill resume and overlap tests.
- Calendar shared-event and recurrence tests.
- Linear status echo-loop and conflict tests.
- Search consistency after edit, merge, archive, and email eligibility changes.
- Backup completeness and checksum tests. Full restore testing is deferred with the restore tooling.
- Timezone, daylight-saving, and deadline boundary tests for `Europe/Budapest`.
- ARM64 image startup smoke test.

### 18.3 Migration gate

CI must verify:

1. Migration from an empty database.
2. Upgrade from the previous phase checkpoint.
3. Constraints and indexes exist.
4. Backfills run against representative fixtures.
5. Migrations are transaction-safe or document their recovery procedure.

## 19. Multi-agent execution model

### 19.1 Agent roles

| Agent | Ownership | Shared files requiring review |
| --- | --- | --- |
| Architecture lead | ADRs, contracts, integration checkpoints, final review | All cross-cutting contracts |
| Platform agent | Workspace bootstrap, CI, containers, config, health, metrics | Root configs and lockfile |
| Schema/domain agent | ERD, migrations, repositories, activity/outbox, domain services | All migrations and DB types |
| Identity/security agent | Auth, sessions, users/admin, RBAC, credential encryption | User/actor schema proposals |
| UI foundation agent | Tokens, components, app shell, navigation, accessibility | Shared UI package |
| Core CRM agent | People, companies, opportunities, notes, timelines | Core API schemas |
| Data-quality agent | Legacy import, LinkedIn import, duplicates, merge | Import/merge contracts |
| Search/backup agent | Search projection/query, backup generation/download | Record projection contracts |
| Workflow agent | Events, meeting notes, follow-ups, dashboard, introductions | Workflow state contracts |
| Google/Linear agent | Calendar polling and Linear synchronization | Integration interfaces |
| Gmail/sales agent | Privacy gate, history polling, eligible email, sales workflow | Email privacy contract |
| MCP agent | MCP transport, tools, scopes, pending confirmations | Application service interfaces |
| QA/security agent | Test harness, threat model, release gates | May review all workstreams |

One person/agent may own multiple roles when capacity is limited, but ownership boundaries remain.

### 19.2 Working rules

- Use one branch/worktree per agent and one focused pull request per vertical slice.
- The architecture lead publishes task IDs and dependency labels before agents start.
- Only the schema/domain agent creates or resequences migrations.
- Feature agents submit migration proposals with required fields, constraints, and queries.
- API schemas are changed in `packages/contracts`; generated clients are never edited manually.
- Shared abstractions for auth, jobs, activity, provider credentials, and storage must not be duplicated.
- Each agent rebases/updates after an integration checkpoint, not continuously during active work.
- Cross-cutting changes require the owning agent's review.
- Provider adapters are developed against fakes until the corresponding security gate passes.

### 19.3 Safe parallelism

Safe after contracts are frozen:

- UI components and backend domain services using agreed OpenAPI mocks.
- Auth implementation and app-shell implementation.
- Core record modules with separate route/service files.
- Search projection and backup export after record projection contracts exist.
- Google and Linear adapters after event/follow-up state machines exist.
- LinkedIn and warm-introduction features after person services stabilize.

Must remain sequential:

- Repository bootstrap before package-level work.
- Identity/domain/API contract freeze before core features.
- Core records before imports, search, workflows, and integrations.
- Privacy-gate approval before Gmail bodies are fetched.
- Workflow state machines before provider synchronization.
- Application services before MCP tools.
- Integration checkpoints before beginning the next dependent phase.

## 20. Delivery phases

### Phase 0 — Architecture and contract freeze

Parallel discovery:

- **Platform agent:** bootstrap/deployment proposal and dependency compatibility check for ARM64.
- **Schema agent:** ERD, normalization rules, import mapping, migration strategy.
- **Security agent:** threat model, auth/session design, email privacy boundary.
- **UI agent:** component inventory and responsive shell contract from `DESIGN.md`.
- **Integration agents:** Google, Gmail, Linear, MCP adapter contracts and provider fakes.

Sequential closeout by architecture lead:

- [ ] Record confirmed decisions as ADRs.
- [ ] Freeze identity, actor, record, activity, API, job, privacy, search, merge, and backup contracts.
- [ ] Publish ERD and initial OpenAPI skeleton.
- [ ] Define representative sanitized fixtures.
- [ ] Approve dependency licenses and ARM64 compatibility.

**Exit gate:** no unresolved cross-cutting contract; agents can work without inventing competing abstractions.

### Phase 1 — Executable foundation

#### Platform agent

- [ ] Create pnpm workspace and package boundaries.
- [ ] Configure TypeScript, linting, formatting, tests, and CI.
- [ ] Add API, worker, MCP, and web entry points.
- [ ] Add typed config validation, logging, health, metrics, and graceful shutdown.
- [ ] Add PostgreSQL development environment and migration runner.
- [ ] Build amd64/arm64 image.

#### Schema/domain agent

- [ ] Create workspace, user, actor, record, activity, outbox, operation, integration, and file foundations.
- [ ] Implement transaction helper and optimistic versioning.
- [ ] Implement activity writer and job outbox publisher.

#### Identity/security agent

- [ ] Bootstrap first admin.
- [ ] Login/logout and session management.
- [ ] Setup/reset/change password flows.
- [ ] Admin user lifecycle and session revocation.
- [ ] RBAC middleware and service policies.
- [ ] Credential encryption service.

#### UI foundation agent

- [ ] Implement tokens, typography, controls, dialogs, tables, status and form primitives.
- [ ] Build auth screens and protected responsive shell.
- [ ] Add navigation, header search placeholder, identity, and logout.
- [ ] Add standard loading, empty, denied, conflict, and error states.

**Checkpoint I1:** bootstrap admin → login → protected shell → attributed mutation → activity entry → deactivate user and confirm session revocation.

### Phase 2 — Shared CRM foundation

After I1, run these workstreams in parallel against frozen contracts.

#### Core CRM agent

- [ ] People, contact points, links, addresses, and categories.
- [ ] Companies and many-to-many employment relationships.
- [ ] Opportunities and stage/list/grouped views.
- [ ] Notes/meeting-note base and record attachments.
- [ ] Record list/detail/create/edit APIs and UI.
- [ ] Chronological timelines.

#### Admin agent

- [ ] User list, add, rename, email change, role toggle.
- [ ] Deactivate/reactivate and reset-access link generation.
- [ ] Workspace timezone/currency defaults.
- [ ] Integration/settings shell.

#### Data-quality agent

- [ ] Staged initial CSV import with dry run and report.
- [ ] Legacy actor mapping/review.
- [ ] Exact duplicate blockers and fuzzy candidate queue.
- [ ] Merge preview, confirmation token, transactional merge.

#### Search/backup agent

- [ ] Search projection and index jobs.
- [ ] Header suggestions and full search page.
- [ ] Versioned logical backup export, checksums, progress, download, expiry.

**Checkpoint I2:** import all sample CSVs → review unresolved notes/duplicates → merge candidate → search records/content → download checksum-valid backup → verify attribution for every mutation.

### Phase 3 — Meetings, follow-ups, and Linear

Sequential prerequisite by workflow/schema owners:

- [ ] Freeze event, attendee review, meeting-note, follow-up, reminder, and Linear link state machines.

Parallel work:

#### Workflow agent

- [ ] Local/manual events and relationships.
- [ ] Follow-up CRUD, reminders, reassignment, completion/cancellation.
- [ ] Dashboard urgency feed.
- [ ] Meeting exclusions and attendee confirmation queue.
- [ ] Meeting-note workflow and next-step follow-up creation.

#### Google/Linear agent

- [ ] Per-user Google OAuth and encrypted credentials.
- [ ] Incremental Calendar polling, recurrence, shared-event deduplication, and cursor reset.
- [ ] Linear workspace/team/label/status settings.
- [ ] Deterministic issue creation and two-way status polling.
- [ ] Retry/conflict state and admin retry UI.

**Checkpoint I3:** replay calendar fixtures without duplicates → exclude meeting with no side effects → confirm unknown attendee → create required note and Linear issue → complete/cancel from both sides → create follow-up from note.

### Phase 4 — Gmail privacy boundary and sales workflow

This phase begins sequentially.

#### Security + Gmail agent gate

- [ ] Implement metadata-only polling and private HMAC probes.
- [ ] Prove unmatched subjects/bodies/snippets/attachments never persist.
- [ ] Implement exclusion semantics exactly as confirmed.
- [ ] Pass privacy threat-model review.

Only after that gate:

- [ ] Incremental Gmail polling and resumable all-history backfill.
- [ ] Eligibility reevaluation after person-email changes.
- [ ] Eligible thread/message storage, sanitization, matching, and shared UI.
- [ ] Search indexing for eligible content only.
- [ ] Sales tracking, deadline default/override, reply classification, and status UI.
- [ ] No-reply follow-up and Linear workflow.

**Checkpoint I4:** mixed eligible/unmatched/excluded mailbox fixture → prove private content isolation → resume interrupted full-history scan → avoid duplicate messages → track sales thread → detect reply or deadline → synchronize Linear.

### Phase 5 — Relationship development

Parallel after person and follow-up services are stable.

#### LinkedIn/data-quality agent

- [ ] Repeated CSV upload and import history.
- [ ] Stable identity/upsert behavior.
- [ ] Match, convert, leave unmatched, or ignore.
- [ ] Enrichment preview and field-level confirmation.

#### Workflow agent

- [ ] Warm-introduction chains and ordered steps.
- [ ] State transitions and current-step calculation.
- [ ] Person-page obligation prompts.
- [ ] Follow-up generation.

#### UI agent

- [ ] Pipeline interaction polish.
- [ ] Responsive navigation, tables, drawers, and forms.
- [ ] OSM-compatible location autocomplete with free-text fallback.

**Checkpoint I5:** re-import identical LinkedIn file idempotently → match/ignore/convert connections → complete a multi-step introduction → verify dashboard/person prompts and follow-ups.

### Phase 6 — MCP and release hardening

#### MCP agent

- [ ] Streamable HTTP transport behind Tailscale.
- [ ] Admin client/scopes UI and one-time credentials.
- [ ] Search/read/create/update/workflow tools through application services.
- [ ] Idempotency and optimistic version support.
- [ ] Pending confirmation for destructive requests.

#### QA/security/platform agents

- [ ] Full authorization matrix tests.
- [ ] Integration retry/dead-letter UI.
- [ ] Accessibility, keyboard, responsive, and reduced-motion review.
- [ ] Performance tests for imports, search, Gmail backfill, and backup.
- [ ] ARM64 deployment smoke test.
- [ ] Dependency/secret scans and sensitive-log review.
- [ ] Production import rehearsal and operational runbooks.

**Checkpoint I6:** run the complete functional acceptance suite in a production-like environment using restored fixtures and provider fakes.

## 21. Security gates

### S1 — Before authenticated deployment

- Password/session/reset controls complete.
- CSRF, origin checks, rate limits, RBAC, and deactivation tests pass.
- Sensitive logs are redacted.

### S2 — Before provider accounts

- OAuth state/PKCE and least-privilege scopes verified.
- Credential encryption and key-version handling tested.
- Provider polling is idempotent and bounded.

### S3 — Before Gmail body ingestion

- Privacy boundary threat model approved.
- Automated proof that ineligible content cannot reach shared storage, logs, search, MCP, or backup.
- Excluded-address behavior matches the confirmed non-veto rule.

### S4 — Before MCP

- Per-client credential/scopes, revocation, rate limits, input limits, and audit pass.
- Destructive confirmation enforcement passes.

### S5 — Before release

- No unresolved critical/high security finding.
- Backup secret-exclusion inspection passes.
- Imports and migrations pass on realistic data.
- All integration failures have a visible retry/recovery path.

## 22. Release acceptance

Release only when:

- Every requirement in `FUNCTIONAL_PLAN.md` maps to a passing automated test or documented manual check.
- Existing people, companies, company links, and notes import without silent loss.
- Deactivated users cannot authenticate while historical attribution remains.
- Merge operations preserve relationships, history, aliases, and external references.
- Search covers all required records and eligible email content.
- Backup ZIP includes all required nonsecret data, retained files, manifest, and valid checksums.
- Excluded meetings create no attendee candidates, note tasks, or Linear issues.
- Calendar, Gmail, Linear, LinkedIn, search, and job replay are idempotent.
- Ineligible Gmail content is absent from shared storage, logs, search, MCP, and backup.
- The complete Gmail history scan can pause, resume, and coexist with incremental polling.
- Sales reply/deadline handling creates and resolves CRM/Linear work correctly.
- Warm-introduction pages show the current required action.
- MCP mutations use standard authorization, validation, versioning, and visible attribution.
- UI surfaces satisfy `DESIGN.md`, keyboard navigation, responsive behavior, and reduced-motion requirements.
- ARM64 images start successfully and API/worker readiness checks pass.

## 23. Deferred work

The following are intentionally outside the first release:

- Scheduled/cron backups and off-device backup retention.
- Backup restoration UI or CLI.
- Microsoft 365, IMAP, or non-Gmail mailbox providers.
- Email sending, drafting, forwarding, or replying.
- Email attachment ingestion.
- Google Calendar write-back.
- Public webhooks or webhook relay.
- Merge undo.
- External search, Redis, Kafka, or microservices.
- Native desktop/mobile client implementation.

The versioned REST API and backup manifest must avoid blocking these later additions.
