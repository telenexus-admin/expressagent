# Nexa CloudOne Phone Panel V1

A deliberately small browser softphone for the existing CloudOne -> Asterisk deployment.

## Number allocation

- `254207913950` remains dedicated to Nexa AI.
- 254207913951 routes to its dedicated Nexa Vapi assistant SIP address.
- `254207913952` routes to the browser phone.
- `254207913953` routes to the browser phone.

The panel can select 951, 952, or 953 as the requested outbound caller ID. CloudOne remains authoritative about which assigned DIDs it accepts as outbound CLI.

## V1 features

- Browser WebRTC phone using SIP.js 0.21.2.
- One active call at a time.
- Incoming answer/reject.
- Outgoing calls to Kenyan mobile and landline numbers.
- Caller-ID selector for the three phone DIDs.
- Hang up and mute.
- Call timer.
- Asterisk CDR-backed recent call history.
- Separate browser login using Nginx Basic Auth.
- Dedicated internal Asterisk WebRTC extension `7001`.
- The CloudOne trunk password is never sent to the browser.

## Architecture

```text
Browser
  | HTTPS + WSS
  v
Nginx
  |-- /       -> isolated Node phone panel on 127.0.0.1:3015
  `-- /ws     -> Asterisk HTTP WebSocket service
                    |
                    `-> PJSIP extension 7001
                           |
                           `-> CloudOne endpoint
```

## DNS prerequisite

Create an A record for:

```text
phone.polyizon.tech -> 169.58.177.113
```

The installer stops without modifying the phone stack if the hostname does not resolve.

## Install on the production server

Do **not** `git pull` the live billing tree. Fetch only this directory from the production-sync branch, then run the installer.

```bash
cd /var/www/nexa-platform

git fetch origin production-sync-2026-08-04

git archive FETCH_HEAD telephony/cloudone-phone-panel | tar -x

chmod +x telephony/cloudone-phone-panel/install.sh

sudo bash telephony/cloudone-phone-panel/install.sh
```

The installer prompts locally for a browser-login password. It generates the internal WebRTC SIP password itself and stores it at `/etc/nexa-phone-panel/panel.env` with root-only permissions.

To use an email for Let's Encrypt renewal notices:

```bash
sudo CERTBOT_EMAIL='your-email@example.com' bash telephony/cloudone-phone-panel/install.sh
```

## Production isolation

The installer does not modify the Nexa billing backend, FreeRADIUS, MikroTik, WireGuard, NOC, TR-069, or the Vapi Nexa tool bridge. It only:

1. adds an Asterisk WebRTC extension and WS transport,
2. pins DID 951 to its dedicated Nexa Vapi assistant route,
3. routes DIDs 952-953 to the browser phone while leaving DID 950 on Nexa AI,
4. adds a small standalone Node service,
5. adds an Nginx virtual host for `phone.polyizon.tech`, and
6. enables Asterisk CSV CDR history for the call-log screen.

## V1 limitation

The browser page must remain open to receive calls. Reliable ringing while the browser/app is fully closed is a later PWA/native push phase.
