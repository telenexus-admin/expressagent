from pathlib import Path

backend = Path('backend/src/routes/noc.js')
text = backend.read_text()
old = """    res.status(status);\n    res.setHeader('Content-Type', contentType);\n    res.setHeader('Cache-Control', upstream.headers['cache-control'] || 'public, max-age=86400');\n    const etag = upstream.headers.etag;\n"""
new = """    const needsRewrite = contentType.includes('json') || path.startsWith('styles/');\n\n    res.status(status);\n    res.setHeader('Content-Type', contentType);\n    res.setHeader('Cache-Control', needsRewrite ? 'no-store, max-age=0' : (upstream.headers['cache-control'] || 'public, max-age=86400'));\n    const etag = upstream.headers.etag;\n"""
if old not in text:
    raise SystemExit('backend cache header block not found')
text = text.replace(old, new, 1)
old_dup = """\n    const needsRewrite = contentType.includes('json') || path.startsWith('styles/');\n    if (needsRewrite || status < 200 || status >= 300) {\n"""
new_dup = """\n    if (needsRewrite || status < 200 || status >= 300) {\n"""
if old_dup not in text:
    raise SystemExit('backend needsRewrite block not found')
text = text.replace(old_dup, new_dup, 1)
backend.write_text(text)

frontend = Path('frontend/src/pages/BillingFibreGis.jsx')
text = frontend.read_text()
old = "const MAP_STYLE = '/api/noc/fibre-gis/map/styles/liberty';"
new = "const MAP_STYLE = '/api/noc/fibre-gis/map/styles/liberty?polyizon_map_v=20260818-1';"
if old not in text:
    raise SystemExit('frontend MAP_STYLE line not found')
frontend.write_text(text.replace(old, new, 1))
