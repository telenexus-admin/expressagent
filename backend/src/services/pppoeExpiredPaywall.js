const { URL } = require('url');
const { connectRouter, getRouter } = require('./mikrotik');

const EXPIRED_ADDRESS_LIST = 'POLYIZON-PPPOE-EXPIRED';
const PAYWALL_ALLOW_LIST = 'POLYIZON-PPPOE-PAYWALL-ALLOW';
const PAYWALL_PROXY_MARKER = 'POLYIZON PPPoE PAYWALL PROXY - DO NOT REMOVE';
const PAYWALL_NAT_MARKER = 'POLYIZON PPPoE EXPIRED HTTP REDIRECT - DO NOT REMOVE';
const PAYWALL_FILTER_PREFIX = 'POLYIZON PPPoE PAYWALL';

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function expiredPaywallEnabled() {
  return envTrue(process.env.PPPOE_EXPIRED_PAYWALL_ENABLED);
}

function expiredPaywallRateLimit() {
  const value = String(process.env.PPPOE_EXPIRED_PAYWALL_RATE_LIMIT || '512k/512k').trim();
  return value || '512k/512k';
}

function expiredPaywallSessionTimeout() {
  const seconds = Number(process.env.PPPOE_EXPIRED_PAYWALL_SESSION_TIMEOUT || 86400);
  return Math.min(604800, Math.max(900, Number.isFinite(seconds) ? Math.floor(seconds) : 86400));
}

function paywallProxyPort() {
  const port = Number(process.env.PPPOE_EXPIRED_PAYWALL_PROXY_PORT || 8080);
  return Math.min(65535, Math.max(1024, Number.isInteger(port) ? port : 8080));
}

function paywallUrl() {
  const configured = String(process.env.PPPOE_EXPIRED_PAYWALL_URL || '').trim();
  if (configured) return configured;
  const base = String(
    process.env.PUBLIC_BACKEND_URL ||
    process.env.FRONTEND_URL ||
    'https://billing.polyizon.tech'
  ).trim().replace(/\/$/, '');
  return `${base}/pppoe/pay?expired=1`;
}

function paywallHost() {
  const url = new URL(paywallUrl());
  if (url.protocol !== 'https:') {
    throw new Error('PPPOE_EXPIRED_PAYWALL_URL must use HTTPS');
  }
  return url.hostname;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function rowId(value) {
  return value?.['.id'] || null;
}

async function ensureCommentedRow(client, {
  printPath,
  addPath,
  setPath,
  comment,
  attributes,
}) {
  const existingRows = rows(await client.command(printPath));
  const existing = existingRows.find((item) => String(item.comment || '') === comment);
  if (existing && rowId(existing)) {
    await client.command(setPath, { '.id': rowId(existing), ...attributes, comment });
    return rowId(existing);
  }
  const created = await client.command(addPath, { ...attributes, comment });
  return rowId(Array.isArray(created) ? created[0] : created);
}

async function moveRow(client, movePath, id, destination = '0') {
  if (!id) return;
  try {
    await client.command(movePath, { '.id': id, destination: String(destination) });
  } catch (error) {
    // Some RouterOS API builds return an id without supporting move by .id.
    // The caller still has a valid rule; report ordering through verification.
    console.warn(`Could not move RouterOS paywall rule ${id}:`, error.message);
  }
}

async function ensureAllowHost(client) {
  const comment = `${PAYWALL_FILTER_PREFIX} HOST - DO NOT REMOVE`;
  const existingRows = rows(await client.command('/ip/firewall/address-list/print'));
  const existing = existingRows.find((item) => String(item.comment || '') === comment);
  const attributes = {
    list: PAYWALL_ALLOW_LIST,
    address: paywallHost(),
    disabled: 'no',
  };
  if (existing && rowId(existing)) {
    await client.command('/ip/firewall/address-list/set', { '.id': rowId(existing), ...attributes, comment });
    return;
  }
  await client.command('/ip/firewall/address-list/add', { ...attributes, comment });
}

async function ensureProxy(client) {
  const proxyRows = rows(await client.command('/ip/proxy/print'));
  const proxy = proxyRows[0] || {};
  const accessRows = rows(await client.command('/ip/proxy/access/print'));
  const marker = accessRows.find((item) => String(item.comment || '') === PAYWALL_PROXY_MARKER);
  const proxyCurrentlyEnabled = String(proxy.enabled || '').toLowerCase() === 'true'
    || String(proxy.enabled || '').toLowerCase() === 'yes';

  if (proxyCurrentlyEnabled && !marker) {
    throw new Error('MikroTik web proxy is already enabled for another purpose; Polyizon will not overwrite it');
  }

  const port = paywallProxyPort();
  await client.command('/ip/proxy/set', {
    enabled: 'yes',
    port: String(port),
    anonymous: 'yes',
  });

  const redirectAttrs = {
    action: 'deny',
    'redirect-to': paywallUrl(),
    disabled: 'no',
  };

  let accessId;
  if (marker && rowId(marker)) {
    accessId = rowId(marker);
    await client.command('/ip/proxy/access/set', {
      '.id': accessId,
      ...redirectAttrs,
      comment: PAYWALL_PROXY_MARKER,
    });
  } else {
    const created = await client.command('/ip/proxy/access/add', {
      ...redirectAttrs,
      comment: PAYWALL_PROXY_MARKER,
    });
    accessId = rowId(Array.isArray(created) ? created[0] : created);
  }
  await moveRow(client, '/ip/proxy/access/move', accessId, '0');
}

async function ensureFilterRules(client) {
  const port = String(paywallProxyPort());
  const specifications = [
    {
      comment: `${PAYWALL_FILTER_PREFIX} ALLOW PORTAL - DO NOT REMOVE`,
      attributes: {
        chain: 'forward',
        'src-address-list': EXPIRED_ADDRESS_LIST,
        'dst-address-list': PAYWALL_ALLOW_LIST,
        protocol: 'tcp',
        'dst-port': '80,443',
        action: 'accept',
        disabled: 'no',
      },
    },
    {
      comment: `${PAYWALL_FILTER_PREFIX} ALLOW DNS UDP - DO NOT REMOVE`,
      attributes: {
        chain: 'forward',
        'src-address-list': EXPIRED_ADDRESS_LIST,
        protocol: 'udp',
        'dst-port': '53',
        action: 'accept',
        disabled: 'no',
      },
    },
    {
      comment: `${PAYWALL_FILTER_PREFIX} ALLOW DNS TCP - DO NOT REMOVE`,
      attributes: {
        chain: 'forward',
        'src-address-list': EXPIRED_ADDRESS_LIST,
        protocol: 'tcp',
        'dst-port': '53',
        action: 'accept',
        disabled: 'no',
      },
    },
    {
      comment: `${PAYWALL_FILTER_PREFIX} BLOCK INTERNET - DO NOT REMOVE`,
      attributes: {
        chain: 'forward',
        'src-address-list': EXPIRED_ADDRESS_LIST,
        action: 'drop',
        disabled: 'no',
      },
    },
    {
      comment: `${PAYWALL_FILTER_PREFIX} ALLOW PROXY INPUT - DO NOT REMOVE`,
      attributes: {
        chain: 'input',
        'src-address-list': EXPIRED_ADDRESS_LIST,
        protocol: 'tcp',
        'dst-port': port,
        action: 'accept',
        disabled: 'no',
      },
    },
    {
      comment: `${PAYWALL_FILTER_PREFIX} BLOCK OTHER PROXY INPUT - DO NOT REMOVE`,
      attributes: {
        chain: 'input',
        protocol: 'tcp',
        'dst-port': port,
        action: 'drop',
        disabled: 'no',
      },
    },
  ];

  const ids = [];
  for (const specification of specifications) {
    const id = await ensureCommentedRow(client, {
      printPath: '/ip/firewall/filter/print',
      addPath: '/ip/firewall/filter/add',
      setPath: '/ip/firewall/filter/set',
      ...specification,
    });
    ids.push(id);
  }

  // Move in reverse so the final top-of-chain order matches specifications.
  for (const id of [...ids].reverse()) {
    await moveRow(client, '/ip/firewall/filter/move', id, '0');
  }
}

async function ensureNatRule(client) {
  const id = await ensureCommentedRow(client, {
    printPath: '/ip/firewall/nat/print',
    addPath: '/ip/firewall/nat/add',
    setPath: '/ip/firewall/nat/set',
    comment: PAYWALL_NAT_MARKER,
    attributes: {
      chain: 'dstnat',
      'src-address-list': EXPIRED_ADDRESS_LIST,
      protocol: 'tcp',
      'dst-port': '80',
      action: 'redirect',
      'to-ports': String(paywallProxyPort()),
      disabled: 'no',
    },
  });
  await moveRow(client, '/ip/firewall/nat/move', id, '0');
}

async function ensurePppoeExpiredPaywall({ clientId, routerId }) {
  if (!expiredPaywallEnabled()) {
    return { enabled: false, status: 'disabled_by_configuration' };
  }
  if (!clientId || !routerId) {
    throw new Error('PPPoE expired paywall requires an assigned MikroTik router');
  }

  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router || !router.is_active) {
    throw new Error('Assigned MikroTik router is unavailable for expired paywall enforcement');
  }

  const client = await connectRouter(router);
  try {
    await ensureAllowHost(client);
    await ensureProxy(client);
    await ensureFilterRules(client);
    await ensureNatRule(client);

    return {
      enabled: true,
      status: 'ready',
      router_id: router.id,
      address_list: EXPIRED_ADDRESS_LIST,
      allowed_destination_list: PAYWALL_ALLOW_LIST,
      portal_url: paywallUrl(),
      portal_host: paywallHost(),
      proxy_port: paywallProxyPort(),
    };
  } finally {
    client.close();
  }
}

async function inspectPppoeExpiredPaywall({ clientId, routerId }) {
  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router || !router.is_active) {
    throw new Error('Assigned MikroTik router is unavailable');
  }
  const client = await connectRouter(router);
  try {
    const [filters, nat, addresses, proxy, proxyAccess] = await Promise.all([
      client.command('/ip/firewall/filter/print'),
      client.command('/ip/firewall/nat/print'),
      client.command('/ip/firewall/address-list/print'),
      client.command('/ip/proxy/print'),
      client.command('/ip/proxy/access/print'),
    ]);
    return {
      router_id: router.id,
      enabled_by_configuration: expiredPaywallEnabled(),
      address_list: EXPIRED_ADDRESS_LIST,
      portal_url: paywallUrl(),
      filters: rows(filters).filter((item) => String(item.comment || '').startsWith(PAYWALL_FILTER_PREFIX)),
      nat: rows(nat).filter((item) => String(item.comment || '') === PAYWALL_NAT_MARKER),
      allow_hosts: rows(addresses).filter((item) => String(item.list || '') === PAYWALL_ALLOW_LIST),
      proxy: rows(proxy)[0] || null,
      proxy_access: rows(proxyAccess).filter((item) => String(item.comment || '') === PAYWALL_PROXY_MARKER),
    };
  } finally {
    client.close();
  }
}

module.exports = {
  EXPIRED_ADDRESS_LIST,
  PAYWALL_ALLOW_LIST,
  ensurePppoeExpiredPaywall,
  expiredPaywallEnabled,
  expiredPaywallRateLimit,
  expiredPaywallSessionTimeout,
  inspectPppoeExpiredPaywall,
  paywallHost,
  paywallProxyPort,
  paywallUrl,
};