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
    if (clientIdParam) fetchClientName(clientIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  const selectedVoice = useMemo(
    () => VOICE_OPTIONS.find((voice) => voice.id === voiceId) || VOICE_OPTIONS[0],
    [voiceId]
  );

  const displayName = agentName.trim() || 'Agent';

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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="space-y-5">
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
                Use media tags from Settings, for example <span className="font-black text-[#4f35f5]">{'{image1}'}</span>. The customer will not see the tag; the agent sends the linked media.
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

          <aside className="xl:sticky xl:top-6 xl:self-start">
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
