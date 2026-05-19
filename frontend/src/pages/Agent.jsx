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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
            maxLength={80}
            placeholder="e.g. Asha"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
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
                  className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                    selected
                      ? 'bg-[#3535FF] border-[#3535FF] text-white'
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-gray-900'
                  }`}
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
            rows={12}
            placeholder="You are a helpful and professional customer support agent..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-y font-mono"
          />
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
            placeholder="+254712345678"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
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
            disabled={saving || !systemPrompt.trim()}
            className="bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
