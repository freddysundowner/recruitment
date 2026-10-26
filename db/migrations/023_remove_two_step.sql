-- Two-step sign-in is gone. Remove everything it stored, and the database functions that mentioned it.

-- Agency users
DROP FUNCTION auth_lookup_user(text);
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
ALTER TABLE users DROP COLUMN totp_secret, DROP COLUMN totp_enabled, DROP COLUMN recovery_codes;
UPDATE tenants SET settings = settings - 'require_2fa' WHERE settings ? 'require_2fa';

-- Platform administrators
DROP FUNCTION platform_admin_auth(text);
DROP FUNCTION platform_admin_get(uuid);
DROP FUNCTION platform_admin_set_totp(uuid, text, boolean, jsonb);
DROP FUNCTION platform_admin_use_recovery(uuid, jsonb);
DROP FUNCTION platform_admins_list();

CREATE FUNCTION platform_admin_auth(p_email text)
  RETURNS TABLE (id uuid, name text, password_hash text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.name, a.password_hash FROM platform_admins a WHERE lower(a.email) = lower(p_email) AND a.status = 'active' $$;
CREATE FUNCTION platform_admin_get(p_id uuid)
  RETURNS TABLE (id uuid, name text, email text, password_hash text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.name, a.email, a.password_hash FROM platform_admins a WHERE a.id = p_id AND a.status = 'active' $$;
CREATE FUNCTION platform_admins_list()
  RETURNS TABLE (id uuid, name text, email text, status text, created_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.id, a.name, a.email, a.status, a.created_at FROM platform_admins a ORDER BY a.created_at $$;
REVOKE ALL ON FUNCTION platform_admin_auth(text), platform_admin_get(uuid), platform_admins_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_auth(text), platform_admin_get(uuid), platform_admins_list() TO recruit_app;
ALTER TABLE platform_admins DROP COLUMN totp_secret, DROP COLUMN totp_enabled, DROP COLUMN recovery_codes;
