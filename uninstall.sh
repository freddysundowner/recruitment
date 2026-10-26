#!/usr/bin/env bash
# Removes one install from this server. It asks before each destructive step and never touches other systems.
#   sudo ./uninstall.sh [--domain recruit.example.com] [-y]
# Always take a backup first: /var/backups/recruit/<instance> holds the nightly ones, or run /opt/recruit/backup.sh <instance>.
set -Eeuo pipefail
ROOT="${RECRUIT_ROOT:-/opt/recruit}"; DOMAIN=""; YES=""
while [ $# -gt 0 ]; do case "$1" in --domain) DOMAIN="$2"; shift ;; -y|--yes) YES=1 ;; --root) ROOT="$2"; shift ;; -h|--help) sed -n '2,5p' "$0"; exit 0 ;; *) echo "Unknown option $1"; exit 1 ;; esac; shift; done
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
if [ -z "$DOMAIN" ]; then
  list="$(ls /etc/recruit/*.env 2>/dev/null | xargs -n1 basename 2>/dev/null | sed 's/\.env$//' || true)"
  [ -n "$list" ] || { echo "No install found."; exit 1; }
  [ "$(echo "$list" | wc -l)" -eq 1 ] && INSTANCE="$list" || { echo "More than one install: $(echo $list). Use --domain."; exit 1; }
else INSTANCE="${DOMAIN//./-}"; fi
ENV_FILE="/etc/recruit/$INSTANCE.env"; [ -r "$ENV_FILE" ] || { echo "No install called $INSTANCE."; exit 1; }
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DB_NAME="$(get DB_NAME)"; INSTANCE_DIR="$ROOT/$INSTANCE"
yn() { [ -n "$YES" ] && return 0; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy] ]]; }
echo "Removing $INSTANCE"
yn "Stop and remove its services, timer and nginx site?" || exit 0
for u in web worker; do systemctl disable --now "recruit-$INSTANCE-$u" 2>/dev/null || true; rm -f "/etc/systemd/system/recruit-$INSTANCE-$u.service"; done
systemctl disable --now "recruit-$INSTANCE-backup.timer" 2>/dev/null || true
rm -f "/etc/systemd/system/recruit-$INSTANCE-backup".{service,timer} "/etc/cron.d/recruit-$INSTANCE"; systemctl daemon-reload 2>/dev/null || true
rm -f "/etc/nginx/sites-enabled/recruit-$INSTANCE.conf" "/etc/nginx/sites-available/recruit-$INSTANCE.conf" "/etc/nginx/conf.d/recruit-$INSTANCE.conf"
nginx -t >/dev/null 2>&1 && { systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true; }
echo "Services and nginx site removed. The SSL certificate (if any) was left: certbot delete --cert-name ${INSTANCE//-/.} removes it."
if yn "Delete the code and the uploaded documents in $INSTANCE_DIR? THIS CANNOT BE UNDONE."; then rm -rf "$INSTANCE_DIR"; echo "Deleted $INSTANCE_DIR"; fi
if [ -n "$DB_NAME" ] && yn "Drop the database '$DB_NAME'? ALL its data goes."; then runuser -u postgres -- psql -X -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" && echo "Dropped $DB_NAME"; fi
yn "Delete the settings file $ENV_FILE (it holds the encryption key)?" && rm -f "$ENV_FILE" && echo "Deleted"
echo "Left in place: PostgreSQL itself, its users recruit_admin and recruit_app, nginx, the private Node.js in $ROOT/node, and backups in /var/backups/recruit."
