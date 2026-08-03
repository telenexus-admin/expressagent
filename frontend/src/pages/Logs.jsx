import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import {
  ActivityIcon,
  AgentIcon,
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  CloseIcon,
  CogIcon,
  PulseIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  TicketIcon,
  UsersIcon,
  WarningIcon,
} from '../components/Icons';

const MODULE_META = {
  conversations: { label: 'Conversations', icon: ChatIcon, tone: 'blue' },
  tickets: { label: 'Tickets', icon: TicketIcon, tone: 'emerald' },
  invoices: { label: 'Invoices', icon: ChartIcon, tone: 'violet' },
  network: { label: 'Network', icon: PulseIcon, tone: 'amber' },
  security: { label: 'Security', icon: ShieldIcon, tone: 'red' },
  ai_tasks: { label: 'AI Tasks', icon: AgentIcon, tone: 'purple' },
  employees: { label: 'Employees', icon: UsersIcon, tone: 'indigo' },
  admins: { label: 'Admins', icon: UsersIcon, tone: 'indigo' },
  settings: { label: 'Settings', icon: CogIcon, tone: 'slate' },
  system: { label: 'System', icon: ActivityIcon, tone: 'slate' },
};

const SEVERITY_STYLES = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  info: 'bg-blue-50 text-blue-700 border-blue-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  critical: 'bg-red-50 text-red-700 border-red-100',
  failed: 'bg-red-50 text-red-700 border-red-100',
};

const ACTOR_META = {
  admin: { label: 'Admin', icon: UsersIcon, color: 'text-[#4B16B5]', bg: 'bg-[#F0EAFF]' },
  ai: { label: 'AI Agent', icon: AgentIcon, color: 'text-blue-700', bg: 'bg-blue-50' },
  system: { label: 'System', icon: CogIcon, color: 'text-slate-700', bg: 'bg-slate-100' },
  customer: { label: 'Customer', icon: ChatIcon, color: 'text-emerald-700', bg: 'bg-emerald-50' },
};

function labelize(value) {
  return String(value || 'event')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value) {
  if (!value) return 'Unknown time';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fullTime(value) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString();
}

function moduleMeta(moduleName) {
  return MODULE_META[moduleName] || { label: labelize(moduleName), icon: ActivityIcon, tone: 'slate' };
}

function toneClasses(tone) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    purple: 'bg-[#F0EAFF] text-[#4B16B5] border-purple-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return tones[tone] || tones.slate;
}

function actorMeta(actorType) {
  return ACTOR_META[actorType] || ACTOR_META.system;
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata;
}

function SummaryCard({ icon: Icon, label, value, helper, tone = 'purple', active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white border rounded-[22px] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#6D35FF]/30 ${
        active ? 'border-[#6D35FF] ring-2 ring-[#6D35FF]/15' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${toneClasses(tone)}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="h-7 w-20 rounded-full bg-gradient-to-r from-transparent via-slate-100 to-transparent" />
      </div>
      <div className="mt-4 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-black text-slate-950">{Number(value || 0).toLocaleString()}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{helper}</div>
    </button>
  );
}

function EventRow({ event, selected, onClick }) {
  const mod = moduleMeta(event.module);
  const actor = actorMeta(event.actor_type);
  const ModuleIcon = mod.icon;
  const ActorIcon = actor.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 transition border-b border-slate-100 hover:bg-[#fbfaff] ${selected ? 'bg-[#f7f2ff]' : 'bg-white'}`}
    >
      <div className="grid grid-cols-[42px_minmax(0,1fr)_120px_110px_34px] max-lg:grid-cols-[42px_minmax(0,1fr)_34px] gap-3 items-center">
        <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center ${toneClasses(mod.tone)}`}>
          <ModuleIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-slate-950 truncate">{event.title || labelize(event.action)}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-black ${SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info}`}>
              {labelize(event.severity)}
            </span>
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-500 truncate">{event.description || 'No extra description captured.'}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
            <span className={`inline-flex items-center gap-1 ${actor.color}`}>
              <span className={`w-5 h-5 rounded-lg flex items-center justify-center ${actor.bg}`}>
                <ActorIcon className="w-3 h-3" />
              </span>
              {event.actor_name || actor.label}
            </span>
            {event.target_phone && <span>{event.target_phone}</span>}
            {event.entity_id && <span>{labelize(event.entity_type)} #{event.entity_id}</span>}
          </div>
        </div>
        <div className="max-lg:hidden">
          <span className={`inline-flex px-3 py-1 rounded-full border text-[11px] font-black ${toneClasses(mod.tone)}`}>
            {mod.label}
          </span>
        </div>
        <div className="max-lg:hidden text-xs font-bold text-slate-400">{formatTime(event.created_at)}</div>
        <div className="w-8 h-8 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400">
          <ArrowRightIcon className="w-4 h-4" />
        </div>
      </div>
    </button>
  );
}

function DetailsDrawer({ event, onClose }) {
  if (!event) return null;
  const metadata = safeMetadata(event.metadata);
  const mod = moduleMeta(event.module);
  const ModIcon = mod.icon;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/25 backdrop-blur-sm">
      <button type="button" aria-label="Close audit details" className="flex-1" onClick={onClose} />
      <aside className="w-full max-w-xl bg-white h-full shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${toneClasses(mod.tone)}`}>
              <ModIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{mod.label}</div>
              <h2 className="text-xl font-black text-slate-950">Audit Details</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-11 h-11 rounded-2xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className={`inline-flex px-3 py-1 rounded-full border text-xs font-black ${SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info}`}>
              {labelize(event.severity)}
            </div>
            <h3 className="mt-3 text-2xl font-black text-slate-950">{event.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 whitespace-pre-wrap">{event.description || 'No description was captured for this event.'}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              ['Actor', event.actor_name || labelize(event.actor_type)],
              ['Actor type', labelize(event.actor_type)],
              ['When', fullTime(event.created_at)],
              ['Action', labelize(event.action)],
              ['Target', event.target_name || event.target_phone || 'Not captured'],
              ['Entity', event.entity_id ? `${labelize(event.entity_type)} #${event.entity_id}` : labelize(event.entity_type || 'system')],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
                <div className="mt-1 text-sm font-black text-slate-900 break-words">{value}</div>
              </div>
            ))}
          </div>

          {(event.ip_address || event.user_agent) && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-black text-slate-950">Device Context</div>
              {event.ip_address && <div className="mt-2 text-xs font-semibold text-slate-500">IP: {event.ip_address}</div>}
              {event.user_agent && <div className="mt-1 text-xs font-semibold text-slate-500 break-words">Device: {event.user_agent}</div>}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-black text-slate-950">Raw Metadata</div>
            <pre className="p-4 text-xs leading-5 text-slate-600 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(metadata, null, 2)}</pre>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function Logs() {
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ modules: [], actors: [], severities: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [quickFilter, setQuickFilter] = useState('all');
  const [query, setQuery] = useState({
    search: '',
    actor: 'all',
    module: 'all',
    severity: 'all',
  });

  const fetchLogs = async () => {
    try {
      setRefreshing(true);
      const params = new URLSearchParams({ limit: '220' });
      Object.entries(query).forEach(([key, value]) => {
        if (value && value !== 'all') params.set(key, value);
      });
      const { data } = await api.get(`/activity?${params.toString()}`);
      const nextEvents = Array.isArray(data) ? data : (data.events || []);
      setEvents(nextEvents);
      setSummary(data.summary || {});
      setFilters(data.filters || { modules: [], actors: [], severities: [] });
      setLastRefreshedAt(new Date());
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit trail');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 180000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.actor, query.module, query.severity]);

  const searchedEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const search = query.search.trim().toLowerCase();
    return events.filter((event) => {
      if (quickFilter === 'today' && new Date(event.created_at) < today) return false;
      if (quickFilter === 'admin' && event.actor_type !== 'admin') return false;
      if (quickFilter === 'ai' && event.actor_type !== 'ai') return false;
      if (quickFilter === 'failed' && !['failed', 'critical'].includes(event.severity)) return false;
      if (quickFilter === 'security' && event.module !== 'security') return false;
      if (!search) return true;
      return [
      event.title,
      event.description,
      event.actor_name,
      event.actor_email,
      event.target_name,
      event.target_phone,
      event.action,
      event.module,
      JSON.stringify(event.metadata || {}),
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [events, query.search, quickFilter]);

  const applySummaryFilter = (filterName) => {
    setQuickFilter((current) => (current === filterName ? 'all' : filterName));
    if (filterName === 'admin') setQuery((current) => ({ ...current, actor: current.actor === 'admin' ? 'all' : 'admin' }));
    else if (filterName === 'ai') setQuery((current) => ({ ...current, actor: current.actor === 'ai' ? 'all' : 'ai' }));
    else if (filterName === 'security') setQuery((current) => ({ ...current, module: current.module === 'security' ? 'all' : 'security' }));
    else if (filterName === 'failed') setQuery((current) => ({ ...current, severity: 'all' }));
    else setQuery((current) => ({ ...current, actor: 'all', module: 'all', severity: 'all' }));
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading audit trail...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f5f7fb] p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-[#315CFF] to-[#8A20FF] text-white flex items-center justify-center shadow-lg shadow-purple-200">
                <ShieldIcon className="w-8 h-8" />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#4B16B5]">Owner control center</div>
                <h1 className="text-3xl sm:text-4xl font-black text-slate-950 tracking-tight">Audit Trail</h1>
                <p className="mt-1 text-sm font-semibold text-slate-500 max-w-3xl">
                  See who did what, what the AI handled, which customers were served, and which system events need attention.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchLogs}
              disabled={refreshing}
              className="h-12 px-5 rounded-2xl bg-[#111127] text-white text-sm font-black shadow-lg shadow-slate-200 inline-flex items-center justify-center gap-2 disabled:opacity-70"
            >
              <RefreshIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </section>

        {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-2xl px-4 py-3 text-sm font-bold">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <SummaryCard icon={ActivityIcon} label="Events today" value={summary.today} helper="Fresh activity" tone="purple" active={quickFilter === 'today'} onClick={() => applySummaryFilter('today')} />
          <SummaryCard icon={UsersIcon} label="Admin actions" value={summary.admin_actions} helper="People changes" tone="indigo" active={quickFilter === 'admin'} onClick={() => applySummaryFilter('admin')} />
          <SummaryCard icon={AgentIcon} label="AI actions" value={summary.ai_actions} helper="Automated work" tone="blue" active={quickFilter === 'ai'} onClick={() => applySummaryFilter('ai')} />
          <SummaryCard icon={WarningIcon} label="Failed / critical" value={summary.failed_actions} helper="Needs review" tone="red" active={quickFilter === 'failed'} onClick={() => applySummaryFilter('failed')} />
          <SummaryCard icon={ShieldIcon} label="Security alerts" value={summary.security_alerts} helper="Access risks" tone="amber" active={quickFilter === 'security'} onClick={() => applySummaryFilter('security')} />
        </div>

        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_150px_170px_150px] gap-3">
              <label className="h-12 rounded-2xl border border-slate-200 bg-white px-4 flex items-center gap-3">
                <SearchIcon className="w-4 h-4 text-slate-400" />
                <input
                  value={query.search}
                  onChange={(e) => setQuery((current) => ({ ...current, search: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchLogs();
                  }}
                  placeholder="Search actor, customer, invoice, router, ticket..."
                  className="w-full outline-none text-sm font-semibold text-slate-700 placeholder:text-slate-400"
                />
              </label>
              <select
                value={query.actor}
                onChange={(e) => { setQuickFilter('all'); setQuery((current) => ({ ...current, actor: e.target.value })); }}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none"
              >
                <option value="all">All actors</option>
                {(filters.actors || []).map((actor) => <option key={actor} value={actor}>{labelize(actor)}</option>)}
              </select>
              <select
                value={query.module}
                onChange={(e) => { setQuickFilter('all'); setQuery((current) => ({ ...current, module: e.target.value })); }}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none"
              >
                <option value="all">All modules</option>
                {(filters.modules || []).map((moduleName) => <option key={moduleName} value={moduleName}>{moduleMeta(moduleName).label}</option>)}
              </select>
              <select
                value={query.severity}
                onChange={(e) => { setQuickFilter('all'); setQuery((current) => ({ ...current, severity: e.target.value })); }}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none"
              >
                <option value="all">All severity</option>
                {(filters.severities || []).map((severity) => <option key={severity} value={severity}>{labelize(severity)}</option>)}
              </select>
            </div>
          </div>

          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-slate-950">System Activity</div>
              <div className="text-xs font-semibold text-slate-500">{searchedEvents.length} event{searchedEvents.length === 1 ? '' : 's'} shown</div>
            </div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
              Auto refresh every 3 min{lastRefreshedAt ? ` · Last ${lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
          </div>

          {searchedEvents.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
                <ActivityIcon className="w-7 h-7" />
              </div>
              <div className="mt-4 text-sm font-black text-slate-800">No audit events found</div>
              <div className="mt-1 text-xs font-semibold text-slate-400">Try widening the filters or waiting for new system activity.</div>
            </div>
          ) : (
            <div>
              {searchedEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={selected?.id === event.id}
                  onClick={() => setSelected(event)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      <DetailsDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
