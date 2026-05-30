import React, { useEffect, useState } from 'react';
import InstallAppButton from '../components/InstallAppButton';
import PushNotificationsButton from '../components/PushNotificationsButton';
import api from '../utils/api';
import { CheckCircleIcon, CogIcon, CreditCardIcon, DownloadIcon, PulseIcon } from '../components/Icons';
import { applyTheme, getStoredTheme, saveTheme } from '../utils/theme';

const THEME_OPTIONS = [
  { key: 'system', label: 'Auto', helper: 'Match this phone or browser.' },
  { key: 'light', label: 'Light', helper: 'Bright dashboard for daytime use.' },
  { key: 'dark', label: 'Dark', helper: 'Low-light mode for night shifts.' },
];

const BILLING_PROVIDERS = [
  { value: 'wispman', label: 'Wispman' },
];

function SettingsCard({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe9ff] text-[#4B16B5]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default function Settings() {
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [billing, setBilling] = useState({
    enabled: false,
    provider: 'wispman',
    base_url: 'https://riseli.wispman.net/index.php?_route=api',
    api_key: '',
    has_api_key: false,
  });
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingTesting, setBillingTesting] = useState(false);
  const [billingEditing, setBillingEditing] = useState(false);
  const [billingStatus, setBillingStatus] = useState(null);

  useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const syncSystem = () => {
      if (getStoredTheme() === 'system') applyTheme('system');
    };
    media?.addEventListener?.('change', syncSystem);
    return () => media?.removeEventListener?.('change', syncSystem);
  }, [theme]);

  const loadBilling = async ({ silent = false } = {}) => {
    if (!silent) setBillingLoading(true);
    try {
      const { data } = await api.get('/settings/billing');
      setBilling((current) => ({
        ...current,
        enabled: Boolean(data.enabled),
        provider: data.provider || 'wispman',
        base_url: data.base_url || current.base_url,
        api_key: '',
        has_api_key: Boolean(data.has_api_key),
      }));
    } catch (err) {
      setBillingStatus({
        type: 'error',
        message: err.response?.data?.error || 'Failed to load billing settings.',
      });
    } finally {
      if (!silent) setBillingLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) {
        await loadBilling();
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseTheme = (mode) => {
    setTheme(mode);
    saveTheme(mode);
  };

  const updateBilling = (field, value) => {
    setBilling((current) => ({ ...current, [field]: value }));
    setBillingStatus(null);
  };

  const testBilling = async () => {
    setBillingTesting(true);
    setBillingStatus(null);
    try {
      const { data } = await api.post('/settings/billing/test', {
        provider: billing.provider,
        base_url: billing.base_url,
        api_key: billing.api_key,
      });
      const scopes = Array.isArray(data.scopes) && data.scopes.length > 0 ? ` Scopes: ${data.scopes.join(', ')}.` : '';
      setBillingStatus({
        type: 'success',
        message: `Connected${data.key_name ? ` as ${data.key_name}` : ''}.${scopes}`,
      });
    } catch (err) {
      setBillingStatus({
        type: 'error',
        message: err.response?.data?.error || err.response?.data?.message || 'Connection test failed.',
      });
    } finally {
      setBillingTesting(false);
    }
  };

  const saveBilling = async () => {
    setBillingSaving(true);
    setBillingStatus(null);
    try {
      const { data } = await api.put('/settings/billing', {
        enabled: billing.enabled,
        provider: billing.provider,
        base_url: billing.base_url,
        api_key: billing.api_key,
      });
      setBilling((current) => ({
        ...current,
        enabled: Boolean(data.enabled),
        provider: data.provider || current.provider,
        base_url: data.base_url || current.base_url,
        api_key: '',
        has_api_key: Boolean(data.has_api_key),
      }));
      setBillingEditing(false);
      setBillingStatus({ type: 'success', message: 'Billing integration saved.' });
    } catch (err) {
      setBillingStatus({
        type: 'error',
        message: err.response?.data?.error || 'Failed to save billing settings.',
      });
    } finally {
      setBillingSaving(false);
    }
  };

  const cancelBillingEdit = async () => {
    setBillingEditing(false);
    setBillingStatus(null);
    await loadBilling({ silent: true });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-950">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">Personal app controls for this device.</p>
        </div>

        <div className="grid gap-4">
          <SettingsCard
            icon={DownloadIcon}
            title="Install App"
            description="Add this dashboard to your phone or desktop for quicker access."
          >
            <div className="max-w-sm">
              <InstallAppButton variant="light" />
            </div>
          </SettingsCard>

          <SettingsCard
            icon={CogIcon}
            title="Theme"
            description="Choose how the dashboard should look on this device."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {THEME_OPTIONS.map((option) => {
                const selected = theme === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => chooseTheme(option.key)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-[#3535FF] bg-[#f3f2ff] text-[#2828DD]'
                        : 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black">{option.label}</span>
                      {selected && <CheckCircleIcon className="h-4 w-4" />}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">{option.helper}</p>
                  </button>
                );
              })}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={CreditCardIcon}
            title="Billing System"
            description="Link the agent to a billing platform so it can answer account, plan and payment questions."
          >
            {billingLoading ? (
              <div className="text-sm font-semibold text-slate-400">Loading billing settings...</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">
                      {billingEditing ? 'Editing unlocked' : 'Billing config locked'}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-amber-800">
                      API details are protected from accidental changes.
                    </div>
                  </div>
                  {billingEditing ? (
                    <button type="button" onClick={cancelBillingEdit} className="rounded-full border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-800">
                      Cancel edit
                    </button>
                  ) : (
                    <button type="button" onClick={() => setBillingEditing(true)} className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-black text-white">
                      Edit billing
                    </button>
                  )}
                </div>
                <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span>
                    <span className="block text-sm font-black text-slate-900">Enable billing lookup</span>
                    <span className="mt-0.5 block text-xs text-slate-500">The agent will use this before answering billing questions.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={billing.enabled}
                    onChange={(event) => updateBilling('enabled', event.target.checked)}
                    disabled={!billingEditing}
                    className="h-5 w-5 accent-[#3535FF]"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Billing system
                    <select
                      value={billing.provider}
                      onChange={(event) => updateBilling('provider', event.target.value)}
                      disabled={!billingEditing}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-700 outline-none focus:border-[#3535FF] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {BILLING_PROVIDERS.map((provider) => (
                        <option key={provider.value} value={provider.value}>{provider.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    API base URL
                    <input
                      value={billing.base_url}
                      onChange={(event) => updateBilling('base_url', event.target.value)}
                      placeholder="https://example.com/index.php?_route=api"
                      disabled={!billingEditing}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  API key
                  <input
                    type="password"
                    value={billing.api_key}
                    onChange={(event) => updateBilling('api_key', event.target.value)}
                    placeholder={billing.has_api_key ? 'Saved. Leave blank to keep current key.' : 'Paste Wispman API key'}
                    disabled={!billingEditing}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </label>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-semibold text-slate-500">
                    {billing.has_api_key ? 'An API key is saved for this client.' : 'No API key saved yet.'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={testBilling}
                      disabled={!billingEditing || billingTesting || (!billing.api_key && !billing.has_api_key)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {billingTesting ? 'Testing...' : 'Test connection'}
                    </button>
                    <button
                      type="button"
                      onClick={saveBilling}
                      disabled={!billingEditing || billingSaving}
                      className="rounded-xl bg-[#3535FF] px-4 py-2 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50"
                    >
                      {billingSaving ? 'Saving...' : 'Save integration'}
                    </button>
                  </div>
                </div>

                {billingStatus && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                      billingStatus.type === 'success'
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-red-100 bg-red-50 text-red-700'
                    }`}
                  >
                    {billingStatus.message}
                  </div>
                )}
              </div>
            )}
          </SettingsCard>

          <SettingsCard
            icon={PulseIcon}
            title="Phone Alerts"
            description="Allow this installed app to show notifications when customers message."
          >
            <div className="max-w-sm">
              <PushNotificationsButton variant="light" />
            </div>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
