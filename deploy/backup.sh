#!/usr/bin/env bash
# Nightly backup: keeps 14 days on the server and, if set up in .env, copies each backup off the server.
# Off-server copies use any S3-compatible storage (Cloudflare R2 or Backblaze B2 have free tiers).
set -euo pipefail
APP_DIR=/opt/grumbling-gnoll
LOCAL=/var/backups/grumbling-gnoll
mkdir -p "$LOCAL"
FILE="$LOCAL/backup-$(date +%F).tar.gz"
cd "$APP_DIR"
DATA_DIR="$APP_DIR/data" node scripts/backup.mjs "$FILE"
find "$LOCAL" -name 'backup-*.tar.gz' -mtime +14 -delete

# Read off-server settings from .env (only the BACKUP_ lines)
if [ -f "$APP_DIR/.env" ]; then
  while IFS='=' read -r key value; do
    case "$key" in BACKUP_*) export "$key=${value%\"}";; esac
  done < <(grep -E '^BACKUP_[A-Z0-9_]+=' "$APP_DIR/.env" | sed 's/="/=/')
fi

if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ]; then
  if ! command -v rclone >/dev/null; then apt-get install -y rclone >/dev/null; fi
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
  export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-auto}"
  export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  rclone copy "$FILE" "offsite:${BACKUP_S3_BUCKET}/grumbling-gnoll/" --quiet
  # keep 60 days off the server
  rclone delete "offsite:${BACKUP_S3_BUCKET}/grumbling-gnoll/" --min-age 60d --quiet || true
  echo "Copied off the server to ${BACKUP_S3_BUCKET}"
fi
