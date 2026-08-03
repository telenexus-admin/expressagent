
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  text: "Hello — I'm Nexa. I can explain what is happening across your subscribers, collections, routers, RADIUS sessions, incidents, employees, and communications. What would you like to know?",
};

const PROMPTS = {
  overview: ['What needs my attention today?', 'How are collections performing?', 'Give me a short account health briefing'],
  subscribers: ['Which subscribers need attention?', 'Explain the latest offline subscribers', 'Which accounts recently expired?'],
  routers: ['Summarize router health', 'Are there active network incidents?', 'Show recent repair recommendations'],
  services: ['Which packages are most active?', 'Are there package or RADIUS problems?', 'Summarize service performance'],
  payments: ['Summarize collections this month', 'Which invoices remain unpaid?', 'Show recent payment risks'],
  communication: ['Are messages being delivered?', 'Summarize communication problems', 'Which customers need a message?'],
  reports: ['Give me an executive briefing', 'Summarize network performance', 'How are employees performing?'],
};

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    sparkle: <><path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4L12 2Z" /><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    minimize: <path d="M6 12h12" />,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.9 8 7 10 4.1-2 7-5.3 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.sparkle}</svg>;
}

function MessageText({ text }) {
  return <div className="space-y-2">{String(text || '').split(/\n+/).filter(Boolean).map((line, index) => {
    const bullet = /^[-•]\s+/.test(line);
    return <p key={index} className={bullet ? 'pl-3 before:-ml-3 before:mr-2 before:content-["•"]' : ''}>{line.replace(/^[-•]\s+/, '')}</p>;
  })}</div>;
}

function sourceLabel(source) {
  if (!source || typeof source !== 'object') return '';
  return source.title || source.name || source.label || source.event_type ||
    [source.entity_type, source.entity_id].filter(Boolean).join(' ') ||
    [source.type, source.id].filter(Boolean).join(' ');
}

function readMessages(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return [WELCOME].concat(Array.isArray(value) ? value.filter((item) => item?.role && item?.text).slice(-30) : []);
  } catch (_) {
    return [WELCOME];
  }
}

export default function NexaAgentChat({ admin, currentTab = 'overview', darkMode = false }) {
  const storageKey = useMemo(() => 'nexa-agent-chat-v1:' +
    (admin?.client_id || admin?.clientId || admin?.client_name || 'billing') + ':' +
    (admin?.id || 'admin'), [admin]);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => readMessages(storageKey));
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const prompts = PROMPTS[currentTab] || PROMPTS.overview;

  useEffect(() => setMessages(readMessages(storageKey)), [storageKey]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(messages.filter((item) => item.id !== 'welcome').slice(-30))); } catch (_) { /* optional */ }
  }, [messages, storageKey]);
  useEffect(() => {
    if (!open) return;
    setUnread(false);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 160);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking, open]);
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const clearChat = () => {
    setMessages([WELCOME]);
    setError('');
    try { localStorage.removeItem(storageKey); } catch (_) { /* optional */ }
  };

  const ask = async (value) => {
    const text = String(value || question).trim();
    if (!text || thinking) return;
    const prior = messages.filter((item) => item.id !== 'welcome').slice(-8);
    const userMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((current) => current.concat(userMessage));
    setQuestion('');
    setError('');
    setThinking(true);
    try {
      const response = await api.post('/nexa-knowledge/ask', {
        question: text,
        history: prior.map((item) => ({ role: item.role, content: item.text })),
        category: currentTab === 'routers' ? 'router' : undefined,
        workspace: currentTab,
      });
      setMessages((current) => current.concat({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: response.data?.answer || 'I could not form an answer from the available account evidence.',
        sources: Array.isArray(response.data?.sources) ? response.data.sources : [],
      }));
      if (!open) setUnread(true);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Nexa could not reach the account knowledge service.');
      setMessages((current) => current.concat({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: 'I could not complete that request. Your account data was not changed.',
        failed: true,
      }));
    } finally {
      setThinking(false);
    }
  };

  const panel = darkMode ? 'border-slate-700 bg-[#11162a] text-white' : 'border-white/80 bg-white text-slate-900';
  const composer = darkMode ? 'border-slate-700 bg-slate-900 text-white placeholder:text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400';

  return <>
    {open && <section role="dialog" aria-modal="true" aria-label="Chat with Nexa" className={'fixed inset-0 z-[10020] flex flex-col overflow-hidden sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-48px))] sm:w-[410px] sm:rounded-[28px] sm:border sm:shadow-[0_24px_80px_rgba(36,19,100,.28)] ' + panel}>
      <header className="relative overflow-hidden bg-gradient-to-br from-[#22005f] via-[#5b21d4] to-[#9635f4] px-4 pb-4 pt-[max(16px,env(safe-area-inset-top))] text-white sm:px-5 sm:pt-5">
        <div className="pointer-events-none absolute -right-8 -top-12 h-36 w-36 rounded-full bg-fuchsia-300/25 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/15 shadow-lg">
            <Icon name="sparkle" className="h-6 w-6" />
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#6927dc] bg-emerald-400" />
          </div>
          <div className="min-w-0 flex-1"><h2 className="text-base font-extrabold tracking-tight">Nexa</h2><p className="truncate text-[11px] font-semibold text-violet-100">Live account intelligence · {admin?.client_business_name || admin?.client_name || 'Billing workspace'}</p></div>
          <button type="button" onClick={clearChat} aria-label="Clear Nexa conversation" className="flex h-9 w-9 items-center justify-center rounded-xl text-violet-100 hover:bg-white/10 hover:text-white"><Icon name="trash" className="h-4 w-4" /></button>
          <button type="button" onClick={() => setOpen(false)} aria-label="Minimize Nexa chat" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"><Icon name="minimize" /></button>
        </div>
      </header>

      <div ref={scrollRef} className={'flex-1 overflow-y-auto px-4 py-5 sm:px-5 ' + (darkMode ? 'bg-[#0c1122]' : 'bg-[#f7f5ff]')} aria-live="polite">
        <div className="space-y-4">{messages.map((message) => {
          const mine = message.role === 'user';
          const labels = [...new Set((message.sources || []).map(sourceLabel).filter(Boolean))].slice(0, 4);
          return <article key={message.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
            <div className={'max-w-[88%] ' + (mine ? '' : 'flex gap-2.5')}>
              {!mine && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white"><Icon name="sparkle" className="h-4 w-4" /></div>}
              <div>
                <div className={'rounded-2xl px-4 py-3 text-[13px] leading-5 shadow-sm ' + (mine ? 'rounded-br-md bg-violet-600 text-white' : message.failed ? 'rounded-bl-md border border-rose-200 bg-rose-50 text-rose-800' : darkMode ? 'rounded-bl-md border border-slate-700 bg-slate-800 text-slate-100' : 'rounded-bl-md border border-violet-100 bg-white text-slate-700')}><MessageText text={message.text} /></div>
                {labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{labels.map((label) => <span key={label} className={'max-w-[180px] truncate rounded-full px-2 py-1 text-[9px] font-bold ' + (darkMode ? 'bg-slate-800 text-slate-400' : 'bg-violet-100 text-violet-600')}>{label}</span>)}</div>}
              </div>
            </div>
          </article>;
        })}
        {thinking && <div className="flex items-center gap-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white"><Icon name="sparkle" className="h-4 w-4" /></div><div className={'flex gap-1 rounded-2xl rounded-bl-md border px-4 py-3 ' + (darkMode ? 'border-slate-700 bg-slate-800' : 'border-violet-100 bg-white')}>{[0, 1, 2].map((item) => <span key={item} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: String(item * 130) + 'ms' }} />)}</div></div>}
        </div>
      </div>

      <div className={'border-t px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 sm:px-5 ' + (darkMode ? 'border-slate-800 bg-[#11162a]' : 'border-slate-100 bg-white')}>
        {messages.length <= 2 && <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{prompts.map((prompt) => <button type="button" key={prompt} disabled={thinking} onClick={() => void ask(prompt)} className={'shrink-0 rounded-full border px-3 py-2 text-[10px] font-bold disabled:opacity-50 ' + (darkMode ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-violet-100 bg-violet-50 text-violet-700')}>{prompt}</button>)}</div>}
        {error && <p className="mb-2 text-[11px] font-semibold text-rose-500">{error}</p>}
        <form onSubmit={(event) => { event.preventDefault(); void ask(); }} className={'flex items-end gap-2 rounded-2xl border p-2 focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-500/10 ' + composer}>
          <textarea ref={inputRef} rows="1" maxLength="1000" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask Nexa about your ISP…" className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-5 outline-none" />
          <button type="submit" disabled={thinking || !question.trim()} aria-label="Send message to Nexa" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-300/40 hover:bg-violet-700 disabled:opacity-40"><Icon name="send" /></button>
        </form>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[9px] font-semibold text-slate-400"><Icon name="shield" className="h-3 w-3" />Account-scoped evidence · Operational actions require approval</div>
      </div>
    </section>}

    {!open && <button type="button" data-nexa-agent-bubble="true" aria-label="Open Nexa assistant" onClick={() => setOpen(true)} className="group fixed bottom-[84px] right-4 z-[10010] flex h-14 items-center gap-2 rounded-full bg-gradient-to-br from-[#5b21d4] to-[#9333ea] px-4 text-white shadow-[0_14px_36px_rgba(91,33,212,.4)] transition hover:-translate-y-1 lg:bottom-6 lg:right-6">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/15"><Icon name="sparkle" /><span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-violet-600 bg-emerald-400" /></span>
      <span className="pr-1 text-xs font-extrabold">Ask Nexa</span>
      {unread && <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white bg-rose-500" />}
    </button>}
  </>;
}
