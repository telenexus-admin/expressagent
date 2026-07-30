import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const purple = '#8b5cf6';
const violet = '#a855f7';

function formatNumber(value, suffix = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function MiniChart({ history = [] }) {
  const rows = history.slice(-48);
  const download = rows.map((row) => Number(row.download_mbps || 0));
  const upload = rows.map((row) => Number(row.upload_mbps || 0));
  const max = Math.max(1, ...download, ...upload);
  const line = (items) => items.map((value, index) => {
    const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 900;
    const y = 240 - (Number(value || 0) / max) * 210 - 15;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="relative h-[270px] rounded-3xl border border-white/10 bg-[#080b12] p-4">
      <svg viewBox="0 0 900 260" className="h-full w-full">
        {[0, 65, 130, 195, 260].map((y) => (
          <line key={y} x1="0" x2="900" y1={y} y2={y} stroke="rgba(255,255,255,.08)" strokeDasharray="6 6" />
        ))}
        <path d={`${line(download)} L 900 260 L 0 260 Z`} fill={purple} opacity="0.24" />
        <path d={`${line(upload)} L 900 260 L 0 260 Z`} fill={violet} opacity="0.14" />
        <path d={line(download)} fill="none" stroke={purple} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={line(upload)} fill="none" stroke={violet} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!rows.length && <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/45">Waiting for live MikroTik samples...</div>}
    </div>
  );
}

export default function PublicNocLive() {
  const { token } = useParams();
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const historyFetchedAt = useRef(0);

  async function refresh() {
    if (!token || busy.current) return;
    busy.current = true;
    try {
      setError('');
      const overviewResult = await axios.get(`${apiBase}/public/noc/${token}/overview`);
      setOverview(overviewResult.data);
      const shouldFetchHistory = !historyFetchedAt.current || Date.now() - historyFetchedAt.current > 30000;
      if (shouldFetchHistory) {
        const historyResult = await axios.get(`${apiBase}/public/noc/${token}/history`, { params: { range: '1h' } });
        setHistory(historyResult.data || []);
        historyFetchedAt.current = Date.now();
      } else {
        const liveRow = {
          timestamp: overviewResult.data?.checked_at || new Date().toISOString(),
          download_mbps: overviewResult.data?.download_mbps,
          upload_mbps: overviewResult.data?.upload_mbps,
        };
        setHistory((current) => [...current.slice(-47), liveRow]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'This live NOC link is unavailable.');
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const interfaces = overview?.interfaces || [];
  const topUsers = overview?.top_users || [];

  return (
    <main className="min-h-screen bg-[#05070c] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#a78bfa]">Live NOC view</p>
          <h1 className="mt-2 text-3xl font-black">{overview?.identity || overview?.router_name || 'MikroTik Router'}</h1>
          <p className="mt-1 text-sm font-semibold text-white/55">Real-time bandwidth, status, interfaces and bandwidth users.</p>
        </header>

        {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-bold text-red-100">{error}</div>}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs font-bold text-white/45">Download</p><b className="text-2xl">{formatNumber(overview?.download_mbps)} Mbps</b></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs font-bold text-white/45">Upload</p><b className="text-2xl">{formatNumber(overview?.upload_mbps)} Mbps</b></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs font-bold text-white/45">CPU</p><b className="text-2xl">{formatNumber(overview?.cpu_load)}%</b></div>
        </section>

        <MiniChart history={history} />

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <h2 className="font-black">Interface Traffic</h2>
            <div className="mt-3 divide-y divide-white/10">
              {interfaces.slice(0, 8).map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span><b>{item.name}</b><small className="ml-2 text-white/40">{item.status}</small></span>
                  <span className="font-black">{formatNumber(item.rx_mbps)} / {formatNumber(item.tx_mbps)} Mbps</span>
                </div>
              ))}
              {!interfaces.length && <p className="py-4 text-sm font-bold text-white/45">No interface traffic returned yet.</p>}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <h2 className="font-black">Top Bandwidth Users</h2>
            <div className="mt-3 divide-y divide-white/10">
              {topUsers.slice(0, 8).map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span><b>{item.name}</b><small className="ml-2 text-white/40">{item.target || item.service || ''}</small></span>
                  <span className="font-black">{formatNumber(item.total_mbps)} Mbps</span>
                </div>
              ))}
              {!topUsers.length && <p className="py-4 text-sm font-bold text-white/45">No queue rate data returned yet.</p>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
