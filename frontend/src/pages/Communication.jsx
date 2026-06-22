import React, { useEffect, useState } from 'react';
import api from '../utils/api';

const SMS_PROVIDERS = [
  { value: 'blessed_text', label: 'Blessed Text' },
  { value: 'savvy', label: 'Savvy Bulk SMS' },
];

const SAVVY_MARKER = 'savvy__';

const PROVIDER_COPY = {
  blessed_text: {
    description: 'Configure SMS delivery for alerts, reports and customer notifications.',
    keyPlaceholder: 'Paste Blessed Text API key',
    senderPlaceholder: 'Enter approved shortcode or Sender ID',
  },
  savvy: {
    description: 'Configure SMS delivery for alerts, reports and customer notifications.',
    keyPlaceholder: 'Paste Savvy API key',
    senderPlaceholder: 'Enter approved shortcode or Sender ID',
  },
};

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    chat: <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.42-4.03 8-9 8a9.86 9.86 0 0 1-4.25-.95L3 20l1.39-3.72A7.35 7.35 0 0 1 3 12c0-4.42 4.03-8 9-8s9 3.58 9 8Z" />,
    building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="10" r="2.4" /><path d="M15.5 15.5A4.5 4.5 0 0 1 21 20" /></>,
    key: <><circle cx="8" cy="15" r="3" /><path d="M10.2 12.8 20 3m-4 4 2 2m-5 1 2 2" /></>,
    phone: <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
    send: <path d="m22 2-7 20-4-9-9-4 20-7ZM11 13l4-4" />,
    save: <><path d="M5 3h12l2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M7 3v6h9M8 21v-7h8v7" /></>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>,
    shield: <><path d="M12 22s7-3.5 7-10V5l-7-3-7 3v7c0 6.5 7 10 7 10Z" /><path d="m9 12 2 2 4-5" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18" /><path d="M10.7 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16.8 16.8 0 0 1-3.1 4.1M6.6 6.6C3.5 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.1-.9" /></>,
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h5v-5h4v5h5v-9" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.6-2.5 2.1-2.5 4" /><path d="M12 17h.01" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function parseSavvySender(value) {
  const sender = String(value || '');
  if (!sender.startsWith(SAVVY_MARKER)) return null;
  const encoded = sender.slice(SAVVY_MARKER.length);
  const separator = encoded.indexOf('__');
  if (separator <= 0) return null;
  const partnerId = encoded.slice(0, separator);
  const senderId = encoded.slice(separator + 2);
  if (!partnerId || !senderId) return null;
  return { partnerId, senderId };
}

function communicationPayload(form) {
  if (form.provider === 'savvy') {
    return {
      provider: 'blessed_text',
      sender_id: `${SAVVY_MARKER}${form.partner_id.trim()}__${form.sender_id.trim()}`,
      api_key: form.api_key,
    };
  }
  return {
    provider: 'blessed_text',
    sender_id: form.sender_id.trim(),
    api_key: form.api_key,
  };
}

function FieldShell({ label, icon, children }) {
  return (
    <label className="block">
      <span className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#505987]">
        {label}
        <Icon name="info" className="h-4 w-4 text-[#9ca4c7]" />
      </span>
      <div className="flex h-[64px] items-center gap-4 rounded-2xl border border-[#dfe3f1] bg-white px-3 shadow-[0_8px_24px_rgba(31,35,82,0.04)] transition focus-within:border-[#8e6cff] focus-within:ring-4 focus-within:ring-[#efeaff]">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f1edff] text-[#5d2df5]">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        {children}
      </div>
    </label>
  );
}

export default function Communication() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState({
    provider: 'savvy',
    sender_id: '',
    partner_id: '',
    api_key: '',
    has_api_key: false,
    test_phone: '',
  });

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus(null);
  };

  const changeProvider = (provider) => {
    setForm((current) => ({
      ...current,
      provider,
      sender_id: '',
      partner_id: '',
      api_key: '',
      has_api_key: false,
    }));
    setStatus(null);
  };

  const applyLoadedConfig = (data) => {
    const savvy = parseSavvySender(data.sender_id);
    setForm((current) => ({
      ...current,
      provider: savvy ? 'savvy' : 'blessed_text',
      sender_id: savvy ? savvy.senderId : (data.sender_id || ''),
      partner_id: savvy ? savvy.partnerId : '',
      api_key: '',
      has_api_key: Boolean(data.has_api_key),
    }));
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/communication');
      applyLoadedConfig(data);
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load communication settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const validate = () => {
    if (!form.sender_id.trim()) {
      setStatus({ type: 'error', message: 'Sender ID / Shortcode is required.' });
      return false;
    }
    if (!form.has_api_key && !form.api_key.trim()) {
      setStatus({ type: 'error', message: 'API key is required.' });
      return false;
    }
    if (form.provider === 'savvy') {
      if (!form.partner_id.trim()) {
        setStatus({ type: 'error', message: 'Savvy Partner ID is required.' });
        return false;
      }
      const encoded = `${SAVVY_MARKER}${form.partner_id.trim()}__${form.sender_id.trim()}`;
      if (encoded.length > 40) {
        setStatus({ type: 'error', message: 'Partner ID and Sender ID are too long. Their combined encoded length must be 40 characters or fewer.' });
        return false;
      }
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setStatus(null);
    try {
      const { data } = await api.put('/settings/communication', communicationPayload(form));
      applyLoadedConfig(data);
      setStatus({ type: 'success', message: `${form.provider === 'savvy' ? 'Savvy Bulk SMS' : 'Blessed Text'} provider saved.` });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to save SMS provider.' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!validate()) return;
    setTesting(true);
    setStatus(null);
    try {
      const { data } = await api.post('/settings/communication/test', {
        ...communicationPayload(form),
        phone: form.test_phone,
      });
      setStatus({ type: 'success', message: `Test SMS sent to +${data.sent_to}.` });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Test SMS failed.' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#fafbff] text-sm font-bold text-[#8b92b6]">
        Loading communication settings...
      </div>
    );
  }

  const copy = PROVIDER_COPY[form.provider] || PROVIDER_COPY.blessed_text;
  const configured = form.has_api_key && form.sender_id.trim() && (form.provider !== 'savvy' || form.partner_id.trim());

  return (
    <div className="flex-1 overflow-y-auto bg-[#fbfcff] px-5 py-6 text-[#0d1438] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="mb-8 flex items-center gap-3 text-sm font-bold text-[#8b92b6]">
              <Icon name="home" className="h-4 w-4" />
              <span>/</span>
              <span>Settings</span>
              <span>/</span>
              <span className="text-[#551fff]">Communication</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <h1 className="text-4xl font-black tracking-tight text-[#0c1239]">Communication</h1>
              <span className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-4 text-sm font-black text-emerald-700">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Active
              </span>
            </div>
            <p className="mt-3 text-base font-semibold text-[#626b95]">
              Monitor support, installations, complaints and AI performance.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#bfa9ff] bg-white px-5 text-sm font-black text-[#5c28ff] shadow-sm transition hover:bg-[#f7f3ff]"
          >
            <Icon name="help" className="h-5 w-5" />
            Need help
          </button>
        </header>

        <section className="rounded-[26px] border border-[#dfe2f1] bg-white p-7 shadow-[0_18px_55px_rgba(53,57,102,0.08)]">
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-5">
              <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-[#7d3cff] to-[#4310da] text-white shadow-[0_16px_30px_rgba(94,45,245,0.28)]">
                <Icon name="chat" className="h-8 w-8" />
              </span>
              <div>
                <h2 className="text-2xl font-black text-[#0d1438]">SMS Provider</h2>
                <p className="mt-1 text-base font-semibold text-[#858daf]">{copy.description}</p>
              </div>
            </div>
            <span className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold ${
              configured
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : 'border-[#e0e4f2] bg-white text-[#667098]'
            }`}>
              <span className={`h-2 w-2 rounded-full ${configured ? 'bg-emerald-500' : 'bg-[#9aa3c2]'}`} />
              {configured ? 'Configured' : 'Not Configured'}
            </span>
          </div>

          <div className="rounded-[24px] border border-[#dfe2f1] bg-white p-6 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)]">
            <div className="grid gap-6 lg:grid-cols-2">
              <FieldShell label="Provider" icon="building">
                <select
                  value={form.provider}
                  onChange={(event) => changeProvider(event.target.value)}
                  className="h-full flex-1 bg-transparent text-base font-bold text-[#25305d] outline-none"
                >
                  {SMS_PROVIDERS.map((provider) => (
                    <option key={provider.value} value={provider.value}>{provider.label}</option>
                  ))}
                </select>
              </FieldShell>

              <FieldShell label="Sender ID / Shortcode" icon="chat">
                <input
                  value={form.sender_id}
                  onChange={(event) => update('sender_id', event.target.value)}
                  placeholder={copy.senderPlaceholder}
                  className="h-full min-w-0 flex-1 bg-transparent text-base font-semibold text-[#25305d] outline-none placeholder:text-[#a9b0cb]"
                />
              </FieldShell>
            </div>

            {form.provider === 'savvy' && (
              <div className="mt-6">
                <FieldShell label="Partner ID" icon="users">
                  <input
                    value={form.partner_id}
                    onChange={(event) => update('partner_id', event.target.value)}
                    placeholder="Enter Savvy Partner ID"
                    className="h-full min-w-0 flex-1 bg-transparent text-base font-semibold text-[#25305d] outline-none placeholder:text-[#a9b0cb]"
                  />
                </FieldShell>
              </div>
            )}

            <div className="mt-6">
              <FieldShell label="API Key" icon="key">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={form.api_key}
                  onChange={(event) => update('api_key', event.target.value)}
                  placeholder={form.has_api_key ? 'Saved. Leave blank to keep current key.' : copy.keyPlaceholder}
                  className="h-full min-w-0 flex-1 bg-transparent text-base font-semibold text-[#25305d] outline-none placeholder:text-[#a9b0cb]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#8a92b5] transition hover:bg-[#f4f1ff] hover:text-[#5d2df5]"
                  title={showKey ? 'Hide API key' : 'Show API key'}
                >
                  <Icon name={showKey ? 'eyeOff' : 'eye'} className="h-5 w-5" />
                </button>
              </FieldShell>
            </div>

            <div className="my-7 h-px bg-[#e7eaf4]" />

            <div className="rounded-2xl border border-[#e0e4f2] bg-[#fbfcff] p-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr_auto] lg:items-center">
                <div>
                  <h3 className="text-lg font-black text-[#0d1438]">Send Test SMS</h3>
                  <p className="mt-1 text-sm font-semibold text-[#727a9f]">
                    Send a test message to verify your SMS configuration.
                  </p>
                </div>
                <div className="flex h-14 items-center gap-4 rounded-2xl border border-[#dfe3f1] bg-white px-3 shadow-sm">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1edff] text-[#5d2df5]">
                    <Icon name="phone" className="h-5 w-5" />
                  </span>
                  <input
                    value={form.test_phone}
                    onChange={(event) => update('test_phone', event.target.value)}
                    placeholder="Enter mobile number"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#25305d] outline-none placeholder:text-[#a9b0cb]"
                  />
                </div>
                <button
                  type="button"
                  onClick={test}
                  disabled={testing || !form.test_phone.trim()}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-[#b99cff] bg-white px-5 text-sm font-black text-[#5d2df5] transition hover:bg-[#f7f3ff] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="send" className="h-5 w-5" />
                  {testing ? 'Sending...' : 'Send Test SMS'}
                </button>
              </div>
            </div>
          </div>

          {status && (
            <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-bold ${
              status.type === 'success'
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : 'border-red-100 bg-red-50 text-red-700'
            }`}>
              {status.message}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm font-semibold text-[#858daf]">
              <Icon name="shield" className="h-6 w-6 text-[#8993bd]" />
              Your credentials are encrypted and securely stored.
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={load}
                disabled={saving || testing}
                className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-[#dfe3f1] bg-white px-6 text-sm font-black text-[#7580a6] shadow-sm transition hover:bg-[#f8f9ff] disabled:opacity-50"
              >
                <Icon name="reset" className="h-5 w-5" />
                Reset
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#8b3dff] to-[#155dff] px-9 text-sm font-black text-white shadow-[0_16px_34px_rgba(65,64,245,0.28)] transition hover:brightness-105 disabled:opacity-50"
              >
                <Icon name="save" className="h-5 w-5" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
