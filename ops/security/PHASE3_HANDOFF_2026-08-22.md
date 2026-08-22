# Phase 3 security handoff — 2026-08-22

## Implemented and verified on production

- Root-protected pre-install PostgreSQL and host-configuration backup with SHA-256 validation.
- Encrypted local Restic snapshot of `nexa_billing`, `radius`, application assets and security-critical configuration.
- Full restore drill: both database dumps restored into disposable PostgreSQL databases, table presence verified, and temporary databases removed.
- Auditd, persistent journal retention, log rotation, backup timer, restore-verification timer and security-monitor timer installed and enabled.
- Production dependency audit: zero high/critical production dependency findings in backend and frontend.
- Existing core services remained active during the completed checks.

## Implemented in this branch but not yet deployed

- Monitor firewall check using `/lib/ufw/ufw-init status`, avoiding the false UFW alert caused by the systemd read-only sandbox.
- Nginx hidden/source-file deny snippet for dotfiles, package manifests, `server.js` and compose files.
- Installer support for deploying that Nginx snippet.
- Updated backup/restore stream permissions and restore-service repository allowlist (these fixes were deployed and restore-tested).

## Remaining acceptance work

1. Deploy the monitor and Nginx snippet changes, include the snippet in each public Nexa server block, run `nginx -t`, reload Nginx, and rerun the DAST baseline.
2. Run the Phase 2 authentication integration suite in an isolated PostgreSQL test database and complete the Linux frontend build/asset precompression gate.
3. Configure and test an encrypted off-site Restic repository; prove an off-site restore.
4. Configure a mutually authenticated TLS remote log collector and test alert delivery.
5. Put `billing.polyizon.tech` behind an independently managed provider WAF/edge policy and verify origin restriction.
6. Grant a publishing credential GitHub workflow scope, move ops/security/phase3/ci/security-phase3.workflow.yml to .github/workflows/security-phase3.yml, enable branch protection requiring it, and retain SBOM artifacts.
7. Complete an independent penetration test and a documented incident-response/restore exercise.

The complete Phase 3 must not be rated 10/10 until every remaining acceptance item has evidence.