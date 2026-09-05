const db = require('../db');
const { loadSubscriber, syncHotspotVoucherRadius, syncSubscriberRadius } = require('./radiusSync');
const { connectRouter, getRouter, syncStaticDhcpLease } = require('./mikrotik');
const { recordBillingEvent } = require('./events');
const { startPppoeLifecycleController } = require('./pppoeLifecycleController');
const { currentSubscriberRate, updateSubscriberPolicy } = require('./radiusDynamicAuth');

let running = false;
let timer;
let fupTimer;
let hotspotFupRunning = false;
let pppoeLifecycleStarted = false;

async function ensureRadiusSyncJobSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_radius_sync_jobs (
      id BIGSERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      subscriber_id INTEGER NOT NULL REFERENCES billing_subscribers(id) ON DELETE CASCADE,
      reason VARCHAR(80) NOT NULL DEFAULT 'billing_update',
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      last_error TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, subscriber_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_radius_sync_jobs_pending
                  ON billing_radius_sync_jobs(next_attempt_at, id)
                  WHERE status IN ('pending','processing')`);

  // Older packages may have speed fields but no explicit MikroTik rate string.
  // Backfill only blank values so all future RADIUS resyncs preserve the plan speed.
  await db.query(`
    UPDATE billing_plans
    SET radius_profile =
          TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM upload_speed_mbps::text)) || 'M/' ||
          TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM download_speed_mbps::text)) || 'M',
        updated_at = NOW()
    WHERE (radius_profile IS NULL OR BTRIM(radius_profile) = '')
      AND upload_speed_mbps IS NOT NULL
      AND download_speed_mbps IS NOT NULL
      AND upload_speed_mbps > 0
      AND download_speed_mbps > 0
  `);
}

async function enqueueRadiusSyncJob(queryable, clientId, subscriberId, reason = 'billing_update') {
  await queryable.query(
    `INSERT INTO billing_radius_sync_jobs (client_id, subscriber_id, reason)
     VALUES ($1,$2,$3)
     ON CONFLICT (client_id, subscriber_id) DO UPDATE
     SET reason=EXCLUDED.reason, status='pending', attempts=0, next_attempt_at=NOW(),
         locked_at=NULL, completed_at=NULL, last_error=NULL, updated_at=NOW()`,
    [clientId, subscriberId, reason]
  );
}

async function claimJobs(limit = 3) {
  const result = await db.query(
    `WITH candidates AS (
       SELECT id FROM billing_radius_sync_jobs
       WHERE (status='pending' AND next_attempt_at <= NOW())
          OR (status='processing' AND locked_at < NOW() - INTERVAL '5 minutes')
       ORDER BY next_attempt_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE billing_radius_sync_jobs jobs
     SET status='processing', attempts=jobs.attempts+1, locked_at=NOW(), updated_at=NOW()
     FROM candidates WHERE jobs.id=candidates.id
     RETURNING jobs.*`,
    [limit]
  );
  return result.rows;
}

async function reconnectFupSubscriber(subscriber) {
  if (!subscriber.router_id || !subscriber.radius_username) return { status: 'router_not_assigned' };
  const router = await getRouter(subscriber.client_id, subscriber.router_id, { includePassword: true });
  if (!router || !router.is_active) return { status: 'router_unavailable' };
  const client = await connectRouter(router);
  try {
    const activeRows = await client.command('/ppp/active/print');
    const session = activeRows.find((row) => String(row.name || '') === String(subscriber.radius_username));
    if (!session?.['.id']) return { status: 'not_online' };
    await client.command('/ppp/active/remove', { '.id': session['.id'] });
    return { status: 'reconnected', router_id: router.id };
  } finally {
    client.close();
  }
}

async function applyLiveFupRate(subscriber, previousRate, effectiveRate) {
  if (String(previousRate || '') === String(effectiveRate || '')) {
    return { status: 'unchanged', rate_limit: effectiveRate || null };
  }

  if (effectiveRate) {
    try {
      const live = await updateSubscriberPolicy(
        subscriber.radius_username,
        { rateLimit: effectiveRate }
      );
      if (['applied', 'no_active_session'].includes(live.status)) {
        return { status: 'coa', rate_limit: effectiveRate, live };
      }
    } catch (error) {
      console.error(`FUP CoA failed for subscriber ${subscriber.id}:`, error.message);
    }
  }

  // A disconnect is also the correct fallback when removing a previous rate
  // entirely, because MikroTik cannot clear that VSA with our current CoA.
  const fallback = await reconnectFupSubscriber(subscriber);
  return { status: 'reauth', rate_limit: effectiveRate || null, fallback };
}

async function reconnectFupHotspotVoucher(voucher) {
  if (!voucher.router_id || !voucher.code) return { status: 'router_not_assigned' };
  const router = await getRouter(voucher.client_id, voucher.router_id, { includePassword: true });
  if (!router || !router.is_active) return { status: 'router_unavailable' };
  const client = await connectRouter(router);
  try {
    const activeRows = await client.command('/ip/hotspot/active/print');
    const session = activeRows.find((row) => String(row.user || '') === String(voucher.code));
    if (!session?.['.id']) return { status: 'not_online' };
    await client.command('/ip/hotspot/active/remove', { '.id': session['.id'] });
    return { status: 'reconnected', router_id: router.id };
  } finally {
    client.close();
  }
}

async function processJob(job) {
  try {
    const subscriber = await loadSubscriber(job.subscriber_id, job.client_id);
    if (!subscriber) throw new Error('Subscriber no longer exists');
    if (subscriber.access_mode === 'dhcp_static') await syncStaticDhcpLease(subscriber);
    else {
      if (!subscriber.radius_username) throw new Error('Subscriber RADIUS credentials are not configured');

      let previousRate = null;
      if (job.reason === 'fup_usage_check') {
        previousRate = await currentSubscriberRate(subscriber.radius_username).catch(() => null);
      }

      const sync = await syncSubscriberRadius(subscriber);

      if (job.reason === 'fup_usage_check') {
        const effectiveRate = sync.fup?.rate_limit || subscriber.radius_profile || null;
        try {
          const live = await applyLiveFupRate(subscriber, previousRate, effectiveRate);
          if (live.status !== 'unchanged') {
            await recordBillingEvent({
              clientId: subscriber.client_id,
              eventType: sync.fup?.applied ? 'radius.fup_applied' : 'radius.fup_restored',
              category: 'radius',
              source: 'radius_sync_worker',
              entityType: 'subscriber',
              entityId: subscriber.id,
              actorType: 'system',
              title: sync.fup?.applied ? 'FUP speed applied' : 'Normal package speed restored',
              payload: {
                previous_rate: previousRate,
                effective_rate: effectiveRate,
                usage_bytes: sync.fup?.usage_bytes || 0,
                threshold_bytes: sync.fup?.threshold_bytes || 0,
                live_method: live.status,
              },
              deduplicationKey: `fup-rate:${subscriber.id}:${effectiveRate || 'none'}:${Date.now()}`,
              sensitivity: 'restricted',
            }).catch(() => {});
          }
        } catch (error) {
          console.error(`FUP live policy failed for subscriber ${subscriber.id}:`, error.message);
        }
      } else if (sync.fup?.rate_changed) {
        try { await reconnectFupSubscriber(subscriber); }
        catch (error) { console.error(`FUP session reconnect failed for subscriber ${subscriber.id}:`, error.message); }
      }
    }
    await db.query(
      `UPDATE billing_radius_sync_jobs SET status='completed', completed_at=NOW(), locked_at=NULL,
       last_error=NULL, updated_at=NOW() WHERE id=$1`,
      [job.id]
    );
    await recordBillingEvent({
      clientId: job.client_id,
      eventType: 'radius.sync_completed',
      category: 'radius',
      source: 'radius_sync_worker',
      entityType: 'subscriber',
      entityId: job.subscriber_id,
      actorType: 'system',
      title: 'RADIUS synchronization completed',
      payload: { job_id: job.id, reason: job.reason, attempt: job.attempts },
      relatedEntities: [{ entityType: 'radius_sync_job', entityId: job.id, relationship: 'sync_job' }],
      deduplicationKey: `radius-sync:${job.id}:attempt:${job.attempts}:completed`,
      sensitivity: 'restricted',
    }).catch((eventError) => console.error('RADIUS sync completion event could not be recorded:', eventError.message));
  } catch (error) {
    const exhausted = Number(job.attempts) >= 8;
    const delaySeconds = Math.min(300, 5 * (2 ** Math.max(0, Number(job.attempts) - 1)));
    await db.query(
      `UPDATE billing_radius_sync_jobs
       SET status=$2, next_attempt_at=NOW()+($3 * INTERVAL '1 second'), locked_at=NULL,
           last_error=$4, updated_at=NOW() WHERE id=$1`,
      [job.id, exhausted ? 'failed' : 'pending', delaySeconds, String(error.message || error).slice(0, 1000)]
    );
    await recordBillingEvent({
      clientId: job.client_id,
      eventType: exhausted ? 'radius.sync_failed' : 'radius.sync_retry_scheduled',
      category: 'radius',
      source: 'radius_sync_worker',
      entityType: 'subscriber',
      entityId: job.subscriber_id,
      actorType: 'system',
      severity: exhausted ? 'critical' : 'warning',
      title: exhausted ? 'RADIUS synchronization failed' : 'RADIUS synchronization retry scheduled',
      payload: {
        job_id: job.id,
        reason: job.reason,
        attempt: job.attempts,
        next_attempt_seconds: exhausted ? null : delaySeconds,
        error: String(error.message || error).slice(0, 1000),
      },
      relatedEntities: [{ entityType: 'radius_sync_job', entityId: job.id, relationship: 'sync_job' }],
      deduplicationKey: `radius-sync:${job.id}:attempt:${job.attempts}:${exhausted ? 'failed' : 'retry'}`,
      sensitivity: 'restricted',
    }).catch((eventError) => console.error('RADIUS sync failure event could not be recorded:', eventError.message));
  }
}

async function processRadiusSyncJobs() {
  if (running) return;
  running = true;
  try {
    const jobs = await claimJobs(3);
    await Promise.all(jobs.map(processJob));
  } catch (error) {
    console.error('RADIUS sync job worker failed:', error.message);
  } finally {
    running = false;
  }
}

async function enqueueFupChecks() {
  try {
    await db.query(
      `INSERT INTO billing_radius_sync_jobs (client_id, subscriber_id, reason)
       SELECT s.client_id, s.id, 'fup_usage_check'
       FROM billing_subscribers s
       JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
       WHERE p.fup_enabled = TRUE
         AND s.radius_username IS NOT NULL AND s.radius_username <> ''
         AND s.service_status = 'active' AND s.radius_status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at + (COALESCE(s.grace_period_days, 0) * INTERVAL '1 day') > NOW())
       ON CONFLICT (client_id, subscriber_id) DO UPDATE
       SET reason='fup_usage_check', status='pending', attempts=0, next_attempt_at=NOW(),
           locked_at=NULL, completed_at=NULL, last_error=NULL, updated_at=NOW()
       WHERE billing_radius_sync_jobs.status IN ('completed', 'failed')`
    );
  } catch (error) {
    console.error('FUP usage check enqueue failed:', error.message);
  }
}

async function processHotspotFupChecks() {
  if (hotspotFupRunning) return;
  hotspotFupRunning = true;
  try {
    const result = await db.query(
      `SELECT v.*, p.router_id, p.mikrotik_rate_limit, p.data_limit_mb, p.fup_enabled,
              p.fup_threshold_mb, p.fup_download_speed_mbps, p.fup_upload_speed_mbps
       FROM billing_hotspot_vouchers v
       JOIN billing_hotspot_plans p ON p.id = v.plan_id AND p.client_id = v.client_id
       WHERE p.fup_enabled = TRUE AND v.status = 'active' AND v.expires_at > NOW()
       ORDER BY v.id LIMIT 100`
    );
    for (const voucher of result.rows) {
      try {
        const sync = await syncHotspotVoucherRadius(voucher);
        if (sync.fup?.rate_changed) await reconnectFupHotspotVoucher(voucher);
      } catch (error) {
        console.error(`Hotspot FUP check failed for voucher ${voucher.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Hotspot FUP worker failed:', error.message);
  } finally {
    hotspotFupRunning = false;
  }
}

function startRadiusSyncJobScheduler() {
  ensureRadiusSyncJobSchema()
    .then(() => processRadiusSyncJobs())
    .catch((error) => console.error('RADIUS sync job schema failed:', error.message));

  if (!pppoeLifecycleStarted) {
    pppoeLifecycleStarted = true;
    startPppoeLifecycleController();
  }

  timer = setInterval(processRadiusSyncJobs, 5000);
  timer.unref?.();
  enqueueFupChecks().then(() => processRadiusSyncJobs()).catch(() => {});
  processHotspotFupChecks().catch(() => {});
  fupTimer = setInterval(() => {
    enqueueFupChecks().then(() => processRadiusSyncJobs()).catch(() => {});
    processHotspotFupChecks().catch(() => {});
  }, 60000);
  fupTimer.unref?.();
}

module.exports = {
  applyLiveFupRate,
  enqueueRadiusSyncJob,
  processRadiusSyncJobs,
  startRadiusSyncJobScheduler,
};
