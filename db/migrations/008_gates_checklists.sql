-- More stage gates, job categories for country checklists, and per-placement checklist steps.
ALTER TABLE pipeline_stages
  ADD COLUMN requires_contract    boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_visa        boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_orientation boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_arrival     boolean NOT NULL DEFAULT false;

-- Apply the defaults to agencies that already exist.
UPDATE pipeline_stages SET requires_contract = true WHERE name = 'Contract';
UPDATE pipeline_stages SET requires_visa = true, requires_orientation = true WHERE name = 'Visa and travel';
UPDATE pipeline_stages SET requires_arrival = true WHERE name = 'Deployed';

ALTER TABLE job_orders ADD COLUMN category text NOT NULL DEFAULT '';

CREATE TABLE placement_steps (
  placement_id uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step         text NOT NULL,
  done_on      date NOT NULL DEFAULT current_date,
  done_by      uuid REFERENCES users(id),
  PRIMARY KEY (placement_id, step)
);
ALTER TABLE placement_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE placement_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON placement_steps USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON placement_steps TO recruit_app;
