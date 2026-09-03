const assert = require('assert');

const communicationRoutes = require('../src/routes/subscriberCommunications');

const { normalizePhone, whatsappConfigured } = communicationRoutes._test;

assert.strictEqual(normalizePhone('0115 472 728'), '254115472728');
assert.strictEqual(normalizePhone('0712-345-678'), '254712345678');
assert.strictEqual(normalizePhone('712345678'), '254712345678');
assert.strictEqual(normalizePhone('+254 712 345 678'), '254712345678');
assert.strictEqual(normalizePhone(''), '');

assert.strictEqual(
  whatsappConfigured({
    connection_provider: 'meta',
    meta_phone_number_id: '1234',
    meta_access_token: 'token',
  }),
  true
);
assert.strictEqual(
  whatsappConfigured({
    connection_provider: 'meta',
    meta_phone_number_id: '1234',
    meta_access_token: '',
  }),
  false
);

const originalUrl = process.env.EVOLUTION_API_URL;
const originalKey = process.env.EVOLUTION_API_KEY;
process.env.EVOLUTION_API_URL = 'https://evolution.test';
process.env.EVOLUTION_API_KEY = 'ci-test-key';

assert.strictEqual(
  whatsappConfigured({
    connection_provider: 'evolution',
    evolution_instance_name: 'primary-instance',
  }),
  true
);
assert.strictEqual(
  whatsappConfigured({
    connection_provider: 'evolution',
    evolution_instance_name: '',
  }),
  false
);

if (originalUrl === undefined) delete process.env.EVOLUTION_API_URL;
else process.env.EVOLUTION_API_URL = originalUrl;
if (originalKey === undefined) delete process.env.EVOLUTION_API_KEY;
else process.env.EVOLUTION_API_KEY = originalKey;

console.log('Subscriber communication helper tests passed.');
