#!/usr/bin/env bash
set -euo pipefail

PHONE_DOMAIN="${PHONE_DOMAIN:-phone.polyizon.tech}"
PUBLIC_IP="${PUBLIC_IP:-169.58.177.113}"
PHONE_EXTENSION="${PHONE_EXTENSION:-7001}"
PANEL_PORT="${PANEL_PORT:-3015}"
PANEL_USER="${PANEL_USER:-phoneadmin}"
APP_ROOT="/opt/nexa-phone-panel"
RUNTIME_DIR="/etc/nexa-phone-panel"
ENV_FILE="${RUNTIME_DIR}/panel.env"
HTPASSWD_FILE="/etc/nginx/.nexa-phone-panel.htpasswd"
PJSIP_MAIN="/etc/asterisk/pjsip.conf"
PJSIP_PHONE="/etc/asterisk/pjsip_nexa_phone.conf"
EXT_MAIN="/etc/asterisk/extensions.conf"
EXT_PHONE="/etc/asterisk/extensions_nexa_phone.conf"
EXT_CLOUDONE="/etc/asterisk/extensions_nexa_cloudone.conf"
HTTP_CONF="/etc/asterisk/http.conf"
CDR_CONF="/etc/asterisk/cdr.conf"
NGINX_SITE="/etc/nginx/sites-available/nexa-phone-panel"
NGINX_LINK="/etc/nginx/sites-enabled/nexa-phone-panel"
SERVICE_FILE="/etc/systemd/system/nexa-phone-panel.service"
BACKUP_ROOT="/var/backups/nexa-phone-panel"

DID_951="254207913951"
DID_952="254207913952"
DID_953="254207913953"

VAPI_951_HOST=159d05a6-196a-4c7b-99ce-cfb92594cbbd.sip.vapi.ai
log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

for required in "$PJSIP_MAIN" "$EXT_MAIN" "$EXT_CLOUDONE"; do
  [[ -f "$required" ]] || die "Required Asterisk file is missing: $required"
done

log "Checking DNS for ${PHONE_DOMAIN}"
resolved="$(getent ahostsv4 "$PHONE_DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
if [[ -z "$resolved" ]]; then
  cat <<EOF
${PHONE_DOMAIN} does not resolve yet.
Create this DNS record first, then rerun the installer:

  Type: A
  Name: phone
  Value: ${PUBLIC_IP}

No phone-panel changes were made.
EOF
  exit 2
fi
printf 'DNS resolves to: %s\n' "$resolved"

if grep -RqsE "server_name[[:space:]]+${PHONE_DOMAIN//./\\.}([[:space:];]|$)" /etc/nginx/sites-enabled 2>/dev/null \
  && [[ ! -L "$NGINX_LINK" ]]; then
  die "Another enabled Nginx site already owns ${PHONE_DOMAIN}. Review it before installing."
fi

log "Installing phone-panel dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx apache2-utils nodejs npm openssl

mkdir -p "$RUNTIME_DIR" "$BACKUP_ROOT"
chmod 700 "$RUNTIME_DIR"

stamp="$(date '+%Y%m%d-%H%M%S')"
backup_dir="${BACKUP_ROOT}/${stamp}"
mkdir -p "$backup_dir"
cp -a "$PJSIP_MAIN" "$EXT_MAIN" "$EXT_CLOUDONE" "$backup_dir/"
[[ -f "$HTTP_CONF" ]] && cp -a "$HTTP_CONF" "$backup_dir/"
[[ -f "$CDR_CONF" ]] && cp -a "$CDR_CONF" "$backup_dir/"
[[ -f "$PJSIP_PHONE" ]] && cp -a "$PJSIP_PHONE" "$backup_dir/"
[[ -f "$EXT_PHONE" ]] && cp -a "$EXT_PHONE" "$backup_dir/"
[[ -f "$NGINX_SITE" ]] && cp -a "$NGINX_SITE" "$backup_dir/"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PANEL_SIP_PASSWORD="${PANEL_SIP_PASSWORD:-$(openssl rand -hex 24)}"

umask 077
cat > "$ENV_FILE" <<EOF
PANEL_DOMAIN=${PHONE_DOMAIN}
PANEL_BIND_HOST=127.0.0.1
PANEL_PORT=${PANEL_PORT}
PANEL_EXTENSION=${PHONE_EXTENSION}
PANEL_SIP_USERNAME=${PHONE_EXTENSION}
PANEL_SIP_PASSWORD=${PANEL_SIP_PASSWORD}
PANEL_DISPLAY_NAME=Nexa Phone
ASTERISK_CDR_CSV=/var/log/asterisk/cdr-csv/Master.csv
EOF
chmod 600 "$ENV_FILE"

log "Building the lightweight browser phone"
npm install --no-audit --no-fund
npm run build

rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT"
cp -a dist "$APP_ROOT/dist"
cp -a server.js package.json "$APP_ROOT/"
chown -R root:root "$APP_ROOT"
chmod -R a+rX "$APP_ROOT"

log "Configuring Asterisk HTTP WebSocket service"
python3 - "$HTTP_CONF" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text() if path.exists() else '[general]\n'
if not re.search(r'(?mi)^\s*\[general\]\s*$', text):
    text += '\n[general]\n'

start = re.search(r'(?mi)^\s*\[general\]\s*$', text)
assert start
next_section = re.search(r'(?mi)^\s*\[[^]]+\]\s*$', text[start.end():])
end = start.end() + (next_section.start() if next_section else len(text[start.end():]))
block = text[start.end():end]

def upsert(block, key, value):
    pattern = rf'(?mi)^\s*{re.escape(key)}\s*=.*$'
    if re.search(pattern, block):
        return re.sub(pattern, f'{key}={value}', block, count=1)
    return block + f'\n{key}={value}\n'

block = upsert(block, 'enabled', 'yes')
if not re.search(r'(?mi)^\s*bindaddr\s*=', block):
    block = upsert(block, 'bindaddr', '127.0.0.1')
if not re.search(r'(?mi)^\s*bindport\s*=', block):
    block = upsert(block, 'bindport', '8088')

path.write_text(text[:start.end()] + block + text[end:])
PY

ASTERISK_HTTP_PORT="$(awk '
  BEGIN{in_general=0}
  /^[[:space:]]*\[general\][[:space:]]*$/{in_general=1; next}
  /^[[:space:]]*\[/{if(in_general) exit}
  in_general && /^[[:space:]]*bindport[[:space:]]*=/{gsub(/^[^=]*=[[:space:]]*/, ""); gsub(/[[:space:]]*;.*/, ""); print; exit}
' "$HTTP_CONF")"
ASTERISK_HTTP_PORT="${ASTERISK_HTTP_PORT:-8088}"

log "Creating the dedicated WebRTC extension ${PHONE_EXTENSION}"
cat > "$PJSIP_PHONE" <<EOF
; Managed by Nexa CloudOne Phone Panel V1
[nexa-phone-ws]
type=transport
protocol=ws
bind=0.0.0.0

[${PHONE_EXTENSION}]
type=auth
auth_type=userpass
username=${PHONE_EXTENSION}
password=${PANEL_SIP_PASSWORD}

[${PHONE_EXTENSION}]
type=aor
max_contacts=3
remove_existing=yes

[${PHONE_EXTENSION}]
type=endpoint
transport=nexa-phone-ws
context=from-nexa-phone
disallow=all
allow=ulaw
allow=alaw
aors=${PHONE_EXTENSION}
auth=${PHONE_EXTENSION}
webrtc=yes
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
EOF
chown root:asterisk "$PJSIP_PHONE"
chmod 640 "$PJSIP_PHONE"

grep -Fqx '#include pjsip_nexa_phone.conf' "$PJSIP_MAIN" || printf '\n#include pjsip_nexa_phone.conf\n' >> "$PJSIP_MAIN"

log "Creating phone inbound/outbound dialplan"
cat > "$EXT_PHONE" <<EOF
; Managed by Nexa CloudOne Phone Panel V1
[nexa-phone-inbound]
exten => ${DID_951},1,NoOp(Nexa Phone incoming ${DID_951})
 same => n,Set(CDR(userfield)=INDID:${DID_951})
 same => n,Answer()
 same => n,NoOp(Forwarding 0207913951 to its dedicated Vapi inbound assistant)
 same => n,Dial(PJSIP/vapi-951-endpoint/sip:+254207913951@159d05a6-196a-4c7b-99ce-cfb92594cbbd.sip.vapi.ai:5060,90)
 same => n,Hangup()

exten => ${DID_952},1,NoOp(Nexa Phone incoming ${DID_952})
 same => n,Set(CDR(userfield)=INDID:${DID_952})
 same => n,Dial(PJSIP/${PHONE_EXTENSION},45)
 same => n,Hangup()

exten => ${DID_953},1,NoOp(Nexa Phone incoming ${DID_953})
 same => n,Set(CDR(userfield)=INDID:${DID_953})
 same => n,Dial(PJSIP/${PHONE_EXTENSION},45)
 same => n,Hangup()

[from-nexa-phone]
exten => _951254X.,1,NoOp(Nexa Phone outbound via ${DID_951})
 same => n,Set(DEST=\${EXTEN:3})
 same => n,Set(CALLERID(num)=${DID_951})
 same => n,Set(CDR(userfield)=OUTDID:${DID_951})
 same => n,Dial(PJSIP/\${DEST}@cloudone-endpoint,60)
 same => n,Hangup()

exten => _952254X.,1,NoOp(Nexa Phone outbound via ${DID_952})
 same => n,Set(DEST=\${EXTEN:3})
 same => n,Set(CALLERID(num)=${DID_952})
 same => n,Set(CDR(userfield)=OUTDID:${DID_952})
 same => n,Dial(PJSIP/\${DEST}@cloudone-endpoint,60)
 same => n,Hangup()

exten => _953254X.,1,NoOp(Nexa Phone outbound via ${DID_953})
 same => n,Set(DEST=\${EXTEN:3})
 same => n,Set(CALLERID(num)=${DID_953})
 same => n,Set(CDR(userfield)=OUTDID:${DID_953})
 same => n,Dial(PJSIP/\${DEST}@cloudone-endpoint,60)
 same => n,Hangup()
EOF
chown root:asterisk "$EXT_PHONE"
chmod 640 "$EXT_PHONE"

grep -Fqx '#include extensions_nexa_phone.conf' "$EXT_MAIN" || printf '\n#include extensions_nexa_phone.conf\n' >> "$EXT_MAIN"

log "Routing DID 951 to Nexa AI and DIDs 952-953 to the web phone"
python3 - "$EXT_CLOUDONE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()
for did in ('254207913951', '254207913952', '254207913953'):
    pattern = rf'(?m)^exten\s*=>\s*{did},1,.*$'
    replacement = f'exten => {did},1,Goto(nexa-phone-inbound,{did},1)'
    if re.search(pattern, text):
        text = re.sub(pattern, replacement, text, count=1)
    else:
        raise SystemExit(f'ABORT: inbound DID {did} was not found in CloudOne dialplan')
path.write_text(text)
PY
chown root:asterisk "$EXT_CLOUDONE"
chmod 640 "$EXT_CLOUDONE"

log "Ensuring Asterisk CDR CSV history is enabled"
python3 - "$CDR_CONF" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text() if path.exists() else '[general]\n'
if not re.search(r'(?mi)^\s*\[general\]\s*$', text):
    text += '\n[general]\n'
start = re.search(r'(?mi)^\s*\[general\]\s*$', text)
next_section = re.search(r'(?mi)^\s*\[[^]]+\]\s*$', text[start.end():])
end = start.end() + (next_section.start() if next_section else len(text[start.end():]))
block = text[start.end():end]
if re.search(r'(?mi)^\s*enable\s*=', block):
    block = re.sub(r'(?mi)^\s*enable\s*=.*$', 'enable=yes', block, count=1)
else:
    block += '\nenable=yes\n'
path.write_text(text[:start.end()] + block + text[end:])
PY

log "Installing isolated phone-panel service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nexa CloudOne Phone Panel
After=network-online.target asterisk.service
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
SupplementaryGroups=asterisk
WorkingDirectory=${APP_ROOT}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_ROOT}/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=/var/log/asterisk

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nexa-phone-panel.service

if [[ ! -f "$HTPASSWD_FILE" ]]; then
  log "Creating the web-panel login"
  echo "Choose a password for browser login user: ${PANEL_USER}"
  echo "This is NOT the SIP trunk password."
  htpasswd -c -B "$HTPASSWD_FILE" "$PANEL_USER"
fi
chmod 640 "$HTPASSWD_FILE"
chown root:www-data "$HTPASSWD_FILE"

log "Configuring Nginx for ${PHONE_DOMAIN}"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PHONE_DOMAIN};

    location /ws {
        proxy_pass http://127.0.0.1:${ASTERISK_HTTP_PORT}/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    location / {
        auth_basic "Nexa Phone";
        auth_basic_user_file ${HTPASSWD_FILE};
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sfn "$NGINX_SITE" "$NGINX_LINK"
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full' >/dev/null || true
fi

log "Restarting Asterisk with WebRTC support"
systemctl restart asterisk
sleep 4
systemctl is-active --quiet asterisk || die "Asterisk failed to restart"
asterisk -rx 'module load cdr_csv.so' >/dev/null 2>&1 || true

log "Requesting/refreshing HTTPS certificate"
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  certbot --nginx -d "$PHONE_DOMAIN" --redirect --non-interactive --agree-tos -m "$CERTBOT_EMAIL"
else
  certbot --nginx -d "$PHONE_DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email
fi

nginx -t
systemctl reload nginx

log "Verification"
echo
systemctl is-active nexa-phone-panel.service
systemctl is-active asterisk
echo
asterisk -rx "pjsip show endpoint ${PHONE_EXTENSION}" | grep -E 'Endpoint:|Aor:|Auth:|Transport:' || true
echo
asterisk -rx 'pjsip show registrations' || true
echo
asterisk -rx 'http show status' | head -12 || true
echo
curl -fsS -u "${PANEL_USER}:$(true)" "http://127.0.0.1:${PANEL_PORT}/api/health" 2>/dev/null || curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health" || true

echo
cat <<EOF
============================================================
 NEXA PHONE PANEL V1 INSTALLED
============================================================
Web panel:           https://${PHONE_DOMAIN}
Browser login user:  ${PANEL_USER}
WebRTC extension:    ${PHONE_EXTENSION}
Nexa AI DID:         254207913950 (UNCHANGED)
Phone DIDs:
  254207913951
  254207913952
  254207913953
CloudOne secret:     NOT EXPOSED TO BROWSER
SIP password shown:  NO
Backup:              ${backup_dir}
============================================================
Open the panel in Chrome/Edge, allow microphone access,
and keep the page open to receive V1 browser calls.
EOF

unset PANEL_SIP_PASSWORD
