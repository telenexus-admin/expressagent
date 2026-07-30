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

function severityColor(severity) {
  if (severity === 'critical') return red;
  if (severity === 'warning') return amber;
  if (severity === 'watch') return purple;
  return green;
}

function textMuted() {
  return 'text-slate-500 theme-dark:text-white/45';
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
  if (clean.length < 2) return <div className="h-8 rounded bg-slate-100 theme-dark:bg-white/[0.03]" />;
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
  const rows = history.slice(-48);
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
    <section className="rounded-[10px] border border-slate-200 bg-white shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d] theme-dark:shadow-[0_0_35px_rgba(0,0,0,.45)]">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 theme-dark:border-white/10 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-black text-slate-950 theme-dark:text-white">Traffic Trends (Live) <span className="text-slate-400 theme-dark:text-white/40">i</span></h2>
          <p className={`mt-1 text-[11px] font-semibold ${textMuted()}`}>Real sampled bandwidth currently consumed across live MikroTik interfaces.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="rounded bg-purple-50 px-2 py-1 text-[#7c3aed] theme-dark:bg-[#160b24] theme-dark:text-[#c084fc]">Download {formatNumber(latestDownload)} Mbps</span>
          <span className="rounded bg-fuchsia-50 px-2 py-1 text-[#a21caf] theme-dark:bg-[#160b24] theme-dark:text-[#f0abfc]">Upload {formatNumber(latestUpload)} Mbps</span>
          <span className="rounded bg-slate-100 px-2 py-1 text-slate-900 theme-dark:bg-[#111827] theme-dark:text-white">Total {formatNumber(latestTotal)} Mbps</span>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1fr_210px]">
        <div className="relative min-h-[260px] p-4">
          <svg viewBox="0 0 900 260" className="h-[260px] w-full">
            {[0, 65, 130, 195, 260].map((y) => (
              <line key={y} x1="0" x2="900" y1={y} y2={y} stroke="currentColor" className="text-slate-200 theme-dark:text-white/10" strokeDasharray="6 6" />
            ))}
            <path d={`${line(download, 240)} L 900 260 L 0 260 Z`} fill="url(#noc-download-area)" opacity="0.30" />
            <path d={`${line(upload, 240)} L 900 260 L 0 260 Z`} fill="url(#noc-upload-area)" opacity="0.18" />
            <path d={line(download, 240)} fill="none" stroke={purple} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d={line(upload, 240)} fill="none" stroke={violet} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
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
            <div className={`absolute inset-0 flex items-center justify-center px-6 text-center text-xs font-bold ${textMuted()}`}>
              Waiting for live MikroTik samples. No mock traffic is shown.
            </div>
          )}
        </div>
        <aside className="border-t border-slate-200 bg-slate-50 p-4 theme-dark:border-white/10 theme-dark:bg-white/[0.015] lg:border-l lg:border-t-0">
          <p className={`text-[11px] font-bold ${textMuted()}`}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
          <div className="mt-3 space-y-3 text-xs">
            <p className="font-black text-[#7c3aed] theme-dark:text-[#c084fc]">Download<br /><span className="text-lg text-slate-950 theme-dark:text-white">{formatNumber(latestDownload)} Mbps</span></p>
            <p className="font-black text-[#a21caf] theme-dark:text-[#f0abfc]">Upload<br /><span className="text-lg text-slate-950 theme-dark:text-white">{formatNumber(latestUpload)} Mbps</span></p>
            <p className="font-black text-slate-600 theme-dark:text-white/70">Total<br /><span className="text-lg text-slate-950 theme-dark:text-white">{formatNumber(latestTotal)} Mbps</span></p>
            <div className={`border-t border-slate-200 pt-3 text-[11px] font-bold theme-dark:border-white/10 ${textMuted()}`}>
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
    <section className="rounded-[10px] border border-slate-200 bg-white shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d]">
      <div className="border-b border-slate-200 px-4 py-3 theme-dark:border-white/10">
        <h2 className="text-sm font-black text-slate-950 theme-dark:text-white">NOC Status</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-400 theme-dark:bg-white/[0.025] theme-dark:text-white/35">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Metric</th>
              <th className="px-4 py-3">Trend (1h)</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3 text-right">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 theme-dark:divide-white/10">
            {rows.map((row) => (
              <tr key={row.item} className="text-slate-700 theme-dark:text-white/85">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 theme-dark:border-white/10 theme-dark:bg-white/[0.04]" style={{ color: statusColor(row.status) }}>{row.icon}</span>
                    <span><b className="block text-slate-950 theme-dark:text-white">{row.item}</b><span className="text-slate-500 theme-dark:text-white/45">{row.subtitle}</span></span>
                  </div>
                </td>
                <td className="px-4 py-3 font-black">{row.metric}</td>
                <td className="px-4 py-3"><Sparkline points={row.trend} color={statusColor(row.status)} bars={row.bars} /></td>
                <td className="px-4 py-3 text-slate-500 theme-dark:text-white/65">{row.details}</td>
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
    <section className="rounded-[10px] border border-slate-200 bg-white shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 theme-dark:border-white/10">
        <h2 className="text-sm font-black text-slate-950 theme-dark:text-white">{title} {live && <span className="text-slate-400 theme-dark:text-white/35">(Live)</span>}</h2>
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
          <thead className="text-[9px] uppercase tracking-[0.14em] text-slate-400 theme-dark:text-white/35">
            <tr>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">User / IP</th>
              <th className="px-3 py-2">Download</th>
              <th className="px-3 py-2">Upload</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Package</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 theme-dark:divide-white/10 theme-dark:text-white/80">
            {topUsers.length ? topUsers.slice(0, 6).map((user, index) => (
              <tr key={`${user.name}-${index}`}>
                <td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-1 font-black theme-dark:bg-white/10">{index + 1}</span></td>
                <td className="px-3 py-2"><b className="block text-slate-950 theme-dark:text-white">{user.name}</b><span className="text-slate-400 theme-dark:text-white/40">{user.target || user.service || '--'}</span></td>
                <td className="px-3 py-2 font-black">{formatNumber(user.download_mbps)} Mbps</td>
                <td className="px-3 py-2 font-black">{formatNumber(user.upload_mbps)} Mbps</td>
                <td className="px-3 py-2 font-black">{formatNumber(user.total_mbps)} Mbps</td>
                <td className="px-3 py-2 text-slate-400 theme-dark:text-white/50">{user.service || '--'}</td>
              </tr>
            )) : (
              <tr><td colSpan="6" className={`px-4 py-5 text-center font-bold ${textMuted()}`}>No live queue rate data returned yet.</td></tr>
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
          <thead className="text-[9px] uppercase tracking-[0.14em] text-slate-400 theme-dark:text-white/35">
            <tr>
              <th className="px-3 py-2">Interface</th>
              <th className="px-3 py-2">RX</th>
              <th className="px-3 py-2">TX</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 theme-dark:divide-white/10 theme-dark:text-white/80">
            {interfaces.length ? interfaces.slice(0, 8).map((item) => (
              <tr key={item.name}>
                <td className="px-3 py-2"><b className="text-slate-950 theme-dark:text-white">{item.name}</b><span className="ml-2 text-slate-400 theme-dark:text-white/35">{item.link_speed || item.type || ''}</span></td>
                <td className="px-3 py-2 font-black">{formatNumber(item.rx_mbps)} Mbps</td>
                <td className="px-3 py-2 font-black">{formatNumber(item.tx_mbps)} Mbps</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-2 font-black" style={{ color: item.status === 'running' ? green : amber }}><span className="h-2 w-2 rounded-full" style={{ background: item.status === 'running' ? green : amber }} />{item.status === 'running' ? 'Up' : item.status || 'Unknown'}</span></td>
              </tr>
            )) : (
              <tr><td colSpan="4" className={`px-4 py-5 text-center font-bold ${textMuted()}`}>No interface traffic samples returned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}

function AnalysisPanel({ analysis, onRefresh }) {
  const findings = analysis?.findings || [];
  const events = analysis?.latest_events || [];
  return (
    <section className="space-y-3">
      <div className="rounded-[10px] border border-slate-200 bg-white p-4 shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7c3aed] theme-dark:text-[#c084fc]">Nexa Analysis</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 theme-dark:text-white">{analysis?.summary || 'Waiting for live router analysis...'}</h2>
            <p className={`mt-1 text-xs font-semibold ${textMuted()}`}>
              Router: {analysis?.router_name || '--'} • Source: {analysis?.live_source || '--'} • Generated {analysis?.generated_at ? new Date(analysis.generated_at).toLocaleTimeString() : '--'}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg bg-[#3535FF] px-4 py-2 text-xs font-black text-white shadow-lg shadow-purple-500/20"
          >
            Refresh analysis
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['CPU', analysis?.metrics?.cpu_load === null || analysis?.metrics?.cpu_load === undefined ? '--' : `${analysis.metrics.cpu_load}%`],
            ['Memory', analysis?.metrics?.memory_used_percent === null || analysis?.metrics?.memory_used_percent === undefined ? '--' : `${analysis.metrics.memory_used_percent}%`],
            ['Storage', analysis?.metrics?.storage_used_percent === null || analysis?.metrics?.storage_used_percent === undefined ? '--' : `${analysis.metrics.storage_used_percent}%`],
            ['Traffic', analysis?.metrics?.total_traffic_mbps === null || analysis?.metrics?.total_traffic_mbps === undefined ? '--' : `${analysis.metrics.total_traffic_mbps} Mbps`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 theme-dark:border-white/10 theme-dark:bg-white/[0.035]">
              <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${textMuted()}`}>{label}</p>
              <p className="mt-1 text-lg font-black text-slate-950 theme-dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
        <section className="rounded-[10px] border border-slate-200 bg-white shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d]">
          <div className="border-b border-slate-200 px-4 py-3 theme-dark:border-white/10">
            <h3 className="text-sm font-black text-slate-950 theme-dark:text-white">Findings</h3>
          </div>
          <div className="divide-y divide-slate-100 theme-dark:divide-white/10">
            {findings.length ? findings.map((item, index) => (
              <div key={`${item.title}-${index}`} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ background: severityColor(item.severity) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-black text-slate-950 theme-dark:text-white">{item.title}</h4>
                      <span className="rounded-md px-2 py-1 text-[9px] font-black uppercase" style={{ background: `${severityColor(item.severity)}22`, color: severityColor(item.severity) }}>{item.severity}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-600 theme-dark:text-white/70">{item.detail}</p>
                    {item.recommendation && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs font-bold leading-5 text-slate-600 theme-dark:bg-white/[0.035] theme-dark:text-white/65">{item.recommendation}</p>}
                  </div>
                </div>
              </div>
            )) : (
              <p className={`p-5 text-center text-sm font-bold ${textMuted()}`}>No analysis findings yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-[10px] border border-slate-200 bg-white shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d]">
          <div className="border-b border-slate-200 px-4 py-3 theme-dark:border-white/10">
            <h3 className="text-sm font-black text-slate-950 theme-dark:text-white">Latest Router Events</h3>
          </div>
          <div className="divide-y divide-slate-100 theme-dark:divide-white/10">
            {events.length ? events.map((event, index) => (
              <div key={`${event.time}-${index}`} className="p-4 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-slate-950 theme-dark:text-white">{event.time || 'Router log'}</span>
                  <span className="rounded bg-slate-100 px-2 py-1 font-black text-slate-500 theme-dark:bg-white/10 theme-dark:text-white/55">{event.topics || 'event'}</span>
                </div>
                <p className="mt-2 font-semibold leading-5 text-slate-600 theme-dark:text-white/70">{event.message || '--'}</p>
              </div>
            )) : (
              <p className={`p-5 text-center text-sm font-bold ${textMuted()}`}>No warning or critical MikroTik logs returned in this sample.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export default function NocOverview() {
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState('live');
  const [error, setError] = useState('');
  const polling = useRef(null);
  const refreshing = useRef(false);
  const historyFetchedAt = useRef(0);
  const analysisFetchedAt = useRef(0);

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
      const shouldFetchHistory = !historyFetchedAt.current || Date.now() - historyFetchedAt.current > 30000;
      const overviewResult = await api.get('/noc/overview', { params: { router_id: id } });
      setOverview(overviewResult.data);
      if (shouldFetchHistory) {
        const historyResult = await api.get('/noc/traffic/history', { params: { router_id: id, range: '6h' } });
        setHistory(historyResult.data || []);
        historyFetchedAt.current = Date.now();
      } else {
        const liveRow = {
          timestamp: overviewResult.data?.checked_at || new Date().toISOString(),
          download_mbps: Number(overviewResult.data?.download_mbps || 0),
          upload_mbps: Number(overviewResult.data?.upload_mbps || 0),
          cpu_load: overviewResult.data?.cpu_load,
          memory_used_percent: overviewResult.data?.memory_used_percent,
          storage_used_percent: overviewResult.data?.storage_used_percent,
          pppoe_count: overviewResult.data?.active_pppoe,
          hotspot_count: overviewResult.data?.active_hotspot,
          router_health_percent: overviewResult.data?.router_health_percent,
        };
        setHistory((current) => {
          const last = current[current.length - 1];
          if (last?.timestamp === liveRow.timestamp) return current;
          return [...current.slice(-47), liveRow];
        });
      }
      const shouldFetchAnalysis = !analysisFetchedAt.current || Date.now() - analysisFetchedAt.current > 30000;
      if (shouldFetchAnalysis) {
        const analysisResult = await api.get('/noc/analysis', { params: { router_id: id } });
        setAnalysis(analysisResult.data);
        analysisFetchedAt.current = Date.now();
      }
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

  useEffect(() => {
    if (activeTab === 'analysis' && selectedRouterId) {
      analysisFetchedAt.current = 0;
      refresh(selectedRouterId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedRouterId]);

  return (
    <div className="min-h-full rounded-[24px] border border-slate-200 bg-white p-3 pb-10 text-slate-950 shadow-sm theme-dark:border-white/10 theme-dark:bg-[#020305] theme-dark:text-white theme-dark:shadow-[0_0_50px_rgba(0,0,0,.55)] sm:p-4">
      <div className="mx-auto max-w-[1180px] space-y-3">
        <header className="flex flex-col gap-3 rounded-[10px] border border-slate-200 bg-white px-4 py-3 shadow-sm theme-dark:border-white/10 theme-dark:bg-[#07090d] md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[#7c3aed] theme-dark:border-white/10 theme-dark:bg-white/[0.04] theme-dark:text-[#a78bfa]">
              <ChartIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black">NOC Overview</h1>
              <p className={`text-xs font-semibold ${textMuted()}`}>Live bandwidth consumption, router status, interfaces, and top users</p>
            </div>
          </div>
          <div className="flex gap-2">
            <select value={selectedRouterId} onChange={(event) => { historyFetchedAt.current = 0; analysisFetchedAt.current = 0; setRouterId(event.target.value); }} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-950 outline-none theme-dark:border-white/10 theme-dark:bg-[#0b0f17] theme-dark:text-white">
              {routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
            </select>
            <button type="button" onClick={() => refresh(selectedRouterId)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#7c3aed] theme-dark:border-white/10 theme-dark:bg-[#0b0f17] theme-dark:text-[#a78bfa]">
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

        <div className="flex flex-wrap gap-2">
          {[
            ['live', 'Live Overview'],
            ['analysis', 'Analysis'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`rounded-lg px-4 py-2 text-xs font-black transition ${
                activeTab === key
                  ? 'bg-[#3535FF] text-white shadow-lg shadow-purple-500/20'
                  : 'border border-slate-200 bg-white text-slate-600 theme-dark:border-white/10 theme-dark:bg-[#07090d] theme-dark:text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'analysis' ? (
          <AnalysisPanel analysis={analysis} onRefresh={() => { analysisFetchedAt.current = 0; refresh(selectedRouterId); }} />
        ) : (
          <>
            <TrafficTrendChart history={history} overview={overview} />
            <NocStatusTable overview={overview} history={history} interfaces={interfaces} />
            <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
              <TopUsersPanel topUsers={topUsers} />
              <InterfacePanel interfaces={interfaces} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
