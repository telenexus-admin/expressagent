import React, { useEffect, useState } from 'react';
import api from '../../utils/api';

const empty = {
  enabled: false,
  evolution_base_url: '',
  evolution_instance: '',
  evolution_api_key: '',
  agent_name: 'Nexa',
  owner_phone: '',
  system_prompt: '',
  webhook_url: '',
  evolution_api_key_configured: false,
};

function Input({ label, value, onChange, placeholder, type = 'text', helper }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-600 mb-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#3535FF] focus:ring-2 focus:ring-[#3535FF]/10"
      />
      {helper && <span className="block text-[11px] text-slate-400 mt-1.5">{helper}</span>}
    </label>
  );
}

export default function NexaWhatsApp() {
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState([]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const load = async () => {
    try {
      const [configRes, conversationsRes] = await Promise.all([
        api.get('/operator-agent/config'),
        api.get('/operator-agent/conversations'),
      ]);
      setForm({ ...empty, ...configRes.data, evolution_api_key: '' });
      setConversations(conversationsRes.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load Nexa WhatsApp setup.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const payload = {
        enabled: Boolean(form.enabled),
        evolution_base_url: form.evolution_base_url,
        evolution_instance: form.evolution_instance,
        agent_name: form.agent_name,
        owner_phone: form.owner_phone,
        system_prompt: form.system_prompt,
      };
      if (form.evolution_api_key.trim()) payload.evolution_api_key = form.evolution_api_key.trim();
      const { data } = await api.put('/operator-agent/config', payload);
      setForm((current) => ({ ...current, ...data, evolution_api_key: '' }));
      setNotice(form.enabled ? 'Nexa official WhatsApp configuration saved and enabled.' : 'Configuration saved. Nexa is currently disabled.');
    } catch (err) {
      const validation = err.response?.data?.errors?.[0]?.msg;
      setError(validation || err.response?.data?.error || 'Could not save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const connectWebhook = async () => {
    setConnecting(true);
    setNotice('');
    setError('');
    try {
      const { data } = await api.post('/operator-evolution/connect-webhook');
      setNotice(`Webhook connected successfully. Nexa will now receive ${data.event} events.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not connect webhook. Save your Evolution credentials first.');
    } finally {
      setConnecting(false);
    }
  };

  const sendTest = async () => {
    setSending(true);
    setNotice('');
    setError('');
    try {
      await api.post('/operator-agent/test-message', { phone: testPhone });
      setNotice(`Test WhatsApp message sent to ${testPhone}.`);
    } catch (err) {
      const validation = err.response?.data?.errors?.[0]?.msg;
      setError(validation || err.response?.data?.error || 'Could not send test message.');
    } finally {
      setSending(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(form.webhook_url);
      setNotice('Webhook URL copied.');
    } catch (_err) {
      setError('Could not copy the webhook URL. Select and copy it manually.');
    }
  };

  if (loading) return <div className="min-h-full flex items-center justify-center text-sm text-slate-400">Loading Nexa WhatsApp setup...</div>;

  return (
    <div className="bg-[#f6f7ff] min-h-full p-4 sm:p-7 lg:p-9">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-7">
          <div>
            <span className="inline-flex px-4 py-2 rounded-full bg-[#e9e9ff] text-[#3535FF] text-xs font-black mb-4">NEXA OPERATOR CHANNEL</span>
            <h1 className="text-3xl font-black text-slate-950">Nexa Official WhatsApp</h1>
            <p className="mt-2 text-sm text-slate-500 max-w-2xl">Connect your normal WhatsApp number through Evolution API. This agent is for Telenexus/Nexa and remains separate from all ISP client agents.</p>
          </div>
          <div className={`rounded-full px-5 py-3 text-xs font-black ${form.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
            {form.enabled ? '● Nexa is live' : '○ Nexa is offline'}
          </div>
        </div>

        {notice && <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">{notice}</div>}
        {error && <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
          <div className="rounded-[30px] bg-white p-6 sm:p-7 shadow-lg shadow-indigo-100/50 border border-white">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div><h2 className="font-black text-xl text-slate-950">Evolution API connection</h2><p className="text-xs text-slate-400 mt-1">Paste credentials from the Evolution API deployment hosting your Nexa number.</p></div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={Boolean(form.enabled)} onChange={(event) => set('enabled', event.target.checked)} className="w-5 h-5 accent-[#3535FF]" /> Live
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Input label="Evolution API URL" value={form.evolution_base_url || ''} onChange={(value) => set('evolution_base_url', value)} placeholder="https://evoapi.yourdomain.com" />
              <Input label="Instance name" value={form.evolution_instance || ''} onChange={(value) => set('evolution_instance', value)} placeholder="nexa-official" />
              <Input label="API key" type="password" value={form.evolution_api_key || ''} onChange={(value) => set('evolution_api_key', value)} placeholder={form.evolution_api_key_configured ? 'Saved — enter only to change it' : 'Paste Evolution API key'} helper={form.evolution_api_key_configured ? 'An API key is already securely saved.' : ''} />
              <Input label="Owner phone for alerts" value={form.owner_phone || ''} onChange={(value) => set('owner_phone', value)} placeholder="2547XXXXXXXX" />
              <Input label="Agent name" value={form.agent_name || ''} onChange={(value) => set('agent_name', value)} placeholder="Nexa" />
            </div>
            <label className="block mt-5">
              <span className="block text-xs font-bold text-slate-600 mb-2">Nexa system prompt</span>
              <textarea value={form.system_prompt || ''} onChange={(event) => set('system_prompt', event.target.value)} rows={8} className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-[#3535FF] focus:ring-2 focus:ring-[#3535FF]/10" />
            </label>
            <div className="flex flex-wrap gap-3 mt-6">
              <button onClick={save} disabled={saving} className="rounded-2xl bg-[#3535FF] px-6 py-3 text-sm font-black text-white hover:bg-[#2727dc] disabled:opacity-60">{saving ? 'Saving...' : 'Save configuration'}</button>
              <button onClick={connectWebhook} disabled={connecting} className="rounded-2xl bg-[#ececff] px-6 py-3 text-sm font-black text-[#3535FF] hover:bg-[#dfdfff] disabled:opacity-60">{connecting ? 'Connecting...' : 'Connect webhook'}</button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[30px] bg-[#101027] p-6 text-white shadow-xl">
              <h2 className="text-lg font-black">Webhook connection</h2>
              <p className="text-xs text-white/55 mt-1 mb-4">Press Connect webhook after saving credentials. Evolution will send incoming messages to this URL.</p>
              <div className="rounded-2xl bg-white/8 border border-white/10 px-4 py-4 text-xs leading-5 text-white/75 break-all">{form.webhook_url || 'Generated after setup loads.'}</div>
              <button onClick={copyWebhook} className="mt-4 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold hover:bg-white/15">Copy webhook URL</button>
            </div>

            <div className="rounded-[30px] bg-white p-6 border border-white shadow-lg shadow-indigo-100/40">
              <h2 className="text-lg font-black text-slate-950">Send test WhatsApp</h2>
              <p className="text-xs text-slate-400 mt-1 mb-4">Confirm that the linked Nexa number can send messages before testing replies.</p>
              <Input label="Test receiver number" value={testPhone} onChange={setTestPhone} placeholder="2547XXXXXXXX" />
              <button onClick={sendTest} disabled={sending || !testPhone.trim()} className="mt-4 w-full rounded-2xl bg-[#101027] px-5 py-3 text-sm font-black text-white disabled:opacity-50">{sending ? 'Sending...' : 'Send test message'}</button>
            </div>

            <div className="rounded-[30px] bg-white p-6 border border-white shadow-lg shadow-indigo-100/40">
              <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-lg font-black text-slate-950">Live Nexa chats</h2><span className="rounded-full bg-[#ececff] px-3 py-1 text-[10px] font-black text-[#3535FF]">{conversations.length}</span></div>
              {conversations.length === 0 ? <p className="text-sm text-slate-400 py-4">No one has texted Nexa yet. Conversations appear here after the webhook receives messages.</p> : <div className="space-y-2">{conversations.slice(0, 5).map((chat) => <div key={chat.id} className="rounded-2xl bg-slate-50 px-4 py-3"><div className="text-sm font-bold text-slate-900">{chat.customer_name || `+${chat.customer_phone}`}</div><p className="text-xs text-slate-500 mt-1 truncate">{chat.last_message}</p></div>)}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
