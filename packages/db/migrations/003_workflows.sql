-- Local workflow storage. Provider credentials, cursors, and provider mappings are
-- intentionally deferred; SYNCED events are marked read-only without provider data.

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  source_timezone text NOT NULL DEFAULT 'Europe/Budapest' CHECK (btrim(source_timezone) <> ''),
  organizer text,
  organizer_name text,
  organizer_email text,
  organizer_user_id uuid,
  owner_user_id uuid,
  location text,
  meeting_url text,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'TENTATIVE', 'CANCELLED')),
  source text NOT NULL DEFAULT 'LOCAL' CHECK (source IN ('LOCAL', 'SYNCED')),
  is_read_only boolean NOT NULL DEFAULT false,
  recurrence_identity text,
  workflow_eligible boolean NOT NULL DEFAULT true,
  exclusion_reason text,
  settings_version integer NOT NULL DEFAULT 1 CHECK (settings_version > 0),
  created_by_actor_id uuid,
  updated_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (organizer_user_id, workspace_id) REFERENCES users (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, workspace_id) REFERENCES users (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK (ends_at >= starts_at),
  CHECK ((source = 'SYNCED') = is_read_only),
  CHECK (workflow_eligible OR nullif(btrim(exclusion_reason), '') IS NOT NULL)
);

CREATE INDEX events_workspace_start_idx ON events (workspace_id, starts_at, id);
CREATE INDEX events_workspace_source_start_idx ON events (workspace_id, source, starts_at, id);
CREATE INDEX events_workspace_owner_start_idx ON events (workspace_id, owner_user_id, starts_at)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX events_workflow_idx ON events (workspace_id, ends_at, id)
  WHERE workflow_eligible AND status <> 'CANCELLED';
CREATE INDEX events_recurrence_idx ON events (workspace_id, recurrence_identity)
  WHERE recurrence_identity IS NOT NULL;

CREATE TABLE event_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  display_name text,
  email text,
  normalized_email text,
  response_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (response_status IN ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'UNKNOWN')),
  is_internal boolean NOT NULL DEFAULT false,
  is_organizer boolean NOT NULL DEFAULT false,
  matched_person_id uuid,
  matched_user_id uuid,
  review_state text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (review_state IN ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'IGNORED')),
  reviewed_by_actor_id uuid,
  reviewed_at timestamptz,
  created_by_actor_id uuid NOT NULL,
  updated_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (event_id, workspace_id) REFERENCES events (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (matched_person_id, workspace_id) REFERENCES people (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (matched_user_id, workspace_id) REFERENCES users (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK (nullif(btrim(display_name), '') IS NOT NULL OR nullif(btrim(email), '') IS NOT NULL),
  CHECK (matched_user_id IS NULL OR is_internal),
  CHECK ((review_state IN ('CONFIRMED', 'IGNORED')) = (reviewed_at IS NOT NULL)),
  CHECK ((review_state IN ('CONFIRMED', 'IGNORED')) = (reviewed_by_actor_id IS NOT NULL))
);

CREATE INDEX event_attendees_event_idx ON event_attendees (workspace_id, event_id, id);
CREATE UNIQUE INDEX event_attendees_email_idx ON event_attendees (workspace_id, event_id, normalized_email)
  WHERE normalized_email IS NOT NULL;
CREATE INDEX event_attendees_person_idx ON event_attendees (workspace_id, matched_person_id)
  WHERE matched_person_id IS NOT NULL;
CREATE INDEX event_attendees_user_idx ON event_attendees (workspace_id, matched_user_id)
  WHERE matched_user_id IS NOT NULL;
CREATE INDEX event_attendees_review_queue_idx ON event_attendees (workspace_id, event_id, id)
  WHERE review_state = 'PENDING';

CREATE TABLE event_people (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  created_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_id, person_id),
  FOREIGN KEY (event_id, workspace_id) REFERENCES events (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, workspace_id) REFERENCES people (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX event_people_person_idx ON event_people (workspace_id, person_id, event_id);

CREATE TABLE event_companies (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  company_id uuid NOT NULL,
  created_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_id, company_id),
  FOREIGN KEY (event_id, workspace_id) REFERENCES events (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, workspace_id) REFERENCES companies (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX event_companies_company_idx ON event_companies (workspace_id, company_id, event_id);

CREATE TABLE event_opportunities (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  created_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_id, opportunity_id),
  FOREIGN KEY (event_id, workspace_id) REFERENCES events (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id, workspace_id) REFERENCES opportunities (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX event_opportunities_opportunity_idx
  ON event_opportunities (workspace_id, opportunity_id, event_id);

CREATE TABLE meeting_notes (
  note_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  summary text NOT NULL DEFAULT '',
  next_steps_markdown text NOT NULL DEFAULT '',
  follow_up_date date,
  status text NOT NULL DEFAULT 'REQUIRED' CHECK (status IN ('REQUIRED', 'COMPLETED', 'CANCELLED')),
  cancellation_reason text,
  completed_by_actor_id uuid,
  completed_at timestamptz,
  cancelled_by_actor_id uuid,
  cancelled_at timestamptz,
  created_by_actor_id uuid,
  updated_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, workspace_id),
  UNIQUE (event_id, workspace_id),
  FOREIGN KEY (note_id, workspace_id) REFERENCES notes (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (event_id, workspace_id) REFERENCES events (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (completed_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (cancelled_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK ((completed_at IS NULL) = (completed_by_actor_id IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by_actor_id IS NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR nullif(btrim(cancellation_reason), '') IS NOT NULL)
);

CREATE INDEX meeting_notes_workspace_status_idx ON meeting_notes (workspace_id, status, updated_at DESC);
CREATE INDEX meeting_notes_follow_up_idx ON meeting_notes (workspace_id, follow_up_date)
  WHERE follow_up_date IS NOT NULL;

CREATE FUNCTION enforce_meeting_note_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_note_type text;
BEGIN
  SELECT note_type INTO current_note_type FROM notes
   WHERE id = NEW.note_id AND workspace_id = NEW.workspace_id;
  IF current_note_type IS DISTINCT FROM 'MEETING' THEN
    RAISE EXCEPTION 'meeting_notes requires a MEETING note, found %', current_note_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_notes_type_guard BEFORE INSERT OR UPDATE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION enforce_meeting_note_type();

CREATE FUNCTION protect_meeting_note_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.note_type IS DISTINCT FROM OLD.note_type AND NEW.note_type <> 'MEETING'
     AND EXISTS (SELECT 1 FROM meeting_notes WHERE note_id = OLD.id AND workspace_id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'a note with meeting workflow metadata must remain type MEETING'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notes_meeting_type_guard BEFORE UPDATE OF note_type ON notes
  FOR EACH ROW EXECUTE FUNCTION protect_meeting_note_type();

CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text,
  due_at timestamptz,
  assignee_user_id uuid,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  source text NOT NULL CHECK (btrim(source) <> ''),
  source_event_id uuid,
  source_meeting_note_id uuid,
  completed_by_actor_id uuid,
  completed_at timestamptz,
  cancelled_by_actor_id uuid,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_actor_id uuid,
  updated_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (assignee_user_id, workspace_id) REFERENCES users (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_event_id, workspace_id) REFERENCES events (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_meeting_note_id, workspace_id) REFERENCES meeting_notes (note_id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (completed_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (cancelled_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK (source_event_id IS NULL OR source_meeting_note_id IS NULL),
  CHECK (source <> 'EVENT' OR source_event_id IS NOT NULL),
  CHECK (source <> 'MEETING_NOTE' OR source_meeting_note_id IS NOT NULL),
  CHECK ((completed_at IS NULL) = (completed_by_actor_id IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by_actor_id IS NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE INDEX follow_ups_workspace_status_due_idx ON follow_ups (workspace_id, status, due_at, id);
CREATE INDEX follow_ups_assignee_status_due_idx ON follow_ups (workspace_id, assignee_user_id, status, due_at)
  WHERE assignee_user_id IS NOT NULL;
CREATE INDEX follow_ups_source_event_idx ON follow_ups (workspace_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE TABLE follow_up_records (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  follow_up_id uuid NOT NULL,
  record_id uuid NOT NULL,
  relationship text NOT NULL DEFAULT 'RELATED' CHECK (relationship IN ('RELATED', 'SOURCE')),
  created_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, follow_up_id, record_id),
  FOREIGN KEY (follow_up_id, workspace_id) REFERENCES follow_ups (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (record_id, workspace_id) REFERENCES records (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX follow_up_records_record_idx ON follow_up_records (workspace_id, record_id, follow_up_id);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  follow_up_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED', 'DELIVERED', 'DISMISSED', 'CANCELLED', 'FAILED')),
  delivered_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by_actor_id uuid,
  cancelled_at timestamptz,
  cancelled_by_actor_id uuid,
  failure_reason text,
  created_by_actor_id uuid NOT NULL,
  updated_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, follow_up_id, scheduled_at),
  FOREIGN KEY (follow_up_id, workspace_id) REFERENCES follow_ups (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (dismissed_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (cancelled_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK ((dismissed_at IS NULL) = (dismissed_by_actor_id IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by_actor_id IS NULL)),
  CHECK ((status = 'DELIVERED') = (delivered_at IS NOT NULL)),
  CHECK ((status = 'DISMISSED') = (dismissed_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK (status <> 'FAILED' OR nullif(btrim(failure_reason), '') IS NOT NULL)
);

CREATE INDEX reminders_pending_schedule_idx ON reminders (workspace_id, scheduled_at, id)
  WHERE status = 'SCHEDULED';
CREATE INDEX reminders_follow_up_idx ON reminders (workspace_id, follow_up_id, scheduled_at DESC);

CREATE TABLE introduction_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  target_person_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  created_by_actor_id uuid,
  updated_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (target_person_id, workspace_id) REFERENCES people (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, workspace_id) REFERENCES users (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX introduction_chains_target_status_idx
  ON introduction_chains (workspace_id, target_person_id, status, updated_at DESC);
CREATE INDEX introduction_chains_owner_status_idx
  ON introduction_chains (workspace_id, owner_user_id, status, updated_at DESC);

CREATE TABLE introduction_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  chain_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  from_person_id uuid,
  to_person_id uuid NOT NULL,
  responsible_user_id uuid,
  responsible_person_id uuid,
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'PENDING', 'REQUESTED', 'ACCEPTED', 'INTRODUCED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'SKIPPED')),
  notes text,
  requested_at timestamptz,
  follow_up_at timestamptz,
  created_by_actor_id uuid,
  updated_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, chain_id, position),
  FOREIGN KEY (chain_id, workspace_id) REFERENCES introduction_chains (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (from_person_id, workspace_id) REFERENCES people (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (to_person_id, workspace_id) REFERENCES people (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (responsible_user_id, workspace_id) REFERENCES users (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (responsible_person_id, workspace_id) REFERENCES people (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK (from_person_id IS NULL OR from_person_id <> to_person_id),
  CHECK ((responsible_user_id IS NOT NULL) <> (responsible_person_id IS NOT NULL)),
  CHECK (follow_up_at IS NULL OR requested_at IS NULL OR follow_up_at >= requested_at)
);

CREATE INDEX introduction_steps_chain_order_idx ON introduction_steps (workspace_id, chain_id, position);
CREATE INDEX introduction_steps_person_status_idx
  ON introduction_steps (workspace_id, to_person_id, status, follow_up_at);
CREATE INDEX introduction_steps_responsible_user_idx
  ON introduction_steps (workspace_id, responsible_user_id, status, follow_up_at)
  WHERE responsible_user_id IS NOT NULL;

CREATE FUNCTION reject_workflow_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is workflow history and cannot be hard-deleted', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE FUNCTION protect_synced_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source <> 'LOCAL' OR OLD.is_read_only THEN
    RAISE EXCEPTION 'synchronized read-only events cannot be hard-deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER synced_events_no_delete BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION protect_synced_event_delete();
CREATE TRIGGER meeting_notes_no_hard_delete BEFORE DELETE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION reject_workflow_history_delete();
CREATE TRIGGER reminders_no_hard_delete BEFORE DELETE ON reminders
  FOR EACH ROW EXECUTE FUNCTION reject_workflow_history_delete();
