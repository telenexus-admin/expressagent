import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const STATUS_STYLES = {
  active: 'bg-emerald-400/15 text-emerald-300 border-emerald-300/20',
  resolved: 'bg-white/10 text-white/45 border-white/10',
  human_takeover: 'bg-orange-400/15 text-orange-200 border-orange-300/20',
};

const STATUS_LABELS = {
  active: 'AI',
  resolved: 'Done',
  human_takeover: 'Human',
};

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ConversationList({ conversations }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const { id } = useParams();
  const navigate = useNavigate();

  const filtered = conversations.filter((c) => {
    const matchSearch =
      c.customer_phone.includes(search) ||
      (c.last_message || '').toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || c.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col h-full rounded-[28px] bg-white/8 border border-white/10 overflow-hidden backdrop-blur-sm">
      <div className="p-3 space-y-3">
        <div className="relative">
          <input
            type="text"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/12 border border-white/10 rounded-2xl pl-4 pr-9 py-3 text-xs text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 text-sm">⌕</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {['all', 'active', 'human_takeover', 'resolved'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-[11px] py-2 rounded-xl capitalize transition-all ${
                filter === s
                  ? 'bg-white text-[#3b168f] font-black shadow-lg shadow-black/10'
                  : 'bg-white/8 text-white/60 hover:bg-white/12 hover:text-white'
              }`}
            >
              {s === 'all' ? 'All' : s === 'human_takeover' ? 'Human' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {filtered.length === 0 ? (
          <p className="text-center text-white/40 text-xs mt-10 px-4">
            No conversations match your filter.
          </p>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => navigate(`/dashboard/conversations/${conv.id}`)}
              className={`w-full text-left p-3 rounded-2xl transition-all ${
                String(id) === String(conv.id)
                  ? 'bg-white text-slate-900 shadow-xl shadow-black/15'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs shrink-0 ${
                    String(id) === String(conv.id)
                      ? 'bg-[#ede7ff] text-[#4b16b5]'
                      : 'bg-white/12 text-white'
                  }`}
                >
                  {conv.customer_phone?.slice(-2) || '??'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-black text-xs truncate max-w-[118px]">
                      {conv.customer_phone}
                    </span>
                    <span className={`${String(id) === String(conv.id) ? 'text-slate-400' : 'text-white/35'} text-[10px] shrink-0`}>
                      {formatTime(conv.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={`${String(id) === String(conv.id) ? 'text-slate-500' : 'text-white/45'} text-[11px] truncate flex-1`}>
                      {conv.last_message || 'No messages yet'}
                    </p>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold shrink-0 ${
                        String(id) === String(conv.id)
                          ? conv.status === 'active'
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                            : conv.status === 'human_takeover'
                            ? 'bg-orange-50 text-orange-600 border-orange-100'
                            : 'bg-slate-100 text-slate-500 border-slate-100'
                          : STATUS_STYLES[conv.status]
                      }`}
                    >
                      {STATUS_LABELS[conv.status]}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
