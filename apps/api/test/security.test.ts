import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import Fastify from 'fastify'
import { registerAuthRoutes } from '../src/auth.ts'
import { registerCrmRoutes } from '../src/crm.ts'

const fakePool = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as never

const app = Fastify()
app.decorateRequest('authUser', null)
registerAuthRoutes(app, {
  pool: fakePool,
  secureCookies: true,
  cookieName: 'resoloon_session',
  sessionTtlDays: 14,
  publicOrigin: 'https://crm.example.test',
})
registerCrmRoutes(app, { pool: fakePool })

before(async () => app.ready())
after(async () => app.close())

test('unauthenticated CRM and identity routes reject access', async () => {
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me' })
  assert.equal(me.statusCode, 401)
  assert.equal(me.headers['content-type']?.toString().split(';')[0], 'application/problem+json')

  const people = await app.inject({ method: 'GET', url: '/api/v1/people' })
  assert.equal(people.statusCode, 401)

  const admin = await app.inject({ method: 'GET', url: '/api/v1/admin/users' })
  assert.equal(admin.statusCode, 401)
})

test('cookie-authenticated mutations require the configured browser origin', async () => {
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'admin@example.test', password: 'password-is-long-enough' },
  })
  assert.equal(missing.statusCode, 403)

  const wrong = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'https://attacker.example.test' },
    payload: { email: 'admin@example.test', password: 'password-is-long-enough' },
  })
  assert.equal(wrong.statusCode, 403)

  const apiWriteWithoutOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/people',
    payload: { fullName: 'Blocked cross-origin mutation' },
  })
  assert.equal(apiWriteWithoutOrigin.statusCode, 403)
})

test('login failures use a generic response and logout clears a secure cookie', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'https://crm.example.test' },
    payload: { email: 'nobody@example.test', password: 'password-is-long-enough' },
  })
  assert.equal(login.statusCode, 401)
  assert.equal(login.json().detail, 'The email or password is incorrect.')

  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { origin: 'https://crm.example.test' },
  })
  assert.equal(logout.statusCode, 200)
  const cookie = String(logout.headers['set-cookie'])
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /Max-Age=0/)
})

test('no public registration endpoint exists', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: 'https://crm.example.test' },
    payload: {},
  })
  assert.equal(response.statusCode, 404)
})
