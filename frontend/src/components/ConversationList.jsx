import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function initials(conversation) {
  const name = conversation.customer_name || '';
  if (!name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '').concat(parts[1]?.[0] || '').toUpperCase().slice(0, 2);
}

function SearchIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 21-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
    </svg>
  );
}

function ChatIcon({ className = 'h-6 w-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.42-4.03 8-9 8a9.86 9.86 0 0 1-4.25-.95L3 20l1.39-3.72A7.35 7.35 0 0 1 3 12c0-4.42 4.03-8 9-8s9 3.58 9 8Z" />
    </svg>
  );
}

function ClockIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function UserIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
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

  const filters = [
    ['all', 'All', ChatIcon],
    ['active', 'Active', ClockIcon],
    ['human_takeover', 'Human', UserIcon],
  ];

  return (
    <div className={`conversation-panel flex h-full flex-col ${compact ? 'p-3' : 'p-6'}`}>
      {!compact && (
        <div className="mb-5 flex items-center gap-4">
          <span className="conversation-hero-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-[#d9d8ff] bg-[#f5f2ff] text-[#5e35ff] shadow-[0_10px_22px_rgba(84,72,190,0.11)]">
            <ChatIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold text-[#0d1438] dashboard-brand-title">
              {conversations.length} total conversations
            </h2>
            <p className="mt-1 text-sm font-medium text-[#6c7699] dashboard-muted">All customer interactions in one place.</p>
          </div>
        </div>
      )}

      <div className={`${compact ? 'mb-3' : 'mb-5'} flex items-center gap-3`}>
        <div className="conversation-search flex h-12 flex-1 items-center gap-3 rounded-2xl border border-[#dfe5f2] bg-white px-4">
          <SearchIcon className="h-5 w-5 shrink-0 text-[#253150]" />
          <input
            type="text"
            placeholder="Search name, phone or latest message..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-xs font-medium text-[#263150] outline-none placeholder:text-[#8b94b8]"
          />
        </div>
        {!compact && (
          <button className="conversation-filter flex h-12 w-14 items-center justify-center rounded-2xl border border-[#dfe5f2] bg-white text-[#253150]">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />
            </svg>
          </button>
        )}
      </div>

      <div className={`${compact ? 'mb-3 grid grid-cols-3 gap-2' : 'mb-5 grid grid-cols-3 gap-4'}`}>
        {filters.map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`conversation-filter-tab flex ${compact ? 'h-10 rounded-xl text-xs' : 'h-12 rounded-2xl text-sm'} items-center justify-center gap-2 border font-medium transition ${
              filter === value
                ? 'border-transparent bg-gradient-to-r from-[#2f5bff] to-[#8b25ff] text-white shadow-[0_12px_24px_rgba(98,52,245,0.22)]'
                : 'border-[#dfe5f2] bg-white text-[#475274] hover:bg-[#f7f8fc]'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="no-visible-scrollbar flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="mt-10 px-4 text-center text-sm font-semibold text-[#8b94b8]">No conversations match your search or filter.</p>
        ) : (
          <div className="conversation-list overflow-hidden rounded-[18px] border border-[#dfe5f2] bg-white">
            {filtered.map((conversation) => {
              const isCurrent = String(id) === String(conversation.id);
              return (
                <button
                  key={conversation.id}
                  onClick={() => navigate(`/dashboard/conversations/${conversation.id}`)}
                  className={`conversation-row group grid w-full ${compact ? 'grid-cols-[46px_minmax(0,1fr)_auto_14px] gap-2 px-3 py-2.5' : 'grid-cols-[72px_220px_minmax(0,1fr)_110px_24px] gap-4 px-6 py-3.5'} items-center border-b border-[#e5eaf4] text-left transition last:border-b-0 ${isCurrent ? 'bg-[#f5f2ff]' : 'hover:bg-[#fbfcff]'}`}
                >
                  <span className={`${compact ? 'h-10 w-10 text-xs' : 'h-14 w-14 text-base'} relative flex items-center justify-center rounded-full border border-[#d7d7ff] bg-[#f6f3ff] font-semibold text-[#4f35f5]`}>
                    {initials(conversation)}
                    <span className="absolute -right-0.5 bottom-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                  </span>
                  <span className="min-w-0">
                    <span className={`${compact ? 'text-sm' : 'text-base'} block truncate font-bold text-[#0d1438] dashboard-brand-title`}>{conversation.customer_name || '-'}</span>
                    <span className="mt-1 block truncate text-sm font-medium text-[#5d6a92] dashboard-muted">+{conversation.customer_phone}</span>
                    {compact && <span className="mt-1 block truncate text-xs font-medium text-[#4f5d84] dashboard-muted">{conversation.last_message || 'No messages yet'}</span>}
                  </span>
                  {!compact && <span className="min-w-0 truncate text-sm font-medium leading-6 text-[#4f5d84] dashboard-muted">
                    {conversation.last_message || 'No messages yet'}
                  </span>}
                  {compact && <span className="conversation-time text-[10px] font-bold text-[#8792ad] dashboard-muted">{formatTime(conversation.last_message_at)}</span>}
                  {!compact && <span className="text-right text-sm font-medium text-[#58658b] dashboard-muted">{formatTime(conversation.last_message_at)}</span>}
                  <span className="text-2xl font-light text-[#7c35ff] transition group-hover:translate-x-1">&rsaquo;</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
