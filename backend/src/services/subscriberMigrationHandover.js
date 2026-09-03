const db = require('../db');
const { registerRouterNas } = require('./radiusSync');
const { connectRouter, decryptSecret, getRouter } = require('./mikrotik');
const {
  missingActiveSessions, normalizeServiceType, radiusCommentFor, radiusServiceFor,
  safeHotspotSnapshot, safePppSnapshot, targetHotspotProfileIds,
} = require('./subscriberMigrationPolicy');
const { ensureMigrationSchema, getBatch } = require('./subscriberMigrationSchema');
const { syncBatchCredentials, verifyBatchCredentials } = require('./subscriberMigrationApply');
const { CONFIRMATION, RADIUS_HOST, clean } = require('./subscriberMigrationCommon');

function radiusEntryComment(batch) {
  return `${radiusCommentFor(batch.service_type)} ${String(batch.id).slice(0, 8)}`;
}

async function prepareHandover(input) {
  await ensureMigrationSchema();
  let batch = (await db.query(
    `SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2`,
    [input.clientId, input.batchId]
  )).rows[0];
  if (!batch || !['radius_ready', 'sync_attention', 'handover_prepared'].includes(batch.status)) {
    throw new Error('Synchronize the migration successfully before preparing handover.');
  }

  if (batch.status === 'sync_attention') {
    const retry = await syncBatchCredentials(input.clientId, input.batchId);
    if (retry.failures.length) {
      throw new Error(`RADIUS synchronization still has ${retry.failures.length} failed account(s). No router changes were made.`);
    }
    batch = (await db.query(
      `SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2`,
      [input.clientId, input.batchId]
    )).rows[0];
  }

  await verifyBatchCredentials(input.clientId, input.batchId);
  const serviceType = normalizeServiceType(batch.service_type);
  const router = await getRouter(input.clientId, batch.router_id, { includePassword: true });
  if (!router) throw new Error('The selected MikroTik is no longer available.');
  const credentials = (await db.query(
    `SELECT nas_identifier,nas_ip,shared_secret_encrypted
     FROM router_radius_credentials WHERE client_id=$1 AND router_id=$2`,
    [input.clientId, batch.router_id]
  )).rows[0];
  if (!credentials) throw new Error('Complete secure router onboarding first.');
  const secret = decryptSecret(credentials.shared_secret_encrypted);
  await registerRouterNas({
    clientId: input.clientId,
    routerId: batch.router_id,
    nasIp: credentials.nas_ip,
    nasIdentifier: credentials.nas_identifier,
    secret,
  });

  const api = await connectRouter(router);
  try {
    const radius = await api.command('/radius/print');
    let snapshot;
    if (serviceType === 'hotspot') {
      const [profiles, servers, active, users] = await Promise.all([
        api.command('/ip/hotspot/profile/print'),
        api.command('/ip/hotspot/print'),
        api.command('/ip/hotspot/active/print'),
        api.command('/ip/hotspot/user/print'),
      ]);
      const targetProfiles = targetHotspotProfileIds(servers);
      if (!targetProfiles.length) throw new Error('No enabled Hotspot server/profile was found on the selected MikroTik.');
      snapshot = {
        ...safeHotspotSnapshot({ radius, profiles, servers, active, users }),
        target_hotspot_profiles: targetProfiles,
      };
    } else {
      const [aaa, active, secrets] = await Promise.all([
        api.command('/ppp/aaa/print'),
        api.command('/ppp/active/print'),
        api.command('/ppp/secret/print'),
      ]);
      snapshot = safePppSnapshot({ radius, aaa, active, secrets });
    }

    const comment = radiusEntryComment(batch);
    let prepared = radius.find((entry) => entry.comment === comment);
    if (!prepared) {
      await api.command('/radius/add', {
        service: radiusServiceFor(serviceType),
        address: RADIUS_HOST(),
        secret,
        'authentication-port': String(process.env.RADIUS_AUTH_PORT || 1812),
        'accounting-port': String(process.env.RADIUS_ACCOUNTING_PORT || 1813),
        'src-address': credentials.nas_ip,
        timeout: '3s',
        comment,
        disabled: 'yes',
      });
      const refreshed = await api.command('/radius/print');
      prepared = refreshed.find((entry) => entry.comment === comment);
    }
    if (!prepared?.['.id']) throw new Error('Could not create the isolated Polyizon RADIUS entry.');

    snapshot.prepared_radius_id = prepared['.id'];
    snapshot.prepared_radius_comment = comment;
    await db.query(
      `UPDATE billing_subscriber_migration_batches
       SET status='handover_prepared',previous_router_config=$3::jsonb,
           handover_prepared_at=NOW(),summary=summary||$4::jsonb
       WHERE client_id=$1 AND id=$2`,
      [
        input.clientId,
        input.batchId,
        JSON.stringify(snapshot),
        JSON.stringify({
          radius_credentials_verified: true,
          handover_strategy: serviceType === 'hotspot' ? 'hotspot_shadow_radius' : 'pppoe_shadow_radius',
        }),
      ]
    );
  } finally {
    api.close();
  }
  return getBatch(input.clientId, input.batchId);
}

function parkedName(batchId, routerId, index) {
  const batch = String(batchId).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'batch';
  const router = String(routerId || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || String(index + 1);
  return `pz-${batch}-${router}-${index + 1}`.slice(0, 48);
}

async function parkLocalCredentials(api, path, usernames, batchId) {
  const rows = await api.command(`${path}/print`);
  const wanted = new Set(usernames.map((value) => clean(value, 180)).filter(Boolean));
  const usedNames = new Set(rows.map((row) => clean(row.name, 180)).filter(Boolean));
  const parked = [];
  let index = 0;
  for (const row of rows) {
    if (!row['.id'] || !wanted.has(clean(row.name, 180))) continue;
    let nextName;
    do {
      nextName = parkedName(batchId, row['.id'], index++);
    } while (usedNames.has(nextName));
    await api.command(`${path}/set`, { '.id': row['.id'], name: nextName });
    usedNames.add(nextName);
    usedNames.delete(row.name);
    parked.push({ id: row['.id'], old_name: row.name, parked_name: nextName });
  }
  return parked;
}

async function restoreParkedCredentials(api, path, parked = []) {
  const failures = [];
  for (const entry of [...parked].reverse()) {
    try {
      const rows = await api.command(`${path}/print`);
      const row = rows.find((candidate) => candidate['.id'] === entry.id || candidate.name === entry.parked_name);
      if (row?.['.id'] && row.name !== entry.old_name) {
        await api.command(`${path}/set`, { '.id': row['.id'], name: entry.old_name });
      }
    } catch (error) {
      failures.push({ id: entry.id, error: clean(error.message, 200) });
    }
  }
  return failures;
}

async function restoreServiceSettings(api, batch, { removePreparedRadius = false } = {}) {
  const previous = batch.previous_router_config || {};
  const serviceType = normalizeServiceType(batch.service_type);
  if (serviceType === 'pppoe') {
    const aaa = previous.ppp_aaa?.[0];
    if (aaa) {
      await api.command('/ppp/aaa/set', {
        'use-radius': aaa.use_radius || 'no',
        accounting: aaa.accounting || 'no',
        'interim-update': aaa.interim_update || '0s',
      });
    }
  } else {
    const targetNames = new Set(previous.target_hotspot_profiles || []);
    const current = await api.command('/ip/hotspot/profile/print');
    for (const profile of previous.hotspot_profiles || []) {
      if (!targetNames.has(profile.name)) continue;
      const live = current.find((candidate) => candidate['.id'] === profile.id || candidate.name === profile.name);
      if (!live?.['.id']) continue;
      await api.command('/ip/hotspot/profile/set', {
        '.id': live['.id'],
        'use-radius': profile.use_radius || 'no',
        'radius-accounting': profile.radius_accounting || 'yes',
        'radius-interim-update': profile.radius_interim_update || 'received',
      });
    }
  }

  const radius = await api.command('/radius/print').catch(() => []);
  const prepared = radius.find(
    (entry) => entry['.id'] === previous.prepared_radius_id || entry.comment === previous.prepared_radius_comment
  );
  if (prepared?.['.id']) {
    if (removePreparedRadius) await api.command('/radius/remove', { '.id': prepared['.id'] });
    else await api.command('/radius/set', { '.id': prepared['.id'], disabled: 'yes' });
  }
}

async function activateHandover(input) {
  await ensureMigrationSchema();
  if (clean(input.confirmation).toUpperCase() !== CONFIRMATION) {
    throw new Error('Enter the exact migration confirmation phrase.');
  }
  const batch = (await db.query(
    `SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2`,
    [input.clientId, input.batchId]
  )).rows[0];
  if (!batch || batch.status !== 'handover_prepared') {
    throw new Error('Prepare and review the handover snapshot first.');
  }
  const verification = await verifyBatchCredentials(input.clientId, input.batchId);
  const serviceType = normalizeServiceType(batch.service_type);
  const usernames = (await db.query(
    `SELECT normalized->>'username' AS username
     FROM billing_subscriber_migration_rows
     WHERE client_id=$1 AND batch_id=$2
       AND (created_subscriber_id IS NOT NULL OR created_hotspot_member_id IS NOT NULL)`,
    [input.clientId, input.batchId]
  )).rows.map((row) => clean(row.username, 180)).filter(Boolean);

  const api = await connectRouter(await getRouter(input.clientId, batch.router_id, { includePassword: true }));
  const credentialPath = serviceType === 'hotspot' ? '/ip/hotspot/user' : '/ppp/secret';
  let parked = [];
  try {
    const previous = batch.previous_router_config || {};
    const radius = await api.command('/radius/print');
    const prepared = radius.find(
      (entry) => entry['.id'] === previous.prepared_radius_id || entry.comment === previous.prepared_radius_comment
    );
    if (!prepared?.['.id']) throw new Error('Prepared Polyizon RADIUS entry is missing. Run prepare again.');

    await api.command('/radius/set', { '.id': prepared['.id'], disabled: 'no' });
    if (serviceType === 'pppoe') {
      await api.command('/ppp/aaa/set', { 'use-radius': 'yes', accounting: 'yes', 'interim-update': '1m' });
    } else {
      const targetNames = new Set(previous.target_hotspot_profiles || []);
      const profiles = await api.command('/ip/hotspot/profile/print');
      const targets = profiles.filter((profile) => targetNames.has(profile.name));
      if (!targets.length) throw new Error('The prepared Hotspot profile set no longer exists.');
      for (const profile of targets) {
        await api.command('/ip/hotspot/profile/set', {
          '.id': profile['.id'],
          'use-radius': 'yes',
          'radius-accounting': 'yes',
          'radius-interim-update': '1m',
        });
      }
    }

    parked = await parkLocalCredentials(api, credentialPath, usernames, batch.id);
    const after = serviceType === 'hotspot'
      ? await api.command('/ip/hotspot/active/print')
      : await api.command('/ppp/active/print');
    const before = serviceType === 'hotspot'
      ? previous.active_hotspot_sessions || []
      : previous.active_pppoe_sessions || [];
    const missing = missingActiveSessions(serviceType, before, after);
    if (missing.length) {
      const names = missing.slice(0, 5).map((row) => row.user || row.name || row.address || row.id).join(', ');
      throw new Error(`Safety check detected dropped active ${serviceType === 'hotspot' ? 'Hotspot' : 'PPPoE'} session(s): ${names}`);
    }

    const currentRadius = await api.command('/radius/print');
    const activeLegacyRadius = currentRadius.filter(
      (entry) => entry['.id'] !== prepared['.id'] && entry.disabled !== 'yes'
    );
    const result = {
      service_type: serviceType,
      mode: 'non_disruptive_shadow_radius',
      radius_credentials_verified: verification.ready,
      preserved_active_sessions: before.length,
      parked_local_credentials: parked,
      parked_local_credential_count: parked.length,
      legacy_radius_entries_preserved: activeLegacyRadius.length,
      prepared_radius_id: prepared['.id'],
      activated_at: new Date().toISOString(),
    };
    await db.query(
      `UPDATE billing_subscriber_migration_batches
       SET status='handover_active',approved_by=COALESCE(approved_by,$3),
           handover_activated_at=NOW(),handover_result=$4::jsonb,
           summary=summary||$5::jsonb
       WHERE client_id=$1 AND id=$2`,
      [
        input.clientId, input.batchId, input.adminId || null, JSON.stringify(result),
        JSON.stringify({
          preserved_active_sessions: before.length,
          parked_local_credentials: parked.length,
          legacy_radius_entries_preserved: activeLegacyRadius.length,
        }),
      ]
    );
  } catch (error) {
    const restoreFailures = await restoreParkedCredentials(api, credentialPath, parked);
    await restoreServiceSettings(api, batch).catch((restoreError) => {
      restoreFailures.push({ service_settings: clean(restoreError.message, 200) });
    });
    if (restoreFailures.length) {
      throw new Error(`${error.message} Automatic rollback also reported ${restoreFailures.length} restore error(s); inspect the router before retrying.`);
    }
    throw error;
  } finally {
    api.close();
  }
  return getBatch(input.clientId, input.batchId);
}

async function rollbackHandover(input) {
  await ensureMigrationSchema();
  const batch = (await db.query(
    `SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2`,
    [input.clientId, input.batchId]
  )).rows[0];
  if (!batch || !['handover_prepared', 'handover_active'].includes(batch.status)) {
    throw new Error('No handover can be rolled back.');
  }
  const serviceType = normalizeServiceType(batch.service_type);
  const credentialPath = serviceType === 'hotspot' ? '/ip/hotspot/user' : '/ppp/secret';
  const api = await connectRouter(await getRouter(input.clientId, batch.router_id, { includePassword: true }));
  try {
    const parked = batch.handover_result?.parked_local_credentials || [];
    const credentialFailures = await restoreParkedCredentials(api, credentialPath, parked);
    if (credentialFailures.length) {
      throw new Error(`Could not restore ${credentialFailures.length} local credential(s); router state was left intact for inspection.`);
    }
    await restoreServiceSettings(api, batch, { removePreparedRadius: true });
    await db.query(
      `UPDATE billing_subscriber_migration_batches
       SET status='rolled_back',rolled_back_at=NOW(),summary=summary||$3::jsonb
       WHERE client_id=$1 AND id=$2`,
      [
        input.clientId, input.batchId,
        JSON.stringify({ rolled_back_at: new Date().toISOString(), router_auth_restored: true }),
      ]
    );
  } finally {
    api.close();
  }
  return getBatch(input.clientId, input.batchId);
}

module.exports = { activateHandover, prepareHandover, rollbackHandover };
