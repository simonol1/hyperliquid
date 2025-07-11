#!/bin/bash

set -e

REMOTE_USER="root"
REMOTE_HOST="$1"
REMOTE_PATH="/opt/mybot"

if [ -z "$REMOTE_HOST" ]; then
  echo "Usage: $0 <DROPLET_IP>"
  exit 1
fi

echo "👉 Uploading .env to $REMOTE_HOST:$REMOTE_PATH"

scp .env "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/.env"

echo "✅ .env uploaded."

# usage:
# chmod +x upload-env.sh
# ./upload-env.sh <DROPLET_IP>