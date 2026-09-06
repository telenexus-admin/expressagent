const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  DIRECT_BANK_STK_RAILS,
  normalizeBankAccount,
  railForInstitution,
  validateDirectBankAccount,
} = require('../src/services/directBankStk');

assert.strictEqual(DIRECT_BANK_STK_RAILS.equity.paybill, '247247');
assert.strictEqual(DIRECT_BANK_STK_RAILS.coop.paybill, '400200');
assert.strictEqual(railForInstitution('equity').name, 'Equity Bank Kenya');
assert.strictEqual(railForInstitution('coop').name, 'Co-operative Bank of Kenya');
assert.strictEqual(railForInstitution('kcb'), null);
assert.strictEqual(railForInstitution('ncba'), null);

assert.strictEqual(normalizeBankAccount(' 0110 2352 4560 01 '), '01102352456001');
assert.deepStrictEqual(
  validateDirectBankAccount('coop', '01102352456001'),
  { valid: true, account: '01102352456001' }
);
assert.strictEqual(validateDirectBankAccount('coop', '0110235245600').valid, false);
assert.strictEqual(validateDirectBankAccount('equity', '0720185645118').valid, true);
assert.strictEqual(validateDirectBankAccount('equity', 'ABC123').valid, false);
assert.strictEqual(validateDirectBankAccount('kcb', '1234567890').valid, false);

const root = path.resolve(__dirname, '..');
const daraja = fs.readFileSync(path.join(root, 'src/services/daraja.js'), 'utf8');
const settlementsRoute = fs.readFileSync(path.join(root, 'src/routes/settlementProfiles.js'), 'utf8');

assert.ok(
  daraja.includes('PartyB: destination ? destination.paybill : config.shortcode'),
  'Daraja STK must use the server-resolved bank Paybill when direct routing is active'
);
assert.ok(
  daraja.includes('AccountReference: destination ? destination.accountNumber : externalReference.slice(0, 40)'),
  'Daraja STK must use the server-resolved bank account as AccountReference'
);
assert.ok(
  daraja.includes("mode: 'direct_bank_stk'"),
  'Payment request metadata must record direct-bank routing without storing the full account number'
);
assert.ok(
  settlementsRoute.includes('DIRECT_BANK_STK_RAILS'),
  'Settlement settings must expose only proven direct-STK rails'
);
assert.ok(
  !settlementsRoute.includes('DIRECT_BANK_STK_RAILS.kcb'),
  'KCB must not be enabled before it is live-tested'
);
assert.ok(
  settlementsRoute.includes("eventType: 'settlement.direct_stk_requested'"),
  'ISP bank changes must be recorded as review requests, not immediate activations'
);
assert.ok(
  settlementsRoute.includes('review_window_hours: 24'),
  'Bank destination requests must expose the 24-hour review window'
);
assert.ok(
  settlementsRoute.includes("status: 'pending_review'"),
  'Self-service submissions must remain pending until operator review'
);
assert.ok(
  settlementsRoute.includes("if (decision === 'verified')"),
  'Approved direct-bank requests must use the operator verification workflow'
);
assert.ok(
  settlementsRoute.includes('activateSettlementProfile({'),
  'Approved direct-bank requests must be activated only after verification'
);

console.log('Direct bank STK tests passed');
