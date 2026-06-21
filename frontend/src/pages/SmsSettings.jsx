import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';

const PROVIDERS = [
  { id: 'blessed', label: 'Blessed Text', note: 'Use Blessed Text for Nexa SMS messages.' },
  { id: 'savvy', label: 'Savvy Bulk SMS', note: 'Requires API key, Partner ID and Sender ID.' },
];

export default function SmsSettings() {
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get('clientId');
  const query = clientId ? `?clientId=${clientId}` : '';
  const [provider, setProvider] = useState('blessed');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [senderId, setSenderId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/sms-settings${query}`)
      .then(({ data }) => {
        setProvider(data.sms_provider || 'blessed');
        setSenderId(data.sms_sender_id || '');
        setPartnerId(data.sms_partner_id || '');
        setApiKeyConfigured(Boolean(data.sms_api_key_configured));
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load SMS settings'))
      .finally(() => setLoading(false));
  }, [query]);

  const selectProvider = (nextProvider) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider);
    setApiKey('');
    setApiKeyConfigured(false);
    setSenderId('');
    setPartnerId('');
    setNotice('');
    setError('');
  };

  const save = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const payload = {
        sms_provider: provider,
        sms_sender_id: senderId.trim(),
        sms_partner_id: provider === 'savvy' ? partnerId.trim() : '',
      };
      if (apiKey.trim()) payload.sms_api_key = apiKey.trim();
      await api.put(`/sms-settings${query}`, payload);
      if (apiKey.trim()) setApiKeyConfigured(true);
      setApiKey('');
      setNotice('SMS provider settings saved successfully.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save SMS settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading SMS settings...</div>;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f6ff] p-5 sm:p-8">
      <div className="mx-auto max-w-3xl pb-10">
        <div className="mb-6">
          <div className="inline-flex rounded-full bg-[#efe9ff] px-4 py-2 text-xs font-black text-[#4B16B5]">Nexa messaging</div>
          <h1 className="mt-3 text-3xl font-black text-slate-950">SMS Provider</h1>
          <p className="mt-1 text-sm text-slate-500">Choose how Nexa sends alerts, assignments, confirmations and daily reports.</p>
        </div>

        {notice && <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
        {error && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="rounded-[30px] bg-white p-6 shadow-xl shadow-purple-100/50">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PROVIDERS.map((item) => {
              const selected = provider === item.id;
              return (
                <button key={item.id} type="button" onClick={() => selectProvider(item.id)} className={`rounded-2xl border p-4 text-left ${selected ? 'border-[#4B16B5] bg-[#F3EFFF]' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-black text-slate-900">{item.label}</span>
                    {selected && <span className="rounded-full bg-[#4B16B5] px-3 py-1 text-[10px] font-black text-white">Selected</span>}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{item.note}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">API key</span>
              <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyConfigured ? 'Saved — enter a new value to replace it' : 'Enter API key'} className="mt-2 w-full rounded-2xl border border-purple-100 bg-[#fbfaff] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#4B16B5]/20" />
              <span className="mt-1 block text-[11px] text-slate-400">{apiKeyConfigured ? 'A key is already saved and is not displayed.' : 'Required before this provider can send messages.'}</span>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Sender ID / Shortcode</span>
              <input value={senderId} onChange={(event) => setSenderId(event.target.value)} placeholder="Enter approved Sender ID" className="mt-2 w-full rounded-2xl border border-purple-100 bg-[#fbfaff] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#4B16B5]/20" />
            </label>

            {provider === 'savvy' && (
              <label className="block sm:col-span-2">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Partner ID</span>
                <input value={partnerId} onChange={(event) => setPartnerId(event.target.value)} placeholder="Enter Savvy Partner ID" className="mt-2 w-full rounded-2xl border border-purple-100 bg-[#fbfaff] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#4B16B5]/20" />
              </label>
            )}
          </div>

          <button type="button" onClick={save} disabled={saving} className="mt-6 rounded-2xl bg-[#4B16B5] px-6 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save SMS settings'}</button>
        </div>
      </div>
    </div>
  );
}
