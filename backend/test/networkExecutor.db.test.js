const crypto = require('crypto');
const db = require('../src/db');
const { createShadowPlan, reviewShadowPlan } = require('../src/services/networkAutomation');
const {
  createExecutionRequest,
  decideExecutionRequest,
  ensureNetworkExecutorSchema,
  executeApprovedRequest,
  getExecutionRequest,
  listExecutionRequests,
  setRouterExecutorCredential,
} = require('../src/services/networkExecutor');

async function insertAdmin(client, clientId, name) {
  const result = await client.query(
    `INSERT INTO admins (name,email,password_hash,role,client_id)
     VALUES ($1,$2,'test-only','admin',$3) RETURNING id`,
    [name, `${crypto.randomUUID()}@phase3.test`, clientId]);
  return result.rows[0].id;
}

async function run() {
  await ensureNetworkExecutorSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const first = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Executor ${crypto.randomUUID()}`]);
    const second = await client.query(`INSERT INTO clients (name,account_type) VALUES ($1,'billing') RETURNING id`, [`Executor Other ${crypto.randomUUID()}`]);
    const clientId = first.rows[0].id; const otherClientId = second.rows[0].id;
    const requester = await insertAdmin(client, clientId, 'Requester');
    const approverOne = await insertAdmin(client, clientId, 'Approver One');
    const approverTwo = await insertAdmin(client, clientId, 'Approver Two');
    const outsider = await insertAdmin(client, otherClientId, 'Outsider');
    const router = await client.query(
      `INSERT INTO mikrotik_routers
       (client_id,name,host,username,password_encrypted,is_active,connection_method,wireguard_tunnel_ip)
       VALUES ($1,'Phase 3 Core','10.77.0.220','nexa','read-only-test',TRUE,'wireguard','10.77.0.220') RETURNING id`, [clientId]);
    const routerId = router.rows[0].id;
    await setRouterExecutorCredential(clientId, routerId, { username: 'nexa-executor', password: 'synthetic-password-123456' }, { queryable: client, adminId: requester });
    await client.query(`UPDATE network_router_executor_credentials SET enabled=TRUE,verification_status='verified' WHERE client_id=$1 AND router_id=$2`, [clientId, routerId]);
    const stored = await client.query(`SELECT password_encrypted FROM network_router_executor_credentials WHERE client_id=$1 AND router_id=$2`, [clientId, routerId]);
    if (stored.rows[0].password_encrypted.includes('synthetic-password')) throw new Error('Executor password stored in plaintext');

    const plan = await createShadowPlan(clientId, routerId, 'restart_interface', { interface: 'ether2-LAN' }, {
      queryable: client, reason: 'Synthetic interface recovery', source: 'phase3-test',
    });
    await reviewShadowPlan(clientId, plan.id, 'confirmed', { queryable: client, adminId: requester, note: 'Technically reviewed' });
    const maintenance = {
      maintenance_window_start: new Date(Date.now() - 60_000),
      maintenance_window_end: new Date(Date.now() + 3_600_000),
    };
    const request = await createExecutionRequest(clientId, plan.id, { idempotency_key: 'phase3-request-0001', ...maintenance }, {
      queryable: client, adminId: requester,
    });
    if (request.status !== 'pending_approval' || request.approvals_required !== 1 || request.commands_executed !== 0) throw new Error('Execution request policy mismatch');
    const duplicate = await createExecutionRequest(clientId, plan.id, { idempotency_key: 'phase3-request-0001', ...maintenance }, {
      queryable: client, adminId: requester,
    });
    if (duplicate.id !== request.id) throw new Error('Execution request idempotency failed');
    if (await getExecutionRequest(otherClientId, request.id, client)) throw new Error('Cross-tenant execution request leaked');
    if ((await listExecutionRequests(otherClientId, {}, client)).length !== 0) throw new Error('Cross-tenant request list leaked');
    await assertReject(() => decideExecutionRequest(clientId, request.id, 'approved', { queryable: client, adminId: outsider }), /does not belong/);
    const ready = await decideExecutionRequest(clientId, request.id, 'approved', { queryable: client, adminId: approverOne });
    if (ready.status !== 'ready' || ready.approvals_received !== 1) throw new Error('Approval did not ready the request');
    await assertReject(() => decideExecutionRequest(clientId, request.id, 'approved', { queryable: client, adminId: approverOne }), /cannot be decided|duplicate|already decided/i);
    await assertReject(() => executeApprovedRequest(clientId, request.id, { queryable: client }), /disabled by deployment policy/);
    if ((await getExecutionRequest(clientId, request.id, client)).status !== 'ready') throw new Error('Disabled execution changed request state');

    const criticalPlan = await createShadowPlan(clientId, routerId, 'restart_interface', { interface: 'ether3-LAN' }, {
      queryable: client, reason: 'Synthetic critical recovery', source: 'phase3-test',
    });
    await client.query(`UPDATE network_action_plans SET risk_level='critical',future_approval=$3::jsonb WHERE client_id=$1 AND id=$2`,
      [clientId, criticalPlan.id, JSON.stringify({ required: true, approvals: 2 })]);
    await reviewShadowPlan(clientId, criticalPlan.id, 'confirmed', { queryable: client, adminId: requester });
    const criticalRequest = await createExecutionRequest(clientId, criticalPlan.id, { idempotency_key: 'phase3-critical-0001', ...maintenance }, { queryable: client, adminId: requester });
    if (criticalRequest.approvals_required !== 2) throw new Error('Critical request did not require dual approval');
    await assertReject(() => decideExecutionRequest(clientId, criticalRequest.id, 'approved', { queryable: client, adminId: requester }), /cannot approve their own critical/);
    const once = await decideExecutionRequest(clientId, criticalRequest.id, 'approved', { queryable: client, adminId: approverOne });
    if (once.status !== 'pending_approval') throw new Error('One approval readied a critical request');
    const twice = await decideExecutionRequest(clientId, criticalRequest.id, 'approved', { queryable: client, adminId: approverTwo });
    if (twice.status !== 'ready' || twice.approvals_received !== 2) throw new Error('Dual approval did not ready critical request');
    let tamperedPlanConnected = false;
    await client.query(`UPDATE network_action_plans SET parameters=$3::jsonb WHERE client_id=$1 AND id=$2`,
      [clientId, criticalPlan.id, JSON.stringify({ interface: 'tampered-interface' })]);
    const blocked = await executeApprovedRequest(clientId, criticalRequest.id, {
      queryable: client, executionEnabled: true, connect: async () => { tamperedPlanConnected = true; throw new Error('must not connect'); },
    });
    if (blocked.status !== 'blocked' || tamperedPlanConnected) throw new Error('Plan-seal tampering was not blocked before router connection');

    const events = await client.query(`SELECT COUNT(*)::int count FROM billing_events WHERE client_id=$1 AND event_type LIKE 'network.execution_%'`, [clientId]);
    if (events.rows[0].count < 4) throw new Error('Execution audit events missing');
    await client.query('ROLLBACK');
    console.log('Network Executor credentials, encryption, idempotency, approval gates, dual control, audit events, disabled execution, and tenant isolation passed and rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { client.release(); await db.end(); }
}

async function assertReject(fn, pattern) {
  let error; try { await fn(); } catch (caught) { error = caught; }
  if (!error || !pattern.test(error.message)) throw new Error(`Expected rejection ${pattern}, received ${error?.message || 'none'}`);
}

run().catch((error) => { console.error(error); process.exit(1); });
