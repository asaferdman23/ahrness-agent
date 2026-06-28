#!/bin/bash
# Push an update to the server.
# Usage: ./deploy/deploy.sh user@your-server-ip
set -euo pipefail

SERVER=${1:?"Usage: $0 user@server-ip"}
APP_DIR=/opt/ahrness

echo "==> Pushing code to $SERVER"
git push origin HEAD

echo "==> Deploying on server"
ssh "$SERVER" bash <<EOF
  set -euo pipefail
  cd $APP_DIR
  git pull
  npm ci --omit=dev
  systemctl restart ahrness
  systemctl status ahrness --no-pager -l
EOF

echo "==> Done."
