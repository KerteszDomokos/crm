# Resoloon CRM

Resoloon's shared CRM is a TypeScript monorepo with a React web client, Fastify API, PostgreSQL schema, and a dry-run-first legacy CSV importer.

## Local development

Requirements: Node.js 24+ and PostgreSQL 17. The application does not bundle the CSV source data into a production image.

For a containerized local stack, use `docker compose up --build -d`; it starts
PostgreSQL, applies migrations, and serves the web app/API on port 3000. Then
create the first admin with
`docker compose exec -e ADMIN_NAME="CRM Admin" -e ADMIN_EMAIL="admin@example.com" app npm run bootstrap:admin`.

```sh
npm install
createdb resoloon
cp .env.example .env
```

Set `DATABASE_URL` in `.env`. For local Vite development, set
`PUBLIC_ORIGIN=http://localhost:5173` (the browser calls the API through Vite's
same-origin proxy). Then run:

```sh
npm run migrate
ADMIN_NAME="CRM Admin" ADMIN_EMAIL="admin@example.com" npm run bootstrap:admin
npm run dev
```

The bootstrap command prints a single-use setup link. Open it in the browser,
set an initial password, then sign in. The API listens on port 3000 and Vite on
port 5173. With `npm run build` completed, the API serves `apps/web/dist` from
the same origin.

## Legacy data

The importer reads `data/person.csv`, `data/company.csv`, and `data/note.csv`.
It defaults to a write-free dry run:

```sh
npm run import:dry-run
npm run import:legacy -- --commit
```

The commit command stores row-level source/provenance and stages duplicates or
unresolved notes for review; it imports only safe rows and relationship edges
between imported records. Set `CSV_DIR` and (for multi-workspace databases)
`WORKSPACE_ID` to override the defaults. A source hash makes repeated imports
idempotent.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The container image is ARM64/AMD64-compatible. To publish a multi-platform
image, build it with Buildx for `linux/amd64,linux/arm64`.

## Current implementation boundary

The current executable slice includes account bootstrap/login/setup, admin user
lifecycle, shared people/companies/opportunities/notes CRUD, relationship links,
activity attribution, search/dashboard, safe legacy CSV import, local events,
meeting-note state, follow-ups, and warm-introduction chains. Google Calendar,
Gmail privacy-gated ingestion, Linear synchronization, LinkedIn matching, full
text-search projections, versioned backup ZIPs, MCP transport, worker/job
runtime, and operational metrics remain follow-on implementation; the database
foundation does not imply those integrations are active.
