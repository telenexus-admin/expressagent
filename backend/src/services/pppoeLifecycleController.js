const db = require('../db');
const { connectRouter, getRouter } = require('./mikrotik');
const { recordBillingEvent } = require('./events');
const { syncSubscriberRadius } = require('./radiusSync');
const { rateLimitFromPlan, removeRadiusCredential } = require('./pppoeProvisioning');
const {
  disconnectSubscriberSessions,
  updateSubscriberPolicy,
} = require('./radiusDynamicAuth');

let running = false;
let timer;

function effectiveExpiry(subscriber) {
  if (!subscriber?.expires_at) return null;
  const base = new Date(subscriber.expires_at);
  if (!Number.isFinite(base.getTime())) return null;
  return new Date(base.getTime() + Number(subscriber.grace_period_days || 0) * 86400000);
}

function accessIsActive(subscriber, now = new Date()) {
  const expiry = effectiveExpiry(subscriber);
  return subscriber?.service_status === 'active'
    && subscriber?.radius_status === 'active'
    && (!expiry || expiry > now);
}

function secondsUntilExpiry(subscriber, now = new Date()) {
  const expiry = effectiveExpiry(subscriber);
  if (!expiry) return null;
  return Math.max(1, Math.ceil((expiry.getTime() - now.getTime()) / 1000));
}

async function ensurePppoeLifecycleSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_pppoe_lifecycle_state (
      subscriber_id BIGINT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      router_id INTEGER,
      radius_username TEXT NOT NULL,
      plan_id BIGINT,
      rate_limit TEXT,
      access_active BOOLEAN NOT NULL DEFAULT FALSE,
      service_status TEXT,
      radius_status TEXT,
      effective_expires_at TIMESTAMPTZ,
      last_action TEXT,
      last_error TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_pppoe_lifecycle_client
                  ON billing_pppoe_lifecycle_state(client_id, subscriber_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_pppoe_lifecycle_seen
                  ON billing_pppoe_lifecycle_state(last_seen_at)`);
}

async function loadNativePppoeSubscribers() {
  const result = await db.query(`
    SELECT s.*,
           p.radius_profile,
           p.download_speed_mbps,
           p.upload_speed_mbps,
           p.fup_enabled,
           p.fup_threshold_mb,
           p.fup_download_speed_mbps,
           p.fup_upload_speed_mbps,
           p.validity_days
    FROM billing_subscribers s
    LEFT JOIN billing_plans p
      ON p.id = s.plan_id
     AND p.client_id = s.client_id
    WHERE s.radius_username IS NOT NULL
      AND s.radius_username <> ''
      AND s.radius_password_ciphertext IS NOT NULL
      AND s.radius_password_ciphertext <> ''
      AND COALESCE(s.access_mode, 'pppoe') IN ('pppoe', 'pppoe_static')
    ORDER BY s.id
    LIMIT 5000
  `);
  return result.rows;
}

async function loadState(subscriberId) {
  const result = await db.query(
    'SELECT * FROM billing_pppoe_lifecycle_state WHERE subscriber_id = $1 LIMIT 1',
    [subscriberId]
  );
  return result.rows[0] || null;
}

async function saveState(subscriber, { accessActive, rateLimit, action = 'observed', error = null }) {
  const expiry = effectiveExpiry(subscriber);
  await db.query(
    `INSERT INTO billing_pppoe_lifecycle_state (
       subscriber_id, client_id, router_id, radius_username, plan_id, rate_limit,
       access_active, service_status, radius_status, effective_expires_at,
       last_action, last_error, last_seen_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
     ON CONFLICT (subscriber_id) DO UPDATE SET
       client_id=EXCLUDED.client_id,
       router_id=EXCLUDED.router_id,
       radius_username=EXCLUDED.radius_username,
       plan_id=EXCLUDED.plan_id,
       rate_limit=EXCLUDED.rate_limit,
       access_active=EXCLUDED.access_active,
       service_status=EXCLUDED.service_status,
       radius_status=EXCLUDED.radius_status,
       effective_expires_at=EXCLUDED.effective_expires_at,
       last_action=EXCLUDED.last_action,
       last_error=EXCLUDED.last_error,
       last_seen_at=NOW(),
       updated_at=NOW()`,
    [
      subscriber.id,
      subscriber.client_id,
      subscriber.router_id || null,
      subscriber.radius_username,
      subscriber.plan_id || null,
      rateLimit || null,
      Boolean(accessActive),
      subscriber.service_status || null,
      subscriber.radius_status || null,
      expiry,
      action,
      error ? String(error).slice(0, 1000) : null,
    ]
  );
}

async function markStateError(subscriberId, error, action) {
  await db.query(
    `UPDATE billing_pppoe_lifecycle_state
     SET last_action=$2, last_error=$3, last_seen_at=NOW(), updated_at=NOW()
     WHERE subscriber_id=$1`,
    [subscriberId, action, String(error?.message || error).slice(0, 1000)]
  );
}

async function disconnectViaRouterApi({ client_id: clientId, router_id: routerId, radius_username: username }) {
  if (!clientId || !routerId || !username) return { status: 'router_not_assigned', removed: 0 };
  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router || !router.is_active) return { status: 'router_unavailable', removed: 0 };
  const client = await connectRouter(router);
  try {
    const rows = await client.command('/ppp/active/print');
    const sessions = rows.filter((row) => String(row.name || '') === String(username));
    for (const session of sessions) {
      if (session['.id']) await client.command('/ppp/active/remove', { '.id': session['.id'] });
    }
    return { status: sessions.length ? 'disconnected' : 'not_online', removed: sessions.length, router_id: router.id };
  } finally {
    client.close();
  }
}

function dynamicResultSucceeded(result) {
  return ['applied', 'no_active_session'].includes(result?.status);
}

async function disconnectWithFallback(subscriber) {
  let dynamic;
  try {
    dynamic = await disconnectSubscriberSessions(subscriber.radius_username);
  } catch (error) {
    dynamic = { status: 'failed', failed: 1, error: error.message };
  }
  if (dynamicResultSucceeded(dynamic)) return { method: 'radius_disconnect', dynamic };

  const fallback = await disconnectViaRouterApi(subscriber);
  if (['disconnected', 'not_online'].includes(fallback.status)) {
    return { method: 'router_api_fallback', dynamic, fallback };
  }
  const error = new Error(`Could not terminate active PPPoE session (${dynamic.status}; ${fallback.status})`);
  error.dynamic = dynamic;
  error.fallback = fallback;
  throw error;
}

async function coaWithFallback(subscriber, policy) {
  let dynamic;
  try {
    dynamic = await updateSubscriberPolicy(subscriber.radius_username, policy);
  } catch (error) {
    dynamic = { status: 'failed', failed: 1, error: error.message };
  }
  if (dynamicResultSucceeded(dynamic)) return { method: 'radius_coa', dynamic };

  const fallback = await disconnectViaRouterApi(subscriber);
  if (['disconnected', 'not_online'].includes(fallback.status)) {
    return { method: 'router_api_reauth', dynamic, fallback };
  }
  const error = new Error(`Could not apply live PPPoE policy (${dynamic.status}; ${fallback.status})`);
  error.dynamic = dynamic;
  error.fallback = fallback;
  throw error;
}

async function recordLifecycleEvent(subscriber, eventType, title, payload = {}, severity = 'info') {
  await recordBillingEvent({
    clientId: subscriber.client_id,
    eventType,
    category: 'radius',
    source: 'pppoe_lifecycle_controller',
    entityType: 'subscriber',
    entityId: subscriber.id,
    actorType: 'system',
    severity,
    title,
    payload: {
      username: subscriber.radius_username,
      router_id: subscriber.router_id || null,
      ...payload,
    },
    relatedEntities: subscriber.router_id
      ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'served_by' }]
      : [],
    deduplicationKey: `pppoe-lifecycle:${subscriber.id}:${eventType}:${Date.now()}`,
    sensitivity: 'restricted',
  }).catch((error) => console.error('PPPoE lifecycle event could not be recorded:', error.message));
}

async function enforceSubscriber(subscriber, now = new Date()) {
  const state = await loadState(subscriber.id);
  const currentActive = accessIsActive(subscriber, now);
  const rateLimit = rateLimitFromPlan(subscriber);
  const expiry = effectiveExpiry(subscriber);
  const previousExpiry = state?.effective_expires_at ? new Date(state.effective_expires_at) : null;
  const expiryChanged = Boolean(state)
    && String(previousExpiry?.toISOString() || '') !== String(expiry?.toISOString() || '');
  const rateChanged = Boolean(state) && String(state.rate_limit || '') !== String(rateLimit || '');
  const planChanged = Boolean(state) && Number(state.plan_id || 0) !== Number(subscriber.plan_id || 0);
  const routerChanged = Boolean(state) && Number(state.router_id || 0) !== Number(subscriber.router_id || 0);
  const usernameChanged = Boolean(state) && String(state.radius_username) !== String(subscriber.radius_username);
  const accessChanged = Boolean(state) && Boolean(state.access_active) !== currentActive;

  try {
    if (!state) {
      if (!currentActive || subscriber.radius_sync_status === 'failed') {
        await syncSubscriberRadius(subscriber);
        if (!currentActive) await disconnectWithFallback(subscriber);
      }
      await saveState(subscriber, { accessActive: currentActive, rateLimit, action: currentActive ? 'baseline' : 'inactive_enforced' });
      return;
    }

    if (usernameChanged) {
      await removeRadiusCredential(state.radius_username).catch(() => {});
      await disconnectWithFallback({
        ...subscriber,
        radius_username: state.radius_username,
        router_id: state.router_id || subscriber.router_id,
      });
      await syncSubscriberRadius(subscriber);
      await saveState(subscriber, { accessActive: currentActive, rateLimit, action: 'username_changed' });
      await recordLifecycleEvent(subscriber, 'pppoe.username_changed', 'PPPoE username synchronized');
      return;
    }

    if (!currentActive) {
      if (accessChanged || subscriber.radius_sync_status !== 'synced' || state.last_action !== 'inactive_enforced') {
        await syncSubscriberRadius(subscriber);
        const sessionControl = await disconnectWithFallback(subscriber);
        if (expiry && expiry <= now && subscriber.service_status === 'active') {
          await db.query(
            `UPDATE billing_subscribers
             SET service_status='expired', updated_at=NOW()
             WHERE id=$1 AND client_id=$2 AND service_status='active'`,
            [subscriber.id, subscriber.client_id]
          );
          subscriber.service_status = 'expired';
        }
        await saveState(subscriber, { accessActive: false, rateLimit, action: 'inactive_enforced' });
        await recordLifecycleEvent(
          subscriber,
          expiry && expiry <= now ? 'pppoe.expired_enforced' : 'pppoe.access_revoked',
          expiry && expiry <= now ? 'PPPoE expiry enforced' : 'PPPoE access revoked',
          { session_control: sessionControl.method }
        );
      } else {
        await saveState(subscriber, { accessActive: false, rateLimit, action: 'inactive_enforced' });
      }
      return;
    }

    if (accessChanged || rateChanged || planChanged || expiryChanged || routerChanged || subscriber.radius_sync_status === 'failed') {
      const sync = await syncSubscriberRadius(subscriber);
      let sessionControl = null;

      if (routerChanged) {
        sessionControl = await disconnectWithFallback(subscriber);
      } else if (rateChanged || planChanged || expiryChanged) {
        sessionControl = await coaWithFallback(subscriber, {
          rateLimit: sync.fup?.rate_limit || rateLimit || null,
          sessionTimeout: secondsUntilExpiry(subscriber, now),
        });
      }

      await saveState(subscriber, {
        accessActive: true,
        rateLimit,
        action: accessChanged ? 'reactivated' : 'policy_updated',
      });
      await recordLifecycleEvent(
        subscriber,
        accessChanged ? 'pppoe.reactivated' : 'pppoe.policy_applied',
        accessChanged ? 'PPPoE subscriber reactivated' : 'Live PPPoE policy applied',
        {
          rate_limit: rateLimit,
          expires_at: expiry?.toISOString() || null,
          session_control: sessionControl?.method || 'not_required',
        }
      );
      return;
    }

    await saveState(subscriber, { accessActive: true, rateLimit, action: state.last_action || 'observed' });
  } catch (error) {
    await markStateError(subscriber.id, error, 'enforcement_failed').catch(() => {});
    await recordLifecycleEvent(
      subscriber,
      'pppoe.lifecycle_enforcement_failed',
      'PPPoE lifecycle enforcement failed',
      { error: String(error.message || error).slice(0, 1000) },
      'warning'
    );
    throw error;
  }
}

async function cleanupDeletedSubscribers(currentIds) {
  const ids = Array.from(currentIds);
  const result = ids.length
    ? await db.query(
      `SELECT * FROM billing_pppoe_lifecycle_state
       WHERE NOT (subscriber_id = ANY($1::bigint[]))
       ORDER BY subscriber_id
       LIMIT 100`,
      [ids]
    )
    : await db.query('SELECT * FROM billing_pppoe_lifecycle_state ORDER BY subscriber_id LIMIT 100');

  for (const state of result.rows) {
    const ghost = {
      id: state.subscriber_id,
      client_id: state.client_id,
      router_id: state.router_id,
      radius_username: state.radius_username,
    };
    try {
      await removeRadiusCredential(state.radius_username).catch(() => {});
      await disconnectWithFallback(ghost);
      await db.query('DELETE FROM billing_pppoe_lifecycle_state WHERE subscriber_id=$1', [state.subscriber_id]);
      await recordLifecycleEvent(ghost, 'pppoe.deleted_enforced', 'Deleted PPPoE subscriber access revoked');
    } catch (error) {
      await db.query(
        `UPDATE billing_pppoe_lifecycle_state
         SET last_action='delete_cleanup_failed', last_error=$2, updated_at=NOW()
         WHERE subscriber_id=$1`,
        [state.subscriber_id, String(error.message || error).slice(0, 1000)]
      );
    }
  }
}

async function processPppoeLifecycle() {
  if (running) return;
  running = true;
  let lockClient;
  let locked = false;
  try {
    await ensurePppoeLifecycleSchema();
    lockClient = await db.connect();
    const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext('polyizon:pppoe-lifecycle')) AS locked");
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return;

    const subscribers = await loadNativePppoeSubscribers();
    const currentIds = new Set(subscribers.map((subscriber) => Number(subscriber.id)));
    for (const subscriber of subscribers) {
      try {
        await enforceSubscriber(subscriber);
      } catch (error) {
        console.error(`PPPoE lifecycle enforcement failed for subscriber ${subscriber.id}:`, error.message);
      }
    }
    await cleanupDeletedSubscribers(currentIds);
  } catch (error) {
    console.error('PPPoE lifecycle controller failed:', error.message);
  } finally {
    if (lockClient && locked) {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('polyizon:pppoe-lifecycle'))").catch(() => {});
    }
    lockClient?.release();
    running = false;
  }
}

function startPppoeLifecycleController() {
  if (String(process.env.PPPOE_LIFECYCLE_ENABLED || 'true').toLowerCase() === 'false') return;
  ensurePppoeLifecycleSchema()
    .then(() => processPppoeLifecycle())
    .catch((error) => console.error('PPPoE lifecycle schema failed:', error.message));
  const intervalMs = Math.max(3000, Number(process.env.PPPOE_LIFECYCLE_INTERVAL_MS || 5000));
  timer = setInterval(processPppoeLifecycle, intervalMs);
  timer.unref?.();
}

module.exports = {
  accessIsActive,
  disconnectViaRouterApi,
  effectiveExpiry,
  ensurePppoeLifecycleSchema,
  enforceSubscriber,
  processPppoeLifecycle,
  secondsUntilExpiry,
  startPppoeLifecycleController,
};
