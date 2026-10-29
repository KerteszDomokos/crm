import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { requireAuth, type AuthUser } from './auth.js'

type CrmOptions = { pool: Pool }
type AuthenticatedRequest = FastifyRequest & { authUser: AuthUser }
type JsonObject = Record<string, unknown>
type RecordType = 'PERSON' | 'COMPANY' | 'OPPORTUNITY' | 'NOTE'

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly title = statusTitle(status),
    readonly extensions: JsonObject = {},
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

function statusTitle(status: number): string {
  return ({ 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict' } as Record<number, string>)[status]
    ?? 'Internal Server Error'
}

function sendProblem(reply: FastifyReply, error: unknown) {
  let status = 500
  let title = 'Internal Server Error'
  let detail = 'The request could not be completed.'
  let extensions: JsonObject = {}

  if (error instanceof HttpError) {
    status = error.status
    title = error.title
    detail = error.message
    extensions = error.extensions
  } else if (isPgError(error)) {
    if (error.code === '23505' || error.code === '40001') {
      status = 409
      title = 'Conflict'
      detail = 'The record conflicts with existing data or has changed. Refresh and try again.'
    } else if (error.code === '23503' || error.code === '23514' || error.code === '22P02' || error.code === '22007' || error.code === '22008' || error.code === '22003') {
      status = 400
      title = 'Bad Request'
      detail = 'One or more supplied values are invalid.'
    }
  }

  return reply
    .code(status)
    .type('application/problem+json')
    .send({
      type: `about:blank`,
      title,
      status,
      detail,
      ...(extensions ?? {}),
    })
}

function isPgError(error: unknown): error is { code: string; constraint?: string } {
  return !!error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
}

type CrmHandler = (request: FastifyRequest, reply: FastifyReply, user: AuthUser) => Promise<unknown>

function protectedHandler(handler: CrmHandler) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as AuthenticatedRequest).authUser
      if (!user?.workspaceId || !user.actorId || !user.userId) {
        throw new HttpError(401, 'Authentication is required.')
      }
      return await handler(request, reply, user)
    } catch (error) {
      return sendProblem(reply, error)
    }
  }
}

function objectBody(request: FastifyRequest): JsonObject {
  const body = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object.')
  }
  return body as JsonObject
}

function queryObject(request: FastifyRequest): JsonObject {
  return (request.query && typeof request.query === 'object' ? request.query : {}) as JsonObject
}

function rejectUnknown(body: JsonObject, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new HttpError(400, `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`)
}

function has(body: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function text(value: unknown, field: string, options: { required?: boolean; nullable?: boolean; max?: number } = {}): string | null {
  if (value === null && options.nullable) return null
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be ${options.nullable ? 'a string or null' : 'a string'}.`)
  const result = value.trim()
  if (!result && options.required) throw new HttpError(400, `${field} is required.`)
  if (result.length > (options.max ?? 10_000)) throw new HttpError(400, `${field} is too long.`)
  return result || (options.nullable ? null : '')
}

function optionalText(body: JsonObject, key: string, label = key, max = 10_000): string | null {
  return text(body[key], label, { nullable: true, max })
}

function requiredText(body: JsonObject, key: string, label = key, max = 500): string {
  return text(body[key], label, { required: true, max }) as string
}

function uuid(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `${field} must be a UUID${nullable ? ' or null' : ''}.`)
  }
  return value
}

function optionalUuid(body: JsonObject, key: string, label = key): string | null {
  return uuid(body[key], label, true)
}

function numberValue(value: unknown, field: string, options: { min?: number; max?: number; integer?: boolean; nullable?: boolean } = {}): number | null {
  if (value === null && options.nullable) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${field} must be a number${options.nullable ? ' or null' : ''}.`)
  if (options.integer && !Number.isInteger(value)) throw new HttpError(400, `${field} must be an integer.`)
  if (options.min !== undefined && value < options.min) throw new HttpError(400, `${field} must be at least ${options.min}.`)
  if (options.max !== undefined && value > options.max) throw new HttpError(400, `${field} must be at most ${options.max}.`)
  return value
}

function isoDate(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${field} must be an ISO date${nullable ? ' or null' : ''}.`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${field} must be a valid calendar date.`)
  return value
}

function isoTimestamp(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be an ISO 8601 timestamp${nullable ? ' or null' : ''}.`)
  }
  return new Date(value).toISOString()
}

function emailAddress(value: unknown): { raw: string; normalized: string } | null {
  if (value === null) return null
  const raw = text(value, 'email', { required: true, max: 320 }) as string
  const at = raw.lastIndexOf('@')
  const normalized = `${raw.slice(0, at)}@${raw.slice(at + 1).toLowerCase()}`
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'email must be a valid email address.')
  return { raw, normalized }
}

function normalizedDomain(value: unknown): { raw: string; normalized: string } | null {
  if (value === null) return null
  const raw = text(value, 'domain', { required: true, max: 253 }) as string
  let hostname: string
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid')
    hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  } catch {
    throw new HttpError(400, 'domain must be a valid hostname or HTTP(S) URL.')
  }
  if (!hostname || hostname.includes(' ') || hostname.length > 253 || !hostname.includes('.')) throw new HttpError(400, 'domain must be a valid hostname.')
  return { raw, normalized: hostname }
}

function canonicalWebsite(value: unknown): { raw: string; canonical: string } | null {
  if (value === null) return null
  const raw = text(value, 'website', { required: true, max: 2_000 }) as string
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid')
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    return { raw, canonical: url.toString().replace(/\/$/, '') }
  } catch {
    throw new HttpError(400, 'website must be a valid HTTP(S) URL.')
  }
}

function normalizedPhone(value: unknown): { raw: string; e164: string | null } | null {
  if (value === null) return null
  const raw = text(value, 'phone', { required: true, max: 100 }) as string
  const compact = raw.replace(/[\s().-]/g, '')
  const e164 = /^\+[1-9]\d{1,14}$/.test(compact) ? compact : null
  return { raw, e164 }
}

function searchText(request: FastifyRequest): string | null {
  const query = queryObject(request)
  const raw = query.q ?? query.search
  if (raw === undefined) return null
  if (typeof raw !== 'string') throw new HttpError(400, 'q must be a string.')
  const value = raw.trim()
  if (value.length > 200) throw new HttpError(400, 'q must not exceed 200 characters.')
  return value || null
}

function escapedLike(query: string | null): string | null {
  return query === null ? null : `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function limitValue(request: FastifyRequest, fallback = 50): number {
  const raw = queryObject(request).limit
  if (raw === undefined) return fallback
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new HttpError(400, 'limit must be an integer between 1 and 100.')
  return value
}

function requestId(request: FastifyRequest): string | null {
  return typeof request.id === 'string' ? request.id.slice(0, 200) : null
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function recordId(request: FastifyRequest): string {
  const value = (request.params as { id?: unknown } | undefined)?.id
  return uuid(value, 'id') as string
}

async function assertUser(client: PoolClient, workspaceId: string, userId: string | null) {
  if (userId === null) return
  const result = await client.query('SELECT 1 FROM users WHERE workspace_id = $1 AND id = $2', [workspaceId, userId])
  if (!result.rowCount) throw new HttpError(400, 'ownerUserId must identify a user in this workspace.')
}

async function assertIds(client: PoolClient, workspaceId: string, ids: string[], table: 'people' | 'companies' | 'opportunities') {
  if (!ids.length) return
  const result = await client.query(
    `SELECT id FROM ${table} p JOIN records r USING (id, workspace_id) WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[]) AND r.archived_at IS NULL`,
    [workspaceId, ids],
  )
  if (result.rowCount !== ids.length) throw new HttpError(400, `One or more related ${table} records do not exist in this workspace.`)
}

function associationIds(body: JsonObject, pluralKey: string, singularKey: string): { supplied: boolean; ids: string[] } {
  if (has(body, pluralKey)) {
    if (!Array.isArray(body[pluralKey]) || body[pluralKey].length > 100) throw new HttpError(400, `${pluralKey} must be an array of at most 100 UUIDs.`)
    const ids = (body[pluralKey] as unknown[]).map((item, index) => uuid(item, `${pluralKey}[${index}]`) as string)
    return { supplied: true, ids: [...new Set(ids)] }
  }
  if (has(body, singularKey)) {
    const id = uuid(body[singularKey], singularKey, true)
    return { supplied: true, ids: id ? [id] : [] }
  }
  return { supplied: false, ids: [] }
}

async function insertRecord(client: PoolClient, workspaceId: string, actorId: string, recordType: RecordType): Promise<{ id: string; version: number }> {
  const result = await client.query(
    `INSERT INTO records (workspace_id, record_type, created_by_actor_id, updated_by_actor_id)
     VALUES ($1, $2, $3, $3) RETURNING id, version`,
    [workspaceId, recordType, actorId],
  )
  return result.rows[0]
}

async function bumpRecordVersion(
  client: PoolClient,
  workspaceId: string,
  id: string,
  actorId: string,
  expectedVersion: number | null,
): Promise<number> {
  const selected = await client.query(
    `SELECT version FROM records WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE`,
    [workspaceId, id],
  )
  if (!selected.rowCount) throw new HttpError(404, 'Record not found.')
  const current = Number(selected.rows[0].version)
  if (expectedVersion !== null && current !== expectedVersion) {
    throw new HttpError(409, 'This record was changed by another user. Refresh and retry your edit.', 'Conflict', { currentVersion: current })
  }
  const updated = await client.query(
    `UPDATE records SET version = version + 1, updated_at = now(), updated_by_actor_id = $3
     WHERE workspace_id = $1 AND id = $2 RETURNING version`,
    [workspaceId, id, actorId],
  )
  return Number(updated.rows[0].version)
}

function expectedVersion(request: FastifyRequest, body: JsonObject): number | null {
  const header = request.headers['if-match']
  let fromHeader: number | null = null
  if (header !== undefined) {
    const tag = Array.isArray(header) ? header[0] : header
    const match = /^(?:W\/)?"?(\d+)"?$/.exec(tag)
    if (!match) throw new HttpError(400, 'If-Match must contain a record version integer.')
    fromHeader = Number(match[1])
  }
  if (has(body, 'version')) {
    const version = numberValue(body.version, 'version', { min: 1, integer: true }) as number
    if (fromHeader !== null && version !== fromHeader) throw new HttpError(400, 'version and If-Match must agree.')
    return version
  }
  return fromHeader
}

function setVersion(reply: FastifyReply, version: number) {
  reply.header('ETag', `"${version}"`)
}

async function writeActivity(
  client: PoolClient,
  user: AuthUser,
  request: FastifyRequest,
  action: string,
  primaryRecordId: string,
  fields: string[],
  relatedRecordIds: string[] = [],
) {
  const event = await client.query(
    `INSERT INTO activity_events (workspace_id, actor_id, owner_user_id, action, primary_record_id, source, request_id, changed_fields)
     VALUES ($1, $2, $3, $4, $5, 'REST', $6, $7::jsonb) RETURNING id`,
    [user.workspaceId, user.actorId, user.userId, action, primaryRecordId, requestId(request), JSON.stringify({ fields })],
  )
  const ids = [...new Set([primaryRecordId, ...relatedRecordIds])]
  await client.query(
    `INSERT INTO activity_records (workspace_id, activity_event_id, record_id)
     SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT DO NOTHING`,
    [user.workspaceId, event.rows[0].id, ids],
  )
}

function updateSet(
  table: string,
  workspaceId: string,
  id: string,
  columns: Array<{ column: string; value: unknown }>,
) {
  if (!columns.length) return null
  const assignments = columns.map(({ column }, index) => `${column} = $${index + 3}`).join(', ')
  return {
    text: `UPDATE ${table} SET ${assignments} WHERE workspace_id = $1 AND id = $2`,
    values: [workspaceId, id, ...columns.map(({ value }) => value)],
  }
}

async function updateSubtype(
  client: PoolClient,
  table: string,
  workspaceId: string,
  id: string,
  columns: Array<{ column: string; value: unknown }>,
) {
  const update = updateSet(table, workspaceId, id, columns)
  if (update) await client.query(update.text, update.values)
}

async function duplicateEmail(client: PoolClient, workspaceId: string, email: string, exceptPersonId: string | null = null) {
  const result = await client.query(
    `SELECT pe.person_id AS id FROM person_emails pe
     WHERE pe.workspace_id = $1 AND pe.normalized_email = $2 AND pe.match_enabled
       AND ($3::uuid IS NULL OR pe.person_id <> $3) LIMIT 1`,
    [workspaceId, email, exceptPersonId],
  )
  if (result.rowCount) throw new HttpError(409, 'A person with this email address already exists.', 'Duplicate email', { duplicateRecordId: result.rows[0].id })
}

async function duplicateDomain(client: PoolClient, workspaceId: string, domain: string, exceptCompanyId: string | null = null) {
  const result = await client.query(
    `SELECT company_id AS id FROM company_domains
     WHERE workspace_id = $1 AND normalized_domain = $2 AND ($3::uuid IS NULL OR company_id <> $3) LIMIT 1`,
    [workspaceId, domain, exceptCompanyId],
  )
  if (result.rowCount) throw new HttpError(409, 'A company with this domain already exists.', 'Duplicate domain', { duplicateRecordId: result.rows[0].id })
}

async function setPersonEmail(client: PoolClient, workspaceId: string, personId: string, email: { raw: string; normalized: string } | null) {
  const current = await client.query(
    'SELECT id FROM person_emails WHERE workspace_id = $1 AND person_id = $2 AND is_primary FOR UPDATE',
    [workspaceId, personId],
  )
  if (!email) {
    if (current.rowCount) await client.query('DELETE FROM person_emails WHERE workspace_id = $1 AND id = $2', [workspaceId, current.rows[0].id])
    return
  }
  await duplicateEmail(client, workspaceId, email.normalized, personId)
  if (current.rowCount) {
    await client.query(
      'UPDATE person_emails SET raw_email = $3, normalized_email = $4, match_enabled = true WHERE workspace_id = $1 AND id = $2',
      [workspaceId, current.rows[0].id, email.raw, email.normalized],
    )
  } else {
    await client.query(
      `INSERT INTO person_emails (workspace_id, person_id, raw_email, normalized_email, is_primary, match_enabled)
       VALUES ($1, $2, $3, $4, true, true)`,
      [workspaceId, personId, email.raw, email.normalized],
    )
  }
}

async function setPersonPhone(client: PoolClient, workspaceId: string, personId: string, phone: { raw: string; e164: string | null } | null) {
  const current = await client.query(
    'SELECT id FROM person_phones WHERE workspace_id = $1 AND person_id = $2 AND is_primary FOR UPDATE',
    [workspaceId, personId],
  )
  if (!phone) {
    if (current.rowCount) await client.query('DELETE FROM person_phones WHERE workspace_id = $1 AND id = $2', [workspaceId, current.rows[0].id])
    return
  }
  if (phone.e164) {
    const duplicate = await client.query(
      'SELECT person_id AS id FROM person_phones WHERE workspace_id = $1 AND e164 = $2 AND person_id <> $3 LIMIT 1',
      [workspaceId, phone.e164, personId],
    )
    if (duplicate.rowCount) throw new HttpError(409, 'A person with this phone number already exists.', 'Duplicate phone', { duplicateRecordId: duplicate.rows[0].id })
  }
  if (current.rowCount) {
    await client.query(
      'UPDATE person_phones SET raw_phone = $3, e164 = $4 WHERE workspace_id = $1 AND id = $2',
      [workspaceId, current.rows[0].id, phone.raw, phone.e164],
    )
  } else {
    await client.query(
      `INSERT INTO person_phones (workspace_id, person_id, raw_phone, e164, is_primary)
       VALUES ($1, $2, $3, $4, true)`,
      [workspaceId, personId, phone.raw, phone.e164],
    )
  }
}

async function setPrimaryAddressCity(
  client: PoolClient,
  table: 'person_addresses' | 'company_addresses',
  ownerColumn: 'person_id' | 'company_id',
  workspaceId: string,
  ownerId: string,
  city: string | null,
) {
  const current = await client.query(
    `SELECT id FROM ${table} WHERE workspace_id = $1 AND ${ownerColumn} = $2 AND is_primary FOR UPDATE`,
    [workspaceId, ownerId],
  )
  if (current.rowCount) {
    await client.query(`UPDATE ${table} SET city = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.rows[0].id, city])
  } else if (city) {
    await client.query(
      `INSERT INTO ${table} (workspace_id, ${ownerColumn}, city, is_primary) VALUES ($1, $2, $3, true)`,
      [workspaceId, ownerId, city],
    )
  }
}

async function setPersonCompany(client: PoolClient, workspaceId: string, personId: string, companyId: string | null) {
  if (companyId) await assertIds(client, workspaceId, [companyId], 'companies')
  await client.query(
    `UPDATE person_companies SET is_primary = false, ended_on = COALESCE(ended_on, CURRENT_DATE)
     WHERE workspace_id = $1 AND person_id = $2 AND is_primary AND ended_on IS NULL`,
    [workspaceId, personId],
  )
  if (!companyId) return
  await client.query(
    `INSERT INTO person_companies (workspace_id, person_id, company_id, is_primary)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (workspace_id, person_id, company_id) DO UPDATE SET is_primary = true, ended_on = NULL`,
    [workspaceId, personId, companyId],
  )
}

const PERSON_SELECT = `
  SELECT p.id, p.full_name AS "fullName", p.job_title AS "jobTitle", p.description, p.importance,
         r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
         (SELECT e.raw_email FROM person_emails e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id AND e.is_primary ORDER BY e.created_at LIMIT 1) AS email,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('email', e.raw_email, 'isPrimary', e.is_primary) ORDER BY e.is_primary DESC, e.created_at)
                   FROM person_emails e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id), '[]'::jsonb) AS emails,
         (SELECT ph.raw_phone FROM person_phones ph WHERE ph.workspace_id = p.workspace_id AND ph.person_id = p.id AND ph.is_primary ORDER BY ph.created_at LIMIT 1) AS phone,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('phone', ph.raw_phone, 'isPrimary', ph.is_primary) ORDER BY ph.is_primary DESC, ph.created_at)
                   FROM person_phones ph WHERE ph.workspace_id = p.workspace_id AND ph.person_id = p.id), '[]'::jsonb) AS phones,
         (SELECT c.id FROM person_companies pc JOIN companies c ON c.workspace_id = pc.workspace_id AND c.id = pc.company_id
           WHERE pc.workspace_id = p.workspace_id AND pc.person_id = p.id AND pc.is_primary AND pc.ended_on IS NULL LIMIT 1) AS "companyId",
          (SELECT c.name FROM person_companies pc JOIN companies c ON c.workspace_id = pc.workspace_id AND c.id = pc.company_id
            WHERE pc.workspace_id = p.workspace_id AND pc.person_id = p.id AND pc.is_primary AND pc.ended_on IS NULL LIMIT 1) AS "companyName"
          ,(SELECT a.city FROM person_addresses a WHERE a.workspace_id = p.workspace_id AND a.person_id = p.id AND a.is_primary LIMIT 1) AS city
          ,(SELECT a.region FROM person_addresses a WHERE a.workspace_id = p.workspace_id AND a.person_id = p.id AND a.is_primary LIMIT 1) AS region
          ,(SELECT a.country_name FROM person_addresses a WHERE a.workspace_id = p.workspace_id AND a.person_id = p.id AND a.is_primary LIMIT 1) AS "countryName"
          ,(SELECT a.country_code FROM person_addresses a WHERE a.workspace_id = p.workspace_id AND a.person_id = p.id AND a.is_primary LIMIT 1) AS "countryCode"
          ,COALESCE((SELECT jsonb_agg(t.label ORDER BY t.normalized_label)
                       FROM record_taxonomies rt JOIN taxonomy_terms t ON t.workspace_id = rt.workspace_id AND t.id = rt.taxonomy_term_id
                      WHERE rt.workspace_id = p.workspace_id AND rt.record_id = p.id AND t.taxonomy = 'PERSON_CATEGORY'), '[]'::jsonb) AS categories
          ,COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'chainId', ic.id, 'targetPersonId', target.id, 'targetPersonName', target.full_name,
                         'position', step.position, 'status', step.status, 'followUpAt', step.follow_up_at,
                         'notes', step.notes
                       ) ORDER BY step.position)
                       FROM introduction_steps step
                       JOIN introduction_chains ic ON ic.workspace_id = step.workspace_id AND ic.id = step.chain_id
                       JOIN people target ON target.workspace_id = ic.workspace_id AND target.id = ic.target_person_id
                      WHERE step.workspace_id = p.workspace_id AND step.to_person_id = p.id AND ic.status = 'ACTIVE'
                        AND step.status NOT IN ('INTRODUCED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'SKIPPED')), '[]'::jsonb) AS "introductionObligations"
     FROM people p JOIN records r USING (id, workspace_id)
   WHERE p.workspace_id = $1 AND r.archived_at IS NULL`

const COMPANY_SELECT = `
  SELECT c.id, c.name, c.description, c.owner_user_id AS "ownerUserId", c.customer_profile AS "customerProfile",
         c.business_role AS "businessRole", r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
         (SELECT d.raw_domain FROM company_domains d WHERE d.workspace_id = c.workspace_id AND d.company_id = c.id AND d.is_primary LIMIT 1) AS domain,
         (SELECT l.raw_url FROM company_links l WHERE l.workspace_id = c.workspace_id AND l.company_id = c.id AND l.is_primary LIMIT 1) AS website,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name, 'jobTitle', pc.job_title)
                    ORDER BY pc.is_primary DESC, p.full_name)
                   FROM person_companies pc JOIN people p ON p.workspace_id = pc.workspace_id AND p.id = pc.person_id
                   WHERE pc.workspace_id = c.workspace_id AND pc.company_id = c.id AND pc.ended_on IS NULL), '[]'::jsonb) AS people,
          (SELECT count(*)::integer FROM person_companies pc WHERE pc.workspace_id = c.workspace_id AND pc.company_id = c.id AND pc.ended_on IS NULL) AS "peopleCount",
          (SELECT a.city FROM company_addresses a WHERE a.workspace_id = c.workspace_id AND a.company_id = c.id AND a.is_primary LIMIT 1) AS city,
          (SELECT a.region FROM company_addresses a WHERE a.workspace_id = c.workspace_id AND a.company_id = c.id AND a.is_primary LIMIT 1) AS region,
          (SELECT a.country_name FROM company_addresses a WHERE a.workspace_id = c.workspace_id AND a.company_id = c.id AND a.is_primary LIMIT 1) AS "countryName",
          (SELECT a.country_code FROM company_addresses a WHERE a.workspace_id = c.workspace_id AND a.company_id = c.id AND a.is_primary LIMIT 1) AS "countryCode",
          COALESCE((SELECT jsonb_agg(t.label ORDER BY t.normalized_label)
                      FROM record_taxonomies rt JOIN taxonomy_terms t ON t.workspace_id = rt.workspace_id AND t.id = rt.taxonomy_term_id
                     WHERE rt.workspace_id = c.workspace_id AND rt.record_id = c.id AND t.taxonomy = 'COMPANY_CATEGORY'), '[]'::jsonb) AS categories,
          COALESCE((SELECT jsonb_agg(t.label ORDER BY t.normalized_label)
                      FROM record_taxonomies rt JOIN taxonomy_terms t ON t.workspace_id = rt.workspace_id AND t.id = rt.taxonomy_term_id
                     WHERE rt.workspace_id = c.workspace_id AND rt.record_id = c.id AND t.taxonomy = 'INDUSTRY'), '[]'::jsonb) AS industries
    FROM companies c JOIN records r USING (id, workspace_id)
   WHERE c.workspace_id = $1 AND r.archived_at IS NULL`

const OPPORTUNITY_SELECT = `
  SELECT o.id, o.name, o.description, o.stage, o.value, o.currency, o.owner_user_id AS "ownerUserId",
         u.full_name AS "ownerName", o.expected_close_date AS "expectedCloseDate", o.next_action AS "nextAction",
         o.next_follow_up_at AS "nextFollowUpAt", o.won_at AS "wonAt", o.lost_at AS "lostAt", o.lost_reason AS "lostReason",
         r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
                   FROM opportunity_companies oc JOIN companies c ON c.workspace_id = oc.workspace_id AND c.id = oc.company_id
                   WHERE oc.workspace_id = o.workspace_id AND oc.opportunity_id = o.id), '[]'::jsonb) AS companies,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name) ORDER BY p.full_name)
                   FROM opportunity_people op JOIN people p ON p.workspace_id = op.workspace_id AND p.id = op.person_id
                   WHERE op.workspace_id = o.workspace_id AND op.opportunity_id = o.id), '[]'::jsonb) AS people
    FROM opportunities o JOIN records r USING (id, workspace_id)
    LEFT JOIN users u ON u.workspace_id = o.workspace_id AND u.id = o.owner_user_id
   WHERE o.workspace_id = $1 AND r.archived_at IS NULL`

const NOTE_SELECT = `
  SELECT n.id, n.note_type AS "noteType", n.title, n.body_markdown AS "bodyMarkdown",
         r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'type', 'PERSON', 'name', p.full_name) ORDER BY p.full_name)
                   FROM note_people np JOIN people p ON p.workspace_id = np.workspace_id AND p.id = np.person_id
                   WHERE np.workspace_id = n.workspace_id AND np.note_id = n.id), '[]'::jsonb)
         || COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'type', 'COMPANY', 'name', c.name) ORDER BY c.name)
                   FROM note_companies nc JOIN companies c ON c.workspace_id = nc.workspace_id AND c.id = nc.company_id
                   WHERE nc.workspace_id = n.workspace_id AND nc.note_id = n.id), '[]'::jsonb)
         || COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'type', 'OPPORTUNITY', 'name', o.name) ORDER BY o.name)
                   FROM note_opportunities no JOIN opportunities o ON o.workspace_id = no.workspace_id AND o.id = no.opportunity_id
                   WHERE no.workspace_id = n.workspace_id AND no.note_id = n.id), '[]'::jsonb) AS "relatedRecords"
    FROM notes n JOIN records r USING (id, workspace_id)
   WHERE n.workspace_id = $1 AND r.archived_at IS NULL`

async function replaceJunction(
  client: PoolClient,
  workspaceId: string,
  sourceId: string,
  sourceColumn: 'opportunity_id' | 'note_id',
  table: 'opportunity_people' | 'opportunity_companies' | 'note_people' | 'note_companies' | 'note_opportunities',
  targetColumn: 'person_id' | 'company_id' | 'opportunity_id',
  ids: string[],
) {
  await client.query(`DELETE FROM ${table} WHERE workspace_id = $1 AND ${sourceColumn} = $2`, [workspaceId, sourceId])
  if (!ids.length) return
  await client.query(
    `INSERT INTO ${table} (workspace_id, ${sourceColumn}, ${targetColumn})
     SELECT $1, $2, unnest($3::uuid[])`,
    [workspaceId, sourceId, ids],
  )
}

export function registerCrmRoutes(app: FastifyInstance, { pool }: CrmOptions): void {
  app.get('/api/v1/people', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const q = escapedLike(searchText(request))
    const limit = limitValue(request)
    const result = await pool.query(
      `${PERSON_SELECT}
       AND ($2::text IS NULL OR p.full_name ILIKE $2 ESCAPE '\\' OR p.job_title ILIKE $2 ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM person_emails e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id AND e.raw_email ILIKE $2 ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM person_companies pc JOIN companies c ON c.workspace_id = pc.workspace_id AND c.id = pc.company_id WHERE pc.workspace_id = p.workspace_id AND pc.person_id = p.id AND c.name ILIKE $2 ESCAPE '\\'))
       ORDER BY r.updated_at DESC, p.id LIMIT $3`,
      [user.workspaceId, q, limit],
    )
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/people', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['fullName', 'firstName', 'lastName', 'jobTitle', 'description', 'importance', 'email', 'phone', 'city', 'companyId', 'introducedByPersonId'])
    let fullName: string
    if (has(body, 'fullName')) fullName = requiredText(body, 'fullName', 'fullName', 500)
    else fullName = [requiredText(body, 'firstName', 'firstName', 250), requiredText(body, 'lastName', 'lastName', 250)].join(' ').trim()
    const jobTitle = has(body, 'jobTitle') ? optionalText(body, 'jobTitle', 'jobTitle', 500) : null
    const description = has(body, 'description') ? optionalText(body, 'description', 'description', 20_000) : null
    const importance = has(body, 'importance') ? numberValue(body.importance, 'importance', { min: 0, max: 5, integer: true, nullable: true }) : null
    const email = has(body, 'email') ? emailAddress(body.email) : null
    const phone = has(body, 'phone') ? normalizedPhone(body.phone) : null
    const city = has(body, 'city') ? optionalText(body, 'city', 'city', 300) : null
    const companyId = has(body, 'companyId') ? uuid(body.companyId, 'companyId', true) : null
    const introducedBy = has(body, 'introducedByPersonId') ? uuid(body.introducedByPersonId, 'introducedByPersonId', true) : null

    const result = await transaction(pool, async (client) => {
      if (email) await duplicateEmail(client, user.workspaceId, email.normalized)
      if (companyId) await assertIds(client, user.workspaceId, [companyId], 'companies')
      if (introducedBy) await assertIds(client, user.workspaceId, [introducedBy], 'people')
      const record = await insertRecord(client, user.workspaceId, user.actorId, 'PERSON')
      await client.query(
        `INSERT INTO people (id, workspace_id, full_name, normalized_name, job_title, description, importance, introduced_by_person_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [record.id, user.workspaceId, fullName, fullName.toLowerCase(), jobTitle, description, importance, introducedBy],
      )
      if (email) await client.query(
        `INSERT INTO person_emails (workspace_id, person_id, raw_email, normalized_email, is_primary, match_enabled)
         VALUES ($1, $2, $3, $4, true, true)`, [user.workspaceId, record.id, email.raw, email.normalized],
      )
      if (phone) await client.query(
        `INSERT INTO person_phones (workspace_id, person_id, raw_phone, e164, is_primary)
         VALUES ($1, $2, $3, $4, true)`, [user.workspaceId, record.id, phone.raw, phone.e164],
      )
      if (city) await client.query(
        `INSERT INTO person_addresses (workspace_id, person_id, city, is_primary) VALUES ($1, $2, $3, true)`,
        [user.workspaceId, record.id, city],
      )
      if (companyId) await client.query(
        `INSERT INTO person_companies (workspace_id, person_id, company_id, is_primary) VALUES ($1, $2, $3, true)`,
        [user.workspaceId, record.id, companyId],
      )
      await writeActivity(client, user, request, 'PERSON_CREATED', record.id, ['fullName', ...(email ? ['email'] : []), ...(phone ? ['phone'] : []), ...(city ? ['city'] : []), ...(companyId ? ['companyId'] : [])], [companyId, introducedBy].filter((id): id is string => !!id))
      const created = await client.query(`${PERSON_SELECT} AND p.id = $2`, [user.workspaceId, record.id])
      return { data: created.rows[0], version: record.version }
    })
    setVersion(reply, result.version)
    return reply.code(201).send(result.data)
  }))

  app.get('/api/v1/people/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const result = await pool.query(`${PERSON_SELECT} AND p.id = $2`, [user.workspaceId, id])
    if (!result.rowCount) throw new HttpError(404, 'Person not found.')
    setVersion(reply, Number(result.rows[0].version))
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/people/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['version', 'fullName', 'jobTitle', 'description', 'importance', 'email', 'phone', 'city', 'companyId', 'introducedByPersonId'])
    const expected = expectedVersion(request, body)
    const columns: Array<{ column: string; value: unknown }> = []
    const changed: string[] = []
    if (has(body, 'fullName')) { const value = requiredText(body, 'fullName', 'fullName', 500); columns.push({ column: 'full_name', value }, { column: 'normalized_name', value: value.toLowerCase() }); changed.push('fullName') }
    if (has(body, 'jobTitle')) { columns.push({ column: 'job_title', value: optionalText(body, 'jobTitle', 'jobTitle', 500) }); changed.push('jobTitle') }
    if (has(body, 'description')) { columns.push({ column: 'description', value: optionalText(body, 'description', 'description', 20_000) }); changed.push('description') }
    if (has(body, 'importance')) { columns.push({ column: 'importance', value: numberValue(body.importance, 'importance', { min: 0, max: 5, integer: true, nullable: true }) }); changed.push('importance') }
    const email = has(body, 'email') ? emailAddress(body.email) : undefined
    const phone = has(body, 'phone') ? normalizedPhone(body.phone) : undefined
    const city = has(body, 'city') ? optionalText(body, 'city', 'city', 300) : undefined
    const companyId = has(body, 'companyId') ? uuid(body.companyId, 'companyId', true) : undefined
    const introducedBy = has(body, 'introducedByPersonId') ? uuid(body.introducedByPersonId, 'introducedByPersonId', true) : undefined
    if (email !== undefined) changed.push('email')
    if (phone !== undefined) changed.push('phone')
    if (city !== undefined) changed.push('city')
    if (companyId !== undefined) changed.push('companyId')
    if (introducedBy !== undefined) { columns.push({ column: 'introduced_by_person_id', value: introducedBy }); changed.push('introducedByPersonId') }
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')

    const result = await transaction(pool, async (client) => {
      const current = await client.query('SELECT id FROM people WHERE workspace_id = $1 AND id = $2', [user.workspaceId, id])
      if (!current.rowCount) throw new HttpError(404, 'Person not found.')
      if (introducedBy) await assertIds(client, user.workspaceId, [introducedBy], 'people')
      if (companyId) await assertIds(client, user.workspaceId, [companyId], 'companies')
      const version = await bumpRecordVersion(client, user.workspaceId, id, user.actorId, expected)
      await updateSubtype(client, 'people', user.workspaceId, id, columns)
      if (email !== undefined) await setPersonEmail(client, user.workspaceId, id, email)
      if (phone !== undefined) await setPersonPhone(client, user.workspaceId, id, phone)
      if (city !== undefined) await setPrimaryAddressCity(client, 'person_addresses', 'person_id', user.workspaceId, id, city)
      if (companyId !== undefined) await setPersonCompany(client, user.workspaceId, id, companyId)
      await writeActivity(client, user, request, 'PERSON_UPDATED', id, changed, [companyId].filter((value): value is string => !!value))
      const updated = await client.query(`${PERSON_SELECT} AND p.id = $2`, [user.workspaceId, id])
      return { data: updated.rows[0], version }
    })
    setVersion(reply, result.version)
    return reply.send(result.data)
  }))

  app.get('/api/v1/companies', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const q = escapedLike(searchText(request))
    const limit = limitValue(request)
    const result = await pool.query(
      `${COMPANY_SELECT}
       AND ($2::text IS NULL OR c.name ILIKE $2 ESCAPE '\\' OR c.description ILIKE $2 ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM company_domains d WHERE d.workspace_id = c.workspace_id AND d.company_id = c.id AND d.raw_domain ILIKE $2 ESCAPE '\\'))
       ORDER BY r.updated_at DESC, c.id LIMIT $3`,
      [user.workspaceId, q, limit],
    )
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/companies', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['name', 'description', 'ownerUserId', 'customerProfile', 'businessRole', 'domain', 'website', 'city'])
    const name = requiredText(body, 'name', 'name', 500)
    const description = has(body, 'description') ? optionalText(body, 'description', 'description', 20_000) : null
    const ownerUserId = has(body, 'ownerUserId') ? uuid(body.ownerUserId, 'ownerUserId', true) : null
    const customerProfile = has(body, 'customerProfile') ? optionalText(body, 'customerProfile', 'customerProfile', 10_000) : null
    const businessRole = has(body, 'businessRole') ? optionalText(body, 'businessRole', 'businessRole', 500) : null
    const domain = has(body, 'domain') ? normalizedDomain(body.domain) : null
    const website = has(body, 'website') ? canonicalWebsite(body.website) : null
    const city = has(body, 'city') ? optionalText(body, 'city', 'city', 300) : null
    const result = await transaction(pool, async (client) => {
      await assertUser(client, user.workspaceId, ownerUserId)
      if (domain) await duplicateDomain(client, user.workspaceId, domain.normalized)
      const record = await insertRecord(client, user.workspaceId, user.actorId, 'COMPANY')
      await client.query(
        `INSERT INTO companies (id, workspace_id, name, normalized_name, description, owner_user_id, customer_profile, business_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [record.id, user.workspaceId, name, name.toLowerCase(), description, ownerUserId, customerProfile, businessRole],
      )
      if (domain) await client.query(
        `INSERT INTO company_domains (workspace_id, company_id, raw_domain, normalized_domain, is_primary) VALUES ($1, $2, $3, $4, true)`,
        [user.workspaceId, record.id, domain.raw, domain.normalized],
      )
      if (website) await client.query(
        `INSERT INTO company_links (workspace_id, company_id, kind, raw_url, canonical_url, is_primary) VALUES ($1, $2, 'WEBSITE', $3, $4, true)`,
        [user.workspaceId, record.id, website.raw, website.canonical],
      )
      if (city) await client.query(
        `INSERT INTO company_addresses (workspace_id, company_id, city, is_primary) VALUES ($1, $2, $3, true)`,
        [user.workspaceId, record.id, city],
      )
      await writeActivity(client, user, request, 'COMPANY_CREATED', record.id, ['name', ...(domain ? ['domain'] : []), ...(website ? ['website'] : [])])
      const created = await client.query(`${COMPANY_SELECT} AND c.id = $2`, [user.workspaceId, record.id])
      return { data: created.rows[0], version: record.version }
    })
    setVersion(reply, result.version)
    return reply.code(201).send(result.data)
  }))

  app.get('/api/v1/companies/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const result = await pool.query(`${COMPANY_SELECT} AND c.id = $2`, [user.workspaceId, id])
    if (!result.rowCount) throw new HttpError(404, 'Company not found.')
    setVersion(reply, Number(result.rows[0].version))
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/companies/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['version', 'name', 'description', 'ownerUserId', 'customerProfile', 'businessRole', 'domain', 'website', 'city'])
    const expected = expectedVersion(request, body)
    const columns: Array<{ column: string; value: unknown }> = []
    const changed: string[] = []
    if (has(body, 'name')) { const value = requiredText(body, 'name', 'name', 500); columns.push({ column: 'name', value }, { column: 'normalized_name', value: value.toLowerCase() }); changed.push('name') }
    if (has(body, 'description')) { columns.push({ column: 'description', value: optionalText(body, 'description', 'description', 20_000) }); changed.push('description') }
    if (has(body, 'ownerUserId')) { columns.push({ column: 'owner_user_id', value: uuid(body.ownerUserId, 'ownerUserId', true) }); changed.push('ownerUserId') }
    if (has(body, 'customerProfile')) { columns.push({ column: 'customer_profile', value: optionalText(body, 'customerProfile', 'customerProfile', 10_000) }); changed.push('customerProfile') }
    if (has(body, 'businessRole')) { columns.push({ column: 'business_role', value: optionalText(body, 'businessRole', 'businessRole', 500) }); changed.push('businessRole') }
    const domain = has(body, 'domain') ? normalizedDomain(body.domain) : undefined
    const website = has(body, 'website') ? canonicalWebsite(body.website) : undefined
    const city = has(body, 'city') ? optionalText(body, 'city', 'city', 300) : undefined
    if (domain !== undefined) changed.push('domain')
    if (website !== undefined) changed.push('website')
    if (city !== undefined) changed.push('city')
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')
    const ownerUserId = columns.find((column) => column.column === 'owner_user_id')?.value as string | null | undefined
    const result = await transaction(pool, async (client) => {
      const current = await client.query('SELECT id FROM companies WHERE workspace_id = $1 AND id = $2', [user.workspaceId, id])
      if (!current.rowCount) throw new HttpError(404, 'Company not found.')
      if (ownerUserId !== undefined) await assertUser(client, user.workspaceId, ownerUserId)
      if (domain) await duplicateDomain(client, user.workspaceId, domain.normalized, id)
      const version = await bumpRecordVersion(client, user.workspaceId, id, user.actorId, expected)
      await updateSubtype(client, 'companies', user.workspaceId, id, columns)
      if (domain !== undefined) {
        const existing = await client.query('SELECT id FROM company_domains WHERE workspace_id = $1 AND company_id = $2 AND is_primary FOR UPDATE', [user.workspaceId, id])
        if (!domain) {
          if (existing.rowCount) await client.query('DELETE FROM company_domains WHERE workspace_id = $1 AND id = $2', [user.workspaceId, existing.rows[0].id])
        } else if (existing.rowCount) {
          await client.query('UPDATE company_domains SET raw_domain = $3, normalized_domain = $4 WHERE workspace_id = $1 AND id = $2', [user.workspaceId, existing.rows[0].id, domain.raw, domain.normalized])
        } else {
          await client.query('INSERT INTO company_domains (workspace_id, company_id, raw_domain, normalized_domain, is_primary) VALUES ($1, $2, $3, $4, true)', [user.workspaceId, id, domain.raw, domain.normalized])
        }
      }
      if (website !== undefined) {
        const existing = await client.query('SELECT id FROM company_links WHERE workspace_id = $1 AND company_id = $2 AND is_primary FOR UPDATE', [user.workspaceId, id])
        if (!website) {
          if (existing.rowCount) await client.query('DELETE FROM company_links WHERE workspace_id = $1 AND id = $2', [user.workspaceId, existing.rows[0].id])
        } else if (existing.rowCount) {
          await client.query('UPDATE company_links SET raw_url = $3, canonical_url = $4 WHERE workspace_id = $1 AND id = $2', [user.workspaceId, existing.rows[0].id, website.raw, website.canonical])
        } else {
          await client.query("INSERT INTO company_links (workspace_id, company_id, kind, raw_url, canonical_url, is_primary) VALUES ($1, $2, 'WEBSITE', $3, $4, true)", [user.workspaceId, id, website.raw, website.canonical])
        }
      }
      if (city !== undefined) await setPrimaryAddressCity(client, 'company_addresses', 'company_id', user.workspaceId, id, city)
      await writeActivity(client, user, request, 'COMPANY_UPDATED', id, changed)
      const updated = await client.query(`${COMPANY_SELECT} AND c.id = $2`, [user.workspaceId, id])
      return { data: updated.rows[0], version }
    })
    setVersion(reply, result.version)
    return reply.send(result.data)
  }))

  app.get('/api/v1/opportunities', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const q = escapedLike(searchText(request))
    const limit = limitValue(request)
    const result = await pool.query(
      `${OPPORTUNITY_SELECT}
       AND ($2::text IS NULL OR o.name ILIKE $2 ESCAPE '\\' OR o.description ILIKE $2 ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM opportunity_companies oc JOIN companies c ON c.workspace_id = oc.workspace_id AND c.id = oc.company_id WHERE oc.workspace_id = o.workspace_id AND oc.opportunity_id = o.id AND c.name ILIKE $2 ESCAPE '\\'))
       ORDER BY r.updated_at DESC, o.id LIMIT $3`,
      [user.workspaceId, q, limit],
    )
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/opportunities', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['name', 'description', 'stage', 'value', 'currency', 'ownerUserId', 'expectedCloseDate', 'nextAction', 'nextFollowUpAt', 'lostReason', 'companyId', 'companyIds', 'personId', 'personIds'])
    const name = requiredText(body, 'name', 'name', 500)
    const description = has(body, 'description') ? optionalText(body, 'description', 'description', 20_000) : null
    const stage = has(body, 'stage') ? requiredText(body, 'stage', 'stage', 30).toUpperCase() : 'LEAD'
    if (!['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'].includes(stage)) throw new HttpError(400, 'stage is not a supported opportunity stage.')
    const value = has(body, 'value') ? numberValue(body.value, 'value', { min: 0, nullable: true }) : null
    const currency = has(body, 'currency') ? requiredText(body, 'currency', 'currency', 3).toUpperCase() : 'EUR'
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'currency must be a three-letter ISO currency code.')
    const ownerUserId = has(body, 'ownerUserId') ? uuid(body.ownerUserId, 'ownerUserId', true) : null
    const expectedCloseDate = has(body, 'expectedCloseDate') ? isoDate(body.expectedCloseDate, 'expectedCloseDate', true) : null
    const nextAction = has(body, 'nextAction') ? optionalText(body, 'nextAction', 'nextAction', 2_000) : null
    const nextFollowUpAt = has(body, 'nextFollowUpAt') ? isoTimestamp(body.nextFollowUpAt, 'nextFollowUpAt', true) : null
    const lostReason = has(body, 'lostReason') ? optionalText(body, 'lostReason', 'lostReason', 2_000) : null
    const companies = associationIds(body, 'companyIds', 'companyId')
    const people = associationIds(body, 'personIds', 'personId')
    const result = await transaction(pool, async (client) => {
      await assertUser(client, user.workspaceId, ownerUserId)
      await assertIds(client, user.workspaceId, companies.ids, 'companies')
      await assertIds(client, user.workspaceId, people.ids, 'people')
      const record = await insertRecord(client, user.workspaceId, user.actorId, 'OPPORTUNITY')
      await client.query(
        `INSERT INTO opportunities (id, workspace_id, name, description, stage, value, currency, owner_user_id, expected_close_date, next_action, next_follow_up_at, won_at, lost_at, lost_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $5 = 'WON' THEN now() END, CASE WHEN $5 = 'LOST' THEN now() END, $12)`,
        [record.id, user.workspaceId, name, description, stage, value, currency, ownerUserId, expectedCloseDate, nextAction, nextFollowUpAt, lostReason],
      )
      await replaceJunction(client, user.workspaceId, record.id, 'opportunity_id', 'opportunity_companies', 'company_id', companies.ids)
      await replaceJunction(client, user.workspaceId, record.id, 'opportunity_id', 'opportunity_people', 'person_id', people.ids)
      await writeActivity(client, user, request, 'OPPORTUNITY_CREATED', record.id, ['name', 'stage', ...(value !== null ? ['value'] : [])], [...companies.ids, ...people.ids])
      const created = await client.query(`${OPPORTUNITY_SELECT} AND o.id = $2`, [user.workspaceId, record.id])
      return { data: created.rows[0], version: record.version }
    })
    setVersion(reply, result.version)
    return reply.code(201).send(result.data)
  }))

  app.get('/api/v1/opportunities/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const result = await pool.query(`${OPPORTUNITY_SELECT} AND o.id = $2`, [user.workspaceId, id])
    if (!result.rowCount) throw new HttpError(404, 'Opportunity not found.')
    setVersion(reply, Number(result.rows[0].version))
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/opportunities/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['version', 'name', 'description', 'stage', 'value', 'currency', 'ownerUserId', 'expectedCloseDate', 'nextAction', 'nextFollowUpAt', 'lostReason', 'companyId', 'companyIds', 'personId', 'personIds'])
    const expected = expectedVersion(request, body)
    const columns: Array<{ column: string; value: unknown }> = []
    const changed: string[] = []
    if (has(body, 'name')) { columns.push({ column: 'name', value: requiredText(body, 'name', 'name', 500) }); changed.push('name') }
    if (has(body, 'description')) { columns.push({ column: 'description', value: optionalText(body, 'description', 'description', 20_000) }); changed.push('description') }
    if (has(body, 'stage')) {
      const stage = requiredText(body, 'stage', 'stage', 30).toUpperCase()
      if (!['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'].includes(stage)) throw new HttpError(400, 'stage is not a supported opportunity stage.')
      columns.push({ column: 'stage', value: stage })
      if (stage === 'WON') columns.push({ column: 'won_at', value: new Date().toISOString() })
      if (stage === 'LOST') columns.push({ column: 'lost_at', value: new Date().toISOString() })
      changed.push('stage')
    }
    if (has(body, 'value')) { columns.push({ column: 'value', value: numberValue(body.value, 'value', { min: 0, nullable: true }) }); changed.push('value') }
    if (has(body, 'currency')) {
      const currency = requiredText(body, 'currency', 'currency', 3).toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'currency must be a three-letter ISO currency code.')
      columns.push({ column: 'currency', value: currency }); changed.push('currency')
    }
    if (has(body, 'ownerUserId')) { columns.push({ column: 'owner_user_id', value: uuid(body.ownerUserId, 'ownerUserId', true) }); changed.push('ownerUserId') }
    if (has(body, 'expectedCloseDate')) { columns.push({ column: 'expected_close_date', value: isoDate(body.expectedCloseDate, 'expectedCloseDate', true) }); changed.push('expectedCloseDate') }
    if (has(body, 'nextAction')) { columns.push({ column: 'next_action', value: optionalText(body, 'nextAction', 'nextAction', 2_000) }); changed.push('nextAction') }
    if (has(body, 'nextFollowUpAt')) { columns.push({ column: 'next_follow_up_at', value: isoTimestamp(body.nextFollowUpAt, 'nextFollowUpAt', true) }); changed.push('nextFollowUpAt') }
    if (has(body, 'lostReason')) { columns.push({ column: 'lost_reason', value: optionalText(body, 'lostReason', 'lostReason', 2_000) }); changed.push('lostReason') }
    const companies = associationIds(body, 'companyIds', 'companyId')
    const people = associationIds(body, 'personIds', 'personId')
    if (companies.supplied) changed.push('companyIds')
    if (people.supplied) changed.push('personIds')
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')
    const ownerUserId = columns.find((column) => column.column === 'owner_user_id')?.value as string | null | undefined

    const result = await transaction(pool, async (client) => {
      const current = await client.query('SELECT id FROM opportunities WHERE workspace_id = $1 AND id = $2', [user.workspaceId, id])
      if (!current.rowCount) throw new HttpError(404, 'Opportunity not found.')
      if (ownerUserId !== undefined) await assertUser(client, user.workspaceId, ownerUserId)
      if (companies.supplied) await assertIds(client, user.workspaceId, companies.ids, 'companies')
      if (people.supplied) await assertIds(client, user.workspaceId, people.ids, 'people')
      const version = await bumpRecordVersion(client, user.workspaceId, id, user.actorId, expected)
      await updateSubtype(client, 'opportunities', user.workspaceId, id, columns)
      if (companies.supplied) await replaceJunction(client, user.workspaceId, id, 'opportunity_id', 'opportunity_companies', 'company_id', companies.ids)
      if (people.supplied) await replaceJunction(client, user.workspaceId, id, 'opportunity_id', 'opportunity_people', 'person_id', people.ids)
      const relatedIds = [...(companies.supplied ? companies.ids : []), ...(people.supplied ? people.ids : [])]
      await writeActivity(client, user, request, 'OPPORTUNITY_UPDATED', id, changed, relatedIds)
      const updated = await client.query(`${OPPORTUNITY_SELECT} AND o.id = $2`, [user.workspaceId, id])
      return { data: updated.rows[0], version }
    })
    setVersion(reply, result.version)
    return reply.send(result.data)
  }))

  app.get('/api/v1/notes', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const q = escapedLike(searchText(request))
    const limit = limitValue(request)
    const result = await pool.query(
      `${NOTE_SELECT}
       AND ($2::text IS NULL OR n.title ILIKE $2 ESCAPE '\\' OR n.body_markdown ILIKE $2 ESCAPE '\\')
       ORDER BY r.updated_at DESC, n.id LIMIT $3`,
      [user.workspaceId, q, limit],
    )
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/notes', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['noteType', 'title', 'bodyMarkdown', 'body', 'personId', 'personIds', 'companyId', 'companyIds', 'opportunityId', 'opportunityIds'])
    const noteType = has(body, 'noteType') ? requiredText(body, 'noteType', 'noteType', 30).toUpperCase() : 'GENERAL'
    if (!['GENERAL', 'MEETING'].includes(noteType)) throw new HttpError(400, 'noteType must be GENERAL or MEETING.')
    const title = requiredText(body, 'title', 'title', 1_000)
    const noteBody = has(body, 'bodyMarkdown') ? text(body.bodyMarkdown, 'bodyMarkdown', { max: 100_000 }) as string : has(body, 'body') ? text(body.body, 'body', { max: 100_000 }) as string : ''
    const people = associationIds(body, 'personIds', 'personId')
    const companies = associationIds(body, 'companyIds', 'companyId')
    const opportunities = associationIds(body, 'opportunityIds', 'opportunityId')
    const result = await transaction(pool, async (client) => {
      await assertIds(client, user.workspaceId, people.ids, 'people')
      await assertIds(client, user.workspaceId, companies.ids, 'companies')
      await assertIds(client, user.workspaceId, opportunities.ids, 'opportunities')
      const record = await insertRecord(client, user.workspaceId, user.actorId, 'NOTE')
      await client.query(
        `INSERT INTO notes (id, workspace_id, note_type, title, body_markdown) VALUES ($1, $2, $3, $4, $5)`,
        [record.id, user.workspaceId, noteType, title, noteBody],
      )
      await replaceJunction(client, user.workspaceId, record.id, 'note_id', 'note_people', 'person_id', people.ids)
      await replaceJunction(client, user.workspaceId, record.id, 'note_id', 'note_companies', 'company_id', companies.ids)
      await replaceJunction(client, user.workspaceId, record.id, 'note_id', 'note_opportunities', 'opportunity_id', opportunities.ids)
      await writeActivity(client, user, request, 'NOTE_CREATED', record.id, ['title', 'noteType', ...(noteBody ? ['bodyMarkdown'] : [])], [...people.ids, ...companies.ids, ...opportunities.ids])
      const created = await client.query(`${NOTE_SELECT} AND n.id = $2`, [user.workspaceId, record.id])
      return { data: created.rows[0], version: record.version }
    })
    setVersion(reply, result.version)
    return reply.code(201).send(result.data)
  }))

  app.get('/api/v1/notes/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const result = await pool.query(`${NOTE_SELECT} AND n.id = $2`, [user.workspaceId, id])
    if (!result.rowCount) throw new HttpError(404, 'Note not found.')
    setVersion(reply, Number(result.rows[0].version))
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/notes/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['version', 'noteType', 'title', 'bodyMarkdown', 'body', 'personId', 'personIds', 'companyId', 'companyIds', 'opportunityId', 'opportunityIds'])
    if (has(body, 'bodyMarkdown') && has(body, 'body')) throw new HttpError(400, 'Use either bodyMarkdown or body, not both.')
    const expected = expectedVersion(request, body)
    const columns: Array<{ column: string; value: unknown }> = []
    const changed: string[] = []
    if (has(body, 'noteType')) {
      const noteType = requiredText(body, 'noteType', 'noteType', 30).toUpperCase()
      if (!['GENERAL', 'MEETING'].includes(noteType)) throw new HttpError(400, 'noteType must be GENERAL or MEETING.')
      columns.push({ column: 'note_type', value: noteType }); changed.push('noteType')
    }
    if (has(body, 'title')) { columns.push({ column: 'title', value: requiredText(body, 'title', 'title', 1_000) }); changed.push('title') }
    if (has(body, 'bodyMarkdown') || has(body, 'body')) {
      const key = has(body, 'bodyMarkdown') ? 'bodyMarkdown' : 'body'
      columns.push({ column: 'body_markdown', value: text(body[key], key, { max: 100_000 }) }); changed.push('bodyMarkdown')
    }
    const people = associationIds(body, 'personIds', 'personId')
    const companies = associationIds(body, 'companyIds', 'companyId')
    const opportunities = associationIds(body, 'opportunityIds', 'opportunityId')
    if (people.supplied) changed.push('personIds')
    if (companies.supplied) changed.push('companyIds')
    if (opportunities.supplied) changed.push('opportunityIds')
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')
    const result = await transaction(pool, async (client) => {
      const current = await client.query('SELECT id FROM notes WHERE workspace_id = $1 AND id = $2', [user.workspaceId, id])
      if (!current.rowCount) throw new HttpError(404, 'Note not found.')
      if (people.supplied) await assertIds(client, user.workspaceId, people.ids, 'people')
      if (companies.supplied) await assertIds(client, user.workspaceId, companies.ids, 'companies')
      if (opportunities.supplied) await assertIds(client, user.workspaceId, opportunities.ids, 'opportunities')
      const version = await bumpRecordVersion(client, user.workspaceId, id, user.actorId, expected)
      await updateSubtype(client, 'notes', user.workspaceId, id, columns)
      if (people.supplied) await replaceJunction(client, user.workspaceId, id, 'note_id', 'note_people', 'person_id', people.ids)
      if (companies.supplied) await replaceJunction(client, user.workspaceId, id, 'note_id', 'note_companies', 'company_id', companies.ids)
      if (opportunities.supplied) await replaceJunction(client, user.workspaceId, id, 'note_id', 'note_opportunities', 'opportunity_id', opportunities.ids)
      await writeActivity(client, user, request, 'NOTE_UPDATED', id, changed, [
        ...(people.supplied ? people.ids : []), ...(companies.supplied ? companies.ids : []), ...(opportunities.supplied ? opportunities.ids : []),
      ])
      const updated = await client.query(`${NOTE_SELECT} AND n.id = $2`, [user.workspaceId, id])
      return { data: updated.rows[0], version }
    })
    setVersion(reply, result.version)
    return reply.send(result.data)
  }))

  app.get('/api/v1/search', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const q = searchText(request)
    if (!q) throw new HttpError(400, 'q is required and must not be empty.')
    const pattern = escapedLike(q)
    const limit = limitValue(request, 20)
    const result = await pool.query(
      `SELECT results.id, results."recordType", results.title, results.subtitle, results."updatedAt", results.version
         FROM (
           SELECT p.id, 'PERSON'::text AS "recordType", p.full_name AS title,
                  COALESCE((SELECT e.raw_email FROM person_emails e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id AND e.is_primary LIMIT 1), p.job_title) AS subtitle,
                  r.updated_at AS "updatedAt", r.version
             FROM people p JOIN records r USING (id, workspace_id)
            WHERE p.workspace_id = $1 AND r.archived_at IS NULL AND (p.full_name ILIKE $2 ESCAPE '\\' OR COALESCE(p.job_title, '') ILIKE $2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM person_emails e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id AND e.raw_email ILIKE $2 ESCAPE '\\'))
           UNION ALL
           SELECT c.id, 'COMPANY'::text, c.name,
                  COALESCE((SELECT d.raw_domain FROM company_domains d WHERE d.workspace_id = c.workspace_id AND d.company_id = c.id AND d.is_primary LIMIT 1), c.description),
                  r.updated_at, r.version
             FROM companies c JOIN records r USING (id, workspace_id)
            WHERE c.workspace_id = $1 AND r.archived_at IS NULL AND (c.name ILIKE $2 ESCAPE '\\' OR COALESCE(c.description, '') ILIKE $2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM company_domains d WHERE d.workspace_id = c.workspace_id AND d.company_id = c.id AND d.raw_domain ILIKE $2 ESCAPE '\\'))
           UNION ALL
           SELECT o.id, 'OPPORTUNITY'::text, o.name, o.stage,
                  r.updated_at, r.version
             FROM opportunities o JOIN records r USING (id, workspace_id)
            WHERE o.workspace_id = $1 AND r.archived_at IS NULL AND (o.name ILIKE $2 ESCAPE '\\' OR COALESCE(o.description, '') ILIKE $2 ESCAPE '\\')
           UNION ALL
           SELECT n.id, 'NOTE'::text, n.title, left(n.body_markdown, 240),
                  r.updated_at, r.version
             FROM notes n JOIN records r USING (id, workspace_id)
            WHERE n.workspace_id = $1 AND r.archived_at IS NULL AND (n.title ILIKE $2 ESCAPE '\\' OR n.body_markdown ILIKE $2 ESCAPE '\\')
         ) AS results
        ORDER BY results."updatedAt" DESC, results.id
        LIMIT $3`,
      [user.workspaceId, pattern, limit],
    )
    return reply.send({ items: result.rows.map((row) => ({
      ...row,
      href: `/${({ PERSON: 'people', COMPANY: 'companies', OPPORTUNITY: 'opportunities', NOTE: 'notes' } as Record<string, string>)[row.recordType]}/${row.id}`,
    })) })
  }))

  app.get('/api/v1/dashboard', { preHandler: requireAuth }, protectedHandler(async (_request, reply, user) => {
    const counts = await pool.query(
      `SELECT count(*) FILTER (WHERE record_type = 'PERSON')::integer AS people,
              count(*) FILTER (WHERE record_type = 'COMPANY')::integer AS companies,
              count(*) FILTER (WHERE record_type = 'OPPORTUNITY')::integer AS opportunities
         FROM records WHERE workspace_id = $1 AND archived_at IS NULL`,
      [user.workspaceId],
    )
    const [followUpCount, actionItems, activity] = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM follow_ups WHERE workspace_id = $1 AND status = 'OPEN'`,
        [user.workspaceId],
      ),
      pool.query(
        `SELECT actions.id, actions.title, actions.description, actions."dueAt", actions.status, actions.href
           FROM (
             SELECT mn.note_id AS id, e.title || ' — meeting notes required' AS title,
                    'Add the summary and next steps for this meeting.'::text AS description,
                    e.starts_at AS "dueAt", mn.status, '/meeting-notes'::text AS href
               FROM meeting_notes mn JOIN events e ON e.workspace_id = mn.workspace_id AND e.id = mn.event_id
              WHERE mn.workspace_id = $1 AND mn.status = 'REQUIRED'
             UNION ALL
             SELECT f.id, f.title, COALESCE(f.body, 'Follow-up action') AS description,
                    f.due_at AS "dueAt", f.status, '/follow-ups'::text AS href
               FROM follow_ups f WHERE f.workspace_id = $1 AND f.status = 'OPEN'
             UNION ALL
             SELECT step.id AS id,
                    'Warm introduction step'::text AS title,
                    target.full_name || ' — waiting on ' || person.full_name AS description,
                    step.follow_up_at AS "dueAt", step.status, '/introductions'::text AS href
               FROM introduction_steps step
               JOIN introduction_chains chain ON chain.workspace_id = step.workspace_id AND chain.id = step.chain_id
               JOIN people target ON target.workspace_id = chain.workspace_id AND target.id = chain.target_person_id
               JOIN people person ON person.workspace_id = step.workspace_id AND person.id = step.to_person_id
              WHERE step.workspace_id = $1 AND chain.status = 'ACTIVE'
                AND step.status NOT IN ('INTRODUCED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'SKIPPED')
           ) AS actions
          ORDER BY actions."dueAt" NULLS LAST, actions.id LIMIT 20`,
        [user.workspaceId],
      ),
      pool.query(
      `SELECT ae.id, ae.action AS title, ae.action AS description, ae.occurred_at AS "occurredAt",
              a.display_name AS "actorName", r.record_type AS "recordType", ae.primary_record_id AS "recordId",
              COALESCE(p.full_name, c.name, o.name, n.title) AS "recordName"
         FROM activity_events ae
         JOIN actors a ON a.workspace_id = ae.workspace_id AND a.id = ae.actor_id
         LEFT JOIN records r ON r.workspace_id = ae.workspace_id AND r.id = ae.primary_record_id
         LEFT JOIN people p ON p.workspace_id = r.workspace_id AND p.id = r.id
         LEFT JOIN companies c ON c.workspace_id = r.workspace_id AND c.id = r.id
         LEFT JOIN opportunities o ON o.workspace_id = r.workspace_id AND o.id = r.id
         LEFT JOIN notes n ON n.workspace_id = r.workspace_id AND n.id = r.id
        WHERE ae.workspace_id = $1
        ORDER BY ae.occurred_at DESC, ae.id DESC LIMIT 10`,
      [user.workspaceId],
      ),
    ])
    const summary = { ...counts.rows[0], openFollowUps: followUpCount.rows[0]?.count ?? 0 }
    return reply.send({ summary, metrics: summary, actionItems: actionItems.rows, recentActivity: activity.rows })
  }))
}
