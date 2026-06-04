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
const DEFAULT_INSTALLATION_FORM = {
  title: 'Installation form',
  intro: 'Share your contact and location details so the installation team can prepare before calling you.',
  accent_color: '#3535FF',
  show_id: true,
  require_id: true,
  show_alternate_phone: true,
  show_email: true,
  show_plan: true,
  show_service_type: true,
  show_county: true,
  show_landmark: true,
  show_house_description: true,
  show_gps: true,
  show_schedule: true,
  show_notes: true,
};
const FORM_SWITCHES = [
  ['show_id', 'ID verification section'],
  ['require_id', 'Require ID upload'],
  ['show_alternate_phone', 'Alternative phone'],
  ['show_email', 'Email address'],
  ['show_plan', 'Preferred package'],
  ['show_service_type', 'Service type'],
  ['show_county', 'County / town'],
  ['show_landmark', 'Nearest landmark'],
  ['show_house_description', 'House description'],
  ['show_gps', 'GPS location button'],
  ['show_schedule', 'Preferred date/time'],
  ['show_notes', 'Extra notes'],
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
  const [payhero, setPayhero] = useState({ enabled: false, channel_id: '', provider: 'm-pesa', basic_auth: '', has_basic_auth: false });
  const [payheroLoading, setPayheroLoading] = useState(true);
  const [payheroSaving, setPayheroSaving] = useState(false);
  const [payheroTesting, setPayheroTesting] = useState(false);
  const [payheroStatus, setPayheroStatus] = useState(null);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaSaving, setMediaSaving] = useState(false);
  const [mediaStatus, setMediaStatus] = useState(null);
  const [mediaForm, setMediaForm] = useState({
    title: '',
    tag: '',
    description: '',
    trigger_keywords: '',
    attach_on_welcome: false,
    file: null,
  });
  const [installationForm, setInstallationForm] = useState(DEFAULT_INSTALLATION_FORM);
  const [installationLoading, setInstallationLoading] = useState(true);
  const [installationSaving, setInstallationSaving] = useState(false);
  const [installationStatus, setInstallationStatus] = useState(null);

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

  const loadMedia = async () => {
    setMediaLoading(true);
    try {
      const { data } = await api.get('/media-library');
      setMediaItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setMediaStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load media library.' });
    } finally {
      setMediaLoading(false);
    }
  };

  const loadPayhero = async () => {
    setPayheroLoading(true);
    try {
      const { data } = await api.get('/settings/payhero');
      setPayhero((current) => ({ ...current, ...data, basic_auth: '' }));
    } catch (err) {
      setPayheroStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load PayHero settings.' });
    } finally {
      setPayheroLoading(false);
    }
  };

  const loadInstallationForm = async () => {
    setInstallationLoading(true);
    try {
      const { data } = await api.get('/settings/installation-form');
      setInstallationForm({ ...DEFAULT_INSTALLATION_FORM, ...data });
    } catch (err) {
      setInstallationStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load installation form settings.' });
    } finally {
      setInstallationLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) {
        await loadBilling();
        await loadPayhero();
        await loadMedia();
        await loadInstallationForm();
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

  const updatePayhero = (field, value) => {
    setPayhero((current) => ({ ...current, [field]: value }));
    setPayheroStatus(null);
  };

  const testPayhero = async () => {
    setPayheroTesting(true);
    setPayheroStatus(null);
    try {
      const { data } = await api.post('/settings/payhero/test', {
        basic_auth: payhero.basic_auth,
        channel_id: payhero.channel_id,
      });
      const channel = data.channel;
      setPayheroStatus({
        type: 'success',
        message: `${channel
          ? `Connected to PayHero channel ${channel.id}${channel.description ? ` (${channel.description})` : ''}.`
          : `PayHero connected. ${data.channels || 0} active payment channel(s) found.`} ${payhero.enabled ? 'Click Save PayHero to apply these settings.' : 'Turn on Enable M-Pesa prompts, then click Save PayHero.'}`,
      });
    } catch (err) {
      setPayheroStatus({ type: 'error', message: err.response?.data?.error || 'PayHero connection test failed.' });
    } finally {
      setPayheroTesting(false);
    }
  };

  const savePayhero = async () => {
    setPayheroSaving(true);
    setPayheroStatus(null);
    try {
      const { data } = await api.put('/settings/payhero', payhero);
      setPayhero((current) => ({ ...current, ...data, basic_auth: '' }));
      setPayheroStatus({ type: 'success', message: 'PayHero payment prompting saved.' });
    } catch (err) {
      setPayheroStatus({ type: 'error', message: err.response?.data?.error || 'Failed to save PayHero settings.' });
    } finally {
      setPayheroSaving(false);
    }
  };

  const cancelBillingEdit = async () => {
    setBillingEditing(false);
    setBillingStatus(null);
    await loadBilling({ silent: true });
  };

  const updateMediaForm = (field, value) => {
    setMediaForm((current) => ({ ...current, [field]: value }));
    setMediaStatus(null);
  };

  const copyMediaTag = async (tag) => {
    const shortcode = `{${tag}}`;
    try {
      await navigator.clipboard?.writeText(shortcode);
      setMediaStatus({ type: 'success', message: `${shortcode} copied. Paste it into Agent Configuration.` });
    } catch (err) {
      setMediaStatus({ type: 'success', message: `Use ${shortcode} in Agent Configuration.` });
    }
  };

  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

  const uploadMedia = async () => {
    if (!mediaForm.file) {
      setMediaStatus({ type: 'error', message: 'Choose an image or PDF first.' });
      return;
    }
    setMediaSaving(true);
    setMediaStatus(null);
    try {
      const dataUrl = await fileToDataUrl(mediaForm.file);
      const { data } = await api.post('/media-library', {
        title: mediaForm.title,
        tag: mediaForm.tag,
        description: mediaForm.description,
        trigger_keywords: mediaForm.trigger_keywords,
        attach_on_welcome: mediaForm.attach_on_welcome,
        filename: mediaForm.file.name,
        mime_type: mediaForm.file.type,
        data: dataUrl,
      });
      setMediaItems((current) => [data, ...current]);
      setMediaForm({ title: '', tag: '', description: '', trigger_keywords: '', attach_on_welcome: false, file: null });
      const input = document.getElementById('agent-media-file');
      if (input) input.value = '';
      setMediaStatus({ type: 'success', message: 'Media uploaded. The agent can now use it.' });
    } catch (err) {
      setMediaStatus({ type: 'error', message: err.response?.data?.error || 'Failed to upload media.' });
    } finally {
      setMediaSaving(false);
    }
  };

  const toggleMedia = async (item, field) => {
    try {
      const { data } = await api.patch(`/media-library/${item.id}`, {
        title: item.title,
        tag: item.tag,
        description: item.description,
        trigger_keywords: item.trigger_keywords,
        attach_on_welcome: field === 'attach_on_welcome' ? !item.attach_on_welcome : item.attach_on_welcome,
        is_active: field === 'is_active' ? !item.is_active : item.is_active,
      });
      setMediaItems((current) => current.map((row) => (row.id === item.id ? data : row)));
    } catch (err) {
      setMediaStatus({ type: 'error', message: err.response?.data?.error || 'Failed to update media.' });
    }
  };

  const deleteMedia = async (id) => {
    if (!window.confirm('Delete this media from the agent library?')) return;
    try {
      await api.delete(`/media-library/${id}`);
      setMediaItems((current) => current.filter((row) => row.id !== id));
    } catch (err) {
      setMediaStatus({ type: 'error', message: err.response?.data?.error || 'Failed to delete media.' });
    }
  };

  const updateInstallationForm = (field, value) => {
    setInstallationForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'show_id' && !value) next.require_id = false;
      if (field === 'require_id' && value) next.show_id = true;
      return next;
    });
    setInstallationStatus(null);
  };

  const saveInstallationForm = async () => {
    setInstallationSaving(true);
    setInstallationStatus(null);
    try {
      const { data } = await api.put('/settings/installation-form', installationForm);
      setInstallationForm({ ...DEFAULT_INSTALLATION_FORM, ...data });
      setInstallationStatus({ type: 'success', message: 'Installation form settings saved.' });
    } catch (err) {
      setInstallationStatus({ type: 'error', message: err.response?.data?.error || 'Failed to save installation form settings.' });
    } finally {
      setInstallationSaving(false);
    }
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
            icon={CreditCardIcon}
            title="PayHero M-Pesa Prompts"
            description="Allow the agent to send an STK prompt only when a customer explicitly asks to pay and confirms an amount."
          >
            {payheroLoading ? (
              <div className="text-sm font-semibold text-slate-400">Loading PayHero settings...</div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span>
                    <span className="block text-sm font-black text-slate-900">Enable M-Pesa prompts</span>
                    <span className="mt-0.5 block text-xs text-slate-500">Prompts require an explicit payment request and amount.</span>
                  </span>
                  <input type="checkbox" checked={payhero.enabled} onChange={(e) => updatePayhero('enabled', e.target.checked)} className="h-5 w-5 accent-[#3535FF]" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    PayHero channel ID
                    <input value={payhero.channel_id} onChange={(e) => updatePayhero('channel_id', e.target.value)} placeholder="e.g. 1234" inputMode="numeric" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Provider
                    <select value={payhero.provider} onChange={(e) => updatePayhero('provider', e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-700 outline-none focus:border-[#3535FF]">
                      <option value="m-pesa">M-Pesa</option>
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Basic Auth token
                  <input type="password" value={payhero.basic_auth} onChange={(e) => updatePayhero('basic_auth', e.target.value)} placeholder={payhero.has_basic_auth ? 'Saved. Leave blank to keep current token.' : 'Basic your-token-here'} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                </label>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold leading-5 text-blue-800">
                  Example customer request: “Send me an M-Pesa prompt for 1500.” The agent will prompt the customer’s WhatsApp number and report the callback result.
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={testPayhero} disabled={payheroTesting || (!payhero.basic_auth && !payhero.has_basic_auth)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-50">{payheroTesting ? 'Testing...' : 'Test connection'}</button>
                  <button type="button" onClick={savePayhero} disabled={payheroSaving} className="rounded-xl bg-[#3535FF] px-4 py-2 text-sm font-black text-white disabled:opacity-50">{payheroSaving ? 'Saving...' : 'Save PayHero'}</button>
                </div>
                {payheroStatus && <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${payheroStatus.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>{payheroStatus.message}</div>}
              </div>
            )}
          </SettingsCard>

          <SettingsCard
            icon={PulseIcon}
            title="Agent Media Library"
            description="Upload images or PDFs the agent can share in welcome messages or when customers ask for visual explanations."
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Title
                    <input
                      value={mediaForm.title}
                      onChange={(event) => updateMediaForm('title', event.target.value)}
                      placeholder="Hotspot sample design"
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Media tag
                    <input
                      value={mediaForm.tag}
                      onChange={(event) => updateMediaForm('tag', event.target.value)}
                      placeholder="image1"
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                    />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Trigger keywords
                    <input
                      value={mediaForm.trigger_keywords}
                      onChange={(event) => updateMediaForm('trigger_keywords', event.target.value)}
                      placeholder="hotspot sample, landing page, poster"
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                    />
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Caption / explanation
                  <textarea
                    rows={2}
                    value={mediaForm.description}
                    onChange={(event) => updateMediaForm('description', event.target.value)}
                    placeholder="Short caption the customer will see with this media."
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                  />
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex-1 text-xs font-black uppercase text-slate-400">
                    File
                    <input
                      id="agent-media-file"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      onChange={(event) => updateMediaForm('file', event.target.files?.[0] || null)}
                      className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-slate-700"
                    />
                  </label>
                  <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={mediaForm.attach_on_welcome}
                      onChange={(event) => updateMediaForm('attach_on_welcome', event.target.checked)}
                      className="h-4 w-4 accent-[#3535FF]"
                    />
                    Send with welcome
                  </label>
                  <button
                    type="button"
                    onClick={uploadMedia}
                    disabled={mediaSaving}
                    className="rounded-xl bg-[#3535FF] px-4 py-2.5 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50"
                  >
                    {mediaSaving ? 'Uploading...' : 'Upload media'}
                  </button>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  Use tags like <span className="font-black text-[#3535FF]">{'{image1}'}</span> in Agent Configuration, for example: during welcome message send {'{image1}'}. Keywords still trigger media automatically.
                </p>
              </div>

              {mediaStatus && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                    mediaStatus.type === 'success'
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                      : 'border-red-100 bg-red-50 text-red-700'
                  }`}
                >
                  {mediaStatus.message}
                </div>
              )}

              {mediaLoading ? (
                <div className="text-sm font-semibold text-slate-400">Loading media...</div>
              ) : mediaItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-400">
                  No media uploaded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {mediaItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-black text-slate-950">{item.title}</h3>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-500">{item.media_type}</span>
                            {item.tag && (
                              <button
                                type="button"
                                onClick={() => copyMediaTag(item.tag)}
                                className="rounded-full bg-[#f3f2ff] px-2 py-0.5 text-[10px] font-black text-[#3535FF] transition hover:bg-[#e8e4ff]"
                                title="Copy media tag"
                              >
                                {`{${item.tag}}`}
                              </button>
                            )}
                            {!item.is_active && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Paused</span>}
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{item.filename}</p>
                          {item.description && <p className="mt-2 text-sm text-slate-600">{item.description}</p>}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(item.trigger_keywords || []).map((keyword) => (
                              <span key={keyword} className="rounded-full bg-[#f3f2ff] px-2 py-1 text-[10px] font-black text-[#3535FF]">
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => toggleMedia(item, 'attach_on_welcome')}
                            className={`rounded-xl px-3 py-2 text-xs font-black ${item.attach_on_welcome ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                          >
                            {item.attach_on_welcome ? 'Welcome on' : 'Welcome off'}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleMedia(item, 'is_active')}
                            className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600"
                          >
                            {item.is_active ? 'Pause' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMedia(item.id)}
                            className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={CogIcon}
            title="Installation Form"
            description="Control what customers see in the installation intake form and which details are required."
          >
            {installationLoading ? (
              <div className="text-sm font-semibold text-slate-400">Loading installation form settings...</div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Form title
                    <input
                      value={installationForm.title}
                      onChange={(event) => updateInstallationForm('title', event.target.value)}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Accent
                    <input
                      type="color"
                      value={installationForm.accent_color}
                      onChange={(event) => updateInstallationForm('accent_color', event.target.value)}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-2 py-1"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Intro text
                  <textarea
                    rows={3}
                    value={installationForm.intro}
                    onChange={(event) => updateInstallationForm('intro', event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case leading-6 text-slate-700 outline-none focus:border-[#3535FF]"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  {FORM_SWITCHES.map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <span className="text-sm font-black text-slate-800">{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(installationForm[key])}
                        onChange={(event) => updateInstallationForm(key, event.target.checked)}
                        disabled={key === 'require_id' && !installationForm.show_id}
                        className="h-5 w-5 accent-[#3535FF] disabled:opacity-40"
                      />
                    </label>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-400">Preview</div>
                  <div className="mt-3 overflow-hidden rounded-[26px] bg-[#0A0A0F] text-white">
                    <div className="p-5">
                      <div className="mb-4 inline-flex rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-white/75">
                        Secure customer intake
                      </div>
                      <h3 className="text-2xl font-black" style={{ color: installationForm.accent_color }}>
                        {installationForm.title || 'Installation form'}
                      </h3>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">{installationForm.intro}</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black">
                        {FORM_SWITCHES.filter(([key]) => installationForm[key]).slice(0, 8).map(([key, label]) => (
                          <span key={key} className="rounded-full bg-white/10 px-3 py-1">{label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-semibold leading-5 text-slate-500">
                    Turning off ID verification removes the ID upload from the public form and from required validation.
                  </p>
                  <button
                    type="button"
                    onClick={saveInstallationForm}
                    disabled={installationSaving}
                    className="rounded-xl bg-[#3535FF] px-4 py-2.5 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50"
                  >
                    {installationSaving ? 'Saving...' : 'Save form'}
                  </button>
                </div>

                {installationStatus && (
                  <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                    installationStatus.type === 'success'
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                      : 'border-red-100 bg-red-50 text-red-700'
                  }`}>
                    {installationStatus.message}
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
