import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import api from './utils/api';

const money = (value) => `KSh ${Number(value || 0).toLocaleString('en-KE')}`;
const normalizeMac = (value) => {
  const compact = String(value || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  return compact.length === 12 ? compact.match(/.{2}/g).join(':') : '';
};
const normalizePhone = (value) => {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('0') && phone.length === 10) phone = `254${phone.slice(1)}`;
  else if ((phone.startsWith('7') || phone.startsWith('1')) && phone.length === 9) phone = `254${phone}`;
  return phone;
};
const durationText = (minutes) => {
  const value = Number(minutes || 0);
  const units = [[43200, 'month'], [10080, 'week'], [1440, 'day'], [60, 'hour']];
  for (const [size, label] of units) {
    if (value >= size && value % size === 0) {
      const amount = value / size;
      return `${amount} ${label}${amount === 1 ? '' : 's'}`;
    }
  }
  return `${value} min`;
};
const toMinutes = (value, unit) => Math.round(Number(value || 0) * ({ minutes: 1, hours: 60, days: 1440, weeks: 10080, months: 43200 }[unit] || 1));
const readStoredPhone = () => {
  try { return window.localStorage.getItem('polyizon-tv-mpesa-phone') || ''; } catch (_) { return ''; }
};
const storePhone = (value) => {
  try { window.localStorage.setItem('polyizon-tv-mpesa-phone', value); } catch (_) {}
};

function TvIcon({ className = 'h-5 w-5' }) {
  return <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 2 4 3 4-3M8 22h8"/><path d="M7 9h10v6H7z"/></svg>;
}
function CloseIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18"/></svg>; }

function AdminTvPanel({ routers = [] }) {
  const [plans, setPlans] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [tab, setTab] = useState('plans');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', price: '', duration_value: '30', duration_unit: 'days', speed_mbps: '5', data_limit_mb: '', router_id: '' });

  const load = async () => {
    try {
      const [planResult, subscriberResult] = await Promise.all([
        api.get('/billing-workspace/hotspot/tv/plans'),
        api.get('/billing-workspace/hotspot/tv/subscribers'),
      ]);
      setPlans(Array.isArray(planResult.data) ? planResult.data : []);
      setSubscribers(Array.isArray(subscriberResult.data) ? subscriberResult.data : []);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load TV packages.');
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    const duration = toMinutes(form.duration_value, form.duration_unit);
    const speed = Number(form.speed_mbps || 0);
    if (!Number.isInteger(duration) || duration < 1 || !(Number(form.price) >= 10) || !(speed > 0)) {
      setError('Enter a package name, price of at least KES 10, duration and speed.'); return;
    }
    try {
      setBusy('create');
      await api.post('/billing-workspace/hotspot/tv/plans', {
        name: form.name.trim(), price: Number(form.price), duration_minutes: duration,
        mikrotik_rate_limit: `${speed}M/${speed}M`,
        data_limit_mb: form.data_limit_mb ? Number(form.data_limit_mb) : null,
        router_id: form.router_id ? Number(form.router_id) : null,
      });
      setForm({ name: '', price: '', duration_value: '30', duration_unit: 'days', speed_mbps: '5', data_limit_mb: '', router_id: '' });
      setOpen(false); setNotice('TV package created and added to the hotspot landing page.'); await load();
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.response?.data?.errors?.[0]?.msg || 'Could not create TV package.');
    } finally { setBusy(''); }
  };

  const togglePlan = async (plan) => {
    try { setBusy(`plan-${plan.id}`); await api.patch(`/billing-workspace/hotspot/tv/plans/${plan.id}`, { is_active: plan.is_active === false }); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not update TV package.'); }
    finally { setBusy(''); }
  };
  const removePlan = async (plan) => {
    if (!window.confirm(`Remove ${plan.name}? Active subscriptions will not be disconnected.`)) return;
    try { setBusy(`plan-${plan.id}`); await api.delete(`/billing-workspace/hotspot/tv/plans/${plan.id}`); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not remove TV package.'); }
    finally { setBusy(''); }
  };
  const setStatus = async (subscriber, status) => {
    try { setBusy(`sub-${subscriber.id}`); await api.patch(`/billing-workspace/hotspot/tv/subscribers/${subscriber.id}/status`, { status }); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not update TV access.'); }
    finally { setBusy(''); }
  };
  const extend = async (subscriber) => {
    const raw = window.prompt(`How many days should be added to ${subscriber.mac_address}?`, '7');
    if (!raw) return; const days = Number(raw); if (!Number.isInteger(days) || days < 1 || days > 365) return;
    try { setBusy(`sub-${subscriber.id}`); await api.post(`/billing-workspace/hotspot/tv/subscribers/${subscriber.id}/extend`, { days }); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not extend TV subscription.'); }
    finally { setBusy(''); }
  };
  const removeSubscriber = async (subscriber) => {
    if (!window.confirm(`Remove TV ${subscriber.mac_address} and revoke its internet access?`)) return;
    try { setBusy(`sub-${subscriber.id}`); await api.delete(`/billing-workspace/hotspot/tv/subscribers/${subscriber.id}`); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not remove TV subscription.'); }
    finally { setBusy(''); }
  };

  const activeCount = subscribers.filter((item) => item.status === 'active' && (!item.expires_at || new Date(item.expires_at) > new Date())).length;
  return <section className="mt-4 overflow-hidden rounded-[20px] border border-emerald-100 bg-white shadow-sm">
    <header className="bg-[linear-gradient(120deg,#071f16,#0c4b34)] px-4 py-4 text-white sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300/15 text-emerald-200"><TvIcon /></span><div><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-300">MAC-bound access</p><h3 className="mt-0.5 text-sm font-black sm:text-base">TV Packages</h3><p className="mt-1 text-[9px] text-emerald-100/70">Sell internet to Smart TVs without captive-portal login.</p></div></div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-white/10 px-2.5 py-1 text-[8px] font-black">{activeCount} ACTIVE TVs</span><button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-emerald-300 px-3 py-2 text-[9px] font-black text-emerald-950">+ TV Package</button></div>
      </div>
    </header>
    <div className="border-b border-slate-100 p-2"><div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button onClick={() => setTab('plans')} className={`rounded-lg px-3 py-2 text-[10px] font-black ${tab === 'plans' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>TV Packages · {plans.length}</button><button onClick={() => setTab('subscribers')} className={`rounded-lg px-3 py-2 text-[10px] font-black ${tab === 'subscribers' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>TV Subscribers · {subscribers.length}</button></div></div>
    {error && <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-700">{error}</p>}
    {notice && <p className="mx-4 mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700">{notice}</p>}
    {tab === 'plans' ? <div className="divide-y divide-slate-100">{plans.length ? plans.map((plan) => <article key={plan.id} className={`flex items-center gap-3 px-4 py-3.5 sm:px-5 ${plan.is_active === false ? 'bg-slate-50 opacity-65' : ''}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><TvIcon className="h-4 w-4"/></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-xs text-slate-900">{plan.name}</strong><span className={`rounded-full px-2 py-0.5 text-[7px] font-black ${plan.is_active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{plan.is_active === false ? 'PAUSED' : 'LIVE'}</span></div><p className="mt-1 truncate text-[9px] text-slate-400">{durationText(plan.duration_minutes)} · {plan.mikrotik_rate_limit || 'Unlimited'} · {plan.router_name || 'All hotspot routers'}</p></div><strong className="text-xs text-slate-900">{money(plan.price)}</strong><div className="flex gap-1"><button disabled={busy === `plan-${plan.id}`} onClick={() => togglePlan(plan)} className="h-8 rounded-lg bg-amber-50 px-2 text-[8px] font-black text-amber-700">{plan.is_active === false ? 'Resume' : 'Pause'}</button><button disabled={busy === `plan-${plan.id}`} onClick={() => removePlan(plan)} className="h-8 rounded-lg bg-rose-50 px-2 text-[8px] font-black text-rose-600">Remove</button></div></article>) : <div className="p-8 text-center text-xs text-slate-400">No TV packages yet. Create one to show the TV Packages button on the landing page.</div>}</div>
    : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="bg-slate-50 text-[8px] font-black uppercase tracking-wider text-slate-400"><tr><th className="px-4 py-3">TV / MAC</th><th>Package</th><th>Paid by</th><th>Router</th><th>Expires</th><th>Status</th><th className="pr-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{subscribers.map((item) => { const expired = item.expires_at && new Date(item.expires_at) <= new Date(); const active = item.status === 'active' && !expired; return <tr key={item.id}><td className="px-4 py-3"><strong className="font-mono text-slate-800">{item.mac_address}</strong><p className="mt-1 text-[8px] text-slate-400">{item.is_online ? `Online · ${item.ip_address || 'IP assigned'}` : item.device_activation_status || 'Offline'}</p></td><td>{item.plan_name || '—'}</td><td>{item.customer_phone ? `+${item.customer_phone}` : '—'}</td><td>{item.router_name || 'Router'}</td><td>{item.expires_at ? new Date(item.expires_at).toLocaleString() : '—'}</td><td><span className={`rounded-full px-2 py-1 text-[8px] font-black ${expired ? 'bg-rose-50 text-rose-700' : active ? 'bg-emerald-50 text-emerald-700' : item.status === 'activation_pending' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{expired ? 'EXPIRED' : String(item.status || 'offline').toUpperCase()}</span></td><td className="pr-4 text-right"><div className="inline-flex gap-1">{active ? <button onClick={() => setStatus(item,'suspended')} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[8px] font-black text-amber-700">Suspend</button> : !expired && <button onClick={() => setStatus(item,'active')} className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[8px] font-black text-emerald-700">Resume</button>}<button onClick={() => extend(item)} className="rounded-lg bg-sky-50 px-2 py-1.5 text-[8px] font-black text-sky-700">Extend</button><button onClick={() => removeSubscriber(item)} className="rounded-lg bg-rose-50 px-2 py-1.5 text-[8px] font-black text-rose-600">Remove</button></div></td></tr>; })}{!subscribers.length && <tr><td colSpan="7" className="p-8 text-center text-xs text-slate-400">TV subscriptions will appear here after the first successful TV package payment.</td></tr>}</tbody></table></div>}

    {open && <div className="fixed inset-0 z-[14000] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={() => setOpen(false)}><form onSubmit={create} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]"><div className="flex items-start justify-between"><div><p className="text-[8px] font-black uppercase tracking-[.2em] text-emerald-500">TV service</p><h3 className="mt-1 text-xl font-black text-slate-950">Create TV Package</h3><p className="mt-1 text-[10px] text-slate-400">One MAC address receives internet for the paid period.</p></div><button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><CloseIcon/></button></div><div className="mt-5 space-y-3"><input required value={form.name} onChange={(e) => setForm({...form,name:e.target.value})} placeholder="Package name · e.g. TV Monthly" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"/><div className="grid grid-cols-2 gap-2"><input required min="10" type="number" value={form.price} onChange={(e) => setForm({...form,price:e.target.value})} placeholder="Price KES" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none"/><input required min="0.25" step="0.25" type="number" value={form.speed_mbps} onChange={(e) => setForm({...form,speed_mbps:e.target.value})} placeholder="Speed Mbps" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none"/></div><div className="grid grid-cols-[1fr_125px] gap-2"><input required min="1" type="number" value={form.duration_value} onChange={(e) => setForm({...form,duration_value:e.target.value})} className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none"/><select value={form.duration_unit} onChange={(e) => setForm({...form,duration_unit:e.target.value})} className="h-11 rounded-xl border border-slate-200 px-3 text-sm"><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></div><input min="1" type="number" value={form.data_limit_mb} onChange={(e) => setForm({...form,data_limit_mb:e.target.value})} placeholder="Data limit MB (optional)" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none"/><select value={form.router_id} onChange={(e) => setForm({...form,router_id:e.target.value})} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"><option value="">All Hotspot routers</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}</select><p className="rounded-xl bg-emerald-50 p-3 text-[9px] leading-4 text-emerald-800">Polyizon uses MAC authentication, enforces this package speed, and revokes the TV automatically at expiry. No voucher is required on the TV.</p><button disabled={busy === 'create'} className="h-11 w-full rounded-xl bg-emerald-500 text-xs font-black text-white disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Create TV Package'}</button></div></form></div>}
  </section>;
}

function PublicTvPanel() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get('portalToken') || params.get('portal_token') || '';
  const preview = params.get('preview') === '1';
  const detectedMac = normalizeMac(params.get('mac') || '');
  const [config, setConfig] = useState(null);
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [phone, setPhone] = useState(readStoredPhone);
  const [lookup, setLookup] = useState(null);
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/hotspot/tv/config?portalToken=${encodeURIComponent(token)}`)
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'TV packages unavailable'); return data; })
      .then(setConfig).catch(() => setConfig({ enabled: false, plans: [] }));
  }, [token]);

  const plans = Array.isArray(config?.plans) ? config.plans : [];
  const selectedPlan = plans.find((plan) => Number(plan.id) === Number(selectedPlanId));
  if (!config?.enabled || !plans.length) return null;

  const checkMac = async () => {
    const normalized = normalizeMac(mac);
    if (!normalized) { setLookup(null); setError('Enter the TV Wi-Fi or Ethernet MAC, for example AA:BB:CC:DD:EE:FF.'); return false; }
    setMac(normalized); setError('');
    try {
      const response = await fetch('/api/public/hotspot/tv/lookup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ portal_token: token, mac: normalized }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not check this TV'); setLookup(data); return true;
    } catch (e) { setError(e.message); return false; }
  };

  const pay = async (event) => {
    event.preventDefault(); setError('');
    if (preview) { setError('TV checkout is disabled in preview. Open the live hotspot page to test payment.'); return; }
    const normalizedMac = normalizeMac(mac); const normalizedPhone = normalizePhone(phone);
    if (!normalizedMac) { setError('Enter a valid TV MAC address.'); return; }
    if (!selectedPlan) { setError('Choose a TV package.'); return; }
    if (!/^254[17]\d{8}$/.test(normalizedPhone)) { setError('Enter a valid Safaricom M-Pesa number.'); return; }
    try {
      setStatus('sending'); storePhone(normalizedPhone);
      const response = await fetch('/api/public/hotspot/tv/checkout', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ portal_token:token, plan_id:selectedPlan.id, phone:normalizedPhone, mac:normalizedMac }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not send M-Pesa prompt');
      setPhone(normalizedPhone); setMac(normalizedMac); setReference(data.reference); setStatus('pending');
    } catch (e) { setStatus('failed'); setError(e.message); }
  };

  useEffect(() => {
    if (!reference || !['pending','activating'].includes(status)) return undefined;
    let stopped = false; let timer;
    const poll = async () => {
      try {
        const response = await fetch(`/api/public/hotspot/tv/checkout/${encodeURIComponent(reference)}?portalToken=${encodeURIComponent(token)}`);
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not confirm payment'); if (stopped) return;
        if (data.status === 'active') { setStatus('active'); setResult(data); setError(''); return; }
        if (data.status === 'failed') { setStatus('failed'); setError(data.error || 'M-Pesa payment was not completed.'); return; }
        setStatus(data.status === 'activating' ? 'activating' : 'pending'); if (data.message) setError(data.message);
      } catch (_) { if (!stopped) setError('Still waiting for payment confirmation…'); }
      if (!stopped) timer = window.setTimeout(poll, 2000);
    };
    void poll(); return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [reference, status, token]);

  const close = () => { if (['sending','pending'].includes(status)) return; setOpen(false); setError(''); setStatus('idle'); setReference(''); setResult(null); };

  return <>
    <section className="px-3 pt-4 sm:px-6" data-polyizon-tv-packages>
      <button type="button" onClick={() => setOpen(true)} className="hotspot-card-shadow group flex w-full items-center justify-between overflow-hidden rounded-[18px] border border-emerald-200 bg-[linear-gradient(120deg,#06291a,#0b5b39)] p-4 text-left text-white transition hover:-translate-y-0.5">
        <span className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-300/15 text-emerald-200"><TvIcon className="h-6 w-6"/></span><span><span className="block text-[9px] font-black uppercase tracking-[.18em] text-emerald-200">Smart TV access</span><strong className="mt-1 block text-base font-black">TV Packages</strong><span className="mt-1 block text-[10px] text-emerald-100/75">Connect a TV by MAC · no hotspot login</span></span></span><span className="rounded-full bg-emerald-300 px-3 py-2 text-[9px] font-black text-emerald-950">VIEW</span>
      </button>
    </section>

    {open && <div className="fixed inset-0 z-[16000] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={close}><section onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-[#f7faf8] shadow-2xl sm:rounded-[28px]"><header className="sticky top-0 z-10 flex items-center justify-between bg-[#082c20] px-5 py-4 text-white"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><TvIcon/></span><div><p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-300">Smart TV internet</p><h2 className="text-lg font-black">TV Packages</h2></div></div><button disabled={['sending','pending'].includes(status)} onClick={close} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 disabled:opacity-40"><CloseIcon/></button></header>
      {status === 'active' && result ? <div className="p-6 text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><TvIcon className="h-8 w-8"/></span><p className="mt-4 text-[9px] font-black uppercase tracking-[.18em] text-emerald-600">Payment confirmed</p><h3 className="mt-1 text-2xl font-black text-slate-950">Your TV is ready</h3><p className="mt-2 text-xs leading-5 text-slate-500">No hotspot login is required. If the TV was already connected, reconnect its Wi-Fi or Ethernet once.</p><div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-left text-xs"><div className="flex justify-between gap-3"><span className="text-slate-500">TV MAC</span><b className="font-mono">{result.mac_address}</b></div><div className="mt-2 flex justify-between gap-3"><span className="text-slate-500">Package</span><b>{result.plan_name}</b></div><div className="mt-2 flex justify-between gap-3"><span className="text-slate-500">Valid until</span><b>{result.expires_at ? new Date(result.expires_at).toLocaleString() : 'Active'}</b></div></div><button onClick={close} className="mt-5 w-full rounded-xl bg-emerald-600 py-3 text-xs font-black text-white">Done</button></div>
      : <form onSubmit={pay} className="space-y-4 p-5"><div><label className="text-[10px] font-black uppercase tracking-wide text-slate-500">TV MAC address</label><div className="mt-2 flex gap-2"><input required value={mac} disabled={['sending','pending'].includes(status)} onChange={(e)=>{setMac(e.target.value.toUpperCase());setLookup(null);setError('');}} onBlur={() => mac && void checkMac()} placeholder="AA:BB:CC:DD:EE:FF" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm font-bold outline-none focus:border-emerald-400"/><button type="button" onClick={checkMac} className="rounded-xl bg-slate-900 px-3 text-[9px] font-black text-white">CHECK</button></div>{detectedMac && detectedMac !== normalizeMac(mac) && <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50 p-2.5"><p className="text-[8px] font-bold text-sky-700">Current hotspot device detected: <span className="font-mono">{detectedMac}</span></p><button type="button" onClick={()=>{setMac(detectedMac);setLookup(null);setError('');}} className="mt-1 text-[9px] font-black text-sky-800">Use this device</button></div>}<p className="mt-2 text-[9px] leading-4 text-slate-400">Enter the TV's Wi-Fi MAC when it connects wirelessly, or Ethernet MAC when it uses a cable. The detected device may be your phone, so Polyizon never selects it automatically.</p></div>
      {lookup?.found && <div className={`rounded-2xl border p-3 text-[10px] ${lookup.subscription?.status === 'active' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-100 bg-amber-50 text-amber-800'}`}><b className="block">{lookup.subscription?.status === 'active' ? 'This TV already has internet' : 'This TV is already registered'}</b><span className="mt-1 block">{lookup.subscription?.plan_name || 'TV package'}{lookup.subscription?.expires_at ? ` · expires ${new Date(lookup.subscription.expires_at).toLocaleString()}` : ''}. A new payment will renew it and can change its package.</span></div>}
      <div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Choose TV package</p><div className="mt-2 grid gap-2">{plans.map((plan) => <button type="button" key={plan.id} disabled={['sending','pending'].includes(status)} onClick={()=>{setSelectedPlanId(plan.id);setError('');}} className={`flex items-center justify-between rounded-2xl border p-3 text-left transition ${Number(selectedPlanId)===Number(plan.id)?'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100':'border-slate-200 bg-white'}`}><span><b className="block text-xs text-slate-900">{plan.name}</b><span className="mt-1 block text-[9px] text-slate-400">{durationText(plan.duration_minutes)} · {plan.mikrotik_rate_limit || 'Unlimited'}</span></span><strong className="text-sm text-emerald-700">{money(plan.price)}</strong></button>)}</div></div>
      <label className="block"><span className="text-[10px] font-black uppercase tracking-wide text-slate-500">M-Pesa phone</span><input required type="tel" inputMode="numeric" disabled={['sending','pending'].includes(status)} value={phone} onChange={(e)=>{setPhone(e.target.value);setError('');}} placeholder="0712 345 678" className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-emerald-400"/></label>
      {status === 'pending' && <div className="rounded-xl bg-emerald-50 p-3 text-[10px] font-bold leading-5 text-emerald-800">M-Pesa prompt sent. Enter your PIN on the phone. Polyizon will bind the TV MAC automatically after confirmation.</div>}{status === 'activating' && <div className="rounded-xl bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800">Payment received. Polyizon is preparing MAC access on the MikroTik. You do not need to pay again.</div>}{error && <div className={`rounded-xl p-3 text-[10px] font-bold leading-5 ${status==='failed'?'bg-rose-50 text-rose-700':'bg-amber-50 text-amber-800'}`}>{error}</div>}
      <button disabled={['sending','pending'].includes(status) || !selectedPlan || !config?.payment_enabled} className="w-full rounded-xl bg-emerald-600 py-3.5 text-xs font-black text-white shadow-lg shadow-emerald-200 disabled:cursor-not-allowed disabled:opacity-45">{preview?'Preview · payment disabled':status==='sending'?'Sending M-Pesa…':status==='pending'?'Waiting for payment…':status==='failed'?'Try payment again':selectedPlan?`Pay ${money(selectedPlan.price)}`:'Choose a package'}</button>{!config?.payment_enabled && <p className="text-center text-[9px] font-bold text-rose-600">M-Pesa is not configured for TV packages on this hotspot.</p>}</form>}
    </section></div>}
  </>;
}

function HotspotTvEnhancer() {
  const publicPortal = /^\/hotspot\/?$/.test(window.location.pathname);
  const [slot, setSlot] = useState(null);
  const [routers, setRouters] = useState([]);

  useEffect(() => {
    let currentHost = null;
    const scan = () => {
      let anchor = null;
      if (publicPortal) {
        anchor = document.querySelector('.hotspot-packages')?.closest('section') ||
          [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === 'Packages')?.closest('section') || null;
      } else {
        const heading = [...document.querySelectorAll('h3')].find((node) => node.textContent?.trim() === 'Hotspot Packages');
        anchor = heading?.closest('section') || null;
      }
      if (!anchor) {
        if (currentHost && !document.contains(currentHost)) currentHost = null;
        if (!currentHost) setSlot(null);
        return;
      }
      if (!currentHost || !document.contains(currentHost)) {
        currentHost = document.createElement('div');
        currentHost.dataset.polyizonTvSlot = publicPortal ? 'public' : 'admin';
      }
      if (anchor.nextElementSibling !== currentHost) anchor.insertAdjacentElement('afterend', currentHost);
      setSlot((previous) => previous === currentHost ? previous : currentHost);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(scan, 1500);
    return () => { observer.disconnect(); clearInterval(timer); if (currentHost?.parentNode) currentHost.parentNode.removeChild(currentHost); };
  }, [publicPortal]);

  useEffect(() => {
    if (publicPortal) return;
    api.get('/mikrotik').then((response) => {
      const data = response.data;
      setRouters(Array.isArray(data) ? data : Array.isArray(data?.routers) ? data.routers : []);
    }).catch(() => setRouters([]));
  }, [publicPortal]);

  if (!slot) return null;
  return createPortal(publicPortal ? <PublicTvPanel/> : <AdminTvPanel routers={routers}/>, slot);
}

let enhancerRoot = null;
export function mountHotspotTvEnhancer() {
  if (enhancerRoot || document.getElementById('polyizon-hotspot-tv-enhancer')) return;
  const host = document.createElement('div');
  host.id = 'polyizon-hotspot-tv-enhancer';
  host.style.display = 'contents';
  document.body.appendChild(host);
  enhancerRoot = createRoot(host);
  enhancerRoot.render(<HotspotTvEnhancer/>);
}
