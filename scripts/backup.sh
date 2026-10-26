#!/bin/sh
# Backs up the database and the uploaded documents into ./backups. Run it daily (cron) and copy the folder off the server.
#   ./scripts/backup.sh
set -e
cd "$(dirname "$0")/.."
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db pg_dump -U recruit_admin -d recruit --format=custom > "backups/db-$STAMP.dump"
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps -T -v "$PWD/backups:/backup" --entrypoint tar app czf "/backup/documents-$STAMP.tgz" -C /data storage 2>/dev/null || echo "Document archive skipped (using S3 storage?)"
# keep the 14 most recent of each kind
ls -1t backups/db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/documents-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Backup written to backups/ ($STAMP)"
