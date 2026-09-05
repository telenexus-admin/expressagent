const assert = require('assert');
const db = require('../src/db');

process.env.SETTLEMENT_ENCRYPTION_KEY = process.env.SETTLEMENT_ENCRYPTION_KEY || '44'.repeat(32);
process.env.PAYMENT_ROUTER_ENABLED = 'true';

const { ensureDarajaSchema } = require('../src/services/daraja');
const {
  reviewSettlementProfile,
  saveSettlementProfile,
} = require('../src/services/settlementProfiles');
const {
  ensurePaymentRouterSchema,
  getPaymentRoute,
  markPaymentCollectionStatus,
  prepareSettlementDispatch,
  recordPaymentRouteIntent,
  refreshPaymentRoute,
} = require('../src/services/paymentRouter');

async function createClient(name) {
  const result = await db.query(
    `INSERT INTO clients (name,business_name,account_type,status)
     VALUES ($1,$2,'billing','active') RETURNING id`,
    [name, `${name} ISP`]
  );
  return result.rows[0].id;
}

async function run() {
  await ensureDarajaSchema();
  await ensurePaymentRouterSchema();

  const clientId = await createClient('router-ci-a');
  const otherClientId = await createClient('router-ci-b');

  try {
    const paymentResult = await db.query(
      `INSERT INTO payhero_payment_requests
       (client_id,customer_phone,customer_name,amount,external_reference,status,payment_provider,metadata)
       VALUES ($1,'254700000001','Router Test',1500,$2,'queued','daraja','{}'::jsonb)
       RETURNING id,external_reference,amount`,
      [clientId, `MPESA-${clientId}-ROUTER-CI`]
    );
    const payment = paymentResult.rows[0];

    const missingProfileRoute = await recordPaymentRouteIntent({
      clientId,
      paymentRequestId: payment.id,
      externalReference: payment.external_reference,
      amount: Number(payment.amount),
      collectionProvider: 'daraja',
      collectionStatus: 'queued',
    });
    assert.strictEqual(missingProfileRoute.client_id, clientId);
    assert.strictEqual(missingProfileRoute.route_status, 'blocked');
    assert.strictEqual(missingProfileRoute.block_reason, 'settlement_profile_missing');

    await assert.rejects(
      () => recordPaymentRouteIntent({
        clientId: otherClientId,
        paymentRequestId: payment.id,
        externalReference: payment.external_reference,
        amount: Number(payment.amount),
      }),
      (error) => error && error.code === 'PAYMENT_TENANT_MISMATCH'
    );

    await saveSettlementProfile({
      clientId,
      institutionCode: 'kcb',
      accountName: 'Router CI A ISP Ltd',
      accountNumber: '1234567890123',
      branchName: 'Nairobi',
      collectionReference: 'KCB-ROUTER-CI',
    });

    const pending = await refreshPaymentRoute({ clientId, paymentRequestId: payment.id });
    assert.strictEqual(pending.route_status, 'blocked');
    assert.strictEqual(pending.block_reason, 'settlement_pending');
    assert.strictEqual(pending.institution_code, 'kcb');
    assert.strictEqual(pending.settlement_snapshot.account_number_masked, '••••0123');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(pending.settlement_snapshot, 'account_number_ciphertext'), false);

    await reviewSettlementProfile({
      clientId,
      adminId: null,
      decision: 'verified',
      notes: 'Router CI verified',
      railReference: 'KCB-CI-RAIL',
    });

    const ready = await refreshPaymentRoute({ clientId, paymentRequestId: payment.id });
    assert.strictEqual(ready.route_status, 'blocked');
    assert.strictEqual(ready.block_reason, 'settlement_routing_ready');

    // Simulate a future operator-enabled rail without changing the production activation lock.
    await db.query(
      `UPDATE billing_settlement_profiles
       SET routing_status='active',updated_at=NOW()
       WHERE client_id=$1`,
      [clientId]
    );

    const activeButNoAdapter = await refreshPaymentRoute({ clientId, paymentRequestId: payment.id });
    assert.strictEqual(activeButNoAdapter.route_status, 'blocked');
    assert.strictEqual(activeButNoAdapter.block_reason, 'settlement_adapter_not_connected');

    const paid = await markPaymentCollectionStatus({
      clientId,
      paymentRequestId: payment.id,
      status: 'paid',
      providerReference: 'QXXROUTER123',
    });
    assert.strictEqual(paid.collection_status, 'paid');
    assert.strictEqual(paid.provider_collection_reference, 'QXXROUTER123');
    assert.ok(paid.collected_at);

    await assert.rejects(
      () => prepareSettlementDispatch({ clientId, routeId: paid.id }),
      (error) => error && error.code === 'SETTLEMENT_DISPATCH_BLOCKED' && error.reason === 'settlement_adapter_not_connected'
    );

    const loaded = await getPaymentRoute({ clientId, paymentRequestId: payment.id });
    assert.strictEqual(loaded.client_id, clientId);
    assert.strictEqual(loaded.collection_status, 'paid');
    assert.strictEqual(loaded.route_status, 'blocked');
    assert.strictEqual(loaded.block_reason, 'settlement_adapter_not_connected');

    const rows = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM billing_payment_routes
       WHERE client_id=$1 AND payment_request_id=$2`,
      [clientId, payment.id]
    );
    assert.strictEqual(rows.rows[0].count, 1);

    console.log('Payment router tenant isolation integration tests passed');
  } finally {
    await db.query('DELETE FROM clients WHERE id=ANY($1::int[])', [[clientId, otherClientId]]);
    await db.end();
  }
}

run().catch(async (error) => {
  console.error(error);
  try { await db.end(); } catch (_) { /* noop */ }
  process.exit(1);
});
