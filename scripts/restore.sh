#!/bin/sh
# Restores a database backup made by backup.sh. This REPLACES the current data. Stop the app first.
#   ./scripts/restore.sh backups/db-20261025-120000.dump
set -e
[ -f "$1" ] || { echo "Usage: $0 backups/db-....dump"; exit 1; }
cd "$(dirname "$0")/.."
printf "This replaces everything in the database with %s. Type YES to continue: " "$1"
read ans; [ "$ans" = "YES" ] || exit 1
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db pg_restore -U recruit_admin -d recruit --clean --if-exists --no-owner < "$1"
echo "Restored. Start the app again."
