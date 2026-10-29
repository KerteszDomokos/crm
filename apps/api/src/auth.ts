import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'

export type AuthUser = {
  userId: string
  workspaceId: string
  actorId: string
  sessionId: string
  fullName: string
  email: string
  role: 'ADMIN' | 'USER'
}

export type AuthRouteOptions = {
  pool: Pool
  secureCookies: boolean
  cookieName: string
  sessionTtlDays: number
  publicOrigin: string
}

type AuthenticatedRequest = FastifyRequest & { authUser: AuthUser | null }

type CredentialRow = {
  user_id: string
  workspace_id: string
  full_name: string
  email: string
  role: 'ADMIN' | 'USER'
  state: 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
  password_hash: Buffer | null
  salt: Buffer | null
  parameters: unknown
  force_reset: boolean | null
}

type ScryptParameters = { N: number; r: number; p: number; keyLength: number }

const DEFAULT_SCRYPT: ScryptParameters = { N: 16_384, r: 8, p: 1, keyLength: 64 }
const DUMMY_SALT = Buffer.alloc(16, 0x5a)
const LOGIN_LIMIT = 20
const LOGIN_WINDOW_MS = 60_000
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
let lastRateLimitPrune = 0

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
): FastifyReply {
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .type('application/problem+json')
    .send({ type: 'about:blank', title, status, detail, instance: request.url })
}

function noStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store')
}

function parseBody<T extends object>(value: unknown): Partial<T> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Partial<T>
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function sessionCookie(request: FastifyRequest, cookieName: string): string | null {
  const header = request.headers.cookie
  if (!header) return null

  const matches: string[] = []
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 0 || segment.slice(0, separator).trim() !== cookieName) continue
    matches.push(segment.slice(separator + 1).trim())
  }
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(matches[0])) return null
  return matches[0]
}

function setSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  const secureFlag = secure ? '; Secure' : ''
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  reply.header(
    'set-cookie',
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}${secureFlag}`,
  )
}

function clearSessionCookie(reply: FastifyReply, cookieName: string, secure: boolean): void {
  const secureFlag = secure ? '; Secure' : ''
  reply.header(
    'set-cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`,
  )
}

function validOrigin(request: FastifyRequest, expectedOrigin: string): boolean {
  const origin = request.headers.origin
  if (typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.origin === expectedOrigin && parsed.origin === origin
  } catch {
    return false
  }
}

function allowMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedOrigin: string,
): boolean {
  if (validOrigin(request, expectedOrigin)) return true
  problem(request, reply, 403, 'Forbidden', 'The request origin is not allowed.')
  return false
}

function limited(request: FastifyRequest): boolean {
  const now = Date.now()
  if (now - lastRateLimitPrune > LOGIN_WINDOW_MS) {
    for (const [key, value] of loginAttempts) {
      if (value.resetAt <= now) loginAttempts.delete(key)
    }
    lastRateLimitPrune = now
  }
  if (loginAttempts.size >= 10_000) {
    const oldestKey = loginAttempts.keys().next().value
    if (oldestKey !== undefined) loginAttempts.delete(oldestKey)
  }

  const key = request.ip || request.socket.remoteAddress || 'unknown'
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return false
  }
  current.count += 1
  return current.count > LOGIN_LIMIT
}

function normalizeScryptParameters(value: unknown, fallbackKeyLength = DEFAULT_SCRYPT.keyLength): ScryptParameters {
  const parameters = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const N = parameters.N ?? parameters.cost ?? DEFAULT_SCRYPT.N
  const r = parameters.r ?? DEFAULT_SCRYPT.r
  const p = parameters.p ?? DEFAULT_SCRYPT.p
  const keyLength = parameters.keyLength ?? parameters.keylen ?? fallbackKeyLength

  if (
    !Number.isSafeInteger(N) || (N as number) < 16_384 || (N as number) > 131_072 ||
    ((N as number) & ((N as number) - 1)) !== 0 ||
    !Number.isSafeInteger(r) || (r as number) < 1 || (r as number) > 8 ||
    !Number.isSafeInteger(p) || (p as number) < 1 || (p as number) > 4 ||
    !Number.isSafeInteger(keyLength) || (keyLength as number) < 32 || (keyLength as number) > 64
  ) {
    throw new Error('Invalid scrypt parameters')
  }
  return { N: N as number, r: r as number, p: p as number, keyLength: keyLength as number }
}

function derivePassword(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  const maxmem = Math.max(64 * 1024 * 1024, 128 * parameters.N * parameters.r + 256 * parameters.r * parameters.p + 1024)
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.keyLength,
      { N: parameters.N, r: parameters.r, p: parameters.p, maxmem },
      (error, derivedKey) => error ? reject(error) : resolve(derivedKey),
    )
  })
}

async function verifyPassword(
  password: string,
  passwordHash: Buffer | Uint8Array | null,
  salt: Buffer | Uint8Array | null,
  storedParameters: unknown,
): Promise<boolean> {
  if (!passwordHash || !salt) {
    await derivePassword(password, DUMMY_SALT, DEFAULT_SCRYPT)
    return false
  }

  try {
    const expected = Buffer.from(passwordHash)
    const parameters = normalizeScryptParameters(storedParameters, expected.length)
    if (expected.length !== parameters.keyLength || expected.length < 32 || expected.length > 64) {
      await derivePassword(password, DUMMY_SALT, DEFAULT_SCRYPT)
      return false
    }
    const actual = await derivePassword(password, Buffer.from(salt), parameters)
    return timingSafeEqual(actual, expected)
  } catch {
    await derivePassword(password, DUMMY_SALT, DEFAULT_SCRYPT)
    return false
  }
}

function passwordParametersJson(parameters: ScryptParameters): string {
  return JSON.stringify({ version: 1, ...parameters })
}

function validPassword(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024) return false
  return [...value].length >= 12
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value)
}

function validUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function publicUser(user: AuthUser): { id: string; workspaceId: string; fullName: string; email: string; role: AuthUser['role'] } {
  return {
    id: user.userId,
    workspaceId: user.workspaceId,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(request as AuthenticatedRequest).authUser) {
    problem(request, reply, 401, 'Unauthorized', 'Authentication is required.')
  }
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { pool, secureCookies, cookieName, sessionTtlDays } = options
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cookieName)) throw new Error('Invalid authentication cookie name')
  if (!Number.isFinite(sessionTtlDays) || sessionTtlDays <= 0 || sessionTtlDays > 365) {
    throw new Error('sessionTtlDays must be greater than zero and no more than 365')
  }
  let expectedOrigin: string
  try {
    const parsed = new URL(options.publicOrigin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
    expectedOrigin = parsed.origin
  } catch {
    throw new Error('publicOrigin must be an absolute HTTP(S) origin')
  }

  function adminForRequest(request: FastifyRequest, reply: FastifyReply): AuthUser | null {
    const user = (request as AuthenticatedRequest).authUser
    if (!user) {
      problem(request, reply, 401, 'Unauthorized', 'Authentication is required.')
      return null
    }
    if (user.role !== 'ADMIN') {
      problem(request, reply, 403, 'Forbidden', 'Administrator access is required.')
      return null
    }
    if (request.method !== 'GET' && !validOrigin(request, expectedOrigin)) {
      problem(request, reply, 403, 'Forbidden', 'The request origin is not allowed.')
      return null
    }
    return user
  }

  function accessUrl(token: string): string {
    return `${expectedOrigin}/setup?token=${encodeURIComponent(token)}`
  }

  // Resolve the opaque cookie once per request. Only the token hash is sent to PostgreSQL.
  app.addHook('onRequest', async (request, reply) => {
    const authRequest = request as AuthenticatedRequest
    authRequest.authUser = null
    const token = sessionCookie(request, cookieName)
    if (!token) return

    try {
      const result = await pool.query<{
        user_id: string
        workspace_id: string
        actor_id: string
        session_id: string
        full_name: string
        email: string
        role: 'ADMIN' | 'USER'
      }>(
        `UPDATE sessions AS s
            SET last_used_at = statement_timestamp()
           FROM users AS u
           JOIN actors AS a
             ON a.workspace_id = u.workspace_id AND a.user_id = u.id AND a.actor_type = 'USER'
          WHERE s.token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > statement_timestamp()
            AND u.id = s.user_id
            AND u.workspace_id = s.workspace_id
            AND u.state = 'ACTIVE'
          RETURNING u.id AS user_id, u.workspace_id, a.id AS actor_id, s.id AS session_id,
                    u.full_name, u.email, u.role`,
        [sha256(token)],
      )
      const row = result.rows[0]
      if (row) {
        authRequest.authUser = {
          userId: row.user_id,
          workspaceId: row.workspace_id,
          actorId: row.actor_id,
          sessionId: row.session_id,
          fullName: row.full_name,
          email: row.email,
          role: row.role,
        }
      }
    } catch {
      problem(request, reply, 503, 'Service Unavailable', 'Authentication is temporarily unavailable.')
    }
  })

  app.post('/api/v1/auth/login', async (request, reply) => {
    noStore(reply)
    if (!allowMutation(request, reply, expectedOrigin)) return
    if (limited(request)) {
      reply.header('retry-after', '60')
      return problem(request, reply, 429, 'Too Many Requests', 'Please wait before trying again.')
    }

    const body = parseBody<{ email: string; password: string }>(request.body)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email) || !password || Buffer.byteLength(password, 'utf8') > 1024) {
      return problem(request, reply, 400, 'Bad Request', 'A valid email and password are required.')
    }

    try {
      const found = await pool.query<CredentialRow>(
        `SELECT u.id AS user_id, u.workspace_id, u.full_name, u.email, u.role, u.state,
                pc.password_hash, pc.salt, pc.parameters, pc.force_reset
           FROM users AS u
           LEFT JOIN password_credentials AS pc
             ON pc.workspace_id = u.workspace_id AND pc.user_id = u.id
          WHERE u.email_normalized = $1
          LIMIT 2`,
        [email],
      )
      // The schema is unique per workspace. With an email-only login contract, reject
      // ambiguous addresses rather than selecting a user from an arbitrary workspace.
      const candidate = found.rows.length === 1 ? found.rows[0] : undefined
      const candidateValid = candidate
        ? await verifyPassword(password, candidate.password_hash, candidate.salt, candidate.parameters)
        : await verifyPassword(password, null, null, null)

      if (!candidate || candidate.state !== 'ACTIVE' || !candidateValid) {
        return problem(request, reply, 401, 'Unauthorized', 'The email or password is incorrect.')
      }

      const rawToken = randomBytes(32).toString('base64url')
      const tokenHash = sha256(rawToken)
      const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000)
      const priorToken = sessionCookie(request, cookieName)
      const user = await inTransaction(pool, async (client) => {
        const locked = await client.query<CredentialRow>(
          `SELECT u.id AS user_id, u.workspace_id, u.full_name, u.email, u.role, u.state,
                  pc.password_hash, pc.salt, pc.parameters, pc.force_reset
             FROM users AS u
             JOIN password_credentials AS pc
               ON pc.workspace_id = u.workspace_id AND pc.user_id = u.id
            WHERE u.id = $1 AND u.workspace_id = $2
            FOR UPDATE OF u, pc`,
          [candidate.user_id, candidate.workspace_id],
        )
        const current = locked.rows[0]
        if (!current || current.state !== 'ACTIVE' || !(await verifyPassword(password, current.password_hash, current.salt, current.parameters))) {
          return null
        }

        await client.query(
          `INSERT INTO actors (workspace_id, actor_type, user_id, display_name)
           VALUES ($1, 'USER', $2, $3)
           ON CONFLICT (workspace_id, user_id) WHERE actor_type = 'USER' DO NOTHING`,
          [current.workspace_id, current.user_id, current.full_name],
        )
        const actorResult = await client.query<{ id: string }>(
          `SELECT id FROM actors WHERE workspace_id = $1 AND user_id = $2 AND actor_type = 'USER'`,
          [current.workspace_id, current.user_id],
        )
        const actorId = actorResult.rows[0]?.id
        if (!actorId) throw new Error('Unable to establish user actor')

        if (priorToken) {
          await client.query(
            `UPDATE sessions SET revoked_at = COALESCE(revoked_at, statement_timestamp())
              WHERE token_hash = $1 AND revoked_at IS NULL`,
            [sha256(priorToken)],
          )
        }
        const sessionResult = await client.query<{ id: string }>(
          `INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at, user_agent)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [current.workspace_id, current.user_id, tokenHash, expiresAt, typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 512) : null],
        )
        return {
          userId: current.user_id,
          workspaceId: current.workspace_id,
          actorId,
          sessionId: sessionResult.rows[0].id,
          fullName: current.full_name,
          email: current.email,
          role: current.role,
        } satisfies AuthUser
      })

      if (!user) return problem(request, reply, 401, 'Unauthorized', 'The email or password is incorrect.')
      setSessionCookie(reply, cookieName, rawToken, expiresAt, secureCookies)
      return reply.code(200).send({ user: publicUser(user) })
    } catch {
      return problem(request, reply, 503, 'Service Unavailable', 'Authentication is temporarily unavailable.')
    }
  })

  app.post('/api/v1/auth/setup', async (request, reply) => {
    noStore(reply)
    if (!allowMutation(request, reply, expectedOrigin)) return

    const body = parseBody<{ token: string; password: string }>(request.body)
    if (
      typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token) ||
      !validPassword(body.password)
    ) {
      return problem(request, reply, 400, 'Bad Request', 'A valid access token and password of at least 12 characters are required.')
    }

    const password = body.password
    const tokenHash = sha256(body.token)
    const salt = randomBytes(16)
    const parameters = DEFAULT_SCRYPT
    const rawSessionToken = randomBytes(32).toString('base64url')
    const sessionTokenHash = sha256(rawSessionToken)
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000)

    try {
      const passwordHash = await derivePassword(password, salt, parameters)
      const user = await inTransaction(pool, async (client) => {
        const tokenCandidate = await client.query<{ user_id: string; workspace_id: string }>(
          `SELECT user_id, workspace_id FROM account_tokens WHERE token_hash = $1`,
          [tokenHash],
        )
        const candidate = tokenCandidate.rows[0]
        if (!candidate) return null

        // Lock the account before its token rows so concurrent setup/reset attempts
        // serialize without deadlocking while consuming all of the user's tokens.
        const lockedUser = await client.query<{
          user_id: string
          workspace_id: string
          full_name: string
          email: string
          role: 'ADMIN' | 'USER'
          state: 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
        }>(
          `SELECT id AS user_id, workspace_id, full_name, email, role, state
             FROM users WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [candidate.user_id, candidate.workspace_id],
        )
        const current = lockedUser.rows[0]
        if (!current || current.state === 'DEACTIVATED') return null

        const validToken = await client.query<{ id: string }>(
          `SELECT id FROM account_tokens
            WHERE token_hash = $1 AND user_id = $2 AND workspace_id = $3
              AND purpose IN ('SETUP', 'PASSWORD_RESET')
              AND consumed_at IS NULL AND expires_at > statement_timestamp()
            FOR UPDATE`,
          [tokenHash, current.user_id, current.workspace_id],
        )
        if (!validToken.rowCount) return null

        await client.query(
          `UPDATE account_tokens SET consumed_at = statement_timestamp()
            WHERE workspace_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
          [current.workspace_id, current.user_id],
        )
        await client.query(
          `INSERT INTO password_credentials
             (workspace_id, user_id, algorithm, password_hash, salt, parameters, force_reset, updated_at)
           VALUES ($1, $2, 'scrypt', $3, $4, $5::jsonb, false, statement_timestamp())
           ON CONFLICT (user_id) DO UPDATE
             SET workspace_id = EXCLUDED.workspace_id, algorithm = EXCLUDED.algorithm,
                 password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt,
                 parameters = EXCLUDED.parameters, force_reset = false,
                 updated_at = statement_timestamp()`,
          [current.workspace_id, current.user_id, passwordHash, salt, passwordParametersJson(parameters)],
        )
        await client.query(
          `UPDATE users SET state = 'ACTIVE', updated_at = statement_timestamp()
            WHERE id = $1 AND workspace_id = $2`,
          [current.user_id, current.workspace_id],
        )
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, statement_timestamp())
            WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [current.workspace_id, current.user_id],
        )
        await client.query(
          `INSERT INTO actors (workspace_id, actor_type, user_id, display_name)
           VALUES ($1, 'USER', $2, $3)
           ON CONFLICT (workspace_id, user_id) WHERE actor_type = 'USER' DO NOTHING`,
          [current.workspace_id, current.user_id, current.full_name],
        )
        const actor = await client.query<{ id: string }>(
          `SELECT id FROM actors WHERE workspace_id = $1 AND user_id = $2 AND actor_type = 'USER'`,
          [current.workspace_id, current.user_id],
        )
        const actorId = actor.rows[0]?.id
        if (!actorId) throw new Error('Unable to establish user actor')

        const session = await client.query<{ id: string }>(
          `INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at, user_agent)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [current.workspace_id, current.user_id, sessionTokenHash, expiresAt,
            typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 512) : null],
        )
        return {
          userId: current.user_id,
          workspaceId: current.workspace_id,
          actorId,
          sessionId: session.rows[0].id,
          fullName: current.full_name,
          email: current.email,
          role: current.role,
        } satisfies AuthUser
      })

      if (!user) return problem(request, reply, 400, 'Bad Request', 'The access link is invalid or expired.')
      setSessionCookie(reply, cookieName, rawSessionToken, expiresAt, secureCookies)
      return reply.code(200).send({ user: publicUser(user) })
    } catch {
      return problem(request, reply, 503, 'Service Unavailable', 'Account setup is temporarily unavailable.')
    }
  })

  app.get('/api/v1/admin/users', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    const admin = adminForRequest(request, reply)
    if (!admin) return
    try {
      const result = await pool.query<{
        id: string
        full_name: string
        email: string
        role: 'ADMIN' | 'USER'
        state: 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
        created_at: Date
        updated_at: Date
      }>(
        `SELECT id, full_name, email, role, state, created_at, updated_at
           FROM users WHERE workspace_id = $1 ORDER BY created_at, id`,
        [admin.workspaceId],
      )
      return reply.send({ users: result.rows.map((user) => ({
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        state: user.state,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      })) })
    } catch {
      return problem(request, reply, 503, 'Service Unavailable', 'The user list is temporarily unavailable.')
    }
  })

  app.post('/api/v1/admin/users', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    const admin = adminForRequest(request, reply)
    if (!admin) return

    const body = parseBody<{ fullName: string; email: string; role?: 'ADMIN' | 'USER' }>(request.body)
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = body?.role ?? 'USER'
    if (
      !fullName || fullName.length > 200 || !validEmail(email) ||
      (role !== 'ADMIN' && role !== 'USER')
    ) {
      return problem(request, reply, 400, 'Bad Request', 'A valid full name, email, and optional role are required.')
    }

    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = sha256(rawToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    try {
      const user = await inTransaction(pool, async (client) => {
        await client.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [admin.workspaceId])
        const created = await client.query<{
          id: string
          workspace_id: string
          full_name: string
          email: string
          role: 'ADMIN' | 'USER'
          state: 'SETUP_REQUIRED'
        }>(
          `INSERT INTO users (workspace_id, full_name, email, role, state)
           VALUES ($1, $2, $3, $4, 'SETUP_REQUIRED')
           RETURNING id, workspace_id, full_name, email, role, state`,
          [admin.workspaceId, fullName, email, role],
        )
        const newUser = created.rows[0]
        await client.query(
          `INSERT INTO account_tokens (workspace_id, user_id, purpose, token_hash, created_by_actor_id, expires_at)
           VALUES ($1, $2, 'SETUP', $3, $4, $5)`,
          [admin.workspaceId, newUser.id, tokenHash, admin.actorId, expiresAt],
        )
        return newUser
      })
      return reply.code(201).send({
        user: {
          id: user.id,
          workspaceId: user.workspace_id,
          fullName: user.full_name,
          email: user.email,
          role: user.role,
          state: user.state,
        },
        setupUrl: accessUrl(rawToken),
      })
    } catch (error) {
      if ((error as { code?: unknown })?.code === '23505') {
        return problem(request, reply, 409, 'Conflict', 'A user with that email already exists in this workspace.')
      }
      return problem(request, reply, 503, 'Service Unavailable', 'The user could not be created right now.')
    }
  })

  app.patch('/api/v1/admin/users/:id', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    const admin = adminForRequest(request, reply)
    if (!admin) return
    const id = (request.params as { id?: unknown }).id
    if (!validUserId(id)) return problem(request, reply, 400, 'Bad Request', 'A valid user ID is required.')

    const body = parseBody<{
      fullName?: string
      email?: string
      role?: 'ADMIN' | 'USER'
      state?: 'ACTIVE' | 'DEACTIVATED'
    }>(request.body)
    const updates: Array<{ column: string; value: string }> = []
    if (body && Object.hasOwn(body, 'fullName')) {
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
      if (!fullName || fullName.length > 200) return problem(request, reply, 400, 'Bad Request', 'The full name is invalid.')
      updates.push({ column: 'full_name', value: fullName })
    }
    if (body && Object.hasOwn(body, 'email')) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!validEmail(email)) return problem(request, reply, 400, 'Bad Request', 'The email is invalid.')
      updates.push({ column: 'email', value: email })
    }
    if (body && Object.hasOwn(body, 'role')) {
      if (body.role !== 'ADMIN' && body.role !== 'USER') return problem(request, reply, 400, 'Bad Request', 'The role is invalid.')
      updates.push({ column: 'role', value: body.role })
    }
    if (body && Object.hasOwn(body, 'state')) {
      if (body.state !== 'ACTIVE' && body.state !== 'DEACTIVATED') {
        return problem(request, reply, 400, 'Bad Request', 'The state is invalid.')
      }
      if (body.state === 'DEACTIVATED' && id === admin.userId) {
        return problem(request, reply, 400, 'Bad Request', 'You cannot deactivate your own account.')
      }
      updates.push({ column: 'state', value: body.state })
    }
    if (updates.length === 0) return problem(request, reply, 400, 'Bad Request', 'At least one supported user field is required.')

    try {
      const user = await inTransaction(pool, async (client) => {
        await client.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [admin.workspaceId])
        const locked = await client.query<{
          id: string
          full_name: string
          email: string
          role: 'ADMIN' | 'USER'
          state: 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
        }>(
          `SELECT id, full_name, email, role, state FROM users
            WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [id, admin.workspaceId],
        )
        const target = locked.rows[0]
        if (!target) return { kind: 'missing' as const }

        const nextRole = updates.find((field) => field.column === 'role')?.value ?? target.role
        const nextState = updates.find((field) => field.column === 'state')?.value ?? target.state
        if (
          target.role === 'ADMIN' && target.state === 'ACTIVE' &&
          (nextRole !== 'ADMIN' || nextState !== 'ACTIVE')
        ) {
          const activeAdmins = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM users
              WHERE workspace_id = $1 AND role = 'ADMIN' AND state = 'ACTIVE' AND id <> $2`,
            [admin.workspaceId, id],
          )
          if (Number(activeAdmins.rows[0]?.count ?? 0) === 0) return { kind: 'last_admin' as const }
        }

        const values: unknown[] = []
        const assignments = updates.map((field) => {
          values.push(field.value)
          return `${field.column} = $${values.length}`
        })
        values.push(id, admin.workspaceId)
        const updated = await client.query<{
          id: string
          workspace_id: string
          full_name: string
          email: string
          role: 'ADMIN' | 'USER'
          state: 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
        }>(
          `UPDATE users SET ${assignments.join(', ')}, updated_at = statement_timestamp()
            WHERE id = $${values.length - 1} AND workspace_id = $${values.length}
            RETURNING id, workspace_id, full_name, email, role, state`,
          values,
        )
        if (nextState === 'DEACTIVATED') {
          await client.query(
            `UPDATE sessions SET revoked_at = COALESCE(revoked_at, statement_timestamp())
              WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
            [admin.workspaceId, id],
          )
        }
        return { kind: 'updated' as const, user: updated.rows[0] }
      })
      if (user.kind === 'missing') return problem(request, reply, 404, 'Not Found', 'The user was not found.')
      if (user.kind === 'last_admin') return problem(request, reply, 409, 'Conflict', 'The last active administrator cannot be demoted or deactivated.')
      return reply.send({ user: {
        id: user.user.id,
        workspaceId: user.user.workspace_id,
        fullName: user.user.full_name,
        email: user.user.email,
        role: user.user.role,
        state: user.user.state,
      } })
    } catch (error) {
      if ((error as { code?: unknown })?.code === '23505') {
        return problem(request, reply, 409, 'Conflict', 'A user with that email already exists in this workspace.')
      }
      return problem(request, reply, 503, 'Service Unavailable', 'The user could not be updated right now.')
    }
  })

  app.post('/api/v1/admin/users/:id/reset-access', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    const admin = adminForRequest(request, reply)
    if (!admin) return
    const id = (request.params as { id?: unknown }).id
    if (!validUserId(id)) return problem(request, reply, 400, 'Bad Request', 'A valid user ID is required.')

    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = sha256(rawToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    try {
      const issued = await inTransaction(pool, async (client) => {
        await client.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [admin.workspaceId])
        const target = await client.query<{ id: string; state: string }>(
          `SELECT id, state FROM users WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [id, admin.workspaceId],
        )
        const user = target.rows[0]
        if (!user || user.state === 'DEACTIVATED') return false
        await client.query(
          `UPDATE account_tokens SET consumed_at = statement_timestamp()
            WHERE workspace_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
          [admin.workspaceId, id],
        )
        await client.query(
          `INSERT INTO account_tokens (workspace_id, user_id, purpose, token_hash, created_by_actor_id, expires_at)
           VALUES ($1, $2, 'PASSWORD_RESET', $3, $4, $5)`,
          [admin.workspaceId, id, tokenHash, admin.actorId, expiresAt],
        )
        return true
      })
      if (!issued) return problem(request, reply, 404, 'Not Found', 'The user was not found or is unavailable.')
      return reply.send({ resetUrl: accessUrl(rawToken) })
    } catch {
      return problem(request, reply, 503, 'Service Unavailable', 'The access link could not be issued right now.')
    }
  })

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    return reply.send({ user: publicUser((request as AuthenticatedRequest).authUser!) })
  })

  app.post('/api/v1/auth/logout', async (request, reply) => {
    noStore(reply)
    if (!allowMutation(request, reply, expectedOrigin)) return
    const token = sessionCookie(request, cookieName)
    try {
      if (token) {
        await pool.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, statement_timestamp())
            WHERE token_hash = $1 AND revoked_at IS NULL`,
          [sha256(token)],
        )
      }
      clearSessionCookie(reply, cookieName, secureCookies)
      return reply.code(200).send({ ok: true })
    } catch {
      return problem(request, reply, 503, 'Service Unavailable', 'The session could not be ended right now.')
    }
  })

  app.post('/api/v1/auth/password', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    if (!allowMutation(request, reply, expectedOrigin)) return
    const body = parseBody<{ currentPassword: string; newPassword: string }>(request.body)
    if (
      typeof body?.currentPassword !== 'string' || !body.currentPassword ||
      Buffer.byteLength(body.currentPassword, 'utf8') > 1024 || !validPassword(body.newPassword)
    ) {
      return problem(request, reply, 400, 'Bad Request', 'Provide the current password and a new password of at least 12 characters.')
    }

    const authUser = (request as AuthenticatedRequest).authUser!
    const parameters = DEFAULT_SCRYPT
    const salt = randomBytes(16)
    const token = randomBytes(32).toString('base64url')
    const tokenHash = sha256(token)
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000)

    try {
      const newHash = await derivePassword(body.newPassword, salt, parameters)
      const changed = await inTransaction(pool, async (client) => {
        const locked = await client.query<CredentialRow>(
          `SELECT u.id AS user_id, u.workspace_id, u.full_name, u.email, u.role, u.state,
                  pc.password_hash, pc.salt, pc.parameters, pc.force_reset
             FROM users AS u
             JOIN password_credentials AS pc
               ON pc.workspace_id = u.workspace_id AND pc.user_id = u.id
            WHERE u.id = $1 AND u.workspace_id = $2
            FOR UPDATE OF u, pc`,
          [authUser.userId, authUser.workspaceId],
        )
        const current = locked.rows[0]
        if (!current || current.state !== 'ACTIVE' || !(await verifyPassword(body.currentPassword as string, current.password_hash, current.salt, current.parameters))) {
          return false
        }
        const currentSession = await client.query(
          `SELECT id FROM sessions
            WHERE id = $1 AND workspace_id = $2 AND user_id = $3
              AND revoked_at IS NULL AND expires_at > statement_timestamp()
            FOR UPDATE`,
          [authUser.sessionId, authUser.workspaceId, authUser.userId],
        )
        if (!currentSession.rowCount) return false

        await client.query(
          `UPDATE password_credentials
              SET password_hash = $1, salt = $2, parameters = $3::jsonb,
                  force_reset = false, updated_at = statement_timestamp()
            WHERE workspace_id = $4 AND user_id = $5`,
          [newHash, salt, passwordParametersJson(parameters), authUser.workspaceId, authUser.userId],
        )
        const session = await client.query<{ id: string }>(
          `INSERT INTO sessions (workspace_id, user_id, token_hash, expires_at, user_agent)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [authUser.workspaceId, authUser.userId, tokenHash, expiresAt, typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 512) : null],
        )
        return session.rows[0]?.id ?? false
      })

      if (!changed) return problem(request, reply, 401, 'Unauthorized', 'The current password is incorrect or the session is no longer valid.')
      setSessionCookie(reply, cookieName, token, expiresAt, secureCookies)
      return reply.code(200).send({ ok: true })
    } catch {
      return problem(request, reply, 503, 'Service Unavailable', 'The password could not be changed right now.')
    }
  })
}
