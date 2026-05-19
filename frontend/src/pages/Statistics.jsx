import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import {
  ChatIcon,
  CheckCircleIcon,
  LifebuoyIcon,
  ActivityIcon,
} from '../components/Icons';

function formatDayLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function MessageVolumeChart({ data }) {
  if (!data || data.length === 0) return null;

  const totals = data.map((d) => d.user_count + d.assistant_count + d.admin_count);
  const max = Math.max(1, ...totals);
  const W = 720;
  const H = 240;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xFor = (i) =>
    padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yFor = (v) => padT + innerH - (v / max) * innerH;

  const linePoints = totals.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
  const areaPath =
    `M ${xFor(0)},${yFor(totals[0])} ` +
    totals.slice(1).map((v, i) => `L ${xFor(i + 1)},${yFor(v)}`).join(' ') +
    ` L ${xFor(totals.length - 1)},${padT + innerH} L ${xFor(0)},${padT + innerH} Z`;

  const peakIndex = totals.indexOf(Math.max(...totals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="areaGradStats" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3535FF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#3535FF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => {
          const y = yFor(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#E5E7EB" strokeDasharray="2 4" />
              <text x={padL - 6} y={y + 3} fontSize="10" fill="#9CA3AF" textAnchor="end">
                {t}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#areaGradStats)" />

        <polyline
          fill="none"
          stroke="#3535FF"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />

        {totals[peakIndex] > 0 && (
          <>
            <circle
              cx={xFor(peakIndex)}
              cy={yFor(totals[peakIndex])}
              r="4"
              fill="#3535FF"
              stroke="white"
              strokeWidth="2"
            />
            <g transform={`translate(${xFor(peakIndex)}, ${yFor(totals[peakIndex]) - 14})`}>
              <rect x="-22" y="-12" width="44" height="18" rx="9" fill="#3535FF" />
              <text
                x="0"
                y="1"
                fontSize="10"
                fontWeight="600"
                fill="white"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {totals[peakIndex]}
              </text>
            </g>
          </>
        )}

        {data.map((d, i) => {
          if (i % 2 !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={d.day}
              x={xFor(i)}
              y={H - padB + 18}
              fontSize="10"
              fill="#9CA3AF"
              textAnchor="middle"
            >
              {formatDayLabel(d.day)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function StatPill({ Icon, label, value, accent = false }) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${
        accent ? 'bg-[#3535FF] text-white' : 'bg-white border border-gray-100'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          accent ? 'bg-white/20 text-white' : 'bg-[#E8E9FF] text-[#3535FF]'
        }`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div
          className={`text-[10px] uppercase tracking-wider font-semibold ${
            accent ? 'text-white/70' : 'text-gray-400'
          }`}
        >
          {label}
        </div>
        <div className={`text-lg font-bold ${accent ? 'text-white' : 'text-gray-900'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function Statistics() {
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
        <div className="text-gray-400 text-sm">Loading statistics...</div>
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

  const { messages_by_day, conversations, ai_health } = data;
  const totalMessages14d = messages_by_day.reduce(
    (sum, d) => sum + d.user_count + d.assistant_count + d.admin_count,
    0
  );

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Statistics</h1>
            <p className="text-sm text-gray-500 mt-1">Message activity across all conversations</p>
          </div>
          <div className="text-xs text-gray-400">Last 14 days</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatPill Icon={ChatIcon} label="Total Messages" value={totalMessages14d.toLocaleString()} />
          <StatPill Icon={ActivityIcon} label="Active" value={conversations.active} />
          <StatPill Icon={LifebuoyIcon} label="Human Takeover" value={conversations.human_takeover} accent />
          <StatPill Icon={CheckCircleIcon} label="Resolved" value={conversations.resolved} />
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Message Volume</h2>
              <p className="text-xs text-gray-500 mt-0.5">Daily messages across all conversations</p>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#3535FF]" />
                <span className="text-gray-600 font-medium">Total messages</span>
              </span>
            </div>
          </div>
          <MessageVolumeChart data={messages_by_day} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              Customer messages (30d)
            </div>
            <div className="text-xl font-bold text-gray-900">
              {ai_health.total_user_messages_30d.toLocaleString()}
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              AI responses (30d)
            </div>
            <div className="text-xl font-bold text-[#3535FF]">
              {ai_health.total_ai_messages_30d.toLocaleString()}
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              Admin replies (30d)
            </div>
            <div className="text-xl font-bold text-gray-900">
              {ai_health.total_admin_messages_30d.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
