-- Candidate and employer portals.
-- Besides the agency wall (tenant_id), a candidate session is limited to that one candidate's rows and an
-- employer session to that one employer's jobs, enforced by the database itself. If any portal code ever
-- forgot a filter, the database still refuses to return other people's rows.

CREATE FUNCTION app_candidate() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.candidate_id', true), '')::uuid $$;
CREATE FUNCTION app_employer() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.employer_id', true), '')::uuid $$;

CREATE TABLE otp_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone      text NOT NULL,
  purpose    text NOT NULL CHECK (purpose IN ('login', 'register')),
  code_hash  text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (tenant_id, phone, created_at DESC);

CREATE TABLE applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_order_id uuid NOT NULL REFERENCES job_orders(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shortlisted', 'declined', 'withdrawn')),
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, job_order_id)
);

CREATE TABLE data_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('export', 'delete')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  handled_by   uuid REFERENCES users(id),
  handled_at   timestamptz
);

CREATE TABLE employer_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  employer_id  uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  decision     text NOT NULL CHECK (decision IN ('interview', 'select', 'reject')),
  note         text NOT NULL DEFAULT '',
  proposed_at  timestamptz,
  decided_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Employers can request workers; staff approve before the job order opens.
ALTER TABLE job_orders DROP CONSTRAINT job_orders_status_check;
ALTER TABLE job_orders ADD CONSTRAINT job_orders_status_check CHECK (status IN ('pending', 'open', 'filled', 'closed'));
ALTER TABLE job_orders ADD COLUMN requested_by uuid REFERENCES users(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['otp_codes', 'applications', 'data_requests', 'employer_decisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON otp_codes, applications, data_requests TO recruit_app;
GRANT SELECT, INSERT ON employer_decisions TO recruit_app;

CREATE POLICY portal_scope ON users AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON tenant_counters AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON costs AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON placement_steps AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON checkins AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON country_checklists AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON employer_checks AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON otp_codes AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL));
CREATE POLICY portal_scope ON fee_charges AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR (app_candidate() IS NOT NULL AND placement_id IN (SELECT id FROM placements))) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR (app_candidate() IS NOT NULL AND placement_id IN (SELECT id FROM placements)));
CREATE POLICY portal_scope ON invoices AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR employer_id = app_employer()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR employer_id = app_employer());
CREATE POLICY portal_scope ON payments AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR (app_candidate() IS NOT NULL AND party = 'candidate' AND placement_id IN (SELECT id FROM placements)) OR (app_employer() IS NOT NULL AND party = 'employer' AND invoice_id IN (SELECT id FROM invoices))) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR (app_candidate() IS NOT NULL AND party = 'candidate' AND placement_id IN (SELECT id FROM placements)) OR (app_employer() IS NOT NULL AND party = 'employer' AND invoice_id IN (SELECT id FROM invoices)));
CREATE POLICY portal_scope ON candidates AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR id = app_candidate() OR (app_employer() IS NOT NULL AND id IN (SELECT p.candidate_id FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE s.position >= 3))) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR id = app_candidate() OR (app_employer() IS NOT NULL AND id IN (SELECT p.candidate_id FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE s.position >= 3)));
CREATE POLICY portal_scope ON documents AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate());
CREATE POLICY portal_scope ON employers AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR id = app_employer()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR id = app_employer());
CREATE POLICY portal_scope ON job_orders AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR (app_candidate() IS NOT NULL AND status = 'open') OR employer_id = app_employer()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR (app_candidate() IS NOT NULL AND status = 'open') OR employer_id = app_employer());
CREATE POLICY portal_scope ON placements AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate() OR (app_employer() IS NOT NULL AND job_order_id IN (SELECT id FROM job_orders))) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate() OR (app_employer() IS NOT NULL AND job_order_id IN (SELECT id FROM job_orders)));
CREATE POLICY portal_scope ON stage_history AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR placement_id IN (SELECT id FROM placements)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR placement_id IN (SELECT id FROM placements));
CREATE POLICY portal_scope ON placement_travel AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR placement_id IN (SELECT id FROM placements)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR placement_id IN (SELECT id FROM placements));
CREATE POLICY portal_scope ON appointments AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR (placement_id IN (SELECT id FROM placements) AND (app_employer() IS NULL OR kind = 'interview'))) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR (placement_id IN (SELECT id FROM placements) AND (app_employer() IS NULL OR kind = 'interview')));
CREATE POLICY portal_scope ON contracts AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR placement_id IN (SELECT id FROM placements)) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR placement_id IN (SELECT id FROM placements));
CREATE POLICY portal_scope ON complaints AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate());
CREATE POLICY portal_scope ON messages AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate());
CREATE POLICY portal_scope ON applications AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate() OR (app_employer() IS NOT NULL AND job_order_id IN (SELECT id FROM job_orders))) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate() OR (app_employer() IS NOT NULL AND job_order_id IN (SELECT id FROM job_orders)));
CREATE POLICY portal_scope ON mpesa_requests AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate());
CREATE POLICY portal_scope ON data_requests AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR candidate_id = app_candidate());
CREATE POLICY portal_scope ON employer_decisions AS RESTRICTIVE FOR ALL USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR employer_id = app_employer()) WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR employer_id = app_employer());

-- Portals can add to the audit trail and the job queue but never read them.
CREATE POLICY portal_scope ON audit_log AS RESTRICTIVE FOR SELECT USING (app_candidate() IS NULL AND app_employer() IS NULL);
CREATE POLICY portal_scope ON jobs AS RESTRICTIVE FOR SELECT USING (app_candidate() IS NULL AND app_employer() IS NULL);

-- The public sign-in pages know only the agency's address (its slug). This returns just what they may show.
CREATE FUNCTION tenant_public(p_slug text)
  RETURNS TABLE (id uuid, name text, brand_name text, brand_color text, portal_open boolean)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.name, t.settings->>'brand_name', t.settings->>'brand_color',
           COALESCE((t.settings->>'candidate_portal')::boolean, true)
    FROM tenants t WHERE t.slug = lower(p_slug) AND t.status = 'active'
  $$;
REVOKE ALL ON FUNCTION tenant_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_public(text) TO recruit_app;
