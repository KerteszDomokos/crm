import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const fullName = process.env.ADMIN_NAME?.trim()
const workspaceName = process.env.WORKSPACE_NAME?.trim() || 'Resoloon CRM'
const publicOrigin = process.env.PUBLIC_ORIGIN?.trim()

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL must be set.')
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Set ADMIN_EMAIL to a valid email address.')
if (!fullName || fullName.length > 200) fail('Set ADMIN_NAME to the administrator name (max 200 characters).')
if (!publicOrigin) fail('PUBLIC_ORIGIN must be set to the browser-visible CRM origin.')

let origin: string
try {
  const parsed = new URL(publicOrigin)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
  origin = parsed.origin
} catch {
  fail('PUBLIC_ORIGIN must be an absolute HTTP(S) origin.')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'resoloon-bootstrap' })
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest()
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1_380_928_333, 2])

    let workspace = await client.query<{ id: string }>('SELECT id FROM workspaces ORDER BY created_at LIMIT 1 FOR UPDATE')
    let workspaceId = workspace.rows[0]?.id
    if (!workspaceId) {
      const createdWorkspace = await client.query<{ id: string }>(
        'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
        [workspaceName],
      )
      workspaceId = createdWorkspace.rows[0].id
    }

    const existing = await client.query<{ id: string; state: string }>(
      'SELECT id, state FROM users WHERE workspace_id = $1 ORDER BY created_at LIMIT 1',
      [workspaceId],
    )
    if (existing.rowCount) {
      throw new Error(`Workspace already contains users; bootstrap is only allowed for an empty workspace (found ${existing.rows[0].state}).`)
    }

    const user = await client.query<{ id: string }>(
      `INSERT INTO users (workspace_id, full_name, email, role, state)
       VALUES ($1, $2, $3, 'ADMIN', 'SETUP_REQUIRED') RETURNING id`,
      [workspaceId, fullName, email],
    )
    await client.query(
      `INSERT INTO account_tokens (workspace_id, user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, 'SETUP', $3, $4)`,
      [workspaceId, user.rows[0].id, tokenHash, expiresAt],
    )
    await client.query('COMMIT')

    const setupUrl = new URL('/setup', `${origin}/`)
    setupUrl.searchParams.set('token', token)
    console.log('Initial administrator created. Share this one-time setup link securely; it will not be shown again:')
    console.log(setupUrl.toString())
    console.log(`Link expires: ${expiresAt.toISOString()}`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
} catch (error) {
  console.error('Initial administrator bootstrap failed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
} finally {
  await pool.end()
}
