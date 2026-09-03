const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { parseBillingImportUpload } = require('./billing');
const { syncMikrotikClients } = require('./mikrotik');
const { normalizeServiceType } = require('./subscriberMigrationPolicy');
const { ensureMigrationSchema, getBatch } = require('./subscriberMigrationSchema');
const {
  CONFIRMATION, MAX_FILE_BYTES, MAX_ROWS, clean, expiryOf, loadMigrationPlans,
  lower, normalized, serviceStatusFor,
} = require('./subscriberMigrationCommon');
const { MAX_AGE_MINUTES, assertFresh, collectRouterInventory, existingIdentities, planMap } = require('./subscriberMigrationWispmanCommon');

const LOCAL_HASH = bcrypt.hashSync(crypto.randomBytes(48).toString('base64url'), 6);

async function previewWispmanMigration(input) {
  await ensureMigrationSchema();
  const clientId = input.clientId;
  const routerId = Number(input.routerId);
  const type = normalizeServiceType(input.serviceType);
  if (!routerId) throw new Error('Select the MikroTik currently managed by Wispman.');
  if (!input.fileBuffer?.length) throw new Error('Choose the latest Wispman CSV or XLSX export.');
  if (input.fileBuffer.length > MAX_FILE_BYTES) throw new Error('Migration files must be 8 MB or smaller.');

  await syncMikrotikClients(clientId).catch(() => null);
  const parsed = parseBillingImportUpload({
    fileName: input.fileName, fileBuffer: input.fileBuffer,
    csvText: input.fileBuffer.toString('utf8'), billingSystem: 'wispman', columnMap: input.columnMap || {},
  });
  if (parsed.accounts.length > MAX_ROWS) throw new Error('A migration batch can contain at most 5,000 clients.');

  const [plans, existing, inventory] = await Promise.all([
    loadMigrationPlans(clientId, type), existingIdentities(clientId), collectRouterInventory(clientId, routerId, type),
  ]);
  const byPlan = planMap(plans);
  const byUser = new Map(inventory.accounts.map((row) => [lower(row.name), row]));
  const online = new Set(inventory.active.map((row) => lower(row.user || row.name)).filter(Boolean));
  const seenAccounts = new Set();
  const seenUsers = new Set();
  const rows = [];

  for (const source of parsed.accounts) {
    const errors = [];
    const warnings = [];
    const expiry = expiryOf(source);
    const value = normalized(source, expiry);
    const userKey = lower(value.username);
    const accountKey = lower(value.account_number);
    const mappedId = (input.packageMap || {})[value.package_name] || (input.packageMap || {})[value.radius_profile];
    const plan = mappedId ? plans.find((p) => Number(p.id) === Number(mappedId)) : byPlan.get(lower(value.package_name)) || byPlan.get(lower(value.radius_profile));
    const local = byUser.get(userKey);

    if (!value.full_name) errors.push('Client name is missing.');
    if (!value.username) errors.push('PPPoE/Hotspot username is missing.');
    if (!value.account_number) errors.push('Account number is missing.');
    if (!expiry) errors.push('A valid exact expiry date is required before Wispman can be retired.');
    if (!plan) errors.push(`Package could not be matched to a Polyizon ${type === 'hotspot' ? 'Hotspot' : 'PPPoE'} package.`);
    if (accountKey && seenAccounts.has(accountKey)) errors.push('Duplicate account number in the Wispman export.');
    if (userKey && seenUsers.has(userKey)) errors.push('Duplicate username in the Wispman export.');
    if (accountKey && existing.accounts.has(accountKey)) errors.push('Account number already exists in Polyizon.');
    if (userKey && existing.usernames.has(userKey)) errors.push('Username already exists in Polyizon.');
    if (!local) errors.push('This Wispman user is not present in the selected MikroTik local user database.');
    if (local) {
      const expectedEnabled = serviceStatusFor(value) === 'active';
      const routerEnabled = local.disabled !== 'yes';
      if (expectedEnabled !== routerEnabled) warnings.push(`Wispman status and MikroTik state differ (${expectedEnabled ? 'active' : 'inactive'} vs ${routerEnabled ? 'enabled' : 'disabled'}).`);
      if (value.radius_profile && local.profile && lower(value.radius_profile) !== lower(local.profile)) warnings.push(`MikroTik currently uses profile "${local.profile}"; it will not be changed during cutover.`);
      if (!online.has(userKey)) warnings.push('Account exists on MikroTik but is not currently online.');
    }
    if (expiry && expiry <= new Date()) warnings.push('Imported subscription is already expired.');
    if (accountKey) seenAccounts.add(accountKey);
    if (userKey) seenUsers.add(userKey);
    rows.push({
      rowNumber: source.row_number,
      normalized: { ...value, router_account_id: local?.id || null, router_profile: local?.profile || null, router_disabled: local?.disabled || null, router_online: online.has(userKey), control_mode: 'mikrotik_local_api' },
      errors, warnings, status: errors.length ? 'error' : warnings.length ? 'warning' : 'ready', planId: plan?.id || null,
    });
  }

  const exported = new Set(rows.map((row) => lower(row.normalized.username)).filter(Boolean));
  const summary = {
    migration_mode: 'wispman_api_takeover', service_type: type,
    total: rows.length, ready: rows.filter((r) => r.status === 'ready').length,
    warnings: rows.filter((r) => r.status === 'warning').length, errors: rows.filter((r) => r.status === 'error').length,
    router_accounts: inventory.accounts.length, active_sessions: inventory.active.length,
    matched_router_accounts: rows.filter((r) => r.normalized.router_account_id).length,
    router_only_accounts: inventory.accounts.filter((a) => !exported.has(lower(a.name))).length,
    password_export_required: false, router_credentials_preserved: true, router_writes_during_preview: 0,
    controller_state: 'wispman_primary', snapshot_max_age_minutes: MAX_AGE_MINUTES(),
  };
  const batchId = crypto.randomUUID();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO billing_subscriber_migration_batches
       (id,client_id,router_id,service_type,source_system,file_name,total_rows,ready_rows,warning_rows,error_rows,source_headers,summary,created_by)
       VALUES($1,$2,$3,$4,'wispman',$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [batchId, clientId, routerId, type, clean(input.fileName, 255), summary.total, summary.ready, summary.warnings, summary.errors, JSON.stringify(parsed.headers), JSON.stringify(summary), input.adminId || null]
    );
    for (const row of rows) {
      await client.query(
        `INSERT INTO billing_subscriber_migration_rows
         (batch_id,client_id,row_number,normalized,password_ciphertext,validation_status,errors,warnings,matched_plan_id,matched_hotspot_plan_id)
         VALUES($1,$2,$3,$4::jsonb,NULL,$5,$6::jsonb,$7::jsonb,$8,$9)`,
        [batchId, clientId, row.rowNumber, JSON.stringify(row.normalized), row.status, JSON.stringify(row.errors), JSON.stringify(row.warnings), type === 'pppoe' ? row.planId : null, type === 'hotspot' ? row.planId : null]
      );
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  return getBatch(clientId, batchId);
}

async function applyWispmanMigration(input) {
  await ensureMigrationSchema();
  if (clean(input.confirmation).toUpperCase() !== CONFIRMATION) throw new Error('Enter the exact migration confirmation phrase.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const batch = (await client.query('SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2 FOR UPDATE', [input.clientId, input.batchId])).rows[0];
    if (!batch || lower(batch.source_system) !== 'wispman') throw new Error('Wispman migration batch was not found.');
    if (batch.status !== 'validated') throw new Error('This Wispman migration batch has already changed.');
    if (Number(batch.error_rows)) throw new Error('Resolve every error before importing.');
    assertFresh(batch);
    const type = normalizeServiceType(batch.service_type);
    const rows = (await client.query('SELECT * FROM billing_subscriber_migration_rows WHERE client_id=$1 AND batch_id=$2 ORDER BY row_number FOR UPDATE', [input.clientId, input.batchId])).rows;
    for (const row of rows) {
      const account = row.normalized;
      const status = serviceStatusFor(account);
      if (type === 'pppoe') {
        const inserted = await client.query(
          `INSERT INTO billing_subscribers(client_id,plan_id,full_name,phone,email,account_number,radius_username,radius_password_ciphertext,radius_status,service_status,expires_at,router_id,router_name,access_mode,notes,control_mode,legacy_source,source_migration_batch_id,mikrotik_local_id,mikrotik_local_profile,local_api_sync_status)
           SELECT $1,$2,$3,$4,$5,$6,$7,NULL,$8,$8,$9,r.id,r.name,'pppoe',$10,'mikrotik_local_api','wispman',$11,$12,$13,'shadow'
           FROM mikrotik_routers r WHERE r.client_id=$1 AND r.id=$14 AND r.is_active=TRUE RETURNING id`,
          [batch.client_id, row.matched_plan_id, account.full_name, account.phone || null, account.email || null, account.account_number, account.username, status, account.expires_at, `Imported from Wispman; existing MikroTik PPP secret preserved. Batch ${batch.id}`, batch.id, account.router_account_id, account.router_profile, batch.router_id]
        );
        if (!inserted.rows[0]) throw new Error('The selected MikroTik is no longer available.');
        await client.query('UPDATE billing_subscriber_migration_rows SET created_subscriber_id=$3,applied_at=NOW() WHERE client_id=$1 AND id=$2', [batch.client_id, row.id, inserted.rows[0].id]);
      } else {
        const inserted = await client.query(
          `INSERT INTO billing_hotspot_members(client_id,router_id,username,password_hash,rate_limit,is_active,full_name,account_number,phone,email,plan_id,password_ciphertext,expires_at,auth_source,source_migration_batch_id,radius_sync_status,updated_at,mikrotik_local_id,mikrotik_local_profile,local_api_sync_status)
           SELECT $1,$2,$3,$4,p.mikrotik_rate_limit,$5,$6,$7,$8,$9,p.id,NULL,$10,'mikrotik_local_api',$11,'not_configured',NOW(),$12,$13,'shadow'
           FROM billing_hotspot_plans p WHERE p.client_id=$1 AND p.id=$14 RETURNING id`,
          [batch.client_id, batch.router_id, account.username, LOCAL_HASH, status === 'active', account.full_name, account.account_number, account.phone || null, account.email || null, account.expires_at, batch.id, account.router_account_id, account.router_profile, row.matched_hotspot_plan_id]
        );
        if (!inserted.rows[0]) throw new Error('The selected Hotspot package no longer exists.');
        await client.query('UPDATE billing_subscriber_migration_rows SET created_hotspot_member_id=$3,applied_at=NOW() WHERE client_id=$1 AND id=$2', [batch.client_id, row.id, inserted.rows[0].id]);
      }
    }
    await client.query(
      `UPDATE billing_subscriber_migration_batches SET status='shadow_ready',approved_by=$3,approved_at=NOW(),applied_at=NOW(),summary=summary||$4::jsonb WHERE client_id=$1 AND id=$2`,
      [input.clientId, input.batchId, input.adminId || null, JSON.stringify({ polyizon_records_created: rows.length, router_changes_on_import: 0, controller_state: 'wispman_primary', next_step: 'safe_api_write_probe' })]
    );
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  return getBatch(input.clientId, input.batchId);
}

module.exports = { applyWispmanMigration, previewWispmanMigration };
