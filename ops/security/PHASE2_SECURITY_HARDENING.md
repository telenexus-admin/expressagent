# Phase 2 application and identity hardening

Phase 2 removes long-lived administrator tokens from browser storage and separates privileged network operations from the public web process.

## Security controls

- Opaque, database-backed administrator sessions.
- Fifteen-minute access lifetime, seven-day absolute refresh lifetime, rotation on every refresh and family-wide revocation when an old refresh token is reused.
- Secure `__Host-` HttpOnly cookies and strict same-site policy.
- Double-submit CSRF validation plus an HTTPS tenant-origin allowlist.
- Required TOTP MFA for all administrators and master operators, encrypted MFA secrets, ten one-time recovery codes and database-backed one-time authentication challenges.
- Five-failure account lockout and endpoint-specific throttles for login, MFA, password reset, onboarding and public writes.
- Exact administrator-email authentication and a 12-character, three-character-class password policy for every admin creation route.
- One-time, fifteen-minute password-reset tokens; password changes revoke all sessions.
- Operator impersonation uses auditable parent/child server sessions. JWTs are no longer placed in URLs or local/session storage.
- WireGuard changes are executed by a root-owned Unix-socket service that accepts only validated peer activation/removal operations. The web backend has no `CAP_NET_ADMIN` and no `/etc/wireguard` write access.
- RADIUS NAS registration fails closed unless the approved database table or synchronizer is available. The web process cannot rewrite FreeRADIUS files or restart the service.
- Root-owned systemd environment files hold application secrets. Inline unit secrets are retired.
- Strict script CSP (no inline JavaScript), HSTS preload, no-sniff, no-referrer, frame and permissions controls.
- Production npm dependency audit must report zero known vulnerabilities before release.

## Rollback

The release procedure records a source archive, PostgreSQL custom dumps, host configuration archive and SHA-256 checksums before activation. Rollback restores the previous source files and service drop-ins, reloads systemd/Nginx and restarts the previous backend. Database additions are backward compatible and need not be dropped to roll back application code.

## Required release gates

1. All modified JavaScript files pass syntax checks.
2. Frontend production build succeeds.
3. Backend and frontend production dependency audits report zero vulnerabilities.
4. Auth integration test passes forced enrollment, TOTP, CSRF, refresh rotation, reuse revocation, one-time challenge/reset and lockout scenarios.
5. Executor rejects malformed operations and the backend service score confirms it has no network capability.
6. Nginx configuration and strict CSP tests pass.
7. Existing billing, RADIUS, router, portal and health smoke tests pass.
8. Production and GitHub commit hashes are recorded after deployment.

No security programme makes a system literally unbreakable. “10/10” for this phase means every control and release gate above is implemented and verified; it does not claim immunity from future vulnerabilities or compromised third-party services.
