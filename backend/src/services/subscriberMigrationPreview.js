const crypto = require('crypto');
const db = require('../db');
const { parseBillingImportUpload } = require('./billing');
const { encryptPassword } = require('./radiusSync');
const { getRouter, syncMikrotikClients } = require('./mikrotik');
const { normalizeServiceType } = require('./subscriberMigrationPolicy');
const { ensureMigrationSchema, getBatch } = require('./subscriberMigrationSchema');
const {
  MAX_FILE_BYTES, MAX_ROWS, clean, expiryOf, loadExistingMigrationIdentities,
  loadMigrationPlans, lower, normalized,
} = require('./subscriberMigrationCommon');

function planLookup(plans) {
  const map = new Map();
  for (const plan of plans) {
    for (const value of [plan.name, plan.radius_profile]) {
      if (value) map.set(lower(value), plan);
    }
  }
  return map;
}

async function previewMigration(input) {
  await ensureMigrationSchema();
  const clientId = input.clientId;
  const routerId = Number(input.routerId);
  const serviceType = normalizeServiceType(input.serviceType);
  if (!routerId) throw new Error('Select the MikroTik that will receive these clients.');
  if (!input.fileBuffer?.length) throw new Error('Choose a CSV or XLSX file.');
  if (input.fileBuffer.length > MAX_FILE_BYTES) throw new Error('Migration files must be 8 MB or smaller.');

  const router = await getRouter(clientId, routerId);
  if (!router || router.is_active === false) throw new Error('The selected MikroTik is unavailable.');
  await syncMikrotikClients(clientId).catch(() => null);

  const parsed = parseBillingImportUpload({
    fileName: input.fileName,
    fileBuffer: input.fileBuffer,
    csvText: input.fileBuffer.toString('utf8'),
    billingSystem: input.sourceSystem,
    columnMap: input.columnMap || {},
  });
  if (parsed.accounts.length > MAX_ROWS) throw new Error('A migration batch can contain at most 5,000 clients.');

  const [plans, existing, liveResult] = await Promise.all([
    loadMigrationPlans(clientId, serviceType),
    loadExistingMigrationIdentities(clientId),
    db.query(
      `SELECT id,username,is_online
       FROM mikrotik_clients
       WHERE client_id=$1 AND router_id=$2 AND service_type=$3`,
      [clientId, routerId, serviceType]
    ),
  ]);
  const plansByName = planLookup(plans);
  const liveByUsername = new Map(liveResult.rows.map((row) => [lower(row.username), row]));
  const seenAccounts = new Set();
  const seenUsernames = new Set();
  const rows = [];

  for (const account of parsed.accounts) {
    const errors = [];
    const warnings = [];
    const expiry = expiryOf(account);
    const value = normalized(account, expiry);
    const usernameKey = lower(value.username);
    const accountKey = lower(value.account_number);
    const mappedId = (input.packageMap || {})[value.package_name] || (input.packageMap || {})[value.radius_profile];
    const plan = mappedId
      ? plans.find((candidate) => Number(candidate.id) === Number(mappedId))
      : plansByName.get(lower(value.package_name)) || plansByName.get(lower(value.radius_profile));

    if (!value.full_name) errors.push('Client name is missing.');
    if (!value.username) errors.push('Username is missing.');
    if (!account.login_password) errors.push('Password is missing; transparent re-authentication cannot be guaranteed.');
    if (!value.account_number) errors.push('Account number is missing.');
    if (!expiry) errors.push('A valid exact expiry date is required.');
    if (!plan) errors.push(`Package could not be matched to a Polyizon ${serviceType === 'hotspot' ? 'Hotspot' : 'PPPoE'} package.`);
    if (accountKey && seenAccounts.has(accountKey)) errors.push('Duplicate account number in this file.');
    if (usernameKey && seenUsernames.has(usernameKey)) errors.push('Duplicate username in this file.');

    const serviceAccounts = serviceType === 'hotspot' ? existing.hotspotAccountNumbers : existing.pppAccountNumbers;
    if (accountKey && serviceAccounts.has(accountKey)) errors.push('Account number already exists in Polyizon.');
    if (usernameKey && existing.usernames.has(usernameKey)) {
      const conflict = existing.usernames.get(usernameKey);
      errors.push(`Username already exists in Polyizon ${conflict.source === 'hotspot' ? 'Hotspot' : 'PPPoE'} authentication.`);
    }

    const live = liveByUsername.get(usernameKey);
    if (!live) warnings.push('Username was not found on the selected MikroTik.');
    else if (!live.is_online) warnings.push('Client exists on the router but is not currently online.');
    if (expiry && expiry <= new Date()) warnings.push('Imported subscription is already expired.');

    if (accountKey) seenAccounts.add(accountKey);
    if (usernameKey) seenUsernames.add(usernameKey);
    rows.push({
      rowNumber: account.row_number,
      normalized: value,
      password: account.login_password ? encryptPassword(account.login_password) : null,
      errors,
      warnings,
      status: errors.length ? 'error' : warnings.length ? 'warning' : 'ready',
      planId: plan?.id || null,
      liveId: live?.id || null,
    });
  }

  const summary = {
    total: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    warnings: rows.filter((row) => row.status === 'warning').length,
    errors: rows.filter((row) => row.status === 'error').length,
    online_matches: rows.filter((row) => row.liveId && !row.errors.length).length,
    service_type: serviceType,
    safety_mode: 'non_disruptive_shadow_radius',
  };
  const batchId = crypto.randomUUID();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO billing_subscriber_migration_batches
       (id,client_id,router_id,service_type,source_system,file_name,total_rows,ready_rows,
        warning_rows,error_rows,source_headers,summary,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)`,
      [
        batchId, clientId, routerId, serviceType, clean(input.sourceSystem || 'generic', 40),
        clean(input.fileName, 255), summary.total, summary.ready, summary.warnings, summary.errors,
        JSON.stringify(parsed.headers), JSON.stringify(summary), input.adminId || null,
      ]
    );
    for (const row of rows) {
      await client.query(
        `INSERT INTO billing_subscriber_migration_rows
         (batch_id,client_id,row_number,normalized,password_ciphertext,validation_status,errors,warnings,
          matched_plan_id,matched_hotspot_plan_id,matched_live_client_id)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
        [
          batchId, clientId, row.rowNumber, JSON.stringify(row.normalized), row.password, row.status,
          JSON.stringify(row.errors), JSON.stringify(row.warnings),
          serviceType === 'pppoe' ? row.planId : null,
          serviceType === 'hotspot' ? row.planId : null,
          row.liveId,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getBatch(clientId, batchId);
}

module.exports = { previewMigration };
