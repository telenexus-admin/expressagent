from pathlib import Path

path = Path('frontend/src/pages/BillingWorkspace.jsx')
text = path.read_text()


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'{label} marker not found')
    text = text.replace(old, new, 1)


replace_once(
    "const BillingAgents = lazy(() => import('./BillingAgents'));\n",
    "const BillingAgents = lazy(() => import('./BillingAgents'));\nconst BillingNoc = lazy(() => import('./BillingNoc'));\n",
    'NOC lazy import',
)

replace_once(
    "  ['vouchers', 'Vouchers', 'ticket'],\n  ['routers', 'Routers', 'router'],\n",
    "  ['vouchers', 'Vouchers', 'ticket'],\n  ['noc', 'NOC', 'pulse'],\n  ['routers', 'Routers', 'router'],\n",
    'NOC nav item',
)

replace_once(
    "    keys: [\n      'routers',\n      'radius',\n      'tr069',\n    ],\n",
    "    keys: [\n      'noc',\n      'routers',\n      'radius',\n      'tr069',\n    ],\n",
    'NOC network group',
)

replace_once(
    "        {tab === 'vouchers' && <Vouchers plans={hotspotPlans} vouchers={vouchers} form={voucherForm} setForm={setVoucherForm} generate={generateVouchers} simulate={simulateVoucher} saving={saving} reload={load} setError={setError} />}\n        {tab === 'routers' && <Routers routers={routers} form={routerForm} setForm={setRouterForm} plan={routerPlan} setPlan={setRouterPlan} prepare={prepareRouter} reload={loadDetails} test={testRouter} provision={previewRouterProvision} notice={routerNotice} saving={saving} darkMode={darkMode} />}\n",
    "        {tab === 'vouchers' && <Vouchers plans={hotspotPlans} vouchers={vouchers} form={voucherForm} setForm={setVoucherForm} generate={generateVouchers} simulate={simulateVoucher} saving={saving} reload={load} setError={setError} />}\n        {tab === 'noc' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingNoc onOpenRouters={() => go('routers')} /></Suspense>}\n        {tab === 'routers' && <Routers routers={routers} form={routerForm} setForm={setRouterForm} plan={routerPlan} setPlan={setRouterPlan} prepare={prepareRouter} reload={loadDetails} test={testRouter} provision={previewRouterProvision} notice={routerNotice} saving={saving} darkMode={darkMode} />}\n",
    'NOC render block',
)

replace_once(
    "    dashboard: <><rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"2\" /><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"4.5\" rx=\"2\" /><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"2\" /><rect x=\"13.5\" y=\"10.5\" width=\"7\" height=\"10\" rx=\"2\" /></>,\n    clients:",
    "    dashboard: <><rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"2\" /><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"4.5\" rx=\"2\" /><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"2\" /><rect x=\"13.5\" y=\"10.5\" width=\"7\" height=\"10\" rx=\"2\" /></>,\n    pulse: <><path d=\"M3 12h4l2.2-5 4.1 10 2.3-5H21\" /><circle cx=\"7\" cy=\"12\" r=\"1\" /><circle cx=\"17\" cy=\"12\" r=\"1\" /></>,\n    clients:",
    'NOC navigation icon',
)

path.write_text(text)
