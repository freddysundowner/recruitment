-- Background jobs, the message log, two-factor sign-in and employer logins.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'recruiter', 'documentation', 'finance', 'employer'));
ALTER TABLE users
  ADD COLUMN employer_id     uuid REFERENCES employers(id) ON DELETE CASCADE,
  ADD COLUMN phone           text,
  ADD COLUMN totp_secret     text,                       -- encrypted, see src/lib/crypto.ts
  ADD COLUMN totp_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN recovery_codes  jsonb NOT NULL DEFAULT '[]'; -- sha-256 hashes of unused codes
ALTER TABLE users ADD CONSTRAINT users_employer_role
  CHECK ((role = 'employer') = (employer_id IS NOT NULL));

-- A simple database-backed queue. The web app adds jobs; a separate worker process runs them.
CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  run_at       timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  last_error   text,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- stops the same reminder being queued twice
  dedupe_key   text
);
CREATE UNIQUE INDEX jobs_dedupe_key ON jobs (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE status = 'queued';

CREATE TABLE messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  to_addr      text NOT NULL,
  subject      text,
  body         text NOT NULL,
  template     text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_ref text,
  error        text,
  candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  employer_id  uuid REFERENCES employers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX messages_candidate_idx ON messages (candidate_id, created_at DESC);
CREATE INDEX messages_tenant_idx ON messages (tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs', 'messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

-- The app can queue jobs and read them; only the worker (table owner) updates them.
GRANT SELECT, INSERT ON jobs TO recruit_app;
GRANT USAGE ON SEQUENCE jobs_id_seq TO recruit_app;
-- The worker marks messages sent or failed, so the app only reads and adds them.
GRANT SELECT, INSERT ON messages TO recruit_app;

-- auth_lookup_user now also returns what the sign-in step needs for two-factor and employer logins.
DROP FUNCTION auth_lookup_user(text);
CREATE FUNCTION auth_lookup_user(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, name text, role text, password_hash text, tenant_status text,
                 totp_enabled boolean, totp_secret text, recovery_codes jsonb)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.tenant_id, u.name, u.role, u.password_hash, t.status, u.totp_enabled, u.totp_secret, u.recovery_codes
    FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE lower(u.email) = lower(p_email) AND u.status = 'active'
  $$;
REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO recruit_app;
