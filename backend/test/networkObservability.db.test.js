const crypto = require('crypto');
const db = require('../src/db');
const { ensureNetworkObservabilitySchema, getNetworkOverview, getRouterTopology,
  listAnomalies, listBaselines, listMetricSamples } = require('../src/services/networkObservability');

async function run() {
  await ensureNetworkObservabilitySchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const first = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Network Agent ${crypto.randomUUID()}`]);
    const second = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Network Other ${crypto.randomUUID()}`]);
    const clientId = first.rows[0].id; const otherClientId = second.rows[0].id;
    const router = await client.query(
      `INSERT INTO mikrotik_routers (client_id,name,host,username,password_encrypted,is_active)
       VALUES ($1,'Synthetic Core','192.0.2.30','synthetic','synthetic-test-only',TRUE) RETURNING id`, [clientId]);
    const routerId = router.rows[0].id;
    const runId = crypto.randomUUID();
    await client.query(`INSERT INTO network_collection_runs (id,client_id,router_id,status,completed_at,topology_nodes,topology_edges,metric_samples)
      VALUES ($1,$2,$3,'completed',NOW(),2,1,1)`, [runId, clientId, routerId]);
    await client.query(`INSERT INTO network_topology_nodes (client_id,router_id,node_key,node_type,display_name,last_run_id)
      VALUES ($1,$2,$3,'router','Synthetic Core',$4),($1,$2,$5,'upstream_gateway','192.0.2.1',$4)`,
      [clientId, routerId, `router:${routerId}`, runId, `router:${routerId}:gateway:192.0.2.1`]);
    await client.query(`INSERT INTO network_topology_edges
      (client_id,router_id,edge_key,from_node_key,relationship,to_node_key,last_run_id)
      VALUES ($1,$2,$3,$4,'uses_upstream',$5,$6)`,
      [clientId, routerId, `edge-${crypto.randomUUID()}`, `router:${routerId}`, `router:${routerId}:gateway:192.0.2.1`, runId]);
    await client.query(`INSERT INTO network_metric_samples
      (client_id,router_id,metric_name,subject_type,subject_key,value,unit,run_id)
      VALUES ($1,$2,'router.cpu_percent','router',$3,42,'percent',$4)`, [clientId, routerId, `router:${routerId}`, runId]);
    await client.query(`INSERT INTO network_metric_baselines
      (client_id,router_id,metric_name,subject_type,subject_key,hour_of_week,sample_count,
       mean_value,stddev_value,p50_value,p95_value,window_started_at,window_ended_at)
      VALUES ($1,$2,'router.cpu_percent','router',$3,10,60,20,3,20,25,NOW()-INTERVAL '7 days',NOW())`,
      [clientId, routerId, `router:${routerId}`]);
    await client.query(`INSERT INTO network_anomalies
      (id,client_id,router_id,metric_name,subject_type,subject_key,observed_value,expected_value,deviation_score,severity)
      VALUES ($1,$2,$3,'router.cpu_percent','router',$4,80,20,20,'critical')`,
      [crypto.randomUUID(), clientId, routerId, `router:${routerId}`]);

    const overview = await getNetworkOverview(clientId, client);
    if (Number(overview.routers) !== 1 || Number(overview.topology_nodes) !== 2 || Number(overview.open_anomalies) !== 1) {
      throw new Error('Tenant network overview is incomplete');
    }
    const topology = await getRouterTopology(clientId, routerId, client);
    if (!topology || topology.nodes.length !== 2 || topology.edges.length !== 1) throw new Error('Topology graph is incomplete');
    if (await getRouterTopology(otherClientId, routerId, client)) throw new Error('Cross-tenant topology leaked');
    if ((await listMetricSamples(clientId, routerId, {}, client)).length !== 1) throw new Error('Metric sample missing');
    if ((await listMetricSamples(otherClientId, routerId, {}, client)).length !== 0) throw new Error('Cross-tenant metric leaked');
    if ((await listBaselines(clientId, routerId, client)).length !== 1) throw new Error('Baseline missing');
    if ((await listAnomalies(clientId, { routerId }, client)).length !== 1) throw new Error('Anomaly missing');
    if ((await listAnomalies(otherClientId, { routerId }, client)).length !== 0) throw new Error('Cross-tenant anomaly leaked');
    if (overview.read_only !== true || overview.automatic_execution !== false) throw new Error('Phase 1 safety flags changed');

    await client.query('ROLLBACK');
    console.log('Network Agent schema, topology, telemetry, baseline, anomaly, and tenant-isolation tests passed and rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no transaction */ }
    throw error;
  } finally { client.release(); await db.end(); }
}

run().catch((error) => { console.error(error); process.exit(1); });
