#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 server (e.g. a $5-6/month VPS).
# Run as root:   bash setup.sh            (uses a free <ip>.sslip.io web address)
#           or:  bash setup.sh mygnoll.com   (if you bought a domain and pointed it at the server)
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/grumbling-gnoll
REPO=https://github.com/keegantsmith-cs/grumbling-gnoll.git

if [ -z "$DOMAIN" ]; then
  IP=$(curl -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "==> Setting up The Grumbling Gnoll at https://$DOMAIN"

if ! swapon --show | grep -q .; then
  echo "==> Adding 2 GB of swap so small servers don't run out of memory while building"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git build-essential poppler-utils debian-keyring debian-archive-keyring apt-transport-https ufw

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy (web server with automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Creating app user and downloading the code"
id gnoll >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin gnoll
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "    Created $APP_DIR/.env (add your Anthropic API key there later)"
fi
# Let Discord messages link back to the site
if grep -q '^PUBLIC_URL=' "$APP_DIR/.env"; then
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" "$APP_DIR/.env"
else
  echo "PUBLIC_URL=https://$DOMAIN" >> "$APP_DIR/.env"
fi
chown -R gnoll:gnoll "$APP_DIR"

echo "==> Installing and building (takes a minute)"
sudo -u gnoll bash -c "cd $APP_DIR && npm ci && npm run build"

echo "==> Starting the app as a service"
cat > /etc/systemd/system/grumbling-gnoll.service <<UNIT
[Unit]
Description=The Grumbling Gnoll virtual tabletop
After=network.target

[Service]
User=gnoll
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now grumbling-gnoll

echo "==> Configuring HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  request_body {
    max_size 300MB
  }
  reverse_proxy localhost:3000
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall: allow SSH and web traffic only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Nightly backup of the database and uploads (keeps 14 days)"
cat > /etc/cron.daily/grumbling-gnoll-backup <<'CRON'
#!/bin/sh
mkdir -p /var/backups/grumbling-gnoll
tar -czf /var/backups/grumbling-gnoll/backup-$(date +%F).tar.gz -C /opt/grumbling-gnoll data
find /var/backups/grumbling-gnoll -name 'backup-*.tar.gz' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/grumbling-gnoll-backup

echo
echo "All done! Open https://$DOMAIN in your browser and create the first account (that's the DM/admin)."
echo "To turn on the AI: nano $APP_DIR/.env  (set ANTHROPIC_API_KEY=...), then: systemctl restart grumbling-gnoll"
