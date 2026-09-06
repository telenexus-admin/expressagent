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
assert.ok(
  settlementsRoute.includes("const { isEmailConfigured, sendEmail } = require('../services/email')"),
  'Bank destination requests must use the existing email service'
);
assert.ok(
  settlementsRoute.includes("const contactEmail = String(client.contact_email || '').trim()"),
  'Bank emails must prefer the email linked to the billing account'
);
assert.ok(
  settlementsRoute.includes("sendEmail({}, {"),
  'Bank emails must use Polyizon central email transport instead of ISP email credentials'
);
assert.ok(
  settlementsRoute.includes("const subject = 'Bank Destination Request Received — Polyizon'"),
  'Receipt email subject must identify the Polyizon bank destination request'
);
assert.ok(
  settlementsRoute.includes('The review may take up to 24 hours.'),
  'Receipt email must state that review may take up to 24 hours'
);
assert.ok(
  settlementsRoute.includes('account_number_masked'),
  'Bank emails must use the masked account number rather than exposing the full bank account'
);
assert.ok(
  settlementsRoute.includes("eventType: 'settlement.direct_stk_request_email'"),
  'Receipt email delivery outcome must be auditable'
);
assert.ok(
  settlementsRoute.includes("router.get('/operator/requests'"),
  'Operator console must have a bank destination request queue endpoint'
);
assert.ok(
  settlementsRoute.indexOf("router.get('/operator/requests'") < settlementsRoute.indexOf("router.get('/operator/:clientId'"),
  'Fixed operator request queue route must be declared before the clientId parameter route'
);
assert.ok(
  settlementsRoute.includes("permissions.length === 0 || permissions.includes('admins')"),
  'Legacy billing account owners without an explicit permissions array must be able to submit bank requests'
);
assert.ok(
  settlementsRoute.includes("current.verification_status !== 'pending'"),
  'Operator must not approve a bank destination request twice'
);
assert.ok(
  settlementsRoute.includes('expected_updated_at'),
  'Operator approvals must protect against approving a stale bank destination request'
);
assert.ok(
  settlementsRoute.includes("const subject = 'Bank Destination Approved — Polyizon'"),
  'Approved bank destination requests must trigger a Polyizon approval email'
);
assert.ok(
  settlementsRoute.includes("eventType: 'settlement.direct_stk_approval_email'"),
  'Approval email delivery outcome must be auditable'
);

console.log('Direct bank STK tests passed');
