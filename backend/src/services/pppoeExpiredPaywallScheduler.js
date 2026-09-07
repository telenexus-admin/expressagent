const db = require('../db');
const { connectRouter, getRouter } = require('./mikrotik');
const { syncSubscriberRadius } = require('./radiusSync');
const { disconnectSubscriberSessions } = require('./radiusDynamicAuth');
const {
  ensurePppoeExpiredPaywall,
  expiredPaywallEnabled,
} = require('./pppoeExpiredPaywall');
const { syncExpiredSubscriberRadius } = require('./pppoeExpiredRadius');

let timer = null;
let running = false;

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_pppoe_expired_paywall_state (
      subscriber_id BIGINT PRIMARY KEY REFERENCES billing_subscribers(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      router_id INTEGER,
      radius_username TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'paywall',
      enforced_at TIMESTAMPTZ,
      restored_at TIMESTAMPTZ,
      last_error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT billing_pppoe_expired_paywall_state_status_check
        CHECK (status IN ('paywall','restored','failed'))
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_pppoe_expired_paywall_status
    ON billing_pppoe_expired_paywall_state(status, updated_at)
  `);
}

async function disconnectViaRouterApi(subscriber) {
  if (!subscriber.client_id || !subscriber.router_id || !subscriber.radius_username) {
    return { status: 'router_not_assigned', removed: 0 };
  }
  const router = await getRouter(subscriber.client_id, subscriber.router_id, { includePassword: true });
  if (!router || !router.is_active) return { status: 'router_unavailable', removed: 0 };

  const client = await connectRouter(router);
  try {
    const rows = await client.command('/ppp/active/print');
    const sessions = Array.isArray(rows)
      ? rows.filter((row) => String(row.name || '') === String(subscriber.radius_username))
      : [];
    for (const session of sessions) {
      if (session['.id']) {
        await client.command('/ppp/active/remove', { '.id': session['.id'] });
      }
    }
    return {
      status: sessions.length ? 'disconnected' : 'not_online',
      removed: sessions.length,
      router_id: router.id,
    };
  } finally {
    client.close();
  }
}

async function disconnectSubscriber(subscriber) {
  try {
    const dynamic = await disconnectSubscriberSessions(subscriber.radius_username);
    if (['applied', 'no_active_session'].includes(dynamic?.status)) {
      return { method: 'radius_disconnect', result: dynamic };
    }
  } catch (error) {
    console.warn(`Expired PPPoE RADIUS disconnect failed for ${subscriber.radius_username}:`, error.message);
  }

  const fallback = await disconnectViaRouterApi(subscriber);
  if (['disconnected', 'not_online'].includes(fallback.status)) {
    return { method: 'router_api', result: fallback };
  }
  throw new Error(`Could not disconnect PPPoE session (${fallback.status})`);
}

async function expiredCandidates(limit) {
  const result = await db.query(
    `SELECT s.*,
            p.radius_profile,p.validity_days,p.fup_enabled,p.fup_threshold_mb,
            p.fup_download_speed_mbps,p.fup_upload_speed_mbps
     FROM billing_subscribers s
     JOIN billing_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     LEFT JOIN billing_pppoe_expired_paywall_state state ON state.subscriber_id=s.id
     WHERE s.radius_username IS NOT NULL
       AND s.radius_username<>''
       AND s.radius_password_ciphertext IS NOT NULL
       AND s.radius_password_ciphertext<>''
       AND COALESCE(s.access_mode,'pppoe') IN ('pppoe','pppoe_static')
       AND s.router_id IS NOT NULL
       AND s.radius_status='active'
       AND s.expires_at IS NOT NULL
       AND s.expires_at + (COALESCE(s.grace_period_days,0) * INTERVAL '1 day') <= NOW()
       AND s.service_status IN ('active','expired')
       AND (state.subscriber_id IS NULL OR state.status<>'paywall')
     ORDER BY s.expires_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function restoredCandidates(limit) {
  const result = await db.query(
    `SELECT s.*,
            p.radius_profile,p.validity_days,p.fup_enabled,p.fup_threshold_mb,
            p.fup_download_speed_mbps,p.fup_upload_speed_mbps
     FROM billing_pppoe_expired_paywall_state state
     JOIN billing_subscribers s ON s.id=state.subscriber_id AND s.client_id=state.client_id
     LEFT JOIN billing_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     WHERE state.status='paywall'
       AND s.service_status='active'
       AND s.radius_status='active'
       AND (s.expires_at IS NULL OR s.expires_at + (COALESCE(s.grace_period_days,0) * INTERVAL '1 day') > NOW())
     ORDER BY state.updated_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function markState(subscriber, status, error = null) {
  await db.query(
    `INSERT INTO billing_pppoe_expired_paywall_state (
       subscriber_id,client_id,router_id,radius_username,status,enforced_at,restored_at,last_error,updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       CASE WHEN $5='paywall' THEN NOW() ELSE NULL END,
       CASE WHEN $5='restored' THEN NOW() ELSE NULL END,
       $6,NOW()
     )
     ON CONFLICT (subscriber_id) DO UPDATE SET
       client_id=EXCLUDED.client_id,
       router_id=EXCLUDED.router_id,
       radius_username=EXCLUDED.radius_username,
       status=EXCLUDED.status,
       enforced_at=CASE WHEN EXCLUDED.status='paywall' THEN NOW() ELSE billing_pppoe_expired_paywall_state.enforced_at END,
       restored_at=CASE WHEN EXCLUDED.status='restored' THEN NOW() ELSE NULL END,
       last_error=EXCLUDED.last_error,
       updated_at=NOW()`,
    [
      subscriber.id,
      subscriber.client_id,
      subscriber.router_id || null,
      subscriber.radius_username,
      status,
      error ? String(error.message || error).slice(0, 1000) : null,
    ]
  );
}

async function enforceExpired(subscriber) {
  try {
    const paywall = await ensurePppoeExpiredPaywall({
      clientId: subscriber.client_id,
      routerId: subscriber.router_id,
    });
    if (!paywall.enabled) return { skipped: true, reason: 'disabled' };

    await syncExpiredSubscriberRadius(subscriber);
    await db.query(
      `UPDATE billing_subscribers
       SET service_status='expired',updated_at=NOW()
       WHERE id=$1 AND client_id=$2 AND service_status IN ('active','expired')`,
      [subscriber.id, subscriber.client_id]
    );
    const disconnected = await disconnectSubscriber(subscriber);
    await markState(subscriber, 'paywall');

    return {
      enforced: true,
      subscriber_id: subscriber.id,
      account_number: subscriber.account_number,
      router_id: subscriber.router_id,
      session_control: disconnected.method,
      portal_url: paywall.portal_url,
    };
  } catch (error) {
    await markState(subscriber, 'failed', error).catch(() => {});
    throw error;
  }
}

async function restorePaid(subscriber) {
  try {
    await syncSubscriberRadius(subscriber);
    const disconnected = await disconnectSubscriber(subscriber);
    await markState(subscriber, 'restored');
    return {
      restored: true,
      subscriber_id: subscriber.id,
      account_number: subscriber.account_number,
      session_control: disconnected.method,
    };
  } catch (error) {
    await markState(subscriber, 'failed', error).catch(() => {});
    throw error;
  }
}

async function processExpiredPaywall() {
  if (!expiredPaywallEnabled() || running) return;
  running = true;
  let lockClient;
  let locked = false;

  try {
    await ensureSchema();
    lockClient = await db.connect();
    const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext('polyizon:pppoe-expired-paywall')) AS locked");
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return;

    const limit = Math.min(500, Math.max(10, Number(process.env.PPPOE_EXPIRED_PAYWALL_BATCH_SIZE || 100)));

    for (const subscriber of await restoredCandidates(limit)) {
      try {
        await restorePaid(subscriber);
      } catch (error) {
        console.error(`PPPoE paywall restore failed for subscriber ${subscriber.id}:`, error.message);
      }
    }

    for (const subscriber of await expiredCandidates(limit)) {
      try {
        await enforceExpired(subscriber);
      } catch (error) {
        console.error(`PPPoE expired paywall enforcement failed for subscriber ${subscriber.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('PPPoE expired paywall scheduler failed:', error.message);
  } finally {
    if (lockClient && locked) {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('polyizon:pppoe-expired-paywall'))").catch(() => {});
    }
    lockClient?.release();
    running = false;
  }
}

function startPppoeExpiredPaywallScheduler() {
  if (!expiredPaywallEnabled()) {
    console.log('PPPoE expired paywall is disabled.');
    return null;
  }

  ensureSchema()
    .then(() => processExpiredPaywall())
    .catch((error) => console.error('PPPoE expired paywall schema failed:', error.message));

  const intervalMs = Math.max(3000, Number(process.env.PPPOE_EXPIRED_PAYWALL_INTERVAL_MS || 5000));
  timer = setInterval(processExpiredPaywall, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  enforceExpired,
  ensureSchema,
  processExpiredPaywall,
  restorePaid,
  startPppoeExpiredPaywallScheduler,
};