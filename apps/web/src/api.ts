import type { DashboardData, SearchResult, UserIdentity } from './types'

export const API_ROOT = (import.meta.env.VITE_API_ROOT ?? '/api/v1').replace(/\/$/, '')

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit, sameOrigin = false): Promise<T> {
  let response: Response
  try {
    const requestUrl = sameOrigin
      ? `${window.location.origin}${new URL(API_ROOT, window.location.origin).pathname.replace(/\/$/, '')}${path}`
      : `${API_ROOT}${path}`
    response = await fetch(requestUrl, {
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError('The CRM API could not be reached. Check your connection and try again.', 0)
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const problem = (await response.json()) as { detail?: string; title?: string; message?: string }
      message = problem.detail ?? problem.message ?? problem.title ?? message
    } catch {
      // Keep the useful status message when the server has no JSON problem body.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.items)) return record.items as T[]
    if (Array.isArray(record.data)) return record.data as T[]
    if (record.data && typeof record.data === 'object') return unwrapList<T>(record.data)
  }
  return []
}

function unwrapObject<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

export const api = {
  me: async () => {
    const payload = unwrapObject<unknown>(await request<unknown>('/auth/me'))
    return payload && typeof payload === 'object' && 'user' in payload
      ? (payload as { user: UserIdentity }).user
      : payload as UserIdentity
  },
  login: async (email: string, password: string) => {
    const payload = unwrapObject<{ user: UserIdentity }>(await request<unknown>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, true))
    return payload.user
  },
  setup: async (token: string, password: string) => {
    const payload = unwrapObject<{ user: UserIdentity }>(await request<unknown>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }, true))
    return payload.user
  },
  logout: () => request<void>('/auth/logout', { method: 'POST' }, true),
  listAdminUsers: async () => {
    const payload = unwrapObject<{ users?: AdminUser[] }>(await request<unknown>('/admin/users'))
    return payload.users ?? []
  },
  createAdminUser: async (body: { fullName: string; email: string; role: 'ADMIN' | 'USER' }) =>
    unwrapObject<{ user: AdminUser; setupUrl: string }>(await request<unknown>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }, true)),
  updateAdminUser: async (id: string, body: Partial<Pick<AdminUser, 'fullName' | 'email' | 'role' | 'state'>>) =>
    unwrapObject<{ user: AdminUser }>(await request<unknown>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, true)),
  resetAdminUserAccess: async (id: string) =>
    unwrapObject<{ resetUrl: string }>(await request<unknown>(`/admin/users/${encodeURIComponent(id)}/reset-access`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, true)),
  list: <T,>(resource: string, query?: string) => {
    const params = new URLSearchParams({ limit: '50' })
    if (query?.trim()) params.set('q', query.trim())
    return request<unknown>(`/${resource}?${params.toString()}`).then(unwrapList<T>)
  },
  create: <T,>(resource: string, body: Record<string, unknown>) =>
    request<T>(`/${resource}`, { method: 'POST', body: JSON.stringify(body) }, true).then((payload) => unwrapObject<T>(payload)),
  update: <T,>(resource: string, id: string, body: Record<string, unknown>) =>
    request<T>(`/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true).then((payload) => unwrapObject<T>(payload)),
  get: <T,>(resource: string, id: string) => request<unknown>(`/${resource}/${encodeURIComponent(id)}`).then((payload) => unwrapObject<T>(payload)),
  dashboard: async () => unwrapObject<DashboardData>(await request<unknown>('/dashboard')),
  search: async (query: string) => {
    const params = new URLSearchParams({ q: query, limit: '8' })
    const payload = await request<unknown>(`/search?${params.toString()}`)
    const unwrapped = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data: unknown }).data
      : payload
    if (Array.isArray(unwrapped)) return unwrapped as SearchResult[]
    if (unwrapped && typeof unwrapped === 'object') {
      const object = unwrapped as Record<string, unknown>
      const flat = object.items ?? object.results
      if (Array.isArray(flat)) return flat as SearchResult[]
      const groups = object.results && typeof object.results === 'object'
        ? object.results as Record<string, unknown>
        : object
      return Object.entries(groups).flatMap(([group, results]) =>
        Array.isArray(results)
          ? (results as SearchResult[]).map((result) => ({ ...result, recordType: result.recordType ?? result.type ?? group }))
          : [],
      )
    }
    return []
  },
}

export type AdminUser = {
  id: string
  fullName: string
  email: string
  role: 'ADMIN' | 'USER'
  state: 'SETUP_REQUIRED' | 'ACTIVE' | 'DEACTIVATED'
  createdAt?: string
  updatedAt?: string
}

export function recordPath(type: string | undefined, id: string): string {
  const normalized = (type ?? '').toLowerCase()
  const route = normalized.includes('person') || normalized === 'people' ? 'people'
    : normalized.includes('compan') ? 'companies'
      : normalized.includes('opportun') ? 'opportunities'
        : normalized.includes('note') ? 'notes'
          : 'search'
  return route === 'search' ? `/search?q=${encodeURIComponent(id)}` : `/${route}/${id}`
}
