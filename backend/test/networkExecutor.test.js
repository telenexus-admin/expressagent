const assert = require('assert');
const {
  ACTION_SUPPORT,
  EXECUTION_ENABLED,
  actionSupport,
  approvalPolicy,
  executionFeatureState,
  planSeal,
  redact,
  resolveSnapshotArgs,
  rowMatches,
} = require('../src/services/networkExecutor');
const { buildOnboardingScript } = require('../src/services/onePasteOnboarding');

function samplePlan(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001', client_id: 7, router_id: 9,
    action_type: 'restart_interface', action_version: 1, risk_level: 'high',
    parameters: { interface: 'ether2-LAN' },
    command_preview: [{ phase: 'change', path: '/interface/enable', args: {}, selector: { name: 'ether2-LAN' } }],
    rollback_preview: [{ phase: 'rollback', path: '/interface/enable', args: {}, selector: { name: 'ether2-LAN' } }],
    verification: ['Interface running'], plan_fingerprint: 'a'.repeat(64),
    future_approval: { required: true, approvals: 1 }, ...overrides,
  };
}

function run() {
  assert.strictEqual(EXECUTION_ENABLED, false, 'Production-safe default must be disabled');
  assert.strictEqual(executionFeatureState().approval_required, true);
  assert.strictEqual(executionFeatureState().dedicated_credentials_required, true);
  assert.ok(Object.keys(ACTION_SUPPORT).length >= 15);
  assert.strictEqual(actionSupport('restart_interface').supported, true);
  assert.strictEqual(actionSupport('change_default_route').supported, false);
  assert.match(actionSupport('change_default_route').reason, /rollback watchdog/i);
  assert.strictEqual(actionSupport('update_radius_endpoint').supported, false);
  assert.match(actionSupport('update_radius_endpoint').reason, /secret-vault/i);

  assert.strictEqual(approvalPolicy(samplePlan()).approvals_required, 1);
  const critical = approvalPolicy(samplePlan({ risk_level: 'critical', future_approval: { approvals: 2 } }));
  assert.strictEqual(critical.approvals_required, 2);
  assert.strictEqual(critical.requester_may_approve, false);

  const seal = planSeal(samplePlan());
  assert.strictEqual(seal.length, 64);
  assert.notStrictEqual(seal, planSeal(samplePlan({ parameters: { interface: 'ether3' } })));
  assert.notStrictEqual(seal, planSeal(samplePlan({ command_preview: [{ phase: 'change', path: '/system/reboot' }] })));

  assert.deepStrictEqual(redact({ username: 'nexa', password: 'secret', nested: { private_key: 'key', value: 3 } }),
    { username: 'nexa', password: '[redacted]', nested: { private_key: '[redacted]', value: 3 } });
  assert.strictEqual(rowMatches({ '.id': '*1', name: 'ether1', comment: 'WAN' }, { name: 'ether1' }), true);
  assert.strictEqual(rowMatches({ '.id': '*1', name: 'ether1', comment: 'WAN' }, { comment_or_id: '*1' }), true);
  assert.strictEqual(rowMatches({ '.id': '*1', name: 'ether1' }, { name: 'ether2' }), false);
  const restored = resolveSnapshotArgs({ 'use-radius': '{{snapshot.ppp_aaa.use-radius}}' }, {
    '/ppp/aaa/print': [{ 'use-radius': 'no' }],
  });
  assert.deepStrictEqual(restored, { 'use-radius': 'no' });
  assert.throws(() => resolveSnapshotArgs({ value: '{{snapshot.queue.max-limit}}' }, {}), /snapshot value missing/);

  const onboarding = buildOnboardingScript({
    routerName: 'Synthetic', apiPassword: 'readonly-password', executorPassword: 'executor-password-123456',
    tunnelIp: '10.77.0.240', callbackToken: 'synthetic-token', portalUrl: 'https://example.test/hotspot?token=test',
  });
  assert.ok(onboarding.includes('name=nexa-readonly policy=read,test,api'));
  assert.ok(onboarding.includes('name=nexa-executor policy=read,write,test,api'));
  assert.ok(onboarding.includes(':local nexaExecutorPassword "executor-password-123456"'));
  assert.ok(!onboarding.includes('`n'), 'RouterOS script contains a literal PowerShell newline marker');

  console.log('Network Executor policy, seal, redaction, support gates, selectors, and snapshot rollback tests passed.');
}

run();
