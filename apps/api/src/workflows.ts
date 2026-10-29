import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { requireAuth, type AuthUser } from './auth.js'

type WorkflowOptions = { pool: Pool }
type JsonObject = Record<string, unknown>
type AuthenticatedRequest = FastifyRequest & { authUser: AuthUser | null }

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

function problem(reply: FastifyReply, error: unknown) {
  let status = 500
  let title = 'Internal Server Error'
  let detail = 'The request could not be completed.'
  if (error instanceof HttpError) {
    status = error.status
    title = ({ 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict' } as Record<number, string>)[status] ?? title
    detail = error.message
  } else if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: unknown }).code)
    if (code === '23505' || code === '40001') {
      status = 409
      title = 'Conflict'
      detail = 'The record conflicts with existing data. Refresh and try again.'
    } else if (['23503', '23514', '22P02', '22007', '22008', '22003'].includes(code)) {
      status = 400
      title = 'Bad Request'
      detail = 'One or more supplied values are invalid.'
    }
  }
  return reply.code(status).type('application/problem+json').send({ type: 'about:blank', title, status, detail })
}

type Handler = (request: FastifyRequest, reply: FastifyReply, user: AuthUser) => Promise<unknown>

function protectedHandler(handler: Handler) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as AuthenticatedRequest).authUser
      if (!user?.workspaceId || !user.actorId || !user.userId) throw new HttpError(401, 'Authentication is required.')
      return await handler(request, reply, user)
    } catch (error) {
      if (!(error instanceof HttpError)) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined
        reply.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError', code }, 'Workflow request failed')
      }
      return problem(reply, error)
    }
  }
}

function objectBody(request: FastifyRequest): JsonObject {
  const body = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.')
  return body as JsonObject
}

function has(body: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function rejectUnknown(body: JsonObject, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new HttpError(400, `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`)
}

function text(value: unknown, field: string, options: { required?: boolean; nullable?: boolean; max?: number } = {}): string | null {
  if (value === null && options.nullable) return null
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be ${options.nullable ? 'a string or null' : 'a string'}.`)
  const result = value.trim()
  if (options.required && !result) throw new HttpError(400, `${field} is required.`)
  if (result.length > (options.max ?? 10_000)) throw new HttpError(400, `${field} is too long.`)
  return result || (options.nullable ? null : '')
}

function requiredText(body: JsonObject, key: string, max = 500): string {
  return text(body[key], key, { required: true, max }) as string
}

function optionalText(body: JsonObject, key: string, max = 10_000): string | null {
  return text(body[key], key, { nullable: true, max })
}

function uuid(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `${field} must be a UUID${nullable ? ' or null' : ''}.`)
  }
  return value
}

function optionalUuid(body: JsonObject, key: string): string | null {
  return uuid(body[key], key, true)
}

function timestamp(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be an ISO 8601 timestamp${nullable ? ' or null' : ''}.`)
  }
  return new Date(value).toISOString()
}

function dateValue(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${field} must be an ISO date${nullable ? ' or null' : ''}.`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${field} must be a valid calendar date.`)
  return value
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${field} must be a boolean.`)
  return value
}

function integer(value: unknown, field: string, min = 1, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `${field} must be an integer between ${min} and ${max}.`)
  return value
}

function queryLimit(request: FastifyRequest): number {
  const raw = ((request.query ?? {}) as JsonObject).limit
  if (raw === undefined) return 50
  const result = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(result) || result < 1 || result > 100) throw new HttpError(400, 'limit must be an integer between 1 and 100.')
  return result
}

function recordId(request: FastifyRequest): string {
  return uuid((request.params as { id?: unknown } | undefined)?.id, 'id') as string
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await work(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function assertUser(client: PoolClient, workspaceId: string, id: string | null, field = 'assigneeUserId') {
  if (!id) return
  const result = await client.query('SELECT 1 FROM users WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
  if (!result.rowCount) throw new HttpError(400, `${field} must identify a user in this workspace.`)
}

async function assertPeople(client: PoolClient, workspaceId: string, ids: Array<string | null>, field = 'personId') {
  const distinct = [...new Set(ids.filter((id): id is string => !!id))]
  if (!distinct.length) return
  const result = await client.query(
    `SELECT p.id FROM people p JOIN records r USING (workspace_id, id)
     WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[]) AND r.archived_at IS NULL`,
    [workspaceId, distinct],
  )
  if (result.rowCount !== distinct.length) throw new HttpError(400, `${field} must identify a person in this workspace.`)
}

async function assertRecords(client: PoolClient, workspaceId: string, ids: Array<string | null>, field: string) {
  const distinct = [...new Set(ids.filter((id): id is string => !!id))]
  if (!distinct.length) return
  const result = await client.query(
    'SELECT id FROM records WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL',
    [workspaceId, distinct],
  )
  if (result.rowCount !== distinct.length) throw new HttpError(400, `${field} must identify an active record in this workspace.`)
}

async function assertTypedRecords(client: PoolClient, workspaceId: string, ids: Array<string | null>, type: 'COMPANY' | 'OPPORTUNITY', field: string) {
  const distinct = [...new Set(ids.filter((id): id is string => !!id))]
  if (!distinct.length) return
  const result = await client.query(
    'SELECT id FROM records WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND record_type=$3 AND archived_at IS NULL',
    [workspaceId, distinct, type],
  )
  if (result.rowCount !== distinct.length) throw new HttpError(400, `${field} must identify active ${type.toLowerCase()} records in this workspace.`)
}

async function assertEvent(client: PoolClient, workspaceId: string, id: string) {
  const result = await client.query('SELECT id FROM events WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
  if (!result.rowCount) throw new HttpError(400, 'eventId must identify an event in this workspace.')
}

async function assertMeetingNote(client: PoolClient, workspaceId: string, id: string) {
  const result = await client.query('SELECT note_id FROM meeting_notes WHERE workspace_id=$1 AND note_id=$2', [workspaceId, id])
  if (!result.rowCount) throw new HttpError(400, 'sourceMeetingNoteId must identify a meeting note in this workspace.')
}

async function writeActivity(
  client: PoolClient,
  user: AuthUser,
  request: FastifyRequest,
  action: string,
  fields: string[],
  primaryRecordId: string | null = null,
) {
  await client.query(
    `INSERT INTO activity_events (workspace_id, actor_id, owner_user_id, action, primary_record_id, source, request_id, changed_fields)
     VALUES ($1, $2, $3, $4, $5, 'REST', $6, $7::jsonb)`,
    [user.workspaceId, user.actorId, user.userId, action, primaryRecordId, typeof request.id === 'string' ? request.id.slice(0, 200) : null, JSON.stringify({ fields })],
  )
}

function ensureTimeRange(start: string, end: string) {
  if (Date.parse(end) < Date.parse(start)) throw new HttpError(400, 'endAt must be on or after startAt.')
}

const EVENT_SELECT = `SELECT e.id, e.title, e.description, e.starts_at AS "startAt", e.ends_at AS "endAt",
  e.all_day AS "allDay", e.source_timezone AS "sourceTimezone", e.organizer, e.organizer_name AS "organizerName",
  e.organizer_email AS "organizerEmail",e.organizer_user_id AS "organizerUserId",e.location,
  e.meeting_url AS "meetingUrl", e.owner_user_id AS "ownerUserId", e.status, e.workflow_eligible AS "workflowEligible",
  e.source, e.exclusion_reason AS "exclusionReason", e.is_read_only AS "isReadOnly",
  (SELECT mn.status FROM meeting_notes mn WHERE mn.workspace_id=e.workspace_id AND mn.event_id=e.id) AS "meetingNoteStatus",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.full_name,'personId',p.id) ORDER BY p.full_name)
              FROM event_people ep JOIN people p ON p.workspace_id=ep.workspace_id AND p.id=ep.person_id
             WHERE ep.workspace_id=e.workspace_id AND ep.event_id=e.id), '[]'::jsonb) AS attendees,
  e.created_at AS "createdAt", e.updated_at AS "updatedAt",
  COALESCE((SELECT array_agg(ep.person_id ORDER BY ep.person_id) FROM event_people ep WHERE ep.workspace_id=e.workspace_id AND ep.event_id=e.id), ARRAY[]::uuid[]) AS "personIds",
  COALESCE((SELECT array_agg(ec.company_id ORDER BY ec.company_id) FROM event_companies ec WHERE ec.workspace_id=e.workspace_id AND ec.event_id=e.id), ARRAY[]::uuid[]) AS "companyIds",
  COALESCE((SELECT array_agg(eo.opportunity_id ORDER BY eo.opportunity_id) FROM event_opportunities eo WHERE eo.workspace_id=e.workspace_id AND eo.event_id=e.id), ARRAY[]::uuid[]) AS "opportunityIds"
  FROM events e WHERE e.workspace_id = $1 AND e.source = 'LOCAL'`

async function replaceEventRelations(
  client: PoolClient,
  workspaceId: string,
  eventId: string,
  actorId: string,
  relations: { personIds?: string[]; companyIds?: string[]; opportunityIds?: string[] },
) {
  for (const [key, table, column] of [
    ['personIds', 'event_people', 'person_id'],
    ['companyIds', 'event_companies', 'company_id'],
    ['opportunityIds', 'event_opportunities', 'opportunity_id'],
  ] as const) {
    const ids = relations[key]
    if (ids === undefined) continue
    await client.query(`DELETE FROM ${table} WHERE workspace_id=$1 AND event_id=$2`, [workspaceId, eventId])
    if (ids.length) {
      await client.query(
        `INSERT INTO ${table} (workspace_id, event_id, ${column}, created_by_actor_id)
         SELECT $1, $2, vals.id, $4 FROM unnest($3::uuid[]) AS vals(id)`,
        [workspaceId, eventId, ids, actorId],
      )
    }
  }
}

function uuidArray(body: JsonObject, key: string): string[] | undefined {
  if (!has(body, key)) return undefined
  if (!Array.isArray(body[key]) || body[key].length > 100) throw new HttpError(400, `${key} must be an array of at most 100 UUIDs.`)
  return [...new Set((body[key] as unknown[]).map((value, index) => uuid(value, `${key}[${index}]`) as string))]
}

type StepInput = {
  id?: string
  position: number
  fromPersonId: string | null
  toPersonId: string
  responsibleUserId: string | null
  responsiblePersonId: string | null
  status: string
  notes: string | null
  requestedAt: string | null
  followUpAt: string | null
}

const STEP_STATUSES = ['PLANNED', 'PENDING', 'REQUESTED', 'ACCEPTED', 'INTRODUCED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'SKIPPED']
const TERMINAL_STEP_STATUSES = ['INTRODUCED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'SKIPPED']

function parseSteps(value: unknown): StepInput[] {
  if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, 'steps must be an array of at most 100 steps.')
  const steps = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, `steps[${index}] must be an object.`)
    const body = item as JsonObject
    rejectUnknown(body, ['id', 'position', 'fromPersonId', 'toPersonId', 'responsibleUserId', 'responsiblePersonId', 'status', 'notes', 'requestedAt', 'followUpAt'])
    const status = has(body, 'status') ? requiredText(body, 'status', 30).toUpperCase() : 'PLANNED'
    if (!STEP_STATUSES.includes(status)) throw new HttpError(400, `steps[${index}].status is not supported.`)
    return {
      id: has(body, 'id') ? uuid(body.id, `steps[${index}].id`) as string : undefined,
      position: integer(body.position, `steps[${index}].position`),
      fromPersonId: has(body, 'fromPersonId') ? uuid(body.fromPersonId, `steps[${index}].fromPersonId`, true) : null,
      toPersonId: uuid(body.toPersonId, `steps[${index}].toPersonId`) as string,
      responsibleUserId: has(body, 'responsibleUserId') ? uuid(body.responsibleUserId, `steps[${index}].responsibleUserId`, true) : null,
      responsiblePersonId: has(body, 'responsiblePersonId') ? uuid(body.responsiblePersonId, `steps[${index}].responsiblePersonId`, true) : null,
      status,
      notes: has(body, 'notes') ? optionalText(body, 'notes', 20_000) : null,
      requestedAt: has(body, 'requestedAt') ? timestamp(body.requestedAt, `steps[${index}].requestedAt`, true) : null,
      followUpAt: has(body, 'followUpAt') ? timestamp(body.followUpAt, `steps[${index}].followUpAt`, true) : null,
    }
  })
  const positions = steps.map((step) => step.position)
  if (new Set(positions).size !== positions.length) throw new HttpError(400, 'Step positions must be unique within an introduction.')
  return steps
}

async function validateSteps(client: PoolClient, workspaceId: string, targetPersonId: string, steps: StepInput[]) {
  await assertPeople(client, workspaceId, [targetPersonId, ...steps.flatMap((step) => [step.fromPersonId, step.toPersonId, step.responsiblePersonId])], 'step person IDs')
  for (const step of steps) {
    await assertUser(client, workspaceId, step.responsibleUserId, 'responsibleUserId')
    if ((step.responsibleUserId !== null) === (step.responsiblePersonId !== null)) {
      throw new HttpError(400, 'Each step must have exactly one responsibleUserId or responsiblePersonId.')
    }
    if (step.fromPersonId && step.fromPersonId === step.toPersonId) throw new HttpError(400, 'fromPersonId and toPersonId must be different.')
    if (step.requestedAt && step.followUpAt && Date.parse(step.followUpAt) < Date.parse(step.requestedAt)) throw new HttpError(400, 'followUpAt must be on or after requestedAt.')
  }
}

async function applySteps(client: PoolClient, workspaceId: string, chainId: string, steps: StepInput[], userActorId: string) {
  const existing = await client.query('SELECT id,position FROM introduction_steps WHERE workspace_id=$1 AND chain_id=$2 FOR UPDATE', [workspaceId, chainId])
  const existingIds = new Set<string>(existing.rows.map((row: { id: string }) => row.id))
  for (const step of steps) {
    if (step.id && !existingIds.has(step.id)) throw new HttpError(400, 'Each supplied step id must belong to this introduction.')
  }
  if (existingIds.size) {
    // Move existing positions out of the client-visible range first so edits can reorder steps
    // without tripping the database's per-chain unique position constraint.
    const offset = Math.max(...existing.rows.map((row: { position: number }) => Number(row.position))) + 1
    await client.query(
      'UPDATE introduction_steps SET position=position+$3,updated_at=now(),updated_by_actor_id=$4 WHERE workspace_id=$1 AND chain_id=$2',
      [workspaceId, chainId, offset, userActorId],
    )
  }
  const keep = steps.flatMap((step) => step.id ? [step.id] : [])
  for (const step of steps) {
    if (step.id) {
      await client.query(
        `UPDATE introduction_steps SET position=$4, from_person_id=$5, to_person_id=$6, responsible_user_id=$7,
         responsible_person_id=$8, status=$9, notes=$10, requested_at=$11, follow_up_at=$12, updated_at=now(),updated_by_actor_id=$13
         WHERE workspace_id=$1 AND chain_id=$2 AND id=$3`,
        [workspaceId, chainId, step.id, step.position, step.fromPersonId, step.toPersonId, step.responsibleUserId,
           step.responsiblePersonId, step.status, step.notes, step.requestedAt, step.followUpAt, userActorId],
      )
    } else {
      const created = await client.query(
        `INSERT INTO introduction_steps
         (workspace_id, chain_id, position, from_person_id, to_person_id, responsible_user_id, responsible_person_id, status, notes, requested_at, follow_up_at, created_by_actor_id, updated_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [workspaceId, chainId, step.position, step.fromPersonId, step.toPersonId, step.responsibleUserId,
          step.responsiblePersonId, step.status, step.notes, step.requestedAt, step.followUpAt, userActorId],
      )
      keep.push(created.rows[0].id as string)
    }
  }
  await client.query(
    `WITH omitted AS (
       SELECT id,row_number() OVER (ORDER BY id)::integer AS offset
       FROM introduction_steps WHERE workspace_id=$1 AND chain_id=$2 AND NOT (id=ANY($3::uuid[]))
     )
     UPDATE introduction_steps s SET position=1000000+omitted.offset,
        status=CASE WHEN s.status = ANY($5::text[]) THEN s.status ELSE 'SKIPPED' END,
        updated_at=now(),updated_by_actor_id=$4
     FROM omitted WHERE s.workspace_id=$1 AND s.chain_id=$2 AND s.id=omitted.id`,
    [workspaceId, chainId, keep, userActorId, TERMINAL_STEP_STATUSES],
  )
}

const INTRO_SELECT = `SELECT c.id, c.target_person_id AS "targetPersonId", c.owner_user_id AS "ownerUserId",
  target.full_name AS "targetPersonName", owner.full_name AS "ownerName",
  c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  (SELECT s.position FROM introduction_steps s WHERE s.workspace_id=c.workspace_id AND s.chain_id=c.id AND c.status='ACTIVE'
     AND s.status <> ALL(ARRAY['INTRODUCED','COMPLETED','DECLINED','CANCELLED','SKIPPED']::text[]) ORDER BY s.position LIMIT 1) AS "currentStep",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'position', s.position, 'fromPersonId', s.from_person_id, 'toPersonId', s.to_person_id,
     'responsibleUserId', s.responsible_user_id, 'responsiblePersonId', s.responsible_person_id,
     'fromPersonName', source.full_name, 'toPersonName', destination.full_name,
     'responsibleUserName', responsible_user.full_name, 'responsiblePersonName', responsible_person.full_name,
     'status', s.status, 'notes', s.notes, 'requestedAt', s.requested_at, 'followUpAt', s.follow_up_at
   ) ORDER BY s.position)
     FROM introduction_steps s
     LEFT JOIN people source ON source.workspace_id=s.workspace_id AND source.id=s.from_person_id
     JOIN people destination ON destination.workspace_id=s.workspace_id AND destination.id=s.to_person_id
     LEFT JOIN users responsible_user ON responsible_user.workspace_id=s.workspace_id AND responsible_user.id=s.responsible_user_id
     LEFT JOIN people responsible_person ON responsible_person.workspace_id=s.workspace_id AND responsible_person.id=s.responsible_person_id
    WHERE s.workspace_id=c.workspace_id AND s.chain_id=c.id), '[]'::jsonb) AS steps
   FROM introduction_chains c
   JOIN people target ON target.workspace_id=c.workspace_id AND target.id=c.target_person_id
   JOIN users owner ON owner.workspace_id=c.workspace_id AND owner.id=c.owner_user_id
  WHERE c.workspace_id=$1`

export function registerWorkflowRoutes(app: FastifyInstance, { pool }: WorkflowOptions): void {
  // Local events
  app.get('/api/v1/events', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${EVENT_SELECT} ORDER BY e.starts_at DESC, e.id LIMIT $2`, [user.workspaceId, queryLimit(request)])
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/events', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['title', 'description', 'startAt', 'endAt', 'allDay', 'sourceTimezone', 'organizer', 'organizerName', 'organizerEmail', 'organizerUserId', 'location', 'meetingUrl', 'status', 'ownerUserId', 'personIds', 'companyIds', 'opportunityIds'])
    const title = requiredText(body, 'title')
    const description = has(body, 'description') ? optionalText(body, 'description', 20_000) : null
    const startAt = timestamp(body.startAt, 'startAt') as string
    const endAt = timestamp(body.endAt, 'endAt') as string
    ensureTimeRange(startAt, endAt)
    const allDay = has(body, 'allDay') ? bool(body.allDay, 'allDay') : false
    const sourceTimezone = has(body, 'sourceTimezone') ? requiredText(body, 'sourceTimezone', 100) : 'Europe/Budapest'
    const organizer = has(body, 'organizer') ? optionalText(body, 'organizer', 500) : null
    const organizerName = has(body, 'organizerName') ? optionalText(body, 'organizerName', 500) : null
    const organizerEmail = has(body, 'organizerEmail') ? optionalText(body, 'organizerEmail', 320) : null
    if (organizerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organizerEmail)) throw new HttpError(400, 'organizerEmail must be a valid email address.')
    const organizerUserId = has(body, 'organizerUserId') ? optionalUuid(body, 'organizerUserId') : null
    const location = has(body, 'location') ? optionalText(body, 'location', 2_000) : null
    const meetingUrl = has(body, 'meetingUrl') ? optionalText(body, 'meetingUrl', 2_000) : null
    const status = has(body, 'status') ? requiredText(body, 'status', 30).toUpperCase() : 'CONFIRMED'
    if (!['CONFIRMED', 'TENTATIVE', 'CANCELLED'].includes(status)) throw new HttpError(400, 'status must be CONFIRMED, TENTATIVE or CANCELLED.')
    const ownerUserId = has(body, 'ownerUserId') ? optionalUuid(body, 'ownerUserId') : user.userId
    const personIds = uuidArray(body, 'personIds') ?? []
    const companyIds = uuidArray(body, 'companyIds') ?? []
    const opportunityIds = uuidArray(body, 'opportunityIds') ?? []
    const created = await transaction(pool, async (client) => {
      await assertUser(client, user.workspaceId, ownerUserId, 'ownerUserId')
      await assertUser(client, user.workspaceId, organizerUserId, 'organizerUserId')
      await assertPeople(client, user.workspaceId, personIds, 'personIds')
      await assertTypedRecords(client, user.workspaceId, companyIds, 'COMPANY', 'companyIds')
      await assertTypedRecords(client, user.workspaceId, opportunityIds, 'OPPORTUNITY', 'opportunityIds')
      const row = await client.query(
        `INSERT INTO events (workspace_id, title, description, starts_at, ends_at, all_day, source_timezone, organizer, organizer_name, organizer_email, organizer_user_id, location, meeting_url, status, source, is_read_only, owner_user_id, created_by_actor_id, updated_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'LOCAL',false,$15,$16,$16) RETURNING id`,
        [user.workspaceId, title, description, startAt, endAt, allDay, sourceTimezone, organizer, organizerName, organizerEmail, organizerUserId, location, meetingUrl, status, ownerUserId, user.actorId],
      )
      const id = row.rows[0].id as string
      await replaceEventRelations(client, user.workspaceId, id, user.actorId, { personIds, companyIds, opportunityIds })
      await writeActivity(client, user, request, 'LOCAL_EVENT_CREATED', ['title', 'startAt', 'endAt', 'allDay', 'sourceTimezone', 'organizer', 'organizerName', 'organizerEmail', 'organizerUserId', 'location', 'meetingUrl', 'status', 'ownerUserId', 'personIds', 'companyIds', 'opportunityIds'])
      return id
    })
    const result = await pool.query(`${EVENT_SELECT} AND e.id=$2`, [user.workspaceId, created])
    return reply.code(201).send(result.rows[0])
  }))

  app.get('/api/v1/events/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${EVENT_SELECT} AND e.id=$2`, [user.workspaceId, recordId(request)])
    if (!result.rowCount) throw new HttpError(404, 'Event not found.')
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/events/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['title', 'description', 'startAt', 'endAt', 'allDay', 'sourceTimezone', 'organizer', 'organizerName', 'organizerEmail', 'organizerUserId', 'location', 'meetingUrl', 'status', 'ownerUserId', 'personIds', 'companyIds', 'opportunityIds'])
    const columns: Array<{ column: string; value: unknown; field: string }> = []
    if (has(body, 'title')) columns.push({ column: 'title', value: requiredText(body, 'title'), field: 'title' })
    if (has(body, 'description')) columns.push({ column: 'description', value: optionalText(body, 'description', 20_000), field: 'description' })
    if (has(body, 'allDay')) columns.push({ column: 'all_day', value: bool(body.allDay, 'allDay'), field: 'allDay' })
    if (has(body, 'sourceTimezone')) columns.push({ column: 'source_timezone', value: requiredText(body, 'sourceTimezone', 100), field: 'sourceTimezone' })
    if (has(body, 'organizer')) columns.push({ column: 'organizer', value: optionalText(body, 'organizer', 500), field: 'organizer' })
    if (has(body, 'organizerName')) columns.push({ column: 'organizer_name', value: optionalText(body, 'organizerName', 500), field: 'organizerName' })
    if (has(body, 'organizerEmail')) {
      const organizerEmail = optionalText(body, 'organizerEmail', 320)
      if (organizerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organizerEmail)) throw new HttpError(400, 'organizerEmail must be a valid email address.')
      columns.push({ column: 'organizer_email', value: organizerEmail, field: 'organizerEmail' })
    }
    if (has(body, 'organizerUserId')) columns.push({ column: 'organizer_user_id', value: optionalUuid(body, 'organizerUserId'), field: 'organizerUserId' })
    if (has(body, 'location')) columns.push({ column: 'location', value: optionalText(body, 'location', 2_000), field: 'location' })
    if (has(body, 'meetingUrl')) columns.push({ column: 'meeting_url', value: optionalText(body, 'meetingUrl', 2_000), field: 'meetingUrl' })
    if (has(body, 'status')) {
      const status = requiredText(body, 'status', 30).toUpperCase()
      if (!['CONFIRMED', 'TENTATIVE', 'CANCELLED'].includes(status)) throw new HttpError(400, 'status must be CONFIRMED, TENTATIVE or CANCELLED.')
      columns.push({ column: 'status', value: status, field: 'status' })
    }
    if (has(body, 'ownerUserId')) columns.push({ column: 'owner_user_id', value: optionalUuid(body, 'ownerUserId'), field: 'ownerUserId' })
    const startAt = has(body, 'startAt') ? timestamp(body.startAt, 'startAt') as string : undefined
    const endAt = has(body, 'endAt') ? timestamp(body.endAt, 'endAt') as string : undefined
    if (startAt !== undefined) columns.push({ column: 'starts_at', value: startAt, field: 'startAt' })
    if (endAt !== undefined) columns.push({ column: 'ends_at', value: endAt, field: 'endAt' })
    const personIds = uuidArray(body, 'personIds')
    const companyIds = uuidArray(body, 'companyIds')
    const opportunityIds = uuidArray(body, 'opportunityIds')
    const changed = [...columns.map((column) => column.field), ...(personIds ? ['personIds'] : []), ...(companyIds ? ['companyIds'] : []), ...(opportunityIds ? ['opportunityIds'] : [])]
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')
    await transaction(pool, async (client) => {
      const locked = await client.query('SELECT starts_at,ends_at FROM events WHERE workspace_id=$1 AND id=$2 AND source=\'LOCAL\' FOR UPDATE', [user.workspaceId, id])
      if (!locked.rowCount) throw new HttpError(404, 'Local event not found.')
      await assertUser(client, user.workspaceId, columns.find((column) => column.field === 'ownerUserId')?.value as string | null | undefined ?? null, 'ownerUserId')
      await assertUser(client, user.workspaceId, columns.find((column) => column.field === 'organizerUserId')?.value as string | null | undefined ?? null, 'organizerUserId')
      await assertPeople(client, user.workspaceId, personIds ?? [], 'personIds')
      await assertTypedRecords(client, user.workspaceId, companyIds ?? [], 'COMPANY', 'companyIds')
      await assertTypedRecords(client, user.workspaceId, opportunityIds ?? [], 'OPPORTUNITY', 'opportunityIds')
      ensureTimeRange(startAt ?? new Date(locked.rows[0].starts_at).toISOString(), endAt ?? new Date(locked.rows[0].ends_at).toISOString())
      const assignments = columns.map(({ column }, index) => `${column}=$${index + 3}`).join(', ')
      if (columns.length) await client.query(`UPDATE events SET ${assignments}, updated_at=now(),updated_by_actor_id=$${columns.length + 3} WHERE workspace_id=$1 AND id=$2`, [user.workspaceId, id, ...columns.map(({ value }) => value), user.actorId])
      else await client.query('UPDATE events SET updated_at=now(),updated_by_actor_id=$3 WHERE workspace_id=$1 AND id=$2', [user.workspaceId, id, user.actorId])
      await replaceEventRelations(client, user.workspaceId, id, user.actorId, { personIds, companyIds, opportunityIds })
      await writeActivity(client, user, request, 'LOCAL_EVENT_UPDATED', changed)
    })
    const result = await pool.query(`${EVENT_SELECT} AND e.id=$2`, [user.workspaceId, id])
    return reply.send(result.rows[0])
  }))

  app.delete('/api/v1/events/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    await transaction(pool, async (client) => {
      const cancelled = await client.query(`UPDATE events SET status='CANCELLED',updated_at=now(),updated_by_actor_id=$3
        WHERE workspace_id=$1 AND id=$2 AND source='LOCAL' RETURNING id`, [user.workspaceId, id, user.actorId])
      if (!cancelled.rowCount) throw new HttpError(404, 'Local event not found.')
      await writeActivity(client, user, request, 'LOCAL_EVENT_DELETED', ['deleted'])
    })
    return reply.code(204).send()
  }))

  // Follow-ups
  const FOLLOW_UP_SELECT = `SELECT f.id,f.title,f.body,f.due_at AS "dueAt",f.assignee_user_id AS "assigneeUserId",u.full_name AS "assigneeName",f.status,f.source,
    f.source_event_id AS "sourceEventId",f.source_meeting_note_id AS "sourceMeetingNoteId",
    f.completed_at AS "completedAt",f.completed_by_actor_id AS "completedByActorId",
    f.cancelled_at AS "cancelledAt",f.cancelled_by_actor_id AS "cancelledByActorId",f.cancellation_reason AS "cancellationReason",
    f.created_at AS "createdAt",f.updated_at AS "updatedAt",
    COALESCE((SELECT array_agg(fr.record_id ORDER BY fr.record_id) FROM follow_up_records fr WHERE fr.workspace_id=f.workspace_id AND fr.follow_up_id=f.id),ARRAY[]::uuid[]) AS "relatedRecordIds",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'type',r.record_type,'name',COALESCE(p.full_name,c.name,o.name,n.title)) ORDER BY r.record_type, r.id)
                FROM follow_up_records fr JOIN records r ON r.workspace_id=fr.workspace_id AND r.id=fr.record_id
                LEFT JOIN people p ON p.workspace_id=r.workspace_id AND p.id=r.id
                LEFT JOIN companies c ON c.workspace_id=r.workspace_id AND c.id=r.id
                LEFT JOIN opportunities o ON o.workspace_id=r.workspace_id AND o.id=r.id
                LEFT JOIN notes n ON n.workspace_id=r.workspace_id AND n.id=r.id
               WHERE fr.workspace_id=f.workspace_id AND fr.follow_up_id=f.id), '[]'::jsonb) AS "relatedRecords"
    FROM follow_ups f LEFT JOIN users u ON u.workspace_id=f.workspace_id AND u.id=f.assignee_user_id WHERE f.workspace_id=$1`

  app.get('/api/v1/follow-ups', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${FOLLOW_UP_SELECT} ORDER BY f.due_at, f.created_at DESC, f.id LIMIT $2`, [user.workspaceId, queryLimit(request)])
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/follow-ups', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['title', 'body', 'dueAt', 'assigneeUserId', 'source', 'sourceEventId', 'sourceMeetingNoteId', 'relatedRecordIds'])
    const title = requiredText(body, 'title')
    const description = has(body, 'body') ? optionalText(body, 'body', 20_000) ?? '' : ''
    const dueAt = timestamp(body.dueAt, 'dueAt') as string
    const assigneeUserId = has(body, 'assigneeUserId') ? optionalUuid(body, 'assigneeUserId') : user.userId
    const source = has(body, 'source') ? requiredText(body, 'source', 30).toUpperCase() : 'MANUAL'
    const validSources = ['MANUAL', 'MEETING', 'MEETING_NOTE', 'SALES_EMAIL', 'EVENT', 'OPPORTUNITY', 'INTRODUCTION', 'IMPORT', 'SYSTEM']
    if (!validSources.includes(source)) throw new HttpError(400, 'source is not supported.')
    const sourceEventId = has(body, 'sourceEventId') ? optionalUuid(body, 'sourceEventId') : null
    const sourceMeetingNoteId = has(body, 'sourceMeetingNoteId') ? optionalUuid(body, 'sourceMeetingNoteId') : null
    const relatedRecordIds = uuidArray(body, 'relatedRecordIds') ?? []
    if (sourceEventId && sourceMeetingNoteId) throw new HttpError(400, 'Provide at most one of sourceEventId or sourceMeetingNoteId.')
    if (source === 'EVENT' && !sourceEventId) throw new HttpError(400, 'sourceEventId is required when source is EVENT.')
    if (source === 'MEETING_NOTE' && !sourceMeetingNoteId) throw new HttpError(400, 'sourceMeetingNoteId is required when source is MEETING_NOTE.')
    if (sourceEventId && source !== 'EVENT') throw new HttpError(400, 'sourceEventId is only valid when source is EVENT.')
    if (sourceMeetingNoteId && source !== 'MEETING_NOTE') throw new HttpError(400, 'sourceMeetingNoteId is only valid when source is MEETING_NOTE.')
    const result = await transaction(pool, async (client) => {
      await assertUser(client, user.workspaceId, assigneeUserId)
      if (sourceEventId) await assertEvent(client, user.workspaceId, sourceEventId)
      if (sourceMeetingNoteId) await assertMeetingNote(client, user.workspaceId, sourceMeetingNoteId)
      await assertRecords(client, user.workspaceId, relatedRecordIds, 'relatedRecordIds')
      const inserted = await client.query(
        `INSERT INTO follow_ups (workspace_id,title,body,due_at,assignee_user_id,status,source,source_event_id,source_meeting_note_id,created_by_actor_id,updated_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,'OPEN',$6,$7,$8,$9,$9) RETURNING id`,
        [user.workspaceId, title, description, dueAt, assigneeUserId, source, sourceEventId, sourceMeetingNoteId, user.actorId],
      )
      const id = inserted.rows[0].id as string
      if (relatedRecordIds.length) {
        await client.query(
          `INSERT INTO follow_up_records (workspace_id,follow_up_id,record_id,created_by_actor_id)
           SELECT $1,$2,ids.id,$4 FROM unnest($3::uuid[]) AS ids(id)`,
          [user.workspaceId, id, relatedRecordIds, user.actorId],
        )
      }
      await writeActivity(client, user, request, 'FOLLOW_UP_CREATED', ['title', 'body', 'dueAt', 'assigneeUserId', 'source', 'sourceEventId', 'sourceMeetingNoteId', 'relatedRecordIds'])
      return id
    })
    const created = await pool.query(`${FOLLOW_UP_SELECT} AND f.id=$2`, [user.workspaceId, result])
    return reply.code(201).send(created.rows[0])
  }))

  app.get('/api/v1/follow-ups/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${FOLLOW_UP_SELECT} AND f.id=$2`, [user.workspaceId, recordId(request)])
    if (!result.rowCount) throw new HttpError(404, 'Follow-up not found.')
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/follow-ups/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['title', 'body', 'dueAt', 'assigneeUserId', 'status', 'cancellationReason', 'relatedRecordIds'])
    const columns: Array<{ column: string; value: unknown; field: string }> = []
    if (has(body, 'title')) columns.push({ column: 'title', value: requiredText(body, 'title'), field: 'title' })
    if (has(body, 'body')) columns.push({ column: 'body', value: optionalText(body, 'body', 20_000) ?? '', field: 'body' })
    if (has(body, 'dueAt')) columns.push({ column: 'due_at', value: timestamp(body.dueAt, 'dueAt'), field: 'dueAt' })
    if (has(body, 'assigneeUserId')) columns.push({ column: 'assignee_user_id', value: optionalUuid(body, 'assigneeUserId'), field: 'assigneeUserId' })
    let cancellationReason = has(body, 'cancellationReason') ? text(body.cancellationReason, 'cancellationReason', { nullable: true, max: 2_000 }) : undefined
    const relatedRecordIds = uuidArray(body, 'relatedRecordIds')
    if (relatedRecordIds) columns.push({ column: 'relatedRecordIds', value: relatedRecordIds, field: 'relatedRecordIds' })
    let nextStatus: string | undefined
    if (has(body, 'status')) {
      nextStatus = requiredText(body, 'status', 30).toUpperCase()
      if (!['OPEN', 'COMPLETED', 'CANCELLED'].includes(nextStatus)) throw new HttpError(400, 'status must be OPEN, COMPLETED or CANCELLED.')
      columns.push({ column: 'status', value: nextStatus, field: 'status' })
    }
    if (nextStatus === 'CANCELLED' && !cancellationReason) cancellationReason = 'Cancelled by user.'
    if (cancellationReason !== undefined && nextStatus !== 'CANCELLED') throw new HttpError(400, 'cancellationReason can only be supplied when cancelling a follow-up.')
    if (cancellationReason !== undefined) columns.push({ column: 'cancellation_reason', value: cancellationReason, field: 'cancellationReason' })
    if (!columns.length) throw new HttpError(400, 'At least one field to update is required.')
    await transaction(pool, async (client) => {
      const current = await client.query('SELECT status FROM follow_ups WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [user.workspaceId, id])
      if (!current.rowCount) throw new HttpError(404, 'Follow-up not found.')
      if (current.rows[0].status !== 'OPEN') throw new HttpError(409, 'A completed or cancelled follow-up cannot be edited.')
      if (nextStatus && current.rows[0].status !== nextStatus) {
        if (current.rows[0].status !== 'OPEN') throw new HttpError(409, 'A completed or cancelled follow-up cannot be reopened or changed.')
      }
      await assertUser(client, user.workspaceId, columns.find((column) => column.field === 'assigneeUserId')?.value as string | null | undefined ?? null)
      const relationValues = columns.find((column) => column.field === 'relatedRecordIds')?.value as string[] | undefined
      if (relationValues) await assertRecords(client, user.workspaceId, relationValues, 'relatedRecordIds')
      const sqlColumns = columns.filter((column) => column.field !== 'relatedRecordIds')
      const assignments = sqlColumns.map(({ column }, index) => `${column}=$${index + 3}`).join(', ')
      const fields = columns.map((column) => column.field)
      const values = sqlColumns.map(({ value }) => value)
      if (nextStatus === 'COMPLETED') {
        await client.query(
          `UPDATE follow_ups SET ${assignments}, completed_at=now(), completed_by_actor_id=$${values.length + 3}, updated_at=now(),updated_by_actor_id=$${values.length + 4} WHERE workspace_id=$1 AND id=$2`,
          [user.workspaceId, id, ...values, user.actorId, user.actorId],
        )
      } else if (nextStatus === 'CANCELLED') {
        await client.query(
          `UPDATE follow_ups SET ${assignments}, cancelled_at=now(), cancelled_by_actor_id=$${values.length + 3}, updated_at=now(),updated_by_actor_id=$${values.length + 4} WHERE workspace_id=$1 AND id=$2`,
          [user.workspaceId, id, ...values, user.actorId, user.actorId],
        )
      } else if (sqlColumns.length) {
        await client.query(`UPDATE follow_ups SET ${assignments}, updated_at=now(),updated_by_actor_id=$${values.length + 3} WHERE workspace_id=$1 AND id=$2`, [user.workspaceId, id, ...values, user.actorId])
      } else {
        await client.query('UPDATE follow_ups SET updated_at=now(),updated_by_actor_id=$3 WHERE workspace_id=$1 AND id=$2', [user.workspaceId, id, user.actorId])
      }
      if (relationValues) {
        await client.query('DELETE FROM follow_up_records WHERE workspace_id=$1 AND follow_up_id=$2', [user.workspaceId, id])
        if (relationValues.length) await client.query(
          `INSERT INTO follow_up_records (workspace_id,follow_up_id,record_id,created_by_actor_id)
           SELECT $1,$2,ids.id,$4 FROM unnest($3::uuid[]) AS ids(id)`, [user.workspaceId, id, relationValues, user.actorId],
        )
      }
      await writeActivity(client, user, request, nextStatus === 'CANCELLED' ? 'FOLLOW_UP_CANCELLED' : nextStatus === 'COMPLETED' ? 'FOLLOW_UP_COMPLETED' : 'FOLLOW_UP_UPDATED', fields)
    })
    const result = await pool.query(`${FOLLOW_UP_SELECT} AND f.id=$2`, [user.workspaceId, id])
    return reply.send(result.rows[0])
  }))

  app.delete('/api/v1/follow-ups/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    await transaction(pool, async (client) => {
      const deleted = await client.query(`UPDATE follow_ups SET status='CANCELLED',cancellation_reason='Deleted by user',cancelled_at=now(),cancelled_by_actor_id=$3,updated_at=now(),updated_by_actor_id=$3
        WHERE workspace_id=$1 AND id=$2 AND status='OPEN' RETURNING id`, [user.workspaceId, id, user.actorId])
      if (!deleted.rowCount) throw new HttpError(404, 'Open follow-up not found.')
      await writeActivity(client, user, request, 'FOLLOW_UP_CANCELLED', ['status', 'cancellationReason'])
    })
    return reply.code(204).send()
  }))

  // Introduction chains and their ordered steps. Supplying `steps` replaces the full step list.
  app.get('/api/v1/introductions', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${INTRO_SELECT} ORDER BY c.updated_at DESC,c.id LIMIT $2`, [user.workspaceId, queryLimit(request)])
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/introductions', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['targetPersonId', 'ownerUserId', 'status', 'steps'])
    const targetPersonId = uuid(body.targetPersonId, 'targetPersonId') as string
    const ownerUserId = has(body, 'ownerUserId') ? optionalUuid(body, 'ownerUserId') : user.userId
    if (!ownerUserId) throw new HttpError(400, 'ownerUserId is required.')
    const status = has(body, 'status') ? requiredText(body, 'status', 30).toUpperCase() : 'ACTIVE'
    if (!['ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status)) throw new HttpError(400, 'status must be ACTIVE, COMPLETED or CANCELLED.')
    const steps = has(body, 'steps') ? parseSteps(body.steps) : []
    for (const step of steps) {
      if (!step.responsibleUserId && !step.responsiblePersonId) step.responsibleUserId = ownerUserId
    }
    const id = await transaction(pool, async (client) => {
      await assertPeople(client, user.workspaceId, [targetPersonId], 'targetPersonId')
      await assertUser(client, user.workspaceId, ownerUserId, 'ownerUserId')
      await validateSteps(client, user.workspaceId, targetPersonId, steps)
      const created = await client.query(
        `INSERT INTO introduction_chains (workspace_id,target_person_id,owner_user_id,status,created_by_actor_id,updated_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [user.workspaceId, targetPersonId, ownerUserId, status, user.actorId],
      )
      const chainId = created.rows[0].id as string
      if (steps.length) await applySteps(client, user.workspaceId, chainId, steps, user.actorId)
      await writeActivity(client, user, request, 'INTRODUCTION_CREATED', ['targetPersonId', 'ownerUserId', 'status', ...(steps.length ? ['steps'] : [])])
      return chainId
    })
    const result = await pool.query(`${INTRO_SELECT} AND c.id=$2`, [user.workspaceId, id])
    return reply.code(201).send(result.rows[0])
  }))

  app.get('/api/v1/introductions/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${INTRO_SELECT} AND c.id=$2`, [user.workspaceId, recordId(request)])
    if (!result.rowCount) throw new HttpError(404, 'Introduction not found.')
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/introductions/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['targetPersonId', 'ownerUserId', 'status', 'steps'])
    const columns: Array<{ column: string; value: unknown; field: string }> = []
    if (has(body, 'targetPersonId')) columns.push({ column: 'target_person_id', value: uuid(body.targetPersonId, 'targetPersonId'), field: 'targetPersonId' })
    if (has(body, 'ownerUserId')) {
      const ownerUserId = optionalUuid(body, 'ownerUserId')
      if (!ownerUserId) throw new HttpError(400, 'ownerUserId cannot be null.')
      columns.push({ column: 'owner_user_id', value: ownerUserId, field: 'ownerUserId' })
    }
    let status: string | undefined
    if (has(body, 'status')) {
      status = requiredText(body, 'status', 30).toUpperCase()
      if (!['ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status)) throw new HttpError(400, 'status must be ACTIVE, COMPLETED or CANCELLED.')
      columns.push({ column: 'status', value: status, field: 'status' })
    }
    const steps = has(body, 'steps') ? parseSteps(body.steps) : undefined
    const changed = [...columns.map((column) => column.field), ...(steps ? ['steps'] : [])]
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')
    await transaction(pool, async (client) => {
      const current = await client.query('SELECT target_person_id,status FROM introduction_chains WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [user.workspaceId, id])
      if (!current.rowCount) throw new HttpError(404, 'Introduction not found.')
      if (current.rows[0].status !== 'ACTIVE') throw new HttpError(409, 'A completed or cancelled introduction cannot be edited.')
      const targetPersonId = (columns.find((column) => column.field === 'targetPersonId')?.value as string | undefined) ?? current.rows[0].target_person_id as string
      await assertPeople(client, user.workspaceId, [targetPersonId], 'targetPersonId')
      await assertUser(client, user.workspaceId, columns.find((column) => column.field === 'ownerUserId')?.value as string | null | undefined ?? null, 'ownerUserId')
      if (steps) await validateSteps(client, user.workspaceId, targetPersonId, steps)
      if (columns.length) {
        const assignments = columns.map(({ column }, index) => `${column}=$${index + 3}`).join(', ')
        await client.query(`UPDATE introduction_chains SET ${assignments},updated_at=now(),updated_by_actor_id=$${columns.length + 3} WHERE workspace_id=$1 AND id=$2`, [user.workspaceId, id, ...columns.map(({ value }) => value), user.actorId])
      }
      if (steps) {
        if (!columns.length) await client.query('UPDATE introduction_chains SET updated_at=now(),updated_by_actor_id=$3 WHERE workspace_id=$1 AND id=$2', [user.workspaceId, id, user.actorId])
        await applySteps(client, user.workspaceId, id, steps, user.actorId)
      }
      await writeActivity(client, user, request, 'INTRODUCTION_UPDATED', changed)
    })
    const result = await pool.query(`${INTRO_SELECT} AND c.id=$2`, [user.workspaceId, id])
    return reply.send(result.rows[0])
  }))

  app.delete('/api/v1/introductions/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    await transaction(pool, async (client) => {
      const cancelled = await client.query(`UPDATE introduction_chains SET status='CANCELLED',updated_at=now(),updated_by_actor_id=$3
        WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' RETURNING id`, [user.workspaceId, id, user.actorId])
      if (!cancelled.rowCount) throw new HttpError(404, 'Active introduction not found.')
      await writeActivity(client, user, request, 'INTRODUCTION_CANCELLED', ['status'])
    })
    return reply.code(204).send()
  }))

  // Meeting-note state machine: REQUIRED -> COMPLETED or CANCELLED; terminal states cannot be reopened.
  const MEETING_NOTE_SELECT = `SELECT mn.note_id AS id, mn.event_id AS "eventId", n.title, e.title AS "eventTitle", e.starts_at AS "meetingAt", mn.summary,
    mn.next_steps_markdown AS "nextStepsMarkdown", mn.follow_up_date AS "followUpDate", mn.status,
    mn.cancellation_reason AS "cancellationReason", mn.completed_at AS "completedAt",
    mn.completed_by_actor_id AS "completedByActorId", mn.cancelled_at AS "cancelledAt",
    mn.cancelled_by_actor_id AS "cancelledByActorId", r.created_at AS "createdAt", r.updated_at AS "updatedAt"
    FROM meeting_notes mn JOIN notes n ON n.workspace_id=mn.workspace_id AND n.id=mn.note_id
    JOIN events e ON e.workspace_id=mn.workspace_id AND e.id=mn.event_id
    JOIN records r ON r.workspace_id=mn.workspace_id AND r.id=mn.note_id WHERE mn.workspace_id=$1`

  app.get('/api/v1/meeting-notes', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${MEETING_NOTE_SELECT} ORDER BY r.updated_at DESC,mn.note_id LIMIT $2`, [user.workspaceId, queryLimit(request)])
    return reply.send({ items: result.rows })
  }))

  app.post('/api/v1/meeting-notes', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const body = objectBody(request)
    rejectUnknown(body, ['eventId', 'title', 'summary', 'nextStepsMarkdown', 'followUpDate'])
    const eventId = uuid(body.eventId, 'eventId') as string
    const title = has(body, 'title') ? requiredText(body, 'title') : 'Meeting notes'
    const summary = has(body, 'summary') ? optionalText(body, 'summary', 20_000) ?? '' : ''
    const nextSteps = has(body, 'nextStepsMarkdown') ? optionalText(body, 'nextStepsMarkdown', 20_000) ?? '' : ''
    const followUpDate = has(body, 'followUpDate') ? dateValue(body.followUpDate, 'followUpDate', true) : null
    const noteId = await transaction(pool, async (client) => {
      await assertEvent(client, user.workspaceId, eventId)
      const record = await client.query(
        `INSERT INTO records (workspace_id,record_type,created_by_actor_id,updated_by_actor_id) VALUES ($1,'NOTE',$2,$2) RETURNING id`,
        [user.workspaceId, user.actorId],
      )
      const id = record.rows[0].id as string
      await client.query('INSERT INTO notes (id,workspace_id,note_type,title,body_markdown) VALUES ($1,$2,\'MEETING\',$3,$4)', [id, user.workspaceId, title, summary])
      await client.query(
        `INSERT INTO meeting_notes (workspace_id,note_id,event_id,summary,next_steps_markdown,follow_up_date,status,created_by_actor_id,updated_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,'REQUIRED',$7,$7)`,
        [user.workspaceId, id, eventId, summary, nextSteps, followUpDate, user.actorId],
      )
      await writeActivity(client, user, request, 'MEETING_NOTE_CREATED', ['eventId', 'title', 'summary', 'nextStepsMarkdown', 'followUpDate'], id)
      return id
    })
    const result = await pool.query(`${MEETING_NOTE_SELECT} AND mn.note_id=$2`, [user.workspaceId, noteId])
    return reply.code(201).send(result.rows[0])
  }))

  app.get('/api/v1/meeting-notes/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const result = await pool.query(`${MEETING_NOTE_SELECT} AND mn.note_id=$2`, [user.workspaceId, recordId(request)])
    if (!result.rowCount) throw new HttpError(404, 'Meeting note not found.')
    return reply.send(result.rows[0])
  }))

  app.patch('/api/v1/meeting-notes/:id', { preHandler: requireAuth }, protectedHandler(async (request, reply, user) => {
    const id = recordId(request)
    const body = objectBody(request)
    rejectUnknown(body, ['title', 'summary', 'nextStepsMarkdown', 'followUpDate', 'status', 'cancellationReason'])
    const title = has(body, 'title') ? requiredText(body, 'title') : undefined
    const summary = has(body, 'summary') ? optionalText(body, 'summary', 20_000) ?? '' : undefined
    const nextSteps = has(body, 'nextStepsMarkdown') ? optionalText(body, 'nextStepsMarkdown', 20_000) ?? '' : undefined
    const followUpDate = has(body, 'followUpDate') ? dateValue(body.followUpDate, 'followUpDate', true) : undefined
    let status: string | undefined
    if (has(body, 'status')) {
      status = requiredText(body, 'status', 30).toUpperCase()
      if (!['COMPLETED', 'CANCELLED'].includes(status)) throw new HttpError(400, 'status must be COMPLETED or CANCELLED.')
    }
    if (status === 'COMPLETED' && !summary?.trim()) throw new HttpError(400, 'A meeting summary is required before completing the note.')
    const cancellationReason = has(body, 'cancellationReason') ? text(body.cancellationReason, 'cancellationReason', { nullable: true, max: 2_000 }) : undefined
    if (status === 'CANCELLED' && !cancellationReason) throw new HttpError(400, 'cancellationReason is required when cancelling a meeting note.')
    if (cancellationReason !== undefined && status !== 'CANCELLED') throw new HttpError(400, 'cancellationReason can only be supplied when cancelling a meeting note.')
    const changed = [title !== undefined ? 'title' : null, summary !== undefined ? 'summary' : null,
      nextSteps !== undefined ? 'nextStepsMarkdown' : null, followUpDate !== undefined ? 'followUpDate' : null,
      status !== undefined ? 'status' : null, cancellationReason !== undefined ? 'cancellationReason' : null].filter((field): field is string => field !== null)
    if (!changed.length) throw new HttpError(400, 'At least one field to update is required.')
    await transaction(pool, async (client) => {
      const current = await client.query(
        `SELECT mn.status, mn.event_id, e.title AS event_title, e.owner_user_id
           FROM meeting_notes mn JOIN events e ON e.workspace_id=mn.workspace_id AND e.id=mn.event_id
          WHERE mn.workspace_id=$1 AND mn.note_id=$2 FOR UPDATE OF mn`,
        [user.workspaceId, id],
      )
      if (!current.rowCount) throw new HttpError(404, 'Meeting note not found.')
      if (status && current.rows[0].status !== 'REQUIRED') throw new HttpError(409, 'Only a REQUIRED meeting note can be completed or cancelled.')
      if (current.rows[0].status !== 'REQUIRED') throw new HttpError(409, 'A terminal meeting note cannot be edited.')
      const updates: Array<{ table: 'notes' | 'meeting_notes'; column: string; value: unknown }> = []
      if (title !== undefined) updates.push({ table: 'notes', column: 'title', value: title })
      if (summary !== undefined) updates.push({ table: 'meeting_notes', column: 'summary', value: summary }, { table: 'notes', column: 'body_markdown', value: summary })
      if (nextSteps !== undefined) updates.push({ table: 'meeting_notes', column: 'next_steps_markdown', value: nextSteps })
      if (followUpDate !== undefined) updates.push({ table: 'meeting_notes', column: 'follow_up_date', value: followUpDate })
      if (status !== undefined) updates.push({ table: 'meeting_notes', column: 'status', value: status })
      if (cancellationReason !== undefined) updates.push({ table: 'meeting_notes', column: 'cancellation_reason', value: cancellationReason })
      if (status === 'COMPLETED') updates.push({ table: 'meeting_notes', column: 'completed_at', value: new Date().toISOString() }, { table: 'meeting_notes', column: 'completed_by_actor_id', value: user.actorId })
      if (status === 'CANCELLED') updates.push({ table: 'meeting_notes', column: 'cancelled_at', value: new Date().toISOString() }, { table: 'meeting_notes', column: 'cancelled_by_actor_id', value: user.actorId })
      for (const table of ['notes', 'meeting_notes'] as const) {
        const fields = updates.filter((update) => update.table === table)
        if (table === 'meeting_notes') fields.push({ table, column: 'updated_by_actor_id', value: user.actorId })
        if (!fields.length) continue
        const idColumn = table === 'notes' ? 'id' : 'note_id'
        if (table === 'meeting_notes') fields.push({ table, column: 'updated_at', value: new Date().toISOString() })
        const finalAssignments = fields.map(({ column }, index) => `${column}=$${index + 3}`).join(', ')
        await client.query(`UPDATE ${table} SET ${finalAssignments} WHERE workspace_id=$1 AND ${idColumn}=$2`, [user.workspaceId, id, ...fields.map(({ value }) => value)])
      }
      if (status || title !== undefined || summary !== undefined || nextSteps !== undefined || followUpDate !== undefined) {
        await client.query('UPDATE records SET version=version+1,updated_at=now(),updated_by_actor_id=$3 WHERE workspace_id=$1 AND id=$2', [user.workspaceId, id, user.actorId])
      }
      if (status === 'COMPLETED' && nextSteps?.trim() && followUpDate) {
        const existingFollowUp = await client.query(
          `SELECT id FROM follow_ups WHERE workspace_id=$1 AND source='MEETING_NOTE' AND source_meeting_note_id=$2 LIMIT 1`,
          [user.workspaceId, id],
        )
        if (!existingFollowUp.rowCount) {
          const assignee = current.rows[0].owner_user_id ?? user.userId
          const followUp = await client.query<{ id: string }>(
            `INSERT INTO follow_ups (workspace_id,title,body,due_at,assignee_user_id,status,source,source_meeting_note_id,created_by_actor_id,updated_by_actor_id)
             VALUES ($1,$2,$3,(($4::date + time '12:00') AT TIME ZONE 'Europe/Budapest'),$5,'OPEN','MEETING_NOTE',$6,$7,$7)
             RETURNING id`,
            [user.workspaceId, `Follow up: ${current.rows[0].event_title}`, nextSteps, followUpDate, assignee, id, user.actorId],
          )
          await client.query(
            `INSERT INTO follow_up_records (workspace_id,follow_up_id,record_id,created_by_actor_id)
             SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid
             UNION SELECT $1,$2,ep.person_id,$4 FROM event_people ep WHERE ep.workspace_id=$1 AND ep.event_id=$5
             UNION SELECT $1,$2,ec.company_id,$4 FROM event_companies ec WHERE ec.workspace_id=$1 AND ec.event_id=$5
             UNION SELECT $1,$2,eo.opportunity_id,$4 FROM event_opportunities eo WHERE eo.workspace_id=$1 AND eo.event_id=$5
             ON CONFLICT DO NOTHING`,
            [user.workspaceId, followUp.rows[0]!.id, id, user.actorId, current.rows[0].event_id],
          )
          await writeActivity(client, user, request, 'FOLLOW_UP_CREATED', ['title', 'body', 'dueAt', 'source'], id)
        }
      }
      await writeActivity(client, user, request, status === 'COMPLETED' ? 'MEETING_NOTE_COMPLETED' : status === 'CANCELLED' ? 'MEETING_NOTE_CANCELLED' : 'MEETING_NOTE_UPDATED', changed, id)
    })
    const result = await pool.query(`${MEETING_NOTE_SELECT} AND mn.note_id=$2`, [user.workspaceId, id])
    return reply.send(result.rows[0])
  }))
}
