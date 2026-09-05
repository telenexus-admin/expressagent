const assert = require('assert');

process.env.DARAJA_CONSUMER_KEY = 'consumer-key';
process.env.DARAJA_CONSUMER_SECRET = 'consumer-secret';
process.env.DARAJA_SHORTCODE = '4329173';
process.env.DARAJA_ENVIRONMENT = 'production';
process.env.DARAJA_B2B_ENABLED = 'false';
process.env.DARAJA_B2B_INITIATOR = '';
process.env.DARAJA_B2B_SECURITY_CREDENTIAL = '';

const {
  BANK_PAYBILL_RAILS,
  buildDarajaB2BPayload,
  darajaB2BReady,
  loadDarajaB2BConfig,
  publicDarajaB2BStatus,
  resolveBankPaybillDestination,
} = require('../src/services/darajaBankSettlement');

assert.strictEqual(BANK_PAYBILL_RAILS.kcb.paybill, '522522');
assert.strictEqual(BANK_PAYBILL_RAILS.coop.paybill, '400200');
assert.strictEqual(BANK_PAYBILL_RAILS.equity.paybill, '247247');
assert.strictEqual(BANK_PAYBILL_RAILS.ncba.paybill, '880100');

let config = loadDarajaB2BConfig();
assert.strictEqual(config.shortcode, '4329173');
assert.strictEqual(config.configured, false);
assert.strictEqual(darajaB2BReady(config), false);

let status = publicDarajaB2BStatus(config);
assert.strictEqual(status.ready, false);
assert.strictEqual(status.has_initiator, false);
assert.strictEqual(status.has_security_credential, false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'consumerSecret'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'securityCredential'), false);

const kcb = resolveBankPaybillDestination({
  institution_code: 'kcb',
  account_number: '1234567890',
  collection_reference: '',
});
assert.deepStrictEqual(kcb, {
  institution_code: 'kcb',
  institution_name: 'KCB Bank Kenya',
  party_b: '522522',
  receiver_identifier_type: '4',
  command_id: 'BusinessPayBill',
  account_reference: '1234567890',
});

const coop = resolveBankPaybillDestination({ institution_code: 'coop', account_number: '01112345678900' });
assert.strictEqual(coop.party_b, '400200');
assert.strictEqual(coop.account_reference, '01112345678900');

const equity = resolveBankPaybillDestination({ institution_code: 'equity', account_number: '0123456789012' });
assert.strictEqual(equity.party_b, '247247');
assert.strictEqual(equity.account_reference, '0123456789012');

const ncba = resolveBankPaybillDestination({
  institution_code: 'ncba',
  account_number: '1234567890',
  collection_reference: 'KEINET',
});
assert.strictEqual(ncba.party_b, '880100');
assert.strictEqual(ncba.account_reference, 'KEINET');

assert.throws(
  () => resolveBankPaybillDestination({ institution_code: 'ncba', account_number: '1234567890', collection_reference: '' }),
  (error) => error.code === 'NCBA_TILL_REFERENCE_REQUIRED'
);

config = {
  ...config,
  enabled: true,
  configured: true,
  initiator: 'polyizonapi',
  securityCredential: 'encrypted-security-credential',
};
const payload = buildDarajaB2BPayload({
  config,
  destination: kcb,
  amount: 1500,
  remarks: 'ISP settlement',
  queueTimeoutUrl: 'https://billing.polyizon.tech/api/public/mpesa/b2b/timeout',
  resultUrl: 'https://billing.polyizon.tech/api/public/mpesa/b2b/result',
});
assert.strictEqual(payload.CommandID, 'BusinessPayBill');
assert.strictEqual(payload.PartyA, '4329173');
assert.strictEqual(payload.PartyB, '522522');
assert.strictEqual(payload.AccountReference, '1234567890');
assert.strictEqual(payload.Amount, 1500);
assert.strictEqual(payload.SenderIdentifierType, '4');
assert.strictEqual(payload.RecieverIdentifierType, '4');

console.log('Daraja B2B bank settlement tests passed');
