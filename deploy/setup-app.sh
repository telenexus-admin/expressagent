#!/bin/bash
# Run this on the droplet after uploading project files to /var/www/whatsapp-agent
set -e

APP_DIR="/var/www/whatsapp-agent"

echo "=== Starting PostgreSQL via Docker Compose ==="
cd "$APP_DIR"
docker-compose up -d
echo "Waiting for PostgreSQL to be ready..."
sleep 10

echo "=== Installing backend dependencies ==="
cd "$APP_DIR/backend"
npm install --production

echo "=== Setting up database ==="
npm run db:init
npm run db:seed

echo "=== Building frontend ==="
cd "$APP_DIR/frontend"
npm install
npm run build

echo "=== Configuring Nginx ==="
cat > /etc/nginx/sites-available/whatsapp-agent << 'NGINX_CONF'
server {
    listen 80;
    server_name _;

    # Serve built frontend
    root /var/www/whatsapp-agent/frontend/dist;
    index index.html;

    # Frontend SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # WhatsApp webhook
    location /webhook {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINX_CONF

ln -sf /etc/nginx/sites-available/whatsapp-agent /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Starting backend with PM2 ==="
cd "$APP_DIR/backend"
pm2 start src/server.js --name whatsapp-backend
pm2 save
pm2 startup systemd -u root --hp /root

echo "=== Deployment complete! ==="
echo "App is running at http://$(curl -s ifconfig.me)"
