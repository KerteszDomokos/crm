ALTER TABLE taxonomy_terms
  ADD COLUMN color text NOT NULL DEFAULT '#6B8E7C'
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN description text,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX taxonomy_terms_workspace_active_order_idx
  ON taxonomy_terms (workspace_id, taxonomy, is_active, sort_order, normalized_label);
