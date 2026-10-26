-- Platform settings (managed from the platform console), SMS credits, and agencies' own sender IDs.

-- ---------------------------------------------------------------- platform settings
-- Secrets inside are encrypted by the application. The agencies' database role cannot read the table;
-- it goes through the two functions below, which only server code calls.
CREATE TABLE platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
REVOKE ALL ON platform_settings FROM PUBLIC, recruit_app;

CREATE FUNCTION platform_settings_all() RETURNS TABLE (key text, value jsonb)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT s.key, s.value FROM platform_settings s $$;
REVOKE ALL ON FUNCTION platform_settings_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_settings_all() TO recruit_app;

CREATE FUNCTION platform_setting_save(p_key text, p_value jsonb, p_by text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ INSERT INTO platform_settings (key, value, updated_by) VALUES (p_key, p_value, p_by)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by $$;
REVOKE ALL ON FUNCTION platform_setting_save(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_setting_save(text, jsonb, text) TO recruit_app;

-- ---------------------------------------------------------------- SMS credits
ALTER TABLE tenants ADD COLUMN sms_credits int NOT NULL DEFAULT 0 CHECK (sms_credits >= 0);

CREATE TABLE sms_credit_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delta         int NOT NULL,
  balance_after int NOT NULL,
  reason        text NOT NULL CHECK (reason IN ('signup_grant', 'purchase', 'sms_sent', 'refund', 'admin')),
  ref           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- A purchase or the signup gift can only be credited once.
CREATE UNIQUE INDEX sms_credit_once ON sms_credit_ledger (tenant_id, reason, ref) WHERE reason IN ('signup_grant', 'purchase') AND ref IS NOT NULL;
CREATE INDEX sms_credit_ledger_tenant ON sms_credit_ledger (tenant_id, created_at DESC);
ALTER TABLE sms_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sms_credit_ledger FOR SELECT USING (tenant_id = app_tenant());
CREATE POLICY portal_scope ON sms_credit_ledger AS RESTRICTIVE FOR ALL USING (app_candidate() IS NULL AND app_employer() IS NULL);
GRANT SELECT ON sms_credit_ledger TO recruit_app;

-- Adding and spending go through these so the balance and the ledger always agree.
CREATE FUNCTION sms_credits_add(p_tenant uuid, p_n int, p_reason text, p_ref text) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b int;
BEGIN
  IF p_n <= 0 THEN RAISE EXCEPTION 'bad_amount'; END IF;
  IF p_reason IN ('signup_grant', 'purchase') AND p_ref IS NOT NULL
     AND EXISTS (SELECT 1 FROM sms_credit_ledger WHERE tenant_id = p_tenant AND reason = p_reason AND ref = p_ref) THEN
    SELECT sms_credits INTO b FROM tenants WHERE id = p_tenant;
    RETURN b;
  END IF;
  UPDATE tenants SET sms_credits = sms_credits + p_n WHERE id = p_tenant RETURNING sms_credits INTO b;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_such_tenant'; END IF;
  INSERT INTO sms_credit_ledger (tenant_id, delta, balance_after, reason, ref) VALUES (p_tenant, p_n, b, p_reason, p_ref);
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION sms_credits_add(uuid, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sms_credits_add(uuid, int, text, text) TO recruit_app;

CREATE FUNCTION sms_credits_spend(p_tenant uuid, p_n int, p_ref text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b int;
BEGIN
  UPDATE tenants SET sms_credits = sms_credits - p_n WHERE id = p_tenant AND sms_credits >= p_n RETURNING sms_credits INTO b;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO sms_credit_ledger (tenant_id, delta, balance_after, reason, ref) VALUES (p_tenant, -p_n, b, 'sms_sent', p_ref);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION sms_credits_spend(uuid, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sms_credits_spend(uuid, int, text) TO recruit_app;

-- Every agency that exists today gets the starting 20 credits.
DO $$ DECLARE t record;
BEGIN FOR t IN SELECT id FROM tenants LOOP PERFORM sms_credits_add(t.id, 20, 'signup_grant', 'initial'); END LOOP; END $$;

ALTER TABLE messages ADD COLUMN credits int NOT NULL DEFAULT 0;

-- Buying credits is paid by M-Pesa, like a subscription.
ALTER TABLE mpesa_requests DROP CONSTRAINT mpesa_requests_purpose_check;
ALTER TABLE mpesa_requests ADD CONSTRAINT mpesa_requests_purpose_check CHECK (purpose IN ('candidate_fee', 'subscription', 'sms_credits'));

-- ---------------------------------------------------------------- agencies' own sender IDs
-- An SMS sender name has to be registered with the SMS provider, and an email sender verified with the email
-- provider, so a new one waits for the platform owner to approve it. Until then the platform's own is used.
CREATE TABLE tenant_senders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('sms', 'email')),
  value        text NOT NULL,
  display_name text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);
ALTER TABLE tenant_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_senders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_senders USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY portal_scope ON tenant_senders AS RESTRICTIVE FOR ALL USING (app_candidate() IS NULL AND app_employer() IS NULL);
-- Agencies can add and remove, but never touch the status: replacing a sender means a new request.
GRANT SELECT, DELETE ON tenant_senders TO recruit_app;
GRANT INSERT (tenant_id, kind, value, display_name) ON tenant_senders TO recruit_app;

CREATE FUNCTION platform_senders_list() RETURNS TABLE (id uuid, tenant_id uuid, tenant_name text, kind text, value text, display_name text, status text, note text, created_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT s.id, s.tenant_id, t.name, s.kind, s.value, s.display_name, s.status, s.note, s.created_at
        FROM tenant_senders s JOIN tenants t ON t.id = s.tenant_id ORDER BY (s.status = 'pending') DESC, s.created_at DESC $$;
REVOKE ALL ON FUNCTION platform_senders_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_senders_list() TO recruit_app;

CREATE FUNCTION platform_sender_review(p_id uuid, p_status text, p_note text, p_by text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  IF p_status NOT IN ('approved', 'rejected', 'pending') THEN RAISE EXCEPTION 'bad_status'; END IF;
  UPDATE tenant_senders SET status = p_status, note = p_note WHERE id = p_id RETURNING * INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM platform_note(s.tenant_id, p_by, 'sender.' || p_status, jsonb_build_object('kind', s.kind, 'value', s.value));
END $$;
REVOKE ALL ON FUNCTION platform_sender_review(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_sender_review(uuid, text, text, text) TO recruit_app;

CREATE FUNCTION platform_credits_grant(p_tenant uuid, p_n int, p_by text) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b int;
BEGIN
  b := sms_credits_add(p_tenant, p_n, 'admin', NULL);
  PERFORM platform_note(p_tenant, p_by, 'credits.grant', jsonb_build_object('credits', p_n));
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION platform_credits_grant(uuid, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_credits_grant(uuid, int, text) TO recruit_app;
