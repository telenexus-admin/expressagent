import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10';

export default function RouterServiceWizard({
  router,
  onClose,
  onComplete,
  darkMode = false,
}) {
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const surface = darkMode
    ? 'border-slate-700 bg-[#11172a] text-slate-100'
    : 'border-slate-200 bg-white text-slate-900';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      if (!router?.id) return;
      try {
        setLoading(true);
        setError('');
        setResult(null);
        const response = await api.post(
          `/mikrotik/${router.id}/provision/preview`,
          { mode: 'both' }
        );
        if (!active) return;
        setPreview(response.data);
        setForm(response.data.config);
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError.response?.data?.error ||
            'Could not inspect this MikroTik.'
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadPreview();
    return () => {
      active = false;
    };
  }, [router?.id]);

  const availablePorts = useMemo(
    () => preview?.discovery?.ethernet_interfaces || [],
    [preview]
  );

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const togglePort = (port) => {
    setForm((current) => {
      const selected = new Set(current?.subscriber_ports || []);
      if (selected.has(port)) selected.delete(port);
      else selected.add(port);
      selected.delete(current?.wan_interface);
      return { ...current, subscriber_ports: [...selected] };
    });
  };

  const refreshPreview = async () => {
    if (!form) return;
    try {
      setLoading(true);
      setError('');
      const response = await api.post(
        `/mikrotik/${router.id}/provision/preview`,
        form
      );
      setPreview(response.data);
      setForm(response.data.config);
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          'Could not validate this service configuration.'
      );
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!form || preview?.blockers?.length) return;
    const ports = (form.subscriber_ports || []).join(', ');
    const confirmed = window.confirm(
      `Configure Hotspot and PPPoE on ${router.name}?\n\nWAN: ${form.wan_interface}\nSubscriber ports: ${ports}\n\nA MikroTik backup will be created first. Devices on the selected LAN ports may reconnect briefly.`
    );
    if (!confirmed) return;

    try {
      setApplying(true);
      setError('');
      const response = await api.post(
        `/mikrotik/${router.id}/provision`,
        form
      );
      setResult(response.data);
      await onComplete?.();
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          'Router service configuration failed.'
      );
    } finally {
      setApplying(false);
    }
  };

  if (!router) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:items-center">
      <section
        className={`max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-3xl border p-5 shadow-2xl ${surface}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-500">
              Automatic service setup
            </p>
            <h3 className="mt-1 text-xl font-black">
              Hotspot + PPPoE
            </h3>
            <p className={`mt-1 text-xs ${muted}`}>
              {router.name} · {router.wireguard_tunnel_ip || router.host}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close service setup"
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${
              darkMode
                ? 'text-slate-400 hover:bg-white/10'
                : 'text-slate-400 hover:bg-slate-100'
            }`}
          >
            ×
          </button>
        </div>

        {loading && (
          <div className={`mt-6 rounded-2xl border p-6 text-sm ${surface}`}>
            Inspecting interfaces, bridges, addresses and existing services…
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {result ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-center text-emerald-800">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-2xl text-white">
                ✓
              </div>
              <h4 className="mt-4 text-xl font-black">
                Hotspot and PPPoE are ready
              </h4>
              <p className="mt-2 text-sm">
                Backup: {result.backup_name}
              </p>
            </div>

            <div className={`rounded-2xl border p-4 ${surface}`}>
              <h4 className="text-sm font-black">Completed steps</h4>
              <div className="mt-3 space-y-2">
                {(result.steps || []).map((step, index) => (
                  <div
                    key={`${step.stage}-${index}`}
                    className="flex items-start gap-3 text-xs"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-white">
                      ✓
                    </span>
                    <span>
                      <b>{step.stage}</b>
                      <span className={`ml-1 ${muted}`}>
                        {step.message}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`rounded-2xl border p-4 text-sm ${surface}`}>
              <b>Next test:</b>{' '}
              {result.next_test}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-black text-emerald-950"
            >
              Finish
            </button>
          </div>
        ) : (
          !loading &&
          form && (
            <div className="mt-6 space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={`rounded-2xl border p-4 ${surface}`}>
                  <p className={`text-[10px] font-black uppercase ${muted}`}>
                    Service mode
                  </p>
                  <p className="mt-2 font-black">Hotspot + PPPoE</p>
                  <p className={`mt-1 text-xs ${muted}`}>
                    Both services share the selected subscriber bridge.
                  </p>
                </div>
                <div className={`rounded-2xl border p-4 ${surface}`}>
                  <p className={`text-[10px] font-black uppercase ${muted}`}>
                    Safety
                  </p>
                  <p className="mt-2 font-black">Backup first</p>
                  <p className={`mt-1 text-xs ${muted}`}>
                    Nexa creates a RouterOS backup before changing services.
                  </p>
                </div>
              </div>

              {(preview?.blockers || []).length > 0 && (
                <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-800">
                  <h4 className="text-sm font-black">Setup is blocked</h4>
                  <ul className="mt-2 space-y-1 text-xs">
                    {preview.blockers.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(preview?.warnings || []).length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
                  <h4 className="text-sm font-black">Before continuing</h4>
                  <ul className="mt-2 space-y-1 text-xs">
                    {preview.warnings.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-bold">Internet/WAN port</span>
                  <select
                    value={form.wan_interface}
                    onChange={(event) => {
                      const value = event.target.value;
                      setForm((current) => ({
                        ...current,
                        wan_interface: value,
                        subscriber_ports: (current.subscriber_ports || []).filter(
                          (port) => port !== value
                        ),
                      }));
                    }}
                    className={`${fieldClass} mt-1.5`}
                  >
                    {availablePorts.map((port) => (
                      <option key={port} value={port}>
                        {port}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-bold">Subscriber bridge</span>
                  <input
                    value={form.subscriber_bridge}
                    onChange={(event) =>
                      update('subscriber_bridge', event.target.value)
                    }
                    className={`${fieldClass} mt-1.5`}
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold">Subscriber LAN ports</span>
                  <span className={`text-[10px] ${muted}`}>
                    Select every port that will serve customers
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {availablePorts
                    .filter((port) => port !== form.wan_interface)
                    .map((port) => {
                      const checked = (form.subscriber_ports || []).includes(port);
                      return (
                        <button
                          key={port}
                          type="button"
                          onClick={() => togglePort(port)}
                          className={`rounded-xl border px-3 py-3 text-xs font-black transition ${
                            checked
                              ? 'border-violet-500 bg-violet-600 text-white'
                              : darkMode
                                ? 'border-slate-700 bg-slate-800 text-slate-300'
                                : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          {checked ? '✓ ' : ''}
                          {port}
                        </button>
                      );
                    })}
                </div>
              </div>

              <details className={`rounded-2xl border p-4 ${surface}`}>
                <summary className="cursor-pointer text-sm font-black">
                  Network addresses
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold">Hotspot gateway</span>
                    <input
                      value={form.hotspot_gateway}
                      onChange={(event) =>
                        update('hotspot_gateway', event.target.value)
                      }
                      className={`${fieldClass} mt-1.5`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold">Hotspot pool</span>
                    <input
                      value={form.hotspot_pool}
                      onChange={(event) =>
                        update('hotspot_pool', event.target.value)
                      }
                      className={`${fieldClass} mt-1.5`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold">PPPoE local address</span>
                    <input
                      value={form.pppoe_local_address}
                      onChange={(event) =>
                        update('pppoe_local_address', event.target.value)
                      }
                      className={`${fieldClass} mt-1.5`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold">PPPoE pool</span>
                    <input
                      value={form.pppoe_pool}
                      onChange={(event) =>
                        update('pppoe_pool', event.target.value)
                      }
                      className={`${fieldClass} mt-1.5`}
                    />
                  </label>
                </div>
              </details>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={refreshPreview}
                  disabled={loading || applying}
                  className={`rounded-xl border py-3 text-sm font-black disabled:opacity-50 ${
                    darkMode
                      ? 'border-slate-600 text-slate-300'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  Recheck configuration
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={
                    applying ||
                    loading ||
                    Boolean(preview?.blockers?.length) ||
                    !(form.subscriber_ports || []).length
                  }
                  className="rounded-xl bg-violet-600 py-3 text-sm font-black text-white shadow-lg shadow-violet-600/20 disabled:opacity-50"
                >
                  {applying
                    ? 'Configuring router…'
                    : 'Configure Hotspot + PPPoE'}
                </button>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}
