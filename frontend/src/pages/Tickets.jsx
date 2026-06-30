import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  waiting_customer: 'Pending',
  resolved: 'Closed',
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

const EMPTY_INSTALLATION = {
  customer_name: '',
  customer_phone: '',
  location: '',
  assigned_employee_id: '',
  priority: 'normal',
};

const NOTIFY_LABELS = {
  sent: 'Alert sent',
  skipped: 'Alert skipped',
  failed: 'Alert failed',
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

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${className}`}>{children}</span>;
}

export default function Tickets({ detailMode = false }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [tickets, setTickets] = useState([]);
  const [detail, setDetail] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installationForm, setInstallationForm] = useState(EMPTY_INSTALLATION);
  const [formError, setFormError] = useState('');

  const params = useMemo(() => {
    const query = { status, category, priority };
    if (search.trim()) query.search = search.trim();
    return query;
  }, [status, category, priority, search]);

  const loadTickets = useCallback(async () => {
    if (detailMode) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/tickets', { params });
      setTickets(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [detailMode, params]);

  const loadDetail = useCallback(async () => {
    if (!detailMode || !id) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/tickets/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [detailMode, id]);

  const loadEmployees = useCallback(async () => {
    try {
      const { data } = await api.get('/employees');
      setEmployees(data.filter((employee) => employee.role === 'technician' && employee.is_active));
    } catch (err) {
      setEmployees([]);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const updateTicket = async (patch) => {
    if (!detail?.ticket?.id || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch(`/tickets/${detail.ticket.id}`, patch);
      setDetail((current) => current ? { ...current, ticket: data } : current);
      await loadDetail();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update ticket');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    const body = note.trim();
    if (!body || !detail?.ticket?.id || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/tickets/${detail.ticket.id}/events`, { body });
      setDetail((current) => current ? { ...current, events: data } : current);
      setNote('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  const deleteTicket = async (ticket) => {
    if (!window.confirm(`Delete ticket #${ticket.id}? This cannot be undone.`)) return;
    try {
      await api.delete(`/tickets/${ticket.id}`);
      if (detailMode) navigate('/dashboard/tickets');
      else loadTickets();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete ticket');
    }
  };

  const createInstallation = async () => {
    const payload = {
      ...installationForm,
      customer_name: installationForm.customer_name.trim(),
      customer_phone: installationForm.customer_phone.trim(),
      location: installationForm.location.trim(),
      assigned_employee_id: Number(installationForm.assigned_employee_id),
    };
    if (!payload.customer_name || !payload.customer_phone || !payload.location || !payload.assigned_employee_id) {
      setFormError('Client name, phone number, location and technician are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const { data } = await api.post('/tickets/installations', payload);
      setShowInstallModal(false);
      setInstallationForm(EMPTY_INSTALLATION);
      navigate(`/dashboard/tickets/${data.id}`);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create installation request');
    } finally {
      setSaving(false);
    }
  };

  if (detailMode) {
    const ticket = detail?.ticket;
    return (
      <div className="min-h-full overflow-y-auto bg-[#f5f7fb] px-5 py-6 text-[#354052]">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => navigate('/dashboard/tickets')} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600">Back to tickets</button>
            {ticket && (
              <button onClick={() => deleteTicket(ticket)} className="rounded-full bg-red-50 px-4 py-2 text-xs font-black text-red-600">Delete ticket</button>
            )}
          </div>
          {error && <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
          {loading && <div className="rounded-2xl bg-white px-6 py-10 text-center text-sm font-bold text-slate-400">Opening ticket...</div>}
          {!loading && !ticket && <div className="rounded-2xl bg-white px-6 py-10 text-center text-sm font-bold text-slate-400">Ticket not found.</div>}
          {ticket && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Pill className={PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.normal}>{ticket.priority}</Pill>
                      <Pill className="border-purple-100 bg-purple-50 text-purple-700">{CATEGORY_LABELS[ticket.category] || ticket.category}</Pill>
                      <Pill className="border-slate-100 bg-slate-50 text-slate-600">{STATUS_LABELS[ticket.status] || ticket.status}</Pill>
                    </div>
                    <h3 className="mt-4 text-2xl font-black text-slate-950">{ticket.title}</h3>
                    <p className="mt-2 text-sm text-slate-500">{ticket.summary || ticket.last_message || 'No summary yet'}</p>
                    <div className="mt-5 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                      <div><span className="font-black text-slate-700">Customer:</span> {ticket.customer_name || 'Unknown'}</div>
                      <div><span className="font-black text-slate-700">Phone:</span> +{ticket.customer_phone}</div>
                      <div><span className="font-black text-slate-700">Assigned:</span> {ticket.assigned_employee_name || ticket.assigned_admin_name || 'Unassigned'}</div>
                      <div><span className="font-black text-slate-700">Employee alert:</span> {NOTIFY_LABELS[ticket.assignment_notify_status] || ticket.assignment_notify_status || 'Not sent'}</div>
                      <div><span className="font-black text-slate-700">Client SMS:</span> {NOTIFY_LABELS[ticket.client_alert_sms_status] || ticket.client_alert_sms_status || 'Not sent'}</div>
                      <div><span className="font-black text-slate-700">Source:</span> {ticket.source}</div>
                      <div><span className="font-black text-slate-700">Opened:</span> {formatDate(ticket.opened_at)}</div>
                      <div><span className="font-black text-slate-700">Updated:</span> {formatDate(ticket.updated_at)}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ticket.conversation_id && (
                      <button onClick={() => navigate(`/dashboard/conversations/${ticket.conversation_id}`)} className="rounded-xl bg-[#3535FF] px-4 py-2 text-xs font-black text-white hover:bg-[#2828DD]">
                        Open conversation
                      </button>
                    )}
                    <select value={ticket.status} disabled={saving} onChange={(event) => updateTicket({ status: event.target.value })} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700">
                      {STATUS_OPTIONS.filter(([key]) => !['active', 'all'].includes(key)).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                    </select>
                    <select value={ticket.priority} disabled={saving} onChange={(event) => updateTicket({ priority: event.target.value })} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700">
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
                  <input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addNote(); }} placeholder="Add an internal note..." className="h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#3535FF]" />
                  <button onClick={addNote} disabled={saving || !note.trim()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Add note</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full overflow-y-auto bg-[#f5f7fb] px-5 py-6 text-[#354052]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-xl font-black tracking-normal text-[#394455]">All Support Tickets</h2>
            <p className="mt-1 text-xs font-semibold text-[#aab6c4]">List of ticket opened by Customer</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setShowInstallModal(true)} className="flex h-11 items-center gap-2 rounded-full bg-[#3535FF] px-5 text-sm font-black text-white shadow-lg shadow-indigo-100 hover:bg-[#2828DD]">
              <span className="text-xl leading-none">+</span>
              Add Installation
            </button>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticket, phone, issue..." className="h-11 w-[260px] rounded-full border border-[#dce5ee] bg-white px-5 text-xs font-black text-[#516072] outline-none placeholder:text-[#b4bfcb] focus:border-[#b9c9d8]" />
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
              Open:
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 rounded-full border border-[#d7e1ea] bg-white px-4 text-xs font-black text-[#a1afbf] outline-none">
                <option value="active">Active tickets</option>
                <option value="open">Open only</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_customer">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-xs font-black text-[#aab6c4]">
                  <th className="px-6 pb-2">ID</th>
                  <th className="px-6 pb-2">Requester Name</th>
                  <th className="px-6 pb-2">Subjects</th>
                  <th className="px-6 pb-2">Status</th>
                  <th className="px-6 pb-2">Priority</th>
                  <th className="px-6 pb-2">Assignee</th>
                  <th className="px-6 pb-2">Create Date</th>
                  <th className="px-6 pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan="8" className="bg-white px-6 py-8 text-sm font-bold text-slate-400">Loading tickets...</td></tr>}
                {!loading && tickets.length === 0 && <tr><td colSpan="8" className="bg-white px-6 py-8 text-sm font-bold text-slate-400">No tickets match these filters.</td></tr>}
                {!loading && tickets.map((ticket) => {
                  const requester = ticket.customer_name || `+${ticket.customer_phone}`;
                  return (
                    <tr key={ticket.id} className="bg-white text-sm font-black text-[#394455] shadow-sm transition hover:bg-[#fbfcff]">
                      <td className="px-6 py-5 align-middle">#{ticket.id}</td>
                      <td className="px-6 py-5 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#dbeafe] to-[#f4e8ff] text-xs font-black text-[#394455]">{initials(requester)}</div>
                          <span className="max-w-[180px] truncate">{requester}</span>
                        </div>
                      </td>
                      <td className="max-w-[360px] px-6 py-5 align-middle"><div className="truncate text-sm font-semibold text-[#394455]">{ticket.title || ticket.summary || ticket.last_message || 'No subject'}</div></td>
                      <td className="px-6 py-5 align-middle"><StatusBadge status={ticket.status} /></td>
                      <td className="px-6 py-5 align-middle"><PriorityBadge priority={ticket.priority} /></td>
                      <td className="px-6 py-5 align-middle">{ticket.assigned_employee_name || ticket.assigned_admin_name || 'Unassigned'}</td>
                      <td className="px-6 py-5 align-middle">{formatCreateDate(ticket.opened_at || ticket.created_at)}</td>
                      <td className="px-6 py-5 align-middle">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => navigate(`/dashboard/tickets/${ticket.id}`)} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-black text-[#3535FF] hover:bg-indigo-100">Open</button>
                          <button onClick={() => deleteTicket(ticket)} className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-100">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-6">
              <h3 className="text-lg font-black text-slate-950">Add installation request</h3>
              <p className="mt-1 text-sm font-semibold text-slate-400">Assign the request to a technician. Only that technician receives the SMS.</p>
            </div>
            <div className="space-y-4 p-6">
              {formError && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{formError}</div>}
              <Field label="Name of client" value={installationForm.customer_name} onChange={(value) => setInstallationForm((form) => ({ ...form, customer_name: value }))} placeholder="As registered on the system" />
              <Field label="Phone number / account number" value={installationForm.customer_phone} onChange={(value) => setInstallationForm((form) => ({ ...form, customer_phone: value }))} placeholder="+254..." />
              <Field label="Detailed location" value={installationForm.location} onChange={(value) => setInstallationForm((form) => ({ ...form, location: value }))} placeholder="Estate, building, floor, nearest landmark..." />
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Technician</span>
                <select value={installationForm.assigned_employee_id} onChange={(event) => setInstallationForm((form) => ({ ...form, assigned_employee_id: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                  <option value="">Select technician</option>
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.phone}</option>)}
                </select>
              </label>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setShowInstallModal(false)} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-black text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={createInstallation} disabled={saving} className="flex-1 rounded-full bg-[#3535FF] py-3 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50">
                {saving ? 'Creating...' : 'Create and notify'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-300 focus:border-[#3535FF]" />
    </label>
  );
}
