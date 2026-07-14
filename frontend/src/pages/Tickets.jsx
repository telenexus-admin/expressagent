import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../utils/api';
import { ActivityIcon, CheckCircleIcon, TicketIcon } from '../components/Icons';

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
  ['manually_added', 'Manually added'],
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
  manually_added: 'Manually added',
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

const EMPTY_TICKET = {
  customer_name: '',
  customer_phone: '',
  title: '',
  summary: '',
  category: 'manually_added',
  priority: 'normal',
  assigned_employee_id: '',
};

const NOTIFY_LABELS = {
  sent: 'Alert sent',
  skipped: 'Alert skipped',
  failed: 'Alert failed',
};

function SearchIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SortIcon({ className = 'h-3 w-3' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 7 4-4 4 4" />
      <path d="M12 3v18" />
      <path d="m16 17-4 4-4-4" />
    </svg>
  );
}

function GridIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function ListIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function CalendarIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function MonitorIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M8 21h8M12 16v5" />
    </svg>
  );
}

function HeadsetIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13a8 8 0 0 1 16 0" />
      <path d="M4 13v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2ZM20 13v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z" />
      <path d="M15 20h-3" />
    </svg>
  );
}

function HourglassIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12M6 21h12M8 3v4a4 4 0 0 0 2 3.46L12 12l2-1.54A4 4 0 0 0 16 7V3M16 21v-4a4 4 0 0 0-2-3.46L12 12l-2 1.54A4 4 0 0 0 8 17v4" />
    </svg>
  );
}

function TimerIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v5l3 2M9 2h6M12 2v3" />
    </svg>
  );
}

function OpenIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function TrashIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function SparkLine({ color = '#6d6cfb' }) {
  return (
    <svg viewBox="0 0 72 24" className="h-7 w-16" fill="none">
      <path d="M2 18c8 0 8-2 15-2s8 5 16 5 9-13 18-13 10 3 19-5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCreateDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function pct(value, total) {
  if (!total) return '0.0% of total';
  return `${((Number(value || 0) / Number(total || 1)) * 100).toFixed(1)}% of total`;
}

function formatDuration(seconds) {
  const totalSeconds = Number(seconds || 0);
  if (!totalSeconds) return '--';
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function initials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'C') + (parts[1]?.[0] || '');
}

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status || 'Open';
  const dot = STATUS_DOT_STYLES[status] || STATUS_DOT_STYLES.open;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${dot.split(' ').slice(1).join(' ')} ${status === 'open' ? 'bg-emerald-50' : status === 'resolved' || status === 'closed' ? 'bg-red-50' : 'bg-amber-50'}`}>
      <span className={`h-2 w-2 rounded-full ${dot.split(' ')[0]}`} />
      {label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const value = priority || 'normal';
  const label = value === 'normal' ? 'Medium' : value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <span className={`inline-flex min-w-[64px] items-center justify-center gap-1 rounded-full px-3 py-1.5 text-xs font-black ${PRIORITY_STYLES[value] || PRIORITY_STYLES.normal}`}>
      {label}
      {['urgent', 'high'].includes(value) && <span className="text-[10px]">^</span>}
    </span>
  );
}

function Select({ value, onChange, options, label }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1.5 text-[10px] font-black text-[#6d7891]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl border border-[#e1e8f5] bg-white px-3 text-xs font-black normal-case text-[#17264d] shadow-[0_10px_25px_rgba(41,57,95,0.06)] outline-none focus:border-[#5b5bff]"
      >
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

function MetricCard({ title, value, subtitle, Icon, iconClass, lineColor }) {
  return (
    <div className="flex min-h-[92px] items-center justify-between rounded-2xl border border-[#e7edf8] bg-white px-4 shadow-[0_16px_36px_rgba(33,51,88,0.08)]">
      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[11px] font-black text-[#64708c]">{title}</div>
          <div className="mt-1 text-2xl font-black leading-none text-[#17264d]">{value}</div>
          <div className="mt-2 text-[11px] font-bold text-[#9aa7bb]">{subtitle}</div>
        </div>
      </div>
      <SparkLine color={lineColor} />
    </div>
  );
}

function TicketSubjectIcon({ ticket }) {
  const SubjectIcon = ticket.category === 'human_support' ? HeadsetIcon : MonitorIcon;
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${ticket.category === 'human_support' ? 'bg-emerald-50 text-emerald-500' : 'bg-blue-50 text-blue-500'}`}>
      <SubjectIcon className="h-4 w-4" />
    </span>
  );
}

function UserMiniIcon() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f6fb] text-[#7c8aa5]">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
    </span>
  );
}

function TicketActions({ ticket, onOpen, onDelete }) {
  return (
    <div className="flex justify-end gap-2">
      <button onClick={() => onOpen(ticket)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e4e9f4] bg-white text-[#4538ff] shadow-sm hover:bg-[#f6f7ff]" title="Open ticket">
        <OpenIcon />
      </button>
      <button onClick={() => onDelete(ticket)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e4e9f4] bg-white text-[#ef4056] shadow-sm hover:bg-red-50" title="Delete ticket">
        <TrashIcon />
      </button>
    </div>
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
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketForm, setTicketForm] = useState(EMPTY_TICKET);
  const [formError, setFormError] = useState('');
  const [summary, setSummary] = useState({ active: 0, open: 0, priority: 0, closed: 0, avg_resolution_seconds: 0 });
  const [viewMode, setViewMode] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 'grid' : 'list'));

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

  const loadSummary = useCallback(async () => {
    if (detailMode) return;
    try {
      const { data } = await api.get('/tickets/summary');
      setSummary(data || {});
    } catch (err) {
      setSummary({ active: 0, open: 0, priority: 0, closed: 0, avg_resolution_seconds: 0 });
    }
  }, [detailMode]);

  const loadEmployees = useCallback(async () => {
    try {
      const { data } = await api.get('/employees');
      setEmployees(Array.isArray(data) ? data.filter((employee) => employee.is_active) : []);
    } catch (err) {
      setEmployees([]);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { if (!detailMode) loadEmployees(); }, [detailMode, loadEmployees]);

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

  const openTicket = (ticket) => navigate(`/dashboard/tickets/${ticket.id}`);

  const createTicket = async () => {
    const payload = {
      ...ticketForm,
      customer_name: ticketForm.customer_name.trim(),
      customer_phone: ticketForm.customer_phone.trim(),
      title: ticketForm.title.trim(),
      summary: ticketForm.summary.trim(),
      assigned_employee_id: ticketForm.assigned_employee_id ? Number(ticketForm.assigned_employee_id) : null,
    };
    if (!payload.customer_phone || !payload.title || !payload.assigned_employee_id) {
      setFormError('Phone number, ticket subject and assignee are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const { data } = await api.post('/tickets', payload);
      setShowTicketModal(false);
      setTicketForm(EMPTY_TICKET);
      await loadSummary();
      navigate(`/dashboard/tickets/${data.id}`);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create ticket');
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
     …500 tokens truncated…   </div>
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

  const totalTickets = Math.max(Number(summary.active || 0) + Number(summary.closed || 0), tickets.length);
  const openTickets = Number(summary.open || 0);
  const progressTickets = tickets.filter((ticket) => ticket.status === 'in_progress' || ticket.status === 'waiting_customer').length;
  const resolvedTickets = Number(summary.closed || 0);
  const avgResolutionTime = formatDuration(summary.avg_resolution_seconds);

  return (
    <div className="min-h-full overflow-y-auto overflow-x-hidden bg-[#f7f9fe] px-3 py-4 text-[#17264d]">
      <div className="mx-auto w-full max-w-full">
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <MetricCard title="Total Tickets" value={totalTickets} subtitle="All time" Icon={TicketIcon} iconClass="bg-[#eef3ff] text-[#315dff]" lineColor="#7890ff" />
          <MetricCard title="Open Tickets" value={openTickets} subtitle={pct(openTickets, totalTickets)} Icon={ActivityIcon} iconClass="bg-[#eafff6] text-[#17c98f]" lineColor="#38cfa1" />
          <MetricCard title="In Progress" value={progressTickets} subtitle={pct(progressTickets, totalTickets)} Icon={HourglassIcon} iconClass="bg-[#fff4df] text-[#ffa51e]" lineColor="#ffb43c" />
          <MetricCard title="Resolved" value={resolvedTickets} subtitle={pct(resolvedTickets, totalTickets)} Icon={CheckCircleIcon} iconClass="bg-[#f4edff] text-[#6f43ff]" lineColor="#8b6cff" />
          <MetricCard title="Avg. Resolution Time" value={avgResolutionTime} subtitle={avgResolutionTime === '--' ? 'No resolved tickets yet' : 'Resolved tickets'} Icon={TimerIcon} iconClass="bg-[#fff0f1] text-[#ff4d6a]" lineColor="#ff7d93" />
        </div>

        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <button onClick={() => { setTicketForm(EMPTY_TICKET); setFormError(''); setShowTicketModal(true); }} className="flex h-12 w-fit items-center gap-3 rounded-xl bg-gradient-to-r from-[#2f72ff] to-[#8028ff] px-6 text-sm font-black text-white shadow-[0_14px_28px_rgba(73,85,255,0.26)] hover:brightness-105">
            <span className="text-xl leading-none">+</span>
            Add Ticket
          </button>

          <div className="flex flex-1 flex-wrap items-end gap-3 xl:justify-end">
            <label className="flex min-w-[260px] flex-1 flex-col gap-1.5 text-[10px] font-black text-[#6d7891] xl:max-w-[330px]">
              <span className="opacity-0">Search</span>
              <span className="flex h-11 items-center gap-3 rounded-xl border border-[#e1e8f5] bg-white px-4 shadow-[0_10px_25px_rgba(41,57,95,0.06)]">
                <SearchIcon className="h-4 w-4 text-[#8794ad]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticket, phone, issue..." className="min-w-0 flex-1 bg-transparent text-xs font-black text-[#17264d] outline-none placeholder:text-[#9aa7bb]" />
                <span className="rounded-md bg-[#f2f5fb] px-2 py-1 text-[10px] font-black text-[#8c98af]">Ctrl K</span>
              </span>
            </label>
            <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            <Select label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
            <Select label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
            <div className="flex flex-col gap-1.5 text-[10px] font-black text-[#6d7891]">
              View
              <div className="flex h-11 items-center gap-1 rounded-xl border border-[#e1e8f5] bg-white p-1 shadow-[0_10px_25px_rgba(41,57,95,0.06)]">
                <button onClick={() => setViewMode('list')} className={`flex h-8 w-10 items-center justify-center rounded-lg ${viewMode === 'list' ? 'bg-[#eef2ff] text-[#4538ff]' : 'text-[#7e8aa2]'}`} title="List view"><ListIcon /></button>
                <button onClick={() => setViewMode('grid')} className={`flex h-8 w-10 items-center justify-center rounded-lg ${viewMode === 'grid' ? 'bg-[#eef2ff] text-[#4538ff]' : 'text-[#7e8aa2]'}`} title="Grid view"><GridIcon /></button>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

        <section className="rounded-3xl border border-[#e5ecf8] bg-white p-4 shadow-[0_18px_45px_rgba(31,45,78,0.08)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black text-[#17264d]">Latest Tickets</h2>
              <span className="rounded-full bg-[#eef2ff] px-3 py-1 text-xs font-black text-[#4538ff]">{Math.min(tickets.length, 8)} of {totalTickets || tickets.length}</span>
            </div>
          </div>

          {viewMode === 'list' ? (
          <div className="w-full overflow-hidden">
            <table className="w-full table-fixed border-separate border-spacing-0">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[18%]" />
                <col className="w-[25%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[11px] font-black text-[#8fa0bb]">
                  <th className="border-b border-[#ecf1f8] px-2 py-3">ID <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3">Requester <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3">Subject <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3">Status <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3">Priority <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3">Assignee <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3">Date <SortIcon className="ml-1 inline h-3 w-3" /></th>
                  <th className="border-b border-[#ecf1f8] px-2 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan="8" className="bg-white px-6 py-8 text-sm font-bold text-slate-400">Loading tickets...</td></tr>}
                {!loading && tickets.length === 0 && <tr><td colSpan="8" className="bg-white px-6 py-8 text-sm font-bold text-slate-400">No tickets match these filters.</td></tr>}
                {!loading && tickets.map((ticket) => {
                  const requester = ticket.customer_name || `+${ticket.customer_phone}`;
                  return (
                    <tr key={ticket.id} className="group text-sm font-black text-[#17264d] transition hover:bg-[#fbfcff]">
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle text-base">#{ticket.id}</td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0eaff] text-xs font-black text-[#4538ff]">{initials(requester)}</div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-[#17264d]">{requester}</div>
                            <div className="mt-1 text-xs font-bold text-[#9aa7bb]">{ticket.customer_name ? 'Customer' : 'Phone'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          <TicketSubjectIcon ticket={ticket} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-[#17264d]">{ticket.title || ticket.summary || ticket.last_message || 'No subject'}</div>
                            <div className="mt-1 truncate text-xs font-bold text-[#9aa7bb]">{CATEGORY_LABELS[ticket.category] || ticket.category} #{String(ticket.id).padStart(4, '0')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle"><StatusBadge status={ticket.status} /></td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle"><PriorityBadge priority={ticket.priority} /></td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          <UserMiniIcon />
                          <span className="truncate text-xs font-black text-[#52617d]">{ticket.assigned_employee_name || ticket.assigned_admin_name || 'Unassigned'}</span>
                        </div>
                      </td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4 text-[#7c8aa5]" />
                          <div className="min-w-0">
                            <div className="text-xs font-black text-[#52617d]">{formatCreateDate(ticket.opened_at || ticket.created_at)}</div>
                            <div className="mt-1 text-[11px] font-bold text-[#9aa7bb]">{formatDate(ticket.opened_at || ticket.created_at).split(',').pop()?.trim()}</div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-[#edf2f8] px-2 py-3 align-middle">
                        <TicketActions ticket={ticket} onOpen={openTicket} onDelete={deleteTicket} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {loading && <div className="rounded-2xl border border-[#edf2f8] bg-white p-5 text-sm font-bold text-slate-400">Loading tickets...</div>}
              {!loading && tickets.length === 0 && <div className="rounded-2xl border border-[#edf2f8] bg-white p-5 text-sm font-bold text-slate-400">No tickets match these filters.</div>}
              {!loading && tickets.map((ticket) => {
                const requester = ticket.customer_name || `+${ticket.customer_phone}`;
                return (
                  <article key={ticket.id} className="rounded-2xl border border-[#e8eef8] bg-white p-4 shadow-[0_10px_24px_rgba(31,45,78,0.06)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f0eaff] text-xs font-black text-[#4538ff]">{initials(requester)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-[#17264d]">{requester}</div>
                          <div className="text-xs font-bold text-[#9aa7bb]">Ticket #{ticket.id}</div>
                        </div>
                      </div>
                      <TicketActions ticket={ticket} onOpen={openTicket} onDelete={deleteTicket} />
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <TicketSubjectIcon ticket={ticket} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-[#17264d]">{ticket.title || ticket.summary || ticket.last_message || 'No subject'}</div>
                        <div className="mt-1 text-xs font-bold text-[#9aa7bb]">{CATEGORY_LABELS[ticket.category] || ticket.category}</div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <StatusBadge status={ticket.status} />
                      <PriorityBadge priority={ticket.priority} />
                    </div>
                    <div className="mt-4 grid gap-2 text-xs font-bold text-[#52617d]">
                      <div className="flex items-center gap-2"><UserMiniIcon /> {ticket.assigned_employee_name || ticket.assigned_admin_name || 'Unassigned'}</div>
                      <div className="flex items-center gap-2"><CalendarIcon className="h-4 w-4 text-[#7c8aa5]" /> {formatCreateDate(ticket.opened_at || ticket.created_at)}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {showTicketModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-3 sm:p-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="shrink-0 border-b border-slate-100 p-5 sm:p-6">
              <h3 className="text-lg font-black text-slate-950">Add manual ticket</h3>
              <p className="mt-1 text-sm font-semibold text-slate-400">Create a support ticket from a call, walk-in request, or internal note.</p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
              {formError && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{formError}</div>}
              <Field label="Requester name" value={ticketForm.customer_name} onChange={(value) => setTicketForm((form) => ({ ...form, customer_name: value }))} placeholder="Customer or requester name" />
              <Field label="Phone number / account number" value={ticketForm.customer_phone} onChange={(value) => setTicketForm((form) => ({ ...form, customer_phone: value }))} placeholder="+254..." />
              <Field label="Ticket subject" value={ticketForm.title} onChange={(value) => setTicketForm((form) => ({ ...form, title: value }))} placeholder="What needs attention?" />
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Category</span>
                <select value={ticketForm.category} onChange={(event) => setTicketForm((form) => ({ ...form, category: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                  {CATEGORY_OPTIONS.filter(([key]) => key !== 'all').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Priority</span>
                <select value={ticketForm.priority} onChange={(event) => setTicketForm((form) => ({ ...form, priority: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                  {PRIORITY_OPTIONS.filter(([key]) => key !== 'all').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Assign to</span>
                <select value={ticketForm.assigned_employee_id} onChange={(event) => setTicketForm((form) => ({ ...form, assigned_employee_id: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                  <option value="">Select employee to notify</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} - {employee.role || 'team'}{employee.phone ? ` - ${employee.phone}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <TextArea label="Details" value={ticketForm.summary} onChange={(value) => setTicketForm((form) => ({ ...form, summary: value }))} placeholder="Describe the issue, promise made, or next action..." />
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-white p-5 sm:flex sm:gap-3 sm:px-6 sm:pb-6">
              <button onClick={() => setShowTicketModal(false)} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-black text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={createTicket} disabled={saving} className="mt-3 flex-1 rounded-full bg-[#3535FF] py-3 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50 sm:mt-0">
                {saving ? 'Saving...' : 'Save and notify'}
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

function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-300 focus:border-[#3535FF]" />
    </label>
  );
}
