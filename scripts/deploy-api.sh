#!/bin/bash

# Deploy apps/api to the hdtrs VM. This assumes Bun, Redis, and Caddy are
# already installed as documented in RUNBOOK.md.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="/tmp/blendr-api.tgz"
REMOTE="${BLENDR_DEPLOY_TARGET:-hdtrs}"

tar --exclude='apps/api/node_modules' --exclude='.DS_Store' -czf "$ARCHIVE" -C "$ROOT_DIR" apps/api
scp "$ARCHIVE" "$REMOTE:/tmp/blendr-api.tgz"
scp "$ROOT_DIR/infra/systemd/blendr-backend.service" "$REMOTE:/tmp/blendr-backend.service"
ssh "$REMOTE" '
  set -e
  sudo mkdir -p /opt/blendr
  sudo rm -rf /opt/blendr/apps/api
  sudo mkdir -p /opt/blendr/apps
  sudo tar -xzf /tmp/blendr-api.tgz -C /opt/blendr
  sudo chown -R heyday:heyday /opt/blendr/apps/api
  sudo cp /tmp/blendr-backend.service /etc/systemd/system/blendr-backend.service
  sudo systemctl daemon-reload
  cd /opt/blendr/apps/api
  /home/heyday/.bun/bin/bun install --production --frozen-lockfile
  sudo systemctl restart blendr-backend
  sudo systemctl --no-pager --full status blendr-backend
'
