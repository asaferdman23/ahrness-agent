#!/bin/bash
# Server bootstrap — run once as root on a fresh Ubuntu 22.04/24.04 Droplet.
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR/REPO/main/deploy/setup.sh | bash
set -euo pipefail

APP_USER=ahrness
APP_DIR=/opt/ahrness
NODE_VERSION=22

echo "==> Installing system packages"
apt-get update -q
apt-get install -y -q git curl build-essential

echo "==> Installing Node.js $NODE_VERSION"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y -q nodejs

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "==> Installing Caddy"
apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y -q caddy

echo "==> Creating app user: $APP_USER"
id -u $APP_USER &>/dev/null || useradd -m -s /bin/bash $APP_USER
usermod -aG docker $APP_USER

echo "==> Creating app directory"
mkdir -p $APP_DIR/store
chown -R $APP_USER:$APP_USER $APP_DIR

echo "==> Done. Next steps:"
echo "  1. Clone your repo into $APP_DIR"
echo "  2. Copy deploy/ahrness.service to /etc/systemd/system/"
echo "  3. Copy deploy/Caddyfile to /etc/caddy/Caddyfile"
echo "  4. Create $APP_DIR/.env (copy from .env.example)"
echo "  5. Run: npm ci && npm run build:sandbox"
echo "  6. systemctl enable --now ahrness caddy"
