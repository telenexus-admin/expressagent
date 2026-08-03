#!/bin/bash
# Server setup script for expresnet-agent on Ubuntu (DigitalOcean)
# Runs as root on the droplet after project files are uploaded to /tmp/expresnet-agent.tar.gz
set -euo pipefail

APP_DIR="/var/www/expresnet-agent"
DB_NAME="whatsapp_support"
DB_PASS="${DB_PASS:?Export DB_PASS before running this setup script}"
SERVER_IP="139.59.36.247"

META_VERIFY_TOKEN="${META_VERIFY_TOKEN:?Export META_VERIFY_TOKEN before running this setup script}"
META_ACCESS_TOKEN="${META_ACCESS_TOKEN:?Export META_ACCESS_TOKEN before running this setup script}"
META_PHONE_NUMBER_ID="${META_PHONE_NUMBER_ID:?Export META_PHONE_NUMBER_ID before running this setup script}"
OPENAI_API_KEY="${OPENAI_API_KEY:?Export OPENAI_API_KEY before running this setup script}"
JWT_SECRET="${JWT_SECRET:?Export JWT_SECRET before running this setup script}"

echo "==> [1/9] Updating system packages..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "==> [2/9] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> [3/9] Installing PostgreSQL, Nginx, and utilities..."
apt-get install -y postgresql postgresql-contrib nginx

echo "==> [4/9] Installing PM2 process manager..."
npm install -g pm2

echo "==> [5/9] Configuring PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '${DB_PASS}';"
sudo -u postgres createdb "${DB_NAME}" 2>/dev/null || echo "  Database '${DB_NAME}' already exists, skipping."

echo "==> [6/9] Extracting application files to ${APP_DIR}..."
rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}"
tar -xzf /tmp/expresnet-agent.tar.gz -C "${APP_DIR}"

echo "==> Writing backend .env..."
cat > "${APP_DIR}/backend/.env" << ENVEOF
META_VERIFY_TOKEN=${META_VERIFY_TOKEN}
META_ACCESS_TOKEN=${META_ACCESS_TOKEN}
META_PHONE_NUMBER_ID=${META_PHONE_NUMBER_ID}
OPENAI_API_KEY=${OPENAI_API_KEY}
DATABASE_URL=postgresql://postgres:${DB_PASS}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
PORT=3001
FRONTEND_URL=http://139.59.36.247
ENVEOF

echo "==> Writing frontend .env..."
cat > "${APP_DIR}/frontend/.env" << 'ENVEOF'
VITE_API_URL=http://139.59.36.247/api
ENVEOF

echo "==> [7/9] Installing npm dependencies and building frontend..."
cd "${APP_DIR}/backend" && npm install --omit=dev
cd "${APP_DIR}/frontend" && npm install && npm run build

echo "==> Initializing database schema and seeding default admin..."
cd "${APP_DIR}/backend" && npm run db:init && npm run db:seed

echo "==> [8/9] Configuring Nginx reverse proxy..."
cat > /etc/nginx/sites-available/expresnet-agent << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;

    # Serve React frontend static files
    root /var/www/expresnet-agent/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to Express backend
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Proxy WhatsApp webhook to Express backend
    location /webhook {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /health {
        proxy_pass http://localhost:3001;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/expresnet-agent /etc/nginx/sites-enabled/expresnet-agent
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

echo "==> [9/9] Starting backend with PM2..."
cd "${APP_DIR}/backend"
pm2 delete expresnet-backend 2>/dev/null || true
pm2 start src/server.js --name expresnet-backend
pm2 save

# Set PM2 to start on reboot
startup_cmd=$(pm2 startup systemd -u root --hp /root 2>&1 | grep -E "^sudo|sudo env")
if [ -n "$startup_cmd" ]; then
    eval "$startup_cmd" || true
fi
systemctl enable pm2-root 2>/dev/null || true

echo ""
echo "==========================================================="
echo "  DEPLOYMENT COMPLETE"
echo "==========================================================="
echo "  App URL:       http://${SERVER_IP}"
echo "  Webhook URL:   http://${SERVER_IP}/webhook"
echo "  Health check:  http://${SERVER_IP}/health"
echo "-----------------------------------------------------------"
echo "  Admin login:   configured by the database seed"
echo "  Password:      supplied through the seed configuration"
echo "-----------------------------------------------------------"
echo "  WhatsApp webhook verify token: supplied through META_VERIFY_TOKEN"
echo "  (Enter this in Meta Developer Console -> Webhooks)"
echo "==========================================================="
