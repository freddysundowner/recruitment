-- The multi-agency platform: plans, subscriptions, platform administrators and self-service signup.
--
-- Platform staff work across every agency, which the row-level wall normally forbids. Rather than give the web
-- app a database role that bypasses the wall, the app can only call the small set of SECURITY DEFINER
-- functions below. Each does one named job (list agencies, change a plan, record a payment, ...) and the app
-- only calls them from pages that check a signed-in platform administrator.

CREATE TABLE plans (
  code               text PRIMARY KEY,
  name               text NOT NULL,
  price_kes_minor    bigint NOT NULL CHECK (price_kes_minor >= 0),   -- per month
  max_users          int,                                            -- null means unlimited
  max_candidates     int,
  features           jsonb NOT NULL DEFAULT '{}',
  sort               int NOT NULL DEFAULT 0,
  active             boolean NOT NULL DEFAULT true
);
INSERT INTO plans (code, name, price_kes_minor, max_users, max_candidates, features, sort) VALUES
  ('starter',    'Starter',    500000,  3,    300,  '{"candidate_portal": false, "employer_portal": false, "mpesa": false, "whatsapp": false, "reports": true, "exports": true}', 1),
  ('pro',        'Pro',        1500000, 10,   3000, '{"candidate_portal": true,  "employer_portal": true,  "mpesa": true,  "whatsapp": false, "reports": true, "exports": true}', 2),
  ('enterprise', 'Enterprise', 4000000, NULL, NULL, '{"candidate_portal": true,  "employer_portal": true,  "mpesa": true,  "whatsapp": true,  "reports": true, "exports": true}', 3);

CREATE TABLE subscriptions (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code          text NOT NULL REFERENCES plans(code),
  status             text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at      timestamptz,
  current_period_end timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency     text NOT NULL DEFAULT 'KES',
  method       text NOT NULL CHECK (method IN ('mpesa', 'card', 'bank', 'cash', 'complimentary')),
  reference    text NOT NULL DEFAULT '',
  months       int NOT NULL CHECK (months > 0),
  plan_code    text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  recorded_by  text NOT NULL DEFAULT 'system',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscription_payments_ref ON subscription_payments (tenant_id, method, reference) WHERE reference <> '';

-- Platform administrators are not part of any agency, so this table is reachable only through the functions below.
CREATE TABLE platform_admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  totp_secret    text,
  totp_enabled   boolean NOT NULL DEFAULT false,
  recovery_codes jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_email ON platform_admins (lower(email));
REVOKE ALL ON platform_admins FROM PUBLIC, recruit_app;

ALTER TABLE mpesa_requests ADD COLUMN meta jsonb NOT NULL DEFAULT '{}';

-- Every agency that already exists gets a subscription, so nothing locks out on upgrade.
INSERT INTO subscriptions (tenant_id, plan_code, status, current_period_end)
  SELECT id, 'pro', 'active', now() + interval '1 year' FROM tenants;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions FOR SELECT USING (tenant_id = app_tenant());
CREATE POLICY portal_scope ON subscriptions AS RESTRICTIVE FOR ALL USING (app_candidate() IS NULL AND app_employer() IS NULL);
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_payments FOR SELECT USING (tenant_id = app_tenant());
CREATE POLICY portal_scope ON subscription_payments AS RESTRICTIVE FOR ALL USING (app_candidate() IS NULL AND app_employer() IS NULL);
GRANT SELECT ON plans, subscriptions, subscription_payments TO recruit_app;
GRANT INSERT ON mpesa_requests TO recruit_app;

-- ---------------------------------------------------------------- helpers for the functions below
CREATE FUNCTION platform_note(p_tenant uuid, p_actor text, p_action text, p_detail jsonb DEFAULT '{}')
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO audit_log (tenant_id, action, entity, detail) VALUES (p_tenant, p_action, 'platform', p_detail || jsonb_build_object('by', p_actor)) $$;
REVOKE ALL ON FUNCTION platform_note(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_note(uuid, text, text, jsonb) TO recruit_app;

-- ---------------------------------------------------------------- signup
CREATE FUNCTION platform_create_tenant(
  p_name text, p_slug text, p_admin_name text, p_email text, p_password_hash text,
  p_plan text, p_trial_days int, p_stages jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid; s jsonb; i int := 0;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN RAISE EXCEPTION 'bad_slug'; END IF;
  IF p_slug = ANY (ARRAY['www', 'app', 'api', 'admin', 'platform', 'login', 'signup', 'staff', 'employer', 'account', 'files', 'export', 'c', 'static', 'mail', 'help', 'support', 'billing', 'status']) THEN
    RAISE EXCEPTION 'reserved_slug';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug) THEN RAISE EXCEPTION 'slug_taken'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(p_email)) THEN RAISE EXCEPTION 'email_taken'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE code = p_plan AND active) THEN RAISE EXCEPTION 'bad_plan'; END IF;

  INSERT INTO tenants (name, slug, plan) VALUES (p_name, p_slug, p_plan) RETURNING id INTO t;
  INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (t, p_admin_name, p_email, p_password_hash, 'admin');
  FOR s IN SELECT * FROM jsonb_array_elements(p_stages) LOOP
    i := i + 1;
    INSERT INTO pipeline_stages (tenant_id, position, name, description, required_doc_types, requires_payment, requires_job_order,
      requires_vetted_employer, marks_deployed, requires_contract, requires_visa, requires_orientation, requires_arrival)
    VALUES (t, i, s->>'name', COALESCE(s->>'description', ''),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'requiredDocTypes')), '{}'),
      COALESCE((s->>'requiresPayment')::boolean, false), COALESCE((s->>'requiresJobOrder')::boolean, false),
      COALESCE((s->>'requiresVettedEmployer')::boolean, false), COALESCE((s->>'marksDeployed')::boolean, false),
      COALESCE((s->>'requiresContract')::boolean, false), COALESCE((s->>'requiresVisa')::boolean, false),
      COALESCE((s->>'requiresOrientation')::boolean, false), COALESCE((s->>'requiresArrival')::boolean, false));
  END LOOP;
  INSERT INTO subscriptions (tenant_id, plan_code, status, trial_ends_at, current_period_end)
    VALUES (t, p_plan, 'trialing', now() + p_trial_days * interval '1 day', now() + p_trial_days * interval '1 day');
  INSERT INTO audit_log (tenant_id, action, entity, entity_id, detail) VALUES (t, 'tenant.signup', 'tenant', t, jsonb_build_object('plan', p_plan));
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION platform_create_tenant(text, text, text, text, text, text, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_create_tenant(text, text, text, text, text, text, int, jsonb) TO recruit_app;

CREATE FUNCTION platform_slug_free(p_slug text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT NOT EXISTS (SELECT 1 FROM tenants WHERE slug = lower(p_slug)) $$;
REVOKE ALL ON FUNCTION platform_slug_free(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_slug_free(text) TO recruit_app;

-- ---------------------------------------------------------------- platform administrators
CREATE FUNCTION platform_admin_auth(p_email text)
  RETURNS TABLE (id uuid, name text, password_hash text, totp_secret text, totp_enabled boolean, recovery_codes jsonb)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.name, a.password_hash, a.totp_secret, a.totp_enabled, a.recovery_codes FROM platform_admins a WHERE lower(a.email) = lower(p_email) AND a.status = 'active' $$;

CREATE FUNCTION platform_admin_get(p_id uuid)
  RETURNS TABLE (id uuid, name text, email text, totp_enabled boolean, totp_secret text, password_hash text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.name, a.email, a.totp_enabled, a.totp_secret, a.password_hash FROM platform_admins a WHERE a.id = p_id AND a.status = 'active' $$;

CREATE FUNCTION platform_admin_set_totp(p_id uuid, p_secret text, p_enabled boolean, p_codes jsonb)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE platform_admins SET totp_secret = p_secret, totp_enabled = p_enabled, recovery_codes = p_codes WHERE id = p_id $$;

CREATE FUNCTION platform_admin_use_recovery(p_id uuid, p_codes jsonb)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE platform_admins SET recovery_codes = p_codes WHERE id = p_id $$;

CREATE FUNCTION platform_admin_set_password(p_id uuid, p_hash text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE platform_admins SET password_hash = p_hash WHERE id = p_id $$;

CREATE FUNCTION platform_admins_list()
  RETURNS TABLE (id uuid, name text, email text, totp_enabled boolean, status text, created_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.name, a.email, a.totp_enabled, a.status, a.created_at FROM platform_admins a ORDER BY a.created_at $$;

CREATE FUNCTION platform_admin_create(p_email text, p_name text, p_hash text)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO platform_admins (email, name, password_hash) VALUES (p_email, p_name, p_hash) RETURNING id $$;

CREATE FUNCTION platform_admin_set_status(p_id uuid, p_status text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE platform_admins SET status = p_status WHERE id = p_id $$;

-- ---------------------------------------------------------------- agencies
CREATE FUNCTION platform_tenants()
  RETURNS TABLE (id uuid, name text, slug text, status text, plan_code text, sub_status text, period_end timestamptz, trial_ends_at timestamptz,
                 users_count bigint, candidates_count bigint, placements_count bigint, last_activity timestamptz, created_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.name, t.slug, t.status, s.plan_code, s.status, s.current_period_end, s.trial_ends_at,
      (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.role <> 'employer' AND u.status = 'active'),
      (SELECT count(*) FROM candidates c WHERE c.tenant_id = t.id AND c.status <> 'inactive'),
      (SELECT count(*) FROM placements p WHERE p.tenant_id = t.id),
      (SELECT max(a.created_at) FROM audit_log a WHERE a.tenant_id = t.id),
      t.created_at
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id ORDER BY t.created_at DESC
  $$;

CREATE FUNCTION platform_overview() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT jsonb_build_object(
      'tenants', (SELECT count(*) FROM tenants),
      'active', (SELECT count(*) FROM subscriptions WHERE status = 'active' AND current_period_end > now()),
      'trialing', (SELECT count(*) FROM subscriptions WHERE status = 'trialing' AND current_period_end > now()),
      'lapsed', (SELECT count(*) FROM subscriptions WHERE current_period_end <= now() OR status IN ('past_due', 'cancelled')),
      'suspended', (SELECT count(*) FROM tenants WHERE status = 'suspended'),
      'signups_30d', (SELECT count(*) FROM tenants WHERE created_at > now() - interval '30 days'),
      'mrr_minor', COALESCE((SELECT sum(p.price_kes_minor) FROM subscriptions s JOIN plans p ON p.code = s.plan_code WHERE s.status = 'active' AND s.current_period_end > now()), 0),
      'collected_30d_minor', COALESCE((SELECT sum(amount_minor) FROM subscription_payments WHERE currency = 'KES' AND created_at > now() - interval '30 days'), 0),
      'candidates', (SELECT count(*) FROM candidates WHERE status <> 'inactive'),
      'placements', (SELECT count(*) FROM placements)
    )
  $$;

CREATE FUNCTION platform_tenant_payments(p_tenant uuid)
  RETURNS SETOF subscription_payments LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT * FROM subscription_payments WHERE tenant_id = p_tenant ORDER BY created_at DESC $$;

CREATE FUNCTION platform_recent_payments()
  RETURNS TABLE (id uuid, tenant_name text, amount_minor bigint, currency text, method text, reference text, months int, plan_code text, recorded_by text, created_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT p.id, t.name, p.amount_minor, p.currency, p.method, p.reference, p.months, p.plan_code, p.recorded_by, p.created_at
        FROM subscription_payments p JOIN tenants t ON t.id = p.tenant_id ORDER BY p.created_at DESC LIMIT 100 $$;

CREATE FUNCTION platform_set_status(p_tenant uuid, p_status text, p_by text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'bad_status'; END IF;
  UPDATE tenants SET status = p_status WHERE id = p_tenant;
  PERFORM platform_note(p_tenant, p_by, 'platform.status', jsonb_build_object('status', p_status));
END $$;

CREATE FUNCTION platform_set_plan(p_tenant uuid, p_plan text, p_by text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans WHERE code = p_plan) THEN RAISE EXCEPTION 'bad_plan'; END IF;
  UPDATE subscriptions SET plan_code = p_plan WHERE tenant_id = p_tenant;
  UPDATE tenants SET plan = p_plan WHERE id = p_tenant;
  PERFORM platform_note(p_tenant, p_by, 'platform.plan', jsonb_build_object('plan', p_plan));
END $$;

-- Records a subscription payment and extends the paid period. The same function is used for card and M-Pesa
-- confirmations from the app and for payments a platform administrator enters by hand.
CREATE FUNCTION platform_record_payment(
  p_tenant uuid, p_amount bigint, p_method text, p_reference text, p_months int, p_plan text, p_by text
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s subscriptions; start_at timestamptz; end_at timestamptz;
BEGIN
  IF p_months < 1 OR p_months > 36 THEN RAISE EXCEPTION 'bad_months'; END IF;
  SELECT * INTO s FROM subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_subscription'; END IF;
  -- Paying early adds to the end of the current period; paying late starts from now.
  start_at := greatest(now(), s.current_period_end);
  end_at := start_at + p_months * interval '1 month';
  INSERT INTO subscription_payments (tenant_id, amount_minor, method, reference, months, plan_code, period_start, period_end, recorded_by)
    VALUES (p_tenant, p_amount, p_method, COALESCE(p_reference, ''), p_months, p_plan, start_at, end_at, p_by);
  UPDATE subscriptions SET plan_code = p_plan, status = 'active', current_period_end = end_at WHERE tenant_id = p_tenant;
  UPDATE tenants SET plan = p_plan WHERE id = p_tenant;
  PERFORM platform_note(p_tenant, p_by, 'platform.payment', jsonb_build_object('method', p_method, 'months', p_months, 'plan', p_plan));
  RETURN end_at;
END $$;

CREATE FUNCTION platform_extend_trial(p_tenant uuid, p_days int, p_by text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE subscriptions SET status = 'trialing', trial_ends_at = greatest(now(), current_period_end) + p_days * interval '1 day',
    current_period_end = greatest(now(), current_period_end) + p_days * interval '1 day' WHERE tenant_id = p_tenant;
  PERFORM platform_note(p_tenant, p_by, 'platform.trial_extended', jsonb_build_object('days', p_days));
END $$;

CREATE FUNCTION platform_support_user(p_tenant uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT id FROM users WHERE tenant_id = p_tenant AND role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1 $$;

CREATE FUNCTION platform_update_plan(p_code text, p_name text, p_price bigint, p_users int, p_candidates int, p_features jsonb, p_active boolean)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE plans SET name = p_name, price_kes_minor = p_price, max_users = p_users, max_candidates = p_candidates, features = p_features, active = p_active WHERE code = p_code $$;

-- Used by the worker's renewal reminders and by billing pages: who to write to at each agency.
CREATE FUNCTION platform_expiring(p_days int)
  RETURNS TABLE (tenant_id uuid, name text, plan_code text, status text, period_end timestamptz, admin_email text, admin_name text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.name, s.plan_code, s.status, s.current_period_end,
           (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' AND u.status = 'active' ORDER BY u.created_at LIMIT 1),
           (SELECT u.name FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' AND u.status = 'active' ORDER BY u.created_at LIMIT 1)
    FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
    WHERE t.status = 'active' AND s.current_period_end BETWEEN now() - interval '30 days' AND now() + p_days * interval '1 day'
  $$;

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'platform\_%' AND p.proname NOT IN ('platform_note', 'platform_create_tenant', 'platform_slug_free') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO recruit_app', f);
  END LOOP;
END $$;
