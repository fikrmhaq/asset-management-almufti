#!/usr/bin/env bash
#
# Nightly backup — `05-infrastructure.md` §4. Adapted from `deploy/backup.sh`
# for an on-premises server with no cloud storage.
#
# Install as a HOST cron job, not a BullMQ job: a backup that only runs while
# the application is healthy is not a backup.
#
#   sudo crontab -e
#   0 2 * * *  /opt/asset-management/scripts/backup.sh >> /var/log/asset-backup.log 2>&1
#
# Retention is 14 daily + 4 weekly (§4).
#
# TWO DIFFERENCES FROM THE REPOSITORY VERSION:
#
#   1. It SOURCES the .env file. Cron runs with almost no environment, so
#      $POSTGRES_USER and $POSTGRES_DB were unset there — with `set -u` the
#      script aborted on its first run, at 02:00, silently, which is exactly
#      when nobody is watching.
#   2. The off-box copy goes to a local mount or an rsync target instead of
#      rclone, because an isolated server has no cloud remote to sync to.

set -euo pipefail

# Values come from the deployment's own .env — the same file compose reads.
ENV_FILE="${ENV_FILE:-/opt/asset-management/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[$(date -Is)] WARNING: no env file at $ENV_FILE — relying on the caller's environment" >&2
fi

COMPOSE_FILE="${COMPOSE_FILE:-/opt/asset-management/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/asset-management}"
STORAGE_DIR="${STORAGE_DIR:-/srv/asset-management/storage}"
BACKUP_MIRROR_DIR="${BACKUP_MIRROR_DIR:-}"
BACKUP_RSYNC_TARGET="${BACKUP_RSYNC_TARGET:-}"

: "${POSTGRES_USER:?POSTGRES_USER is not set — check $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB is not set — check $ENV_FILE}"

timestamp="$(date +%Y%m%d-%H%M%S)"
dow="$(date +%u)" # 7 = Sunday, kept as the weekly copy

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

dump="$BACKUP_DIR/daily/db-$timestamp.sql.gz"

echo "[$(date -Is)] dumping database -> $dump"

# `--clean` so the dump can be restored over an existing database. Piped
# straight into gzip: an intermediate plain-text dump of the whole registry is
# the last thing that should sit on disk unnecessarily.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 > "$dump"

# A zero-byte dump means pg_dump failed silently through the pipe.
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

# The off-box copy is NOT optional. The database, its backups and every
# attachment are on one disk, so a single failure destroys all three together.
copied=false

if [[ -n "$BACKUP_MIRROR_DIR" ]]; then
  if [[ -d "$BACKUP_MIRROR_DIR" ]]; then
    echo "[$(date -Is)] mirroring -> $BACKUP_MIRROR_DIR"
    rsync -a --delete "$BACKUP_DIR/" "$BACKUP_MIRROR_DIR/"
    copied=true
  else
    # A NAS mount that dropped looks identical to a working one until you need
    # the backup, so this is an error rather than a silent skip.
    echo "[$(date -Is)] ERROR: BACKUP_MIRROR_DIR $BACKUP_MIRROR_DIR is not mounted" >&2
  fi
fi

if [[ -n "$BACKUP_RSYNC_TARGET" ]]; then
  echo "[$(date -Is)] replicating -> $BACKUP_RSYNC_TARGET"
  rsync -a --delete "$BACKUP_DIR/" "$BACKUP_RSYNC_TARGET/"
  copied=true
fi

if [[ "$copied" != true ]]; then
  echo "[$(date -Is)] WARNING: no off-box copy configured — backups exist only on this host," >&2
  echo "  which §4 states is not sufficient at this architecture." >&2
fi

echo "[$(date -Is)] done"
