#!/usr/bin/env bash

# === CONFIG ===
DROPLET_IP="209.38.87.178"
REMOTE_PATH="/opt/mybot"

# === 1) Build locally ===
echo "🔨 Building Docker image locally..."
docker compose build

# === 2) Upload project to droplet ===
echo "🚚 Copying files to droplet..."
scp -r . root@$DROPLET_IP:$REMOTE_PATH

# === 3) SSH + run Compose ===
echo "🚀 Deploying on droplet..."
ssh root@$DROPLET_IP << EOF
  cd $REMOTE_PATH
  docker compose pull
  docker compose up -d
EOF

echo "✅ Deployed! Containers should be up."
