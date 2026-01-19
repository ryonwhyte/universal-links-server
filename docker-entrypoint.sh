#!/bin/sh
set -e

# Ensure data and custom-templates directories exist and are writable
mkdir -p /app/data /app/custom-templates

# If running as root, fix ownership and switch to node user
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data /app/custom-templates
  # Run seed (creates admin user if not exists) then start server
  exec su-exec node sh -c "node dist/db/seed.js && node dist/index.js"
else
  # Run seed (creates admin user if not exists) then start server
  node dist/db/seed.js
  exec node dist/index.js
fi
