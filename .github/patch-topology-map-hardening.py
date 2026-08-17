from pathlib import Path

path = Path('frontend/src/pages/BillingTopology.jsx')
text = path.read_text()

old = "  const routerNodes = useMemo(() => (topology?.nodes || []).filter((node) => node.kind === 'router' && Number.isFinite(Number(node.latitude)) && Number.isFinite(Number(node.longitude))), [topology]);"
new = "  const routerNodes = useMemo(() => (topology?.nodes || []).filter((node) => node.kind === 'router' && node.latitude !== null && node.latitude !== undefined && node.latitude !== '' && node.longitude !== null && node.longitude !== undefined && node.longitude !== '' && Number.isFinite(Number(node.latitude)) && Number.isFinite(Number(node.longitude))), [topology]);"
if old not in text:
    raise SystemExit('router coordinate filter marker not found')
text = text.replace(old, new, 1)

old = "        if (![source.latitude, source.longitude, target.latitude, target.longitude].every((value) => Number.isFinite(Number(value)))) return null;"
new = "        if ([source.latitude, source.longitude, target.latitude, target.longitude].some((value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)))) return null;"
if old not in text:
    raise SystemExit('edge coordinate filter marker not found')
text = text.replace(old, new, 1)

old = "        const popup = new maplibregl.Popup({ offset: 24, closeButton: false }).setHTML(`<div style=\"font-family:system-ui;padding:2px 0\"><b>${node.label}</b><div style=\"font-size:11px;color:#64748b;margin-top:3px\">${node.site_label || 'Network site'} · CPU ${node.cpu_load ?? '—'}% · ${fmt(node.wan_traffic_mbps)} Mbps</div></div>`);"
new = "        const popupRoot = document.createElement('div');\n        popupRoot.style.cssText = 'font-family:system-ui;padding:2px 0';\n        const popupTitle = document.createElement('b');\n        popupTitle.textContent = String(node.label || 'Router');\n        const popupDetail = document.createElement('div');\n        popupDetail.style.cssText = 'font-size:11px;color:#64748b;margin-top:3px';\n        popupDetail.textContent = `${node.site_label || 'Network site'} · CPU ${node.cpu_load ?? '—'}% · ${fmt(node.wan_traffic_mbps)} Mbps`;\n        popupRoot.append(popupTitle, popupDetail);\n        const popup = new maplibregl.Popup({ offset: 24, closeButton: false }).setDOMContent(popupRoot);"
if old not in text:
    raise SystemExit('popup marker not found')
text = text.replace(old, new, 1)

path.write_text(text)
