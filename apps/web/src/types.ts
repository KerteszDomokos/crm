export type PersonRecord = {
  id: string
  fullName?: string
  name?: string | { firstName?: string; lastName?: string }
  jobTitle?: string | null
  email?: string | null
  primaryEmail?: string | null
  emails?: Array<string | { email?: string; address?: string; primaryEmail?: string }>
  phone?: string | null
  city?: string | null
  companyName?: string | null
  companies?: Array<string | { id?: string; name?: string }>
  importance?: number | null
  categories?: string[]
  updatedAt?: string
}

export type CompanyRecord = {
  id: string
  name: string
  domain?: string | null
  website?: string | null
  description?: string | null
  city?: string | null
  industries?: string[]
  categories?: string[]
  peopleCount?: number
  updatedAt?: string
}

export type OpportunityStage = 'LEAD' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST' | string

export type OpportunityRecord = {
  id: string
  name: string
  description?: string | null
  stage?: OpportunityStage
  value?: number | string | null
  currency?: string | null
  companyName?: string | null
  companies?: Array<string | { id?: string; name?: string }>
  expectedCloseDate?: string | null
  nextAction?: string | null
  ownerName?: string | null
  updatedAt?: string
}

export type NoteRecord = {
  id: string
  title: string
  bodyMarkdown?: string | null
  body?: string | null
  noteType?: 'GENERAL' | 'MEETING' | string
  type?: string
  createdAt?: string
  updatedAt?: string
  createdByName?: string | null
  relatedRecords?: Array<{ type?: string; name?: string }>
  personName?: string | null
  companyName?: string | null
  opportunityName?: string | null
}

export type UserIdentity = {
  fullName?: string
  name?: string
  email?: string
  role?: string
}

export type DashboardData = {
  summary?: {
    people?: number
    companies?: number
    opportunities?: number
    openFollowUps?: number
  }
  metrics?: Record<string, number | string | null | undefined>
  actionItems?: Array<{
    id: string
    title: string
    description?: string
    dueAt?: string
    status?: string
    href?: string
  }>
  recentActivity?: Array<{
    id: string
    title: string
    description?: string
    occurredAt?: string
    actorName?: string
    recordType?: string
  }>
}

export type SearchResult = {
  id: string
  type?: string
  recordType?: string
  title?: string
  name?: string
  subtitle?: string
  description?: string
  href?: string
  matchedOn?: string
}
