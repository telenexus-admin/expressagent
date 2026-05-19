import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const ACTION_STYLES = {
  admin_created: 'bg-emerald-50 text-emerald-700',
  admin_deleted: 'bg-red-50 text-red-700',
  reply_sent: 'bg-sky-50 text-sky-700',
  conversation_status_changed: 'bg-violet-50 text-violet-700',
  workflow_updated: 'bg-amber-50 text-amber-700',
  employee_created: 'bg-indigo-50 text-indigo-700',
  employee_updated: 'bg-purple-50 text-purple-700',
  employee_deleted: 'bg-red-50 text-red-700',
};

function actionLabel(action) {
  return String(action || '')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const fetchLogs = async () => {
    try {
      const { data } = await api.get('/activity?limit=150');
      setLogs(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  const actions = useMemo(() => ['all', ...new Set(logs.map((l) => l.action).filter(Boolean))], [logs]);
  const visibleLogs = filter === 'all' ? logs : logs.filter((l) => l.action === filter);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading activity logs...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f6ff] p-5 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center rounded-full bg-[#efe9ff] text-[#4B16B5] px-4 py-2 text-xs font-black mb-3">
              Owner audit trail
            </div>
            <h1 className="text-3xl font-black text-slate-950 tracking-tight">Activity Logs</h1>
            <p className="text-sm text-slate-500 mt-1">Track important actions performed by admins inside this dashboard.</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-white border border-purple-50 rounded-2xl px-4 py-3 text-sm font-bold text-slate-600 shadow-sm outline-none"
            >
              {actions.map((a) => (
                <option key={a} value={a}>{a === 'all' ? 'All actions' : actionLabel(a)}</option>
              ))}
            </select>
            <button onClick={fetchLogs} className="bg-[#4B16B5] text-white rounded-2xl px-4 py-3 text-sm font-black shadow-lg shadow-purple-200">
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="mb-5 bg-red-50 border border-red-100 text-red-700 rounded-2xl px-4 py-3 text-sm">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-[26px] p-5 shadow-lg shadow-purple-100/50 border border-white">
            <div className="text-xs font-black text-slate-400 uppercase tracking-wider">Total events</div>
            <div className="text-3xl font-black text-slate-950 mt-2">{logs.length}</div>
          </div>
          <div className="bg-white rounded-[26px] p-5 shadow-lg shadow-purple-100/50 border border-white">
            <div className="text-xs font-black text-slate-400 uppercase tracking-wider">Admins active</div>
            <div className="text-3xl font-black text-[#4B16B5] mt-2">{new Set(logs.map((l) => l.admin_email).filter(Boolean)).size}</div>
          </div>
          <div className="bg-white rounded-[26px] p-5 shadow-lg shadow-purple-100/50 border border-white">
            <div className="text-xs font-black text-slate-400 uppercase tracking-wider">Shown now</div>
            <div className="text-3xl font-black text-slate-950 mt-2">{visibleLogs.length}</div>
          </div>
        </div>

        <div className="bg-white rounded-[32px] shadow-xl shadow-purple-100/70 border border-white overflow-hidden">
          {visibleLogs.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">No activity logs yet. New actions will appear here automatically.</div>
          ) : (
            <div className="divide-y divide-purple-50">
              {visibleLogs.map((log) => (
                <div key={log.id} className="p-5 flex flex-col lg:flex-row lg:items-center gap-4 hover:bg-[#fbfaff] transition-colors">
                  <div className="w-12 h-12 rounded-2xl bg-[#F0EAFF] text-[#4B16B5] flex items-center justify-center font-black shrink-0">
                    {(log.admin_name || 'A').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-black ${ACTION_STYLES[log.action] || 'bg-slate-100 text-slate-600'}`}>
                        {actionLabel(log.action)}
                      </span>
                      <span className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900">{log.description}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      By {log.admin_name || 'Unknown admin'}{log.admin_email ? ` · ${log.admin_email}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 lg:text-right">
                    <div className="font-bold text-slate-500">{log.entity_type}</div>
                    {log.entity_id && <div>ID #{log.entity_id}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
