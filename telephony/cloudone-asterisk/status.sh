#!/usr/bin/env bash
set -euo pipefail

CLOUDONE_HOST="${CLOUDONE_HOST:-ls02.cloudone.co.ke}"
CLOUDONE_PORT="${CLOUDONE_PORT:-5060}"
PUBLIC_IP="${PUBLIC_IP:-169.58.177.113}"

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

echo "=================================================="
echo " NEXA CLOUDONE SIP GATEWAY STATUS"
echo "=================================================="

echo
echo "===== ASTERISK SERVICE ====="
systemctl --no-pager --full status asterisk | sed -n '1,16p' || true

echo
echo "===== CLOUDONE REGISTRATION ====="
asterisk -rx 'pjsip show registrations' || true

echo
echo "===== ENDPOINTS ====="
asterisk -rx 'pjsip show endpoints' | grep -E 'Endpoint:|cloudone|vapi' || true

echo
echo "===== CLOUDONE CONTACT ====="
asterisk -rx 'pjsip show aor cloudone-aor' || true

echo
echo "===== VAPI CONTACT ====="
asterisk -rx 'pjsip show aor vapi-aor' || true

echo
echo "===== SIP LISTENER ====="
ss -lunp | grep ':5060' || true

echo
echo "===== RECENT CALL / SIP LOGS ====="
journalctl -u asterisk --since '15 minutes ago' --no-pager \
  | grep -Ei 'PJSIP|cloudone|vapi|registration|invite|error|warning|failed|rejected' \
  | tail -100 || true

echo
echo "===== CONFIG ====="
echo "Registrar: ${CLOUDONE_HOST}:${CLOUDONE_PORT}/UDP"
echo "PBX IP:    ${PUBLIC_IP}"

if [[ -r /etc/nexa-cloudone/vapi-sip.env ]]; then
  # shellcheck disable=SC1091
  source /etc/nexa-cloudone/vapi-sip.env
  echo "Vapi URI:  ${VAPI_SIP_URI:-not configured}"
fi

echo "=================================================="
