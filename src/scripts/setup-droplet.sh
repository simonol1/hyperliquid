#!/bin/bash

set -e

# === CONFIG ===
REMOTE_USER="root"
REMOTE_HOST="$1"          # Pass droplet IP as first argument
REMOTE_PATH="/opt/mybot"

if [ -z "$REMOTE_HOST" ]; then
  echo "Usage: $0 <DROPLET_IP>"
  exit 1
fi

echo "👉 Connecting to $REMOTE_HOST ..."

ssh "$REMOTE_USER@$REMOTE_HOST" bash -s <<EOF
  echo "🔧 Updating packages..."
  apt-get update -y
  apt-get upgrade -y

  echo "🐳 Installing Docker..."
  apt-get install -y docker.io docker-compose-plugin

  echo "📂 Creating app directory..."
  mkdir -p "$REMOTE_PATH"
EOF

echo "✅ Droplet prepared. Next: deploy your code & .env"


# usage:
# chmod +x setup-droplet.sh
# ./setup-droplet.sh <DROPLET_IP>