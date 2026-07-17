#!/bin/bash
# Push an update to the server.
# Usage: ./deploy/deploy.sh user@your-server-ip [ssh-port]
# SSH port also settable via SSH_PORT env var; defaults to 22.
set -euo pipefail

SERVER=${1:?"Usage: $0 user@server-ip [ssh-port]"}
SSH_PORT=${2:-${SSH_PORT:-22}}
APP_DIR=/opt/ahrness

echo "==> Pushing code to $SERVER"
git push origin HEAD

echo "==> Deploying on server (port $SSH_PORT)"
ssh -p "$SSH_PORT" "$SERVER" bash <<EOF
  set -euo pipefail
  cd $APP_DIR
  git pull
  npm ci
  npm run build:frontend
  systemctl restart ahrness
  systemctl status ahrness --no-pager -l
EOF

echo "==> Done."
