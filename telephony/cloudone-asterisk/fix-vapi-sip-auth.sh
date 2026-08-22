#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/etc/nexa-cloudone"
VAPI_ENV="/etc/nexa-platform/vapi-outbound.env"
VAPI_SIP_ENV="${RUNTIME_DIR}/vapi-sip.env"
VAPI_AUTH_ENV="${RUNTIME_DIR}/vapi-sip-auth.env"
PJSIP_FILE="/etc/asterisk/pjsip_nexa_cloudone.conf"
VAPI_API_BASE="${VAPI_API_BASE:-https://api.vapi.ai}"
VAPI_SIP_HOST="${VAPI_SIP_HOST:-sip.vapi.ai}"
VAPI_AUTH_USER="${VAPI_AUTH_USER:-nexa-cloudone-254207913950}"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root."
[[ -r "$VAPI_ENV" ]] || die "Missing $VAPI_ENV"
[[ -r "$VAPI_SIP_ENV" ]] || die "Missing $VAPI_SIP_ENV"
[[ -r "$PJSIP_FILE" ]] || die "Missing $PJSIP_FILE"

set -a
# shellcheck disable=SC1090
source "$VAPI_ENV"
# shellcheck disable=SC1090
source "$VAPI_SIP_ENV"
set +a

[[ -n "${VAPI_PRIVATE_API_KEY:-}" ]] || die "VAPI_PRIVATE_API_KEY is missing"
[[ -n "${VAPI_ALERT_ASSISTANT_ID:-}" ]] || die "VAPI_ALERT_ASSISTANT_ID is missing"
[[ -n "${VAPI_SIP_PHONE_NUMBER_ID:-}" ]] || die "VAPI_SIP_PHONE_NUMBER_ID is missing"
[[ -n "${VAPI_SIP_URI:-}" ]] || die "VAPI_SIP_URI is missing"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

if [[ -r "$VAPI_AUTH_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$VAPI_AUTH_ENV"
fi

if [[ -z "${VAPI_SIP_AUTH_PASSWORD:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    VAPI_SIP_AUTH_PASSWORD="$(openssl rand -hex 32)"
  else
    VAPI_SIP_AUTH_PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  fi
fi

VAPI_SIP_AUTH_REALM="${VAPI_SIP_AUTH_REALM:-$VAPI_SIP_HOST}"

umask 077
{
  printf 'VAPI_SIP_AUTH_USERNAME=%q\n' "$VAPI_AUTH_USER"
  printf 'VAPI_SIP_AUTH_PASSWORD=%q\n' "$VAPI_SIP_AUTH_PASSWORD"
  printf 'VAPI_SIP_AUTH_REALM=%q\n' "$VAPI_SIP_AUTH_REALM"
} > "$VAPI_AUTH_ENV"
chmod 600 "$VAPI_AUTH_ENV"

log "Securing the existing Vapi SIP URI with explicit digest credentials"

payload="$(jq -cn \
  --arg sipUri "$VAPI_SIP_URI" \
  --arg assistantId "$VAPI_ALERT_ASSISTANT_ID" \
  --arg realm "$VAPI_SIP_AUTH_REALM" \
  --arg username "$VAPI_AUTH_USER" \
  --arg password "$VAPI_SIP_AUTH_PASSWORD" \
  '{provider:"vapi",sipUri:$sipUri,assistantId:$assistantId,authentication:{realm:$realm,username:$username,password:$password}}')"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

code="$(curl -sS -o "$tmp" -w '%{http_code}' \
  -X PATCH "${VAPI_API_BASE%/}/phone-number/${VAPI_SIP_PHONE_NUMBER_ID}" \
  -H "Authorization: Bearer ${VAPI_PRIVATE_API_KEY}" \
  -H 'Content-Type: application/json' \
  --data "$payload")"

if (( code < 200 || code >= 300 )); then
  echo "Vapi PATCH failed with HTTP $code" >&2
  jq -r '.message // .error // "Unknown Vapi error"' "$tmp" 2>/dev/null >&2 || true
  exit 1
fi

jq -e --arg id "$VAPI_SIP_PHONE_NUMBER_ID" '.id == $id' "$tmp" >/dev/null \
  || die "Vapi returned an unexpected phone-number resource"

log "Adding matching outbound digest authentication to Asterisk"

python3 - "$PJSIP_FILE" "$VAPI_AUTH_USER" "$VAPI_SIP_AUTH_PASSWORD" "$VAPI_SIP_AUTH_REALM" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
username = sys.argv[2]
password = sys.argv[3]
realm = sys.argv[4]
text = path.read_text()

# Remove any previous managed vapi-auth block so this is repeatable.
text = re.sub(
    r'(?ms)^\[vapi-auth\]\n.*?(?=^\[|\Z)',
    '',
    text,
)

auth_block = (
    '[vapi-auth]\n'
    'type=auth\n'
    'auth_type=userpass\n'
    f'username={username}\n'
    f'password={password}\n'
    f'realm={realm}\n\n'
)

anchor = '[vapi-aor]'
if anchor not in text:
    raise SystemExit('ABORT: [vapi-aor] was not found in PJSIP config')
text = text.replace(anchor, auth_block + anchor, 1)

m = re.search(r'(?ms)^\[vapi-endpoint\]\n(.*?)(?=^\[|\Z)', text)
if not m:
    raise SystemExit('ABORT: [vapi-endpoint] was not found in PJSIP config')
body = m.group(1)
if re.search(r'(?m)^outbound_auth=', body):
    body = re.sub(r'(?m)^outbound_auth=.*$', 'outbound_auth=vapi-auth', body)
else:
    body = 'outbound_auth=vapi-auth\n' + body
text = text[:m.start(1)] + body + text[m.end(1):]

path.write_text(text)
PY

chown root:asterisk "$PJSIP_FILE"
chmod 640 "$PJSIP_FILE"

log "Restarting Asterisk"
systemctl restart asterisk
sleep 4
systemctl is-active --quiet asterisk || die "Asterisk failed to restart"

echo
asterisk -rx 'pjsip show endpoint vapi-endpoint' \
  | grep -E 'Endpoint:|OutAuth:|Aor:|Contact:' || true

echo
asterisk -rx 'pjsip show registrations' || true

echo
cat <<EOF
==================================================
 VAPI SIP AUTH FIX APPLIED
==================================================
Vapi SIP phone-number: ${VAPI_SIP_PHONE_NUMBER_ID}
Vapi SIP URI:          ${VAPI_SIP_URI}
Digest realm:          ${VAPI_SIP_AUTH_REALM}
Asterisk auth object:  vapi-auth
Secret storage:        ${VAPI_AUTH_ENV}
Password displayed:    NO
==================================================
Call 020 7913950 again and watch the Asterisk console.
A successful Vapi leg should challenge with 401, then Asterisk
must resend the INVITE with Authorization and receive a success/ringing response.
EOF

unset VAPI_PRIVATE_API_KEY VAPI_SIP_AUTH_PASSWORD
