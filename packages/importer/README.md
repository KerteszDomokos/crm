# CSV importer

Dry-run-first parser and normalizer for the legacy `person.csv`, `company.csv`,
and `note.csv` exports. It has no database or CRM write path: `createImportPlan`
returns normalized records, legacy provenance, relationships, row issues,
duplicate candidates, and a summary for review.

## Public API

Import from `@resoloon/importer` (entry point `src/index.ts`):

- `parseCsv(text)` handles quoted fields, escaped quotes, CRLF, and quoted
  multiline fields. It returns headers, row-numbered records, and shape issues;
  malformed quoting throws `CsvSyntaxError`.
- `parseJsonArrayCell(text)` safely returns `{ value, error? }`.
- `createImportPlan({ people, companies, notes }, options?)` creates a complete
  dry-run projection. Optional `existingPeople` and `existingCompanies` profiles
  mark matching legacy IDs as updates and add duplicate comparisons against
  already-imported CRM records.
- `getImportStatus(plan, entityType, legacyId)` and `asDuplicateProfile(record)`
  are convenience helpers.
- Unicode, name, email, phone, domain, URL, and similarity normalizers are also
  exported.

Legacy IDs are retained as `legacyId` and in `provenance.sourceId`; provenance
also carries source/actor metadata and the original cell values. Company/person
relationships are reconciled from both `Company Id` and `Other people Id`.
Notes always have empty relationship arrays and `UNASSIGNED_REVIEW` status.
Potential duplicates and unresolved references require review; no merge or
relationship guess is performed.

## Commands

Requires Node.js 24+ and, for typechecking, installed workspace development
dependencies. Install with `npm ci` from the repository root, then run from the
repository root:

```sh
npm test -w @resoloon/importer
npm run typecheck -w @resoloon/importer
npm run --silent import:dry-run           # reads data/{person,company,note}.csv
npm run --silent import:dry-run -- /path/to/csvs # directory containing the three files
```

Dry-run output is JSON containing aggregate counts, all row issues, and
duplicate candidates. `created` means ready for a later reviewed commit; this
package itself never creates, updates, or skips anything in a database.
