-- Core schema. Every tenant table carries tenant_id and is protected by row-level security.
-- The app connects as recruit_app (not the owner), so the policies below always apply.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION app_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- tenants
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  plan       text NOT NULL DEFAULT 'pro',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  features   jsonb NOT NULL DEFAULT '{}',
  settings   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'recruiter', 'documentation', 'finance')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE tenant_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       text NOT NULL,
  value     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, key)
);

-- ---------------------------------------------------------------- pipeline
CREATE TABLE pipeline_stages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position          int  NOT NULL,
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  required_doc_types text[] NOT NULL DEFAULT '{}',
  requires_payment  boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, position)
);

-- ---------------------------------------------------------------- people
CREATE TABLE candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name          text NOT NULL,
  last_name           text NOT NULL,
  id_number           text,
  dob                 date,
  gender              text,
  phone               text NOT NULL,
  email               text,
  county              text,
  skills              text NOT NULL DEFAULT '',
  experience          text NOT NULL DEFAULT '',
  preferred_countries text NOT NULL DEFAULT '',
  consent_at          timestamptz,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'placed', 'inactive')),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX candidates_id_number_key ON candidates (tenant_id, id_number) WHERE id_number IS NOT NULL;
CREATE INDEX candidates_phone_idx ON candidates (tenant_id, phone);

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,
  doc_number  text,
  issue_date  date,
  expiry_date date,
  file_key    text NOT NULL,
  file_name   text NOT NULL,
  mime_type   text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_candidate_idx ON documents (candidate_id);
CREATE INDEX documents_expiry_idx ON documents (tenant_id, expiry_date);

CREATE TABLE employers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company      text NOT NULL,
  country      text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  currency     text NOT NULL DEFAULT 'USD',
  vetted       boolean NOT NULL DEFAULT false,
  notes        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employer_id      uuid NOT NULL REFERENCES employers(id) ON DELETE RESTRICT,
  title            text NOT NULL,
  country          text NOT NULL,
  quantity         int  NOT NULL CHECK (quantity > 0),
  salary           text NOT NULL DEFAULT '',
  terms            text NOT NULL DEFAULT '',
  deadline         date,
  payment_model    text NOT NULL CHECK (payment_model IN ('employer_paid', 'candidate_paid')),
  placement_fee_minor bigint NOT NULL DEFAULT 0,
  fee_currency     text NOT NULL DEFAULT 'USD',
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'closed')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- placements
CREATE TABLE placements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  job_order_id  uuid NOT NULL REFERENCES job_orders(id) ON DELETE RESTRICT,
  stage_id      uuid NOT NULL REFERENCES pipeline_stages(id),
  payment_model text NOT NULL CHECK (payment_model IN ('employer_paid', 'candidate_paid')),
  outcome       text NOT NULL DEFAULT 'active' CHECK (outcome IN ('active', 'deployed', 'closed')),
  close_reason  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
-- A candidate can sit in many placements over time, but only one active one at once.
CREATE UNIQUE INDEX placements_one_active ON placements (candidate_id) WHERE outcome = 'active';
CREATE INDEX placements_stage_idx ON placements (tenant_id, stage_id);

CREATE TABLE stage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id  uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES pipeline_stages(id),
  to_stage_id   uuid REFERENCES pipeline_stages(id),
  user_id       uuid REFERENCES users(id),
  note          text NOT NULL DEFAULT '',
  override      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- money
-- Money is stored as integer minor units with an explicit currency, never as floats.
CREATE TABLE costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id   uuid NOT NULL REFERENCES placements(id) ON DELETE RESTRICT,
  category       text NOT NULL,
  amount_minor   bigint NOT NULL,
  currency       text NOT NULL DEFAULT 'KES',
  payee          text NOT NULL DEFAULT '',
  incurred_on    date NOT NULL DEFAULT current_date,
  receipt_ref    text NOT NULL DEFAULT '',
  reverses_id    uuid REFERENCES costs(id),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fee_charges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  placement_id  uuid NOT NULL REFERENCES placements(id) ON DELETE RESTRICT,
  fee_type      text NOT NULL,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      text NOT NULL DEFAULT 'KES',
  due_on        date,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number        text NOT NULL,
  employer_id   uuid NOT NULL REFERENCES employers(id),
  placement_id  uuid NOT NULL REFERENCES placements(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      text NOT NULL,
  fx_rate_to_kes numeric(14,6) NOT NULL DEFAULT 1,
  issued_on     date NOT NULL DEFAULT current_date,
  due_on        date,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_no    text NOT NULL,
  party         text NOT NULL CHECK (party IN ('candidate', 'employer')),
  placement_id  uuid NOT NULL REFERENCES placements(id),
  invoice_id    uuid REFERENCES invoices(id),
  method        text NOT NULL CHECK (method IN ('mpesa', 'cash', 'bank')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      text NOT NULL,
  reference     text NOT NULL DEFAULT '',
  paid_on       date NOT NULL DEFAULT current_date,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_no)
);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);

-- ---------------------------------------------------------------- row-level security
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'tenant_counters', 'pipeline_stages', 'candidates', 'documents', 'employers',
    'job_orders', 'placements', 'stage_history', 'costs', 'fee_charges', 'invoices', 'payments', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants USING (id = app_tenant()) WITH CHECK (id = app_tenant());

-- ---------------------------------------------------------------- grants
GRANT USAGE ON SCHEMA public TO recruit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, tenant_counters, pipeline_stages, candidates, documents, employers,
  job_orders, placements, fee_charges, invoices TO recruit_app;
-- Append-only: history, money movements and the audit trail can be added to, never changed.
GRANT SELECT, INSERT ON stage_history, costs, payments, audit_log TO recruit_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO recruit_app;

-- ---------------------------------------------------------------- login lookup
-- Login happens before the tenant is known, so it goes through one narrow function
-- that runs as the table owner and returns a single user by email.
CREATE FUNCTION auth_lookup_user(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, name text, role text, password_hash text, tenant_status text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.tenant_id, u.name, u.role, u.password_hash, t.status
    FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE lower(u.email) = lower(p_email) AND u.status = 'active'
  $$;
REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO recruit_app;
