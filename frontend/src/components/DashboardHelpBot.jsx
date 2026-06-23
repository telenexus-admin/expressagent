import React, { useRef, useState } from 'react';
import api from '../utils/api';
import { CloseIcon } from './Icons';
import nexaHelpRobot from '../assets/nexa-help-robot.jpg';

const STARTER_MESSAGES = [
  'How do I install the app?',
  'How do I connect Wispman billing?',
  'Tell the AI to keep replies shorter.',
];

export default function DashboardHelpBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hi, I can help with this dashboard, tickets, billing, notifications and agent behavior. You can also ask me to update the AI prompt.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const send = async (text = input) => {
    const message = String(text || '').trim();
    if (!message || busy) return;

    setInput('');
    setMessages((current) => [...current, { role: 'user', text: message }]);
    setBusy(true);

    try {
      const { data } = await api.post('/help-bot/chat', { message });
      const applied = data.applied?.type === 'agent_prompt'
        ? `\n\nApplied to Agent Configuration: ${data.applied.instruction}`
        : '';
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: `${data.reply || 'Done.'}${applied}` },
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: err.response?.data?.error || 'I could not respond right now.' },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-[22px] border border-[#dce3f1] bg-white p-2 pr-4 text-[#0d1438] shadow-2xl shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-indigo-500/30"
        aria-label="Open help bot"
      >
        <img
          src={nexaHelpRobot}
          alt=""
          className="h-12 w-12 rounded-2xl object-cover object-top"
        />
        <span className="hidden text-left text-xs font-black leading-4 sm:block">
          Ask Nexa
          <br />
          for help
        </span>
      </button>

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[620px] max-h-[calc(100vh-2rem)] w-[390px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-2xl shadow-slate-900/20">
          <div className="flex items-center justify-between gap-3 bg-[#0A0A0F] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <img src={nexaHelpRobot} alt="" className="h-11 w-11 rounded-2xl object-cover object-top" />
              <div>
                <div className="text-sm font-black">Ask Nexa for help</div>
                <div className="text-xs text-white/55">System help and safe auto-config</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:text-white"
              aria-label="Close help bot"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="no-visible-scrollbar flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'bg-[#3535FF] text-white'
                        : 'border border-slate-100 bg-white text-slate-700 shadow-sm'
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="inline-flex rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm font-semibold text-slate-400 shadow-sm">
                  Thinking...
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 bg-white p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {STARTER_MESSAGES.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => send(starter)}
                  disabled={busy}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-[#efe9ff] hover:text-[#4B16B5] disabled:opacity-50"
                >
                  {starter}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') send();
                }}
                placeholder="Ask or tell it what to configure..."
                className="h-12 min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-[#3535FF]"
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="rounded-2xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
