import type {
  DashboardData,
  EventRecord,
  FollowUpRecord,
  MeetingNoteRequirementRecord,
  SearchResult,
  TaxonomyRecord,
  UserIdentity,
  WorkspaceUser,
  WarmIntroductionRecord,
} from './types'

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

function announceUndo(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || typeof window === 'undefined') return
  const outer = payload as Record<string, unknown>
  const record = outer.data && typeof outer.data === 'object' ? outer.data as Record<string, unknown> : outer
  if (typeof record.undoToken === 'string') {
    window.dispatchEvent(new CustomEvent('resoloon:undo-available', {
      detail: { token: record.undoToken, label: typeof record.undoLabel === 'string' ? record.undoLabel : 'Action completed' },
    }))
  }
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
  list: async <T,>(resource: string, query?: string) => {
    const pageSize = 100
    const results: T[] = []
    let offset = 0
    while (true) {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
      if (query?.trim()) params.set('q', query.trim())
      const page = unwrapList<T>(await request<unknown>(`/${resource}?${params.toString()}`))
      results.push(...page)
      if (page.length < pageSize) return results
      offset += page.length
    }
  },
  listLookup: async <T,>(resource: string, query = '') => {
    const params = new URLSearchParams({ limit: '50' })
    if (query.trim()) params.set('q', query.trim())
    return unwrapList<T>(await request<unknown>(`/${resource}?${params.toString()}`))
  },
  listWorkspaceUsers: async (query = '') => {
    const params = new URLSearchParams({ q: query.trim(), limit: '50' })
    return request<unknown>(`/users?${params.toString()}`).then(unwrapList<WorkspaceUser>)
  },
  listTaxonomies: async (taxonomy: TaxonomyRecord['taxonomy'], query = '') => {
    const params = new URLSearchParams({ taxonomy, q: query.trim(), limit: '50' })
    return request<unknown>(`/taxonomies?${params.toString()}`).then(unwrapList<TaxonomyRecord>)
  },
  listAdminTaxonomies: async (taxonomy: TaxonomyRecord['taxonomy'], query = '') => {
    const params = new URLSearchParams({ taxonomy, q: query.trim(), limit: '100' })
    return request<unknown>(`/admin/taxonomies?${params.toString()}`).then(unwrapList<TaxonomyRecord>)
  },
  createTaxonomy: (body: { taxonomy: TaxonomyRecord['taxonomy']; label: string; color: string; description?: string }) =>
    request<TaxonomyRecord>('/admin/taxonomies', { method: 'POST', body: JSON.stringify(body) }, true).then(unwrapObject<TaxonomyRecord>),
  updateTaxonomy: (id: string, body: Partial<Pick<TaxonomyRecord, 'label' | 'color' | 'description' | 'isActive' | 'sortOrder'>>) =>
    request<TaxonomyRecord>(`/admin/taxonomies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true).then(unwrapObject<TaxonomyRecord>),
  create: <T,>(resource: string, body: Record<string, unknown>) =>
    request<T>(`/${resource}`, { method: 'POST', body: JSON.stringify(body) }, true).then((payload) => unwrapObject<T>(payload)),
  update: <T,>(resource: string, id: string, body: Record<string, unknown>) =>
    request<T>(`/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true).then((payload) => unwrapObject<T>(payload)),
  get: <T,>(resource: string, id: string) => request<unknown>(`/${resource}/${encodeURIComponent(id)}`).then((payload) => unwrapObject<T>(payload)),
  listEvents: () => request<unknown>('/events?limit=50').then(unwrapList<EventRecord>),
  createEvent: (body: Record<string, unknown>) =>
    request<unknown>('/events', { method: 'POST', body: JSON.stringify(body) }, true).then(unwrapObject<EventRecord>),
  listFollowUps: () => request<unknown>('/follow-ups?limit=50').then(unwrapList<FollowUpRecord>),
  createFollowUp: (body: Record<string, unknown>) =>
    request<unknown>('/follow-ups', { method: 'POST', body: JSON.stringify(body) }, true).then(unwrapObject<FollowUpRecord>),
  updateFollowUp: (id: string, body: Record<string, unknown>) =>
    request<unknown>(`/follow-ups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true).then((payload) => { announceUndo(payload); return unwrapObject<FollowUpRecord>(payload) }),
  listIntroductions: () => request<unknown>('/introductions?limit=50').then(unwrapList<WarmIntroductionRecord>),
  createIntroduction: (body: Record<string, unknown>) =>
    request<unknown>('/introductions', { method: 'POST', body: JSON.stringify(body) }, true).then(unwrapObject<WarmIntroductionRecord>),
  updateIntroduction: (id: string, body: Record<string, unknown>) =>
    request<unknown>(`/introductions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true).then(unwrapObject<WarmIntroductionRecord>),
  listMeetingNotes: () => request<unknown>('/meeting-notes?limit=50').then(unwrapList<MeetingNoteRequirementRecord>),
  createMeetingNote: (body: { eventId: string; title?: string }) =>
    request<unknown>('/meeting-notes', { method: 'POST', body: JSON.stringify(body) }, true).then(unwrapObject<MeetingNoteRequirementRecord>),
  completeMeetingNote: (id: string, body: { summary: string; nextStepsMarkdown?: string; followUpDate?: string }) =>
    request<unknown>(`/meeting-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, status: 'COMPLETED' }) }, true).then((payload) => { announceUndo(payload); return unwrapObject<MeetingNoteRequirementRecord>(payload) }),
  cancelMeetingNote: (id: string, reason: string) =>
    request<unknown>(`/meeting-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED', cancellationReason: reason }) }, true).then((payload) => { announceUndo(payload); return unwrapObject<MeetingNoteRequirementRecord>(payload) }),
  undo: (token: string) => request<{ undone: boolean; actionType: string; targetId: string }>(`/undo/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify({}) }, true),
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
