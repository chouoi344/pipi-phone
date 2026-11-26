#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! node -e "if(require('sharp/package.json').version!==require('./package.json').dependencies.sharp)process.exit(1);require('sharp')" >/dev/null 2>&1; then
  npm ci --omit=dev --no-audit --no-fund
fi
exec node server.cjs
