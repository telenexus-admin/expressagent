# Phase 3 recovery and continuous assurance

Phase 3 protects recovery evidence and continuously tests the controls established in Phases 1 and 2. It is additive and does not reset application files or databases.

## Implemented controls

- Nightly encrypted Restic backups of PostgreSQL, uploaded assets and root-only infrastructure configuration.
- Retention of seven daily, five weekly, twelve monthly and three yearly snapshots.
- Repository integrity checks after every backup.
- Weekly full restore into disposable PostgreSQL databases, checksum verification and automatic removal of verification databases.
- Persistent, compressed and sealed journals with a 90-day/2-GiB policy.
- Auditd watches for changes to application secrets, WireGuard, FreeRADIUS, Asterisk, Nginx, SSH and systemd, plus interactive privileged execution.
- Five-minute health monitoring for critical services, firewall, Fail2ban, backup age, restore-proof age, disk pressure and TLS expiry.
- Deduplicated JSON security events with optional HTTPS webhook delivery.
- CI gates for production dependency vulnerabilities, Phase 2 auth regressions, CodeQL SAST, CycloneDX SBOM generation and scheduled DAST.
- A production verification script that fails when local evidence or mandatory external controls are missing.

## External acceptance gates

Phase 3 must not be rated complete until all of the following are proven:

1. A physically separate Restic repository is configured and both backup and restore-proof stamps exist.
2. Security logs are forwarded over authenticated TLS to a separate collector and retrieval is tested.
3. `billing.polyizon.tech` is proxied through an independent provider-edge WAF with managed rules, bot/rate controls and an origin rule that rejects non-edge web traffic.
4. GitHub branch protection requires the Phase 3 security workflow.
5. An independent penetration test has no unresolved critical/high findings.

## Rollback

The installer copies every replaced host file to `/var/backups/nexa-security-phase3/<UTC timestamp>`. Disable the three timers before rollback, restore only the named files, reload systemd/audit rules/journald, and rerun Phase 1 and Phase 2 smoke tests. Never reset the application worktree or database.

## Meaning of 10/10

“10/10” means every implemented and external acceptance gate above has current evidence. It does not mean the system is unbreakable or eliminate the need for patching, monitoring and future independent tests.
