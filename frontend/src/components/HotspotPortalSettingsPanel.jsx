import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const DEFAULTS = {
  brand_name: '',
  tagline: '',
  support_phone: '',
  whatsapp_phone: '',
  support_text: '',
  wallet_label: 'MY WALLET',
  wallet_balance: 0,
  flash_enabled: false,
  flash_plan_id: '',
  flash_discount_price: '',
  flash_starts_at: '',
  flash_ends_at: '',
  popular_plan_id: '',
};

function toInputDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function fromInputDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-700">{label}</span>
      {hint && <span className="ml-1 text-[10px] font-semibold text-slate-400">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10';

export default function HotspotPortalSettingsPanel({ plans = [] }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [portalUrl, setPortalUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const selectedPlan = useMemo(
    () => plans.find((plan) => Number(plan.id) === Number(settings.flash_plan_id)) || null,
    [plans, settings.flash_plan_id],
  );

  const discountPercent = useMemo(() => {
    const original = Number(selectedPlan?.price || 0);
    const discounted = Number(settings.flash_discount_price || 0);
    if (!original || discounted < 0 || discounted >= original) return 0;
    return Math.round(((original - discounted) / original) * 100);
  }, [selectedPlan, settings.flash_discount_price]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.get('/billing-workspace/hotspot/portal-settings'),
      api.get('/billing-workspace/hotspot/portal-config').catch(() => ({ data: {} })),
    ])
      .then(([settingsResult, portalResult]) => {
        if (!mounted) return;
        setSettings({ ...DEFAULTS, ...(settingsResult.data || {}) });
        setPortalUrl(portalResult.data?.portal_url || '');
      })
      .catch((requestError) => {
        if (mounted) setError(requestError.response?.data?.error || 'Could not load hotspot portal settings.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  const update = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice('');
    setError('');
  };

  const toggleFlash = (enabled) => {
    const now = new Date();
    const end = new Date(now.getTime() + (60 * 60 * 1000));
    setSettings((current) => ({
      ...current,
      flash_enabled: enabled,
      flash_starts_at: current.flash_starts_at || now.toISOString(),
      flash_ends_at: current.flash_ends_at || end.toISOString(),
    }));
    setNotice('');
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');

    try {
      const result = await api.put('/billing-workspace/hotspot/portal-settings', {
        ...settings,
        wallet_balance: Number(settings.wallet_balance || 0),
        flash_plan_id: settings.flash_plan_id ? Number(settings.flash_plan_id) : null,
        flash_discount_price: settings.flash_discount_price === ''
          ? null
          : Number(settings.flash_discount_price),
        popular_plan_id: settings.popular_plan_id ? Number(settings.popular_plan_id) : null,
      });
      setSettings({ ...DEFAULTS, ...(result.data || {}) });
      setNotice('Hotspot portal and flash offer saved.');
    } catch (requestError) {
      setError(
        requestError.response?.data?.error
          || requestError.response?.data?.errors?.[0]?.msg
          || 'Could not save hotspot portal settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="mb-6 animate-pulse rounded-3xl border border-slate-200 bg-white p-6">
        <div className="h-5 w-48 rounded bg-slate-200" />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="h-24 rounded-2xl bg-slate-100" />
          <div className="h-24 rounded-2xl bg-slate-100" />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-[#061a55] via-[#07378d] to-[#0878f9] px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.22em] text-blue-200">
              Public hotspot portal
            </p>
            <h2 className="mt-1 text-xl font-black">Branding and flash package</h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-blue-100">
              Choose the package, discount and exact start/end time shown on the public hotspot page.
            </p>
          </div>
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-xs font-black transition hover:bg-white/20"
            >
              Open portal
            </a>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6 p-5 sm:p-6">
        <div>
          <h3 className="text-sm font-black text-slate-900">Portal identity</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Hotspot brand name">
              <input
                className={inputClass}
                value={settings.brand_name}
                onChange={(event) => update('brand_name', event.target.value)}
                placeholder="Suntech"
              />
            </Field>
            <Field label="Hero tagline">
              <input
                className={inputClass}
                value={settings.tagline}
                onChange={(event) => update('tagline', event.target.value)}
                placeholder="Stay connected with Suntech Hotspot"
              />
            </Field>
            <Field label="Support phone">
              <input
                className={inputClass}
                value={settings.support_phone}
                onChange={(event) => update('support_phone', event.target.value)}
                placeholder="011 438 6777"
              />
            </Field>
            <Field label="WhatsApp phone">
              <input
                className={inputClass}
                value={settings.whatsapp_phone}
                onChange={(event) => update('whatsapp_phone', event.target.value)}
                placeholder="254114386777"
              />
            </Field>
            <Field label="Wallet label">
              <input
                className={inputClass}
                value={settings.wallet_label}
                onChange={(event) => update('wallet_label', event.target.value)}
                placeholder="MY WALLET"
              />
            </Field>
            <Field label="Displayed wallet balance" hint="visual only">
              <input
                min="0"
                step="0.01"
                type="number"
                className={inputClass}
                value={settings.wallet_balance}
                onChange={(event) => update('wallet_balance', event.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50 to-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[#ff0b61] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                  Flash
                </span>
                <h3 className="font-black text-slate-900">Timed flash package</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                The public countdown uses the server time and disappears automatically when the offer ends.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-3">
              <span className="text-xs font-black text-slate-600">
                {settings.flash_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <input
                type="checkbox"
                checked={Boolean(settings.flash_enabled)}
                onChange={(event) => toggleFlash(event.target.checked)}
                className="h-5 w-5 accent-[#ff0b61]"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Flash package">
              <select
                className={inputClass}
                value={settings.flash_plan_id || ''}
                onChange={(event) => update('flash_plan_id', event.target.value)}
              >
                <option value="">Select hotspot package</option>
                {plans.filter((plan) => plan.is_active !== false).map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} - KSh {Number(plan.price || 0).toLocaleString()}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Discounted price (KSh)">
              <input
                min="0"
                step="0.01"
                type="number"
                className={inputClass}
                value={settings.flash_discount_price ?? ''}
                onChange={(event) => update('flash_discount_price', event.target.value)}
                placeholder="30"
              />
            </Field>

            <Field label="Offer starts">
              <input
                type="datetime-local"
                className={inputClass}
                value={toInputDateTime(settings.flash_starts_at)}
                onChange={(event) => update('flash_starts_at', fromInputDateTime(event.target.value))}
              />
            </Field>

            <Field label="Offer ends">
              <input
                type="datetime-local"
                className={inputClass}
                value={toInputDateTime(settings.flash_ends_at)}
                onChange={(event) => update('flash_ends_at', fromInputDateTime(event.target.value))}
              />
            </Field>
          </div>

          {selectedPlan && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pink-100 bg-white px-4 py-3 text-xs">
              <span className="font-bold text-slate-600">
                Original: KSh {Number(selectedPlan.price || 0).toLocaleString()}
              </span>
              <span className="font-black text-[#ff0b61]">
                {discountPercent > 0 ? `${discountPercent}% OFF` : 'Enter a lower discounted price'}
              </span>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-black text-slate-900">Package display</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Popular package badge">
              <select
                className={inputClass}
                value={settings.popular_plan_id || ''}
                onChange={(event) => update('popular_plan_id', event.target.value)}
              >
                <option value="">Automatic</option>
                {plans.filter((plan) => plan.is_active !== false).map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Support message">
              <input
                className={inputClass}
                value={settings.support_text}
                onChange={(event) => update('support_text', event.target.value)}
                placeholder="Need help? Contact support."
              />
            </Field>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>
        )}
        {notice && (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</p>
        )}

        <button
          disabled={saving}
          className="w-full rounded-xl bg-gradient-to-r from-[#0878f9] to-[#073cc9] py-3.5 text-sm font-black text-white shadow-lg shadow-blue-600/20 disabled:opacity-50"
        >
          {saving ? 'Saving portal...' : 'Save hotspot portal'}
        </button>
      </form>
    </section>
  );
}
