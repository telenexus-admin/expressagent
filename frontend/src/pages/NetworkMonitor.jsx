import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import { CheckCircleIcon, CogIcon, PulseIcon, WarningIcon, WrenchIcon } from '../components/Icons';

const FEATURE_OPTIONS = [
  ['ppp_active', 'PPPoE active users'],
  ['ppp_secrets', 'PPPoE secrets'],
  ['hotspot_active', 'Hotspot active users'],
  ['dhcp_leases', 'DHCP leases'],
  ['interfaces', 'Interfaces'],
  ['logs', 'Router logs'],
  ['ping', 'Ping tests'],
];

const emptyFeatures = Object.fromEntries(FEATURE_OPTIONS.map(([key]) => [key, true]));

const emptyForm = {
  id: null,
  name: '',
  host: '',
  port: 8728,
  connection_type: 'api',
  username: '',
  password: '',
  is_active: true,
  features: emptyFeatures,
};

const NEXA_SERVER_IP = '64.227.156.219';

function routerOsQuote(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeAllowedApiAddresses(extraAddresses) {
  const addresses = String(extraAddresses || '')
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.includes('/') ? value : `${value}/32`));
  return [`${NEXA_SERVER_IP}/32`, ...addresses].join(',');
}

function buildRouterOsCommands(mode, password, extraAddresses = '') {
  const service = mode === 'api-ssl' ? 'api-ssl' : 'api';
  const port = mode === 'api-ssl' ? 8729 : 8728;
  return `/ip service enable ${service}
/ip service set ${service} port=${port} address=${normalizeAllowedApiAddresses(extraAddresses)}
/user group add name=nexa-readonly policy=read,test
/user add name=nexa group=nexa-readonly password="${routerOsQuote(password)}"`;
}

function statusClass(status) {
  if (status === 'online') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (status === 'error') return 'border-red-100 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, type = 'text', placeholder = '', autoComplete = 'off' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="h-11 w-full rounded-xl border border-[#dfe5f2] bg-white px-3 text-sm font-semibold text-[#101633] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#eee9ff]"
    />
  );
}

function StatCard({ icon: Icon, label, value, helper, tone = 'purple' }) {
  const tones = {
    purple: 'bg-[#efe9ff] text-[#4f35f5]',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="rounded-2xl border border-[#e5e9f4] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#8a92ad]">{label}</p>
          <p className="mt-2 text-xl font-black text-[#101633]">{value}</p>
          <p className="mt-1 text-xs font-semibold text-[#6d7697]">{helper}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tones[tone] || tones.purple}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function CommandGenerator() {
  const [mode, setMode] = useState('api');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [existingApiIps, setExistingApiIps] = useState('');
  const [copied, setCopied] = useState(false);
  const passwordReady = password.length >= 8 && password === confirmPassword;
  const error = !password
    ? ''
    : password.length < 8
      ? 'Use at least 8 characters for the MikroTik API password.'
      : password !== confirmPassword
        ? 'Password confirmation does not match.'
        : '';
  const commands = passwordReady
    ? buildRouterOsCommands(mode, password, existingApiIps)
    : buildRouterOsCommands(mode, 'ENTER_PASSWORD_ABOVE', existingApiIps);

  async function copy() {
    if (!passwordReady) return;
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#dfe5f2] bg-[#fbfcff] p-4">
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div>
          <h3 className="text-sm font-black text-[#101633]">Generate RouterOS Script</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#6d7697]">
            Choose the API type, enter the password the admin wants to use, confirm it, then copy the final script.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">Connection type</span>
              <select
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value);
                  setCopied(false);
                }}
                className="h-11 w-full rounded-xl border border-[#dfe5f2] bg-white px-3 text-sm font-black text-[#101633] outline-none focus:border-[#5b35f5]"
              >
                <option value="api">Standard API - port 8728</option>
                <option value="api-ssl">API-SSL - port 8729</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">MikroTik API password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setCopied(false);
                }}
                placeholder="Enter a strong password"
                className="h-11 w-full rounded-xl border border-[#dfe5f2] bg-white px-3 text-sm font-semibold text-[#101633] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#eee9ff]"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">Existing billing/API server IPs</span>
              <input
                type="text"
                value={existingApiIps}
                onChange={(event) => {
                  setExistingApiIps(event.target.value);
                  setCopied(false);
                }}
                placeholder="Optional, e.g. 10.133.0.1"
                className="h-11 w-full rounded-xl border border-[#dfe5f2] bg-white px-3 text-sm font-semibold text-[#101633] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#eee9ff]"
              />
              <span className="mt-1.5 block text-[11px] font-semibold leading-5 text-[#7a849f]">
                Add any billing system IP already using MikroTik API so Nexa does not block it. Separate multiple IPs with commas.
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setCopied(false);
                }}
                placeholder="Confirm the same password"
                className="h-11 w-full rounded-xl border border-[#dfe5f2] bg-white px-3 text-sm font-semibold text-[#101633] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#eee9ff]"
              />
            </label>
            {error && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div>}
            {passwordReady && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                Ready. Use username <span className="font-mono">nexa</span>, this password, host/router IP, and port {mode === 'api-ssl' ? '8729' : '8728'} in the form below.
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-black text-[#101633]">Final command script</h3>
              <p className="mt-1 text-xs font-semibold text-[#6d7697]">
                Nexa server IP is already set to {NEXA_SERVER_IP}/32. Existing API server IPs are preserved when entered.
              </p>
            </div>
            <button
              type="button"
              onClick={copy}
              disabled={!passwordReady}
              className="h-9 rounded-xl bg-[#4f35f5] px-4 text-xs font-black text-white shadow-[0_10px_22px_rgba(79,53,245,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? 'Copied' : 'Copy Script'}
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-[#101633] p-4 text-xs font-semibold leading-6 text-white"><code>{commands}</code></pre>
        </div>
      </div>
    </div>
  );
}

export default function NetworkMonitor() {
  const [routers, setRouters] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [routerTestStatus, setRouterTestStatus] = useState({});

  async function loadRouters() {
    setLoading(true);
    try {
      const { data } = await api.get('/mikrotik');
      setRouters(Array.isArray(data) ? data : []);
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load MikroTik routers.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRouters();
  }, []);

  const summary = useMemo(() => {
    const online = routers.filter((router) => router.last_status === 'online').length;
    const active = routers.filter((router) => router.is_active).length;
    const errors = routers.filter((router) => router.last_status === 'error').length;
    return { online, active, errors, total: routers.length };
  }, [routers]);

  function update(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'connection_type' && !current.id) next.port = value === 'api-ssl' ? 8729 : 8728;
      return next;
    });
    setStatus(null);
  }

  function updateFeature(key, value) {
    setForm((current) => ({ ...current, features: { ...current.features, [key]: value } }));
  }

  function resetForm() {
    setForm(emptyForm);
    setStatus(null);
  }

  function editRouter(router) {
    setForm({
      id: router.id,
      name: router.name || '',
      host: router.host || '',
      port: router.port || (router.connection_type === 'api-ssl' ? 8729 : 8728),
      connection_type: router.connection_type || 'api',
      username: router.username || '',
      password: '',
      is_active: router.is_active !== false,
      features: { ...emptyFeatures, ...(router.features || {}) },
    });
    setStatus({ type: 'info', message: 'Editing saved router. Leave password blank to keep the current password.' });
  }

  async function saveRouter() {
    setSaving(true);
    setStatus(null);
    try {
      const payload = { ...form, port: Number(form.port || 0) };
      const { data } = await api.post('/mikrotik', payload);
      setRouters((current) => {
        const exists = current.some((router) => router.id === data.id);
        return exists ? current.map((router) => (router.id === data.id ? data : router)) : [data, ...current];
      });
      resetForm();
      setStatus({ type: 'success', message: 'MikroTik router saved. Use Test Connection to confirm live access.' });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to save MikroTik router.' });
    } finally {
      setSaving(false);
    }
  }

  async function testRouter(router = null) {
    setTesting(!router);
    setBusyId(router ? `test-${router.id}` : '');
    const targetName = router?.name || form.name || 'MikroTik router';
    const testingMessage = `Testing ${targetName} connection. This can take up to 20 seconds...`;
    setStatus({ type: 'info', message: testingMessage });
    if (router) {
      setRouterTestStatus((current) => ({
        ...current,
        [router.id]: { type: 'info', message: testingMessage },
      }));
    }
    try {
      const payload = router ? { id: router.id } : { ...form, port: Number(form.port || 0) };
      const { data } = await api.post('/mikrotik/test', payload, { timeout: 30000 });
      const successStatus = {
        type: 'success',
        message: `Connected to ${data.identity || 'router'}${data.version ? ` on RouterOS ${data.version}` : ''}.`,
      };
      setStatus(successStatus);
      if (router) {
        setRouterTestStatus((current) => ({ ...current, [router.id]: successStatus }));
      }
      await loadRouters();
    } catch (err) {
      const message = err.code === 'ECONNABORTED'
        ? 'MikroTik test request timed out. Confirm the router public IP/host and API port are reachable from the Nexa server.'
        : err.response?.data?.error || 'MikroTik connection failed.';
      const errorStatus = { type: 'error', message };
      setStatus(errorStatus);
      if (router) {
        setRouterTestStatus((current) => ({ ...current, [router.id]: errorStatus }));
      }
      if (router) await loadRouters();
    } finally {
      setTesting(false);
      setBusyId('');
    }
  }

  async function deleteRouter(router) {
    if (!window.confirm(`Delete ${router.name}?`)) return;
    setBusyId(`delete-${router.id}`);
    try {
      await api.delete(`/mikrotik/${router.id}`);
      setRouters((current) => current.filter((row) => row.id !== router.id));
      setStatus({ type: 'success', message: 'MikroTik router deleted.' });
      if (form.id === router.id) resetForm();
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to delete MikroTik router.' });
    } finally {
      setBusyId('');
    }
  }

  async function toggleActive(router) {
    setBusyId(`active-${router.id}`);
    try {
      const { data } = await api.post('/mikrotik', { ...router, is_active: !router.is_active });
      setRouters((current) => current.map((row) => (row.id === data.id ? data : row)));
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to update router.' });
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8faff] p-5 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-normal text-[#101633]">Network Monitor</h1>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[#657194]">
              Link the AI agent to MikroTik RouterOS API so it can read router health, PPPoE or Hotspot activity, and prepare diagnostics before support acts.
            </p>
          </div>
          <button
            type="button"
            onClick={loadRouters}
            className="h-11 rounded-xl border border-[#d8def0] bg-white px-5 text-sm font-black text-[#4f35f5] shadow-sm"
          >
            Refresh Routers
          </button>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={WrenchIcon} label="Routers" value={summary.total} helper="Saved RouterOS API links." />
          <StatCard icon={CheckCircleIcon} label="Online" value={summary.online} helper="Last test connected." tone="green" />
          <StatCard icon={PulseIcon} label="Active" value={summary.active} helper="Enabled for monitoring." tone="blue" />
          <StatCard icon={WarningIcon} label="Attention" value={summary.errors} helper="Last test failed." tone="amber" />
        </div>

        {status && (
          <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-bold ${
            status.type === 'success'
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : status.type === 'info'
                ? 'border-blue-100 bg-blue-50 text-blue-700'
                : 'border-red-100 bg-red-50 text-red-700'
          }`}>
            {status.message}
          </div>
        )}

        <section className="mb-5 rounded-[24px] border border-[#dfe5f2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe9ff] text-[#4f35f5]">
              <WrenchIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-black text-[#101633]">How to Link MikroTik</h2>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#6d7697]">
                Generate the command script, paste it into MikroTik Terminal or Winbox Terminal, then use the same username and password in the router form below.
              </p>
            </div>
          </div>
          <CommandGenerator />
          <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
            For production, do not expose API to the whole internet. Keep the user read-only, use a strong password, and limit the API service to the Nexa backend server IP.
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-[24px] border border-[#dfe5f2] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe9ff] text-[#4f35f5]">
                <CogIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-black text-[#101633]">{form.id ? 'Edit Router Link' : 'Add MikroTik Router'}</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#6d7697]">
                  Use a RouterOS API user with read and test permissions. Restrict API access to the Nexa server IP on the router.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <Field label="Router name">
                <TextInput value={form.name} onChange={(value) => update('name', value)} placeholder="Main core router" />
              </Field>
              <Field label="Host or public IP">
                <TextInput value={form.host} onChange={(value) => update('host', value)} placeholder="router.example.com or 102.x.x.x" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Connection">
                  <select
                    value={form.connection_type}
                    onChange={(event) => update('connection_type', event.target.value)}
                    className="h-11 w-full rounded-xl border border-[#dfe5f2] bg-white px-3 text-sm font-black text-[#101633] outline-none focus:border-[#5b35f5]"
                  >
                    <option value="api">RouterOS API</option>
                    <option value="api-ssl">RouterOS API-SSL</option>
                  </select>
                </Field>
                <Field label="Port">
                  <TextInput type="number" value={form.port} onChange={(value) => update('port', value)} />
                </Field>
              </div>
              <Field label="Username">
                <TextInput value={form.username} onChange={(value) => update('username', value)} placeholder="nexa" autoComplete="username" />
              </Field>
              <Field label={form.id ? 'Password (leave blank to keep current)' : 'Password'}>
                <TextInput type="password" value={form.password} onChange={(value) => update('password', value)} autoComplete="new-password" />
              </Field>

              <div className="rounded-2xl border border-[#edf1f7] bg-[#fbfcff] p-4">
                <div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">Agent can read</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FEATURE_OPTIONS.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#34405f]">
                      <input
                        type="checkbox"
                        checked={form.features[key] !== false}
                        onChange={(event) => updateFeature(key, event.target.checked)}
                        className="h-4 w-4 accent-[#4f35f5]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-2xl border border-[#edf1f7] bg-[#fbfcff] px-4 py-3 text-sm font-black text-[#34405f]">
                <input type="checkbox" checked={form.is_active} onChange={(event) => update('is_active', event.target.checked)} className="h-4 w-4 accent-[#4f35f5]" />
                Enable this router for monitoring
              </label>

              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                {form.id && (
                  <button type="button" onClick={resetForm} className="h-11 flex-1 rounded-xl border border-[#d8def0] bg-white text-sm font-black text-[#657194]">
                    Cancel
                  </button>
                )}
                <button type="button" onClick={() => testRouter()} disabled={testing || saving} className="h-11 flex-1 rounded-xl border border-[#d8def0] bg-white text-sm font-black text-[#4f35f5] disabled:opacity-50">
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button type="button" onClick={saveRouter} disabled={saving || testing} className="h-11 flex-1 rounded-xl bg-[#4f35f5] text-sm font-black text-white shadow-[0_10px_24px_rgba(79,53,245,0.2)] disabled:opacity-50">
                  {saving ? 'Saving...' : form.id ? 'Save Router' : 'Add Router'}
                </button>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-[24px] border border-[#dfe5f2] bg-white shadow-sm">
            <div className="border-b border-[#edf1f7] p-5">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#101633]">Linked routers</h2>
              <p className="mt-1 text-xs font-semibold text-[#7a849f]">Test routers from here to refresh their live status.</p>
            </div>

            {loading ? (
              <div className="p-10 text-center text-sm font-bold text-[#7a849f]">Loading MikroTik routers...</div>
            ) : routers.length === 0 ? (
              <div className="p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#efe9ff] text-[#4f35f5]">
                  <WrenchIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-base font-black text-[#101633]">No router linked yet</h3>
                <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-[#6d7697]">
                  Add the first MikroTik router to start production monitoring and diagnostics.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#edf1f7]">
                {routers.map((router) => (
                  <div key={router.id} className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-black text-[#101633]">{router.name}</h3>
                          <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${statusClass(router.last_status)}`}>
                            {router.last_status || 'Not tested'}
                          </span>
                          {!router.is_active && <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase text-amber-700">Paused</span>}
                        </div>
                        <div className="mt-2 grid gap-2 text-xs font-semibold text-[#6d7697] sm:grid-cols-2">
                          <div className="truncate">Host: <span className="font-mono text-[#101633]">{router.host}:{router.port}</span></div>
                          <div>Mode: <span className="font-black text-[#101633]">{router.connection_type === 'api-ssl' ? 'API-SSL' : 'API'}</span></div>
                          <div>User: <span className="font-black text-[#101633]">{router.username}</span></div>
                          <div>Identity: <span className="font-black text-[#101633]">{router.last_identity || '-'}</span></div>
                          <div>RouterOS: <span className="font-black text-[#101633]">{router.last_version || '-'}</span></div>
                          <div>Uptime: <span className="font-black text-[#101633]">{router.last_uptime || '-'}</span></div>
                        </div>
                        {router.last_error && (
                          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                            {router.last_error}
                          </div>
                        )}
                        {routerTestStatus[router.id] && (
                          <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold ${
                            routerTestStatus[router.id].type === 'success'
                              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                              : routerTestStatus[router.id].type === 'info'
                                ? 'border-blue-100 bg-blue-50 text-blue-700'
                                : 'border-red-100 bg-red-50 text-red-700'
                          }`}>
                            {routerTestStatus[router.id].message}
                          </div>
                        )}
                        <div className="mt-3 text-[11px] font-semibold text-[#8a92ad]">
                          Last online: {router.last_seen_at ? new Date(router.last_seen_at).toLocaleString() : 'Not confirmed yet'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => testRouter(router)} disabled={busyId === `test-${router.id}`} className="h-10 rounded-xl bg-[#efe9ff] px-4 text-xs font-black text-[#4f35f5] disabled:opacity-50">
                          {busyId === `test-${router.id}` ? 'Testing...' : 'Test'}
                        </button>
                        <button type="button" onClick={() => editRouter(router)} className="h-10 rounded-xl border border-[#d8def0] bg-white px-4 text-xs font-black text-[#657194]">
                          Edit
                        </button>
                        <button type="button" onClick={() => toggleActive(router)} disabled={busyId === `active-${router.id}`} className="h-10 rounded-xl border border-[#d8def0] bg-white px-4 text-xs font-black text-[#657194] disabled:opacity-50">
                          {router.is_active ? 'Pause' : 'Activate'}
                        </button>
                        <button type="button" onClick={() => deleteRouter(router)} disabled={busyId === `delete-${router.id}`} className="h-10 rounded-xl bg-red-50 px-4 text-xs font-black text-red-600 disabled:opacity-50">
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
