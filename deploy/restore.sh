#!/usr/bin/env bash
#
# Restore from a backup — `05-infrastructure.md` §4.
#
#   ./deploy/restore.sh /var/backups/asset-management/daily/db-20260813-020000.sql.gz
#
# A backup procedure that has never been restored is a hypothesis. This script
# exists so the restore path is written down and rehearsable, not improvised
# during an outage.
#
# > Restoring REPLACES the current database. The application is stopped first so
# > no request can write between the drop and the reload.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/asset-management/docker-compose.prod.yml}"
STORAGE_DIR="${STORAGE_DIR:-/srv/asset-management/storage}"

dump="${1:-}"
attachments="${2:-}"

if [[ -z "$dump" ]]; then
  echo "usage: $0 <db-dump.sql.gz> [storage-archive.tar.gz]" >&2
  exit 64
fi

if [[ ! -f "$dump" ]]; then
  echo "no such dump: $dump" >&2
  exit 66
fi

read -r -p "This REPLACES the live database from $dump. Type 'restore' to continue: " confirm
[[ "$confirm" == "restore" ]] || { echo "aborted"; exit 1; }

echo "[$(date -Is)] stopping the application (datastores stay up)"
docker compose -f "$COMPOSE_FILE" stop api web

echo "[$(date -Is)] restoring database"
# The dump was taken with --clean --if-exists, so it drops and recreates each
# object itself; no manual DROP DATABASE is needed.
gunzip -c "$dump" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

if [[ -n "$attachments" ]]; then
  if [[ ! -f "$attachments" ]]; then
    echo "no such attachment archive: $attachments" >&2
    exit 66
  fi

  echo "[$(date -Is)] restoring attachments"
  # Attachments are restored ALONGSIDE the database on purpose: a database row
  # pointing at a file that is not there is worse than either loss alone.
  tar -xzf "$attachments" -C "$STORAGE_DIR"
fi

echo "[$(date -Is)] starting the application"
docker compose -f "$COMPOSE_FILE" up -d api web

echo "[$(date -Is)] verifying"
sleep 5
docker compose -f "$COMPOSE_FILE" exec -T api \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.json()).then(d => { console.log(JSON.stringify(d)); process.exit(d.status === 'ok' ? 0 : 1); })"

echo "[$(date -Is)] restore complete"
