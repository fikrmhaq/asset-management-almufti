#!/usr/bin/env bash
#
# Nightly database backup — `05-infrastructure.md` §4.
#
# Runs on the HOST via cron, not as a BullMQ job: a backup that only runs while
# the application is healthy is not a backup. Install with
#
#   0 2 * * *  /opt/asset-management/deploy/backup.sh >> /var/log/asset-backup.log 2>&1
#
# Retention is 14 daily + 4 weekly, per §4.
#
# > The off-box copy at the end is NOT optional. File storage (§5) is local disk
# > on this same VPS, so one disk failure otherwise destroys the database, its
# > backups and every attachment at the same moment.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/asset-management/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/asset-management}"
STORAGE_DIR="${STORAGE_DIR:-/srv/asset-management/storage}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

timestamp="$(date +%Y%m%d-%H%M%S)"
dow="$(date +%u)" # 7 = Sunday, kept as the weekly copy

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

dump="$BACKUP_DIR/daily/db-$timestamp.sql.gz"

echo "[$(date -Is)] dumping database → $dump"

# `--clean` so the dump can be restored over an existing database. Piped
# straight into gzip: an intermediate plain-text dump of the whole registry is
# the last thing that should sit on disk unnecessarily.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 > "$dump"

# A zero-byte dump means pg_dump failed silently through the pipe; `set -o
# pipefail` catches most of it, this catches the rest.
if [[ ! -s "$dump" ]]; then
  echo "[$(date -Is)] FAILED: dump is empty" >&2
  rm -f "$dump"
  exit 1
fi

echo "[$(date -Is)] archiving attachments"
attachments="$BACKUP_DIR/daily/storage-$timestamp.tar.gz"
tar -czf "$attachments" -C "$STORAGE_DIR" .

if [[ "$dow" == "7" ]]; then
  cp "$dump" "$BACKUP_DIR/weekly/"
  cp "$attachments" "$BACKUP_DIR/weekly/"
fi

# Retention: 14 daily, 4 weekly (§4). Counted per file KIND, so a missing
# attachment archive cannot shorten the database history.
for kind in db storage; do
  find "$BACKUP_DIR/daily" -name "$kind-*" -type f | sort -r | tail -n +15 | xargs -r rm --
  find "$BACKUP_DIR/weekly" -name "$kind-*" -type f | sort -r | tail -n +5 | xargs -r rm --
done

if [[ -n "$RCLONE_REMOTE" ]]; then
  echo "[$(date -Is)] replicating off-VPS → $RCLONE_REMOTE"
  rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --transfers 2
else
  echo "[$(date -Is)] WARNING: RCLONE_REMOTE is unset — backups exist only on this host," >&2
  echo "  which §4 states is not sufficient at this architecture." >&2
fi

echo "[$(date -Is)] done"
