import React, { useEffect, useMemo, useState } from 'react';

import api from '../utils/api';
import PppoePortalAccessModal from './PppoePortalAccessModal';

function formatBytes(value) {
  const number = Number(value || 0);
  if (!number) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(number) / Math.log(1024)));
  return `${(number / (1024 ** index)).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function dateText(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-KE');
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function Metric({ label, value, caption, tone = 'emerald' }) {
  const tones = {
    emerald: 'from-emerald-500 to-teal-400 text-emerald-700 bg-emerald-50',
    cyan: 'from-cyan-500 to-sky-400 text-cyan-700 bg-cyan-50',
    blue: 'from-blue-500 to-indigo-400 text-blue-700 bg-blue-50',
    amber: 'from-amber-500 to-orange-400 text-amber-700 bg-amber-50',
  };
  const toneClass = tones[tone] || tones.emerald;
  const [bar, text, badge] = toneClass.split(' ');

  return (
    <article className="relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,.05)] sm:p-5">
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${bar} ${text}`} />
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${badge}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${text.replace('text-', 'bg-')}`} />
      </div>
      <span className="text-[9px] font-black uppercase tracking-[.16em] text-slate-400">{label}</span>
      <strong className="mt-1.5 block truncate text-lg font-black tracking-[-.02em] text-slate-950 sm:text-xl">{value}</strong>
      {caption && <span className="mt-1 block truncate text-[9px] font-semibold text-slate-400">{caption}</span>}
    </article>
  );
}

function Detail({ label, value, accent = false }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${accent ? 'border-emerald-100 bg-emerald-50/70' : 'border-slate-100 bg-slate-50/80'}`}>
      <span className={`text-[8px] font-black uppercase tracking-[.13em] ${accent ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</span>
      <strong className="mt-1.5 block break-words text-xs text-slate-800">{value || 'Not set'}</strong>
    </div>
  );
}

function Empty({ title, text }) {
  return (
    <div className="p-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-lg font-black text-emerald-600">✓</div>
      <strong className="mt-4 block text-sm text-slate-800">{title}</strong>
      <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-slate-400">{text}</p>
    </div>
  );
}

function TrafficDonut({ download, upload }) {
  const total = download + upload;
  const downloadPercent = total ? Math.round((download / total) * 100) : 0;
  const uploadPercent = total ? 100 - downloadPercent : 0;

  return (
    <div className="flex flex-col items-center justify-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={`Download ${downloadPercent} percent, upload ${uploadPercent} percent`}>
          <circle cx="60" cy="60" r="46" fill="none" stroke="#e2e8f0" strokeWidth="13" />
          {total > 0 && (
            <>
              <circle cx="60" cy="60" r="46" pathLength="100" fill="none" stroke="#059669" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${downloadPercent} ${100 - downloadPercent}`} />
              <circle cx="60" cy="60" r="46" pathLength="100" fill="none" stroke="#22d3ee" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${uploadPercent} ${100 - uploadPercent}`} strokeDashoffset={-downloadPercent} />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black uppercase tracking-[.14em] text-slate-400">Total</span>
          <strong className="mt-1 max-w-[92px] truncate text-lg font-black text-slate-950">{formatBytes(total)}</strong>
          <span className="text-[8px] text-slate-400">30 days</span>
        </div>
      </div>

      <div className="w-full min-w-0 space-y-3">
        <div className="rounded-2xl bg-emerald-50 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.12em] text-emerald-700"><i className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Download</span>
            <span className="text-[9px] font-black text-emerald-700">{downloadPercent}%</span>
          </div>
          <strong className="mt-2 block text-base font-black text-slate-950">{formatBytes(download)}</strong>
        </div>
        <div className="rounded-2xl bg-cyan-50 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.12em] text-cyan-700"><i className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Upload</span>
            <span className="text-[9px] font-black text-cyan-700">{uploadPercent}%</span>
          </div>
          <strong className="mt-2 block text-base font-black text-slate-950">{formatBytes(upload)}</strong>
        </div>
      </div>
    </div>
  );
}

function TrafficBars({ daily, maxDay }) {
  if (!daily.length) return <Empty title="No accounting data" text="Usage will appear after this PPPoE account records RADIUS sessions." />;

  return (
    <div className="mt-5 overflow-x-auto pb-1">
      <div className="flex h-56 min-w-[680px] items-end gap-2 px-1">
        {daily.map((day) => {
          const down = Number(day.download_bytes || 0);
          const up = Number(day.upload_bytes || 0);
          const value = down + up;
          const height = Math.max(4, Math.round((value / maxDay) * 100));
          const downShare = value ? Math.max(2, Math.round((down / value) * 100)) : 100;
          const upShare = value ? Math.max(2, 100 - downShare) : 0;
          const label = String(day.day || '').slice(8) || String(day.day || '');

          return (
            <div key={day.day} className="group flex min-w-[18px] flex-1 flex-col items-center justify-end gap-1.5">
              <div
                title={`${day.day}: ↓ ${formatBytes(down)} · ↑ ${formatBytes(up)}`}
                className="flex w-full min-w-[12px] max-w-[24px] flex-col justify-end overflow-hidden rounded-t-[7px] bg-slate-100 transition group-hover:scale-x-110"
                style={{ height: `${height}%` }}
              >
                {upShare > 0 && <div className="w-full bg-cyan-400" style={{ height: `${upShare}%` }} />}
                <div className="w-full bg-gradient-to-t from-emerald-700 to-emerald-400" style={{ height: `${downShare}%` }} />
              </div>
              <span className="text-[7px] font-bold text-slate-400">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionUsage({ sessions }) {
  if (!sessions.length) return <Empty title="No sessions" text="This customer has no recorded RADIUS sessions yet." />;
  const max = Math.max(1, ...sessions.map((session) => Number(session.download_bytes || 0) + Number(session.upload_bytes || 0)));

  return (
    <div className="divide-y divide-slate-100">
      {sessions.map((session, index) => {
        const down = Number(session.download_bytes || 0);
        const up = Number(session.upload_bytes || 0);
        const total = down + up;
        const width = Math.max(2, Math.round((total / max) * 100));
        return (
          <article key={`${session.acctstarttime}-${index}`} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <strong className="text-xs text-slate-800">{session.is_active ? 'Live session' : 'Completed session'}</strong>
                  {session.is_active && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[7px] font-black text-emerald-700">LIVE</span>}
                </div>
                <p className="mt-1 text-[8px] text-slate-400">{dateTime(session.acctstarttime)} · {session.framedipaddress || 'No IP'}</p>
              </div>
              <div className="text-right">
                <strong className="text-[9px] text-slate-700">↓ {formatBytes(down)} · ↑ {formatBytes(up)}</strong>
                <p className="mt-1 text-[8px] text-slate-400">{formatDuration(session.acctsessiontime)}</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" style={{ width: `${width}%` }} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function PppoeSubscriberDetail({ subscriber, back, setError }) {
  const [tab, setTab] = useState('overview');
  const [details, setDetails] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [portalOpen, setPortalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const [detailResult, usageResult] = await Promise.all([
          api.get(`/billing-workspace/subscribers/${subscriber.id}/details`),
          api.get(`/billing-workspace/subscribers/${subscriber.id}/usage?days=30`),
        ]);
        if (!mounted) return;
        setDetails(detailResult.data);
        setUsage(usageResult.data);
      } catch (error) {
        if (mounted) setError(error.response?.data?.error || 'Could not load client details.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [subscriber.id, setError]);

  const record = details?.subscriber || subscriber;
  const invoices = details?.invoices || [];
  const payments = details?.payments || [];
  const tickets = details?.tickets || [];
  const radius = usage?.usage || {};
  const total = radius.total || {};
  const daily = radius.daily || [];
  const sessions = radius.sessions || [];
  const download = Number(total.download_bytes || 0);
  const upload = Number(total.upload_bytes || 0);
  const combined = download + upload;
  const maxDay = Math.max(1, ...daily.map((day) => Number(day.download_bytes || 0) + Number(day.upload_bytes || 0)));
  const online = Boolean(usage?.subscriber?.is_online ?? subscriber.is_online);
  const remainingDays = daysUntil(record.expires_at);
  const latestSession = sessions.find((session) => session.is_active) || sessions[0] || null;

  const initials = useMemo(() => String(record.full_name || 'C')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase(), [record.full_name]);

  if (loading) {
    return (
      <div className="-mx-5 -mt-5 min-h-screen bg-[#f4f7f6] p-6 sm:-mx-8 sm:-mt-8">
        <button type="button" onClick={back} className="text-xs font-black text-emerald-700">← Back to subscribers</button>
        <div className="mt-6 h-48 animate-pulse rounded-[28px] bg-emerald-950/10" />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-200" />)}</div>
      </div>
    );
  }

  const statusLabel = record.service_status === 'suspended' ? 'Suspended' : online ? 'Online' : 'Offline';

  return (
    <div className="-mx-5 -mt-5 min-h-screen bg-[#f4f7f6] pb-12 sm:-mx-8 sm:-mt-8">
      <section className="relative isolate overflow-hidden bg-[#052e2b] px-5 pb-20 pt-6 text-white sm:px-8 sm:pb-24">
        <div className="pointer-events-none absolute inset-0 opacity-80" style={{ background: 'radial-gradient(circle at 83% 12%, rgba(52,211,153,.25), transparent 25%), radial-gradient(circle at 9% 90%, rgba(34,211,238,.12), transparent 24%), linear-gradient(118deg,#031f1d 0%,#075843 55%,#0a6a50 100%)' }} />
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-8 -top-8 h-56 w-56 rounded-full border border-emerald-300/10" />
        <div className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />

        <div className="relative z-10">
          <button type="button" onClick={back} className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-[9px] font-black text-white backdrop-blur transition hover:bg-white/15">← Subscribers</button>

          <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-white/10 bg-white/10 text-xl font-black shadow-inner backdrop-blur sm:h-20 sm:w-20 sm:text-2xl">{initials}</span>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-[8px] font-black uppercase tracking-[.22em] text-emerald-200">PPPoE subscriber</p>
                  <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[7px] font-black uppercase tracking-[.12em] text-emerald-100">Central RADIUS</span>
                </div>
                <h2 className="truncate text-2xl font-black tracking-[-.035em] sm:text-4xl">{record.full_name}</h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-emerald-100/80">
                  <span>{record.account_number}</span><span className="h-1 w-1 rounded-full bg-emerald-300" /><span>{record.plan_name || 'No package'}</span><span className="h-1 w-1 rounded-full bg-emerald-300" /><span>{record.router_name || 'No router'}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-2 text-[8px] font-black uppercase tracking-[.12em] ${record.service_status === 'suspended' ? 'border-amber-300/30 bg-amber-300 text-amber-950' : online ? 'border-emerald-200/30 bg-emerald-300 text-emerald-950' : 'border-white/10 bg-white/10 text-white'}`}>{statusLabel}</span>
              <button type="button" onClick={() => setPortalOpen(true)} className="rounded-xl bg-white px-4 py-2.5 text-[9px] font-black text-emerald-800 shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-50">Portal Login</button>
            </div>
          </div>

          <div className="mt-7 grid gap-2 sm:grid-cols-3 lg:max-w-3xl">
            <div className="rounded-2xl border border-white/10 bg-white/[.07] p-3.5 backdrop-blur"><span className="text-[7px] font-black uppercase tracking-[.14em] text-emerald-200/70">PPPoE username</span><strong className="mt-1 block truncate text-xs text-white">{record.radius_username || 'Not configured'}</strong></div>
            <div className="rounded-2xl border border-white/10 bg-white/[.07] p-3.5 backdrop-blur"><span className="text-[7px] font-black uppercase tracking-[.14em] text-emerald-200/70">Current IP</span><strong className="mt-1 block truncate text-xs text-white">{latestSession?.framedipaddress || record.static_ip || subscriber.ip_address || 'Not connected'}</strong></div>
            <div className="rounded-2xl border border-white/10 bg-white/[.07] p-3.5 backdrop-blur"><span className="text-[7px] font-black uppercase tracking-[.14em] text-emerald-200/70">Last activity</span><strong className="mt-1 block truncate text-xs text-white">{total.last_seen ? dateTime(total.last_seen) : 'No activity yet'}</strong></div>
          </div>
        </div>

        <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-12">
          <svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full"><path d="M0 106 C175 35 330 175 520 112 C720 48 835 164 1044 74 C1112 45 1162 58 1200 36 L1200 180 L0 180 Z" fill="#f4f7f6" /></svg>
        </div>
      </section>

      <div className="space-y-4 px-3 sm:px-8">
        <section className="-mt-7 relative z-20 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metric label="Package" value={record.plan_name || 'No package'} caption={record.plan_price ? money(record.plan_price) : 'No price'} tone="emerald" />
          <Metric label="Data used" value={formatBytes(combined)} caption="Last 30 days" tone="cyan" />
          <Metric label="Online time" value={formatDuration(total.session_seconds)} caption={`${total.session_count || 0} RADIUS session${Number(total.session_count || 0) === 1 ? '' : 's'}`} tone="blue" />
          <Metric label="Expires" value={dateText(record.expires_at)} caption={remainingDays === null ? 'No expiry set' : remainingDays < 0 ? 'Expired' : `${remainingDays} day${remainingDays === 1 ? '' : 's'} remaining`} tone="amber" />
        </section>

        <nav className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-[0_8px_30px_rgba(15,23,42,.04)]">
          <div className="flex min-w-max gap-1">
            {[['overview', 'Overview'], ['usage', 'Bandwidth Usage'], ['billing', 'Billing'], ['tickets', 'Tickets']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-xl px-4 py-2.5 text-[9px] font-black transition ${tab === key ? 'bg-[#075843] text-white shadow-sm' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'}`}>{label}</button>
            ))}
          </div>
        </nav>

        {tab === 'overview' && (
          <div className="space-y-4">
            <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Traffic mix</p><h3 className="mt-1 text-base font-black text-slate-950">Data usage</h3><p className="mt-1 text-[9px] text-slate-400">Download vs upload · last 30 days</p></div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[8px] font-black text-emerald-700">{formatBytes(combined)}</span>
                </div>
                <div className="mt-5"><TrafficDonut download={download} upload={upload} /></div>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">30 day pulse</p><h3 className="mt-1 text-base font-black text-slate-950">Daily bandwidth activity</h3><p className="mt-1 text-[9px] text-slate-400">RADIUS accounting shown as stacked daily traffic</p></div>
                  <div className="flex items-center gap-3 text-[8px] font-bold text-slate-500"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-600" /> Download</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-400" /> Upload</span></div>
                </div>
                <TrafficBars daily={daily} maxDay={maxDay} />
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
                <div className="flex items-center justify-between"><div><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">CRM</p><h3 className="mt-1 text-sm font-black text-slate-950">Customer profile</h3></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-[8px] font-black uppercase text-emerald-700">Customer</span></div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2"><Detail label="M-Pesa account number" value={record.account_number} accent /><Detail label="Phone" value={record.phone} /><Detail label="Email" value={record.email} /><Detail label="Created" value={dateText(record.created_at)} /></div>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
                <div className="flex items-center justify-between"><div><p className="text-[8px] font-black uppercase tracking-[.18em] text-cyan-600">Subscription</p><h3 className="mt-1 text-sm font-black text-slate-950">Service details</h3></div><span className={`rounded-full px-3 py-1 text-[8px] font-black uppercase ${record.service_status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{record.service_status || 'Unknown'}</span></div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2"><Detail label="Package" value={record.plan_name} /><Detail label="Expiry" value={dateText(record.expires_at)} accent /><Detail label="Grace period" value={`${Number(record.grace_period_days || 0)} day(s)`} /><Detail label="Session count" value={`${total.session_count || 0} session(s)`} /></div>
              </article>
            </section>

            <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Network</p><h3 className="mt-1 text-sm font-black text-slate-950">PPPoE & central RADIUS</h3>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"><Detail label="PPPoE username" value={record.radius_username} accent /><Detail label="Router" value={record.router_name} /><Detail label="Access mode" value={record.access_mode} /><Detail label="Current / static IP" value={latestSession?.framedipaddress || record.static_ip || subscriber.ip_address} /><Detail label="VLAN" value={record.vlan_id ? `VLAN ${record.vlan_id}` : 'No VLAN'} /><Detail label="RADIUS status" value={record.radius_status} /></div>
                </div>
                <div className="relative overflow-hidden rounded-[22px] bg-[#062f2b] p-5 text-white">
                  <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full border border-emerald-300/20" /><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-300 text-xl font-black text-emerald-950">↗</span><h4 className="mt-4 text-sm font-black">Customer Portal</h4><p className="mt-2 text-[10px] leading-5 text-emerald-100/70">Create or update the credentials this PPPoE customer uses for their self-service portal.</p><button type="button" onClick={() => setPortalOpen(true)} className="mt-5 w-full rounded-xl bg-emerald-300 px-4 py-3 text-[9px] font-black text-emerald-950 transition hover:bg-emerald-200">Manage Portal Login</button>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'usage' && (
          <div className="space-y-4">
            <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
                <p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Usage composition</p><h3 className="mt-1 text-base font-black text-slate-950">Traffic split</h3><div className="mt-5"><TrafficDonut download={download} upload={upload} /></div>
              </article>
              <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.05)]">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[8px] font-black uppercase tracking-[.18em] text-cyan-600">Daily accounting</p><h3 className="mt-1 text-base font-black text-slate-950">30-day traffic</h3><p className="mt-1 text-[9px] text-slate-400">Each bar separates download and upload traffic</p></div><div className="flex items-center gap-3 text-[8px] font-bold text-slate-500"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-600" /> Download</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-400" /> Upload</span></div></div><TrafficBars daily={daily} maxDay={maxDay} />
              </article>
            </section>

            <section className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Download" value={formatBytes(download)} caption="Received by customer" tone="emerald" /><Metric label="Upload" value={formatBytes(upload)} caption="Sent by customer" tone="cyan" /><Metric label="Online time" value={formatDuration(total.session_seconds)} caption="Last 30 days" tone="blue" /><Metric label="Last activity" value={total.last_seen ? dateText(total.last_seen) : 'No activity'} caption={total.last_seen ? dateTime(total.last_seen) : 'No RADIUS session'} tone="amber" /></section>

            <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,.05)]">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">RADIUS accounting</p><h3 className="mt-1 text-sm font-black text-slate-950">Session history</h3><p className="mt-1 text-[9px] text-slate-400">Recent sessions with relative data consumption</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-[8px] font-black text-slate-500">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span></header>
              <SessionUsage sessions={sessions} />
            </section>
          </div>
        )}

        {tab === 'billing' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,.05)]">
              <header className="border-b border-slate-100 p-5"><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Billing</p><h3 className="mt-1 text-sm font-black text-slate-950">Invoices</h3></header>
              <div className="divide-y divide-slate-100">{invoices.map((invoice) => <article key={invoice.invoice_number} className="flex items-center justify-between gap-4 p-4"><div><strong className="text-xs text-slate-800">{invoice.invoice_number}</strong><p className="mt-1 text-[8px] text-slate-400">Due {dateText(invoice.due_date)}</p></div><div className="text-right"><strong className="text-xs text-slate-900">{money(invoice.amount)}</strong><p className={`mt-1 text-[8px] font-black uppercase ${invoice.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>{invoice.status}</p></div></article>)}{!invoices.length && <Empty title="No invoices" text="No invoices are recorded for this customer." />}</div>
            </section>

            <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,.05)]">
              <header className="border-b border-slate-100 p-5"><p className="text-[8px] font-black uppercase tracking-[.18em] text-cyan-600">Transactions</p><h3 className="mt-1 text-sm font-black text-slate-950">Payments</h3></header>
              <div className="divide-y divide-slate-100">{payments.map((payment, index) => <article key={`${payment.reference}-${index}`} className="flex items-center justify-between gap-4 p-4"><div><strong className="text-xs text-slate-800">{payment.method || 'Payment'}</strong><p className="mt-1 max-w-[180px] truncate text-[8px] text-slate-400">{payment.reference || 'No reference'}</p></div><div className="text-right"><strong className="text-xs text-slate-900">{money(payment.amount)}</strong><p className="mt-1 text-[8px] font-black uppercase text-emerald-600">{payment.status}</p></div></article>)}{!payments.length && <Empty title="No payments" text="No payment transactions are recorded for this customer." />}</div>
            </section>
          </div>
        )}

        {tab === 'tickets' && (
          <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,.05)]">
            <header className="border-b border-slate-100 p-5"><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Customer support</p><h3 className="mt-1 text-sm font-black text-slate-950">CRM Tickets</h3></header>
            <div className="divide-y divide-slate-100">{tickets.map((ticket) => <article key={ticket.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div><strong className="text-xs text-slate-800">{ticket.title}</strong><p className="mt-1 text-[8px] text-slate-400">{ticket.category || 'General'} · {ticket.priority || 'Normal'}</p></div><div className="text-right"><span className={`rounded-full px-2.5 py-1 text-[8px] font-black uppercase ${ticket.status === 'closed' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>{ticket.status}</span><p className="mt-1 text-[8px] text-slate-400">{dateText(ticket.updated_at)}</p></div></article>)}{!tickets.length && <Empty title="No support tickets" text="This customer currently has no matching CRM tickets." />}</div>
          </section>
        )}
      </div>

      {portalOpen && <PppoePortalAccessModal subscriber={record} close={() => setPortalOpen(false)} />}
    </div>
  );
}
