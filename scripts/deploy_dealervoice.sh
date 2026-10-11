#!/usr/bin/env bash
# Deploys/updates DealerVoice on the Google Cloud VM, next to n8n.
# Upload dealervoice.tar.gz with SSH-in-browser "UPLOAD FILE", then run:  bash deploy_dealervoice.sh
set -euo pipefail

IP=$(curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
APP_DOMAIN="app.${IP//./-}.sslip.io"

test -f ~/dealervoice.tar.gz || { echo "dealervoice.tar.gz not found in home folder. Upload it first."; exit 1; }

echo ">>> Unpacking app..."
rm -rf ~/dealervoice && mkdir -p ~/dealervoice
tar -xzf ~/dealervoice.tar.gz -C ~/dealervoice

cd ~/n8n

# Add the app service to the existing n8n compose file (only once).
if ! grep -q "dealervoice:" docker-compose.yml; then
  echo ">>> Adding DealerVoice to docker-compose.yml..."
  awk '
    /^volumes:/ && !done {
      print "  dealervoice:"
      print "    build: ../dealervoice"
      print "    restart: unless-stopped"
      print "    env_file: ../dealervoice/.env.production"
      print ""
      done=1
    }
    { print }
  ' docker-compose.yml > docker-compose.tmp && mv docker-compose.tmp docker-compose.yml
fi

# Route app.<ip>.sslip.io to the app (only once). Caddy gets the HTTPS certificate automatically.
if ! grep -q "$APP_DOMAIN" Caddyfile; then
  echo ">>> Adding $APP_DOMAIN to Caddy..."
  printf '\n%s {\n  reverse_proxy dealervoice:3000\n}\n' "$APP_DOMAIN" >> Caddyfile
fi

echo ">>> Building and starting DealerVoice (first time takes 3-5 minutes)..."
sudo docker compose up -d --build dealervoice
sudo docker compose restart caddy

echo ""
echo "======================================================"
echo " Done! DealerVoice is live at (wait ~1 minute first):"
echo "   https://${APP_DOMAIN}"
echo "======================================================"
