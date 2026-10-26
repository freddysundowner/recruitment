#!/usr/bin/env bash
# Installs the system for ONE agency on its own server (the agency bought it).
#   sudo ./install-standalone.sh
# Questions are asked as it goes. For no questions, give everything as options (see --help).
set -Eeuo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/lib.sh"

KIND="Single-agency system"
LICENSE_PUBLIC_KEY="${LICENSE_PUBLIC_KEY:-}"
BLESSEDTEXTS_API_KEY="${BLESSEDTEXTS_API_KEY:-}"; BLESSEDTEXTS_SENDER_ID="${BLESSEDTEXTS_SENDER_ID:-}"
BREVO_API_KEY="${BREVO_API_KEY:-}"; EMAIL_FROM="${EMAIL_FROM:-}"; EMAIL_FROM_NAME="${EMAIL_FROM_NAME:-}"

usage() {
  cat <<'TXT'
Installs the system for one agency on this server.

  sudo ./install-standalone.sh [options]

  --domain NAME             the domain or sub-domain (asked; default recruit.reggycodas.com)
  --email ADDRESS           for SSL certificate notices (asked only if a certificate is needed)
  --license-public-key KEY  the public key that came with the purchase (asked)
  --port N                  the private port for the website (default: the first free one from 3100)
  --db-name NAME            database name (default recruit)
  --skip-nginx              do not touch nginx (you proxy to the printed port yourself)
  --skip-ssl                do not request a certificate
  -y, --yes                 no questions: use defaults and the options/environment given
  -h, --help

Optional, from the environment or asked: BLESSEDTEXTS_API_KEY, BLESSEDTEXTS_SENDER_ID, BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME
Existing PostgreSQL on another machine: PG_ADMIN_URL=postgres://admin:pass@host:5432/postgres
TXT
}

mode_env() {
  echo "TENANT_MODE=single"
  echo "LICENSE_PUBLIC_KEY=$(env_quote "$LICENSE_PUBLIC_KEY")"
  [ -n "$BLESSEDTEXTS_API_KEY" ] && echo "BLESSEDTEXTS_API_KEY=$(env_quote "$BLESSEDTEXTS_API_KEY")"
  [ -n "$BLESSEDTEXTS_SENDER_ID" ] && echo "BLESSEDTEXTS_SENDER_ID=$(env_quote "$BLESSEDTEXTS_SENDER_ID")"
  [ -n "$BREVO_API_KEY" ] && echo "BREVO_API_KEY=$(env_quote "$BREVO_API_KEY")"
  [ -n "$EMAIL_FROM" ] && echo "EMAIL_FROM=$(env_quote "$EMAIL_FROM")"
  [ -n "$EMAIL_FROM_NAME" ] && echo "EMAIL_FROM_NAME=$(env_quote "$EMAIL_FROM_NAME")"
  true
}

next_steps() {
  printf '\n%sWhat to do next%s\n' "$B" "$N"
  say "1. Open $([ "$SSL_STATE" = new ] || [ "$SSL_STATE" = existing ] && echo https || echo http)://$DOMAIN . It opens a setup page."
  say "2. Paste the activation key you were given, then enter the agency's name and your own details."
  say "3. In Settings add the team, turn on two-step sign-in, and add the M-Pesa details."
  [ -z "$BLESSEDTEXTS_API_KEY" ] && say "4. For text messages, add BLESSEDTEXTS_API_KEY to $ENV_FILE, then: systemctl restart $SERVICE_WEB $SERVICE_WORKER"
}

parse_common_args "$@"
printf '%sSingle-agency installer%s\n' "$B" "$N"
preflight
questions_common
step "About this agency's installation"
ask LICENSE_PUBLIC_KEY "Public key from the purchase (LICENSE_PUBLIC_KEY)"
ask_optional BLESSEDTEXTS_API_KEY "BlessedTexts API key for SMS"
if [ -n "$BLESSEDTEXTS_API_KEY" ]; then ask_optional BLESSEDTEXTS_SENDER_ID "BlessedTexts sender ID"; fi
ask_optional BREVO_API_KEY "Brevo API key for email"
if [ -n "$BREVO_API_KEY" ]; then ask EMAIL_FROM "Email address to send from"; ask_optional EMAIL_FROM_NAME "Name on the emails"; fi
install_node
install_database
provision_database
create_user_and_dirs
write_env
install_source
install_packages_and_build
run_migrations
install_services
setup_nginx
setup_ssl
install_backups
health_check
print_summary
