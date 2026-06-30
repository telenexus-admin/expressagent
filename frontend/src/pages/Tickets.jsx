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
  urgent: 'bg-red-100 text-red-500',
  high: 'bg-slate-200 text-slate-500',
  normal: 'bg-slate-200 text-slate-500',
  low: 'bg-slate-200 text-slate-500',
};

const STATUS_DOT_STYLES = {
  open: 'bg-emerald-500 text-emerald-500',
  in_progress: 'bg-amber-400 text-amber-500',
  waiting_customer: 'bg-amber-400 text-amber-500',
  resolved: 'bg-red-400 text-red-500',
  closed: 'bg-red-400 text-red-500',
};

const NOTIFY_LABELS = {
  sent: 'Alert sent',
  skipped: 'Alert skipped',
  failed: 'Alert failed',
};

const NOTIFY_STYLES = {
  sent: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  skipped: 'border-slate-100 bg-slate-50 text-slate-600',
  failed: 'border-red-100 bg-red-50 text-red-700',
};

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCreateDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'C') + (parts[1]?.[0] || '');
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${className}`}>{children}</span>;
}

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status || 'Open';
  const dot = STATUS_DOT_STYLES[status] || STATUS_DOT_STYLES.open;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-black ${dot.split(' ').slice(1).join(' ')}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${dot.split(' ')[0]}`} />
      {label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const value = priority || 'normal';
  const label = value === 'normal' ? 'Medium' : value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <span className={`inline-flex min-w-[64px] justify-center rounded-md px-3 py-1.5 text-xs font-black ${PRIORITY_STYLES[value] || PRIORITY_STYLES.normal}`}>
      {label}
    </span>
  );
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
    <div className="min-h-full overflow-y-auto bg-[#f5f7fb] px-5 py-6 text-[#354052]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-xl font-black tracking-normal text-[#394455]">All Support Tickets</h2>
            <p className="mt-1 text-xs font-semibold text-[#aab6c4]">List of ticket opened by Customer</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search ticket, phone, issue..."
                className="h-11 w-[260px] rounded-full border border-[#dce5ee] bg-white px-5 text-xs font-black text-[#516072] outline-none placeholder:text-[#b4bfcb] focus:border-[#b9c9d8]"
              />
            </label>
            <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            <Select label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
            <Select label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

        <section>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-black text-[#394455]">
              Latest Tickets <span className="text-[#5f6b7c]">(Showing 01 to {String(Math.min(tickets.length, 8)).padStart(2, '0')} of {tickets.length} Tickets)</span>
            </div>
            <label className="flex items-center gap-3 text-sm font-black text-[#394455]">
              Sort By:
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-11 rounded-full border border-[#d7e1ea] bg-white px-4 text-xs font-black text-[#a1afbf] outline-none"
              >
                <option value="active">Date Created</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting_customer">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-xs font-black text-[#aab6c4]">
                  <th className="px-6 pb-2">ID</th>
                  <th className="px-6 pb-2">Requester Name</th>
                  <th className="px-6 pb-2">Subjects</th>
                  <th className="px-6 pb-2">Status</th>
                  <th className="px-6 pb-2">Priority</th>
                  <th className="px-6 pb-2">Assignee</th>
                  <th className="px-6 pb-2">Create Date</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="7" className="bg-white px-6 py-8 text-sm font-bold text-slate-400">Loading tickets...</td></tr>
                )}
                {!loading && tickets.length === 0 && (
                  <tr><td colSpan="7" className="bg-white px-6 py-8 text-sm font-bold text-slate-400">No tickets match these filters.</td></tr>
                )}
                {!loading && tickets.map((ticket) => {
                  const requester = ticket.customer_name || `+${ticket.customer_phone}`;
                  const active = ticket.id === selectedId;
                  return (
                    <tr
                      key={ticket.id}
                      onClick={() => setSelectedId(ticket.id)}
                      className={`cursor-pointer bg-white text-sm font-black text-[#394455] shadow-sm transition hover:bg-[#fbfcff] ${active ? 'outline outline-2 outline-[#d9ddff]' : ''}`}
                    >
                      <td className="px-6 py-5 align-middle">#{ticket.id}</td>
                      <td className="px-6 py-5 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#dbeafe] to-[#f4e8ff] text-xs font-black text-[#394455]">
                            {initials(requester)}
                          </div>
                          <span className="max-w-[180px] truncate">{requester}</span>
                        </div>
                      </td>
                      <td className="max-w-[360px] px-6 py-5 align-middle">
                        <div className="truncate text-sm font-semibold text-[#394455]">{ticket.title || ticket.summary || ticket.last_message || 'No subject'}</div>
                      </td>
                      <td className="px-6 py-5 align-middle"><StatusBadge status={ticket.status} /></td>
                      <td className="px-6 py-5 align-middle"><PriorityBadge priority={ticket.priority} /></td>
                      <td className="px-6 py-5 align-middle">{ticket.assigned_employee_name || ticket.assigned_admin_name || 'Unassigned'}</td>
                      <td className="px-6 py-5 align-middle">{formatCreateDate(ticket.opened_at || ticket.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 pb-10">
          {!selectedTicket && (
            <div className="rounded-2xl bg-white px-6 py-10 text-center text-sm font-bold text-slate-400">Select a ticket to review it.</div>
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
                      <div><span className="font-black text-slate-700">Assigned:</span> {selectedTicket.assigned_employee_name || selectedTicket.assigned_admin_name || 'Unassigned'}</div>
                      <div><span className="font-black text-slate-700">Employee alert:</span> {NOTIFY_LABELS[selectedTicket.assignment_notify_status] || selectedTicket.assignment_notify_status || 'Not sent'}</div>
                      <div><span className="font-black text-slate-700">Client SMS:</span> {NOTIFY_LABELS[selectedTicket.client_alert_sms_status] || selectedTicket.client_alert_sms_status || 'Not sent'}</div>
                      <div><span className="font-black text-slate-700">Client email:</span> {NOTIFY_LABELS[selectedTicket.client_alert_email_status] || selectedTicket.client_alert_email_status || 'Not sent'}</div>
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
