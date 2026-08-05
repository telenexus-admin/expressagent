const crypto = require('crypto');
const { Pool } = require('pg');
const db = require('../db');
const {
  connectRouter,
  decryptSecret,
  encryptSecret,
  getRouter,
} = require('./mikrotik');
const {
  ensureNetworkEnrollmentSchema,
} = require('./networkEnrollment');
const {
  ensureNetworkExecutorSchema,
} = require('./networkExecutor');
const {
  createHotspotPortalToken,
} = require('./hotspotPortalToken');
const {
  inspectRadiusNasRegistration,
  registerRadiusNas,
} = require('./radiusNasRegistry');

const DEFAULTS = {
  wan_interface: 'ether1',
  subscriber_bridge: 'bridge-nexa',
  hotspot_gateway: '10.20.0.1/24',
  hotspot_pool: '10.20.0.10-10.20.0.254',
  hotspot_dns_name: 'login.nexa.local',
  pppoe_local_address: '10.30.0.1',
  pppoe_pool: '10.30.0.10-10.30.0.254',
  pppoe_service_name: 'NEXA-PPPoE',
  radius_host:
    process.env.RADIUS_WIREGUARD_HOST ||
    process.env.MIKROTIK_WG_SERVER_IP ||
    process.env.WIREGUARD_SERVER_IP ||
    '10.77.0.1',
  radius_auth_port: 1812,
  radius_accounting_port: 1813,
  portal_url:
    process.env.HOTSPOT_PORTAL_URL ||
    'https://nexa.telenexustechnologies.com/hotspot',
};

let radiusPool;

function bool(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    String(value || '').toLowerCase()
  );
}

function cleanName(value, label) {
  const name = String(value || '').trim();
  if (!name || !/^[A-Za-z0-9_.:-]{1,80}$/.test(name)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return name;
}

function ipv4(value) {
  const text = String(value || '').trim();
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function privateIpv4(value) {
  if (!ipv4(value)) return false;
  const parts = value.split('.').map(Number);
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function validateCidr(value, label) {
  const text = String(value || '').trim();
  const [address, prefix] = text.split('/');
  if (!ipv4(address) || !/^\d{1,2}$/.test(prefix || '')) {
    throw new Error(`${label} must be a valid IPv4 CIDR`);
  }
  const bits = Number(prefix);
  if (bits < 8 || bits > 30) {
    throw new Error(`${label} prefix must be between /8 and /30`);
  }
  return text;
}

function validatePool(value, label) {
  const text = String(value || '').trim();
  const [start, end] = text.split('-');
  if (!ipv4(start) || !ipv4(end)) {
    throw new Error(`${label} must be an IPv4 start-end range`);
  }
  return text;
}

function asRows(value) {
  return Array.isArray(value) ? value : [];
}

function rowId(row) {
  return row?.['.id'];
}

function stripCidr(value) {
  return String(value || '').split('/')[0];
}

function subnetPrefix(value) {
  return stripCidr(value).split('.').slice(0, 3).join('.');
}

function safePortalBase(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:') {
    throw new Error('Hotspot portal URL must use HTTPS');
  }
  return url.toString().replace(/\/$/, '');
}

async function routerRows(client, path, attrs) {
  const result = await client.command(path, attrs);
  return asRows(result);
}

async function discover(client) {
  const interfaces = await routerRows(client, '/interface/print');
  const bridges = await routerRows(client, '/interface/bridge/print');
  const bridgePorts = await routerRows(
    client,
    '/interface/bridge/port/print'
  );
  const addresses = await routerRows(client, '/ip/address/print');
  const dhcpClients = await routerRows(client, '/ip/dhcp-client/print');
  const dhcpServers = await routerRows(client, '/ip/dhcp-server/print');
  const hotspotServers = await routerRows(client, '/ip/hotspot/print');
  const pppoeServers = await routerRows(
    client,
    '/interface/pppoe-server/server/print'
  );
  const radius = await routerRows(client, '/radius/print');

  const ethernetInterfaces = interfaces
    .filter((item) => {
      const type = String(item.type || '').toLowerCase();
      const name = String(item.name || '');
      return (
        !bool(item.disabled) &&
        (type.includes('ether') || /^ether\d+$/i.test(name))
      );
    })
    .map((item) => String(item.name));

  const boundWan = dhcpClients.find(
    (item) =>
      String(item.status || '').toLowerCase() === 'bound' &&
      ethernetInterfaces.includes(String(item.interface || ''))
  );

  const wanInterface = String(
    boundWan?.interface ||
    ethernetInterfaces.find((name) => name === 'ether1') ||
    ethernetInterfaces[0] ||
    DEFAULTS.wan_interface
  );

  const subscriberPorts = ethernetInterfaces.filter(
    (name) => name !== wanInterface
  );

  return {
    interfaces,
    ethernet_interfaces: ethernetInterfaces,
    bridges,
    bridge_ports: bridgePorts,
    addresses,
    dhcp_clients: dhcpClients,
    dhcp_servers: dhcpServers,
    hotspot_servers: hotspotServers,
    pppoe_servers: pppoeServers,
    radius,
    wan_interface: wanInterface,
    subscriber_ports: subscriberPorts,
  };
}

function normalizeConfig(input = {}, discovery = {}) {
  const incomingPorts = Array.isArray(input.subscriber_ports)
    ? input.subscriber_ports
    : String(input.subscriber_ports || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  const config = {
    ...DEFAULTS,
    ...input,
    mode: 'both',
    wan_interface:
      input.wan_interface ||
      discovery.wan_interface ||
      DEFAULTS.wan_interface,
    subscriber_ports:
      incomingPorts.length
        ? incomingPorts
        : discovery.subscriber_ports || [],
  };

  config.wan_interface = cleanName(
    config.wan_interface,
    'WAN interface'
  );
  config.subscriber_bridge = cleanName(
    config.subscriber_bridge,
    'Subscriber bridge'
  );
  config.hotspot_gateway = validateCidr(
    config.hotspot_gateway,
    'Hotspot gateway'
  );
  config.hotspot_pool = validatePool(
    config.hotspot_pool,
    'Hotspot pool'
  );
  config.pppoe_local_address = String(
    config.pppoe_local_address || ''
  ).trim();
  if (!ipv4(config.pppoe_local_address)) {
    throw new Error('PPPoE local address must be a valid IPv4 address');
  }
  config.pppoe_pool = validatePool(
    config.pppoe_pool,
    'PPPoE pool'
  );
  config.hotspot_dns_name = cleanName(
    config.hotspot_dns_name,
    'Hotspot DNS name'
  ).toLowerCase();
  config.pppoe_service_name = cleanName(
    config.pppoe_service_name,
    'PPPoE service name'
  );
  config.radius_host = String(config.radius_host || '').trim();
  if (!ipv4(config.radius_host)) {
    throw new Error('RADIUS WireGuard host must be an IPv4 address');
  }
  config.radius_auth_port = Number(config.radius_auth_port || 1812);
  config.radius_accounting_port = Number(
    config.radius_accounting_port || 1813
  );
  if (
    !Number.isInteger(config.radius_auth_port) ||
    !Number.isInteger(config.radius_accounting_port)
  ) {
    throw new Error('RADIUS ports must be whole numbers');
  }
  config.portal_url = safePortalBase(config.portal_url);

  const availablePorts = new Set(
    discovery.ethernet_interfaces || []
  );
  config.subscriber_ports = [...new Set(config.subscriber_ports)]
    .map((item) => cleanName(item, 'Subscriber port'))
    .filter(
      (item) =>
        item !== config.wan_interface &&
        (!availablePorts.size || availablePorts.has(item))
    );

  if (!config.subscriber_ports.length) {
    throw new Error('Select at least one subscriber LAN port');
  }

  if (
    config.subscriber_ports.includes(config.wan_interface)
  ) {
    throw new Error('The WAN port cannot also be a subscriber port');
  }

  return config;
}

function buildStages(config) {
  return [
    ['backup', 'Create a RouterOS safety backup'],
    ['bridge', `Create ${config.subscriber_bridge}`],
    ['ports', 'Move selected LAN ports to the subscriber bridge'],
    ['hotspot-address', 'Install the Hotspot gateway address'],
    ['hotspot-dhcp', 'Create Hotspot DHCP pool, network and server'],
    ['hotspot', 'Create the Hotspot profile and server'],
    ['pppoe', 'Create the PPPoE pool, profile and server'],
    ['radius', 'Register and configure RADIUS authentication'],
    ['portal', 'Install the signed Nexa captive portal'],
    ['nat', `Enable subscriber internet through ${config.wan_interface}`],
    ['validation', 'Validate Hotspot, PPPoE, RADIUS and portal services'],
  ].map(([stage, label]) => ({ stage, label }));
}

function preflight(config, discovery) {
  const blockers = [];
  const warnings = [];

  if (
    String(process.env.RADIUS_SYNC_ENABLED || '').toLowerCase() !==
    'true'
  ) {
    blockers.push('RADIUS_SYNC_ENABLED is not enabled on the backend');
  }
  if (!process.env.RADIUS_DATABASE_URL) {
    blockers.push('RADIUS_DATABASE_URL is not configured');
  }
  if (!privateIpv4(config.radius_host)) {
    blockers.push(
      'RADIUS_WIREGUARD_HOST must be a private IP reachable through WireGuard'
    );
  }
  try {
    createHotspotPortalToken(1);
  } catch (error) {
    blockers.push(error.message);
  }

  const gatewayPrefix = subnetPrefix(config.hotspot_gateway);
  const pppoePrefix = subnetPrefix(config.pppoe_local_address);
  const conflicts = (discovery.addresses || []).filter((item) => {
    const address = String(item.address || '');
    const managed = String(item.comment || '').startsWith('NEXA managed');
    return (
      !managed &&
      (address.startsWith(`${gatewayPrefix}.`) ||
        address.startsWith(`${pppoePrefix}.`))
    );
  });

  if (conflicts.length) {
    blockers.push(
      `The proposed 10.20.0.0/24 or 10.30.0.0/24 network conflicts with ${conflicts
        .map((item) => `${item.address} on ${item.interface}`)
        .join(', ')}`
    );
  }

  const foreignHotspot = (discovery.hotspot_servers || []).filter(
    (item) =>
      !String(item.comment || '').startsWith('NEXA managed')
  );
  const foreignPppoe = (discovery.pppoe_servers || []).filter(
    (item) =>
      !String(item.comment || '').startsWith('NEXA managed')
  );
  if (foreignHotspot.length || foreignPppoe.length) {
    warnings.push(
      'Existing non-Nexa Hotspot or PPPoE services were detected and will be left unchanged'
    );
  }

  const selectedPortAssignments = new Map(
    (discovery.bridge_ports || []).map((item) => [
      String(item.interface || ''),
      String(item.bridge || ''),
    ])
  );
  const moved = config.subscriber_ports.filter(
    (port) =>
      selectedPortAssignments.get(port) &&
      selectedPortAssignments.get(port) !== config.subscriber_bridge
  );
  if (moved.length) {
    warnings.push(
      `${moved.join(', ')} will move from their current bridge to ${config.subscriber_bridge}; connected devices may reconnect briefly`
    );
  }

  return { blockers, warnings };
}

async function ensureProvisioningTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mikrotik_provisioning_runs (
      id BIGSERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      router_id INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      backup_name VARCHAR(180),
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      error TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE
    )
  `);
  await db.query(`
    ALTER TABLE mikrotik_provisioning_runs
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_mikrotik_provisioning_client_router
    ON mikrotik_provisioning_runs(client_id, router_id, created_at DESC)
  `);
}

function getRadiusPool() {
  if (!process.env.RADIUS_DATABASE_URL) {
    throw new Error('RADIUS_DATABASE_URL is not configured');
  }
  if (!radiusPool) {
    radiusPool = new Pool({
      connectionString: process.env.RADIUS_DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 8000,
      query_timeout: 8000,
    });
  }
  return radiusPool;
}

async function radiusDatabasePreflight() {
  if (!process.env.RADIUS_DATABASE_URL) {
    return {
      ok: false,
      error: 'RADIUS_DATABASE_URL is not configured',
    };
  }

  try {
    const registration =
      await inspectRadiusNasRegistration(
        getRadiusPool()
      );

    return {
      ok: true,
      registration,
    };
  } catch (error) {
    return {
      ok: false,
      error: `RADIUS registration: ${error.message}`,
    };
  }
}

async function getProvisioningRouter(
  clientId,
  routerId
) {
  await ensureNetworkExecutorSchema();

  const router = await getRouter(
    clientId,
    routerId,
    { includePassword: false }
  );

  if (!router) {
    throw new Error(
      'MikroTik router not found in this billing account'
    );
  }

  if (router.connection_method !== 'wireguard') {
    throw new Error(
      'Router provisioning is allowed only through the private WireGuard tunnel'
    );
  }

  const result = await db.query(
    `SELECT
       username,
       password_encrypted,
       enabled,
       verification_status,
       last_error
     FROM network_router_executor_credentials
     WHERE client_id = $1
       AND router_id = $2
     LIMIT 1`,
    [clientId, routerId]
  );

  const credential = result.rows[0];

  if (!credential) {
    throw new Error(
      'The secure MikroTik provisioning executor is not configured'
    );
  }

  if (
    credential.verification_status !== 'verified' ||
    credential.enabled !== true
  ) {
    throw new Error(
      credential.last_error ||
      'The secure MikroTik provisioning executor is not verified'
    );
  }

  return {
    ...router,
    username: credential.username,
    password: decryptSecret(
      credential.password_encrypted
    ),
  };
}
async function getRadiusCredential(clientId, router) {
  await ensureNetworkEnrollmentSchema();
  const nasIp = String(
    router.wireguard_tunnel_ip || router.host || ''
  ).trim();
  if (!ipv4(nasIp)) {
    throw new Error('Router WireGuard tunnel IP is unavailable');
  }

  const existing = await db.query(
    `SELECT * FROM router_radius_credentials
     WHERE client_id = $1 AND router_id = $2`,
    [clientId, router.id]
  );

  if (existing.rows[0]) {
    const record = existing.rows[0];
    if (record.nas_ip !== nasIp) {
      await db.query(
        `UPDATE router_radius_credentials
         SET nas_ip = $3, registration_status = 'pending_registration', last_error = NULL
         WHERE client_id = $1 AND router_id = $2`,
        [clientId, router.id, nasIp]
      );
    }
    return {
      nas_identifier: record.nas_identifier,
      nas_ip: nasIp,
      secret: decryptSecret(record.shared_secret_encrypted),
    };
  }

  const nasIdentifier = `nexa-${clientId}-${router.id}-${router.name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
  const secret = crypto.randomBytes(32).toString('base64url');

  await db.query(
    `INSERT INTO router_radius_credentials
      (client_id, router_id, nas_identifier, nas_ip, shared_secret_encrypted)
     VALUES ($1, $2, $3, $4, $5)`,
    [clientId, router.id, nasIdentifier, nasIp, encryptSecret(secret)]
  );

  return {
    nas_identifier: nasIdentifier,
    nas_ip: nasIp,
    secret,
  };
}


async function ensureResource({
  client,
  printPath,
  addPath,
  setPath,
  match,
  attrs,
  stage,
  record,
}) {
  const rows = await routerRows(client, printPath);
  const existing = rows.find(match);
  if (existing && rowId(existing)) {
    await client.command(setPath, {
      '.id': rowId(existing),
      ...attrs,
    });
    await record(stage, 'completed', 'Existing resource updated');
    return existing;
  }
  const created = await client.command(addPath, attrs);
  await record(stage, 'completed', 'Resource created');
  return asRows(created)[0] || {};
}

async function ensureBridgePorts(client, config, record) {
  const ports = await routerRows(
    client,
    '/interface/bridge/port/print'
  );
  for (const interfaceName of config.subscriber_ports) {
    const existing = ports.find(
      (item) => String(item.interface || '') === interfaceName
    );
    if (existing && rowId(existing)) {
      await client.command('/interface/bridge/port/set', {
        '.id': rowId(existing),
        bridge: config.subscriber_bridge,
        disabled: 'no',
      });
    } else {
      await client.command('/interface/bridge/port/add', {
        bridge: config.subscriber_bridge,
        interface: interfaceName,
        disabled: 'no',
        comment: 'NEXA managed subscriber port',
      });
    }
  }
  await record(
    'ports',
    'completed',
    `${config.subscriber_ports.length} subscriber ports assigned`
  );
}

async function writePortalFile(client, config, portalToken, record) {
  const files = await routerRows(client, '/file/print');
  const existingFile = files.find(
    (item) => String(item.name || '') === 'nexa-hotspot/login.html'
  );
  if (existingFile && rowId(existingFile)) {
    await client.command('/file/remove', { '.id': rowId(existingFile) });
  }

  const existingDirectory = files.find(
    (item) => String(item.name || '') === 'nexa-hotspot'
  );
  if (!existingDirectory) {
    await client.command('/file/add', {
      name: 'nexa-hotspot',
      type: 'directory',
    });
  }

  const portal = config.portal_url;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting to Nexa</title></head><body><p>Opening the secure internet portal...</p><script>(function(){var q=new URLSearchParams();q.set('portalToken','${portalToken}');q.set('mac','$(mac)');q.set('ip','$(ip)');q.set('link-login-only','$(link-login-only)');q.set('link-orig','$(link-orig)');window.location.replace('${portal}?'+q.toString());})();</script></body></html>`;

  await client.command('/file/add', {
    name: 'nexa-hotspot/login.html',
    contents: html,
  });
  await record('portal', 'completed', 'Signed captive portal installed');
}

async function configureRouter({
  client,
  clientId,
  router,
  config,
  credential,
  record,
}) {
  const portalToken = createHotspotPortalToken(clientId);
  const hotspotGatewayIp = stripCidr(config.hotspot_gateway);
  const hotspotNetwork = `${subnetPrefix(config.hotspot_gateway)}.0/24`;

  await ensureResource({
    client,
    printPath: '/interface/bridge/print',
    addPath: '/interface/bridge/add',
    setPath: '/interface/bridge/set',
    match: (item) => item.name === config.subscriber_bridge,
    attrs: {
      name: config.subscriber_bridge,
      'protocol-mode': 'rstp',
      comment: 'NEXA managed subscriber bridge',
      disabled: 'no',
    },
    stage: 'bridge',
    record,
  });

  await ensureBridgePorts(client, config, record);

  await ensureResource({
    client,
    printPath: '/ip/address/print',
    addPath: '/ip/address/add',
    setPath: '/ip/address/set',
    match: (item) =>
      item.comment === 'NEXA managed hotspot gateway' ||
      (item.address === config.hotspot_gateway &&
        item.interface === config.subscriber_bridge),
    attrs: {
      address: config.hotspot_gateway,
      interface: config.subscriber_bridge,
      comment: 'NEXA managed hotspot gateway',
      disabled: 'no',
    },
    stage: 'hotspot-address',
    record,
  });

  await ensureResource({
    client,
    printPath: '/ip/pool/print',
    addPath: '/ip/pool/add',
    setPath: '/ip/pool/set',
    match: (item) => item.name === 'NEXA-HOTSPOT-POOL',
    attrs: {
      name: 'NEXA-HOTSPOT-POOL',
      ranges: config.hotspot_pool,
      comment: 'NEXA managed hotspot pool',
    },
    stage: 'hotspot-dhcp',
    record,
  });

  await ensureResource({
    client,
    printPath: '/ip/dhcp-server/network/print',
    addPath: '/ip/dhcp-server/network/add',
    setPath: '/ip/dhcp-server/network/set',
    match: (item) => item.comment === 'NEXA managed hotspot network',
    attrs: {
      address: hotspotNetwork,
      gateway: hotspotGatewayIp,
      'dns-server': hotspotGatewayIp,
      comment: 'NEXA managed hotspot network',
    },
    stage: 'hotspot-dhcp',
    record,
  });

  await ensureResource({
    client,
    printPath: '/ip/dhcp-server/print',
    addPath: '/ip/dhcp-server/add',
    setPath: '/ip/dhcp-server/set',
    match: (item) => item.name === 'NEXA-HOTSPOT-DHCP',
    attrs: {
      name: 'NEXA-HOTSPOT-DHCP',
      interface: config.subscriber_bridge,
      'address-pool': 'NEXA-HOTSPOT-POOL',
      'lease-time': '1h',
      disabled: 'no',
      comment: 'NEXA managed hotspot DHCP',
    },
    stage: 'hotspot-dhcp',
    record,
  });

  await client.command('/ip/dns/set', {
    'allow-remote-requests': 'yes',
  });

  await ensureResource({
    client,
    printPath: '/ip/hotspot/profile/print',
    addPath: '/ip/hotspot/profile/add',
    setPath: '/ip/hotspot/profile/set',
    match: (item) => item.name === 'NEXA-HOTSPOT-PROFILE',
    attrs: {
      name: 'NEXA-HOTSPOT-PROFILE',
      'hotspot-address': hotspotGatewayIp,
      'dns-name': config.hotspot_dns_name,
      'html-directory': 'nexa-hotspot',
      'login-by': 'http-chap,http-pap,cookie',
      'use-radius': 'yes',
      'radius-accounting': 'yes',
      'radius-interim-update': '1m',
      comment: 'NEXA managed hotspot profile',
    },
    stage: 'hotspot',
    record,
  });

  await ensureResource({
    client,
    printPath: '/ip/hotspot/print',
    addPath: '/ip/hotspot/add',
    setPath: '/ip/hotspot/set',
    match: (item) => item.name === 'NEXA-HOTSPOT',
    attrs: {
      name: 'NEXA-HOTSPOT',
      interface: config.subscriber_bridge,
      'address-pool': 'NEXA-HOTSPOT-POOL',
      profile: 'NEXA-HOTSPOT-PROFILE',
      disabled: 'no',
      comment: 'NEXA managed hotspot server',
    },
    stage: 'hotspot',
    record,
  });

  await ensureResource({
    client,
    printPath: '/ip/pool/print',
    addPath: '/ip/pool/add',
    setPath: '/ip/pool/set',
    match: (item) => item.name === 'NEXA-PPPOE-POOL',
    attrs: {
      name: 'NEXA-PPPOE-POOL',
      ranges: config.pppoe_pool,
      comment: 'NEXA managed PPPoE pool',
    },
    stage: 'pppoe',
    record,
  });

  await ensureResource({
    client,
    printPath: '/ppp/profile/print',
    addPath: '/ppp/profile/add',
    setPath: '/ppp/profile/set',
    match: (item) => item.name === 'NEXA-PPPOE-PROFILE',
    attrs: {
      name: 'NEXA-PPPOE-PROFILE',
      'local-address': config.pppoe_local_address,
      'remote-address': 'NEXA-PPPOE-POOL',
      'only-one': 'yes',
      'change-tcp-mss': 'yes',
      'use-compression': 'no',
      'use-encryption': 'no',
      comment: 'NEXA managed PPPoE profile',
    },
    stage: 'pppoe',
    record,
  });

  await ensureResource({
    client,
    printPath: '/interface/pppoe-server/server/print',
    addPath: '/interface/pppoe-server/server/add',
    setPath: '/interface/pppoe-server/server/set',
    match: (item) =>
      item.comment === 'NEXA managed PPPoE server' ||
      item['service-name'] === config.pppoe_service_name,
    attrs: {
      interface: config.subscriber_bridge,
      'service-name': config.pppoe_service_name,
      'default-profile': 'NEXA-PPPOE-PROFILE',
      authentication: 'pap,chap,mschap1,mschap2',
      'one-session-per-host': 'yes',
      disabled: 'no',
      comment: 'NEXA managed PPPoE server',
    },
    stage: 'pppoe',
    record,
  });

  const peers = await routerRows(
    client,
    '/interface/wireguard/peers/print'
  );
  const nexaPeer = peers.find(
    (item) => item.comment === 'NEXA server'
  );
  if (nexaPeer && rowId(nexaPeer)) {
    const allowed = new Set(
      String(nexaPeer['allowed-address'] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
    allowed.add('10.77.0.1/32');
    allowed.add(`${config.radius_host}/32`);
    await client.command('/interface/wireguard/peers/set', {
      '.id': rowId(nexaPeer),
      'allowed-address': [...allowed].join(','),
    });
  }

  await ensureResource({
    client,
    printPath: '/radius/print',
    addPath: '/radius/add',
    setPath: '/radius/set',
    match: (item) => item.comment === 'NEXA managed RADIUS',
    attrs: {
      service: 'hotspot,ppp',
      address: config.radius_host,
      secret: credential.secret,
      'authentication-port': String(config.radius_auth_port),
      'accounting-port': String(config.radius_accounting_port),
      'src-address': credential.nas_ip,
      timeout: '3s',
      comment: 'NEXA managed RADIUS',
      disabled: 'no',
    },
    stage: 'radius',
    record,
  });

  await client.command('/ppp/aaa/set', {
    'use-radius': 'yes',
    accounting: 'yes',
    'interim-update': '1m',
  });

  await ensureResource({
    client,
    printPath: '/ip/hotspot/walled-garden/print',
    addPath: '/ip/hotspot/walled-garden/add',
    setPath: '/ip/hotspot/walled-garden/set',
    match: (item) => item.comment === 'NEXA managed portal access',
    attrs: {
      'dst-host': new URL(config.portal_url).hostname,
      action: 'allow',
      comment: 'NEXA managed portal access',
      disabled: 'no',
    },
    stage: 'portal',
    record,
  });

  await writePortalFile(client, config, portalToken, record);

  await ensureResource({
    client,
    printPath: '/ip/firewall/nat/print',
    addPath: '/ip/firewall/nat/add',
    setPath: '/ip/firewall/nat/set',
    match: (item) => item.comment === 'NEXA managed subscriber NAT',
    attrs: {
      chain: 'srcnat',
      action: 'masquerade',
      'out-interface': config.wan_interface,
      comment: 'NEXA managed subscriber NAT',
      disabled: 'no',
    },
    stage: 'nat',
    record,
  });

  return portalToken;
}

async function validateRouter(client, config) {
  const bridges = await routerRows(client, '/interface/bridge/print');
  const addresses = await routerRows(client, '/ip/address/print');
  const dhcp = await routerRows(client, '/ip/dhcp-server/print');
  const hotspots = await routerRows(client, '/ip/hotspot/print');
  const pppoe = await routerRows(
    client,
    '/interface/pppoe-server/server/print'
  );
  const radius = await routerRows(client, '/radius/print');
  const files = await routerRows(client, '/file/print');
  const nat = await routerRows(client, '/ip/firewall/nat/print');

  const validation = {
    bridge: bridges.some(
      (item) => item.name === config.subscriber_bridge
    ),
    hotspot_gateway: addresses.some(
      (item) => item.comment === 'NEXA managed hotspot gateway'
    ),
    dhcp: dhcp.some((item) => item.name === 'NEXA-HOTSPOT-DHCP'),
    hotspot: hotspots.some((item) => item.name === 'NEXA-HOTSPOT'),
    pppoe: pppoe.some(
      (item) => item.comment === 'NEXA managed PPPoE server'
    ),
    radius: radius.some(
      (item) => item.comment === 'NEXA managed RADIUS'
    ),
    portal: files.some(
      (item) => item.name === 'nexa-hotspot/login.html'
    ),
    nat: nat.some(
      (item) => item.comment === 'NEXA managed subscriber NAT'
    ),
  };

  const missing = Object.entries(validation)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Provisioning validation failed: ${missing.join(', ')}`
    );
  }
  return validation;
}

async function previewProvisioning(clientId, routerId, input = {}) {
  const router = await getRouter(clientId, routerId, {
    includePassword: true,
  });
  if (!router) {
    throw new Error('MikroTik router not found in this billing account');
  }
  let client;
  try {
    client = await connectRouter(router);
    const discovery = await discover(client);
    const config = normalizeConfig(input, discovery);
    const readiness = preflight(config, discovery);
    const radiusCheck = await radiusDatabasePreflight();
    if (!radiusCheck.ok) readiness.blockers.push(radiusCheck.error);

    return {
      router: {
        id: router.id,
        name: router.name,
        host: router.host,
        port: router.port,
      },
      mode: 'both',
      discovery: {
        wan_interface: discovery.wan_interface,
        subscriber_ports: discovery.subscriber_ports,
        ethernet_interfaces: discovery.ethernet_interfaces,
        existing_bridge_names: discovery.bridges.map(
          (item) => item.name
        ),
      },
      config,
      stages: buildStages(config),
      blockers: [...new Set(readiness.blockers)],
      warnings: [...new Set(readiness.warnings)],
      ready: readiness.blockers.length === 0,
    };
  } finally {
    if (client) client.close();
  }
}

async function applyProvisioning(clientId, routerId, input = {}) {
  await ensureProvisioningTables();
  const router = await getProvisioningRouter(
    clientId,
    routerId
  );

  const preview = await previewProvisioning(clientId, routerId, input);
  if (preview.blockers.length) {
    throw new Error(
      `Provisioning blocked: ${preview.blockers.join('; ')}`
    );
  }
  const config = preview.config;
  const backupName = `nexa-before-services-${Date.now()}`;
  const run = await db.query(
    `INSERT INTO mikrotik_provisioning_runs
      (client_id, router_id, status, config, backup_name)
     VALUES ($1, $2, 'running', $3::jsonb, $4)
     RETURNING id`,
    [
      clientId,
      routerId,
      JSON.stringify({ ...config, radius_secret: '[managed]' }),
      backupName,
    ]
  );
  const runId = run.rows[0].id;
  const steps = [];
  let client;

  const record = async (stage, status, message) => {
    steps.push({ stage, status, message, at: new Date().toISOString() });
    await db.query(
      `UPDATE mikrotik_provisioning_runs
       SET steps = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(steps), runId]
    );
  };

  try {
    client = await connectRouter(router);

    await client.command(
      '/system/backup/save',
      { name: backupName }
    );

    await record(
      'backup',
      'completed',
      `Backup ${backupName} created`
    );

    const credential = await getRadiusCredential(
      clientId,
      router
    );

    const registration = await registerRadiusNas(
      getRadiusPool(),
      credential,
      router.name
    );

    await db.query(
      `UPDATE router_radius_credentials
       SET registration_status = 'registered',
           last_error = NULL,
           registered_at = NOW()
       WHERE client_id = $1 AND router_id = $2`,
      [clientId, routerId]
    );

    await record(
      'radius-registration',
      'completed',
      `FreeRADIUS client registered through ${
        registration.mode
      }`
    );

    await configureRouter({
      client,
      clientId,
      router,
      config,
      credential,
      record,
    });

    const validation = await validateRouter(client, config);
    await record('validation', 'completed', 'All required services validated');

    await db.query(
      `UPDATE mikrotik_provisioning_runs
       SET status = 'completed', steps = $1::jsonb,
           completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(steps), runId]
    );
    await db.query(
      `UPDATE mikrotik_routers
       SET provisioning_status = 'ready', provisioned_at = NOW(),
           last_status = 'online', last_error = NULL, updated_at = NOW()
       WHERE client_id = $1 AND id = $2`,
      [clientId, routerId]
    );

    return {
      run_id: runId,
      status: 'completed',
      service_status: 'ready',
      mode: 'both',
      backup_name: backupName,
      config,
      steps,
      validation,
      next_test:
        'Create one Hotspot voucher and one PPPoE subscriber, then connect test devices on the selected LAN ports.',
    };
  } catch (error) {
    await db.query(
      `UPDATE mikrotik_provisioning_runs
       SET status = 'failed', error = $1, steps = $2::jsonb,
           updated_at = NOW()
       WHERE id = $3`,
      [error.message, JSON.stringify(steps), runId]
    );
    await db.query(
      `UPDATE mikrotik_routers
       SET provisioning_status = 'failed', updated_at = NOW()
       WHERE client_id = $1 AND id = $2`,
      [clientId, routerId]
    ).catch(() => {});
    await db.query(
      `UPDATE router_radius_credentials
       SET registration_status = 'failed', last_error = $3
       WHERE client_id = $1 AND router_id = $2`,
      [clientId, routerId, error.message]
    ).catch(() => {});
    const backupCreated = steps.some(
      (step) =>
        step.stage === 'backup' &&
        step.status === 'completed'
    );

    throw new Error(
      backupCreated
        ? `${error.message}. Router backup: ${backupName}`
        : `${error.message}. No router service changes were applied.`
    );
  } finally {
    if (client) client.close();
  }
}

module.exports = {
  DEFAULTS,
  applyProvisioning,
  buildStages,
  normalizeConfig,
  previewProvisioning,
};
