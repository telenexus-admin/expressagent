import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/api';
import PushNotificationsButton from '../../components/PushNotificationsButton';

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
  email_enabled: false,
  email_from_name: 'Nexa',
  email_from_address: '',
  email_reply_to: '',
  email_smtp_host: 'mail.privateemail.com',
  email_smtp_port: 465,
  email_smtp_secure: true,
  email_smtp_username: '',
  email_smtp_password: '',
  email_smtp_password_configured: false,
  email_configured_at: null,
};

const replyModes = [
  { value: 'auto', label: 'Auto', description: 'Voice replies to voice notes, text replies to text' },
  { value: 'text', label: 'Text only', description: 'Always reply using normal messages' },
  { value: 'voice', label: 'Voice note', description: 'Always answer with a voice note' },
  { value: 'silent', label: 'Silent', description: 'Record messages but send no AI response' },
];

function Input({ label, value, onChange, placeholder, type = 'text', helper }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold text-slate-600">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#3535FF] focus:ring-2 focus:ring-[#3535FF]/10" />
      {helper && <span className="mt-1.5 block text-[11px] text-slate-400">{helper}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button type="button" disabled={disabled} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[#3535FF]' : 'bg-slate-300'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function Initial({ name }) {
  const letter = String(name || 'C').trim().charAt(0).toUpperCase() || 'C';
  return <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ececff] text-base font-black text-[#3535FF]">{letter}</div>;
}

function ModeBadge({ mode }) {
  const map = {
    auto: 'bg-indigo-50 text-indigo-600',
    text: 'bg-sky-50 text-sky-700',
    voice: 'bg-purple-50 text-purple-700',
    silent: 'bg-slate-100 text-slate-500',
  };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${map[mode] || map.auto}`}>{mode || 'auto'}</span>;
}

function ChatBubble({ message }) {
  const inbound = message.role === 'user';
  const manual = message.role === 'admin';
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[88%] rounded-[20px] px-3.5 py-2.5 text-sm leading-6 shadow-sm sm:max-w-[84%] sm:px-4 sm:py-3 ${inbound ? 'rounded-tl-md border border-slate-100 bg-white text-slate-800' : manual ? 'rounded-tr-md bg-[#101027] text-white' : 'rounded-tr-md bg-[#edeaff] text-slate-800'}`}>
        {!inbound && <div className={`mb-1 text-[10px] font-black uppercase tracking-wide ${manual ? 'text-white/55' : 'text-[#3535FF]'}`}>{manual ? 'You' : 'Nexa AI'}</div>}
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        <div className={`mt-1 text-right text-[10px] ${inbound ? 'text-slate-400' : manual ? 'text-white/50' : 'text-slate-400'}`}>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>
  );
}

export default function NexaWhatsApp() {
  const [tab, setTab] = useState('inbox');
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [liveSaving, setLiveSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [chat, setChat] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [controlSaving, setControlSaving] = useState(false);
  const [composer, setComposer] = useState('');
  const [manualMode, setManualMode] = useState('text');
  const [sendingReply, setSendingReply] = useState(false);
  const [search, setSearch] = useState('');
  const messagesEndRef = useRef(null);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const loadConversations = async (preserveSelection = true) => {
    const { data } = await api.get('/operator-agent/conversations');
    const rows = data || [];
    setConversations(rows);
    if (!preserveSelection || !selectedId) {
      if (rows[0]?.id) setSelectedId(rows[0].id);
    }
  };

  const load = async () => {
    try {
      const [configRes, conversationsRes] = await Promise.all([api.get('/operator-agent/config'), api.get('/operator-agent/conversations')]);
      setForm({ ...empty, ...configRes.data, evolution_api_key: '' });
      const rows = conversationsRes.data || [];
      const requestedConversationId = Number(new URLSearchParams(window.location.search).get('conversationId'));
      setConversations(rows);
      if (requestedConversationId && rows.some((row) => row.id === requestedConversationId)) {
        setSelectedId(requestedConversationId);
        setMobileChatOpen(true);
      } else if (rows[0]?.id) {
        setSelectedId((current) => current || rows[0].id);
      }
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load Nexa WhatsApp setup.');
    } finally {
      setLoading(false);
    }
  };

  const openChat = async (id, quiet = false) => {
    if (!id) return;
    if (!quiet) setChatLoading(true);
    try {
      const { data } = await api.get(`/operator-agent/conversations/${id}`);
      setChat(data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load this Nexa conversation.');
    } finally {
      if (!quiet) setChatLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (selectedId) openChat(selectedId); }, [selectedId]);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        await loadConversations(true);
        if (selectedId) await openChat(selectedId, true);
      } catch (_err) {}
    }, 10000);
    return () => clearInterval(timer);
  }, [selectedId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat?.messages?.length, selectedId]);

  const filteredChats = useMemo(() => {
    const key = search.toLowerCase().trim();
    if (!key) return conversations;
    return conversations.filter((item) => `${item.customer_name || ''} ${item.customer_phone} ${item.last_message || ''}`.toLowerCase().includes(key));
  }, [conversations, search]);

  const save = async () => {
    setSaving(true); setNotice(''); setError('');
    try {
      const payload = {
        enabled: Boolean(form.enabled),
        evolution_base_url: form.evolution_base_url,
        evolution_instance: form.evolution_instance,
        agent_name: form.agent_name,
        owner_phone: form.owner_phone,
        system_prompt: form.system_prompt,
        email_enabled: Boolean(form.email_enabled),
        email_from_name: form.email_from_name,
        email_from_address: form.email_from_address,
        email_reply_to: form.email_reply_to,
        email_smtp_host: form.email_smtp_host,
        email_smtp_port: Number(form.email_smtp_port || 465),
        email_smtp_secure: Boolean(form.email_smtp_secure),
        email_smtp_username: form.email_smtp_username,
      };
      if (form.evolution_api_key.trim()) payload.evolution_api_key = form.evolution_api_key.trim();
      if (form.email_smtp_password.trim()) payload.email_smtp_password = form.email_smtp_password.trim();
      const { data } = await api.put('/operator-agent/config', payload);
      setForm((current) => ({ ...current, ...data, evolution_api_key: '', email_smtp_password: '' }));
      setNotice(form.enabled ? 'Nexa official WhatsApp configuration saved and enabled.' : 'Configuration saved. Nexa is currently disabled.');
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not save configuration.');
    } finally { setSaving(false); }
  };

  const toggleLive = async (enabled) => {
    setLiveSaving(true); setNotice(''); setError('');
    try {
      const { data } = await api.put('/operator-agent/config', { enabled: Boolean(enabled) });
      setForm((current) => ({ ...current, ...data, evolution_api_key: '' }));
      setNotice(enabled ? 'Nexus AI is online. Incoming WhatsApp messages will get replies.' : 'Nexus AI is offline. Incoming messages will be recorded only.');
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not update Nexus AI status.');
    } finally { setLiveSaving(false); }
  };

  const connectWebhook = async () => {
    setConnecting(true); setNotice(''); setError('');
    try {
      const { data } = await api.post('/operator-evolution/connect-webhook');
      setNotice(`Webhook connected successfully. Nexa will now receive ${data.event} events.`);
    } catch (err) { setError(err.response?.data?.error || 'Could not connect webhook. Save your Evolution credentials first.'); }
    finally { setConnecting(false); }
  };

  const sendTest = async () => {
    setSending(true); setNotice(''); setError('');
    try { await api.post('/operator-agent/test-message', { phone: testPhone }); setNotice(`Test WhatsApp message sent to ${testPhone}.`); }
    catch (err) { setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not send test message.'); }
    finally { setSending(false); }
  };

  const sendEmailTest = async () => {
    setTestingEmail(true); setNotice(''); setError('');
    try {
      const payload = {
        to: testEmail,
        email_enabled: true,
        email_from_name: form.email_from_name,
        email_from_address: form.email_from_address,
        email_reply_to: form.email_reply_to,
        email_smtp_host: form.email_smtp_host,
        email_smtp_port: Number(form.email_smtp_port || 465),
        email_smtp_secure: Boolean(form.email_smtp_secure),
        email_smtp_username: form.email_smtp_username,
      };
      if (form.email_smtp_password.trim()) payload.email_smtp_password = form.email_smtp_password.trim();
      await api.post('/operator-agent/email-test', payload);
      setNotice(`Test email sent to ${testEmail}.`);
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not send test email.');
    } finally { setTestingEmail(false); }
  };

  const copyWebhook = async () => {
    try { await navigator.clipboard.writeText(form.webhook_url); setNotice('Webhook URL copied.'); }
    catch (_err) { setError('Could not copy the webhook URL. Select and copy it manually.'); }
  };

  const updateControls = async (updates) => {
    if (!chat?.conversation?.id) return;
    setControlSaving(true); setError('');
    try {
      const { data } = await api.patch(`/operator-agent/conversations/${chat.conversation.id}`, updates);
      setChat((current) => ({ ...current, conversation: data }));
      await loadConversations(true);
    } catch (err) { setError(err.response?.data?.error || 'Could not update chat controls.'); }
    finally { setControlSaving(false); }
  };

  const sendManualReply = async () => {
    const content = composer.trim();
    if (!chat?.conversation?.id || !content) return;
    setSendingReply(true); setError('');
    try {
      await api.post(`/operator-agent/conversations/${chat.conversation.id}/send`, { content, mode: manualMode });
      setComposer('');
      await openChat(chat.conversation.id, true);
      await loadConversations(true);
    } catch (err) { setError(err.response?.data?.error || 'Could not send your reply.'); }
    finally { setSendingReply(false); }
  };

  if (loading) return <div className="flex min-h-full items-center justify-center text-sm text-slate-400">Loading Nexa WhatsApp...</div>;

  return (
    <div className="min-h-full bg-[#f6f7ff] p-4 sm:p-6 lg:p-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="mb-3 inline-flex rounded-full bg-[#e9e9ff] px-4 py-2 text-xs font-black text-[#3535FF]">NEXA OPERATOR CHANNEL</span>
            <h1 className="text-3xl font-black text-slate-950">Nexa Official WhatsApp</h1>
            <p className="mt-1 text-sm text-slate-500">Control AI replies and personally take over any official Nexa conversation.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`rounded-full px-5 py-3 text-xs font-black ${form.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{form.enabled ? 'Nexus AI online' : 'Nexus AI offline'}</div>
            <div className="rounded-2xl bg-white p-1 shadow-sm">
              <button onClick={() => setTab('inbox')} className={`rounded-xl px-5 py-2.5 text-xs font-black ${tab === 'inbox' ? 'bg-[#3535FF] text-white' : 'text-slate-500'}`}>Inbox</button>
              <button onClick={() => setTab('setup')} className={`rounded-xl px-5 py-2.5 text-xs font-black ${tab === 'setup' ? 'bg-[#3535FF] text-white' : 'text-slate-500'}`}>Setup</button>
            </div>
          </div>
        </div>

        {notice && <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-3 text-sm text-emerald-700">{notice}</div>}
        {error && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>}

        <div className={`mb-5 rounded-[28px] border p-5 shadow-lg sm:p-6 ${form.enabled ? 'border-emerald-100 bg-emerald-50 shadow-emerald-100/50' : 'border-amber-100 bg-amber-50 shadow-amber-100/50'}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={`mb-2 inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide ${form.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {form.enabled ? 'Webhook replies active' : 'Webhook replies paused'}
              </div>
              <h2 className="text-xl font-black text-slate-950">Nexus AI status</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                {form.enabled
                  ? 'The official Nexa number is allowed to answer incoming WhatsApp messages.'
                  : 'Evolution webhooks are arriving, but Nexus is ignoring them until this switch is turned on.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleLive(!form.enabled)}
              disabled={liveSaving}
              className={`rounded-2xl px-6 py-3 text-sm font-black text-white shadow-lg disabled:opacity-60 ${form.enabled ? 'bg-slate-950 shadow-slate-200' : 'bg-[#3535FF] shadow-indigo-200'}`}
            >
              {liveSaving ? 'Updating...' : form.enabled ? 'Turn Nexus AI Off' : 'Turn Nexus AI On'}
            </button>
          </div>
        </div>

        {tab === 'inbox' ? (
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white bg-white p-4 shadow-lg shadow-indigo-100/40 sm:hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black text-slate-950">Phone Alerts</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Get Nexus message alerts with Reply and AI on/off actions.</p>
                </div>
                <span className="rounded-full bg-[#ececff] px-3 py-1 text-[10px] font-black text-[#3535FF]">Nexus</span>
              </div>
              <PushNotificationsButton variant="light" />
            </div>
            <div className="grid h-[calc(100dvh-330px)] min-h-[430px] grid-cols-1 overflow-hidden rounded-[28px] border border-white bg-white shadow-xl shadow-indigo-100/50 sm:h-[calc(100vh-250px)] sm:min-h-[640px] sm:rounded-[32px] lg:grid-cols-[340px_minmax(420px,1fr)_310px]">
            <aside className={`${mobileChatOpen ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col border-r border-slate-100 bg-white`}>
              <div className="border-b border-slate-100 p-5">
                <div className="flex items-center justify-between"><h2 className="text-lg font-black text-slate-950">Conversations</h2><span className="rounded-full bg-[#ececff] px-3 py-1 text-[10px] font-black text-[#3535FF]">{conversations.length}</span></div>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats..." className="mt-4 w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#3535FF]/20" />
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {filteredChats.length === 0 ? <p className="p-5 text-sm text-slate-400">No Nexa chats yet.</p> : filteredChats.map((item) => (
                  <button key={item.id} onClick={() => { setSelectedId(item.id); setMobileChatOpen(true); }} className={`mb-2 flex w-full gap-3 rounded-2xl p-3 text-left transition ${selectedId === item.id ? 'bg-[#f1efff]' : 'hover:bg-slate-50'}`}>
                    <Initial name={item.customer_name || item.customer_phone} />
                    <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-bold text-slate-900">{item.customer_name || `+${item.customer_phone}`}</p><span className="text-[10px] text-slate-400">{item.last_message_at ? new Date(item.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div><p className="mt-1 truncate text-xs text-slate-500">{item.last_message || 'No messages'}</p><div className="mt-2 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.ai_enabled ? 'bg-emerald-400' : 'bg-slate-300'}`} /><ModeBadge mode={item.reply_mode} /></div></div>
                  </button>
                ))}
              </div>
            </aside>

            <section className={`${mobileChatOpen ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col bg-[#faf9ff]`}>
              {!chat || chatLoading ? <div className="flex flex-1 items-center justify-center text-sm text-slate-400">{chatLoading ? 'Opening chat...' : 'Select a conversation'}</div> : <>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-3.5 py-3 sm:px-5 sm:py-4">
                  <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                    <button type="button" onClick={() => setMobileChatOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-600 lg:hidden">‹</button>
                    <Initial name={chat.conversation.customer_name || chat.conversation.customer_phone} />
                    <div className="min-w-0"><p className="truncate font-black text-slate-950">{chat.conversation.customer_name || `+${chat.conversation.customer_phone}`}</p><p className="truncate text-xs text-slate-400">+{chat.conversation.customer_phone}</p></div>
                  </div>
                  <div className={`shrink-0 rounded-full px-3 py-2 text-[10px] font-black sm:text-[11px] ${chat.conversation.ai_enabled && chat.conversation.reply_mode !== 'silent' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{chat.conversation.ai_enabled && chat.conversation.reply_mode !== 'silent' ? 'AI ACTIVE' : 'AI PAUSED'}</div>
                </div>
                <div className="border-b border-slate-100 bg-white px-3.5 py-3 lg:hidden">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="text-sm font-black text-slate-900">Nexa replies</p><p className="text-xs text-slate-400">Controls for this chat</p></div>
                    <Toggle checked={Boolean(chat.conversation.ai_enabled)} disabled={controlSaving} onChange={(value) => updateControls({ ai_enabled: value })} />
                  </div>
                  <select value={chat.conversation.reply_mode} onChange={(event) => updateControls({ reply_mode: event.target.value })} disabled={controlSaving} className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                    {replyModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                  </select>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3.5 sm:p-7">{chat.messages.map((message) => <ChatBubble key={message.id} message={message} />)}<div ref={messagesEndRef} /></div>
                <div className="border-t border-slate-100 bg-white p-3.5 sm:p-4">
                  <div className="mb-3 flex flex-wrap gap-2"><button onClick={() => setManualMode('text')} className={`rounded-full px-4 py-2 text-xs font-black ${manualMode === 'text' ? 'bg-[#3535FF] text-white' : 'bg-slate-100 text-slate-500'}`}>Send text</button><button onClick={() => setManualMode('voice')} className={`rounded-full px-4 py-2 text-xs font-black ${manualMode === 'voice' ? 'bg-[#3535FF] text-white' : 'bg-slate-100 text-slate-500'}`}>Send voice note</button></div>
                  <div className="flex items-end gap-2 sm:gap-3"><textarea value={composer} onChange={(event) => setComposer(event.target.value)} rows={2} placeholder={manualMode === 'voice' ? 'Type what Nexus should say...' : 'Type a manual reply...'} className="min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-[#3535FF]" /><button onClick={sendManualReply} disabled={sendingReply || !composer.trim()} className="rounded-2xl bg-[#3535FF] px-4 py-4 text-sm font-black text-white disabled:opacity-50 sm:px-5">{sendingReply ? 'Sending...' : 'Send'}</button></div>
                </div>
              </>}
            </section>

            <aside className="hidden overflow-y-auto border-l border-slate-100 bg-white p-5 lg:block">
              {!chat ? <p className="mt-10 text-center text-sm text-slate-400">Choose a chat to control Nexa.</p> : <div className="space-y-5">
                <div className="rounded-2xl bg-[#f6f7ff] p-4"><p className="text-sm font-black text-slate-900">Phone Alerts</p><p className="mt-1 text-xs text-slate-500">Receive Nexus message notifications with quick actions.</p><PushNotificationsButton variant="light" /></div>
                <div><h2 className="text-lg font-black text-slate-950">AI Controls</h2><p className="mt-1 text-xs text-slate-400">Changes apply to this customer only.</p></div>
                <div className="rounded-2xl bg-[#f6f7ff] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-black text-slate-900">Nexa replies</p><p className="text-xs text-slate-500">Switch AI on or off</p></div><Toggle checked={Boolean(chat.conversation.ai_enabled)} disabled={controlSaving} onChange={(value) => updateControls({ ai_enabled: value })} /></div></div>
                <div><p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-400">Reply style</p><div className="space-y-2">{replyModes.map((mode) => <button key={mode.value} onClick={() => updateControls({ reply_mode: mode.value })} disabled={controlSaving} className={`w-full rounded-2xl border p-3 text-left ${chat.conversation.reply_mode === mode.value ? 'border-[#3535FF] bg-[#f1efff]' : 'border-slate-100 bg-white hover:bg-slate-50'}`}><div className="text-sm font-black text-slate-900">{mode.label}</div><p className="mt-1 text-[11px] leading-4 text-slate-500">{mode.description}</p></button>)}</div></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Messages</p><p className="mt-2 text-2xl font-black text-slate-900">{chat.messages.length}</p><p className="text-xs text-slate-400">in this conversation</p></div>
              </div>}
            </aside>
          </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-6">
            <div className="rounded-[30px] border border-white bg-white p-6 shadow-lg shadow-indigo-100/50 sm:p-7">
              <div className="mb-6 flex items-center justify-between gap-4"><div><h2 className="text-xl font-black text-slate-950">Evolution API connection</h2><p className="mt-1 text-xs text-slate-400">Credentials for the normal WhatsApp number hosting Nexa.</p></div><label className="flex items-center gap-3 text-sm font-bold text-slate-700"><span>{form.enabled ? 'Online' : 'Offline'}</span><Toggle checked={Boolean(form.enabled)} disabled={liveSaving} onChange={toggleLive} /></label></div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2"><Input label="Evolution API URL" value={form.evolution_base_url || ''} onChange={(value) => set('evolution_base_url', value)} placeholder="https://evoapi.yourdomain.com" /><Input label="Instance name" value={form.evolution_instance || ''} onChange={(value) => set('evolution_instance', value)} placeholder="nexa-official" /><Input label="API key" type="password" value={form.evolution_api_key || ''} onChange={(value) => set('evolution_api_key', value)} placeholder={form.evolution_api_key_configured ? 'Saved — enter only to change it' : 'Paste Evolution API key'} helper={form.evolution_api_key_configured ? 'An API key is already securely saved.' : ''} /><Input label="Owner phone for alerts" value={form.owner_phone || ''} onChange={(value) => set('owner_phone', value)} placeholder="2547XXXXXXXX" /><Input label="Agent name" value={form.agent_name || ''} onChange={(value) => set('agent_name', value)} placeholder="Nexa" /></div>
              <label className="mt-5 block"><span className="mb-2 block text-xs font-bold text-slate-600">Nexa system prompt</span><textarea value={form.system_prompt || ''} onChange={(event) => set('system_prompt', event.target.value)} rows={8} className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-[#3535FF]" /></label>
              <div className="mt-6 flex flex-wrap gap-3"><button onClick={save} disabled={saving} className="rounded-2xl bg-[#3535FF] px-6 py-3 text-sm font-black text-white disabled:opacity-60">{saving ? 'Saving...' : 'Save configuration'}</button><button onClick={connectWebhook} disabled={connecting} className="rounded-2xl bg-[#ececff] px-6 py-3 text-sm font-black text-[#3535FF] disabled:opacity-60">{connecting ? 'Connecting...' : 'Connect webhook'}</button></div>
            </div>
            <div className="rounded-[30px] border border-white bg-white p-6 shadow-lg shadow-indigo-100/50 sm:p-7">
              <div className="mb-6 flex items-center justify-between gap-4"><div><h2 className="text-xl font-black text-slate-950">Official Nexa Email</h2><p className="mt-1 text-xs text-slate-400">Namecheap Private Email or any SMTP mailbox used by Nexa.</p></div><label className="flex items-center gap-3 text-sm font-bold text-slate-700"><span>{form.email_enabled ? 'Enabled' : 'Disabled'}</span><Toggle checked={Boolean(form.email_enabled)} onChange={(value) => set('email_enabled', value)} /></label></div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2"><Input label="From name" value={form.email_from_name || ''} onChange={(value) => set('email_from_name', value)} placeholder="Nexa" /><Input label="From email" value={form.email_from_address || ''} onChange={(value) => set('email_from_address', value)} placeholder="support@yourdomain.com" /><Input label="Reply-to email" value={form.email_reply_to || ''} onChange={(value) => set('email_reply_to', value)} placeholder="support@yourdomain.com" /><Input label="SMTP username" value={form.email_smtp_username || ''} onChange={(value) => set('email_smtp_username', value)} placeholder="support@yourdomain.com" /><Input label="SMTP host" value={form.email_smtp_host || ''} onChange={(value) => set('email_smtp_host', value)} placeholder="mail.privateemail.com" /><Input label="SMTP port" value={String(form.email_smtp_port || '')} onChange={(value) => set('email_smtp_port', value)} placeholder="465" /><Input label="SMTP password" type="password" value={form.email_smtp_password || ''} onChange={(value) => set('email_smtp_password', value)} placeholder={form.email_smtp_password_configured ? 'Saved - enter only to change it' : 'Mailbox password'} helper={form.email_smtp_password_configured ? 'A mailbox password is already securely saved.' : 'Use the mailbox password from Namecheap Private Email.'} /><label className="block"><span className="mb-2 block text-xs font-bold text-slate-600">Security</span><button type="button" onClick={() => set('email_smtp_secure', !form.email_smtp_secure)} className={`flex h-[46px] w-full items-center justify-between rounded-2xl border px-4 text-sm font-black ${form.email_smtp_secure ? 'border-[#3535FF]/20 bg-[#f1efff] text-[#3535FF]' : 'border-slate-200 bg-slate-50 text-slate-500'}`}><span>SSL/TLS</span><span>{form.email_smtp_secure ? 'On' : 'Off'}</span></button></label></div>
              <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Namecheap Private Email:</strong> host <span className="font-mono">mail.privateemail.com</span>, port <span className="font-mono">465</span>, SSL/TLS on, username is the full email address.</div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row"><Input label="Send test email to" value={testEmail} onChange={setTestEmail} placeholder="you@example.com" /><button onClick={sendEmailTest} disabled={testingEmail || !testEmail.trim()} className="mt-6 rounded-2xl bg-[#101027] px-5 py-3 text-sm font-black text-white disabled:opacity-50 sm:min-w-40">{testingEmail ? 'Sending...' : 'Send test email'}</button></div>
            </div>
            </div>
            <div className="space-y-6">
              <div className="rounded-[30px] bg-[#101027] p-6 text-white shadow-xl"><h2 className="text-lg font-black">Webhook connection</h2><p className="mb-4 mt-1 text-xs text-white/55">Evolution sends incoming messages to this URL.</p><div className="break-all rounded-2xl border border-white/10 bg-white/10 px-4 py-4 text-xs leading-5 text-white/75">{form.webhook_url || 'Generated after setup loads.'}</div><button onClick={copyWebhook} className="mt-4 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold">Copy webhook URL</button></div>
              <div className="rounded-[30px] border border-white bg-white p-6 shadow-lg shadow-indigo-100/40"><h2 className="text-lg font-black text-slate-950">Send test WhatsApp</h2><p className="mb-4 mt-1 text-xs text-slate-400">Confirm that the linked Nexa number can send messages.</p><Input label="Test receiver number" value={testPhone} onChange={setTestPhone} placeholder="2547XXXXXXXX" /><button onClick={sendTest} disabled={sending || !testPhone.trim()} className="mt-4 w-full rounded-2xl bg-[#101027] px-5 py-3 text-sm font-black text-white disabled:opacity-50">{sending ? 'Sending...' : 'Send test message'}</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
