import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { registerAuthRoutes } from './auth.js'
import { registerCrmRoutes } from './crm.js'
import { registerWorkflowRoutes } from './workflows.js'
import { loadLocalEnv } from './env.js'

loadLocalEnv()

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`${name} must be configured`)
  return value
}

const databaseUrl = required('DATABASE_URL')
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 3000)
const publicOrigin = required('PUBLIC_ORIGIN', `http://localhost:${port}`)
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'resoloon_session'
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 14)
const secureCookies = process.env.COOKIE_SECURE === 'true' || new URL(publicOrigin).protocol === 'https:'

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be a valid TCP port')
if (!Number.isFinite(sessionTtlDays) || sessionTtlDays < 1 || sessionTtlDays > 365) throw new Error('SESSION_TTL_DAYS must be between 1 and 365')

const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  application_name: 'resoloon-crm-api',
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 30_000,
})

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword'],
      censor: '[REDACTED]',
    },
  },
  bodyLimit: 1_048_576,
  trustProxy: process.env.TRUST_PROXY === 'true',
  requestIdHeader: 'x-request-id',
})

app.decorateRequest('authUser', null)

app.get('/health/live', async () => ({ status: 'ok' }))
app.get('/health/ready', async (_request, reply) => {
  try {
    await pool.query('SELECT 1')
    return { status: 'ready' }
  } catch {
    return reply.code(503).send({ status: 'not_ready' })
  }
})

registerAuthRoutes(app, { pool, secureCookies, cookieName, sessionTtlDays, publicOrigin })
registerCrmRoutes(app, { pool })
registerWorkflowRoutes(app, { pool })

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const hasWebBuild = existsSync(resolve(webRoot, 'index.html'))
if (hasWebBuild) {
  await app.register(fastifyStatic, { root: webRoot, prefix: '/', wildcard: true })
}

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).type('application/problem+json').send({
      type: 'about:blank', title: 'Not Found', status: 404,
      detail: 'The requested API resource was not found.', instance: request.url,
    })
  }
  if (hasWebBuild && request.method === 'GET' && request.headers.accept?.includes('text/html')) {
    reply.header('cache-control', 'no-store')
    return reply.type('text/html; charset=utf-8').sendFile('index.html', { maxAge: 0 })
  }
  return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' })
})

app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  request.log.error({ err: error }, 'Request failed')
  const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500
  return reply.code(status).type('application/problem+json').send({
    type: 'about:blank',
    title: status >= 500 ? 'Internal Server Error' : error.name,
    status,
    detail: status >= 500 ? 'The request could not be completed.' : error.message,
    instance: request.url,
  })
})

let closing = false
async function close(signal: string) {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'Shutting down gracefully')
  try {
    await app.close()
    await pool.end()
    process.exitCode = 0
  } catch (error) {
    app.log.error({ err: error }, 'Graceful shutdown failed')
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void close('SIGINT'))
process.once('SIGTERM', () => void close('SIGTERM'))

try {
  await app.listen({ host, port })
  app.log.info({ host, port }, 'Resoloon CRM API listening')
} catch (error) {
  app.log.error({ err: error }, 'Could not start API')
  await pool.end()
  process.exitCode = 1
}
