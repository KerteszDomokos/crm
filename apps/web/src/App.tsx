import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ClipboardCheck,
  ChevronDown,
  CircleHelp,
  GitBranch,
  Clock3,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ListChecks,
  MapPin,
  Star,
  Tags,
  UsersRound,
  X,
  BriefcaseBusiness,
} from 'lucide-react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, ApiError, recordPath, type AdminUser } from './api'
import type {
  CompanyRecord,
  DashboardData,
  EventRecord,
  FollowUpRecord,
  MeetingNoteRequirementRecord,
  NoteRecord,
  OpportunityRecord,
  OpportunityStage,
  PersonRecord,
  SearchResult,
  UserIdentity,
  TaxonomyRecord,
  WorkspaceUser,
  RecordLink,
  WarmIntroductionRecord,
} from './types'

type ResourceDefinition<T> = {
  resource: string
  singular: string
  plural: string
  eyebrow: string
  description: string
  icon: typeof UsersRound
  emptyTitle: string
  emptyDescription: string
  fields: FormField[]
  columns: Array<{ label: string; render: (record: T) => ReactNode; className?: string }>
  summary?: (records: T[]) => string
}

type LookupSource = 'people' | 'companies' | 'opportunities' | 'records' | 'users' | 'cities' | 'PERSON_CATEGORY' | 'COMPANY_CATEGORY' | 'INDUSTRY'
type LookupOption = { id: string; label: string; subtitle?: string; color?: string; recordType?: string }
type FormField = {
  name: string
  label: string
  type?: string
  required?: boolean
  placeholder?: string
  options?: string[]
  source?: LookupSource
  multiple?: boolean
  allowCustom?: boolean
  wide?: boolean
  help?: string
  min?: number
  max?: number
}
type ResourceFormDefinition = { resource: string; singular: string; fields: FormField[] }

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function personName(person: PersonRecord) {
  if (person.fullName) return person.fullName
  if (typeof person.name === 'string') return person.name
  if (person.name) return [person.name.firstName, person.name.lastName].filter(Boolean).join(' ')
  return 'Unnamed person'
}

function companyName(record: CompanyRecord | string | { name?: string }) {
  if (typeof record === 'string') return record
  return record.name ?? 'Company'
}

function associatedCompanies(person: PersonRecord) {
  if (person.companyName) return person.companyName
  return person.companies?.map(companyName).join(', ') || '—'
}

function emailOf(person: PersonRecord) {
  return person.primaryEmail ?? person.email ?? person.emails?.map((email) => typeof email === 'string' ? email : email.primaryEmail ?? email.email ?? email.address).filter(Boolean).join(', ') ?? '—'
}

function getInitials(name?: string) {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'R'
}

function useResource<T extends { id: string }>(resource: string) {
  const [records, setRecords] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const reload = useCallback(() => setRefreshToken((value) => value + 1), [])

  const upsertRecord = useCallback((updated: T) => {
    setRecords((current) => {
      const index = current.findIndex((record) => record.id === updated.id)
      if (index < 0) return [updated, ...current]
      const next = current.slice()
      next[index] = { ...current[index], ...updated }
      return next
    })
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api.list<T>(resource).then((result) => {
      if (active) setRecords(result)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load records.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [resource, refreshToken])

  useEffect(() => {
    const refresh = () => reload()
    window.addEventListener('resoloon:workflow-refresh', refresh)
    return () => window.removeEventListener('resoloon:workflow-refresh', refresh)
  }, [reload])

  return { records, loading, error, reload, upsertRecord }
}

function LoadingState({ label = 'Loading your workspace' }: { label?: string }) {
  return <div className="state-panel" role="status"><LoaderCircle className="spin state-icon accent" size={20} /><span>{label}</span></div>
}

function EmptyState({ icon: Icon = CircleHelp, title, description, action }: { icon?: typeof CircleHelp; title: string; description: string; action?: ReactNode }) {
  return <div className="state-panel empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-panel" role="alert"><span className="error-mark">!</span><div><strong>Couldn’t load this view</strong><p>{message}</p></div><button type="button" className="button button-ghost button-small" onClick={onRetry}>Try again</button></div>
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'neutral', to }: { label: string; value: string | number; detail: string; icon: typeof UsersRound; tone?: 'neutral' | 'positive'; to?: string }) {
  const body = <><div className="metric-top"><span className="eyebrow">{label}</span><span className={`metric-icon ${tone}`}><Icon size={15} /></span></div><div className={`metric-value ${tone === 'positive' ? 'accent' : ''}`}>{value}</div><div className="metric-detail">{detail}</div></>
  return to
    ? <Link to={to} className={`metric-card metric-card-link${tone === 'positive' ? ' metric-card-positive' : ''}`}>{body}</Link>
    : <article className="metric-card">{body}</article>
}

function StagePill({ stage }: { stage?: OpportunityStage | string }) {
  const value = (stage ?? 'LEAD').toUpperCase()
  const label = displayStage(value)
  return <span className={`stage-pill stage-${value.toLowerCase().replaceAll('_', '-')}`}><span className="stage-dot" />{label}</span>
}

function ImportanceStars({ value, onChange, readOnly = false, size = 16 }: {
  value?: number | null
  onChange?: (next: number | null) => void
  readOnly?: boolean
  size?: number
}) {
  const current = typeof value === 'number' && value >= 1 && value <= 5 ? Math.round(value) : 0
  const [hovered, setHovered] = useState(0)
  const shown = hovered || current

  if (readOnly) {
    if (!current) return <span className="importance-stars importance-empty" aria-label="No importance set">—</span>
    return <span className="importance-stars" aria-label={`${current} of 5`}>
      {Array.from({ length: 5 }, (_, index) => {
        const rank = index + 1
        return <Star key={rank} size={size} className={rank <= current ? 'star-filled' : 'star-empty'} fill={rank <= current ? 'currentColor' : 'none'} aria-hidden />
      })}
    </span>
  }

  return <div
    className="importance-stars importance-stars-input"
    role="radiogroup"
    aria-label="Importance"
    onMouseLeave={() => setHovered(0)}
  >
    {Array.from({ length: 5 }, (_, index) => {
      const rank = index + 1
      const active = rank <= shown
      return <button
        key={rank}
        type="button"
        role="radio"
        aria-checked={current === rank}
        aria-label={`${rank} star${rank === 1 ? '' : 's'}`}
        className={`importance-star${active ? ' is-active' : ''}${current === rank ? ' is-selected' : ''}`}
        onMouseEnter={() => setHovered(rank)}
        onFocus={() => setHovered(rank)}
        onBlur={() => setHovered(0)}
        onClick={() => onChange?.(current === rank ? null : rank)}
      >
        <Star size={size} fill={active ? 'currentColor' : 'none'} aria-hidden />
      </button>
    })}
  </div>
}

function ResourcePage<T extends { id: string }>({ definition }: { definition: ResourceDefinition<T> }) {
  const { records, loading, error, reload, upsertRecord } = useResource<T>(definition.resource)
  const [createOpen, setCreateOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState('')
  const filterInputRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('id')
  const Icon = definition.icon
  const filteredRecords = useMemo(() => {
    if (!localSearch.trim()) return records
    const query = localSearch.trim().toLocaleLowerCase()
    return records.filter((record) => JSON.stringify(record).toLocaleLowerCase().includes(query))
  }, [localSearch, records])

  const openRecord = useCallback((id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('id', id)
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  const closeRecord = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('id')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const handleRecordSaved = useCallback((updated: Record<string, unknown> & { id: string }) => {
    upsertRecord(updated as T)
  }, [upsertRecord])

  useEffect(() => {
    function handleFilterShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const editingText = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key === '/' && !editingText && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        filterInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleFilterShortcut)
    return () => window.removeEventListener('keydown', handleFilterShortcut)
  }, [])

  return <section className={`page-stack resource-page${selectedId ? ' resource-page-drawer-open' : ''}`}>
    <div className="page-heading">
      <div><div className="eyebrow page-eyebrow">Workspace / {definition.plural}</div><h1>{definition.plural}</h1><p>{definition.description}</p></div>
      <button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Add {definition.singular.toLowerCase()}</button>
    </div>
    <div className="list-panel">
      <div className="list-toolbar"><div className="list-context"><span className="list-icon"><Icon size={16} /></span><div><strong>{definition.plural}</strong><span>{loading ? 'Loading…' : definition.summary?.(records) ?? `${records.length} ${records.length === 1 ? 'record' : 'records'}`}</span></div></div>
        <label className="inline-search"><Search size={14} /><input ref={filterInputRef} value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} placeholder={`Filter ${definition.plural.toLowerCase()}`} aria-label={`Filter ${definition.plural}`} /><kbd>/</kbd></label>
      </div>
      {loading ? <LoadingState label={`Loading ${definition.plural.toLowerCase()}…`} /> : error ? <ErrorState message={error} onRetry={reload} /> : filteredRecords.length === 0 ?
        (records.length === 0 ? <EmptyState icon={Icon} title={definition.emptyTitle} description={definition.emptyDescription} action={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Create {definition.singular.toLowerCase()}</button>} /> : <EmptyState icon={Search} title="No matching records" description="Try a different filter, or clear the search to see all records." />) :
          <div className="table-scroll"><table className="record-table"><thead><tr>{definition.columns.map((column) => <th key={column.label} className={column.className}>{column.label}</th>)}<th aria-label="Open record" /></tr></thead><tbody>{filteredRecords.map((record) => <tr key={record.id} className={`click-row${selectedId === record.id ? ' selected-row' : ''}`} onClick={() => openRecord(record.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') openRecord(record.id) }}>{definition.columns.map((column, index) => <td key={`${record.id}-${column.label}`} className={`${column.className ?? ''} ${index === 0 ? 'primary-cell' : ''}`}>{index === 0 ? <div className="primary-cell-content">{column.render(record)}</div> : column.render(record)}</td>)}<td className="open-cell"><ArrowUpRight size={14} /></td></tr>)}</tbody></table></div>}
    </div>
    {createOpen && <RecordFormDialog definition={definition} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
    {selectedId && <RecordDrawer definition={definition} recordId={selectedId} onClose={closeRecord} onSaved={handleRecordSaved} />}
  </section>
}

function RecordDrawer({ definition, recordId, onClose, onSaved }: {
  definition: ResourceFormDefinition & { plural: string; icon: typeof UsersRound; singular: string; resource: string }
  recordId: string
  onClose: () => void
  onSaved: (updated: Record<string, unknown> & { id: string }) => void
}) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  useEscapeToClose(onClose)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.get<Record<string, unknown>>(definition.resource, recordId).then((data) => {
      if (active) { setRecord(data); setError(null) }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this record.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [definition.resource, recordId, token])

  const title = String(record?.fullName ?? record?.name ?? record?.title ?? definition.singular)
  const subtitle = String(record?.jobTitle ?? record?.domain ?? record?.email ?? record?.stage ?? definition.plural)

  return <>
    <button type="button" className="drawer-scrim" aria-label="Close record" onClick={onClose} />
    <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header className="drawer-header">
        <div className="drawer-identity">
          <span className="avatar drawer-avatar">{definition.resource === 'companies' ? <Building2 size={18} /> : getInitials(title)}</span>
          <div>
            <div className="eyebrow">{definition.singular}</div>
            <h2 id="drawer-title">{loading ? 'Loading…' : title}</h2>
            {!loading && <p className="drawer-subtitle">{subtitle}</p>}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      <div className="drawer-body">
        {loading ? <LoadingState label="Loading record…" /> : error ? <ErrorState message={error} onRetry={() => setToken((value) => value + 1)} /> : record ? <>
          {record.stage != null && <div className="drawer-stage"><StagePill stage={String(record.stage)} /></div>}
          {Array.isArray(record.introductionObligations) && record.introductionObligations.length > 0 && <section className="drawer-callout">
            <span className="eyebrow">Introduction owed</span>
            {(record.introductionObligations as Array<Record<string, unknown>>).map((obligation, index) => {
              const introduceTo = String(obligation.introduceToPersonName ?? obligation.targetPersonName ?? 'the next person')
              return <p key={`${String(obligation.chainId ?? index)}-${String(obligation.position ?? index)}`}>Introduce the team to <strong>{introduceTo}</strong>{obligation.followUpAt ? ` · ${formatDate(String(obligation.followUpAt))}` : ''}</p>
            })}
            <Link to="/introductions" className="one-time-link-open" onClick={onClose}>Open introduction chains</Link>
          </section>}
          <RecordEditorForm
            key={`${recordId}-${token}`}
            definition={definition}
            record={record}
            inline
            stacked
            onSave={async (values) => {
              const updated = await api.update<Record<string, unknown> & { id: string }>(definition.resource, recordId, values)
              setRecord(updated)
              onSaved({ ...updated, id: String(updated.id ?? recordId) })
              return updated
            }}
            onSaved={() => {}}
            onReload={() => setToken((value) => value + 1)}
          />
        </> : null}
      </div>
    </aside>
  </>
}

function displayStage(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function toLookupOptions(source: LookupSource | undefined, payload: unknown): LookupOption[] {
  if (!Array.isArray(payload)) return []
  if (source === 'PERSON_CATEGORY' || source === 'COMPANY_CATEGORY' || source === 'INDUSTRY') {
    return (payload as TaxonomyRecord[]).map((item) => ({ id: item.label, label: item.label, color: item.color }))
  }
  if (source === 'cities') {
    return (payload as Array<{ id?: string; label?: string; subtitle?: string }>).flatMap((item) => {
      const label = String(item.label ?? item.id ?? '').trim()
      if (!label) return []
      return [{ id: label, label, subtitle: item.subtitle }]
    })
  }
  if (source === 'users') return (payload as WorkspaceUser[]).map((item) => ({ id: item.id, label: item.fullName, subtitle: item.email }))
  if (source === 'records') return (payload as SearchResult[]).map((item) => ({ id: item.id, label: item.title ?? item.name ?? 'Record', subtitle: item.recordType ?? item.type, recordType: item.recordType ?? item.type }))
  if (source === 'people') return (payload as PersonRecord[]).map((item) => ({ id: item.id, label: personName(item), subtitle: item.jobTitle ?? emailOf(item) }))
  if (source === 'companies') return (payload as CompanyRecord[]).map((item) => ({ id: item.id, label: companyName(item), subtitle: item.domain ?? item.website ?? item.domains?.[0] }))
  if (source === 'opportunities') return (payload as OpportunityRecord[]).map((item) => ({ id: item.id, label: item.name, subtitle: item.stage ? displayStage(item.stage) : undefined }))
  return []
}

async function loadLookupOptions(source: LookupSource, query: string): Promise<LookupOption[]> {
  if (source === 'users') return toLookupOptions(source, await api.listWorkspaceUsers(query))
  if (source === 'PERSON_CATEGORY' || source === 'COMPANY_CATEGORY' || source === 'INDUSTRY') return toLookupOptions(source, await api.listTaxonomies(source, query))
  if (source === 'records') return query.trim().length >= 2 ? toLookupOptions(source, await api.search(query)) : []
  if (source === 'cities') return query.trim().length >= 2 ? toLookupOptions(source, await api.searchCities(query)) : []
  return toLookupOptions(source, await api.listLookup(source, query))
}

function SearchablePicker({
  selected, onChange, source, options = [], multiple = false, allowCustom = false, placeholder, label, disabled = false,
}: {
  selected: LookupOption[]
  onChange: (items: LookupOption[]) => void
  source?: LookupSource
  options?: LookupOption[]
  multiple?: boolean
  allowCustom?: boolean
  placeholder?: string
  label: string
  disabled?: boolean
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [remoteOptions, setRemoteOptions] = useState<LookupOption[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!source) { setRemoteOptions([]); return }
    let active = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      loadLookupOptions(source, query).then((items) => { if (active) setRemoteOptions(items) }).catch(() => { if (active) setRemoteOptions([]) }).finally(() => { if (active) setLoading(false) })
    }, query ? 180 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [source, query])

  useLayoutEffect(() => {
    if (!open || !rootRef.current) { setMenuBox(null); return }
    function place() {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, 240), Math.min(420, window.innerWidth - 16))
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
      const below = rect.bottom + 6
      const estimated = 240
      const top = below + estimated > window.innerHeight - 8
        ? Math.max(8, rect.top - estimated - 6)
        : below
      setMenuBox({ top, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, query, selected.length, loading])

  useEffect(() => {
    if (!open) return
    function closeOutside(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const baseOptions = source ? remoteOptions : options
  const displayedSelected = selected.map((item) => {
    const match = baseOptions.find((option) => option.id === item.id)
    return {
      id: item.id,
      label: (match?.label || item.label || item.id || '').trim() || 'Selected',
      subtitle: match?.subtitle ?? item.subtitle,
      color: match?.color ?? item.color,
      recordType: match?.recordType ?? item.recordType,
    }
  })
  const filtered = baseOptions.filter((item) => {
    const match = `${item.label} ${item.subtitle ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    return match && !selected.some((chosen) => chosen.id === item.id)
  })
  const canAddCustom = allowCustom && query.trim().length > 0 && ![...baseOptions, ...selected].some((item) => item.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase())
  const rows = [...filtered, ...(canAddCustom ? [{ id: `__custom__${query.trim()}`, label: `Add “${query.trim()}”`, subtitle: 'Create this value', customValue: query.trim() } as LookupOption & { customValue: string }] : [])]

  function choose(item: LookupOption & { customValue?: string }) {
    const value: LookupOption = item.customValue
      ? { id: item.customValue, label: item.customValue }
      : { id: item.id, label: item.label || item.id, subtitle: item.subtitle, color: item.color, recordType: item.recordType }
    if (!value.id || !value.label) return
    if (selected.some((chosen) => chosen.id === value.id || chosen.label.toLocaleLowerCase() === value.label.toLocaleLowerCase())) {
      setQuery('')
      setOpen(false)
      return
    }
    onChange(multiple ? [...selected, value] : [value])
    setQuery('')
    setHighlighted(0)
    setOpen(false)
    if (multiple) requestAnimationFrame(() => inputRef.current?.focus())
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((index) => rows.length ? (index + 1) % rows.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((index) => rows.length ? (index - 1 + rows.length) % rows.length : 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!open) { setOpen(true); return }
      if (!loading && rows[highlighted]) choose(rows[highlighted])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setQuery('')
    } else if (event.key === 'Backspace' && !query && selected.length) {
      onChange(selected.slice(0, -1))
    }
  }

  const menu = open && !disabled && menuBox && createPortal(
    <div
      ref={popoverRef}
      className="picker-popover picker-popover-portal"
      style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
    >
      <ul id={listId} role="listbox" aria-label={`${label} options`} aria-multiselectable={multiple || undefined}>
        {loading && <li className="picker-empty" role="presentation"><LoaderCircle size={13} className="spin" />Searching…</li>}
        {!loading && rows.map((item, index) => {
          const already = selected.some((choice) => choice.id === item.id)
          return <li
            key={`${item.id}-${index}`}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={already || index === highlighted}
            className={`picker-option${index === highlighted ? ' is-highlighted' : ''}${already ? ' is-selected' : ''}`}
            onMouseEnter={() => setHighlighted(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              choose(item)
            }}
          >
            <span><strong>{item.label}</strong>{item.subtitle && <small>{item.subtitle}</small>}</span>
            {already ? <Check size={13} /> : null}
          </li>
        })}
        {!loading && rows.length === 0 && <li className="picker-empty" role="presentation">{query ? (allowCustom ? 'No matches. Press Enter to add this value.' : 'No matches.') : `Start typing to search ${label.toLowerCase()}.`}</li>}
      </ul>
    </div>,
    document.body,
  )

  return <div className={`search-picker${disabled ? ' is-disabled' : ''}${selected.length ? ' has-selection' : ''}`} ref={rootRef}>
    <div className="picker-control" onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus() } }}>
      {displayedSelected.map((item, index) => (
        <span
          className={`picker-chip${item.color ? ' taxonomy-picker-chip' : ''}`}
          key={`${item.id}-${index}`}
          style={item.color ? { color: item.color, borderColor: `${item.color}66`, backgroundColor: `${item.color}22` } : undefined}
          title={item.label}
        >
          <span>{item.label}</span>
          <button
            type="button"
            aria-label={`Remove ${item.label}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onChange(selected.filter((_, itemIndex) => itemIndex !== index))
            }}
            disabled={disabled}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[highlighted] ? `${listId}-${highlighted}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        disabled={disabled}
        placeholder={selected.length ? (multiple ? 'Add another…' : 'Search to replace…') : (placeholder ?? `Search ${label.toLowerCase()}…`)}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setHighlighted(0); setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      {selected.length > 0 && !multiple && (
        <button
          className="picker-clear"
          type="button"
          aria-label={`Clear ${label}`}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange([]); setQuery(''); inputRef.current?.focus() }}
          disabled={disabled}
        >
          <X size={13} />
        </button>
      )}
      <ChevronDown size={14} className="picker-chevron" />
    </div>
    {menu}
  </div>
}


function listAsStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).label ?? (item as Record<string, unknown>).name ?? (item as Record<string, unknown>).fullName ?? (item as Record<string, unknown>).email ?? (item as Record<string, unknown>).primaryEmail ?? (item as Record<string, unknown>).address ?? (item as Record<string, unknown>).phone ?? (item as Record<string, unknown>).domain ?? '') : '').filter(Boolean)
}

function relatedChoices(field: FormField, record?: Record<string, unknown>): LookupOption[] {
  if (!record) return []
  const name = field.name
  if (field.source === 'people' && name === 'companyIds') {
    const values = Array.isArray(record.companies) ? record.companies : []
    return values.flatMap((item) => typeof item === 'object' && item ? [{ id: String((item as Record<string, unknown>).id ?? ''), label: String((item as Record<string, unknown>).name ?? 'Company') }] : [])
  }
  if (field.source === 'companies' && name === 'companyIds') {
    const values = Array.isArray(record.companies) ? record.companies : []
    return values.flatMap((item) => typeof item === 'object' && item ? [{ id: String((item as Record<string, unknown>).id ?? ''), label: String((item as Record<string, unknown>).name ?? 'Company') }] : [])
  }
  if (field.source === 'people' && name === 'personIds') {
    const values = Array.isArray(record.people) ? record.people : []
    return values.flatMap((item) => typeof item === 'object' && item ? [{ id: String((item as Record<string, unknown>).id ?? ''), label: String((item as Record<string, unknown>).fullName ?? (item as Record<string, unknown>).name ?? 'Person') }] : [])
  }
  if (field.source === 'people' && name === 'introducedByPersonId' && record.introducedByPersonId) return [{ id: String(record.introducedByPersonId), label: String(record.introducedByPersonName ?? 'Introducer') }]
  if (field.source === 'users') {
    const id = name === 'assigneeUserId' ? record.assigneeUserId : name === 'responsibleUserId' ? record.responsibleUserId : record.ownerUserId
    const label = name === 'assigneeUserId' ? record.assigneeName : name === 'responsibleUserId' ? record.responsibleName : record.ownerName
    if (id) return [{ id: String(id), label: String(label ?? 'Workspace member') }]
  }
  if (field.source === 'records' && Array.isArray(record.relatedRecords)) return (record.relatedRecords as Array<Record<string, unknown>>).map((item) => ({ id: String(item.id), label: String(item.name ?? 'Related record'), subtitle: String(item.type ?? '') }))
  if (field.name === 'companyIds' || field.name === 'personIds' || field.name === 'opportunityIds') {
    const related = Array.isArray(record.relatedRecords) ? record.relatedRecords as Array<Record<string, unknown>> : []
    const expected = name.startsWith('person') ? 'person' : name.startsWith('compan') ? 'compan' : 'opportun'
    return related.filter((item) => item.id && String(item.type ?? '').toLowerCase().includes(expected)).map((item) => ({ id: String(item.id), label: String(item.name ?? 'Related record') }))
  }
  return []
}

function fieldInitialValue(field: FormField, record?: Record<string, unknown>): unknown {
  if (!record) {
    if (field.options?.length) return [{ id: field.options[0], label: displayStage(field.options[0]) }]
    if (field.type === 'stars') return null
    return field.type === 'picker' || field.type === 'links' ? [] : ''
  }
  const name = field.name
  if (field.type === 'stars') {
    const raw = record[name]
    const rank = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(rank) && rank >= 1 && rank <= 5 ? Math.round(rank) : null
  }
  if (field.type === 'links') return normalizeRecordLinks(record.links)
  if (field.options) {
    const raw = record[name] ?? (name === 'noteType' ? record.type : undefined) ?? field.options[0]
    const option = String(raw)
    return [{ id: option, label: displayStage(option) }]
  }
  if (field.type === 'picker') {
    if (field.source === 'cities') {
      const city = typeof record[name] === 'string' ? record[name].trim() : ''
      return city ? [{ id: city, label: city }] : []
    }
    if (field.source === 'PERSON_CATEGORY' || field.source === 'COMPANY_CATEGORY' || field.source === 'INDUSTRY') {
      const raw = Array.isArray(record[name]) ? record[name] as Array<string | { label?: string; color?: string; id?: string }> : []
      return raw.flatMap((item) => {
        if (typeof item === 'string' && item.trim()) return [{ id: item.trim(), label: item.trim() }]
        if (item && typeof item === 'object') {
          const label = String(item.label ?? '').trim()
          if (!label) return []
          return [{ id: label, label, color: typeof item.color === 'string' ? item.color : undefined }]
        }
        return []
      })
    }
    if (!field.source) {
      let values: string[] = []
      if (name === 'emails') values = listAsStrings(record.emails).length ? listAsStrings(record.emails) : [record.primaryEmail ?? record.email].filter((item): item is string => typeof item === 'string' && Boolean(item))
      else if (name === 'phones') values = listAsStrings(record.phones).length ? listAsStrings(record.phones) : [record.phone ?? record.primaryPhone].filter((item): item is string => typeof item === 'string' && Boolean(item))
      else if (name === 'domains') values = listAsStrings(record.domains).length ? listAsStrings(record.domains) : [record.domain ?? record.primaryDomain].filter((item): item is string => typeof item === 'string' && Boolean(item))
      else values = listAsStrings(record[name])
      return values.map((value) => ({ id: value, label: value }))
    }
    const related = relatedChoices(field, record)
    const value = record[name]
      const values = field.multiple ? (Array.isArray(value) ? value : name === 'companyIds' && Array.isArray(record.companies) ? (record.companies as Array<Record<string, unknown>>).map((item) => item.id) : name === 'personIds' && Array.isArray(record.people) ? (record.people as Array<Record<string, unknown>>).map((item) => item.id) : related.map((item) => item.id)) : value == null ? [] : [value]
    return values.filter((item) => item != null).map((item) => {
      const id = String(item)
      const known = related.find((option) => option.id === id)
      if (known) return known
      if (field.options?.includes(id)) return { id, label: displayStage(id) }
      return { id, label: field.source === 'people' ? 'Selected person' : field.source === 'companies' ? 'Selected company' : field.source === 'users' ? 'Workspace member' : 'Related record' }
    })
  }
  let value = record[name]
  if (value == null) {
    if (name === 'bodyMarkdown') value = record.body
    else if (name === 'noteType') value = record.type ?? 'GENERAL'
    else if (name === 'fullName' && record.name && typeof record.name === 'object') {
      const nestedName = record.name as { firstName?: string; lastName?: string }
      value = [nestedName.firstName, nestedName.lastName].filter(Boolean).join(' ')
    }
    else if (name === 'startAt' || name === 'endAt') value = record[name === 'startAt' ? 'startsAt' : 'endsAt']
  }
  if (value != null && (field.type === 'date' || name === 'expectedCloseDate' || name === 'followUpDate' || name === 'dueAt')) return String(value).slice(0, 10)
  if (value != null && field.type === 'datetime-local') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  }
  return value == null ? '' : String(value)
}

function normalizeRecordLinks(raw: unknown): RecordLink[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ kind: 'other', url: item.trim() }]
    if (item && typeof item === 'object') {
      const link = item as Record<string, unknown>
      const url = typeof link.url === 'string' ? link.url.trim() : typeof link.rawUrl === 'string' ? link.rawUrl.trim() : ''
      if (!url) return []
      const kind = typeof link.kind === 'string' && link.kind.trim() ? link.kind.trim() : 'other'
      const label = typeof link.label === 'string' && link.label.trim() ? link.label.trim() : undefined
      return [{ kind, url, ...(label ? { label } : {}) }]
    }
    return []
  })
}

function LinkEditor({ links, onChange }: { links: RecordLink[]; onChange: (links: RecordLink[]) => void }) {
  return <div className="link-editor">
    {links.map((link, index) => <div className="link-editor-row" key={index}>
      <input aria-label={`Link ${index + 1} URL`} type="url" value={link.url} placeholder="https://…" onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value, kind: item.kind || 'other' } : item))} />
      <input aria-label={`Link ${index + 1} label`} value={link.label ?? ''} placeholder="Label (optional)" onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} />
      <button type="button" className="icon-button link-remove" aria-label={`Remove link ${index + 1}`} onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
    </div>)}
    <button type="button" className="button button-ghost button-small" onClick={() => onChange([...links, { kind: 'other', url: '', label: '' }])}><Plus size={13} />Add link</button>
  </div>
}

function taxonomyLabels(values?: Array<string | { label?: string; color?: string }> | null) {
  if (!values?.length) return '—'
  return values.map((item) => typeof item === 'string' ? item : item.label ?? '—').filter(Boolean).join(', ')
}

function TaxonomyBadges({ values }: { values?: Array<string | { label?: string; color?: string }> | null }) {
  if (!values?.length) return <span className="cell-muted">—</span>
  return <span className="taxonomy-badges">
    {values.map((item, index) => {
      const label = typeof item === 'string' ? item : item.label ?? '—'
      const color = typeof item === 'string' ? undefined : item.color
      return <span key={`${label}-${index}`} className="taxonomy-badge" style={color ? { ['--taxonomy-color' as string]: color } : undefined}>{label}</span>
    })}
  </span>
}

const CATEGORY_COLOR_PRESETS = ['#00CF7F', '#6B8E7C', '#5B8DEF', '#F0A202', '#E4572E', '#9B5DE5', '#00BBF9', '#F15BB5']

function SettingsCategoriesPage() {
  type TaxonomyKind = TaxonomyRecord['taxonomy']
  type CategoryDraft = { id: string; label: string; color: string; isActive: boolean; isNew?: boolean }
  const tabs: Array<{ id: TaxonomyKind; label: string; hint: string }> = [
    { id: 'PERSON_CATEGORY', label: 'People', hint: 'Tags you attach to people in your network.' },
    { id: 'COMPANY_CATEGORY', label: 'Companies', hint: 'How you classify organizations.' },
    { id: 'INDUSTRY', label: 'Industries', hint: 'Industry labels for companies.' },
  ]
  const [tab, setTab] = useState<TaxonomyKind>('PERSON_CATEGORY')
  const [savedTerms, setSavedTerms] = useState<TaxonomyRecord[]>([])
  const [drafts, setDrafts] = useState<CategoryDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(CATEGORY_COLOR_PRESETS[0])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setActionError(null)
    setStatus('')
    api.listAdminTaxonomies(tab).then((items) => {
      if (!active) return
      setSavedTerms(items)
      setDrafts(items.map((item) => ({
        id: item.id,
        label: item.label,
        color: item.color ?? '#6B8E7C',
        isActive: item.isActive !== false,
      })))
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load categories.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [tab, refreshToken])

  const dirtyCount = useMemo(() => {
    let count = 0
    for (const draft of drafts) {
      if (draft.isNew) {
        if (draft.label.trim()) count += 1
        continue
      }
      const original = savedTerms.find((term) => term.id === draft.id)
      if (!original) continue
      const originalActive = original.isActive !== false
      if (
        draft.label.trim() !== original.label
        || draft.color.toLowerCase() !== (original.color ?? '#6B8E7C').toLowerCase()
        || draft.isActive !== originalActive
      ) count += 1
    }
    return count
  }, [drafts, savedTerms])

  function updateDraft(id: string, patch: Partial<Pick<CategoryDraft, 'label' | 'color' | 'isActive'>>) {
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
    setActionError(null)
    setStatus('')
  }

  function stageNewCategory(event: FormEvent) {
    event.preventDefault()
    const label = newLabel.trim()
    if (!label) { setActionError('Give the category a name.'); return }
    if (drafts.some((item) => item.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      setActionError('That category name is already in this list.')
      return
    }
    setDrafts((current) => [...current, {
      id: `new-${crypto.randomUUID()}`,
      label,
      color: newColor,
      isActive: true,
      isNew: true,
    }])
    setNewLabel('')
    setNewColor(CATEGORY_COLOR_PRESETS[(CATEGORY_COLOR_PRESETS.indexOf(newColor) + 1) % CATEGORY_COLOR_PRESETS.length] ?? CATEGORY_COLOR_PRESETS[0])
    setActionError(null)
    setStatus('')
  }

  function discardChanges() {
    setDrafts(savedTerms.map((item) => ({
      id: item.id,
      label: item.label,
      color: item.color ?? '#6B8E7C',
      isActive: item.isActive !== false,
    })))
    setActionError(null)
    setStatus('Changes discarded.')
  }

  function changeTab(next: TaxonomyKind) {
    if (next === tab) return
    if (dirtyCount > 0 && !window.confirm('You have unsaved category changes. Leave without saving?')) return
    setTab(next)
    setNewLabel('')
  }

  async function saveAll() {
    const normalized = drafts.map((draft) => ({ ...draft, label: draft.label.trim() }))
    if (normalized.some((draft) => !draft.label)) {
      setActionError('Every category needs a name.')
      return
    }
    if (normalized.some((draft) => !/^#[0-9A-Fa-f]{6}$/.test(draft.color))) {
      setActionError('Every category needs a valid hex color.')
      return
    }
    const labels = normalized.map((draft) => draft.label.toLocaleLowerCase())
    if (new Set(labels).size !== labels.length) {
      setActionError('Category names must be unique.')
      return
    }

    const creates = normalized.filter((draft) => draft.isNew)
    const updates = normalized.flatMap((draft) => {
      if (draft.isNew) return []
      const original = savedTerms.find((term) => term.id === draft.id)
      if (!original) return []
      const originalActive = original.isActive !== false
      const changed = draft.label !== original.label
        || draft.color.toLowerCase() !== (original.color ?? '#6B8E7C').toLowerCase()
        || draft.isActive !== originalActive
      return changed ? [draft] : []
    })

    if (!creates.length && !updates.length) {
      setStatus('Nothing to save.')
      return
    }

    setSaving(true)
    setActionError(null)
    setStatus('')
    try {
      await Promise.all([
        ...creates.map((draft) => api.createTaxonomy({ taxonomy: tab, label: draft.label, color: draft.color })),
        ...updates.map((draft) => api.updateTaxonomy(draft.id, {
          label: draft.label,
          color: draft.color,
          isActive: draft.isActive,
        })),
      ])
      setStatus(`Saved ${creates.length + updates.length} categor${creates.length + updates.length === 1 ? 'y' : 'ies'}.`)
      setRefreshToken((value) => value + 1)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to save categories.')
    } finally {
      setSaving(false)
    }
  }

  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0]

  return <section className="page-stack settings-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow page-eyebrow">Workspace / Settings</div>
        <h1>Categories</h1>
        <p>Edit names and colors freely, then save once when the list looks right.</p>
      </div>
      <div className="page-heading-actions">
        <button type="button" className="button button-ghost" disabled={saving || dirtyCount === 0} onClick={discardChanges}>Discard</button>
        <button type="button" className="button button-primary" disabled={saving || dirtyCount === 0} onClick={() => void saveAll()}>
          {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
          {dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Save changes'}
        </button>
      </div>
    </div>

    <div className="settings-tabs" role="tablist" aria-label="Category types">
      {tabs.map((item) => <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={tab === item.id}
        className={`settings-tab${tab === item.id ? ' is-active' : ''}`}
        onClick={() => changeTab(item.id)}
      >{item.label}</button>)}
    </div>

    <div className="list-panel settings-panel">
      <div className="list-toolbar">
        <div className="list-context">
          <span className="list-icon"><Tags size={16} /></span>
          <div>
            <strong>{activeTab.label} categories</strong>
            <span>{activeTab.hint}</span>
          </div>
        </div>
        {(status || dirtyCount > 0) && <span className="editor-status settings-status">{status || `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}</span>}
      </div>

      {actionError && <div className="form-error settings-inline-error" role="alert">{actionError}</div>}

      {loading ? <LoadingState label="Loading categories…" /> : error ? <ErrorState message={error} onRetry={() => setRefreshToken((value) => value + 1)} /> : <>
        <div className="category-rows">
          {drafts.length === 0 && <EmptyState icon={Tags} title="No categories yet" description="Add the first one below. Keep names short and colors distinct." />}
          {drafts.map((draft) => {
            const inactive = !draft.isActive
            return <article className={`category-row${inactive ? ' is-inactive' : ''}${draft.isNew ? ' is-new' : ''}`} key={draft.id}>
              <label className="category-color">
                <span className="sr-only">Color</span>
                <input type="color" value={draft.color} onChange={(event) => updateDraft(draft.id, { color: event.target.value })} disabled={saving} />
                <span className="category-color-swatch" style={{ background: draft.color }} />
              </label>
              <input
                className="category-label-input"
                value={draft.label}
                aria-label="Category name"
                onChange={(event) => updateDraft(draft.id, { label: event.target.value })}
                disabled={saving}
              />
              <div className="category-presets" aria-label="Color presets">
                {CATEGORY_COLOR_PRESETS.map((color) => <button
                  key={color}
                  type="button"
                  className={`category-preset${draft.color.toLowerCase() === color.toLowerCase() ? ' is-selected' : ''}`}
                  style={{ background: color }}
                  aria-label={`Use ${color}`}
                  onClick={() => updateDraft(draft.id, { color })}
                  disabled={saving}
                />)}
              </div>
              <div className="category-row-actions">
                {draft.isNew ? <button type="button" className="button button-ghost button-small" disabled={saving} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}>Remove</button>
                  : <button type="button" className="button button-ghost button-small" disabled={saving} onClick={() => updateDraft(draft.id, { isActive: !draft.isActive })}>
                    {inactive ? 'Reactivate' : 'Hide'}
                  </button>}
              </div>
            </article>
          })}
        </div>

        <form className="category-create" onSubmit={stageNewCategory}>
          <label className="category-color">
            <span className="sr-only">New category color</span>
            <input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} disabled={saving} />
            <span className="category-color-swatch" style={{ background: newColor }} />
          </label>
          <input
            className="category-label-input"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder={`New ${activeTab.label.toLowerCase()} category`}
            aria-label="New category name"
            disabled={saving}
          />
          <div className="category-presets" aria-label="New category color presets">
            {CATEGORY_COLOR_PRESETS.map((color) => <button
              key={color}
              type="button"
              className={`category-preset${newColor.toLowerCase() === color.toLowerCase() ? ' is-selected' : ''}`}
              style={{ background: color }}
              aria-label={`Use ${color}`}
              onClick={() => setNewColor(color)}
              disabled={saving}
            />)}
          </div>
          <button type="submit" className="button button-ghost" disabled={saving || !newLabel.trim()}>
            <Plus size={15} />
            Add to list
          </button>
        </form>
      </>}
    </div>
  </section>
}

function humanizeActivity(action: string, recordName?: string | null, actorName?: string | null) {
  const labels: Record<string, string> = {
    PERSON_CREATED: 'Person created',
    PERSON_UPDATED: 'Person updated',
    COMPANY_CREATED: 'Company created',
    COMPANY_UPDATED: 'Company updated',
    OPPORTUNITY_CREATED: 'Opportunity created',
    OPPORTUNITY_UPDATED: 'Opportunity updated',
    NOTE_CREATED: 'Note created',
    NOTE_UPDATED: 'Note updated',
    FOLLOW_UP_CREATED: 'Follow-up created',
    FOLLOW_UP_COMPLETED: 'Follow-up completed',
    FOLLOW_UP_CANCELLED: 'Follow-up cancelled',
    LOCAL_EVENT_CREATED: 'Event created',
    LOCAL_EVENT_UPDATED: 'Event updated',
    MEETING_NOTE_COMPLETED: 'Meeting note completed',
    MEETING_NOTE_CANCELLED: 'Meeting note cancelled',
    INTRODUCTION_CREATED: 'Warm introduction planned',
    RECORD_IMPORTED: 'Imported from legacy CSV',
    RECORD_IMPORTED_UPDATE: 'Updated from legacy CSV',
  }
  const title = labels[action] ?? action.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase())
  const detail = [recordName, actorName ? `by ${actorName}` : null].filter(Boolean).join(' · ')
  return { title, detail: detail || 'Workspace update' }
}

function MarkdownField({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  return <div className="markdown-field">
    <div className="markdown-field-toolbar"><span>{editing ? 'Markdown source' : 'Rendered preview'}</span><button type="button" className="button button-ghost button-small" onClick={() => setEditing((current) => !current)}>{editing ? 'Preview' : 'Edit Markdown'}</button></div>
    {editing
      ? <textarea aria-label={`${label} Markdown source`} className="markdown-source" value={value} onChange={(event) => onChange(event.target.value)} rows={10} placeholder={placeholder ?? 'Write with Markdown…'} />
      : value.trim()
        ? <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></div>
        : <div className="markdown-preview markdown-empty">No note content yet. Choose <strong>Edit Markdown</strong> to write the first draft.</div>}
  </div>
}

function workspaceDateAfter(days: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const today = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]))
  const target = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + days, 12))
  const parts = Object.fromEntries(formatter.formatToParts(target).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function DateQuickInput({
  type = 'date', name, value, defaultValue = '', onChange, label, required = false,
}: {
  type?: 'date' | 'datetime-local'
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  label: string
  required?: boolean
}) {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const current = value ?? internalValue
  const update = (next: string) => {
    if (onChange) onChange(next)
    else setInternalValue(next)
  }
  const presets = [
    { label: 'Today', days: 0 },
    { label: 'Tomorrow', days: 1 },
    { label: 'In 2 days', days: 2 },
    { label: 'In 4 days', days: 4 },
    { label: 'Next week', days: 7 },
  ]
  return <div className="date-quick-input">
    <div className="date-shortcuts" aria-label={`Quick ${label.toLowerCase()} options`}>
      {presets.map((preset) => {
        const date = workspaceDateAfter(preset.days)
        const next = type === 'datetime-local' ? `${date}T09:00` : date
        return <button type="button" key={preset.label} className={current === next ? 'date-shortcut selected' : 'date-shortcut'} onClick={() => update(next)}>{preset.label}</button>
      })}
    </div>
    <input aria-label={label} name={name} type={type} value={current} required={required} onChange={(event) => update(event.target.value)} />
  </div>
}

function RecordEditorForm({ definition, record, inline = false, stacked = false, onSave, onCancel, onSaved, onReload }: {
  definition: ResourceFormDefinition
  record?: Record<string, unknown>
  inline?: boolean
  stacked?: boolean
  onSave: (values: Record<string, unknown>) => Promise<unknown>
  onCancel?: () => void
  onSaved: () => void
  onReload?: () => void
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(definition.fields.map((field) => [field.name, fieldInitialValue(field, record)])))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [conflict, setConflict] = useState(false)
  const [recordSnapshot, setRecordSnapshot] = useState<Record<string, unknown> | undefined>(record)

  useEffect(() => {
    setRecordSnapshot(record)
  }, [record])

  function setValue(name: string, value: unknown) { setValues((current) => ({ ...current, [name]: value })); setStatus(''); setError(null) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setError(null); setStatus(''); setConflict(false)
    const payload: Record<string, unknown> = {}
    if (recordSnapshot && recordSnapshot.version != null) payload.version = recordSnapshot.version
    try {
      definition.fields.forEach((field) => {
        const value = values[field.name]
        if (field.type === 'stars') {
          payload[field.name] = typeof value === 'number' && value >= 1 && value <= 5 ? value : recordSnapshot ? null : undefined
        } else if (field.type === 'picker') {
          const selected = (Array.isArray(value) ? value : []) as LookupOption[]
          payload[field.name] = field.multiple ? selected.map((item) => item.id) : selected[0]?.id ?? (recordSnapshot ? null : undefined)
        } else if (field.type === 'links') {
          // API currently expects URL strings; keep local editing as objects for labels.
          payload.links = normalizeRecordLinks(value).map((link) => link.url)
        } else if (field.options) {
          const selected = (Array.isArray(value) ? value : []) as LookupOption[]
          payload[field.name] = selected[0]?.id ?? null
        } else if (typeof value === 'string') {
          if (!value.trim()) payload[field.name] = recordSnapshot ? null : undefined
          else if (field.type === 'number') payload[field.name] = Number(value)
          else if (field.type === 'datetime-local') payload[field.name] = workspaceDateTimeToIso(value)
          else if (field.type === 'date' && (field.name === 'nextFollowUpAt' || field.name.endsWith('At'))) {
            payload[field.name] = workspaceDateTimeToIso(`${value}T12:00`)
          }
          else payload[field.name] = value.trim()
        }
      })
      Object.keys(payload).forEach((key) => { if (payload[key] === undefined) delete payload[key] })
      const saved = await onSave(payload)
      if (saved && typeof saved === 'object') {
        const savedRecord = saved as Record<string, unknown>
        const merged = { ...(recordSnapshot ?? {}), ...savedRecord }
        setRecordSnapshot(merged)
        setValues((current) => {
          const next = { ...current }
          definition.fields.forEach((field) => {
            if (field.type === 'picker' || field.type === 'stars' || field.type === 'links' || field.name in savedRecord) {
              next[field.name] = fieldInitialValue(field, merged)
            }
          })
          return next
        })
      }
      setStatus(recordSnapshot ? 'Changes saved.' : `${definition.singular} created.`)
      onSaved()
    } catch (reason) {
      const apiError = reason instanceof ApiError ? reason : null
      setConflict(apiError?.status === 409 || apiError?.status === 412)
      setError(apiError?.status === 409 || apiError?.status === 412 ? 'This record changed elsewhere. Reload the latest version, then reapply your changes.' : reason instanceof Error ? reason.message : 'Unable to save this record.')
    } finally { setPending(false) }
  }

  return <form onSubmit={submit} className={`form-body record-editor-form${inline ? ' record-editor-inline' : ''}${stacked ? ' record-editor-stacked' : ''}`}>
    <div className={`record-editor-grid${stacked ? ' record-editor-grid-stacked' : ''}`}>
      {definition.fields.map((field) => {
        const value = values[field.name]
        const className = `form-field${field.wide || stacked ? ' field-wide' : ''}`
        const caption = <span>{field.label}{field.required && <b className="required-mark"> *</b>}</span>
        if (field.type === 'picker' || field.options) {
          const selected = Array.isArray(value) ? value as LookupOption[] : []
          const choices = field.options?.map((option) => ({ id: option, label: displayStage(option) }))
          // Use a div, not a label — wrapping the combobox in <label> steals clicks from options/chips.
          return <div className={className} key={field.name}>{caption}{field.help && <small className="field-help">{field.help}</small>}<SearchablePicker label={field.label} selected={selected} onChange={(items) => setValue(field.name, items)} source={field.source} options={choices} multiple={field.multiple} allowCustom={field.allowCustom} placeholder={field.placeholder} /></div>
        }
        if (field.type === 'stars') {
          const rank = typeof value === 'number' ? value : null
          return <div className={className} key={field.name}><span>{field.label}</span><ImportanceStars value={rank} onChange={(next) => setValue(field.name, next)} size={18} /></div>
        }
        if (field.type === 'links') return <div className={className} key={field.name}><span>{field.label}</span><LinkEditor links={Array.isArray(value) ? value as RecordLink[] : []} onChange={(items) => setValue(field.name, items)} /></div>
        if (field.type === 'date' || field.type === 'datetime-local') return <div className={className} key={field.name}><span>{field.label}{field.required && <b className="required-mark"> *</b>}</span>{field.help && <small className="field-help">{field.help}</small>}<DateQuickInput type={field.type} label={field.label} value={String(value ?? '')} onChange={(next) => setValue(field.name, next)} required={field.required} /></div>
        if (field.type === 'markdown') return <div className={className} key={field.name}><span>{field.label}</span><MarkdownField label={field.label} value={String(value ?? '')} onChange={(next) => setValue(field.name, next)} placeholder={field.placeholder} /></div>
        if (field.type === 'textarea') return <label className={className} key={field.name}>{caption}{field.help && <small className="field-help">{field.help}</small>}<textarea value={String(value ?? '')} placeholder={field.placeholder} rows={field.name === 'bodyMarkdown' ? 8 : 4} required={field.required} onChange={(event) => setValue(field.name, event.target.value)} /></label>
        return <label className={className} key={field.name}>{caption}{field.help && <small className="field-help">{field.help}</small>}<input type={field.type ?? 'text'} value={String(value ?? '')} placeholder={field.placeholder} required={field.required} min={field.min} max={field.max} step={field.type === 'number' ? field.min != null || field.max != null ? '1' : 'any' : undefined} onChange={(event) => setValue(field.name, event.target.value)} /></label>
      })}
    </div>
    {error && <div className="form-error" role="alert">{error}{conflict && onReload && <button type="button" className="button button-ghost button-small conflict-reload" onClick={onReload}>Reload record</button>}</div>}
    <div className="editor-footer"><span className="editor-status" role="status" aria-live="polite">{pending ? 'Saving changes…' : status}</span><div className="modal-actions">{onCancel && <button type="button" className="button button-ghost" onClick={onCancel} disabled={pending}>Cancel</button>}<button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : record ? <Check size={15} /> : <Plus size={15} />}{record ? 'Save changes' : `Create ${definition.singular.toLowerCase()}`}</button></div></div>
  </form>
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])
}

function RecordFormDialog({ definition, onClose, onSaved, save }: { definition: ResourceFormDefinition; onClose: () => void; onSaved: () => void; save?: (values: Record<string, unknown>) => Promise<unknown> }) {
  useEscapeToClose(onClose)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal record-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
    <div className="modal-header"><div><div className="eyebrow">New record</div><h2 id="create-title">Add {definition.singular.toLowerCase()}</h2><p className="dialog-hint">Capture the details and connect it to the right people and organizations.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <RecordEditorForm definition={definition} onSave={save ?? ((values) => api.create(definition.resource, values))} onCancel={onClose} onSaved={onSaved} />
  </section></div>
}

const peopleDefinition: ResourceDefinition<PersonRecord> = {
  resource: 'people', singular: 'Person', plural: 'People', eyebrow: 'Relationships', icon: UsersRound,
  description: 'The people behind your most important relationships.',
  emptyTitle: 'Your people are yet to arrive', emptyDescription: 'Create a person to start building your shared relationship history.',
  fields: [
    { name: 'fullName', label: 'Full name', required: true, placeholder: 'Name as it appears in your workspace' },
    { name: 'jobTitle', label: 'Job title', placeholder: 'e.g. Partnerships lead' },
    { name: 'importance', label: 'Importance', type: 'stars', min: 1, max: 5 },
    { name: 'emails', label: 'Email addresses', type: 'picker', multiple: true, allowCustom: true, placeholder: 'Add an email and press Enter' },
    { name: 'phones', label: 'Phone numbers', type: 'picker', multiple: true, allowCustom: true, placeholder: 'Add a phone number and press Enter' },
    { name: 'companyIds', label: 'Companies', type: 'picker', source: 'companies', multiple: true, placeholder: 'Search companies by name' },
    { name: 'introducedByPersonId', label: 'Introduced by', type: 'picker', source: 'people', placeholder: 'Search people by name' },
    { name: 'linkedinUrl', label: 'LinkedIn profile', type: 'url', placeholder: 'https://linkedin.com/in/…' },
    { name: 'links', label: 'Other links', type: 'links', wide: true },
    { name: 'city', label: 'City', type: 'picker', source: 'cities', allowCustom: true, placeholder: 'Search cities…' },
    { name: 'categories', label: 'Categories', type: 'picker', source: 'PERSON_CATEGORY', multiple: true, allowCustom: true, placeholder: 'Search or add a category' },
    { name: 'description', label: 'Description', type: 'textarea', wide: true, placeholder: 'Background, interests, and relationship context' },
  ],
  columns: [
    { label: 'Name', render: (person) => <><span className="avatar avatar-small">{getInitials(personName(person))}</span><span className="cell-primary"><strong>{personName(person)}</strong><small>{person.jobTitle ?? 'No title added'}</small></span></> },
    { label: 'Importance', render: (person) => <ImportanceStars value={person.importance} readOnly size={13} />, className: 'importance-column' },
    { label: 'Email', render: (person) => <span className="cell-muted">{emailOf(person)}</span>, className: 'optional-column' },
    { label: 'Company', render: (person) => <span>{associatedCompanies(person)}</span>, className: 'optional-column' },
    { label: 'Categories', render: (person) => <TaxonomyBadges values={person.categories} />, className: 'optional-column' },
    { label: 'City', render: (person) => <span>{person.city ?? '—'}</span>, className: 'optional-column' },
    { label: 'Updated', render: (person) => <span className="mono-caption">{formatDate(person.updatedAt)}</span>, className: 'date-column' },
  ],
}

const companiesDefinition: ResourceDefinition<CompanyRecord> = {
  resource: 'companies', singular: 'Company', plural: 'Companies', eyebrow: 'Organizations', icon: Building2,
  description: 'The organizations and teams in your network.',
  emptyTitle: 'No companies in your workspace', emptyDescription: 'Add a company to connect people, opportunities, and notes in one place.',
  fields: [
    { name: 'name', label: 'Company name', required: true, placeholder: 'Company name' },
    { name: 'domains', label: 'Domains', type: 'picker', multiple: true, allowCustom: true, placeholder: 'Add a domain and press Enter' },
    { name: 'website', label: 'Website', type: 'url', placeholder: 'https://company.com' },
    { name: 'links', label: 'Other links', type: 'links', wide: true },
    { name: 'categories', label: 'Categories', type: 'picker', source: 'COMPANY_CATEGORY', multiple: true, allowCustom: true, placeholder: 'Search or add a category' },
    { name: 'industries', label: 'Industries', type: 'picker', source: 'INDUSTRY', multiple: true, allowCustom: true, placeholder: 'Search or add an industry' },
    { name: 'customerProfile', label: 'Customer profile', type: 'textarea', placeholder: 'Who does the company serve?' },
    { name: 'businessRole', label: 'Business role', placeholder: 'e.g. Customer, partner, supplier' },
    { name: 'ownerUserId', label: 'Owner', type: 'picker', source: 'users', placeholder: 'Search workspace members by name' },
    { name: 'city', label: 'City', type: 'picker', source: 'cities', allowCustom: true, placeholder: 'Search cities…' },
    { name: 'description', label: 'Description', type: 'textarea', wide: true, placeholder: 'What does this company do?' },
  ],
  columns: [
    { label: 'Company', render: (company) => <><span className="avatar avatar-small company-avatar"><Building2 size={15} /></span><span className="cell-primary"><strong>{company.name}</strong><small>{company.domain ?? company.website ?? 'No website added'}</small></span></> },
    { label: 'Industry', render: (company) => <span>{taxonomyLabels(company.industries) !== '—' ? taxonomyLabels(company.industries) : taxonomyLabels(company.categories)}</span>, className: 'optional-column' },
    { label: 'City', render: (company) => <span>{company.city ?? '—'}</span>, className: 'optional-column' },
    { label: 'People', render: (company) => <span className="mono-caption">{company.peopleCount ?? '—'}</span>, className: 'date-column' },
    { label: 'Updated', render: (company) => <span className="mono-caption">{formatDate(company.updatedAt)}</span>, className: 'date-column' },
  ],
}

const opportunityDefinition: ResourceDefinition<OpportunityRecord> = {
  resource: 'opportunities', singular: 'Opportunity', plural: 'Opportunities', eyebrow: 'Pipeline', icon: BriefcaseBusiness,
  description: 'Keep every deal moving, from first conversation to close.',
  emptyTitle: 'Your pipeline is clear', emptyDescription: 'Add your first opportunity to keep its stage, value, and next action visible.',
  fields: [
    { name: 'name', label: 'Opportunity name', required: true, placeholder: 'Opportunity name' },
    { name: 'stage', label: 'Pipeline stage', type: 'picker', options: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
    { name: 'value', label: 'Value', type: 'number', placeholder: '0' },
    { name: 'currency', label: 'Currency', placeholder: 'EUR' },
    { name: 'expectedCloseDate', label: 'Expected close date', type: 'date' },
    { name: 'nextFollowUpAt', label: 'Next follow-up date', type: 'date' },
    { name: 'nextAction', label: 'Next action', placeholder: 'What should happen next?' },
    { name: 'companyIds', label: 'Companies', type: 'picker', source: 'companies', multiple: true, placeholder: 'Search companies by name' },
    { name: 'personIds', label: 'People', type: 'picker', source: 'people', multiple: true, placeholder: 'Search people by name' },
    { name: 'ownerUserId', label: 'Owner', type: 'picker', source: 'users', placeholder: 'Search workspace members by name' },
    { name: 'description', label: 'Description', type: 'textarea', wide: true, placeholder: 'Context, scope, and success criteria' },
  ],
  columns: [
    { label: 'Opportunity', render: (opportunity) => <span className="cell-primary"><strong>{opportunity.name}</strong><small>{opportunity.companyName ?? opportunity.companies?.map(companyName).join(', ') ?? 'No company linked'}</small></span> },
    { label: 'Stage', render: (opportunity) => <StagePill stage={opportunity.stage} /> },
    { label: 'Value', render: (opportunity) => <span className="mono-value">{opportunity.value == null ? '—' : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(opportunity.value))} ${opportunity.currency ?? 'EUR'}`}</span>, className: 'optional-column' },
    { label: 'Next action', render: (opportunity) => <span className="cell-muted">{opportunity.nextAction ?? '—'}</span>, className: 'optional-column' },
    { label: 'Close date', render: (opportunity) => <span className="mono-caption">{formatDate(opportunity.expectedCloseDate)}</span>, className: 'date-column' },
  ],
  summary: (records) => `${records.length} opportunities · ${records.filter((record) => !['WON', 'LOST'].includes((record.stage ?? '').toUpperCase())).length} active`,
}

const notesDefinition: ResourceDefinition<NoteRecord> = {
  resource: 'notes', singular: 'Note', plural: 'Notes & meetings', eyebrow: 'Knowledge', icon: FileText,
  description: 'Meeting recaps, context, and details worth remembering.',
  emptyTitle: 'No notes just yet', emptyDescription: 'Capture a conversation or add context to make your shared history more useful.',
  fields: [
    { name: 'title', label: 'Title', required: true, placeholder: 'A short, descriptive title' },
    { name: 'noteType', label: 'Note type', type: 'picker', options: ['GENERAL', 'MEETING'] },
    { name: 'bodyMarkdown', label: 'Note (Markdown)', type: 'markdown', wide: true, placeholder: 'Write your note…' },
    { name: 'personIds', label: 'People', type: 'picker', source: 'people', multiple: true, placeholder: 'Search people by name' },
    { name: 'companyIds', label: 'Companies', type: 'picker', source: 'companies', multiple: true, placeholder: 'Search companies by name' },
    { name: 'opportunityIds', label: 'Opportunities', type: 'picker', source: 'opportunities', multiple: true, placeholder: 'Search opportunities by name' },
  ],
  columns: [
    { label: 'Note', render: (note) => <span className="cell-primary"><strong>{note.title}</strong><small className="note-preview">{note.bodyMarkdown ?? note.body ?? 'No preview available'}</small></span> },
    { label: 'Type', render: (note) => <span className="type-label">{(note.noteType ?? note.type ?? 'GENERAL').toLowerCase() === 'meeting' ? 'Meeting' : 'General'}</span> },
    { label: 'Related to', render: (note) => <span className="cell-muted">{note.relatedRecords?.map((record) => record.name).join(', ') || note.personName || note.companyName || note.opportunityName || 'Unassigned'}</span>, className: 'optional-column' },
    { label: 'Last edited', render: (note) => <span className="mono-caption">{formatDate(note.updatedAt ?? note.createdAt)}</span>, className: 'date-column' },
  ],
}

const eventFormDefinition: ResourceFormDefinition = {
  resource: 'events', singular: 'Event', fields: [
    { name: 'title', label: 'Event title', required: true, placeholder: 'A conversation worth remembering' },
    { name: 'startAt', label: 'Starts', type: 'datetime-local', required: true },
    { name: 'endAt', label: 'Ends', type: 'datetime-local', required: true },
    { name: 'location', label: 'Location', placeholder: 'Office, city, or venue' },
    { name: 'meetingUrl', label: 'Meeting link', type: 'url', placeholder: 'https://…' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'What is this event about?' },
  ],
}

const followUpFormDefinition: ResourceFormDefinition = {
  resource: 'follow-ups', singular: 'Follow-up', fields: [
    { name: 'title', label: 'Follow-up', required: true, placeholder: 'Send the proposal' },
    { name: 'dueAt', label: 'Due', type: 'datetime-local', required: true },
    { name: 'relatedRecordIds', label: 'Follow up with / about', type: 'picker', source: 'records', multiple: true, placeholder: 'Search people, companies, or opportunities' },
    { name: 'assigneeUserId', label: 'Assignee', type: 'picker', source: 'users', placeholder: 'Search workspace members by name' },
    { name: 'body', label: 'Details', type: 'textarea', placeholder: 'Context or next step' },
  ],
}

function useWorkflowResource<T>(loader: () => Promise<T[]>) {
  const [records, setRecords] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const reload = useCallback(() => setRefreshToken((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    loader().then((result) => { if (active) setRecords(result) }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this workflow.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loader, refreshToken])

  useEffect(() => {
    const refresh = () => reload()
    window.addEventListener('resoloon:workflow-refresh', refresh)
    return () => window.removeEventListener('resoloon:workflow-refresh', refresh)
  }, [reload])

  return { records, loading, error, reload }
}

function WorkflowListPanel({
  title, icon: Icon, count, loading, error, onRetry, emptyTitle, emptyDescription, emptyAction, children,
}: {
  title: string
  icon: typeof CalendarDays
  count: number
  loading: boolean
  error: string | null
  onRetry: () => void
  emptyTitle: string
  emptyDescription: string
  emptyAction?: ReactNode
  children: ReactNode
}) {
  return <div className="list-panel workflow-list-panel">
    <div className="list-toolbar"><div className="list-context"><span className="list-icon"><Icon size={16} /></span><div><strong>{title}</strong><span>{loading ? 'Loading…' : `${count} ${count === 1 ? 'record' : 'records'}`}</span></div></div></div>
    {loading ? <LoadingState label={`Loading ${title.toLowerCase()}…`} /> : error ? <ErrorState message={error} onRetry={onRetry} /> : count === 0 ? <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} action={emptyAction} /> : <div className="workflow-cards">{children}</div>}
  </div>
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Date not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function workspaceDateTimeToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Enter a valid date and time.')
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  let instant = desired
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
    instant -= represented - desired
  }
  const check = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
  if (
    Number(check.year) !== Number(match[1]) || Number(check.month) !== Number(match[2]) ||
    Number(check.day) !== Number(match[3]) || Number(check.hour) !== Number(match[4]) ||
    Number(check.minute) !== Number(match[5])
  ) throw new Error('That local time does not exist in the workspace timezone. Choose another time.')
  return new Date(instant).toISOString()
}

function statusText(value?: string | null) {
  if (!value) return 'Open'
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusClass(value?: string | null) {
  return (value ?? 'open').toLowerCase().replaceAll('_', '-')
}

function workflowRelated(records?: Array<{ name?: string; type?: string }>, fallback?: string | null) {
  return records?.map((record) => record.name).filter(Boolean).join(', ') || fallback || 'No related record'
}

function EventsPage() {
  const { records, loading, error, reload } = useWorkflowResource<EventRecord>(api.listEvents)
  const [createOpen, setCreateOpen] = useState(false)
  const [meetingNotePending, setMeetingNotePending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function createMeetingNote(record: EventRecord) {
    setActionError(null)
    setMeetingNotePending(record.id)
    try {
      await api.createMeetingNote({ eventId: record.id, title: `Meeting notes — ${record.title ?? 'Meeting'}` })
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to create a meeting-note requirement.')
    } finally {
      setMeetingNotePending(null)
    }
  }

  return <section className="page-stack">
    <div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / CALENDAR</div><h1>Events</h1><p>Create local events and keep dates, locations, and meeting links close to your relationships.</p></div><button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Add event</button></div>
    {actionError && <div className="form-error" role="alert">{actionError}</div>}
    <WorkflowListPanel title="Events" icon={CalendarDays} count={records.length} loading={loading} error={error} onRetry={reload} emptyTitle="No events yet" emptyDescription="Add a local event or connect a calendar to keep meetings in view." emptyAction={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Add event</button>}>
      {records.map((record) => {
        const startAt = record.startAt ?? record.startsAt ?? record.start
        const endAt = record.endAt ?? record.endsAt ?? record.end
        const attendees = Array.isArray(record.attendees) ? record.attendees.map((attendee) => typeof attendee === 'string' ? attendee : attendee.name ?? attendee.email).filter(Boolean) : []
        const canRequestNote = !!endAt && Date.parse(endAt) <= Date.now() && record.status !== 'CANCELLED' && record.workflowEligible !== false && !record.meetingNoteStatus
        return <article className="workflow-card" key={record.id}>
          <div className="workflow-card-heading"><div><span className="eyebrow">{record.source ? statusText(record.source) : 'LOCAL EVENT'}</span><h3>{record.title ?? 'Untitled event'}</h3></div><span className={`workflow-status ${statusClass(record.status)}`}>{statusText(record.status ?? (record.workflowEligible === false ? 'EXCLUDED' : 'SCHEDULED'))}</span></div>
          <p className="workflow-description">{record.description || 'No event description added.'}</p>
          <div className="workflow-card-meta"><span><Clock3 size={13} />{formatDateTime(startAt)}{endAt ? ` – ${formatDateTime(endAt)}` : ''}</span>{record.location && <span><MapPin size={13} />{record.location}</span>}{attendees.length > 0 && <span><UsersRound size={13} />{attendees.join(', ')}</span>}{record.meetingUrl && <a href={record.meetingUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={13} />Join meeting</a>}</div>
          {record.exclusionReason && <p className="workflow-note">Note workflow excluded: {record.exclusionReason}</p>}
          {canRequestNote && <div className="workflow-card-actions"><button type="button" className="button button-ghost button-small" disabled={meetingNotePending === record.id} onClick={() => void createMeetingNote(record)}>{meetingNotePending === record.id ? <LoaderCircle size={13} className="spin" /> : <ClipboardCheck size={13} />}Create meeting-note requirement</button></div>}
          {record.meetingNoteStatus && <p className="workflow-note">Meeting note: {statusText(record.meetingNoteStatus)}</p>}
        </article>
      })}
    </WorkflowListPanel>
    {createOpen && <RecordFormDialog definition={eventFormDefinition} save={api.createEvent} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
  </section>
}

function FollowUpsPage() {
  const { records, loading, error, reload } = useWorkflowResource<FollowUpRecord>(api.listFollowUps)
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function changeStatus(record: FollowUpRecord, status: 'COMPLETED' | 'CANCELLED') {
    setActionError(null)
    setPendingId(record.id)
    try {
      await api.updateFollowUp(record.id, { status })
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update this follow-up.')
    } finally {
      setPendingId(null)
    }
  }

  const openCount = records.filter((record) => !['COMPLETED', 'CANCELLED'].includes((record.status ?? 'OPEN').toUpperCase())).length
  return <section className="page-stack">
    <div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / ACTIONS</div><h1>Follow-ups</h1><p>Make the next relationship-building action clear, assigned, and easy to close out.</p></div><button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Add follow-up</button></div>
    {actionError && <div className="form-error" role="alert">{actionError}</div>}
    <div className="workflow-summary"><span className="workflow-summary-icon"><ListChecks size={16} /></span><span><strong>{openCount}</strong> open action{openCount === 1 ? '' : 's'} {openCount === 1 ? 'needs' : 'need'} attention</span></div>
    <WorkflowListPanel title="Follow-ups" icon={ListChecks} count={records.length} loading={loading} error={error} onRetry={reload} emptyTitle="You’re all caught up" emptyDescription="Create a follow-up to make sure an important next step does not get lost." emptyAction={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Add follow-up</button>}>
      {records.map((record) => {
        const dueAt = record.dueAt
        const isOpen = !['COMPLETED', 'CANCELLED'].includes((record.status ?? 'OPEN').toUpperCase())
        const overdue = isOpen && dueAt != null && new Date(dueAt).getTime() < Date.now()
        const related = workflowRelated(record.relatedRecords, record.personName ?? record.companyName ?? record.opportunityName)
        return <article className={`workflow-card ${overdue ? 'workflow-card-overdue' : ''}`} key={record.id}>
          <div className="workflow-card-heading"><div><span className="eyebrow">{record.source ? statusText(record.source) : 'FOLLOW-UP'}</span><h3>{record.title ?? 'Untitled follow-up'}</h3></div><span className={`workflow-status ${statusClass(overdue ? 'OVERDUE' : record.status)}`}>{overdue ? 'Overdue' : statusText(record.status)}</span></div>
          {record.body && <p className="workflow-description">{record.body}</p>}
          <div className="workflow-card-meta"><span><Clock3 size={13} />Due {formatDateTime(dueAt)}</span><span><UsersRound size={13} />{related}</span>{(record.assigneeName ?? record.assigneeUserId) && <span>Assigned to {record.assigneeName ?? 'a workspace member'}</span>}</div>
          {isOpen && <div className="workflow-card-actions"><button type="button" className="button button-ghost button-small" disabled={pendingId === record.id} onClick={() => void changeStatus(record, 'COMPLETED')}>{pendingId === record.id ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}Complete</button><button type="button" className="button button-ghost button-small danger-action" disabled={pendingId === record.id} onClick={() => void changeStatus(record, 'CANCELLED')}>Cancel</button></div>}
        </article>
      })}
    </WorkflowListPanel>
    {createOpen && <RecordFormDialog definition={followUpFormDefinition} save={api.createFollowUp} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
  </section>
}

function IntroductionFormDialog({ people, peopleLoading, onClose, onSaved }: { people: PersonRecord[]; peopleLoading: boolean; onClose: () => void; onSaved: () => void }) {
  const [stepCount, setStepCount] = useState(1)
  const [target, setTarget] = useState<LookupOption[]>([])
  const [owner, setOwner] = useState<LookupOption[]>([])
  const [fromPeople, setFromPeople] = useState<LookupOption[][]>([[]])
  const [toPeople, setToPeople] = useState<LookupOption[][]>([[]])
  const [responsibleUsers, setResponsibleUsers] = useState<LookupOption[][]>([[]])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const targetPersonId = target[0]?.id ?? ''
    if (!targetPersonId) { setError('Choose a target person by name.'); return }
    const steps = Array.from({ length: stepCount }, (_, index) => {
      const fromPersonId = fromPeople[index]?.[0]?.id ?? ''
      const toPersonId = toPeople[index]?.[0]?.id ?? ''
      const responsibleUserId = responsibleUsers[index]?.[0]?.id ?? ''
      const notes = String(form.get(`steps.${index}.notes`) ?? '').trim()
      const followUpDate = String(form.get(`steps.${index}.followUpAt`) ?? '').trim()
      const followUpAt = followUpDate ? workspaceDateTimeToIso(`${followUpDate}T12:00`) : undefined
      return { position: index + 1, ...(fromPersonId ? { fromPersonId } : {}), toPersonId, ...(responsibleUserId ? { responsibleUserId } : {}), status: 'PENDING', ...(notes ? { notes } : {}), ...(followUpAt ? { followUpAt } : {}) }
    })
    if (steps.some((step) => !step.toPersonId)) { setError('Choose a next person for each step.'); return }
    setPending(true)
    try {
      await api.createIntroduction({ targetPersonId, ...(owner[0]?.id ? { ownerUserId: owner[0].id } : {}), steps })
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create this introduction.')
    } finally {
      setPending(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal workflow-modal" role="dialog" aria-modal="true" aria-labelledby="intro-form-title">
    <div className="modal-header"><div><div className="eyebrow">RELATIONSHIP DEVELOPMENT</div><h2 id="intro-form-title">Plan a warm introduction</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <form className="form-body" onSubmit={submit}>
      <p className="dialog-hint">Build an ordered path through people in your CRM. The first step can start with your team.</p>
      <div className="form-grid"><label className="form-field"><span>Target person <b className="required-mark"> *</b></span><SearchablePicker label="Target person" selected={target} onChange={setTarget} source="people" placeholder="Search people by name" /></label><label className="form-field"><span>Chain owner</span><SearchablePicker label="Chain owner" selected={owner} onChange={setOwner} source="users" placeholder="Search workspace members" /></label></div>
      {!peopleLoading && people.length === 0 && <p className="dialog-hint">Add a person before planning an introduction. <Link to="/people" className="one-time-link-open">Open people</Link></p>}
      {Array.from({ length: stepCount }, (_, index) => <fieldset className="intro-step" key={index}><legend>Step {index + 1}</legend><div className="form-grid"><label className="form-field"><span>Introducer{index === 0 ? ' (leave blank for team)' : ''}</span><SearchablePicker label={`Step ${index + 1} introducer`} selected={fromPeople[index] ?? []} onChange={(items) => setFromPeople((current) => current.map((item, itemIndex) => itemIndex === index ? items : item))} source="people" placeholder={index === 0 ? 'Your team (or choose a person)' : 'Search people by name'} /></label><label className="form-field"><span>Next person <b className="required-mark"> *</b></span><SearchablePicker label={`Step ${index + 1} next person`} selected={toPeople[index] ?? []} onChange={(items) => setToPeople((current) => current.map((item, itemIndex) => itemIndex === index ? items : item))} source="people" placeholder="Search people by name" /></label><label className="form-field"><span>Responsible member</span><SearchablePicker label={`Step ${index + 1} responsible member`} selected={responsibleUsers[index] ?? []} onChange={(items) => setResponsibleUsers((current) => current.map((item, itemIndex) => itemIndex === index ? items : item))} source="users" placeholder="Search workspace members" /></label><div className="form-field"><span>Follow-up date</span><DateQuickInput name={`steps.${index}.followUpAt`} label={`Step ${index + 1} follow-up date`} /></div></div><label className="form-field"><span>Step notes</span><textarea name={`steps.${index}.notes`} rows={2} placeholder="Context or the ask for this introduction" /></label></fieldset>)}
      <button type="button" className="button button-ghost button-small add-step-button" disabled={stepCount >= 5} onClick={() => { const next = stepCount + 1; setStepCount(Math.min(5, next)); setFromPeople((current) => [...current, []]); setToPeople((current) => [...current, []]); setResponsibleUsers((current) => [...current, []]) }}><Plus size={13} />Add another step</button>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : <GitBranch size={15} />}Create introduction</button></div>
    </form>
  </section></div>
}

function IntroductionsPage() {
  const { records, loading, error, reload } = useWorkflowResource<WarmIntroductionRecord>(api.listIntroductions)
  const people = useResource<PersonRecord>('people')
  const peopleById = useMemo(() => new Map(people.records.map((person) => [person.id, personName(person)])), [people.records])
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingStep, setPendingStep] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function updateStep(record: WarmIntroductionRecord, step: NonNullable<WarmIntroductionRecord['steps']>[number], nextStatus: 'REQUESTED' | 'INTRODUCED') {
    const stepKey = `${record.id}-${step.id ?? step.position ?? ''}`
    setPendingStep(stepKey)
    setActionError(null)
    const updatedSteps = (record.steps ?? []).map((item, index) => ({
      ...(item.id ? { id: item.id } : {}),
      position: item.position ?? index + 1,
      fromPersonId: item.fromPersonId ?? null,
      toPersonId: item.toPersonId ?? '',
      responsibleUserId: item.responsibleUserId ?? null,
      responsiblePersonId: item.responsiblePersonId ?? null,
      status: item.id === step.id ? nextStatus : item.status ?? 'PENDING',
      notes: item.notes ?? null,
      requestedAt: item.requestedAt ?? null,
      followUpAt: item.followUpAt ?? null,
    }))
    const allTerminal = updatedSteps.every((item) => ['INTRODUCED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'SKIPPED'].includes(item.status.toUpperCase()))
    try {
      await api.updateIntroduction(record.id, { steps: updatedSteps, ...(allTerminal ? { status: 'COMPLETED' } : {}) })
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update this introduction step.')
    } finally {
      setPendingStep(null)
    }
  }

  return <section className="page-stack">
    <div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / RELATIONSHIPS</div><h1>Warm introductions</h1><p>Map the people who can open the next door, one clear step at a time.</p></div><button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Plan introduction</button></div>
    {actionError && <div className="form-error" role="alert">{actionError}</div>}
    <WorkflowListPanel title="Introduction chains" icon={GitBranch} count={records.length} loading={loading} error={error} onRetry={reload} emptyTitle="No introduction chains yet" emptyDescription="Create a path through your network and make each person’s next action visible." emptyAction={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Plan introduction</button>}>
      {records.map((record) => {
        const steps = Array.isArray(record.steps) ? [...record.steps].sort((left, right) => (left.position ?? 0) - (right.position ?? 0)) : []
        return <article className="workflow-card" key={record.id}>
          <div className="workflow-card-heading"><div><span className="eyebrow">INTRODUCTION CHAIN</span><h3>{record.targetPersonName ?? (record.targetPersonId ? peopleById.get(record.targetPersonId) ?? 'Target person' : 'Target person not set')}</h3></div><span className={`workflow-status ${statusClass(record.status)}`}>{statusText(record.status ?? 'ACTIVE')}</span></div>
          <p className="workflow-intro-owner">{record.ownerName ? `Owned by ${record.ownerName}` : record.ownerUserId ? 'Owned by a workspace member' : 'Shared relationship workflow'}{record.currentStep ? ` · Current step ${record.currentStep}` : ''}</p>
          {steps.length ? <ol className="intro-path">{steps.map((step, index) => {
            const stepKey = `${record.id}-${step.id ?? step.position ?? ''}`
            const stepStatus = (step.status ?? 'PENDING').toUpperCase()
            return <li key={step.id ?? `${record.id}-${step.position ?? index}`}><span className="intro-step-number">{step.position ?? index + 1}</span><div className="intro-step-copy"><strong>{step.fromPersonName ?? (step.fromPersonId ? peopleById.get(step.fromPersonId) ?? 'Person' : 'Your team')} <ArrowUpRight size={12} /> {step.toPersonName ?? (step.toPersonId ? peopleById.get(step.toPersonId) ?? 'Person' : 'Next person')}</strong><small>{step.notes || (step.followUpAt ? `Follow up ${formatDate(step.followUpAt)}` : 'No step notes')}</small></div><span className={`workflow-status ${statusClass(step.status)}`}>{statusText(step.status ?? 'PENDING')}</span>{stepStatus === 'PENDING' && <button type="button" className="button button-ghost button-small intro-step-action" disabled={pendingStep === stepKey} onClick={() => void updateStep(record, step, 'REQUESTED')}>{pendingStep === stepKey ? <LoaderCircle size={12} className="spin" /> : null}Request intro</button>}{stepStatus === 'REQUESTED' && <button type="button" className="button button-ghost button-small intro-step-action" disabled={pendingStep === stepKey} onClick={() => void updateStep(record, step, 'INTRODUCED')}>{pendingStep === stepKey ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}Mark introduced</button>}</li>
          })}</ol> : <p className="workflow-note">No steps have been added to this chain yet.</p>}
        </article>
      })}
    </WorkflowListPanel>
    {createOpen && <IntroductionFormDialog people={people.records} peopleLoading={people.loading} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
  </section>
}

function MeetingNoteActionDialog({ record, mode, onClose, onSaved }: {
  record: MeetingNoteRequirementRecord
  mode: 'view' | 'edit' | 'complete' | 'cancel'
  onClose: () => void
  onSaved: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readOnly = mode === 'view'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (readOnly) return
    setError(null)
    const form = new FormData(event.currentTarget)
    setPending(true)
    try {
      if (mode === 'complete') {
        await api.completeMeetingNote(record.id, {
          summary: String(form.get('summary') ?? '').trim(),
          nextStepsMarkdown: String(form.get('nextStepsMarkdown') ?? '').trim() || undefined,
          followUpDate: String(form.get('followUpDate') ?? '').trim() || undefined,
        })
      } else if (mode === 'edit') {
        await api.updateMeetingNote(record.id, {
          summary: String(form.get('summary') ?? '').trim(),
          nextStepsMarkdown: String(form.get('nextStepsMarkdown') ?? '').trim() || undefined,
          followUpDate: String(form.get('followUpDate') ?? '').trim() || undefined,
        })
      } else {
        await api.cancelMeetingNote(record.id, String(form.get('reason') ?? '').trim())
      }
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update this meeting note.')
    } finally {
      setPending(false)
    }
  }
  const title = record.eventTitle ?? record.title ?? 'Meeting note'
  const eyebrow = mode === 'complete' ? 'MEETING RECAP' : mode === 'edit' ? 'EDIT NOTE' : mode === 'view' ? 'MEETING NOTE' : 'CANCEL REQUIREMENT'
  const heading = mode === 'complete' ? 'Complete meeting note' : mode === 'edit' ? 'Edit meeting note' : mode === 'view' ? 'Meeting note' : 'Cancel meeting note'
  const noteFields = <>
    <label className="form-field"><span>Meeting summary{!readOnly && <b className="required-mark"> *</b>}</span>
      <textarea name="summary" rows={5} required={!readOnly} readOnly={readOnly} defaultValue={record.summary ?? ''} placeholder="What was discussed?" />
    </label>
    <label className="form-field"><span>Next steps</span>
      <textarea name="nextStepsMarkdown" rows={3} readOnly={readOnly} defaultValue={record.nextStepsMarkdown ?? ''} placeholder="Actions, owners, and decisions" />
    </label>
    <div className="form-field"><span>Follow-up date</span>
      {readOnly
        ? <input type="text" readOnly value={record.followUpDate ? formatDate(record.followUpDate) : '—'} />
        : <DateQuickInput name="followUpDate" label="Follow-up date" defaultValue={record.followUpDate?.slice(0, 10) ?? ''} />}
    </div>
  </>
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="meeting-note-action-title">
    <div className="modal-header"><div><div className="eyebrow">{eyebrow}</div><h2 id="meeting-note-action-title">{heading}</h2><p className="dialog-hint">{title}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <form className="form-body" onSubmit={submit}>
      {mode === 'cancel'
        ? <label className="form-field"><span>Cancellation reason <b className="required-mark"> *</b></span><textarea name="reason" rows={3} required placeholder="Why is this note no longer required?" /></label>
        : noteFields}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="button button-ghost" onClick={onClose} disabled={pending}>{readOnly ? 'Close' : mode === 'cancel' ? 'Keep open' : 'Discard'}</button>
        {!readOnly && <button type="submit" className={`button ${mode === 'cancel' ? 'button-ghost danger-action' : 'button-primary'}`} disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : mode === 'complete' || mode === 'edit' ? <Check size={15} /> : null}{mode === 'complete' ? 'Complete note' : mode === 'edit' ? 'Save changes' : 'Cancel requirement'}</button>}
      </div>
    </form>
  </section></div>
}

function MeetingNotesPage() {
  const { records, loading, error, reload } = useWorkflowResource<MeetingNoteRequirementRecord>(api.listMeetingNotes)
  const [action, setAction] = useState<{ record: MeetingNoteRequirementRecord; mode: 'view' | 'edit' | 'complete' | 'cancel' } | null>(null)
  const outstanding = records.filter((record) => !['COMPLETED', 'CANCELLED'].includes((record.status ?? 'REQUIRED').toUpperCase())).length
  return <section className="page-stack">
    <div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / MEETING WORKFLOW</div><h1>Meeting notes</h1><p>Recaps for eligible meetings. Write the note, mark it complete, or reopen it later to edit.</p></div></div>
    <div className="workflow-summary"><span className="workflow-summary-icon"><ClipboardCheck size={16} /></span><span><strong>{outstanding}</strong> note{outstanding === 1 ? '' : 's'} still required</span></div>
    <WorkflowListPanel title="Meeting notes" icon={ClipboardCheck} count={records.length} loading={loading} error={error} onRetry={reload} emptyTitle="No meeting notes required" emptyDescription="Required notes appear here after eligible meetings. Calendar exclusions prevent unnecessary reminders.">
      {records.map((record) => {
        const status = (record.status ?? 'REQUIRED').toUpperCase()
        const required = status === 'REQUIRED'
        const completed = status === 'COMPLETED'
        const cancelled = status === 'CANCELLED'
        const eyebrow = required ? 'REQUIRED RECAP' : completed ? 'MEETING RECAP' : 'CANCELLED RECAP'
        return <article className="workflow-card" key={record.id}>
          <div className="workflow-card-heading"><div><span className="eyebrow">{eyebrow}</span><h3>{record.eventTitle ?? record.title ?? 'Meeting note'}</h3></div><span className={`workflow-status ${statusClass(status)}`}>{statusText(status)}</span></div>
          <div className="workflow-card-meta"><span><Clock3 size={13} />{formatDateTime(record.meetingAt ?? record.createdAt)}</span>{record.followUpDate && <span>Follow-up {formatDate(record.followUpDate)}</span>}</div>
          {record.summary
            ? <div className="workflow-note-body"><span className="eyebrow">Note</span><p className="workflow-description">{record.summary}</p></div>
            : required && <p className="workflow-note">No note written yet.</p>}
          {record.nextStepsMarkdown && <div className="workflow-note-body"><span className="eyebrow">Next steps</span><p className="workflow-description">{record.nextStepsMarkdown}</p></div>}
          {record.cancellationReason && <p className="workflow-note">Cancelled: {record.cancellationReason}</p>}
          <div className="workflow-card-actions">
            {(completed || (record.summary && !required)) && <button type="button" className="button button-ghost button-small" onClick={() => setAction({ record, mode: 'view' })}><FileText size={13} />View note</button>}
            {(required || completed) && <button type="button" className="button button-ghost button-small" onClick={() => setAction({ record, mode: required ? 'complete' : 'edit' })}>{required ? <Check size={13} /> : <Pencil size={13} />}{required ? 'Write / complete' : 'Edit note'}</button>}
            {required && <button type="button" className="button button-ghost button-small danger-action" onClick={() => setAction({ record, mode: 'cancel' })}>Cancel requirement</button>}
            <Link to={`/notes?id=${encodeURIComponent(record.id)}`} className="button button-ghost button-small">Open in Notes<ArrowUpRight size={13} /></Link>
            {cancelled && !record.summary && <button type="button" className="button button-ghost button-small" onClick={() => setAction({ record, mode: 'view' })}><FileText size={13} />Details</button>}
          </div>
        </article>
      })}
    </WorkflowListPanel>
    {action && <MeetingNoteActionDialog record={action.record} mode={action.mode} onClose={() => setAction(null)} onSaved={() => { setAction(null); reload() }} />}
  </section>
}

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/people', label: 'People', icon: UsersRound },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/opportunities', label: 'Opportunities', icon: BriefcaseBusiness },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/follow-ups', label: 'Follow-ups', icon: ListChecks },
  { to: '/introductions', label: 'Warm intros', icon: GitBranch },
  { to: '/meeting-notes', label: 'Meeting notes', icon: ClipboardCheck },
  { to: '/notes', label: 'Notes', icon: FileText },
]

function BrandLogo({ className = '' }: { className?: string }) {
  const [unavailable, setUnavailable] = useState(false)
  return unavailable
    ? <span className="brand-mark" aria-label="Resoloon"><span /></span>
    : <img className={`brand-wordmark ${className}`} src="/resoloon_light_long_logo_-_no_ballon.svg" alt="Resoloon" onError={() => setUnavailable(true)} />
}

function AuthBrand() {
  return <div className="auth-brand"><BrandLogo className="brand-wordmark-auth" /><span className="brand-product-label">CRM</span></div>
}

function LoginPage({ onAuthenticated }: { onAuthenticated: (user: UserIdentity) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(event.currentTarget)
    try {
      const user = await api.login(String(form.get('email') ?? '').trim(), String(form.get('password') ?? ''))
      onAuthenticated(user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return <main className="auth-screen"><section className="auth-card" aria-labelledby="login-title">
    <AuthBrand />
    <div className="eyebrow auth-eyebrow">PRIVATE WORKSPACE</div>
    <h1 id="login-title">Welcome back</h1>
    <p className="auth-description">Sign in to continue to your relationship workspace.</p>
    <form className="auth-form" onSubmit={submit}>
      <label className="form-field" htmlFor="login-email"><span>Email address</span><input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" required autoFocus /></label>
      <label className="form-field" htmlFor="login-password"><span>Password</span><input id="login-password" name="password" type="password" autoComplete="current-password" required /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="button button-primary auth-submit" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : null}{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="cookie-note"><ShieldCheck size={14} />Session authentication uses an HttpOnly cookie.</p>
  </section></main>
}

function SetupPage({ onAuthenticated }: { onAuthenticated: (user: UserIdentity) => void }) {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (!token) { setError('This setup link is missing its access token. Ask your administrator for a new link.'); return }
    if (password !== String(form.get('confirmPassword') ?? '')) { setError('The passwords do not match.'); return }
    setPending(true)
    try {
      onAuthenticated(await api.setup(token, password))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to set up your password. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return <main className="auth-screen"><section className="auth-card" aria-labelledby="setup-title">
    <AuthBrand />
    <div className="eyebrow auth-eyebrow">ACCOUNT ACCESS</div>
    <h1 id="setup-title">Set your password</h1>
    <p className="auth-description">Choose a password with at least 12 characters to activate your account.</p>
    <form className="auth-form" onSubmit={submit}>
      <label className="form-field" htmlFor="setup-password"><span>New password</span><input id="setup-password" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus /></label>
      <label className="form-field" htmlFor="setup-confirm-password"><span>Confirm password</span><input id="setup-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="button button-primary auth-submit" disabled={pending || !token}>{pending ? <LoaderCircle size={15} className="spin" /> : null}{pending ? 'Saving password…' : 'Set password'}</button>
    </form>
    {!token && <p className="auth-footnote">Setup links are single-use and expire. Contact your administrator to request another.</p>}
    {!token && <Link className="auth-back-link" to="/">Back to sign in</Link>}
    <p className="cookie-note"><ShieldCheck size={14} />Session authentication uses an HttpOnly cookie.</p>
  </section></main>
}

function AuthStatusPage({ loading, message, onRetry, onSignIn }: { loading?: boolean; message?: string; onRetry?: () => void; onSignIn?: () => void }) {
  return <main className="auth-screen"><section className="auth-card auth-status-card" aria-live="polite">
    <AuthBrand />
    {loading ? <div className="auth-loading"><LoaderCircle size={19} className="spin accent" /><span>Checking your session…</span></div> : <>
      <div className="eyebrow auth-eyebrow">WORKSPACE ACCESS</div><h1>We couldn’t verify your session</h1>
      <p className="auth-description">{message ?? 'The workspace is temporarily unavailable. Your CRM data remains hidden until access can be verified.'}</p>
      <div className="auth-status-actions"><button type="button" className="button button-primary" onClick={onRetry}>Try again</button><button type="button" className="button button-ghost" onClick={onSignIn}>Sign in</button></div>
    </>}
  </section></main>
}

function AccessDeniedPage() {
  return <section className="page-stack"><div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / ACCESS</div><h1>Administrator access required</h1><p>Your account does not have permission to manage workspace users.</p></div></div><Link to="/" className="button button-ghost">Back to dashboard</Link></section>
}

function UserFormDialog({ user, onClose, onSaved }: { user?: AdminUser; onClose: () => void; onSaved: (created?: { user: AdminUser; setupUrl: string }) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<LookupOption[]>([{ id: user?.role ?? 'USER', label: user?.role === 'ADMIN' ? 'Administrator' : 'User' }])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(event.currentTarget)
    const values = {
      fullName: String(form.get('fullName') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      role: (role[0]?.id ?? 'USER') as 'ADMIN' | 'USER',
    }
    try {
      if (user) {
        await api.updateAdminUser(user.id, values)
        onSaved()
      } else {
        onSaved(await api.createAdminUser(values))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this user.')
    } finally {
      setPending(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="user-form-title">
    <div className="modal-header"><div><div className="eyebrow">{user ? 'Workspace access' : 'Invite a teammate'}</div><h2 id="user-form-title">{user ? 'Edit user' : 'Add a user'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <form className="form-body" onSubmit={submit}>
      <label className="form-field" htmlFor="user-full-name"><span>Full name</span><input id="user-full-name" name="fullName" autoComplete="name" maxLength={200} required defaultValue={user?.fullName ?? ''} /></label>
      <label className="form-field" htmlFor="user-email"><span>Email address</span><input id="user-email" name="email" type="email" autoComplete="email" maxLength={320} required defaultValue={user?.email ?? ''} /></label>
      <label className="form-field"><span>Role</span><SearchablePicker label="Role" selected={role} onChange={setRole} options={[{ id: 'USER', label: 'User' }, { id: 'ADMIN', label: 'Administrator' }]} /></label>
      {!user && <p className="dialog-hint">A single-use setup link will be created for this person.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{user ? 'Save changes' : 'Create user'}</button></div>
    </form>
  </section></div>
}

function OneTimeLinkNotice({ notice, onDismiss }: { notice: { name: string; kind: 'setup' | 'reset'; url: string }; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(notice.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return <section className="one-time-link" aria-labelledby="one-time-link-title">
    <div className="one-time-link-heading"><div><span className="eyebrow">SHARE THIS LINK ONCE</span><h2 id="one-time-link-title">{notice.kind === 'setup' ? 'Setup link created' : 'Password reset link created'}</h2><p>Send this single-use link to {notice.name}. It expires in 7 days and won’t be shown again after you leave this page.</p></div><button type="button" className="icon-button" aria-label="Dismiss one-time link" onClick={onDismiss}><X size={15} /></button></div>
    <div className="one-time-link-field"><input aria-label="One-time account access link" readOnly value={notice.url} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button-ghost button-small" onClick={copyLink}>{copied ? <Check size={14} /> : null}{copied ? 'Copied' : 'Copy link'}</button></div>
    <span className="copy-status" role="status">{copied ? 'Link copied to clipboard.' : ''}</span>
    <a className="one-time-link-open" href={notice.url} target="_blank" rel="noreferrer">Open setup page</a>
  </section>
}

function AdminUsersPage({ currentUserId }: { currentUserId?: string }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [notice, setNotice] = useState<{ name: string; kind: 'setup' | 'reset'; url: string } | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api.listAdminUsers().then((items) => { if (active) setUsers(items) }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load workspace users.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshToken])

  async function changeState(user: AdminUser, state: 'ACTIVE' | 'DEACTIVATED') {
    setActionError(null)
    setPendingId(user.id)
    try {
      await api.updateAdminUser(user.id, { state })
      setRefreshToken((value) => value + 1)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update this account.')
    } finally {
      setPendingId(null)
    }
  }

  async function resetAccess(user: AdminUser) {
    setActionError(null)
    setPendingId(user.id)
    try {
      const result = await api.resetAdminUserAccess(user.id)
      setNotice({ name: user.fullName, kind: 'reset', url: result.resetUrl })
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to create a reset link.')
    } finally {
      setPendingId(null)
    }
  }

  return <section className="page-stack admin-page">
    <div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / ADMINISTRATION</div><h1>Users</h1><p>Manage who can access this workspace and what they can do.</p></div><button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Add user</button></div>
    {notice && <OneTimeLinkNotice notice={notice} onDismiss={() => setNotice(null)} />}
    {actionError && <div className="form-error" role="alert">{actionError}</div>}
    <div className="list-panel admin-user-list"><div className="list-toolbar"><div className="list-context"><span className="list-icon"><UsersRound size={16} /></span><div><strong>Workspace users</strong><span>{loading ? 'Loading…' : `${users.length} ${users.length === 1 ? 'user' : 'users'}`}</span></div></div></div>
      {loading ? <LoadingState label="Loading users…" /> : error ? <ErrorState message={error} onRetry={() => setRefreshToken((value) => value + 1)} /> : !users.length ? <EmptyState icon={UsersRound} title="No users found" description="Add a user to invite them into your workspace." action={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Add user</button>} /> : <div className="admin-users">
        {users.map((user) => <article className="admin-user-row" key={user.id}>
          <span className="avatar admin-avatar">{getInitials(user.fullName)}</span>
          <div className="admin-user-identity"><strong>{user.fullName}{user.id === currentUserId && <span className="you-label">You</span>}</strong><span>{user.email}</span></div>
          <span className={`role-pill ${user.role === 'ADMIN' ? 'role-admin' : ''}`}>{user.role === 'ADMIN' ? 'Administrator' : 'User'}</span>
          <span className={`user-state state-${user.state.toLowerCase()}`}><span />{user.state === 'SETUP_REQUIRED' ? 'Setup required' : user.state === 'DEACTIVATED' ? 'Deactivated' : 'Active'}</span>
          <div className="admin-user-actions">
            <button type="button" className="button button-ghost button-small" onClick={() => setEditingUser(user)} disabled={pendingId === user.id}>Edit</button>
            {user.state !== 'DEACTIVATED' && <button type="button" className="button button-ghost button-small" onClick={() => void resetAccess(user)} disabled={pendingId === user.id}>{pendingId === user.id ? <LoaderCircle size={13} className="spin" /> : null}Reset access</button>}
            {user.state === 'DEACTIVATED' ? <button type="button" className="button button-ghost button-small" onClick={() => void changeState(user, 'ACTIVE')} disabled={pendingId === user.id}>{pendingId === user.id ? <LoaderCircle size={13} className="spin" /> : null}Reactivate</button> : <button type="button" className="button button-ghost button-small danger-action" onClick={() => void changeState(user, 'DEACTIVATED')} disabled={pendingId === user.id || user.id === currentUserId} title={user.id === currentUserId ? 'You cannot deactivate your own account' : undefined}>{pendingId === user.id ? <LoaderCircle size={13} className="spin" /> : null}Deactivate</button>}
          </div>
        </article>)}
      </div>}
    </div>
    {createOpen && <UserFormDialog onClose={() => setCreateOpen(false)} onSaved={(created) => { setCreateOpen(false); setRefreshToken((value) => value + 1); if (created) setNotice({ name: created.user.fullName, kind: 'setup', url: created.setupUrl }) }} />}
    {editingUser && <UserFormDialog user={editingUser} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); setRefreshToken((value) => value + 1) }} />}
  </section>
}

export default function App() {
  const [identity, setIdentity] = useState<UserIdentity | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'denied'>('loading')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authAttempt, setAuthAttempt] = useState(0)
  const [mobileNav, setMobileNav] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null)
  const [logoutPending, setLogoutPending] = useState(false)
  const [undoNotice, setUndoNotice] = useState<{ token: string; label: string } | null>(null)
  const [undoPending, setUndoPending] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    setAuthState('loading')
    api.me().then((user) => {
      if (active) { setIdentity(user); setAuthError(null); setAuthState('authenticated') }
    }).catch((reason: unknown) => {
      if (!active) return
      setIdentity(null)
      if (reason instanceof ApiError && reason.status === 401) {
        setAuthError(null)
        setAuthState('unauthenticated')
      } else {
        setAuthError(reason instanceof Error ? reason.message : 'The workspace is temporarily unavailable.')
        setAuthState('denied')
      }
    })
    return () => { active = false }
  }, [authAttempt])

  useEffect(() => {
    setMobileNav(false)
    setSearchOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ token: string; label: string }>).detail
      if (detail?.token) { setUndoNotice(detail); setUndoError(null) }
    }
    window.addEventListener('resoloon:undo-available', announce)
    return () => window.removeEventListener('resoloon:undo-available', announce)
  }, [])

  const undoLastAction = useCallback(async () => {
    if (!undoNotice || undoPending) return
    setUndoPending(true)
    setUndoError(null)
    try {
      await api.undo(undoNotice.token)
      setUndoNotice(null)
      window.dispatchEvent(new Event('resoloon:workflow-refresh'))
      setLogoutMessage('The last workflow action was restored.')
      window.setTimeout(() => setLogoutMessage(null), 4000)
    } catch (reason) {
      setUndoError(reason instanceof Error ? reason.message : 'Unable to undo that action.')
    } finally {
      setUndoPending(false)
    }
  }, [undoNotice, undoPending])

  useEffect(() => {
    if (!undoNotice) return
    function handleUndoShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const editingText = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !editingText) {
        event.preventDefault()
        void undoLastAction()
      }
    }
    window.addEventListener('keydown', handleUndoShortcut)
    return () => window.removeEventListener('keydown', handleUndoShortcut)
  }, [undoNotice, undoLastAction])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    const query = searchValue.trim()
    if (authState !== 'authenticated' || query.length < 2) { setSearchResults([]); setSearchError(null); setSearching(false); return }
    let active = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      api.search(query).then((results) => { if (active) { setSearchResults(results.slice(0, 6)); setSearchError(null) } }).catch((reason: unknown) => { if (active) { setSearchError(reason instanceof Error ? reason.message : 'Search is unavailable.'); setSearchResults([]) } }).finally(() => { if (active) setSearching(false) })
    }, 240)
    return () => { active = false; window.clearTimeout(timer) }
  }, [authState, searchValue])

  const fullName = identity?.fullName ?? identity?.name
  const isAdmin = identity?.role?.toUpperCase() === 'ADMIN'

  function acceptIdentity(user: UserIdentity) {
    setIdentity(user)
    setAuthError(null)
    setAuthState('authenticated')
    navigate('/')
  }

  async function logout() {
    setLogoutMessage(null)
    setLogoutPending(true)
    try {
      await api.logout()
      setIdentity(null)
      setAuthState('unauthenticated')
      navigate('/')
    } catch (reason) {
      setLogoutMessage(reason instanceof Error ? reason.message : 'Unable to sign out.')
      window.setTimeout(() => setLogoutMessage(null), 4000)
    } finally {
      setLogoutPending(false)
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchValue.trim()
    if (!query) return
    setSearchOpen(false)
    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  if (location.pathname === '/setup') return <SetupPage onAuthenticated={acceptIdentity} />
  if (authState === 'loading') return <AuthStatusPage loading />
  if (authState === 'denied') return <AuthStatusPage message={authError ?? undefined} onRetry={() => setAuthAttempt((value) => value + 1)} onSignIn={() => { setIdentity(null); setAuthError(null); setAuthState('unauthenticated') }} />
  if (authState === 'unauthenticated' || !identity) return <LoginPage onAuthenticated={acceptIdentity} />

  return <div className="app-shell">
    {mobileNav && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><BrandLogo /><span className="brand-product-label">CRM</span><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={16} /></button></div>
      <div className="workspace-switcher" aria-label="Current workspace"><span className="workspace-monogram">R</span><span><strong>Resoloon</strong><small>Shared workspace</small></span></div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav className="primary-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Icon size={16} /><span>{label}</span></NavLink>)}{isAdmin && <NavLink to="/settings/categories" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Settings size={16} /><span>Categories</span></NavLink>}{isAdmin && <NavLink to="/admin/users" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><ShieldCheck size={16} /><span>User management</span></NavLink>}</nav>
      <div className="sidebar-bottom"><div className="workspace-status"><span className="status-dot" /><span>Workspace connected</span></div><a className="sidebar-foot-link" href="mailto:support@resoloon.com"><CircleHelp size={14} />Help & feedback</a><div className="sidebar-version">RESOLOON CRM <span>·</span> PRIVATE WORKSPACE</div></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="mobile-brand"><BrandLogo className="brand-wordmark-mobile" /><span className="brand-product-label">CRM</span></div>
        <form className="global-search" onSubmit={submitSearch} role="search"><Search size={15} /><input ref={searchInputRef} value={searchValue} onChange={(event) => { setSearchValue(event.target.value); setSearchOpen(true) }} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Search people, companies, notes…" aria-label="Search workspace" /><kbd>⌘ K</kbd>
          {searchOpen && searchValue.trim().length >= 2 && <div className="search-popover"><div className="search-popover-heading"><span>SEARCH RESULTS</span><span>{searching ? <LoaderCircle className="spin" size={13} /> : `${searchResults.length} found`}</span></div>{searchError ? <div className="search-hint error-text">{searchError}</div> : searchResults.length ? searchResults.map((result) => <button type="button" key={`${result.recordType}-${result.id}`} className="search-result" onClick={() => { setSearchOpen(false); navigate(recordPath(result.recordType ?? result.type, result.id)) }}><span className="search-result-icon"><Search size={13} /></span><span><strong>{result.title ?? result.name ?? 'Untitled record'}</strong><small>{result.subtitle ?? result.description ?? result.recordType ?? result.type ?? 'CRM record'}</small></span><ArrowUpRight size={13} /></button>) : !searching && <div className="search-hint">No matching records yet. Press enter to view full search.</div>}<button type="submit" className="search-all">Search all records <ArrowUpRight size={13} /></button></div>}
        </form>
        <div className="topbar-right"><span className="topbar-context">RELATIONSHIP WORKSPACE</span><div className="identity-divider" /><div className="identity-block"><span className="avatar identity-avatar">{getInitials(fullName)}</span><span className="identity-copy"><strong>{fullName ?? 'Workspace member'}</strong><small>{identity.email ?? identity.role ?? 'Resoloon team'}</small></span></div><button className="logout-button" onClick={logout} disabled={logoutPending} title="Sign out" aria-label="Sign out"><LogOut size={14} /><span>{logoutPending ? 'Signing out…' : 'Log out'}</span></button></div>
      </header>
      <main className="main-content" onClick={() => { if (searchOpen) setSearchOpen(false) }}><div className="content-inner"><Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/people" element={<ResourcePage definition={peopleDefinition} />} />
        <Route path="/companies" element={<ResourcePage definition={companiesDefinition} />} />
        <Route path="/opportunities" element={<ResourcePage definition={opportunityDefinition} />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/follow-ups" element={<FollowUpsPage />} />
        <Route path="/introductions" element={<IntroductionsPage />} />
        <Route path="/meeting-notes" element={<MeetingNotesPage />} />
        <Route path="/notes" element={<ResourcePage definition={notesDefinition} />} />
        <Route path="/settings/categories" element={isAdmin ? <SettingsCategoriesPage /> : <AccessDeniedPage />} />
        <Route path="/admin/users" element={isAdmin ? <AdminUsersPage currentUserId={typeof (identity as UserIdentity & { id?: string }).id === 'string' ? (identity as UserIdentity & { id?: string }).id : undefined} /> : <AccessDeniedPage />} />
        <Route path="/search" element={<FullSearchPage />} />
        <Route path="/:resource/:id" element={<RecordDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes></div></main>
       {logoutMessage && <div role="status" className="toast"><Check size={15} />{logoutMessage}</div>}
       {undoNotice && <div role="status" className="toast undo-toast"><span>{undoError ?? `${undoNotice.label} · ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z to undo`}</span><button type="button" className="button button-ghost button-small" disabled={undoPending} onClick={() => void undoLastAction()}>{undoPending ? 'Restoring…' : 'Undo'}</button><button type="button" className="undo-dismiss" aria-label="Dismiss undo notice" onClick={() => setUndoNotice(null)}><X size={13} /></button></div>}
    </div>
  </div>
}

function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const reload = () => setRefreshToken((value) => value + 1)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.dashboard().then((data) => { if (active) { setDashboard(data); setError(null) } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load dashboard.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshToken])

  const summary = dashboard?.summary ?? dashboard?.metrics ?? {}
  return <section className="page-stack dashboard-page">
    <div className="page-heading dashboard-heading"><div><div className="eyebrow page-eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase()}</div><h1>Good work starts<br className="mobile-break" /> with good relationships.</h1><p>Your shared workspace, at a glance.</p></div><Link to="/people" className="button button-ghost"><UsersRound size={15} />Browse people</Link></div>
    {error ? <ErrorState message={error} onRetry={reload} /> : <>
      <div className="section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Overview</h2></div>{loading && <span className="subtle-loading"><LoaderCircle className="spin" size={13} />Updating</span>}</div>
      <div className="metrics-grid"><MetricCard label="People" value={summary.people ?? '—'} detail="In your network" icon={UsersRound} tone="positive" to="/people" /><MetricCard label="Companies" value={summary.companies ?? '—'} detail="Across your workspace" icon={Building2} to="/companies" /><MetricCard label="Opportunities" value={summary.opportunities ?? '—'} detail="In your pipeline" icon={BriefcaseBusiness} to="/opportunities" /><MetricCard label="Open follow-ups" value={summary.openFollowUps ?? '—'} detail="Ready for your attention" icon={Clock3} to="/follow-ups" /></div>
      <div className="dashboard-columns"><section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">NEXT UP</span><h2>Action items</h2></div><span className="panel-count">{dashboard?.actionItems?.length ?? 0}</span></div>{loading ? <LoadingState label="Loading action items…" /> : dashboard?.actionItems?.length ? <div className="action-list">{dashboard.actionItems.map((item) => <Link className="action-row" key={item.id} to={item.href ?? '/follow-ups'}><span className="action-check"><Check size={12} /></span><span className="action-copy"><strong>{item.title}</strong><small>{item.description ?? item.status ?? 'Open action'}</small></span><span className="action-date">{formatDate(item.dueAt)}</span><ArrowUpRight size={14} className="row-arrow" /></Link>)}</div> : <EmptyState icon={Check} title="Nothing needs your attention" description="Follow-ups and other priority actions will appear here." />}</section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">TEAM ACTIVITY</span><h2>Recently updated</h2></div><Clock3 size={15} className="muted-icon" /></div>{loading ? <LoadingState label="Loading recent activity…" /> : dashboard?.recentActivity?.length ? <div className="activity-list">{dashboard.recentActivity.map((activity) => {
          const copy = humanizeActivity(String(activity.title ?? ''), activity.recordName, activity.actorName)
          const href = activity.recordType && activity.recordId ? recordPath(activity.recordType, activity.recordId) : null
          const body = <><span className="activity-marker" /><div><strong>{copy.title}</strong><p>{copy.detail}</p><small>{formatDate(activity.occurredAt)}</small></div></>
          return href
            ? <Link className="activity-row activity-row-link" key={activity.id} to={href}>{body}</Link>
            : <article className="activity-row" key={activity.id}>{body}</article>
        })}</div> : <EmptyState icon={Clock3} title="Your story starts here" description="Changes to shared records will show up in this activity feed." />}</section></div>
      <section className="quick-links"><div className="quick-links-copy"><span className="eyebrow">MAKE A CONNECTION</span><h2>Keep your network in motion.</h2><p>People, organizations, and opportunities—connected in one shared place.</p></div><div className="quick-link-buttons"><Link to="/companies" className="button button-ghost"><Building2 size={15} />Companies<ArrowUpRight size={13} /></Link><Link to="/opportunities" className="button button-ghost"><BriefcaseBusiness size={15} />Opportunities<ArrowUpRight size={13} /></Link><Link to="/notes" className="button button-ghost"><FileText size={15} />Notes<ArrowUpRight size={13} /></Link></div></section>
    </>}
  </section>
}

function FullSearchPage() {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(Boolean(query))
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let active = true
    if (!query) { setResults([]); setLoading(false); return }
    setLoading(true)
    api.search(query, 40).then((items) => { if (active) { setResults(items); setError(null) } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Search is unavailable.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, retryToken])

  return <section className="page-stack"><div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / SEARCH</div><h1>Search results</h1><p>{query ? <>Showing matches for <strong className="query-emphasis">“{query}”</strong></> : 'Search across people, companies, opportunities, and notes.'}</p></div></div><div className="list-panel">{loading ? <LoadingState label="Searching your workspace…" /> : error ? <ErrorState message={error} onRetry={() => setRetryToken((value) => value + 1)} /> : !results.length ? <EmptyState icon={Search} title={query ? 'No matching records' : 'Search your workspace'} description={query ? 'Try another name, company, or keyword.' : 'Use the search field in the header to find records and shared context.'} /> : <div className="full-search-results">{results.map((result) => <Link className="full-search-result" key={`${result.recordType}-${result.id}`} to={recordPath(result.recordType ?? result.type, result.id)}><span className="search-result-icon"><Search size={14} /></span><span><strong>{result.title ?? result.name ?? 'Untitled record'}</strong><small>{result.subtitle ?? result.description ?? result.matchedOn ?? 'CRM record'}</small></span><span className="search-type">{(result.recordType ?? result.type ?? 'record').replaceAll('_', ' ')}</span><ArrowUpRight size={14} /></Link>)}</div>}</div></section>
}

function RecordDetailPage() {
  const { resource = '', id = '' } = useParams()
  const navigate = useNavigate()
  const safeResource = ['people', 'companies', 'opportunities', 'notes'].includes(resource) ? resource : null

  useEffect(() => {
    if (!safeResource || !id) {
      navigate('/', { replace: true })
      return
    }
    navigate(`/${safeResource}?id=${encodeURIComponent(id)}`, { replace: true })
  }, [id, navigate, safeResource])

  return <LoadingState label="Opening record…" />
}

function NotFoundPage() {
  return <EmptyState icon={CircleHelp} title="This page isn’t here" description="The link may have moved, or you may not have access to it." action={<Link to="/" className="button button-ghost"><ArrowLeft size={14} />Go to dashboard</Link>} />
}
