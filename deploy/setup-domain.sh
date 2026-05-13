#!/bin/bash
# Run on the droplet as root after the domain DNS has propagated.
# Usage: bash setup-domain.sh
set -euo pipefail

DOMAIN="agent.expessnetsolutions.co.ke"
APP_DIR="/var/www/expresnet-agent"
EMAIL="elijahalex62@gmail.com"

echo "==> [1/5] Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

echo "==> [2/5] Updating Nginx server_name..."
cat > /etc/nginx/sites-available/expresnet-agent << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    # Redirect HTTP → HTTPS
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # Serve React frontend static files
    root ${APP_DIR}/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Proxy API calls to Express backend
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Proxy WhatsApp webhook to Express backend
    location /webhook {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://localhost:3001;
    }
}
NGINXEOF

echo "==> [3/5] Obtaining SSL certificate from Let's Encrypt..."
certbot certonly --nginx \
  --non-interactive \
  --agree-tos \
  --email "${EMAIL}" \
  -d "${DOMAIN}"

nginx -t && systemctl reload nginx

echo "==> [4/5] Updating .env files to use HTTPS domain..."
# Backend: update FRONTEND_URL
sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" "${APP_DIR}/backend/.env"

# Frontend: update API URL and rebuild
sed -i "s|VITE_API_URL=.*|VITE_API_URL=https://${DOMAIN}/api|" "${APP_DIR}/frontend/.env"

cd "${APP_DIR}/frontend"
npm install
npm run build

echo "==> [5/5] Restarting backend..."
pm2 restart expresnet-backend

echo ""
echo "==========================================================="
echo "  DOMAIN SETUP COMPLETE"
echo "==========================================================="
echo "  App URL:       https://${DOMAIN}"
echo "  Webhook URL:   https://${DOMAIN}/webhook"
echo "  Health check:  https://${DOMAIN}/health"
echo "-----------------------------------------------------------"
echo "  Update your Meta WhatsApp webhook URL to:"
echo "  https://${DOMAIN}/webhook"
echo "==========================================================="
