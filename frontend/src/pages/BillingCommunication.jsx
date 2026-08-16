import React, { useEffect, useState } from 'react';
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
    message: <><path d="M21 12a8 8 0 0 1-8 8 9 9 0 0 1-4-.9L3 21l1.9-5A8 8 0 1 1 21 12Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
    phone: <path d="M5 4h3l2 5-2.4 1.4a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
    key: <><circle cx="8" cy="15" r="3" /><path d="m10.2 12.8 9.8-9.8M16 7l2 2M13 10l2 2" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="m11 13 4-4" /></>,
    qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16.5 9" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
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
  return <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${value.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`}>{value.message}</div>;
}

function AudienceComposer({ channel }) {
  const [audience, setAudience] = useState('all');
  const [routerId, setRouterId] = useState('');
  const [routers, setRouters] = useState([]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { api.get('/mikrotik').then(({ data }) => setRouters(Array.isArray(data) ? data : (data?.routers || []))).catch(() => setRouters([])); }, []);

  const send = async () => {
    if (!message.trim()) return setNotice({ type: 'error', message: 'Write a message before sending.' });
    setSending(true); setNotice(null);
    try {
      const { data } = await api.post('/settings/communication/send', { channel, audience, router_id: routerId || undefined, message: message.trim() });
      setNotice({ type: 'success', message: `${data.sent || 0} message${data.sent === 1 ? '' : 's'} queued for ${audienceOptions.find((item) => item.id === audience)?.label || 'your audience'}.` });
      setMessage('');
    } catch (error) {
      setNotice({ type: 'error', message: error.response?.data?.error || 'The message could not be sent.' });
    } finally { setSending(false); }
  };

  return <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_35px_rgba(15,23,42,.06)] sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-slate-950">Send {channel === 'sms' ? 'SMS' : 'WhatsApp'}</h3><p className="mt-1 text-xs text-slate-500">Choose an audience, use a template, and send from this billing account.</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${channel === 'sms' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>{channel}</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      <div className="relative"><button type="button" onClick={() => setAudienceOpen((open) => !open)} className="flex h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-left text-sm font-bold text-slate-700"><span>{audienceOptions.find((item) => item.id === audience)?.label}</span><span className="text-violet-600">⌄</span></button>{audienceOpen && <div className="absolute left-0 right-0 top-14 z-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">{audienceOptions.map((item) => <button type="button" key={item.id} onClick={() => { setAudience(item.id); setAudienceOpen(false); }} className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ${audience === item.id ? 'bg-violet-50 text-violet-700' : 'hover:bg-slate-50'}`}><span className="mt-1 h-2 w-2 rounded-full bg-violet-500" /><span><b className="block text-xs">{item.label}</b><small className="block text-[10px] text-slate-400">{item.note}</small></span></button>)}</div>}</div>
      <div className="relative"><button type="button" onClick={() => setTemplateOpen((open) => !open)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 text-xs font-black text-violet-700 sm:w-auto"><span>Templates</span><span>⌄</span></button>{templateOpen && <div className="absolute right-0 top-14 z-40 w-[min(330px,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">{messageTemplates.map((item) => <button type="button" key={item.id} onClick={() => { setMessage(item.body); setTemplateOpen(false); }} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-violet-50"><b className="block text-xs text-slate-800">{item.title}</b><small className="mt-1 block line-clamp-2 text-[10px] leading-4 text-slate-400">{item.body}</small></button>)}</div>}</div>
    </div>
    {audience === 'router' && <select value={routerId} onChange={(event) => setRouterId(event.target.value)} className="mt-3 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 outline-none focus:border-violet-400"><option value="">Select a router</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name || router.router_name || `Router ${router.id}`}</option>)}</select>}
    <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="Write your message... Use {{name}}, {{account}} or {{business}}" className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-5 outline-none focus:border-violet-400" />
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-[10px] text-slate-400">Personalization variables are replaced per subscriber.</span><button type="button" onClick={send} disabled={sending} className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-5 text-xs font-black text-white shadow-lg disabled:opacity-50 ${channel === 'sms' ? 'bg-violet-600 shadow-violet-200' : 'bg-[#25D366] shadow-emerald-200'}`}><Icon name="send" className="h-4 w-4" />{sending ? 'Sending...' : 'Send message'}</button></div>
    <Notice value={notice} />
  </section>;
}

function SmsPanel() {
  const [form, setForm] = useState({ provider: '', api_key: '', sender_id: '', partner_id: '', test_phone: '', has_api_key: false });
  const [providerOpen, setProviderOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState(null);

  const apply = (data) => setForm((current) => ({
    ...current,
    provider: data.has_api_key ? (data.provider === 'blessed' ? 'blessed_text' : (data.provider || '')) : '',
    sender_id: data.sender_id || '',
    partner_id: data.partner_id || '',
    api_key: '',
    has_api_key: Boolean(data.has_api_key),
  }));

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

  const selectProvider = (provider) => {
    setForm((current) => ({ ...current, provider, api_key: '', sender_id: '', partner_id: '', has_api_key: false }));
    setNotice(null);
  };

  const payload = () => ({
    provider: form.provider,
    api_key: form.api_key,
    sender_id: form.sender_id.trim(),
    partner_id: form.provider === 'savvy' ? form.partner_id.trim() : '',
  });

  const validate = () => {
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
      setNotice({ type: 'success', message: 'SMS provider credentials saved securely.' });
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

  if (loading) return <div className="rounded-3xl bg-white p-12 text-center text-sm font-bold text-slate-400">Loading SMS configuration...</div>;

  return <div className="space-y-5">
    <Notice value={notice} />
    <section className="rounded-[26px] border border-violet-100 bg-white p-5 shadow-[0_18px_55px_rgba(76,29,149,.08)] sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-xl font-black text-slate-950">SMS provider</h3><p className="mt-1 text-sm text-slate-500">Credentials belong only to this billing account.</p></div>
        <span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${form.has_api_key ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{form.has_api_key ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
      </div>
      <div className="relative mt-5"><button type="button" onClick={() => setProviderOpen((open) => !open)} className="flex h-14 w-full items-center justify-between rounded-2xl border border-violet-200 bg-violet-50 px-4 text-left transition hover:border-violet-400"><span><small className="block text-[10px] font-black uppercase tracking-wide text-violet-500">Provider</small><b className="mt-1 block text-sm text-slate-900">{providers.find((item) => item.id === form.provider)?.name || 'Select an SMS provider'}</b></span><span className="text-lg text-violet-600">⌄</span></button>{providerOpen && <div className="absolute left-0 right-0 top-16 z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">{providers.map((provider) => <button type="button" key={provider.id} onClick={() => { selectProvider(provider.id); setProviderOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition ${form.provider === provider.id ? 'bg-violet-50' : 'hover:bg-slate-50'}`}><span><b className="block text-sm text-slate-900">{provider.name}</b><small className="mt-1 block text-[10px] text-slate-400">{provider.note}</small></span>{form.provider === provider.id && <span className="text-violet-600">✓</span>}</button>)}</div>}</div>
      {form.provider && <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label><span className="text-xs font-black uppercase tracking-wide text-slate-500">{form.provider === 'talksasa' ? 'API token' : 'API key'}</span><div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4"><Icon name="key" className="h-5 w-5 text-violet-500" /><input type="password" value={form.api_key} onChange={(event) => setForm({ ...form, api_key: event.target.value })} placeholder={form.has_api_key ? 'Saved - enter only to replace it' : 'Enter provider credential'} className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div></label>
        <label><span className="text-xs font-black uppercase tracking-wide text-slate-500">Sender ID / Shortcode</span><input value={form.sender_id} onChange={(event) => setForm({ ...form, sender_id: event.target.value })} placeholder="Approved Sender ID" className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400" /></label>
        {form.provider === 'savvy' && <label className="sm:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Partner ID</span><input value={form.partner_id} onChange={(event) => setForm({ ...form, partner_id: event.target.value })} placeholder="Savvy Partner ID" className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400" /></label>}
      </div>}
      {form.provider && <div className="mt-5 flex justify-end"><button type="button" onClick={save} disabled={saving} className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 disabled:opacity-50">{saving ? 'Saving...' : 'Save SMS settings'}</button></div>}
    </section>
    <section className="rounded-[26px] border border-slate-200 bg-white p-5 sm:p-7">
      <h3 className="text-lg font-black text-slate-950">Send a test SMS</h3><p className="mt-1 text-sm text-slate-500">Confirm the provider credentials before sending subscriber notifications.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row"><div className="flex h-14 flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4"><Icon name="phone" className="h-5 w-5 text-violet-500" /><input value={form.test_phone} onChange={(event) => setForm({ ...form, test_phone: event.target.value })} placeholder="2547XXXXXXXX" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div><button type="button" onClick={test} disabled={testing} className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-violet-200 px-5 text-sm font-black text-violet-700 disabled:opacity-50"><Icon name="send" />{testing ? 'Sending...' : 'Send test'}</button></div>
    </section>
    <AudienceComposer channel="sms" />
  </div>;
}

function WhatsappPanel() {
  const [state, setState] = useState({ configured: false, connected: false, connection_state: 'not_configured' });
  const [method, setMethod] = useState('qr');
  const [phone, setPhone] = useState('');
  const [qr, setQr] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = async (quiet = false) => {
    try {
      const { data } = await api.get('/settings/whatsapp');
      setState(data);
      if (data.connected) { setQr(''); setPairingCode(''); }
    } catch (error) {
      if (!quiet) setNotice({ type: 'error', message: error.response?.data?.error || 'Could not load WhatsApp status.' });
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!qr && !pairingCode) return undefined;
    const timer = window.setInterval(() => load(true), 5000);
    return () => window.clearInterval(timer);
  }, [qr, pairingCode]);

  const connect = async () => {
    if (method === 'pairing_code' && phone.replace(/\D/g, '').length < 8) {
      return setNotice({ type: 'error', message: 'Enter a WhatsApp number with country code.' });
    }
    setBusy(true); setNotice(null); setQr(''); setPairingCode('');
    try {
      const { data } = await api.post('/settings/whatsapp/connect', { method, phone });
      setState((current) => ({ ...current, configured: true, connected: data.status === 'connected', connection_state: data.connection_state || data.status }));
      if (data.qr_code) setQr(data.qr_code.startsWith('data:image') ? data.qr_code : `data:image/png;base64,${data.qr_code}`);
      if (data.pairing_code) setPairingCode(data.pairing_code);
      setNotice({ type: 'success', message: data.message || 'WhatsApp connection started.' });
    } catch (error) {
      setNotice({ type: 'error', message: error.response?.data?.error || 'Could not start WhatsApp connection.' });
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = state.connected ? 'Connected' : state.configured ? 'Disconnected' : 'Not configured';
  return <div className="space-y-5">
    <Notice value={notice} />
    <section className="rounded-[26px] border border-emerald-100 bg-white p-5 shadow-[0_18px_55px_rgba(5,150,105,.08)] sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#25D366] shadow-lg shadow-emerald-200"><WhatsappIcon className="h-9 w-9" /></span><div><h3 className="text-xl font-black text-slate-950">WhatsApp connection</h3><p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">Connect the billing account number through Baileys to send invoices, payment confirmations, expiry reminders and support updates.</p></div></div>
        <span className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-[10px] font-black ${state.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}><span className={`h-2 w-2 rounded-full ${state.connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />{statusLabel.toUpperCase()}</span>
      </div>
      {state.instance_name && <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500"><b className="text-slate-700">Instance:</b> {state.instance_name}<span className="mx-2">-</span><b className="text-slate-700">State:</b> {state.connection_state || 'unknown'}</div>}
      {state.connected ? <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-emerald-800"><Icon name="check" className="h-7 w-7" /><div><b className="block">WhatsApp is ready</b><span className="text-sm">Subscriber messages can use this connected account.</span></div></div> : <>
        <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={() => setMethod('qr')} className={`rounded-2xl border p-4 text-left ${method === 'qr' ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200'}`}><Icon name="qr" className="h-6 w-6 text-emerald-600" /><b className="mt-3 block text-sm text-slate-900">Scan QR code</b><span className="mt-1 block text-xs text-slate-500">Best when WhatsApp is on another phone.</span></button><button type="button" onClick={() => setMethod('pairing_code')} className={`rounded-2xl border p-4 text-left ${method === 'pairing_code' ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100' : 'border-slate-200'}`}><Icon name="key" className="h-6 w-6 text-violet-600" /><b className="mt-3 block text-sm text-slate-900">Pairing code</b><span className="mt-1 block text-xs text-slate-500">Best when this is your only phone.</span></button></div>
        {method === 'pairing_code' && <label className="mt-5 block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">WhatsApp number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="2547XXXXXXXX" className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400" /></label>}
        <button type="button" onClick={connect} disabled={busy} className="mt-5 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-600 disabled:opacity-50"><Icon name={busy ? 'refresh' : method === 'qr' ? 'qr' : 'key'} className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Preparing connection...' : method === 'qr' ? 'Generate QR code' : 'Generate pairing code'}</button>
      </>}
    </section>
    {qr && !state.connected && <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-center sm:p-7"><h3 className="text-lg font-black text-slate-950">Scan from WhatsApp</h3><p className="mt-1 text-sm text-slate-500">WhatsApp - Linked devices - Link a device</p><div className="mx-auto mt-5 w-fit rounded-3xl border-8 border-white bg-white p-2 shadow-xl"><img src={qr} alt="WhatsApp connection QR code" className="h-64 w-64 max-w-full" /></div><div className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-amber-600"><Icon name="refresh" className="h-4 w-4 animate-spin" />Waiting for scan and connection...</div></section>}
    {pairingCode && !state.connected && <section className="rounded-[26px] border border-violet-100 bg-white p-6 text-center"><h3 className="text-lg font-black text-slate-950">Enter this pairing code</h3><p className="mt-1 text-sm text-slate-500">Open WhatsApp linked devices and choose link with phone number.</p><button type="button" onClick={() => navigator.clipboard?.writeText(pairingCode)} className="mx-auto mt-5 inline-flex items-center gap-3 rounded-2xl bg-violet-50 px-6 py-4 font-mono text-2xl font-black tracking-[.2em] text-violet-700"><Icon name="copy" />{pairingCode}</button><p className="mt-4 text-xs font-bold text-amber-600">This code expires. Generate a new one if it is rejected.</p></section>}
    <AudienceComposer channel="whatsapp" />
  </div>;
}

export default function BillingCommunication() {
  const [section, setSection] = useState('sms');
  return <div data-billing-communication className="-mx-5 -mt-5 space-y-5 sm:-mx-8 sm:-mt-8">
    <section className="relative isolate overflow-hidden billing-network-hero bg-[#0a2417] px-5 pb-20 pt-7 text-white sm:px-8">
      <div className="relative z-10"><p className="text-[10px] font-black uppercase tracking-[.2em] text-violet-200">Customer engagement</p><h2 className="mt-2 text-3xl font-black tracking-tight">Communication</h2><p className="mt-2 max-w-xl text-sm leading-6 text-violet-100">Configure the channels this billing account uses to reach subscribers.</p></div>
      <div className="pointer-events-none absolute right-[-8%] top-3 h-36 w-3/5 opacity-20"><svg viewBox="0 0 600 180" className="h-full w-full"><path d="M0 120 C120 20 220 180 350 80 S520 20 600 70" fill="none" stroke="white" strokeWidth="2" /><path d="M0 145 C120 45 220 205 350 105 S520 45 600 95" fill="none" stroke="white" /></svg></div>
      <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-16"><svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full"><path d="M0 100 C180 20 300 190 510 115 C720 40 780 175 1000 70 C1090 28 1140 65 1200 25 L1200 180 L0 180 Z" fill="#f7f8f7" /></svg></div>
    </section>
    <div className="px-5 pb-24 sm:px-8"><div className="mb-5 grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm"><button type="button" onClick={() => setSection('sms')} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${section === 'sms' ? 'bg-violet-600 text-white shadow-lg shadow-violet-200' : 'text-slate-500'}`}><Icon name="message" className="h-5 w-5" />SMS</button><button type="button" onClick={() => setSection('whatsapp')} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${section === 'whatsapp' ? 'bg-[#25D366] text-white shadow-lg shadow-emerald-200' : 'text-slate-500'}`}><WhatsappIcon className="h-5 w-5" />WhatsApp</button></div>{section === 'sms' ? <SmsPanel /> : <WhatsappPanel />}</div>
  </div>;
}
