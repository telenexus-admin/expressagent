const db = require('../src/db');
const { pollRadiusSessionEvents } = require('../src/services/radiusSessionEvents');
const { runMikrotikMonitorOnce } = require('../src/services/mikrotikMonitor');
const tr069Routes = require('../src/routes/tr069');

async function run() {
  await pollRadiusSessionEvents();
  const mikrotik = await runMikrotikMonitorOnce();
  const tr069 = await tr069Routes.runTr069TelemetryOnce();
  const observations = await db.query(
    `SELECT source, COUNT(*)::int AS entities,
            COUNT(*) FILTER (WHERE freshness_expires_at >= NOW())::int AS fresh,
            COUNT(*) FILTER (WHERE operational_status IN ('online', 'up', 'connected'))::int AS online,
            COUNT(*) FILTER (WHERE operational_status IN ('offline', 'down', 'disconnected'))::int AS offline,
            MAX(observed_at) AS last_observed_at
     FROM billing_twin_entities
     WHERE source IN ('radius_accounting_live', 'mikrotik_monitor_live', 'tr069_live')
     GROUP BY source ORDER BY source`
  );
  const coverage = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_subscribers
         WHERE radius_username IS NOT NULL AND radius_username <> '') AS radius_subscribers,
       (SELECT COUNT(*)::int FROM mikrotik_routers WHERE is_active = TRUE) AS active_routers,
       (SELECT COUNT(*)::int FROM tr069_configs WHERE enabled = TRUE) AS tr069_accounts,
       (SELECT COUNT(*)::int FROM tr069_device_cache) AS cached_onts,
       (SELECT COUNT(*)::int FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE projection.event_id IS NULL) AS pending_twin_events,
       (SELECT COUNT(*)::int FROM billing_twin_projection_events WHERE status = 'failed') AS failed_twin_events`
  );
  console.log(JSON.stringify({
    runs: { radius: 'completed', mikrotik, tr069 },
    observations: observations.rows,
    coverage: coverage.rows[0],
  }, null, 2));
  if (Number(coverage.rows[0].failed_twin_events) > 0) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
