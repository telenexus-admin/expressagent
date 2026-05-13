import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const STATUS_STYLES = {
  active: 'bg-green-100 text-green-700',
  resolved: 'bg-gray-100 text-gray-500',
  human_takeover: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS = {
  active: 'Active',
  resolved: 'Resolved',
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
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-2">
        <input
          type="text"
          placeholder="Search by phone or message..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <div className="flex gap-1">
          {['all', 'active', 'human_takeover', 'resolved'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`flex-1 text-xs py-1 rounded-md capitalize transition-colors ${
                filter === s
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'All' : s === 'human_takeover' ? 'Human' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 text-xs mt-10 px-4">
            No conversations match your filter.
          </p>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => navigate(`/dashboard/conversations/${conv.id}`)}
              className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                String(id) === String(conv.id)
                  ? 'bg-green-50 border-l-[3px] border-l-green-500'
                  : 'border-l-[3px] border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-semibold text-xs text-gray-900 truncate max-w-[120px]">
                  {conv.customer_phone}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-gray-400">{formatTime(conv.last_message_at)}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[conv.status]}`}
                  >
                    {STATUS_LABELS[conv.status]}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500 truncate">
                {conv.last_message || 'No messages yet'}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
