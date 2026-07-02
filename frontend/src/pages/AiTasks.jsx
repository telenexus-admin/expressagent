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
  audience_status: 'active',
  package_name: '',
  limit: 100,
  schedule_mode: 'now',
  run_at: '',
  repeat: 'none',
  interval_minutes: 30,
  tone: 'warm',
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

export default function AiTasks() {
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  useEffect(() => {
    loadTasks();
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
          status: form.audience_status,
          package_name: form.package_name,
          limit: Number(form.limit) || 100,
        },
        schedule: {
          mode: form.schedule_mode,
          run_at: form.run_at || null,
          repeat: form.repeat,
          interval_minutes: Number(form.interval_minutes) || 0,
        },
        options: { tone: form.tone, approval_required: form.task_type !== 'engagement_message' },
      });
      setForm(initialForm);
      setMessage('Mission created successfully.');
      await loadTasks();
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
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update mission.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
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

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Package filter</span>
              <input value={form.package_name} onChange={(e) => updateForm('package_name', e.target.value)} placeholder="Optional package name" className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
            </label>

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
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b86a8]">Run at</span>
                  <input type="datetime-local" value={form.run_at} onChange={(e) => updateForm('run_at', e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]" />
                </label>
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
    </div>
  );
}
