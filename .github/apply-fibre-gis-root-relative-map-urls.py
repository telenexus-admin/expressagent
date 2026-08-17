from pathlib import Path

path = Path('backend/src/routes/noc.js')
text = path.read_text()
old = '''function rewriteOpenFreeMapJson(value, req) {
  const proxyBase = mapProxyAbsoluteBase(req);
  return String(value || '')
    .replaceAll('https://tiles.openfreemap.org', proxyBase)
    .replaceAll('http://tiles.openfreemap.org', proxyBase);
}
'''
new = '''function rewriteOpenFreeMapJson(value, req) {
  const proxyBase = mapProxyAbsoluteBase(req);
  const rewriteUrl = (input) => {
    if (typeof input !== 'string') return input;
    if (input.startsWith('https://tiles.openfreemap.org')) {
      return `${proxyBase}${input.slice('https://tiles.openfreemap.org'.length)}`;
    }
    if (input.startsWith('http://tiles.openfreemap.org')) {
      return `${proxyBase}${input.slice('http://tiles.openfreemap.org'.length)}`;
    }
    if (input.startsWith('/') && !input.startsWith('//')) {
      return `${proxyBase}${input}`;
    }
    return input;
  };

  try {
    const parsed = JSON.parse(String(value || ''));
    const walk = (node) => {
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        for (const [key, child] of Object.entries(node)) {
          node[key] = walk(child);
        }
        return node;
      }
      return rewriteUrl(node);
    };
    return JSON.stringify(walk(parsed));
  } catch (_) {
    return rewriteUrl(String(value || ''));
  }
}
'''
if old not in text:
    raise SystemExit('target rewrite function not found')
path.write_text(text.replace(old, new))
