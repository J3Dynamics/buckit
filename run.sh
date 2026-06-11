#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Starting Buckit on http://localhost:8234"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install --silent
fi

if [ "${1:-dev}" = "dev" ]; then
  npm run dev
else
  npm run build && npm start
fi
