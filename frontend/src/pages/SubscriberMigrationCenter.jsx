import React, { useMemo, useState } from 'react';
import api from '../utils/api';

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10';
const CONFIRMATION = 'MIGRATE WITHOUT DISCONNECTING';

function toneForStatus(batch) {
  if (batch?.status === 'handover_active') return 'bg-emerald-100 text-emerald-800';
  if (batch?.status === 'rolled_back') return 'bg-slate-100 text-slate-700';
  if (batch?.status === 'sync_attention' || Number(batch?.error_rows) > 0) return 'bg-rose-100 text-rose-800';
  return 'bg-amber-100 text-amber-800';
}

export default function SubscriberMigrationCenter({ routers, plans, hotspotPlans, close, reload }) {
  const [file, setFile] = useState(null);
  const [routerId, setRouterId] = useState('');
  const [serviceType, setServiceType] = useState('pppoe');
  const [sourceSystem, setSourceSystem] = useState('generic');
  const [batch, setBatch] = useState(null);
  const [packageMap, setPackageMap] = useState({});
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const destinationPlans = serviceType === 'hotspot' ? hotspotPlans : plans;
  const sourcePackages = useMemo(
    () => [...new Set((batch?.rows || []).map((row) => row.normalized?.package_name).filter(Boolean))],
    [batch]
  );

  const resetValidation = () => {
    setBatch(null);
    setConfirmation('');
  };

  const encode = async (selected) => {
    const bytes = new Uint8Array(await selected.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  };

  const action = async (name, request) => {
    setBusy(name);
    setError('');
    try {
      const response = await request();
      setBatch(response.data);
      if (name === 'apply' && reload) await reload();
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || 'Migration action failed.');
    } finally {
      setBusy('');
    }
  };

  const preview = () => action('preview', async () => {
    if (!file || !routerId) throw new Error('Choose a client file and the destination MikroTik.');
    return api.post('/billing-workspace/subscriber-migrations/preview', {
      file_name: file.name,
      file_data: await encode(file),
      router_id: Number(routerId),
      service_type: serviceType,
      source_system: sourceSystem,
      package_map: packageMap,
    });
  });

  const post = (name, suffix, body = {}) => action(
    name,
    () => api.post(`/billing-workspace/subscriber-migrations/${batch.id}/${suffix}`, body)
  );

  const serviceLabel = serviceType === 'hotspot' ? 'Hotspot' : 'PPPoE';
  const canPrepare = ['radius_ready', 'sync_attention'].includes(batch?.status);
  const statusTone = toneForStatus(batch);
  const metricTone = {
    slate: 'border-slate-100 bg-slate-50',
    emerald: 'border-emerald-100 bg-emerald-50',
    amber: 'border-amber-100 bg-amber-50',
    rose: 'border-rose-100 bg-rose-50',
    sky: 'border-sky-100 bg-sky-50',
  };

  return (
    <div className="fixed inset-0 z-[13000] flex items-end justify-center bg-slate-950/65 sm:items-center sm:p-5">
      <div className="max-h-[96vh] w-full max-w-5xl overflow-y-auto rounded-t-[2rem] bg-[#f7faf8] shadow-2xl sm:rounded-[2rem]">
        <header className="sticky top-0 z-20 flex items-start justify-between border-b border-emerald-900/20 bg-[#082c20] px-5 py-5 text-white sm:px-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.25em] text-emerald-300">Non-disruptive subscriber transfer</p>
            <h3 className="mt-1 font-[Georgia,serif] text-2xl font-semibold">Migration Center</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-emerald-100/80">Stage accounts in Polyizon first, verify RADIUS, snapshot the MikroTik, then activate without intentionally dropping current sessions.</p>
          </div>
          <button type="button" onClick={close} className="rounded-xl bg-white/10 px-3 py-2 text-xl">×</button>
        </header>

        <div className="space-y-4 p-4 sm:p-7">
          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}

          <section className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-black text-slate-600">Client type
              <select
                value={serviceType}
                onChange={(event) => {
                  setServiceType(event.target.value);
                  setPackageMap({});
                  resetValidation();
                }}
                className={`${field} mt-2`}
              >
                <option value="pppoe">PPPoE subscribers</option>
                <option value="hotspot">Hotspot username/password users</option>
              </select>
            </label>

            <label className="text-xs font-black text-slate-600">Legacy billing file
              <input
                type="file"
                accept=".csv,.xlsx,.xlsm"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  resetValidation();
                }}
                className="mt-2 block w-full rounded-xl border border-slate-200 p-2 text-xs"
              />
            </label>

            <label className="text-xs font-black text-slate-600">Destination MikroTik
              <select
                value={routerId}
                onChange={(event) => {
                  setRouterId(event.target.value);
                  resetValidation();
                }}
                className={`${field} mt-2`}
              >
                <option value="">Select router</option>
                {routers.map((router) => (
                  <option key={router.id} value={router.id}>{router.name} · {router.last_status || 'status unknown'}</option>
                ))}
              </select>
            </label>

            <label className="text-xs font-black text-slate-600">Source system
              <select value={sourceSystem} onChange={(event) => { setSourceSystem(event.target.value); resetValidation(); }} className={`${field} mt-2`}>
                <option value="generic">Generic CSV / Excel</option>
                <option value="wispman">Wispman</option>
                <option value="billnasi">Billnasi</option>
              </select>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-3 sm:col-span-2 lg:col-span-4">
              <p className="max-w-3xl text-xs font-semibold leading-5 text-emerald-900">Preview is read-only against the router. It validates usernames, passwords, exact expiry dates, destination packages, existing Polyizon identities and the currently observed MikroTik clients.</p>
              <button type="button" disabled={busy || !file || !routerId} onClick={preview} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
                {busy === 'preview' ? 'Validating…' : batch ? 'Run validation again' : `Preview ${serviceLabel} migration`}
              </button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3"><p className="text-[9px] font-black uppercase tracking-wider text-emerald-600">1 · Stage</p><p className="mt-1 text-xs font-bold text-emerald-950">Create Polyizon records and RADIUS credentials first.</p></div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-3"><p className="text-[9px] font-black uppercase tracking-wider text-sky-600">2 · Shadow</p><p className="mt-1 text-xs font-bold text-sky-950">Add an isolated RADIUS entry and snapshot the current auth state.</p></div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3"><p className="text-[9px] font-black uppercase tracking-wider text-amber-600">3 · Activate safely</p><p className="mt-1 text-xs font-bold text-amber-950">Preserve legacy RADIUS and verify active sessions after the switch.</p></div>
          </section>

          {batch && <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['Rows', batch.total_rows, 'slate'],
                ['Ready', batch.ready_rows, 'emerald'],
                ['Warnings', batch.warning_rows, 'amber'],
                ['Errors', batch.error_rows, 'rose'],
                ['Online matches', batch.summary?.online_matches || 0, 'sky'],
              ].map(([label, value, tone]) => (
                <div key={label} className={`rounded-2xl border p-3 ${metricTone[tone]}`}>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
                </div>
              ))}
            </section>

            {sourcePackages.length > 0 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <h4 className="font-black text-slate-900">{serviceLabel} package mapping</h4>
                <p className="mt-1 text-xs text-slate-500">Map package names from the old billing file to the correct Polyizon {serviceLabel} packages, then validate again.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {sourcePackages.map((name) => (
                    <label key={name} className="text-xs font-bold text-slate-600">{name}
                      <select value={packageMap[name] || ''} onChange={(event) => setPackageMap({ ...packageMap, [name]: event.target.value })} className={`${field} mt-1`}>
                        <option value="">Auto-match by name/profile</option>
                        {destinationPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.name}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div><h4 className="font-black text-slate-900">Validation report</h4><p className="text-xs text-slate-500">Passwords are encrypted before migration rows are stored and are never displayed here.</p></div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${statusTone}`}>{String(batch.status || 'unknown').replaceAll('_', ' ')}</span>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[9px] uppercase tracking-wider text-slate-400"><tr><th className="p-3">Row</th><th>Client</th><th>Username</th><th>Package</th><th>Expiry</th><th>Router match</th><th>Result</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(batch.rows || []).map((row) => (
                      <tr key={row.id}>
                        <td className="p-3 font-bold">{row.row_number}</td>
                        <td>{row.normalized?.full_name}</td>
                        <td>{row.normalized?.username}</td>
                        <td>{row.normalized?.package_name || '—'}</td>
                        <td>{row.normalized?.expires_at ? new Date(row.normalized.expires_at).toLocaleString() : 'Missing'}</td>
                        <td>{row.matched_live_client_id ? 'Matched' : 'Not found'}</td>
                        <td className={row.validation_status === 'error' ? 'font-bold text-rose-600' : row.validation_status === 'warning' ? 'font-bold text-amber-600' : 'font-bold text-emerald-600'}>
                          <span>{row.validation_status}</span>
                          {[...(row.errors || []), ...(row.warnings || [])].map((message) => <span key={message} className="mt-1 block max-w-xs text-[10px] font-medium text-slate-500">{message}</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-emerald-200 bg-white p-4 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <h4 className="font-black text-slate-900">Approval and zero-drop handover</h4>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Apply writes only to Polyizon and RADIUS. Prepare records a service-specific rollback snapshot and creates a disabled batch-specific RADIUS entry. Activate enables RADIUS for {serviceLabel}, parks only matching local MikroTik credentials instead of deleting them, preserves existing legacy RADIUS entries, and checks that sessions present before activation are still present afterward.</p>
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={batch.confirmation_phrase || CONFIRMATION} className={`${field} mt-3 max-w-md font-mono`} />
                </div>
                <div className="flex flex-wrap content-start gap-2 lg:max-w-sm lg:justify-end">
                  {batch.status === 'validated' && (
                    <button type="button" disabled={busy || Number(batch.error_rows) > 0} onClick={() => post('apply', 'apply', { confirmation })} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">
                      {busy === 'apply' ? 'Synchronizing…' : 'Apply clients to Polyizon'}
                    </button>
                  )}
                  {canPrepare && (
                    <button type="button" disabled={busy} onClick={() => post('prepare', 'handover/prepare')} className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">
                      {busy === 'prepare' ? 'Preparing…' : batch.status === 'sync_attention' ? 'Retry RADIUS sync & prepare' : 'Prepare router handover'}
                    </button>
                  )}
                  {batch.status === 'handover_prepared' && (
                    <button type="button" disabled={busy} onClick={() => post('activate', 'handover/activate', { confirmation })} className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-amber-950 disabled:opacity-40">
                      {busy === 'activate' ? 'Checking sessions…' : 'Activate Polyizon authentication'}
                    </button>
                  )}
                  {['handover_prepared', 'handover_active'].includes(batch.status) && (
                    <button type="button" disabled={busy} onClick={() => post('rollback', 'handover/rollback')} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700 disabled:opacity-40">
                      {busy === 'rollback' ? 'Restoring…' : 'Restore previous router auth'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          </>}
        </div>
      </div>
    </div>
  );
}
