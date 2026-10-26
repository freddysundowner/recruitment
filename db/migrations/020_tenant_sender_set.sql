-- Asking for a sender ID. A shared-service agency's request waits for approval; an agency running its own copy
-- uses its own provider accounts, so there is nobody to ask and it is approved at once.
CREATE FUNCTION tenant_sender_set(p_tenant uuid, p_kind text, p_value text, p_display text, p_auto boolean) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i uuid;
BEGIN
  IF p_kind NOT IN ('sms', 'email') THEN RAISE EXCEPTION 'bad_kind'; END IF;
  DELETE FROM tenant_senders WHERE tenant_id = p_tenant AND kind = p_kind;
  INSERT INTO tenant_senders (tenant_id, kind, value, display_name, status)
    VALUES (p_tenant, p_kind, p_value, NULLIF(p_display, ''), CASE WHEN p_auto THEN 'approved' ELSE 'pending' END) RETURNING id INTO i;
  RETURN i;
END $$;
REVOKE ALL ON FUNCTION tenant_sender_set(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_sender_set(uuid, text, text, text, boolean) TO recruit_app;
