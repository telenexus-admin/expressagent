import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../utils/api';

const VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const MIN_META_ACCESS_TOKEN_LENGTH = 50;
const CONNECTION_OPTIONS = [
  { value: 'meta', label: 'Meta WhatsApp', description: 'Customer messages come through the official WhatsApp Cloud API.' },
  { value: 'website', label: 'Website only', description: 'Use the website chat widget without linking a WhatsApp number.' },
  { value: 'evolution', label: 'Evolution WhatsApp', description: 'For clients connected through the Evolution onboarding flow.' },
];

const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-700',
  suspended: 'bg-amber-50 text-amber-700',
};

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [openingDashboard, setOpeningDashboard] = useState(false);

  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '' });
  const [adminFormError, setAdminFormError] = useState('');
  const [adminFormLoading, setAdminFormLoading] = useState(false);
  const [payhero, setPayhero] = useState({
    enabled: false,
    channel_id: '',
    provider: 'm-pesa',
    has_basic_auth: false,
  });
  const [payheroLoading, setPayheroLoading] = useState(true);
  const [payheroSaving, setPayheroSaving] = useState(false);
  const [payheroTesting, setPayheroTesting] = useState(false);
  const [payheroStatus, setPayheroStatus] = useState(null);

  useEffect(() => {
    fetchClient();
    fetchAdmins();
    fetchPayhero();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchClient = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get(`/clients/${id}`);
      setClient(data);
      setForm({
        name: data.name || '',
        business_name: data.business_name || '',
        contact_email: data.contact_email || '',
        status: data.status || 'active',
        connection_provider: data.connection_provider || 'meta',
        meta_phone_number_id: data.meta_phone_number_id || '',
        meta_business_account_id: data.meta_business_account_id || '',
        meta_verify_token: data.meta_verify_token || '',
        meta_access_token: '',
        support_number: data.support_number || '',
        agent_name: data.agent_name || '',
        voice_id: data.voice_id || 'alloy',
        system_prompt: data.system_prompt || '',
        opening_message: data.opening_message || '',
        photo_troubleshooting_enabled: data.photo_troubleshooting_enabled === true,
      });
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Failed to load client');
    } finally {
      setLoading(false);
    }
  };

  const fetchAdmins = async () => {
    setAdminsLoading(true);
    try {
      const { data } = await api.get(`/admins?clientId=${id}`);
      setAdmins(data);
    } catch (err) {
      console.error('Failed to fetch admins:', err.message);
    } finally {
      setAdminsLoading(false);
    }
  };

  const fetchPayhero = async () => {
    setPayheroLoading(true);
    setPayheroStatus(null);
    try {
      const { data } = await api.get(`/settings/payhero?clientId=${id}`);
      setPayhero((current) => ({ ...current, ...data }));
    } catch (err) {
      setPayheroStatus({
        type: 'error',
        message: err.response?.data?.error || 'Failed to load PayHero settings',
      });
    } finally {
      setPayheroLoading(false);
    }
  };

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const updatePayhero = (key, value) => {
    setPayhero((current) => ({ ...current, [key]: value }));
    setPayheroStatus(null);
  };

  const testPayhero = async () => {
    setPayheroTesting(true);
    setPayheroStatus(null);
    try {
      const { data } = await api.post(`/settings/payhero/test?clientId=${id}`, {
        channel_id: payhero.channel_id,
      });
      const channel = data.channel;
      setPayheroStatus({
        type: 'success',
        message: channel
          ? `Connected to PayHero channel ${channel.id}${channel.description ? ` (${channel.description})` : ''}.`
          : `PayHero connected. ${data.channels || 0} active payment channel(s) found.`,
      });
    } catch (err) {
      setPayheroStatus({
        type: 'error',
        message: err.response?.data?.error || 'PayHero connection test failed',
      });
    } finally {
      setPayheroTesting(false);
    }
  };

  const savePayhero = async () => {
    setPayheroSaving(true);
    setPayheroStatus(null);
    try {
      const { data } = await api.put(`/settings/payhero?clientId=${id}`, payhero);
      setPayhero((current) => ({ ...current, ...data }));
      setPayheroStatus({ type: 'success', message: 'PayHero payment prompting saved for this client.' });
    } catch (err) {
      setPayheroStatus({
        type: 'error',
        message: err.response?.data?.error || 'Failed to save PayHero settings',
      });
    } finally {
      setPayheroSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveStatus(null);
    setSaveError('');
    try {
      const payload = {
        name: form.name,
        business_name: form.business_name,
        contact_email: form.contact_email,
        status: form.status,
        connection_provider: form.connection_provider,
        meta_phone_number_id: form.meta_phone_number_id,
        meta_business_account_id: form.meta_business_account_id,
        meta_verify_token: form.meta_verify_token,
        support_number: form.support_number,
        agent_name: form.agent_name,
        voice_id: form.voice_id,
        system_prompt: form.system_prompt,
        opening_message: form.opening_message,
        photo_troubleshooting_enabled: form.photo_troubleshooting_enabled,
      };
      const nextMetaToken = form.meta_access_token.trim();
      if (nextMetaToken) {
        if (nextMetaToken.length < MIN_META_ACCESS_TOKEN_LENGTH) {
          setSaveStatus('error');
          setSaveError('Meta access token looks too short. Paste the full Meta token, or leave it blank to keep the current one.');
          return;
        }
        payload.meta_access_token = nextMetaToken;
      }
      await api.put(`/clients/${id}`, payload);
      setSaveStatus('success');
      setForm((f) => ({ ...f, meta_access_token: '' }));
      fetchClient();
    } catch (err) {
      setSaveStatus('error');
      setSaveError(
        err.response?.data?.error ||
          err.response?.data?.errors?.[0]?.msg ||
          'Failed to save changes'
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteClient = async () => {
    if (
      !window.confirm(
        `Delete client "${client.name}"? This permanently removes their admins, conversations, escalations, and messages. This cannot be undone.`
      )
    )
      return;
    try {
      await api.delete(`/clients/${id}`);
      navigate('/onboarding/clients');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete client');
    }
  };

  const openClientDashboard = async () => {
    const tab = window.open('about:blank', '_blank');
    setOpeningDashboard(true);
    try {
      const { data } = await api.post(`/clients/${id}/operator-access`);
      const encodedAdmin = window.btoa(unescape(encodeURIComponent(JSON.stringify(data.admin))));
      const url = `/client-access?token=${encodeURIComponent(data.token)}&admin=${encodeURIComponent(encodedAdmin)}&next=${encodeURIComponent('/dashboard/agent')}`;
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (err) {
      if (tab) tab.close();
      alert(err.response?.data?.error || 'Failed to open client dashboard');
    } finally {
      setOpeningDashboard(false);
    }
  };

  const openAdminModal = () => {
    setAdminForm({ name: '', email: '', password: '' });
    setAdminFormError('');
    setShowAdminModal(true);
  };

  const createAdmin = async () => {
    if (!adminForm.name.trim() || !adminForm.email.trim() || !adminForm.password.trim()) {
      setAdminFormError('All fields are required');
      return;
    }
    if (adminForm.password.length < 8) {
      setAdminFormError('Password must be at least 8 characters');
      return;
    }
    setAdminFormLoading(true);
    setAdminFormError('');
    try {
      await api.post('/admins', {
        name: adminForm.name,
        email: adminForm.email,
        password: adminForm.password,
        role: 'admin',
        client_id: parseInt(id, 10),
      });
      setShowAdminModal(false);
      fetchAdmins();
    } catch (err) {
      setAdminFormError(
        err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to add admin'
      );
    } finally {
      setAdminFormLoading(false);
    }
  };

  const deleteAdmin = async (a) => {
    if (!window.confirm(`Remove admin "${a.name}"? They will no longer be able to sign in.`)) return;
    try {
      await api.delete(`/admins/${a.id}`);
      fetchAdmins();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete admin');
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">Loading client...</div>;
  }
  if (loadError) {
    return (
      <div className="p-8">
        <Link to="/onboarding/clients" className="text-sm text-[#3535FF] hover:underline">
          ← Back to clients
        </Link>
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {loadError}
        </div>
      </div>
    );
  }

  const webhookUrl = `${window.location.origin}/webhook`;

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Link to="/onboarding/clients" className="text-sm text-[#3535FF] hover:underline">
            ← Back to clients
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                {client.business_name && (
                  <span className="text-sm text-gray-500">{client.business_name}</span>
                )}
                <span
                  className={`text-[10px] px-2.5 py-1 rounded-full font-semibold capitalize ${STATUS_STYLES[client.status] || 'bg-gray-100 text-gray-600'}`}
                >
                  {client.status}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={openClientDashboard}
                disabled={openingDashboard}
                className="text-xs font-semibold text-white bg-[#4B16B5] hover:bg-[#351083] disabled:opacity-50 px-4 py-2 rounded-full"
              >
                {openingDashboard ? 'Opening...' : 'Configure Bot'}
              </button>
              <button
                onClick={deleteClient}
                className="text-xs font-semibold text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-full"
              >
                Delete Client
              </button>
            </div>
          </div>
        </div>

        {saveStatus === 'success' && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm">
            Changes saved.
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {saveError}
          </div>
        )}

        <Card title="Identity">
          <Field label="Client / Company Name" value={form.name} onChange={(v) => updateField('name', v)} />
          <Field label="Business Name (shown to customers)" value={form.business_name} onChange={(v) => updateField('business_name', v)} />
          <Field label="Contact Email" value={form.contact_email} onChange={(v) => updateField('contact_email', v)} type="email" />
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Connection Type</label>
            <select
              value={form.connection_provider}
              onChange={(e) => updateField('connection_provider', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
            >
              {CONNECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-500">
              {CONNECTION_OPTIONS.find((option) => option.value === form.connection_provider)?.description}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Status</label>
            <select
              value={form.status}
              onChange={(e) => updateField('status', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </div>
        </Card>

        {form.connection_provider === 'meta' && (
        <>
        <Card title="Meta WhatsApp Credentials">
          <Field label="phone_number_id" value={form.meta_phone_number_id} onChange={(v) => updateField('meta_phone_number_id', v)} mono />
          <Field label="WhatsApp Business Account ID" value={form.meta_business_account_id} onChange={(v) => updateField('meta_business_account_id', v)} mono />
          <Field
            label="Webhook Verify Token"
            value={form.meta_verify_token}
            onChange={(v) => updateField('meta_verify_token', v)}
            mono
          />
          <Field
            label="Access Token (rotate)"
            value={form.meta_access_token}
            onChange={(v) => updateField('meta_access_token', v)}
            placeholder="Leave blank to keep existing token"
            type="password"
            mono
            hint="The stored token is never displayed. Type a new value to replace it."
            autoComplete="new-password"
          />
        </Card>

        <Card
          title="Webhook Setup"
          subtitle="Paste these into Meta > WhatsApp > Configuration"
        >
          <ReadOnlyField label="Callback URL" value={webhookUrl} />
          <ReadOnlyField label="Verify Token" value={client.meta_verify_token || '(none — set one above and save)'} />
          <ReadOnlyField label="phone_number_id" value={client.meta_phone_number_id || '(not set)'} />
        </Card>
        </>
        )}

        {form.connection_provider === 'website' && (
          <Card
            title="Website Chat Setup"
            subtitle="Use this client ID when installing the Nexa chat bubble on their website"
          >
            <ReadOnlyField label="Client ID" value={String(client.id)} />
            <ReadOnlyField label="Public Config URL" value={`${window.location.origin}/api/public/site-chat/${client.id}/config`} />
          </Card>
        )}

        <Card title="Agent Configuration">
          <Field label="Agent Name" value={form.agent_name} onChange={(v) => updateField('agent_name', v)} />
          <Field label="Live Support Phone Number" value={form.support_number} onChange={(v) => updateField('support_number', v)} placeholder="+254712345678" />
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Voice Note Voice</label>
            <select
              value={form.voice_id}
              onChange={(e) => updateField('voice_id', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className={`rounded-2xl border p-4 transition-colors ${form.photo_troubleshooting_enabled ? 'border-[#D8CAFF] bg-[#F5F1FF]' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Enable Photo Troubleshooting</h3>
                  {form.photo_troubleshooting_enabled && (
                    <span className="rounded-full bg-[#4B16B5] px-2 py-0.5 text-[10px] font-bold text-white">ACTIVE</span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  Let this client's AI accept router and fibre terminal photos, inspect visible lights, and guide troubleshooting safely.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.photo_troubleshooting_enabled}
                onClick={() => updateField('photo_troubleshooting_enabled', !form.photo_troubleshooting_enabled)}
                className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors ${form.photo_troubleshooting_enabled ? 'bg-[#4B16B5]' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${form.photo_troubleshooting_enabled ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            <p className="mt-3 rounded-xl bg-white/75 px-3 py-2 text-[11px] text-gray-500">
              Safety note: the AI will describe only visible indicators and will not claim a definite fault or technician dispatch without confirmation.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">System Prompt</label>
            <textarea
              rows={10}
              value={form.system_prompt}
              onChange={(e) => updateField('system_prompt', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-y"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Opening Message <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={form.opening_message}
              onChange={(e) => updateField('opening_message', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-y"
              placeholder="Greeting sent on the first message of a new conversation."
            />
          </div>
        </Card>

        <Card
          title="Operator Payment Integration"
          subtitle="PayHero credentials are managed by Nexa operators only. Client admins cannot see or edit this setup."
        >
          {payheroLoading ? (
            <div className="text-sm text-gray-400">Loading PayHero settings...</div>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                <span>
                  <span className="block text-sm font-bold text-gray-900">Enable M-Pesa prompts</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    The agent can prompt customers only after a clear payment request and amount confirmation.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={payhero.enabled}
                  onChange={(e) => updatePayhero('enabled', e.target.checked)}
                  className="h-5 w-5 accent-[#3535FF]"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="PayHero Channel ID"
                  value={payhero.channel_id}
                  onChange={(v) => updatePayhero('channel_id', v)}
                  placeholder="e.g. 9010"
                  mono
                />
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Provider</label>
                  <select
                    value={payhero.provider}
                    onChange={(e) => updatePayhero('provider', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                  >
                    <option value="m-pesa">M-Pesa</option>
                  </select>
                </div>
              </div>

              <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold leading-5 ${payhero.has_basic_auth ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                {payhero.has_basic_auth
                  ? 'Shared PayHero Basic Auth is configured on the server. You only need to choose this client channel.'
                  : 'Shared PayHero Basic Auth is missing on the server. Add PAYHERO_BASIC_AUTH in the backend .env before enabling prompts.'}
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold leading-5 text-blue-800">
                Customer flow: the agent checks the registered billing account, confirms full package amount or custom amount, then sends the STK prompt through this channel.
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={testPayhero}
                  disabled={payheroTesting || !payhero.has_basic_auth}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50"
                >
                  {payheroTesting ? 'Testing...' : 'Test PayHero'}
                </button>
                <button
                  type="button"
                  onClick={savePayhero}
                  disabled={payheroSaving}
                  className="rounded-xl bg-[#3535FF] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {payheroSaving ? 'Saving...' : 'Save PayHero'}
                </button>
              </div>

              {payheroStatus && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                    payheroStatus.type === 'success'
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                      : 'border-red-100 bg-red-50 text-red-700'
                  }`}
                >
                  {payheroStatus.message}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="sticky bottom-0 bg-white -mx-6 sm:-mx-8 px-6 sm:px-8 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        <Card
          title="Admins"
          subtitle="People who can sign in to this client's dashboard"
          right={
            <button
              onClick={openAdminModal}
              className="bg-[#3535FF] hover:bg-[#2828DD] text-white px-4 py-2 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">+</span>
              Add Admin
            </button>
          }
        >
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {adminsLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">
                      Loading...
                    </td>
                  </tr>
                )}
                {!adminsLoading &&
                  admins.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{a.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{a.email}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(a.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteAdmin(a)}
                          className="text-xs text-red-500 hover:text-red-700 font-semibold"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                {!adminsLoading && admins.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">
                      No admins for this client yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {showAdminModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Add Admin</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Creates a sign-in for <span className="font-medium">{client.name}</span>
              </p>
            </div>
            <div className="p-6 space-y-4">
              {adminFormError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-sm">
                  {adminFormError}
                </div>
              )}
              <Field label="Full Name" value={adminForm.name} onChange={(v) => setAdminForm((f) => ({ ...f, name: v }))} placeholder="Jane Smith" />
              <Field label="Email" value={adminForm.email} onChange={(v) => setAdminForm((f) => ({ ...f, email: v }))} placeholder="jane@company.com" type="email" />
              <Field label="Password" value={adminForm.password} onChange={(v) => setAdminForm((f) => ({ ...f, password: v }))} placeholder="Min. 8 characters" type="password" />
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowAdminModal(false)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createAdmin}
                disabled={adminFormLoading}
                className="flex-1 bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white py-2.5 rounded-full text-sm font-semibold transition-colors"
              >
                {adminFormLoading ? 'Creating...' : 'Create Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, subtitle, right, children }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', mono = false, hint, autoComplete }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white ${mono ? 'font-mono text-xs' : ''}`}
      />
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
  };
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono text-gray-700"
        />
        <button
          type="button"
          onClick={copy}
          className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 hover:bg-gray-100"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
