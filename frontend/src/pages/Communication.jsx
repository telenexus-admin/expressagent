import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { ChatIcon, CheckCircleIcon } from '../components/Icons';

const SMS_PROVIDERS = [
  { value: 'blessed_text', label: 'Blessed Text' },
  { value: 'savvy', label: 'Savvy Bulk SMS' },
];

const providerCopy = {
  blessed_text: {
    description: 'Use the API key and sender ID from your Blessed Text account.',
    keyPlaceholder: 'Paste Blessed Text API key',
    senderPlaceholder: 'e.g. NEXA',
  },
  savvy: {
    description: 'Use your Savvy API key, Partner ID and approved Sender ID / shortcode.',
    keyPlaceholder: 'Paste Savvy API key',
    senderPlaceholder: 'Enter approved shortcode or Sender ID',
  },
};

function parseSavvySender(value) {
  const sender = String(value || '');
  const [partnerId, ...senderParts] = sender.split('--');
  const senderId = senderParts.join('--');
  if (!partnerId || !senderId) return null;
  return { partnerId, senderId };
}

function providerPayload(form) {
  if (form.provider !== 'savvy') {
    return {
      provider: 'blessed_text',
      sender_id: form.sender_id,
      api_key: form.api_key,
    };
  }

  return {
    provider: 'savvy',
    sender_id: `${form.partner_id.trim()}--${form.sender_id.trim()}`,
    api_key: form.api_key,
  };
}

export default function Communication() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    provider: 'blessed_text',
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
    const savvy = data.provider === 'savvy' ? parseSavvySender(data.sender_id) : null;
    setForm((current) => ({
      ...current,
      provider: data.provider || 'blessed_text',
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

  const validateSavvy = () => {
    if (form.provider !== 'savvy') return true;
    if (!form.partner_id.trim()) {
      setStatus({ type: 'error', message: 'Savvy Partner ID is required.' });
      return false;
    }
    if (!form.sender_id.trim()) {
      setStatus({ type: 'error', message: 'Savvy Sender ID / Shortcode is required.' });
      return false;
    }
    const combined = `${form.partner_id.trim()}--${form.sender_id.trim()}`;
    if (combined.length > 40) {
      setStatus({ type: 'error', message: 'Partner ID and Sender ID are too long. Their combined length must be 38 characters or fewer.' });
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validateSavvy()) return;
    setSaving(true);
    setStatus(null);
    try {
      const { data } = await api.put('/settings/communication', providerPayload(form));
      applyLoadedConfig(data);
      setStatus({ type: 'success', message: `${form.provider === 'savvy' ? 'Savvy Bulk SMS' : 'Blessed Text'} provider saved.` });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to save SMS provider.' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!validateSavvy()) return;
    setTesting(true);
    setStatus(null);
    try {
      const { data } = await api.post('/settings/communication/test', {
        ...providerPayload(form),
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
    return <div className="flex flex-1 items-center justify-center text-sm font-bold text-slate-400">Loading communication settings...</div>;
  }

  const copy = providerCopy[form.provider] || providerCopy.blessed_text;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-950">Communication</h1>
          <p className="mt-1 text-sm text-slate-500">Configure SMS delivery for alerts, reports and customer notifications.</p>
        </div>

        <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#efe9ff] text-[#4B16B5]">
              <ChatIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-950">SMS Provider</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{copy.description}</p>
                </div>
                {form.has_api_key && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                    <CheckCircleIcon className="h-4 w-4" /> Configured
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Provider
                  <select
                    value={form.provider}
                    onChange={(event) => changeProvider(event.target.value)}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                  >
                    {SMS_PROVIDERS.map((provider) => (
                      <option key={provider.value} value={provider.value}>{provider.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Sender ID / Shortcode
                  <input
                    value={form.sender_id}
                    onChange={(event) => update('sender_id', event.target.value)}
                    placeholder={copy.senderPlaceholder}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                  />
                </label>
              </div>

              {form.provider === 'savvy' && (
                <label className="mt-4 flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Partner ID
                  <input
                    value={form.partner_id}
                    onChange={(event) => update('partner_id', event.target.value)}
                    placeholder="Enter Savvy Partner ID"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                  />
                </label>
              )}

              <label className="mt-4 flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                API Key
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(event) => update('api_key', event.target.value)}
                  placeholder={form.has_api_key ? 'Saved. Leave blank to keep current key.' : copy.keyPlaceholder}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                />
              </label>

              <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <h3 className="text-sm font-black text-slate-950">Send Test SMS</h3>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <input
                    value={form.test_phone}
                    onChange={(event) => update('test_phone', event.target.value)}
                    placeholder="2547XXXXXXXX"
                    className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#3535FF]"
                  />
                  <button
                    type="button"
                    onClick={test}
                    disabled={testing || !form.test_phone.trim()}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {testing ? 'Testing...' : 'Test SMS'}
                  </button>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold text-slate-500">
                  This provider is used for ticket alerts, daily reports, installation confirmations and support SMS.
                </p>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-xl bg-[#3535FF] px-5 py-2.5 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save provider'}
                </button>
              </div>

              {status && (
                <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
                  status.type === 'success'
                    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                    : 'border-red-100 bg-red-50 text-red-700'
                }`}>
                  {status.message}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
