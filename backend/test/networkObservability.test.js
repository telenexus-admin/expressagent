const assert = require('assert');
const {
  READ_ONLY_SOURCES,
  buildMetrics,
  buildTopology,
  redactRow,
  scoreMetric,
} = require('../src/services/networkObservability');

function run() {
  assert.ok(READ_ONLY_SOURCES.every(([, path]) => path.endsWith('/print')));

  const redacted = redactRow({ name: 'router', password: 'hidden', 'private-key': 'hidden', token: 'hidden', address: '10.0.0.1' });
  assert.deepStrictEqual(redacted, { name: 'router', address: '10.0.0.1' });

  const router = { id: 8, client_id: 22, name: 'Core Router', last_version: '7.20' };
  const facts = {
    identity: [{ name: 'CCR-Core' }],
    resource: [{ version: '7.20', 'cpu-load': '21', 'free-memory': '750', 'total-memory': '1000' }],
    interfaces: [
      { name: 'ether1-WAN', type: 'ether', running: 'true', disabled: 'false', 'mac-address': '00:11:22:33:44:55' },
      { name: 'bridge-LAN', type: 'bridge', running: 'true', disabled: 'false' },
    ],
    bridge_ports: [{ bridge: 'bridge-LAN', interface: 'ether2', pvid: '20' }],
    vlans: [{ name: 'customers-vlan', 'vlan-id': '20', interface: 'bridge-LAN' }],
    neighbors: [{ identity: 'Tower-Switch', address: '10.10.0.2', interface: 'ether1-WAN', platform: 'MikroTik' }],
    routes: [{ 'dst-address': '0.0.0.0/0', gateway: '10.10.0.1', active: 'true', distance: '1' }],
    wireguard_peers: [{ 'public-key': 'never-store-this-key', comment: 'Nexa tunnel', 'allowed-address': '10.77.0.1/32' }],
    ospf_neighbors: [{ 'remote-address': '10.10.0.3', state: 'Full' }],
    bgp_sessions: [],
    ppp_active: [{ name: 'client-1' }, { name: 'client-2' }],
    hotspot_active: [{ user: 'voucher-1' }],
    dhcp_leases: [{ status: 'bound' }],
    interface_traffic: {
      'ether1-WAN': { 'rx-bits-per-second': '12000000', 'tx-bits-per-second': '3500000' },
    },
  };

  const topology = buildTopology(router, facts);
  assert.ok(topology.nodes.some((node) => node.node_type === 'upstream_gateway'));
  assert.ok(topology.nodes.some((node) => node.display_name === 'Tower-Switch'));
  assert.ok(topology.edges.some((edge) => edge.relationship === 'uses_upstream'));
  assert.ok(topology.edges.some((edge) => edge.relationship === 'connected_to'));
  assert.ok(!JSON.stringify(topology).includes('never-store-this-key'));

  const metrics = buildMetrics(router, facts, new Date('2026-08-02T10:00:00Z'));
  assert.strictEqual(metrics.find((item) => item.metric_name === 'router.cpu_percent').value, 21);
  assert.strictEqual(metrics.find((item) => item.metric_name === 'router.memory_used_percent').value, 25);
  assert.strictEqual(metrics.find((item) => item.metric_name === 'sessions.pppoe_active').value, 2);
  assert.strictEqual(metrics.find((item) => item.metric_name === 'interface.rx_bps').value, 12000000);

  const baseline = { sample_count: 120, mean_value: 100, stddev_value: 5, p50_value: 100, p95_value: 108 };
  assert.strictEqual(scoreMetric({ value: 108 }, baseline), null);
  const warning = scoreMetric({ value: 130 }, baseline);
  assert.strictEqual(warning.severity, 'warning');
  assert.strictEqual(warning.deviation_score, 6);
  const critical = scoreMetric({ value: 145 }, baseline);
  assert.strictEqual(critical.severity, 'critical');
  assert.strictEqual(scoreMetric({ value: 500 }, { ...baseline, sample_count: 3 }), null);

  console.log('Network Agent topology, telemetry, redaction, and baseline scoring tests passed.');
}

run();
