#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/etc/nexa-cloudone"
PJSIP_FILE="/etc/asterisk/pjsip_nexa_cloudone.conf"
EXT_FILE="/etc/asterisk/extensions_nexa_cloudone.conf"
VAPI_SIP_ENV="${RUNTIME_DIR}/vapi-sip.env"
VAPI_CHALLENGE_ENV="${RUNTIME_DIR}/vapi-challenge-auth.env"
VAPI_SIP_HOST="${VAPI_SIP_HOST:-sip.vapi.ai}"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root."
[[ -r "$PJSIP_FILE" ]] || die "Missing $PJSIP_FILE"
[[ -r "$EXT_FILE" ]] || die "Missing $EXT_FILE"
[[ -r "$VAPI_SIP_ENV" ]] || die "Missing $VAPI_SIP_ENV"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

# shellcheck disable=SC1090
source "$VAPI_SIP_ENV"

[[ -n "${VAPI_SIP_URI:-}" ]] || die "VAPI_SIP_URI is missing"
[[ -n "${VAPI_SIP_USER:-}" ]] || VAPI_SIP_USER="${VAPI_SIP_URI#sip:}"
VAPI_SIP_USER="${VAPI_SIP_USER%@*}"

if [[ -r "$VAPI_CHALLENGE_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$VAPI_CHALLENGE_ENV"
fi

VAPI_CHALLENGE_USERNAME="${VAPI_CHALLENGE_USERNAME:-nexa-cloudone-local}"
VAPI_CHALLENGE_REALM="${VAPI_CHALLENGE_REALM:-$VAPI_SIP_HOST}"

if [[ -z "${VAPI_CHALLENGE_PASSWORD:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    VAPI_CHALLENGE_PASSWORD="$(openssl rand -hex 24)"
  else
    VAPI_CHALLENGE_PASSWORD="$(head -c 36 /dev/urandom | base64 | tr -d '\n')"
  fi
fi

umask 077
{
  printf 'VAPI_CHALLENGE_USERNAME=%q\n' "$VAPI_CHALLENGE_USERNAME"
  printf 'VAPI_CHALLENGE_PASSWORD=%q\n' "$VAPI_CHALLENGE_PASSWORD"
  printf 'VAPI_CHALLENGE_REALM=%q\n' "$VAPI_CHALLENGE_REALM"
} > "$VAPI_CHALLENGE_ENV"
chmod 600 "$VAPI_CHALLENGE_ENV"

log "Adding local Asterisk credentials for Vapi's SIP 401 challenge"

python3 - \
  "$PJSIP_FILE" \
  "$EXT_FILE" \
  "$VAPI_CHALLENGE_USERNAME" \
  "$VAPI_CHALLENGE_PASSWORD" \
  "$VAPI_CHALLENGE_REALM" \
  "$VAPI_SIP_URI" <<'PY'
from pathlib import Path
import re
import sys

pjsip_path = Path(sys.argv[1])
ext_path = Path(sys.argv[2])
username = sys.argv[3]
password = sys.argv[4]
realm = sys.argv[5]
vapi_uri = sys.argv[6]

text = pjsip_path.read_text()

# Remove any prior managed vapi-auth block so the repair is repeatable.
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
pjsip_path.write_text(text)

# Ensure the managed dialplan still targets the original unmodified Vapi SIP URI.
ext_text = ext_path.read_text()
new_line = f' same => n,Dial(PJSIP/vapi-endpoint/{vapi_uri}:5060,90)\n'
lines = []
changed = False
for line in ext_text.splitlines(True):
    if 'Dial(PJSIP/vapi-endpoint/sip:' in line:
        lines.append(new_line)
        changed = True
    else:
        lines.append(line)

if not changed:
    raise SystemExit('ABORT: managed Vapi Dial line not found')

ext_path.write_text(''.join(lines))
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
 VAPI SIP CHALLENGE AUTH FIX APPLIED
==================================================
Vapi SIP URI:           ${VAPI_SIP_URI}
Asterisk auth object:   vapi-auth
Digest realm:           ${VAPI_CHALLENGE_REALM}
Secret storage:         ${VAPI_CHALLENGE_ENV}
Vapi API changed:       NO
Vapi phone resource:    UNCHANGED
Password displayed:     NO
==================================================
Call 020 7913950 again.
Expected Vapi leg:
  INVITE -> 401 challenge -> INVITE with Authorization -> ringing/answer
==================================================
EOF

unset VAPI_CHALLENGE_PASSWORD
