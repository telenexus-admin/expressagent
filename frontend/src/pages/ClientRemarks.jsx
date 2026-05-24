import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

function StatCard({ label, value, helper, tone = 'purple' }) {
  const tones = {
    purple: 'from-[#5B35E5] to-[#3922C9]',
    green: 'from-emerald-400 to-emerald-600',
    amber: 'from-amber-400 to-orange-500',
    red: 'from-rose-400 to-rose-600',
  };
  return (
    <div className={`relative overflow-hidden rounded-[26px] bg-gradient-to-br ${tones[tone]} p-5 text-white shadow-lg`}>
      <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/15" />
      <p className="relative text-xs font-bold text-white/75">{label}</p>
      <div className="relative mt-2 text-3xl font-black">{value}</div>
      <p className="relative mt-2 text-[11px] text-white/75">{helper}</p>
    </div>
  );
}

function Badge({ item }) {
  if (!item.response_key) return <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-500">Waiting</span>;
  if (item.response_key === 'excellent') return <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">Loved it</span>;
  if (item.response_key === 'okay') return <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-700">It was okay</span>;
  return <span className="rounded-full bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-700">Needs help</span>;
}

export default function ClientRemarks() {
  const [summary, setSummary] = useState(null);
  const [remarks, setRemarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState(null);

  const load = async () => {
    try {
      const [summaryResult, listResult] = await Promise.all([
        api.get('/remarks/summary'),
        api.get('/remarks'),
      ]);
      setSummary(summaryResult.data);
      setRemarks(listResult.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load client remarks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const responded = summary?.responses || 0;
  const satisfaction = responded ? Math.round((((summary.excellent || 0) + (summary.okay || 0)) / responded) * 100) : 0;
  const responseRate = summary?.surveys_sent ? Math.round((responded / summary.surveys_sent) * 100) : 0;
  const followups = useMemo(() => remarks.filter((item) => item.requires_followup && !item.reviewed_at), [remarks]);

  const markReviewed = async (id) => {
    setReviewingId(id);
    try {
      await api.patch(`/remarks/${id}/review`);
      await load();
    } finally {
      setReviewingId(null);
    }
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm font-semibold text-[#4B16B5]">Loading AI client remarks...</div>;
  if (error) return <div className="flex-1 flex items-center justify-center text-sm text-rose-600">{error}</div>;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f6ff] p-5 sm:p-7 lg:p-8">
      <div className="mx-auto max-w-7xl pb-10">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex rounded-full bg-[#efe9ff] px-4 py-2 text-xs font-black text-[#4B16B5]">Customer experience intelligence</div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">AI Client Remarks</h1>
            <p className="mt-1 text-sm text-slate-500">Feedback collected by Nexa at the end of customer support conversations.</p>
          </div>
          <div className="rounded-full border border-purple-50 bg-white px-5 py-3 text-xs font-bold text-slate-400 shadow-sm">Auto-refresh · 30 seconds</div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Satisfaction" value={`${satisfaction}%`} helper="Loved it or okay responses" tone="purple" />
          <StatCard label="Loved it" value={summary.excellent || 0} helper="Customers with a great experience" tone="green" />
          <StatCard label="Response rate" value={`${responseRate}%`} helper={`${responded} of ${summary.surveys_sent || 0} surveys answered`} tone="amber" />
          <StatCard label="Needs follow-up" value={summary.pending_followup || 0} helper="Customers asking for more help" tone="red" />
        </div>

        {followups.length > 0 && (
          <section className="mb-6 rounded-[30px] border border-rose-100 bg-white p-5 shadow-xl shadow-rose-100/50 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">Attention required</h2>
                <p className="text-xs text-slate-500">These customers selected “Need help” after speaking to Nexa.</p>
              </div>
              <span className="rounded-full bg-rose-50 px-4 py-2 text-xs font-black text-rose-600">{followups.length} pending</span>
            </div>
            <div className="space-y-3">
              {followups.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-2xl bg-rose-50/65 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.customer_name || 'WhatsApp customer'}</p>
                    <p className="mt-1 text-xs text-slate-500">Feedback received {new Date(item.responded_at || item.requested_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-700">Follow up required</span>
                    <button onClick={() => markReviewed(item.id)} disabled={reviewingId === item.id} className="rounded-full bg-[#4B16B5] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{reviewingId === item.id ? 'Saving...' : 'Mark reviewed'}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-[30px] border border-white bg-white shadow-xl shadow-purple-100/50">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <h2 className="text-lg font-black text-slate-950">Recent feedback</h2>
              <p className="mt-1 text-xs text-slate-500">Surveys sent and customer selections recorded by the AI.</p>
            </div>
            <div className="rounded-full bg-[#F0EAFF] px-4 py-2 text-xs font-black text-[#4B16B5]">Avg score {summary.average_score || 0}/5</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                <tr><th className="px-6 py-3">Customer</th><th className="px-6 py-3">Remark</th><th className="px-6 py-3">Survey sent</th><th className="px-6 py-3">Follow-up</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-sm">
                {remarks.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-4 font-semibold text-slate-900">{item.customer_name || 'WhatsApp customer'}</td>
                    <td className="px-6 py-4"><Badge item={item} /></td>
                    <td className="px-6 py-4 text-xs text-slate-500">{new Date(item.requested_at).toLocaleString()}</td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-500">{item.requires_followup ? (item.reviewed_at ? 'Reviewed' : 'Pending') : 'None'}</td>
                  </tr>
                ))}
                {remarks.length === 0 && <tr><td colSpan={4} className="px-6 py-14 text-center text-sm text-slate-400">No experience feedback has been collected yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
