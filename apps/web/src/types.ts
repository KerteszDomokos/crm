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

export type RelatedRecordSummary = {
  id?: string
  type?: string
  name?: string
  [key: string]: unknown
}

export type EventAttendee = string | {
  id?: string
  name?: string
  email?: string
  responseStatus?: string
  [key: string]: unknown
}

export type EventRecord = {
  id: string
  title?: string
  description?: string | null
  startAt?: string | null
  endAt?: string | null
  startsAt?: string | null
  endsAt?: string | null
  start?: string | null
  end?: string | null
  allDay?: boolean
  timezone?: string | null
  sourceTimezone?: string | null
  organizer?: string | null
  organizerName?: string | null
  ownerUserId?: string | null
  location?: string | null
  meetingUrl?: string | null
  source?: string | null
  status?: string | null
  workflowEligible?: boolean
  exclusionReason?: string | null
  meetingNoteStatus?: string | null
  attendees?: EventAttendee[]
  personIds?: string[]
  companyIds?: string[]
  opportunityIds?: string[]
  relatedRecords?: RelatedRecordSummary[]
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type FollowUpRecord = {
  id: string
  title?: string
  body?: string | null
  dueAt?: string | null
  status?: string | null
  source?: string | null
  assigneeName?: string | null
  assigneeUserId?: string | null
  relatedRecords?: RelatedRecordSummary[]
  personName?: string | null
  companyName?: string | null
  opportunityName?: string | null
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type IntroductionStep = {
  id?: string
  position?: number
  fromPersonId?: string | null
  toPersonId?: string | null
  responsibleUserId?: string | null
  responsiblePersonId?: string | null
  fromPersonName?: string | null
  toPersonName?: string | null
  responsibleName?: string | null
  status?: string | null
  notes?: string | null
  requestedAt?: string | null
  followUpDate?: string | null
  followUpAt?: string | null
  [key: string]: unknown
}

export type WarmIntroductionRecord = {
  id: string
  targetPersonId?: string | null
  ownerUserId?: string | null
  targetPersonName?: string | null
  ownerName?: string | null
  status?: string | null
  currentStep?: number | null
  steps?: IntroductionStep[]
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type MeetingNoteRequirementRecord = {
  id: string
  eventId?: string | null
  eventTitle?: string | null
  title?: string | null
  meetingAt?: string | null
  status?: string | null
  summary?: string | null
  nextStepsMarkdown?: string | null
  followUpDate?: string | null
  cancellationReason?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
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
