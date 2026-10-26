#!/bin/sh
# Creates the runtime role the app connects as. It is not a superuser and does not own the tables,
# so row-level security always applies to it. Runs once, when the database volume is first created.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE recruit_app LOGIN PASSWORD '${APP_DB_PASSWORD:-recruit_app_dev}' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO recruit_app;
SQL
