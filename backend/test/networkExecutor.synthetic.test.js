const crypto = require('crypto');
const db = require('../src/db');
const { createShadowPlan, reviewShadowPlan } = require('../src/services/networkAutomation');
const {
  createExecutionRequest,
  decideExecutionRequest,
  ensureNetworkExecutorSchema,
  executeApprovedRequest,
  recoverExpiredExecutions,
  setRouterExecutorCredential,
} = require('../src/services/networkExecutor');

class FakeRouter {
  constructor(runningAfterEnable = true) {
    this.runningAfterEnable = runningAfterEnable;
    this.interface = { '.id': '*1', name: 'ether2-LAN', disabled: 'false', running: 'true' };
    this.calls = [];
  }
  async command(path, attrs = {}) {
    this.calls.push({ path, attrs: { ...attrs } });
    if (path === '/system/identity/print') return [{ name: 'Synthetic-Router' }];
    if (path === '/system/backup/save') return [];
    if (path === '/interface/print') return [{ ...this.interface }];
    if (path === '/interface/disable') { this.interface.disabled = 'true'; this.interface.running = 'false'; return []; }
    if (path === '/interface/enable') {
      this.interface.disabled = 'false'; this.interface.running = this.runningAfterEnable ? 'true' : 'false'; return [];
    }
    throw new Error(`Unexpected fake RouterOS command ${path}`);
  }
  close() {}
}

async function fixture(client, suffix, runningAfterEnable, executeNow = true) {
  const tenant = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Synthetic Executor ${suffix}`]);
  const clientId = tenant.rows[0].id;
  const admin = await client.query(`INSERT INTO admins (name,email,password_hash,role,client_id) VALUES ('Executor Admin',$1,'test','admin',$2) RETURNING id`, [`${crypto.randomUUID()}@synthetic.test`, clientId]);
  const tunnelIp = { success: '10.77.0.221', rollback: '10.77.0.222', watchdog: '10.77.0.223' }[suffix];
  const router = await client.query(`INSERT INTO mikrotik_routers
    (client_id,name,host,username,password_encrypted,is_active,connection_method,wireguard_tunnel_ip)
    VALUES ($1,$2,$3,'nexa','test',TRUE,'wireguard',$3) RETURNING id`, [clientId, `Synthetic ${suffix}`, tunnelIp]);
  const routerId = router.rows[0].id; const adminId = admin.rows[0].id;
  await setRouterExecutorCredential(clientId, routerId, { username: 'nexa-executor', password: 'synthetic-password-123456' }, { queryable: client, adminId });
  await client.query(`UPDATE network_router_executor_credentials SET enabled=TRUE,verification_status='verified' WHERE client_id=$1 AND router_id=$2`, [clientId, routerId]);
  const plan = await createShadowPlan(clientId, routerId, 'restart_interface', { interface: 'ether2-LAN' }, { queryable: client, reason: `Synthetic ${suffix}` });
  await reviewShadowPlan(clientId, plan.id, 'confirmed', { queryable: client, adminId });
  const request = await createExecutionRequest(clientId, plan.id, {
    idempotency_key: `synthetic-${suffix}-request`,
    maintenance_window_start: new Date(Date.now() - 60_000),
    maintenance_window_end: new Date(Date.now() + 3_600_000),
  }, { queryable: client, adminId });
  await decideExecutionRequest(clientId, request.id, 'approved', { queryable: client, adminId });
  const fake = new FakeRouter(runningAfterEnable);
  if (!executeNow) return { fake, clientId, requestId: request.id };
  const result = await executeApprovedRequest(clientId, request.id, { queryable: client, executionEnabled: true, connect: async () => fake });
  return { result, fake, clientId, requestId: request.id };
}

async function run() {
  await ensureNetworkExecutorSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const success = await fixture(client, 'success', true);
    if (success.result.status !== 'succeeded' || success.result.verification_status !== 'passed') throw new Error('Synthetic repair did not succeed');
    if (!success.fake.calls.some((item) => item.path === '/system/backup/save')) throw new Error('Pre-change backup was not created');
    if (!success.fake.calls.some((item) => item.path === '/interface/disable') || !success.fake.calls.some((item) => item.path === '/interface/enable')) throw new Error('Structured repair commands were not executed');
    const successSteps = await client.query(`SELECT phase,status FROM network_execution_steps WHERE client_id=$1 AND request_id=$2 ORDER BY sequence_no`, [success.clientId, success.requestId]);
    if (!successSteps.rows.some((item) => item.phase === 'verify' && item.status === 'succeeded')) throw new Error('Verification step audit missing');

    const rollback = await fixture(client, 'rollback', false);
    if (rollback.result.status !== 'rolled_back' || rollback.result.rollback_status !== 'succeeded') throw new Error('Failed verification did not trigger rollback');
    const enables = rollback.fake.calls.filter((item) => item.path === '/interface/enable').length;
    if (enables < 2) throw new Error('Rollback command did not run after verification failure');
    const rollbackSteps = await client.query(`SELECT phase,status FROM network_execution_steps WHERE client_id=$1 AND request_id=$2 ORDER BY sequence_no`, [rollback.clientId, rollback.requestId]);
    if (!rollbackSteps.rows.some((item) => item.phase === 'rollback' && item.status === 'succeeded')) throw new Error('Rollback step audit missing');

    const watchdog = await fixture(client, 'watchdog', true, false);
    await client.query(`UPDATE network_execution_requests
      SET status='executing',lease_owner='dead-worker',lease_expires_at=NOW()-INTERVAL '1 minute'
      WHERE client_id=$1 AND id=$2`, [watchdog.clientId, watchdog.requestId]);
    await client.query(`INSERT INTO network_execution_steps
      (request_id,client_id,sequence_no,phase,operation_path,status,finished_at)
      VALUES ($1,$2,1,'change','/interface/enable','succeeded',NOW())`, [watchdog.requestId, watchdog.clientId]);
    const recovered = await recoverExpiredExecutions({ queryable: client, executionEnabled: true, connect: async () => watchdog.fake });
    if (recovered.recovered !== 1 || recovered.results[0].status !== 'rolled_back') throw new Error('Expired execution lease was not recovered');
    if (!watchdog.fake.calls.some((item) => item.path === '/interface/enable')) throw new Error('Watchdog rollback command did not run');

    await client.query('ROLLBACK');
    console.log('Network Executor synthetic success, pre-change backup, verification, failed-verification rollback, and step auditing passed and rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { client.release(); await db.end(); }
}

run().catch((error) => { console.error(error); process.exit(1); });
