import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { CheckCircleIcon, WarningIcon } from '../components/Icons';

const VOICE_OPTIONS = [
  { id: 'alloy', label: 'Alloy', description: 'Neutral, balanced — works for most use cases' },
  { id: 'echo', label: 'Echo', description: 'Calm and grounded male timbre' },
  { id: 'fable', label: 'Fable', description: 'Warm storyteller, expressive and friendly' },
  { id: 'onyx', label: 'Onyx', description: 'Deep, authoritative male voice' },
  { id: 'nova', label: 'Nova', description: 'Bright and energetic female voice' },
  { id: 'shimmer', label: 'Shimmer', description: 'Soft, gentle female voice' },
];

const DEFAULT_WELCOME_MENU = {
  enabled: true,
  body: '',
  button_text: 'Choose option',
  footer: '',
  section_title: 'How can I help?',
  options: [
    { id: 'express_installation', title: 'Installation', description: 'Get connected or request a new setup.', text: 'I want to request a new installation.' },
    { id: 'express_billing', title: 'Billing & Payments', description: 'Check payments, expiry, plan or account status.', text: 'I need help with billing or payments.' },
    { id: 'express_technical', title: 'Technical Support', description: 'Internet down, slow speeds, router or fibre issue.', text: 'My internet has a technical issue.' },
    { id: 'express_general', title: 'General Inquiry', description: 'Ask about packages, coverage or anything else.', text: 'I have a general inquiry.' },
  ],
};

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
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Superadmin must reach this page via ?clientId=; redirect them to Clients otherwise.
  useEffect(() => {
    if (admin?.role === 'superadmin' && !clientIdParam) {
      navigate('/dashboard/clients', { replace: true });
    }
  }, [admin, clientIdParam, navigate]);

  useEffect(() => {
    fetchSettings();
    if (clientIdParam) fetchClientName(clientIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  const settingsQuery = clientIdParam ? `?clientId=${clientIdParam}` : '';

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/settings${settingsQuery}`);
      setAgentName(data.agent_name || '');
      setVoiceId(data.voice_id || 'alloy');
      setSystemPrompt(data.system_prompt || '');
      setSupportNumber(data.support_number || '');
      setWelcomeMenu({
        ...DEFAULT_WELCOME_MENU,
        ...(data.welcome_menu || {}),
        options: data.welcome_menu?.options?.length ? data.welcome_menu.options : DEFAULT_WELCOME_MENU.options,
      });
      setEditing(false);
    } catch (err) {
      console.error('Failed to fetch agent settings:', err.message);
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
      setEditing(false);
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading agent configuration...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Agent Configuration
            {clientName && <span className="text-base font-normal text-gray-500"> — {clientName}</span>}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Name, voice, behavior, and escalation contact for the AI assistant
          </p>
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">
                {editing ? 'Editing unlocked' : 'Configuration locked'}
              </div>
              <div className="mt-1 text-sm font-semibold text-amber-800">
                {editing
                  ? 'Changes here affect live customer-facing behavior.'
                  : 'Viewing mode is locked. Unlock before changing prompts, buttons or support routing.'}
              </div>
            </div>
            {editing ? (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-full border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-50"
              >
                Cancel edit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-black text-white hover:bg-slate-800"
              >
                Edit configuration
              </button>
            )}
          </div>
        </div>

        {/* Identity */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-gray-900">Agent Name</h2>
            <p className="text-xs text-gray-500 mt-1">
              The AI will introduce itself with this name when customers ask who they're speaking to.
            </p>
          </div>
          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            disabled={!editing}
            maxLength={80}
            placeholder="e.g. Asha"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        {/* Voice */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-gray-900">Voice Note Voice</h2>
            <p className="text-xs text-gray-500 mt-1">
              When a customer sends a voice note, the AI replies with a voice note in this voice.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {VOICE_OPTIONS.map((opt) => {
              const selected = voiceId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setVoiceId(opt.id)}
                  disabled={!editing}
                  className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                    selected
                      ? 'bg-[#3535FF] border-[#3535FF] text-white'
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-gray-900'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {selected && (
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-white/20 px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      selected ? 'text-white/80' : 'text-gray-500'
                    }`}
                  >
                    {opt.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* System prompt */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-gray-900">System Prompt</h2>
            <p className="text-xs text-gray-500 mt-1">
              Sets the personality, tone, and rules the AI follows when responding to customers.
              Changes take effect on the next incoming message.
            </p>
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={!editing}
            rows={12}
            placeholder="You are a helpful and professional customer support agent..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-y font-mono disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        {/* Interactive welcome menu */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Interactive Welcome Buttons</h2>
              <p className="text-xs text-gray-500 mt-1">
                Configure the first WhatsApp menu customers see when they start a chat or type menu.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
              <input
                type="checkbox"
                checked={welcomeMenu.enabled}
                onChange={(e) => updateWelcomeMenu('enabled', e.target.checked)}
                disabled={!editing}
                className="h-4 w-4 accent-[#3535FF]"
              />
              Enabled
            </label>
          </div>

          <label className="block mb-3">
            <span className="block text-xs font-bold text-gray-600 mb-1.5">Welcome message</span>
            <textarea
              rows={3}
              value={welcomeMenu.body}
              onChange={(e) => updateWelcomeMenu('body', e.target.value)}
              disabled={!editing}
              placeholder="Leave blank to use the automatic greeting with agent and business name."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-y disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <label>
              <span className="block text-xs font-bold text-gray-600 mb-1.5">Open button text</span>
              <input
                value={welcomeMenu.button_text}
                maxLength={20}
                onChange={(e) => updateWelcomeMenu('button_text', e.target.value)}
                disabled={!editing}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              />
            </label>
            <label>
              <span className="block text-xs font-bold text-gray-600 mb-1.5">Section title</span>
              <input
                value={welcomeMenu.section_title}
                maxLength={24}
                onChange={(e) => updateWelcomeMenu('section_title', e.target.value)}
                disabled={!editing}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              />
            </label>
            <label>
              <span className="block text-xs font-bold text-gray-600 mb-1.5">Footer</span>
              <input
                value={welcomeMenu.footer}
                maxLength={60}
                onChange={(e) => updateWelcomeMenu('footer', e.target.value)}
                disabled={!editing}
                placeholder="Optional"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              />
            </label>
          </div>

          <div className="space-y-3">
            {welcomeMenu.options.map((option, index) => (
              <div key={option.id || index} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label>
                    <span className="block text-xs font-bold text-gray-600 mb-1.5">Button title</span>
                    <input
                      value={option.title}
                      maxLength={24}
                      onChange={(e) => updateWelcomeOption(index, 'title', e.target.value)}
                      disabled={!editing}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </label>
                  <label>
                    <span className="block text-xs font-bold text-gray-600 mb-1.5">Description</span>
                    <input
                      value={option.description}
                      maxLength={72}
                      onChange={(e) => updateWelcomeOption(index, 'description', e.target.value)}
                      disabled={!editing}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </label>
                </div>
                <label className="block mt-3">
                  <span className="block text-xs font-bold text-gray-600 mb-1.5">Message sent to AI after customer chooses it</span>
                  <input
                    value={option.text}
                    onChange={(e) => updateWelcomeOption(index, 'text', e.target.value)}
                    disabled={!editing}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Support number */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-gray-900">Live Support Phone Number</h2>
            <p className="text-xs text-gray-500 mt-1">
              The AI shares this number with customers when escalating to a human, and forwards
              human-takeover requests here. Use international format (e.g. +254712345678). Leave
              blank to disable.
            </p>
          </div>
          <input
            type="tel"
            value={supportNumber}
            onChange={(e) => setSupportNumber(e.target.value)}
            disabled={!editing}
            placeholder="+254712345678"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        {/* Save bar */}
        <div className="flex items-center justify-between pt-2 pb-8">
          <div>
            {status === 'success' && (
              <span className="text-emerald-600 text-sm flex items-center gap-1.5 font-medium">
                <CheckCircleIcon className="w-4 h-4" /> Saved successfully
              </span>
            )}
            {status === 'error' && (
              <span className="text-red-600 text-sm flex items-center gap-1.5 font-medium">
                <WarningIcon className="w-4 h-4" /> {errorMessage || 'Failed to save settings'}
              </span>
            )}
          </div>
          <button
            onClick={save}
            disabled={!editing || saving || !systemPrompt.trim()}
            className="bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
