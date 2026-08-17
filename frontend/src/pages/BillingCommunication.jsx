import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const providers = [
  { id: 'blessed_text', name: 'Blessed Text', note: 'API key and approved Sender ID' },
  { id: 'savvy', name: 'Savvy Bulk SMS', note: 'API key, Partner ID and Sender ID' },
  { id: 'talksasa', name: 'Talk Sasa', note: 'API token and approved Sender ID' },
];

const audienceOptions = [
  { id: 'all', label: 'All subscribers', note: 'Every subscriber with a valid contact' },
  { id: 'online', label: 'Online now', note: 'Subscribers with an active session' },
  { id: 'offline', label: 'Offline', note: 'Subscribers with no active session' },
  { id: 'expired', label: 'Expired accounts', note: 'Subscribers who need a recharge' },
  { id: 'new', label: 'New subscribers', note: 'Recently added accounts' },
  { id: 'router', label: 'By router', note: 'Choose a connected router' },
];

const messageTemplates = [
  { id: 'expiry', title: 'Internet expired', body: 'Hello {{name}}, your internet package for account {{account}} has expired. Recharge to restore access.' },
  { id: 'welcome', title: 'Welcome message', body: 'Hello {{name}}, welcome to {{business}}. Your account {{account}} is ready to use.' },
  { id: 'maintenance', title: 'Planned maintenance', body: 'Hello {{name}}, we will be performing network maintenance today. Thank you for your patience.' },
  { id: 'payment', title: 'Payment received', body: 'Hello {{name}}, we have received your payment for account {{account}}. Thank you.' },
];

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.66 3.8l.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1v-.1h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z" /></>,
    sms: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m5 8 7 5 7-5" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="m11 13 4-4" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    template: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    router: <><rect x="3" y="8" width="18" height="10" rx="2" /><path d="M7 12h.01M11 12h.01M17 12h.01M8 8l4-4 4 4" /></>,
    key: <><circle cx="8" cy="15" r="3" /><path d="m10.2 12.8 9.8-9.8M16 7l2 2M13 10l2 2" /></>,
    phone: <path d="M5 4h3l2 5-2.4 1.4a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
    qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16.5 9" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
    spark: <><path d="m12 2 1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  };

  return <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function WhatsappIcon({ className = 'h-5 w-5' }) {
  return <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#25D366" />
    <path fill="#fff" d="M16 6a10 10 0 0 0-8.55 15.18L6 25.8l4.76-1.4A10 10 0 1 0 16 6Zm0 17.9a7.88 7.88 0 0 1-4.03-1.1l-.3-.18-2.83.83.85-2.75-.2-.31A7.9 7.9 0 1 1 16 23.9Zm4.35-5.72c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.41-1.33-1.65-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.31-.74-1.8-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.16 1.51.1.46-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
  </svg>;
}

function Notice({ value }) {
  if (!value) return null;
  return <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${value.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`}>{value.message}</div>;
}

function SmsSettings({ onChange }) {
  const [form, setForm] = useState({ provider: '', api_key: '', sender_id: '', partner_id: '', test_phone: '', has_api_key: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState(null);

  const apply = (data) => {
    const next = {
      provider: data?.has_api_key ? (data.provider === 'blessed' ? 'blessed_text' : (data.provider || '')) : '',
      sender_id: data?.sender_id || '',
      partner_id: data?.partner_id || '',
      api_key: '',
      test_phone: '',
      has_api_key: Boolean(data?.has_api_key),
    };
    setForm(next);
    onChange?.(Boolean(data?.has_api_key));
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/communication');
      apply(data);
    } catch (error) {
      setNotice({ type: 'error', message: error.response?.data?.error || 'Could not load SMS settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const payload = () => ({
    provider: form.provider,
    api_key: form.api_key,
    sender_id: form.sender_id.trim(),
    partner_id: form.provider === 'savvy' ? form.partner_id.trim() : '',
  });

  const validate = () => {
    if (!form.provider) return 'Select an SMS provider.';
    if (!form.sender_id.trim()) return 'Enter the approved Sender ID or shortcode.';
    if (!form.has_api_key && !form.api_key.trim()) return 'Enter the provider API key or token.';
    if (form.provider === 'savvy' && !form.partner_id.trim()) return 'Enter the Savvy Partner ID.';
    return '';
  };

  const save = async () => {
    const error = validate();
    if (error) return setNotice({ type: 'error', message: error });
    setSaving(true); setNotice(null);
    try {
      const { data } = await api.put('/settings/communication', payload());
      apply(data);
      setNotice({ type: 'success', message: 'SMS settings saved.' });
    } catch (requestError) {
      setNotice({ type: 'error', message: requestError.response?.data?.error || 'Could not save SMS settings.' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    const error = validate();
    if (error) return setNotice({ type: 'error', message: error });
    if (!form.test_phone.trim()) return setNotice({ type: 'error', message: 'Enter a test phone number.' });
    setTesting(true); setNotice(null);
    try {
      const { data } = await api.post('/settings/communication/test', { ...payload(), phone: form.test_phone.trim() });
      setNotice({ type: 'success', message: `Test SMS sent to +${data.sent_to}.` });
    } catch (requestError) {
      setNotice({ type: 'error', message: requestError.response?.data?.error || 'The test SMS could not be sent.' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="rounded-3xl bg-white p-10 text-center text-sm font-semibold text-slate-400">Loading SMS configuration...</div>;

  return <div className="space-y-4">
    <Notice value={notice} />
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">Provider</span>
        <select value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value, api_key: '', sender_id: '', partner_id: '', has_api_key: false }))} className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none focus:border-emerald-400">
          <option value="">Select provider</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select>
        {form.provider && <small className="mt-2 block text-xs text-slate-400">{providers.find((provider) => provider.id === form.provider)?.note}</small>}
      </label>

      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">{form.provider === 'talksasa' ? 'API token' : 'API key'}</span>
        <div className="mt-2 flex h-14 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4">
          <Icon name="key" className="h-5 w-5 text-emerald-600" />
          <input type="password" value={form.api_key} onChange={(event) => setForm((current) => ({ ...current, api_key: event.target.value }))} placeholder={form.has_api_key ? 'Saved - enter only to replace' : 'Enter credential'} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
      </label>

      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">Sender ID / shortcode</span>
        <input value={form.sender_id} onChange={(event) => setForm((current) => ({ ...current, sender_id: event.target.value }))} placeholder="Approved Sender ID" className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400" />
      </label>

      {form.provider === 'savvy' && <label className="block">
        <span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">Partner ID</span>
        <input value={form.partner_id} onChange={(event) => setForm((current) => ({ ...current, partner_id: event.target.value }))} placeholder="Savvy Partner ID" className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400" />
      </label>}
    </div>

    <div className="flex justify-end"><button type="button" onClick={save} disabled={saving} className="h-12 rounded-2xl bg-emerald-500 px-6 text-sm font-black text-white shadow-lg shadow-emerald-200 disabled:opacity-50">{saving ? 'Saving...' : 'Save SMS settings'}</button></div>

    <div className="border-t border-slate-200 pt-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-14 flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4"><Icon name="phone" className="h-5 w-5 text-emerald-600" /><input value={form.test_phone} onChange={(event) => setForm((current) => ({ ...current, test_phone: event.target.value }))} placeholder="2547XXXXXXXX" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
        <button type="button" onClick={test} disabled={testing} className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 text-sm font-black text-emerald-700 disabled:opacity-50"><Icon name="send" className="h-4 w-4" />{testing ? 'Sending...' : 'Send test'}</button>
      </div>
    </div>
  </div>;
}

function WhatsappSettings({ onChange }) {
  const [state, setState] = useState({ configured: false, connected: false, connection_state: 'not_configured' });
  const [method, setMethod] = useState('qr');
  const [phone, setPhone] = useState('');
  const [qr, setQr] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await api.get('/settings/whatsapp');
      setState(data);
      onChange?.(Boolean(data?.connected));
      if (data.connected) { setQr(''); setPairingCode(''); }
    } catch (error) {
      if (!quiet) setNotice({ type: 'error', message: error.response?.data?.error || 'Could not load WhatsApp status.' });
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { load(false); }, []);
  useEffect(() => {
    if (!qr && !pairingCode) return undefined;
    const timer = window.setInterval(() => load(true), 5000);
    return () => window.clearInterval(timer);
  }, [qr, pairingCode]);

  const connect = async () => {
    if (method === 'pairing_code' && phone.replace(/\D/g, '').length < 8) return setNotice({ type: 'error', message: 'Enter a WhatsApp number with country code.' });
    setBusy(true); setNotice(null); setQr(''); setPairingCode('');
    try {
      const { data } = await api.post('/settings/whatsapp/connect', { method, phone });
      const next = { ...state, configured: true, connected: data.status === 'connected', connection_state: data.connection_state || data.status };
      setState(next);
      onChange?.(Boolean(next.connected));
      if (data.qr_code) setQr(data.qr_code.startsWith('data:image') ? data.qr_code : `data:image/png;base64,${data.qr_code}`);
      if (data.pairing_code) setPairingCode(data.pairing_code);
      setNotice({ type: 'success', message: data.message || 'WhatsApp connection started.' });
    } catch (error) {
      setNotice({ type: 'error', message: error.response?.data?.error || 'Could not start WhatsApp connection.' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="rounded-3xl bg-white p-10 text-center text-sm font-semibold text-slate-400">Loading WhatsApp configuration...</div>;

  return <div className="space-y-4">
    <Notice value={notice} />
    {state.connected ? <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-800"><Icon name="check" className="h-6 w-6" /><div><b className="block text-sm">WhatsApp is ready</b><span className="text-xs">The connected account can send subscriber messages.</span></div></div> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setMethod('qr')} className={`rounded-2xl border p-4 text-left ${method === 'qr' ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 bg-white'}`}><Icon name="qr" className="h-6 w-6 text-emerald-600" /><b className="mt-3 block text-sm text-slate-900">Scan QR code</b><span className="mt-1 block text-xs text-slate-500">Link WhatsApp from another phone.</span></button>
        <button type="button" onClick={() => setMethod('pairing_code')} className={`rounded-2xl border p-4 text-left ${method === 'pairing_code' ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 bg-white'}`}><Icon name="key" className="h-6 w-6 text-emerald-600" /><b className="mt-3 block text-sm text-slate-900">Pairing code</b><span className="mt-1 block text-xs text-slate-500">Link using the WhatsApp phone number.</span></button>
      </div>
      {method === 'pairing_code' && <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="2547XXXXXXXX" className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400" />}
      <button type="button" onClick={connect} disabled={busy} className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 text-sm font-black text-white shadow-lg shadow-emerald-200 disabled:opacity-50"><Icon name={busy ? 'refresh' : method === 'qr' ? 'qr' : 'key'} className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Preparing...' : method === 'qr' ? 'Generate QR code' : 'Generate pairing code'}</button>
    </>}

    {qr && !state.connected && <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center"><img src={qr} alt="WhatsApp connection QR code" className="mx-auto h-64 w-64 max-w-full" /><p className="mt-4 text-xs font-semibold text-amber-600">Waiting for scan...</p></div>}
    {pairingCode && !state.connected && <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center"><button type="button" onClick={() => navigator.clipboard?.writeText(pairingCode)} className="inline-flex items-center gap-3 rounded-2xl bg-emerald-50 px-6 py-4 font-mono text-2xl font-black tracking-[.18em] text-emerald-700"><Icon name="copy" className="h-5 w-5" />{pairingCode}</button><p className="mt-3 text-xs text-slate-500">Enter this code in WhatsApp linked devices.</p></div>}
  </div>;
}

function SettingsModal({ open, onClose, onSmsChange, onWhatsappChange }) {
  const [tab, setTab] = useState('sms');
  if (!open) return null;

  return <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-8 backdrop-blur-sm">
    <div className="w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/50 bg-[#f7f8f7] shadow-[0_35px_80px_rgba(15,23,42,.28)]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-5 sm:px-7"><div><p className="text-[10px] font-black uppercase tracking-[.22em] text-emerald-600">Communication</p><h3 className="mt-1 text-2xl font-black text-slate-950">Configuration</h3></div><button type="button" onClick={onClose} aria-label="Close configuration" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 hover:text-slate-900"><Icon name="close" /></button></div>
      <div className="p-5 sm:p-7">
        <div className="mb-5 grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1.5"><button type="button" onClick={() => setTab('sms')} className={`rounded-xl px-4 py-3 text-sm font-black ${tab === 'sms' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'text-slate-500'}`}><span className="inline-flex items-center gap-2"><Icon name="sms" className="h-4 w-4" />SMS</span></button><button type="button" onClick={() => setTab('whatsapp')} className={`rounded-xl px-4 py-3 text-sm font-black ${tab === 'whatsapp' ? 'bg-[#25D366] text-white shadow-lg shadow-emerald-200' : 'text-slate-500'}`}><span className="inline-flex items-center gap-2"><WhatsappIcon className="h-4 w-4" />WhatsApp</span></button></div>
        {tab === 'sms' ? <SmsSettings onChange={onSmsChange} /> : <WhatsappSettings onChange={onWhatsappChange} />}
      </div>
    </div>
  </div>;
}

function MessageComposer({ channel }) {
  const [audience, setAudience] = useState('all');
  const [routerId, setRouterId] = useState('');
  const [routers, setRouters] = useState([]);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { api.get('/mikrotik').then(({ data }) => setRouters(Array.isArray(data) ? data : (data?.routers || []))).catch(() => setRouters([])); }, []);
  const selectedAudience = useMemo(() => audienceOptions.find((item) => item.id === audience) || audienceOptions[0], [audience]);

  const send = async () => {
    if (!message.trim()) return setNotice({ type: 'error', message: 'Write a message before sending.' });
    setSending(true); setNotice(null);
    try {
      const { data } = await api.post('/settings/communication/send', { channel, audience, router_id: routerId || undefined, message: message.trim() });
      setNotice({ type: 'success', message: `${data.sent || 0} message${data.sent === 1 ? '' : 's'} queued for ${selectedAudience.label}.` });
      setMessage('');
    } catch (error) {
      setNotice({ type: 'error', message: error.response?.data?.error || 'The message could not be sent.' });
    } finally { setSending(false); }
  };

  return <div className="space-y-4">
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,.05)] sm:p-7">
      <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Icon name="send" className="h-5 w-5" /></span><div><h3 className="text-xl font-black text-slate-950">New message</h3><p className="mt-1 text-sm text-slate-500">Choose the audience, write the message, then send.</p></div></div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[.85fr_1.15fr]">
        <div className="space-y-4">
          <label className="block"><span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">Audience</span><div className="relative mt-2"><Icon name="users" className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-emerald-600" /><select value={audience} onChange={(event) => setAudience(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-sm text-slate-800 outline-none focus:border-emerald-400">{audienceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div><small className="mt-2 block text-xs text-slate-400">{selectedAudience.note}</small></label>

          {audience === 'router' && <label className="block"><span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">Router</span><div className="relative mt-2"><Icon name="router" className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-emerald-600" /><select value={routerId} onChange={(event) => setRouterId(event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-sm text-slate-800 outline-none focus:border-emerald-400"><option value="">Select router</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name || router.router_name || `Router ${router.id}`}</option>)}</select></div></label>}

          <div><span className="text-[11px] font-black uppercase tracking-[.18em] text-slate-500">Quick templates</span><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{messageTemplates.map((template) => <button type="button" key={template.id} onClick={() => setMessage(template.body)} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700"><Icon name="template" className="h-4 w-4" /></span><span><b className="block text-sm text-slate-800">{template.title}</b><small className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-400">{template.body}</small></span></button>)}</div></div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={10} placeholder="Write your message..." className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-800 outline-none focus:border-emerald-400" />
          <div className="mt-3 flex flex-wrap gap-2">{['{{name}}', '{{account}}', '{{business}}'].map((token) => <button type="button" key={token} onClick={() => setMessage((current) => `${current}${current ? ' ' : ''}${token}`)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-emerald-300 hover:text-emerald-700"><Icon name="spark" className="h-3.5 w-3.5" />{token}</button>)}</div>
          <div className="mt-5 flex justify-end"><button type="button" onClick={send} disabled={sending} className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-black text-white shadow-lg disabled:opacity-50 ${channel === 'sms' ? 'bg-emerald-500 shadow-emerald-200 hover:bg-emerald-600' : 'bg-[#25D366] shadow-emerald-200'}`}><Icon name="send" className="h-4 w-4" />{sending ? 'Sending...' : channel === 'sms' ? 'Send SMS' : 'Send WhatsApp'}</button></div>
        </div>
      </div>
    </section>
    <Notice value={notice} />
  </div>;
}

export default function BillingCommunication() {
  const [channel, setChannel] = useState('sms');
  const [configOpen, setConfigOpen] = useState(false);
  const [smsReady, setSmsReady] = useState(null);
  const [whatsappReady, setWhatsappReady] = useState(null);

  const loadStatus = async () => {
    const [smsResult, whatsappResult] = await Promise.allSettled([
      api.get('/settings/communication'),
      api.get('/settings/whatsapp'),
    ]);
    if (smsResult.status === 'fulfilled') setSmsReady(Boolean(smsResult.value.data?.has_api_key));
    if (whatsappResult.status === 'fulfilled') setWhatsappReady(Boolean(whatsappResult.value.data?.connected));
  };

  useEffect(() => { loadStatus(); }, []);

  const needsAction = channel === 'sms' ? smsReady === false : whatsappReady === false;

  return <div data-billing-communication className="-mx-5 -mt-5 space-y-5 sm:-mx-8 sm:-mt-8">
    <section className="relative isolate overflow-hidden billing-network-hero bg-[#0a2417] px-5 pb-20 pt-7 text-white sm:px-8">
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-200">Customer engagement</p><h2 className="mt-2 text-3xl font-black tracking-tight">Communication</h2><p className="mt-2 max-w-xl text-sm leading-6 text-emerald-100">Send subscriber messages from one simple workspace.</p></div>
        <button type="button" onClick={() => setConfigOpen(true)} aria-label="Communication configuration" title="Communication configuration" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/15"><Icon name="gear" className="h-5 w-5" /></button>
      </div>
      <div className="pointer-events-none absolute right-[-8%] top-3 h-36 w-3/5 opacity-20"><svg viewBox="0 0 600 180" className="h-full w-full"><path d="M0 120 C120 20 220 180 350 80 S520 20 600 70" fill="none" stroke="white" strokeWidth="2" /><path d="M0 145 C120 45 220 205 350 105 S520 45 600 95" fill="none" stroke="white" /></svg></div>
      <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-16"><svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full"><path d="M0 100 C180 20 300 190 510 115 C720 40 780 175 1000 70 C1090 28 1140 65 1200 25 L1200 180 L0 180 Z" fill="#f7f8f7" /></svg></div>
    </section>

    <div className="px-5 pb-24 sm:px-8">
      {needsAction && <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800"><Icon name="warning" className="h-5 w-5 shrink-0" /><span className="text-sm font-bold">Action needed: {channel === 'sms' ? 'configure SMS before sending messages.' : 'connect WhatsApp before sending messages.'}</span></div>}

      <div className="mb-5 grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm"><button type="button" onClick={() => setChannel('sms')} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${channel === 'sms' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'text-slate-500'}`}><Icon name="sms" className="h-5 w-5" />SMS</button><button type="button" onClick={() => setChannel('whatsapp')} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${channel === 'whatsapp' ? 'bg-[#25D366] text-white shadow-lg shadow-emerald-200' : 'text-slate-500'}`}><WhatsappIcon className="h-5 w-5" />WhatsApp</button></div>

      <MessageComposer channel={channel} />
    </div>

    <SettingsModal open={configOpen} onClose={() => { setConfigOpen(false); loadStatus(); }} onSmsChange={setSmsReady} onWhatsappChange={setWhatsappReady} />
  </div>;
}
