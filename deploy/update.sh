#!/usr/bin/env bash
# Pull the newest code from GitHub and restart. Run as root on the server: bash /opt/grumbling-gnoll/deploy/update.sh
set -euo pipefail
cd /opt/grumbling-gnoll
# Tools newer features need
command -v pdftoppm >/dev/null || (apt-get update -y && apt-get install -y poppler-utils)
command -v rclone >/dev/null || apt-get install -y rclone
# Nightly backups now run deploy/backup.sh (adds the optional off-server copy)
cat > /etc/cron.daily/grumbling-gnoll-backup <<'CRON'
#!/bin/sh
/bin/bash /opt/grumbling-gnoll/deploy/backup.sh >> /var/log/grumbling-gnoll-backup.log 2>&1
CRON
chmod +x /etc/cron.daily/grumbling-gnoll-backup
# Older installs: add the site address for Discord links if it's missing
if ! grep -q '^PUBLIC_URL=.\+' .env && [ -f /etc/caddy/Caddyfile ]; then
  DOMAIN=$(head -1 /etc/caddy/Caddyfile | awk '{print $1}')
  sed -i '/^PUBLIC_URL=/d' .env
  echo "PUBLIC_URL=https://$DOMAIN" >> .env
fi
sudo -u gnoll git pull --ff-only
sudo -u gnoll bash -c "npm ci && npm run build"
systemctl restart grumbling-gnoll
echo "Updated and restarted."
