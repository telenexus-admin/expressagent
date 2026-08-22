# Phase 1 host firewall policy

UFW uses default-deny ingress. The required inbound policy is:

- TCP 80 and 443 from anywhere for Nginx and ACME.
- UDP 51820 from anywhere for WireGuard router tunnels.
- UDP 1812 and 1813 only from `10.77.0.0/24`.
- TCP 22 rate-limited; SSH accepts public keys only.
- UDP 5060 only from the resolved CloudOne and Vapi SIP endpoints:
  - `102.164.53.14`
  - `44.229.228.186`
  - `44.238.177.138`
- UDP 10000:10199 for strict, replay-protected RTP.
- TCP 3001 explicitly denied; Node binds to `127.0.0.1` as a second layer.
- IAX UDP 4569 is closed because no peers or channels use it.

Provider IP changes must be verified before replacing SIP allowlist entries. Never widen RADIUS to the public internet.
