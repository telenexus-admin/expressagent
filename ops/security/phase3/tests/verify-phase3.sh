#!/usr/bin/env bash
set -Eeuo pipefail

failures=0
check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'PASS %s\n' "${label}"
  else
    printf 'FAIL %s\n' "${label}" >&2
    failures=$((failures + 1))
  fi
}

check 'restic installed' command -v restic
check 'auditd active' systemctl is-active --quiet auditd
check 'backup timer enabled' systemctl is-enabled --quiet nexa-backup.timer
check 'restore timer enabled' systemctl is-enabled --quiet nexa-restore-verify.timer
check 'monitor timer enabled' systemctl is-enabled --quiet nexa-security-monitor.timer
check 'local backup success proof' test -s /var/lib/nexa-backup/last-success
check 'local restore proof' test -s /var/lib/nexa-backup/last-restore-verified
check 'journal retention configured' grep -q '^MaxRetentionSec=90day$' /etc/systemd/journald.conf.d/60-nexa-retention.conf
check 'audit rules loaded' auditctl -l
check 'backend active' systemctl is-active --quiet nexa-platform-backend
check 'FreeRADIUS active' systemctl is-active --quiet freeradius
check 'Asterisk active' systemctl is-active --quiet asterisk
check 'Nginx config valid' nginx -t
check 'public DAST baseline' /usr/local/lib/nexa-security/dast-baseline.sh https://billing.polyizon.tech

if [[ -s /etc/nexa-backup/offsite.env ]] && grep -q '^NEXA_OFFSITE_REPOSITORY=.' /etc/nexa-backup/offsite.env; then
  check 'off-site backup success proof' test -s /var/lib/nexa-backup/last-offsite-success
  check 'off-site restore proof' test -s /var/lib/nexa-backup/last-offsite-restore-verified
else
  printf 'BLOCKED off-site repository is not configured\n' >&2
  failures=$((failures + 1))
fi

if [[ -s /etc/rsyslog.d/60-nexa-offsite.conf ]]; then
  check 'off-site log forwarding syntax' rsyslogd -N1
else
  printf 'BLOCKED off-site security log collector is not configured\n' >&2
  failures=$((failures + 1))
fi

(( failures == 0 )) || exit 1
echo 'Phase 3 production verification passed.'
