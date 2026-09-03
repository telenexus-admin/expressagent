const db = require('../db');
const { connectRouter, getRouter } = require('./mikrotik');
const { normalizeServiceType } = require('./subscriberMigrationPolicy');
const { clean, lower } = require('./subscriberMigrationCommon');

const MAX_AGE_MINUTES = () => Math.max(5, Number(process.env.WISPMAN_MIGRATION_MAX_SNAPSHOT_MINUTES || 30));

function safeRouterAccount(row = {}) {
  return {
    id: row['.id'] || null,
    name: clean(row.name, 180),
    profile: clean(row.profile, 180),
    disabled: String(row.disabled || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    comment: clean(row.comment, 300),
    server: clean(row.server, 120),
  };
}

function safeSession(type, row = {}) {
  return normalizeServiceType(type) === 'hotspot'
    ? { id: row['.id'] || null, user: clean(row.user, 180), address: clean(row.address, 80), mac_address: clean(row['mac-address'], 80), server: clean(row.server, 120) }
    : { id: row['.id'] || null, name: clean(row.name, 180), address: clean(row.address, 80), caller_id: clean(row['caller-id'], 120) };
}

function legacyControllerCandidates(users = [], activeUsers = [], polyizonUsername = '') {
  const active = new Map(activeUsers.map((row) => [lower(row.name), row]));
  return users.flatMap((row) => {
    const name = clean(row.name, 120);
    if (!name || lower(name) === lower(polyizonUsername)) return [];
    const live = active.get(lower(name));
    const text = `${name} ${row.comment || ''}`.toLowerCase();
    let confidence = '';
    let reason = '';
    if (/wisp(?:man)?/.test(text)) {
      confidence = 'high'; reason = 'username/comment identifies Wispman';
    } else if (/\b(billing|api|ispmanager|manager)\b/.test(text) || /api/i.test(live?.via || '')) {
      confidence = 'medium'; reason = live ? 'billing-like account or active API session' : 'billing-like account';
    }
    if (!confidence) return [];
    return [{
      id: row['.id'] || null, name, group: clean(row.group, 120),
      disabled: String(row.disabled || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
      comment: clean(row.comment, 300), confidence, reason,
      active: Boolean(live), via: clean(live?.via, 80), address: clean(live?.address, 120),
    }];
  });
}

async function collectRouterInventory(clientId, routerId, serviceType) {
  const type = normalizeServiceType(serviceType);
  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router || router.is_active === false) throw new Error('The selected MikroTik is unavailable.');
  const api = await connectRouter(router);
  try {
    const accountPath = type === 'hotspot' ? '/ip/hotspot/user' : '/ppp/secret';
    const activePath = type === 'hotspot' ? '/ip/hotspot/active' : '/ppp/active';
    const accountProps = type === 'hotspot' ? '.id,name,profile,disabled,comment,server' : '.id,name,profile,disabled,comment';
    const activeProps = type === 'hotspot' ? '.id,user,address,mac-address,server' : '.id,name,address,caller-id';
    const [accounts, sessions, users, activeUsers] = await Promise.all([
      api.command(`${accountPath}/print`, { '.proplist': accountProps }),
      api.command(`${activePath}/print`, { '.proplist': activeProps }),
      api.command('/user/print', { '.proplist': '.id,name,group,disabled,comment' }).catch(() => []),
      api.command('/user/active/print', { '.proplist': '.id,name,address,via' }).catch(() => []),
    ]);
    return {
      router_id: routerId, router_name: router.name, controller_username: router.username, service_type: type,
      accounts: accounts.map(safeRouterAccount),
      active: sessions.map((row) => safeSession(type, row)),
      router_users: users.map((row) => ({ id: row['.id'] || null, name: clean(row.name, 120), group: clean(row.group, 120), disabled: String(row.disabled || 'no').toLowerCase() === 'yes' ? 'yes' : 'no', comment: clean(row.comment, 300) })),
      legacy_api_candidates: legacyControllerCandidates(users, activeUsers, router.username),
    };
  } finally { api.close(); }
}

function planMap(plans) {
  const map = new Map();
  for (const plan of plans) for (const key of [plan.name, plan.radius_profile]) if (key) map.set(lower(key), plan);
  return map;
}

async function existingIdentities(clientId) {
  const [ppp, hotspot] = await Promise.all([
    db.query('SELECT account_number,radius_username username FROM billing_subscribers WHERE client_id=$1', [clientId]),
    db.query('SELECT account_number,username FROM billing_hotspot_members WHERE client_id=$1', [clientId]),
  ]);
  const all = [...ppp.rows, ...hotspot.rows];
  return {
    accounts: new Set(all.map((row) => lower(row.account_number)).filter(Boolean)),
    usernames: new Set(all.map((row) => lower(row.username)).filter(Boolean)),
  };
}

function assertFresh(batch) {
  const age = Date.now() - new Date(batch.created_at).getTime();
  if (!Number.isFinite(age) || age > MAX_AGE_MINUTES() * 60000) {
    throw new Error(`This Wispman snapshot is older than ${MAX_AGE_MINUTES()} minutes. Upload a fresh export before continuing.`);
  }
}

function inventoryDrift(rows, inventory) {
  const byUser = new Map(inventory.accounts.map((row) => [lower(row.name), row]));
  return rows.flatMap((row) => {
    const expected = row.normalized || {};
    const live = byUser.get(lower(expected.username));
    if (!live) return [{ username: expected.username, reason: 'missing' }];
    if (expected.router_account_id && expected.router_account_id !== live.id) return [{ username: expected.username, reason: 'id_changed' }];
    if (String(expected.router_profile || '') !== String(live.profile || '')) return [{ username: expected.username, reason: 'profile_changed' }];
    if (String(expected.router_disabled || 'no') !== String(live.disabled || 'no')) return [{ username: expected.username, reason: 'enabled_state_changed' }];
    return [];
  });
}

module.exports = {
  MAX_AGE_MINUTES, assertFresh, collectRouterInventory, existingIdentities, inventoryDrift,
  legacyControllerCandidates, planMap, safeRouterAccount, safeSession,
};
