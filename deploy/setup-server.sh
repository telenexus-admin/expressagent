#!/bin/bash
# Run this script on the DigitalOcean droplet as root (or with sudo)
set -e

echo "=== Updating system ==="
apt-get update && apt-get upgrade -y

echo "=== Installing Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "=== Installing Docker & Docker Compose ==="
apt-get install -y docker.io docker-compose
systemctl enable docker
systemctl start docker

echo "=== Installing PM2 (process manager) ==="
npm install -g pm2

echo "=== Installing Nginx ==="
apt-get install -y nginx
systemctl enable nginx

echo "=== Done. Now upload the project files and run setup-app.sh ==="
