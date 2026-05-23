import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

function shortTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const STATUS = {
  active: { text: 'Active', style: 'bg-emerald-50 text-emerald-600' },
  human_takeover: { text: 'Human', style: 'bg-orange-50 text-orange-600' },
  resolved: { text: 'Resolved', style: 'bg-slate-100 text-slate-500' },
};

export default function GlobalConversationSearch() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/conversations', { params: { search: trimmed } });
        if (!cancelled) {
          setResults(data.slice(0, 6));
          setOpen(true);
        }
      } catch (err) {
        if (!cancelled && err.response?.status !== 401) console.error('Dashboard search failed:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    navigate(`/dashboard/conversations?search=${encodeURIComponent(trimmed)}`);
  };

  const openConversation = (id) => {
    setOpen(false);
    setQuery('');
    navigate(`/dashboard/conversations/${id}`);
  };

  return (
    <div ref={containerRef} className="relative hidden md:block w-[330px] xl:w-[405px]">
      <form onSubmit={submit} className="flex bg-white rounded-full px-5 py-3 shadow-sm border border-slate-100 items-center gap-3 focus-within:ring-2 focus-within:ring-[#4b16b5]/15">
        <svg className="w-4 h-4 text-slate-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m21 21-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          placeholder="Search customer, phone or message..."
          className="bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none flex-1"
          aria-label="Search customer conversations"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="text-slate-300 hover:text-slate-500 text-lg leading-none" aria-label="Clear search">×</button>
        )}
      </form>

      {open && query.trim().length >= 2 && (
        <div className="absolute right-0 left-0 top-[58px] z-50 rounded-[24px] border border-slate-100 bg-white p-2 shadow-2xl shadow-slate-300/40">
          <div className="px-3 pt-2 pb-2 text-[10px] font-black tracking-[0.16em] uppercase text-slate-400">Conversation results</div>
          {loading ? (
            <div className="px-3 py-5 text-xs text-slate-400">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-5 text-xs text-slate-400">No customer or message found.</div>
          ) : (
            <div className="space-y-1">
              {results.map((item) => {
                const status = STATUS[item.status] || STATUS.active;
                return (
                  <button key={item.id} type="button" onClick={() => openConversation(item.id)} className="w-full rounded-2xl px-3 py-3 text-left hover:bg-[#f5f1ff] transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-xs font-bold text-slate-800 truncate">{item.customer_name || `+${item.customer_phone}`}</div>
                      <span className={`text-[9px] font-bold rounded-full px-2 py-1 shrink-0 ${status.style}`}>{status.text}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                      <span className="truncate">+{item.customer_phone}</span>
                      <span className="shrink-0">{shortTime(item.last_message_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-slate-500">{item.last_message || 'No message preview available'}</p>
                  </button>
                );
              })}
            </div>
          )}
          {results.length > 0 && (
            <button type="button" onClick={submit} className="mt-2 w-full border-t border-slate-100 py-3 text-xs font-bold text-[#4b16b5] hover:bg-[#f5f1ff] rounded-b-2xl">View all matching conversations →</button>
          )}
        </div>
      )}
    </div>
  );
}
