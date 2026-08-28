# Production Security Hardening

## Three-phase programme

### Phase 1 — perimeter and administrative access

**Status: accepted on 2026-08-22. Phase 1 checklist score: 10/10.**

This score means every control and acceptance test defined for the Phase 1 host-perimeter and administrative-access scope passed. It does not mean the complete application is unbreakable; application identity, secret rotation, data controls, recovery and continuous assurance remain in Phases 2 and 3.

#### Implemented controls

- UFW is enabled with default-deny inbound policy.
- Public web traffic is limited to TCP 80/443 through Nginx.
- The Node backend binds only to `127.0.0.1:3001`; UFW also explicitly denies public TCP 3001.
- WireGuard UDP 51820 remains public for router tunnel establishment.
- RADIUS UDP 1812/1813 accepts traffic only from the WireGuard router range `10.77.0.0/24`.
- SSH TCP 22 is rate-limited and monitored by Fail2ban.
- SSH password and keyboard-interactive login are disabled persistently.
- SSH forwarding and X11 forwarding are disabled; authentication attempts, sessions and grace time are restricted.
- The Ubuntu administrator uses ED25519 public-key access and passwordless sudo.
- Root password login is disabled; public-key-only root recovery remains available.
- SIP UDP 5060 is allowlisted to the verified CloudOne and Vapi endpoints.
- Unused IAX UDP 4569 is closed.
- RTP was reduced from 10,001 ports to UDP 10000:10199, with strict RTP and replay protection.
- The backend runs as dedicated system identity `nexa-backend:nexa-backend`, not root.
- The backend systemd sandbox uses a strict read-only filesystem, private devices and temporary storage, restricted namespaces/socket families, no-new-privileges and a single `CAP_NET_ADMIN` capability.
- The only backend write exception is `/etc/wireguard`.
- WireGuard persistence no longer calls a privileged `wg-quick` helper. It validates the interface name, reads runtime configuration through `wg showconf`, writes a mode-0600 temporary file and atomically renames it.
- Backend cgroup limits remain active: 1 GiB memory, 512 tasks and 200% CPU.
- FreeRADIUS configuration validates successfully; its real SQL target remains mode 640.
- Persistent configuration examples are versioned in `ops/security/phase1/`.
- Pre-change rollback copies are root-protected under:
  - `/var/backups/nexa-security-phase1/20260822-0045`
  - `/var/backups/nexa-security-phase1/20260822-0135`

#### Active inbound policy

```text
allow 80/tcp and 443/tcp from anywhere
allow 51820/udp from anywhere
allow 1812/udp and 1813/udp from 10.77.0.0/24 only
deny 3001/tcp from anywhere
limit 22/tcp from anywhere
allow 5060/udp from 102.164.53.14
allow 5060/udp from 44.229.228.186
allow 5060/udp from 44.238.177.138
allow 10000:10199/udp from anywhere
default deny incoming
```

Provider IP changes must be verified before updating the SIP allowlist. RADIUS must never be widened to the public internet.

#### Acceptance evidence

- Backend service: active, zero restarts after successful hardened launch.
- Runtime identity: `nexa-backend:nexa-backend`.
- systemd security exposure: **3.1 OK**, improved from **9.6 UNSAFE**.
- Backend listener: `127.0.0.1:3001` only.
- External TCP 3001: connection timeout / HTTP 000.
- Public HTTPS login: HTTP 200.
- Local health: HTTP 200.
- Protected billing API without authentication: HTTP 401.
- Fresh Ubuntu key login: passed.
- Passwordless sudo: passed.
- Root recovery key: passed.
- Password-only SSH attempt: rejected with `Permission denied (publickey)`.
- SSH socket: enabled and active for boot persistence.
- Fail2ban SSH jail: active; 13 hostile sources had been banned at acceptance time.
- WireGuard capability canary under the exact backend identity/sandbox: passed.
- Idempotent live-peer activation and atomic persistence: passed.
- WireGuard config after persistence: mode 600.
- Active router `10.77.0.4`: recent handshake, 0% ping loss.
- RouterOS API `10.77.0.4:8728`: reachable.
- FreeRADIUS: active; `freeradius -XC` reports configuration OK.
- Asterisk: active.
- CloudOne contact: available; registration: registered.
- Vapi contact: available.
- Nginx configuration: valid.
- Nginx, PostgreSQL, FreeRADIUS, Asterisk, Fail2ban, backend and WireGuard: enabled.
- No backend warning-or-higher journal entries after the final hardened start.

#### Administrative access

```bash
ssh -i ~/.ssh/codex_nexa ubuntu@169.58.177.113
sudo -i
```

#### Emergency rollback

Rollback copies are intentionally retained outside the application tree. Use them only during an incident, validate the target path before copying, and re-run the acceptance checks after recovery. Do not reset the Git worktree or database.

### Phase 2 — application identity, secrets and authorization

Planned controls:

- short-lived secure HttpOnly sessions with refresh rotation
- MFA for billing administrators and platform operators
- login, reset, onboarding, portal and payment rate limits
- strict CSP without unsafe inline script execution
- coordinated rotation of hotspot, provider, database and application secrets
- managed secret storage
- PostgreSQL least privilege and tenant row-level security
- complete privileged router/RADIUS executor separation where future operations require more than `CAP_NET_ADMIN`
- dependency lock repair and security updates

### Phase 3 — recovery and continuous assurance

Planned controls:

- encrypted automated PostgreSQL and asset backups
- off-site copies, retention and automated restore verification
- central security logs, alerts and audit retention
- provider-edge firewall or WAF as an independent perimeter
- SAST, DAST, dependency scanning and SBOM
- incident-response exercises and an independent penetration test

## Safety rule

Do not reset the application tree or database. Production contains active billing data and feature work; security changes must remain additive, backed up and regression-tested.
