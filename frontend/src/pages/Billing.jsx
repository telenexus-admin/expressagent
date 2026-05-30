import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import { ChartIcon, ChatIcon, CreditCardIcon, PulseIcon } from '../components/Icons';

function formatKes(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function UsageCard({ icon: Icon, label, value, helper, tone = 'purple' }) {
  const tones = {
    purple: 'bg-[#efe9ff] text-[#4B16B5]',
    blue: 'bg-sky-50 text-sky-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">{helper}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function DailyBars({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const max = Math.max(1, ...safeRows.map((row) => Number(row.ai_messages || 0)));
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-950">Daily AI Usage</h2>
          <p className="mt-1 text-xs text-slate-500">AI replies sent this billing month.</p>
        </div>
      </div>
      <div className="flex h-44 items-end gap-1 overflow-x-auto pb-2">
        {safeRows.map((row) => {
          const count = Number(row.ai_messages || 0);
          const height = Math.max(4, Math.round((count / max) * 150));
          const date = new Date(row.day);
          return (
            <div key={row.day} className="flex min-w-[18px] flex-1 flex-col items-center justify-end gap-2">
              <div title={`${count} AI replies`} className="w-full max-w-[18px] rounded-t-lg bg-[#4B16B5]" style={{ height }} />
              <span className="text-[9px] font-bold text-slate-400">{date.getDate()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Billing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await api.get('/billing/usage');
        if (!active) return;
        setData(response.data);
        setError('');
      } catch (err) {
        if (active) setError(err.response?.data?.error || 'Failed to load billing usage');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const meter = useMemo(() => {
    const used = data?.usage?.ai_messages || 0;
    const included = data?.usage?.included_messages || 500;
    return {
      percent: Math.min(100, Math.round((used / Math.max(1, included)) * 100)),
      over: used > included,
    };
  }, [data]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-sm font-bold text-[#4B16B5]">Loading billing usage...</div>;
  }

  if (error) {
    return <div className="flex flex-1 items-center justify-center p-6 text-sm font-bold text-red-600">{error}</div>;
  }

  const pricing = data.pricing;
  const usage = data.usage;
  const charges = data.charges;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950">Billing</h1>
            <p className="mt-1 text-sm text-slate-500">
              Usage meter for {data.month.label}. Base plan covers the first {pricing.included_ai_messages} AI replies.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-white">
            <div className="text-[10px] font-black uppercase tracking-wider text-white/50">Current total</div>
            <div className="text-2xl font-black">{formatKes(charges.total_due)}</div>
          </div>
        </div>

        <div className="mb-5 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-slate-400">AI message allowance</div>
              <div className="mt-1 text-3xl font-black text-slate-950">
                {usage.ai_messages.toLocaleString()} / {pricing.included_ai_messages.toLocaleString()}
              </div>
            </div>
            <div className={`rounded-2xl px-4 py-2 text-sm font-black ${meter.over ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {meter.over ? `${usage.overage_messages} over included bundle` : `${usage.remaining_included_messages} included replies left`}
            </div>
          </div>
          <div className="h-4 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${meter.over ? 'bg-amber-500' : 'bg-[#4B16B5]'}`}
              style={{ width: `${meter.percent}%` }}
            />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Pricing: {formatKes(pricing.base_fee)} for up to {pricing.included_ai_messages} AI replies, then {pricing.overage_unit_messages} extra AI replies = {formatKes(pricing.overage_unit_price)}.
          </div>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <UsageCard icon={CreditCardIcon} label="Base fee" value={formatKes(charges.base_fee)} helper="Monthly platform charge." tone="purple" />
          <UsageCard icon={ChatIcon} label="Overage" value={formatKes(charges.overage_cost)} helper={`${usage.overage_messages} extra AI replies this month.`} tone="amber" />
          <UsageCard icon={PulseIcon} label="Projected bill" value={formatKes(charges.projected_total_due)} helper={`${usage.projected_ai_messages} AI replies projected.`} tone="blue" />
          <UsageCard icon={ChartIcon} label="Conversations" value={usage.active_conversations.toLocaleString()} helper="Conversations with activity this month." tone="green" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <DailyBars rows={data.daily_usage} />
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black text-slate-950">Billing Notes</h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
              <p>Billable usage is counted from AI replies sent to customers.</p>
              <p>Customer messages and admin replies are shown for context, but they do not increase the AI overage charge.</p>
              <p>Current month customer messages: <strong>{usage.customer_messages.toLocaleString()}</strong></p>
              <p>Current month admin replies: <strong>{usage.admin_messages.toLocaleString()}</strong></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
