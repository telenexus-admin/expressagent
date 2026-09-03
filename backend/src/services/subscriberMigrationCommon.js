const db = require('../db');

const CONFIRMATION = 'MIGRATE WITHOUT DISCONNECTING';
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const RADIUS_HOST = () => process.env.RADIUS_WIREGUARD_HOST || '10.78.0.2';
const clean = (value, length = 255) => String(value || '').trim().slice(0, length);
const lower = (value) => clean(value).toLowerCase();

function expiryOf(account) {
  if (!account.expiration_date) return null;
  let time = /^\d{2}:\d{2}(?::\d{2})?$/.test(account.expiration_time || '')
    ? account.expiration_time
    : '23:59:59';
  if (time.length === 5) time += ':00';
  const date = new Date(`${account.expiration_date}T${time}+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalized(account, expiry) {
  return {
    external_client_id: clean(account.external_client_id, 120),
    full_name: clean(account.full_name || account.username || account.account_number, 255),
    username: clean(account.login_username || account.username, 180),
    account_number: clean(account.account_number || account.username || account.external_client_id, 120),
    email: clean(account.email, 255),
    phone: clean(account.phone, 80),
    physical_address: clean(account.physical_address, 500),
    source_router: clean(account.router, 180),
    radius_profile: clean(account.radius_profile, 180),
    package_name: clean(account.package_name, 180),
    imported_status: clean(account.client_status || account.package_status, 80),
    expires_at: expiry ? expiry.toISOString() : null,
  };
}

function serviceStatusFor(account) {
  const expiry = account.expires_at ? new Date(account.expires_at) : null;
  if (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date()) return 'expired';
  if (/suspend|disable|block|inactive|terminated/i.test(account.imported_status || '')) return 'suspended';
  return 'active';
}

function isActive(account) {
  return serviceStatusFor(account) === 'active';
}

function normalizeRouterAddress(value) {
  return clean(value, 120).split('/')[0];
}

async function loadMigrationPlans(clientId, serviceType) {
  if (serviceType === 'hotspot') {
    return (await db.query(
      `SELECT id,name,mikrotik_rate_limit AS radius_profile
       FROM billing_hotspot_plans
       WHERE client_id=$1 AND is_active=TRUE`,
      [clientId]
    )).rows;
  }
  return (await db.query(
    `SELECT id,name,radius_profile
     FROM billing_plans
     WHERE client_id=$1 AND is_active=TRUE`,
    [clientId]
  )).rows;
}

async function loadExistingMigrationIdentities(clientId) {
  const [pppAccounts, hotspotAccounts, managedUsernames] = await Promise.all([
    db.query('SELECT account_number FROM billing_subscribers WHERE client_id=$1', [clientId]),
    db.query('SELECT account_number,username FROM billing_hotspot_members WHERE client_id=$1', [clientId]),
    db.query(
      `SELECT radius_username AS username,client_id,'pppoe' AS source
       FROM billing_subscribers
       WHERE radius_username IS NOT NULL AND radius_username<>''
       UNION ALL
       SELECT username,client_id,'hotspot' AS source
       FROM billing_hotspot_members
       WHERE username IS NOT NULL AND username<>''`
    ),
  ]);
  return {
    pppAccountNumbers: new Set(pppAccounts.rows.map((row) => lower(row.account_number)).filter(Boolean)),
    hotspotAccountNumbers: new Set(hotspotAccounts.rows.map((row) => lower(row.account_number)).filter(Boolean)),
    usernames: new Map(managedUsernames.rows.map((row) => [lower(row.username), row])),
  };
}

module.exports = {
  CONFIRMATION, MAX_FILE_BYTES, MAX_ROWS, RADIUS_HOST, clean, expiryOf, isActive,
  loadExistingMigrationIdentities, loadMigrationPlans, lower, normalizeRouterAddress,
  normalized, serviceStatusFor,
};
