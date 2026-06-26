import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  AgentIcon,
  CheckCircleIcon,
  LifebuoyIcon,
  PulseIcon,
  WarningIcon,
} from '../components/Icons';
import robotAgentImage from '../assets/robot-agent.jpg';

const VOICE_OPTIONS = [
  { id: 'alloy', label: 'Alloy', description: 'Neutral, balanced - works for most use cases' },
  { id: 'echo', label: 'Echo', description: 'Calm and grounded male timbre' },
  { id: 'fable', label: 'Fable', description: 'Warm storyteller, expressive and friendly' },
  { id: 'onyx', label: 'Onyx', description: 'Deep, authoritative male voice' },
  { id: 'nova', label: 'Nova', description: 'Bright and energetic female voice' },
  { id: 'shimmer', label: 'Shimmer', description: 'Soft, gentle female voice' },
];

const VOICE_GRADIENTS = {
  alloy: 'from-[#b96cff] via-[#8c5cf6] to-[#5b33f6]',
  echo: 'from-[#9ee7ff] via-[#62a8ff] to-[#4968f6]',
  fable: 'from-[#b3f5e9] via-[#73deca] to-[#35c9b0]',
  onyx: 'from-[#77789d] via-[#44466d] to-[#20213d]',
  nova: 'from-[#ffd19d] via-[#ff8da8] to-[#7b5cff]',
  shimmer: 'from-[#f8b3ff] via-[#a88cff] to-[#64dcff]',
};

const DEFAULT_WELCOME_MENU = {
  enabled: true,
  body: '',
  button_text: 'Choose option',
  footer: '',
  section_title: 'How can I help?',
  options: [
    {
      id: 'express_installation',
      title: 'Installation',
      description: 'Get connected or request a new setup.',
      text: 'I want to request a new installation.',
    },
    {
      id: 'express_billing',
      title: 'Billing & Payments',
      description: 'Check payments, expiry, plan or account status.',
      text: 'I need help with billing or payments.',
    },
    {
      id: 'express_technical',
      title: 'Technical Support',
      description: 'Internet down, slow speeds, router or fibre issue.',
      text: 'My internet has a technical issue.',
    },
    {
      id: 'express_general',
      title: 'General Inquiry',
      description: 'Ask about packages, coverage or anything else.',
      text: 'I have a general inquiry.',
    },
  ],
};

function SettingsCard({ icon, title, description, children }) {
  return (
    <section className="rounded-[24px] border border-[#e9e7f5] bg-white p-5 shadow-[0_18px_45px_rgba(24,18,70,0.05)] sm:p-6">
      <div className="mb-4 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0ebff] text-[#5b35f5]">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-black text-[#171733]">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#7d829b]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function VoiceOrb({ voiceId }) {
  return (
    <div className={`relative h-16 w-16 overflow-hidden rounded-full bg-gradient-to-br ${VOICE_GRADIENTS[voiceId] || VOICE_GRADIENTS.alloy}`}>
      <div className="absolute inset-x-2 top-1/2 h-px bg-white/55" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.45),transparent_32%)]" />
    </div>
  );
}

const AGENT_STATUS_COPY = {
  configured: ['Configured', 'border-slate-200 bg-slate-50 text-slate-600'],
  provisioning: ['OTP pending', 'border-amber-100 bg-amber-50 text-amber-700'],
  pending_qr: ['Waiting for WhatsApp link', 'border-blue-100 bg-blue-50 text-blue-700'],
  connected: ['Connected, awaiting review', 'border-indigo-100 bg-indigo-50 text-indigo-700'],
  reviewed: ['Reviewed by onboarding team', 'border-purple-100 bg-purple-50 text-purple-700'],
  active: ['Active', 'border-emerald-100 bg-emerald-50 text-emerald-700'],
  failed: ['Needs attention', 'border-red-100 bg-red-50 text-red-700'],
};

function AgentStatusCard({ agent, selected = false, onOpen }) {
  const [label, className] = AGENT_STATUS_COPY[agent.status] || [agent.status || 'Pending', 'border-slate-200 bg-slate-50 text-slate-600'];
  const canOpen = agent.kind === 'primary' || agent.workspace_available;
  return (
    <div className={`rounded-2xl border bg-[#fbfcff] p-4 transition ${selected ? 'border-[#6c4cff] ring-4 ring-[#efeaff]' : 'border-[#e7e9f2]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-[#171733]">{agent.label || agent.agent_name}</div>
          <div className="mt-1 text-xs font-bold text-[#7d829b]">{agent.connected_number || agent.phone || 'WhatsApp number pending'}</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${className}`}>{label}</span>
      </div>
      <div className="mt-3 grid gap-2 text-xs font-semibold text-[#7d829b] sm:grid-cols-2">
        <div className="min-w-0">Instance: <span className="break-all font-mono text-[#4f35f5]">{agent.instance_name || 'not assigned'}</span></div>
        <div>Stage: <span className="text-[#171733]">{agent.connection_state || 'workspace'}</span></div>
      </div>
      {agent.provider_error && <div className="mt-3 break-words rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{agent.provider_error}</div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold text-[#858aa2]">
          {canOpen ? 'Available in this dashboard' : 'Waiting for onboarding review'}
        </span>
        <button
          type="button"
          onClick={() => onOpen(agent)}
          disabled={!canOpen}
          className="h-10 rounded-xl bg-[#4f35f5] px-4 text-xs font-black text-white shadow-[0_10px_22px_rgba(79,53,245,0.16)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
        >
          {selected ? 'Workspace Open' : 'Open Workspace'}
        </button>
      </div>
    </div>
  );
}

export default function Agent() {
  const { admin } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientIdParam = searchParams.get('clientId');
  const [clientName, setClientName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [voiceId, setVoiceId] = useState('alloy');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [supportNumber, setSupportNumber] = useState('');
  const [welcomeMenu, setWelcomeMenu] = useState(DEFAULT_WELCOME_MENU);
  const [agentsInfo, setAgentsInfo] = useState({ agents: [], onboarding_path: '/self-onboarding' });
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [blockedNumbers, setBlockedNumbers] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [blockForm, setBlockForm] = useState({ phone: '', reason: '' });
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockStatus, setBlockStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (admin?.role === 'superadmin' && !clientIdParam) {
      navigate('/dashboard/clients', { replace: true });
    }
  }, [admin, clientIdParam, navigate]);

  const settingsQuery = clientIdParam ? `?clientId=${clientIdParam}` : '';

  const fetchAgents = async () => {
    setAgentsLoading(true);
    try {
      const { data } = await api.get(`/settings/agents${settingsQuery}`);
      const agents = Array.isArray(data.agents) ? data.agents : [];
      setAgentsInfo({
        agents,
        onboarding_path: data.onboarding_path || '/self-onboarding',
        onboarding_url: data.onboarding_url || '',
      });
      setSelectedAgentId((current) => (
        agents.some((agent) => String(agent.id) === String(current)) ? current : agents[0]?.id || ''
      ));
    } catch (err) {
      console.error('Failed to fetch agents:', err.message);
    } finally {
      setAgentsLoading(false);
    }
  };

  const fetchBlockedNumbers = async () => {
    setBlockedLoading(true);
    try {
      const { data } = await api.get(`/settings/blocked-numbers${settingsQuery}`);
      setBlockedNumbers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch blocked numbers:', err.message);
      setBlockStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load blocked numbers.' });
    } finally {
      setBlockedLoading(false);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    setStatus(null);
    setErrorMessage('');
    try {
      const { data } = await api.get(`/settings${settingsQuery}`);
      setAgentName(data.agent_name || '');
      setVoiceId(data.voice_id || 'alloy');
      setSystemPrompt(data.system_prompt || '');
      setSupportNumber(data.support_number || '');
      setWelcomeMenu({
        ...DEFAULT_WELCOME_MENU,
        ...(data.welcome_menu || {}),
        options: data.welcome_menu?.options?.length
          ? data.welcome_menu.options
          : DEFAULT_WELCOME_MENU.options,
      });
    } catch (err) {
      console.error('Failed to fetch agent settings:', err.message);
      setStatus('error');
      setErrorMessage(err.response?.data?.error || 'Failed to load agent configuration.');
    } finally {
      setLoading(false);
    }
  };

  const fetchClientName = async (id) => {
    try {
      const { data } = await api.get(`/clients/${id}`);
      setClientName(data.business_name || data.name || '');
    } catch (err) {
      console.error('Failed to fetch client name:', err.message);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchAgents();
    fetchBlockedNumbers();
    if (clientIdParam) fetchClientName(clientIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  const selectedVoice = useMemo(
    () => VOICE_OPTIONS.find((voice) => voice.id === voiceId) || VOICE_OPTIONS[0],
    [voiceId]
  );

  const displayName = agentName.trim() || 'Agent';
  const selectedAgent = useMemo(() => (
    agentsInfo.agents.find((agent) => String(agent.id) === String(selectedAgentId))
    || agentsInfo.agents[0]
    || null
  ), [agentsInfo.agents, selectedAgentId]);
  const openAddAgent = () => {
    window.location.href = agentsInfo.onboarding_path || '/self-onboarding';
  };
  const openAgentWorkspace = (agent) => {
    setSelectedAgentId(agent.id);
  };

  const blockNumber = async () => {
    if (!blockForm.phone.trim()) {
      setBlockStatus({ type: 'error', message: 'Enter a phone number to block.' });
      return;
    }
    setBlockSaving(true);
    setBlockStatus(null);
    try {
      const { data } = await api.post(`/settings/blocked-numbers${settingsQuery}`, {
        phone: blockForm.phone,
        reason: blockForm.reason,
      });
      setBlockedNumbers((current) => [data, ...current.filter((row) => row.id !== data.id)]);
      setBlockForm({ phone: '', reason: '' });
      setBlockStatus({ type: 'success', message: 'Number blocked. The agent will no longer send replies to it.' });
    } catch (err) {
      setBlockStatus({ type: 'error', message: err.response?.data?.error || 'Failed to block number.' });
    } finally {
      setBlockSaving(false);
    }
  };

  const unblockNumber = async (id) => {
    try {
      await api.delete(`/settings/blocked-numbers/${id}${settingsQuery}`);
      setBlockedNumbers((current) => current.filter((row) => row.id !== id));
      setBlockStatus({ type: 'success', message: 'Number unblocked.' });
    } catch (err) {
      setBlockStatus({ type: 'error', message: err.response?.data?.error || 'Failed to unblock number.' });
    }
  };

  const isValidSupportNumber = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return /^\+?[0-9][0-9\s\-()]{6,19}$/.test(trimmed);
  };

  const save = async () => {
    if (!systemPrompt.trim()) {
      setStatus('error');
      setErrorMessage('System prompt cannot be empty.');
      return;
    }
    if (!isValidSupportNumber(supportNumber)) {
      setStatus('error');
      setErrorMessage('Enter a valid phone number (e.g. +254712345678) or leave it blank.');
      return;
    }
    if (agentName.length > 80) {
      setStatus('error');
      setErrorMessage('Agent name must be 80 characters or fewer.');
      return;
    }

    setSaving(true);
    setStatus(null);
    setErrorMessage('');
    try {
      await api.put(`/settings${settingsQuery}`, {
        agent_name: agentName.trim(),
        voice_id: voiceId,
        system_prompt: systemPrompt,
        support_number: supportNumber.trim(),
        welcome_menu: welcomeMenu,
      });
      setStatus('success');
      setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      console.error('Failed to save agent settings:', err.message);
      setStatus('error');
      setErrorMessage(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setStatus(null);
    setErrorMessage('');
    fetchSettings();
  };

  const updateWelcomeMenu = (field, value) => {
    setWelcomeMenu((current) => ({ ...current, [field]: value }));
  };

  const updateWelcomeOption = (index, field, value) => {
    setWelcomeMenu((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) => (
        optionIndex === index ? { ...option, [field]: value } : option
      )),
    }));
  };

  const addWelcomeOption = () => {
    setWelcomeMenu((current) => {
      const options = Array.isArray(current.options) ? current.options : [];
      if (options.length >= 10) return current;
      return {
        ...current,
        options: [
          ...options,
          {
            id: `welcome_option_${Date.now()}`,
            title: '',
            description: '',
            text: '',
          },
        ],
      };
    });
  };

  const removeWelcomeOption = (index) => {
    setWelcomeMenu((current) => ({
      ...current,
      options: (current.options || []).filter((_, optionIndex) => optionIndex !== index),
    }));
  };

  const moveWelcomeOption = (index, direction) => {
    setWelcomeMenu((current) => {
      const options = [...(current.options || [])];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= options.length) return current;
      [options[index], options[nextIndex]] = [options[nextIndex], options[index]];
      return { ...current, options };
    });
  };

  if (loading) {
    return (
      <div className="flex-1 bg-[#fbfcff]">
        <div className="flex h-full items-center justify-center text-sm font-semibold text-[#8b90a8]">
          Loading agent configuration...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#fbfcff] p-5 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-7 flex items-center gap-2 text-sm font-bold text-[#8d91a8]">
              <span>Settings</span>
              <span className="text-[#c5c7d4]">/</span>
              <span className="text-[#171733]">Agent Configuration</span>
            </div>
            <h1 className="flex items-center gap-2 text-3xl font-black tracking-tight text-[#111233]">
              Agent Configuration
              <span className="text-[#5b35f5]">*</span>
              {clientName && <span className="text-lg font-bold text-[#81869f]">- {clientName}</span>}
            </h1>
            <p className="mt-2 text-sm font-medium text-[#858aa2]">
              Monitor support, installations, complaints and AI performance.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={cancelEdit}
              className="h-12 rounded-xl border border-[#e0e3ef] bg-white px-6 text-sm font-black text-[#343850] shadow-sm transition hover:border-[#c9cce0]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !systemPrompt.trim()}
              className="h-12 rounded-xl bg-[#4f35f5] px-7 text-sm font-black text-white shadow-[0_14px_30px_rgba(79,53,245,0.25)] transition hover:bg-[#3d27d8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </header>

        {status && (
          <div
            className={`mb-5 flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${
              status === 'success'
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : 'border-red-100 bg-red-50 text-red-700'
            }`}
          >
            {status === 'success' ? (
              <CheckCircleIcon className="h-4 w-4" />
            ) : (
              <WarningIcon className="h-4 w-4" />
            )}
            {status === 'success' ? 'Saved successfully' : errorMessage || 'Failed to save settings'}
          </div>
        )}

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0 space-y-5">
            <SettingsCard
              icon={<AgentIcon className="h-5 w-5" />}
              title="WhatsApp Agents"
              description="Add another WhatsApp number through Evolution onboarding and track each stage from here."
            >
              {selectedAgent && (
                <div className="mb-4 rounded-2xl border border-[#dcd7ff] bg-gradient-to-br from-[#fbfaff] to-white p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#6a55f5]">Open workspace</div>
                      <h3 className="mt-1 text-xl font-black text-[#171733]">{selectedAgent.label || selectedAgent.agent_name}</h3>
                      <p className="mt-1 text-sm font-semibold text-[#747b98]">
                        {selectedAgent.kind === 'primary'
                          ? 'Primary agent workspace for this dashboard.'
                          : 'Additional WhatsApp agent attached to this same dashboard.'}
                      </p>
                    </div>
                    <div className="grid gap-2 text-xs font-bold text-[#6c728b] sm:grid-cols-3 lg:min-w-[420px]">
                      <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                        Number
                        <span className="mt-1 block break-all font-mono text-[#171733]">{selectedAgent.connected_number || selectedAgent.phone || 'Pending'}</span>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                        Instance
                        <span className="mt-1 block break-all font-mono text-[#4f35f5]">{selectedAgent.instance_name || 'Pending'}</span>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                        Status
                        <span className="mt-1 block text-[#171733]">{AGENT_STATUS_COPY[selectedAgent.status]?.[0] || selectedAgent.status || 'Configured'}</span>
                      </div>
                    </div>
                  </div>
                  {selectedAgent.kind !== 'primary' && (
                    <div className="mt-4 rounded-xl bg-white px-4 py-3 text-xs font-bold leading-5 text-[#747b98]">
                      This workspace stays inside the current client dashboard. Use it to confirm the reviewed number and monitor the onboarding stage without creating a separate client login.
                    </div>
                  )}
                </div>
              )}
              <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#e7e9f2] bg-[#fbfcff] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-[#171733]">Agent panels</div>
                  <div className="mt-1 text-xs font-semibold text-[#858aa2]">Agent One is your current dashboard agent. Additional agents appear here after onboarding.</div>
                </div>
                <button
                  type="button"
                  onClick={openAddAgent}
                  className="h-11 rounded-xl bg-[#4f35f5] px-5 text-sm font-black text-white shadow-[0_10px_22px_rgba(79,53,245,0.2)]"
                >
                  Add Agent
                </button>
              </div>
              {agentsLoading ? (
                <div className="rounded-2xl border border-dashed border-[#d7dbea] bg-white px-4 py-6 text-center text-sm font-bold text-[#858aa2]">Loading agent status...</div>
              ) : (
                <div className="grid gap-3">
                  {agentsInfo.agents.map((agent) => (
                    <AgentStatusCard
                      key={`${agent.kind}-${agent.id}`}
                      agent={agent}
                      selected={String(selectedAgent?.id || '') === String(agent.id)}
                      onOpen={openAgentWorkspace}
                    />
                  ))}
                </div>
              )}
            </SettingsCard>

            <SettingsCard
              icon={<WarningIcon className="h-5 w-5" />}
              title="Blocked Numbers"
              description="Flag a WhatsApp number so the agent records incoming messages but does not send automated replies."
            >
              {blockStatus && (
                <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${blockStatus.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                  {blockStatus.message}
                </div>
              )}
              <div className="grid gap-3 rounded-2xl border border-[#e7e9f2] bg-[#fbfcff] p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">Phone number</span>
                  <input
                    value={blockForm.phone}
                    onChange={(event) => setBlockForm((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="2547XXXXXXXX"
                    className="h-11 w-full rounded-xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5]"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">Reason</span>
                  <input
                    value={blockForm.reason}
                    onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Spam, abuse, wrong contact..."
                    className="h-11 w-full rounded-xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5]"
                  />
                </label>
                <button
                  type="button"
                  onClick={blockNumber}
                  disabled={blockSaving}
                  className="h-11 rounded-xl bg-[#171733] px-5 text-sm font-black text-white disabled:opacity-50"
                >
                  {blockSaving ? 'Blocking...' : 'Block'}
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {blockedLoading ? (
                  <div className="rounded-2xl border border-dashed border-[#d7dbea] bg-white px-4 py-6 text-center text-sm font-bold text-[#858aa2]">Loading blocked numbers...</div>
                ) : blockedNumbers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#d7dbea] bg-white px-4 py-6 text-center text-sm font-bold text-[#858aa2]">No blocked numbers yet.</div>
                ) : blockedNumbers.map((row) => (
                  <div key={row.id} className="flex flex-col gap-3 rounded-2xl border border-[#e7e9f2] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-mono text-sm font-black text-[#171733]">{row.phone}</div>
                      <div className="mt-1 text-xs font-semibold text-[#858aa2]">{row.reason || 'No reason added'} · {new Date(row.created_at).toLocaleDateString()}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => unblockNumber(row.id)}
                      className="h-10 rounded-xl border border-red-100 bg-red-50 px-4 text-xs font-black text-red-600"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            </SettingsCard>

            <SettingsCard
              icon={<AgentIcon className="h-5 w-5" />}
              title="Agent Name"
              description="The AI will introduce itself with this name when customers ask who they're speaking to."
            >
              <input
                type="text"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                maxLength={80}
                placeholder="e.g. Asha"
                className="h-14 w-full rounded-2xl border border-[#9b83ff] bg-white px-5 text-base font-semibold text-[#15162f] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
              />
            </SettingsCard>

            <SettingsCard
              icon={<PulseIcon className="h-5 w-5" />}
              title="Voice for Voice Notes"
              description="When a customer sends a voice note, the AI replies with a voice note in this voice."
            >
              <div className="grid gap-4 md:grid-cols-2">
                {VOICE_OPTIONS.map((voice) => {
                  const selected = voice.id === voiceId;
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => setVoiceId(voice.id)}
                      className={`flex min-h-[116px] items-center gap-4 rounded-2xl border bg-white p-4 text-left transition ${
                        selected
                          ? 'border-[#8d70ff] shadow-[0_12px_30px_rgba(91,53,245,0.12)] ring-2 ring-[#eee9ff]'
                          : 'border-[#e6e8f2] hover:border-[#cfd2e4] hover:shadow-sm'
                      }`}
                    >
                      <VoiceOrb voiceId={voice.id} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-base font-black text-[#171733]">{voice.label}</span>
                          {selected && (
                            <span className="rounded-full bg-[#ede8ff] px-2 py-1 text-[10px] font-black text-[#5b35f5]">
                              Selected
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-sm leading-relaxed text-[#686e86]">
                          {voice.description}
                        </span>
                      </span>
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected ? 'border-[#4f35f5] bg-[#4f35f5]' : 'border-[#cbd0df] bg-white'
                        }`}
                      >
                        {selected && <CheckCircleIcon className="h-3.5 w-3.5 text-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 rounded-2xl border border-[#ded6ff] bg-[#fbfaff] px-4 py-3 text-sm font-medium text-[#686e86]">
                Voice settings can be changed at any time. Changes apply to new interactions.
              </div>
            </SettingsCard>

            <SettingsCard
              icon={<LifebuoyIcon className="h-5 w-5" />}
              title="Live Support Phone Number"
              description="The AI shares this number with customers when escalating to a human. Leave blank to disable."
            >
              <input
                type="tel"
                value={supportNumber}
                onChange={(event) => setSupportNumber(event.target.value)}
                placeholder="+254712345678"
                className="h-14 w-full rounded-2xl border border-[#e4e7f1] bg-white px-5 text-base font-semibold text-[#15162f] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
              />
            </SettingsCard>

            <SettingsCard
              icon={<AgentIcon className="h-5 w-5" />}
              title="System Prompt"
              description="Sets the personality, tone, and rules the AI follows when responding to customers."
            >
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={10}
                placeholder="You are a helpful and professional customer support agent..."
                className="w-full resize-y rounded-2xl border border-[#e4e7f1] bg-white px-5 py-4 font-mono text-sm leading-relaxed text-[#15162f] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
              />
              <p className="mt-3 rounded-2xl border border-[#ded6ff] bg-[#fbfaff] px-4 py-3 text-sm font-bold text-[#686e86]">
                Use media tags from Knowledge Base, for example <span className="font-black text-[#4f35f5]">{'{image1}'}</span>. The customer will not see the tag; the agent sends the linked media.
              </p>
            </SettingsCard>

            <SettingsCard
              icon={<PulseIcon className="h-5 w-5" />}
              title="Interactive Welcome Buttons"
              description="Configure the first WhatsApp menu customers see when they start a chat or type menu."
            >
              <div className="mb-4 flex items-center justify-between rounded-2xl border border-[#e7e9f2] bg-[#fbfcff] px-4 py-3">
                <div>
                  <div className="text-sm font-black text-[#171733]">Welcome menu</div>
                  <div className="mt-1 text-xs font-semibold text-[#858aa2]">
                    Shows request installation, billing, support and general inquiry options.
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-black text-[#4f35f5]">
                  <input
                    type="checkbox"
                    checked={welcomeMenu.enabled}
                    onChange={(event) => updateWelcomeMenu('enabled', event.target.checked)}
                    className="h-4 w-4 accent-[#4f35f5]"
                  />
                  Enabled
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                  Welcome message
                </span>
                <textarea
                  rows={3}
                  value={welcomeMenu.body}
                  onChange={(event) => updateWelcomeMenu('body', event.target.value)}
                  placeholder="Leave blank to use the automatic greeting with agent and business name."
                  className="w-full resize-y rounded-2xl border border-[#e4e7f1] bg-white px-4 py-3 text-sm font-semibold text-[#15162f] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
                />
                <span className="mt-2 block text-xs font-bold text-[#858aa2]">
                  Add a media tag like {'{image1}'} here to send that media with the welcome menu.
                </span>
              </label>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                    Open button
                  </span>
                  <input
                    value={welcomeMenu.button_text}
                    maxLength={20}
                    onChange={(event) => updateWelcomeMenu('button_text', event.target.value)}
                    className="h-12 w-full rounded-2xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                    Section title
                  </span>
                  <input
                    value={welcomeMenu.section_title}
                    maxLength={24}
                    onChange={(event) => updateWelcomeMenu('section_title', event.target.value)}
                    className="h-12 w-full rounded-2xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                    Footer
                  </span>
                  <input
                    value={welcomeMenu.footer}
                    maxLength={60}
                    onChange={(event) => updateWelcomeMenu('footer', event.target.value)}
                    placeholder="Optional"
                    className="h-12 w-full rounded-2xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5] focus:ring-4 focus:ring-[#ede8ff]"
                  />
                </label>
              </div>

              <div className="mt-4 space-y-3">
                {welcomeMenu.options.map((option, index) => (
                  <div key={option.id || index} className="rounded-2xl border border-[#e7e9f2] bg-[#fbfcff] p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                        Option {index + 1}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => moveWelcomeOption(index, -1)}
                          disabled={index === 0}
                          className="h-8 rounded-lg border border-[#dfe2ee] bg-white px-3 text-xs font-black text-[#59607a] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWelcomeOption(index, 1)}
                          disabled={index === welcomeMenu.options.length - 1}
                          className="h-8 rounded-lg border border-[#dfe2ee] bg-white px-3 text-xs font-black text-[#59607a] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() => removeWelcomeOption(index)}
                          className="h-8 rounded-lg border border-red-100 bg-red-50 px-3 text-xs font-black text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label>
                        <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                          Button title
                        </span>
                        <input
                          value={option.title}
                          maxLength={24}
                          onChange={(event) => updateWelcomeOption(index, 'title', event.target.value)}
                          className="h-11 w-full rounded-xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5]"
                        />
                      </label>
                      <label>
                        <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                          Description
                        </span>
                        <input
                          value={option.description}
                          maxLength={72}
                          onChange={(event) => updateWelcomeOption(index, 'description', event.target.value)}
                          className="h-11 w-full rounded-xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5]"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-[#8a8fa6]">
                        Message sent to AI
                      </span>
                      <input
                        value={option.text}
                        onChange={(event) => updateWelcomeOption(index, 'text', event.target.value)}
                        className="h-11 w-full rounded-xl border border-[#e4e7f1] bg-white px-4 text-sm font-bold text-[#15162f] outline-none focus:border-[#5b35f5]"
                      />
                    </label>
                  </div>
                ))}
                {welcomeMenu.options.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[#d7dbea] bg-white px-4 py-6 text-center text-sm font-bold text-[#858aa2]">
                    No welcome options yet.
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-bold text-[#858aa2]">
                  {welcomeMenu.options.length}/10 options configured
                </div>
                <button
                  type="button"
                  onClick={addWelcomeOption}
                  disabled={welcomeMenu.options.length >= 10}
                  className="h-11 rounded-xl bg-[#4f35f5] px-5 text-sm font-black text-white shadow-[0_10px_22px_rgba(79,53,245,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Option
                </button>
              </div>
            </SettingsCard>
          </main>

          <aside className="min-w-0 2xl:sticky 2xl:top-6 2xl:self-start">
            <div className="rounded-[26px] border border-[#eceaf7] bg-white p-6 shadow-[0_24px_60px_rgba(25,19,75,0.08)]">
              <h2 className="text-lg font-black text-[#171733]">Agent Summary</h2>

              <div className="mt-8 flex flex-col items-center text-center">
                <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#ded6ff] via-[#9c86ff] to-[#f3f0ff] p-1">
                  <img
                    src={robotAgentImage}
                    alt="AI agent"
                    className="h-full w-full rounded-full border-4 border-white object-cover object-top shadow-lg"
                  />
                  <span className="absolute -right-2 top-8 h-2 w-2 rounded-full bg-[#7f69ff]" />
                  <span className="absolute left-0 top-10 h-2 w-2 rounded-full bg-[#bbaeff]" />
                </div>
                <div className="mt-4 text-base font-black text-[#171733]">{displayName}</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Active
                </div>
              </div>

              <div className="mt-8 divide-y divide-[#eef0f6]">
                <div className="flex items-center gap-4 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0ebff] text-[#5b35f5]">
                    <PulseIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-[#171733]">Voice for Voice Notes</div>
                    <div className="mt-1 text-sm font-bold text-[#5b35f5]">{selectedVoice.label}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0ebff] text-[#5b35f5]">
                    <LifebuoyIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-[#171733]">Escalation</div>
                    <div className="mt-1 text-sm font-bold text-[#59607a]">
                      {supportNumber.trim() ? supportNumber.trim() : 'Not configured'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0ebff] text-[#5b35f5]">
                    <CheckCircleIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-[#171733]">Welcome Menu</div>
                    <div className="mt-1 text-sm font-bold text-[#59607a]">
                      {welcomeMenu.enabled ? `${welcomeMenu.options.length} buttons active` : 'Disabled'}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#d8d0ff] bg-white text-sm font-black text-[#5b35f5] transition hover:bg-[#fbfaff]"
              >
                <span className="text-base">&gt;</span>
                Preview Agent
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
