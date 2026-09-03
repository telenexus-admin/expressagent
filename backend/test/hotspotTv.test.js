const assert = require('assert');
const { tvPaymentMetadata } = require('../src/services/hotspotTv');

const valid = tvPaymentMetadata({
  amount: 500,
  metadata: {
    purpose: 'hotspot_tv',
    tv_plan_id: 12,
    router_id: 3,
    mac: 'aa-bb-cc-dd-ee-ff',
    expected_amount: 500,
  },
});

assert(valid, 'valid TV payment metadata should be accepted');
assert.strictEqual(valid.plan_id, 12);
assert.strictEqual(valid.router_id, 3);
assert.strictEqual(valid.mac, 'AA:BB:CC:DD:EE:FF');
assert.strictEqual(valid.expected_amount, 500);

assert.strictEqual(tvPaymentMetadata({
  amount: 500,
  metadata: { purpose: 'hotspot', plan_id: 12, router_id: 3, mac: 'AA:BB:CC:DD:EE:FF' },
}), null, 'normal hotspot payments must not enter the TV fulfillment path');

assert.strictEqual(tvPaymentMetadata({
  amount: 500,
  metadata: { purpose: 'hotspot_tv', tv_plan_id: 12, router_id: 3, mac: 'not-a-mac' },
}), null, 'invalid MAC addresses must be rejected');

assert.strictEqual(tvPaymentMetadata({
  amount: 500,
  metadata: { purpose: 'hotspot_tv', tv_plan_id: 12, router_id: 0, mac: 'AA:BB:CC:DD:EE:FF' },
}), null, 'TV payments need a concrete MikroTik router');

const stringMetadata = tvPaymentMetadata({
  amount: 200,
  metadata: JSON.stringify({
    purpose: 'hotspot_tv',
    tv_plan_id: 8,
    router_id: 4,
    mac: '0011.2233.4455',
  }),
});
assert.strictEqual(stringMetadata.mac, '00:11:22:33:44:55');
assert.strictEqual(stringMetadata.expected_amount, 200);

console.log('Hotspot TV metadata tests passed.');
