import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'

import type { Database } from './types.js'

const { Pool } = pg
const LOCK_CLASS_ID = 1_380_928_333
const LOCK_OBJECT_ID = 1
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

interface AppliedMigration {
  filename: string
  sha256: string
}

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set')
  }

  const pool = new Pool({ connectionString, max: 1 })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  let lockAcquired = false

  try {
    await db.connection().execute(async (connection) => {
      await sql.raw(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          filename text PRIMARY KEY,
          sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `).execute(connection)

      await sql`SELECT pg_advisory_lock(${LOCK_CLASS_ID}, ${LOCK_OBJECT_ID})`.execute(connection)
      lockAcquired = true

      const { rows: appliedRows } = await sql<AppliedMigration>`
        SELECT filename, sha256 FROM public.schema_migrations
      `.execute(connection)
      const applied = new Map(appliedRows.map(({ filename, sha256 }) => [filename, sha256]))

      const filenames = (await readdir(migrationsDirectory))
        .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename))
        .sort()

      for (const filename of filenames) {
        const contents = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8')
        const checksum = createHash('sha256').update(contents).digest('hex')
        const previousChecksum = applied.get(filename)

        if (previousChecksum) {
          if (previousChecksum !== checksum) {
            throw new Error(`Applied migration ${filename} has changed; add a new migration instead`)
          }
          continue
        }

        await connection.transaction().execute(async (transaction) => {
          await sql.raw(contents).execute(transaction)
          await sql`
            INSERT INTO public.schema_migrations (filename, sha256)
            VALUES (${filename}, ${checksum})
          `.execute(transaction)
        })
        console.info(`Applied database migration ${filename}`)
      }
    })
  } finally {
    if (lockAcquired) {
      await sql`SELECT pg_advisory_unlock(${LOCK_CLASS_ID}, ${LOCK_OBJECT_ID})`.execute(db)
    }
    await db.destroy()
  }
}

migrate().catch((error: unknown) => {
  console.error('Database migration failed:', error)
  process.exitCode = 1
})
