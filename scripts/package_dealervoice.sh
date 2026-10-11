#!/usr/bin/env bash
# Run on your Mac. Creates dealervoice.tar.gz (app code + production settings) to upload to the VM.
set -euo pipefail
cd "$(dirname "$0")/../web"
cp .env.local .env.production
# --no-xattrs / COPYFILE_DISABLE: leave out macOS file labels that Linux tar warns about.
COPYFILE_DISABLE=1 tar --no-xattrs --exclude=node_modules --exclude=.next --exclude=.git --exclude=.env.local --exclude=.DS_Store \
  -czf ../dealervoice.tar.gz .
rm .env.production
echo "Created $(cd .. && pwd)/dealervoice.tar.gz"
