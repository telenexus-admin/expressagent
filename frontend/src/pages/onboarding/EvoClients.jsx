import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';

const statusStyles = {
  provisioning: 'bg-slate-100 text-slate-600',
  pending_qr: 'bg-amber-50 text-amber-700',
  connected: 'bg-blue-50 text-blue-700',
  reviewed: 'bg-purple-50 text-purple-700',
  active: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
};

const statusLabels = {
  provisioning: 'Provisioning',
  pending_qr: 'Waiting for connection',
  connected: 'Connected · review needed',
  reviewed: 'Reviewed · configure workspace',
  active: 'Workspace ready',
  failed: 'Connection failed',
};

const defaultPrompt = `You are a helpful and professional customer support agent. Answer customer questions clearly and briefly. Be empathetic and solution-focused. If you cannot resolve an issue, tell the customer a human agent will follow up soon. Never invent information.`;

function StatCard({ label, value, helper, tone = 'indigo' }) {
  const styles = {
    indigo: 'bg-gradient-to-br from-[#3535FF] to-[#6D44FF] text-white',
    amber: 'bg-white text-slate-950 border border-amber-100',
    blue: 'bg-white text-slate-950 border border-blue-100',
    green: 'bg-white text-slate-950 border border-emerald-100',
  };
  return <div className={`rounded-[25px] p-5 shadow-sm ${styles[tone]}`}><p className={`text-xs font-bold ${tone === 'indigo' ? 'text-white/70' : 'text-slate-400'}`}>{label}</p><p className="mt-2 text-3xl font-black">{value}</p><p className={`mt-2 text-[11px] ${tone === 'indigo' ? 'text-white/70' : 'text-slate-400'}`}>{helper}</p></div>;
}

function StatusBadge({ status }) {
  return <span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${statusStyles[status] || 'bg-slate-100 text-slate-600'}`}>{statusLabels[status] || status}</span>;
}

function Field({ label, value, onChange, placeholder, type = 'text', required = true }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-slate-600">{label}</span><input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-slate-200 bg-[#F8F8FD] px-4 py-3 text-sm outline-none focus:border-[#3535FF] focus:ring-2 focus:ring-[#3535FF]/10" /></label>;
}

function WorkspaceModal({ client, onClose, onCreated }) {
  const [form, setForm] = useState({
    agent_name: `${client.business_name || client.owner_name} Assistant`,
    support_number: client.phone || '',
    system_prompt: defaultPrompt,
    opening_message: `Hello! Welcome to ${client.business_name}. How may I assist you today?`,
    photo_troubleshooting_enabled: true,
    admin_name: client.owner_name || '',
    admin_email: client.email || '',
    admin_password: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/evo-clients/${client.id}/workspace`, form);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not create client workspace.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-sm"><div className="mx-auto max-w-3xl rounded-[32px] bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 px-6 py-5 sm:px-8"><div><p className="text-xs font-black tracking-[0.18em] text-[#3535FF]">EVOLUTION CLIENT WORKSPACE</p><h2 className="mt-2 text-2xl font-black text-slate-950">Configure {client.business_name}</h2><p className="mt-1 text-sm text-slate-500">Set the agent identity and create the client dashboard login.</p></div><button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-500">Close</button></div><form onSubmit={submit} className="px-6 py-6 sm:px-8"><div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700"><strong>Connection:</strong> {client.instance_name}. The dashboard will be ready after this step. Live Evolution AI message routing is activated separately in the next setup stage.</div><div className="grid grid-cols-1 gap-5 sm:grid-cols-2"><Field label="Agent name" value={form.agent_name} onChange={(v) => update('agent_name', v)} placeholder="e.g. MaxNet Assistant" /><Field label="Human support number" value={form.support_number} onChange={(v) => update('support_number', v)} placeholder="2547XXXXXXXX" required={false} /><Field label="Dashboard admin name" value={form.admin_name} onChange={(v) => update('admin_name', v)} placeholder="Owner or administrator" /><Field label="Dashboard login email" type="email" value={form.admin_email} onChange={(v) => update('admin_email', v)} placeholder="admin@company.com" /><Field label="Temporary dashboard password" type="password" value={form.admin_password} onChange={(v) => update('admin_password', v)} placeholder="Minimum 8 characters" /></div><label className="mt-5 block"><span className="mb-2 block text-xs font-bold text-slate-600">Welcome message</span><textarea rows={2} value={form.opening_message} onChange={(e) => update('opening_message', e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-[#F8F8FD] px-4 py-3 text-sm outline-none focus:border-[#3535FF]" /></label><label className="mt-5 block"><span className="mb-2 block text-xs font-bold text-slate-600">Agent instruction / system prompt</span><textarea rows={5} value={form.system_prompt} onChange={(e) => update('system_prompt', e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-[#F8F8FD] px-4 py-3 text-sm leading-6 outline-none focus:border-[#3535FF]" /></label><label className="mt-5 flex items-center gap-3 rounded-2xl bg-[#F6F7FF] p-4 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.photo_troubleshooting_enabled} onChange={(e) => update('photo_troubleshooting_enabled', e.target.checked)} className="h-4 w-4 accent-[#3535FF]" />Enable photo troubleshooting for this client</label>{error && <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}<div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-6 py-3.5 text-sm font-bold text-slate-600">Cancel</button><button type="submit" disabled={saving} className="rounded-2xl bg-[#3535FF] px-7 py-3.5 text-sm font-black text-white shadow-lg disabled:opacity-50">{saving ? 'Creating workspace...' : 'Create client workspace'}</button></div></form></div></div>;
}

export default function EvoClients() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total: 0, waiting_scan: 0, connected: 0, active: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [configureClient, setConfigureClient] = useState(null);

  const load = async () => {
    try {
      const [clientsResult, summaryResult] = await Promise.all([api.get('/evo-clients'), api.get('/evo-clients/summary')]);
      setRows(clientsResult.data || []);
      setSummary(summaryResult.data || {});
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load Evo clients.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); const interval = setInterval(load, 20000); return () => clearInterval(interval); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((row) => `${row.business_name} ${row.owner_name} ${row.email} ${row.phone} ${row.location || ''}`.toLowerCase().includes(q));
  }, [rows, search]);

  const refresh = async (id) => {
    setBusyId(id);
    try { await api.post(`/evo-clients/${id}/refresh`); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Could not refresh this connection.'); }
    finally { setBusyId(null); }
  };

  const setStatus = async (id, status) => {
    setBusyId(id);
    try { await api.patch(`/evo-clients/${id}/status`, { status }); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Could not update this client.'); }
    finally { setBusyId(null); }
  };

  const workspaceCreated = async (data) => {
    setConfigureClient(null);
    setSuccess(`Workspace created. Dashboard login: ${data.admin.email} at /login. Live Evolution AI routing is the next activation step.`);
    await load();
  };

  if (loading) return <div className="flex min-h-full items-center justify-center text-sm text-slate-400">Loading Evo Clients...</div>;

  return <div className="min-h-full bg-[#F7F7FF] p-5 sm:p-7"><div className="mx-auto max-w-7xl"><div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><span className="mb-3 inline-flex rounded-full bg-[#E9E9FF] px-4 py-2 text-xs font-black text-[#3535FF]">EVOLUTION API ONBOARDING</span><h1 className="text-3xl font-black tracking-tight text-slate-950">Evo Clients</h1><p className="mt-1 text-sm text-slate-500">Review connected businesses, configure their agent and create their Nexa dashboards.</p></div><div className="rounded-2xl bg-white px-5 py-3 text-xs font-bold text-slate-500 shadow-sm">Public link: <span className="text-[#3535FF]">/self-onboarding</span></div></div>{error && <div className="mb-5 rounded-2xl border border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</div>}{success && <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-3 text-sm text-emerald-700">{success}</div>}<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Total signups" value={summary.total || 0} helper="Evolution onboarding requests" tone="indigo" /><StatCard label="Waiting to connect" value={summary.waiting_scan || 0} helper="QR or pairing pending" tone="amber" /><StatCard label="Connected" value={summary.connected || 0} helper="Ready for your review" tone="blue" /><StatCard label="Workspace ready" value={summary.active || 0} helper="Client dashboard created" tone="green" /></div><div className="overflow-hidden rounded-[30px] border border-white bg-white shadow-xl shadow-indigo-100/50"><div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-black text-slate-950">Self-onboarded businesses</h2><p className="mt-1 text-xs text-slate-400">A reviewed client receives a dashboard only after you configure their workspace.</p></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client, owner or email..." className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#3535FF]/20 sm:max-w-xs" /></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-400"><tr><th className="px-6 py-4">Business</th><th className="px-6 py-4">Contact</th><th className="px-6 py-4">WhatsApp Instance</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Action</th></tr></thead><tbody className="divide-y divide-slate-50">{filtered.map((row) => <tr key={row.id} className="hover:bg-slate-50/50"><td className="px-6 py-5"><p className="font-bold text-slate-950">{row.business_name}</p><p className="mt-1 text-xs text-slate-400">{row.location || 'Location not provided'} · {new Date(row.created_at).toLocaleDateString()}</p>{row.workspace_client_id && <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Dashboard created</p>}</td><td className="px-6 py-5"><p className="font-semibold text-slate-800">{row.owner_name}</p><p className="mt-1 text-xs text-slate-400">{row.email}</p><p className="text-xs text-slate-400">{row.phone}</p>{row.dashboard_admin_email && <p className="mt-2 text-xs font-semibold text-[#3535FF]">Login: {row.dashboard_admin_email}</p>}</td><td className="px-6 py-5"><p className="max-w-[220px] truncate font-mono text-xs text-slate-600">{row.instance_name}</p><p className="mt-1 text-xs text-slate-400">{row.connection_state || 'Not checked'}</p></td><td className="px-6 py-5"><StatusBadge status={row.status} /></td><td className="px-6 py-5"><div className="flex flex-wrap gap-2">{['pending_qr', 'failed'].includes(row.status) && <button disabled={busyId === row.id} onClick={() => refresh(row.id)} className="rounded-full bg-[#E9E9FF] px-4 py-2 text-xs font-black text-[#3535FF] disabled:opacity-50">Refresh</button>}{row.status === 'connected' && <button disabled={busyId === row.id} onClick={() => setStatus(row.id, 'reviewed')} className="rounded-full bg-[#3535FF] px-4 py-2 text-xs font-black text-white disabled:opacity-50">Mark reviewed</button>}{row.status === 'reviewed' && !row.workspace_client_id && <button onClick={() => setConfigureClient(row)} className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-black text-white">Configure workspace</button>}{row.workspace_client_id && <span className="rounded-full bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">Dashboard ready</span>}{!['archived', 'active'].includes(row.status) && !row.workspace_client_id && <button disabled={busyId === row.id} onClick={() => setStatus(row.id, 'archived')} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-500 disabled:opacity-50">Archive</button>}</div>{row.provider_error && <p className="mt-2 max-w-xs text-[11px] text-rose-500">{row.provider_error}</p>}</td></tr>)}{filtered.length === 0 && <tr><td colSpan={5} className="px-6 py-14 text-center text-sm text-slate-400">No Evolution self-onboarded clients yet.</td></tr>}</tbody></table></div></div></div>{configureClient && <WorkspaceModal client={configureClient} onClose={() => setConfigureClient(null)} onCreated={workspaceCreated} />}</div>;
}