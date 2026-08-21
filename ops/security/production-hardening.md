# Production Security Hardening

## Three-phase programme

### Phase 1 — perimeter and administrative access (implemented 2026-08-22)

Objective: remove direct internet paths to internal services without changing billing data or application behaviour.

Controls implemented on production host `169.58.177.113`:

- UFW enabled with default-deny incoming and default-allow outgoing.
- Public access retained only for:
  - TCP 80 and 443 (Nginx / ACME)
  - UDP 51820 (WireGuard)
  - UDP 5060 and 4569 plus UDP 10000:20000 (Asterisk signalling/media)
  - rate-limited TCP 22 (administration)
- UDP 1812 and 1813 are allowed only from the WireGuard router range `10.77.0.0/24`.
- TCP 3001 is explicitly denied from the internet; Nginx continues proxying to `127.0.0.1:3001`.
- Fail2ban 1.0.2 installed, enabled and running with the `sshd` jail.
- Existing administrative ED25519 key installed for the `ubuntu` sudo account and tested.
- Root password locked. Public-key root recovery remains available until Phase 2 finishes persistent SSH policy migration.
- Backend cgroup limits applied persistently: `MemoryMax=1G`, `TasksMax=512`, `CPUQuota=200%`.
- FreeRADIUS configuration validated with `freeradius -XC`.
- The apparent `777` on `mods-enabled/sql` was confirmed to be symlink metadata; the real target is `640 freerad:freerad` and was not changed.
- Pre-change configuration copies are stored under `/var/backups/nexa-security-phase1/20260822-0045`.

Current UFW policy:

```text
default deny incoming
default allow outgoing
limit 22/tcp
allow 80/tcp
allow 443/tcp
allow 51820/udp
allow 5060/udp
allow 4569/udp
allow 10000:20000/udp
allow from 10.77.0.0/24 to any port 1812 proto udp
allow from 10.77.0.0/24 to any port 1813 proto udp
deny 3001/tcp
```

Administrative access:

```bash
ssh -i ~/.ssh/codex_nexa ubuntu@169.58.177.113
sudo -i
```

Verification completed:

- fresh `ubuntu` SSH key login and passwordless sudo
- root key recovery login
- HTTPS login page HTTP 200
- local backend health HTTP 200
- Nginx, PostgreSQL, FreeRADIUS, backend, Fail2ban and WireGuard active
- active router `10.77.0.4` reachable with 0% packet loss
- RouterOS API on `10.77.0.4:8728` reachable
- WireGuard handshakes continue
- FreeRADIUS configuration parses successfully

Rollback is documented for emergency use only:

```bash
sudo ufw disable
sudo cp -a /var/backups/nexa-security-phase1/20260822-0045/ufw.before/. /etc/ufw/
sudo systemctl restart ufw
```

### Phase 2 — application identity, secrets and runtime isolation

Planned controls:

- short-lived secure HttpOnly sessions with refresh rotation
- MFA for billing administrators and platform operators
- login, reset, onboarding, portal and payment rate limits
- strict CSP without unsafe inline script execution
- dependency lock repair and security updates
- secrets rotation and a managed secret store
- split privileged router/RADIUS executor from the unprivileged web API
- localhost-only backend bind as defence in depth
- PostgreSQL least privilege and tenant row-level security

### Phase 3 — recovery and continuous assurance

Planned controls:

- encrypted automated PostgreSQL and asset backups
- off-site copies, retention and automated restore verification
- central security logs, alerts and audit retention
- WAF/bot controls, SAST, DAST, dependency scanning and SBOM
- incident-response exercises and an independent penetration test

## Safety rule

Do not reset the application tree or database. Production contains uncommitted feature work; security changes must remain additive, backed up and regression-tested.


## Phase 1 standalone review — 2026-08-22

**Score: 7.5/10 for the perimeter and administrative-access phase.**

The score is for Phase 1 only, not for the security of the complete application.

Re-verification evidence:

- UFW remained active and enabled with default-deny incoming policy.
- TCP 3001 remained blocked externally: the independent client connection timed out while HTTPS returned HTTP 200.
- Firewall counters showed direct TCP 3001 probes being dropped.
- RADIUS 1812/1813 remained allowed only from `10.77.0.0/24`.
- SSH remained rate-limited and Fail2ban remained active.
- Fail2ban had observed 70 failed SSH attempts and banned nine sources since installation.
- Root and Ubuntu account passwords remained locked.
- Fresh key-based Ubuntu access and sudo had already been proven.
- Nginx, PostgreSQL, FreeRADIUS, backend, WireGuard, UFW and Fail2ban were active and enabled where applicable.
- Protected billing API returned HTTP 401 without authentication.
- Active router `10.77.0.4` remained reachable with 0% packet loss.
- WireGuard showed a recent handshake.
- FreeRADIUS configuration validation remained successful.
- Backend limits remained active: 1 GiB memory, 512 tasks and 200% CPU.
- Rollback copies remained root-protected under `/var/backups/nexa-security-phase1/20260822-0045`.

Score deductions and Phase 2 handoff:

- The Node backend still runs as root.
- Node still listens on all interfaces; UFW blocks it externally, but localhost-only binding is still required for defence in depth.
- The SSH daemon still advertises `PermitRootLogin yes`, `PasswordAuthentication yes` and `X11Forwarding yes`; account passwords are locked, but persistent daemon policy must be tightened.
- SIP and RTP remain publicly exposed because the current Asterisk integration requires them; provider allowlisting or a SIP edge gateway is still needed.
- UFW is the only confirmed host perimeter. A provider/cloud firewall has not yet been verified as a second independent layer.
- Centralized alerting and reboot-based persistence testing remain Phase 3 work.

A 10/10 rating is intentionally not used: no internet-facing system is unbreakable, and Phase 1 is one security layer rather than the complete control programme.
