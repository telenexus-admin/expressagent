from pathlib import Path

p = Path('frontend/src/pages/BillingFibreGis.jsx')
s = p.read_text()
old = """const MAP_STYLE = '/api/noc/fibre-gis/map/styles/liberty';
const MAP_PROXY_PATH = '/api/noc/fibre-gis/map/';

function transformMapRequest(url) {
  if (!String(url || '').includes(MAP_PROXY_PATH)) return { url };
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
}
"""
new = "const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';\n"
if old not in s:
    raise SystemExit('map proxy config marker not found')
s = s.replace(old, new, 1)
marker = "        transformRequest: transformMapRequest,\n"
if marker not in s:
    raise SystemExit('transformRequest marker not found')
s = s.replace(marker, '', 1)
p.write_text(s)
