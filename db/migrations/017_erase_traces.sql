-- Messages and the audit trail are append-only for the app, which is right for everything except honouring a
-- person's request to delete their personal data. This one function is the only way around that, and it can
-- only act on the signed-in agency's own rows: it removes a candidate's messages and strips their name from
-- audit entries, keeping the fact that something happened but not who it was about.
CREATE FUNCTION erase_candidate_traces(p_candidate uuid) RETURNS int
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    WITH m AS (DELETE FROM messages WHERE candidate_id = p_candidate AND tenant_id = app_tenant() RETURNING 1),
         a AS (UPDATE audit_log SET detail = detail - 'name' - 'phone' - 'email'
               WHERE tenant_id = app_tenant() AND entity = 'candidate' AND entity_id = p_candidate AND detail ?| ARRAY['name', 'phone', 'email'] RETURNING 1)
    SELECT (SELECT count(*) FROM m)::int + (SELECT count(*) FROM a)::int
  $$;
REVOKE ALL ON FUNCTION erase_candidate_traces(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_candidate_traces(uuid) TO recruit_app;
