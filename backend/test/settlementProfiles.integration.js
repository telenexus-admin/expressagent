const assert = require('assert');
const db = require('../src/db');

process.env.SETTLEMENT_ENCRYPTION_KEY = process.env.SETTLEMENT_ENCRYPTION_KEY || '33'.repeat(32);

const {
  ensureSettlementSchema,
  getSettlementProfile,
  resolveActiveSettlement,
  reviewSettlementProfile,
  safeProfile,
  saveSettlementProfile,
} = require('../src/services/settlementProfiles');

async function run() {
  await ensureSettlementSchema();

  const clientResult = await db.query(
    `INSERT INTO clients (name,business_name,account_type,status)
     VALUES ('settlement-ci','Settlement CI ISP','billing','active')
     RETURNING id`
  );
  const clientId = clientResult.rows[0].id;

  try {
    const saved = await saveSettlementProfile({
      clientId,
      institutionCode: 'ncba',
      accountName: 'Settlement CI ISP Ltd',
      accountNumber: '0123456789012',
      branchName: 'Upper Hill',
      collectionReference: 'NCBA-CI-998877',
    });

    assert.strictEqual(saved.institution_code, 'ncba');
    assert.strictEqual(saved.verification_status, 'pending');
    assert.strictEqual(saved.routing_status, 'disabled');
    assert.ok(saved.account_number_ciphertext);
    assert.ok(!saved.account_number_ciphertext.includes('0123456789012'));
    assert.strictEqual(saved.account_number_last4, '9012');

    const safe = safeProfile(saved);
    assert.strictEqual(safe.account_number_masked, '••••9012');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(safe, 'account_number_ciphertext'), false);

    const edited = await saveSettlementProfile({
      clientId,
      institutionCode: 'ncba',
      accountName: 'Settlement CI ISP Ltd',
      accountNumber: '',
      branchName: 'Westlands',
      collectionReference: '',
    });
    assert.strictEqual(edited.account_number_last4, '9012');
    assert.strictEqual(edited.branch_name, 'Westlands');
    assert.strictEqual(edited.verification_status, 'pending');
    assert.strictEqual(edited.routing_status, 'disabled');

    await assert.rejects(
      () => saveSettlementProfile({
        clientId,
        institutionCode: 'kcb',
        accountName: 'Settlement CI ISP Ltd',
        accountNumber: '',
        branchName: '',
        collectionReference: '',
      }),
      /bank account number/i
    );

    const verified = await reviewSettlementProfile({
      clientId,
      adminId: null,
      decision: 'verified',
      notes: 'CI verification',
      railReference: 'BANK-RAIL-CI',
    });
    assert.strictEqual(verified.verification_status, 'verified');
    assert.strictEqual(verified.routing_status, 'ready');

    await assert.rejects(
      () => resolveActiveSettlement(clientId),
      (error) => error && error.code === 'SETTLEMENT_NOT_ACTIVE'
    );

    const loaded = await getSettlementProfile(clientId);
    assert.strictEqual(loaded.routing_status, 'ready');

    console.log('Settlement profile integration tests passed');
  } finally {
    await db.query('DELETE FROM clients WHERE id=$1', [clientId]);
    await db.end();
  }
}

run().catch(async (error) => {
  console.error(error);
  try { await db.end(); } catch (_) { /* noop */ }
  process.exit(1);
});
