import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-700',
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

export default function ConversationList({ conversations, compact = false, initialSearch = '' }) {
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState('all');
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    setSearch(initialSearch || '');
  }, [initialSearch]);

  const searchTerm = search.trim().toLowerCase();
  const filtered = conversations.filter((conversation) => {
    const searchable = `${conversation.customer_name || ''} ${conversation.customer_phone || ''} ${conversation.last_message || ''}`.toLowerCase();
    const matchSearch = !searchTerm || searchable.includes(searchTerm);
    const matchFilter = filter === 'all' || conversation.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col h-full">
      <div className={`${compact ? 'px-3 pb-3' : 'px-5 pt-5 pb-3'} space-y-2 border-b border-gray-100`}>
        <div className="relative">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            placeholder="Search name, phone or latest message..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-full pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:border-transparent"
          />
        </div>
        <div className="flex gap-1">
          {['all', 'active', 'human_takeover', 'resolved'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`flex-1 text-[10px] py-1.5 rounded-full capitalize transition-colors font-medium ${filter === status ? 'bg-[#3535FF] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {status === 'all' ? 'All' : status === 'human_takeover' ? 'Human' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="no-visible-scrollbar flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 text-xs mt-10 px-4">No conversations match your search or filter.</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((conversation) => {
              const isCurrent = String(id) === String(conversation.id);
              return (
                <button
                  key={conversation.id}
                  onClick={() => navigate(`/dashboard/conversations/${conversation.id}`)}
                  className={`w-full text-left p-3 rounded-xl transition-colors ${isCurrent ? 'bg-[#3535FF] text-white' : 'text-gray-900 hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`font-semibold text-xs truncate max-w-[160px] ${isCurrent ? 'text-white' : 'text-gray-900'}`}>
                      {conversation.customer_name || `+${conversation.customer_phone}`}
                    </span>
                    <span className={`text-[10px] ${isCurrent ? 'text-white/70' : 'text-gray-400'}`}>{formatTime(conversation.last_message_at)}</span>
                  </div>
                  {conversation.customer_name && <p className={`text-[10px] mb-1 ${isCurrent ? 'text-white/65' : 'text-gray-400'}`}>+{conversation.customer_phone}</p>}
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[11px] truncate ${isCurrent ? 'text-white/80' : 'text-gray-500'}`}>{conversation.last_message || 'No messages yet'}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${isCurrent ? 'bg-white/20 text-white' : STATUS_STYLES[conversation.status]}`}>
                      {STATUS_LABELS[conversation.status]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
