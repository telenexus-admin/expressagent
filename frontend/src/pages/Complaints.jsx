import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { WarningIcon, CheckCircleIcon, ChartIcon } from '../components/Icons';

const CATEGORY_STYLES = {
  connectivity: 'bg-red-100 text-red-700',
  speed: 'bg-orange-100 text-orange-700',
  billing: 'bg-purple-100 text-purple-700',
  support: 'bg-blue-100 text-blue-700',
  hardware: 'bg-amber-100 text-amber-700',
  other: 'bg-gray-100 text-gray-700',
};

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// trigger_message for complaints is stored as: `[category] original message`
function parseComplaintTrigger(trigger) {
  const result = { category: 'other', original: trigger || '' };
  if (!trigger) return result;
  const m = trigger.match(/^\[([a-z]+)\]\s*(.*)$/i);
  if (m) {
    result.category = m[1].toLowerCase();
    result.original = m[2];
  }
  return result;
}

export default function Complaints() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);

  const fetchItems = async (currentFilter) => {
    try {
      const params = new URLSearchParams({ type: 'complaint' });
      if (currentFilter !== 'all') params.set('status', currentFilter);
      const { data } = await api.get(`/escalations?${params.toString()}`);
      setItems(data);
    } catch (err) {
      console.error('Failed to fetch complaints:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchItems(filter);
    const interval = setInterval(() => fetchItems(filter), 15000);
    return () => clearInterval(interval);
  }, [filter]);

  const resolveOne = async (id) => {
    try {
      await api.patch(`/escalations/${id}/resolve`);
      fetchItems(filter);
    } catch (err) {
      console.error('Failed to resolve complaint:', err.message);
    }
  };

  const openCount = items.filter((e) => !e.resolved_at).length;
  const resolvedCount = items.filter((e) => e.resolved_at).length;
  const totalCount = items.length;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Complaints</h1>
          <p className="text-sm text-gray-500 mt-1">
            Whenever a customer raises an issue, the AI summarises it and stores it here for review.
          </p>
        </div>

        {/* Stat pills */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
              <WarningIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Open</div>
              <div className="text-lg font-bold text-gray-900">{openCount}</div>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <CheckCircleIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Resolved</div>
              <div className="text-lg font-bold text-gray-900">{resolvedCount}</div>
            </div>
          </div>
          <div className="bg-[#3535FF] rounded-2xl px-4 py-3 flex items-center gap-3 text-white">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <ChartIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold">Total</div>
              <div className="text-lg font-bold">{totalCount}</div>
            </div>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-5">
          {['open', 'resolved', 'all'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-4 py-2 rounded-full capitalize transition-colors font-medium ${
                filter === f
                  ? 'bg-[#3535FF] text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-gray-400 text-sm py-12">Loading...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <p className="text-sm text-gray-500">
              {filter === 'open'
                ? 'No open complaints. When a customer raises an issue, the AI will summarise it here.'
                : filter === 'resolved'
                ? 'No resolved complaints yet.'
                : 'No complaints recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((e) => {
              const { category, original } = parseComplaintTrigger(e.trigger_message);
              const catStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.other;
              return (
                <div
                  key={e.id}
                  className={`bg-white rounded-2xl border p-5 transition-shadow hover:shadow-sm ${
                    e.resolved_at ? 'border-gray-100 opacity-75' : 'border-gray-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#3535FF] flex items-center justify-center text-white font-semibold text-sm shrink-0">
                        {(e.customer_name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-sm text-gray-900 truncate">
                            {e.customer_name || 'Unknown customer'}
                          </h3>
                          {e.resolved_at && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                              Resolved
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          +{e.customer_phone} · {formatDateTime(e.created_at)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium shrink-0 capitalize ${catStyle}`}
                    >
                      {category}
                    </span>
                  </div>

                  {e.summary && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
                      <p className="text-[10px] uppercase tracking-wide text-red-500 font-semibold mb-1">
                        AI summary
                      </p>
                      <p className="text-sm text-gray-800">{e.summary}</p>
                    </div>
                  )}

                  {original && (
                    <div className="bg-gray-50 rounded-xl p-3 mb-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                        Customer's message
                      </p>
                      <p className="text-sm text-gray-700">{original}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => navigate(`/dashboard/conversations/${e.conversation_id}`)}
                      className="text-xs text-[#3535FF] hover:text-[#2828DD] font-semibold"
                    >
                      Open conversation →
                    </button>
                    {!e.resolved_at && (
                      <button
                        onClick={() => resolveOne(e.id)}
                        className="ml-auto text-xs text-gray-500 hover:text-gray-700 font-medium"
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
