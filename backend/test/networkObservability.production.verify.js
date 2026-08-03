const db = require('../src/db');
const {
  ensureNetworkObservabilitySchema,
  getNetworkOverview,
  getRouterTopology,
  listAnomalies,
} = require('../src/services/networkObservability');

async function run() {
  await ensureNetworkObservabilitySchema(db);
  const tenants = await db.query(`SELECT id,name FROM clients WHERE account_type='billing' ORDER BY id`);
  const routers = await db.query(`SELECT client_id,id,name FROM mikrotik_routers ORDER BY client_id,id`);
  let openAnomalies = 0;
  for (const tenant of tenants.rows) {
    const overview = await getNetworkOverview(tenant.id);
    if (overview.read_only !== true || overview.automatic_execution !== false) {
      throw new Error(`Network Agent safety mode failed for tenant ${tenant.id}`);
    }
    const anomalies = await listAnomalies(tenant.id, { status: 'open' });
    if (anomalies.some((item) => Number(item.client_id) !== Number(tenant.id))) {
      throw new Error(`Cross-tenant anomaly leaked into tenant ${tenant.id}`);
    }
    openAnomalies += anomalies.length;
  }
  if (routers.rows.length && tenants.rows.length > 1) {
    const target = routers.rows[0];
    const other = tenants.rows.find((tenant) => Number(tenant.id) !== Number(target.client_id));
    if (other && await getRouterTopology(other.id, target.id)) {
      throw new Error('Cross-tenant router topology access was allowed');
    }
  }
  console.log(JSON.stringify({
    tenants_verified: tenants.rows.length,
    routers_registered: routers.rows.length,
    open_anomalies: openAnomalies,
    read_only: true,
    automatic_execution: false,
    cross_tenant_topology: 'isolated',
  }));
}

run().catch((error) => { console.error(error); process.exit(1); }).finally(() => db.end());
