const assert = require('assert');
const { compileBillingBlueprint, networkFromGateway, resourceConflicts } = require('../src/services/routerBillingBlueprint');

const capability = { adapter_version: 'routeros-v7.1', blockers: [] };
const plan = compileBillingBlueprint({
  desired_services: {
    pppoe: true,
    hotspot: true,
    vlan_id: 220,
    service_interface: 'bridge-subscribers',
    wan_interface_list: 'WAN',
  },
  capability_profile: capability,
  current_config: {},
  nas_identifier: 'nexa-1-2-edge',
  nas_ip: '10.77.0.2',
  radius_host: '10.78.0.2',
});
assert.strictEqual(plan.execution_ready, true);
assert.deepStrictEqual(plan.stages.map((stage) => stage.name), [
  'checkpoint', 'subscriber_vlan', 'radius_registration', 'hotspot_network',
  'dns_and_portal', 'hotspot_service', 'pppoe_service', 'radius_on_router',
  'subscriber_internet', 'activate_after_validation',
]);
const operations = plan.stages.flatMap((stage) => stage.operations);
for (const path of [
  '/ip/address/add', '/ip/pool/add', '/ip/dhcp-server/network/add',
  '/ip/dhcp-server/add', '/ip/dns/set', '/ip/firewall/filter/add',
  'nexa://file/ensure-directory', 'nexa://file/write', '/ip/hotspot/profile/add', '/ip/hotspot/add',
  '/ip/hotspot/walled-garden/add', '/ppp/profile/add',
  '/interface/pppoe-server/server/add', '/radius/add', '/ppp/aaa/set',
  '/ip/firewall/nat/add',
]) assert.ok(operations.some((item) => item.path === path), 'missing ' + path);
assert.strictEqual(operations.filter((item) => item.path === 'nexa://file/write').length, 3);
assert.ok(operations.some((item) => item.secret_ref === 'router-radius-secret'));
assert.ok(!JSON.stringify(plan).includes('shared_secret'));
const staged = operations.filter((item) => ['/ip/dhcp-server/add', '/ip/hotspot/add', '/interface/pppoe-server/server/add'].includes(item.path));
assert.ok(staged.every((item) => item.args.disabled === 'yes'));
const activation = plan.stages.find((stage) => stage.name === 'activate_after_validation').operations;
assert.strictEqual(activation.length, 3);
assert.ok(activation.every((item) => item.args.disabled === 'no'));
const dnsRules = operations.filter((item) => item.path === '/ip/firewall/filter/add' && item.args['dst-port'] === '53' && item.args['src-address']);
assert.strictEqual(dnsRules.length, 2);
assert.ok(dnsRules.every((item) => item.args['src-address'] === '10.20.0.0/24'));
const publicDnsDrops = operations.filter((item) => item.args?.['in-interface-list'] === 'WAN' && item.args?.action === 'drop');
assert.strictEqual(publicDnsDrops.length, 2);
assert.ok(operations.filter((item) => ['/ip/hotspot/add', '/interface/pppoe-server/server/add'].includes(item.path)).every((item) => item.args.interface === 'nexa-subscriber-vlan-220'));
assert.ok(plan.rollback_stages[0].operations.some((item) => item.args.comment_prefix === 'NEXA managed'));
assert.strictEqual(networkFromGateway('10.40.0.1/24'), '10.40.0.0/24');

const current = { pools: [{ name: 'NEXA-HOTSPOT-POOL', comment: 'customer resource' }] };
assert.strictEqual(resourceConflicts(current).length, 1);
const blocked = compileBillingBlueprint({
  desired_services: { hotspot: true, pppoe: false },
  capability_profile: capability,
  current_config: current,
  nas_identifier: 'nexa-1-2-edge',
  nas_ip: '10.77.0.2',
});
assert.strictEqual(blocked.execution_ready, false);
assert.strictEqual(blocked.conflict_report.status, 'blocked');
assert.strictEqual(blocked.stages.length, 0);
assert.throws(() => compileBillingBlueprint({
  desired_services: { hotspot: false, pppoe: false },
  capability_profile: capability,
}), /At least one subscriber service/);
assert.throws(() => compileBillingBlueprint({
  desired_services: { hotspot: true },
  capability_profile: { blockers: ['unsupported'] },
}), /Compatibility blockers/);
console.log('Complete RouterOS billing blueprint tests passed.');