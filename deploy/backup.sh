#!/usr/bin/env bash
# Backs up one install: the database, and the uploaded documents. Run daily by a timer the installer sets up.
#   deploy/backup.sh <instance>
set -Eeuo pipefail
INSTANCE="${1:?usage: backup.sh <instance>}"
ENV_FILE="/etc/recruit/${INSTANCE}.env"
[ -r "$ENV_FILE" ] || { echo "No settings file at $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
DEST="${BACKUP_DIR:-/var/backups/recruit/$INSTANCE}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"; chmod 700 "$DEST"

pg_dump --format=custom --dbname="$MIGRATE_DATABASE_URL" --file="$DEST/db-$STAMP.dump"
if [ "${STORAGE_DRIVER:-}" != "s3" ] && [ -d "${STORAGE_DIR:-}" ]; then
  tar -czf "$DEST/documents-$STAMP.tgz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
fi
ls -1t "$DEST"/db-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t "$DEST"/documents-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "Backup written to $DEST ($STAMP)"
