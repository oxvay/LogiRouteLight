#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Installing dependencies..."
npm install

echo "==> Building..."
npm run build

echo "==> Restarting app..."
pm2 restart logiroute

echo "==> Done. Status:"
pm2 status logiroute
