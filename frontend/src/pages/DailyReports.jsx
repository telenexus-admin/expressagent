import React, { useEffect, useState } from 'react';
import api from '../utils/api';

function statusStyle(status) {
  if (status === 'sent') return 'bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-700';
}

function MetricCard({ label, value, helper, tone = 'purple' }) {
  const tones = {
    purple: 'bg-[#F0EAFF] text-[#4B16B5]',
    blue: 'bg-sky-50 text-sky-700',
    green: 'bg-emerald-50 text-emerald-700',
    orange: 'bg-orange-50 text-orange-700',
  };
  return (
    <div className="rounded-[24px] bg-white border border-white shadow-md shadow-purple-100/40 p-4">
      <div className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide ${tones[tone]}`}>{label}</div>
      <div className="mt-3 text-3xl font-black text-slate-950">{value || 0}</div>
      <div className="mt-1 text-[11px] text-slate-400">{helper}</div>
    </div>
  );
}

function HandoverRow({ item }) {
  const states = {
    resolved: { text: 'Resolved', style: 'bg-emerald-50 text-emerald-700' },
    followed_up: { text: 'Followed up', style: 'bg-sky-50 text-sky-700' },
    pending_follow_up: { text: 'Pending follow-up', style: 'bg-orange-50 text-orange-700' },
  };
  const state = states[item.outcome] || states.pending_follow_up;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-[#fbfaff] border border-purple-50 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-900 truncate">{item.customer_name || `+${item.customer_phone}`}</div>
        <div className="text-xs text-slate-400 truncate mt-1">{item.customer_name ? `+${item.customer_phone} · ` : ''}{item.admin_replies} admin repl{item.admin_replies === 1 ? 'y' : 'ies'}{item.last_responded_by ? ` · ${item.last_responded_by}` : ''}</div>
      </div>
      <span className={`text-[10px] font-black rounded-full px-3 py-1.5 shrink-0 ${state.style}`}>{state.text}</span>
    </div>
  );
}

export default function DailyReports() {
  const [config, setConfig] = useState(null);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [phone, setPhone] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [configRes, previewRes, historyRes] = await Promise.all([
        api.get('/reports/config'),
        api.get('/reports/preview'),
        api.get('/reports/history'),
      ]);
      setConfig(configRes.data);
      setPhone(configRes.data.daily_report_phone || '');
      setEnabled(Boolean(configRes.data.daily_report_enabled));
      setPreview(previewRes.data);
      setHistory(historyRes.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load daily reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      await api.put('/reports/config', { daily_report_enabled: enabled, daily_report_phone: phone });
      setNotice(enabled ? 'Daily SMS report is enabled for 8:00 PM every day.' : 'Daily SMS report has been switched off.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save report settings');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setNotice('');
    setError('');
    try {
      const { data } = await api.post('/reports/test-sms', { phone });
      setNotice(`Test report sent successfully to ${data.sent_to}.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send test report SMS');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading daily reports...</div>;

  const metrics = preview?.metrics || {};
  const handovers = metrics.handover_details || [];

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f6ff] p-5 sm:p-7 lg:p-8">
      <div className="max-w-7xl mx-auto pb-10">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center rounded-full bg-[#efe9ff] text-[#4B16B5] px-4 py-2 text-xs font-black mb-3">Nexa daily intelligence</div>
            <h1 className="text-3xl font-black text-slate-950 tracking-tight">Daily Reports</h1>
            <p className="text-sm text-slate-500 mt-1">Receive a daily SMS summary of customer engagement, AI handling and human follow-up.</p>
          </div>
          <div className="rounded-full bg-white px-5 py-3 text-xs font-bold text-slate-400 shadow-sm border border-purple-50">
            Automatic delivery · 8:00 PM · Africa/Nairobi
          </div>
        </div>

        {notice && <div className="mb-5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl px-4 py-3 text-sm font-medium">{notice}</div>}
        {error && <div className="mb-5 bg-red-50 border border-red-100 text-red-700 rounded-2xl px-4 py-3 text-sm">{error}</div>}

        <div className="grid grid-cols-1 xl:grid-cols-[390px_1fr] gap-6 mb-6">
          <div className="rounded-[30px] bg-white border border-white shadow-xl shadow-purple-100/50 p-6">
            <h2 className="text-lg font-black text-slate-950">SMS delivery settings</h2>
            <p className="text-xs text-slate-400 mt-1 mb-5">Set the admin/owner number that receives the report every evening.</p>
            <label className="text-xs font-black text-slate-500 uppercase tracking-wide">Report phone number</label>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="2547XXXXXXXX" className="mt-2 w-full rounded-2xl border border-purple-100 bg-[#fbfaff] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#4B16B5]/20" />
            <label className="mt-5 flex items-center justify-between rounded-2xl border border-purple-50 bg-[#faf8ff] px-4 py-4 cursor-pointer">
              <div><div className="text-sm font-bold text-slate-900">Send daily SMS reports</div><div className="text-[11px] text-slate-400 mt-1">Delivered once daily after 8 PM</div></div>
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="w-5 h-5 accent-[#4B16B5]" />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={saveConfig} disabled={saving} className="rounded-2xl bg-[#4B16B5] px-4 py-3 text-xs font-black text-white disabled:opacity-60">{saving ? 'Saving...' : 'Save settings'}</button>
              <button onClick={sendTest} disabled={testing || !phone.trim()} className="rounded-2xl bg-[#F0EAFF] px-4 py-3 text-xs font-black text-[#4B16B5] disabled:opacity-50">{testing ? 'Sending...' : 'Send test SMS'}</button>
            </div>
            {config && <p className="mt-5 text-[11px] text-slate-400">Reports for <strong className="text-slate-600">{config.business_name}</strong> are isolated to this dashboard only.</p>}
          </div>

          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <MetricCard label="Customers" value={metrics.customers_texted} helper="Texted the agent today" tone="purple" />
              <MetricCard label="AI handled" value={metrics.ai_cases_handled} helper={`${metrics.ai_replies || 0} AI replies`} tone="blue" />
              <MetricCard label="Handovers" value={metrics.handovers} helper={`${metrics.handovers_pending || 0} still pending`} tone="orange" />
              <MetricCard label="Resolved" value={metrics.handovers_resolved} helper="Human cases completed" tone="green" />
            </div>
            <div className="rounded-[30px] bg-white border border-white shadow-lg shadow-purple-100/50 p-6">
              <div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="text-lg font-black text-slate-950">Today&apos;s SMS preview</h2><p className="text-xs text-slate-400 mt-1">This is the summary the admin receives at 8 PM.</p></div><span className="rounded-full bg-[#F0EAFF] px-3 py-1.5 text-[10px] font-black text-[#4B16B5]">{preview?.report_date}</span></div>
              <pre className="whitespace-pre-wrap rounded-2xl bg-[#25105d] px-5 py-4 text-xs leading-6 text-white/90 font-sans">{preview?.reportText || 'No report preview available.'}</pre>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-[30px] bg-white border border-white shadow-lg shadow-purple-100/50 p-6">
            <div className="mb-4"><h2 className="text-lg font-black text-slate-950">Human handover actions today</h2><p className="text-xs text-slate-400 mt-1">See whether forwarded cases were followed up or resolved.</p></div>
            {handovers.length === 0 ? <div className="rounded-2xl bg-[#fbfaff] py-9 text-center text-sm text-slate-400">No cases were handed over today.</div> : <div className="space-y-3">{handovers.map((item) => <HandoverRow key={item.id} item={item} />)}</div>}
          </div>

          <div className="rounded-[30px] bg-white border border-white shadow-lg shadow-purple-100/50 p-6">
            <div className="mb-4"><h2 className="text-lg font-black text-slate-950">Report delivery history</h2><p className="text-xs text-slate-400 mt-1">Previous automatically sent SMS reports will appear here.</p></div>
            {history.length === 0 ? <div className="rounded-2xl bg-[#fbfaff] py-9 text-center text-sm text-slate-400">No daily SMS reports sent yet.</div> : <div className="space-y-3">{history.slice(0, 8).map((report) => <div key={report.id} className="flex items-center justify-between gap-3 rounded-2xl bg-[#fbfaff] border border-purple-50 px-4 py-3"><div><div className="text-sm font-bold text-slate-900">{report.report_date}</div><div className="mt-1 text-xs text-slate-400">Sent to {report.recipient_phone}</div></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-black capitalize ${statusStyle(report.delivery_status)}`}>{report.delivery_status}</span></div>)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
