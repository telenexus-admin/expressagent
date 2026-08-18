from pathlib import Path
import re


def sub_once(text, pattern, replacement, label, flags=0):
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text


# ---------------------------------------------------------------------------
# BillingWorkspace.jsx
# ---------------------------------------------------------------------------
path = Path("frontend/src/pages/BillingWorkspace.jsx")
text = path.read_text()

text = sub_once(
    text,
    r"const routerDisplayStatus = \(router\) => \{.*?\n\};\nconst Badge",
    '''const routerDisplayStatus = (router) => {
  if (router?.is_active === false) return 'inactive';
  const status = String(
    router?.last_status ||
    router?.status ||
    ''
  ).trim().toLowerCase();

  if (['error', 'failed', 'offline'].includes(status)) return 'offline';
  if (['online', 'active'].includes(status)) return 'online';
  if (['unknown', 'stale'].includes(status)) return 'unknown';
  return status || 'pending';
};
const Badge''',
    "routerDisplayStatus",
    re.S,
)

old_tone = "tone === 'indigo' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'bg-slate-100 text-slate-600'"
new_tone = "tone === 'indigo' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : tone === 'rose' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-slate-100 text-slate-600'"
if old_tone not in text:
    raise SystemExit("Badge rose tone: source marker missing")
text = text.replace(old_tone, new_tone, 1)

font_effect = re.compile(
    r"(  useEffect\(\(\) => \{\n"
    r"    const id = 'nexa-billing-modern-font';.*?\n"
    r"  \}, \[\]\);)",
    re.S,
)
match = font_effect.search(text)
if not match:
    raise SystemExit("font effect marker not found")
router_poll = '''

  useEffect(() => {
    let mounted = true;
    const refreshRouterStates = async () => {
      try {
        const result = await api.get('/mikrotik');
        if (!mounted) return;
        const routerData = result.data;
        setRouters(
          Array.isArray(routerData)
            ? routerData
            : Array.isArray(routerData?.routers)
              ? routerData.routers
              : []
        );
      } catch (_) {
        // Keep the last confirmed monitor state until the next refresh.
      }
    };

    const timer = window.setInterval(refreshRouterStates, 30000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);'''
text = text[:match.end()] + router_poll + text[match.end():]

text = sub_once(
    text,
    r"\n\s*section:has\(svg\[aria-label=\"Live bandwidth traffic graph\"\]\) > div:nth-child\(2\) \{.*?"
    r"section:has\(svg\[aria-label=\"Live bandwidth traffic graph\"\]\) > div:nth-child\(2\) > div:last-child > div:nth-child\(n\+3\) \{.*?\n\s*\}\n",
    "\n",
    "broken bandwidth layout CSS",
    re.S,
)

component_pattern = re.compile(
    r"function BandwidthOverviewExact\(\{.*?\n\s*return \(",
    re.S,
)
component_match = component_pattern.search(text)
if not component_match:
    raise SystemExit("BandwidthOverviewExact prefix not found")
component_prefix = '''function BandwidthOverviewExact({
  history = [],
  tick = 0,
  panel = 'bg-white text-slate-900',
  muted = 'text-slate-400',
}) {
  const buckets = new Map();

  (Array.isArray(history) ? history : []).forEach((row, index) => {
    if (!row) return;
    const down = Number(row.download_mbps);
    const up = Number(row.upload_mbps);
    if (!Number.isFinite(down) && !Number.isFinite(up)) return;

    const parsedTime = new Date(row.timestamp || row.created_at || '').getTime();
    const hasTime = Number.isFinite(parsedTime) && parsedTime > 0;
    const bucket = hasTime ? Math.floor(parsedTime / 5000) * 5000 : index;
    buckets.set(bucket, {
      timestamp: hasTime ? parsedTime : index,
      download_mbps: Number.isFinite(down) ? Math.max(0, down) : 0,
      upload_mbps: Number.isFinite(up) ? Math.max(0, up) : 0,
    });
  });

  const rows = [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-60);
  const latest = rows[rows.length - 1] || null;
  const download = Number(latest?.download_mbps || 0);
  const upload = Number(latest?.upload_mbps || 0);
  const peak = Math.max(0, ...rows.flatMap((row) => [row.download_mbps, row.upload_mbps]));
  const scaleMax = peak > 0 ? peak * 1.12 : 1;

  const points = (key) => rows
    .map((row, index) => {
      const x = rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100;
      const value = Number.isFinite(row[key]) ? row[key] : 0;
      const y = 38 - (value / scaleMax) * 32;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  void tick;

  return ('''
text = text[:component_match.start()] + component_prefix + text[component_match.end():]

text = sub_once(
    text,
    r"peak ===\s*1\s*&&\s*!rows\.length\s*\? '—'\s*:\s*`\$\{peak\.toFixed\(\s*2\s*\)\} Mbps`",
    "!rows.length ? '—' : `${peak.toFixed(2)} Mbps`",
    "actual peak display",
    re.S,
)

text = sub_once(
    text,
    r"<Badge\s+tone=\{\s*\['online', 'active'\]\.includes\(routerDisplayStatus\(router\)\)\s*\? 'green'\s*:\s*'amber'\s*\}\s*>\s*\{routerDisplayStatus\(router\)\}\s*</Badge>",
    '''<Badge
                  tone={
                    routerDisplayStatus(router) === 'online'
                      ? 'green'
                      : routerDisplayStatus(router) === 'offline'
                        ? 'rose'
                        : 'amber'
                  }
                >
                  {routerDisplayStatus(router)}
                </Badge>''',
    "router badge",
    re.S,
)

text = sub_once(
    text,
    r"(API \{router\.port \|\| 8728\}\n\s*</p>)",
    r'''\1

                  {router.status_checked_at && (
                    <p className={`mt-1 text-[10px] font-semibold ${muted}`}>
                      {router.status_source === 'monitor' ? 'Live monitor' : 'Last check'} · {new Date(router.status_checked_at).toLocaleTimeString()}
                    </p>
                  )}''',
    "router monitor timestamp",
)

path.write_text(text)


# ---------------------------------------------------------------------------
# BillingNoc.jsx
# ---------------------------------------------------------------------------
path = Path("frontend/src/pages/BillingNoc.jsx")
text = path.read_text()
text = sub_once(
    text,
    r"function TrafficChart\(\{ rows \}\) \{.*?\n\}\n\nfunction EmptyNoc",
    '''function TrafficChart({ rows }) {
  const buckets = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (!row) return;
    const down = Number(row.download_mbps);
    const up = Number(row.upload_mbps);
    if (!Number.isFinite(down) && !Number.isFinite(up)) return;
    const parsedTime = new Date(row.timestamp || row.created_at || '').getTime();
    const hasTime = Number.isFinite(parsedTime) && parsedTime > 0;
    const bucket = hasTime ? Math.floor(parsedTime / 5000) * 5000 : index;
    buckets.set(bucket, {
      timestamp: hasTime ? parsedTime : index,
      download_mbps: Number.isFinite(down) ? Math.max(0, down) : 0,
      upload_mbps: Number.isFinite(up) ? Math.max(0, up) : 0,
    });
  });

  const data = [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-60);
  if (!data.length) return <div className="flex h-[150px] items-center justify-center text-[10px] font-semibold text-slate-400">Traffic history will appear after NOC samples are collected.</div>;

  const peak = Math.max(0, ...data.flatMap((row) => [row.download_mbps, row.upload_mbps]));
  const scaleMax = peak > 0 ? peak * 1.12 : 1;
  const width = 720;
  const height = 150;
  const padX = 12;
  const padY = 14;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padY * 2;
  const point = (row, index, key) => {
    const x = padX + (data.length <= 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth);
    const value = Number.isFinite(row[key]) ? row[key] : 0;
    const y = padY + usableHeight - (value / scaleMax) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const down = data.map((row, index) => point(row, index, 'download_mbps')).join(' ');
  const up = data.map((row, index) => point(row, index, 'upload_mbps')).join(' ');

  return <div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-[150px] w-full" role="img" aria-label="NOC traffic graph">{[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1={padX} x2={width - padX} y1={padY + usableHeight * ratio} y2={padY + usableHeight * ratio} stroke="currentColor" className="text-slate-100" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}<polyline points={down} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /><polyline points={up} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg><div className="mt-2 flex items-center justify-between text-[10px] font-bold text-slate-400"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-500" />Download</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />Upload</span><span className="hidden sm:inline">Peak {peak.toFixed(2)} Mbps</span></div></div>;
}

function EmptyNoc''',
    "NOC TrafficChart",
    re.S,
)
path.write_text(text)


# ---------------------------------------------------------------------------
# mikrotik.js: authoritative status = one-minute background monitor state.
# ---------------------------------------------------------------------------
path = Path("backend/src/services/mikrotik.js")
text = path.read_text()
text = sub_once(
    text,
    r"function safeRouter\(row\) \{.*?\n\}\n\nfunction routerOsQuote",
    '''function safeRouter(row) {
  const features = cleanFeatures(row.features);
  const now = Date.now();
  const monitorCheckedAt = row.monitor_updated_at || null;
  const monitorCheckedMs = monitorCheckedAt ? new Date(monitorCheckedAt).getTime() : NaN;
  const monitorFresh = Number.isFinite(monitorCheckedMs) && now - monitorCheckedMs <= 3 * 60 * 1000;
  const storedSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : NaN;
  const storedFresh = Number.isFinite(storedSeenMs) && now - storedSeenMs <= 3 * 60 * 1000;
  const storedStatus = String(row.last_status || '').trim().toLowerCase();
  const monitorState = row.monitor_state_json && typeof row.monitor_state_json === 'object'
    ? row.monitor_state_json
    : {};
  const monitorFailures = Number(monitorState.failure_count || 0);

  let lastStatus = 'pending';
  let statusSource = 'unconfirmed';
  let statusCheckedAt = null;
  let lastError = row.last_error || '';

  if (row.is_active === false) {
    lastStatus = 'inactive';
    statusSource = 'configuration';
  } else if (monitorCheckedAt) {
    statusCheckedAt = monitorCheckedAt;
    if (!monitorFresh) {
      lastStatus = 'unknown';
      statusSource = 'stale_monitor';
    } else if (row.monitor_is_online === true) {
      lastStatus = 'online';
      statusSource = 'monitor';
      lastError = '';
    } else if (monitorFailures >= 2) {
      lastStatus = 'offline';
      statusSource = 'monitor';
      lastError = monitorState.last_error || lastError;
    } else {
      lastStatus = 'checking';
      statusSource = 'monitor';
      lastError = monitorState.last_error || lastError;
    }
  } else if (storedFresh && ['online', 'active'].includes(storedStatus)) {
    lastStatus = 'online';
    statusSource = 'manual_test';
    statusCheckedAt = row.last_seen_at;
  } else if (['error', 'offline', 'failed'].includes(storedStatus)) {
    lastStatus = 'offline';
    statusSource = 'manual_test';
    statusCheckedAt = row.updated_at || null;
  }

  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    connection_type: row.connection_type || 'api',
    username: row.username,
    connection_method: row.connection_method || 'public_api',
    wireguard_tunnel_ip: row.wireguard_tunnel_ip || '',
    wireguard_interface: row.wireguard_interface || '',
    wireguard_mikrotik_public_key: row.wireguard_mikrotik_public_key || '',
    wireguard_billing_api_ips: row.wireguard_billing_api_ips || '',
    provisioning_status: row.provisioning_status || 'not_configured',
    provisioned_at: row.provisioned_at || null,
    password_configured: Boolean(row.password_encrypted),
    features,
    is_active: row.is_active !== false,
    last_status: lastStatus,
    last_error: lastError,
    last_identity: row.last_identity || '',
    last_version: row.last_version || '',
    last_uptime: row.last_uptime || '',
    last_seen_at: row.monitor_last_seen || row.last_seen_at,
    status_source: statusSource,
    status_checked_at: statusCheckedAt,
    monitor_offline_since: row.monitor_offline_since || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function routerOsQuote''',
    "safeRouter",
    re.S,
)

text = sub_once(
    text,
    r"async function listRouters\(clientId\) \{.*?\n\}\n\nasync function getRouter",
    '''async function listRouters(clientId) {
  await ensureMikrotikTables();
  const stateTable = await db.query(
    `SELECT TO_REGCLASS('public.router_states') AS table_name`
  );
  const hasMonitorState = Boolean(stateTable.rows[0]?.table_name);
  const result = hasMonitorState
    ? await db.query(
        `SELECT r.*,
                s.is_online AS monitor_is_online,
                s.last_seen AS monitor_last_seen,
                s.offline_since AS monitor_offline_since,
                s.updated_at AS monitor_updated_at,
                s.state_json AS monitor_state_json
         FROM mikrotik_routers r
         LEFT JOIN router_states s ON s.router_id = r.id
         WHERE r.client_id = $1
         ORDER BY r.created_at DESC`,
        [clientId]
      )
    : await db.query(
        `SELECT * FROM mikrotik_routers WHERE client_id = $1 ORDER BY created_at DESC`,
        [clientId]
      );
  return result.rows.map(safeRouter);
}

async function getRouter''',
    "listRouters",
    re.S,
)
path.write_text(text)


# ---------------------------------------------------------------------------
# noc.js: reduce duplicate history points and duplicate live RouterOS reads.
# ---------------------------------------------------------------------------
path = Path("backend/src/services/noc.js")
text = path.read_text()
text = sub_once(
    text,
    r"async function nocHistory\(clientId, routerId, range = '6h'\) \{.*?\n\}\n\nasync function nocStatus",
    '''async function nocHistory(clientId, routerId, range = '6h') {
  await ensureNocTables();
  const router = await resolveRouter(clientId, routerId);
  const hours = range === '24h' ? 24 : range === '1h' ? 1 : 6;
  const bucketSeconds = hours === 24 ? 60 : 10;
  const result = await db.query(
    `SELECT created_at, download_mbps, upload_mbps, cpu_load, memory_used_percent,
            storage_used_percent, active_pppoe, active_hotspot, router_health_percent
     FROM (
       SELECT DISTINCT ON (FLOOR(EXTRACT(EPOCH FROM created_at) / $4::numeric))
              created_at, download_mbps, upload_mbps, cpu_load, memory_used_percent,
              storage_used_percent, active_pppoe, active_hotspot, router_health_percent
       FROM noc_router_snapshots
       WHERE client_id = $1
         AND router_id = $2
         AND created_at >= NOW() - ($3::text)::interval
       ORDER BY FLOOR(EXTRACT(EPOCH FROM created_at) / $4::numeric), created_at DESC
     ) sampled
     ORDER BY created_at ASC`,
    [clientId, router.id, `${hours} hours`, bucketSeconds]
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

async function recentSnapshotOrLive(clientId, routerId, seconds = 20) {
  const router = await resolveRouter(clientId, routerId);
  const previous = await latestStoredSnapshot(clientId, router.id).catch(() => null);
  if (previous && recentEnough(previous.checked_at || previous.cached_at, seconds / 60)) {
    return previous;
  }
  return readLiveSnapshot(clientId, router.id);
}

async function nocStatus''',
    "nocHistory",
    re.S,
)
text = sub_once(
    text,
    r"(async function nocStatus\(clientId, routerId\) \{\n\s*)const snapshot = await readLiveSnapshot\(clientId, routerId\);",
    r"\1const snapshot = await recentSnapshotOrLive(clientId, routerId);",
    "nocStatus reuse",
)
text = sub_once(
    text,
    r"(async function nocAnalysis\(clientId, routerId\) \{\n\s*)const snapshot = await nocOverview\(clientId, routerId\);",
    r"\1const snapshot = await recentSnapshotOrLive(clientId, routerId);",
    "nocAnalysis reuse",
)
path.write_text(text)

print("Applied traffic chart and live router status fixes")
