#!/usr/bin/env bash
# Pull the newest code from GitHub and restart. Run as root on the server: bash /opt/grumbling-gnoll/deploy/update.sh
set -euo pipefail
cd /opt/grumbling-gnoll
sudo -u gnoll git pull --ff-only
sudo -u gnoll bash -c "npm ci && npm run build"
systemctl restart grumbling-gnoll
echo "Updated and restarted."
