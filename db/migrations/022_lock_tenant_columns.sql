-- An agency's own database role may only change its settings. Its plan, status and SMS credits can only change
-- through the platform functions, so no bug on the agency side can hand out credits or a better plan.
REVOKE UPDATE ON tenants FROM recruit_app;
GRANT UPDATE (settings) ON tenants TO recruit_app;
