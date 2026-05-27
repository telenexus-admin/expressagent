import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

const STATUS_OPTIONS = [
  ['active', 'Active'],
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['waiting_customer', 'Waiting customer'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
  ['all', 'All'],
];

const CATEGORY_OPTIONS = [
  ['all', 'All categories'],
  ['technical', 'Technical'],
  ['billing', 'Billing'],
  ['installation', 'Installation'],
  ['complaint', 'Complaint'],
  ['human_support', 'Human support'],
  ['feedback', 'Feedback'],
  ['general', 'General'],
];

const PRIORITY_OPTIONS = [
  ['all', 'All priorities'],
  ['urgent', 'Urgent'],
  ['high', 'High'],
  ['normal', 'Normal'],
  ['low', 'Low'],
];

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

const CATEGORY_LABELS = {
  technical: 'Technical',
  billing: 'Billing',
  installation: 'Installation',
  complaint: 'Complaint',
  human_support: 'Human support',
  feedback: 'Feedback',
  general: 'General',
};

const PRIORITY_STYLES = {
  urgent: 'bg-red-50 text-red-700 border-red-100',
  high: 'bg-orange-50 text-orange-700 border-orange-100',
  normal: 'bg-blue-50 text-blue-700 border-blue-100',
  low: 'bg-slate-50 text-slate-600 border-slate-100',
};

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${className}`}>{children}</span>;
}

function Select({ value, onChange, options, label }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-[11px] font-black uppercase text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
      >
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

export default function Tickets() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const query = { status, category, priority };
    if (search.trim()) query.search = search.trim();
    return query;
  }, [status, category, priority, search]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/tickets', { params });
      setTickets(data);
      setSelectedId((current) => data.some((item) => item.id === current) ? current : data[0]?.id || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [params]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    try {
      const { data } = await api.get(`/tickets/${selectedId}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load ticket');
    }
  }, [selectedId]);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const updateTicket = async (patch) => {
    if (!selectedId || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch(`/tickets/${selectedId}`, patch);
      setDetail((current) => current ? { ...current, ticket: data } : current);
      await loadTickets();
      await loadDetail();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update ticket');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    const body = note.trim();
    if (!body || !selectedId || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/tickets/${selectedId}/events`, { body });
      setDetail((current) => current ? { ...current, events: data } : current);
      setNote('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  const selectedTicket = detail?.ticket || tickets.find((item) => item.id === selectedId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f8fafc]">
      <div className="shrink-0 border-b border-slate-100 bg-white px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Tickets</h2>
            <p className="mt-1 text-sm text-slate-500">Track customer issues from WhatsApp, AI classification and admin follow-up.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            <Select label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
            <Select label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
            <label className="flex min-w-[220px] flex-col gap-1 text-[11px] font-black uppercase text-slate-400">
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Phone, name, issue..."
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
              />
            </label>
          </div>
        </div>
      </div>

      {error && <div className="mx-5 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(320px,440px)_1fr]">
        <section className="min-h-0 overflow-y-auto border-r border-slate-100 bg-white">
          {loading && <div className="p-6 text-sm text-slate-400">Loading tickets...</div>}
          {!loading && tickets.length === 0 && <div className="p-6 text-sm text-slate-400">No tickets match these filters.</div>}
          {tickets.map((ticket) => {
            const active = ticket.id === selectedId;
            return (
              <button
                key={ticket.id}
                onClick={() => setSelectedId(ticket.id)}
                className={`block w-full border-b border-slate-100 px-5 py-4 text-left transition ${active ? 'bg-[#f3f2ff]' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-950">{ticket.title}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{ticket.customer_name || `+${ticket.customer_phone}`}</div>
                  </div>
                  <Pill className={PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.normal}>{ticket.priority}</Pill>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill className="border-purple-100 bg-purple-50 text-purple-700">{CATEGORY_LABELS[ticket.category] || ticket.category}</Pill>
                  <Pill className="border-slate-100 bg-slate-50 text-slate-600">{STATUS_LABELS[ticket.status] || ticket.status}</Pill>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">{ticket.summary || ticket.last_message || 'No summary yet'}</p>
                <div className="mt-3 text-[11px] font-semibold text-slate-400">Updated {formatDate(ticket.updated_at)}</div>
              </button>
            );
          })}
        </section>

        <section className="min-h-0 overflow-y-auto p-5">
          {!selectedTicket && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a ticket to review it.</div>
          )}
          {selectedTicket && (
            <div className="mx-auto max-w-4xl space-y-5">
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Pill className={PRIORITY_STYLES[selectedTicket.priority] || PRIORITY_STYLES.normal}>{selectedTicket.priority}</Pill>
                      <Pill className="border-purple-100 bg-purple-50 text-purple-700">{CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category}</Pill>
                      <Pill className="border-slate-100 bg-slate-50 text-slate-600">{STATUS_LABELS[selectedTicket.status] || selectedTicket.status}</Pill>
                    </div>
                    <h3 className="mt-4 text-2xl font-black text-slate-950">{selectedTicket.title}</h3>
                    <p className="mt-2 text-sm text-slate-500">{selectedTicket.summary || selectedTicket.last_message || 'No summary yet'}</p>
                    <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                      <div><span className="font-black text-slate-700">Customer:</span> {selectedTicket.customer_name || 'Unknown'}</div>
                      <div><span className="font-black text-slate-700">Phone:</span> +{selectedTicket.customer_phone}</div>
                      <div><span className="font-black text-slate-700">Source:</span> {selectedTicket.source}</div>
                      <div><span className="font-black text-slate-700">Opened:</span> {formatDate(selectedTicket.opened_at)}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTicket.conversation_id && (
                      <button
                        onClick={() => navigate(`/dashboard/conversations/${selectedTicket.conversation_id}`)}
                        className="rounded-xl bg-[#3535FF] px-4 py-2 text-xs font-black text-white hover:bg-[#2828DD]"
                      >
                        Open conversation
                      </button>
                    )}
                    <select
                      value={selectedTicket.status}
                      disabled={saving}
                      onChange={(event) => updateTicket({ status: event.target.value })}
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700"
                    >
                      {STATUS_OPTIONS.filter(([key]) => !['active', 'all'].includes(key)).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                    </select>
                    <select
                      value={selectedTicket.priority}
                      disabled={saving}
                      onChange={(event) => updateTicket({ priority: event.target.value })}
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700"
                    >
                      {PRIORITY_OPTIONS.filter(([key]) => key !== 'all').map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <h4 className="text-sm font-black text-slate-950">Activity</h4>
                <div className="mt-4 space-y-3">
                  {(detail?.events || []).map((event) => (
                    <div key={event.id} className="rounded-xl bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-black uppercase text-slate-400">
                        <span>{event.event_type.replace('_', ' ')}</span>
                        <span>{formatDate(event.created_at)}</span>
                      </div>
                      {event.actor_name && <div className="mt-1 text-xs font-bold text-slate-600">{event.actor_name}</div>}
                      {event.body && <p className="mt-2 text-sm leading-relaxed text-slate-700">{event.body}</p>}
                    </div>
                  ))}
                  {detail && detail.events.length === 0 && <div className="text-sm text-slate-400">No activity yet.</div>}
                </div>
                <div className="mt-4 flex gap-2">
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addNote();
                    }}
                    placeholder="Add an internal note..."
                    className="h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#3535FF]"
                  />
                  <button
                    onClick={addNote}
                    disabled={saving || !note.trim()}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                  >
                    Add note
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
