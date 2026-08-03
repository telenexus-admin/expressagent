const crypto = require('crypto');
const db = require('../src/db');
const {
  createShadowPlan,
  ensureNetworkAutomationSchema,
  getAutomationOverview,
  getShadowPlan,
  listShadowPlans,
  planTenantSignals,
  reviewShadowPlan,
} = require('../src/services/networkAutomation');

async function run() {
  await ensureNetworkAutomationSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const first = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Automation ${crypto.randomUUID()}`]);
    const second = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Automation Other ${crypto.randomUUID()}`]);
    const clientId = first.rows[0].id; const otherClientId = second.rows[0].id;
    const router = await client.query(
      `INSERT INTO mikrotik_routers (client_id,name,host,username,password_encrypted,is_active)
       VALUES ($1,'Shadow Core','192.0.2.70','shadow','test-only',TRUE) RETURNING id`, [clientId]);
    const routerId = router.rows[0].id;
    const incidentId = crypto.randomUUID(); const anomalyId = crypto.randomUUID();
    await client.query(
      `INSERT INTO billing_incidents
       (id,client_id,incident_key,title,summary,category,severity,primary_entity_type,primary_entity_id)
       VALUES ($1,$2,$3,'RADIUS access failure','RADIUS authentication timeouts','network','critical','router',$4)`,
      [incidentId, clientId, `shadow-${crypto.randomUUID()}`, String(routerId)]);
    await client.query(
      `INSERT INTO network_anomalies
       (id,client_id,router_id,metric_name,subject_type,subject_key,observed_value,expected_value,deviation_score,severity,details)
       VALUES ($1,$2,$3,'router.cpu_percent','router',$4,90,20,12,'critical',$5::jsonb)`,
      [anomalyId, clientId, routerId, `router:${routerId}`, JSON.stringify({ source: 'test' })]);

    const plan = await createShadowPlan(clientId, routerId, 'restart_interface', { interface: 'ether2-LAN' }, {
      queryable: client, incidentId, reason: 'Test shadow recovery plan', source: 'test',
    });
    if (plan.execution_allowed || plan.commands_executed || plan.mode !== 'shadow') throw new Error('Shadow safety flags changed');
    const duplicate = await createShadowPlan(clientId, routerId, 'restart_interface', { interface: 'ether2-LAN' }, {
      queryable: client, incidentId, reason: 'Refreshed test shadow recovery plan', source: 'test',
    });
    if (duplicate.id !== plan.id) throw new Error('Plan deduplication failed');
    if (await getShadowPlan(otherClientId, plan.id, client)) throw new Error('Cross-tenant plan leaked');
    await client.query('SAVEPOINT tenant_review_guard');
    let directCrossTenantRejected = false;
    try {
      await client.query(
        `INSERT INTO network_action_plan_reviews (id,plan_id,client_id,decision)
         VALUES ($1,$2,$3,'confirmed')`, [crypto.randomUUID(), plan.id, otherClientId]);
    } catch (_) {
      directCrossTenantRejected = true;
      await client.query('ROLLBACK TO SAVEPOINT tenant_review_guard');
    }
    if (!directCrossTenantRejected) throw new Error('Database accepted a cross-tenant plan review');
    if ((await listShadowPlans(otherClientId, {}, client)).length !== 0) throw new Error('Cross-tenant plan list leaked');
    if (await reviewShadowPlan(otherClientId, plan.id, 'confirmed', { queryable: client })) throw new Error('Cross-tenant review succeeded');
    const reviewed = await reviewShadowPlan(clientId, plan.id, 'confirmed', { queryable: client, note: 'Technical review only' });
    if (!reviewed || reviewed.review_status !== 'confirmed' || reviewed.execution_allowed || reviewed.commands_executed) {
      throw new Error('Review unexpectedly executed or failed');
    }

    const planned = await planTenantSignals(clientId, client);
    if (planned.incidents !== 1 || planned.anomalies !== 1 || planned.plans < 2) throw new Error('Signal planner did not cover incident and anomaly');
    const overview = await getAutomationOverview(clientId, client);
    if (overview.mode !== 'shadow' || overview.automatic_execution || overview.commands_executed !== 0) throw new Error('Automation overview safety flags changed');
    const events = await client.query(
      `SELECT COUNT(*)::int count FROM billing_events WHERE client_id=$1 AND event_type LIKE 'network.shadow_plan_%'`, [clientId]);
    const outbox = await client.query(
      `SELECT COUNT(*)::int count FROM billing_event_outbox WHERE client_id=$1 AND topic LIKE $2`, [clientId, `billing.${clientId}.network.shadow_plan_%`]);
    if (events.rows[0].count < 3 || outbox.rows[0].count < 3) throw new Error('Shadow plan audit events or outbox records missing');

    await client.query('ROLLBACK');
    console.log('Network Automation schema, deduplication, audit outbox, technical review, signal planning, and tenant isolation passed and rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no transaction */ }
    throw error;
  } finally { client.release(); await db.end(); }
}

run().catch((error) => { console.error(error); process.exit(1); });
