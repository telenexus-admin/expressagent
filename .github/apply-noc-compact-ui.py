from pathlib import Path

noc = Path('frontend/src/pages/BillingNoc.jsx')
text = noc.read_text()

old_metric = '''  return <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,.045)]"><div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-4 ${iconTones[tone] || iconTones.slate}`}><Icon name={icon} className="h-5 w-5" /></span><div className="min-w-0 text-right"><div className="text-[9px] font-extrabold uppercase tracking-[.16em] text-slate-400">{label}</div><div className="mt-1 truncate text-[20px] font-black tracking-[-.03em] text-slate-950">{value}</div></div></div><p className="mt-3 min-h-[32px] text-[11px] leading-4 text-slate-500">{note}</p></section>;'''
new_metric = '''  return <section className="rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-2"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-2 ${iconTones[tone] || iconTones.slate}`}><Icon name={icon} className="h-4 w-4" /></span><div className="min-w-0 text-right"><div className="text-[8px] font-extrabold uppercase tracking-[.14em] text-slate-400">{label}</div><div className="mt-0.5 truncate text-[16px] font-black tracking-[-.03em] text-slate-950">{value}</div></div></div><p className="mt-2 min-h-[24px] text-[9px] leading-[13px] text-slate-500">{note}</p></section>;'''
if old_metric not in text:
    raise SystemExit('metric card marker not found')
text = text.replace(old_metric, new_metric, 1)

old_gauge = '''  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-slate-600"><Icon name={icon} className="h-[18px] w-[18px]" /></span><span className="text-xs font-bold text-slate-600">{label}</span></div><b className="text-sm text-slate-950">{amount === null ? '—' : `${amount}%`}</b></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${amount ?? 0}%` }} /></div></div>;'''
new_gauge = '''  return <div className="rounded-xl border border-slate-200 bg-white p-2.5"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-slate-600"><Icon name={icon} className="h-3.5 w-3.5" /></span><span className="text-[10px] font-bold text-slate-600">{label}</span></div><b className="text-[11px] text-slate-950">{amount === null ? '—' : `${amount}%`}</b></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${amount ?? 0}%` }} /></div></div>;'''
if old_gauge not in text:
    raise SystemExit('gauge marker not found')
text = text.replace(old_gauge, new_gauge, 1)

text = text.replace('h-[180px] items-center justify-center text-xs', 'h-[132px] items-center justify-center text-[10px]', 1)
text = text.replace('const width = 720; const height = 180; const pad = 14;', 'const width = 720; const height = 132; const pad = 12;', 1)
text = text.replace('className="h-[180px] w-full"', 'className="h-[132px] w-full"', 1)
text = text.replace('strokeWidth="3"', 'strokeWidth="2.5"', 1)

start_marker = '  return <div className="space-y-4 sm:space-y-5">'
start = text.find(start_marker)
if start < 0:
    raise SystemExit('NOC render marker not found')
end_marker = '  </div>;\n}'
end = text.rfind(end_marker)
if end < 0:
    raise SystemExit('NOC render end marker not found')

render = r'''  return (
    <div className="-mx-3 -mt-3 min-h-screen bg-[#f7f8fb] pb-16 sm:-mx-8 sm:-mt-8">
      <section className="relative overflow-hidden billing-network-hero bg-[#0a2417] px-5 pb-12 pt-5 text-white sm:px-8">
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-200">Network / NOC</p>
            <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">NOC</h2>
            <p className="mt-1 max-w-xl text-[11px] leading-4 text-emerald-100 sm:text-xs">Live network health, traffic, sessions and RouterOS alerts.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="relative hidden sm:block sm:min-w-[190px]">
              <span className="sr-only">NOC router</span>
              <select value={routerId} onChange={(event) => setRouterId(event.target.value)} className="h-9 w-full appearance-none rounded-xl border border-white/20 bg-white/10 px-3 pr-8 text-[10px] font-bold text-white outline-none backdrop-blur focus:border-emerald-300">
                {routers.map((item) => <option key={item.id} value={item.id} className="text-slate-900">{item.last_identity || item.name || `Router ${item.id}`}</option>)}
              </select>
              <Icon name="chevron" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-emerald-100" />
            </label>
            <button type="button" disabled={refreshing} onClick={() => loadNoc({ selectedRouterId: routerId })} title="Refresh NOC" aria-label="Refresh NOC" className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50">
              <Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="mt-3 sm:hidden">
          <label className="relative block">
            <span className="sr-only">NOC router</span>
            <select value={routerId} onChange={(event) => setRouterId(event.target.value)} className="h-9 w-full appearance-none rounded-xl border border-white/20 bg-white/10 px-3 pr-8 text-[10px] font-bold text-white outline-none">
              {routers.map((item) => <option key={item.id} value={item.id} className="text-slate-900">{item.last_identity || item.name || `Router ${item.id}`}</option>)}
            </select>
            <Icon name="chevron" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-emerald-100" />
          </label>
        </div>
        <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-8">
          <svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full">
            <path d="M0 100 C210 30 330 178 520 112 C735 36 850 170 1040 70 C1110 34 1165 55 1200 32 L1200 180 L0 180 Z" fill="#f7f8fb" />
          </svg>
        </div>
      </section>

      <div className="space-y-3 px-3 sm:px-8">
        {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] font-semibold text-rose-700"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span></div>}

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
          <MetricCard icon="shield" label="Network health" value={health ? `${health}%` : '—'} note={snapshot?.source === 'last-good-snapshot' ? 'Last good live sample.' : snapshot?.wan_status === 'stable' ? 'Router and WAN responding.' : 'Review WAN and alerts.'} tone={toneForHealth(health)} />
          <MetricCard icon="down" label="Download" value={formatMbps(snapshot?.download_mbps)} note={`${snapshot?.wan_interface || 'WAN'} ${snapshot?.wan_link_speed ? `· ${snapshot.wan_link_speed}` : ''}`} tone="emerald" />
          <MetricCard icon="up" label="Upload" value={formatMbps(snapshot?.upload_mbps)} note={`${formatMbps(snapshot?.total_traffic_mbps)} combined`} tone="blue" />
          <MetricCard icon="users" label="Sessions" value={compactNumber(activeSessions)} note={`${compactNumber(snapshot?.active_pppoe)} PPPoE · ${compactNumber(snapshot?.active_hotspot)} Hotspot`} tone="slate" />
          <div className="col-span-2 xl:col-span-1"><MetricCard icon="alert" label="Alerts" value={compactNumber(snapshot?.active_alerts)} note={`${compactNumber(snapshot?.critical_alerts)} critical · ${compactNumber(snapshot?.warning_alerts)} warning`} tone={Number(snapshot?.active_alerts || 0) ? 'rose' : 'emerald'} /></div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.38fr_.62fr]">
          <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-start justify-between gap-2"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-emerald-600">Live traffic</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">Bandwidth flow</h3><p className="mt-0.5 text-[9px] text-slate-400">6-hour traffic · {snapshot?.identity || router?.name || 'selected router'}</p></div><Pill tone={snapshot?.wan_status === 'stable' ? 'emerald' : 'amber'}>WAN {snapshot?.wan_status || 'unknown'}</Pill></div>
            <div className="mt-2"><TrafficChart rows={history} /></div>
          </section>
          <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-2"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-slate-400">Router resources</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">System load</h3></div><span className="text-right text-[8px] font-semibold leading-3 text-slate-400">{snapshot?.board_name || ''}<br />{snapshot?.routeros_version ? `RouterOS ${snapshot.routeros_version}` : ''}</span></div>
            <div className="mt-2 space-y-1.5"><Gauge label="CPU" value={snapshot?.cpu_load} icon="cpu" /><Gauge label="Memory" value={snapshot?.memory_used_percent} icon="memory" /><Gauge label="Storage" value={snapshot?.storage_used_percent} icon="storage" /></div>
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[9px] text-slate-500"><Icon name="clock" className="h-3.5 w-3.5 text-emerald-600" /><span>Uptime</span><b className="ml-auto text-slate-800">{snapshot?.uptime || router?.last_uptime || '—'}</b></div>
          </section>
        </div>

        <div className="grid gap-3 xl:grid-cols-[.7fr_1.3fr]">
          <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-2"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-slate-400">NOC analysis</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">Attention queue</h3></div><Pill tone={analysis?.severity === 'critical' ? 'rose' : analysis?.severity === 'warning' ? 'amber' : 'emerald'}>{analysis?.severity || 'Live'}</Pill></div>
            <p className="mt-1 text-[9px] leading-4 text-slate-500">{analysis?.summary || 'Waiting for a live router sample.'}</p>
            <div className="mt-2 space-y-1.5">{(findings.length ? findings.slice(0, 4) : [{ severity: 'info', title: 'No active findings', detail: 'No major operational issue is visible.' }]).map((finding, index) => <div key={`${finding.title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5"><div className="flex items-start gap-2"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${finding.severity === 'critical' ? 'bg-rose-500' : finding.severity === 'warning' ? 'bg-amber-500' : finding.severity === 'watch' ? 'bg-sky-500' : 'bg-emerald-500'}`} /><div className="min-w-0"><b className="block text-[10px] text-slate-900">{finding.title}</b><p className="mt-0.5 text-[9px] leading-[13px] text-slate-500">{finding.detail}</p>{finding.recommendation && <p className="mt-1 text-[8px] font-semibold leading-[12px] text-emerald-700">Action: {finding.recommendation}</p>}</div></div></div>)}</div>
          </section>

          <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3 sm:px-4"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-slate-400">Interfaces</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">Live links</h3></div><Pill tone="slate">{interfaces.length} monitored</Pill></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[.12em] text-slate-400"><tr><th className="px-4 py-2">Interface</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Down</th><th className="px-3 py-2">Up</th><th className="px-3 py-2">Link</th></tr></thead><tbody className="divide-y divide-slate-100">{interfaces.length ? interfaces.slice(0, 8).map((item) => <tr key={`${item.name}-${item.type}`} className="text-[10px]"><td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-slate-500"><Icon name="interface" className="h-3.5 w-3.5" /></span><div><b className="block text-[10px] text-slate-900">{item.name || 'Interface'}</b><span className="text-[8px] text-slate-400">{item.type || item.comment || ''}</span></div></div></td><td className="px-3 py-2.5"><Pill tone={item.status === 'running' ? 'emerald' : item.status === 'disabled' ? 'slate' : 'rose'}>{item.status || 'unknown'}</Pill></td><td className="px-3 py-2.5 font-bold text-emerald-700">{formatMbps(item.rx_mbps)}</td><td className="px-3 py-2.5 font-bold text-sky-700">{formatMbps(item.tx_mbps)}</td><td className="px-3 py-2.5 text-slate-500">{item.link_speed || '—'}</td></tr>) : <tr><td colSpan="5" className="px-4 py-8 text-center text-[10px] text-slate-400">No live interface data returned.</td></tr>}</tbody></table></div>
          </section>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4"><div className="flex items-center justify-between"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-slate-400">Subscriber traffic</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">Top active queues</h3></div><Icon name="users" className="h-4 w-4 text-emerald-600" /></div><div className="mt-2 space-y-1.5">{topUsers.length ? topUsers.slice(0, 6).map((user, index) => <div key={`${user.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[8px] font-black text-slate-500 ring-1 ring-slate-200">{index + 1}</span><div className="min-w-0 flex-1"><b className="block truncate text-[10px] text-slate-900">{user.name}</b><span className="block truncate text-[8px] text-slate-400">{user.target || user.service || 'Queue'}</span></div><b className="text-[10px] text-slate-800">{formatMbps(user.total_mbps)}</b></div>) : <div className="rounded-lg bg-slate-50 px-3 py-5 text-center text-[9px] text-slate-400">No active queue traffic.</div>}</div></section>
          <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4"><div className="flex items-center justify-between"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-slate-400">RouterOS events</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">Latest alerts</h3></div><Icon name="alert" className="h-4 w-4 text-amber-500" /></div><div className="mt-2 space-y-1.5">{alerts.length ? alerts.slice(0, 6).map((alert, index) => <div key={`${alert.time}-${index}`} className="rounded-lg border border-slate-100 px-2.5 py-2"><div className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="truncate text-[8px] uppercase tracking-wide text-amber-700">{alert.topics || 'Router event'}</b><span className="shrink-0 text-[8px] text-slate-400">{alert.time || ''}</span></div><p className="mt-0.5 text-[9px] leading-[13px] text-slate-600">{alert.message || 'RouterOS reported an event.'}</p></div></div></div>) : <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3 text-[9px] text-emerald-700"><Icon name="check" className="h-4 w-4" /><b>No warning or critical RouterOS logs.</b></div>}</div></section>
        </div>

        <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-[8px] font-extrabold uppercase tracking-[.17em] text-slate-400">Network fleet</p><h3 className="mt-0.5 text-sm font-black text-slate-950 sm:text-base">Routers</h3></div><div className="flex gap-1.5"><Pill tone="emerald">{onlineRouters} online</Pill>{offlineRouters > 0 && <Pill tone="rose">{offlineRouters} offline</Pill>}<Pill tone="slate">{routers.length} total</Pill></div></div><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{routers.map((item) => { const state = statusText(item.last_status || item.status); const isOnline = ['online', 'active'].includes(state); return <button key={item.id} type="button" onClick={() => setRouterId(String(item.id))} className={`rounded-xl border p-2.5 text-left transition ${String(item.id) === String(routerId) ? 'border-emerald-400 bg-emerald-50/70 ring-1 ring-emerald-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}><div className="flex items-start gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><Icon name="router" className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="truncate text-[10px] text-slate-900">{item.last_identity || item.name || `Router ${item.id}`}</b><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : state === 'error' || state === 'offline' ? 'bg-rose-500' : 'bg-amber-400'}`} /></div><p className="mt-0.5 truncate text-[8px] text-slate-400">{item.host || item.wireguard_tunnel_ip || 'No address'} · {item.last_version || 'RouterOS'}</p><p className="mt-0.5 truncate text-[8px] font-semibold text-slate-500">{item.last_uptime ? `Uptime ${item.last_uptime}` : item.last_error || 'Waiting for health sample'}</p></div></div></button>; })}</div></section>

        <div className="flex flex-col gap-0.5 px-1 text-[8px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>{lastUpdated ? `Last refresh ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for live refresh'}</span><span>{statusRows.length ? `${statusRows.length} NOC checks active` : 'Live RouterOS monitoring'}</span></div>
      </div>
    </div>
  );
'''

text = text[:start] + render + '\n}'
noc.write_text(text)

workspace = Path('frontend/src/pages/BillingWorkspace.jsx')
ws = workspace.read_text()
old = "!['subscribers', 'routers', 'hotspot'].includes(tab)"
new = "!['subscribers', 'routers', 'hotspot', 'noc'].includes(tab)"
if old not in ws:
    raise SystemExit('workspace header exclusion marker not found')
workspace.write_text(ws.replace(old, new, 1))
