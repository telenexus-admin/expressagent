
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';
import { messagesForLLM, messagesForStorage } from '../utils/nexaChatSecurity';

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
  const [bubbleHidden, setBubbleHidden] = useState(false);
  const [hideBubblePrompt, setHideBubblePrompt] = useState(false);
  const bubblePressTimer = useRef(null);
  const bubbleLongPress = useRef(false);
  const [onboarding, setOnboarding] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const prompts = PROMPTS[currentTab] || PROMPTS.overview;

  useEffect(() => setMessages(readMessages(storageKey)), [storageKey]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(messagesForStorage(messages))); } catch (_) { /* optional */ }
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
    setOnboarding(null);
    setQuestion('');
    setCopiedId('');
    setMessages([WELCOME]);
    setError('');
    try { localStorage.removeItem(storageKey); } catch (_) { /* optional */ }
  };

  const continueOnboarding = async (text) => {
    const addUser = (displayText, sensitive = false) => setMessages((current) => current.concat({
      id: crypto.randomUUID(),
      role: 'user',
      text: displayText,
      private: sensitive,
      sensitive,
    }));
    const addNexa = (message) => setMessages((current) => current.concat({
      id: crypto.randomUUID(),
      role: 'assistant',
      text: message,
    }));
    setQuestion('');
    setError('');

    if (onboarding.step === 'name') {
      const name = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      addUser(name);
      if (name.length < 2) {
        addNexa('Please give the router a clear name with at least two characters.');
        return;
      }
      setOnboarding({ step: 'password', name, password: '' });
      addNexa('Perfect — I will call it "' + name + '".\n\nNow create the MikroTik API password Nexa should use. It must have at least 8 characters. This entry is masked and will never be sent to the AI or saved in chat history.');
      return;
    }

    if (onboarding.step === 'password') {
      addUser('••••••••', true);
      if (text.length < 8) {
        addNexa('That password is too short. Please enter at least 8 characters.');
        return;
      }
      setOnboarding({ step: 'confirm', name: onboarding.name, password: text });
      addNexa('Got it securely. Please enter the same password once more to confirm it.');
      return;
    }

    if (onboarding.step === 'confirm') {
      addUser('••••••••', true);
      if (text !== onboarding.password) {
        setOnboarding({ step: 'password', name: onboarding.name, password: '' });
        addNexa('Those passwords did not match, so I discarded both entries. Create the password again and I will reconfirm it.');
        return;
      }

      const routerName = onboarding.name;
      const confirmedPassword = onboarding.password;
      setOnboarding({ step: 'creating', name: routerName });
      setThinking(true);
      try {
        const result = await api.post('/mikrotik/wireguard/prepare', {
          name: routerName,
          password: confirmedPassword,
        });
        const script = String(result.data?.mikrotikScript || '');
        if (!script) throw new Error('The onboarding service did not return a script.');
        setMessages((current) => current.concat({
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'Your secure script for "' + routerName + '" is ready.\n\nCopy it below and paste it once into the MikroTik terminal. I will detect the callback, identify the model and RouterOS version, register it to this billing account, and begin discovery automatically.',
          script,
          expiresInMinutes: Number(result.data?.expires_in_minutes || 60),
          sensitive: true,
        }));
        setOnboarding(null);
      } catch (requestError) {
        setOnboarding(null);
        setError(requestError.response?.data?.error || requestError.message || 'Could not generate the onboarding script.');
        addNexa('I could not generate the script, and I discarded the password. Nothing was changed on the router. Tell me to add the MikroTik when you are ready to try again.');
      } finally {
        setThinking(false);
      }
    }
  };
  const ask = async (value) => {
    const text = String(value || question).trim();
    if (!text || thinking) return;
    if (onboarding) {
      if (onboarding.step !== 'creating') await continueOnboarding(text);
      return;
    }
    const prior = messagesForLLM(messages);
    const userMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((current) => current.concat(userMessage));
    setQuestion('');
    setError('');
    setThinking(true);
    try {
      const response = await api.post('/nexa-knowledge/ask', {
        question: text,
        history: prior,
        category: currentTab === 'routers' ? 'router' : undefined,
        workspace: currentTab,
      });
      if (response.data?.flow?.type === 'mikrotik_onboarding') {
        setOnboarding({ step: 'name', name: '', password: '' });
      }
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

  const copyScript = async (message) => {
    try {
      await navigator.clipboard.writeText(message.script);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => current === message.id ? '' : current), 2200);
    } catch (_) {
      setError('Could not copy automatically. Press and hold the script to select it.');
    }
  };

  const endBubblePress = () => {
    if (
      bubblePressTimer.current
    ) {
      window.clearTimeout(
        bubblePressTimer.current
      );

      bubblePressTimer.current =
        null;
    }
  };


  const beginBubblePress = () => {
    endBubblePress();

    bubbleLongPress.current =
      false;

    bubblePressTimer.current =
      window.setTimeout(
        () => {
          bubbleLongPress.current =
            true;

          setHideBubblePrompt(
            true
          );

          bubblePressTimer.current =
            null;
        },

        650
      );
  };


  const openBubble = () => {
    endBubblePress();

    if (
      bubbleLongPress.current
    ) {
      bubbleLongPress.current =
        false;

      return;
    }

    setHideBubblePrompt(
      false
    );

    setOpen(
      true
    );
  };


  const hideBubble = () => {
    endBubblePress();

    bubbleLongPress.current =
      false;

    setHideBubblePrompt(
      false
    );

    setBubbleHidden(
      true
    );

    setOpen(
      false
    );
  };


  const secretEntry = onboarding?.step === 'password' || onboarding?.step === 'confirm';
  const onboardingPlaceholder = onboarding?.step === 'name'
    ? 'Enter the MikroTik name…'
    : onboarding?.step === 'password'
      ? 'Create the API password…'
      : onboarding?.step === 'confirm'
        ? 'Confirm the API password…'
        : onboarding?.step === 'creating'
          ? 'Generating secure script…'
          : 'Ask Nexa about your ISP…';
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
                {message.script && <div className={'mt-3 overflow-hidden rounded-2xl border ' + (darkMode ? 'border-slate-700 bg-slate-950' : 'border-violet-200 bg-[#130b29]')}>
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-white"><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-violet-300">One-paste RouterOS script</p><p className="text-[9px] text-slate-400">Expires in {message.expiresInMinutes || 60} minutes</p></div><button type="button" onClick={() => void copyScript(message)} className="rounded-lg bg-violet-600 px-3 py-2 text-[10px] font-extrabold hover:bg-violet-500">{copiedId === message.id ? 'Copied ✓' : 'Copy script'}</button></div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 py-3 font-mono text-[10px] leading-4 text-emerald-300">{message.script}</pre>
                </div>}
                {labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{labels.map((label) => <span key={label} className={'max-w-[180px] truncate rounded-full px-2 py-1 text-[9px] font-bold ' + (darkMode ? 'bg-slate-800 text-slate-400' : 'bg-violet-100 text-violet-600')}>{label}</span>)}</div>}
              </div>
            </div>
          </article>;
        })}
        {thinking && <div className="flex items-center gap-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white"><Icon name="sparkle" className="h-4 w-4" /></div><div className={'flex gap-1 rounded-2xl rounded-bl-md border px-4 py-3 ' + (darkMode ? 'border-slate-700 bg-slate-800' : 'border-violet-100 bg-white')}>{[0, 1, 2].map((item) => <span key={item} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: String(item * 130) + 'ms' }} />)}</div></div>}
        </div>
      </div>

      <div className={'border-t px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 sm:px-5 ' + (darkMode ? 'border-slate-800 bg-[#11162a]' : 'border-slate-100 bg-white')}>
        {!onboarding && messages.length <= 2 && <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{prompts.map((prompt) => <button type="button" key={prompt} disabled={thinking} onClick={() => void ask(prompt)} className={'shrink-0 rounded-full border px-3 py-2 text-[10px] font-bold disabled:opacity-50 ' + (darkMode ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-violet-100 bg-violet-50 text-violet-700')}>{prompt}</button>)}</div>}
        {error && <p className="mb-2 text-[11px] font-semibold text-rose-500">{error}</p>}
        <form onSubmit={(event) => { event.preventDefault(); void ask(); }} className={'flex items-end gap-2 rounded-2xl border p-2 focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-500/10 ' + composer}>
          {secretEntry ? <input ref={inputRef} type="password" autoComplete="new-password" maxLength="160" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={onboardingPlaceholder} className="min-h-[38px] flex-1 bg-transparent px-2 py-2 text-[13px] leading-5 outline-none" /> : <textarea ref={inputRef} rows="1" maxLength="1000" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder={onboardingPlaceholder} disabled={onboarding?.step === 'creating'} className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-5 outline-none disabled:opacity-50" />}
          <button type="submit" disabled={thinking || !question.trim()} aria-label="Send message to Nexa" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-300/40 hover:bg-violet-700 disabled:opacity-40"><Icon name="send" /></button>
        </form>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[9px] font-semibold text-slate-400"><Icon name="shield" className="h-3 w-3" />{secretEntry ? 'Private entry · never sent to AI or saved in chat' : 'Account-scoped evidence · Operational actions require approval'}</div>
      </div>
    </section>}

    {!open &&
      !bubbleHidden && (
      <>

        {hideBubblePrompt && (
          <div className="fixed bottom-[150px] right-4 z-[10011] flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-400/30 lg:bottom-[88px] lg:right-6">

            <span className="pl-2 text-[10px] font-black text-slate-600">
              Hide Ask Nexa?
            </span>

            <button
              type="button"
              onClick={
                hideBubble
              }
              className="rounded-xl bg-slate-950 px-3 py-2 text-[9px] font-black text-white"
            >
              Hide
            </button>

            <button
              type="button"
              onClick={() =>
                setHideBubblePrompt(
                  false
                )
              }
              className="rounded-xl px-2 py-2 text-[9px] font-black text-slate-400"
            >
              Cancel
            </button>
          </div>
        )}


        <button
          type="button"
          data-nexa-agent-bubble="true"
          aria-label="Open Nexa assistant"
          onPointerDown={
            beginBubblePress
          }
          onPointerUp={
            endBubblePress
          }
          onPointerCancel={
            endBubblePress
          }
          onPointerLeave={
            endBubblePress
          }
          onContextMenu={
            event =>
              event
                .preventDefault()
          }
          onClick={
            openBubble
          }
          className="group fixed bottom-[84px] right-4 z-[10010] flex h-14 select-none items-center gap-2 rounded-full bg-gradient-to-br from-[#0b3923] to-[#0f7048] px-4 text-white shadow-[0_14px_36px_rgba(11,57,35,.34)] transition hover:-translate-y-1 lg:bottom-6 lg:right-6"
        >

          <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/15">

            <Icon
              name="sparkle"
            />

            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-emerald-700 bg-emerald-300" />
          </span>


          <span className="pr-1 text-xs font-extrabold">
            Ask Nexa
          </span>


          {unread && (
            <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white bg-rose-500" />
          )}
        </button>
      </>
    )}

  </>;
}
