import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';
import { ChartIcon, CogIcon, PulseIcon, UsersIcon, WarningIcon } from '../components/Icons';

const purple = '#7c3aed';
const cyan = '#22d3ee';
const rose = '#fb7185';

function formatNumber(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function statusTone(value) {
  const n = Number(value || 0);
  if (n >= 85) return 'Healthy';
  if (n >= 65) return 'Watch';
  if (n > 0) return 'Attention';
  return 'Offline';
}

function MiniLine({ points = [], height = 44, color = purple }) {
  const clean = points.map(Number).filter((n) => Number.isFinite(n));
  if (clean.length < 2) return <div className="h-11 rounded-xl bg-slate-100 theme-dark:bg-white/5" />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const path = clean.map((value, index) => {
    const x = (index / (clean.length - 1)) * 100;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 100 ${height}`} className="h-11 w-full overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bars({ values = [], color = purple }) {
  const clean = values.map(Number).filter((n) => Number.isFinite(n)).slice(-14);
  const max = Math.max(1, ...clean);
  return (
    <div className="flex h-12 items-end gap-1.5">
      {(clean.length ? clean : [0, 0, 0, 0, 0, 0, 0]).map((value, index) => (
        <span
          key={index}
          className="w-full rounded-t-md"
          style={{ height: `${Math.max(10, (value / max) * 48)}px`, background: `linear-gradient(180deg, ${color}, rgba(124,58,237,0.16))` }}
        />
      ))}
    </div>
  );
}

function Donut({ value, label = 'CPU' }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="relative mx-auto h-32 w-32">
      <svg viewBox="0 0 110 110" className="-rotate-90">
        <circle cx="55" cy="55" r={radius} fill="none" stroke="rgba(148,163,184,.18)" strokeWidth="13" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke="url(#noc-donut)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${(safe / 100) * circumference} ${circumference}`}
        />
        <defs>
          <linearGradient id="noc-donut" x1="0" x2="1">
            <stop stopColor={cyan} />
            <stop offset="1" stopColor={purple} />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-[#0b1026] theme-dark:text-white">{formatNumber(safe, '%')}</span>
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a849f] theme-dark:text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function TrafficChart({ history, mode }) {
  const rows = history.slice(-80);
  const values = rows.map((row) => {
    if (mode === 'CPU') return Number(row.cpu_load || 0);
    if (mode === 'Memory') return Number(row.memory_used_percent || 0);
    if (mode === 'Health') return Number(row.router_health_percent || 0);
    return Number(row.download_mbps || 0) + Number(row.upload_mbps || 0);
  });
  const upload = rows.map((row) => Number(row.upload_mbps || 0));
  const max = Math.max(1, ...values, ...(mode === 'Interfaces' ? upload : []));
  const line = (items, h = 260) => items.map((value, index) => {
    const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 1000;
    const y = h - (Number(value || 0) / max) * (h - 24) - 12;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="relative h-[300px] overflow-hidden rounded-[28px] border border-[#dce3f4] bg-white/70 p-4 shadow-sm theme-dark:border-white/10 theme-dark:bg-[#0a0f18]">
      <svg viewBox="0 0 1000 300" className="h-full w-full">
        {[60, 120, 180, 240].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="currentColor" className="text-slate-200 theme-dark:text-white/10" strokeDasharray="8 8" />)}
        <path d={`${line(values)} L 1000 300 L 0 300 Z`} fill="url(#noc-area)" opacity="0.34" />
        <path d={line(values)} fill="none" stroke={purple} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {mode === 'Interfaces' && <path d={line(upload)} fill="none" stroke={cyan} strokeWidth="4" strokeDasharray="12 10" strokeLinecap="round" strokeLinejoin="round" />}
        <defs>
          <linearGradient id="noc-area" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor={purple} />
            <stop offset="1" stopColor={purple} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      {!rows.length && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm font-bold text-[#7a849f] theme-dark:text-slate-500">
          Waiting for live MikroTik snapshots. No mock traffic is shown here.
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, helper, children, trend }) {
  return (
    <div className="rounded-[26px] border border-[#dce3f4] bg-white/80 p-5 shadow-sm theme-dark:border-white/10 theme-dark:bg-[linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#7a849f] theme-dark:text-slate-400">{title}</p>
      <div className="mt-3 text-3xl font-black text-[#0b1026] theme-dark:text-white">{value}</div>
      <p className="mt-1 text-sm font-semibold text-[#657194] theme-dark:text-slate-400">{helper}</p>
      <div className="mt-5">{children}</div>
      {trend && <p className="mt-4 text-sm font-black text-[#7c3aed] theme-dark:text-[#a78bfa]">{trend}</p>}
    </div>
  );
}

function ProgressBar({ value, color = purple }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100 theme-dark:bg-white/10">
      <span className="block h-full rounded-full" style={{ width: `${safe}%`, background: color }} />
    </div>
  );
}

export default function NocOverview() {
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('Interfaces');
  const [error, setError] = useState('');
  const polling = useRef(null);
  const refreshing = useRef(false);

  const selectedRouterId = routerId || routers[0]?.id || '';
  const totalTrend = useMemo(() => history.map((row) => Number(row.download_mbps || 0) + Number(row.upload_mbps || 0)), [history]);
  const healthTrend = useMemo(() => history.map((row) => row.router_health_percent), [history]);
  const interfaces = overview?.interfaces || [];
  const topUsers = overview?.top_users || [];
  const onlineSessions = Number(overview?.active_pppoe || 0) + Number(overview?.active_hotspot || 0);

  async function loadRouters() {
    const { data } = await api.get('/noc/routers');
    setRouters(data || []);
    if (!routerId && data?.[0]?.id) setRouterId(String(data[0].id));
  }

  async function refresh(id = selectedRouterId) {
    if (!id) return;
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setError('');
      const [overviewResult, historyResult] = await Promise.all([
        api.get('/noc/overview', { params: { router_id: id } }),
        api.get('/noc/traffic/history', { params: { router_id: id, range: '6h' } }),
      ]);
      setOverview(overviewResult.data);
      setHistory(historyResult.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'NOC data is unavailable from the live router right now.');
    } finally {
      refreshing.current = false;
    }
  }

  useEffect(() => { loadRouters().catch((err) => setError(err.response?.data?.error || 'Could not load NOC routers.')); }, []);

  useEffect(() => {
    if (!selectedRouterId) return undefined;
    refresh(selectedRouterId);
    polling.current = setInterval(() => refresh(selectedRouterId), 5000);
    return () => clearInterval(polling.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouterId]);

  return (
    <div className="min-h-full rounded-[34px] border border-[#dce3f4] bg-[#f7f8ff] p-4 pb-10 text-[#0b1026] theme-dark:border-white/10 theme-dark:bg-[#05070c] theme-dark:text-white sm:p-6 sm:pb-12">
      <div className="mx-auto max-w-[1180px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d8ddff] bg-white text-[#7c3aed] shadow-sm theme-dark:border-white/10 theme-dark:bg-white/5">
              <ChartIcon className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-normal sm:text-4xl">NOC Overview</h1>
              <p className="mt-1 text-sm font-semibold text-[#657194] theme-dark:text-slate-400">Live MikroTik uplink traffic, router health, interfaces, and top bandwidth users.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <select value={selectedRouterId} onChange={(event) => setRouterId(event.target.value)} className="h-12 rounded-2xl border border-[#dce3f4] bg-white px-4 text-sm font-black text-[#0b1026] outline-none theme-dark:border-white/10 theme-dark:bg-[#0d111a] theme-dark:text-white">
              {routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
            </select>
            <button type="button" onClick={() => refresh(selectedRouterId)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#dce3f4] bg-white text-[#7c3aed] theme-dark:border-white/10 theme-dark:bg-[#0d111a] theme-dark:text-[#a78bfa]">
              <CogIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {error && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 theme-dark:border-red-500/30 theme-dark:bg-red-500/10 theme-dark:text-red-200">{error}</div>}
        {overview?.source === 'last-good-snapshot' || overview?.traffic_source === 'last-good-snapshot' ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 theme-dark:border-amber-500/30 theme-dark:bg-amber-500/10 theme-dark:text-amber-100">
            Showing the last stable NOC reading while the router finishes the next live sample.
          </div>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Total Traffic" value={`${formatNumber(overview?.total_traffic_mbps)} Mbps`} helper="Live selected uplink throughput" trend={overview?.wan_interface ? `Uplink ${overview.wan_interface}` : 'Uplink auto-detecting'}>
            <MiniLine points={totalTrend} />
          </MetricCard>
          <MetricCard title="Router CPU" value={`${formatNumber(overview?.cpu_load)}%`} helper="Live RouterOS processor load" trend={overview?.cpu_load === null || overview?.cpu_load === undefined ? 'CPU unavailable' : statusTone(100 - Number(overview.cpu_load || 0))}>
            <Donut value={overview?.cpu_load} />
          </MetricCard>
          <MetricCard title="Memory / Storage" value={`${formatNumber(overview?.memory_used_percent)}%`} helper={`Storage ${formatNumber(overview?.storage_used_percent)}% used`}>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs font-black text-[#657194] theme-dark:text-slate-400"><span>Memory</span><span>{formatNumber(overview?.memory_used_percent)}%</span></div>
                <ProgressBar value={overview?.memory_used_percent} color={cyan} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs font-black text-[#657194] theme-dark:text-slate-400"><span>Storage</span><span>{formatNumber(overview?.storage_used_percent)}%</span></div>
                <ProgressBar value={overview?.storage_used_percent} color={rose} />
              </div>
            </div>
          </MetricCard>
          <MetricCard title="Online Sessions" value={formatNumber(onlineSessions)} helper={`PPPoE ${formatNumber(overview?.active_pppoe)} / Hotspot ${formatNumber(overview?.active_hotspot)}`} trend="Read directly from MikroTik">
            <Bars values={healthTrend} />
          </MetricCard>
        </section>

        <section className="mt-5 rounded-[30px] border border-[#dce3f4] bg-white/80 p-5 shadow-sm theme-dark:border-white/10 theme-dark:bg-[linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Traffic Trends</h2>
              <p className="mt-1 text-sm font-semibold text-[#657194] theme-dark:text-slate-400">Interface-first view. Uplink values are live RouterOS monitor-traffic samples.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Interfaces', 'CPU', 'Memory', 'Health'].map((item) => (
                <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${tab === item ? 'bg-[#7c3aed] text-white shadow-lg shadow-purple-500/25' : 'border border-[#dce3f4] text-[#657194] theme-dark:border-white/10 theme-dark:text-slate-300'}`}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <TrafficChart history={history} mode={tab} />
          </div>
          <div className="mt-4 flex flex-wrap gap-5 text-xs font-bold text-[#657194] theme-dark:text-slate-400">
            <span><span className="mr-2 inline-block h-1.5 w-8 rounded-full bg-[#7c3aed]" />Primary metric</span>
            <span><span className="mr-2 inline-block h-1.5 w-8 rounded-full bg-[#22d3ee]" />Upload when viewing interfaces</span>
            <span>Selected uplink: {overview?.wan_interface || 'auto-detecting'}</span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {interfaces.slice(0, 6).map((item) => {
              const total = Number(item.total_mbps || 0);
              const max = Math.max(1, ...interfaces.map((row) => Number(row.total_mbps || 0)));
              return (
                <div key={item.name} className="rounded-2xl border border-[#e6ebf6] bg-white/70 p-4 theme-dark:border-white/10 theme-dark:bg-[#0a0f18]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{item.name}</p>
                      <p className="text-xs font-bold text-[#657194] theme-dark:text-slate-400">{item.type || 'interface'} - {item.status || 'unknown'}{item.link_speed ? ` - ${item.link_speed}` : ''}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${item.status === 'running' ? 'bg-emerald-100 text-emerald-700 theme-dark:bg-emerald-500/15 theme-dark:text-emerald-200' : 'bg-slate-100 text-slate-600 theme-dark:bg-white/10 theme-dark:text-slate-300'}`}>{item.status || 'unknown'}</span>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex justify-between text-xs font-black text-[#657194] theme-dark:text-slate-400"><span>Total</span><span>{formatNumber(total)} Mbps</span></div>
                    <ProgressBar value={(total / max) * 100} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-[#657194] theme-dark:text-slate-400">
                    <span>RX {formatNumber(item.rx_mbps)} Mbps</span>
                    <span>TX {formatNumber(item.tx_mbps)} Mbps</span>
                  </div>
                </div>
              );
            })}
            {!interfaces.length && <div className="rounded-2xl border border-[#e6ebf6] p-5 text-sm font-bold text-[#657194] theme-dark:border-white/10 theme-dark:text-slate-400">No live interface samples returned yet.</div>}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] border border-[#dce3f4] bg-white/80 p-5 shadow-sm theme-dark:border-white/10 theme-dark:bg-[linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Top Users & Bandwidth Usage</h2>
              <p className="mt-1 text-sm font-semibold text-[#657194] theme-dark:text-slate-400">Pulled from MikroTik queue rate data. No estimated/mock users are shown.</p>
            </div>
            <span className="rounded-2xl border border-[#dce3f4] px-4 py-2 text-xs font-black text-[#657194] theme-dark:border-white/10 theme-dark:text-slate-300">Live queues</span>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-[#e6ebf6] theme-dark:border-white/10">
            {topUsers.length === 0 ? (
              <div className="p-5 text-sm font-bold text-[#657194] theme-dark:text-slate-400">Top users unavailable. Enable simple queue rate stats on MikroTik, or wait for active queue traffic.</div>
            ) : topUsers.map((user, index) => {
              const max = Math.max(1, ...topUsers.map((row) => Number(row.total_mbps || 0)));
              return (
                <div key={`${user.name}-${index}`} className="grid gap-4 border-b border-[#e6ebf6] p-4 last:border-b-0 theme-dark:border-white/10 md:grid-cols-[2fr_1fr_1fr_1.5fr] md:items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0e9ff] text-sm font-black text-[#7c3aed] theme-dark:bg-[#7c3aed]/20 theme-dark:text-[#c4b5fd]">{index + 1}</div>
                    <div>
                      <p className="font-black">{user.name}</p>
                      <p className="text-xs font-bold text-[#657194] theme-dark:text-slate-400">{user.target || user.service || 'queue target'}</p>
                    </div>
                  </div>
                  <p className="text-sm font-black">Down {formatNumber(user.download_mbps)} Mbps</p>
                  <p className="text-sm font-black">Up {formatNumber(user.upload_mbps)} Mbps</p>
                  <div>
                    <div className="mb-2 flex justify-between text-xs font-black text-[#657194] theme-dark:text-slate-400"><span>Total</span><span>{formatNumber(user.total_mbps)} Mbps</span></div>
                    <ProgressBar value={(Number(user.total_mbps || 0) / max) * 100} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] border border-[#dce3f4] bg-white/80 p-5 shadow-sm theme-dark:border-white/10 theme-dark:bg-[linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 rounded-2xl border border-[#e6ebf6] p-4 theme-dark:border-white/10">
              <PulseIcon className="h-6 w-6 text-[#7c3aed]" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a849f] theme-dark:text-slate-400">Router</p>
                <p className="font-black">{overview?.identity || overview?.router_name || '--'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-[#e6ebf6] p-4 theme-dark:border-white/10">
              <UsersIcon className="h-6 w-6 text-[#22d3ee]" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a849f] theme-dark:text-slate-400">Uptime</p>
                <p className="font-black">{overview?.uptime || '--'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-[#e6ebf6] p-4 theme-dark:border-white/10">
              <WarningIcon className="h-6 w-6 text-[#fb7185]" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a849f] theme-dark:text-slate-400">Alerts</p>
                <p className="font-black">{formatNumber(overview?.active_alerts)} recent warning log(s)</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
