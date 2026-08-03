const db = require('../src/db');

async function run() {
  const totals = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_events) AS events,
       (SELECT COUNT(*)::int FROM billing_twin_projection_events WHERE status = 'projected') AS projected,
       (SELECT COUNT(*)::int FROM billing_twin_projection_events WHERE status = 'failed') AS failed,
       (SELECT COUNT(*)::int FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE projection.event_id IS NULL) AS pending,
       (SELECT COUNT(*)::int FROM billing_twin_entities) AS entities,
       (SELECT COUNT(*)::int FROM billing_twin_relationships WHERE active = TRUE) AS relationships,
       (SELECT COUNT(DISTINCT client_id)::int FROM billing_twin_entities) AS tenants,
       (SELECT COUNT(*)::int FROM billing_twin_entities
          WHERE freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale_entities,
       (SELECT COUNT(*)::int FROM billing_twin_entities
          WHERE health_status IN ('degraded', 'critical')) AS unhealthy_entities`
  );
  const integrity = await db.query(
    `SELECT COUNT(*)::int AS missing_relationship_endpoints
     FROM billing_twin_relationships rel
     WHERE rel.active = TRUE AND (
       NOT EXISTS (
         SELECT 1 FROM billing_twin_entities entity
         WHERE entity.client_id = rel.client_id
           AND entity.entity_type = rel.from_entity_type AND entity.entity_id = rel.from_entity_id
       ) OR NOT EXISTS (
         SELECT 1 FROM billing_twin_entities entity
         WHERE entity.client_id = rel.client_id
           AND entity.entity_type = rel.to_entity_type AND entity.entity_id = rel.to_entity_id
       )
     )`
  );
  const workers = await db.query(
    `SELECT status, projected_count, failed_count,
            last_started_at, last_completed_at, last_event_at,
            CASE WHEN last_error IS NULL THEN FALSE ELSE TRUE END AS has_error
     FROM billing_twin_projector_state
     ORDER BY updated_at DESC LIMIT 3`
  );
  const result = {
    ...totals.rows[0],
    ...integrity.rows[0],
    workers: workers.rows,
  };
  console.log(JSON.stringify(result, null, 2));
  if (Number(result.failed) > 0 || Number(result.missing_relationship_endpoints) > 0) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
