import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
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
  Plus,
  Search,
  ShieldCheck,
  ListChecks,
  MapPin,
  UsersRound,
  X,
  BriefcaseBusiness,
} from 'lucide-react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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

type FormField = { name: string; label: string; type?: string; required?: boolean; placeholder?: string; options?: string[] }
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

function useResource<T>(resource: string) {
  const [records, setRecords] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const reload = useCallback(() => setRefreshToken((value) => value + 1), [])

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

  return { records, loading, error, reload }
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

function MetricCard({ label, value, detail, icon: Icon, tone = 'neutral' }: { label: string; value: string | number; detail: string; icon: typeof UsersRound; tone?: 'neutral' | 'positive' }) {
  return <article className="metric-card"><div className="metric-top"><span className="eyebrow">{label}</span><span className={`metric-icon ${tone}`}><Icon size={15} /></span></div><div className={`metric-value ${tone === 'positive' ? 'accent' : ''}`}>{value}</div><div className="metric-detail">{detail}</div></article>
}

function StagePill({ stage }: { stage?: OpportunityStage }) {
  const value = (stage ?? 'LEAD').toUpperCase()
  const label = value.charAt(0) + value.slice(1).toLowerCase()
  return <span className={`stage-pill stage-${value.toLowerCase()}`}><span className="stage-dot" />{label}</span>
}

function ResourcePage<T extends { id: string }>({ definition }: { definition: ResourceDefinition<T> }) {
  const { records, loading, error, reload } = useResource<T>(definition.resource)
  const [createOpen, setCreateOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState('')
  const navigate = useNavigate()
  const Icon = definition.icon
  const filteredRecords = useMemo(() => {
    if (!localSearch.trim()) return records
    const query = localSearch.trim().toLocaleLowerCase()
    return records.filter((record) => JSON.stringify(record).toLocaleLowerCase().includes(query))
  }, [localSearch, records])

  return <section className="page-stack">
    <div className="page-heading">
      <div><div className="eyebrow page-eyebrow">Workspace / {definition.plural}</div><h1>{definition.plural}</h1><p>{definition.description}</p></div>
      <button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Add {definition.singular.toLowerCase()}</button>
    </div>
    <div className="list-panel">
      <div className="list-toolbar"><div className="list-context"><span className="list-icon"><Icon size={16} /></span><div><strong>{definition.plural}</strong><span>{loading ? 'Loading…' : definition.summary?.(records) ?? `${records.length} ${records.length === 1 ? 'record' : 'records'}`}</span></div></div>
        <label className="inline-search"><Search size={14} /><input value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} placeholder={`Filter ${definition.plural.toLowerCase()}`} aria-label={`Filter ${definition.plural}`} /><kbd>/</kbd></label>
      </div>
      {loading ? <LoadingState label={`Loading ${definition.plural.toLowerCase()}…`} /> : error ? <ErrorState message={error} onRetry={reload} /> : filteredRecords.length === 0 ?
        (records.length === 0 ? <EmptyState icon={Icon} title={definition.emptyTitle} description={definition.emptyDescription} action={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Create {definition.singular.toLowerCase()}</button>} /> : <EmptyState icon={Search} title="No matching records" description="Try a different filter, or clear the search to see all records." />) :
          <div className="table-scroll"><table className="record-table"><thead><tr>{definition.columns.map((column) => <th key={column.label} className={column.className}>{column.label}</th>)}<th aria-label="Open record" /></tr></thead><tbody>{filteredRecords.map((record) => <tr key={record.id} className="click-row" onClick={() => navigate(`/${definition.resource}/${record.id}`)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/${definition.resource}/${record.id}`) }}>{definition.columns.map((column, index) => <td key={`${record.id}-${column.label}`} className={`${column.className ?? ''} ${index === 0 ? 'primary-cell' : ''}`}>{column.render(record)}</td>)}<td className="open-cell"><ArrowUpRight size={14} /></td></tr>)}</tbody></table></div>}
    </div>
    {createOpen && <RecordFormDialog definition={definition} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
  </section>
}

function RecordFormDialog({ definition, record, onClose, onSaved, save }: { definition: ResourceFormDefinition; record?: Record<string, unknown>; onClose: () => void; onSaved: () => void; save?: (values: Record<string, unknown>) => Promise<unknown> }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(event.currentTarget)
    const values: Record<string, unknown> = {}
    if (record && typeof record.version === 'number') values.version = record.version
    definition.fields.forEach((field) => {
      const value = form.get(field.name)?.toString().trim()
      if (value) {
        if (field.type === 'number') values[field.name] = Number(value)
        else if (field.type === 'datetime-local') values[field.name] = workspaceDateTimeToIso(value)
        else values[field.name] = value
      }
    })
    try {
      if (save) await save(values)
      else if (record?.id) await api.update(definition.resource, String(record.id), values)
      else await api.create(definition.resource, values)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create this record.')
    } finally {
      setPending(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
    <div className="modal-header"><div><div className="eyebrow">{record ? 'Edit record' : 'New record'}</div><h2 id="create-title">{record ? `Edit ${definition.singular.toLowerCase()}` : `Add ${definition.singular.toLowerCase()}`}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <form onSubmit={submit} className="form-body">
      {definition.fields.map((field) => {
        const initial = fieldInitialValue(field.name, record)
        return <label className="form-field" key={field.name}><span>{field.label}{field.required && <b className="required-mark"> *</b>}</span>{field.options ? <select name={field.name} required={field.required} defaultValue={initial || field.options[0]}><option value="" disabled>Select {field.label.toLowerCase()}</option>{field.options.map((option) => <option key={option} value={option}>{option.charAt(0) + option.slice(1).toLowerCase()}</option>)}</select> : field.type === 'textarea' ? <textarea name={field.name} placeholder={field.placeholder} rows={4} required={field.required} defaultValue={initial} /> : <input type={field.type ?? 'text'} name={field.name} placeholder={field.placeholder} required={field.required} step={field.type === 'number' ? 'any' : undefined} defaultValue={initial} />}</label>
      })}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : record ? <Check size={15} /> : <Plus size={15} />}{record ? 'Save changes' : `Create ${definition.singular.toLowerCase()}`}</button></div>
    </form>
  </section></div>
}

function fieldInitialValue(name: string, record?: Record<string, unknown>) {
  if (!record) return ''
  const value = record[name]
  if (value != null) {
    if (name === 'expectedCloseDate' || name === 'followUpDate' || name === 'dueAt') return String(value).slice(0, 10)
    if (name === 'startAt' || name === 'endAt') {
      const date = new Date(String(value))
      return Number.isNaN(date.getTime()) ? String(value) : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    }
    return String(value)
  }
  if (name === 'email') {
    const emails = record.emails
    if (Array.isArray(emails) && emails.length) {
      const first = emails[0]
      return typeof first === 'string' ? first : String(first.primaryEmail ?? first.email ?? first.address ?? '')
    }
    return String(record.primaryEmail ?? '')
  }
  if (name === 'phone') return String(record.primaryPhone ?? '')
  if (name === 'domain') return String(record.primaryDomain ?? record.website ?? '')
  if (name === 'bodyMarkdown') return String(record.body ?? '')
  if (name === 'noteType') return String(record.type ?? 'GENERAL')
  return ''
}

const peopleDefinition: ResourceDefinition<PersonRecord> = {
  resource: 'people', singular: 'Person', plural: 'People', eyebrow: 'Relationships', icon: UsersRound,
  description: 'The people behind your most important relationships.',
  emptyTitle: 'Your people are yet to arrive', emptyDescription: 'Create a person to start building your shared relationship history.',
  fields: [
    { name: 'fullName', label: 'Full name', required: true, placeholder: 'Name as it appears in your workspace' },
    { name: 'jobTitle', label: 'Job title', placeholder: 'e.g. Partnerships lead' },
    { name: 'email', label: 'Email address', type: 'email', placeholder: 'name@company.com' },
    { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+36 00 000 0000' },
    { name: 'city', label: 'City', placeholder: 'Budapest' },
  ],
  columns: [
    { label: 'Name', render: (person) => <><span className="avatar avatar-small">{getInitials(personName(person))}</span><span className="cell-primary"><strong>{personName(person)}</strong><small>{person.jobTitle ?? 'No title added'}</small></span></> },
    { label: 'Email', render: (person) => <span className="cell-muted">{emailOf(person)}</span>, className: 'optional-column' },
    { label: 'Company', render: (person) => <span>{associatedCompanies(person)}</span>, className: 'optional-column' },
    { label: 'Location', render: (person) => <span>{person.city ?? '—'}</span>, className: 'optional-column' },
    { label: 'Updated', render: (person) => <span className="mono-caption">{formatDate(person.updatedAt)}</span>, className: 'date-column' },
  ],
}

const companiesDefinition: ResourceDefinition<CompanyRecord> = {
  resource: 'companies', singular: 'Company', plural: 'Companies', eyebrow: 'Organizations', icon: Building2,
  description: 'The organizations and teams in your network.',
  emptyTitle: 'No companies in your workspace', emptyDescription: 'Add a company to connect people, opportunities, and notes in one place.',
  fields: [
    { name: 'name', label: 'Company name', required: true, placeholder: 'Company name' },
    { name: 'domain', label: 'Website domain', placeholder: 'company.com' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'What does this company do?' },
  ],
  columns: [
    { label: 'Company', render: (company) => <><span className="avatar avatar-small company-avatar"><Building2 size={15} /></span><span className="cell-primary"><strong>{company.name}</strong><small>{company.domain ?? company.website ?? 'No website added'}</small></span></> },
    { label: 'Industry', render: (company) => <span>{company.industries?.join(', ') ?? company.categories?.join(', ') ?? '—'}</span>, className: 'optional-column' },
    { label: 'Location', render: (company) => <span>{company.city ?? '—'}</span>, className: 'optional-column' },
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
    { name: 'stage', label: 'Pipeline stage', options: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
    { name: 'value', label: 'Value', type: 'number', placeholder: '0' },
    { name: 'currency', label: 'Currency', placeholder: 'EUR' },
    { name: 'expectedCloseDate', label: 'Expected close date', type: 'date' },
    { name: 'nextAction', label: 'Next action', placeholder: 'What should happen next?' },
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
    { name: 'noteType', label: 'Note type', options: ['GENERAL', 'MEETING'] },
    { name: 'bodyMarkdown', label: 'Note', type: 'textarea', placeholder: 'Write your note…' },
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
    { name: 'assigneeUserId', label: 'Assignee user ID', placeholder: 'Optional workspace member ID' },
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
    <div className="workflow-summary"><span className="workflow-summary-icon"><ListChecks size={16} /></span><span><strong>{openCount}</strong> open action{openCount === 1 ? '' : 's'} need attention</span></div>
    <WorkflowListPanel title="Follow-ups" icon={ListChecks} count={records.length} loading={loading} error={error} onRetry={reload} emptyTitle="You’re all caught up" emptyDescription="Create a follow-up to make sure an important next step does not get lost." emptyAction={<button type="button" className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={15} />Add follow-up</button>}>
      {records.map((record) => {
        const dueAt = record.dueAt
        const isOpen = !['COMPLETED', 'CANCELLED'].includes((record.status ?? 'OPEN').toUpperCase())
        const overdue = isOpen && dueAt != null && new Date(dueAt).getTime() < Date.now()
        const related = workflowRelated(record.relatedRecords, record.personName ?? record.companyName ?? record.opportunityName)
        return <article className={`workflow-card ${overdue ? 'workflow-card-overdue' : ''}`} key={record.id}>
          <div className="workflow-card-heading"><div><span className="eyebrow">{record.source ? statusText(record.source) : 'FOLLOW-UP'}</span><h3>{record.title ?? 'Untitled follow-up'}</h3></div><span className={`workflow-status ${statusClass(overdue ? 'OVERDUE' : record.status)}`}>{overdue ? 'Overdue' : statusText(record.status)}</span></div>
          {record.body && <p className="workflow-description">{record.body}</p>}
          <div className="workflow-card-meta"><span><Clock3 size={13} />Due {formatDateTime(dueAt)}</span><span><UsersRound size={13} />{related}</span>{(record.assigneeName ?? record.assigneeUserId) && <span>Assigned to {record.assigneeName ?? record.assigneeUserId}</span>}</div>
          {isOpen && <div className="workflow-card-actions"><button type="button" className="button button-ghost button-small" disabled={pendingId === record.id} onClick={() => void changeStatus(record, 'COMPLETED')}>{pendingId === record.id ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}Complete</button><button type="button" className="button button-ghost button-small danger-action" disabled={pendingId === record.id} onClick={() => void changeStatus(record, 'CANCELLED')}>Cancel</button></div>}
        </article>
      })}
    </WorkflowListPanel>
    {createOpen && <RecordFormDialog definition={followUpFormDefinition} save={api.createFollowUp} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
  </section>
}

function IntroductionFormDialog({ people, peopleLoading, onClose, onSaved }: { people: PersonRecord[]; peopleLoading: boolean; onClose: () => void; onSaved: () => void }) {
  const [stepCount, setStepCount] = useState(1)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const targetPersonId = String(form.get('targetPersonId') ?? '').trim()
    const steps = Array.from({ length: stepCount }, (_, index) => {
      const fromPersonId = String(form.get(`steps.${index}.fromPersonId`) ?? '').trim()
      const toPersonId = String(form.get(`steps.${index}.toPersonId`) ?? '').trim()
      const responsibleUserId = String(form.get(`steps.${index}.responsibleUserId`) ?? '').trim()
      const notes = String(form.get(`steps.${index}.notes`) ?? '').trim()
      const followUpDate = String(form.get(`steps.${index}.followUpAt`) ?? '').trim()
      const followUpAt = followUpDate ? workspaceDateTimeToIso(`${followUpDate}T12:00`) : undefined
      return { position: index + 1, ...(fromPersonId ? { fromPersonId } : {}), toPersonId, ...(responsibleUserId ? { responsibleUserId } : {}), status: 'PENDING', ...(notes ? { notes } : {}), ...(followUpAt ? { followUpAt } : {}) }
    })
    if (steps.some((step) => !step.toPersonId)) { setError('Add a destination person ID for each step.'); return }
    setPending(true)
    try {
      await api.createIntroduction({ targetPersonId, ...(String(form.get('ownerUserId') ?? '').trim() ? { ownerUserId: String(form.get('ownerUserId')).trim() } : {}), steps })
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
      <div className="form-grid"><label className="form-field"><span>Target person <b className="required-mark"> *</b></span><select name="targetPersonId" required disabled={peopleLoading || people.length === 0}><option value="">{peopleLoading ? 'Loading people…' : people.length ? 'Choose a person' : 'No people available'}</option>{people.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label><label className="form-field"><span>Chain owner user ID</span><input name="ownerUserId" placeholder="Optional workspace member ID" /></label></div>
      {!peopleLoading && people.length === 0 && <p className="dialog-hint">Add a person before planning an introduction. <Link to="/people" className="one-time-link-open">Open people</Link></p>}
      {Array.from({ length: stepCount }, (_, index) => <fieldset className="intro-step" key={index}><legend>Step {index + 1}</legend><div className="form-grid"><label className="form-field"><span>Introducer{index === 0 ? ' (leave blank for team)' : ''}</span><select name={`steps.${index}.fromPersonId`} defaultValue=""><option value="">{index === 0 ? 'Your team' : 'Choose a person (optional)'}</option>{people.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label><label className="form-field"><span>Next person <b className="required-mark"> *</b></span><select name={`steps.${index}.toPersonId`} required disabled={peopleLoading || people.length === 0}><option value="">Choose a person</option>{people.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label><label className="form-field"><span>Responsible member ID</span><input name={`steps.${index}.responsibleUserId`} placeholder="Optional workspace member ID" /></label><label className="form-field"><span>Follow-up date</span><input name={`steps.${index}.followUpAt`} type="date" /></label></div><label className="form-field"><span>Step notes</span><textarea name={`steps.${index}.notes`} rows={2} placeholder="Context or the ask for this introduction" /></label></fieldset>)}
      <button type="button" className="button button-ghost button-small add-step-button" disabled={stepCount >= 5} onClick={() => setStepCount((count) => Math.min(5, count + 1))}><Plus size={13} />Add another step</button>
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
          <div className="workflow-card-heading"><div><span className="eyebrow">INTRODUCTION CHAIN</span><h3>{record.targetPersonName ?? (record.targetPersonId ? peopleById.get(record.targetPersonId) ?? `Target · ${record.targetPersonId}` : 'Target person not set')}</h3></div><span className={`workflow-status ${statusClass(record.status)}`}>{statusText(record.status ?? 'ACTIVE')}</span></div>
          <p className="workflow-intro-owner">{record.ownerName ? `Owned by ${record.ownerName}` : record.ownerUserId ? `Owner · ${record.ownerUserId}` : 'Shared relationship workflow'}{record.currentStep ? ` · Current step ${record.currentStep}` : ''}</p>
          {steps.length ? <ol className="intro-path">{steps.map((step, index) => {
            const stepKey = `${record.id}-${step.id ?? step.position ?? ''}`
            const stepStatus = (step.status ?? 'PENDING').toUpperCase()
            return <li key={step.id ?? `${record.id}-${step.position ?? index}`}><span className="intro-step-number">{step.position ?? index + 1}</span><div className="intro-step-copy"><strong>{step.fromPersonName ?? (step.fromPersonId ? peopleById.get(step.fromPersonId) ?? `Person · ${step.fromPersonId}` : 'Your team')} <ArrowUpRight size={12} /> {step.toPersonName ?? (step.toPersonId ? peopleById.get(step.toPersonId) ?? `Person · ${step.toPersonId}` : 'Next person')}</strong><small>{step.notes || (step.followUpAt ? `Follow up ${formatDate(step.followUpAt)}` : 'No step notes')}</small></div><span className={`workflow-status ${statusClass(step.status)}`}>{statusText(step.status ?? 'PENDING')}</span>{stepStatus === 'PENDING' && <button type="button" className="button button-ghost button-small intro-step-action" disabled={pendingStep === stepKey} onClick={() => void updateStep(record, step, 'REQUESTED')}>{pendingStep === stepKey ? <LoaderCircle size={12} className="spin" /> : null}Request intro</button>}{stepStatus === 'REQUESTED' && <button type="button" className="button button-ghost button-small intro-step-action" disabled={pendingStep === stepKey} onClick={() => void updateStep(record, step, 'INTRODUCED')}>{pendingStep === stepKey ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}Mark introduced</button>}</li>
          })}</ol> : <p className="workflow-note">No steps have been added to this chain yet.</p>}
        </article>
      })}
    </WorkflowListPanel>
    {createOpen && <IntroductionFormDialog people={people.records} peopleLoading={people.loading} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
  </section>
}

function MeetingNoteActionDialog({ record, mode, onClose, onSaved }: { record: MeetingNoteRequirementRecord; mode: 'complete' | 'cancel'; onClose: () => void; onSaved: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="meeting-note-action-title">
    <div className="modal-header"><div><div className="eyebrow">{mode === 'complete' ? 'MEETING RECAP' : 'CANCEL REQUIREMENT'}</div><h2 id="meeting-note-action-title">{mode === 'complete' ? 'Complete meeting note' : 'Cancel meeting note'}</h2><p className="dialog-hint">{title}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <form className="form-body" onSubmit={submit}>
      {mode === 'complete' ? <><label className="form-field"><span>Meeting summary <b className="required-mark"> *</b></span><textarea name="summary" rows={4} required defaultValue={record.summary ?? ''} placeholder="What was discussed?" /></label><label className="form-field"><span>Next steps</span><textarea name="nextStepsMarkdown" rows={3} defaultValue={record.nextStepsMarkdown ?? ''} placeholder="Actions, owners, and decisions" /></label><label className="form-field"><span>Follow-up date</span><input name="followUpDate" type="date" defaultValue={record.followUpDate?.slice(0, 10) ?? ''} /></label></> : <label className="form-field"><span>Cancellation reason <b className="required-mark"> *</b></span><textarea name="reason" rows={3} required placeholder="Why is this note no longer required?" /></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} disabled={pending}>Keep open</button><button type="submit" className={`button ${mode === 'complete' ? 'button-primary' : 'button-ghost danger-action'}`} disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : mode === 'complete' ? <Check size={15} /> : null}{mode === 'complete' ? 'Complete note' : 'Cancel requirement'}</button></div>
    </form>
  </section></div>
}

function MeetingNotesPage() {
  const { records, loading, error, reload } = useWorkflowResource<MeetingNoteRequirementRecord>(api.listMeetingNotes)
  const [action, setAction] = useState<{ record: MeetingNoteRequirementRecord; mode: 'complete' | 'cancel' } | null>(null)
  const outstanding = records.filter((record) => !['COMPLETED', 'CANCELLED'].includes((record.status ?? 'REQUIRED').toUpperCase())).length
  return <section className="page-stack">
    <div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / MEETING WORKFLOW</div><h1>Meeting-note requirements</h1><p>Required recaps for eligible meetings. Complete the summary and next steps, or record why a note is no longer needed.</p></div></div>
    <div className="workflow-summary"><span className="workflow-summary-icon"><ClipboardCheck size={16} /></span><span><strong>{outstanding}</strong> note{outstanding === 1 ? '' : 's'} still required</span></div>
    <WorkflowListPanel title="Meeting notes" icon={ClipboardCheck} count={records.length} loading={loading} error={error} onRetry={reload} emptyTitle="No meeting notes required" emptyDescription="Required notes appear here after eligible meetings. Calendar exclusions prevent unnecessary reminders.">
      {records.map((record) => {
        const status = record.status ?? 'REQUIRED'
        const actionable = !['COMPLETED', 'CANCELLED'].includes(status.toUpperCase())
        return <article className="workflow-card" key={record.id}>
          <div className="workflow-card-heading"><div><span className="eyebrow">REQUIRED RECAP</span><h3>{record.eventTitle ?? record.title ?? 'Meeting note'}</h3></div><span className={`workflow-status ${statusClass(status)}`}>{statusText(status)}</span></div>
          <div className="workflow-card-meta"><span><Clock3 size={13} />{formatDateTime(record.meetingAt ?? record.createdAt)}</span>{record.eventId && <span>Event {record.eventId}</span>}</div>
          {record.summary && <p className="workflow-description">{record.summary}</p>}
          {record.cancellationReason && <p className="workflow-note">Cancelled: {record.cancellationReason}</p>}
          {actionable && <div className="workflow-card-actions"><button type="button" className="button button-primary button-small" onClick={() => setAction({ record, mode: 'complete' })}><Check size={13} />Complete note</button><button type="button" className="button button-ghost button-small danger-action" onClick={() => setAction({ record, mode: 'cancel' })}>Cancel requirement</button></div>}
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
  { to: '/introductions', label: 'Warm introductions', icon: GitBranch },
  { to: '/meeting-notes', label: 'Meeting-note requirements', icon: ClipboardCheck },
  { to: '/notes', label: 'Notes & meetings', icon: FileText },
]

function AuthBrand() {
  return <div className="auth-brand"><span className="brand-mark"><span /></span><span className="brand-name">resoloon<span>CRM</span></span></div>
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(event.currentTarget)
    const values = {
      fullName: String(form.get('fullName') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      role: String(form.get('role') ?? 'USER') as 'ADMIN' | 'USER',
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
      <label className="form-field" htmlFor="user-role"><span>Role</span><select id="user-role" name="role" defaultValue={user?.role ?? 'USER'}><option value="USER">User</option><option value="ADMIN">Administrator</option></select></label>
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
      <div className="brand-row"><span className="brand-mark"><span /></span><span className="brand-name">resoloon<span>CRM</span></span><button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={16} /></button></div>
      <div className="workspace-switcher"><span className="workspace-monogram">R</span><span><strong>Resoloon</strong><small>Shared workspace</small></span><ChevronDown size={14} /></div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav className="primary-nav" aria-label="Main navigation">{navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Icon size={16} /><span>{label}</span>{label === 'Opportunities' && <span className="nav-arrow">↗</span>}</NavLink>)}{isAdmin && <NavLink to="/admin/users" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><ShieldCheck size={16} /><span>User management</span></NavLink>}</nav>
      <div className="sidebar-bottom"><div className="workspace-status"><span className="status-dot" /><span>Workspace connected</span></div><a className="sidebar-foot-link" href="mailto:support@resoloon.com"><CircleHelp size={14} />Help & feedback</a><div className="sidebar-version">RESOLOON CRM <span>·</span> PRIVATE WORKSPACE</div></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="mobile-brand"><span className="brand-mark"><span /></span>Resoloon</div>
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
        <Route path="/admin/users" element={isAdmin ? <AdminUsersPage currentUserId={typeof (identity as UserIdentity & { id?: string }).id === 'string' ? (identity as UserIdentity & { id?: string }).id : undefined} /> : <AccessDeniedPage />} />
        <Route path="/search" element={<FullSearchPage />} />
        <Route path="/:resource/:id" element={<RecordDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes></div></main>
      {logoutMessage && <div role="status" className="toast"><Check size={15} />{logoutMessage}</div>}
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
    <div className="page-heading dashboard-heading"><div><div className="eyebrow page-eyebrow">THURSDAY, {new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase()}</div><h1>Good work starts<br className="mobile-break" /> with good relationships.</h1><p>Your shared workspace, at a glance.</p></div><Link to="/people" className="button button-ghost"><UsersRound size={15} />Browse people</Link></div>
    {error ? <ErrorState message={error} onRetry={reload} /> : <>
      <div className="section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Overview</h2></div>{loading && <span className="subtle-loading"><LoaderCircle className="spin" size={13} />Updating</span>}</div>
      <div className="metrics-grid"><MetricCard label="People" value={summary.people ?? '—'} detail="In your network" icon={UsersRound} tone="positive" /><MetricCard label="Companies" value={summary.companies ?? '—'} detail="Across your workspace" icon={Building2} /><MetricCard label="Opportunities" value={summary.opportunities ?? '—'} detail="In your pipeline" icon={BriefcaseBusiness} /><MetricCard label="Open follow-ups" value={summary.openFollowUps ?? '—'} detail="Ready for your attention" icon={Clock3} /></div>
      <div className="dashboard-columns"><section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">NEXT UP</span><h2>Action items</h2></div><span className="panel-count">{dashboard?.actionItems?.length ?? 0}</span></div>{loading ? <LoadingState label="Loading action items…" /> : dashboard?.actionItems?.length ? <div className="action-list">{dashboard.actionItems.map((item) => <Link className="action-row" key={item.id} to={item.href ?? '/opportunities'}><span className="action-check"><Check size={12} /></span><span className="action-copy"><strong>{item.title}</strong><small>{item.description ?? item.status ?? 'Open action'}</small></span><span className="action-date">{formatDate(item.dueAt)}</span><ArrowUpRight size={14} className="row-arrow" /></Link>)}</div> : <EmptyState icon={Check} title="Nothing needs your attention" description="Follow-ups and other priority actions will appear here." />}</section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">TEAM ACTIVITY</span><h2>Recently updated</h2></div><Clock3 size={15} className="muted-icon" /></div>{loading ? <LoadingState label="Loading recent activity…" /> : dashboard?.recentActivity?.length ? <div className="activity-list">{dashboard.recentActivity.map((activity) => <article className="activity-row" key={activity.id}><span className="activity-marker" /><div><strong>{activity.title}</strong><p>{activity.description ?? activity.actorName ?? 'Workspace update'}</p><small>{formatDate(activity.occurredAt)}</small></div></article>)}</div> : <EmptyState icon={Clock3} title="Your story starts here" description="Changes to shared records will show up in this activity feed." />}</section></div>
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
    api.search(query).then((items) => { if (active) { setResults(items); setError(null) } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Search is unavailable.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, retryToken])

  return <section className="page-stack"><div className="page-heading"><div><div className="eyebrow page-eyebrow">WORKSPACE / SEARCH</div><h1>Search results</h1><p>{query ? <>Showing matches for <strong className="query-emphasis">“{query}”</strong></> : 'Search across people, companies, opportunities, and notes.'}</p></div></div><div className="list-panel">{loading ? <LoadingState label="Searching your workspace…" /> : error ? <ErrorState message={error} onRetry={() => setRetryToken((value) => value + 1)} /> : !results.length ? <EmptyState icon={Search} title={query ? 'No matching records' : 'Search your workspace'} description={query ? 'Try another name, company, or keyword.' : 'Use the search field in the header to find records and shared context.'} /> : <div className="full-search-results">{results.map((result) => <Link className="full-search-result" key={`${result.recordType}-${result.id}`} to={recordPath(result.recordType ?? result.type, result.id)}><span className="search-result-icon"><Search size={14} /></span><span><strong>{result.title ?? result.name ?? 'Untitled record'}</strong><small>{result.subtitle ?? result.description ?? result.matchedOn ?? 'CRM record'}</small></span><span className="search-type">{(result.recordType ?? result.type ?? 'record').replaceAll('_', ' ')}</span><ArrowUpRight size={14} /></Link>)}</div>}</div></section>
}

function RecordDetailPage() {
  const { resource = '', id = '' } = useParams()
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const navigate = useNavigate()
  const safeResource = ['people', 'companies', 'opportunities', 'notes'].includes(resource) ? resource : null

  useEffect(() => {
    let active = true
    if (!safeResource) { setLoading(false); setError('This record type is not available.'); return }
    setLoading(true)
    api.get<Record<string, unknown>>(safeResource, id).then((data) => { if (active) { setRecord(data); setError(null) } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this record.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, safeResource, token])

  const pageTitle = safeResource === 'people' ? 'People' : safeResource === 'companies' ? 'Companies' : safeResource === 'opportunities' ? 'Opportunities' : 'Notes & meetings'
  const formDefinition: ResourceFormDefinition | null = safeResource === 'people' ? peopleDefinition : safeResource === 'companies' ? companiesDefinition : safeResource === 'opportunities' ? opportunityDefinition : safeResource === 'notes' ? notesDefinition : null
  return <section className="page-stack">
    <button type="button" className="back-link" onClick={() => navigate(safeResource ? `/${safeResource}` : '/')}><ArrowLeft size={14} />Back to {pageTitle.toLowerCase()}</button>
    {loading ? <LoadingState label="Loading record…" /> : error ? <ErrorState message={error} onRetry={() => setToken((value) => value + 1)} /> : record ? <div className="detail-panel">
      <div className="detail-heading"><div><div className="eyebrow">{pageTitle.toUpperCase()} / RECORD</div><h1>{String(record.fullName ?? record.name ?? record.title ?? 'Record')}</h1></div><div className="detail-actions">{record.stage != null && <StagePill stage={String(record.stage)} />}{formDefinition && <button type="button" className="button button-ghost button-small" onClick={() => setEditOpen(true)}>Edit record</button>}</div></div>
      {Array.isArray(record.introductionObligations) && record.introductionObligations.length > 0 && <section className="detail-description introduction-obligations"><span className="eyebrow">YOUR INTRODUCTION OBLIGATIONS</span>{(record.introductionObligations as Array<Record<string, unknown>>).map((obligation, index) => <p key={`${String(obligation.chainId ?? index)}-${String(obligation.position ?? index)}`}>Introduce <strong>{String(obligation.targetPersonName ?? 'the next person')}</strong>{obligation.followUpAt ? ` · follow up ${formatDate(String(obligation.followUpAt))}` : ''}{obligation.notes ? ` · ${String(obligation.notes)}` : ''}</p>)}<Link to="/introductions" className="one-time-link-open">Open introduction chains</Link></section>}
      <div className="detail-fields">{Object.entries(record).filter(([key, value]) => key !== 'id' && key !== 'introductionObligations' && value != null && (typeof value !== 'object' || Array.isArray(value))).map(([key, value]) => <div className="detail-field" key={key}><span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}</span><strong>{Array.isArray(value) ? value.map((item) => typeof item === 'object' && item !== null ? String((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).fullName ?? (item as Record<string, unknown>).email ?? '') : String(item)).filter(Boolean).join(', ') || '—' : String(value)}</strong></div>)}</div>
      {record.description != null && <div className="detail-description"><span className="eyebrow">ABOUT</span><p>{String(record.description)}</p></div>}
    </div> : null}
    {editOpen && record && formDefinition && <RecordFormDialog definition={formDefinition} record={record} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); setToken((value) => value + 1) }} />}
  </section>
}

function NotFoundPage() {
  return <EmptyState icon={CircleHelp} title="This page isn’t here" description="The link may have moved, or you may not have access to it." action={<Link to="/" className="button button-ghost"><ArrowLeft size={14} />Go to dashboard</Link>} />
}
