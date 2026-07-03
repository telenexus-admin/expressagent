import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import { AgentIcon, BoltIcon, BrainIcon, CheckCircleIcon, FlowIcon, PulseIcon, ShareIosIcon } from '../components/Icons';

const TASK_TYPES = [
  { value: 'engagement_message', label: 'Customer engagement', hint: 'Send a natural message to active customers.' },
  { value: 'invoice_send', label: 'Invoice mission', hint: 'Queue invoice work for a specific customer.' },
  { value: 'website_summary', label: 'Website research', hint: 'Refresh saved website knowledge and summarize it.' },
  { value: 'mikrotik_report', label: 'Network report', hint: 'Pull router health and summarize the status.' },
];

const statusClass = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-100',
  completed: 'bg-slate-50 text-slate-700 border-slate-100',
  paused: 'bg-amber-50 text-amber-700 border-amber-100',
  failed: 'bg-rose-50 text-rose-700 border-rose-100',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

const initialForm = {
  title: '',
  task_type: 'engagement_message',
  instruction: '',
  audience_type: 'filtered',
  audience_status: 'active',
  package_name: '',
  custom_numbers: '',
  custom_group_name: '',
  custom_group_contacts: '',
  limit: 100,
  channel: 'whatsapp',
  schedule_mode: 'now',
  run_at: '',
  run_time: '20:00',
  repeat: 'none',
  interval_minutes: 30,
  tone: 'warm',
};

const TABS = [
  { key: 'task_center', label: 'Task Center' },
  { key: 'engagement', label: 'Engagement Campaigns' },
  { key: 'invoices', label: 'Invoice Tasks' },
  { key: 'websites', label: 'Website Research' },
  { key: 'network', label: 'Network Tasks' },
  { key: 'scheduled', label: 'Scheduled Tasks' },
  { key: 'logs', label: 'Task Logs' },
];

const TEMPLATES = [
  {
    title: 'Thank active customers',
    task_type: 'engagement_message',
    instruction: 'Thank our active customers for believing in us and remind them that our team is always ready to help.',
    audience_status: 'active',
  },
  {
    title: 'Daily router health report',
    task_type: 'mikrotik_report',
    instruction: 'Check router health, active users, CPU load, uptime, and important logs, then summarize what needs attention.',
    schedule_mode: 'recurring',
    repeat: 'daily',
  },
  {
    title: 'Refresh website knowledge',
    task_type: 'website_summary',
    instruction: 'Refresh all active website knowledge links and summarize the latest changes for the admin.',
    schedule_mode: 'recurring',
    repeat: 'minutes',
    interval_minutes: 30,
  },
  {
    title: 'Prepare invoice mission',
    task_type: 'invoice_send',
    instruction: 'Create and send an invoice to the customer named in the instruction after checking billing details.',
  },
  {
    title: 'Expiry reminders',
    task_type: 'engagement_message',
    instruction: 'Send a friendly reminder to customers expiring tomorrow and guide them to renew before service interruption.',
    audience_status: 'active',
  },
  {
    title: 'Package offer',
    task_type: 'engagement_message',
    instruction: 'Tell customers on the selected package about a better offer and answer replies naturally.',
    audience_status: 'active',
  },
];

const TAB_TASK_TYPES = {
  engagement: ['engagement_message'],
  invoices: ['invoice_send'],
  websites: ['website_summary'],
  network: ['mikrotik_report'],
};

function localDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function typeLabel(value) {
  return TASK_TYPES.find((type) => type.value === value)?.label || value;
}

function ActionButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center justify-center rounded-2xl px-4 text-[13px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function TabButton({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={`h-11 rounded-2xl px-4 text-[13px] font-black transition ${
        active
          ? 'bg-gradient-to-r from-[#3158ff] to-[#812cff] text-white shadow-[0_12px_26px_rgba(81,53,245,0.24)]'
          : 'border border-[#dfe5f5] bg-white text-[#425071] hover:border-[#bfc8e4]'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function HistoryPanel({ runs, loading }) {
  if (loading) {
    return <div className="rounded-[24px] border border-[#dfe5f5] bg-white p-8 text-[13px] font-black text-[#637098]">Loading task history...</div>;
  }
  if (!runs.length) {
    return (
      <div className="rounded-[28px] border border-dashed border-[#cfd8ec] bg-white p-10 text-center">
        <FlowIcon className="mx-auto h-10 w-10 text-[#6c2cff]" />
        <h3 className="mt-4 text-[18px] font-black text-[#08103f]">No runs yet</h3>
        <p className="mt-2 text-[13px] font-semibold text-[#637098]">When a mission runs, the result will appear here.</p>
      </div>
    );
  }
  return (
    <section className="rounded-[28px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-black text-[#08103f]">Recent mission runs</h2>
          <p className="text-[12px] font-semibold text-[#637098]">A clear trail of what the agent attempted and what happened.</p>
        </div>
        <span className="rounded-full bg-[#f0e8ff] px-3 py-1 text-[12px] font-black text-[#6c2cff]">{runs.length} runs</span>
      </div>
      <div className="space-y-3">
        {runs.map((run) => (
          <article key={run.id} className="rounded-2xl border border-[#e4e9f6] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[14px] font-black text-[#08103f]">{run.title}</p>
                <p className="text-[12px] font-bold text-[#637098]">{typeLabel(run.task_type)} • {localDateTime(run.started_at)}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] ${statusClass[run.status] || statusClass.completed}`}>
                {run.status}
              </span>
            </div>
            <p className="mt-3 text-[13px] font-semibold leading-6 text-[#425071]">{run.summary || run.error || 'No summary returned.'}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GuardrailsPanel() {
  const items = [
    ['Approval-first actions', 'Invoice and network-changing missions are captured safely so approval can be added before execution.'],
    ['Audience limits', 'Engagement missions can be limited by account status, package, and maximum recipients.'],
    ['Human-readable history', 'Every run keeps a result trail with success, failure, and partial-delivery details.'],
    ['No silent router changes', 'Current network missions report and summarize. Reboot/action layers should stay explicit and permissioned.'],
  ];
  return (
    <section className="rounded-[28px] border border-[#dfe5f5] bg-white p-6 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <CheckCircleIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[20px] font-black text-[#08103f]">Mission guardrails</h2>
          <p className="text-[13px] font-semibold text-[#637098]">The agent can be powerful without being reckless.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {items.map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-[#e4e9f6] bg-[#f8faff] p-4">
            <p className="text-[14px] font-black text-[#08103f]">{title}</p>
            <p className="mt-2 text-[13px] font-semibold leading-6 text-[#637098]">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CapabilityPanel({ title, description, items, icon: Icon = BrainIcon }) {
  return (
    <section className="rounded-[28px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f0e8ff] text-[#6c2cff]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[18px] font-black text-[#08103f]">{title}</h2>
          <p className="mt-1 text-[13px] font-semibold leading-6 text-[#637098]">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-[#e4e9f6] bg-[#f8faff] p-4 text-[13px] font-bold leading-6 text-[#425071]">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, busy, onRun, onStatus }) {
  const latestRun = task.recent_runs?.[0];
  const nextStatus = task.status === 'paused' ? 'active' : 'paused';
  return (
    <article className="rounded-[24px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-black text-[#08103f]">{task.title}</h3>
            <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] ${statusClass[task.status] || statusClass.completed}`}>
              {task.status}
            </span>
          </div>
          <p className="mt-1 text-[12px] font-bold text-[#637098]">{typeLabel(task.task_type)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => onRun(task.id)} disabled={busy} className="bg-[#5135f5] text-white shadow-[0_12px_30px_rgba(81,53,245,0.22)]">
            Run now
          </ActionButton>
          <ActionButton onClick={() => onStatus(task.id, nextStatus)} disabled={busy || task.status === 'cancelled'} className="border border-[#d9e1f2] bg-white text-[#16204a]">
            {task.status === 'paused' ? 'Resume' : 'Pause'}
          </ActionButton>
          <ActionButton onClick={() => onStatus(task.id, 'cancelled')} disabled={busy || task.status === 'cancelled'} className="bg-rose-50 text-rose-700">
            Cancel
          </ActionButton>
        </div>
      </div>

      <p className="mt-4 rounded-2xl bg-[#f7f9fe] p-4 text-[13px] font-semibold leading-6 text-[#425071]">{task.instruction}</p>

      <div className="mt-4 grid gap-3 text-[12px] font-bold text-[#637098] sm:grid-cols-3">
        <div className="rounded-2xl border border-[#e4e9f6] p-3">
          <span className="block text-[#99a4bf]">Next run</span>
          {localDateTime(task.next_run_at)}
        </div>
        <div className="rounded-2xl border border-[#e4e9f6] p-3">
          <span className="block text-[#99a4bf]">Last run</span>
          {localDateTime(task.last_run_at)}
        </div>
        <div className="rounded-2xl border border-[#e4e9f6] p-3">
          <span className="block text-[#99a4bf]">Audience</span>
          {task.audience?.status || 'active'} customers
        </div>
      </div>

      {latestRun && (
        <div className="mt-4 rounded-2xl border border-[#e4e9f6] bg-white p-4">
          <p className="text-[12px] font-black uppercase tracking-[0.12em] text-[#6c2cff]">Latest result</p>
          <p className="mt-2 text-[13px] font-semibold leading-6 text-[#425071]">{latestRun.summary || latestRun.error || 'No summary yet.'}</p>
        </div>
      )}
    </article>
  );
}

function MissionList({ tasks, loading, busy, onRun, onStatus, emptyTitle = 'No missions yet', emptyBody = 'Create the first task and Nexa will start handling it from here.' }) {
  if (loading) {
    return <div className="rounded-[24px] border border-[#dfe5f5] bg-white p-8 text-[13px] font-black text-[#637098]">Loading AI tasks...</div>;
  }
  if (!tasks.length) {
    return (
      <div className="rounded-[28px] border border-dashed border-[#cfd8ec] bg-white p-10 text-center">
        <AgentIcon className="mx-auto h-10 w-10 text-[#6c2cff]" />
        <h3 className="mt-4 text-[18px] font-black text-[#08103f]">{emptyTitle}</h3>
        <p className="mt-2 text-[13px] font-semibold text-[#637098]">{emptyBody}</p>
      </div>
    );
  }
  return tasks.map((task) => <TaskCard key={task.id} task={task} busy={busy} onRun={onRun} onStatus={onStatus} />);
}

export default function AiTasks() {
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('task_center');

  const selectedType = useMemo(() => TASK_TYPES.find((type) => type.value === form.task_type), [form.task_type]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/ai-tasks');
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load AI tasks.');
    } finally {
      setLoading(false);
    }
  };

  const loadRuns = async () => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get('/ai-tasks/runs?limit=50');
      setRuns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load AI task history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    loadRuns();
  }, []);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
    setMessage('');
  };

  const createTask = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post('/ai-tasks', {
        title: form.title,
        task_type: form.task_type,
        instruction: form.instruction,
        audience: {
          type: form.audience_type,
          status: form.audience_status,
          package_name: form.package_name,
          limit: Number(form.limit) || 100,
          custom_numbers: form.custom_numbers,
          group: {
            name: form.custom_group_name,
            contacts: form.custom_group_contacts,
          },
        },
        schedule: {
          mode: form.schedule_mode,
          run_at: form.run_at || null,
          time: form.run_time || null,
          repeat: form.repeat,
          interval_minutes: Number(form.interval_minutes) || 0,
        },
        options: { tone: form.tone, channel: form.channel, approval_required: form.task_type !== 'engagement_message' },
      });
      setForm(initialForm);
      setMessage('Mission created successfully.');
      setActiveTab('scheduled');
      await loadTasks();
      await loadRuns();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create mission.');
    } finally {
      setBusy(false);
    }
  };

  const runTask = async (id) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post(`/ai-tasks/${id}/run`);
      setMessage('Mission run completed.');
      await loadTasks();
      await loadRuns();
    } catch (err) {
      setError(err.response?.data?.error || 'Mission run failed.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (id, status) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.patch(`/ai-tasks/${id}/status`, { status });
      setMessage(`Mission ${status}.`);
      await loadTasks();
      await loadRuns();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update mission.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-5 p-4 pb-10 sm:p-5">
      <section className="overflow-hidden rounded-[28px] border border-[#dfe5f5] bg-white shadow-[0_24px_70px_rgba(30,41,59,0.08)]">
        <div className="relative flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-[#f0e8ff] text-[#6c2cff] shadow-[0_14px_30px_rgba(108,44,255,0.16)]">
              <BrainIcon className="h-8 w-8" />
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#6c2cff]">Mission control</p>
              <h1 className="mt-1 text-[28px] font-black text-[#08103f]">AI Tasks</h1>
              <p className="mt-2 max-w-[720px] text-[14px] font-semibold leading-6 text-[#637098]">
                Give the agent work to do: engage customers, refresh website knowledge, prepare invoice missions, or pull network reports on schedule.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12px] font-black text-[#425071] sm:grid-cols-4 lg:w-[460px]">
            {TASK_TYPES.map((type) => (
              <div key={type.value} className="rounded-2xl border border-[#e3e8f7] bg-[#f8faff] p-3">
                <span className="block text-[#08103f]">{type.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {(message || error) && (
        <div className={`rounded-2xl px-4 py-3 text-[13px] font-black ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {error || message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <TabButton key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </TabButton>
        ))}
      </div>

      {activeTab === 'task_center' && (
      <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <form onSubmit={createTask} className="rounded-[28px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef6ff] text-[#2563eb]">
              <BoltIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[18px] font-black text-[#08103f]">Create a mission</h2>
              <p className="text-[12px] font-semibold text-[#637098]">{selectedType?.hint}</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Mission type</span>
              <select value={form.task_type} onChange={(e) => updateForm('task_type', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                {TASK_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Title</span>
              <input value={form.title} onChange={(e) => updateForm('title', e.target.value)} placeholder="Thank active customers" className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Instruction</span>
              <textarea value={form.instruction} onChange={(e) => updateForm('instruction', e.target.value)} rows={5} placeholder="Tell active customers thank you for believing in us." className="mt-2 w-full resize-none rounded-2xl border border-[#d9e1f2] bg-white px-4 py-3 text-[13px] font-semibold leading-6 text-[#08103f] outline-none focus:border-[#6c2cff]" />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Audience</span>
                <select value={form.audience_type} onChange={(e) => updateForm('audience_type', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                  <option value="filtered">Customers from system</option>
                  <option value="custom_numbers">Custom number</option>
                  <option value="custom_group">Custom group</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Communication method</span>
                <select value={form.channel} onChange={(e) => updateForm('channel', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </label>
            </div>

            {form.audience_type === 'filtered' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Customer filter</span>
                  <select value={form.audience_status} onChange={(e) => updateForm('audience_status', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                    <option value="active">Active customers</option>
                    <option value="expired">Expired customers</option>
                    <option value="all">All known customers</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Limit</span>
                  <input type="number" min="1" max="500" value={form.limit} onChange={(e) => updateForm('limit', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
                </label>
              </div>
            )}

            {form.audience_type === 'custom_numbers' && (
              <label className="block">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Custom number or email</span>
                <textarea value={form.custom_numbers} onChange={(e) => updateForm('custom_numbers', e.target.value)} rows={3} placeholder="One recipient per line. Example: James, 254712345678, james@example.com" className="mt-2 w-full resize-none rounded-2xl border border-[#d9e1f2] bg-white px-4 py-3 text-[13px] font-semibold leading-6 text-[#08103f] outline-none focus:border-[#6c2cff]" />
              </label>
            )}

            {form.audience_type === 'custom_group' && (
              <div className="space-y-3 rounded-2xl border border-[#e4e9f6] bg-[#f8faff] p-4">
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Group name</span>
                  <input value={form.custom_group_name} onChange={(e) => updateForm('custom_group_name', e.target.value)} placeholder="VIP customers" className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Group contacts</span>
                  <textarea value={form.custom_group_contacts} onChange={(e) => updateForm('custom_group_contacts', e.target.value)} rows={4} placeholder="One contact per line: Name, phone, email" className="mt-2 w-full resize-none rounded-2xl border border-[#d9e1f2] bg-white px-4 py-3 text-[13px] font-semibold leading-6 text-[#08103f] outline-none focus:border-[#6c2cff]" />
                </label>
              </div>
            )}

            {form.audience_type === 'filtered' && <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Package filter</span>
              <input value={form.package_name} onChange={(e) => updateForm('package_name', e.target.value)} placeholder="Optional package name" className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
            </label>}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Schedule</span>
                <select value={form.schedule_mode} onChange={(e) => updateForm('schedule_mode', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                  <option value="now">Run now</option>
                  <option value="once">Run once later</option>
                  <option value="recurring">Recurring</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Tone</span>
                <select value={form.tone} onChange={(e) => updateForm('tone', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                  <option value="warm">Warm</option>
                  <option value="brief">Brief</option>
                </select>
              </label>
            </div>

            {form.schedule_mode !== 'now' && (
              <div className="grid gap-3 sm:grid-cols-2">
                {form.schedule_mode === 'once' ? <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Execution date and time</span>
                  <input type="datetime-local" value={form.run_at} onChange={(e) => updateForm('run_at', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
                </label> : <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Execution time</span>
                  <input type="time" value={form.run_time} onChange={(e) => updateForm('run_time', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
                </label>}
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Repeat</span>
                  <select value={form.repeat} onChange={(e) => updateForm('repeat', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]">
                    <option value="none">No repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="minutes">Every N minutes</option>
                  </select>
                </label>
              </div>
            )}

            {form.repeat === 'minutes' && (
              <label className="block">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Interval minutes</span>
                <input type="number" min="5" value={form.interval_minutes} onChange={(e) => updateForm('interval_minutes', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
              </label>
            )}

            <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] text-[14px] font-black text-white shadow-[0_18px_40px_rgba(81,53,245,0.25)] disabled:opacity-60">
              <ShareIosIcon className="h-4 w-4" />
              Create Mission
            </button>
          </div>
        </form>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
            <h2 className="text-[18px] font-black text-[#08103f]">Mission templates</h2>
            <p className="mt-1 text-[12px] font-semibold text-[#637098]">Start fast, then edit the instruction before creating the task.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.title}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, ...template }))}
                  className="rounded-2xl border border-[#e4e9f6] bg-[#f8faff] p-4 text-left transition hover:border-[#6c2cff]"
                >
                  <p className="text-[14px] font-black text-[#08103f]">{template.title}</p>
                  <p className="mt-2 text-[12px] font-semibold leading-5 text-[#637098]">{typeLabel(template.task_type)}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-4">
              <PulseIcon className="h-5 w-5 text-[#5135f5]" />
              <p className="mt-3 text-[22px] font-black text-[#08103f]">{tasks.length}</p>
              <p className="text-[12px] font-bold text-[#637098]">Total missions</p>
            </div>
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-4">
              <FlowIcon className="h-5 w-5 text-[#f59e0b]" />
              <p className="mt-3 text-[22px] font-black text-[#08103f]">{tasks.filter((task) => ['active', 'scheduled'].includes(task.status)).length}</p>
              <p className="text-[12px] font-bold text-[#637098]">Ready or scheduled</p>
            </div>
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-4">
              <CheckCircleIcon className="h-5 w-5 text-[#10b981]" />
              <p className="mt-3 text-[22px] font-black text-[#08103f]">{tasks.filter((task) => task.last_run_at).length}</p>
              <p className="text-[12px] font-bold text-[#637098]">Run before</p>
            </div>
          </div>

          {loading ? (
            <div className="rounded-[24px] border border-[#dfe5f5] bg-white p-8 text-[13px] font-black text-[#637098]">Loading AI tasks...</div>
          ) : tasks.length ? (
            tasks.map((task) => <TaskCard key={task.id} task={task} busy={busy} onRun={runTask} onStatus={changeStatus} />)
          ) : (
            <div className="rounded-[28px] border border-dashed border-[#cfd8ec] bg-white p-10 text-center">
              <AgentIcon className="mx-auto h-10 w-10 text-[#6c2cff]" />
              <h3 className="mt-4 text-[18px] font-black text-[#08103f]">No missions yet</h3>
              <p className="mt-2 text-[13px] font-semibold text-[#637098]">Create the first task and Nexa will start handling it from here.</p>
            </div>
          )}
        </section>
      </section>
      )}

      {activeTab === 'engagement' && (
        <section className="space-y-4">
          <CapabilityPanel
            title="Engagement Campaigns"
            description="Use this for real customer conversations, not dry broadcasts. Nexa can greet customers naturally and continue the conversation when they reply."
            icon={ShareIosIcon}
            items={[
              'Audience filters: active, expired, expiring soon, package, router, billing import, or recent interaction.',
              'Delivery styles: warm, brief, reminder, offer, or support follow-up.',
              'Channels planned: WhatsApp first, then SMS and email when enabled per account.',
              'Replies stay in conversations so the team can see what customers said back.',
            ]}
          />
          <MissionList tasks={tasks.filter((task) => TAB_TASK_TYPES.engagement.includes(task.task_type))} loading={loading} busy={busy} onRun={runTask} onStatus={changeStatus} emptyTitle="No engagement campaigns yet" emptyBody="Create one from Task Center, or use the thank-you and expiry reminder templates." />
        </section>
      )}

      {activeTab === 'invoices' && (
        <section className="space-y-4">
          <CapabilityPanel
            title="Invoice Tasks"
            description="Invoice missions will connect deeper into the invoice generator: fetch customer details, generate PDF, send invoice, and continue Pay Now / Pay Later flows."
            icon={CheckCircleIcon}
            items={[
              'Create invoice for one customer by name, phone, account number, or username.',
              'Batch invoice expired customers or monthly customers on a schedule.',
              'Attach Pay Now and Pay Later buttons after the PDF invoice is sent.',
              'Current build captures invoice missions safely; full send executor is the next invoice step.',
            ]}
          />
          <MissionList tasks={tasks.filter((task) => TAB_TASK_TYPES.invoices.includes(task.task_type))} loading={loading} busy={busy} onRun={runTask} onStatus={changeStatus} emptyTitle="No invoice tasks yet" emptyBody="Create an invoice mission from Task Center." />
        </section>
      )}

      {activeTab === 'websites' && (
        <section className="space-y-4">
          <CapabilityPanel
            title="Website Research Tasks"
            description="Connect scheduled website refreshes to the Knowledge Base so Nexa can keep learning from pages that change over time."
            icon={BrainIcon}
            items={[
              'Refresh saved website links every 5, 10, 30 minutes, daily, or weekly.',
              'Summarize changes into the task logs for admin review.',
              'Save refreshed findings back into Knowledge Base for future customer replies.',
              'Useful for ISP pricing pages, competitor updates, documentation, and public notices.',
            ]}
          />
          <MissionList tasks={tasks.filter((task) => TAB_TASK_TYPES.websites.includes(task.task_type))} loading={loading} busy={busy} onRun={runTask} onStatus={changeStatus} emptyTitle="No website research tasks yet" emptyBody="Create one from Task Center using the website refresh template." />
        </section>
      )}

      {activeTab === 'network' && (
        <section className="space-y-4">
          <CapabilityPanel
            title="Network Tasks"
            description="Network tasks are read-only by default: router health, CPU, uptime, interfaces, failed logins, offline routers, and active users."
            icon={PulseIcon}
            items={[
              'Safe automatic: check and report router status, logs, CPU, uptime, active users, and interface traffic.',
              'Approval required later: reboot router, disable interface, enable interface, or disconnect user.',
              'Forbidden unless explicitly enabled: firewall changes, user deletion, package changes.',
              'Every network task should log the router checked, warnings found, and any admin approval record.',
            ]}
          />
          <MissionList tasks={tasks.filter((task) => TAB_TASK_TYPES.network.includes(task.task_type))} loading={loading} busy={busy} onRun={runTask} onStatus={changeStatus} emptyTitle="No network tasks yet" emptyBody="Create a MikroTik report mission from Task Center." />
        </section>
      )}

      {activeTab === 'scheduled' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-4">
              <PulseIcon className="h-5 w-5 text-[#5135f5]" />
              <p className="mt-3 text-[22px] font-black text-[#08103f]">{tasks.length}</p>
              <p className="text-[12px] font-bold text-[#637098]">Total missions</p>
            </div>
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-4">
              <FlowIcon className="h-5 w-5 text-[#f59e0b]" />
              <p className="mt-3 text-[22px] font-black text-[#08103f]">{tasks.filter((task) => ['active', 'scheduled'].includes(task.status)).length}</p>
              <p className="text-[12px] font-bold text-[#637098]">Ready or scheduled</p>
            </div>
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-4">
              <CheckCircleIcon className="h-5 w-5 text-[#10b981]" />
              <p className="mt-3 text-[22px] font-black text-[#08103f]">{tasks.filter((task) => task.last_run_at).length}</p>
              <p className="text-[12px] font-bold text-[#637098]">Run before</p>
            </div>
          </div>
          <MissionList tasks={tasks.filter((task) => ['active', 'scheduled', 'paused'].includes(task.status))} loading={loading} busy={busy} onRun={runTask} onStatus={changeStatus} emptyTitle="No scheduled tasks yet" emptyBody="Create a recurring or run-later mission from Task Center." />
        </section>
      )}

      {activeTab === 'logs' && <HistoryPanel runs={runs} loading={historyLoading} />}
    </div>
  );
}
