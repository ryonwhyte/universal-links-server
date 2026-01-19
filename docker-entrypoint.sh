#!/bin/sh
set -e

# Ensure data and custom-templates directories exist and are writable
mkdir -p /app/data /app/custom-templates

# If running as root, fix ownership and switch to node user
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data /app/custom-templates
  exec su-exec node node dist/index.js
else
  exec node dist/index.js
fi
