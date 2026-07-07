import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import aiBotArtwork from '../assets/aiBotArtwork';
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

function getVolumeSummary(data) {
  const safe = data || [];
  const totals = safe.map((d) => ({
    ...d,
    total: Number(d.user_count || 0) + Number(d.assistant_count || 0) + Number(d.admin_count || 0),
  }));
  const totalMessages = totals.reduce((sum, d) => sum + d.total, 0);
  const userMessages = totals.reduce((sum, d) => sum + Number(d.user_count || 0), 0);
  const aiMessages = totals.reduce((sum, d) => sum + Number(d.assistant_count || 0), 0);
  const adminMessages = totals.reduce((sum, d) => sum + Number(d.admin_count || 0), 0);
  const peak = totals.reduce((best, d) => (d.total > best.total ? d : best), totals[0] || { total: 0 });
  const avg = totals.length ? Math.round(totalMessages / totals.length) : 0;
  const automationRate = userMessages ? Math.round((aiMessages / userMessages) * 100) : 0;
  const humanTouchRate = userMessages ? Math.round((adminMessages / userMessages) * 100) : 0;
  const last7 = totals.slice(-7).reduce((sum, d) => sum + d.total, 0);
  const previous7 = totals.slice(0, Math.max(0, totals.length - 7)).reduce((sum, d) => sum + d.total, 0);
  const trend = previous7 ? Math.round(((last7 - previous7) / previous7) * 100) : last7 > 0 ? 100 : 0;
  return { totalMessages, userMessages, aiMessages, adminMessages, peak, avg, automationRate, humanTouchRate, trend };
}

function MessageVolumeChart({ data }) {
  if (!data || data.length === 0) return null;

  const rows = data.map((d) => ({
    ...d,
    user_count: Number(d.user_count || 0),
    assistant_count: Number(d.assistant_count || 0),
    admin_count: Number(d.admin_count || 0),
    total: Number(d.user_count || 0) + Number(d.assistant_count || 0) + Number(d.admin_count || 0),
  }));

  const maxValue = Math.max(1, ...rows.flatMap((d) => [d.total, d.user_count, d.assistant_count, d.admin_count]));
  const W = 880;
  const H = 300;
  const padL = 46;
  const padR = 18;
  const padT = 24;
  const padB = 48;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;
  const xFor = (i) => padL + stepX * i;
  const yFor = (v) => padT + innerH - (v / maxValue) * innerH;
  const pointsFor = (key) => rows.map((row, i) => `${xFor(i)},${yFor(row[key])}`).join(' ');
  const totalLine = pointsFor('total');
  const customerLine = pointsFor('user_count');
  const aiLine = pointsFor('assistant_count');
  const adminLine = pointsFor('admin_count');
  const areaPoints = `${padL},${padT + innerH} ${totalLine} ${xFor(rows.length - 1)},${padT + innerH}`;
  const peakIndex = rows.findIndex((row) => row.total === Math.max(...rows.map((d) => d.total)));
  const peak = rows[peakIndex];
  const guides = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="w-full overflow-x-auto pb-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[720px]" role="img" aria-label="Daily message traffic trend graph">
        <defs>
          <linearGradient id="trafficArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6D3DEB" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#6D3DEB" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {guides.map((guide) => {
          const value = Math.round(maxValue * guide);
          const y = yFor(value);
          return (
            <g key={guide}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#EEE9F8" strokeWidth="1" />
              <text x={padL - 12} y={y + 4} fontSize="10" fill="#968EA9" textAnchor="end">{value}</text>
            </g>
          );
        })}

        <polygon points={areaPoints} fill="url(#trafficArea)" />
        <polyline points={totalLine} fill="none" stroke="#C7B8F4" strokeWidth="2" strokeDasharray="5 5" />
        <polyline points={customerLine} fill="none" stroke="#5426D8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={aiLine} fill="none" stroke="#25A5EA" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={adminLine} fill="none" stroke="#1FB77A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

        {rows.map((row, i) => (
          <g key={row.day}>
            <circle cx={xFor(i)} cy={yFor(row.user_count)} r="4" fill="white" stroke="#5426D8" strokeWidth="2" />
            <circle cx={xFor(i)} cy={yFor(row.assistant_count)} r="4" fill="white" stroke="#25A5EA" strokeWidth="2" />
            {row.admin_count > 0 && <circle cx={xFor(i)} cy={yFor(row.admin_count)} r="4" fill="white" stroke="#1FB77A" strokeWidth="2" />}
            <text x={xFor(i)} y={H - 18} fontSize="10" fill="#968EA9" textAnchor="middle">
              {i % 2 === 0 || i === rows.length - 1 ? formatDayLabel(row.day) : ''}
            </text>
          </g>
        ))}

        {peak && peak.total > 0 && (
          <g transform={`translate(${xFor(peakIndex)}, ${Math.max(14, yFor(peak.total) - 24)})`}>
            <rect x="-26" y="-13" width="52" height="24" rx="12" fill="#241052" />
            <text x="0" y="2" fontSize="11" fontWeight="700" fill="white" textAnchor="middle">{peak.total}</text>
          </g>
        )}
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

function MiniInsight({ label, value, helper, tone = 'purple' }) {
  const tones = {
    purple: 'bg-[#F0EAFF] text-[#4B16B5]',
    blue: 'bg-sky-50 text-sky-700',
    green: 'bg-emerald-50 text-emerald-700',
    dark: 'bg-slate-950 text-white',
  };
  return (
    <div className="rounded-[22px] bg-white/75 border border-white p-4 shadow-sm">
      <div className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black ${tones[tone]}`}>{label}</div>
      <div className="text-2xl font-black text-slate-950 mt-3">{value}</div>
      <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{helper}</div>
    </div>
  );
}

function AIHealthCard({ aiHealth }) {
  return (
    <div className="rounded-[34px] bg-gradient-to-br from-[#4B16B5] to-[#2B086F] text-white p-6 shadow-xl shadow-purple-200 relative overflow-hidden min-h-[285px]">
      <div className="absolute -right-7 -top-7 h-40 w-40 rounded-full bg-sky-400/10 blur-2xl" />
      <div className="absolute right-0 top-0 bottom-0 w-[48%] bg-gradient-to-l from-[#36117f]/20 to-transparent" />
      <img
        src={aiBotArtwork}
        alt="Nexa AI health assistant"
        className="absolute z-0 -right-6 top-3 h-[172px] w-[152px] object-cover object-[62%_28%] mix-blend-multiply opacity-90 drop-shadow-[0_0_18px_rgba(72,176,255,0.65)]"
      />
      <div className="relative z-10">
        <div className="text-white/65 text-xs font-bold">AI Health Score</div>
        <div className="text-6xl font-black tracking-tight mt-3">{aiHealth.score}<span className="text-2xl text-white/60">%</span></div>
        <div className="mt-4 rounded-2xl bg-white/12 p-4 max-w-[82%]">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-white/70">Handle rate</span>
            <span className="font-black">{aiHealth.ai_handle_rate}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full bg-[#95D13D]" style={{ width: `${Math.min(100, aiHealth.ai_handle_rate)}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
          <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/55">Open escalations</div><div className="text-xl font-black mt-1">{aiHealth.open_escalations}</div></div>
          <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/55">Failed alerts</div><div className="text-xl font-black mt-1">{aiHealth.failed_notifications}</div></div>
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
        <div className="text-[#4B16B5] text-sm font-bold">Loading dashboard...</div>
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
  const summary = getVolumeSummary(messages_by_day);
  const trendLabel = summary.trend > 0 ? `+${summary.trend}%` : `${summary.trend}%`;
  const peakLabel = summary.peak?.day ? formatDayLabel(summary.peak.day) : '—';

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f6ff] p-5 sm:p-7 lg:p-8">
      <div className="max-w-7xl mx-auto pb-10">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-950 tracking-tight">Support Performance</h1>
            <p className="text-sm text-slate-500 mt-1">A clean overview of messages, AI replies, handovers and service health.</p>
          </div>
          <div className="rounded-full bg-white px-5 py-3 text-xs font-bold text-slate-400 shadow-sm border border-purple-50">
            Last 14 days · Auto-refresh 30s
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
          <PremiumStatCard Icon={ChatIcon} label="Total Messages" value={summary.totalMessages.toLocaleString()} note="Across all conversations" gradient="bg-gradient-to-br from-[#5B35E5] to-[#3922C9]" />
          <PremiumStatCard Icon={ActivityIcon} label="Active Conversations" value={conversations.active} note="Currently handled by AI" gradient="bg-gradient-to-br from-[#2FA8F7] to-[#2779D8]" />
          <PremiumStatCard Icon={LifebuoyIcon} label="Human Takeover" value={conversations.human_takeover} note="Needs admin attention" gradient="bg-gradient-to-br from-[#20C985] to-[#159E63]" />
          <PremiumStatCard Icon={CheckCircleIcon} label="Resolved" value={conversations.resolved} note="Closed support cases" gradient="bg-gradient-to-br from-[#95D13D] to-[#6FBB2F]" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_0.95fr] gap-6">
          <div className="rounded-[34px] bg-white p-5 sm:p-6 shadow-xl shadow-purple-100/70 border border-white overflow-hidden">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-5">
              <div>
                <div className="text-[11px] font-black text-[#4B16B5] uppercase tracking-[0.18em]">Message activity</div>
                <h2 className="text-2xl font-black text-slate-950 mt-1">14-day traffic trend</h2>
                <p className="text-xs text-slate-400 mt-1">Customer messages, AI responses and admin replies over time.</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] font-bold">
                <span className="flex items-center gap-1.5 rounded-full bg-[#F0EAFF] text-[#4B16B5] px-3 py-2"><span className="w-2 h-2 rounded-full bg-[#5426D8]" />Customer</span>
                <span className="flex items-center gap-1.5 rounded-full bg-sky-50 text-sky-700 px-3 py-2"><span className="w-2 h-2 rounded-full bg-[#25A5EA]" />AI</span>
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 py-2"><span className="w-2 h-2 rounded-full bg-[#1FB77A]" />Admin</span>
              </div>
            </div>

            <MessageVolumeChart data={messages_by_day} />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              <MiniInsight label="Peak day" value={peakLabel} helper={`${summary.peak?.total || 0} total messages`} tone="purple" />
              <MiniInsight label="Daily avg" value={summary.avg} helper="Average messages per day" tone="blue" />
              <MiniInsight label="AI rate" value={`${summary.automationRate}%`} helper="AI replies vs customer messages" tone="green" />
              <MiniInsight label="7-day trend" value={trendLabel} helper="Latest 7 days vs previous period" tone="dark" />
            </div>
          </div>

          <div className="space-y-6">
            <AIHealthCard aiHealth={ai_health} />

            <div className="rounded-[34px] bg-white p-5 shadow-lg shadow-purple-100/60 border border-white">
              <h3 className="text-sm font-black text-slate-950 mb-4">30-day role breakdown</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-bold mb-2"><span>Customer messages</span><span>{ai_health.total_user_messages_30d.toLocaleString()}</span></div>
                  <div className="h-3 rounded-full bg-[#F0EAFF] overflow-hidden"><div className="h-full bg-[#4B16B5] rounded-full" style={{ width: '100%' }} /></div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-bold mb-2"><span>AI responses</span><span>{ai_health.total_ai_messages_30d.toLocaleString()}</span></div>
                  <div className="h-3 rounded-full bg-sky-50 overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(100, summary.automationRate)}%` }} /></div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-bold mb-2"><span>Admin replies</span><span>{ai_health.total_admin_messages_30d.toLocaleString()}</span></div>
                  <div className="h-3 rounded-full bg-emerald-50 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, summary.humanTouchRate)}%` }} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
