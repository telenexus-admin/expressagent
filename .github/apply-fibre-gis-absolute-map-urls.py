from pathlib import Path

path = Path('backend/src/routes/noc.js')
text = path.read_text()
old = """function rewriteOpenFreeMapJson(value) {\n  return String(value || '')\n    .replaceAll('https://tiles.openfreemap.org', MAP_PROXY_PREFIX)\n    .replaceAll('http://tiles.openfreemap.org', MAP_PROXY_PREFIX);\n}\n"""
new = """function mapProxyAbsoluteBase(req) {\n  const candidates = [req.get('origin'), req.get('referer')];\n  for (const candidate of candidates) {\n    if (!candidate) continue;\n    try {\n      const parsed = new URL(candidate);\n      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {\n        return `${parsed.origin}${MAP_PROXY_PREFIX}`;\n      }\n    } catch (_) {}\n  }\n\n  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();\n  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();\n  const host = forwardedHost || String(req.get('host') || '').trim();\n  const protocol = forwardedProto === 'https' || forwardedProto === 'http'\n    ? forwardedProto\n    : (req.secure ? 'https' : 'http');\n\n  if (host && /^[a-z0-9.-]+(?::\\d+)?$/i.test(host)) {\n    return `${protocol}://${host}${MAP_PROXY_PREFIX}`;\n  }\n  return MAP_PROXY_PREFIX;\n}\n\nfunction rewriteOpenFreeMapJson(value, req) {\n  const proxyBase = mapProxyAbsoluteBase(req);\n  return String(value || '')\n    .replaceAll('https://tiles.openfreemap.org', proxyBase)\n    .replaceAll('http://tiles.openfreemap.org', proxyBase);\n}\n"""
if old not in text:
    raise SystemExit('rewriteOpenFreeMapJson block not found')
text = text.replace(old, new, 1)
old_call = "return res.send(rewriteOpenFreeMapJson(body));"
new_call = "return res.send(rewriteOpenFreeMapJson(body, req));"
if old_call not in text:
    raise SystemExit('rewriteOpenFreeMapJson call not found')
text = text.replace(old_call, new_call, 1)
path.write_text(text)
