from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f'{label}: marker not found in {path}')
    path.write_text(text.replace(old, new, 1))


# Backend: authenticated same-origin proxy for OpenFreeMap resources.
route = Path('backend/src/routes/noc.js')
replace_once(
    route,
    "const express = require('express');\n",
    "const express = require('express');\nconst { Readable } = require('stream');\n",
    'stream import',
)

resolve_marker = """function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}
"""
proxy_helpers = """
const OPENFREEMAP_ORIGIN = 'https://tiles.openfreemap.org';
const MAP_PROXY_PREFIX = '/api/noc/fibre-gis/map';
const MAP_PROXY_MAX_BYTES = 10 * 1024 * 1024;

function safeMapProxyPath(value) {
  const path = String(value || '').replace(/^\\/+/, '');
  if (!path || path.includes('..') || path.includes('\\\\') || path.includes('://')) return '';
  return path;
}

function rewriteOpenFreeMapJson(value) {
  return String(value || '')
    .replaceAll('https://tiles.openfreemap.org', MAP_PROXY_PREFIX)
    .replaceAll('http://tiles.openfreemap.org', MAP_PROXY_PREFIX);
}

async function proxyOpenFreeMap(req, res) {
  const path = safeMapProxyPath(req.params[0]);
  if (!path) return res.status(400).json({ error: 'Invalid map resource path' });

  const target = new URL(`${OPENFREEMAP_ORIGIN}/${path}`);
  for (const [key, rawValue] of Object.entries(req.query || {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    values.forEach((value) => target.searchParams.append(key, String(value ?? '')));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: {
        Accept: req.get('accept') || '*/*',
        'User-Agent': 'Polyizon-FibreGIS/1.0',
      },
    });

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > MAP_PROXY_MAX_BYTES) {
      return res.status(413).json({ error: 'Map resource is too large' });
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=86400');
    const etag = upstream.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);
    const lastModified = upstream.headers.get('last-modified');
    if (lastModified) res.setHeader('Last-Modified', lastModified);

    if (!upstream.ok) {
      const message = await upstream.text().catch(() => '');
      return res.send(message || `Map provider returned ${upstream.status}`);
    }

    if (contentType.includes('json') || path.startsWith('styles/')) {
      const body = await upstream.text();
      if (Buffer.byteLength(body) > MAP_PROXY_MAX_BYTES) {
        return res.status(413).json({ error: 'Map resource is too large' });
      }
      return res.send(rewriteOpenFreeMapJson(body));
    }

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on('error', (error) => {
      console.error('Fibre GIS map proxy stream error:', error.message);
      if (!res.headersSent) res.status(502).end();
      else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.error('Fibre GIS map proxy error:', error.message);
    if (!res.headersSent) {
      res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'Map provider timed out' : 'Map provider unavailable' });
    }
  } finally {
    clearTimeout(timeout);
  }
}
"""
replace_once(route, resolve_marker, resolve_marker + proxy_helpers, 'map proxy helpers')

route_marker = """router.get('/fibre-gis', async (req, res) => {
"""
route_block = """router.get('/fibre-gis/map/*', proxyOpenFreeMap);

"""
replace_once(route, route_marker, route_block + route_marker, 'map proxy route')


# Frontend: use same-origin map proxy, attach the existing bearer token, show load/error state,
# keep map resized, and make placement instructions visible immediately.
page = Path('frontend/src/pages/BillingFibreGis.jsx')
replace_once(
    page,
    "const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';\n",
    "const MAP_STYLE = '/api/noc/fibre-gis/map/styles/liberty';\nconst MAP_PROXY_PATH = '/api/noc/fibre-gis/map/';\n\nfunction transformMapRequest(url) {\n  if (!String(url || '').includes(MAP_PROXY_PATH)) return { url };\n  const token = sessionStorage.getItem('token') || localStorage.getItem('token');\n  return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };\n}\n",
    'map style/proxy config',
)

replace_once(
    page,
    """  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const modeRef = useRef('browse');
""",
    """  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const mapReadyRef = useRef(false);
  const modeRef = useRef('browse');
""",
    'map ready ref',
)

replace_once(
    page,
    """  const [data, setData] = useState({ assets: [], routes: [], routers: [], stats: {} });
""",
    """  const [data, setData] = useState({ assets: [], routes: [], routers: [], stats: {} });
  const [mapState, setMapState] = useState('loading');
  const [mapMessage, setMapMessage] = useState('Loading street map…');
  const [mapRetryKey, setMapRetryKey] = useState(0);
""",
    'map state',
)

old_effect_start = """  useEffect(() => {
    if (!mapElement.current || mapRef.current) return undefined;
    const map = new maplibregl.Map({ container: mapElement.current, style: MAP_STYLE, center: [37.2, -0.3], zoom: 6.1, pitch: 44, bearing: -8, attributionControl: true });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left');
    map.on('load', () => {
"""
new_effect_start = """  useEffect(() => {
    if (!mapElement.current || mapRef.current) return undefined;
    mapReadyRef.current = false;
    setMapState('loading');
    setMapMessage('Loading street map…');
    let lastMapError = '';
    let map;

    try {
      map = new maplibregl.Map({
        container: mapElement.current,
        style: MAP_STYLE,
        center: [37.2, -0.3],
        zoom: 6.1,
        pitch: 44,
        bearing: -8,
        attributionControl: true,
        transformRequest: transformMapRequest,
      });
    } catch (error) {
      setMapState('error');
      setMapMessage(error?.message || 'The map could not start.');
      return undefined;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left');

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => map.resize())
      : null;
    resizeObserver?.observe(mapElement.current);

    map.on('error', (event) => {
      lastMapError = event?.error?.message || lastMapError || 'Map data could not be loaded.';
    });

    const loadTimeout = setTimeout(() => {
      if (mapReadyRef.current) return;
      setMapState('error');
      setMapMessage(lastMapError || 'The street map is taking too long to load.');
    }, 12000);

    map.on('load', () => {
      mapReadyRef.current = true;
      clearTimeout(loadTimeout);
      setMapState('ready');
      setMapMessage('');
      map.resize();
"""
replace_once(page, old_effect_start, new_effect_start, 'map initialization')

old_cleanup = """    return () => { map.remove(); mapRef.current = null; };
  }, [updateDraftSource]);
"""
new_cleanup = """    return () => {
      clearTimeout(loadTimeout);
      resizeObserver?.disconnect();
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [mapRetryKey, updateDraftSource]);
"""
replace_once(page, old_cleanup, new_cleanup, 'map cleanup/retry')

old_buttons = """<button type=\"button\" onClick={() => { setMode(mode === 'place-asset' ? 'browse' : 'place-asset'); setDraftCoordinates([]); updateDraftSource([]); }} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black ${mode === 'place-asset' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Icon name=\"plus\" className=\"h-3.5 w-3.5\" />Add</button><button type=\"button\" onClick={() => { const next = mode === 'draw-route' ? 'browse' : 'draw-route'; setMode(next); setDraftCoordinates([]); updateDraftSource([]); }} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black ${mode === 'draw-route' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Icon name=\"route\" className=\"h-3.5 w-3.5\" />Draw fibre</button>"""
new_buttons = """<button type=\"button\" disabled={mapState !== 'ready'} onClick={() => { setMode(mode === 'place-asset' ? 'browse' : 'place-asset'); setDraftCoordinates([]); updateDraftSource([]); }} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'place-asset' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Icon name=\"plus\" className=\"h-3.5 w-3.5\" />Add</button><button type=\"button\" disabled={mapState !== 'ready'} onClick={() => { const next = mode === 'draw-route' ? 'browse' : 'draw-route'; setMode(next); setDraftCoordinates([]); updateDraftSource([]); }} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'draw-route' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Icon name=\"route\" className=\"h-3.5 w-3.5\" />Draw fibre</button>"""
replace_once(page, old_buttons, new_buttons, 'map action buttons')

map_container_marker = """        <div className=\"relative h-[590px] sm:h-[650px]\"><div ref={mapElement} className=\"absolute inset-0\" />
"""
map_overlay = """        <div className=\"relative h-[590px] sm:h-[650px]\"><div ref={mapElement} className=\"absolute inset-0 bg-[#eef2f1]\" />
          {mapState !== 'ready' && <div className=\"absolute inset-0 z-30 flex items-center justify-center bg-[#f4f7f6]\"><div className=\"mx-4 w-full max-w-[340px] rounded-[18px] border border-slate-200 bg-white p-5 text-center shadow-xl\"><div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl ${mapState === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}><Icon name={mapState === 'error' ? 'info' : 'map'} className={`h-5 w-5 ${mapState === 'loading' ? 'animate-pulse' : ''}`} /></div><h3 className=\"mt-3 text-base font-black text-slate-900\">{mapState === 'error' ? 'Map could not load' : 'Loading Fibre GIS map'}</h3><p className=\"mx-auto mt-1 max-w-[280px] text-[9px] leading-4 text-slate-500\">{mapMessage}</p>{mapState === 'error' && <button type=\"button\" onClick={() => { setMapState('loading'); setMapMessage('Retrying street map…'); setMapRetryKey((value) => value + 1); }} className=\"mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-black text-white hover:bg-emerald-700\">Retry map</button>}</div></div>}
"""
replace_once(page, map_container_marker, map_overlay, 'map loading overlay')

replace_once(
    page,
    """{mode === 'place-asset' && <div className=\"absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-emerald-200 bg-white/95 px-3 py-2 text-center shadow-xl backdrop-blur\">""",
    """{mode === 'place-asset' && <div className=\"absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-xl border border-emerald-200 bg-white/95 px-3 py-2 text-center shadow-xl backdrop-blur\">""",
    'placement instruction position',
)
replace_once(
    page,
    """{mode === 'draw-route' && <div className=\"absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-emerald-200 bg-white/95 p-1.5 shadow-xl backdrop-blur\">""",
    """{mode === 'draw-route' && <div className=\"absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-emerald-200 bg-white/95 p-1.5 shadow-xl backdrop-blur\">""",
    'route instruction position',
)
