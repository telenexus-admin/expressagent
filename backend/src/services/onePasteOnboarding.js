const crypto = require('crypto');
const db = require('../db');
const { ensureMikrotikTables, activateWireguardPeer, decryptSecret, encryptSecret, saveRouter } = require('./mikrotik');
const { recordBillingEvent } = require('./events');
const { setRouterExecutorCredential, testRouterExecutorCredential } = require('./networkExecutor');
const { createEnrollment, markBootstrapConnected, queueEnrollmentDiscovery } = require('./networkEnrollment');

const WG_SERVER_IP = process.env.MIKROTIK_WG_SERVER_IP || process.env.WIREGUARD_SERVER_IP || '10.77.0.1';
const WG_PREFIX = process.env.MIKROTIK_WG_SUBNET_PREFIX || process.env.WIREGUARD_SUBNET_PREFIX || '10.77.0';
const WG_PUBLIC_KEY = process.env.MIKROTIK_WG_PUBLIC_KEY || process.env.WIREGUARD_SERVER_PUBLIC_KEY || 'zCy0rX2el4g0TLBDG8xSZCY2PqxgtyjJDsKqmBgVE08=';
const WG_ENDPOINT = process.env.MIKROTIK_WG_ENDPOINT || process.env.WIREGUARD_ENDPOINT || '64.227.156.219';
const WG_PORT = Number(process.env.MIKROTIK_WG_ENDPOINT_PORT || process.env.WIREGUARD_ENDPOINT_PORT || 51820);
const CALLBACK_BASE = String(process.env.PUBLIC_API_URL || 'https://nexa.telenexustechnologies.com').replace(/\/$/, '');

async function ensureTokens() {
  await ensureMikrotikTables();
  await db.query(`CREATE TABLE IF NOT EXISTS mikrotik_onboarding_tokens (
    id BIGSERIAL PRIMARY KEY,
    token_hash VARCHAR(128) UNIQUE NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_name VARCHAR(160) NOT NULL,
    tunnel_ip VARCHAR(45) NOT NULL,
    api_password_encrypted TEXT,
    executor_username VARCHAR(120),
    executor_password_encrypted TEXT,
    enrollment_id UUID,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  )`);
  await db.query(`ALTER TABLE mikrotik_onboarding_tokens ADD COLUMN IF NOT EXISTS api_password_encrypted TEXT`);
  await db.query(`ALTER TABLE mikrotik_onboarding_tokens ADD COLUMN IF NOT EXISTS executor_username VARCHAR(120)`);
  await db.query(`ALTER TABLE mikrotik_onboarding_tokens ADD COLUMN IF NOT EXISTS executor_password_encrypted TEXT`);
  await db.query(`ALTER TABLE mikrotik_onboarding_tokens ADD COLUMN IF NOT EXISTS enrollment_id UUID`);
}

async function allocate() {
  await ensureTokens();
  const used = await db.query(`SELECT wireguard_tunnel_ip FROM mikrotik_routers WHERE wireguard_tunnel_ip IS NOT NULL
    UNION SELECT tunnel_ip FROM mikrotik_onboarding_tokens WHERE used_at IS NULL AND expires_at>NOW()`);
  const taken = new Set(used.rows.map((row) => row.wireguard_tunnel_ip || row.tunnel_ip));
  for (let octet = 2; octet <= 254; octet += 1) {
    const ip = `${WG_PREFIX}.${octet}`;
    if (!taken.has(ip)) return ip;
  }
  throw new Error('No available private onboarding tunnel IPs remain');
}

function q(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function script({ apiPassword, executorPassword, tunnelIp, callbackToken }) {
  const wgName = `wg-nexa-${tunnelIp.split('.').pop()}`;
  return `# Nexa secure bootstrap-only enrollment
# Creates only the private management path and scoped Nexa identities.
# Subscriber services are planned later after read-only discovery and approval.
:local nexaWg "${q(wgName)}"
:local nexaCallback "${q(CALLBACK_BASE)}/api/public/mikrotik/onboard"
:local nexaPassword "${q(apiPassword)}"
:local nexaExecutorPassword "${q(executorPassword)}"
:local nexaTunnel "${q(tunnelIp)}"
:local nexaCallbackToken "${q(callbackToken)}"

:if ([:len [/interface/wireguard/find name=\$nexaWg]] = 0) do={ /interface/wireguard/add name=\$nexaWg mtu=1420 comment="NEXA managed WireGuard" }
:if ([:len [/ip/address/find address~("^" . \$nexaTunnel . "/") interface=\$nexaWg]] = 0) do={ /ip/address/add address=(\$nexaTunnel . "/24") interface=\$nexaWg comment="NEXA management tunnel" }
:if ([:len [/interface/wireguard/peers/find interface=\$nexaWg public-key="${q(WG_PUBLIC_KEY)}"]] = 0) do={ /interface/wireguard/peers/add interface=\$nexaWg public-key="${q(WG_PUBLIC_KEY)}" endpoint-address="${q(WG_ENDPOINT)}" endpoint-port=${WG_PORT} allowed-address="${WG_SERVER_IP}/32" persistent-keepalive=25s comment="NEXA server" }
:if ([:len [/ip/firewall/filter/find comment="NEXA API via WireGuard"]] = 0) do={ /ip/firewall/filter/add chain=input in-interface=\$nexaWg protocol=tcp dst-port=8728 src-address=${WG_SERVER_IP} action=accept comment="NEXA API via WireGuard" }
:if ([:len [/user/group/find name="nexa-readonly"]] = 0) do={/user/group/add name=nexa-readonly policy=read,test,api}
:if ([:len [/user/find name="nexa"]] = 0) do={/user/add name=nexa group=nexa-readonly password=\$nexaPassword}
/user/set [find name="nexa"] group=nexa-readonly password=\$nexaPassword
:if ([:len [/user/group/find name="nexa-executor"]] = 0) do={/user/group/add name=nexa-executor policy=read,write,test,api}
:if ([:len [/user/find name="nexa-executor"]] = 0) do={/user/add name=nexa-executor group=nexa-executor password=\$nexaExecutorPassword}
/user/set [find name="nexa-executor"] group=nexa-executor password=\$nexaExecutorPassword
/ip/service/enable api
/ip/service/set api port=8728 address="${WG_SERVER_IP}/32"

# Prove enrollment to Nexa. No RADIUS, PPPoE, Hotspot, VLAN, pool, NAT, DNS, or portal configuration occurs here.
:delay 3s
:local nexaPublicKey [/interface/wireguard/get [find name=\$nexaWg] public-key]
:local nexaBody ("{\\\"token\\\":\\\"" . \$nexaCallbackToken . "\\",\\\"public_key\\\":\\\"" . \$nexaPublicKey . "\\",\\\"tunnel_ip\\\":\\\"" . \$nexaTunnel . "\\"}")
/tool/fetch url=\$nexaCallback http-method=post http-header-field="Content-Type:application/json" http-data=\$nexaBody output=none
:put "NEXA SECURE ENROLLMENT SENT: discovery will continue in the billing dashboard"`;
}

async function prepareSinglePaste(clientId, payload = {}) {
  const name = String(payload.name || '').trim();
  const password = String(payload.password || '').trim();
  if (!name || password.length < 8) throw new Error('Router name and API password of at least 8 characters are required');
  const executorUsername = 'nexa-executor';
  const executorPassword = crypto.randomBytes(24).toString('base64url');
  const tunnelIp = await allocate();
  const token = crypto.randomBytes(32).toString('base64url');
  const enrollment = await createEnrollment(clientId, {
    router_name: name,
    tunnel_ip: tunnelIp,
    desired_services: payload.desired_services || { pppoe: true, hotspot: true },
  });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(`INSERT INTO mikrotik_onboarding_tokens
    (token_hash,client_id,router_name,tunnel_ip,api_password_encrypted,executor_username,
      executor_password_encrypted,enrollment_id,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()+INTERVAL '1 hour')`,
  [tokenHash, clientId, name, tunnelIp, encryptSecret(password), executorUsername,
    encryptSecret(executorPassword), enrollment.id]);
  return {
    enrollment_id: enrollment.id,
    tunnel_ip: tunnelIp,
    script: script({ apiPassword: password, executorPassword, tunnelIp, callbackToken: token }),
    expires_in_minutes: 60,
    executor: { username: executorUsername, stored_securely: true, enabled_after_verification: true },
    warning: 'Bootstrap only: subscriber and RADIUS settings remain unchanged until discovery, compatibility checks, and approval are complete.',
  };
}

async function completeSinglePaste(body = {}) {
  if (!body.token) throw new Error('Onboarding token is invalid or expired');
  const tokenHash = crypto.createHash('sha256').update(String(body.token)).digest('hex');
  const result = await db.query(`UPDATE mikrotik_onboarding_tokens SET used_at=NOW()
    WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING *`, [tokenHash]);
  const tokenRecord = result.rows[0];
  if (!tokenRecord) throw new Error('This onboarding token is invalid, expired, or already used');
  if (!tokenRecord.api_password_encrypted) throw new Error('This legacy token cannot be completed safely; generate a new script');
  if (!body.public_key || !body.tunnel_ip || body.tunnel_ip !== tokenRecord.tunnel_ip) {
    throw new Error('Router callback data is invalid');
  }

  await activateWireguardPeer({ public_key: body.public_key, tunnel_ip: body.tunnel_ip });
  const router = await saveRouter(tokenRecord.client_id, {
    name: tokenRecord.router_name,
    host: tokenRecord.tunnel_ip,
    port: 8728,
    connection_type: 'api',
    username: 'nexa',
    password: decryptSecret(tokenRecord.api_password_encrypted),
    connection_method: 'wireguard',
    wireguard_tunnel_ip: tokenRecord.tunnel_ip,
    wireguard_mikrotik_public_key: body.public_key,
  });

  let executorStatus = 'not_configured';
  if (tokenRecord.executor_username && tokenRecord.executor_password_encrypted) {
    await setRouterExecutorCredential(tokenRecord.client_id, router.id, {
      username: tokenRecord.executor_username,
      password: decryptSecret(tokenRecord.executor_password_encrypted),
    });
    executorStatus = 'unverified';
    try {
      const verified = await testRouterExecutorCredential(tokenRecord.client_id, router.id);
      executorStatus = verified.verification_status;
    } catch (_) {
      // Discovery and credential verification retry after the WireGuard handshake settles.
    }
  }

  await markBootstrapConnected(tokenRecord.client_id, tokenRecord.enrollment_id, router.id, {
    public_key: body.public_key,
    tunnel_ip: tokenRecord.tunnel_ip,
  });
  queueEnrollmentDiscovery(tokenRecord.client_id, tokenRecord.enrollment_id, router.id);

  await recordBillingEvent({
    clientId: tokenRecord.client_id,
    eventType: 'router.bootstrap_connected',
    category: 'router',
    source: 'mikrotik_onboarding_callback',
    entityType: 'router',
    entityId: router.id,
    actorType: 'router',
    actorId: router.id,
    actorName: router.name,
    title: 'Router secure bootstrap connected',
    description: `${router.name} connected; read-only discovery is queued`,
    payload: {
      router_name: router.name,
      tunnel_ip: tokenRecord.tunnel_ip,
      connection_method: 'wireguard',
      executor_status: executorStatus,
      enrollment_id: tokenRecord.enrollment_id,
    },
    relatedEntities: [{ entityType: 'router_enrollment', entityId: tokenRecord.enrollment_id, relationship: 'bootstrap_connected' }],
    deduplicationKey: `router:${router.id}:bootstrap-connected`,
    sensitivity: 'restricted',
  });

  return {
    ok: true,
    router_id: router.id,
    router_name: router.name,
    tunnel_ip: tokenRecord.tunnel_ip,
    enrollment_id: tokenRecord.enrollment_id,
    status: 'bootstrap_connected',
    executor_status: executorStatus,
  };
}

module.exports = { buildOnboardingScript: script, ensureTokens, prepareSinglePaste, completeSinglePaste };
