#!/usr/bin/env bash
set -euo pipefail

CLOUDONE_HOST="${CLOUDONE_HOST:-ls02.cloudone.co.ke}"
CLOUDONE_PORT="${CLOUDONE_PORT:-5060}"
CLOUDONE_USER="${CLOUDONE_USER:-telenexus}"
PRIMARY_DID="${PRIMARY_DID:-254207913950}"
PUBLIC_IP="${PUBLIC_IP:-169.58.177.113}"

DIDS=("254207913950" "254207913951" "254207913952" "254207913953")

VAPI_API_BASE="${VAPI_API_BASE:-https://api.vapi.ai}"
VAPI_SIP_HOST="${VAPI_SIP_HOST:-sip.vapi.ai}"
VAPI_SIP_USER="${VAPI_SIP_USER:-nexa-cloudone-254207913950}"
VAPI_SIP_URI="sip:${VAPI_SIP_USER}@${VAPI_SIP_HOST}"

RUNTIME_DIR="/etc/nexa-cloudone"
BACKUP_ROOT="/var/backups/nexa-cloudone"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"

PJSIP_MAIN="/etc/asterisk/pjsip.conf"
PJSIP_NEXA="/etc/asterisk/pjsip_nexa_cloudone.conf"
EXT_MAIN="/etc/asterisk/extensions.conf"
EXT_NEXA="/etc/asterisk/extensions_nexa_cloudone.conf"
RTP_CONF="/etc/asterisk/rtp.conf"

CLOUDONE_ENV="${RUNTIME_DIR}/cloudone.env"
VAPI_SIP_ENV="${RUNTIME_DIR}/vapi-sip.env"
VAPI_EXISTING_ENV="/etc/nexa-platform/vapi-outbound.env"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }
require_root(){ [[ "$(id -u)" -eq 0 ]] || die "Run as root."; }

backup_if_exists(){
  local path="$1"
  [[ -e "$path" ]] || return 0
  mkdir -p "$BACKUP_DIR"
  cp -a "$path" "$BACKUP_DIR/"
}

ensure_include(){
  local file="$1" line="$2"
  touch "$file"
  grep -Fqx "$line" "$file" || printf '\n%s\n' "$line" >> "$file"
}

json_http(){
  local method="$1" url="$2" token="$3" payload="${4:-}"
  local tmp code
  tmp="$(mktemp)"
  if [[ -n "$payload" ]]; then
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data "$payload")"
  else
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $token" -H 'Accept: application/json')"
  fi
  cat "$tmp"
  rm -f "$tmp"
  if (( code < 200 || code >= 300 )); then
    echo >&2
    echo "HTTP status: $code" >&2
    return 1
  fi
}

check_existing_listener(){
  command -v ss >/dev/null 2>&1 || return 0
  local listeners
  listeners="$(ss -lunp 2>/dev/null | awk '$5 ~ /:5060$/ {print}' || true)"
  if [[ -n "$listeners" ]] && ! grep -qi asterisk <<<"$listeners"; then
    echo "$listeners"
    die "UDP 5060 is already used by a non-Asterisk process."
  fi
}

install_packages(){
  log "Installing Asterisk/PJSIP dependencies"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y asterisk curl jq dnsutils
}

ensure_cloudone_secret(){
  mkdir -p "$RUNTIME_DIR"
  chmod 700 "$RUNTIME_DIR"

  if [[ -s "$CLOUDONE_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$CLOUDONE_ENV"
  fi

  if [[ -z "${CLOUDONE_SIP_PASSWORD:-}" ]]; then
    echo
    echo "CloudOne SIP password is required and will not be echoed."
    read -rsp "CloudOne SIP password: " CLOUDONE_SIP_PASSWORD
    echo
  fi

  [[ -n "${CLOUDONE_SIP_PASSWORD:-}" ]] || die "CloudOne SIP password is empty."

  umask 077
  printf 'CLOUDONE_SIP_PASSWORD=%q\n' "$CLOUDONE_SIP_PASSWORD" > "$CLOUDONE_ENV"
  chmod 600 "$CLOUDONE_ENV"
}

load_vapi_credentials(){
  if [[ -r "$VAPI_EXISTING_ENV" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$VAPI_EXISTING_ENV"
    set +a
  fi

  if [[ -z "${VAPI_PRIVATE_API_KEY:-}" ]]; then
    read -rsp "Vapi PRIVATE API key: " VAPI_PRIVATE_API_KEY
    echo
  fi

  if [[ -z "${VAPI_ALERT_ASSISTANT_ID:-}" ]]; then
    read -rp "Vapi Nexa Assistant ID: " VAPI_ALERT_ASSISTANT_ID
  fi

  [[ -n "${VAPI_PRIVATE_API_KEY:-}" ]] || die "Vapi private key is missing."
  [[ -n "${VAPI_ALERT_ASSISTANT_ID:-}" ]] || die "Vapi assistant ID is missing."
}

ensure_vapi_sip_number(){
  log "Creating/reusing Vapi SIP URI for Nexa"

  local numbers phone_id payload created
  numbers="$(json_http GET "${VAPI_API_BASE%/}/phone-number?limit=1000" "$VAPI_PRIVATE_API_KEY")" \
    || die "Could not list Vapi phone numbers."

  phone_id="$(
    printf '%s' "$numbers" |
      jq -r --arg uri "$VAPI_SIP_URI" '.[] | select(.provider == "vapi" and .sipUri == $uri) | .id' |
      head -n1
  )"

  if [[ -z "$phone_id" || "$phone_id" == "null" ]]; then
    payload="$(jq -cn \
      --arg sipUri "$VAPI_SIP_URI" \
      --arg assistantId "$VAPI_ALERT_ASSISTANT_ID" \
      '{provider:"vapi",name:"Nexa CloudOne SIP Bridge",sipUri:$sipUri,assistantId:$assistantId}')"

    created="$(json_http POST "${VAPI_API_BASE%/}/phone-number" "$VAPI_PRIVATE_API_KEY" "$payload")" \
      || die "Vapi SIP phone-number creation failed."

    phone_id="$(printf '%s' "$created" | jq -r '.id // empty')"
    [[ -n "$phone_id" ]] || die "Vapi did not return a SIP phone-number ID."
  fi

  umask 077
  {
    printf 'VAPI_SIP_PHONE_NUMBER_ID=%q\n' "$phone_id"
    printf 'VAPI_SIP_URI=%q\n' "$VAPI_SIP_URI"
    printf 'VAPI_SIP_HOST=%q\n' "$VAPI_SIP_HOST"
    printf 'VAPI_SIP_USER=%q\n' "$VAPI_SIP_USER"
  } > "$VAPI_SIP_ENV"
  chmod 600 "$VAPI_SIP_ENV"

  echo "Vapi SIP URI: $VAPI_SIP_URI"
  echo "Vapi SIP phone-number ID: $phone_id"
}

write_pjsip_config(){
  log "Writing CloudOne and Vapi PJSIP configuration"
  backup_if_exists "$PJSIP_MAIN"
  backup_if_exists "$PJSIP_NEXA"

  # shellcheck disable=SC1090
  source "$CLOUDONE_ENV"

  cat > "$PJSIP_NEXA" <<EOF
; Nexa CloudOne gateway - managed by install.sh

[nexa-cloudone-udp]
type=transport
protocol=udp
bind=0.0.0.0:${CLOUDONE_PORT}
external_signaling_address=${PUBLIC_IP}
external_media_address=${PUBLIC_IP}
local_net=10.0.0.0/8
local_net=172.16.0.0/12
local_net=192.168.0.0/16
local_net=127.0.0.0/8

[cloudone-auth]
type=auth
auth_type=userpass
username=${CLOUDONE_USER}
password=${CLOUDONE_SIP_PASSWORD}

[cloudone-aor]
type=aor
contact=sip:${CLOUDONE_HOST}:${CLOUDONE_PORT}
qualify_frequency=30
qualify_timeout=3.0

[cloudone-endpoint]
type=endpoint
transport=nexa-cloudone-udp
context=from-cloudone
disallow=all
allow=ulaw
allow=alaw
aors=cloudone-aor
outbound_auth=cloudone-auth
from_user=${CLOUDONE_USER}
from_domain=${CLOUDONE_HOST}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
send_pai=yes
trust_id_inbound=yes

[cloudone-identify]
type=identify
endpoint=cloudone-endpoint
match=${CLOUDONE_HOST}
srv_lookups=yes

[cloudone-registration]
type=registration
transport=nexa-cloudone-udp
outbound_auth=cloudone-auth
server_uri=sip:${CLOUDONE_HOST}:${CLOUDONE_PORT}
client_uri=sip:${CLOUDONE_USER}@${CLOUDONE_HOST}
contact_user=${PRIMARY_DID}
endpoint=cloudone-endpoint
line=yes
retry_interval=30
forbidden_retry_interval=60
fatal_retry_interval=60
max_retries=0
expiration=300

[vapi-aor]
type=aor
contact=sip:${VAPI_SIP_HOST}:5060
qualify_frequency=30
qualify_timeout=3.0

[vapi-endpoint]
type=endpoint
transport=nexa-cloudone-udp
context=from-vapi
disallow=all
allow=ulaw
allow=alaw
aors=vapi-aor
from_domain=${VAPI_SIP_HOST}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
EOF

  chmod 640 "$PJSIP_NEXA"
  chown root:asterisk "$PJSIP_NEXA"
  ensure_include "$PJSIP_MAIN" '#include pjsip_nexa_cloudone.conf'
}

write_extensions_config(){
  log "Writing inbound DID -> Nexa dialplan"
  backup_if_exists "$EXT_MAIN"
  backup_if_exists "$EXT_NEXA"

  cat > "$EXT_NEXA" <<EOF
; Nexa CloudOne dialplan - managed by install.sh

[from-cloudone]
exten => ${DIDS[0]},1,Goto(nexa-cloudone-forward,s,1)
exten => ${DIDS[1]},1,Goto(nexa-cloudone-forward,s,1)
exten => ${DIDS[2]},1,Goto(nexa-cloudone-forward,s,1)
exten => ${DIDS[3]},1,Goto(nexa-cloudone-forward,s,1)
exten => ${CLOUDONE_USER},1,Goto(nexa-cloudone-forward,s,1)
exten => s,1,Goto(nexa-cloudone-forward,s,1)
exten => _X.,1,Goto(nexa-cloudone-forward,s,1)

[nexa-cloudone-forward]
exten => s,1,NoOp(Nexa inbound CloudOne call)
 same => n,Dial(PJSIP/vapi-endpoint/sip:${VAPI_SIP_USER}@${VAPI_SIP_HOST}:5060,90)
 same => n,Hangup()

[from-vapi]
exten => _X.,1,Hangup()
exten => s,1,Hangup()

[nexa-cloudone-outbound]
exten => _254X.,1,Set(CALLERID(num)=${PRIMARY_DID})
 same => n,Dial(PJSIP/\${EXTEN}@cloudone-endpoint,60)
 same => n,Hangup()

exten => _0X.,1,Set(DEST=254\${EXTEN:1})
 same => n,Set(CALLERID(num)=${PRIMARY_DID})
 same => n,Dial(PJSIP/\${DEST}@cloudone-endpoint,60)
 same => n,Hangup()
EOF

  chmod 640 "$EXT_NEXA"
  chown root:asterisk "$EXT_NEXA"
  ensure_include "$EXT_MAIN" '#include extensions_nexa_cloudone.conf'
}

write_rtp_config(){
  log "Ensuring RTP range 10000-20000"
  backup_if_exists "$RTP_CONF"
  touch "$RTP_CONF"

  if grep -q '^\[general\]' "$RTP_CONF"; then
    if grep -q '^rtpstart=' "$RTP_CONF"; then
      sed -i 's/^rtpstart=.*/rtpstart=10000/' "$RTP_CONF"
    else
      sed -i '/^\[general\]/a rtpstart=10000' "$RTP_CONF"
    fi

    if grep -q '^rtpend=' "$RTP_CONF"; then
      sed -i 's/^rtpend=.*/rtpend=20000/' "$RTP_CONF"
    else
      sed -i '/^\[general\]/a rtpend=20000' "$RTP_CONF"
    fi
  else
    cat >> "$RTP_CONF" <<'EOF'

[general]
rtpstart=10000
rtpend=20000
EOF
  fi
}

configure_firewall_if_active(){
  command -v ufw >/dev/null 2>&1 || return 0
  ufw status 2>/dev/null | grep -q '^Status: active' || return 0

  log "UFW is active; adding SIP/RTP rules"

  local ips ip
  mapfile -t ips < <(getent ahostsv4 "$CLOUDONE_HOST" | awk '{print $1}' | sort -u)
  (( ${#ips[@]} > 0 )) || die "Could not resolve ${CLOUDONE_HOST}; not opening SIP globally."

  for ip in "${ips[@]}"; do
    ufw allow proto udp from "$ip" to any port "$CLOUDONE_PORT" comment 'Nexa CloudOne SIP' >/dev/null
  done

  ufw allow 10000:20000/udp comment 'Nexa Asterisk RTP' >/dev/null
}

restart_asterisk(){
  log "Restarting Asterisk"
  systemctl enable asterisk >/dev/null
  systemctl restart asterisk
  sleep 4

  if ! systemctl is-active --quiet asterisk; then
    journalctl -u asterisk --since "2 minutes ago" --no-pager | tail -120 >&2 || true
    die "Asterisk failed to start."
  fi

  echo "Asterisk: ACTIVE"
}

show_status(){
  log "Current PJSIP status"
  asterisk -rx 'pjsip show registrations' || true
  echo
  asterisk -rx 'pjsip show endpoints' | grep -E 'Endpoint:|cloudone|vapi' || true
  echo
  echo "CloudOne registrar: ${CLOUDONE_HOST}:${CLOUDONE_PORT}/UDP"
  echo "CloudOne username:  ${CLOUDONE_USER}"
  echo "Primary DID:        ${PRIMARY_DID}"
  echo "Vapi SIP URI:       ${VAPI_SIP_URI}"
  echo "Public PBX IP:       ${PUBLIC_IP}"
  echo "Inbound DIDs:"
  printf '  %s\n' "${DIDS[@]}"
}

main(){
  require_root

  echo "=================================================="
  echo " NEXA CLOUDONE -> ASTERISK -> VAPI SIP GATEWAY"
  echo "=================================================="

  mkdir -p "$BACKUP_ROOT" "$BACKUP_DIR"
  chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"

  check_existing_listener
  install_packages
  ensure_cloudone_secret
  load_vapi_credentials
  ensure_vapi_sip_number
  write_pjsip_config
  write_extensions_config
  write_rtp_config
  configure_firewall_if_active
  restart_asterisk
  show_status

  echo
  echo "=================================================="
  echo " GATEWAY DEPLOYED"
  echo "=================================================="
  echo "CloudOne registration must show: Registered"
  echo "Then call any bundled DID from a normal mobile phone."
  echo "All inbound CloudOne calls are forwarded to Nexa."
  echo
  echo "CloudOne must whitelist PBX IP: ${PUBLIC_IP}"
  echo "Status: bash telephony/cloudone-asterisk/status.sh"
  echo "=================================================="

  unset CLOUDONE_SIP_PASSWORD VAPI_PRIVATE_API_KEY
}

main "$@"
