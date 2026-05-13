import React, { useState, useEffect } from 'react';
import api from '../utils/api';

export default function Settings() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error'

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/settings');
      setSystemPrompt(data.system_prompt || '');
    } catch (err) {
      console.error('Failed to fetch settings:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!systemPrompt.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      await api.put('/settings', { system_prompt: systemPrompt });
      setStatus('success');
      setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      console.error('Failed to save settings:', err.message);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure how the AI assistant behaves</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">AI System Prompt</h2>
            <p className="text-xs text-gray-500 mt-1">
              This prompt sets the personality, tone, and rules the AI follows when responding to
              customers. Changes take effect on the next incoming message.
            </p>
          </div>

          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y font-mono"
            rows={12}
            placeholder="You are a helpful and professional customer support agent..."
          />

          <div className="flex items-center justify-between mt-4">
            <div>
              {status === 'success' && (
                <span className="text-green-600 text-sm flex items-center gap-1.5">
                  <span>✓</span> Settings saved successfully
                </span>
              )}
              {status === 'error' && (
                <span className="text-red-600 text-sm flex items-center gap-1.5">
                  <span>✗</span> Failed to save settings
                </span>
              )}
            </div>
            <button
              onClick={saveSettings}
              disabled={saving || !systemPrompt.trim()}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-amber-800 mb-1">Tips for a great system prompt</h3>
          <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
            <li>Define the agent's name, tone, and personality</li>
            <li>Specify topics the agent should and should not discuss</li>
            <li>Include escalation instructions ("tell customer an agent will follow up")</li>
            <li>Add company-specific information like hours, policies, or product details</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
