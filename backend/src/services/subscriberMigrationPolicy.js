const SUPPORTED_SERVICE_TYPES = Object.freeze(['pppoe', 'hotspot']);

function normalizeServiceType(value) {
  const serviceType = String(value || 'pppoe').trim().toLowerCase();
  if (!SUPPORTED_SERVICE_TYPES.includes(serviceType)) {
    throw new Error('Choose PPPoE or Hotspot clients.');
  }
  return serviceType;
}

function radiusServiceFor(serviceType) {
  return normalizeServiceType(serviceType) === 'hotspot' ? 'hotspot' : 'ppp';
}

function radiusCommentFor(serviceType) {
  return `POLYIZON migration RADIUS ${normalizeServiceType(serviceType)}`;
}

function migrationDestinationFor(serviceType) {
  return normalizeServiceType(serviceType) === 'hotspot'
    ? 'billing_hotspot_members'
    : 'billing_subscribers';
}

function planTableFor(serviceType) {
  return normalizeServiceType(serviceType) === 'hotspot'
    ? 'billing_hotspot_plans'
    : 'billing_plans';
}

function activeSessionIdentity(serviceType, row = {}) {
  const type = normalizeServiceType(serviceType);
  const id = String(row['.id'] || '').trim();
  if (id) return `id:${id}`;
  if (type === 'pppoe') {
    return `pppoe:${String(row.name || row.user || '').trim()}|${String(row.address || '').trim()}|${String(row['caller-id'] || row.caller_id || '').trim()}`;
  }
  return `hotspot:${String(row.user || row.username || row.name || '').trim()}|${String(row['mac-address'] || row.mac_address || '').trim()}|${String(row.address || '').trim()}`;
}

function missingActiveSessions(serviceType, before = [], after = []) {
  const afterIds = new Set(after.map((row) => activeSessionIdentity(serviceType, row)));
  return before.filter((row) => !afterIds.has(activeSessionIdentity(serviceType, row)));
}

function targetHotspotProfileIds(servers = []) {
  return [...new Set(
    servers
      .filter((server) => String(server.disabled || 'no').toLowerCase() !== 'yes')
      .map((server) => String(server.profile || '').trim())
      .filter(Boolean)
  )];
}

function safeRadiusSnapshot(rows = []) {
  return rows.map((row) => ({
    id: row['.id'],
    address: row.address || '',
    service: row.service || '',
    disabled: row.disabled || 'no',
    comment: row.comment || '',
  }));
}

function safePppSnapshot({ radius = [], aaa = [], active = [], secrets = [] } = {}) {
  return {
    service_type: 'pppoe',
    radius: safeRadiusSnapshot(radius),
    ppp_aaa: aaa.map((row) => ({
      use_radius: row['use-radius'] || 'no',
      accounting: row.accounting || 'no',
      interim_update: row['interim-update'] || '0s',
    })),
    active_pppoe_sessions: active.map((row) => ({
      id: row['.id'],
      name: row.name || '',
      address: row.address || '',
      caller_id: row['caller-id'] || '',
    })),
    local_pppoe_credentials: secrets.map((row) => ({
      id: row['.id'],
      name: row.name || '',
      disabled: row.disabled || 'no',
      profile: row.profile || '',
    })),
  };
}

function safeHotspotSnapshot({ radius = [], profiles = [], servers = [], active = [], users = [] } = {}) {
  return {
    service_type: 'hotspot',
    radius: safeRadiusSnapshot(radius),
    hotspot_profiles: profiles.map((row) => ({
      id: row['.id'],
      name: row.name || '',
      use_radius: row['use-radius'] || 'no',
      radius_accounting: row['radius-accounting'] || 'yes',
      radius_interim_update: row['radius-interim-update'] || 'received',
    })),
    hotspot_servers: servers.map((row) => ({
      id: row['.id'],
      name: row.name || '',
      profile: row.profile || '',
      disabled: row.disabled || 'no',
      interface: row.interface || '',
    })),
    active_hotspot_sessions: active.map((row) => ({
      id: row['.id'],
      user: row.user || row.username || '',
      address: row.address || '',
      mac_address: row['mac-address'] || '',
      server: row.server || '',
    })),
    local_hotspot_credentials: users.map((row) => ({
      id: row['.id'],
      name: row.name || '',
      disabled: row.disabled || 'no',
      profile: row.profile || '',
      server: row.server || '',
    })),
  };
}

module.exports = {
  SUPPORTED_SERVICE_TYPES,
  activeSessionIdentity,
  migrationDestinationFor,
  missingActiveSessions,
  normalizeServiceType,
  planTableFor,
  radiusCommentFor,
  radiusServiceFor,
  safeHotspotSnapshot,
  safePppSnapshot,
  safeRadiusSnapshot,
  targetHotspotProfileIds,
};
