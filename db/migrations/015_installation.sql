-- A single-agency install (TENANT_MODE=single) holds one activation key, checked offline by its signature.
CREATE TABLE installation (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  customer       text NOT NULL,
  activation_key text NOT NULL,
  expires_at     timestamptz,
  max_users      int,
  updates_until  timestamptz,
  activated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON installation TO recruit_app;

-- First-run setup needs to know whether an agency exists yet, before anyone can sign in.
CREATE FUNCTION install_has_tenant() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM tenants) $$;
REVOKE ALL ON FUNCTION install_has_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION install_has_tenant() TO recruit_app;
