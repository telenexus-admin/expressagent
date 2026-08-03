const assert = require('assert');
const {
  getCapabilityResponse,
  isMikrotikOnboardingQuestion,
} = require('../src/services/nexaCapabilities');

assert.equal(isMikrotikOnboardingQuestion('Can you configure a MikroTik?'), true);
assert.equal(isMikrotikOnboardingQuestion('Add my billing system to this router'), true);
assert.equal(isMikrotikOnboardingQuestion('How are collections performing?'), false);

const result = getCapabilityResponse('I want you to add a billing system in my MikroTik');
assert.match(result.answer, /Yes\. I can onboard and configure your MikroTik/);
assert.match(result.answer, /WireGuard/);
assert.match(result.answer, /RADIUS, PPPoE and Hotspot/);
assert.equal(result.actions[0].type, 'open_router_onboarding');
assert.equal(result.sources[0].id, 'mikrotik_secure_onboarding');
assert.equal(getCapabilityResponse('Which invoices are unpaid?'), null);

console.log('Nexa platform capability routing tests passed.');
