import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';
import { ChartIcon, CogIcon, PulseIcon, UsersIcon, WarningIcon } from '../components/Icons';

const purple = '#7c3aed';
const cyan = '#22d3ee';

function formatNumber(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function MiniLine({ points = [], height = 44, color = purple }) {
  const clean = points.map(Number).filter((n) => Number.isFinite(n));
  if (clean.length < 2) return <div className="h-11 rounded-xl bg-white/5" />;
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
          style={{ height: `${Math.max(12, (value / max) * 48)}px`, background: `linear-gradient(180deg, ${color}, rgba(124,58,237,0.18))` }}
        />
      ))}
    </div>
  );
}

function Donut({ value }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="relative mx-auto h-32 w-32">
      <svg viewBox="0 0 110 110" className="-rotate-90">
        <circle cx="55" cy="55" r={radius} fill="none" stroke="rgba(148,163,184,.2)" strokeWidth="13" />
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
      <div className="absolute inset-0 flex items-center justify-center text-2xl font-black text-[#0b1026] theme-dark:text-white">{formatNumber(safe, '%')}</div>
    </div>
  );
}

function TrafficChart({ history, mode }) {
  const rows = history.slice(-80);
  const values = rows.map((row) => {
    if (mode === 'CPU') return Number(row.cpu_load || 0);
    if (mode === 'PPPoE') return Number(row.pppoe_count || 0);
    if (mode === 'Hotspot') return Number(row.hotspot_count || 0);
    if (mode === 'Queues') return Number(row.router_health_percent || 0);
    return Number(row.download_mbps || 0);
  });
  const upload = rows.map((row) => Number(row.upload_mbps || 0));
  const max = Math.max(1, ...values, ...(mode === 'WAN' ? upload : []));
  const line = (items, h = 260) => items.map((value, index) => {
    const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 1000;
    const y = h - (Number(value || 0) / max) * (h - 24) - 12;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="relative h-[320px] overflow-hidden rounded-[28px] border border-[#dce3f4] bg-white/70 p-4 shadow-sm theme-dark:border-white/10 theme-dark:bg-[#0d111a]">
      <svg viewBox="0 0 1000 300" className="h-full w-full">
        {[60, 120, 180, 240].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="currentColor" className="text-slate-200 theme-dark:text-white/10" strokeDasharray="8 8" />)}
        <path d={`${line(values)} L 1000 300 L 0 300 Z`} fill="url(#noc-area)" opacity="0.34" />
        <path d={line(values)} fill="none" stroke={purple} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {mode === 'WAN' && <path d={line(upload)} fill="none" stroke={cyan} strokeWidth="4" strokeDasharray="12 10" strokeLinecap="round" strokeLinejoin="round" />}
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

export default function NocOverview() {
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [tab, setTab] = useState('WAN');
  const [error, setError] = useState('');
  const polling = useRef(null);

  const selectedRouterId = routerId || routers[0]?.id || '';
  const totalTrend = useMemo(() => history.map((row) => Number(row.download_mbps || 0) + Number(row.upload_mbps || 0)), [history]);
  const pppTrend = useMemo(() => history.map((row) => row.pppoe_count), [history]);
  const hotspotTrend = useMemo(() => history.map((row) => row.hotspot_count), [history]);
  const healthTrend = useMemo(() => history.map((row) => row.router_health_percent), [history]);

  async function loadRouters() {
    const { data } = await api.get('/noc/routers');
    setRouters(data || []);
    if (!routerId && data?.[0]?.id) setRouterId(String(data[0].id));
  }

  async function refresh(id = selectedRouterId) {
    if (!id) return;
    try {
      setError('');
      const [overviewResult, historyResult, statusResult] = await Promise.all([
        api.get('/noc/overview', { params: { router_id: id } }),
        api.get('/noc/traffic/history', { params: { router_id: id, range: '6h' } }),
        api.get('/noc/status', { params: { router_id: id } }),
      ]);
      setOverview(overviewResult.data);
      setHistory(historyResult.data || []);
      setStatusRows(statusResult.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'NOC data is unavailable from the live router right now.');
    }
  }

  useEffect(() => { loadRouters().catch((err) => setError(err.response?.data?.error || 'Could not load NOC routers.')); }, []);

  useEffect(() => {
    if (!selectedRouterId) return undefined;
    refresh(selectedRouterId);
    polling.current = setInterval(() => refresh(selectedRouterId), 3000);
    return () => clearInterval(polling.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouterId]);

  return (
    <div className="min-h-full rounded-[34px] border border-[#dce3f4] bg-[#f7f8ff] p-4 text-[#0b1026] theme-dark:border-white/10 theme-dark:bg-[#05070c] theme-dark:text-white sm:p-6">
      <div className="mx-auto max-w-[1180px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d8ddff] bg-white text-[#7c3aed] shadow-sm theme-dark:border-white/10 theme-dark:bg-white/5">
              <ChartIcon className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-normal sm:text-4xl">NOC Overview</h1>
              <p className="mt-1 text-sm font-semibold text-[#657194] theme-dark:text-slate-400">Real-time MikroTik traffic, clients, and network health</p>
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

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Total Traffic" value={`${formatNumber(overview?.total_traffic_mbps)} Mbps`} helper="Current WAN Throughput" trend={overview?.wan_interface ? `WAN ${overview.wan_interface}` : 'WAN not configured'}>
            <MiniLine points={totalTrend} />
          </MetricCard>
          <MetricCard title="Active PPPoE" value={formatNumber(overview?.active_pppoe)} helper="Online Homes">
            <Donut value={statusRows.find((row) => row.item === 'PPPoE Sessions')?.status === 'Active' ? 86 : 0} />
          </MetricCard>
          <MetricCard title="Hotspot Users" value={formatNumber(overview?.active_hotspot)} helper="Live Sessions" trend={history.length ? 'Live RouterOS active sessions' : 'No history yet'}>
            <MiniLine points={hotspotTrend} color={cyan} />
          </MetricCard>
          <MetricCard title="Router Health" value={`${formatNumber(overview?.router_health_percent)}%`} helper="System Availability" trend={overview?.wan_status || 'No status'}>
            <Bars values={healthTrend} />
          </MetricCard>
        </section>

        <section className="mt-5 rounded-[30px] border border-[#dce3f4] bg-white/80 p-5 shadow-sm theme-dark:border-white/10 theme-dark:bg-[linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-black">Traffic Trends</h2>
            <div className="flex flex-wrap gap-2">
              {['WAN', 'PPPoE', 'Hotspot', 'Queues', 'CPU'].map((item) => (
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
            <span><span className="mr-2 inline-block h-1.5 w-8 rounded-full bg-[#7c3aed]" />Download / primary metric</span>
            <span><span className="mr-2 inline-block h-1.5 w-8 rounded-full bg-[#22d3ee]" />Upload on WAN</span>
            <span>Download uses WAN RX. Upload uses WAN TX.</span>
          </div>
        </section>

        <section className="mt-5 rounded-[30px] border border-[#dce3f4] bg-white/80 p-5 shadow-sm theme-dark:border-white/10 theme-dark:bg-[linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025))]">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black">NOC Status</h2>
            <span className="rounded-2xl border border-[#dce3f4] px-4 py-2 text-xs font-black text-[#657194] theme-dark:border-white/10 theme-dark:text-slate-300">Live check</span>
          </div>
          <div className="mt-4 divide-y divide-[#e6ebf6] overflow-hidden rounded-2xl border border-[#e6ebf6] theme-dark:divide-white/10 theme-dark:border-white/10">
            {statusRows.length === 0 ? (
              <div className="p-5 text-sm font-bold text-[#657194] theme-dark:text-slate-400">No NOC status rows yet. Link and test a MikroTik router first.</div>
            ) : statusRows.map((row) => (
              <div key={row.item} className="grid gap-4 p-4 sm:grid-cols-[1.1fr_1fr_.8fr_1.2fr] sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#dce3f4] bg-white text-[#7c3aed] theme-dark:border-white/10 theme-dark:bg-white/5">
                    {row.item.includes('PPPoE') || row.item.includes('Hotspot') ? <UsersIcon className="h-5 w-5" /> : row.status === 'Attention' ? <WarningIcon className="h-5 w-5" /> : <PulseIcon className="h-5 w-5" />}
                  </div>
                  <p className="font-black">{row.item}</p>
                </div>
                <div>
                  <p className="text-sm font-black">{row.metric}</p>
                  <MiniLine points={row.trend || []} height={30} />
                </div>
                <div className="flex items-center gap-2 text-sm font-black">
                  <span className={`h-2.5 w-2.5 rounded-full ${row.status === 'Healthy' || row.status === 'Stable' || row.status === 'Active' || row.status === 'Optimized' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {row.status}
                </div>
                <p className="text-sm font-semibold text-[#657194] theme-dark:text-slate-400">{row.note}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
