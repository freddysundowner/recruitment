-- Deployment operations: travel and visa, appointments, country checklists, contracts,
-- post-deployment check-ins, complaints and employer vetting checks.

CREATE TABLE placement_travel (
  placement_id        uuid PRIMARY KEY REFERENCES placements(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visa_status         text NOT NULL DEFAULT 'not_started' CHECK (visa_status IN ('not_started', 'applied', 'approved', 'refused')),
  visa_applied_on     date,
  visa_decision_on    date,
  visa_number         text,
  visa_expiry         date,
  airline             text,
  flight_no           text,
  ticket_ref          text,
  departure_on        date,
  departure_airport   text,
  orientation_done_on date,
  arrival_confirmed_on date,
  employer_start_on   date,
  notes               text NOT NULL DEFAULT '',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id)
);

CREATE TABLE appointments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('interview', 'medical', 'embassy', 'orientation', 'other')),
  scheduled_at timestamptz NOT NULL,
  location     text NOT NULL DEFAULT '',
  result       text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'passed', 'failed', 'no_show', 'cancelled')),
  notes        text NOT NULL DEFAULT '',
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_when_idx ON appointments (tenant_id, scheduled_at);

-- What a worker needs before leaving for a given country (and, optionally, job category).
CREATE TABLE country_checklists (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  country            text NOT NULL,
  job_category       text NOT NULL DEFAULT '',
  required_doc_types text[] NOT NULL DEFAULT '{}',
  steps              text[] NOT NULL DEFAULT '{}',
  notes              text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX country_checklists_key ON country_checklists (tenant_id, lower(country), lower(job_category));

-- Contract copies from each side. Differences in the key terms are flagged as possible substitution.
CREATE TABLE contracts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id   uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  party          text NOT NULL CHECK (party IN ('candidate', 'employer')),
  salary_minor   bigint NOT NULL CHECK (salary_minor >= 0),
  currency       text NOT NULL,
  hours_per_week int,
  months         int,
  other_terms    text NOT NULL DEFAULT '',
  file_key       text,
  file_name      text,
  signed_on      date NOT NULL DEFAULT current_date,
  recorded_by    uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contracts_placement_idx ON contracts (placement_id, created_at DESC);

CREATE TABLE checkins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  due_on       date NOT NULL,
  done_on      date,
  outcome      text CHECK (outcome IN ('well', 'concern', 'unreachable')),
  notes        text NOT NULL DEFAULT '',
  created_by   uuid REFERENCES users(id)
);
CREATE INDEX checkins_due_idx ON checkins (tenant_id, due_on) WHERE done_on IS NULL;

CREATE TABLE complaints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  placement_id uuid REFERENCES placements(id) ON DELETE SET NULL,
  raised_via   text NOT NULL CHECK (raised_via IN ('portal', 'staff')),
  subject      text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  resolution   text NOT NULL DEFAULT '',
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

CREATE TABLE employer_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employer_id uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('registration', 'references', 'past_complaints', 'site_visit', 'other')),
  result      text NOT NULL CHECK (result IN ('ok', 'concern')),
  notes       text NOT NULL DEFAULT '',
  checked_on  date NOT NULL DEFAULT current_date,
  checked_by  uuid REFERENCES users(id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['placement_travel', 'appointments', 'country_checklists', 'contracts', 'checkins', 'complaints', 'employer_checks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON placement_travel, appointments, country_checklists, checkins, complaints, employer_checks TO recruit_app;
-- Contracts are evidence: add and read, never edit.
GRANT SELECT, INSERT ON contracts TO recruit_app;
