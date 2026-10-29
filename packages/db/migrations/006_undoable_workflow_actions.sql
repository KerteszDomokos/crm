CREATE TABLE undoable_workflow_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('FOLLOW_UP_STATUS', 'MEETING_NOTE_STATUS')),
  target_id uuid NOT NULL,
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz,
  consumed_by_actor_id uuid,
  UNIQUE (id, workspace_id),
  FOREIGN KEY (actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (consumed_by_actor_id, workspace_id) REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by_actor_id IS NULL))
);

CREATE INDEX undoable_workflow_actions_unconsumed_idx
  ON undoable_workflow_actions (workspace_id, actor_id, created_at DESC, id DESC)
  WHERE consumed_at IS NULL;
