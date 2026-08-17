import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    pulse: <><path d="M3 12h4l2.2-5 4.1 10 2.3-5H21" /></>,
    router: <><rect x="3" y="7" width="18" height="10" rx="3" /><path d="M7 12h.01M11 12h.01M15 12h2M8 7V4m8 3V4" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9.5" r="2.2" /><path d="M16 15.5a4.5 4.5 0 0 1 4.5 4.5" /></>,
    down: <><path d="M12 4v13" /><path d="m7 12 5 5 5-5" /></>,
    up: <><path d="M12 20V7" /><path d="m7 12 5-5 5 5" /></>,
    cpu: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></>,
    memory: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M8 10h8M8 14h5" /></>,
    storage: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
    alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 3.1 7.7 7 9.5 3.9-1.8 7-5 7-9.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    interface: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h10M7 13h4M15 13h2" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.pulse}</svg>;
}

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));
const compactNumber = (value) => Number(value || 0).toLocaleString();
const formatMbps = (value) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} Mbps`;
const statusText = (value) => String(value || '').trim().toLowerCase();

function toneForHealth(value) {
  const health = Number(value || 0);
  if (health >= 90) return 'emerald';
  if (health >= 70) return 'amber';
  if (health > 0) return 'rose';
  return 'slate';
}

function Pill({ tone = 'slate', children }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    blue: 'border-sky-200 bg-sky-50 text-sky-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.11em] ${tones[tone] || tones.slate}`}>{children}</span>;
}

function MetricCard({ icon, label, value, note, tone = 'emerald' }) {
  const iconTones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    blue: 'bg-sky-50 text-sky-700 ring-sky-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,.045)]"><div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-4 ${iconTones[tone] || iconTones.slate}`}><Icon name={icon} className="h-5 w-5" /></span><div className="min-w-0 text-right"><div className="text-[9px] font-extrabold uppercase tracking-[.16em] text-slate-400">{label}</div><div className="mt-1 truncate text-[20px] font-black tracking-[-.03em] text-slate-950">{value}</div></div></div><p className="mt-3 min-h-[32px] text-[11px] leading-4 text-slate-500">{note}</p></section>;
}

function Gauge({ label, value, icon }) {
  const amount = value === null || value === undefined ? null : clamp(value);
  const tone = amount === null ? 'bg-slate-300' : amount >= 85 ? 'bg-rose-500' : amount >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-slate-600"><Icon name={icon} className="h-[18px] w-[18px]" /></span><span className="text-xs font-bold text-slate-600">{label}</span></div><b className="text-sm text-slate-950">{amount === null ? '—' : `${amount}%`}</b></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${amount ?? 0}%` }} /></div></div>;
}

function TrafficChart({ rows }) {
  const data = Array.isArray(rows) ? rows.slice(-36) : [];
  if (!data.length) return <div className="flex h-[180px] items-center justify-center text-xs font-semibold text-slate-400">Traffic history will appear after NOC samples are collected.</div>;
  const values = data.flatMap((row) => [Number(row.download_mbps || 0), Number(row.upload_mbps || 0)]);
  const max = Math.max(1, ...values);
  const width = 720; const height = 180; const pad = 14; const usableWidth = width - pad * 2; const usableHeight = height - pad * 2;
  const point = (row, index, key) => { const x = pad + (data.length <= 1 ? 0 : (index / (data.length - 1)) * usableWidth); const y = pad + usableHeight - (Number(row[key] || 0) / max) * usableHeight; return `${x.toFixed(1)},${y.toFixed(1)}`; };
  const down = data.map((row, index) => point(row, index, 'download_mbps')).join(' ');
  const up = data.map((row, index) => point(row, index, 'upload_mbps')).join(' ');
  return <div><svg viewBox={`0 0 ${width} ${height}`} className="h-[180px] w-full" role="img" aria-label="NOC traffic graph">{[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={pad + usableHeight * ratio} y2={pad + usableHeight * ratio} stroke="currentColor" className="text-slate-100" strokeWidth="1" />)}<polyline points={down} fill="none" stroke="#10b981" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /><polyline points={up} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity=".85" /></svg><div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-400"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />Download</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-500" />Upload</span></div></div>;
}

function EmptyNoc({ onOpenRouters }) {
  return <section className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-16 text-center shadow-sm"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-4 ring-emerald-100"><Icon name="router" className="h-7 w-7" /></span><h2 className="mt-5 text-2xl font-black text-slate-950">Connect a router to activate NOC</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">The NOC reads live RouterOS health, interfaces, sessions, traffic and alerts from your linked MikroTik routers.</p><button type="button" onClick={onOpenRouters} className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-600"><Icon name="router" className="h-4 w-4" />Open Routers</button></section>;
}

export default function BillingNoc({ onOpenRouters }) {
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadRouters = useCallback(async () => {
    const { data } = await api.get('/noc/routers');
    const list = Array.isArray(data) ? data : [];
    setRouters(list);
    setRouterId((current) => current || String(list.find((router) => router.is_active !== false)?.id || list[0]?.id || ''));
    return list;
  }, []);

  const loadNoc = useCallback(async ({ quiet = false, selectedRouterId = routerId } = {}) => {
    if (!selectedRouterId) return;
    if (!quiet) setRefreshing(true);
    const query = `?router_id=${encodeURIComponent(selectedRouterId)}`;
    try {
      const [overviewResult, historyResult, statusResult, analysisResult] = await Promise.all([
        api.get(`/noc/overview${query}`),
        api.get(`/noc/traffic/history${query}&range=6h`).catch(() => ({ data: [] })),
        api.get(`/noc/status${query}`).catch(() => ({ data: [] })),
        api.get(`/noc/analysis${query}`).catch(() => ({ data: null })),
      ]);
      setSnapshot(overviewResult.data || null);
      setHistory(Array.isArray(historyResult.data) ? historyResult.data : []);
      setStatusRows(Array.isArray(statusResult.data) ? statusResult.data : []);
      setAnalysis(analysisResult.data || null);
      setError('');
      setLastUpdated(new Date());
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'NOC could not read the selected router.');
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [routerId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const list = await loadRouters();
        if (!mounted) return;
        const first = String(list.find((router) => router.is_active !== false)?.id || list[0]?.id || '');
        if (first) await loadNoc({ selectedRouterId: first });
      } catch (requestError) {
        if (mounted) setError(requestError.response?.data?.error || 'NOC could not load your routers.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [loadRouters]);

  useEffect(() => {
    if (!routerId || loading) return undefined;
    void loadNoc({ quiet: false, selectedRouterId: routerId });
    const timer = window.setInterval(() => void loadNoc({ quiet: true, selectedRouterId: routerId }), 10000);
    return () => window.clearInterval(timer);
  }, [routerId, loading, loadNoc]);

  const router = useMemo(() => routers.find((item) => String(item.id) === String(routerId)) || null, [routers, routerId]);
  const onlineRouters = useMemo(() => routers.filter((item) => ['online', 'active'].includes(statusText(item.last_status || item.status))).length, [routers]);
  const offlineRouters = useMemo(() => routers.filter((item) => ['offline', 'error', 'failed'].includes(statusText(item.last_status || item.status))).length, [routers]);
  const activeSessions = Number(snapshot?.active_pppoe || 0) + Number(snapshot?.active_hotspot || 0);
  const health = Number(snapshot?.router_health_percent || 0);
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const alerts = Array.isArray(snapshot?.latest_alerts) ? snapshot.latest_alerts : [];
  const interfaces = Array.isArray(snapshot?.interfaces) ? snapshot.interfaces : [];
  const topUsers = Array.isArray(snapshot?.top_users) ? snapshot.top_users : [];

  if (loading) return <div className="space-y-4"><div className="h-36 animate-pulse rounded-[28px] bg-slate-200/70" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-[22px] bg-slate-200/70" />)}</div><div className="h-80 animate-pulse rounded-[28px] bg-slate-200/70" /></div>;
  if (!routers.length) return <EmptyNoc onOpenRouters={onOpenRouters} />;

  return <div className="space-y-4 sm:space-y-5">
    <section className="relative overflow-hidden rounded-[28px] bg-[#071d13] px-4 py-5 text-white shadow-xl shadow-emerald-950/15 sm:px-6 sm:py-6"><div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Pill tone={health >= 90 ? 'emerald' : health >= 70 ? 'amber' : 'rose'}><span className={`h-1.5 w-1.5 rounded-full ${health >= 90 ? 'bg-emerald-500' : health >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`} />{health ? `${health}% health` : 'Live NOC'}</Pill><span className="text-[10px] font-semibold text-emerald-100/70">Auto-refresh 10s</span></div><h2 className="mt-3 text-[27px] font-black tracking-[-.035em]">Network Operations Center</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-emerald-100/75 sm:text-sm">Live RouterOS health, subscriber sessions, traffic, interfaces and operational alerts in one view.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><label className="relative min-w-[220px]"><span className="sr-only">NOC router</span><select value={routerId} onChange={(event) => setRouterId(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-white/15 bg-white/10 px-3 pr-9 text-xs font-bold text-white outline-none backdrop-blur focus:border-emerald-300">{routers.map((item) => <option key={item.id} value={item.id} className="text-slate-900">{item.last_identity || item.name || `Router ${item.id}`}</option>)}</select><Icon name="chevron" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-emerald-100" /></label><button type="button" disabled={refreshing} onClick={() => loadNoc({ selectedRouterId: routerId })} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-black text-white transition hover:bg-white/15 disabled:opacity-50"><Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button></div></div><div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" /></section>
    {error && <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5"><MetricCard icon="shield" label="Network health" value={health ? `${health}%` : '—'} note={snapshot?.source === 'last-good-snapshot' ? 'Showing the last good live snapshot.' : snapshot?.wan_status === 'stable' ? 'Router and WAN are responding normally.' : 'Review WAN and router alerts.'} tone={toneForHealth(health)} /><MetricCard icon="down" label="Download" value={formatMbps(snapshot?.download_mbps)} note={`${snapshot?.wan_interface || 'WAN'} ${snapshot?.wan_link_speed ? `· ${snapshot.wan_link_speed}` : ''}`} tone="emerald" /><MetricCard icon="up" label="Upload" value={formatMbps(snapshot?.upload_mbps)} note={`${formatMbps(snapshot?.total_traffic_mbps)} combined traffic`} tone="blue" /><MetricCard icon="users" label="Active sessions" value={compactNumber(activeSessions)} note={`${compactNumber(snapshot?.active_pppoe)} PPPoE · ${compactNumber(snapshot?.active_hotspot)} Hotspot`} tone="slate" /><div className="col-span-2 xl:col-span-1"><MetricCard icon="alert" label="Alerts" value={compactNumber(snapshot?.active_alerts)} note={`${compactNumber(snapshot?.critical_alerts)} critical · ${compactNumber(snapshot?.warning_alerts)} warning`} tone={Number(snapshot?.active_alerts || 0) ? 'rose' : 'emerald'} /></div></div>
    <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,.045)] sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-emerald-600">Live traffic</p><h3 className="mt-1 text-xl font-black text-slate-950">Bandwidth flow</h3><p className="mt-1 text-xs text-slate-500">Six-hour traffic history for {snapshot?.identity || router?.name || 'selected router'}.</p></div><Pill tone={snapshot?.wan_status === 'stable' ? 'emerald' : 'amber'}><span className={`h-1.5 w-1.5 rounded-full ${snapshot?.wan_status === 'stable' ? 'bg-emerald-500' : 'bg-amber-500'}`} />WAN {snapshot?.wan_status || 'unknown'}</Pill></div><div className="mt-4"><TrafficChart rows={history} /></div></section><section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,.045)] sm:p-5"><div className="flex items-center justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">Router resources</p><h3 className="mt-1 text-xl font-black text-slate-950">System load</h3></div><span className="text-right text-[10px] font-semibold text-slate-400">{snapshot?.board_name || ''}<br />{snapshot?.routeros_version ? `RouterOS ${snapshot.routeros_version}` : ''}</span></div><div className="mt-4 space-y-2.5"><Gauge label="CPU" value={snapshot?.cpu_load} icon="cpu" /><Gauge label="Memory" value={snapshot?.memory_used_percent} icon="memory" /><Gauge label="Storage" value={snapshot?.storage_used_percent} icon="storage" /></div><div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500"><Icon name="clock" className="h-4 w-4 text-emerald-600" /><span>Uptime</span><b className="ml-auto text-slate-800">{snapshot?.uptime || router?.last_uptime || '—'}</b></div></section></div>
    <div className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]"><section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,.045)] sm:p-5"><div className="flex items-center justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">NOC analysis</p><h3 className="mt-1 text-xl font-black text-slate-950">Attention queue</h3></div><Pill tone={analysis?.severity === 'critical' ? 'rose' : analysis?.severity === 'warning' ? 'amber' : 'emerald'}>{analysis?.severity || 'Live'}</Pill></div><p className="mt-2 text-xs leading-5 text-slate-500">{analysis?.summary || 'NOC analysis is waiting for a live router sample.'}</p><div className="mt-4 space-y-2.5">{(findings.length ? findings.slice(0, 5) : [{ severity: 'info', title: 'No active findings', detail: 'No major operational issue is visible in the latest sample.' }]).map((finding, index) => <div key={`${finding.title}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-start gap-2.5"><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${finding.severity === 'critical' ? 'bg-rose-500' : finding.severity === 'warning' ? 'bg-amber-500' : finding.severity === 'watch' ? 'bg-sky-500' : 'bg-emerald-500'}`} /><div className="min-w-0"><b className="block text-xs text-slate-900">{finding.title}</b><p className="mt-1 text-[11px] leading-4 text-slate-500">{finding.detail}</p>{finding.recommendation && <p className="mt-1.5 text-[10px] font-semibold leading-4 text-emerald-700">Action: {finding.recommendation}</p>}</div></div></div>)}</div></section><section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,.045)]"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 sm:px-5"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">Interfaces</p><h3 className="mt-1 text-xl font-black text-slate-950">Live links</h3></div><Pill tone="slate">{interfaces.length} monitored</Pill></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead className="bg-slate-50 text-[9px] font-extrabold uppercase tracking-[.14em] text-slate-400"><tr><th className="px-5 py-3">Interface</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Download</th><th className="px-4 py-3">Upload</th><th className="px-4 py-3">Link</th></tr></thead><tbody className="divide-y divide-slate-100">{interfaces.length ? interfaces.slice(0, 8).map((item) => <tr key={`${item.name}-${item.type}`} className="text-xs"><td className="px-5 py-3.5"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 text-slate-500"><Icon name="interface" className="h-4 w-4" /></span><div><b className="block text-slate-900">{item.name || 'Interface'}</b><span className="text-[10px] text-slate-400">{item.type || item.comment || ''}</span></div></div></td><td className="px-4 py-3.5"><Pill tone={item.status === 'running' ? 'emerald' : item.status === 'disabled' ? 'slate' : 'rose'}>{item.status || 'unknown'}</Pill></td><td className="px-4 py-3.5 font-bold text-emerald-700">{formatMbps(item.rx_mbps)}</td><td className="px-4 py-3.5 font-bold text-sky-700">{formatMbps(item.tx_mbps)}</td><td className="px-4 py-3.5 text-slate-500">{item.link_speed || '—'}</td></tr>) : <tr><td colSpan="5" className="px-5 py-12 text-center text-xs text-slate-400">No live interface data returned.</td></tr>}</tbody></table></div></section></div>
    <div className="grid gap-4 xl:grid-cols-2"><section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,.045)] sm:p-5"><div className="flex items-center justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">Subscriber traffic</p><h3 className="mt-1 text-xl font-black text-slate-950">Top active queues</h3></div><Icon name="users" className="h-5 w-5 text-emerald-600" /></div><div className="mt-4 space-y-2">{topUsers.length ? topUsers.slice(0, 7).map((user, index) => <div key={`${user.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-[10px] font-black text-slate-500 ring-1 ring-slate-200">{index + 1}</span><div className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-900">{user.name}</b><span className="block truncate text-[10px] text-slate-400">{user.target || user.service || 'Queue'}</span></div><b className="text-xs text-slate-800">{formatMbps(user.total_mbps)}</b></div>) : <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">No active queue traffic is being returned right now.</div>}</div></section><section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,.045)] sm:p-5"><div className="flex items-center justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">RouterOS events</p><h3 className="mt-1 text-xl font-black text-slate-950">Latest alerts</h3></div><Icon name="alert" className="h-5 w-5 text-amber-500" /></div><div className="mt-4 space-y-2">{alerts.length ? alerts.slice(0, 7).map((alert, index) => <div key={`${alert.time}-${index}`} className="rounded-xl border border-slate-100 px-3 py-2.5"><div className="flex items-start gap-2.5"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="truncate text-[10px] uppercase tracking-wide text-amber-700">{alert.topics || 'Router event'}</b><span className="shrink-0 text-[9px] text-slate-400">{alert.time || ''}</span></div><p className="mt-1 text-[11px] leading-4 text-slate-600">{alert.message || 'RouterOS reported an event.'}</p></div></div></div>) : <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-xs text-emerald-700"><Icon name="check" className="h-5 w-5" /><b>No warning or critical RouterOS logs in the latest sample.</b></div>}</div></section></div>
    <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_10px_35px_rgba(15,23,42,.045)] sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[.18em] text-slate-400">Network fleet</p><h3 className="mt-1 text-xl font-black text-slate-950">Routers</h3></div><div className="flex gap-2"><Pill tone="emerald">{onlineRouters} online</Pill>{offlineRouters > 0 && <Pill tone="rose">{offlineRouters} offline</Pill>}<Pill tone="slate">{routers.length} total</Pill></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{routers.map((item) => { const state = statusText(item.last_status || item.status); const isOnline = ['online', 'active'].includes(state); return <button key={item.id} type="button" onClick={() => setRouterId(String(item.id))} className={`rounded-2xl border p-3 text-left transition ${String(item.id) === String(routerId) ? 'border-emerald-400 bg-emerald-50/70 ring-2 ring-emerald-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}><div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><Icon name="router" className="h-[18px] w-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="truncate text-xs text-slate-900">{item.last_identity || item.name || `Router ${item.id}`}</b><span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : state === 'error' || state === 'offline' ? 'bg-rose-500' : 'bg-amber-400'}`} /></div><p className="mt-1 truncate text-[10px] text-slate-400">{item.host || item.wireguard_tunnel_ip || 'No address'} · {item.last_version || 'RouterOS'}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">{item.last_uptime ? `Uptime ${item.last_uptime}` : item.last_error || 'Waiting for health sample'}</p></div></div></button>; })}</div></section>
    <div className="flex flex-col gap-1 px-1 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>{lastUpdated ? `Last live refresh ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for live refresh'}</span><span>{statusRows.length ? `${statusRows.length} NOC status checks active` : 'Live RouterOS monitoring'}</span></div>
  </div>;
}
