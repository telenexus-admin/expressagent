const db = require('../db');
const { connectRouter, getRouter } = require('./mikrotik');

let controllerTimer = null;
let controllerRunning = false;

function validFutureExpiry(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt);
  return Number.isFinite(expiry.getTime()) && expiry > now;
}

function effectiveLocalApiActive(subscriber, now = new Date()) {
  if (subscriber.service_status !== 'active' || subscriber.radius_status !== 'active') return false;
  if (!subscriber.expires_at) return true;
  const expiry = new Date(subscriber.expires_at);
  if (!Number.isFinite(expiry.getTime())) return false;
  expiry.setUTCDate(expiry.getUTCDate() + Number(subscriber.grace_period_days || 0));
  return expiry > now;
}

function effectiveHotspotLocalApiActive(member, now = new Date()) {
  return member.is_active === true && validFutureExpiry(member.expires_at, now);
}

function desiredDisabledValue(subscriber, now = new Date()) {
  return effectiveLocalApiActive(subscriber, now) ? 'no' : 'yes';
}

function desiredHotspotDisabledValue(member, now = new Date()) {
  return effectiveHotspotLocalApiActive(member, now) ? 'no' : 'yes';
}

async function updateSubscriberSyncState(clientId, subscriberId, status, error = null) {
  await db.query(
    `UPDATE billing_subscribers
     SET local_api_sync_status=$3,
         local_api_sync_error=$4,
         local_api_last_synced_at=NOW(),
         updated_at=NOW()
     WHERE client_id=$1 AND id=$2`,
    [clientId, subscriberId, status, error]
  );
}

async function updateHotspotSyncState(clientId, memberId, status, error = null) {
  await db.query(
    `UPDATE billing_hotspot_members
     SET local_api_sync_status=$3,
         local_api_sync_error=$4,
         local_api_last_synced_at=NOW(),
         updated_at=NOW()
     WHERE client_id=$1 AND id=$2`,
    [clientId, memberId, status, error]
  );
}

function localRecord(rows, id, username) {
  return rows.find((row) =>
    (id && row['.id'] === id) || String(row.name || '') === String(username || '')
  );
}

async function syncPppSubscribers(api, clientId, subscribers) {
  if (!subscribers.length) return 0;
  const secrets = await api.command('/ppp/secret/print', {
    '.proplist': '.id,name,profile,disabled,comment',
  });
  let synced = 0;
  for (const subscriber of subscribers) {
    try {
      const row = localRecord(secrets, subscriber.mikrotik_local_id, subscriber.radius_username);
      if (!row?.['.id']) {
        await updateSubscriberSyncState(clientId, subscriber.id, 'missing', 'Existing MikroTik PPP secret was not found');
        continue;
      }
      const desired = desiredDisabledValue(subscriber);
      if (String(row.disabled || 'no').toLowerCase() !== desired) {
        await api.command('/ppp/secret/set', { '.id': row['.id'], disabled: desired });
        row.disabled = desired;
      }
      await db.query(
        `UPDATE billing_subscribers
         SET mikrotik_local_id=$3,
             mikrotik_local_profile=$4,
             local_api_sync_status='synced',
             local_api_sync_error=NULL,
             local_api_last_synced_at=NOW(),
             updated_at=NOW()
         WHERE client_id=$1 AND id=$2`,
        [clientId, subscriber.id, row['.id'], row.profile || subscriber.mikrotik_local_profile || null]
      );
      synced += 1;
    } catch (error) {
      await updateSubscriberSyncState(clientId, subscriber.id, 'failed', String(error.message || error).slice(0, 500)).catch(() => {});
    }
  }
  return synced;
}

async function syncHotspotMembers(api, clientId, members) {
  if (!members.length) return 0;
  const users = await api.command('/ip/hotspot/user/print', {
    '.proplist': '.id,name,profile,server,disabled,comment',
  });
  let synced = 0;
  for (const member of members) {
    try {
      const row = localRecord(users, member.mikrotik_local_id, member.username);
      if (!row?.['.id']) {
        await updateHotspotSyncState(clientId, member.id, 'missing', 'Existing MikroTik Hotspot user was not found');
        continue;
      }
      const desired = desiredHotspotDisabledValue(member);
      if (String(row.disabled || 'no').toLowerCase() !== desired) {
        await api.command('/ip/hotspot/user/set', { '.id': row['.id'], disabled: desired });
        row.disabled = desired;
      }
      await db.query(
        `UPDATE billing_hotspot_members
         SET mikrotik_local_id=$3,
             mikrotik_local_profile=$4,
             local_api_sync_status='synced',
             local_api_sync_error=NULL,
             local_api_last_synced_at=NOW(),
             updated_at=NOW()
         WHERE client_id=$1 AND id=$2`,
        [clientId, member.id, row['.id'], row.profile || member.mikrotik_local_profile || null]
      );
      synced += 1;
    } catch (error) {
      await updateHotspotSyncState(clientId, member.id, 'failed', String(error.message || error).slice(0, 500)).catch(() => {});
    }
  }
  return synced;
}

async function syncRouterGroup({ clientId, routerId, subscribers = [], hotspotMembers = [] }) {
  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router) throw new Error('Migration router no longer exists');
  const api = await connectRouter(router);
  try {
    const pppSynced = await syncPppSubscribers(api, clientId, subscribers);
    const hotspotSynced = await syncHotspotMembers(api, clientId, hotspotMembers);
    return { pppSynced, hotspotSynced };
  } finally {
    api.close();
  }
}

async function loadArmedPppSubscribers() {
  return db.query(
    `SELECT s.*
     FROM billing_subscribers s
     JOIN billing_subscriber_migration_batches b
       ON b.id=s.source_migration_batch_id
      AND b.client_id=s.client_id
     WHERE s.control_mode='mikrotik_local_api'
       AND s.router_id IS NOT NULL
       AND b.source_system='wispman'
       AND b.status='handover_active'
       AND COALESCE((b.handover_result->>'controller_armed')::boolean,FALSE)=TRUE
     ORDER BY s.client_id,s.router_id,s.id`
  );
}

async function loadArmedHotspotMembers() {
  return db.query(
    `SELECT m.*
     FROM billing_hotspot_members m
     JOIN billing_subscriber_migration_batches b
       ON b.id=m.source_migration_batch_id
      AND b.client_id=m.client_id
     WHERE m.auth_source='mikrotik_local_api'
       AND m.router_id IS NOT NULL
       AND b.source_system='wispman'
       AND b.status='handover_active'
       AND COALESCE((b.handover_result->>'controller_armed')::boolean,FALSE)=TRUE
     ORDER BY m.client_id,m.router_id,m.id`
  );
}

async function runWispmanLocalApiControllerOnce() {
  if (controllerRunning) return { skipped: true, reason: 'already_running' };
  controllerRunning = true;
  try {
    const [pppResult, hotspotResult] = await Promise.all([
      loadArmedPppSubscribers(),
      loadArmedHotspotMembers(),
    ]);
    const groups = new Map();
    const groupFor = (clientId, routerId) => {
      const key = `${clientId}:${routerId}`;
      if (!groups.has(key)) groups.set(key, { clientId, routerId, subscribers: [], hotspotMembers: [] });
      return groups.get(key);
    };
    for (const subscriber of pppResult.rows) {
      groupFor(subscriber.client_id, subscriber.router_id).subscribers.push(subscriber);
    }
    for (const member of hotspotResult.rows) {
      groupFor(member.client_id, member.router_id).hotspotMembers.push(member);
    }

    let syncedRouters = 0;
    let pppSynced = 0;
    let hotspotSynced = 0;
    for (const group of groups.values()) {
      try {
        const result = await syncRouterGroup(group);
        pppSynced += result.pppSynced;
        hotspotSynced += result.hotspotSynced;
        syncedRouters += 1;
      } catch (error) {
        const message = String(error.message || error).slice(0, 500);
        for (const subscriber of group.subscribers) {
          await updateSubscriberSyncState(subscriber.client_id, subscriber.id, 'failed', message).catch(() => {});
        }
        for (const member of group.hotspotMembers) {
          await updateHotspotSyncState(member.client_id, member.id, 'failed', message).catch(() => {});
        }
      }
    }
    return {
      subscribers: pppResult.rowCount,
      hotspot_members: hotspotResult.rowCount,
      ppp_synced: pppSynced,
      hotspot_synced: hotspotSynced,
      routers: syncedRouters,
    };
  } finally {
    controllerRunning = false;
  }
}

function startWispmanLocalApiController() {
  if (controllerTimer) return controllerTimer;
  const intervalMs = Math.max(15000, Number(process.env.WISPMAN_LOCAL_API_SYNC_MS || 60000));
  controllerTimer = setInterval(() => {
    runWispmanLocalApiControllerOnce().catch((error) => {
      console.error('Wispman local API controller:', error.message);
    });
  }, intervalMs);
  controllerTimer.unref?.();
  runWispmanLocalApiControllerOnce().catch((error) => {
    console.error('Wispman local API controller initial sync:', error.message);
  });
  return controllerTimer;
}

module.exports = {
  desiredDisabledValue,
  desiredHotspotDisabledValue,
  effectiveHotspotLocalApiActive,
  effectiveLocalApiActive,
  runWispmanLocalApiControllerOnce,
  startWispmanLocalApiController,
};
