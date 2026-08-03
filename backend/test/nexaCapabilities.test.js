const assert = require('assert');
const {
  getCapabilityResponse,
  isMikrotikOnboardingQuestion,
} = require('../src/services/nexaCapabilities');

assert.equal(isMikrotikOnboardingQuestion('Can you configure a MikroTik?'), true);
assert.equal(isMikrotikOnboardingQuestion('Add my billing system to this router'), true);
assert.equal(isMikrotikOnboardingQuestion('How are collections performing?'), false);

for (const question of [
  'Can you configure a MikroTik?',
  'I want you to add a billing system in my MikroTik',
]) {
  const result = getCapabilityResponse(question);
  assert.match(result.answer, /What name should I call this MikroTik/);
  assert.equal(result.flow.type, 'mikrotik_onboarding');
  assert.equal(result.flow.step, 'router_name');
  assert.equal(result.actions, undefined);
  assert.equal(result.sources[0].id, 'mikrotik_secure_onboarding');
}
assert.equal(getCapabilityResponse('Which invoices are unpaid?'), null);

console.log('Nexa conversational MikroTik onboarding routing tests passed.');
