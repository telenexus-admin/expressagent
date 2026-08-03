import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { LifebuoyIcon, WarningIcon, ArrowRightIcon } from '../components/Icons';

function HealthRing({ score, status }) {
  const radius = 72;
  const stroke = 12;
  const norm = radius - stroke / 2;
  const circ = 2 * Math.PI * norm;
  const offset = circ - (score / 100) * circ;

  const colors = {
    healthy: '#10B981',
    warning: '#F59E0B',
    critical: '#EF4444',
  };
  const color = colors[status] || '#3535FF';

  return (
    <div className="relative w-44 h-44 shrink-0">
      <svg width="176" height="176" viewBox="0 0 176 176">
        <circle cx="88" cy="88" r={norm} stroke="#F3F4F6" strokeWidth={stroke} fill="none" />
        <circle
          cx="88"
          cy="88"
          r={norm}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 88 88)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-gray-900">{score}</span>
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
          Health Score
        </span>
      </div>
    </div>
  );
}

function Bar({ label, value, color = '#3535FF' }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-700 font-medium">{label}</span>
        <span className="text-sm font-bold text-gray-900">{pct}%</span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function AIHealth() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await api.get('/analytics');
        setData(data);
        setError('');
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading AI health...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-red-500 text-sm">{error || 'No data'}</div>
      </div>
    );
  }

  const { ai_health } = data;

  const statusLabel = {
    healthy: 'Healthy',
    warning: 'Needs attention',
    critical: 'Critical',
  }[ai_health.status];

  const statusColor = {
    healthy: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    critical: 'bg-red-100 text-red-700',
  }[ai_health.status];

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Agent Health</h1>
            <p className="text-sm text-gray-500 mt-1">
              How well the AI is handling customer conversations
            </p>
          </div>
          <div className="text-xs text-gray-400">Last 30 days</div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-8 mb-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-bold text-gray-900">Overall Health</h2>
            <span className={`text-xs px-3 py-1 rounded-full font-semibold ${statusColor}`}>
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-8">
            <HealthRing score={ai_health.score} status={ai_health.status} />

            <div className="flex-1 w-full space-y-5">
              <Bar label="AI handle rate" value={ai_health.ai_handle_rate} color="#3535FF" />
              <Bar label="Escalation rate" value={ai_health.escalation_rate} color="#F59E0B" />
            </div>
          </div>
        </div>

        {(ai_health.open_escalations > 0 || ai_health.failed_notifications > 0) && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
              Attention required
            </div>
            {ai_health.open_escalations > 0 && (
              <button
                onClick={() => navigate('/dashboard/escalations')}
                className="w-full flex items-center justify-between text-sm bg-amber-50 hover:bg-amber-100 text-amber-800 px-4 py-3 rounded-xl transition-colors"
              >
                <span className="flex items-center gap-2 font-medium">
                  <LifebuoyIcon className="w-4 h-4" />
                  {ai_health.open_escalations} open escalation
                  {ai_health.open_escalations !== 1 ? 's' : ''}
                </span>
                <ArrowRightIcon className="w-4 h-4" />
              </button>
            )}
            {ai_health.failed_notifications > 0 && (
              <div className="flex items-center gap-2 text-sm bg-red-50 text-red-700 px-4 py-3 rounded-xl">
                <WarningIcon className="w-4 h-4 shrink-0" />
                <span>
                  {ai_health.failed_notifications} failed support notification
                  {ai_health.failed_notifications !== 1 ? 's' : ''} in last 30d
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
