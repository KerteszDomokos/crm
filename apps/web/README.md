# Resoloon CRM web

React 19 + TypeScript + Vite frontend. It is intentionally self-contained under
`apps/web/`; the API origin/path can be changed with `VITE_API_ROOT` (defaults to
`/api/v1`). Requests include same-origin credentials for cookie sessions.

## Development

From the repository root, install once with `npm ci`, then run `npm run dev:web`,
`npm run typecheck -w @resoloon/web`, or `npm run build -w @resoloon/web`.

## REST contract used by the frontend

All API requests are rooted at `/api/v1`, use JSON with camelCase fields, and
assume authenticated cookie sessions. Responses may be direct values or wrapped
in `{ "data": ... }`. Collection responses may be arrays or
`{ "items": [...], "nextCursor": "..." }` / `{ "data": [...] }`.
Errors should follow RFC 9457 (`detail`/`title`); the UI also handles ordinary
HTTP errors and network failures.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/auth/me` | Current user: `fullName`, `email`, `role` |
| POST | `/auth/logout` | End the current session |
| GET | `/people?limit=50&q=...` | People collection |
| POST | `/people` | Create with `fullName`, `jobTitle`, `email`, `phone`, `city` |
| GET | `/people/{id}` | Person detail |
| PATCH | `/people/{id}` | Partially update a person |
| GET | `/companies?limit=50&q=...` | Company collection |
| POST | `/companies` | Create with `name`, `domain`, `description` |
| GET | `/companies/{id}` | Company detail |
| PATCH | `/companies/{id}` | Partially update a company |
| GET | `/opportunities?limit=50&q=...` | Opportunity collection |
| POST | `/opportunities` | Create with `name`, `stage`, `value`, `currency`, `expectedCloseDate`, `nextAction` |
| GET | `/opportunities/{id}` | Opportunity detail |
| PATCH | `/opportunities/{id}` | Partially update an opportunity |
| GET | `/notes?limit=50&q=...` | Notes and meeting notes collection |
| POST | `/notes` | Create with `title`, `noteType`, `bodyMarkdown` |
| GET | `/notes/{id}` | Note detail |
| PATCH | `/notes/{id}` | Partially update a note |
| GET | `/search?q=...&limit=8` | Global search; accepts flat results or grouped results by record type |
| GET | `/dashboard` | Summary metrics, action items, and recent activity |

Create responses should return the saved record (or `{ "data": record }`).
Dashboard fields are `summary` (`people`, `companies`, `opportunities`,
`openFollowUps`), `actionItems`, and `recentActivity`. Collection fields follow
the `packages/db/src/types.ts` model where available. Missing API data is shown
as an empty state; no sample CRM records are bundled in the frontend.
