import React, { useMemo, useState } from 'react';
import api from '../utils/api';

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10';
const CONFIRMATION = 'MIGRATE WITHOUT DISCONNECTING';

function Step({ n, title, text, active, done }) {
  return <div className={`rounded-2xl border p-3 ${done ? 'border-emerald-200 bg-emerald-50' : active ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
    <div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${done ? 'bg-emerald-600 text-white' : active ? 'bg-amber-400 text-amber-950' : 'bg-slate-100 text-slate-500'}`}>{done ? '✓' : n}</span><b className="text-xs text-slate-900">{title}</b></div>
    <p className="mt-1.5 text-[11px] leading-4 text-slate-500">{text}</p>
  </div>;
}

function statusRank(status) {
  return ['validated', 'shadow_ready', 'handover_prepared', 'handover_active'].indexOf(status);
}

export default function SubscriberMigrationCenter({ routers = [], plans = [], hotspotPlans = [], close, reload }) {
  const [sourceSystem, setSourceSystem] = useState('wispman');
  const [serviceType, setServiceType] = useState('pppoe');
  const [routerId, setRouterId] = useState('');
  const [file, setFile] = useState(null);
  const [batch, setBatch] = useState(null);
  const [packageMap, setPackageMap] = useState({});
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const isWispman = sourceSystem === 'wispman';
  const destinationPlans = serviceType === 'hotspot' ? hotspotPlans : plans;
  const sourcePackages = useMemo(() => [...new Set((batch?.rows || []).map((r) => r.normalized?.package_name).filter(Boolean))], [batch]);
  const rank = statusRank(batch?.status);

  const reset = () => { setBatch(null); setConfirmation(''); setError(''); };
  const encode = async (selected) => {
    const bytes = new Uint8Array(await selected.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const run = async (name, request) => {
    setBusy(name); setError('');
    try {
      const response = await request();
      setBatch(response.data);
      if (name === 'apply' && reload) await reload();
    } catch (e) { setError(e.response?.data?.error || e.message || 'Migration action failed.'); }
    finally { setBusy(''); }
  };
  const preview = () => run('preview', async () => {
    if (!file || !routerId) throw new Error('Choose the export file and destination MikroTik.');
    return api.post('/billing-workspace/subscriber-migrations/preview', {
      file_name: file.name, file_data: await encode(file), router_id: Number(routerId),
      service_type: serviceType, source_system: sourceSystem, package_map: packageMap,
    });
  });
  const post = (name, path, body = {}) => run(name, () => api.post(`/billing-workspace/subscriber-migrations/${batch.id}/${path}`, body));

  const steps = isWispman ? [
    ['Reconcile', 'Match Wispman export to the real local users already on MikroTik.'],
    ['Shadow import', 'Create Polyizon billing records. Customer passwords and MikroTik users stay untouched.'],
    ['Prove control', 'Polyizon creates and removes one disabled temporary test user; no customer is used.'],
    ['Cut over', 'Revoke the dedicated Wispman MikroTik API controller and verify online sessions remain.'],
    ['Polyizon primary', 'Polyizon manages the same local users through MikroTik API after migration.'],
  ] : [
    ['Validate', 'Validate file, router matches, expiry and packages.'],
    ['Stage', 'Create Polyizon records and synchronize RADIUS credentials.'],
    ['Prepare', 'Snapshot RouterOS and add an isolated disabled Polyizon RADIUS entry.'],
    ['Activate', 'Enable Polyizon authentication with session-preservation checks.'],
    ['Complete', 'Keep rollback data while Polyizon becomes authoritative.'],
  ];

  const metric = isWispman && batch ? [
    ['Wispman rows', batch.total_rows], ['Router users', batch.summary?.router_accounts || 0],
    ['Matched', batch.summary?.matched_router_accounts || 0], ['Online now', batch.summary?.active_sessions || 0],
    ['Router only', batch.summary?.router_only_accounts || 0],
  ] : batch ? [['Rows', batch.total_rows], ['Ready', batch.ready_rows], ['Warnings', batch.warning_rows], ['Errors', batch.error_rows], ['Online matches', batch.summary?.online_matches || 0]] : [];

  return <div className="fixed inset-0 z-[13000] flex items-end justify-center bg-slate-950/70 sm:items-center sm:p-5">
    <div className="max-h-[96vh] w-full max-w-6xl overflow-y-auto rounded-t-[2rem] bg-[#f7faf8] shadow-2xl sm:rounded-[2rem]">
      <header className="sticky top-0 z-20 flex items-start justify-between bg-[#082c20] px-5 py-5 text-white sm:px-7">
        <div><p className="text-[10px] font-black uppercase tracking-[.25em] text-emerald-300">Migration command center</p><h3 className="mt-1 font-[Georgia,serif] text-2xl font-semibold">Move to Polyizon without rebuilding the network</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-emerald-100/80">{isWispman ? 'Wispman migration keeps the existing MikroTik PPPoE/Hotspot users and active sessions. We transfer billing control, not customer credentials.' : 'Use the RADIUS handover path only for billing systems whose subscribers actually authenticate through RADIUS.'}</p></div>
        <button onClick={close} className="rounded-xl bg-white/10 px-3 py-2 text-xl">×</button>
      </header>

      <div className="space-y-4 p-4 sm:p-7">
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
        <section className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-black text-slate-600">Current billing system<select value={sourceSystem} onChange={(e) => { setSourceSystem(e.target.value); setPackageMap({}); reset(); }} className={`${field} mt-2`}><option value="wispman">Wispman — MikroTik API takeover</option><option value="billnasi">Billnasi — RADIUS migration</option><option value="generic">Other / Generic — RADIUS migration</option></select></label>
          <label className="text-xs font-black text-slate-600">Client type<select value={serviceType} onChange={(e) => { setServiceType(e.target.value); setPackageMap({}); reset(); }} className={`${field} mt-2`}><option value="pppoe">PPPoE subscribers</option><option value="hotspot">Hotspot username/password users</option></select></label>
          <label className="text-xs font-black text-slate-600">MikroTik<select value={routerId} onChange={(e) => { setRouterId(e.target.value); reset(); }} className={`${field} mt-2`}><option value="">Select router</option>{routers.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.last_status || 'status unknown'}</option>)}</select></label>
          <label className="text-xs font-black text-slate-600">Latest export<input type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => { setFile(e.target.files?.[0] || null); reset(); }} className="mt-2 block w-full rounded-xl border border-slate-200 p-2 text-xs" /></label>
          <div className={`flex items-center justify-between gap-3 rounded-2xl p-3 sm:col-span-2 lg:col-span-4 ${isWispman ? 'bg-emerald-50' : 'bg-sky-50'}`}><div><b className="text-xs text-slate-900">{isWispman ? 'Read-only reconciliation first' : 'Validation first'}</b><p className="mt-1 text-[11px] leading-4 text-slate-600">{isWispman ? 'Preview reads Wispman export + live MikroTik. Password export is not required. No RouterOS write occurs.' : 'Preview validates the import before any router authentication setting changes.'}</p></div><button disabled={busy || !file || !routerId} onClick={preview} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">{busy === 'preview' ? 'Reconciling…' : batch ? 'Re-run reconciliation' : 'Analyze migration'}</button></div>
        </section>

        <section className="grid gap-2 sm:grid-cols-5">{steps.map(([title, text], i) => <Step key={title} n={i + 1} title={title} text={text} done={rank >= i && batch?.status !== 'rolled_back'} active={rank === i - 1} />)}</section>

        {batch && <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">{metric.map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>)}</section>

          {isWispman && <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><b className="text-xs text-emerald-900">Passwords stay on MikroTik</b><p className="mt-1 text-[11px] text-emerald-700">No PPPoE or Hotspot password is replaced during migration.</p></div><div className="rounded-2xl border border-sky-200 bg-sky-50 p-3"><b className="text-xs text-sky-900">Sessions stay where they are</b><p className="mt-1 text-[11px] text-sky-700">Cutover changes the billing controller, not the established PPP/Hotspot session.</p></div><div className="rounded-2xl border border-amber-200 bg-amber-50 p-3"><b className="text-xs text-amber-900">No shared-admin guessing</b><p className="mt-1 text-[11px] text-amber-700">Polyizon only auto-disables a clearly identified Wispman API user.</p></div></div>}

          {sourcePackages.length > 0 && <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><h4 className="font-black text-slate-900">Package translation</h4><p className="mt-1 text-xs text-slate-500">Map the old billing package to Polyizon. Wispman cutover does not rewrite the current MikroTik profile.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{sourcePackages.map((name) => <label key={name} className="text-xs font-bold text-slate-600">{name}<select value={packageMap[name] || ''} onChange={(e) => setPackageMap({ ...packageMap, [name]: e.target.value })} className={`${field} mt-1`}><option value="">Auto-match</option>{destinationPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</div><p className="mt-3 text-[11px] font-semibold text-amber-700">After changing a mapping, run reconciliation again before importing.</p></section>}

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h4 className="font-black text-slate-900">{isWispman ? 'Wispman ↔ MikroTik reconciliation' : 'Validation report'}</h4><p className="text-xs text-slate-500">{isWispman ? 'Every migrated username must already exist on the selected MikroTik.' : 'Resolve errors before continuing.'}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase text-slate-700">{String(batch.status).replaceAll('_', ' ')}</span></div><div className="max-h-72 overflow-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[9px] uppercase text-slate-400"><tr><th className="p-3">Row</th><th>Client</th><th>Username</th><th>Package</th>{isWispman && <th>Router profile</th>}<th>Online</th><th>Result</th></tr></thead><tbody className="divide-y divide-slate-100">{(batch.rows || []).map((r) => <tr key={r.id}><td className="p-3 font-bold">{r.row_number}</td><td>{r.normalized?.full_name}</td><td>{r.normalized?.username}</td><td>{r.normalized?.package_name || '—'}</td>{isWispman && <td>{r.normalized?.router_profile || '—'}</td>}<td>{r.normalized?.router_online || r.matched_live_client_id ? 'Yes' : 'No'}</td><td className={r.validation_status === 'error' ? 'font-bold text-rose-600' : r.validation_status === 'warning' ? 'font-bold text-amber-600' : 'font-bold text-emerald-600'}>{r.validation_status}{[...(r.errors || []), ...(r.warnings || [])].map((m) => <span key={m} className="mt-1 block max-w-xs text-[10px] font-medium text-slate-500">{m}</span>)}</td></tr>)}</tbody></table></div></section>

          {isWispman && (batch.summary?.legacy_api_candidates || []).length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h4 className="text-xs font-black text-amber-950">Possible Wispman MikroTik controller</h4><div className="mt-2 flex flex-wrap gap-2">{batch.summary.legacy_api_candidates.map((c) => <span key={c.name} className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-amber-800">{c.name} · {c.confidence} · {c.disabled === 'yes' ? 'disabled' : 'enabled'}</span>)}</div></section>}

          <section className="rounded-3xl border border-emerald-200 bg-white p-4 shadow-sm"><div className="grid gap-4 lg:grid-cols-[1fr_auto]"><div><h4 className="font-black text-slate-900">{isWispman ? 'Zero-drop controller handover' : 'Approval and handover'}</h4><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">{isWispman ? 'Import changes Polyizon only. The control test uses a disabled disposable RouterOS user. Final cutover disables only a confidently identified Wispman API account, checks the same active sessions still exist, then arms Polyizon local-API control.' : 'Use the staged RADIUS workflow with rollback and active-session checks.'}</p><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={batch.confirmation_phrase || CONFIRMATION} className={`${field} mt-3 max-w-md font-mono`} /></div><div className="flex flex-wrap content-start gap-2 lg:max-w-sm lg:justify-end">
            {batch.status === 'validated' && <button disabled={busy || Number(batch.error_rows) > 0} onClick={() => post('apply', 'apply', { confirmation })} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">{busy === 'apply' ? 'Importing…' : isWispman ? 'Import billing records — router untouched' : 'Apply clients to Polyizon'}</button>}
            {isWispman && batch.status === 'shadow_ready' && <button disabled={busy} onClick={() => post('prepare', 'handover/prepare')} className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white">{busy === 'prepare' ? 'Testing…' : 'Run safe MikroTik API control test'}</button>}
            {!isWispman && ['radius_ready', 'sync_attention'].includes(batch.status) && <button disabled={busy} onClick={() => post('prepare', 'handover/prepare')} className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white">Prepare router handover</button>}
            {batch.status === 'handover_prepared' && <button disabled={busy} onClick={() => post('activate', 'handover/activate', { confirmation })} className="rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-black text-amber-950">{busy === 'activate' ? 'Verifying sessions…' : isWispman ? 'MAKE POLYIZON PRIMARY' : 'Activate Polyizon authentication'}</button>}
            {isWispman && ['shadow_ready', 'handover_prepared'].includes(batch.status) && <button disabled={busy} onClick={() => post('rollback', 'handover/rollback')} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700">Remove staged import</button>}
            {['handover_active'].includes(batch.status) && <button disabled={busy} onClick={() => post('rollback', 'handover/rollback')} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700">Restore previous controller</button>}
          </div></div></section>

          {isWispman && batch.status === 'handover_active' && <section className="rounded-3xl bg-[#082c20] p-5 text-white"><p className="text-[10px] font-black uppercase tracking-[.22em] text-emerald-300">Migration complete</p><h4 className="mt-1 text-xl font-black">Polyizon is the primary billing controller</h4><div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] text-emerald-100">Customer sessions dropped</p><b className="text-2xl">{batch.handover_result?.customer_sessions_dropped ?? 0}</b></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] text-emerald-100">Passwords changed</p><b className="text-2xl">{batch.handover_result?.customer_passwords_changed ?? 0}</b></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] text-emerald-100">Legacy API</p><b className="text-sm">{batch.handover_result?.legacy_api_username || 'verified externally'} · revoked</b></div></div></section>}
        </>}
      </div>
    </div>
  </div>;
}
