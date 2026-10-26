-- M-Pesa STK push requests (Safaricom Daraja). Each request carries a secret callback token,
-- so only Safaricom (who is given the URL) can report a result for it.
CREATE TABLE mpesa_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purpose             text NOT NULL DEFAULT 'candidate_fee' CHECK (purpose IN ('candidate_fee', 'subscription')),
  placement_id        uuid REFERENCES placements(id) ON DELETE SET NULL,
  candidate_id        uuid REFERENCES candidates(id) ON DELETE SET NULL,
  phone               text NOT NULL,
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  account_ref         text NOT NULL,
  merchant_request_id text,
  checkout_request_id text,
  token_hash          text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  result_code         int,
  result_desc         text,
  mpesa_receipt       text,
  payment_id          uuid REFERENCES payments(id),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE UNIQUE INDEX mpesa_receipt_key ON mpesa_requests (tenant_id, mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;
CREATE INDEX mpesa_pending_idx ON mpesa_requests (created_at) WHERE status = 'pending';

ALTER TABLE mpesa_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mpesa_requests USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON mpesa_requests TO recruit_app;

-- Safaricom calls us without a session, so the agency is found from the secret in the callback URL.
CREATE FUNCTION mpesa_lookup(p_token_hash text)
  RETURNS TABLE (id uuid, tenant_id uuid)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT r.id, r.tenant_id FROM mpesa_requests r WHERE r.token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION mpesa_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mpesa_lookup(text) TO recruit_app;
