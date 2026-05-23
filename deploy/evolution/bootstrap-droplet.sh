#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_URL="${1:-https://evoapi.telenexustechnologies.com}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="/opt/evolution"
ENV_FILE="$TARGET_DIR/.env"

if [ "${EUID}" -ne 0 ]; then
  echo "Run this script as root (or with sudo)."
  exit 1
fi

echo "==> Preparing Nexa Official WhatsApp Evolution API stack"
echo "    Public URL: $PUBLIC_URL"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker is not installed. Installing Docker from Ubuntu packages..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin openssl curl
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is missing. Installing it..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin
fi

install -d -m 700 "$TARGET_DIR"
install -m 600 "$SCRIPT_DIR/docker-compose.yml" "$TARGET_DIR/docker-compose.yml"

if [ -f "$ENV_FILE" ]; then
  echo "==> Existing $ENV_FILE found. Keeping existing secrets and configuration."
else
  echo "==> Generating Evolution API, PostgreSQL and Redis secrets on the Droplet..."
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  REDIS_PASSWORD="$(openssl rand -hex 24)"
  API_KEY="$(openssl rand -hex 32)"

  cat > "$ENV_FILE" <<EOF
# Nexa Official WhatsApp Number - Evolution API
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD

SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=$PUBLIC_URL

AUTHENTICATION_API_KEY=$API_KEY
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
DEL_INSTANCE=false

DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$POSTGRES_PASSWORD@evolution-postgres:5432/evolution?schema=public
DATABASE_CONNECTION_CLIENT_NAME=nexa_operator
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_LABELS=true
DATABASE_SAVE_DATA_HISTORIC=true

CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://:$REDIS_PASSWORD@evolution-redis:6379/1
CACHE_REDIS_PREFIX_KEY=nexa_operator
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false

WEBHOOK_GLOBAL_ENABLED=false
WEBSOCKET_ENABLED=false

CONFIG_SESSION_PHONE_CLIENT=Nexa Official Agent
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30

LOG_LEVEL=ERROR,WARN,INFO,LOG,WEBHOOKS
LOG_BAILEYS=error
LOG_COLOR=true

CORS_ORIGIN=*
CORS_METHODS=GET,POST,PUT,DELETE
CORS_CREDENTIALS=true
LANGUAGE=en
EOF
  chmod 600 "$ENV_FILE"
fi

echo "==> Starting containers..."
cd "$TARGET_DIR"
docker compose pull
docker compose up -d

echo "==> Container status"
docker compose ps

echo
echo "==> Local service test"
sleep 3
curl -sS -i http://127.0.0.1:8080/ | head -n 20 || true

echo
echo "Evolution API bootstrap completed."
echo "Secrets remain only in: $ENV_FILE"
echo "To view your Evolution API key on the Droplet only, run:"
echo "  grep '^AUTHENTICATION_API_KEY=' $ENV_FILE"
echo "To view logs, run:"
echo "  cd $TARGET_DIR && docker compose logs -f evolution-api"
echo "Do not run: docker compose down -v  (it deletes persistent WhatsApp/session data)."
