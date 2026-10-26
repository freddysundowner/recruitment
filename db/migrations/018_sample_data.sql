-- Sample data lets a new agency explore every screen before entering real records, and then remove it cleanly.
-- Sample candidates are marked source = 'sample'; sample employers and job orders carry is_sample.
ALTER TABLE candidates DROP CONSTRAINT candidates_source_check;
ALTER TABLE candidates ADD CONSTRAINT candidates_source_check CHECK (source IN ('staff', 'portal', 'import', 'sample'));
ALTER TABLE employers ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE job_orders ADD COLUMN is_sample boolean NOT NULL DEFAULT false;

-- Costs, payments, history and the like are append-only for the app, so removing the sample records needs this one
-- function. It acts only on rows flagged as sample, and only in the signed-in agency.
CREATE FUNCTION sample_remove() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := app_tenant();
  n_cand int; n_emp int; n_job int;
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  CREATE TEMP TABLE _sc ON COMMIT DROP AS SELECT id FROM candidates WHERE tenant_id = t AND source = 'sample';
  CREATE TEMP TABLE _sp ON COMMIT DROP AS SELECT id FROM placements WHERE tenant_id = t AND candidate_id IN (SELECT id FROM _sc);
  -- a real candidate matched to a sample job is not removed, but loses the sample job
  UPDATE placements SET job_order_id = NULL, payment_model = NULL
    WHERE tenant_id = t AND candidate_id NOT IN (SELECT id FROM _sc)
      AND job_order_id IN (SELECT id FROM job_orders WHERE tenant_id = t AND is_sample);
  DELETE FROM audit_log WHERE tenant_id = t AND entity_id IN (SELECT id FROM _sc UNION SELECT id FROM _sp);
  DELETE FROM payments WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM invoices WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM costs WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM mpesa_requests WHERE tenant_id = t AND candidate_id IN (SELECT id FROM _sc);
  DELETE FROM contracts WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM messages WHERE tenant_id = t AND candidate_id IN (SELECT id FROM _sc);
  DELETE FROM complaints WHERE tenant_id = t AND candidate_id IN (SELECT id FROM _sc);
  DELETE FROM applications WHERE tenant_id = t AND candidate_id IN (SELECT id FROM _sc);
  DELETE FROM employer_decisions WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM stage_history WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM fee_charges WHERE tenant_id = t AND placement_id IN (SELECT id FROM _sp);
  DELETE FROM placements WHERE tenant_id = t AND id IN (SELECT id FROM _sp);
  DELETE FROM documents WHERE tenant_id = t AND candidate_id IN (SELECT id FROM _sc);
  DELETE FROM candidates WHERE tenant_id = t AND id IN (SELECT id FROM _sc);
  GET DIAGNOSTICS n_cand = ROW_COUNT;
  DELETE FROM applications WHERE tenant_id = t AND job_order_id IN (SELECT id FROM job_orders WHERE tenant_id = t AND is_sample);
  DELETE FROM job_orders WHERE tenant_id = t AND is_sample;
  GET DIAGNOSTICS n_job = ROW_COUNT;
  DELETE FROM employer_checks WHERE tenant_id = t AND employer_id IN (SELECT id FROM employers WHERE tenant_id = t AND is_sample);
  DELETE FROM users WHERE tenant_id = t AND employer_id IN (SELECT id FROM employers WHERE tenant_id = t AND is_sample);
  DELETE FROM employers WHERE tenant_id = t AND is_sample;
  GET DIAGNOSTICS n_emp = ROW_COUNT;
  INSERT INTO audit_log (tenant_id, action, entity, detail) VALUES (t, 'sample.remove', 'tenant', jsonb_build_object('candidates', n_cand, 'employers', n_emp, 'jobs', n_job));
  RETURN jsonb_build_object('candidates', n_cand, 'employers', n_emp, 'jobs', n_job);
END $$;
REVOKE ALL ON FUNCTION sample_remove() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sample_remove() TO recruit_app;
