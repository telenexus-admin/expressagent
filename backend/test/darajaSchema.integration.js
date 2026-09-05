const assert = require('assert');
const db = require('../src/db');
const { ensureDarajaSchema } = require('../src/services/daraja');

(async () => {
  await ensureDarajaSchema();

  const clientColumns = (await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
      AND column_name IN (
        'mpesa_enabled','mpesa_consumer_key','mpesa_consumer_secret','mpesa_shortcode',
        'mpesa_passkey','mpesa_environment','mpesa_transaction_type','mpesa_callback_secret','mpesa_configured_at'
      )
  `)).rows.map((row) => row.column_name);
  assert.strictEqual(clientColumns.length, 9, 'all native Daraja client columns must exist');

  const conversationColumns = (await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations' AND column_name='payment_state'
  `)).rows;
  assert.strictEqual(conversationColumns.length, 1, 'native payment_state must exist');

  const ledgerColumns = (await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payhero_payment_requests'
      AND column_name IN ('payment_provider','merchant_request_id','checkout_request_id','mpesa_receipt_number','metadata')
  `)).rows.map((row) => row.column_name);
  assert.strictEqual(ledgerColumns.length, 5, 'compatibility payment ledger must support Daraja fields');

  console.log('Daraja schema integration test passed');
  await db.end();
})().catch(async (error) => {
  console.error(error);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
