const db = require('../db');
const {
  connectRouter,
  ensureMikrotikTables,
  getRouter,
  listRouters,
} = require('./mikrotik');

const SNAPSHOT_LIMIT = 1200;
const LIVE_INTERFACE_LIMIT = 8;

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function bitsPerSecond(value) {
  const parsed = num(value);
  return parsed === null ? 0 : parsed;
}

function mbps(value) {
  return Number((bitsPerSecond(value) / 1000000).toFixed(2));
}

function mbpsFromBits(value) {
  const parsed = Number(value || 0);
  return Number((parsed / 1000000).toFixed(2));
}

function parseRatePair(value) {
  const parts = String(value || '').split('/').map((item) => bitsPerSecond(item));
  return {
    tx_bps: parts[0] || 0,
    rx_bps: parts[1] || 0,
  };
}

function percent(value, fallback = null) {
  const parsed = num(value);
  if (parsed === null) return fallback;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(1))));
}

function bytesPercent(free, total) {
  const freeBytes = num(free);
  const totalBytes = num(total);
  if (!totalBytes || freeBytes === null) return null;
  return Math.max(0, Math.min(100, Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1))));
}

function trafficInterfaceCandidate(row = {}) {
  const name = String(row.name || '');
  const type = String(row.type || '').toLowerCase();
  return /^(ether|sfp|combo|bridge|bonding|vlan|wg-|wireguard|lte)/i.test(name) ||
    ['ether', 'bridge', 'bonding', 'vlan', 'wireguard', 'lte'].includes(type);
}

function chooseWanInterface(interfaces = [], preferred = '') {
  const target = String(preferred || '').trim().toLowerCase();
  const usable = interfaces.filter((row) => trafficInterfaceCandidate(row) && row.disabled !== 'true' && row.disabled !== true);
  if (target) {
    const match = usable.find((row) => String(row.name || '').toLowerCase() === target);
    if (match) return match;
  }
  const namedWan = usable.find((row) => /\b(wan|internet|uplink|provider|backhaul)\b/i.test(`${row.name || ''} ${row.comment || ''}`));
  if (namedWan) return namedWan;
  const running = usable
    .filter((row) => row.running === 'true' || row.running === true)
    .sort((a, b) => ((b.rx_bps || 0) + (b.tx_bps || 0)) - ((a.rx_bps || 0) + (a.tx_bps || 0)));
  return running[0] || usable[0] || {};
}

function orderInterfaceCandidates(rows = [], preferred = '') {
  const target = String(preferred || '').trim().toLowerCase();
  const scored = rows
    .filter(trafficInterfaceCandidate)
    .filter((row) => row.disabled !== 'true' && row.disabled !== true)
    .map((row) => {
      const name = String(row.name || '').toLowerCase();
      const haystack = `${row.name || ''} ${row.comment || ''}`.toLowerCase();
      let score = 0;
      if (target && name === target) score += 1000;
      if (/\b(wan|internet|uplink|provider|backhaul)\b/i.test(haystack)) score += 500;
      if (row.running === 'true' || row.running === true) score += 200;
      if (/^(sfp|ether|combo)/i.test(row.name || '')) score += 80;
      if (/^(bridge|vlan|wg-|wireguard)/i.test(row.name || '')) score += 20;
      return { row, score };
    });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, LIVE_INTERFACE_LIMIT)
    .map((item) => item.row);
}

function routerHealth({ cpuLoad, memoryUsedPercent, storageUsedPercent, ok }) {
  if (!ok) return 0;
  const penalties = [
    Math.max(0, (Number(cpuLoad || 0) - 50) * 0.45),
    Math.max(0, (Number(memoryUsedPercent || 0) - 70) * 0.35),
    Math.max(0, (Number(storageUsedPercent || 0) - 75) * 0.45),
  ];
  const score = 100 - penalties.reduce((sum, item) => sum + item, 0);
  return Math.max(0, Math.min(100, Number(score.toFixed(1))));
}

function statusFromHealth(value) {
  if (value >= 90) return 'Healthy';
  if (value >= 70) return 'Watch';
  if (value > 0) return 'Attention';
  return 'Offline';
}

function trendFromRows(rows, key) {
  return rows.map((row) => Number(row[key] || 0)).filter((value) => Number.isFinite(value));
}

async function interfaceTrafficRows(client, interfaceRows = [], preferred = '') {
  const candidates = orderInterfaceCandidates(interfaceRows, preferred);
  const rows = [];
  for (const row of candidates) {
    const traffic = row.disabled === 'true'
      ? {}
      : (await client.command('/interface/monitor-traffic', { interface: row.name, once: '' }).catch(() => []))[0] || {};
    const rxBps = bitsPerSecond(traffic['rx-bits-per-second']);
    const txBps = bitsPerSecond(traffic['tx-bits-per-second']);
    rows.push({
      name: row.name || '',
      type: row.type || '',
      running: row.running === 'true',
      disabled: row.disabled === 'true',
      comment: row.comment || '',
      rx_bps: rxBps,
      tx_bps: txBps,
      rx_mbps: mbpsFromBits(rxBps),
      tx_mbps: mbpsFromBits(txBps),
      total_mbps: mbpsFromBits(rxBps + txBps),
      link_speed: row['actual-speed'] || row.speed || row['link-speed'] || row['default-name'] || '',
      full_duplex: row['full-duplex'] || '',
      status: row.disabled === 'true' ? 'disabled' : row.running === 'true' ? 'running' : 'down',
    });
  }

  return rows.sort((a, b) => (b.total_mbps || 0) - (a.total_mbps || 0));
}

function interfaceCountsForBandwidth(row = {}) {
  const name = String(row.name || '').toLowerCase();
  const type = String(row.type || '').toLowerCase();
  if (row.disabled || row.status === 'disabled') return false;
  if (name === 'lo' || type === 'loopback') return false;
  if (/^(wg-|wireguard|ovpn|sstp|l2tp|pptp)/i.test(name)) return false;
  return row.status === 'running' || row.running === true || Number(row.total_mbps || 0) > 0;
}

function aggregateBandwidth(interfaces = [], wan = {}) {
  const counted = interfaces.filter(interfaceCountsForBandwidth);
  const active = counted.filter((row) => Number(row.total_mbps || 0) > 0);
  const rows = active.length ? active : counted;
  const rxBps = rows.reduce((sum, row) => sum + Number(row.rx_bps || 0), 0);
  const txBps = rows.reduce((sum, row) => sum + Number(row.tx_bps || 0), 0);
  const fallbackRx = Number(wan.rx_bps || 0);
  const fallbackTx = Number(wan.tx_bps || 0);
  const finalRx = rxBps || fallbackRx;
  const finalTx = txBps || fallbackTx;
  return {
    download_mbps: mbpsFromBits(finalRx),
    upload_mbps: mbpsFromBits(finalTx),
    total_mbps: mbpsFromBits(finalRx + finalTx),
    sampled_interfaces: rows.length,
    source: rows.length > 1 ? 'aggregate-live-interfaces' : 'live-interface',
  };
}

function topUsersFromQueues(queueRows = []) {
  return queueRows
    .filter((row) => row.disabled !== 'true' && row.disabled !== true)
    .map((row) => {
      const rate = parseRatePair(row.rate || row['rate'] || row['actual-rate'] || '');
      const totalBps = rate.tx_bps + rate.rx_bps;
      return {
        name: row.name || row.target || row.comment || 'Queue user',
        target: row.target || '',
        service: row.comment || row.parent || 'queue',
        download_mbps: mbpsFromBits(rate.rx_bps),
        upload_mbps: mbpsFromBits(rate.tx_bps),
        total_mbps: mbpsFromBits(totalBps),
        raw_rate: row.rate || row['actual-rate'] || '',
        disabled: row.disabled === 'true' || row.disabled === true,
      };
    })
    .filter((row) => row.total_mbps > 0)
    .sort((a, b) => b.total_mbps - a.total_mbps)
    .slice(0, 12);
}

async function latestStoredSnapshot(clientId, routerId) {
  await ensureNocTables();
  const result = await db.query(
    `SELECT raw, created_at
     FROM noc_router_snapshots
     WHERE client_id = $1 AND router_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientId, routerId]
  );
  const row = result.rows[0];
  if (!row?.raw) return null;
  return {
    ...row.raw,
    cached_at: row.created_at,
  };
}

function recentEnough(dateValue, minutes = 10) {
  const time = new Date(dateValue || 0).getTime();
  return Number.isFinite(time) && Date.now() - time <= minutes * 60 * 1000;
}

function stabilizeSnapshot(snapshot, previous) {
  if (!previous) return snapshot;
  const next = { ...snapshot };
  const liveInterfaces = Array.isArray(snapshot.interfaces) ? snapshot.interfaces : [];
  const liveHasTraffic = liveInterfaces.some((row) => Number(row.total_mbps || 0) > 0);
  const previousInterfaces = Array.isArray(previous.interfaces) ? previous.interfaces : [];
  if (!liveHasTraffic && previousInterfaces.length && recentEnough(previous.checked_at || previous.cached_at, 10)) {
    next.interfaces = previousInterfaces;
    next.wan_interface = snapshot.wan_interface || previous.wan_interface;
    next.wan_link_speed = snapshot.wan_link_speed || previous.wan_link_speed;
    next.download_mbps = Number(previous.download_mbps || 0);
    next.upload_mbps = Number(previous.upload_mbps || 0);
    next.total_traffic_mbps = Number(previous.total_traffic_mbps || 0);
    next.wan_status = snapshot.wan_status === 'stable' ? snapshot.wan_status : previous.wan_status;
    next.traffic_source = 'last-good-snapshot';
  }
  if ((!snapshot.top_users || snapshot.top_users.length === 0) && Array.isArray(previous.top_users) && previous.top_users.length && recentEnough(previous.checked_at || previous.cached_at, 10)) {
    next.top_users = previous.top_users;
    next.top_users_source = 'last-good-snapshot';
  }
  return next;
}

async function ensureNocTables() {
  await ensureMikrotikTables();
  await db.query(`
    CREATE TABLE IF NOT EXISTS noc_router_snapshots (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      router_id INTEGER NOT NULL REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
      router_name VARCHAR(180),
      download_mbps NUMERIC,
      upload_mbps NUMERIC,
      active_pppoe INTEGER,
      active_hotspot INTEGER,
      cpu_load NUMERIC,
      memory_used_percent NUMERIC,
      storage_used_percent NUMERIC,
      router_health_percent NUMERIC,
      wan_interface VARCHAR(120),
      wan_link_speed VARCHAR(80),
      wan_status VARCHAR(60),
      queue_health_percent NUMERIC,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_noc_snapshots_router_time ON noc_router_snapshots(router_id, created_at DESC)`);
}

async function resolveRouter(clientId, routerId) {
  if (routerId) {
    const router = await getRouter(clientId, routerId, { includePassword: true });
    if (!router || router.is_active === false) throw new Error('NOC router not found or inactive');
    return router;
  }
  const routers = await listRouters(clientId);
  const first = routers.find((router) => router.is_active !== false);
  if (!first) throw new Error('No active MikroTik routers are linked yet');
  return getRouter(clientId, first.id, { includePassword: true });
}

async function readLiveSnapshot(clientId, routerId, options = {}) {
  await ensureNocTables();
  const router = await resolveRouter(clientId, routerId);
  const previous = await latestStoredSnapshot(clientId, router.id).catch(() => null);
  let client = null;
  try {
    client = await connectRouter(router);
    const identityRows = await client.command('/system/identity/print').catch(() => []);
    const resourceRows = await client.command('/system/resource/print').catch(() => []);
    const interfaceRows = router.features?.interfaces === false ? [] : await client.command('/interface/print').catch(() => []);
    const pppRows = router.features?.ppp_active === false ? [] : await client.command('/ppp/active/print').catch(() => []);
    const hotspotRows = router.features?.hotspot_active === false ? [] : await client.command('/ip/hotspot/active/print').catch(() => []);
    const queueRows = await client.command('/queue/simple/print', { stats: '' }).catch(() => client.command('/queue/simple/print').catch(() => []));
    const logRows = router.features?.logs === false ? [] : await client.command('/log/print').catch(() => []);

    const resource = resourceRows[0] || {};
    const interfaces = await interfaceTrafficRows(client, interfaceRows, options.wan_interface);
    const wan = chooseWanInterface(interfaces, options.wan_interface);
    const bandwidth = aggregateBandwidth(interfaces, wan);
    const topUsers = topUsersFromQueues(queueRows);

    const downloadMbps = bandwidth.download_mbps;
    const uploadMbps = bandwidth.upload_mbps;
    const cpuLoad = percent(resource['cpu-load']);
    const memoryUsedPercent = bytesPercent(resource['free-memory'], resource['total-memory']);
    const storageUsedPercent = bytesPercent(resource['free-hdd-space'] || resource['free-disk-space'], resource['total-hdd-space'] || resource['total-disk-space']);
    const health = routerHealth({ cpuLoad, memoryUsedPercent, storageUsedPercent, ok: true });
    const activeQueues = queueRows.filter((row) => row.disabled !== 'true' && row.disabled !== true).length;
    const queueHealth = queueRows.length ? Number(((activeQueues / queueRows.length) * 100).toFixed(1)) : null;
    const warningLogs = logRows.filter((row) => /error|critical|warning|failed|failure|attack|dhcp alert/i.test(`${row.topics || ''} ${row.message || ''}`)).slice(-10);

    const snapshot = stabilizeSnapshot({
      router_id: router.id,
      client_id: clientId,
      router_name: identityRows[0]?.name || router.last_identity || router.name,
      identity: identityRows[0]?.name || router.last_identity || router.name,
      board_name: resource['board-name'] || '',
      routeros_version: resource.version || router.last_version || '',
      uptime: resource.uptime || router.last_uptime || '',
      download_mbps: downloadMbps,
      upload_mbps: uploadMbps,
      total_traffic_mbps: Number((downloadMbps + uploadMbps).toFixed(2)),
      active_pppoe: pppRows.length,
      active_hotspot: hotspotRows.length,
      cpu_load: cpuLoad,
      memory_used_percent: memoryUsedPercent,
      storage_used_percent: storageUsedPercent,
      router_health_percent: health,
      wan_interface: wan.name || '',
      wan_link_speed: wan.link_speed || '',
      wan_status: wan.name ? (wan.running ? 'stable' : 'down') : 'unknown',
      bandwidth,
      queue_health_percent: queueHealth,
      total_queues: queueRows.length,
      active_queues: activeQueues,
      top_users: topUsers,
      active_alerts: warningLogs.length,
      critical_alerts: warningLogs.filter((row) => /critical/i.test(`${row.topics || ''} ${row.message || ''}`)).length,
      warning_alerts: warningLogs.length,
      latest_alerts: warningLogs.reverse().map((row) => ({
        time: row.time || row.date || '',
        topics: row.topics || '',
        message: row.message || '',
      })),
      interfaces,
      checked_at: new Date().toISOString(),
      source: 'mikrotik-live',
    }, previous);

    await storeSnapshot(snapshot).catch((err) => console.error('NOC snapshot store failed:', err.message));
    return snapshot;
  } finally {
    if (client) client.close();
  }
}

async function storeSnapshot(snapshot) {
  await db.query(
    `INSERT INTO noc_router_snapshots (
       client_id, router_id, router_name, download_mbps, upload_mbps, active_pppoe,
       active_hotspot, cpu_load, memory_used_percent, storage_used_percent,
       router_health_percent, wan_interface, wan_link_speed, wan_status,
       queue_health_percent, raw
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
    [
      snapshot.client_id,
      snapshot.router_id,
      snapshot.router_name,
      snapshot.download_mbps,
      snapshot.upload_mbps,
      snapshot.active_pppoe,
      snapshot.active_hotspot,
      snapshot.cpu_load,
      snapshot.memory_used_percent,
      snapshot.storage_used_percent,
      snapshot.router_health_percent,
      snapshot.wan_interface,
      snapshot.wan_link_speed,
      snapshot.wan_status,
      snapshot.queue_health_percent,
      JSON.stringify(snapshot),
    ]
  );
  await db.query(
    `DELETE FROM noc_router_snapshots
     WHERE id IN (
       SELECT id FROM noc_router_snapshots
       WHERE router_id = $1
       ORDER BY created_at DESC
       OFFSET $2
     )`,
    [snapshot.router_id, SNAPSHOT_LIMIT]
  );
}

async function nocRouters(clientId) {
  await ensureNocTables();
  return listRouters(clientId);
}

async function nocOverview(clientId, routerId, options = {}) {
  try {
    return await readLiveSnapshot(clientId, routerId, options);
  } catch (err) {
    const router = await resolveRouter(clientId, routerId);
    const previous = await latestStoredSnapshot(clientId, router.id).catch(() => null);
    if (previous && recentEnough(previous.checked_at || previous.cached_at, 10)) {
      return {
        ...previous,
        source: 'last-good-snapshot',
        live_error: err.message,
      };
    }
    throw err;
  }
}

async function nocHistory(clientId, routerId, range = '6h') {
  await ensureNocTables();
  const router = await resolveRouter(clientId, routerId);
  const hours = range === '24h' ? 24 : range === '1h' ? 1 : 6;
  const result = await db.query(
    `SELECT created_at, download_mbps, upload_mbps, cpu_load, memory_used_percent, storage_used_percent, active_pppoe, active_hotspot, router_health_percent
     FROM noc_router_snapshots
     WHERE client_id = $1 AND router_id = $2 AND created_at >= NOW() - ($3::text)::interval
     ORDER BY created_at ASC`,
    [clientId, router.id, `${hours} hours`]
  );
  return result.rows.map((row) => ({
    timestamp: row.created_at,
    download_mbps: Number(row.download_mbps || 0),
    upload_mbps: Number(row.upload_mbps || 0),
    cpu_load: row.cpu_load === null ? null : Number(row.cpu_load),
    memory_used_percent: row.memory_used_percent === null ? null : Number(row.memory_used_percent),
    storage_used_percent: row.storage_used_percent === null ? null : Number(row.storage_used_percent),
    pppoe_count: row.active_pppoe === null ? null : Number(row.active_pppoe),
    hotspot_count: row.active_hotspot === null ? null : Number(row.active_hotspot),
    router_health_percent: row.router_health_percent === null ? null : Number(row.router_health_percent),
  }));
}

async function nocStatus(clientId, routerId) {
  const snapshot = await readLiveSnapshot(clientId, routerId);
  const history = await nocHistory(clientId, snapshot.router_id, '1h');
  return [
    {
      item: 'Core Router',
      metric: snapshot.cpu_load === null ? 'CPU unavailable' : `CPU ${snapshot.cpu_load}%`,
      status: statusFromHealth(snapshot.router_health_percent),
      note: snapshot.uptime ? `Uptime ${snapshot.uptime}` : 'Uptime unavailable',
      trend: trendFromRows(history, 'cpu_load'),
    },
    {
      item: 'WAN Uplink',
      metric: `${snapshot.total_traffic_mbps} Mbps`,
      status: snapshot.wan_status === 'stable' ? 'Stable' : 'Attention',
      note: [snapshot.wan_interface, snapshot.wan_link_speed].filter(Boolean).join(' / ') || 'Interface unavailable',
      trend: history.map((row) => Number((Number(row.download_mbps || 0) + Number(row.upload_mbps || 0)).toFixed(2))),
    },
    {
      item: 'PPPoE Sessions',
      metric: snapshot.active_pppoe === null ? 'Unavailable' : String(snapshot.active_pppoe),
      status: snapshot.active_pppoe === null ? 'Unavailable' : 'Active',
      note: 'Live RouterOS active sessions',
      trend: trendFromRows(history, 'pppoe_count'),
    },
    {
      item: 'Hotspot Users',
      metric: snapshot.active_hotspot === null ? 'Unavailable' : `${snapshot.active_hotspot} users`,
      status: snapshot.active_hotspot === null ? 'Unavailable' : 'Active',
      note: 'Live Hotspot active sessions',
      trend: trendFromRows(history, 'hotspot_count'),
    },
    {
      item: 'Queue Health',
      metric: snapshot.queue_health_percent === null ? 'Unavailable' : `${snapshot.queue_health_percent}%`,
      status: snapshot.queue_health_percent === null ? 'Unavailable' : snapshot.queue_health_percent > 85 ? 'Optimized' : 'Watch',
      note: snapshot.total_queues ? `${snapshot.active_queues}/${snapshot.total_queues} queues active` : 'No queue stats returned',
      trend: [],
    },
  ];
}

module.exports = {
  nocHistory,
  nocOverview,
  nocRouters,
  nocStatus,
};
