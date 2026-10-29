-- Staging, review, and durable source identity for repeatable imports.

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  import_type text NOT NULL CHECK (import_type = lower(btrim(import_type)) AND import_type <> ''),
  source_name text NOT NULL CHECK (btrim(source_name) <> ''),
  source_sha256 bytea NOT NULL CHECK (octet_length(source_sha256) = 32),
  status text NOT NULL DEFAULT 'STAGED'
    CHECK (status IN ('STAGED', 'VALIDATING', 'REVIEW_REQUIRED', 'READY', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  created_count integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_provenance) = 'object'),
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, import_type, source_sha256),
  FOREIGN KEY (created_by_actor_id, workspace_id)
    REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK (
    created_count::bigint + updated_count::bigint + skipped_count::bigint +
    error_count::bigint + review_count::bigint <= total_rows
  ),
  CHECK (status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') OR finished_at IS NOT NULL)
);

CREATE INDEX import_batches_workspace_status_idx
  ON import_batches (workspace_id, status, created_at DESC, id);
CREATE INDEX import_batches_workspace_created_idx
  ON import_batches (workspace_id, created_at DESC, id);

CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 0),
  source_key text,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VALID', 'CREATED', 'UPDATED', 'SKIPPED', 'ERROR', 'REVIEW_REQUIRED', 'IGNORED')),
  review_state text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (review_state IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  source_data jsonb NOT NULL CHECK (jsonb_typeof(source_data) = 'object'),
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(normalized_data) = 'object'),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  target_record_id uuid,
  reviewed_by_actor_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (workspace_id, batch_id, row_number),
  UNIQUE (id, workspace_id),
  UNIQUE (id, batch_id, workspace_id),
  FOREIGN KEY (batch_id, workspace_id)
    REFERENCES import_batches (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_record_id, workspace_id)
    REFERENCES records (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_actor_id, workspace_id)
    REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  CHECK ((review_state IN ('APPROVED', 'REJECTED')) = (reviewed_at IS NOT NULL)),
  CHECK ((review_state IN ('APPROVED', 'REJECTED')) = (reviewed_by_actor_id IS NOT NULL))
);

CREATE INDEX import_rows_batch_status_idx
  ON import_rows (workspace_id, batch_id, status, row_number);
CREATE INDEX import_rows_review_queue_idx
  ON import_rows (workspace_id, batch_id, row_number) WHERE review_state = 'PENDING';
CREATE INDEX import_rows_target_record_idx
  ON import_rows (workspace_id, target_record_id) WHERE target_record_id IS NOT NULL;
CREATE INDEX import_rows_source_key_idx
  ON import_rows (workspace_id, batch_id, source_key) WHERE source_key IS NOT NULL;

CREATE FUNCTION protect_import_batch_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.import_type IS DISTINCT FROM OLD.import_type
     OR NEW.source_name IS DISTINCT FROM OLD.source_name
     OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
     OR NEW.source_provenance IS DISTINCT FROM OLD.source_provenance
     OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import batch source identity and provenance are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_batches_source_immutable BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION protect_import_batch_source();

CREATE FUNCTION protect_import_row_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.row_number IS DISTINCT FROM OLD.row_number
     OR NEW.source_key IS DISTINCT FROM OLD.source_key
     OR NEW.source_data IS DISTINCT FROM OLD.source_data
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import row source identity and provenance are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_rows_source_immutable BEFORE UPDATE ON import_rows
  FOR EACH ROW EXECUTE FUNCTION protect_import_row_source();

CREATE TABLE external_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_system text NOT NULL CHECK (source_system = lower(btrim(source_system)) AND source_system <> ''),
  object_type text NOT NULL CHECK (object_type = lower(btrim(object_type)) AND object_type <> ''),
  external_id text NOT NULL CHECK (btrim(external_id) <> ''),
  record_id uuid NOT NULL,
  import_batch_id uuid,
  import_row_id uuid,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  created_by_actor_id uuid NOT NULL,
  updated_by_actor_id uuid NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, source_system, object_type, external_id),
  FOREIGN KEY (record_id, workspace_id)
    REFERENCES records (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_actor_id, workspace_id)
    REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_actor_id, workspace_id)
    REFERENCES actors (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (import_batch_id, workspace_id)
    REFERENCES import_batches (id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (import_row_id, import_batch_id, workspace_id)
    REFERENCES import_rows (id, batch_id, workspace_id) ON DELETE RESTRICT,
  CHECK ((import_batch_id IS NULL) = (import_row_id IS NULL)),
  CHECK (last_seen_at >= first_seen_at)
);

CREATE INDEX external_references_record_idx
  ON external_references (workspace_id, record_id, source_system, object_type);
CREATE INDEX external_references_import_batch_idx
  ON external_references (workspace_id, import_batch_id, import_row_id)
  WHERE import_batch_id IS NOT NULL;

CREATE FUNCTION protect_external_reference_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.source_system IS DISTINCT FROM OLD.source_system
     OR NEW.object_type IS DISTINCT FROM OLD.object_type
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
     OR NEW.import_row_id IS DISTINCT FROM OLD.import_row_id
     OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'external reference source identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_references_identity_immutable BEFORE UPDATE ON external_references
  FOR EACH ROW EXECUTE FUNCTION protect_external_reference_identity();

CREATE FUNCTION reject_import_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is import history and cannot be hard-deleted', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER import_batches_no_delete BEFORE DELETE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION reject_import_history_delete();
CREATE TRIGGER import_rows_no_delete BEFORE DELETE ON import_rows
  FOR EACH ROW EXECUTE FUNCTION reject_import_history_delete();
CREATE TRIGGER external_references_no_delete BEFORE DELETE ON external_references
  FOR EACH ROW EXECUTE FUNCTION reject_import_history_delete();
