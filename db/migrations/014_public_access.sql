-- The public candidate pages should also respect the agency's plan and whether its subscription is current.
DROP FUNCTION tenant_public(text);
CREATE FUNCTION tenant_public(p_slug text)
  RETURNS TABLE (id uuid, name text, brand_name text, brand_color text, portal_open boolean)
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.name, t.settings->>'brand_name', t.settings->>'brand_color',
           COALESCE((t.settings->>'candidate_portal')::boolean, true)
             AND COALESCE((p.features->>'candidate_portal')::boolean, true)
             AND (s.current_period_end IS NULL OR s.current_period_end + interval '7 days' > now())
             AND COALESCE(s.status, 'active') <> 'cancelled'
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN plans p ON p.code = s.plan_code
    WHERE t.slug = lower(p_slug) AND t.status = 'active'
  $$;
REVOKE ALL ON FUNCTION tenant_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_public(text) TO recruit_app;

-- The subdomain a visitor arrived on, mapped to an agency, for addresses like acme.yourapp.co.ke.
CREATE FUNCTION tenant_slug_exists(p_slug text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = lower(p_slug) AND status = 'active') $$;
REVOKE ALL ON FUNCTION tenant_slug_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_slug_exists(text) TO recruit_app;
