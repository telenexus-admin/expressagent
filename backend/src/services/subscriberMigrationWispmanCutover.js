const crypto = require('crypto');
const db = require('../db');
const { connectRouter, getRouter } = require('./mikrotik');
const { missingActiveSessions, normalizeServiceType } = require('./subscriberMigrationPolicy');
const { ensureMigrationSchema, getBatch } = require('./subscriberMigrationSchema');
const { CONFIRMATION, clean, lower } = require('./subscriberMigrationCommon');
const { runWispmanLocalApiControllerOnce } = require('./subscriberLocalApiController');
const { assertFresh, collectRouterInventory, inventoryDrift, safeSession } = require('./subscriberMigrationWispmanCommon');

async function writeProbe(api, type, batchId) {
  const path = normalizeServiceType(type) === 'hotspot' ? '/ip/hotspot/user' : '/ppp/secret';
  const marker = `polyizon-migration-probe-${String(batchId).slice(0, 8)}`;
  let id = null;
  try {
    await api.command(`${path}/add`, { name: marker, password: crypto.randomBytes(24).toString('base64url'), disabled: 'yes', comment: `POLYIZON safe migration probe ${String(batchId).slice(0, 8)}` });
    const rows = await api.command(`${path}/print`, { '.proplist': '.id,name,disabled,comment' });
    const probe = rows.find((row) => row.name === marker);
    if (!probe?.['.id']) throw new Error('Polyizon could not verify its temporary MikroTik API probe.');
    id = probe['.id'];
    await api.command(`${path}/set`, { '.id': id, disabled: 'yes' });
    return { success: true, marker, customer_accounts_changed: 0 };
  } finally { if (id) await api.command(`${path}/remove`, { '.id': id }).catch(() => {}); }
}

async function prepareWispmanHandover(input) {
  await ensureMigrationSchema();
  const batch = (await db.query('SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2', [input.clientId, input.batchId])).rows[0];
  if (!batch || batch.status !== 'shadow_ready') throw new Error('Import the fresh Wispman batch into shadow mode first.');
  assertFresh(batch);
  const rows = (await db.query('SELECT normalized FROM billing_subscriber_migration_rows WHERE client_id=$1 AND batch_id=$2 ORDER BY row_number', [input.clientId, input.batchId])).rows;
  const inventory = await collectRouterInventory(input.clientId, batch.router_id, batch.service_type);
  const drift = inventoryDrift(rows, inventory);
  if (drift.length) throw new Error(`The MikroTik changed after the Wispman export (${drift.length} difference(s)). Remove the staged import and upload a fresh export.`);

  const router = await getRouter(input.clientId, batch.router_id, { includePassword: true });
  const api = await connectRouter(router);
  let probe;
  try {
    const before = inventory.active;
    probe = await writeProbe(api, batch.service_type, batch.id);
    const activePath = normalizeServiceType(batch.service_type) === 'hotspot' ? '/ip/hotspot/active' : '/ppp/active';
    const props = normalizeServiceType(batch.service_type) === 'hotspot' ? '.id,user,address,mac-address,server' : '.id,name,address,caller-id';
    const after = (await api.command(`${activePath}/print`, { '.proplist': props })).map((row) => safeSession(batch.service_type, row));
    if (missingActiveSessions(batch.service_type, before, after).length) throw new Error('Safety probe detected an active customer session change. No cutover was performed.');
    inventory.active = after;
  } finally { api.close(); }

  const snapshot = {
    migration_mode: 'wispman_api_takeover', captured_at: new Date().toISOString(),
    controller_router_username: inventory.controller_username, local_accounts: inventory.accounts,
    active_sessions: inventory.active, router_users: inventory.router_users,
    legacy_api_candidates: inventory.legacy_api_candidates, api_write_probe: probe,
  };
  await db.query(
    `UPDATE billing_subscriber_migration_batches SET status='handover_prepared',previous_router_config=$3::jsonb,handover_prepared_at=NOW(),summary=summary||$4::jsonb WHERE client_id=$1 AND id=$2`,
    [input.clientId, input.batchId, JSON.stringify(snapshot), JSON.stringify({ api_write_probe: 'passed', api_write_probe_customer_changes: 0, controller_state: 'ready_for_wispman_revoke', preserved_active_sessions: inventory.active.length, legacy_api_candidates: inventory.legacy_api_candidates.map(({ name, confidence, disabled, reason }) => ({ name, confidence, disabled, reason })) })]
  );
  return getBatch(input.clientId, input.batchId);
}

function chooseController(snapshot, inventory) {
  const candidates = Array.isArray(snapshot?.legacy_api_candidates) ? snapshot.legacy_api_candidates : [];
  const live = new Map(inventory.router_users.map((row) => [lower(row.name), row]));
  const high = candidates.filter((item) => item.confidence === 'high');
  if (high.length === 1) {
    const row = live.get(lower(high[0].name));
    if (row) return { candidate: { ...high[0], ...row }, verified: row.disabled === 'yes', canAutoDisable: row.disabled !== 'yes' };
  }
  if (high.length > 1) return { error: `Multiple Wispman-looking MikroTik users were detected: ${high.map((x) => x.name).join(', ')}.` };
  const medium = candidates.filter((item) => item.confidence === 'medium');
  if (medium.length === 1) {
    const row = live.get(lower(medium[0].name));
    if (row?.disabled === 'yes') return { candidate: { ...medium[0], ...row }, verified: true, canAutoDisable: false };
    if (row) return { error: `"${row.name}" may be Wispman's API account, but Polyizon will not disable an ambiguous account automatically. Disable that dedicated Wispman user, then retry.` };
  }
  if (medium.length > 1) return { error: `Several possible legacy API users were observed (${medium.map((x) => x.name).join(', ')}). Disable Wispman's dedicated API user manually, then retry.` };
  return { error: 'Polyizon could not safely identify Wispman’s dedicated MikroTik API user. Revoke Wispman API access first, then prepare a fresh handover.' };
}

async function activateWispmanHandover(input) {
  await ensureMigrationSchema();
  if (clean(input.confirmation).toUpperCase() !== CONFIRMATION) throw new Error('Enter the exact migration confirmation phrase.');
  const batch = (await db.query('SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2', [input.clientId, input.batchId])).rows[0];
  if (!batch || batch.status !== 'handover_prepared') throw new Error('Run the safe MikroTik API write probe before cutover.');
  const inventory = await collectRouterInventory(input.clientId, batch.router_id, batch.service_type);
  const decision = chooseController(batch.previous_router_config || {}, inventory);
  if (decision.error) throw new Error(decision.error);

  const router = await getRouter(input.clientId, batch.router_id, { includePassword: true });
  const api = await connectRouter(router);
  let disabledByPolyizon = false;
  try {
    const activePath = normalizeServiceType(batch.service_type) === 'hotspot' ? '/ip/hotspot/active' : '/ppp/active';
    const props = normalizeServiceType(batch.service_type) === 'hotspot' ? '.id,user,address,mac-address,server' : '.id,name,address,caller-id';
    const before = (await api.command(`${activePath}/print`, { '.proplist': props })).map((row) => safeSession(batch.service_type, row));
    if (!decision.verified && decision.canAutoDisable && decision.candidate?.id) {
      await api.command('/user/set', { '.id': decision.candidate.id, disabled: 'yes' });
      disabledByPolyizon = true;
    }
    const users = await api.command('/user/print', { '.proplist': '.id,name,disabled' });
    const legacy = users.find((row) => lower(row.name) === lower(decision.candidate?.name));
    if (legacy && String(legacy.disabled || 'no').toLowerCase() !== 'yes') throw new Error('Wispman API account is still enabled; takeover was not armed.');
    const after = (await api.command(`${activePath}/print`, { '.proplist': props })).map((row) => safeSession(batch.service_type, row));
    const missing = missingActiveSessions(batch.service_type, before, after);
    if (missing.length) {
      if (disabledByPolyizon) await api.command('/user/set', { '.id': decision.candidate.id, disabled: 'no' }).catch(() => {});
      throw new Error(`Cutover detected ${missing.length} active customer session(s) missing. Wispman access was restored.`);
    }
    const result = {
      migration_mode: 'wispman_api_takeover', controller_mode: 'mikrotik_local_api', controller_armed: true,
      legacy_access_verified: true, legacy_api_username: decision.candidate?.name || null, legacy_api_user_id: decision.candidate?.id || null,
      legacy_api_disabled_by_polyizon: disabledByPolyizon, legacy_api_was_already_disabled: Boolean(decision.verified),
      active_sessions_before: before.length, active_sessions_after: after.length, customer_sessions_dropped: 0,
      customer_credentials_changed: 0, customer_passwords_changed: 0, activated_at: new Date().toISOString(),
    };
    await db.query(
      `UPDATE billing_subscriber_migration_batches SET status='handover_active',approved_by=COALESCE(approved_by,$3),handover_activated_at=NOW(),handover_result=$4::jsonb,summary=summary||$5::jsonb WHERE client_id=$1 AND id=$2`,
      [input.clientId, input.batchId, input.adminId || null, JSON.stringify(result), JSON.stringify({ controller_state: 'polyizon_primary', legacy_wispman_access: 'revoked', controller_armed: true, preserved_active_sessions: after.length, customer_sessions_dropped: 0, router_credentials_preserved: true })]
    );
  } catch (error) {
    if (disabledByPolyizon && decision.candidate?.id) await api.command('/user/set', { '.id': decision.candidate.id, disabled: 'no' }).catch(() => {});
    throw error;
  } finally { api.close(); }
  await runWispmanLocalApiControllerOnce().catch((error) => console.error('Initial Wispman local API sync:', error.message));
  return getBatch(input.clientId, input.batchId);
}

async function rollbackWispmanHandover(input) {
  await ensureMigrationSchema();
  const batch = (await db.query('SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2', [input.clientId, input.batchId])).rows[0];
  if (!batch || !['shadow_ready', 'handover_prepared', 'handover_active'].includes(batch.status)) throw new Error('This Wispman migration cannot be rolled back from its current state.');
  if (batch.status === 'handover_active' && batch.handover_result?.legacy_api_disabled_by_polyizon) {
    const router = await getRouter(input.clientId, batch.router_id, { includePassword: true });
    const api = await connectRouter(router);
    try {
      const users = await api.command('/user/print', { '.proplist': '.id,name,disabled' });
      const legacy = users.find((row) => row['.id'] === batch.handover_result.legacy_api_user_id || lower(row.name) === lower(batch.handover_result.legacy_api_username));
      if (legacy?.['.id']) await api.command('/user/set', { '.id': legacy['.id'], disabled: 'no' });
    } finally { api.close(); }
  }
  if (['shadow_ready', 'handover_prepared'].includes(batch.status)) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM billing_subscribers WHERE client_id=$1 AND source_migration_batch_id=$2 AND control_mode='mikrotik_local_api'", [input.clientId, input.batchId]);
      await client.query("DELETE FROM billing_hotspot_members WHERE client_id=$1 AND source_migration_batch_id=$2 AND auth_source='mikrotik_local_api'", [input.clientId, input.batchId]);
      await client.query('UPDATE billing_subscriber_migration_rows SET created_subscriber_id=NULL,created_hotspot_member_id=NULL,applied_at=NULL WHERE client_id=$1 AND batch_id=$2', [input.clientId, input.batchId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  await db.query(
    `UPDATE billing_subscriber_migration_batches SET status='rolled_back',rolled_back_at=NOW(),summary=summary||$3::jsonb WHERE client_id=$1 AND id=$2`,
    [input.clientId, input.batchId, JSON.stringify({ rolled_back_at: new Date().toISOString(), controller_state: 'wispman_restored_or_shadow_removed', customer_credentials_changed: 0 })]
  );
  return getBatch(input.clientId, input.batchId);
}

module.exports = { activateWispmanHandover, chooseController, prepareWispmanHandover, rollbackWispmanHandover, writeProbe };
