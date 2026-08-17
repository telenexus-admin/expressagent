const db = require('../db');
const {
  connectRouter,
  ensureMikrotikTables,
  getRouter,
  listRouters,
} = require('./mikrotik');

const MAX_DISCOVERED_PER_ROUTER = 12;
const MAX_TRAFFIC_INTERFACES = 12;

function text(value) {
  return String(value ?? '').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function truthy(value) {
  return value === true || ['true', 'yes', '1', 'running', 'up'].includes(text(value).toLowerCase());
}

function mbps(bits) {
  return Number((number(bits) / 1000000).toFixed(2));
}

function memoryPercent(resource = {}) {
  const total = number(resource['total-memory']);
  const free = number(resource['free-memory']);
  if (!total) return null;
  return Number((((total - free) / total) * 100).toFixed(1));
}

function inferRole(name, explicit = '') {
  const saved = text(explicit).toLowerCase();
  if (['core', 'edge', 'distribution', 'access', 'olt', 'switch', 'ap'].includes(saved)) return saved;
  const value = text(name).toLowerCase();
  if (/\b(core|edge|gateway|border)\b/.test(value)) return 'core';
  if (/\b(distribution|dist|pop|aggregation|agg)\b/.test(value)) return 'distribution';
  if (/\b(olt|pon)\b/.test(value)) return 'olt';
  if (/\b(switch|crs|css)\b/.test(value)) return 'switch';
  if (/\b(ap|access point|wireless|sector|tower)\b/.test(value)) return 'ap';
  return 'access';
}

function roleRank(role) {
  return {
    internet: 0,
    core: 1,
    edge: 1,
    distribution: 2,
    olt: 3,
    switch: 3,
    access: 4,
    ap: 4,
    discovered: 5,
    service: 6,
  }[role] ?? 4;
}

function classifyNeighbor(row = {}) {
  const haystack = `${row.identity || ''} ${row.platform || ''} ${row.board || ''} ${row['board-name'] || ''} ${row['system-description'] || ''}`.toLowerCase();
  if (/\b(olt|gpon|epon|xgpon|huawei ma|zte c3|zte c6)\b/.test(haystack)) return 'olt';
  if (/\b(crs|css|switch|catalyst|aruba|hp procurve)\b/.test(haystack)) return 'switch';
  if (/\b(ubiquiti|airmax|rocket|nanostation|litebeam|powerbeam|access point|wireless|sector|cambium)\b/.test(haystack)) return 'ap';
  if (/\b(routeros|mikrotik|routerboard|router|ccr|rb\d|hex|hap)\b/.test(haystack)) return 'access';
  return 'discovered';
}

function neighborKey(row = {}) {
  return normalize(row['mac-address'] || row.identity || row.address || row['interface-name'] || row.interface);
}

function interfaceCandidate(row = {}) {
  const name = text(row.name);
  const type = text(row.type).toLowerCase();
  return /^(ether|sfp|combo|bridge|bonding|vlan|lte|wifi|wlan)/i.test(name) ||
    ['ether', 'bridge', 'bonding', 'vlan', 'lte', 'wifi', 'wlan'].includes(type);
}

function chooseWan(interfaces = []) {
  const usable = interfaces.filter((row) => !row.disabled);
  const named = usable.find((row) => /\b(wan|internet|uplink|provider|transit|backhaul)\b/i.test(`${row.name} ${row.comment || ''}`));
  if (named) return named;
  const running = usable
    .filter((row) => row.running)
    .sort((a, b) => Number(b.total_mbps || 0) - Number(a.total_mbps || 0));
  return running[0] || usable[0] || null;
}

async function ensureTopologySchema() {
  await ensureMikrotikTables();
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_latitude NUMERIC`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_longitude NUMERIC`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_site_label VARCHAR(180)`);
  await db.query(`ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_role VARCHAR(40)`);
}

async function topologyRouterRows(clientId) {
  await ensureTopologySchema();
  const result = await db.query(
    `SELECT id, name, host, wireguard_tunnel_ip, is_active, last_status, last_error,
            last_identity, last_version, last_uptime, last_seen_at,
            topology_latitude, topology_longitude, topology_site_label, topology_role
     FROM mikrotik_routers
     WHERE client_id = $1
     ORDER BY created_at ASC`,
    [clientId]
  );
  return result.rows;
}

async function monitorInterfaceTraffic(client, interfaces) {
  const candidates = interfaces
    .filter((row) => row.running && !row.disabled && interfaceCandidate(row))
    .slice(0, MAX_TRAFFIC_INTERFACES);

  for (const row of candidates) {
    const sample = (await client.command('/interface/monitor-traffic', {
      interface: row.name,
      once: '',
    }).catch(() => []))[0] || {};
    row.rx_bps = number(sample['rx-bits-per-second']);
    row.tx_bps = number(sample['tx-bits-per-second']);
    row.rx_mbps = mbps(row.rx_bps);
    row.tx_mbps = mbps(row.tx_bps);
    row.total_mbps = Number((row.rx_mbps + row.tx_mbps).toFixed(2));
  }
  return interfaces;
}

async function readRouterTopology(clientId, routerMeta) {
  const config = await getRouter(clientId, routerMeta.id, { includePassword: true });
  if (!config || config.is_active === false) {
    return {
      ok: false,
      router: routerMeta,
      error: 'Router is inactive',
      neighbors: [],
      interfaces: [],
    };
  }

  let client = null;
  try {
    client = await connectRouter(config);
    const identityRows = await client.command('/system/identity/print').catch(() => []);
    const resourceRows = await client.command('/system/resource/print').catch(() => []);
    const interfaceRows = await client.command('/interface/print').catch(() => []);
    const neighborRows = await client.command('/ip/neighbor/print').catch(() => []);
    const pppRows = config.features?.ppp_active === false
      ? []
      : await client.command('/ppp/active/print').catch(() => []);
    const hotspotRows = config.features?.hotspot_active === false
      ? []
      : await client.command('/ip/hotspot/active/print').catch(() => []);

    const interfaces = interfaceRows
      .filter(interfaceCandidate)
      .map((row) => ({
        name: text(row.name),
        type: text(row.type),
        comment: text(row.comment),
        running: truthy(row.running),
        disabled: truthy(row.disabled),
        link_speed: text(row['actual-speed'] || row.speed || row['link-speed']),
        rx_bps: 0,
        tx_bps: 0,
        rx_mbps: 0,
        tx_mbps: 0,
        total_mbps: 0,
      }));

    await monitorInterfaceTraffic(client, interfaces);
    const wan = chooseWan(interfaces);
    const resource = resourceRows[0] || {};
    const identity = text(identityRows[0]?.name || routerMeta.last_identity || routerMeta.name);
    const role = inferRole(identity || routerMeta.name, routerMeta.topology_role);

    const neighbors = neighborRows
      .filter((row) => row && (row.identity || row.address || row['mac-address']))
      .slice(0, 80)
      .map((row) => ({
        identity: text(row.identity),
        address: text(row.address || row['address4'] || row['address6']),
        mac_address: text(row['mac-address']),
        platform: text(row.platform || row.board || row['board-name']),
        version: text(row.version),
        uptime: text(row.uptime),
        local_interface: text(row.interface),
        remote_interface: text(row['interface-name']),
        discovered_type: classifyNeighbor(row),
      }));

    return {
      ok: true,
      router: routerMeta,
      identity,
      role,
      version: text(resource.version || routerMeta.last_version),
      board_name: text(resource['board-name']),
      uptime: text(resource.uptime || routerMeta.last_uptime),
      cpu_load: resource['cpu-load'] === undefined ? null : number(resource['cpu-load']),
      memory_used_percent: memoryPercent(resource),
      pppoe: pppRows.length,
      hotspot: hotspotRows.length,
      interfaces,
      neighbors,
      wan,
      checked_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      router: routerMeta,
      identity: text(routerMeta.last_identity || routerMeta.name),
      role: inferRole(routerMeta.last_identity || routerMeta.name, routerMeta.topology_role),
      version: text(routerMeta.last_version),
      uptime: text(routerMeta.last_uptime),
      cpu_load: null,
      memory_used_percent: null,
      pppoe: 0,
      hotspot: 0,
      interfaces: [],
      neighbors: [],
      wan: null,
      error: error.message || 'Live topology read failed',
      checked_at: new Date().toISOString(),
    };
  } finally {
    if (client) client.close();
  }
}

function interfaceFor(snapshot, name) {
  const target = text(name).toLowerCase();
  return snapshot.interfaces.find((row) => text(row.name).toLowerCase() === target) || null;
}

function linkState(sourceSnapshot, localInterface) {
  const iface = interfaceFor(sourceSnapshot, localInterface);
  if (!iface) return { status: sourceSnapshot.ok ? 'unknown' : 'down', traffic_mbps: 0, link_speed: '' };
  return {
    status: iface.running ? 'up' : 'down',
    traffic_mbps: Number(iface.total_mbps || 0),
    download_mbps: Number(iface.rx_mbps || 0),
    upload_mbps: Number(iface.tx_mbps || 0),
    link_speed: iface.link_speed || '',
  };
}

function configuredMatch(snapshot, neighbor, snapshots) {
  const neighborIdentity = normalize(neighbor.identity);
  const neighborAddress = text(neighbor.address);
  return snapshots.find((candidate) => {
    if (candidate.router.id === snapshot.router.id) return false;
    const identities = [
      candidate.identity,
      candidate.router.name,
      candidate.router.last_identity,
    ].map(normalize).filter(Boolean);
    const addresses = [
      candidate.router.host,
      candidate.router.wireguard_tunnel_ip,
    ].map(text).filter(Boolean);
    return (neighborIdentity && identities.includes(neighborIdentity)) ||
      (neighborAddress && addresses.includes(neighborAddress));
  }) || null;
}

function topologyNodeFromRouter(snapshot) {
  const router = snapshot.router;
  return {
    id: `router:${router.id}`,
    kind: 'router',
    role: snapshot.role,
    label: snapshot.identity || router.name,
    status: snapshot.ok ? 'online' : 'offline',
    health: snapshot.ok
      ? Math.max(0, Math.min(100, 100 - Math.max(0, number(snapshot.cpu_load) - 60) * 0.7 - Math.max(0, number(snapshot.memory_used_percent) - 75) * 0.4))
      : 0,
    router_id: router.id,
    host: router.host,
    tunnel_ip: router.wireguard_tunnel_ip || '',
    version: snapshot.version,
    board_name: snapshot.board_name,
    uptime: snapshot.uptime,
    cpu_load: snapshot.cpu_load,
    memory_used_percent: snapshot.memory_used_percent,
    active_pppoe: snapshot.pppoe,
    active_hotspot: snapshot.hotspot,
    wan_interface: snapshot.wan?.name || '',
    wan_link_speed: snapshot.wan?.link_speed || '',
    wan_traffic_mbps: Number(snapshot.wan?.total_mbps || 0),
    site_label: router.topology_site_label || '',
    latitude: router.topology_latitude === null ? null : Number(router.topology_latitude),
    longitude: router.topology_longitude === null ? null : Number(router.topology_longitude),
    error: snapshot.error || router.last_error || '',
    checked_at: snapshot.checked_at,
  };
}

function serviceNode(routerNode, service, count) {
  return {
    id: `service:${routerNode.router_id}:${service}`,
    kind: 'service',
    role: 'service',
    service,
    label: service === 'pppoe' ? 'PPPoE subscribers' : 'Hotspot users',
    count: Number(count || 0),
    status: count > 0 ? 'online' : 'idle',
    parent_router_id: routerNode.router_id,
  };
}

async function getNetworkTopology(clientId) {
  const routers = await topologyRouterRows(clientId);
  const activeRouters = routers.filter((router) => router.is_active !== false);
  const snapshots = [];
  const concurrency = 3;

  for (let offset = 0; offset < activeRouters.length; offset += concurrency) {
    const batch = activeRouters.slice(offset, offset + concurrency);
    snapshots.push(...await Promise.all(batch.map((router) => readRouterTopology(clientId, router))));
  }

  const nodes = [{
    id: 'internet',
    kind: 'internet',
    role: 'internet',
    label: 'Internet',
    status: activeRouters.length ? 'online' : 'idle',
  }];
  const edges = [];
  const edgeKeys = new Set();
  const discoveredKeys = new Set();

  for (const snapshot of snapshots) {
    const routerNode = topologyNodeFromRouter(snapshot);
    nodes.push(routerNode);

    if (snapshot.pppoe > 0) nodes.push(serviceNode(routerNode, 'pppoe', snapshot.pppoe));
    if (snapshot.hotspot > 0) nodes.push(serviceNode(routerNode, 'hotspot', snapshot.hotspot));
  }

  const nodeByRouterId = new Map(nodes.filter((node) => node.kind === 'router').map((node) => [Number(node.router_id), node]));
  const linkedUpstream = new Set();

  for (const snapshot of snapshots) {
    const sourceId = `router:${snapshot.router.id}`;
    let discoveredCount = 0;

    for (const neighbor of snapshot.neighbors) {
      const configured = configuredMatch(snapshot, neighbor, snapshots);
      const link = linkState(snapshot, neighbor.local_interface);

      if (configured) {
        const a = nodeByRouterId.get(Number(snapshot.router.id));
        const b = nodeByRouterId.get(Number(configured.router.id));
        if (!a || !b) continue;
        const aRank = roleRank(a.role);
        const bRank = roleRank(b.role);
        const source = aRank < bRank ? a.id : bRank < aRank ? b.id : (a.id < b.id ? a.id : b.id);
        const target = source === a.id ? b.id : a.id;
        const key = [source, target].sort().join('|');
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        linkedUpstream.add(target);
        edges.push({
          id: `link:${source}:${target}`,
          source,
          target,
          kind: 'network',
          status: link.status,
          local_interface: neighbor.local_interface,
          remote_interface: neighbor.remote_interface,
          traffic_mbps: link.traffic_mbps,
          download_mbps: link.download_mbps || 0,
          upload_mbps: link.upload_mbps || 0,
          link_speed: link.link_speed,
          label: [neighbor.local_interface, link.link_speed].filter(Boolean).join(' · '),
        });
        continue;
      }

      if (discoveredCount >= MAX_DISCOVERED_PER_ROUTER) continue;
      const keyPart = neighborKey(neighbor);
      if (!keyPart) continue;
      const discoveredId = `discovered:${snapshot.router.id}:${keyPart}`;
      if (!discoveredKeys.has(discoveredId)) {
        discoveredKeys.add(discoveredId);
        discoveredCount += 1;
        nodes.push({
          id: discoveredId,
          kind: 'discovered',
          role: neighbor.discovered_type,
          label: neighbor.identity || neighbor.platform || neighbor.address || 'Discovered device',
          status: 'online',
          platform: neighbor.platform,
          version: neighbor.version,
          uptime: neighbor.uptime,
          address: neighbor.address,
          mac_address: neighbor.mac_address,
          local_interface: neighbor.local_interface,
          remote_interface: neighbor.remote_interface,
          parent_router_id: snapshot.router.id,
        });
      }
      const link = linkState(snapshot, neighbor.local_interface);
      const edgeKey = `${sourceId}|${discoveredId}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({
          id: `link:${sourceId}:${discoveredId}`,
          source: sourceId,
          target: discoveredId,
          kind: 'network',
          status: link.status,
          local_interface: neighbor.local_interface,
          remote_interface: neighbor.remote_interface,
          traffic_mbps: link.traffic_mbps,
          download_mbps: link.download_mbps || 0,
          upload_mbps: link.upload_mbps || 0,
          link_speed: link.link_speed,
          label: [neighbor.local_interface, link.link_speed].filter(Boolean).join(' · '),
        });
      }
    }

    const routerNode = nodeByRouterId.get(Number(snapshot.router.id));
    if (routerNode) {
      for (const service of ['pppoe', 'hotspot']) {
        const serviceId = `service:${snapshot.router.id}:${service}`;
        if (nodes.some((node) => node.id === serviceId)) {
          edges.push({
            id: `service-link:${snapshot.router.id}:${service}`,
            source: routerNode.id,
            target: serviceId,
            kind: 'service',
            status: snapshot.ok ? 'up' : 'down',
            traffic_mbps: 0,
            label: '',
          });
        }
      }
    }
  }

  for (const snapshot of snapshots) {
    const routerId = `router:${snapshot.router.id}`;
    const hasIncomingRouterLink = edges.some((edge) => edge.target === routerId && edge.source.startsWith('router:'));
    const role = inferRole(snapshot.identity || snapshot.router.name, snapshot.router.topology_role);
    if (!hasIncomingRouterLink && (snapshot.wan || ['core', 'edge'].includes(role))) {
      const wan = snapshot.wan || {};
      edges.push({
        id: `internet:${snapshot.router.id}`,
        source: 'internet',
        target: routerId,
        kind: 'internet',
        status: snapshot.ok && (!wan.name || wan.running) ? 'up' : 'down',
        local_interface: wan.name || '',
        traffic_mbps: Number(wan.total_mbps || 0),
        download_mbps: Number(wan.rx_mbps || 0),
        upload_mbps: Number(wan.tx_mbps || 0),
        link_speed: wan.link_speed || '',
        label: [wan.name, wan.link_speed].filter(Boolean).join(' · '),
      });
    }
  }

  const onlineRouters = nodes.filter((node) => node.kind === 'router' && node.status === 'online').length;
  const offlineRouters = nodes.filter((node) => node.kind === 'router' && node.status !== 'online').length;
  const discovered = nodes.filter((node) => node.kind === 'discovered').length;
  const totalSessions = nodes
    .filter((node) => node.kind === 'service')
    .reduce((sum, node) => sum + Number(node.count || 0), 0);

  return {
    generated_at: new Date().toISOString(),
    nodes,
    edges,
    stats: {
      routers: activeRouters.length,
      routers_online: onlineRouters,
      routers_offline: offlineRouters,
      discovered_devices: discovered,
      active_sessions: totalSessions,
      links: edges.filter((edge) => edge.kind !== 'service').length,
      mapped_sites: nodes.filter((node) => node.kind === 'router' && Number.isFinite(node.latitude) && Number.isFinite(node.longitude)).length,
    },
  };
}

async function saveTopologyLocation(clientId, routerId, payload = {}) {
  await ensureTopologySchema();
  const latitude = payload.latitude === '' || payload.latitude === null || payload.latitude === undefined
    ? null
    : Number(payload.latitude);
  const longitude = payload.longitude === '' || payload.longitude === null || payload.longitude === undefined
    ? null
    : Number(payload.longitude);

  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new Error('Latitude must be between -90 and 90');
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new Error('Longitude must be between -180 and 180');
  }

  const siteLabel = text(payload.site_label).slice(0, 180) || null;
  const role = inferRole('', payload.role);
  const result = await db.query(
    `UPDATE mikrotik_routers
     SET topology_latitude = $1,
         topology_longitude = $2,
         topology_site_label = $3,
         topology_role = $4,
         updated_at = NOW()
     WHERE client_id = $5 AND id = $6
     RETURNING id, name, topology_latitude, topology_longitude, topology_site_label, topology_role`,
    [latitude, longitude, siteLabel, role, clientId, Number(routerId)]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    latitude: row.topology_latitude === null ? null : Number(row.topology_latitude),
    longitude: row.topology_longitude === null ? null : Number(row.topology_longitude),
    site_label: row.topology_site_label || '',
    role: row.topology_role || 'access',
  };
}

module.exports = {
  ensureTopologySchema,
  getNetworkTopology,
  saveTopologyLocation,
};
