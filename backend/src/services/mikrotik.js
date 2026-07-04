const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../db');

const execFileAsync = promisify(execFile);

const DEFAULT_FEATURES = {
  ppp_active: true,
  ppp_secrets: true,
  hotspot_active: true,
  dhcp_leases: true,
  interfaces: true,
  logs: true,
  ping: true,
};

const WIREGUARD_SERVER_IP = process.env.MIKROTIK_WG_SERVER_IP || process.env.WIREGUARD_SERVER_IP || '10.77.0.1';
const WIREGUARD_SUBNET_PREFIX = process.env.MIKROTIK_WG_SUBNET_PREFIX || process.env.WIREGUARD_SUBNET_PREFIX || '10.77.0';
const WIREGUARD_SERVER_PUBLIC_KEY = process.env.MIKROTIK_WG_PUBLIC_KEY || process.env.WIREGUARD_SERVER_PUBLIC_KEY || 'zCy0rX2el4g0TLBDG8xSZCY2PqxgtyjJDsKqmBgVE08=';
const WIREGUARD_ENDPOINT = process.env.MIKROTIK_WG_ENDPOINT || process.env.WIREGUARD_ENDPOINT || '64.227.156.219';
const WIREGUARD_ENDPOINT_PORT = Number(process.env.MIKROTIK_WG_ENDPOINT_PORT || process.env.WIREGUARD_ENDPOINT_PORT || 51820);
const WIREGUARD_INTERFACE = process.env.MIKROTIK_WG_INTERFACE || process.env.WIREGUARD_INTERFACE || 'wg-nexa';

function encryptionKey() {
  return crypto
    .createHash('sha256')
    .update(process.env.MIKROTIK_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || 'nexa-mikrotik-secret')
    .digest();
}

function encryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `gcm:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (!text.startsWith('gcm:')) return text;
  const [, iv64, tag64, data64] = text.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv64, 'base64'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data64, 'base64')), decipher.final()]).toString('utf8');
}

async function ensureMikrotikTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mikrotik_routers (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INTEGER NOT NULL DEFAULT 8728,
      connection_type VARCHAR(20) NOT NULL DEFAULT 'api',
      username VARCHAR(120) NOT NULL,
      password_encrypted TEXT NOT NULL,
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_status VARCHAR(40),
      last_error TEXT,
      last_identity VARCHAR(180),
      last_version VARCHAR(120),
      last_uptime VARCHAR(120),
      last_seen_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_client ON mikrotik_routers(client_id, is_active)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS mikrotik_clients (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      router_id INTEGER NOT NULL REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
      router_name VARCHAR(160),
      service_type VARCHAR(30) NOT NULL,
      account_number VARCHAR(180),
      username VARCHAR(180) NOT NULL,
      display_name VARCHAR(255),
      phone VARCHAR(80),
      profile VARCHAR(180),
      package_name VARCHAR(180),
      status VARCHAR(40),
      is_online BOOLEAN NOT NULL DEFAULT FALSE,
      expiry_date VARCHAR(80),
      expiry_time VARCHAR(40),
      ip_address VARCHAR(80),
      mac_address VARCHAR(80),
      uptime VARCHAR(120),
      last_seen VARCHAR(160),
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, router_id, service_type, username)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mikrotik_clients_client_service ON mikrotik_clients(client_id, service_type, is_online)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mikrotik_clients_client_phone ON mikrotik_clients(client_id, phone)`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS connection_method VARCHAR(40) NOT NULL DEFAULT 'public_api'`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS wireguard_tunnel_ip VARCHAR(45)`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS wireguard_interface VARCHAR(80)`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS wireguard_mikrotik_public_key TEXT`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS wireguard_billing_api_ips TEXT`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mikrotik_routers_wg_ip ON mikrotik_routers(wireguard_tunnel_ip) WHERE wireguard_tunnel_ip IS NOT NULL`);
}

function cleanFeatures(features) {
  const incoming = typeof features === 'object' && features ? features : {};
  return Object.fromEntries(Object.keys(DEFAULT_FEATURES).map((key) => [key, incoming[key] !== false]));
}

function safeRouter(row) {
  const features = cleanFeatures(row.features);
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    connection_type: row.connection_type || 'api',
    username: row.username,
    connection_method: row.connection_method || 'public_api',
    wireguard_tunnel_ip: row.wireguard_tunnel_ip || '',
    wireguard_interface: row.wireguard_interface || '',
    wireguard_mikrotik_public_key: row.wireguard_mikrotik_public_key || '',
    wireguard_billing_api_ips: row.wireguard_billing_api_ips || '',
    password_configured: Boolean(row.password_encrypted),
    features,
    is_active: row.is_active !== false,
    last_status: row.last_status || '',
    last_error: row.last_error || '',
    last_identity: row.last_identity || '',
    last_version: row.last_version || '',
    last_uptime: row.last_uptime || '',
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function routerOsQuote(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeApiAllowedIps(value) {
  const seen = new Set();
  const addresses = String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.includes('/') ? item : `${item}/32`))
    .filter((item) => {
      if (!/^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/.test(item)) return false;
      const [ip] = item.split('/');
      const validOctets = ip.split('.').every((part) => {
        const octet = Number(part);
        return Number.isInteger(octet) && octet >= 0 && octet <= 255;
      });
      if (!validOctets || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  const nexaAddress = `${WIREGUARD_SERVER_IP}/32`;
  if (!seen.has(nexaAddress)) addresses.push(nexaAddress);
  return addresses.join(',');
}

async function allocateWireguardTunnelIp(preferredIp = '') {
  await ensureMikrotikTables();
  const preferred = String(preferredIp || '').trim();
  if (preferred) {
    const taken = await db.query(`SELECT id FROM mikrotik_routers WHERE wireguard_tunnel_ip = $1 LIMIT 1`, [preferred]);
    if (!taken.rows[0]) return preferred;
  }
  const result = await db.query(`SELECT wireguard_tunnel_ip FROM mikrotik_routers WHERE wireguard_tunnel_ip IS NOT NULL`);
  const used = new Set(result.rows.map((row) => row.wireguard_tunnel_ip));
  for (let octet = 2; octet <= 254; octet += 1) {
    const ip = `${WIREGUARD_SUBNET_PREFIX}.${octet}`;
    if (!used.has(ip)) return ip;
  }
  throw new Error('No available WireGuard tunnel IPs remain in the Nexa pool');
}

function buildWireguardScripts({ tunnelIp, routerName, apiPassword, billingApiIps }) {
  const lastOctet = String(tunnelIp || '').split('.').pop() || '2';
  const interfaceName = `wg-nexa-${lastOctet}`;
  const password = apiPassword || 'ENTER_PASSWORD_HERE';
  const allowedApiIps = normalizeApiAllowedIps(billingApiIps);
  const mikrotikScript = `/interface/wireguard add name=${interfaceName} mtu=1420
/ip address add address=${tunnelIp}/24 interface=${interfaceName} comment="Nexa WireGuard tunnel - ${routerOsQuote(routerName || 'MikroTik')}"
/interface/wireguard/peers add interface=${interfaceName} public-key="${WIREGUARD_SERVER_PUBLIC_KEY}" endpoint-address=${WIREGUARD_ENDPOINT} endpoint-port=${WIREGUARD_ENDPOINT_PORT} allowed-address=${WIREGUARD_SERVER_IP}/32 persistent-keepalive=25s
/ip firewall filter add chain=input in-interface=${interfaceName} protocol=tcp dst-port=8728 src-address=${WIREGUARD_SERVER_IP} action=accept comment="Allow Nexa API via WireGuard"
/ip firewall filter move [find comment="Allow Nexa API via WireGuard"] 0
:if ([:len [/user group find name="nexa-readonly"]] = 0) do={/user group add name=nexa-readonly policy=read,test,api}
/user group set [find name="nexa-readonly"] policy=read,test,api
:if ([:len [/user find name="nexa"]] = 0) do={/user add name=nexa group=nexa-readonly password="${routerOsQuote(password)}"}
/user set [find name="nexa"] group=nexa-readonly password="${routerOsQuote(password)}"
/ip service enable api
/ip service set api port=8728 address=${allowedApiIps}
/interface/wireguard print detail where name="${interfaceName}"`;

  return { interfaceName, mikrotikScript };
}

function cleanWireguardPublicKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) {
    throw new Error('Enter a valid MikroTik WireGuard public key');
  }
  return key;
}

function cleanTunnelIp(value) {
  const ip = String(value || '').trim();
  const escapedPrefix = WIREGUARD_SUBNET_PREFIX.replace(/\./g, '\\.');
  const match = ip.match(new RegExp(`^${escapedPrefix}\\.(\\d{1,3})$`));
  if (!match) throw new Error(`Tunnel IP must be inside ${WIREGUARD_SUBNET_PREFIX}.0/24`);
  const lastOctet = Number(match[1]);
  if (!Number.isInteger(lastOctet) || lastOctet < 2 || lastOctet > 254) {
    throw new Error('Enter a valid WireGuard tunnel IP');
  }
  return ip;
}

function compactPhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('254') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`;
  return digits;
}

function phoneFromText(...values) {
  const text = values.filter(Boolean).join(' ');
  const match = text.match(/(?:\+?254|0)\d[\d\s-]{7,15}/);
  if (match) return compactPhone(match[0]);
  const compact = compactPhone(text);
  return compact.length >= 9 && compact.length <= 12 ? compact : '';
}

function extractMikrotikLookupCandidates({ customerPhone, messageText }) {
  const text = String(messageText || '');
  const values = new Set();
  const add = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    values.add(raw.toLowerCase());
    const phone = compactPhone(raw);
    if (phone) {
      values.add(phone);
      if (phone.startsWith('254')) values.add(`0${phone.slice(3)}`);
    }
  };
  add(customerPhone);
  const phoneMatches = text.match(/(?:\+?254|0)\d[\d\s-]{7,15}/g) || [];
  phoneMatches.forEach(add);
  const labelled = [
    ...text.matchAll(/\b(?:username|user\s*name|login|account\s*(?:number|no\.?)?|client\s*id)\s*(?:is|:|-)?\s*([A-Za-z0-9_.-]{2,50})\b/gi),
  ];
  labelled.forEach((match) => add(match[1]));
  if (!labelled.length && !phoneMatches.length) {
    const simple = text.trim();
    if (/^[A-Za-z0-9_.@-]{3,50}$/.test(simple) && !/^(hello|thanks|thank|status|expiry|expire|account|details)$/i.test(simple)) add(simple);
  }
  return Array.from(values);
}

function rowMatchesCandidates(row, candidates) {
  const fields = Object.values(row || {}).filter((value) => value != null && value !== '');
  return fields.some((field) => {
    const raw = String(field || '').toLowerCase();
    const phone = compactPhone(raw);
    const compactRaw = raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return candidates.some((candidate) => {
      const compactCandidate = String(candidate || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      return (
        raw === candidate ||
        raw.includes(candidate) ||
        compactRaw.includes(compactCandidate) ||
        (phone && (phone === candidate || phone === compactCandidate))
      );
    });
  });
}

function parsePossibleExpiry(...values) {
  const text = values.filter(Boolean).join(' ');
  const iso = text.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})(?:[ T,]+(\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (iso) return { expiration: iso[1].replace(/\//g, '-'), expiration_time: iso[2] || '' };
  const labelled = text.match(/\b(?:expir(?:y|es?|ation)|valid\s*until)\s*[:=-]?\s*([A-Za-z0-9 ,:/-]{6,30})/i);
  if (labelled) return { expiration: labelled[1].trim(), expiration_time: '' };
  return { expiration: '', expiration_time: '' };
}

function mikrotikStatusFromRows({ router, service, profile, secret, active, lease }) {
  const source = active || secret || lease || {};
  const expiry = parsePossibleExpiry(secret?.comment, active?.comment, lease?.comment);
  const disabled = String(secret?.disabled || '').toLowerCase() === 'true';
  const status = active ? 'active' : disabled ? 'inactive' : secret ? 'offline' : lease ? 'seen' : 'unknown';
  const activeIp = active?.address || active?.['remote-address'] || active?.['to-address'];
  return {
    source: 'mikrotik',
    fullname: source.comment || source.name || source.user || '',
    phone: phoneFromText(source.comment, source.name, source.user),
    account: source.name || source.user || source['mac-address'] || source.address || '',
    username: source.name || source.user || source['mac-address'] || source.address || '',
    status,
    plan: profile || source.profile || source.server || '',
    service,
    router: router.name,
    ip_address: activeIp || lease?.['active-address'] || lease?.address || '',
    mac_address: active?.['caller-id'] || active?.['mac-address'] || lease?.['mac-address'] || '',
    uptime: active?.uptime || active?.['idle-time'] || lease?.['last-seen'] || '',
    last_seen: active ? 'online now' : secret?.['last-logged-out'] || lease?.['last-seen'] || '',
    expiration: expiry.expiration,
    expiration_time: expiry.expiration_time,
    raw: { secret, active, lease },
  };
}

function normalizeServiceType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('hotspot')) return 'hotspot';
  if (text.includes('ppp')) return 'pppoe';
  return text || 'unknown';
}

function normalizeMikrotikClient({ clientId, router, service, profile, secret, active, lease }) {
  const status = mikrotikStatusFromRows({ router, service, profile, secret, active, lease });
  const username = status.username || status.account || status.phone || status.mac_address || status.ip_address;
  if (!username) return null;
  return {
    client_id: clientId,
    router_id: router.id,
    router_name: router.name,
    service_type: normalizeServiceType(service),
    account_number: status.account || username,
    username,
    display_name: status.fullname || username,
    phone: status.phone || '',
    profile: status.plan || profile || '',
    package_name: status.plan || profile || '',
    status: status.status || 'unknown',
    is_online: status.status === 'active',
    expiry_date: status.expiration || '',
    expiry_time: status.expiration_time || '',
    ip_address: status.ip_address || '',
    mac_address: status.mac_address || '',
    uptime: status.uptime || '',
    last_seen: status.last_seen || '',
    raw: status.raw || {},
  };
}

async function activeRouterConfigs(clientId) {
  await ensureMikrotikTables();
  const result = await db.query(
    `SELECT * FROM mikrotik_routers WHERE client_id = $1 AND is_active = TRUE ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`,
    [clientId]
  );
  return result.rows.map((row) => ({ ...row, password: decryptSecret(row.password_encrypted) }));
}

async function upsertMikrotikClient(row) {
  await db.query(
    `INSERT INTO mikrotik_clients (
       client_id, router_id, router_name, service_type, account_number, username, display_name, phone,
       profile, package_name, status, is_online, expiry_date, expiry_time, ip_address, mac_address,
       uptime, last_seen, raw, last_synced_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,NOW(),NOW())
     ON CONFLICT (client_id, router_id, service_type, username)
     DO UPDATE SET router_name = EXCLUDED.router_name,
                   account_number = EXCLUDED.account_number,
                   display_name = EXCLUDED.display_name,
                   phone = EXCLUDED.phone,
                   profile = EXCLUDED.profile,
                   package_name = EXCLUDED.package_name,
                   status = EXCLUDED.status,
                   is_online = EXCLUDED.is_online,
                   expiry_date = EXCLUDED.expiry_date,
                   expiry_time = EXCLUDED.expiry_time,
                   ip_address = EXCLUDED.ip_address,
                   mac_address = EXCLUDED.mac_address,
                   uptime = EXCLUDED.uptime,
                   last_seen = EXCLUDED.last_seen,
                   raw = EXCLUDED.raw,
                   last_synced_at = NOW(),
                   updated_at = NOW()`,
    [
      row.client_id,
      row.router_id,
      row.router_name,
      row.service_type,
      row.account_number,
      row.username,
      row.display_name,
      row.phone,
      row.profile,
      row.package_name,
      row.status,
      row.is_online,
      row.expiry_date,
      row.expiry_time,
      row.ip_address,
      row.mac_address,
      row.uptime,
      row.last_seen,
      JSON.stringify(row.raw || {}),
    ]
  );
}

async function markStaleMikrotikClientsOffline({ clientId, routerId, onlineRows }) {
  const onlineKeys = onlineRows
    .map((row) => `${row.service_type}:${row.username}`)
    .filter(Boolean);
  const values = [clientId, routerId];
  let staleFilter = '';

  if (onlineKeys.length) {
    values.push(onlineKeys);
    staleFilter = `AND NOT ((service_type || ':' || username) = ANY($${values.length}::text[]))`;
  }

  await db.query(
    `UPDATE mikrotik_clients
     SET is_online = FALSE,
         status = CASE WHEN status = 'active' THEN 'offline' ELSE status END,
         last_seen = CASE WHEN last_seen = 'online now' THEN 'not online in latest sync' ELSE last_seen END,
         last_synced_at = NOW(),
         updated_at = NOW()
     WHERE client_id = $1
       AND router_id = $2
       AND is_online = TRUE
       ${staleFilter}`,
    values
  );
}

async function collectMikrotikClientRows(clientId, router, client) {
  const [pppSecrets, pppActive, hotspotUsers, hotspotActive, hotspotHosts, dhcpLeases] = await Promise.all([
    router.features?.ppp_secrets === false ? Promise.resolve([]) : client.command('/ppp/secret/print').catch(() => []),
    router.features?.ppp_active === false ? Promise.resolve([]) : client.command('/ppp/active/print').catch(() => []),
    router.features?.hotspot_active === false ? Promise.resolve([]) : client.command('/ip/hotspot/user/print').catch(() => []),
    router.features?.hotspot_active === false ? Promise.resolve([]) : client.command('/ip/hotspot/active/print').catch(() => []),
    router.features?.hotspot_active === false ? Promise.resolve([]) : client.command('/ip/hotspot/host/print').catch(() => []),
    router.features?.dhcp_leases === false ? Promise.resolve([]) : client.command('/ip/dhcp-server/lease/print').catch(() => []),
  ]);

  const seen = new Set();
  const rows = [];
  const pushRow = (row) => {
    if (!row) return;
    const key = `${row.service_type}:${row.username}`;
    if (seen.has(key)) return;
    rows.push(row);
    seen.add(key);
  };

  for (const secret of pppSecrets) {
    const active = pppActive.find((item) => item.name === secret.name);
    pushRow(normalizeMikrotikClient({
      clientId,
      router,
      service: 'pppoe',
      profile: secret.profile || '',
      secret,
      active,
    }));
  }
  for (const active of pppActive) {
    pushRow(normalizeMikrotikClient({ clientId, router, service: 'pppoe', active }));
  }
  for (const user of hotspotUsers) {
    const active = hotspotActive.find((item) => item.user === user.name);
    pushRow(normalizeMikrotikClient({
      clientId,
      router,
      service: 'hotspot',
      profile: user.profile || '',
      secret: user,
      active,
    }));
  }
  for (const active of hotspotActive) {
    pushRow(normalizeMikrotikClient({ clientId, router, service: 'hotspot', active }));
  }
  for (const host of hotspotHosts) {
    pushRow(normalizeMikrotikClient({ clientId, router, service: 'hotspot', lease: host }));
  }
  for (const lease of dhcpLeases) {
    pushRow(normalizeMikrotikClient({ clientId, router, service: 'hotspot', lease }));
  }

  const onlineRows = rows.filter((row) => row.is_online);
  return {
    rows,
    onlineRows,
    onlinePppRows: onlineRows.filter((row) => row.service_type === 'pppoe'),
    onlineHotspotRows: onlineRows.filter((row) => row.service_type === 'hotspot'),
    sources: {
      router_id: router.id,
      router: router.name,
      ppp_secrets: pppSecrets.length,
      ppp_active: pppActive.length,
      hotspot_users: hotspotUsers.length,
      hotspot_active: hotspotActive.length,
      hotspot_hosts: hotspotHosts.length,
      dhcp_leases: dhcpLeases.length,
      deduped_online_pppoe: onlineRows.filter((row) => row.service_type === 'pppoe').length,
      deduped_online_hotspot: onlineRows.filter((row) => row.service_type === 'hotspot').length,
      deduped_total: rows.length,
    },
  };
}

function isExpiredMikrotikClient(row) {
  const expiry = String(row.expiry_date || '').trim();
  if (!expiry) return false;
  const match = expiry.match(/20\d{2}-\d{1,2}-\d{1,2}/);
  if (!match) return false;
  const date = new Date(`${match[0]}T23:59:59`);
  return !Number.isNaN(date.getTime()) && date < new Date();
}

function publicMikrotikClient(row) {
  return {
    ...row,
    is_online: row.is_online === true,
    is_expired: isExpiredMikrotikClient(row),
  };
}

async function syncMikrotikClients(clientId) {
  await ensureMikrotikTables();
  const routers = await activeRouterConfigs(clientId);
  const summary = { routers: routers.length, synced: 0, failed: 0, sources: [], errors: [] };

  for (const router of routers) {
    let client = null;
    try {
      client = await connectRouter(router);
      const collected = await collectMikrotikClientRows(clientId, router, client);
      summary.sources.push(collected.sources);

      for (const row of collected.rows) {
        await upsertMikrotikClient(row);
        summary.synced += 1;
      }
      await markStaleMikrotikClientsOffline({
        clientId,
        routerId: router.id,
        onlineRows: collected.onlineRows,
      });
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ router_id: router.id, router: router.name, error: err.message });
      console.error(`MikroTik client sync failed for router ${router.id}:`, err.message);
    } finally {
      if (client) client.close();
    }
  }
  return summary;
}

async function listMikrotikClients(clientId, filters = {}) {
  await ensureMikrotikTables();
  const params = [clientId];
  const where = ['client_id = $1'];
  const service = normalizeServiceType(filters.service_type || filters.service || '');
  if (['pppoe', 'hotspot'].includes(service)) {
    params.push(service);
    where.push(`service_type = $${params.length}`);
  }
  const status = String(filters.status || 'all').toLowerCase();
  if (status === 'online') where.push('is_online = TRUE');
  if (status === 'offline') where.push('is_online = FALSE');
  if (filters.search) {
    params.push(`%${String(filters.search).toLowerCase()}%`);
    where.push(`LOWER(COALESCE(username,'') || ' ' || COALESCE(display_name,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(account_number,'')) LIKE $${params.length}`);
  }
  const result = await db.query(
    `SELECT * FROM mikrotik_clients
     WHERE ${where.join(' AND ')}
     ORDER BY is_online DESC, last_synced_at DESC, updated_at DESC
     LIMIT 1000`,
    params
  );
  const rows = result.rows.map(publicMikrotikClient);
  const filtered = status === 'expired' ? rows.filter((row) => row.is_expired) : rows;
  return {
    clients: filtered,
    counts: {
      total: rows.length,
      online: rows.filter((row) => row.is_online).length,
      offline: rows.filter((row) => !row.is_online).length,
      expired: rows.filter((row) => row.is_expired).length,
      pppoe: rows.filter((row) => row.service_type === 'pppoe').length,
      hotspot: rows.filter((row) => row.service_type === 'hotspot').length,
    },
  };
}

async function findMikrotikAccount({ clientId, customerPhone, messageText }) {
  const candidates = extractMikrotikLookupCandidates({ customerPhone, messageText });
  if (!clientId || candidates.length === 0) return null;
  const routers = await activeRouterConfigs(clientId);
  for (const router of routers) {
    let client = null;
    try {
      client = await connectRouter(router);
      const pppSecrets = await client.command('/ppp/secret/print').catch(() => []);
      const pppActive = await client.command('/ppp/active/print').catch(() => []);
      const hotspotUsers = await client.command('/ip/hotspot/user/print').catch(() => []);
      const hotspotActive = await client.command('/ip/hotspot/active/print').catch(() => []);
      const leases = await client.command('/ip/dhcp-server/lease/print').catch(() => []);

      const pppSecret = pppSecrets.find((row) => rowMatchesCandidates(row, candidates));
      const pppLive = pppActive.find((row) => rowMatchesCandidates(row, candidates) || (pppSecret?.name && row.name === pppSecret.name));
      if (pppSecret || pppLive) {
        return mikrotikStatusFromRows({
          router,
          service: 'PPPoE',
          profile: pppSecret?.profile || pppLive?.service || '',
          secret: pppSecret,
          active: pppLive,
        });
      }

      const hotspotUser = hotspotUsers.find((row) => rowMatchesCandidates(row, candidates));
      const hotspotLive = hotspotActive.find((row) => rowMatchesCandidates(row, candidates) || (hotspotUser?.name && row.user === hotspotUser.name));
      if (hotspotUser || hotspotLive) {
        return mikrotikStatusFromRows({
          router,
          service: 'Hotspot',
          profile: hotspotUser?.profile || '',
          secret: hotspotUser,
          active: hotspotLive,
        });
      }

      const lease = leases.find((row) => rowMatchesCandidates(row, candidates));
      if (lease) {
        return mikrotikStatusFromRows({ router, service: 'DHCP lease', lease });
      }
    } catch (err) {
      console.error(`MikroTik account lookup failed for router ${router.id}:`, err.message);
    } finally {
      if (client) client.close();
    }
  }
  return null;
}

function wantsAny(text, patterns) {
  const value = String(text || '').toLowerCase();
  return patterns.some((pattern) => pattern.test(value));
}

function summarizeRows(rows, fields, limit = 8) {
  return (rows || []).slice(0, limit).map((row) => {
    const parts = fields
      .map(([key, label = key]) => row?.[key] ? `${label}: ${row[key]}` : null)
      .filter(Boolean);
    return parts.join(', ');
  }).filter(Boolean);
}

function uptimeToSeconds(value) {
  const text = String(value || '').toLowerCase();
  if (!text || text === 'not shown') return null;
  let total = 0;
  const weekMatch = text.match(/(\d+)w/);
  const dayMatch = text.match(/(\d+)d/);
  const hourMatch = text.match(/(\d+)h/);
  const minuteMatch = text.match(/(\d+)m/);
  const secondMatch = text.match(/(\d+)s/);
  if (weekMatch) total += Number(weekMatch[1]) * 7 * 24 * 60 * 60;
  if (dayMatch) total += Number(dayMatch[1]) * 24 * 60 * 60;
  if (hourMatch) total += Number(hourMatch[1]) * 60 * 60;
  if (minuteMatch) total += Number(minuteMatch[1]) * 60;
  if (secondMatch) total += Number(secondMatch[1]);
  return total || null;
}

function firstValue(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

function percentText(value) {
  const text = String(value || '').trim();
  if (!text || text === 'not shown') return 'not returned by RouterOS API';
  return text.endsWith('%') ? text : `${text}%`;
}

function parseRateBits(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  const numeric = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  if (text.includes('gbps') || text.includes('gbit')) return numeric * 1000000000;
  if (text.includes('mbps') || text.includes('mbit')) return numeric * 1000000;
  if (text.includes('kbps') || text.includes('kbit')) return numeric * 1000;
  return numeric;
}

function parseMetricNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function formatRate(value) {
  const bits = parseRateBits(value);
  if (!bits) return '0 bps';
  if (bits >= 1000000000) return `${(bits / 1000000000).toFixed(bits >= 10000000000 ? 0 : 1)} Gbps`;
  if (bits >= 1000000) return `${(bits / 1000000).toFixed(bits >= 10000000 ? 1 : 2)} Mbps`;
  if (bits >= 1000) return `${(bits / 1000).toFixed(bits >= 10000 ? 1 : 2)} kbps`;
  return `${Math.round(bits)} bps`;
}

function firstPresent(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

async function interfaceTrafficSnapshot(client, name) {
  const rows = await client.command('/interface/monitor-traffic', { interface: name, once: '' }).catch(() => []);
  return rows[0] || {};
}

async function summarizeInterfacesDetailed(client) {
  const interfaceRows = await client.command('/interface/print').catch(() => []);
  const physicalRows = (interfaceRows || [])
    .filter((row) => {
      const name = String(row.name || '');
      const type = String(row.type || '').toLowerCase();
      return /^(ether|sfp|combo|bridge|vlan|bonding|wg-|wireguard|lte)/i.test(name) ||
        ['ether', 'vlan', 'bridge', 'bonding', 'wireguard', 'lte'].includes(type);
    })
    .slice(0, 24);

  const trafficRows = await Promise.all(physicalRows.map(async (row) => ({
    row,
    traffic: row.running === 'true' && row.disabled !== 'true'
      ? await interfaceTrafficSnapshot(client, row.name)
      : {},
  })));

  const enriched = trafficRows.map(({ row, traffic }) => {
    const name = row.name || 'unnamed';
    const type = row.type || 'interface';
    const disabled = row.disabled === 'true';
    const running = row.running === 'true';
    const status = disabled ? 'disabled' : running ? 'connected/running' : 'not linked';
    const tx = firstPresent(traffic, ['tx-bits-per-second'], firstPresent(row, ['tx', 'tx-bits-per-second'], '0'));
    const rx = firstPresent(traffic, ['rx-bits-per-second'], firstPresent(row, ['rx', 'rx-bits-per-second'], '0'));
    const txPackets = firstPresent(traffic, ['tx-packets-per-second'], firstPresent(row, ['tx-packet', 'tx-packets'], '0'));
    const rxPackets = firstPresent(traffic, ['rx-packets-per-second'], firstPresent(row, ['rx-packet', 'rx-packets'], '0'));
    const mtu = firstPresent(row, ['actual-mtu', 'mtu', 'l2mtu'], 'not shown');
    return {
      name,
      type,
      disabled,
      running,
      status,
      tx,
      rx,
      txBits: parseRateBits(tx),
      rxBits: parseRateBits(rx),
      txPackets,
      rxPackets,
      mtu,
    };
  });

  const connected = enriched
    .filter((item) => item.running && !item.disabled)
    .sort((a, b) => (b.txBits + b.rxBits) - (a.txBits + a.rxBits));
  const inactive = enriched.filter((item) => !item.running && !item.disabled);
  const disabled = enriched.filter((item) => item.disabled);

  const lines = [];
  lines.push(`- Interface totals: ${enriched.length} shown, ${connected.length} connected/running, ${inactive.length} not linked, ${disabled.length} disabled.`);
  if (connected.length) {
    lines.push('- Connected ports with traffic:');
    connected.slice(0, 12).forEach((item) => {
      const trafficText = `TX ${formatRate(item.tx)}, RX ${formatRate(item.rx)}`;
      const packetText = `TX packets ${item.txPackets}, RX packets ${item.rxPackets}`;
      lines.push(`  - ${item.name}: ${item.type}, ${item.status}, MTU ${item.mtu}, ${trafficText}, ${packetText}`);
    });
  } else {
    lines.push('- Connected ports with traffic: none returned as running.');
  }
  if (inactive.length) {
    lines.push(`- Ports with no link: ${inactive.slice(0, 16).map((item) => item.name).join(', ')}${inactive.length > 16 ? '...' : ''}`);
  }
  if (disabled.length) {
    lines.push(`- Disabled ports: ${disabled.slice(0, 16).map((item) => item.name).join(', ')}${disabled.length > 16 ? '...' : ''}`);
  }
  lines.push('- Explanation: connected/running means RouterOS sees an active link. TX is traffic leaving the router on that interface; RX is traffic entering the router on that interface. 0 bps means the link may be up but idle during the check.');
  return lines;
}

function routerStatusMessages({ uptime, cpuLoad, pppCount, hotspotCount }) {
  const cpu = Number(cpuLoad);
  const totalSessions = Number(pppCount || 0) + Number(hotspotCount || 0);
  let cpuMessage = 'CPU usage was not returned by the router during this check.';
  if (Number.isFinite(cpu) && cpu < 50) {
    cpuMessage = 'CPU usage looks normal. The router is handling the current traffic comfortably.';
  } else if (Number.isFinite(cpu) && cpu < 70) {
    cpuMessage = 'CPU usage is slightly active but still under control. It is worth watching during peak hours.';
  } else if (Number.isFinite(cpu) && cpu < 85) {
    cpuMessage = 'CPU usage is getting high. Users may start noticing slow browsing, delayed responses, or unstable speeds.';
  } else if (Number.isFinite(cpu)) {
    cpuMessage = 'Sir, this router needs urgent attention. CPU load is very high and clients may experience slow internet, disconnections, or poor response time.';
  }

  const seconds = uptimeToSeconds(uptime);
  let uptimeMessage = 'Uptime was not returned by the router during this check.';
  if (seconds !== null && seconds < 24 * 60 * 60) {
    uptimeMessage = 'The router was restarted recently. Everything looks fresh, but if this happens often, we may need to check for power issues, crashes, or unstable configuration.';
  } else if (seconds !== null && seconds < 7 * 24 * 60 * 60) {
    uptimeMessage = 'Uptime looks normal. The router appears stable with no immediate reboot concern.';
  } else if (seconds !== null && seconds < 30 * 24 * 60 * 60) {
    uptimeMessage = 'The router has been running steadily for several days. This is okay as long as clients are browsing well and there are no complaints.';
  } else if (seconds !== null && seconds < 60 * 24 * 60 * 60) {
    uptimeMessage = 'The router has been online for a long time. If users are reporting slow speeds, delays, or random drops, a planned reboot during low-traffic hours may help refresh performance.';
  } else if (seconds !== null) {
    uptimeMessage = 'The router has stayed online for a very long time. That shows stability, but it can also allow small performance issues to build up quietly. A safe maintenance reboot during off-peak hours is recommended, especially if there are complaints, high CPU, or slow speeds.';
  }
  const routerStatus = totalSessions > 0 ? 'Online and serving clients' : 'Online, but no active client sessions were returned in this check';
  return { cpuMessage, uptimeMessage, routerStatus };
}

function analyzeRouterSecurityLogs(rows = []) {
  const attemptsBySource = new Map();
  const recentFailures = (rows || [])
    .map((row) => {
      const message = String(row.message || '').trim();
      const match = message.match(/login failure for user\s+(.+?)\s+from\s+([0-9a-fA-F:.]+)\s+via\s+([a-z0-9-]+)/i);
      if (!match) return null;
      return {
        time: row.time || row.date || '',
        username: String(match[1] || '').trim() || 'blank',
        source: match[2],
        method: String(match[3] || '').toLowerCase(),
        message,
      };
    })
    .filter(Boolean);

  for (const failure of recentFailures) {
    const key = `${failure.source}|${failure.method}`;
    const current = attemptsBySource.get(key) || {
      source: failure.source,
      method: failure.method,
      count: 0,
      users: new Set(),
      lastTime: failure.time,
    };
    current.count += 1;
    current.users.add(failure.username);
    current.lastTime = failure.time || current.lastTime;
    attemptsBySource.set(key, current);
  }

  const suspicious = [...attemptsBySource.values()]
    .filter((item) => item.count >= 3 || ['ssh', 'ftp', 'telnet', 'winbox'].includes(item.method))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (!suspicious.length) {
    return {
      hasIssue: false,
      summary: 'No recent login attack pattern was detected in the router logs returned by this check.',
      lines: [],
    };
  }

  const total = recentFailures.length;
  const lines = suspicious.map((item) => {
    const users = [...item.users].slice(0, 4).join(', ');
    return `${item.count} failed ${item.method.toUpperCase()} login attempts from ${item.source}${users ? ` using ${users}` : ''}`;
  });

  return {
    hasIssue: true,
    summary: `Security attention: the router logs show ${total} recent failed login attempt${total === 1 ? '' : 's'}. This looks like brute-force probing against remote access services.`,
    lines,
  };
}

async function buildMikrotikStatusReply({ clientId }) {
  if (!clientId) return '';
  const routers = await activeRouterConfigs(clientId);
  if (!routers.length) {
    return 'No active MikroTik routers are linked to this account yet.';
  }

  const router = routers[0];
  let client = null;
  try {
    client = await connectRouter(router);
    const identityRows = await client.command('/system/identity/print');
    const resourceRows = await client.command('/system/resource/print');
    const [collected, logRows] = await Promise.all([
      collectMikrotikClientRows(clientId, router, client),
      router.features?.logs === false ? Promise.resolve([]) : client.command('/log/print').catch(() => []),
    ]);
    const identity = identityRows[0]?.name || router.last_identity || router.name || 'this router';
    const resource = resourceRows[0];
    if (!resource) throw new Error('RouterOS did not return /system/resource/print data');
    const uptime = firstValue(resource, ['uptime'], 'not returned by RouterOS API');
    const cpuLoad = firstValue(resource, ['cpu-load', 'cpu'], 'not shown');
    const pppCount = collected.onlinePppRows.length;
    const hotspotCount = collected.onlineHotspotRows.length;
    const { cpuMessage, uptimeMessage, routerStatus } = routerStatusMessages({ uptime, cpuLoad, pppCount, hotspotCount });
    const security = analyzeRouterSecurityLogs(logRows);
    const servingLine = (pppCount + hotspotCount) > 0
      ? 'is online and currently serving clients'
      : 'is online, but no active client sessions were returned in this check';
    const securitySection = security.hasIssue
      ? `\n\nSecurity check:\n${security.summary}\n${security.lines.map((line) => `- ${line}`).join('\n')}\nRecommendation: restrict or disable public SSH/FTP/Winbox access, allow management only through trusted IPs or VPN, and keep the Nexa API limited to WireGuard.`
      : `\n\nSecurity check:\n${security.summary}`;

    return `Sir, your router ${identity} ${servingLine}.

It has been running for ${uptime}.

Currently, ${pppCount} homes are enjoying internet through PPPoE, while ${hotspotCount} hotspot users are connected.

These online numbers use the same logic as the Clients tab: PPP active plus Hotspot active sessions, deduped by account/IP/MAC. Hotspot hosts and DHCP leases are stored as seen/offline records, but are not counted as online by themselves.

CPU load is at ${percentText(cpuLoad)}.
${cpuMessage}

Uptime check:
${uptimeMessage}

Overall network view: ${routerStatus}${securitySection}`;

  } catch (err) {
    return `Sir, I could not complete the live router status check right now.

Router: ${router.name || 'Unknown'}
Status: Unavailable from the current read-only check
Error: ${err.message || 'connection failed'}`;
  } finally {
    if (client) client.close();
  }
}

async function buildMikrotikAdminContext({ clientId, messageText }) {
  if (!clientId) return '';
  const routers = await activeRouterConfigs(clientId);
  if (!routers.length) {
    return '\n\nROUTER ADMIN CONTEXT:\nNo active MikroTik routers are linked to this account yet.';
  }

  const wantsLogs = wantsAny(messageText, [/\blogs?\b/, /error/, /alert/, /attention/, /dhcp/, /warning/]);
  const wantsInterfaces = wantsAny(messageText, [/\binterfaces?\b/, /\bports?\b/, /ether/, /sfp/, /traffic/]);
  const wantsUsers = wantsAny(messageText, [/active users?/, /pppoe/, /hotspot/, /online users?/, /sessions?/]);
  const wantsAccount = extractMikrotikLookupCandidates({ customerPhone: '', messageText }).length > 0;
  const lines = [
    '',
    '',
    'ROUTER ADMIN CONTEXT:',
    'This is read-only live MikroTik data. Do not claim to reboot, disable, enable, pause, resume, change packages, modify firewall, or fix the router. Only explain observations and suggest safe next checks.',
  ];

  if (wantsAccount) {
    const account = await findMikrotikAccount({ clientId, customerPhone: '', messageText }).catch((err) => {
      console.error('MikroTik admin account lookup failed:', err.message);
      return null;
    });
    if (account) {
      lines.push('Matched client/account:');
      lines.push(`- Router: ${account.router || 'unknown'}`);
      lines.push(`- Service: ${account.service || 'unknown'}`);
      lines.push(`- Account: ${account.account || account.username || 'not shown'}`);
      lines.push(`- Status: ${account.status || 'unknown'}`);
      if (account.plan) lines.push(`- Plan/profile: ${account.plan}`);
      if (account.ip_address) lines.push(`- IP address: ${account.ip_address}`);
      if (account.mac_address) lines.push(`- MAC address: ${account.mac_address}`);
      if (account.uptime) lines.push(`- Uptime/session: ${account.uptime}`);
      if (account.last_seen) lines.push(`- Last seen: ${account.last_seen}`);
      if (account.expiration) lines.push(`- Expiry: ${account.expiration}${account.expiration_time ? ` ${account.expiration_time}` : ''}`);
    } else {
      lines.push('Matched client/account: none found in linked MikroTik routers.');
    }
  }

  for (const router of routers.slice(0, 5)) {
    let client = null;
    try {
      client = await connectRouter(router);
      const [identityRows, resourceRows, collected] = await Promise.all([
        client.command('/system/identity/print').catch(() => []),
        client.command('/system/resource/print').catch(() => []),
        collectMikrotikClientRows(clientId, router, client),
      ]);
      const identity = identityRows[0] || {};
      const resource = resourceRows[0] || {};
      lines.push('');
      lines.push(`Router ${router.name}: online`);
      lines.push(`- Checked at: ${new Date().toISOString()}`);
      lines.push(`- Identity: ${identity.name || router.last_identity || router.name}`);
      lines.push(`- RouterOS: ${resource.version || router.last_version || 'not shown'}`);
      lines.push(`- Uptime: ${resource.uptime || router.last_uptime || 'not shown'} (from /system/resource/print)`);
      if (resource['cpu-load']) lines.push(`- CPU load: ${resource['cpu-load']}%`);
      if (resource['free-memory']) lines.push(`- Free memory: ${resource['free-memory']}`);
      lines.push(`- Active PPPoE sessions: ${collected.onlinePppRows.length}`);
      lines.push(`- Active Hotspot clients: ${collected.onlineHotspotRows.length}`);
      lines.push(`- Client count source: PPP active ${collected.sources.ppp_active}, Hotspot active ${collected.sources.hotspot_active}, Hotspot hosts ${collected.sources.hotspot_hosts}, DHCP leases ${collected.sources.dhcp_leases}, deduped total ${collected.sources.deduped_total}`);

      if (router.features?.logs !== false) {
        const logRows = await client.command('/log/print').catch(() => []);
        const security = analyzeRouterSecurityLogs(logRows);
        lines.push(`- Security logs: ${security.summary}`);
        security.lines.forEach((line) => lines.push(`  - ${line}`));
      }

      if (wantsUsers) {
        const pppSummary = collected.onlinePppRows.slice(0, 8).map((row) => `${row.username || row.account_number || 'user'} ip=${row.ip_address || '-'} uptime=${row.uptime || '-'}`);
        const hotspotSummary = collected.onlineHotspotRows.slice(0, 8).map((row) => `${row.username || row.account_number || 'user'} ip=${row.ip_address || '-'} uptime=${row.uptime || '-'}`);
        if (pppSummary.length) lines.push(`- PPPoE sample: ${pppSummary.join(' | ')}`);
        if (hotspotSummary.length) lines.push(`- Hotspot sample: ${hotspotSummary.join(' | ')}`);
      }

      if (wantsInterfaces && router.features?.interfaces !== false) {
        lines.push('- Interface detail:');
        const interfaceLines = await summarizeInterfacesDetailed(client).catch((err) => [`- Interface details unavailable: ${err.message || 'RouterOS command failed'}`]);
        interfaceLines.forEach((line) => lines.push(line));
      }

      if (wantsLogs && router.features?.logs !== false) {
        const logRows = await client.command('/log/print').catch(() => []);
        const recent = (logRows || []).slice(-8).reverse().map((row) => {
          const time = row.time || row.date || '';
          const topics = row.topics || '';
          const message = row.message || '';
          return [time, topics, message].filter(Boolean).join(' ');
        }).filter(Boolean);
        lines.push(`- Recent logs: ${recent.length ? recent.join(' | ') : 'no recent logs returned'}`);
      }
    } catch (err) {
      lines.push('');
      lines.push(`Router ${router.name}: unavailable`);
      lines.push(`- Error: ${err.message || 'connection failed'}`);
    } finally {
      if (client) client.close();
    }
  }

  return lines.join('\n');
}

async function activateWireguardPeer(payload = {}) {
  const publicKey = cleanWireguardPublicKey(payload.public_key || payload.wireguard_mikrotik_public_key);
  const tunnelIp = cleanTunnelIp(payload.tunnel_ip || payload.wireguard_tunnel_ip);
  try {
    await execFileAsync('wg', ['set', WIREGUARD_INTERFACE, 'peer', publicKey, 'allowed-ips', `${tunnelIp}/32`], { timeout: 15000 });
    await execFileAsync('wg-quick', ['save', WIREGUARD_INTERFACE], { timeout: 15000 });
  } catch (err) {
    const detail = err.stderr || err.stdout || err.message;
    throw new Error(`Could not activate WireGuard peer on Nexa server: ${detail}`);
  }
  return {
    ok: true,
    interface: WIREGUARD_INTERFACE,
    public_key: publicKey,
    tunnel_ip: tunnelIp,
  };
}

async function prepareWireguardOnboarding(clientId, payload = {}) {
  const tunnelIp = await allocateWireguardTunnelIp(payload.wireguard_tunnel_ip);
  const scripts = buildWireguardScripts({
    tunnelIp,
    routerName: payload.name,
    apiPassword: payload.password,
    billingApiIps: payload.wireguard_billing_api_ips,
  });
  return {
    server_ip: WIREGUARD_SERVER_IP,
    server_public_key: WIREGUARD_SERVER_PUBLIC_KEY,
  endpoint: WIREGUARD_ENDPOINT,
  endpoint_port: WIREGUARD_ENDPOINT_PORT,
  wireguard_interface: WIREGUARD_INTERFACE,
  tunnel_ip: tunnelIp,
    api_host: tunnelIp,
    api_port: 8728,
    api_connection_type: 'api',
    username: 'nexa',
    ...scripts,
  };
}

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) return Buffer.from([(length >> 24) | 0xe0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.from([0xf0, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

function encodeWord(word) {
  const data = Buffer.from(String(word), 'utf8');
  return Buffer.concat([encodeLength(data.length), data]);
}

class RouterOsApi {
  constructor({ host, port, secure }) {
    this.host = host;
    this.port = Number(port || (secure ? 8729 : 8728));
    this.secure = secure;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const options = { host: this.host, port: this.port, rejectUnauthorized: false };
      const socket = this.secure ? tls.connect(options) : net.connect(options);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('MikroTik connection timed out'));
      }, 15000);
      socket.once(this.secure ? 'secureConnect' : 'connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on('data', (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); });
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  close() {
    if (this.socket) this.socket.end();
  }

  writeSentence(words) {
    const payload = Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
    this.socket.write(payload);
  }

  async waitForBuffer(count, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (this.buffer.length < count) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('MikroTik API response timed out');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async readByte() {
    await this.waitForBuffer(1);
    const byte = this.buffer[0];
    this.buffer = this.buffer.slice(1);
    return byte;
  }

  async readBytes(count) {
    await this.waitForBuffer(count);
    const chunk = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return chunk;
  }

  async readLength() {
    const first = await this.readByte();
    if ((first & 0x80) === 0x00) return first;
    if ((first & 0xc0) === 0x80) return ((first & ~0xc0) << 8) + await this.readByte();
    if ((first & 0xe0) === 0xc0) return ((first & ~0xe0) << 16) + ((await this.readByte()) << 8) + await this.readByte();
    if ((first & 0xf0) === 0xe0) return ((first & ~0xf0) << 24) + ((await this.readByte()) << 16) + ((await this.readByte()) << 8) + await this.readByte();
    return ((await this.readByte()) << 24) + ((await this.readByte()) << 16) + ((await this.readByte()) << 8) + await this.readByte();
  }

  async readWord() {
    const length = await this.readLength();
    if (length === 0) return '';
    return (await this.readBytes(length)).toString('utf8');
  }

  async readSentence() {
    const words = [];
    while (true) {
      const word = await this.readWord();
      if (!word) return words;
      words.push(word);
    }
  }

  async command(command, attrs = {}) {
    const words = [command, ...Object.entries(attrs).map(([key, value]) => `=${key}=${value}`)];
    this.writeSentence(words);
    const rows = [];
    while (true) {
      const sentence = await this.readSentence();
      const marker = sentence[0];
      const data = {};
      for (const word of sentence.slice(1)) {
        const match = word.match(/^=([^=]+)=(.*)$/);
        if (match) data[match[1]] = match[2];
      }
      if (marker === '!re') rows.push(data);
      if (marker === '!trap' || marker === '!fatal') throw new Error(data.message || 'RouterOS command failed');
      if (marker === '!done') return rows;
    }
  }

  async login(username, password) {
    await this.command('/login', { name: username, password });
  }
}

async function connectRouter(config) {
  const client = new RouterOsApi({
    host: config.host,
    port: config.port,
    secure: config.connection_type === 'api-ssl',
  });
  await client.connect();
  await client.login(config.username, config.password);
  return client;
}

async function probeRouter(config) {
  const client = await connectRouter(config);
  try {
    const identityRows = await client.command('/system/identity/print');
    const resourceRows = await client.command('/system/resource/print');
    const pppRows = await client.command('/ppp/active/print').catch(() => []);
    const hotspotRows = await client.command('/ip/hotspot/active/print').catch(() => []);
    const interfaceRows = await client.command('/interface/print').catch(() => []);
    const identity = identityRows[0] || {};
    const resource = resourceRows[0] || {};
    return {
      identity: identity.name || '',
      version: resource.version || '',
      uptime: resource.uptime || '',
      cpu_load: resource['cpu-load'] || '',
      free_memory: resource['free-memory'] || '',
      ppp_active_count: pppRows.length,
      hotspot_active_count: hotspotRows.length,
      interface_count: interfaceRows.length,
    };
  } finally {
    client.close();
  }
}

async function listRouters(clientId) {
  await ensureMikrotikTables();
  const result = await db.query(`SELECT * FROM mikrotik_routers WHERE client_id = $1 ORDER BY created_at DESC`, [clientId]);
  return result.rows.map(safeRouter);
}

async function getRouter(clientId, id, { includePassword = false } = {}) {
  await ensureMikrotikTables();
  const result = await db.query(`SELECT * FROM mikrotik_routers WHERE client_id = $1 AND id = $2 LIMIT 1`, [clientId, id]);
  const row = result.rows[0];
  if (!row) return null;
  return includePassword ? { ...row, password: decryptSecret(row.password_encrypted) } : safeRouter(row);
}

async function saveRouter(clientId, payload = {}) {
  await ensureMikrotikTables();
  const id = payload.id ? Number(payload.id) : null;
  const name = String(payload.name || '').trim().slice(0, 160);
  const host = String(payload.host || '').trim();
  const port = Number(payload.port || (payload.connection_type === 'api-ssl' ? 8729 : 8728));
  const connectionType = payload.connection_type === 'api-ssl' ? 'api-ssl' : 'api';
  const username = String(payload.username || '').trim().slice(0, 120);
  const connectionMethod = payload.connection_method === 'wireguard' ? 'wireguard' : 'public_api';
  const wireguardTunnelIp = String(payload.wireguard_tunnel_ip || '').trim() || null;
  const wireguardInterface = String(payload.wireguard_interface || '').trim() || null;
  const wireguardMikrotikPublicKey = String(payload.wireguard_mikrotik_public_key || '').trim() || null;
  const wireguardBillingApiIps = String(payload.wireguard_billing_api_ips || '').trim() || null;
  const features = cleanFeatures(payload.features);
  if (!name) throw new Error('Router name is required');
  if (!host) throw new Error('Router host/IP is required');
  if (!username) throw new Error('MikroTik username is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid MikroTik API port');

  if (id) {
    const current = await getRouter(clientId, id, { includePassword: false });
    if (!current) return null;
    const params = [
      name,
      host,
      port,
      connectionType,
      username,
      JSON.stringify(features),
      payload.is_active !== false,
      connectionMethod,
      wireguardTunnelIp,
      wireguardInterface,
      wireguardMikrotikPublicKey,
      wireguardBillingApiIps,
      clientId,
      id,
    ];
    const passwordSql = payload.password ? ', password_encrypted = $13' : '';
    const queryParams = payload.password
      ? [...params.slice(0, 12), encryptSecret(payload.password), clientId, id]
      : params;
    const result = await db.query(
      `UPDATE mikrotik_routers
       SET name = $1, host = $2, port = $3, connection_type = $4, username = $5,
           features = $6::jsonb, is_active = $7, connection_method = $8,
           wireguard_tunnel_ip = $9, wireguard_interface = $10,
           wireguard_mikrotik_public_key = $11, wireguard_billing_api_ips = $12,
           updated_at = NOW()${passwordSql}
       WHERE client_id = $${queryParams.length - 1} AND id = $${queryParams.length}
       RETURNING *`,
      queryParams
    );
    return safeRouter(result.rows[0]);
  }

  if (!payload.password) throw new Error('MikroTik password is required');
  const result = await db.query(
    `INSERT INTO mikrotik_routers
       (client_id, name, host, port, connection_type, username, password_encrypted, features, is_active,
        connection_method, wireguard_tunnel_ip, wireguard_interface, wireguard_mikrotik_public_key, wireguard_billing_api_ips)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      clientId,
      name,
      host,
      port,
      connectionType,
      username,
      encryptSecret(payload.password),
      JSON.stringify(features),
      payload.is_active !== false,
      connectionMethod,
      wireguardTunnelIp,
      wireguardInterface,
      wireguardMikrotikPublicKey,
      wireguardBillingApiIps,
    ]
  );
  return safeRouter(result.rows[0]);
}

async function testRouterConfig(config) {
  const password = config.password || (config.password_encrypted ? decryptSecret(config.password_encrypted) : '');
  return probeRouter({ ...config, password });
}

async function updateRouterStatus(clientId, id, status) {
  const result = await db.query(
    `UPDATE mikrotik_routers
     SET last_status = $1, last_error = $2, last_identity = $3, last_version = $4,
         last_uptime = $5, last_seen_at = COALESCE($6::timestamptz, last_seen_at),
         updated_at = NOW()
     WHERE client_id = $7 AND id = $8
     RETURNING *`,
    [
      status.ok ? 'online' : 'error',
      status.error || null,
      status.identity || null,
      status.version || null,
      status.uptime || null,
      status.ok ? new Date() : null,
      clientId,
      id,
    ]
  );
  return result.rows[0] ? safeRouter(result.rows[0]) : null;
}

function pickWanInterface(interfaces = []) {
  const usable = interfaces.filter((item) => item && item.disabled !== 'true' && item.disabled !== true);
  const explicitWan = usable.find((item) => /\b(wan|internet|uplink|provider|backhaul)\b/i.test(`${item.name || ''} ${item.comment || ''}`));
  return explicitWan || {};
}

function monitoringInterfaceSummary(interfaces = []) {
  return interfaces.map((item) => ({
    name: item.name || '',
    comment: item.comment || '',
    type: item.type || '',
    running: item.running === true || item.running === 'true',
    disabled: item.disabled === true || item.disabled === 'true',
    rx_bps: parseRateBits(item.rx || item['rx-rate'] || item['rx-bits-per-second'] || item['rx-byte'] || 0),
    tx_bps: parseRateBits(item.tx || item['tx-rate'] || item['tx-bits-per-second'] || item['tx-byte'] || 0),
    speed: item['actual-speed'] || item.speed || item['link-speed'] || '',
  }));
}

async function monitorCommand(client, path, fallback = []) {
  try {
    return { ok: true, rows: await client.command(path) };
  } catch (err) {
    return { ok: false, rows: fallback, error: err.message || 'command failed' };
  }
}

async function collectMonitoringSnapshot(router) {
  const config = router.password ? router : { ...router, password: decryptSecret(router.password_encrypted) };
  let client = null;
  try {
    client = await connectRouter(config);
    const [identityResult, resourceResult, pppResult, hotspotResult, interfaceResult, logResult] = await Promise.all([
      monitorCommand(client, '/system/identity/print'),
      monitorCommand(client, '/system/resource/print'),
      router.features?.ppp_active === false ? Promise.resolve({ ok: false, rows: [], disabled: true }) : monitorCommand(client, '/ppp/active/print'),
      router.features?.hotspot_active === false ? Promise.resolve({ ok: false, rows: [], disabled: true }) : monitorCommand(client, '/ip/hotspot/active/print'),
      router.features?.interfaces === false ? Promise.resolve({ ok: false, rows: [], disabled: true }) : monitorCommand(client, '/interface/print'),
      router.features?.logs === false ? Promise.resolve({ ok: false, rows: [], disabled: true }) : monitorCommand(client, '/log/print'),
    ]);
    const identityRows = identityResult.rows;
    const resourceRows = resourceResult.rows;
    const pppActive = pppResult.rows;
    const hotspotActive = hotspotResult.rows;
    const interfaces = interfaceResult.rows;
    const logs = logResult.rows;
    const resource = resourceRows[0] || {};
    const identity = identityRows[0]?.name || router.last_identity || router.name;
    const ifaceSummary = monitoringInterfaceSummary(interfaces);
    const wan = pickWanInterface(ifaceSummary);
    const cpuValue = firstValue(resource, ['cpu-load', 'cpu'], null);
    const freeMemory = firstValue(resource, ['free-memory'], null);
    const totalMemory = firstValue(resource, ['total-memory'], null);
    const freeStorage = firstValue(resource, ['free-hdd-space', 'free-disk-space'], null);
    const totalStorage = firstValue(resource, ['total-hdd-space', 'total-disk-space'], null);
    const badBlocks = firstValue(resource, ['bad-blocks'], null);
    return {
      ok: true,
      router_id: router.id,
      client_id: router.client_id,
      router_name: identity || router.name,
      version: firstValue(resource, ['version'], ''),
      uptime: firstValue(resource, ['uptime'], ''),
      cpu_load: cpuValue === null ? null : Number(cpuValue),
      free_memory: freeMemory === null ? null : Number(freeMemory),
      total_memory: totalMemory === null ? null : Number(totalMemory),
      free_storage: freeStorage === null ? null : Number(freeStorage),
      total_storage: totalStorage === null ? null : Number(totalStorage),
      bad_blocks: parseMetricNumber(badBlocks),
      active_pppoe: pppResult.ok ? pppActive.length : null,
      active_hotspot: hotspotResult.ok ? hotspotActive.length : null,
      wan_interface: wan.name || '',
      wan_link_status: wan.name ? (wan.running ? 'running' : 'down') : 'unknown',
      wan_link_speed: wan.speed || '',
      wan_rx_mbps: wan.name ? Number(((wan.rx_bps || 0) / 1000000).toFixed(2)) : null,
      wan_tx_mbps: wan.name ? Number(((wan.tx_bps || 0) / 1000000).toFixed(2)) : null,
      interfaces: ifaceSummary,
      logs,
      source_ok: {
        identity: identityResult.ok,
        resource: resourceResult.ok,
        ppp_active: pppResult.ok,
        hotspot_active: hotspotResult.ok,
        interfaces: interfaceResult.ok,
        logs: logResult.ok,
      },
      checked_at: new Date(),
    };
  } finally {
    if (client) client.close();
  }
}

async function deleteRouter(clientId, id) {
  await ensureMikrotikTables();
  const result = await db.query(`DELETE FROM mikrotik_routers WHERE client_id = $1 AND id = $2 RETURNING id`, [clientId, id]);
  return Boolean(result.rows[0]);
}

module.exports = {
  DEFAULT_FEATURES,
  deleteRouter,
  ensureMikrotikTables,
  getRouter,
  listMikrotikClients,
  listRouters,
  activateWireguardPeer,
  buildMikrotikAdminContext,
  buildMikrotikStatusReply,
  collectMonitoringSnapshot,
  findMikrotikAccount,
  prepareWireguardOnboarding,
  saveRouter,
  syncMikrotikClients,
  testRouterConfig,
  updateRouterStatus,
};
