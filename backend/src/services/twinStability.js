const os = require('os');
const v8 = require('v8');
const { monitorEventLoopDelay } = require('perf_hooks');
const db = require('../db');
const { recordBillingEvent } = require('./events');
const {
  ensureDigitalTwinSchema,
  processDigitalTwinBatch,
} = require('./digitalTwin');

const TWIN_STABILITY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_twin_health_samples (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'critical')),
    availability_score NUMERIC(5,2) NOT NULL CHECK (availability_score >= 0 AND availability_score <= 100),
    freshness_score NUMERIC(5,2) NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 100),
    total_events INTEGER NOT NULL DEFAULT 0,
    pending_events INTEGER NOT NULL DEFAULT 0,
    failed_events INTEGER NOT NULL DEFAULT 0,
    oldest_pending_seconds INTEGER NOT NULL DEFAULT 0,
    total_entities INTEGER NOT NULL DEFAULT 0,
    stale_entities INTEGER NOT NULL DEFAULT 0,
    total_relationships INTEGER NOT NULL DEFAULT 0,
    missing_relationship_endpoints INTEGER NOT NULL DEFAULT 0,
    source_health JSONB NOT NULL DEFAULT '[]'::jsonb,
    runtime JSONB NOT NULL DEFAULT '{}'::jsonb,
    sampled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_health_samples_tenant_time
    ON billing_twin_health_samples(client_id, sampled_at DESC);

  CREATE TABLE IF NOT EXISTS billing_twin_alerts (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    alert_key VARCHAR(180) NOT NULL,
    source VARCHAR(120) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('open', 'resolved')),
    title VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, alert_key)
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_alerts_tenant_status
    ON billing_twin_alerts(client_id, status, severity, last_detected_at DESC);

  CREATE TABLE IF NOT EXISTS billing_twin_reconciliation_runs (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    worker_id VARCHAR(160) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_reconciliation_tenant_time
    ON billing_twin_reconciliation_runs(client_id, started_at DESC);
`;

const WORKER_ID = `${os.hostname()}:${process.pid}:twin-stability`;
const SAMPLE_INTERVAL_MS = Math.max(60000, Number(process.env.TWIN_STABILITY_INTERVAL_MS) || 300000);
const RECONCILE_INTERVAL_MS = Math.max(300000, Number(process.env.TWIN_RECONCILE_INTERVAL_MS) || 900000);
let schemaReady = false;
let schemaPromise;
let schedulerStarted = false;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function runtimeSnapshot() {
  const memory = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const snapshot = {
    worker_id: WORKER_ID,
    pid: process.pid,
    uptime_seconds: round(process.uptime()),
    rss_mb: round(memory.rss / 1048576),
    heap_used_mb: round(memory.heapUsed / 1048576),
    heap_limit_mb: round(heapLimit / 1048576),
    heap_used_percent: heapLimit ? round(memory.heapUsed / heapLimit * 100) : 0,
    event_loop_p95_ms: round(eventLoopDelay.percentile(95) / 1e6),
    event_loop_max_ms: round(eventLoopDelay.max / 1e6),
  };
  eventLoopDelay.reset();
  return snapshot;
}

async function ensureTwinStabilitySchema(queryable = db) {
  await ensureDigitalTwinSchema(queryable);
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = queryable.query(TWIN_STABILITY_SCHEMA_SQL)
      .then(() => { schemaReady = true; })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

function scoreTwinStability(metrics) {
  const sources = metrics.sources || [];
  const applicable = sources.filter((source) => number(source.expected) > 0);
  const freshnessScore = applicable.length
    ? applicable.reduce((sum, source) => sum + Math.min(1, number(source.fresh) / number(source.expected)), 0)
      / applicable.length * 100
    : 100;
  let availabilityScore = 100;
  if (number(metrics.failed_events) > 0) availabilityScore -= 45;
  if (number(metrics.missing_relationship_endpoints) > 0) availabilityScore -= 45;
  if (number(metrics.oldest_pending_seconds) > 300) availabilityScore -= 35;
  else if (number(metrics.oldest_pending_seconds) > 120) availabilityScore -= 15;
  availabilityScore -= Math.min(35, (100 - freshnessScore) * 0.6);
  if (number(metrics.runtime?.event_loop_p95_ms) > 1000) availabilityScore -= 30;
  else if (number(metrics.runtime?.event_loop_p95_ms) > 250) availabilityScore -= 10;
  if (number(metrics.runtime?.heap_used_percent) > 85) availabilityScore -= 30;
  else if (number(metrics.runtime?.heap_used_percent) > 70) availabilityScore -= 10;
  availabilityScore = Math.max(0, round(availabilityScore));

  const sourceCompletelyDown = applicable.some((source) => number(source.fresh) === 0);
  let status = 'healthy';
  if (
    number(metrics.failed_events) > 0
    || number(metrics.missing_relationship_endpoints) > 0
    || number(metrics.oldest_pending_seconds) > 300
    || sourceCompletelyDown
    || number(metrics.runtime?.event_loop_p95_ms) > 1000
    || number(metrics.runtime?.heap_used_percent) > 85
  ) status = 'critical';
  else if (
    number(metrics.oldest_pending_seconds) > 120
    || freshnessScore < 95
    || number(metrics.runtime?.event_loop_p95_ms) > 250
    || number(metrics.runtime?.heap_used_percent) > 70
  ) status = 'degraded';
  return { status, availability_score: availabilityScore, freshness_score: round(freshnessScore) };
}

async function collectTenantMetrics(clientId, queryable = db, runtime = null) {
  await ensureTwinStabilitySchema(queryable);
  const totals = await queryable.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_events WHERE client_id = $1) AS total_events,
       (SELECT COUNT(*)::int FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE event.client_id = $1 AND projection.event_id IS NULL) AS pending_events,
       (SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(event.recorded_at))), 0)::int
          FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE event.client_id = $1 AND projection.event_id IS NULL) AS oldest_pending_seconds,
       (SELECT COUNT(*)::int FROM billing_twin_projection_events
          WHERE client_id = $1 AND status = 'failed') AS failed_events,
       (SELECT COUNT(*)::int FROM billing_twin_entities WHERE client_id = $1) AS total_entities,
       (SELECT COUNT(*)::int FROM billing_twin_entities
          WHERE client_id = $1 AND freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale_entities,
       (SELECT COUNT(*)::int FROM billing_twin_relationships
          WHERE client_id = $1 AND active = TRUE) AS total_relationships,
       (SELECT COUNT(*)::int FROM billing_twin_relationships rel
          WHERE rel.client_id = $1 AND rel.active = TRUE AND (
            NOT EXISTS (SELECT 1 FROM billing_twin_entities entity
              WHERE entity.client_id = rel.client_id AND entity.entity_type = rel.from_entity_type
                AND entity.entity_id = rel.from_entity_id)
            OR NOT EXISTS (SELECT 1 FROM billing_twin_entities entity
              WHERE entity.client_id = rel.client_id AND entity.entity_type = rel.to_entity_type
                AND entity.entity_id = rel.to_entity_id)
          )) AS missing_relationship_endpoints,
       (SELECT COUNT(*)::int FROM billing_subscribers
          WHERE client_id = $1 AND radius_username IS NOT NULL AND radius_username <> '') AS radius_expected,
       (SELECT COUNT(*)::int FROM mikrotik_routers
          WHERE client_id = $1 AND is_active = TRUE) AS mikrotik_expected,
       (SELECT COUNT(*)::int FROM tr069_configs
          WHERE client_id = $1 AND enabled = TRUE) AS tr069_account_expected,
       (SELECT COUNT(*)::int FROM tr069_device_cache WHERE client_id = $1) AS ont_expected,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'radius_accounting_live'
            AND observation.entity_type = 'subscriber'
            AND EXISTS (SELECT 1 FROM billing_subscribers subscriber
              WHERE subscriber.client_id = observation.client_id
                AND subscriber.id::text = observation.entity_id
                AND subscriber.radius_username IS NOT NULL AND subscriber.radius_username <> '')) AS radius_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'radius_accounting_live'
            AND observation.entity_type = 'subscriber' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM billing_subscribers subscriber
              WHERE subscriber.client_id = observation.client_id
                AND subscriber.id::text = observation.entity_id
                AND subscriber.radius_username IS NOT NULL AND subscriber.radius_username <> '')) AS radius_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'radius_accounting_live'
            AND observation.entity_type = 'subscriber') AS radius_last_observed_at,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'mikrotik_monitor_live'
            AND observation.entity_type = 'router'
            AND EXISTS (SELECT 1 FROM mikrotik_routers router
              WHERE router.client_id = observation.client_id AND router.id::text = observation.entity_id
                AND router.is_active = TRUE)) AS mikrotik_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'mikrotik_monitor_live'
            AND observation.entity_type = 'router' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM mikrotik_routers router
              WHERE router.client_id = observation.client_id AND router.id::text = observation.entity_id
                AND router.is_active = TRUE)) AS mikrotik_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'mikrotik_monitor_live'
            AND observation.entity_type = 'router') AS mikrotik_last_observed_at,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_monitor_live'
            AND observation.entity_type = 'tr069_configuration'
            AND EXISTS (SELECT 1 FROM tr069_configs config
              WHERE config.client_id = observation.client_id AND config.enabled = TRUE)) AS tr069_account_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_monitor_live'
            AND observation.entity_type = 'tr069_configuration' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM tr069_configs config
              WHERE config.client_id = observation.client_id AND config.enabled = TRUE)) AS tr069_account_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_monitor_live'
            AND observation.entity_type = 'tr069_configuration') AS tr069_account_last_observed_at,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_live'
            AND observation.entity_type = 'ont'
            AND EXISTS (SELECT 1 FROM tr069_device_cache ont
              WHERE ont.client_id = observation.client_id AND ont.device_id = observation.entity_id)) AS ont_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_live'
            AND observation.entity_type = 'ont' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM tr069_device_cache ont
              WHERE ont.client_id = observation.client_id AND ont.device_id = observation.entity_id)) AS ont_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_live'
            AND observation.entity_type = 'ont') AS ont_last_observed_at`,
    [clientId]
  );
  const row = totals.rows[0];
  const sources = [
    ['radius_accounting_live', 'subscriber', row.radius_expected, row.radius_observed, row.radius_fresh, row.radius_last_observed_at],
    ['mikrotik_monitor_live', 'router', row.mikrotik_expected, row.mikrotik_observed, row.mikrotik_fresh, row.mikrotik_last_observed_at],
    ['tr069_monitor_live', 'tr069_configuration', row.tr069_account_expected, row.tr069_account_observed, row.tr069_account_fresh, row.tr069_account_last_observed_at],
    ['tr069_live', 'ont', row.ont_expected, row.ont_observed, row.ont_fresh, row.ont_last_observed_at],
  ].map(([source, entityType, expectedValue, observedValue, freshValue, lastObservedAt]) => {
    const expected = number(expectedValue);
    const observed = number(observedValue);
    const fresh = number(freshÛ}´¶‰ËkºwµçeÑ¥½¸½˜ÑÉ…¹Í¥Ñ¥½¹Ì¤…İ…¥Ğ•µ¥Ñ±•ÉÑQÉ…¹Í¥Ñ¥½¸¡±¥•¹Ñ%°ÑÉ…¹Í¥Ñ¥½¸¹…±•ÉĞ°ÑÉ…¹Í¥Ñ¥½¸¹ÑÉ…¹Í¥Ñ¥½¸¤ì(€ô(€É•ÑÕÉ¸ì€¸¸¹Í…µÁ±”¹É½İÍlÁt°ÑÉ…¹Í¥Ñ¥½¹Ìôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸İ¥Ñ¡‘Ù¥Í½Éå1½¬¡±½­9…µ”°™¸¤ì(€½¹ÍĞ±¥•¹Ğ€ô…İ…¥Ğ‘ˆ¹½¹¹•Ğ ¤ì(€ÑÉäì(€€€½¹ÍĞ±½¬€ô…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä M1PÁ}ÑÉå}…‘Ù¥Í½Éå}±½¬¡¡…Í¡Ñ•áĞ Ä¤¤L…ÅÕ¥É•œ°m±½­9…µ•t¤ì(€€€¥˜€ …±½¬¹É½İÍlÁtü¹…ÅÕ¥É•¤É•ÑÕÉ¸ìÍ­¥ÁÁ•èÑÉÕ”°É•…Í½¸è€±½­}¹½Ñ}…ÅÕ¥É•œôì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…İ…¥Ğ™¸¡±¥•¹Ğ¤ì(€€€ô™¥¹…±±äì(€€€€€…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä M1PÁ}…‘Ù¥Í½Éå}Õ¹±½¬¡¡…Í¡Ñ•áĞ Ä¤¤œ°m±½­9…µ•t¤ì(€€€ô(€ô™¥¹…±±äì(€€€±¥•¹Ğ¹É•±•…Í” ¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÉÕ¹Qİ¥¹]…Ñ¡‘½=¹” ¤ì(€…İ…¥Ğ•¹ÍÕÉ•Qİ¥¹MÑ…‰¥±¥ÑåM¡•µ„ ¤ì(€É•ÑÕÉ¸İ¥Ñ¡‘Ù¥Í½Éå1½¬ ¹•á„éÑİ¥¸éİ…Ñ¡‘½œœ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍĞÑ•¹…¹ÑÌ€ô…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€M1P%MQ%9P±¥•¹Ñ}¥L¥I=4€ (€€€€€€€€M1P±¥•¹Ñ}¥I=4‰¥±±¥¹}•Ù•¹ÑÌ(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌ(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4µ¥­É½Ñ¥­}É½ÕÑ•ÉÌ(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4ÑÈÀØå}½¹™¥Ì(€€€€€€€¤Ñ•¹…¹Ğ=IH	d±¥•¹Ñ}¥‘€(€€€€¤ì(€€€½¹ÍĞÉÕ¹Ñ¥µ”€ôÉÕ¹Ñ¥µ•M¹…ÁÍ¡½Ğ ¤ì(€€€½¹ÍĞÉ•ÍÕ±ÑÌ€ômtì(€€€™½È€¡½¹ÍĞÑ•¹…¹Ğ½˜Ñ•¹…¹ÑÌ¹É½İÌ¤ì(€€€€€É•ÍÕ±ÑÌ¹ÁÕÍ ¡…İ…¥ĞÍ…µÁ±•Q•¹…¹ÑMÑ…‰¥±¥Ñä¡Ñ•¹…¹Ğ¹¥°ìÉÕ¹Ñ¥µ”ô¤¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€Ñ•¹…¹ÑÌèÉ•ÍÕ±ÑÌ¹±•¹Ñ °(€€€€€¡•…±Ñ¡äèÉ•ÍÕ±ÑÌ¹™¥±Ñ•È ¡É•ÍÕ±Ğ¤€ôøÉ•ÍÕ±Ğ¹ÍÑ…ÑÕÌ€ôôô€¡•…±Ñ¡äœ¤¹±•¹Ñ °(€€€€€‘•É…‘•èÉ•ÍÕ±ÑÌ¹™¥±Ñ•È ¡É•ÍÕ±Ğ¤€ôøÉ•ÍÕ±Ğ¹ÍÑ…ÑÕÌ€ôôô€‘•É…‘•œ¤¹±•¹Ñ °(€€€€€É¥Ñ¥…°èÉ•ÍÕ±ÑÌ¹™¥±Ñ•È ¡É•ÍÕ±Ğ¤€ôøÉ•ÍÕ±Ğ¹ÍÑ…ÑÕÌ€ôôô€É¥Ñ¥…°œ¤¹±•¹Ñ °(€€€ôì(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•½¹¥±•Q•¹…¹ÑM½ÕÉ•Ì¡±¥•¹Ñ%°ÅÕ•Éå…‰±”€ô‘ˆ¤ì(€½¹ÍĞ½Õ¹ÑÌ€ôì•¹Ñ¥Ñ¥•Í}¥¹Í•ÉÑ•è€À°É•±…Ñ¥½¹Í¡¥ÁÍ}É•½¹¥±•è€À°É•±…Ñ¥½¹Í¡¥ÁÍ}•¹‘•è€Àôì(€½¹ÍĞ•¹Ñ¥ÑåEÕ•É¥•Ì€ôl(€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì€ (€€€€€€±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€ÍÑ…Ñ”°Í½ÕÉ”°½‰Í•ÉÙ•‘}…Ğ°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€€¤M1P±¥•¹Ñ}¥°€ÍÕ‰ÍÉ¥‰•Èœ°¥èéÑ•áĞ°™Õ±±}¹…µ”°(€€€€€€M]!8Í•ÉÙ¥•}ÍÑ…ÑÕÌ%8€ …Ñ¥Ù”œ°¥¹…Ñ¥Ù”œ°•áÁ¥É•œ°ÍÕÍÁ•¹‘•œ°Á•¹‘¥¹œœ¤Q!8Í•ÉÙ¥•}ÍÑ…ÑÕÌ1M€Õ¹­¹½İ¸œ9°(€€€€€€©Í½¹‰}‰Õ¥±‘}½‰©•Ğ …½Õ¹Ñ}¹Õµ‰•Èœ°…½Õ¹Ñ}¹Õµ‰•È°€Í•ÉÙ¥•}ÍÑ…ÑÕÌœ°Í•ÉÙ¥•}ÍÑ…ÑÕÌ°(€€€€€€€€€•áÁ¥É•Í}…Ğœ°•áÁ¥É•Í}…Ğ°€…•ÍÍ}µ½‘”œ°…•ÍÍ}µ½‘”¤°(€€€€€€€Í½ÕÉ•}É•½¹¥±¥…Ñ¥½¸œ°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤°(€€€€€€=1M¡É•…Ñ•‘}…Ğ°9=\ ¤¤°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤(€€€€I=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌ]!I±¥•¹Ñ}¥€ô€Ä(€€€€=8=91%P€¡±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥¤<9=Q!%9€°(€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì€ (€€€€€€±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€ÍÑ…Ñ”°Í½ÕÉ”°½‰Í•ÉÙ•‘}…Ğ°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€€¤M1P±¥•¹Ñ}¥°€Á…­…”œ°¥èéÑ•áĞ°¹…µ”°(€€€€€€M]!8¥Í}…Ñ¥Ù”Q!8€…Ñ¥Ù”œ1M€¥¹…Ñ¥Ù”œ9°(€€€€€€©Í½¹‰}‰Õ¥±‘}½‰©•Ğ ÁÉ¥”œ°ÁÉ¥”°€Ù…±¥‘¥Ñå}‘…åÌœ°Ù…±¥‘¥Ñå}‘…åÌ¤°(€€€€€€€Í½ÕÉ•}É•½¹¥±¥…Ñ¥½¸œ°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤°(€€€€€€=1M¡É•…Ñ•‘}…Ğ°9=\ ¤¤°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤(€€€€I=4‰¥±±¥¹}Á±…¹Ì]!I±¥•¹Ñ}¥€ô€Ä(€€€€=8=91%P€¡±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥¤<9=Q!%9€°(€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì€ (€€€€€€±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€ÍÑ…Ñ”°Í½ÕÉ”°½‰Í•ÉÙ•‘}…Ğ°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€€¤M1P±¥•¹Ñ}¥°€¡½ÑÍÁ½Ñ}Á…­…”œ°¥èéÑ•áĞ°¹…µ”°(€€€€€€M]!8¥Í}…Ñ¥Ù”Q!8€…Ñ¥Ù”œ1M€¥¹…Ñ¥Ù”œ9°(€€€€€€©Í½¹‰}‰Õ¥±‘}½‰©•Ğ ÁÉ¥”œ°ÁÉ¥”°€‘ÕÉ…Ñ¥½¹}µ¥¹ÕÑ•Ìœ°‘ÕÉ…Ñ¥½¹}µ¥¹ÕÑ•Ì¤°(€€€€€€€Í½ÕÉ•}É•½¹¥±¥…Ñ¥½¸œ°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤°(€€€€€€=1M¡É•…Ñ•‘}…Ğ°9=\ ¤¤°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤(€€€€I=4‰¥±±¥¹}¡½ÑÍÁ½Ñ}Á±…¹Ì]!I±¥•¹Ñ}¥€ô€Ä(€€€€=8=91%P€¡±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥¤<9=Q!%9€°(€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì€ (€€€€€€±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€ÍÑ…Ñ”°Í½ÕÉ”°½‰Í•ÉÙ•‘}…Ğ°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€€¤M1P±¥•¹Ñ}¥°€É½ÕÑ•Èœ°¥èéÑ•áĞ°¹…µ”°(€€€€€€M]!8¥Í}…Ñ¥Ù”Q!8€…Ñ¥Ù”œ1M€¥¹…Ñ¥Ù”œ9°(€€€€€€©Í½¹‰}‰Õ¥±‘}½‰©•Ğ ±…ÍÑ}ÍÑ…ÑÕÌœ°±…ÍÑ}ÍÑ…ÑÕÌ°€±…ÍÑ}Í••¹}…Ğœ°±…ÍÑ}Í••¹}…Ğ¤°(€€€€€€€Í½ÕÉ•}É•½¹¥±¥…Ñ¥½¸œ°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤°(€€€€€€=1M¡É•…Ñ•‘}…Ğ°9=\ ¤¤°=1M¡ÕÁ‘…Ñ•‘}…Ğ°É•…Ñ•‘}…Ğ°9=\ ¤¤(€€€€I=4µ¥­É½Ñ¥­}É½ÕÑ•ÉÌ]!I±¥•¹Ñ}¥€ô€Ä(€€€€=8=91%P€¡±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥¤<9=Q!%9€°(€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì€ (€€€€€€±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ°(€€€€€€¡•…±Ñ¡}ÍÑ…ÑÕÌ°ÍÑ…Ñ”°Í½ÕÉ”°½‰Í•ÉÙ•‘}…Ğ°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€€¤M1P±¥•¹Ñ}¥°€½¹Ğœ°‘•Ù¥•}¥°(€€€€€€9U11%¡=9Q}]L œ€œ°µ…¹Õ™…ÑÕÉ•È°µ½‘•±}¹…µ”°Í•É¥…±}¹Õµ‰•È¤°€œœ¤°(€€€€€€M]!8ÍÑ…ÑÕÌ%8€ ½¹±¥¹”œ°İ…É¹¥¹œœ¤Q!8€½¹±¥¹”œ1M€½™™±¥¹”œ9°(€€€€€€M]!8ÍÑ…ÑÕÌ€ô€İ…É¹¥¹œœQ!8€‘•É…‘•œ]!8ÍÑ…ÑÕÌ€ô€½™™±¥¹”œQ!8€É¥Ñ¥…°œ1M€¡•…±Ñ¡äœ9°(€€€€€€©Í½¹‰}‰Õ¥±‘}½‰©•Ğ ÍÑ…ÑÕÌœ°ÍÑ…ÑÕÌ°€±…ÍÑ}¥¹™½É´œ°±…ÍÑ}¥¹™½É´¤°(€€€€€€€Í½ÕÉ•}É•½¹¥±¥…Ñ¥½¸œ°=1M¡±…ÍÑ}¥¹™½É´°Íå¹•‘}…Ğ¤°(€€€€€€Íå¹•‘}…Ğ°=1M¡±…ÍÑ}¥¹™½É´°Íå¹•‘}…Ğ¤(€€€€I=4ÑÈÀØå}‘•Ù¥•}…¡”]!I±¥•¹Ñ}¥€ô€Ä(€€€€=8=91%P€¡±¥•¹Ñ}¥°•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥¤<9=Q!%9€°(€tì(€™½È€¡½¹ÍĞÍÅ°½˜•¹Ñ¥ÑåEÕ•É¥•Ì¤½Õ¹ÑÌ¹•¹Ñ¥Ñ¥•Í}¥¹Í•ÉÑ•€¬ô€¡…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä¡ÍÅ°°m±¥•¹Ñ%‘t¤¤¹É½İ½Õ¹Ğì((€½¹ÍĞÉ•±…Ñ¥½¹Í¡¥ÁÌ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€]%Q ‘•Í¥É•L€ (€€€€€€M1P±¥•¹Ñ}¥°€ÍÕ‰ÍÉ¥‰•ÈœèéÑ•áĞ™É½µ}ÑåÁ”°¥èéÑ•áĞ™É½µ}¥°(€€€€€€€€€€€€€€ÍÕ‰ÍÉ¥‰•‘}Ñ¼œèéÑ•áĞÉ•±…Ñ¥½¹Í¡¥À°€Á…­…”œèéÑ•áĞÑ½}ÑåÁ”°Á±…¹}¥èéÑ•áĞÑ½}¥(€€€€€€I=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌ]!I±¥•¹Ñ}¥€ô€Ä9Á±…¹}¥%L9=P9U10(€€€€€€U9%=810(€€€€€€M1P±¥•¹Ñ}¥°€ÍÕ‰ÍÉ¥‰•Èœ°¥èéÑ•áĞ°€½¹¹•Ñ•‘}Ñ¡É½Õ œ°€É½ÕÑ•Èœ°É½ÕÑ•É}¥èéÑ•áĞ(€€€€€€I=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌ]!I±¥•¹Ñ}¥€ô€Ä9É½ÕÑ•É}¥%L9=P9U10(€€€€€€U9%=810(€€€€€€M1P±¥•¹Ñ}¥°€Á…­…”œ°¥èéÑ•áĞ°€…±±½…Ñ•‘}Ñ¼œ°€É½ÕÑ•Èœ°É½ÕÑ•É}¥èéÑ•áĞ(€€€€€€I=4‰¥±±¥¹}Á±…¹Ì]!I±¥•¹Ñ}¥€ô€Ä9É½ÕÑ•É}¥%L9=P9U10(€€€€€€U9%=810(€€€€€€M1P±¥•¹Ñ}¥°€¡½ÑÍÁ½Ñ}Á…­…”œ°¥èéÑ•áĞ°€…±±½…Ñ•‘}Ñ¼œ°€É½ÕÑ•Èœ°É½ÕÑ•É}¥èéÑ•áĞ(€€€€€€I=4‰¥±±¥¹}¡½ÑÍÁ½Ñ}Á±…¹Ì]!I±¥•¹Ñ}¥€ô€Ä9É½ÕÑ•É}¥%L9=P9U10(€€€€€€U9%=810(€€€€€€M1P±¥•¹Ñ}¥°€½¹Ğœ°‘•Ù¥•}¥°€…ÍÍ¥¹•‘}ÍÕ‰ÍÉ¥‰•Èœ°€ÍÕ‰ÍÉ¥‰•Èœ°ÍÕ‰ÍÉ¥‰•É}¥èéÑ•áĞ(€€€€€€I=4ÑÈÀØå}‘•Ù¥•}±½…Ñ¥½¹Ì]!I±¥•¹Ñ}¥€ô€Ä9ÍÕ‰ÍÉ¥‰•É}¥%L9=P9U10(€€€€€¤(€€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌ€ (€€€€€€±¥•¹Ñ}¥°™É½µ}•¹Ñ¥Ñå}ÑåÁ”°™É½µ}•¹Ñ¥Ñå}¥°É•±…Ñ¥½¹Í¡¥À°(€€€€€€Ñ½}•¹Ñ¥Ñå}ÑåÁ”°Ñ½}•¹Ñ¥Ñå}¥°…Ñ¥Ù”°½‰Í•ÉÙ•‘}…Ğ°Ù…±¥‘}™É½´°½¹™¥‘•¹”(€€€€€¤M1P±¥•¹Ñ}¥°™É½µ}ÑåÁ”°™É½µ}¥°É•±…Ñ¥½¹Í¡¥À°Ñ½}ÑåÁ”°Ñ½}¥°(€€€€€€€€€€€€€QIU°9=\ ¤°9=\ ¤°€Ä¸ÀÀÀI=4‘•Í¥É•(€€€€=8=91%P€ (€€€€€€±¥•¹Ñ}¥°™É½µ}•¹Ñ¥Ñå}ÑåÁ”°™É½µ}•¹Ñ¥Ñå}¥°(€€€€€€É•±…Ñ¥½¹Í¡¥À°Ñ½}•¹Ñ¥Ñå}ÑåÁ”°Ñ½}•¹Ñ¥Ñå}¥(€€€€€¤<UAQMP…Ñ¥Ù”€ôQIU°Ù…±¥‘}Ñ¼€ô9U10°½‰Í•ÉÙ•‘}…Ğ€ô9=\ ¤°(€€€€€€Ù•ÉÍ¥½¸€ô‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌ¹Ù•ÉÍ¥½¸€¬€Ä°ÕÁ‘…Ñ•‘}…Ğ€ô9=\ ¤(€€€€]!I‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌ¹…Ñ¥Ù”€ô1M€°(€€€m±¥•¹Ñ%‘t(€€¤ì(€½Õ¹ÑÌ¹É•±…Ñ¥½¹Í¡¥ÁÍ}É•½¹¥±•€ôÉ•±…Ñ¥½¹Í¡¥ÁÌ¹É½İ½Õ¹Ğì(€½¹ÍĞ•¹‘•€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€UAQ‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌÉ•°(€€€€MP…Ñ¥Ù”€ô1M°Ù…±¥‘}Ñ¼€ô9=\ ¤°½‰Í•ÉÙ•‘}…Ğ€ô9=\ ¤°(€€€€€€€€Ù•ÉÍ¥½¸€ôÙ•ÉÍ¥½¸€¬€Ä°ÕÁ‘…Ñ•‘}…Ğ€ô9=\ ¤(€€€€]!IÉ•°¹±¥•¹Ñ}¥€ô€Ä9É•°¹…Ñ¥Ù”€ôQIU9€ (€€€€€€€¡É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô€ÍÕ‰ÍÉ¥‰•Èœ9É•°¹É•±…Ñ¥½¹Í¡¥À€ô€ÍÕ‰ÍÉ¥‰•‘}Ñ¼œ(€€€€€€€€99=Pa%MQL€¡M1P€ÄI=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌÍÕ‰ÍÉ¥‰•È(€€€€€€€€€€]!IÍÕ‰ÍÉ¥‰•È¹±¥•¹Ñ}¥€ôÉ•°¹±¥•¹Ñ}¥9ÍÕ‰ÍÉ¥‰•È¹¥èéÑ•áĞ€ôÉ•°¹™É½µ}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€9ÍÕ‰ÍÉ¥‰•È¹Á±…¹}¥èéÑ•áĞ€ôÉ•°¹Ñ½}•¹Ñ¥Ñå}¥¤¤(€€€€€€=H€¡É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô€ÍÕ‰ÍÉ¥‰•Èœ9É•°¹É•±…Ñ¥½¹Í¡¥À€ô€½¹¹•Ñ•‘}Ñ¡É½Õ œ(€€€€€€€€99=Pa%MQL€¡M1P€ÄI=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌÍÕ‰ÍÉ¥‰•È(€€€€€€€€€€]!IÍÕ‰ÍÉ¥‰•È¹±¥•¹Ñ}¥€ôÉ•°¹±¥•¹Ñ}¥9ÍÕ‰ÍÉ¥‰•È¹¥èéÑ•áĞ€ôÉ•°¹™É½µ}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€9ÍÕ‰ÍÉ¥‰•È¹É½ÕÑ•É}¥èéÑ•áĞ€ôÉ•°¹Ñ½}•¹Ñ¥Ñå}¥¤¤(€€€€€€=H€¡É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”%8€ Á…­…”œ°¡½ÑÍÁ½Ñ}Á…­…”œ¤9É•°¹É•±…Ñ¥½¹Í¡¥À€ô€…±±½…Ñ•‘}Ñ¼œ(€€€€€€€€99=Pa%MQL€ (€€€€€€€€€€M1P€ÄI=4‰¥±±¥¹}Á±…¹ÌÁ±…¸]!IÉ•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô€Á…­…”œ(€€€€€€€€€€€€9Á±…¸¹±¥•¹Ñ}¥€ôÉ•°¹±¥•¹Ñ}¥9Á±…¸¹¥èéÑ•áĞ€ôÉ•°¹™É½µ}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€9Á±…¸¹É½ÕÑ•É}¥èéÑ•áĞ€ôÉ•°¹Ñ½}•¹Ñ¥Ñå}¥(€€€€€€€€€€U9%=810(€€€€€€€€€€M1P€ÄI=4‰¥±±¥¹}¡½ÑÍÁ½Ñ}Á±…¹ÌÁ±…¸]!IÉ•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô€¡½ÑÍÁ½Ñ}Á…­…”œ(€€€€€€€€€€€€9Á±…¸¹±¥•¹Ñ}¥€ôÉ•°¹±¥•¹Ñ}¥9Á±…¸¹¥èéÑ•áĞ€ôÉ•°¹™É½µ}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€9Á±…¸¹É½ÕÑ•É}¥èéÑ•áĞ€ôÉ•°¹Ñ½}•¹Ñ¥Ñå}¥(€€€€€€€€€¤¤(€€€€€€=H€¡É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô€½¹Ğœ9É•°¹É•±…Ñ¥½¹Í¡¥À€ô€…ÍÍ¥¹•‘}ÍÕ‰ÍÉ¥‰•Èœ(€€€€€€€€99=Pa%MQL€¡M1P€ÄI=4ÑÈÀØå}‘•Ù¥•}±½…Ñ¥½¹Ì±½…Ñ¥½¸(€€€€€€€€€€]!I±½…Ñ¥½¸¹±¥•¹Ñ}¥€ôÉ•°¹±¥•¹Ñ}¥9±½…Ñ¥½¸¹‘•Ù¥•}¥€ôÉ•°¹™É½µ}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€9±½…Ñ¥½¸¹ÍÕ‰ÍÉ¥‰•É}¥èéÑ•áĞ€ôÉ•°¹Ñ½}•¹Ñ¥Ñå}¥¤¤(€€€€€¥€°(€€€m±¥•¹Ñ%‘t(€€¤ì(€½Õ¹ÑÌ¹É•±…Ñ¥½¹Í¡¥ÁÍ}•¹‘•€ô•¹‘•¹É½İ½Õ¹Ğì(€É•ÑÕÉ¸½Õ¹ÑÌì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÉÕ¹Qİ¥¹I•½¹¥±¥…Ñ¥½¹=¹” ¤ì(€…İ…¥Ğ•¹ÍÕÉ•Qİ¥¹MÑ…‰¥±¥ÑåM¡•µ„ ¤ì(€É•ÑÕÉ¸İ¥Ñ¡‘Ù¥Í½Éå1½¬ ¹•á„éÑİ¥¸éÉ•½¹¥±¥…Ñ¥½¸œ°…Íå¹Œ€ ¤€ôøì(€€€…İ…¥ĞÁÉ½•ÍÍ¥¥Ñ…±Qİ¥¹	…Ñ  ÔÀÀ¤ì(€€€½¹ÍĞÑ•¹…¹ÑÌ€ô…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€M1P%MQ%9P±¥•¹Ñ}¥L¥I=4€ (€€€€€€€€M1P±¥•¹Ñ}¥I=4‰¥±±¥¹}•Ù•¹ÑÌ(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4‰¥±±¥¹}ÍÕ‰ÍÉ¥‰•ÉÌ(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4µ¥­É½Ñ¥­}É½ÕÑ•ÉÌ(€€€€€€€€U9%=8M1P±¥•¹Ñ}¥I=4ÑÈÀØå}½¹™¥Ì(€€€€€€€¤Ñ•¹…¹Ğ=IH	d±¥•¹Ñ}¥‘€(€€€€¤ì(€€€½¹ÍĞÑ½Ñ…°€ôìÑ•¹…¹ÑÌè€À°•¹Ñ¥Ñ¥•Í}¥¹Í•ÉÑ•è€À°É•±…Ñ¥½¹Í¡¥ÁÍ}É•½¹¥±•è€À°É•±…Ñ¥½¹Í¡¥ÁÍ}•¹‘•è€À°™…¥±•è€Àôì(€€€™½È€¡½¹ÍĞÑ•¹…¹Ğ½˜Ñ•¹…¹ÑÌ¹É½İÌ¤ì(€€€€€½¹ÍĞÍÑ…ÉÑ•€ô…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}É•½¹¥±¥…Ñ¥½¹}ÉÕ¹Ì€¡±¥•¹Ñ}¥°İ½É­•É}¥°ÍÑ…ÑÕÌ¤(€€€€€€€€Y1UL€ Ä°È°ÉÕ¹¹¥¹œœ¤IQUI9%9¥‘€°(€€€€€€€mÑ•¹…¹Ğ¹¥°]=I-I}%t(€€€€€€¤ì(€€€€€ÑÉäì(€€€€€€€½¹ÍĞ½Õ¹ÑÌ€ô…İ…¥ĞÉ•½¹¥±•Q•¹…¹ÑM½ÕÉ•Ì¡Ñ•¹…¹Ğ¹¥¤ì(€€€€€€€…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€€€€€UAQ‰¥±±¥¹}Ñİ¥¹}É•½¹¥±¥…Ñ¥½¹}ÉÕ¹Ì(€€€€€€€€€€MPÍÑ…ÑÕÌ€ô€½µÁ±•Ñ•œ°½Õ¹ÑÌ€ô€Èèé©Í½¹ˆ°½µÁ±•Ñ•‘}…Ğ€ô9=\ ¤]!I¥€ô€Å€°(€€€€€€€€€mÍÑ…ÉÑ•¹É½İÍlÁt¹¥°)M=8¹ÍÑÉ¥¹¥™ä¡½Õ¹ÑÌ¥t(€€€€€€€€¤ì(€€€€€€€Ñ½Ñ…°¹Ñ•¹…¹ÑÌ€¬ô€Äì(€€€€€€€™½È€¡½¹ÍĞ­•ä½˜l•¹Ñ¥Ñ¥•Í}¥¹Í•ÉÑ•œ°€É•±…Ñ¥½¹Í¡¥ÁÍ}É•½¹¥±•œ°€É•±…Ñ¥½¹Í¡¥ÁÍ}•¹‘•t¤ì(€€€€€€€€€Ñ½Ñ…±m­•åt€¬ô¹Õµ‰•È¡½Õ¹ÑÍm­•åt¤ì(€€€€€€€ô(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€Ñ½Ñ…°¹™…¥±•€¬ô€Äì(€€€€€€€…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€€€€€UAQ‰¥±±¥¹}Ñİ¥¹}É•½¹¥±¥…Ñ¥½¹}ÉÕ¹Ì(€€€€€€€€€€MPÍÑ…ÑÕÌ€ô€™…¥±•œ°•ÉÉ½È€ô€È°½µÁ±•Ñ•‘}…Ğ€ô9=\ ¤]!I¥€ô€Å€°(€€€€€€€€€mÍÑ…ÉÑ•¹É½İÍlÁt¹¥°MÑÉ¥¹œ¡•ÉÉ½È¹µ•ÍÍ…”ñğ•ÉÉ½È¤¹Í±¥” À°€ÈÀÀÀ¥t(€€€€€€€€¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸Ñ½Ñ…°ì(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑQİ¥¹MÑ…‰¥±¥ÑåI•Á½ÉĞ¡±¥•¹Ñ%°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•Qİ¥¹MÑ…‰¥±¥ÑåM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞm±…Ñ•ÍĞ°¡¥ÍÑ½Éä°…±•ÉÑÌ°É•½¹¥±¥…Ñ¥½¹t€ô…İ…¥ĞAÉ½µ¥Í”¹…±°¡l(€€€ÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1P€¨I=4‰¥±±¥¹}Ñİ¥¹}¡•…±Ñ¡}Í…µÁ±•Ì(€€€€€€]!I±¥•¹Ñ}¥€ô€Ä=IH	dÍ…µÁ±•‘}…ĞM1%5%P€Å€°m±¥•¹Ñ%‘t(€€€€¤°(€€€ÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1PÍÑ…ÑÕÌ°…Ù…¥±…‰¥±¥Ñå}Í½É”°™É•Í¡¹•ÍÍ}Í½É”°Á•¹‘¥¹}•Ù•¹ÑÌ°(€€€€€€€€€€€€€™…¥±•‘}•Ù•¹ÑÌ°Í…µÁ±•‘}…Ğ(€€€€€€I=4‰¥±±¥¹}Ñİ¥¹}¡•…±Ñ¡}Í…µÁ±•Ì(€€€€€€]!I±¥•¹Ñ}¥€ô€Ä9Í…µÁ±•‘}…Ğ€øô9=\ ¤€´%9QIY0€œÜÈ¡½ÕÉÌœ(€€€€€€=IH	dÍ…µÁ±•‘}…ĞM1%5%P€ÄÀÀÁ€°m±¥•¹Ñ%‘t(€€€€¤°(€€€ÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1P¥°…±•ÉÑ}­•ä°Í½ÕÉ”°Í•Ù•É¥Ñä°ÍÑ…ÑÕÌ°Ñ¥Ñ±”°‘•Ñ…¥±Ì°(€€€€€€€€€€€€€™¥ÉÍÑ}‘•Ñ•Ñ•‘}…Ğ°±…ÍÑ}‘•Ñ•Ñ•‘}…Ğ°É•Í½±Ù•‘}…Ğ°½ÕÉÉ•¹•}½Õ¹Ğ(€€€€€€I=4‰¥±±¥¹}Ñİ¥¹}…±•ÉÑÌ]!I±¥•¹Ñ}¥€ô€Ä(€€€€€€=IH	d€¡ÍÑ…ÑÕÌ€ô€½Á•¸œ¤M°Í•Ù•É¥ÑäM°±…ÍÑ}‘•Ñ•Ñ•‘}…ĞM1%5%P€ÄÀÁ€°m±¥•¹Ñ%‘t(€€€€¤°(€€€ÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1PÍÑ…ÑÕÌ°½Õ¹ÑÌ°•ÉÉ½È°ÍÑ…ÉÑ•‘}…Ğ°½µÁ±•Ñ•‘}…Ğ(€€€€€€I=4‰¥±±¥¹}Ñİ¥¹}É•½¹¥±¥…Ñ¥½¹}ÉÕ¹Ì(€€€€€€]!I±¥•¹Ñ}¥€ô€Ä=IH	dÍÑ…ÉÑ•‘}…ĞM1%5%P€Å€°m±¥•¹Ñ%‘t(€€€€¤°(€t¤ì(€½¹ÍĞÍ…µÁ±•Ì€ô¡¥ÍÑ½Éä¹É½İÌì(€½¹ÍĞÍ½…­!½ÕÉÌ€ôÍ…µÁ±•Ì¹±•¹Ñ (€€€€ü€¡…Ñ”¹¹½Ü ¤€´¹•Ü…Ñ”¡Í…µÁ±•ÍlÁt¹Í…µÁ±•‘}…Ğ¤¹•ÑQ¥µ” ¤¤€¼€ÌØÀÀÀÀÀ€è€Àì(€É•ÑÕÉ¸ì(€€€ÕÉÉ•¹Ğè±…Ñ•ÍĞ¹É½İÍlÁtñğ¹Õ±°°(€€€…±•ÉÑÌè…±•ÉÑÌ¹É½İÌ°(€€€É•½¹¥±¥…Ñ¥½¸èÉ•½¹¥±¥…Ñ¥½¸¹É½İÍlÁtñğ¹Õ±°°(€€€Í½…¬èì(€€€€€ÍÑ…ÉÑ•‘}…ĞèÍ…µÁ±•ÍlÁtü¹Í…µÁ±•‘}…Ğñğ¹Õ±°°(€€€€€•±…ÁÍ•‘}¡½ÕÉÌèÉ½Õ¹¡Í½…­!½ÕÉÌ¤°(€€€€€Í…µÁ±•}½Õ¹ĞèÍ…µÁ±•Ì¹±•¹Ñ °(€€€€€¡•…±Ñ¡å}Í…µÁ±•ÌèÍ…µÁ±•Ì¹™¥±Ñ•È ¡Í…µÁ±”¤€ôøÍ…µÁ±”¹ÍÑ…ÑÕÌ€ôôô€¡•…±Ñ¡äœ¤¹±•¹Ñ °(€€€€€‘•É…‘•‘}Í…µÁ±•ÌèÍ…µÁ±•Ì¹™¥±Ñ•È ¡Í…µÁ±”¤€ôøÍ…µÁ±”¹ÍÑ…ÑÕÌ€ôôô€‘•É…‘•œ¤¹±•¹Ñ °(€€€€€É¥Ñ¥…±}Í…µÁ±•ÌèÍ…µÁ±•Ì¹™¥±Ñ•È ¡Í…µÁ±”¤€ôøÍ…µÁ±”¹ÍÑ…ÑÕÌ€ôôô€É¥Ñ¥…°œ¤¹±•¹Ñ °(€€€€€Ù•É‘¥ĞèÍ½…­!½ÕÉÌ€øô€Ğà€ü€•±¥¥‰±•}™½É}Ù•É‘¥Ğœ€è€½±±•Ñ¥¹œœ°(€€€ô°(€€€¡¥ÍÑ½ÉäèÍ…µÁ±•Ì°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±¥ÍÑQİ¥¹±•ÉÑÌ¡±¥•¹Ñ%°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•Qİ¥¹MÑ…‰¥±¥ÑåM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÍÑ…ÑÕÌ€ôl½Á•¸œ°€É•Í½±Ù•t¹¥¹±Õ‘•Ì¡½ÁÑ¥½¹Ì¹ÍÑ…ÑÕÌ¤€ü½ÁÑ¥½¹Ì¹ÍÑ…ÑÕÌ€è¹Õ±°ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€M1P¥°…±•ÉÑ}­•ä°Í½ÕÉ”°Í•Ù•É¥Ñä°ÍÑ…ÑÕÌ°Ñ¥Ñ±”°‘•Ñ…¥±Ì°(€€€€€€€€€€€™¥ÉÍÑ}‘•Ñ•Ñ•‘}…Ğ°±…ÍÑ}‘•Ñ•Ñ•‘}…Ğ°É•Í½±Ù•‘}…Ğ°½ÕÉÉ•¹•}½Õ¹Ğ(€€€€I=4‰¥±±¥¹}Ñİ¥¹}…±•ÉÑÌ(€€€€]!I±¥•¹Ñ}¥€ô€Ä9€ ÈèéÑ•áĞ%L9U10=HÍÑ…ÑÕÌ€ô€È¤(€€€€=IH	d€¡ÍÑ…ÑÕÌ€ô€½Á•¸œ¤M°Í•Ù•É¥ÑäM°±…ÍÑ}‘•Ñ•Ñ•‘}…ĞM(€€€€1%5%P€Í€°(€€€m±¥•¹Ñ%°ÍÑ…ÑÕÌ°5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸¡9Õµ‰•È¡½ÁÑ¥½¹Ì¹±¥µ¥Ğ¤ñğ€ÄÀÀ°€ÔÀÀ¤¥t(€€¤ì(€É•ÑÕÉ¸É•ÍÕ±Ğ¹É½İÌì)ô()™Õ¹Ñ¥½¸ÍÑ…ÉÑQİ¥¹MÑ…‰¥±¥ÑåM¡•‘Õ±•ÉÌ ¤ì(€¥˜€¡Í¡•‘Õ±•ÉMÑ…ÉÑ•¤É•ÑÕÉ¸ì(€Í¡•‘Õ±•ÉMÑ…ÉÑ•€ôÑÉÕ”ì(€Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€ÉÕ¹Qİ¥¹I•½¹¥±¥…Ñ¥½¹=¹” ¤¹…Ñ  ¡•ÉÉ½È¤€ôø½¹Í½±”¹•ÉÉ½È Qİ¥¸É•½¹¥±¥…Ñ¥½¸ÍÑ…ÉÑÕÀ™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤¤ì(€ô°€ĞÔÀÀÀ¤ì(€Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€ÉÕ¹Qİ¥¹]…Ñ¡‘½=¹” ¤¹…Ñ  ¡•ÉÉ½È¤€ôø½¹Í½±”¹•ÉÉ½È Qİ¥¸İ…Ñ¡‘½œÍÑ…ÉÑÕÀ™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤¤ì(€ô°€äÀÀÀÀ¤ì(€½¹ÍĞİ…Ñ¡‘½œ€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøì(€€€ÉÕ¹Qİ¥¹]…Ñ¡‘½=¹” ¤¹…Ñ  ¡•ÉÉ½È¤€ôø½¹Í½±”¹•ÉÉ½È Qİ¥¸İ…Ñ¡‘½œ™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤¤ì(€ô°M5A1}%9QIY1}5L¤ì(€½¹ÍĞÉ•½¹¥±¥…Ñ¥½¸€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøì(€€€ÉÕ¹Qİ¥¹I•½¹¥±¥…Ñ¥½¹=¹” ¤¹…Ñ  ¡•ÉÉ½È¤€ôø½¹Í½±”¹•ÉÉ½È Qİ¥¸É•½¹¥±¥…Ñ¥½¸™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤¤ì(€ô°I=9%1}%9QIY1}5L¤ì(€İ…Ñ¡‘½œ¹Õ¹É•˜ü¸ ¤ì(€É•½¹¥±¥…Ñ¥½¸¹Õ¹É•˜ü¸ ¤ì(€½¹Í½±”¹±½œ¡Qİ¥¸ÍÑ…‰¥±¥Ñäİ…Ñ¡‘½œÉ•…‘ä€ ‘íM5A1}%9QIY1}5MõµÌÍ…µÁ±•Ì°€‘íI=9%1}%9QIY1}5MõµÌÉ•½¹¥±¥…Ñ¥½¸¤¹€¤ì)ô()µ½‘Õ±”¹•áÁ½ÉÑÌ€ôì(€Q]%9}MQ	%1%Qe}M!5}ME0°(€½±±•ÑQ•¹…¹Ñ5•ÑÉ¥Ì°(€‘•Í¥É•‘±•ÉÑÌ°(€•¹ÍÕÉ•Qİ¥¹MÑ…‰¥±¥ÑåM¡•µ„°(€•ÑQİ¥¹MÑ…‰¥±¥ÑåI•Á½ÉĞ°(€±¥ÍÑQİ¥¹±•ÉÑÌ°(€É•½¹¥±•Q•¹…¹ÑM½ÕÉ•Ì°(€ÉÕ¹Qİ¥¹I•½¹¥±¥…Ñ¥½¹=¹”°(€ÉÕ¹Qİ¥¹]…Ñ¡‘½=¹”°(€Í…µÁ±•Q•¹…¹ÑMÑ…‰¥±¥Ñä°(€Í½É•Qİ¥¹MÑ…‰¥±¥Ñä°(€ÍÑ…ÉÑQİ¥¹MÑ…‰¥±¥ÑåM¡•‘Õ±•ÉÌ°)ôì(