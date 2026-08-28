#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_root="/var/backups/nexa-security-phase3/$(date -u +%Y%m%d-%H%M%S)"
install -d -m 0700 "${backup_root}"

for path in \
  /etc/systemd/journald.conf.d/60-nexa-retention.conf \
  /etc/audit/rules.d/60-nexa-security.rules \
  /etc/logrotate.d/nexa-security \
  /etc/systemd/system/nexa-backup.service \
  /etc/systemd/system/nexa-backup.timer \
  /etc/systemd/system/nexa-restore-verify.service \
  /etc/systemd/system/nexa-restore-verify.timer \
  /etc/systemd/system/nexa-security-monitor.service \
  /etc/systemd/system/nexa-security-monitor.timer; do
  if [[ -e "${path}" ]]; then
    destination="${backup_root}${path}"
    install -d -m 0700 "$(dirname "${destination}")"
    cp -a "${path}" "${destination}"
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends restic auditd audispd-plugins jq

install -d -m 0700 /etc/nexa-backup /etc/nexa-security
install -d -m 0700 /var/lib/nexa-backup /var/lib/nexa-security
install -d -m 0750 -o root -g adm /var/log/nexa-security
install -d -m 0755 /usr/local/lib/nexa-security
install -d -m 0755 /etc/systemd/journald.conf.d
install -d -m 0755 /etc/nginx/snippets
install -d -m 0700 /var/backups/nexa-restic

if [[ ! -s /etc/nexa-backup/restic-password ]]; then
  openssl rand -base64 48 > /etc/nexa-backup/restic-password
fi
chmod 0600 /etc/nexa-backup/restic-password

if [[ ! -s /etc/nexa-backup/backup.env ]]; then
  install -m 0600 "${source_root}/backup/backup.env.example" /etc/nexa-backup/backup.env
fi
if [[ ! -e /etc/nexa-backup/offsite.env ]]; then
  install -m 0600 /dev/null /etc/nexa-backup/offsite.env
fi
if [[ ! -s /etc/nexa-security/monitor.env ]]; then
  install -m 0600 "${source_root}/monitor/monitor.env.example" /etc/nexa-security/monitor.env
fi

install -m 0750 "${source_root}/backup/nexa-backup" /usr/local/sbin/nexa-backup
install -m 0750 "${source_root}/backup/nexa-restore-verify" /usr/local/sbin/nexa-restore-verify
install -m 0750 "${source_root}/monitor/nexa-security-monitor" /usr/local/sbin/nexa-security-monitor
install -m 0755 "${source_root}/tests/dast-baseline.sh" /usr/local/lib/nexa-security/dast-baseline.sh
install -m 0750 "${source_root}/tests/verify-phase3.sh" /usr/local/lib/nexa-security/verify-phase3.sh

install -m 0644 "${source_root}/backup/nexa-backup.service" /etc/systemd/system/nexa-backup.service
install -m 0644 "${source_root}/backup/nexa-backup.timer" /etc/systemd/system/nexa-backup.timer
install -m 0644 "${source_root}/backup/nexa-restore-verify.service" /etc/systemd/system/nexa-restore-verify.service
install -m 0644 "${source_root}/backup/nexa-restore-verify.timer" /etc/systemd/system/nexa-restore-verify.timer
install -m 0644 "${source_root}/monitor/nexa-security-monitor.service" /etc/systemd/system/nexa-security-monitor.service
install -m 0644 "${source_root}/monitor/nexa-security-monitor.timer" /etc/systemd/system/nexa-security-monitor.timer
install -m 0640 "${source_root}/logging/60-nexa-security.rules" /etc/audit/rules.d/60-nexa-security.rules
install -m 0644 "${source_root}/logging/60-nexa-retention.conf" /etc/systemd/journald.conf.d/60-nexa-retention.conf
install -m 0644 "${source_root}/logging/nexa-security-logrotate" /etc/logrotate.d/nexa-security
install -m 0644 "${source_root}/nginx/nexa-deny-hidden-files.conf" /etc/nginx/snippets/nexa-deny-hidden-files.conf

systemctl daemon-reload
augenrules --load
systemctl enable --now auditd
systemctl restart systemd-journald
systemctl enable --now nexa-backup.timer nexa-restore-verify.timer nexa-security-monitor.timer

echo "Phase 3 local controls installed. Rollback copies: ${backup_root}"
echo 'Configure /etc/nexa-backup/offsite.env and a TLS rsyslog destination before Phase 3 can be accepted.'
