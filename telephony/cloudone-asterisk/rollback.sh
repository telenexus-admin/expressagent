#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="/var/backups/nexa-cloudone"

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

latest="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n1 || true)"

if [[ -z "$latest" ]]; then
  echo "No Nexa CloudOne backup directory found under $BACKUP_ROOT"
  exit 1
fi

echo "Restoring Asterisk files from: $latest"

for name in pjsip.conf pjsip_nexa_cloudone.conf extensions.conf extensions_nexa_cloudone.conf rtp.conf; do
  if [[ -e "$latest/$name" ]]; then
    cp -a "$latest/$name" "/etc/asterisk/$name"
    echo "Restored /etc/asterisk/$name"
  fi
done

# If a managed include file did not exist in the backup, remove the newly-created file.
if [[ ! -e "$latest/pjsip_nexa_cloudone.conf" ]]; then
  rm -f /etc/asterisk/pjsip_nexa_cloudone.conf
fi

if [[ ! -e "$latest/extensions_nexa_cloudone.conf" ]]; then
  rm -f /etc/asterisk/extensions_nexa_cloudone.conf
fi

systemctl restart asterisk
sleep 3
systemctl is-active --quiet asterisk

echo "Rollback complete. Asterisk is active."
echo "The Vapi SIP phone-number resource is intentionally left in place."
