import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import api from '../utils/api';
import BillingSubscribersLegacy from './BillingSubscribersLegacy';
import PppoeClientCreate from './PppoeClientCreate';
import SubscriberMigrationCenter from './SubscriberMigrationCenter';

function compact(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5h16v11H8l-4 3v-14Z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.4-4A8 8 0 1 1 20 11.5Z" />
      <path d="M8.4 7.8c.3-.3.7-.3 1-.1l1.2 1.8c.2.3.1.6-.1.9l-.7.7c.6 1.3 1.7 2.4 3 3l.7-.8c.2-.3.6-.3.9-.1l1.8 1.1c.3.2.4.6.2.9-.5.9-1.4 1.4-2.4 1.3-3.3-.4-6.1-3-6.6-6.3-.1-.9.2-1.8 1-2.4Z" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.2 3.8 9 3l2 5-2.1 1.4a14.2 14.2 0 0 0 5.7 5.7L16 13l5 2-.8 2.8a3 3 0 0 1-3.2 2.1C10 19.2 4.8 14 4.1 7a3 3 0 0 1 2.1-3.2Z" />
    </svg>
  );
}

function QuickAction({ label, title, disabled, tone, onClick, children }) {
  const tones = {
    sms: 'text-sky-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700',
    whatsapp: 'text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700',
    call: 'text-slate-500 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700',
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border border-transparent transition ${tones[tone] || tones.call} disabled:cursor-not-allowed disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

function CommunicationPopup({ subscriber, channel, close }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [phone, setPhone] = useState(subscriber?.phone || '');
  const endRef = useRef(null);

  const isWhatsApp = channel === 'whatsapp';
  const title = isWhatsApp ? 'WhatsApp' : 'Message';

  const payload = useMemo(() => ({
    phone: subscriber?.phone || '',
    customer_name: subscriber?.full_name || '',
    channel,
  }), [subscriber?.phone, subscriber?.full_name, channel]);

  const loadThread = async ({ quiet = false } = {}) => {
    if (!payload.phone) {
      setConfigured(false);
      setError('This subscriber has no phone number. Add a phone number before sending a message.');
      setLoading(false);
      return;
    }

    try {
      if (!quiet) setLoading(true);
      const result = await api.post('/billing-workspace/subscriber-communications/open', payload);
      setMessages(Array.isArray(result.data?.messages) ? result.data.messages : []);
      setConfigured(result.data?.configured !== false);
      setPhone(result.data?.conversation?.customer_phone || payload.phone);
      setError(result.data?.configured === false
        ? `${isWhatsApp ? 'WhatsApp' : 'SMS'} is not configured for this billing workspace.`
        : '');
    } catch (requestError) {
      if (!quiet) {
        setError(requestError.response?.data?.error || requestError.response?.data?.errors?.[0]?.msg || 'Could not open this conversation.');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const firstLoad = async () => {
      if (!active) return;
      await loadThread();
    };
    void firstLoad();

    const interval = window.setInterval(() => {
      if (active && isWhatsApp && configured) void loadThread({ quiet: true });
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.phone, payload.customer_name, payload.channel]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);

  const send = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || !configured) return;

    try {
      setSending(true);
      setError('');
      const result = await api.post('/billing-workspace/subscriber-communications/send', {
        ...payload,
        message: text,
      });
      setMessages(Array.isArray(result.data?.messages) ? result.data.messages : messages);
      setDraft('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.response?.data?.errors?.[0]?.msg || 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[15000] flex items-end justify-center bg-slate-950/30 p-0 backdrop-blur-[1px] sm:items-end sm:justify-end sm:p-5" onClick={close}>
      <section
        className="flex max-h-[76vh] w-full flex-col overflow-hidden rounded-t-[26px] border border-slate-200 bg-white shadow-2xl sm:max-h-[620px] sm:w-[380px] sm:rounded-[24px]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={`flex items-center justify-between gap-3 px-4 py-3.5 text-white ${isWhatsApp ? 'bg-[#075e54]' : 'bg-slate-900'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
              {isWhatsApp ? <WhatsAppIcon /> : <MessageIcon />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{title} · {subscriber?.full_name || 'Subscriber'}</p>
              <p className="mt-0.5 truncate text-[10px] text-white/70">{phone || subscriber?.phone || 'No phone number'} · {configured ? 'Configured channel' : 'Channel unavailable'}</p>
            </div>
          </div>
          <button type="button" onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl transition hover:bg-white/20">×</button>
        </header>

        <div className={`border-b px-4 py-2 text-[10px] font-semibold ${isWhatsApp ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-sky-100 bg-sky-50 text-sky-700'}`}>
          {isWhatsApp
            ? 'Messages are sent through the WhatsApp channel configured for this ISP. New WhatsApp replies appear here automatically.'
            : 'Messages are sent through the SMS provider configured for this ISP.'}
        </div>

        <div className="min-h-[250px] flex-1 space-y-2 overflow-y-auto bg-[#f7f8fa] p-4">
          {loading ? (
            <div className="space-y-3">
              <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-slate-200" />
              <div className="ml-auto h-14 w-3/4 animate-pulse rounded-2xl bg-slate-200" />
              <div className="h-10 w-1/2 animate-pulse rounded-2xl bg-slate-200" />
            </div>
          ) : messages.length ? messages.map((message) => {
            const incoming = message.role === 'user';
            return (
              <article key={message.id} className={`flex ${incoming ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[82%] rounded-2xl px-3 py-2.5 shadow-sm ${incoming ? 'rounded-bl-md bg-white text-slate-800' : isWhatsApp ? 'rounded-br-md bg-[#dff7e8] text-slate-900' : 'rounded-br-md bg-sky-100 text-slate-900'}`}>
                  <p className="whitespace-pre-wrap break-words text-xs leading-5">{message.content}</p>
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-[8px] text-slate-400">
                    {!incoming && message.sender_name && <span>{message.sender_name}</span>}
                    <span>{message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </div>
                </div>
              </article>
            );
          }) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isWhatsApp ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{isWhatsApp ? <WhatsAppIcon /> : <MessageIcon />}</span>
              <strong className="mt-3 text-sm text-slate-800">Start the conversation</strong>
              <p className="mt-1 max-w-[250px] text-[10px] leading-5 text-slate-400">Send the first {isWhatsApp ? 'WhatsApp' : 'SMS'} message to this subscriber from Polyizon.</p>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error && <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-[10px] font-bold text-rose-700">{error}</div>}

        <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3">
          <textarea
            rows="1"
            maxLength="4000"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim()) void send(event);
              }
            }}
            disabled={!configured || sending}
            placeholder={configured ? `Type ${isWhatsApp ? 'a WhatsApp' : 'an SMS'} message…` : 'Configure this channel first'}
            className="min-h-11 max-h-28 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-800 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!configured || sending || !draft.trim()}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${isWhatsApp ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-sky-600 hover:bg-sky-500'}`}
            aria-label="Send message"
          >
            {sending ? '…' : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg>
            )}
          </button>
        </form>
      </section>
    </div>
  );
}

function CallComingSoon({ subscriber, close }) {
  return (
    <div className="fixed inset-0 z-[15000] flex items-center justify-center bg-slate-950/35 p-5 backdrop-blur-sm" onClick={close}>
      <section className="w-full max-w-sm rounded-[26px] bg-white p-6 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><CallIcon /></span>
        <p className="mt-4 text-[9px] font-black uppercase tracking-[.18em] text-violet-500">Polyizon Voice</p>
        <h3 className="mt-1 text-xl font-black text-slate-950">Coming soon in v2</h3>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-slate-500">Direct calls to {subscriber?.full_name || 'this subscriber'} from the subscriber list will be added with the Polyizon call-center integration.</p>
        <button type="button" onClick={close} className="mt-5 w-full rounded-xl bg-slate-900 py-3 text-xs font-black text-white">Got it</button>
      </section>
    </div>
  );
}

export default function BillingSubscribers(props) {
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [pppoeOpen, setPppoeOpen] = useState(false);
  const [legacyKey, setLegacyKey] = useState(0);
  const [actionSlots, setActionSlots] = useState([]);
  const [communication, setCommunication] = useState(null);
  const [callNotice, setCallNotice] = useState(null);
  const rootRef = useRef(null);

  const candidates = useMemo(() => {
    const subscriberRows = Array.isArray(props.subscribers) ? props.subscribers : [];
    const networkRows = Array.isArray(props.networkClients) ? props.networkClients : [];
    return [...subscriberRows, ...networkRows];
  }, [props.subscribers, props.networkClients]);

  const closePppoe = () => {
    setPppoeOpen(false);
    setLegacyKey((value) => value + 1);
  };

  const resolveRowSubscriber = (row, actionButton) => {
    const cells = row?.querySelectorAll?.('td');
    const rowName = String(cells?.[0]?.textContent || actionButton?.getAttribute('aria-label')?.replace(/^Actions for\s+/, '') || '').trim();
    const networkValue = String(cells?.[2]?.textContent || '').trim();
    const networkKey = compact(networkValue);
    const nameKey = compact(rowName);

    const exactIdentity = candidates.find((candidate) => [
      candidate.account_number,
      candidate.phone,
      candidate.radius_username,
      candidate.username,
      candidate.mac_address,
    ].some((value) => value && compact(value) === networkKey));

    if (exactIdentity) return exactIdentity;

    const sameName = candidates.find((candidate) => compact(candidate.full_name || candidate.display_name) === nameKey);
    if (sameName) return sameName;

    return null;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let frame = 0;

    const scan = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const buttons = [...root.querySelectorAll('button[aria-label^="Actions for "]')];
        const next = buttons.map((button, index) => {
          const cell = button.closest('td');
          const row = button.closest('tr');
          const subscriber = resolveRowSubscriber(row, button);
          if (!cell || !subscriber) return null;
          return {
            key: `${subscriber.id || subscriber.account_number || subscriber.phone || index}-${index}`,
            cell,
            subscriber,
          };
        }).filter(Boolean);

        setActionSlots((previous) => {
          if (
            previous.length === next.length &&
            previous.every((entry, index) => entry.cell === next[index]?.cell && entry.key === next[index]?.key)
          ) return previous;
          return next;
        });
      });
    };

    scan();
    const observer = new MutationObserver(() => scan());
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
    // candidates are intentionally included so edited phone/account data rebinds the row actions.
  }, [candidates, legacyKey]);

  const interceptSubscriberActions = (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;

    const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
    const heading = button.querySelector?.('b')?.textContent?.trim() || '';

    if (label === 'Import / migrate') {
      event.preventDefault();
      event.stopPropagation();
      setMigrationOpen(true);
      return;
    }

    if (heading === 'PPPoE client' || label.startsWith('PPPoE client')) {
      event.preventDefault();
      event.stopPropagation();
      setPppoeOpen(true);
    }
  };

  return (
    <div ref={rootRef} className="contents" onClickCapture={interceptSubscriberActions}>
      <style>{`
        .subscriber-list-panel th:last-child,
        .subscriber-list-panel td:last-child { min-width: 138px; }
        .subscriber-quick-actions { pointer-events: auto; }
        @media (max-width: 639px) {
          .subscriber-list-panel th:last-child,
          .subscriber-list-panel td:last-child { min-width: 112px; }
          .subscriber-quick-actions { gap: 0 !important; right: 28px !important; }
          .subscriber-quick-actions button { width: 23px !important; height: 23px !important; }
          .subscriber-quick-actions svg { width: 13px !important; height: 13px !important; }
        }
      `}</style>

      <BillingSubscribersLegacy key={legacyKey} {...props} />

      {actionSlots.map(({ key, cell, subscriber }) => createPortal(
        <span key={key} className="subscriber-quick-actions absolute right-9 top-1/2 z-30 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-inherit px-0.5">
          <QuickAction
            label={`Message ${subscriber.full_name || 'subscriber'}`}
            title={subscriber.phone ? 'Send SMS message' : 'No phone number'}
            disabled={!subscriber.phone}
            tone="sms"
            onClick={() => setCommunication({ subscriber, channel: 'sms' })}
          >
            <MessageIcon />
          </QuickAction>
          <QuickAction
            label={`WhatsApp ${subscriber.full_name || 'subscriber'}`}
            title={subscriber.phone ? 'Open WhatsApp chat' : 'No phone number'}
            disabled={!subscriber.phone}
            tone="whatsapp"
            onClick={() => setCommunication({ subscriber, channel: 'whatsapp' })}
          >
            <WhatsAppIcon />
          </QuickAction>
          <QuickAction
            label={`Call ${subscriber.full_name || 'subscriber'}`}
            title="Call subscriber"
            tone="call"
            onClick={() => setCallNotice(subscriber)}
          >
            <CallIcon />
          </QuickAction>
        </span>,
        cell,
        key
      ))}

      {migrationOpen && (
        <SubscriberMigrationCenter
          routers={props.routers || []}
          plans={props.plans || []}
          hotspotPlans={props.hotspotPlans || []}
          reload={props.reload}
          close={() => setMigrationOpen(false)}
        />
      )}

      {pppoeOpen && (
        <PppoeClientCreate
          routers={props.routers || []}
          plans={props.plans || []}
          reload={props.reload}
          close={closePppoe}
        />
      )}

      {communication && (
        <CommunicationPopup
          subscriber={communication.subscriber}
          channel={communication.channel}
          close={() => setCommunication(null)}
        />
      )}

      {callNotice && (
        <CallComingSoon subscriber={callNotice} close={() => setCallNotice(null)} />
      )}
    </div>
  );
}
