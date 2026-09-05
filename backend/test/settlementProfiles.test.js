const assert = require('assert');

process.env.SETTLEMENT_ENCRYPTION_KEY = '22'.repeat(32);

const {
  decryptValue,
  encryptValue,
  institution,
  publicInstitutions,
} = require('../src/services/settlementProfiles');

function run() {
  const banks = publicInstitutions();
  assert.deepStrictEqual(banks.map((bank) => bank.code), ['ncba', 'kcb', 'coop', 'equity']);
  for (const bank of banks) {
    assert.strictEqual(bank.type, 'bank');
    assert.strictEqual(bank.settlement_capability, 'bank_collection');
    assert.ok(bank.collection_model);
  }

  assert.strictEqual(institution('NCBA').code, 'ncba');
  assert.strictEqual(institution('coop').name, 'Co-operative Bank of Kenya');
  assert.strictEqual(institution('unknown'), null);

  const secret = '01234567890123';
  const encrypted = encryptValue(secret);
  assert.ok(encrypted);
  assert.ok(!encrypted.includes(secret));
  assert.strictEqual(decryptValue(encrypted), secret);
  assert.notStrictEqual(encryptValue(secret), encrypted, 'AES-GCM should use a fresh IV');

  console.log('Settlement profile unit tests passed');
}

run();
