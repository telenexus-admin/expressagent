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
  const W = 820;
  const H = 300;
  const padL = 38;
  const padR = 22;
  const padT = 24;
  const padB = 40;
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
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[720px]" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="premiumAreaGradStats" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="premiumLineGradStats" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#4B16B5" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => {
          const y = yFor(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#E8E3F8" strokeDasharray="3 6" />
              <text x={padL - 8} y={y + 3} fontSize="10" fill="#A59ABF" textAnchor="end">
                {t}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#premiumAreaGradStats)" />
        <polyline
          fill="none"
          stroke="url(#premiumLineGradStats)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />

        {totals.map((v, i) => (
          <circle
            key={`${i}-${v}`}
            cx={xFor(i)}
            cy={yFor(v)}
            r="4"
            fill="white"
            stroke="#4B16B5"
            strokeWidth="2"
          />
        ))}

        {totals[peakIndex] > 0 && (
          <g transform={`translate(${xFor(peakIndex)}, ${yFor(totals[peakIndex]) - 20})`}>
            <rect x="-28" y="-15" width="56" height="24" rx="12" fill="#4B16B5" />
            <text x="0" y="0" fontSize="11" fontWeight="800" fill="white" textAnchor="middle" dominantBaseline="middle">
              {totals[peakIndex]}
            </text>
          </g>
        )}

        {data.map((d, i) => {
          if (i % 2 !== 0 && i !== data.length - 1) return null;
          return (
            <text key={d.day} x={xFor(i)} y={H - 14} fontSize="10" fill="#A59ABF" textAnchor="middle">
              {formatDayLabel(d.day)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function PremiumStatCard({ Icon, label, value, note, gradient, accent }) {
  return (
    <div className={`relative overflow-hidden rounded-[28px] ${gradient} p-5 text-white shadow-xl shadow-purple-100`}>
      <div className="absolute -right-8 -top-10 w-32 h-32 rounded-full bg-white/15" />
      <div className="absolute right-10 bottom-4 w-16 h-16 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="text-white/75 text-xs font-bold">{label}</div>
          <div className="text-3xl font-black mt-2 tracking-tight">{value}</div>
          <div className="text-[11px] text-white/70 mt-2">{note}</div>
        </div>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${accent || 'bg-white/18'}`}>
          <Icon className="w-6 h-6" />
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
      <div className="flex-1 flex items-center justify-center bg-[#f8f6ff]">
        <div className="text-[#4B16B5] text-sm font-bold">Loading premium dashboard...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#f8f6ff]">
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
    <div className="flex-1 overflow-y-auto bg-[#f8f6ff] p-5 sm:p-7 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#efe9ff] text-[#4B16B5] px-4 py-2 text-xs font-black mb-3">
              Premium dashboard live
            </div>
            <h1 className="text-3xl font-black text-slate-950 tracking-tight">Support Performance</h1>
            <p className="text-sm text-slate-500 mt-1">A clean overview of messages, AI replies, handovers and service health.</p>
          </div>
          <div className="rounded-full bg-white px-5 py-3 text-xs font-bold text-slate-400 shadow-sm border border-purple-50">
            Last 14 days · Auto-refresh 30s
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
          <PremiumStatCard
            Icon={ChatIcon}
            label="Total Messages"
            value={totalMessages14d.toLocaleString()}
            note="Across all conversations"
            gradient="bg-gradient-to-br from-[#5B35E5] to-[#3922C9]"
          />
          <PremiumStatCard
            Icon={ActivityIcon}
            label="Active Conversations"
            value={conversations.active}
            note="Currently handled by AI"
            gradient="bg-gradient-to-br from-[#2FA8F7] to-[#2779D8]"
          />
          <PremiumStatCard
            Icon={LifebuoyIcon}
            label="Human Takeover"
            value={conversations.human_takeover}
            note="Needs admin attention"
            gradient="bg-gradient-to-br from-[#20C985] to-[#159E63]"
          />
          <PremiumStatCard
            Icon={CheckCircleIcon}
            label="Resolved"
            value={conversations.resolved}
            note="Closed support cases"
            gradient="bg-gradient-to-br from-[#95D13D] to-[#6FBB2F]"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.8fr_0.9fr] gap-6">
          <div className="rounded-[30px] bg-white p-6 shadow-xl shadow-purple-100/70 border border-white">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">Message Volume</h2>
                <p className="text-xs text-slate-400 mt-1">Daily user, AI and admin message activity.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#4B16B5] bg-[#efe9ff] rounded-full px-4 py-2">
                <span className="w-2 h-2 rounded-full bg-[#4B16B5]" />
                Live analytics
              </div>
            </div>
            <MessageVolumeChart data={messages_by_day} />
          </div>

          <div className="rounded-[30px] bg-gradient-to-br from-[#4B16B5] to-[#2B086F] text-white p-6 shadow-xl shadow-purple-200 relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-40 h-40 rounded-full bg-white/10" />
            <div className="relative">
              <div className="text-white/65 text-xs font-bold">AI Health Score</div>
              <div className="text-6xl font-black tracking-tight mt-3">{ai_health.score}<span className="text-2xl text-white/60">%</span></div>
              <div className="mt-4 rounded-2xl bg-white/12 p-4">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-white/70">Handle rate</span>
                  <span className="font-black">{ai_health.ai_handle_rate}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/15 overflow-hidden">
                  <div className="h-full rounded-full bg-[#95D13D]" style={{ width: `${Math.min(100, ai_health.ai_handle_rate)}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <div className="rounded-2xl bg-white/10 p-3">
                  <div className="text-white/55">Open escalations</div>
                  <div className="text-xl font-black mt-1">{ai_health.open_escalations}</div>
                </div>
                <div className="rounded-2xl bg-white/10 p-3">
                  <div className="text-white/55">Failed alerts</div>
                  <div className="text-xl font-black mt-1">{ai_health.failed_notifications}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-6">
          <div className="bg-white rounded-[26px] border border-white p-5 shadow-lg shadow-purple-100/50">
            <div className="text-xs font-black text-slate-400 uppercase tracking-wider">Customer messages</div>
            <div className="text-3xl font-black text-slate-950 mt-2">{ai_health.total_user_messages_30d.toLocaleString()}</div>
            <p className="text-xs text-slate-400 mt-1">Last 30 days</p>
          </div>
          <div className="bg-white rounded-[26px] border border-white p-5 shadow-lg shadow-purple-100/50">
            <div className="text-xs font-black text-slate-400 uppercase tracking-wider">AI responses</div>
            <div className="text-3xl font-black text-[#4B16B5] mt-2">{ai_health.total_ai_messages_30d.toLocaleString()}</div>
            <p className="text-xs text-slate-400 mt-1">Automated replies</p>
          </div>
          <div className="bg-white rounded-[26px] border border-white p-5 shadow-lg shadow-purple-100/50">
            <div className="text-xs font-black text-slate-400 uppercase tracking-wider">Admin replies</div>
            <div className="text-3xl font-black text-slate-950 mt-2">{ai_health.total_admin_messages_30d.toLocaleString()}</div>
            <p className="text-xs text-slate-400 mt-1">Manual support replies</p>
          </div>
        </div>
      </div>
    </div>
  );
}
