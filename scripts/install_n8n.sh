#!/usr/bin/env bash
# Installs n8n with automatic HTTPS on a fresh Google Cloud VM (Ubuntu/Debian).
# Run inside the VM:  bash install.sh
set -euo pipefail

# Public IP of this VM -> free domain via sslip.io (e.g. 34-93-1-2.sslip.io)
IP=$(curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
DOMAIN="${IP//./-}.sslip.io"

echo ">>> Installing Docker..."
curl -fsSL https://get.docker.com | sudo sh

mkdir -p ~/n8n && cd ~/n8n

cat > docker-compose.yml <<EOF
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: unless-stopped
    environment:
      - N8N_HOST=${DOMAIN}
      - N8N_PROTOCOL=https
      - N8N_PORT=5678
      - WEBHOOK_URL=https://${DOMAIN}/
      - GENERIC_TIMEZONE=Asia/Kolkata
      - TZ=Asia/Kolkata
    volumes:
      - n8n_data:/home/node/.n8n

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data

volumes:
  n8n_data:
  caddy_data:
EOF

cat > Caddyfile <<EOF
${DOMAIN} {
  reverse_proxy n8n:5678
}
EOF

echo ">>> Starting n8n..."
sudo docker compose up -d

echo ""
echo "======================================================"
echo " Done! Open in your browser (wait ~1 minute first):"
echo "   https://${DOMAIN}"
echo "======================================================"
