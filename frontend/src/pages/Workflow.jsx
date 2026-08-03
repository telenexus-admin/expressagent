import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import api from '../utils/api';
import {
  BoltIcon,
  CreditCardIcon,
  WrenchIcon,
  PhoneIcon,
  HeartIcon,
  QuestionIcon,
  BrainIcon,
  ChatIcon,
  CheckCircleIcon,
  WarningIcon,
} from '../components/Icons';

const INTENT_STYLE = {
  new_installation:    { Icon: BoltIcon,       accent: '#0EA5E9', bg: 'bg-sky-50',     ring: 'ring-sky-200' },
  relocation_request:  { Icon: WrenchIcon,     accent: '#7C3AED', bg: 'bg-violet-50',  ring: 'ring-violet-200' },
  payment_billing:     { Icon: CreditCardIcon, accent: '#F59E0B', bg: 'bg-amber-50',   ring: 'ring-amber-200' },
  technical_issue:     { Icon: WrenchIcon,     accent: '#EF4444', bg: 'bg-red-50',     ring: 'ring-red-200' },
  router_management:   { Icon: WrenchIcon,     accent: '#2563EB', bg: 'bg-blue-50',    ring: 'ring-blue-200' },
  router_alerts:       { Icon: WarningIcon,    accent: '#F97316', bg: 'bg-orange-50',  ring: 'ring-orange-200' },
  human_request:       { Icon: PhoneIcon,      accent: '#8B5CF6', bg: 'bg-violet-50',  ring: 'ring-violet-200' },
  compliment_feedback: { Icon: HeartIcon,      accent: '#EC4899', bg: 'bg-pink-50',    ring: 'ring-pink-200' },
  general_inquiry:     { Icon: QuestionIcon,   accent: '#10B981', bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
};

const INTENT_LABELS = {
  new_installation: 'New Installation',
  relocation_request: 'Relocation / Transfer',
  payment_billing: 'Payment / Billing',
  technical_issue: 'Technical Problem',
  router_management: 'Router Management',
  router_alerts: 'Router Alerts',
  human_request: 'Wants a Human',
  compliment_feedback: 'Compliment / Feedback',
  general_inquiry: 'General Inquiry',
};
const CHANNELS = [
  ['sms', 'SMS'],
  ['email', 'Email'],
  ['whatsapp', 'WhatsApp'],
];

function normalizeChannels(value) {
  return Array.isArray(value) && value.length ? value : ['sms'];
}

function normalizeEmployeeIds(value, fallback = null) {
  const source = Array.isArray(value) ? value : [];
  const ids = source.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  if (ids.length === 0 && fallback) ids.push(parseInt(fallback, 10));
  return [...new Set(ids)].filter((item) => Number.isInteger(item) && item > 0);
}

function normalizePhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function normalizeAllowedPhoneNumbers(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,\n\s]+/);
  return [...new Set(source.map(normalizePhoneDigits).filter((item) => item.length >= 9))];
}

export default function Workflow() {
  const [intents, setIntents] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState({}); // { [intentKey]: 'saving' | 'saved' | 'error' }

  const fetchAll = useCallback(async () => {
    try {
      const [{ data: workflow }, { data: disp }] = await Promise.all([
        api.get('/workflows'),
        api.get('/workflows/dispatches?limit=10').catch(() => ({ data: [] })),
      ]);
      setIntents(workflow.intents || []);
      setEmployees(workflow.employees || []);
      setDispatches(disp || []);
    } catch (err) {
      console.error('Failed to fetch workflows:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const saveRoute = async (intentKey, patch) => {
    const current = intents.find((intent) => intent.key === intentKey);
    if (!current) return;
    setSaveState((s) => ({ ...s, [intentKey]: 'saving' }));
    try {
      const nextEmployeeIds = patch.employee_ids !== undefined
        ? patch.employee_ids
        : normalizeEmployeeIds(current.assignedEmployeeIds, current.assignedEmployeeId);
      const nextChannels = patch.notification_channels || normalizeChannels(current.notificationChannels);
      await api.put(`/workflows/${intentKey}`, {
        employee_ids: nextEmployeeIds,
        allowed_phone_numbers: patch.allowed_phone_numbers !== undefined
          ? normalizeAllowedPhoneNumbers(patch.allowed_phone_numbers)
          : normalizeAllowedPhoneNumbers(current.allowedPhoneNumbers),
        is_enabled: true,
        notification_channels: nextChannels,
      });
      setIntents((prev) =>
        prev.map((i) =>
          i.key === intentKey
            ? {
                ...i,
                assignedEmployeeId: nextEmployeeIds[0] || null,
                assignedEmployeeIds: nextEmployeeIds,
                allowedPhoneNumbers: patch.allowed_phone_numbers !== undefined
                  ? normalizeAllowedPhoneNumbers(patch.allowed_phone_numbers)
                  : normalizeAllowedPhoneNumbers(i.allowedPhoneNumbers),
                notificationChannels: nextChannels,
              }
            : i
        )
      );
      setSaveState((s) => ({ ...s, [intentKey]: 'saved' }));
      setTimeout(() => {
        setSaveState((s) => {
          const next = { ...s };
          if (next[intentKey] === 'saved') delete next[intentKey];
          return next;
        });
      }, 1800);
    } catch (err) {
      console.error(err);
      setSaveState((s) => ({ ...s, [intentKey]: 'error' }));
    }
  };

  const assign = (intentKey, employeeIds) => saveRoute(intentKey, { employee_ids: employeeIds });
  const updateChannels = (intentKey, channels) => saveRoute(intentKey, { notification_channels: channels });
  const updateAllowedNumbers = (intentKey, numbers) => saveRoute(intentKey, { allowed_phone_numbers: numbers });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        Loading workflow…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Workflow</h1>
              <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                This is how your AI agent decides what to do with every customer message.
                For each scenario below, pick the employee and notification channels for alerts.
              </p>
            </div>
            <div className="flex gap-2">
              {editing ? (
                <button
                  type="button"
                  onClick={() => { setEditing(false); fetchAll(); }}
                  className="rounded-full border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-800"
                >
                  Lock routing
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-black text-white"
                >
                  Edit routing
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {editing ? 'Routing is unlocked. Employee changes save immediately.' : 'Routing is locked to prevent accidental employee assignment changes.'}
          </div>
        </div>

        {employees.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3 mb-6 flex items-start gap-2">
            <WarningIcon className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="text-sm">
              <strong>No active employees yet.</strong> Add team members on the{' '}
              <a href="/dashboard/employees" className="underline font-semibold">Employees</a>{' '}
              tab before assigning them to workflow scenarios.
            </div>
          </div>
        )}

        <FlowDiagram intents={intents} employees={employees} onAssign={assign} onChannelsChange={updateChannels} onAllowedNumbersChange={updateAllowedNumbers} saveState={saveState} editing={editing} />

        <RecentActivity dispatches={dispatches} />
      </div>
    </div>
  );
}

function FlowDiagram({ intents, employees, onAssign, onChannelsChange, onAllowedNumbersChange, saveState, editing }) {
  const containerRef = useRef(null);
  const aiNodeRef = useRef(null);
  const cardRefs = useRef({});
  const [paths, setPaths] = useState([]);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const aiNode = aiNodeRef.current;
    if (!container || !aiNode) return;

    const cRect = container.getBoundingClientRect();
    const aRect = aiNode.getBoundingClientRect();

    const startX = aRect.left + aRect.width / 2 - cRect.left;
    const startY = aRect.bottom - cRect.top;

    const newPaths = intents
      .map((intent) => {
        const node = cardRefs.current[intent.key];
        if (!node) return null;
        const nRect = node.getBoundingClientRect();
        const endX = nRect.left + nRect.width / 2 - cRect.left;
        const endY = nRect.top - cRect.top;
        // Smooth cubic curve from AI node down to top of each card
        const midY = startY + (endY - startY) / 2;
        const d = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
        return { key: intent.key, d, accent: INTENT_STYLE[intent.key]?.accent || '#3535FF' };
      })
      .filter(Boolean);

    setPaths(newPaths);
    setSvgSize({ width: cRect.width, height: cRect.height });
  }, [intents]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(containerRef.current);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [recompute]);

  return (
    <div
      ref={containerRef}
      className="relative bg-white rounded-3xl border border-gray-100 p-6 sm:p-10 mb-8"
    >
      {/* SVG connection layer */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={svgSize.width}
        height={svgSize.height}
        style={{ overflow: 'visible' }}
      >
        <defs>
          {paths.map((p) => (
            <marker
              key={`arrow-${p.key}`}
              id={`arrow-${p.key}`}
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={p.accent} />
            </marker>
          ))}
        </defs>
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.accent}
            strokeWidth="2"
            strokeOpacity="0.6"
            strokeDasharray="4 4"
            markerEnd={`url(#arrow-${p.key})`}
          />
        ))}
      </svg>

      {/* Customer message node */}
      <div className="relative flex flex-col items-center mb-6">
        <TopNode
          icon={<ChatIcon className="w-5 h-5" />}
          title="Customer sends a message"
          subtitle="WhatsApp text or voice note"
          accent="#3535FF"
        />
        <div className="w-px h-6 bg-gray-300" />
        <div ref={aiNodeRef}>
          <TopNode
            icon={<BrainIcon className="w-5 h-5" />}
            title="AI reads & classifies the message"
            subtitle="Detects what the customer needs"
            accent="#0A0A0F"
            primary
          />
        </div>
      </div>

      {/* Branch label */}
      <div className="relative flex justify-center mb-8 mt-2">
        <span className="bg-white px-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">
          Branches by intent
        </span>
      </div>

      {/* Intent cards grid */}
      <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {intents.map((intent) => (
          <IntentCard
            key={intent.key}
            ref={(el) => (cardRefs.current[intent.key] = el)}
            intent={intent}
            employees={employees}
            onAssign={onAssign}
            onChannelsChange={onChannelsChange}
            onAllowedNumbersChange={onAllowedNumbersChange}
            saveState={saveState[intent.key]}
            editing={editing}
          />
        ))}
      </div>
    </div>
  );
}

function TopNode({ icon, title, subtitle, accent, primary = false }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-5 py-3 shadow-sm border ${
        primary ? 'bg-[#0A0A0F] text-white border-[#0A0A0F]' : 'bg-white border-gray-200'
      }`}
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: primary ? 'rgba(255,255,255,0.1)' : `${accent}1a`, color: primary ? '#fff' : accent }}
      >
        {icon}
      </div>
      <div>
        <div className={`text-sm font-bold ${primary ? 'text-white' : 'text-gray-900'}`}>{title}</div>
        <div className={`text-xs ${primary ? 'text-gray-300' : 'text-gray-500'}`}>{subtitle}</div>
      </div>
    </div>
  );
}

const IntentCard = React.forwardRef(function IntentCard(
  { intent, employees, onAssign, onChannelsChange, onAllowedNumbersChange, saveState, editing },
  ref
) {
  const style = INTENT_STYLE[intent.key] || { Icon: QuestionIcon, accent: '#6B7280', bg: 'bg-gray-50' };
  const { Icon, accent, bg } = style;
  const selectedEmployeeIds = normalizeEmployeeIds(intent.assignedEmployeeIds, intent.assignedEmployeeId);
  const assignedEmployees = employees.filter((e) => selectedEmployeeIds.includes(e.id));
  const isPassthrough = intent.isPassthrough;
  const isRouterAllowList = intent.key === 'router_management';
  const channels = normalizeChannels(intent.notificationChannels);
  const toggleEmployee = (employeeId) => {
    const id = parseInt(employeeId, 10);
    const next = selectedEmployeeIds.includes(id)
      ? selectedEmployeeIds.filter((item) => item !== id)
      : [...selectedEmployeeIds, id];
    onAssign(intent.key, next);
  };
  const clearEmployees = () => onAssign(intent.key, []);
  const toggleChannel = (channel) => {
    const next = channels.includes(channel)
      ? channels.filter((item) => item !== channel)
      : [...channels, channel];
    onChannelsChange(intent.key, next.length ? next : ['sms']);
  };

  return (
    <div
      ref={ref}
      className="relative bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow"
      style={{ borderTopWidth: 3, borderTopColor: accent }}
    >
      <div className={`${bg} px-4 py-3 flex items-center gap-2.5`}>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${accent}26`, color: accent }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900 truncate">{intent.label}</div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            {intent.department}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        <p className="text-xs text-gray-600 leading-relaxed">{intent.description}</p>

        {intent.examples && intent.examples.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              What customer might say
            </div>
            <ul className="space-y-0.5">
              {intent.examples.slice(0, 3).map((ex, i) => (
                <li key={i} className="text-xs text-gray-700 italic flex gap-1.5">
                  <span className="text-gray-300">"</span>
                  <span>{ex}</span>
                  <span className="text-gray-300">"</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-2 border-t border-gray-100">
          {isRouterAllowList ? (
            <AuthorizedNumbersEditor
              numbers={intent.allowedPhoneNumbers || []}
              editing={editing}
              saveState={saveState}
              onSave={(numbers) => onAllowedNumbersChange(intent.key, numbers)}
            />
          ) : isPassthrough ? (
            <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <CheckCircleIcon className="w-3.5 h-3.5" />
              AI answers directly — no employee alert
            </div>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">
                Then notify
              </div>
              <EmployeePicker
                employees={employees}
                selectedEmployeeIds={selectedEmployeeIds}
                editing={editing}
                onToggle={toggleEmployee}
                onClear={clearEmployees}
              />

              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {CHANNELS.map(([value, label]) => {
                  const active = channels.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleChannel(value)}
                      disabled={!editing}
                      className={`rounded-lg border px-2 py-1.5 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? 'border-[#3535FF] bg-[#f3f2ff] text-[#3535FF]'
                          : 'border-gray-100 bg-gray-50 text-gray-400'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-1.5 h-4 text-[10px]">
                {saveState === 'saving' && <span className="text-gray-400">Saving…</span>}
                {saveState === 'saved' && (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircleIcon className="w-3 h-3" /> Saved
                  </span>
                )}
                {saveState === 'error' && (
                  <span className="text-red-600 flex items-center gap-1">
                    <WarningIcon className="w-3 h-3" /> Failed to save
                  </span>
                )}
                {!saveState && assignedEmployees.length > 0 && (
                  <span className="text-gray-400">
                    {channels.map((channel) => CHANNELS.find(([value]) => value === channel)?.[1] || channel).join(', ')} alert to {assignedEmployees.length === 1 ? assignedEmployees[0].name : `${assignedEmployees.length} employees`}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function EmployeePicker({ employees, selectedEmployeeIds, editing, onToggle, onClear }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-gray-100 bg-gray-50 p-2">
      {employees.length === 0 && (
        <div className="px-2 py-2 text-xs text-gray-400">No active employees available.</div>
      )}
      {employees.map((emp) => {
        const checked = selectedEmployeeIds.includes(emp.id);
        return (
          <label
            key={emp.id}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
              checked ? 'border-[#3535FF] bg-white text-[#3535FF]' : 'border-transparent bg-white/60 text-gray-600 hover:bg-white'
            } ${!editing ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!editing}
              onChange={() => onToggle(emp.id)}
              className="h-3.5 w-3.5 accent-[#3535FF]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{emp.name}</span>
              <span className="block truncate font-mono text-[10px] text-gray-400">{emp.phone}</span>
            </span>
          </label>
        );
      })}
      {editing && selectedEmployeeIds.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-black text-gray-500 hover:bg-gray-100"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

function AuthorizedNumbersEditor({ numbers, editing, saveState, onSave }) {
  const [text, setText] = useState(() => normalizeAllowedPhoneNumbers(numbers).join('\n'));

  useEffect(() => {
    setText(normalizeAllowedPhoneNumbers(numbers).join('\n'));
  }, [numbers]);

  const parsed = normalizeAllowedPhoneNumbers(text);

  return (
    <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-blue-700 font-black">
          Authorized WhatsApp numbers
        </div>
        <p className="mt-1 text-xs font-semibold leading-5 text-blue-800/80">
          The agent will answer router uptime, logs, reports and MikroTik admin questions only for these numbers.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!editing}
        rows={4}
        placeholder="2547XXXXXXXX&#10;0722XXXXXX"
        className="w-full resize-none rounded-xl border border-blue-100 bg-white px-3 py-2 font-mono text-xs font-bold text-[#17264d] outline-none focus:border-[#3535FF] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-blue-700">
          {parsed.length ? `${parsed.length} authorized number${parsed.length === 1 ? '' : 's'}` : 'No authorized numbers set'}
        </span>
        {editing && (
          <button
            type="button"
            onClick={() => onSave(parsed)}
            className="rounded-lg bg-[#3535FF] px-3 py-1.5 text-[10px] font-black text-white"
          >
            Save allowed numbers
          </button>
        )}
      </div>
      <div className="h-4 text-[10px]">
        {saveState === 'saving' && <span className="text-gray-400">Saving...</span>}
        {saveState === 'saved' && <span className="text-emerald-600">Saved</span>}
        {saveState === 'error' && <span className="text-red-600">Failed to save</span>}
      </div>
    </div>
  );
}

function RecentActivity({ dispatches }) {
  if (!dispatches || dispatches.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 p-6 text-center">
        <div className="text-sm font-bold text-gray-900 mb-1">Recent workflow alerts</div>
        <div className="text-xs text-gray-400">
          No alerts dispatched yet. Once a customer message triggers an intent with an assigned employee, it'll show up here.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-bold text-gray-900">Recent workflow alerts</div>
        <div className="text-xs text-gray-500">Alerts sent to employees based on detected intent</div>
      </div>
      <div className="divide-y divide-gray-50">
        {dispatches.map((d) => {
          const style = INTENT_STYLE[d.intent_key];
          const Icon = style?.Icon || QuestionIcon;
          const accent = style?.accent || '#6B7280';
          const dispatchedEmployeeIds = normalizeEmployeeIds(d.employee_ids, d.employee_id);
          const employeeLabel = dispatchedEmployeeIds.length > 1
            ? `${dispatchedEmployeeIds.length} employees`
            : (d.employee_name || <em className="text-gray-400">employee removed</em>);
          return (
            <div key={d.id} className="px-5 py-3 flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `${accent}1a`, color: accent }}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {INTENT_LABELS[d.intent_key] || d.intent_key}
                  </span>
                  <span className="text-xs text-gray-400">→</span>
                  <span className="text-xs text-gray-700">{employeeLabel}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f3f2ff] text-[#3535FF] font-semibold">
                    {normalizeChannels(d.notification_channels).map((channel) => CHANNELS.find(([value]) => value === channel)?.[1] || channel).join(' + ')}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      d.notify_status === 'sent'
                        ? 'bg-emerald-50 text-emerald-700'
                        : d.notify_status === 'failed'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {d.notify_status}
                  </span>
                </div>
                <div className="text-xs text-gray-600 mt-0.5 truncate">
                  <span className="font-mono">+{d.customer_phone}</span>:{' '}
                  <span className="italic">"{d.trigger_message}"</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {new Date(d.created_at).toLocaleString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
