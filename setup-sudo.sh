#!/bin/bash
# =============================================================================
# OpenVoiceUI — generic sudo setup script
# Creates: nginx config, Let's Encrypt SSL, systemd service, prestart script
# Run as: sudo bash setup-sudo.sh
# =============================================================================
set -e

# ── Configure these before running ──────────────────────────────────────────
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="your-domain.com"        # ← EDIT: your actual domain
PORT=5001                        # ← match PORT in your .env (default: 5001)
EMAIL="your@email.com"           # ← EDIT: for Let's Encrypt notifications
SERVICE_NAME="openvoiceui"
RUN_USER="${SUDO_USER:-$(whoami)}"
WWW_DIR="/var/www/${SERVICE_NAME}"          # canvas pages + any web assets
# ────────────────────────────────────────────────────────────────────────────

# Guard: refuse to run with placeholder values
if [ "$DOMAIN" = "your-domain.com" ] || [ "$EMAIL" = "your@email.com" ]; then
    echo "ERROR: Edit DOMAIN and EMAIL at the top of this script before running."
    echo "       Open setup-sudo.sh in a text editor and set your real domain and email."
    exit 1
fi

# Check .env exists
if [ ! -f "${INSTALL_DIR}/.env" ]; then
    echo "ERROR: No .env file found at ${INSTALL_DIR}/.env"
    echo "       Run: cp ${INSTALL_DIR}/.env.example ${INSTALL_DIR}/.env"
    echo "       Then edit .env and set your API keys before running this script."
    exit 1
fi

# Check OpenClaw gateway configuration
OPENCLAW_TOKEN=$(grep -E "^CLAWDBOT_AUTH_TOKEN=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
if [ -z "$OPENCLAW_TOKEN" ] || [ "$OPENCLAW_TOKEN" = "your-openclaw-gateway-token" ]; then
    echo ""
    echo "⚠️  OpenClaw gateway not configured."
    echo "   OpenClaw is the AI backend that powers all voice conversations."
    echo "   Without it the server will start but cannot respond to anyone."
    echo ""
    echo "   To set up OpenClaw:"
    echo "   1. Download and install OpenClaw: https://openclaw.ai"
    echo "   2. Start the OpenClaw service (it runs on ws://127.0.0.1:18791 by default)"
    echo "   3. Copy your auth token into .env:"
    echo "        CLAWDBOT_AUTH_TOKEN=your-token-here"
    echo "   4. Re-run this script"
    echo ""
    printf "   Continue setup without OpenClaw configured? [y/N] "
    read -r REPLY
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping. Configure OpenClaw first, then re-run this script."
        exit 1
    fi
    echo "   Continuing — remember to configure OpenClaw before using the voice agent."
else
    OPENCLAW_URL=$(grep -E "^CLAWDBOT_GATEWAY_URL=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
    echo "  ✓ OpenClaw token found. Gateway: ${OPENCLAW_URL:-ws://127.0.0.1:18791}"
fi
echo ""

echo "=== OpenVoiceUI setup: ${DOMAIN} on port ${PORT} ==="
echo "    Install dir : ${INSTALL_DIR}"
echo "    Service user: ${RUN_USER}"
echo "    WWW dir     : ${WWW_DIR}"
echo ""

# 0. Per-instance www directory (canvas pages, isolated from other users)
echo "[0/5] Creating www directory for ${RUN_USER}..."
mkdir -p "${WWW_DIR}/canvas-pages"
chown -R "${RUN_USER}:${RUN_USER}" "${WWW_DIR}"
chmod -R 755 "${WWW_DIR}"

# 1. Prestart script (kills stale process on port before service starts)
echo "[1/5] Creating prestart script..."
cat > /usr/local/bin/prestart-${SERVICE_NAME}.sh << PRESTART
#!/bin/bash
PORT=${PORT}
LOG=/var/log/${SERVICE_NAME}.log
PID=\$(fuser \${PORT}/tcp 2>/dev/null)
if [ -n "\$PID" ]; then
    echo "\$(date): Found stale process \$PID on port \$PORT, killing..." | tee -a \$LOG
    kill \$PID 2>/dev/null
    sleep 2
    if kill -0 \$PID 2>/dev/null; then
        kill -9 \$PID 2>/dev/null
        sleep 1
    fi
fi
exit 0
PRESTART
chmod +x /usr/local/bin/prestart-${SERVICE_NAME}.sh

# 2. Systemd service
echo "[2/5] Creating systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << SERVICE
[Unit]
Description=OpenVoiceUI Voice Agent (${DOMAIN})
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStartPre=/usr/local/bin/prestart-${SERVICE_NAME}.sh
ExecStart=${INSTALL_DIR}/venv/bin/python3 ${INSTALL_DIR}/server.py
Restart=always
RestartSec=10
Environment=PATH=/usr/bin:/usr/local/bin
EnvironmentFile=${INSTALL_DIR}/.env

[Install]
WantedBy=multi-user.target
SERVICE

# 3. Nginx config
echo "[3/5] Creating nginx config..."
cat > /etc/nginx/sites-available/${DOMAIN} << NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    client_max_body_size 100M;
}
NGINX

ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}

# 4. SSL cert
echo "[4/5] Obtaining SSL certificate..."
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    certbot certonly --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL}
else
    echo "  SSL cert already exists, skipping."
fi

# 5. Enable and start service
echo "[5/5] Enabling and starting service..."
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}.service
systemctl restart ${SERVICE_NAME}.service

sleep 3
systemctl status ${SERVICE_NAME}.service --no-pager

echo ""
echo "=== Done! OpenVoiceUI running at https://${DOMAIN} ==="
echo ""
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_NAME}"
echo "  sudo systemctl restart ${SERVICE_NAME}"
echo "  sudo journalctl -u ${SERVICE_NAME} -f"
