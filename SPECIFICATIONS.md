# CRM system specification
This is going to be Resoloon's CRM system which is gonna be hosted on a Raspberry Pi or similar linux based computer using kubernetes. Kubernetes setup will be defined in a different repo.


The system will handle 3 or maximum 4 users, and the hosting will go trough tailscale.


The CRM system needs a postgresql database with the contacts.

## Schema
### People
People obviously have names (please dont separate first and last name), other than that, its the same as you see it on the person.csv file in data.

Add an additional introduced by field to track connections


### Companies
Same as in the company.csv file

### Opportunities
Just the obvious ones


### Notes
Markdown data with a date of creation and modification.
We need a meeting note form, where the meeting summary, next steps and followup date is set.

### Followups
Reminders connected to linear with tasks and reminders on the main page alongside the note requirements to the calendar events


### Warm intro tracker
Most complicated one, where you can chain people after each other to actually get to a target one. Its just relations, and if somebody is added to this chain, show on the persons page that they should intro me to somebody.


### Events
Just pure data, nothing special. Reminders should be an option


### Linkedin connections
Just to store the data from a linkedin connection csv file in the db, which should be updateable by uploading the csv. It should have a flag with needed in crm or not, and if not then the autosuggestion system shouldnt recommend it to the persons

## Connections
The obvious CRM connections: company to person, (multiple person can have the same company and one individual can have multiple companies), opportunity to company and persons.

Notes to each type of data, person, company, opportunity.


## Connectors and integrations
- Linear - needs to create tasks with management label

- Google calendar for syncing - needs to sync if something happens with somebody and automatically put into the crm when somebody new was on the meet, and should set automated tasks when a summary is needed.


- Emails - either with a link to all threads or actually parse all of them and show them on the UI. Decision later when decided how hard is this

- MCP server if thats not too complicated


## Workflows
1. When a meeting happened it lists the neccesary note uploading on the main page automatically. Also creates a linear ticket, and if the summary is completed or cancelled the linear ticket needs to move as well. 
2. Sales email workflow: each email can be set as sales email, and then it will be tracked and should create followup reminders and stuff.


## AI
We should have an mcp connector opportunity if thats easy to ingegrate

## Search
We need to have a very good search bar, which searches trough everything: names, company names notes and everywhere there is any informatin.


## API
We need to have an API, since i might implement a client application later. This api should be used by the UI as well, and later that can be ported to a native desktop app.

## UI
We should have a panel on the left side with all the tables: company people etc

We should have there a main page where there is a feed kind of thing, where you are reminded to make meeting notes about the recent meeting (is in sync with linear), and also where you get updates from the sales emails.

We should have an email tab where each sent email can be set as sales email (with automatic connection to the persons), and if an email is set as a sales email (easily like on button on the right side of this)

We should have a linkedin connection matcher, where we can select persons from the linkedin export to map it to real person entrys. that should just add the linkedin link to the entry, and if any other info is available that too.




## Other features
- Automated meeting note reminders trough linear: when there is a meet an issue is automatically generated in linear. For that there should be a list (with an easy option to add) which blocks this if words are in the meeting description suchas team, and people who i meet reguraly and can be also excluded from this mandatory meeting note uploading.
- Duplicated entrys should be detected
- Automatic Linkedin exported csv data should be uploadable and it should have dedicated ui where you can either pair the persons to someone or just leave them as a linkedin connection

- Sales related emails: we need to choose from the sent emails which are sales related ones, and if no reply was detected, sends a followup notification and creates a ticket.
