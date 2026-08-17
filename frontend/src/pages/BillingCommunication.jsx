import React, { useEffect, useState } from 'react';
import api from '../utils/api';

const providers = [
  { id: 'blessed_text', name: 'Blessed Text', note: 'API key and approved Sender ID' },
  { id: 'savvy', name: 'Savvy Bulk SMS', note: 'API key, Partner ID and Sender ID' },
  { id: 'talksasa', name: 'Talk Sasa', note: 'API token and approved Sender ID' },
];

const audienceOptions = [
  { id: 'all', label: 'All subscribers', note: 'Every subscriber with a valid contact', icon: 'users' },
  { id: 'online', label: 'Online now', note: 'Subscribers with an active session', icon: 'signal' },
  { id: 'offline', label: 'Offline', note: 'Subscribers with no active session', icon: 'offline' },
  { id: 'expired', label: 'Expired accounts', note: 'Subscribers who need a recharge', icon: 'clock' },
  { id: 'new', label: 'New subscribers', note: 'Recently added accounts', icon: 'spark' },
  { id: 'router', label: 'By router', note: 'Choose a connected router', icon: 'router' },
];

const messageTemplates = [
  { id: 'expiry', title: 'Internet expired', body: 'Hello {{name}}, your internet package for account {{account}} has expired. Recharge to restore access.' },
  { id: 'welcome', title: 'Welcome message', body: 'Hello {{name}}, welcome to {{business}}. Your account {{account}} is ready to use.' },
  { id: 'maintenance', title: 'Planned maintenance', body: 'Hello {{name}}, we will be performing network maintenance today. Thank you for your patience.' },
  { id: 'payment', title: 'Payment received', body: 'Hello {{name}}, we have received your payment for account {{account}}. Thank you.' },
];

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    message: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4.3A2.5 2.5 0 0 1 4 13.3Z" /><path d="M8 8h8M8 12h5" /></>,
    sms: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m5 8 7 5 7-5" /></>,
    phone: <path d="M5 4h3l2 5-2.4 1.4a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
    key: <><circle cx="8" cy="15" r="3" /><path d="m10.2 12.8 9.8-9.8M16 7l2 2M13 10l2 2" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="m11 13 4-4" /></>,
    qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16.5 9" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    template: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M9 9v11" /></>,
    router: <><rect x="3" y="8" width="18" height="10" rx="2" /><path d="M7 12h.01M11 12h.01M17 12h.01M8 8l4-4 4 4" /></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.1 7.9 7.5 9.5 4.4-1.6 7.5-4.9 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.2 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.8 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2v-4h.1A1.7 1.7 0 0 0 3.7 8.2a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 3.8a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1A1.7 1.7 0 0 0 14.8 3.7a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.2 8c.2.4.4.7.8 1 .3.2.7.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.6Z" /></>,
    signal: <><path d="M5 17h.01M9 14h.01M13 11h.01M17 8h.01" /><path d="M4 20h16" /></>,
    offline: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01" /><path d="m3 3 18 18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    spark: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" /></>,
    broadcast: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></>,
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.message}
    </svg>
  );
}

function WhatsappIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path fill="#fff" d="M16 6a10 10 0 0 0-8.55 15.18L6 25.8l4.76-1.4A10 10 0 1 0 16 6Zm0 17.9a7.88 7.88 0 0 1-4.03-1.1l-.3-.18-2.83.83.85-2.75-.2-.31A7.9 7.9 0 1 1 16 23.9Zm4.35-5.72c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.41-1.33-1.65-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.31-.74-1.8-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.16 1.51.1.46-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

function Notice({ value }) {
  if (!value) return null;
  const success = value.type === 'success';

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-[13px] font-semibold ${
      success
        ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
        : 'border-rose-100 bg-rose-50 text-rose-700'
    }`}>
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
        success ? 'bg-emerald-100' : 'bg-rose-100'
      }`}>
        <Icon name={success ? 'check' : 'message'} className="h-3.5 w-3.5" />
      </span>
      <span className="leading-5">{value.message}</span>
    </div>
  );
}

function SectionHeading({ icon, eyebrow, title, description, badge }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-emerald-600">{eyebrow}</p>}
          <h3 className="mt-0.5 text-[18px] font-black tracking-tight text-slate-950">{title}</h3>
          {description && <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-500">{description}</p>}
        </div>
      </div>
      {badge}
    </div>
  );
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

  useEffect(() => {
    api.get('/mikrotik')
      .then(({ data }) => setRouters(Array.isArray(data) ? data : (data?.routers || [])))
      .catch(() => setRouters([]));
  }, []);

  const send = async () => {
    if (!message.trim()) {
      setNotice({ type: 'error', message: 'Write a message before sending.' });
      return;
    }

    setSending(true);
    setNotice(null);

    try {
      const { data } = await api.post('/settings/communication/send', {
        channel,
        audience,
        router_id: routerId || undefined,
        message: message.trim(),
      });

      setNotice({
        type: 'success',
        message: `${data.sent || 0} message${data.sent === 1 ? '' : 's'} queued for ${
          audienceOptions.find((item) => item.id === audience)?.label || 'your audience'
        }.`,
      });
      setMessage('');
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.response?.data?.error || 'The message could not be sent.',
      });
    } finally {
      setSending(false);
    }
  };

  const selectedAudience = audienceOptions.find((item) => item.id === audience) || audienceOptions[0];
  const isSms = channel === 'sms';

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_50px_rgba(15,23,42,.055)] sm:p-5">
      <SectionHeading
        icon="broadcast"
        eyebrow="Broadcast"
        title="Message composer"
        description="Choose who should receive the message, start from a template, then send from the active channel."
        badge={
          <span className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] ${
            isSms
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : 'border-[#25D366]/20 bg-[#25D366]/10 text-emerald-700'
          }`}>
            {isSms ? <Icon name="sms" className="h-3.5 w-3.5" /> : <WhatsappIcon className="h-3.5 w-3.5" />}
            {isSms ? 'SMS' : 'WhatsApp'}
          </span>
        }
      />

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setAudienceOpen((open) => !open);
              setTemplateOpen(false);
            }}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
              <Icon name={selectedAudience.icon} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <small className="block text-[9px] font-extrabold uppercase tracking-[.12em] text-slate-400">Audience</small>
              <b className="mt-0.5 block truncate text-[12px] font-bold text-slate-800">{selectedAudience.label}</b>
            </span>
            <Icon name="chevron" className={`h-4 w-4 text-slate-400 transition ${audienceOpen ? 'rotate-180' : ''}`} />
          </button>

          {audienceOpen && (
            <div className="absolute left-0 right-0 top-[58px] z-40 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_22px_60px_rgba(15,23,42,.16)]">
              {audienceOptions.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setAudience(item.id);
                    setAudienceOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    audience === item.id ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    audience === item.id ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Icon name={item.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[12px] font-bold text-slate-800">{item.label}</b>
                    <small className="mt-0.5 block text-[10px] leading-4 text-slate-400">{item.note}</small>
                  </span>
                  {audience === item.id && <Icon name="check" className="h-4 w-4 text-emerald-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setTemplateOpen((open) => !open);
              setAudienceOpen(false);
            }}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/30"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Icon name="template" className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <small className="block text-[9px] font-extrabold uppercase tracking-[.12em] text-slate-400">Quick start</small>
              <b className="mt-0.5 block text-[12px] font-bold text-slate-800">Templates</b>
            </span>
            <Icon name="chevron" className={`h-4 w-4 text-slate-400 transition ${templateOpen ? 'rotate-180' : ''}`} />
          </button>

          {templateOpen && (
            <div className="absolute right-0 top-[58px] z-40 w-full min-w-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_22px_60px_rgba(15,23,42,.16)] md:w-[350px]">
              {messageTemplates.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setMessage(item.body);
                    setTemplateOpen(false);
                  }}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-emerald-50"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Icon name="message" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <b className="block text-[12px] font-bold text-slate-800">{item.title}</b>
                    <small className="mt-1 block line-clamp-2 text-[10px] leading-4 text-slate-400">{item.body}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {audience === 'router' && (
        <label className="mt-3 block">
          <span className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-slate-500">
            <Icon name="router" className="h-3.5 w-3.5 text-emerald-600" />
            Target router
          </span>
          <select
            value={routerId}
            onChange={(event) => setRouterId(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[12px] font-semibold text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
          >
            <option value="">Select a router</option>
            {routers.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name || router.router_name || `Router ${router.id}`}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 transition focus-within:border-emerald-300 focus-within:ring-4 focus-within:ring-emerald-50">
        <div className="flex items-center justify-between border-b border-slate-200/70 px-3.5 py-2">
          <span className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-slate-500">
            <Icon name="message" className="h-3.5 w-3.5 text-emerald-600" />
            Message
          </span>
          <span className="text-[10px] font-semibold text-slate-400">{message.length} characters</span>
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          placeholder="Write your message..."
          className="w-full resize-none bg-transparent px-3.5 py-3 text-[13px] leading-5 text-slate-800 outline-none placeholder:text-slate-400"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {['{{name}}', '{{account}}', '{{business}}'].map((variable) => (
          <button
            type="button"
            key={variable}
            onClick={() => setMessage((current) => `${current}${current ? ' ' : ''}${variable}`)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-500 transition hover:border-emerald-200 hover:text-emerald-700"
          >
            {variable}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-[10px] leading-4 text-slate-400">
          Variables are personalized for each subscriber before the message is queued.
        </p>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-[12px] font-extrabold text-white shadow-[0_8px_24px_rgba(16,185,129,.22)] transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name={sending ? 'refresh' : 'send'} className={`h-4 w-4 ${sending ? 'animate-spin' : ''}`} />
          {sending ? 'Sending...' : `Send ${isSms ? 'SMS' : 'WhatsApp'}`}
        </button>
      </div>

      <div className="mt-3">
        <Notice value={notice} />
      </div>
    </section>
  );
}

function SmsPanel() {
  const [form, setForm] = useState({
    provider: '',
    api_key: '',
    sender_id: '',
    partner_id: '',
    test_phone: '',
    has_api_key: false,
  });
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
      setNotice({
        type: 'error',
        message: error.response?.data?.error || 'Could not load SMS settings.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selectProvider = (provider) => {
    setForm((current) => ({
      ...current,
      provider,
      api_key: '',
      sender_id: '',
      partner_id: '',
      has_api_key: false,
    }));
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
    if (error) {
      setNotice({ type: 'error', message: error });
      return;
    }

    setSaving(true);
    setNotice(null);

    try {
      const { data } = await api.put('/settings/communication', payload());
      apply(data);
      setNotice({ type: 'success', message: 'SMS provider credentials saved securely.' });
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: requestError.response?.data?.error || 'Could not save SMS settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    const error = validate();
    if (error) {
      setNotice({ type: 'error', message: error });
      return;
    }

    if (!form.test_phone.trim()) {
      setNotice({ type: 'error', message: 'Enter a test phone number.' });
      return;
    }

    setTesting(true);
    setNotice(null);

    try {
      const { data } = await api.post('/settings/communication/test', {
        ...payload(),
        phone: form.test_phone.trim(),
      });

      setNotice({ type: 'success', message: `Test SMS sent to +${data.sent_to}.` });
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: requestError.response?.data?.error || 'The test SMS could not be sent.',
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3 text-[12px] font-semibold text-slate-500">
          <Icon name="refresh" className="h-4 w-4 animate-spin text-emerald-500" />
          Loading SMS configuration...
        </div>
      </div>
    );
  }

  const selectedProvider = providers.find((item) => item.id === form.provider);

  return (
    <div className="space-y-4">
      <Notice value={notice} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_50px_rgba(15,23,42,.05)] sm:p-5">
          <SectionHeading
            icon="settings"
            eyebrow="Configuration"
            title="SMS provider"
            description="Connect the SMS gateway used by this billing account. Credentials remain scoped to this account."
            badge={
              <span className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] ${
                form.has_api_key
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}>
                <span className={`h-2 w-2 rounded-full ${form.has_api_key ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                {form.has_api_key ? 'Configured' : 'Not configured'}
              </span>
            }
          />

          <div className="relative mt-5">
            <button
              type="button"
              onClick={() => setProviderOpen((open) => !open)}
              className="flex min-h-[54px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/30"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                <Icon name="shield" className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <small className="block text-[9px] font-extrabold uppercase tracking-[.12em] text-slate-400">Provider</small>
                <b className="mt-0.5 block truncate text-[12px] font-bold text-slate-800">
                  {selectedProvider?.name || 'Select an SMS provider'}
                </b>
              </span>
              <Icon name="chevron" className={`h-4 w-4 text-slate-400 transition ${providerOpen ? 'rotate-180' : ''}`} />
            </button>

            {providerOpen && (
              <div className="absolute left-0 right-0 top-[60px] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_22px_60px_rgba(15,23,42,.16)]">
                {providers.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    onClick={() => {
                      selectProvider(provider.id);
                      setProviderOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      form.provider === provider.id ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      form.provider === provider.id
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon name="sms" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[12px] font-bold text-slate-800">{provider.name}</b>
                      <small className="mt-0.5 block text-[10px] leading-4 text-slate-400">{provider.note}</small>
                    </span>
                    {form.provider === provider.id && <Icon name="check" className="h-4 w-4 text-emerald-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {form.provider && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.11em] text-slate-500">
                  <Icon name="key" className="h-3.5 w-3.5 text-emerald-600" />
                  {form.provider === 'talksasa' ? 'API token' : 'API key'}
                </span>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(event) => setForm({ ...form, api_key: event.target.value })}
                  placeholder={form.has_api_key ? 'Saved — enter only to replace' : 'Enter provider credential'}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[12px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.11em] text-slate-500">
                  <Icon name="message" className="h-3.5 w-3.5 text-emerald-600" />
                  Sender ID / Shortcode
                </span>
                <input
                  value={form.sender_id}
                  onChange={(event) => setForm({ ...form, sender_id: event.target.value })}
                  placeholder="Approved Sender ID"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[12px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                />
              </label>

              {form.provider === 'savvy' && (
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.11em] text-slate-500">
                    <Icon name="link" className="h-3.5 w-3.5 text-emerald-600" />
                    Partner ID
                  </span>
                  <input
                    value={form.partner_id}
                    onChange={(event) => setForm({ ...form, partner_id: event.target.value })}
                    placeholder="Savvy Partner ID"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[12px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                  />
                </label>
              )}
            </div>
          )}

          {form.provider && (
            <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-[11px] font-extrabold text-white shadow-[0_8px_22px_rgba(16,185,129,.2)] transition hover:bg-emerald-600 disabled:opacity-50"
              >
                <Icon name={saving ? 'refresh' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
                {saving ? 'Saving...' : 'Save SMS settings'}
              </button>
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_50px_rgba(15,23,42,.04)] sm:p-5">
          <SectionHeading
            icon="phone"
            eyebrow="Verification"
            title="Test connection"
            description="Send one SMS before using the provider for subscriber broadcasts."
          />

          <label className="mt-5 block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[.11em] text-slate-500">Test phone number</span>
            <div className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 transition focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-50">
              <Icon name="phone" className="h-4 w-4 text-emerald-600" />
              <input
                value={form.test_phone}
                onChange={(event) => setForm({ ...form, test_phone: event.target.value })}
                placeholder="2547XXXXXXXX"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
          </label>

          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 text-[11px] font-extrabold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            <Icon name={testing ? 'refresh' : 'send'} className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
            {testing ? 'Sending test...' : 'Send test SMS'}
          </button>

          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                <Icon name="shield" className="h-3.5 w-3.5" />
              </span>
              <p className="text-[10px] leading-4 text-slate-500">
                Test messages use the same provider credentials and Sender ID that subscriber notifications will use.
              </p>
            </div>
          </div>
        </section>
      </div>

      <AudienceComposer channel="sms" />
    </div>
  );
}

function WhatsappPanel() {
  const [state, setState] = useState({
    configured: false,
    connected: false,
    connection_state: 'not_configured',
  });
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
      if (data.connected) {
        setQr('');
        setPairingCode('');
      }
    } catch (error) {
      if (!quiet) {
        setNotice({
          type: 'error',
          message: error.response?.data?.error || 'Could not load WhatsApp status.',
        });
      }
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
      setNotice({ type: 'error', message: 'Enter a WhatsApp number with country code.' });
      return;
    }

    setBusy(true);
    setNotice(null);
    setQr('');
    setPairingCode('');

    try {
      const { data } = await api.post('/settings/whatsapp/connect', { method, phone });

      setState((current) => ({
        ...current,
        configured: true,
        connected: data.status === 'connected',
        connection_state: data.connection_state || data.status,
      }));

      if (data.qr_code) {
        setQr(data.qr_code.startsWith('data:image') ? data.qr_code : `data:image/png;base64,${data.qr_code}`);
      }

      if (data.pairing_code) setPairingCode(data.pairing_code);

      setNotice({
        type: 'success',
        message: data.message || 'WhatsApp connection started.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.response?.data?.error || 'Could not start WhatsApp connection.',
      });
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = state.connected
    ? 'Connected'
    : state.configured
      ? 'Disconnected'
      : 'Not configured';

  return (
    <div className="space-y-4">
      <Notice value={notice} />

      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_50px_rgba(15,23,42,.05)] sm:p-5">
        <SectionHeading
          icon="link"
          eyebrow="Channel connection"
          title="WhatsApp"
          description="Connect the billing account number to send invoices, payment confirmations, expiry reminders and support updates."
          badge={
            <span className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] ${
              state.connected
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : state.configured
                  ? 'border-amber-100 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}>
              <span className={`h-2 w-2 rounded-full ${
                state.connected ? 'bg-emerald-500' : state.configured ? 'bg-amber-500' : 'bg-slate-300'
              }`} />
              {statusLabel}
            </span>
          }
        />

        {state.instance_name && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-100 bg-slate-50/80 px-3.5 py-3 text-[10px] text-slate-500">
            <span><b className="text-slate-700">Instance:</b> {state.instance_name}</span>
            <span><b className="text-slate-700">State:</b> {state.connection_state || 'unknown'}</span>
          </div>
        )}

        {state.connected ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-800">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
              <Icon name="check" className="h-[18px] w-[18px]" />
            </span>
            <div>
              <b className="block text-[13px] font-extrabold">WhatsApp is ready</b>
              <span className="mt-0.5 block text-[11px] leading-4 text-emerald-700">
                Subscriber broadcasts can use this connected account.
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMethod('qr')}
                className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                  method === 'qr'
                    ? 'border-emerald-300 bg-emerald-50 ring-4 ring-emerald-50/80'
                    : 'border-slate-200 bg-white hover:border-emerald-200'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  method === 'qr' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  <Icon name="qr" className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <b className="block text-[12px] font-extrabold text-slate-800">Scan QR code</b>
                  <span className="mt-1 block text-[10px] leading-4 text-slate-500">Use when WhatsApp is available on another phone.</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMethod('pairing_code')}
                className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                  method === 'pairing_code'
                    ? 'border-emerald-300 bg-emerald-50 ring-4 ring-emerald-50/80'
                    : 'border-slate-200 bg-white hover:border-emerald-200'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  method === 'pairing_code' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  <Icon name="key" className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <b className="block text-[12px] font-extrabold text-slate-800">Pairing code</b>
                  <span className="mt-1 block text-[10px] leading-4 text-slate-500">Use when this is the same phone running WhatsApp.</span>
                </span>
              </button>
            </div>

            {method === 'pairing_code' && (
              <label className="mt-4 block">
                <span className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.11em] text-slate-500">
                  <Icon name="phone" className="h-3.5 w-3.5 text-emerald-600" />
                  WhatsApp number
                </span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="2547XXXXXXXX"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[12px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                />
              </label>
            )}

            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-[12px] font-extrabold text-white shadow-[0_8px_24px_rgba(16,185,129,.22)] transition hover:bg-emerald-600 disabled:opacity-50"
            >
              <Icon
                name={busy ? 'refresh' : method === 'qr' ? 'qr' : 'key'}
                className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`}
              />
              {busy
                ? 'Preparing connection...'
                : method === 'qr'
                  ? 'Generate QR code'
                  : 'Generate pairing code'}
            </button>
          </>
        )}
      </section>

      {qr && !state.connected && (
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 text-center shadow-sm sm:p-5">
          <SectionHeading
            icon="qr"
            eyebrow="Link device"
            title="Scan from WhatsApp"
            description="Open WhatsApp → Linked devices → Link a device, then scan this code."
          />
          <div className="mx-auto mt-5 w-fit rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_16px_45px_rgba(15,23,42,.1)]">
            <img src={qr} alt="WhatsApp connection QR code" className="h-56 w-56 max-w-full rounded-xl" />
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-[10px] font-bold text-amber-700">
            <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" />
            Waiting for connection
          </div>
        </section>
      )}

      {pairingCode && !state.connected && (
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 text-center shadow-sm sm:p-5">
          <SectionHeading
            icon="key"
            eyebrow="Link device"
            title="Pairing code"
            description="Open WhatsApp linked devices and choose the option to link with a phone number."
          />
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(pairingCode)}
            className="mx-auto mt-5 inline-flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-[22px] font-black tracking-[.18em] text-emerald-700 transition hover:bg-emerald-100"
          >
            <Icon name="copy" className="h-5 w-5" />
            {pairingCode}
          </button>
          <p className="mt-3 text-[10px] font-semibold text-amber-600">This code expires. Generate a new one if WhatsApp rejects it.</p>
        </section>
      )}

      <AudienceComposer channel="whatsapp" />
    </div>
  );
}

export default function BillingCommunication() {
  const [section, setSection] = useState('sms');

  return (
    <div data-billing-communication className="-mx-5 -mt-5 sm:-mx-8 sm:-mt-8">
      <section className="relative overflow-hidden border-b border-emerald-950/10 bg-[#0b2a1c] px-5 pb-7 pt-6 text-white sm:px-8 sm:pb-8 sm:pt-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-px w-1/2 bg-gradient-to-r from-transparent via-emerald-300/30 to-transparent" />

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-emerald-200 shadow-inner">
              <Icon name="broadcast" className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-emerald-300">Customer engagement</p>
              <h2 className="mt-1 text-[27px] font-black tracking-tight text-white sm:text-[30px]">Communication</h2>
              <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-emerald-50/70">
                Configure channels, verify delivery, and send targeted subscriber messages from one organized workspace.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-[10px] font-bold text-emerald-50/80">
              <Icon name="shield" className="h-3.5 w-3.5 text-emerald-300" />
              Account-scoped credentials
            </span>
          </div>
        </div>
      </section>

      <div className="bg-[#f7f8f7] px-5 pb-24 pt-4 sm:px-8 sm:pt-5">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,.04)]">
          <button
            type="button"
            onClick={() => setSection('sms')}
            className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-extrabold transition ${
              section === 'sms'
                ? 'bg-emerald-500 text-white shadow-[0_8px_22px_rgba(16,185,129,.2)]'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <Icon name="sms" className="h-4 w-4" />
            SMS
          </button>

          <button
            type="button"
            onClick={() => setSection('whatsapp')}
            className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-extrabold transition ${
              section === 'whatsapp'
                ? 'bg-emerald-500 text-white shadow-[0_8px_22px_rgba(16,185,129,.2)]'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <WhatsappIcon className="h-4 w-4" />
            WhatsApp
          </button>
        </div>

        {section === 'sms' ? <SmsPanel /> : <WhatsappPanel />}
      </div>
    </div>
  );
}
