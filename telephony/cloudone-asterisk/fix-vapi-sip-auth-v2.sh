#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/etc/nexa-cloudone"
VAPI_ENV="/etc/nexa-platform/vapi-outbound.env"
VAPI_SIP_ENV="${RUNTIME_DIR}/vapi-sip.env"
VAPI_AUTH_ENV="${RUNTIME_DIR}/vapi-sip-auth.env"
PJSIP_FILE="/etc/asterisk/pjsip_nexa_cloudone.conf"
EXT_FILE="/etc/asterisk/extensions_nexa_cloudone.conf"
VAPI_API_BASE="${VAPI_API_BASE:-https://api.vapi.ai}"
VAPI_SIP_HOST="${VAPI_SIP_HOST:-sip.vapi.ai}"
VAPI_SECURE_USER="${VAPI_SECURE_USER:-nexa-cloudone-254207913950-secure}"
VAPI_SECURE_URI="sip:${VAPI_SECURE_USER}@${VAPI_SIP_HOST}"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root."
[[ -r "$VAPI_ENV" ]] || die "Missing $VAPI_ENV"
[[ -r "$PJSIP_FILE" ]] || die "Missing $PJSIP_FILE"
[[ -r "$EXT_FILE" ]] || die "Missing $EXT_FILE"

set -a
# shellcheck disable=SC1090
source "$VAPI_ENV"
set +a

[[ -n "${VAPI_PRIVATE_API_KEY:-}" ]] || die "VAPI_PRIVATE_API_KEY is missing"
[[ -n "${VAPI_ALERT_ASSISTANT_ID:-}" ]] || die "VAPI_ALERT_ASSISTANT_ID is missing"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

if [[ -r "$VAPI_AUTH_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$VAPI_AUTH_ENV"
fi

VAPI_SIP_AUTH_USERNAME="${VAPI_SIP_AUTH_USERNAME:-$VAPI_SECURE_USER}"
VAPI_SIP_AUTH_REALM="${VAPI_SIP_AUTH_REALM:-$VAPI_SIP_HOST}"

if [[ -z "${VAPI_SIP_AUTH_PASSWORD:-}" ]]; then
  VAPI_SIP_AUTH_PASSWORD="$(openssl rand -hex 32)"
fi

umask 077
{
  printf 'VAPI_SIP_AUTH_USERNAME=%q\n' "$VAPI_SIP_AUTH_USERNAME"
  printf 'VAPI_SIP_AUTH_PASSWORD=%q\n' "$VAPI_SIP_AUTH_PASSWORD"
  printf 'VAPI_SIP_AUTH_REALM=%q\n' "$VAPI_SIP_AUTH_REALM"
} > "$VAPI_AUTH_ENV"
chmod 600 "$VAPI_AUTH_ENV"

api_get(){
  local url="$1"
  curl -fsS "$url" \
    -H "Authorization: Bearer ${VAPI_PRIVATE_API_KEY}" \
    -H 'Accept: application/json'
}

log "Looking for an existing secured Vapi SIP URI"
numbers="$(api_get "${VAPI_API_BASE%/}/phone-number?limit=1000")" \
  || die "Could not list Vapi phone numbers"

phone_id="$(printf '%s' "$numbers" | jq -r --arg uri "$VAPI_SECURE_URI" \
  '.[] | select(.provider == "vapi" and .sipUri == $uri) | .id' | head -n1)"

if [[ -z "$phone_id" || "$phone_id" == "null" ]]; then
  log "Creating a NEW secured Vapi SIP URI (POST, not PATCH)"

  payload="$(jq -cn \
    --arg sipUri "$VAPI_SECURE_URI" \
    --arg assistantId "$VAPI_ALERT_ASSISTANT_ID" \
    --arg realm "$VAPI_SIP_AUTH_REALM" \
    --arg username "$VAPI_SIP_AUTH_USERNAME" \
    --arg password "$VAPI_SIP_AUTH_PASSWORD" \
    '{provider:"vapi",name:"Nexa CloudOne Secure SIP Bridge",sipUri:$sipUri,assistantId:$assistantId,authentication:{realm:$realm,username:$username,password:$password}}')"

  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT

  code="$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "${VAPI_API_BASE%/}/phone-number" \
    -H "Authorization: Bearer ${VAPI_PRIVATE_API_KEY}" \
    -H 'Content-Type: application/json' \
    --data "$payload")"

  if (( code < 200 || code >= 300 )); then
    echo "Vapi secure SIP creation failed with HTTP $code" >&2
    jq -c '{message,error,statusCode,errors}' "$tmp" 2>/dev/null >&2 || cat "$tmp" >&2
    exit 1
  fi

  phone_id="$(jq -r '.id // empty' "$tmp")"
  [[ -n "$phone_id" ]] || die "Vapi did not return a phone-number ID"
else
  log "Secured Vapi SIP URI already exists; reusing it"
fi

umask 077
{
  printf 'VAPI_SIP_PHONE_NUMBER_ID=%q\n' "$phone_id"
  printf 'VAPI_SIP_URI=%q\n' "$VAPI_SECURE_URI"
  printf 'VAPI_SIP_HOST=%q\n' "$VAPI_SIP_HOST"
  printf 'VAPI_SIP_USER=%q\n' "$VAPI_SECURE_USER"
} > "$VAPI_SIP_ENV"
chmod 600 "$VAPI_SIP_ENV"

log "Adding matching digest auth to the Asterisk Vapi endpoint"

python3 - "$PJSIP_FILE" "$EXT_FILE" "$VAPI_SIP_AUTH_USERNAME" "$VAPI_SIP_AUTH_PASSWORD" "$VAPI_SIP_AUTH_REALM" "$VAPI_SECURE_URI" <<'PY'
from pathlib import Path
import re
import sys

pjsip = Path(sys.argv[1])
ext = Path(sys.argv[2])
username = sys.argv[3]
password = sys.argv[4]
realm = sys.argv[5]
secure_uri = sys.argv[6]

text = pjsip.read_text()

text = re.sub(r'(?ms)^\[vapi-auth\]\n.*?(?=^\[|\Z)', '', text)

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
    raise SystemExit('ABORT: [vapi-aor] not found')
text = text.replace(anchor, auth_block + anchor, 1)

m = re.search(r'(?ms)^\[vapi-endpoint\]\n(.*?)(?=^\[|\Z)', text)
if not m:
    raise SystemExit('ABORT: [vapi-endpoint] not found')
body = m.group(1)
if re.search(r'(?m)^outbound_auth=', body):
    body = re.sub(r'(?m)^outbound_auth=.*$', 'outbound_auth=vapi-auth', body)
else:
    body = 'outbound_auth=vapi-auth\n' + body
text = text[:m.start(1)] + body + text[m.end(1):]
pjsip.write_text(text)

ext_text = ext.read_text()
new_target = secure_uri + ':5060'
pattern = r'(?m)(Dial\(PJSIP/vapi-endpoint/)sip:[^,]+(@?[^,]*,90\))'
# Replace only the managed Vapi Dial target line.
lines = []
changed = False
for line in ext_text.splitlines(True):
    if 'Dial(PJSIP/vapi-endpoint/sip:' in line:
        prefix = line.split('Dial(PJSIP/vapi-endpoint/', 1)[0]
        line = prefix + f'Dial(PJSIP/vapi-endpoint/{new_target},90)\n'
        changed = True
    lines.append(line)
if not changed:
    raise SystemExit('ABORT: managed Vapi Dial line not found in extensions config')
ext.write_text(''.join(lines))
PY

chown root:asterisk "$PJSIP_FILE" "$EXT_FILE"
chmod 640 "$PJSIP_FILE" "$EXT_FILE"

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
 VAPI SIP AUTH V2 APPLIED
==================================================
Secure Vapi SIP URI:    ${VAPI_SECURE_URI}
Vapi phone-number ID:   ${phone_id}
Digest realm:           ${VAPI_SIP_AUTH_REALM}
Asterisk auth object:   vapi-auth
Password displayed:     NO
Old Vapi SIP URI:       left untouched
==================================================
Call 020 7913950 again.
Expected Vapi leg: 401 challenge -> authenticated INVITE -> ringing/answer.
EOF

unset VAPI_PRIVATE_API_KEY VAPI_SIP_AUTH_PASSWORD
