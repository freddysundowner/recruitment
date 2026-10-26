#!/usr/bin/env bash
# Shared by install-saas.sh and install-standalone.sh. It is sourced, never run on its own.
#
# What an install does, in order:
#   1. checks the server (root, system, memory, disk, free port) and asks the few questions it needs
#   2. gives this system its OWN Node.js, so other systems on the server keep their own
#   3. uses the server's PostgreSQL if there is one (installs it only if there is none) and creates the
#      database and its two users only if they are missing
#   4. copies the code, installs packages, builds, and creates the tables
#   5. runs the website and the background worker as services that restart by themselves
#   6. sets up nginx for the domain only if no server block for that name exists yet
#   7. gets an SSL certificate only if the domain has none
#   8. schedules daily backups, and checks the site answers
# Running an installer again is safe: it keeps your secrets, database and files, and only fills in what is missing.

set -Eeuo pipefail
trap 'printf "\n\033[31mStopped on line %s of the installer.\033[0m See %s for details.\n" "$LINENO" "${LOG_FILE:-the log}" >&2' ERR

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
RECRUIT_ROOT="${RECRUIT_ROOT:-/opt/recruit}"
SERVICE_USER="${SERVICE_USER:-recruit}"
DEFAULT_DOMAIN="recruit.reggycodas.com"
NODE_MAJOR="$(tr -d '[:space:]' < "$DEPLOY_DIR/node-version" 2>/dev/null || echo 24)"

# ---------------------------------------------------------------- output
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; D=""; N=""; fi
STEP_N=0
step() { STEP_N=$((STEP_N + 1)); printf '\n%s%s. %s%s\n' "$B" "$STEP_N" "$*" "$N"; }
say()  { printf '   %s\n' "$*"; }
ok()   { printf '   %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '   %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '\n%sProblem:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- questions
ASSUME_YES="${ASSUME_YES:-}"
LOG_FILE="${LOG_FILE:-/var/log/recruit-install.log}"
# ask VAR "Question" [default]  - keeps a value already given as a flag or in the environment
ask() {
  local var="$1" prompt="$2" def="${3:-}" cur="${!1:-}" ans
  if [ -n "$cur" ]; then return 0; fi
  if [ -n "$ASSUME_YES" ] || [ ! -t 0 ]; then
    [ -n "$def" ] || die "$prompt  (give it with a flag or in the environment: it has no default)"
    printf -v "$var" '%s' "$def"; return 0
  fi
  read -r -p "   $prompt${def:+ [$def]}: " ans || true
  printf -v "$var" '%s' "${ans:-$def}"
  [ -n "${!var}" ] || die "$prompt is needed."
}
ask_optional() { # like ask, but an empty answer is fine
  local var="$1" prompt="$2" cur="${!1:-}" ans
  if [ -n "$cur" ] || [ -n "$ASSUME_YES" ] || [ ! -t 0 ]; then printf -v "$var" '%s' "$cur"; return 0; fi
  read -r -p "   $prompt (press Enter to skip): " ans || true
  printf -v "$var" '%s' "$ans"
}
ask_secret() { # ask_secret VAR "Question" minlen
  local var="$1" prompt="$2" min="${3:-1}" a b
  if [ -n "${!var:-}" ]; then return 0; fi
  if [ -n "$ASSUME_YES" ] || [ ! -t 0 ]; then die "$prompt  (give it in the environment as $var)"; fi
  while :; do
    read -r -s -p "   $prompt: " a; echo
    [ "${#a}" -ge "$min" ] || { warn "Use at least $min characters."; continue; }
    read -r -s -p "   Type it again: " b; echo
    [ "$a" = "$b" ] && break || warn "They did not match."
  done
  printf -v "$var" '%s' "$a"
}
confirm() { # confirm "Question" default(y|n)
  local def="${2:-n}" ans
  if [ -n "$ASSUME_YES" ] || [ ! -t 0 ]; then [ "$def" = y ]; return; fi
  read -r -p "   $1 [$([ "$def" = y ] && echo Y/n || echo y/N)]: " ans || true
  ans="${ans:-$def}"; [[ "$ans" =~ ^[Yy] ]]
}

# ---------------------------------------------------------------- common flags
DOMAIN="${DOMAIN:-}"; EMAIL="${EMAIL:-}"; PORT="${PORT:-}"; DB_NAME="${DB_NAME:-}"
SKIP_SSL="${SKIP_SSL:-}"; SKIP_NGINX="${SKIP_NGINX:-}"; SKIP_BUILD="${SKIP_BUILD:-}"
parse_common_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--yes) ASSUME_YES=1 ;;
      --domain) DOMAIN="$2"; shift ;;
      --email) EMAIL="$2"; shift ;;
      --port) PORT="$2"; shift ;;
      --db-name) DB_NAME="$2"; shift ;;
      --root) RECRUIT_ROOT="$2"; shift ;;
      --skip-ssl) SKIP_SSL=1 ;;
      --skip-nginx) SKIP_NGINX=1 ;;
      --license-public-key) LICENSE_PUBLIC_KEY="$2"; shift ;;
      --admin-email) PLATFORM_ADMIN_EMAIL="$2"; shift ;;
      --admin-name) PLATFORM_ADMIN_NAME="$2"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
    shift
  done
}

# ---------------------------------------------------------------- small helpers
as_service() { runuser -u "$SERVICE_USER" -- "$@"; }
have() { command -v "$1" >/dev/null 2>&1; }
rand_hex() { openssl rand -hex "${1:-32}"; }
env_get() { [ -r "$2" ] && grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
env_quote() { local v="$1"; v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; v="${v//\$/\\\$}"; v="${v//\`/\\\`}"; printf '"%s"' "$v"; }
HAS_SYSTEMD=""; [ -d /run/systemd/system ] && HAS_SYSTEMD=1
APT_UPDATED=""
apt_install() {
  have apt-get || die "This installer installs missing packages with apt (Ubuntu or Debian). Install these yourself, then run it again: $*"
  if [ -z "$APT_UPDATED" ]; then DEBIAN_FRONTEND=noninteractive apt-get update -y >>"$LOG_FILE" 2>&1; APT_UPDATED=1; fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" >>"$LOG_FILE" 2>&1
}
svc() { # svc action name   (works with or without systemd, so it can be tested in a container)
  if [ -n "$HAS_SYSTEMD" ]; then systemctl "$1" "$2" >>"$LOG_FILE" 2>&1; else
    case "$2" in
      postgresql) service postgresql "$1" >>"$LOG_FILE" 2>&1 || true ;;
      nginx) if [ "$1" = reload ]; then nginx -s reload 2>>"$LOG_FILE" || nginx 2>>"$LOG_FILE" || true; elif [ "$1" = start ]; then nginx 2>>"$LOG_FILE" || true; fi ;;
      *) true ;;
    esac
  fi
}

# ---------------------------------------------------------------- 1. the server
preflight() {
  step "Checking this server"
  [ "$(id -u)" -eq 0 ] || die "Run this as root: sudo ./$(basename "$0")"
  [ -f "$SRC_DIR/package.json" ] && [ -d "$SRC_DIR/db/migrations" ] || die "Run this from the system's folder (the one that holds package.json and db/)."
  mkdir -p "$(dirname "$LOG_FILE")"; : > "$LOG_FILE"; chmod 600 "$LOG_FILE"
  local os="unknown"; [ -r /etc/os-release ] && os="$(. /etc/os-release; echo "${PRETTY_NAME:-$ID}")"
  ok "System: $os, $(uname -m)"
  have apt-get || warn "This is not Ubuntu or Debian. Missing packages cannot be installed for you, so the installer will stop and tell you what to add."
  [ -n "$HAS_SYSTEMD" ] && ok "systemd is available" || warn "systemd is not running here (a container?). Services will be written but not started."

  local ram_mb disk_mb
  ram_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
  disk_mb="$(df -Pm "$(dirname "$RECRUIT_ROOT")" | awk 'NR==2 {print $4}')"
  [ "$disk_mb" -ge 3000 ] || die "Only ${disk_mb} MB of disk is free. Building the system needs about 3 GB."
  ok "${ram_mb} MB of memory, $((disk_mb / 1024)) GB of disk free"
  ensure_swap "$ram_mb"

  local missing=()
  for t in curl tar xz openssl; do have "$t" || missing+=("$t"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    say "Installing small tools that are missing: ${missing[*]}"
    local pk=(); for t in "${missing[@]}"; do case "$t" in xz) pk+=(xz-utils) ;; *) pk+=("$t") ;; esac; done
    apt_install ca-certificates "${pk[@]}"
  fi
  have runuser || die "The 'runuser' command is missing (it comes with util-linux)."
}

ensure_swap() { # building needs memory; on a small server without swap, add a temporary 2 GB swap file
  local ram_mb="$1"
  [ "$ram_mb" -lt 2000 ] || return 0
  [ "$(awk 'NR>1' /proc/swaps | wc -l)" -eq 0 ] || return 0
  [ -z "$HAS_SYSTEMD" ] && return 0
  warn "Little memory and no swap: the build could run out of memory."
  if confirm "Add a 2 GB swap file at /swapfile-recruit to make the build safe?" y; then
    fallocate -l 2G /swapfile-recruit 2>/dev/null || dd if=/dev/zero of=/swapfile-recruit bs=1M count=2048 status=none
    chmod 600 /swapfile-recruit; mkswap /swapfile-recruit >/dev/null; swapon /swapfile-recruit
    grep -q swapfile-recruit /etc/fstab || echo "/swapfile-recruit none swap sw 0 0" >> /etc/fstab
    ok "Swap added"
  fi
}

port_in_use() { # is something already listening on this port?
  if have ss; then ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
pick_port() {
  local existing; existing="$(env_get PORT "$ENV_FILE")"
  if [ -n "$existing" ] && [ -z "$PORT" ]; then PORT="$existing"; ok "Keeping this install's port: $PORT"; return; fi
  if [ -n "$PORT" ]; then port_in_use "$PORT" && ! [ "$PORT" = "$existing" ] && die "Port $PORT is already used by something else."; return; fi
  local p=3100; while port_in_use "$p"; do p=$((p + 1)); done
  PORT="$p"; ok "The website will listen privately on 127.0.0.1:$PORT (other systems on this server are not touched)"
}

questions_common() {
  step "A few questions"
  ask DOMAIN "Domain or sub-domain for this system" "$DEFAULT_DOMAIN"
  DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##')"
  [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "'$DOMAIN' does not look like a domain name."
  INSTANCE="${DOMAIN//./-}"
  INSTANCE_DIR="$RECRUIT_ROOT/$INSTANCE"; APP_DIR="$INSTANCE_DIR/app"; STORAGE_DIR="$INSTANCE_DIR/storage"
  ENV_FILE="/etc/recruit/$INSTANCE.env"
  LOG_FILE="/var/log/recruit-install-$INSTANCE.log"; mkdir -p /var/log; : >> "$LOG_FILE"
  local root_domain; root_domain="$(printf '%s' "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')"
  if [ -z "$SKIP_SSL" ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then ask EMAIL "Email for SSL certificate notices" "admin@$root_domain"; fi
  [ -n "$DB_NAME" ] || DB_NAME="$(env_get DB_NAME "$ENV_FILE")"
  # Each install needs its own database. If another install here already uses "recruit", suggest a name of its own.
  local def_db="recruit" other_uses
  other_uses="$(grep -lE '^DB_NAME=recruit$' /etc/recruit/*.env 2>/dev/null | grep -v "^$ENV_FILE$" | head -1 || true)"
  [ -z "$other_uses" ] || def_db="recruit_$(printf '%s' "${DOMAIN//./_}" | tr -c 'a-z0-9_\n' '_' | cut -c1-30)"
  ask DB_NAME "Database name" "$def_db"
  [[ "$DB_NAME" =~ ^[a-z][a-z0-9_]{0,40}$ ]] || die "The database name can use lowercase letters, numbers and underscores."
  pick_port
}

# ---------------------------------------------------------------- 2. Node.js, private to this system
install_node() {
  step "Node.js (a private copy, so other systems on this server are not affected)"
  NODE_BIN="$(bash "$DEPLOY_DIR/ensure-node.sh" "$NODE_MAJOR" 2>>"$LOG_FILE" | tail -1)"
  [ -x "$NODE_BIN/node" ] || die "Could not install Node.js. See $LOG_FILE."
  ok "Using $("$NODE_BIN/node" -v) at $NODE_BIN"
  if have node; then say "${D}The server's own Node ($(node -v 2>/dev/null)) is left exactly as it is.${N}"; fi
}

# ---------------------------------------------------------------- 3. PostgreSQL
PG_PORT=""; PG_HOST="127.0.0.1"
pg_admin() { # run SQL as the database administrator
  if [ -n "${PG_ADMIN_URL:-}" ]; then psql -X -v ON_ERROR_STOP=1 "$PG_ADMIN_URL" "$@"
  else runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -p "${PG_PORT:-5432}" "$@"; fi
}
install_database() {
  step "PostgreSQL"
  if [ -n "${PG_ADMIN_URL:-}" ]; then
    ok "Using the database server you gave (PG_ADMIN_URL)"
    PG_HOST="$(printf '%s' "$PG_ADMIN_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/]+).*#\2#')"; PG_PORT="$(printf '%s' "$PG_ADMIN_URL" | sed -nE 's#^[a-z]+://([^@]*@)?[^:/]+:([0-9]+).*#\2#p')"; PG_PORT="${PG_PORT:-5432}"
  else
    if have psql && { have pg_lsclusters || have postgres || [ -d /var/lib/postgresql ] || ls /usr/lib/postgresql >/dev/null 2>&1; }; then
      ok "PostgreSQL is already installed, so it is not installed again"
    else
      say "PostgreSQL is not installed here."
      confirm "Install PostgreSQL now?" y || die "A PostgreSQL server is needed. Install it, or give PG_ADMIN_URL for a server you already have."
      apt_install postgresql postgresql-client
      ok "PostgreSQL installed"
    fi
    start_postgres
    PG_PORT="$(pg_admin -tAc 'show port' 2>/dev/null || true)"
    [ -n "$PG_PORT" ] || die "Could not talk to PostgreSQL as its administrator (the 'postgres' account). If it needs a password or runs elsewhere, give PG_ADMIN_URL."
  fi
  local v; v="$(pg_admin -tAc 'show server_version_num')"
  [ "$v" -ge 120000 ] || die "PostgreSQL 12 or newer is needed (this is $(pg_admin -tAc 'show server_version')). The system is tested on 12 and newer."
  ok "PostgreSQL $(pg_admin -tAc 'show server_version') on port $PG_PORT"
}
pg_admin_in_db() { # pg_admin_in_db DATABASE args...  (as the administrator, inside one database)
  local db="$1"; shift
  if [ -n "${PG_ADMIN_URL:-}" ]; then psql -X -v ON_ERROR_STOP=1 "$(printf '%s' "$PG_ADMIN_URL" | sed -E "s#^([a-z]+://[^/?]+)(/[^?]*)?#\1/$db#")" "$@"
  else runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -p "${PG_PORT:-5432}" -d "$db" "$@"; fi
}
start_postgres() {
  pg_admin -tAc 'select 1' >/dev/null 2>&1 && return 0
  say "Starting PostgreSQL ..."
  if [ -n "$HAS_SYSTEMD" ]; then systemctl enable --now postgresql >>"$LOG_FILE" 2>&1 || true; else
    service postgresql start >>"$LOG_FILE" 2>&1 || { have pg_lsclusters && pg_lsclusters -h | awk '{print $1, $2}' | while read -r v n; do pg_ctlcluster "$v" "$n" start >>"$LOG_FILE" 2>&1 || true; done; }
  fi
  local i; for i in $(seq 1 20); do pg_admin -tAc 'select 1' >/dev/null 2>&1 && return 0; sleep 1; done
}

# Creates the two users and the database only if they are missing. Existing ones are left as they are.
provision_database() {
  step "Database and users"
  ADMIN_DB_PASSWORD="$(env_get ADMIN_DB_PASSWORD "$ENV_FILE")"; APP_DB_PASSWORD="$(env_get APP_DB_PASSWORD "$ENV_FILE")"
  local admin_exists app_exists db_exists reset=""
  admin_exists="$(pg_admin -tAc "select 1 from pg_roles where rolname='recruit_admin'")"
  app_exists="$(pg_admin -tAc "select 1 from pg_roles where rolname='recruit_app'")"
  db_exists="$(pg_admin -tAc "select 1 from pg_database where datname='$DB_NAME'")"

  # The users are shared by every install on this server's PostgreSQL. If they exist but we do not know their passwords,
  # we can only continue by setting new ones, which would break another install that uses them.
  if { [ -n "$admin_exists" ] || [ -n "$app_exists" ]; } && { [ -z "$ADMIN_DB_PASSWORD" ] || [ -z "$APP_DB_PASSWORD" ]; }; then
    local other; other="$(grep -lE '^ADMIN_DB_PASSWORD=' /etc/recruit/*.env 2>/dev/null | grep -v "^$ENV_FILE$" | head -1 || true)"
    if [ -n "$other" ]; then
      ADMIN_DB_PASSWORD="$(env_get ADMIN_DB_PASSWORD "$other")"; APP_DB_PASSWORD="$(env_get APP_DB_PASSWORD "$other")"
      ok "The database users already exist from another install here; reusing their passwords"
    else
      warn "The database users recruit_admin / recruit_app already exist, but this installer does not know their passwords."
      confirm "Set new passwords for them? (Only say yes if nothing else uses these two users.)" n || die "Stopped. Give the existing passwords in $ENV_FILE (ADMIN_DB_PASSWORD, APP_DB_PASSWORD), or answer yes to set new ones."
      reset=1
    fi
  fi
  [ -n "$ADMIN_DB_PASSWORD" ] || ADMIN_DB_PASSWORD="$(rand_hex 20)"
  [ -n "$APP_DB_PASSWORD" ] || APP_DB_PASSWORD="$(rand_hex 20)"

  # The owner must be able to see every agency's rows (the worker and the platform functions do), so it gets BYPASSRLS.
  # It is not a superuser. The runtime user never bypasses row-level security.
  pg_admin -v admin_pw="$ADMIN_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" -v db="$DB_NAME" -v reset="${reset:-0}" >>"$LOG_FILE" 2>&1 <<'SQL'
SELECT format('CREATE ROLE recruit_admin LOGIN BYPASSRLS NOSUPERUSER PASSWORD %L', :'admin_pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recruit_admin') \gexec
SELECT format('CREATE ROLE recruit_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'app_pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recruit_app') \gexec
SELECT format('ALTER ROLE recruit_admin PASSWORD %L', :'admin_pw') WHERE :'reset' = '1' \gexec
SELECT format('ALTER ROLE recruit_app PASSWORD %L', :'app_pw') WHERE :'reset' = '1' \gexec
ALTER ROLE recruit_admin BYPASSRLS;
ALTER ROLE recruit_app NOBYPASSRLS NOSUPERUSER;
SELECT format('CREATE DATABASE %I OWNER recruit_admin', :'db') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO recruit_app', :'db') \gexec
SQL
  # The system uses the pgcrypto extension. On PostgreSQL 12 only an administrator may create it, so it is done here, once.
  pg_admin_in_db "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >>"$LOG_FILE" 2>&1 || die "Could not enable the pgcrypto extension. Is the 'postgresql-contrib' package installed? See $LOG_FILE."
  [ -z "$admin_exists" ] && ok "Created the database owner (recruit_admin)" || ok "The database owner already existed"
  [ -z "$app_exists" ] && ok "Created the runtime user (recruit_app)" || ok "The runtime user already existed"
  [ -z "$db_exists" ] && ok "Created the database '$DB_NAME'" || ok "The database '$DB_NAME' already existed, so it was kept as it is"

  DATABASE_URL="postgres://recruit_app:${APP_DB_PASSWORD}@${PG_HOST}:${PG_PORT}/${DB_NAME}"
  MIGRATE_DATABASE_URL="postgres://recruit_admin:${ADMIN_DB_PASSWORD}@${PG_HOST}:${PG_PORT}/${DB_NAME}"
  if ! psql -X -tAc 'select 1' "$MIGRATE_DATABASE_URL" >/dev/null 2>&1; then
    die "The database user cannot sign in over TCP. On PostgreSQL this is controlled by pg_hba.conf: it needs a line like
   host  $DB_NAME  recruit_admin,recruit_app  127.0.0.1/32  scram-sha-256
   then run: systemctl reload postgresql   (details in $LOG_FILE)"
  fi
  ok "Both users can sign in"
}

# ---------------------------------------------------------------- settings file
write_env() {
  step "Settings file"
  local existing=0; [ -f "$ENV_FILE" ] && existing=1
  SESSION_SECRET="$(env_get SESSION_SECRET "$ENV_FILE")"; [ -n "$SESSION_SECRET" ] || SESSION_SECRET="$(rand_hex 32)"
  FIELD_ENCRYPTION_KEY="$(env_get FIELD_ENCRYPTION_KEY "$ENV_FILE")"; [ -n "$FIELD_ENCRYPTION_KEY" ] || FIELD_ENCRYPTION_KEY="$(rand_hex 32)"
  mkdir -p /etc/recruit; chmod 755 /etc/recruit
  # Anything the owner added by hand (messages, M-Pesa, storage ...) is kept: only the lines below are rewritten.
  local keep=""
  if [ "$existing" -eq 1 ]; then
    keep="$(grep -vE '^(# Managed by|NODE_ENV|PORT|APP_URL|DB_NAME|ADMIN_DB_PASSWORD|APP_DB_PASSWORD|DATABASE_URL|MIGRATE_DATABASE_URL|WORKER_DATABASE_URL|SESSION_SECRET|FIELD_ENCRYPTION_KEY|STORAGE_DIR|TENANT_MODE|LICENSE_PUBLIC_KEY|SIGNUP_ENABLED)=' "$ENV_FILE" | grep -vE '^# Managed by' || true)"
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
    ls -1t "$ENV_FILE".bak-* 2>/dev/null | tail -n +4 | xargs -r rm --
  fi
  {
    echo "# Managed by the installer. Add your own settings (SMS, email, M-Pesa, storage) at the bottom; they are kept."
    echo "NODE_ENV=production"
    echo "PORT=$PORT"
    echo "APP_URL=$(env_quote "https://$DOMAIN")"
    echo "DB_NAME=$DB_NAME"
    echo "ADMIN_DB_PASSWORD=$ADMIN_DB_PASSWORD"
    echo "APP_DB_PASSWORD=$APP_DB_PASSWORD"
    echo "DATABASE_URL=$(env_quote "$DATABASE_URL")"
    echo "MIGRATE_DATABASE_URL=$(env_quote "$MIGRATE_DATABASE_URL")"
    echo "WORKER_DATABASE_URL=$(env_quote "$MIGRATE_DATABASE_URL")"
    echo "SESSION_SECRET=$SESSION_SECRET"
    echo "FIELD_ENCRYPTION_KEY=$FIELD_ENCRYPTION_KEY"
    echo "STORAGE_DIR=$STORAGE_DIR"
    mode_env
    [ -n "$keep" ] && { echo; printf '%s\n' "$keep"; }
  } > "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
  chown root:"$SERVICE_USER" "$ENV_FILE" 2>/dev/null || chown root:root "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  [ "$existing" -eq 1 ] && ok "Updated $ENV_FILE (your secrets and your own settings were kept; a copy of the old file sits next to it)" || ok "Wrote $ENV_FILE (readable only by root and the system's own user)"
}

# ---------------------------------------------------------------- 4. code, packages, build, tables
create_user_and_dirs() {
  step "Service user and folders"
  id "$SERVICE_USER" >/dev/null 2>&1 || { useradd --system --home-dir "$RECRUIT_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"; ok "Created the user '$SERVICE_USER' that runs the system (it cannot sign in)"; }
  mkdir -p "$APP_DIR" "$STORAGE_DIR" "$INSTANCE_DIR" "$INSTANCE_DIR/.home"
  chown "$SERVICE_USER":"$SERVICE_USER" "$STORAGE_DIR" "$INSTANCE_DIR/.home"; chmod 750 "$STORAGE_DIR"; chmod 700 "$INSTANCE_DIR/.home"
  chmod 755 "$RECRUIT_ROOT" "$INSTANCE_DIR"
  ok "Folders ready under $INSTANCE_DIR"
}

install_source() {
  step "Copying the system's files"
  # A plain copy that leaves out what is rebuilt on the server and anything private.
  tar -C "$SRC_DIR" --exclude=./node_modules --exclude=./.next --exclude=./.next-dev --exclude=./.git --exclude='./.env*' --exclude=./storage \
      --exclude=./backups --exclude=./e2e --exclude=./tests --exclude='*.log' --exclude=./tsconfig.tsbuildinfo -cf - . | tar -C "$APP_DIR" -xf -
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
  mkdir -p /opt/recruit && cp -f "$SRC_DIR/update.js" "$RECRUIT_ROOT/update.js" 2>/dev/null || true
  ok "Files copied to $APP_DIR"
}

# Runs a command as the service user with the private Node first on the path and the settings loaded.
in_app() { runuser -u "$SERVICE_USER" -- bash -c 'cd "$1"; shift; set -a; . "$0"; set +a; export PATH="'"$NODE_BIN"':$PATH" HOME="'"$INSTANCE_DIR/.home"'"; exec "$@"' "$ENV_FILE" "$APP_DIR" "$@"; }

install_packages_and_build() {
  step "Installing packages and building (this takes a few minutes)"
  say "Installing packages ..."
  in_app npm ci --include=dev --no-audit --no-fund >>"$LOG_FILE" 2>&1 || die "npm could not install the packages. See $LOG_FILE."
  ok "Packages installed"
  say "Building the website ..."
  in_app env TENANT_MODE= LICENSE_PUBLIC_KEY= DATABASE_URL=postgres://build:build@localhost:5432/build SESSION_SECRET=build-time-placeholder-build-time-placeholder npm run build >>"$LOG_FILE" 2>&1 || die "The build failed. See $LOG_FILE."
  ok "Built"
}

run_migrations() {
  step "Creating the database tables"
  in_app npm run migrate >>"$LOG_FILE" 2>&1 || die "The database tables could not be created. See $LOG_FILE."
  ok "Database is up to date ($(psql -X -tAc 'select count(*) from schema_migrations' "$MIGRATE_DATABASE_URL" 2>/dev/null || echo '?') updates applied)"
}

# ---------------------------------------------------------------- 5. services
install_services() {
  step "Services that start by themselves"
  local unit_dir=/etc/systemd/system web="recruit-$INSTANCE-web" worker="recruit-$INSTANCE-worker"
  [ -f "$APP_DIR/node_modules/tsx/dist/cli.mjs" ] || die "The worker program (tsx) is missing."
  cat > "$unit_dir/$web.service" <<UNIT
[Unit]
Description=Recruitment system website ($DOMAIN)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN/node $APP_DIR/node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$INSTANCE_DIR

[Install]
WantedBy=multi-user.target
UNIT
  cat > "$unit_dir/$worker.service" <<UNIT
[Unit]
Description=Recruitment system background worker ($DOMAIN)
After=network.target postgresql.service $web.service
Wants=postgresql.service

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN/node $APP_DIR/node_modules/tsx/dist/cli.mjs scripts/worker.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$INSTANCE_DIR

[Install]
WantedBy=multi-user.target
UNIT
  if [ -n "$HAS_SYSTEMD" ]; then
    systemctl daemon-reload
    systemctl enable "$web" "$worker" >>"$LOG_FILE" 2>&1
    systemctl restart "$web" "$worker"
    ok "Website and worker are running and will start again after a reboot ($web, $worker)"
  else
    warn "No systemd here, so the services were written to $unit_dir but not started."
    say "To run them by hand:  $NODE_BIN/node $APP_DIR/node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1"
  fi
  SERVICE_WEB="$web"; SERVICE_WORKER="$worker"
}

# ---------------------------------------------------------------- 6. nginx
NGINX_FILE=""
nginx_find_server_name() { # prints the file that already has this name in a server_name line
  nginx -T 2>/dev/null | awk -v d="$1" '
    /^# configuration file /{f=$4; sub(/:$/,"",f); next}
    {
      line=$0; sub(/#.*/,"",line)
      while (match(line, /server_name[ \t]+[^;]+;/)) {
        seg=substr(line, RSTART+11, RLENGTH-12); n=split(seg, a, /[ \t]+/)
        for (i=1; i<=n; i++) if (a[i]==d) { print f; exit }
        line=substr(line, RSTART+RLENGTH)
      }
    }'
}
nginx_conf_path() { if [ -d /etc/nginx/sites-available ]; then echo "/etc/nginx/sites-available/recruit-$INSTANCE.conf"; else echo "/etc/nginx/conf.d/recruit-$INSTANCE.conf"; fi; }
nginx_link() { local f="$1"; if [ -d /etc/nginx/sites-enabled ] && [ "$(dirname "$f")" = /etc/nginx/sites-available ]; then ln -sfn "$f" "/etc/nginx/sites-enabled/$(basename "$f")"; fi; }

nginx_block() { # nginx_block with_ssl(0|1)
  local proxy="
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_read_timeout 60s;"
  if [ "$1" = 1 ]; then
    cat <<CONF
# Written by the recruitment system installer for $DOMAIN
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    $([ -f /etc/letsencrypt/options-ssl-nginx.conf ] && echo "include /etc/letsencrypt/options-ssl-nginx.conf;")
    $([ -f /etc/letsencrypt/ssl-dhparams.pem ] && echo "ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;")
    client_max_body_size 12m;
    add_header Strict-Transport-Security "max-age=31536000" always;
    location / {$proxy
    }
}
CONF
  else
    cat <<CONF
# Written by the recruitment system installer for $DOMAIN
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 12m;
    location / {$proxy
    }
}
CONF
  fi
}

setup_nginx() {
  step "nginx"
  if [ -n "$SKIP_NGINX" ]; then warn "Skipped (you asked for no nginx changes). Point your own proxy at http://127.0.0.1:$PORT."; return; fi
  if ! have nginx; then
    say "nginx is not installed here."
    confirm "Install nginx now?" y || die "nginx is needed to serve the domain. Install it, or run again with --skip-nginx and set up your own proxy."
    apt_install nginx; svc enable nginx || true; svc start nginx; ok "nginx installed"
  else ok "nginx is already installed"; fi

  local found; found="$(nginx_find_server_name "$DOMAIN" || true)"
  NGINX_FILE="$(nginx_conf_path)"
  if [ -n "$found" ] && [ "$found" != "$NGINX_FILE" ] && [ "$(readlink -f "$found")" != "$(readlink -f "$NGINX_FILE" 2>/dev/null || echo x)" ]; then
    ok "nginx already has a server for $DOMAIN, in $found, so it is not changed"
    if grep -qE "proxy_pass[^;]*:$PORT" "$found" 2>/dev/null; then ok "...and it already points at this system (port $PORT)"
    else
      warn "It does not point at this system. To use it, send the site to the system with:"
      say "    proxy_pass http://127.0.0.1:$PORT;   (plus the usual X-Forwarded-For and X-Forwarded-Proto headers)"
      say "then run: nginx -t && systemctl reload nginx"
    fi
    NGINX_EXISTING="$found"; return
  fi
  if [ -n "$found" ]; then ok "nginx already has this system's own server block for $DOMAIN"; NGINX_EXISTING="$found"
  else
    local with_ssl=0; [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && with_ssl=1
    nginx_block "$with_ssl" > "$NGINX_FILE"; nginx_link "$NGINX_FILE"
    nginx -t >>"$LOG_FILE" 2>&1 || { rm -f "$NGINX_FILE" "/etc/nginx/sites-enabled/$(basename "$NGINX_FILE")"; die "nginx did not accept the new settings, so they were removed. See $LOG_FILE."; }
    svc reload nginx
    ok "Added the nginx server for $DOMAIN -> 127.0.0.1:$PORT ($NGINX_FILE)"
  fi
  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 'Nginx Full' >>"$LOG_FILE" 2>&1 || { ufw allow 80/tcp; ufw allow 443/tcp; } >>"$LOG_FILE" 2>&1
    ok "The firewall (ufw) allows web traffic"
  fi
}

# ---------------------------------------------------------------- 7. SSL
SSL_STATE="none"
has_ssl() {
  [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && return 0
  local f="${NGINX_EXISTING:-}"; [ -n "$f" ] && grep -qE "^\s*ssl_certificate\s" "$f" 2>/dev/null && grep -qE "listen[^;]*443" "$f" && return 0
  return 1
}
public_ip() { curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true; }
dns_ip() { getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}'; }

setup_ssl() {
  step "SSL certificate"
  if has_ssl; then
    SSL_STATE="existing"
    ok "$DOMAIN already has an SSL certificate, so none is requested"
    if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && ! openssl x509 -checkend 1209600 -noout -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" >/dev/null 2>&1; then
      warn "That certificate ends within 14 days. Check that renewal works: certbot renew --dry-run"
    fi
    return
  fi
  if [ -n "$SKIP_SSL" ] || [ -n "$SKIP_NGINX" ]; then warn "Skipped. The site works on http only until you add a certificate."; SSL_STATE="skipped"; return; fi
  [ -n "${NGINX_EXISTING:-}" ] && [ "$(readlink -f "$NGINX_EXISTING")" != "$(readlink -f "$NGINX_FILE")" ] && { warn "The domain's nginx block belongs to something else, so the certificate is left to you: certbot --nginx -d $DOMAIN"; SSL_STATE="manual"; return; }

  local me ip; me="$(public_ip)"; ip="$(dns_ip || true)"
  if [ -z "$ip" ]; then warn "$DOMAIN does not point anywhere yet. Add a DNS 'A' record for it pointing at ${me:-this server}."
  elif [ -n "$me" ] && [ "$ip" != "$me" ]; then warn "$DOMAIN points to $ip, but this server is $me."; else ok "DNS: $DOMAIN points to this server (${me:-$ip})"; fi
  if [ -z "$ip" ] || { [ -n "$me" ] && [ "$ip" != "$me" ]; }; then
    if ! confirm "Try to get the certificate anyway? (It will fail until the DNS is right.)" n; then
      warn "Skipped. When the DNS is right, run:  certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
      SSL_STATE="pending-dns"; return
    fi
  fi
  have certbot || { say "Installing certbot ..."; apt_install certbot python3-certbot-nginx; }
  if certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --non-interactive --redirect >>"$LOG_FILE" 2>&1; then
    SSL_STATE="new"; ok "SSL certificate installed for $DOMAIN. It renews by itself."
    if [ -n "$HAS_SYSTEMD" ] && ! systemctl is-enabled certbot.timer >/dev/null 2>&1 && ! ls /etc/cron.d/certbot >/dev/null 2>&1; then warn "Automatic renewal does not seem to be set up. Add a daily 'certbot renew' job."; fi
  else
    SSL_STATE="failed"; warn "The certificate could not be issued (see $LOG_FILE). The site works on http. Fix the cause, then run: certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
  fi
}

# ---------------------------------------------------------------- 8. backups, update command, health
install_backups() {
  step "Daily backups and the update command"
  mkdir -p "/var/backups/recruit/$INSTANCE"; chmod 700 /var/backups/recruit
  cp -f "$DEPLOY_DIR/backup.sh" "$RECRUIT_ROOT/backup.sh"; chmod 755 "$RECRUIT_ROOT/backup.sh"
  if [ -n "$HAS_SYSTEMD" ]; then
    cat > "/etc/systemd/system/recruit-$INSTANCE-backup.service" <<UNIT
[Unit]
Description=Recruitment system backup ($DOMAIN)
[Service]
Type=oneshot
Environment=PATH=/usr/bin:/bin:/usr/local/bin
ExecStart=$RECRUIT_ROOT/backup.sh $INSTANCE
UNIT
    cat > "/etc/systemd/system/recruit-$INSTANCE-backup.timer" <<UNIT
[Unit]
Description=Daily recruitment system backup ($DOMAIN)
[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=900
Persistent=true
[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload; systemctl enable --now "recruit-$INSTANCE-backup.timer" >>"$LOG_FILE" 2>&1
    ok "Backs up the database and documents every night at about 02:30, keeping 14 days (in /var/backups/recruit/$INSTANCE)"
  else
    echo "30 2 * * * root $RECRUIT_ROOT/backup.sh $INSTANCE >> /var/log/recruit-backup.log 2>&1" > "/etc/cron.d/recruit-$INSTANCE"
    ok "Backup job added to cron (/etc/cron.d/recruit-$INSTANCE)"
  fi
  cat > /usr/local/bin/recruit-update <<WRAP
#!/usr/bin/env bash
# Updates the recruitment system from a folder or .tar.gz of the new files:  sudo recruit-update /path/to/new-files
exec "$NODE_BIN/node" "$RECRUIT_ROOT/update.js" "\$@"
WRAP
  chmod 755 /usr/local/bin/recruit-update
  ok "To update later:  sudo recruit-update /path/to/the/new/files"
}

health_check() {
  step "Checking that it works"
  local i code=""
  if [ -n "$HAS_SYSTEMD" ]; then
    for i in $(seq 1 30); do code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login" || true)"; [ "$code" = 200 ] && break; sleep 2; done
    [ "$code" = 200 ] && ok "The website answers on 127.0.0.1:$PORT" || die "The website did not start. Look at: journalctl -u $SERVICE_WEB -n 50"
    systemctl is-active --quiet "$SERVICE_WORKER" && ok "The background worker is running" || warn "The worker is not running. Look at: journalctl -u $SERVICE_WORKER -n 50"
  else warn "Services were not started here, so there is nothing to check."; fi
  if [ -n "$HAS_SYSTEMD" ] && { [ "$SSL_STATE" = new ] || [ "$SSL_STATE" = existing ]; }; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/login" || true)"
    [ "$code" = 200 ] && ok "https://$DOMAIN/login answers" || warn "https://$DOMAIN/login did not answer yet (answered '$code'). DNS or nginx may still be settling."
  fi
}

print_summary() {
  local scheme=https; [ "$SSL_STATE" = new ] || [ "$SSL_STATE" = existing ] || scheme=http
  printf '\n%s============================================================%s\n' "$B" "$N"
  printf '%s%s is installed.%s\n\n' "$G$B" "$KIND" "$N"
  say "Address:        $scheme://$DOMAIN"
  say "Settings file:  $ENV_FILE   (secrets: keep it private)"
  say "Files:          $INSTANCE_DIR"
  say "Backups:        /var/backups/recruit/$INSTANCE   (copy them off this server too)"
  say "Install log:    $LOG_FILE"
  say "Services:       systemctl status $SERVICE_WEB $SERVICE_WORKER"
  say "Logs:           journalctl -u $SERVICE_WEB -f"
  printf '\n%sIMPORTANT:%s copy FIELD_ENCRYPTION_KEY from %s to your password manager now.\n' "$Y$B" "$N" "$ENV_FILE"
  say "Without it, ID and passport numbers cannot be read again if the server is lost."
  next_steps
  printf '%s============================================================%s\n' "$B" "$N"
}
