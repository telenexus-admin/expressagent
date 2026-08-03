const assert = require('assert');
const {
  FORBIDDEN_PATHS,
  buildActionPlan,
  getActionCatalog,
  suggestedActionForText,
  validateOperation,
} = require('../src/services/networkAutomation');

function mustReject(fn, pattern) {
  assert.throws(fn, pattern);
}

function run() {
  const catalog = getActionCatalog();
  assert.ok(catalog.length >= 15, 'Expected the complete Phase 2 action catalogue');
  assert.ok(catalog.every((item) => item.phase_2_mode === 'shadow' && item.execution_allowed === false));

  for (const type of ['diagnose_router_health', 'diagnose_uplink', 'diagnose_radius_access']) {
    const params = type === 'diagnose_uplink' ? { interface: 'ether1-WAN', gateway: '192.0.2.1' } : {};
    const plan = buildActionPlan(type, params, { routerId: 10 });
    assert.strictEqual(plan.mode, 'shadow');
    assert.strictEqual(plan.execution_allowed, false);
    assert.strictEqual(plan.commands_executed, false);
    assert.ok(plan.command_preview.every((item) => item.phase === 'inspect'));
  }

  const restart = buildActionPlan('restart_interface', { interface: 'ether2-LAN' }, { routerId: 10 });
  assert.ok(restart.command_preview.some((item) => item.phase === 'change'));
  assert.ok(restart.rollback_preview.length > 0);
  assert.strictEqual(restart.future_approval.required, true);
  assert.strictEqual(restart.execution_allowed, false);

  const route = buildActionPlan('change_default_route', {
    route_id: '*1', gateway: '192.0.2.254', distance: 1,
  }, { routerId: 10 });
  assert.strictEqual(route.risk_level, 'critical');
  assert.strictEqual(route.future_approval.approvals, 2);
  assert.strictEqual(route.rollback_guarantee, 'full');

  const radius = buildActionPlan('update_radius_endpoint', {
    radius_id: '*3', address: '192.0.2.20', authentication_port: 1812,
    accounting_port: 1813, secret_ref: 'secret:tenant-radius-primary',
  }, { routerId: 10 });
  assert.ok(JSON.stringify(radius).includes('secret:tenant-radius-primary'));
  assert.ok(!JSON.stringify(radius).includes('plaintext-password'));

  mustReject(() => buildActionPlan('restart_interface', {
    interface: 'ether1; /system reset-configuration',
  }, { routerId: 10 }), /unsupported RouterOS characters/);
  mustReject(() => buildActionPlan('diagnose_router_health', { raw_command: '/system/reboot' }, { routerId: 10 }), /Unsupported parameters/);
  mustReject(() => buildActionPlan('change_default_route', {
    route_id: '*1', gateway: 'not-an-ip', distance: 1,
  }, { routerId: 10 }), /valid IPv4 or IPv6/);
  mustReject(() => buildActionPlan('update_radius_endpoint', {
    radius_id: '*3', address: '192.0.2.20', authentication_port: 1812,
    accounting_port: 1813, secret_ref: 'plaintext-password',
  }, { routerId: 10 }), /encrypted secret/);
  for (const path of FORBIDDEN_PATHS) {
    mustReject(() => validateOperation({ phase: 'change', path, args: {} }), /Forbidden RouterOS operation|Unsafe RouterOS/);
  }

  assert.strictEqual(suggestedActionForText('RADIUS authentication timeouts'), 'diagnose_radius_access');
  assert.strictEqual(suggestedActionForText('WAN packet loss at gateway'), 'diagnose_uplink');
  assert.strictEqual(suggestedActionForText('CPU overload'), 'diagnose_resource_pressure');
  assert.strictEqual(suggestedActionForText('failed login attack'), 'diagnose_security_exposure');
  console.log(`Network Automation ${catalog.length}-action catalogue, injection rejection, rollback metadata, and shadow-only safety tests passed.`);
}

run();
