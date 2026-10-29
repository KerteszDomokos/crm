# Resoloon CRM — Functional Plan

## 1. Product goal

Create a shared CRM for Resoloon's small team that brings contacts, companies, opportunities, meetings, email follow-ups, introductions, and relationship history into one workspace.

The first release is complete only when all functionality in this plan is available. The delivery increments below define implementation order, not optional scope.

## 2. Operating model

- The CRM is used by 3–4 trusted team members in a shared workspace.
- Every team member has an individual account and logs in with an email address and password.
- Creates, edits, notes, follow-ups, and other actions automatically record the logged-in user so the team can see who did what.
- Automated actions identify the connected account owner and indicate that the action was performed by the system.
- All CRM users can view and edit all CRM information, including eligible email threads belonging to other team members. Emails cant be sent from the system, but reading them is possible for everyone.

### 2.1 Authentication and user administration

- There is no public registration. An administrator creates each user account.
- The first administrator account is created during initial setup.
- An administrator can add a user with a name and unique email address from a short, single-screen form.
- A newly added user receives a password-setup flow and can change their own password later.
- Users can log out and request a password reset.
- The system has administrator and standard-user account types. Both can access the shared CRM data; only administrators can manage users and workspace-wide settings.
- The simple admin panel allows an administrator to list users, add or rename a user, grant or remove administrator status, deactivate or reactivate an account, and reset a user's access.
- Deactivating a user prevents future login without removing their historical activity, record ownership, or integration history.

## 3. Main navigation

The left navigation provides access to:

1. Dashboard
2. People
3. Companies
4. Opportunities
5. Notes and meetings
6. Follow-ups
7. Warm introductions
8. Calendar and events
9. Email
10. LinkedIn connections
11. Global search
12. Settings
13. Admin panel (administrators only)

The logged-in user's name and a logout action remain visible from every screen in the top-right header panel.

## 4. Core records

### 4.1 People

Each person has one editable full-name field. During CSV import, first and last names are combined into this field.

The person record supports:

- Full name
- Categories and importance
- Primary and additional email addresses
- Primary and additional phone numbers
- Job title
- One or more associated companies
- LinkedIn profile and secondary links
- Address and location details (should focus on city, and autocomplete them if possible to avoid the typos)
- General description or imported legacy note
- Source, creator, creation date, and action history
- Next follow-up
- Introduced-by person
- Notes, meetings, events, opportunities, email threads, and follow-ups
- Warm-introduction requests involving the person

The person page highlights outstanding actions, including when that person is expected to introduce the team to someone else.

### 4.2 Companies

The company record supports the information present in `data/company.csv`, including:

- Name
- Domain and secondary links
- LinkedIn profile and secondary links
- Address and location details
- Categories and industries
- Customer profile and business role
- Description
- Owner, source, creator, creation date, and last update
- Associated people, opportunities, notes, meetings, events, email threads, and follow-ups

A person may belong to multiple companies, and a company may have multiple people.

### 4.3 Opportunities

Opportunities use this standard pipeline:

1. Lead
2. Qualified
3. Proposal
4. Negotiation
5. Won
6. Lost

An opportunity contains a name, description, stage, value and currency, owner, expected close date, next action, next follow-up, and optional won/lost details. It can be associated with multiple people and companies and can have notes, meetings, events, email threads, and follow-ups.

Users can view opportunities as a list and grouped by pipeline stage.

### 4.4 Notes and meeting notes

All notes:

- Support Markdown
- Record creation and last-modification dates
- Record who created and last changed them
- Can be attached to a person, company, or opportunity

A meeting note is a specialized note with:

- Meeting reference
- Meeting summary
- Next steps
- Follow-up date
- Status: required, completed, or cancelled
- Cancellation reason when cancelled

### 4.5 Follow-ups

A follow-up can be created manually or generated from a meeting, meeting note, sales email, event, opportunity, or warm introduction.

It includes a title, due date, responsible team member, status, related CRM records, source, reminders, and an optional linked Linear issue. Follow-ups appear on the dashboard and in the relevant record timelines.

### 4.6 Warm-introduction chains

A warm introduction tracks an ordered path from the team through one or more people to a target person.

Each chain shows:

- Target person
- Ordered introduction steps
- Person responsible for each step
- Current step
- Status of each step: planned, requested, accepted, introduced, declined, or skipped
- Notes and follow-up dates
- Overall chain status

When a person has an active step, their person page clearly states whom they are expected to introduce and shows the related follow-up.

### 4.7 Events

Events store calendar details, date and time, organizer, attendees, description, location or meeting link, reminders, and related CRM records. Events may come from Google Calendar or be created in the CRM.

### 4.8 LinkedIn connections

LinkedIn connection CSV files can be uploaded repeatedly. Importing a newer export updates existing connection records and adds new ones without duplicating previous imports.

Each imported connection can be:

- Matched to an existing CRM person
- Converted into a new CRM person
- Left as an unmatched LinkedIn connection
- Marked as not needed in the CRM

Connections marked as not needed are excluded from future match and person suggestions. Matching a connection enriches the person with the LinkedIn URL and other available information without overwriting better CRM data without confirmation.

## 5. Dashboard

The dashboard is an action-oriented feed containing:

- Meeting notes that must be completed or cancelled
- Overdue and upcoming follow-ups
- Sales emails awaiting replies
- Reply and status updates for tracked sales threads
- Warm-introduction actions
- Relevant Linear synchronization updates or failures

Items are ordered by urgency and can be completed, cancelled, opened, or reassigned directly from the feed where appropriate.

## 6. Search and duplicate handling

### 6.1 Global search

One search box searches across all useful CRM information, including names, email addresses, phone numbers, company names and domains, opportunity details, notes, meeting summaries, email content, event details, LinkedIn data, and follow-ups.

Results are grouped by record type, show why they matched, and open the relevant record or content.

This search feature should be available on the header, but the results then just show up as suggestion. If enter is hit, the system switches to the detailed search tab.

### 6.2 Duplicate detection and merging

Potential duplicate people and companies are detected during manual creation, CSV import, LinkedIn matching, and calendar-driven contact creation.

- Strong exact matches should prevent accidental duplicate creation.
- Similar names or partial matches create a merge suggestion.
- Users confirm all non-exact merges.
- A merge preview shows which values and relationships will be retained.
- Merging preserves notes, events, email threads, relationships, history, and follow-ups.

## 7. Integrations and workflows

### 7.1 Google Calendar and meeting-note workflow

Each user may have a connected calendar. Calendar data is combined into the shared workspace while retaining its owner.

Workflow:

1. Calendar events are synchronized into the CRM.
2. Events are matched to existing people using attendee identity.
3. Unknown external attendees are added as CRM people after confirmation from the feed dashboard.
4. If a newly added attendee resembles an existing person, the CRM suggests a merge.
5. After an eligible meeting occurs, the CRM creates a required meeting-note item and a Linear issue with the management label.
6. The reminder appears on the dashboard and on related record pages.
7. Completing or cancelling the note updates the Linear issue.
8. Completing or cancelling the Linear issue updates the CRM item.
9. A completed note can generate follow-ups from its next steps and follow-up date.

Settings provide:

- A list of words or phrases that exclude matching meetings from this workflow
- A list of people whose regular meetings do not require notes
- A quick way to add a new exclusion

An excluded meeting does not create a note task, Linear issue, or new CRM people from its attendees.

### 7.2 Email visibility and privacy rule

Email accounts are associated with their respective users. Eligible email threads are visible to the whole CRM team and clearly identify the account owner.

To avoid exposing unrelated personal or company email, a thread's full content is imported and displayed only when at least one external participant can be matched to an existing CRM person. Unmatched email is not parsed into shared CRM content.

Eligible threads are automatically related to matched people and their companies. Users can also relate them to opportunities.

### 7.3 Sales-email workflow

Users can mark an eligible sent thread as a sales email with one action.

When marked:

1. The CRM proposes all matched external recipients and companies.
2. The thread is tracked once and may relate to multiple people and companies.
3. A follow-up deadline is set from a workspace default and can be changed for that thread.
4. If no external reply arrives by the deadline, the CRM creates a dashboard reminder and a Linear issue with the management label.
5. When a reply arrives, the sales item is updated and the outstanding no-reply reminder and Linear issue are completed.
6. Users can cancel tracking, change the deadline, or mark a reply as not resolving the required follow-up.
7. Status changes synchronize in both directions between the CRM and Linear.

### 7.4 Linear synchronization

Meeting-note and sales follow-up issues use the management label. The CRM keeps their status synchronized in both directions with Linear.

Every linked item shows its Linear reference and synchronization state. If synchronization fails, the item remains usable in the CRM and a visible warning allows a retry.

### 7.5 Read/write MCP interface

The first release includes an MCP interface through which approved AI clients can:

- Search and read CRM records and relationships
- Create and update people, companies, opportunities, notes, events, and follow-ups
- Add meeting notes and next steps
- Manage opportunity stages and warm-introduction chains
- Complete or cancel follow-ups

MCP changes appear in normal record history and are identified as automated actions. Destructive actions such as merging or deleting records require explicit confirmation through the CRM rather than being performed silently.

## 8. Record timelines and activity history

People, companies, notes, and opportunities have a chronological timeline combining relevant notes, meetings, calendar events, email activity, follow-ups, introductions, and record changes.

Each activity indicates its source, date, related records, and the logged-in user or connected account responsible for it.

## 9. Initial data import

The existing person and company CSV files are imported into the CRM.

- Person first and last name columns are combined into one full name.
- Existing IDs and source information are retained as import references.
- Person-to-company relationships are restored from the imported IDs.
- Multi-value fields such as categories, emails, phones, links, and industries remain multi-value.
- Duplicate candidates are reviewed rather than imported blindly.
- Import produces a summary of created, updated, skipped, and review-required records.

## 10. Functional settings

Settings cover:

- The logged-in user's profile and password
- Connected calendar and email account ownership
- Linear connection and management label
- Default sales-email follow-up period
- Meeting exclusion words and phrases
- People excluded from mandatory meeting notes
- Email addresses excluded from CRM and ever creating a person for them
- LinkedIn CSV import and import history
- Integration status and retryable errors
- Manual full-backup download

Workspace-wide integration and workflow settings are editable by administrators. Standard users can manage their own profile, password, and connected accounts.

The administrator-only user panel covers:

- Adding users
- Renaming users and changing their email addresses
- Granting or removing administrator status
- Deactivating and reactivating accounts
- Resetting account access

### 10.1 Manual full backup

Administrators have a **Download full backup** button in the settings or admin panel. After confirmation, the CRM creates and downloads a timestamped ZIP file containing all CRM-managed data, including:

- People, companies, opportunities, notes, and their relationships
- Follow-ups, warm-introduction chains, events, and meeting information
- Eligible stored email threads and sales-email tracking data
- LinkedIn connection data and import history
- Users, account status, record ownership, and activity history
- Workspace settings and integration configuration
- Uploaded or imported source files retained by the CRM
- A manifest describing when the backup was created and what it contains

The backup must contain enough information to support a complete future restore without losing relationships or history. Plaintext passwords and active external-service credentials are not included; integrations can be reconnected after restoration.

The CRM shows backup progress and a clear success or failure result. Creating a backup is recorded in the activity history. Scheduled automatic backups are planned for a later release and are not required for the first release.

## 11. Delivery increments

### Increment 1 — Shared CRM foundation

- Email-and-password login, logout, and password reset
- Simple administrator panel and user lifecycle management
- Logged-in user action attribution
- People, companies, opportunities, notes, and relationships
- Initial CSV import
- Administrator full-backup ZIP download
- Record timelines
- Global search
- Duplicate detection and merging

### Increment 2 — Meetings and follow-ups

- Events and Google Calendar synchronization
- Automatic attendee creation and merge suggestions
- Meeting exclusions
- Meeting-note workflow and dashboard feed
- Follow-ups and reminders
- Two-way Linear synchronization

### Increment 3 — Email workflow

- Per-user connected email accounts
- Privacy-gated full-thread import
- Automatic person and company matching
- Sales-email tracking
- No-reply reminders and two-way Linear synchronization

### Increment 4 — Relationship development

- LinkedIn CSV import, update, matching, and exclusions
- Warm-introduction chains and person-page prompts
- Opportunity pipeline views and related workflow polish

### Increment 5 — External access and release readiness

- Read/write MCP interface
- Integration failure and retry experiences
- End-to-end workflow validation
- Data quality review and release acceptance

## 12. Release acceptance

The first release is functionally complete when:

- Existing person and company data can be imported without losing meaningful information or relationships.
- Users can log in with individual accounts, and team actions are attributed to the logged-in user.
- Administrators can add, rename, deactivate, reactivate, and reset access for users from a simple admin panel.
- Deactivated users cannot log in, and their historical activity remains intact.
- An administrator can download a timestamped ZIP containing all CRM-managed data needed for a future complete restore.
- Users can manage all core records and relationships from the UI.
- Search finds relevant information across records, notes, events, and eligible email content.
- Duplicate suggestions and confirmed merges preserve related history.
- Eligible meetings automatically create people, note reminders, and synchronized Linear issues.
- Meeting exclusions prevent both reminders and attendee creation.
- Eligible full email threads are visible across the team without importing unmatched email.
- Sales emails can be tracked with configurable deadlines, reply detection, reminders, and Linear synchronization.
- LinkedIn exports can be re-imported, matched, ignored, or converted into people.
- Warm-introduction chains expose the next required action on relevant person pages.
- Approved MCP clients can search, create, and update CRM information with visible action attribution.
