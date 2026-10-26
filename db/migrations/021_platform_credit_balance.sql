CREATE FUNCTION platform_credits_balance(p_tenant uuid) RETURNS int
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT sms_credits FROM tenants WHERE id = p_tenant $$;
REVOKE ALL ON FUNCTION platform_credits_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_credits_balance(uuid) TO recruit_app;
