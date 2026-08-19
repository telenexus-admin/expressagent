# CloudOne → Asterisk → Nexa/Vapi SIP Gateway

This directory deploys a small Asterisk/PJSIP gateway for the CloudOne SIP trunk used by Nexa.

## What it does

- Registers the server to `ls02.cloudone.co.ke:5060` over UDP using the CloudOne SIP account.
- Accepts inbound calls for the bundled DIDs:
  - `254207913950`
  - `254207913951`
  - `254207913952`
  - `254207913953`
- Creates/reuses a Vapi SIP phone-number URI attached to the existing Nexa assistant.
- Forwards every inbound CloudOne call to Nexa over SIP at `sip.vapi.ai`.
- Keeps CloudOne and Vapi secrets out of Git.
- Does not touch the billing backend, MikroTik, RADIUS, WireGuard, NOC, or TR-069 configuration.

## Production assumptions

- Production server public IP: `169.58.177.113`
- CloudOne registrar: `ls02.cloudone.co.ke`
- SIP transport: UDP
- SIP signaling port: `5060`
- CloudOne login: `telenexus`
- Existing Vapi server env: `/etc/nexa-platform/vapi-outbound.env`
- Existing Vapi env contains `VAPI_PRIVATE_API_KEY` and `VAPI_ALERT_ASSISTANT_ID`.
- Vapi region is US (`https://api.vapi.ai`, `sip.vapi.ai`).

The CloudOne SIP password is requested interactively during installation and stored only at `/etc/nexa-cloudone/cloudone.env` with mode `600`.

## Deploy

From the repository root on the production server:

```bash
sudo bash telephony/cloudone-asterisk/install.sh
```

The installer is idempotent. It backs up any Asterisk config it changes under `/var/backups/nexa-cloudone/`.

## Verify

```bash
sudo bash telephony/cloudone-asterisk/status.sh
```

Healthy registration should show a CloudOne PJSIP registration with status `Registered`.

Then call any of the four CloudOne DIDs from a normal mobile phone. Asterisk should receive the inbound call and bridge it to the Nexa Vapi assistant.

## Firewall

If UFW is active, the installer allows:

- UDP 5060 only from IPv4 addresses currently resolved for `ls02.cloudone.co.ke`.
- UDP 10000-20000 for RTP media.

When CloudOne provides authoritative RTP media subnets, tighten the RTP rule to those ranges.

CloudOne must whitelist the production server IP `169.58.177.113` (or the PBX FQDN they approve).

## Security

- No SIP password is committed to this repository.
- No Vapi private key is committed to this repository.
- The inbound PJSIP endpoint is identified against the CloudOne hostname.
- The Vapi SIP URI itself does not require SIP registration/authentication; Vapi documents direct SIP URI calling for SIP phone numbers.
- Rotate the CloudOne SIP password if it has ever been exposed outside the server.

## Rollback

```bash
sudo bash telephony/cloudone-asterisk/rollback.sh
```

Rollback restores the most recent Asterisk backups created by this deployment and restarts Asterisk. It does not delete the Vapi SIP phone-number resource automatically.
