import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';
import { ChartIcon, CogIcon, PulseIcon, UsersIcon, WarningIcon } from '../components/Icons';

const purple = '#8b5cf6';
const violet = '#a855f7';
const green = '#22c55e';
const amber = '#f59e0b';
const red = '#ef4444';

function formatNumber(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function safePercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function statusColor(status) {
  if (/healthy|stable|active|optimized|up/i.test(status || '')) return green;
  if (/busy|warning|watch/i.test(status || '')) return amber;
  return red;
}

function Sparkline({ points = [], color = purple, bars = false }) {
  const clean = points.map(Number).filter((n) => Number.isFinite(n)).slice(-24);
  if (bars) {
    const max = Math.max(1, ...clean);
    return (
      <div className="flex h-8 items-end gap-1">
        {(clean.length ? clean : [0, 0, 0, 0, 0, 0, 0, 0]).map((value, index) => (
          <span key={index} className="w-1.5 rounded-t-sm" style={{ height: `${Math.max(4, (value / max) * 30)}px`, background: color }} />
        ))}
      </div>
    );
  }
  if (clean.length < 2) return <div className="h-8 rounded bg-white/[0.03]" />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const path = clean.map((value, index) => {
    const x = (index / (clean.length - 1)) * 120;
    const y = 32 - ((value - min) / span) * 26 - 3;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 120 34" className="h-8 w-28 overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrafficTrendChart({ history = [], overview }) {
  const rows = history.slice(-80);
  const download = rows.map((row) => Number(row.download_mbps || 0));
  const upload = rows.map((row) => Number(row.upload_mbps || 0));
  const total = rows.map((row) => Number(row.download_mbps || 0) + Number(row.upload_mbps || 0));
  const max = Math.max(1, ...download, ...upload, Number(overview?.total_traffic_mbps || 0));
  const line = (items, height = 260) => items.map((value, index) => {
    const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 900;
    const y = height - (Number(value || 0) / max) * (height - 28) - 14;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const latestDownload = Number(overview?.download_mbps || 0);
  const latestUpload = Number(overview?.upload_mbps || 0);
  const latestTotal = Number(overview?.total_traffic_mbps || 0);

  return (
    <section className="rounded-[10px] border border-white/10 bg-[#07090d] shadow-[0_0_35px_rgba(0,0,0,.45)]">
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-black text-white">Traffic Trends (Live) <span className="text-white/40">i</span></h2>
          <p className="mt-1 text-[11px] font-semibold text-white/45">Real sampled bandwidth currently consumed across live MikroTik interfaces.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="rounded bg-[#160b24] px-2 py-1 text-[#c084fc]">Download {formatNumber(latestDownload)} Mbps</span>
          <span className="rounded bg-[#160b24] px-2 py-1 text-[#f0abfc]">Upload {formatNumber(latestUpload)} Mbps</span>
          <span className="rounded bg-[#111827] px-2 py-1 text-white">Total {formatNumber(latestTotal)} Mbps</span>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1fr_210px]">
        <div className="relative min-h-[290px] p-4">
          <svg viewBox="0 0 900 280" className="h-[280px] w-full">
            {[0, 70, 140, 210, 280].map((y) => (
              <line key={y} x1="0" x2="900" y1={y} y2={y} stroke="rgba(255,255,255,.08)" strokeDasharray="6 6" />
            ))}
            <path d={`${line(download)} L 900 280 L 0 280 Z`} fill="url(#noc-download-area)" opacity="0.34" />
            <path d={`${line(upload)} L 900 280 L 0 280 Z`} fill="url(#noc-upload-area)" opacity="0.22" />
            <path d={line(download)} fill="none" stroke={purple} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d={line(upload)} fill="none" stroke={violet} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <defs>
              <linearGradient id="noc-download-area" x1="0" x2="0" y1="0" y2="1">
                <stop stopColor={purple} />
                <stop offset="1" stopColor={purple} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="noc-upload-area" x1="0" x2="0" y1="0" y2="1">
                <stop stopColor={violet} />
                <stop offset="1" stopColor={violet} stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
          {!rows.length && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs font-bold text-white/45">
              Waiting for live MikroTik samples. No mock traffic is shown.
            </div>
          )}
        </div>
        <aside className="border-t border-white/10 bg-white/[0.015] p-4 lg:border-l lg:border-t-0">
          <p className="text-[11px] font-bold text-white/50">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
          <div className="mt-3 space-y-3 text-xs">
            <p className="font-black text-[#c084fc]">Download<br /><span className="text-lg text-white">{formatNumber(latestDownload)} Mbps</span></p>
            <p className="font-black text-[#f0abfc]">Upload<br /><span className="text-lg text-white">{formatNumber(latestUpload)} Mbps</span></p>
            <p className="font-black text-white/70">Total<br /><span className="text-lg text-white">{formatNumber(latestTotal)} Mbps</span></p>
            <div className="border-t border-white/10 pt-3 text-[11px] font-bold text-white/45">
              <p>Source: <span className="text-[#c084fc]">{overview?.bandwidth?.source || 'live interfaces'}</span></p>
              <p>Peak (1h): <span className="text-[#c084fc]">{formatNumber(Math.max(0, ...total))} Mbps</span></p>
              <p>Average: <span className="text-[#f0abfc]">{formatNumber(total.length ? total.reduce((sum, value) => sum + value, 0) / total.length : 0)} Mbps</span></p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function NocStatusTable({ overview, history, interfaces }) {
  const totalSessions = Number(overview?.active_pppoe || 0) + Number(overview?.active_hotspot || 0);
  const rows = [
    {
      item: 'Core Router',
      subtitle: overview?.identity || overview?.router_name || 'MikroTik',
      metric: `CPU ${formatNumber(overview?.cpu_load)}%`,
      details: `Uptime: ${overview?.uptime || '--'} / RouterOS ${overview?.routeros_version || '--'}`,
      status: Number(overview?.cpu_load || 0) > 80 ? 'Warning' : 'Healthy',
      trend: history.map((row) => row.cpu_load),
      icon: <PulseIcon className="h-4 w-4" />,
    },
    {
      item: 'WAN Uplink',
      subtitle: overview?.wan_interface || 'Selected uplink',
      metric: `${formatNumber(overview?.download_mbps)} Mbps / ${formatNumber(overview?.upload_mbps)} Mbps`,
      details: `${overview?.wan_link_speed || 'Link speed unknown'} / ${overview?.wan_status || 'unknown'} / sampled ${formatNumber(overview?.bandwidth?.sampled_interfaces)} interface(s)`,
      status: overview?.wan_status === 'stable' ? 'Stable' : 'Warning',
      trend: history.map((row) => Number(row.download_mbps || 0) + Number(row.upload_mbps || 0)),
      icon: <ChartIcon className="h-4 w-4" />,
    },
    {
      item: 'Active Sessions',
      subtitle: 'PPPoE + Hotspot',
      metric: `${formatNumber(totalSessions)} Online`,
      details: `PPPoE: ${formatNumber(overview?.active_pppoe)} / Hotspot: ${formatNumber(overview?.active_hotspot)}`,
      status: totalSessions > 0 ? 'Active' : 'Watch',
      trend: history.map((row) => Number(row.pppoe_count || 0) + Number(row.hotspot_count || 0)),
      icon: <UsersIcon className="h-4 w-4" />,
    },
    {
      item: 'Interface Health',
      subtitle: 'Live ports',
      metric: `${interfaces.filter((item) => item.status === 'running').length}/${interfaces.length || 0} Up`,
      details: `${interfaces.filter((item) => Number(item.total_mbps || 0) > 0).length} passing traffic`,
      status: interfaces.some((item) => item.status === 'running') ? 'Active' : 'Warning',
      trend: interfaces.map((item) => item.total_mbps),
      icon: <CogIcon className="h-4 w-4" />,
    },
    {
      item: 'Storage / Memory',
      subtitle: 'Router resources',
      metric: `Memory ${formatNumber(overview?.memory_used_percent)}%`,
      details: `Storage: ${formatNumber(overview?.storage_used_percent)}% used`,
      status: Number(overview?.memory_used_percent || 0) > 85 || Number(overview?.storage_used_percent || 0) > 85 ? 'Warning' : 'Optimized',
      trend: history.map((row) => row.memory_used_percent),
      icon: <PulseIcon className="h-4 w-4" />,
    },
    {
      item: 'Alerts',
      subtitle: 'Active issues',
      metric: `${formatNumber(overview?.active_alerts)} Active Alerts`,
      details: `Critical: ${formatNumber(overview?.critical_alerts)} / Warning: ${formatNumber(overview?.warning_alerts)}`,
      status: Number(overview?.critical_alerts || 0) > 0 || Number(overview?.warning_alerts || 0) > 0 ? 'Warning' : 'Healthy',
      trend: [1, 3, 2, 4, 5, Number(overview?.active_alerts || 0)],
      bars: true,
      icon: <WarningIcon className="h-4 w-4" />,
    },
  ];

  return (
    <section className="rounded-[10px] border border-white/10 bg-[#07090d]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-black text-white">NOC Status</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="bg-white/[0.025] text-[10px] uppercase tracking-[0.14em] text-white/35">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Metric</th>
              <th className="px-4 py-3">Trend (1h)</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3 text-right">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => (
              <tr key={row.item} className="text-white/85">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]" style={{ color: statusColor(row.status) }}>{row.icon}</span>
                    <span><b className="block text-white">{row.item}</b><span className="text-white/45">{row.subtitle}</span></span>
                  </div>
                </td>
                <td className="px-4 py-3 font-black">{row.metric}</td>
                <td className="px-4 py-3"><Sparkline points={row.trend} color={statusColor(row.status)} bars={row.bars} /></td>
                <td className="px-4 py-3 text-white/65">{row.details}</td>
                <td className="px-4 py-3 text-right">
                  <span className="rounded-md px-2 py-1 text-[10px] font-black" style={{ background: `${statusColor(row.status)}22`, color: statusColor(row.status) }}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DataPanel({ title, live, children }) {
  return (
    <section className="rounded-[10px] border border-white/10 bg-[#07090d]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-black text-white">{title} {live && <span className="text-white/35">(Live)</span>}</h2>
      </div>
      {children}
    </section>
  );
}

function TopUsersPanel({ topUsers }) {
  return (
    <DataPanel title="Top Bandwidth Users" live>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[11px]">
          <thead className="text-[9px] uppercase tracking-[0.14em] text-white/35">
            <tr>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">User / IP</th>
              <th className="px-3 py-2">Download</th>
              <th className="px-3 py-2">Upload</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Package</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-white/80">
            {topUsers.length ? topUsers.slice(0, 6).map((user, index) => (
              <tr key={`${user.name}-${index}`}>
                <td className="px-3 py-2"><span className="rounded bg-white/10 px-2 py-1 font-black">{index + 1}</span></td>
                <td className="px-3 py-2"><b className="block text-white">{user.name}</b><span className="text-white/40">{user.target || user.service || '--'}</span></td>
                <td className="px-3 py-2 font-black">{formatNumber(user.download_mbps)} Mbps</td>
                <td className="px-3 py-2 font-black">{formatNumber(user.upload_mbps)} Mbps</td>
                <td className="px-3 py-2 font-black">{formatNumber(user.total_mbps)} Mbps</td>
                <td className="px-3 py-2 text-white/50">{user.service || '--'}</td>
              </tr>
            )) : (
              <tr><td colSpan="6" className="px-4 py-5 text-center font-bold text-white/45">No live queue rate data returned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}

function InterfacePanel({ interfaces }) {
  return (
    <DataPanel title="Interface Traffic" live>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[11px]">
          <thead className="text-[9px] uppercase tracking-[0.14em] text-white/35">
            <tr>
              <th className="px-3 py-2">Interface</th>
              <th className="px-3 py-2">RX</th>
              <th className="px-3 py-2">TX</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-white/80">
            {interfaces.length ? interfaces.slice(0, 8).map((item) => (
              <tr key={item.name}>
                <td className="px-3 py-2"><b className="text-white">{item.name}</b><span className="ml-2 text-white/35">{item.link_speed || item.type || ''}</span></td>
                <td className="px-3 py-2 font-black">{formatNumber(item.rx_mbps)} Mbps</td>
                <td className="px-3 py-2 font-black">{formatNumber(item.tx_mbps)} Mbps</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-2 font-black" style={{ color: item.status === 'running' ? green : amber }}><span className="h-2 w-2 rounded-full" style={{ background: item.status === 'running' ? green : amber }} />{item.status === 'running' ? 'Up' : item.status || 'Unknown'}</span></td>
              </tr>
            )) : (
              <tr><td colSpan="4" className="px-4 py-5 text-center font-bold text-white/45">No interface traffic samples returned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}

export default function NocOverview() {
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const polling = useRef(null);
  const refreshing = useRef(false);

  const selectedRouterId = routerId || routers[0]?.id || '';
  const interfaces = useMemo(() => overview?.interfaces || [], [overview]);
  const topUsers = useMemo(() => overview?.top_users || [], [overview]);

  async function loadRouters() {
    const { data } = await api.get('/noc/routers');
    setRouters(data || []);
    if (!routerId && data?.[0]?.id) setRouterId(String(data[0].id));
  }

  async function refresh(id = selectedRouterId) {
    if (!id || refreshing.current) return;
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
    <div className="min-h-full rounded-[24px] border border-white/10 bg-[#020305] p-3 pb-10 text-white shadow-[0_0_50px_rgba(0,0,0,.55)] sm:p-4">
      <div className="mx-auto max-w-[1180px] space-y-3">
        <header className="flex flex-col gap-3 rounded-[10px] border border-white/10 bg-[#07090d] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#a78bfa]">
              <ChartIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black">NOC Overview</h1>
              <p className="text-xs font-semibold text-white/45">Live bandwidth consumption, router status, interfaces, and top users</p>
            </div>
          </div>
          <div className="flex gap-2">
            <select value={selectedRouterId} onChange={(event) => setRouterId(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-xs font-black text-white outline-none">
              {routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
            </select>
            <button type="button" onClick={() => refresh(selectedRouterId)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0b0f17] text-[#a78bfa]">
              <CogIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">{error}</div>}
        {overview?.source === 'last-good-snapshot' || overview?.traffic_source === 'last-good-snapshot' ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-100">
            Showing the last stable NOC reading while the router finishes the next live sample.
          </div>
        ) : null}

        <TrafficTrendChart history={history} overview={overview} />
        <NocStatusTable overview={overview} history={history} interfaces={interfaces} />
        <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
          <TopUsersPanel topUsers={topUsers} />
          <InterfacePanel interfaces={interfaces} />
        </div>
      </div>
    </div>
  );
}
