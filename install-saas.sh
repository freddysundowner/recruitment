#!/usr/bin/env bash
# Installs the shared service, where many agencies sign up and pay you a subscription.
#   sudo ./install-saas.sh
# Questions are asked as it goes. For no questions, give everything as options (see --help).
set -Eeuo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/lib.sh"

KIND="Shared (SaaS) system"
PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-}"; PLATFORM_ADMIN_NAME="${PLATFORM_ADMIN_NAME:-}"; PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-}"

usage() {
  cat <<'TXT'
Installs the shared service (many agencies, subscriptions, platform console) on this server.

  sudo ./install-saas.sh [options]

  --domain NAME        the domain or sub-domain (asked; default recruit.reggycodas.com)
  --email ADDRESS      for SSL certificate notices (asked only if a certificate is needed)
  --admin-email ADDR   the platform owner's sign-in email (asked)
  --admin-name NAME    the platform owner's name (asked)
  PLATFORM_ADMIN_PASSWORD   (environment) the platform owner's password, 12+ characters (asked, hidden)
  --port N             the private port for the website (default: the first free one from 3100)
  --db-name NAME       database name (default recruit)
  --skip-nginx         do not touch nginx (you proxy to the printed port yourself)
  --skip-ssl           do not request a certificate
  -y, --yes            no questions: use defaults and the options/environment given
  -h, --help

SMS (BlessedTexts), email (Brevo), M-Pesa and card keys are set afterwards in the platform console, under Settings.
Existing PostgreSQL on another machine: PG_ADMIN_URL=postgres://admin:pass@host:5432/postgres
TXT
}

mode_env() {
  echo "TENANT_MODE="
  echo "SIGNUP_ENABLED=true"
  true
}

create_platform_admin() {
  step "Platform owner account"
  local n; n="$(psql -X -tAc 'select count(*) from platform_admins' "$MIGRATE_DATABASE_URL" 2>/dev/null || echo 0)"
  if [ "${n:-0}" -gt 0 ]; then ok "A platform owner already exists, so none is created"; return; fi
  ask PLATFORM_ADMIN_EMAIL "Platform owner's email (you sign in at /platform/login with it)" "admin@${DOMAIN#*.}"
  ask PLATFORM_ADMIN_NAME "Platform owner's name" "Platform Owner"
  ask_secret PLATFORM_ADMIN_PASSWORD "Platform owner's password (at least 12 characters)" 12
  in_app env PLATFORM_ADMIN_PASSWORD="$PLATFORM_ADMIN_PASSWORD" npm run platform:admin -- "$PLATFORM_ADMIN_EMAIL" "$PLATFORM_ADMIN_NAME" >>"$LOG_FILE" 2>&1 || die "Could not create the platform owner. See $LOG_FILE."
  ok "Created $PLATFORM_ADMIN_EMAIL"
}

next_steps() {
  local u="$([ "$SSL_STATE" = new ] || [ "$SSL_STATE" = existing ] && echo https || echo http)://$DOMAIN"
  printf '\n%sWhat to do next%s\n' "$B" "$N"
  say "1. Sign in at $u/platform/login with ${PLATFORM_ADMIN_EMAIL:-the platform owner email}. You will be asked to set up two-step sign-in."
  say "2. Open Settings in the console and add: BlessedTexts (SMS), Brevo (email), your M-Pesa paybill or till, and Stripe if you take cards."
  say "3. Check the plans and prices under Plans, and the SMS credit price and free credits under Settings."
  say "4. Agencies sign themselves up at $u/signup"
}

parse_common_args "$@"
printf '%sShared (SaaS) installer%s\n' "$B" "$N"
preflight
questions_common
install_node
install_database
provision_database
create_user_and_dirs
write_env
install_source
install_packages_and_build
run_migrations
create_platform_admin
install_services
setup_nginx
setup_ssl
install_backups
health_check
print_summary
