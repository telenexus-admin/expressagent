import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';

const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-700',
  suspended: 'bg-amber-50 text-amber-700',
};

const DEFAULT_PROMPT = `You are a helpful and professional ISP customer support agent. Your goals are:
- Answer customer questions accurately and concisely
- Be polite, empathetic, and solution-focused
- If you cannot resolve an issue, let the customer know a human agent will follow up soon
- Never make up information you are unsure about
- Keep responses brief and easy to read on a mobile device
- Handle common ISP issues such as no internet, slow speeds, red LOS, router lights, billing questions, package expiry, payments and installation requests
- Use customer photos of routers, ONTs, cables and speed tests to give careful visual troubleshooting based only on what is visible`;

const VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const CONNECTION_OPTIONS = [
  { value: 'meta', label: 'Meta WhatsApp', description: 'Customer messages come through the official WhatsApp Cloud API.' },
  { value: 'website', label: 'Website only', description: 'Use the website chat widget without linking a WhatsApp number.' },
  { value: 'evolution', label: 'Evolution WhatsApp', description: 'For clients connected through the Evolution onboarding flow.' },
];
const CONNECTION_LABELS = CONNECTION_OPTIONS.reduce((acc, option) => ({ ...acc, [option.value]: option.label }), {});

const EMPTY_FORM = {
  name: '',
  business_name: '',
  contact_email: '',
  connection_provider: 'meta',
  meta_phone_number_id: '',
  meta_access_token: '',
  meta_business_account_id: '',
  meta_verify_token: '',
  support_number: '',
  system_prompt: DEFAULT_PROMPT,
  agent_name: '',
  voice_id: 'alloy',
  admin_name: '',
  admin_email: '',
  admin_password: '',
};

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessingClientId, setAccessingClientId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/clients');
      setClients(data);
    } catch (err) {
      console.error('Failed to fetch clients:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setCreated(null);
    setShowModal(true);
  };

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const createClient = async () => {
    const required = [
      ['name', 'Client name'],
      ['admin_name', 'Admin name'],
      ['admin_email', 'Admin email'],
      ['admin_password', 'Admin password'],
    ];
    if (form.connection_provider === 'meta') {
      required.splice(1, 0, ['meta_phone_number_id', 'Meta phone_number_id'], ['meta_access_token', 'Meta access token']);
    }
    for (const [key, label] of required) {
      if (!form[key].trim()) {
        setFormError(`${label} is required`);
        return;
      }
    }
    if (form.admin_password.length < 8) {
      setFormError('Admin password must be at least 8 characters');
      return;
    }

    setFormLoading(true);
    setFormError('');
    try {
      const { data } = await api.post('/clients', form);
      setCreated(data);
      fetchClients();
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.errors?.[0]?.msg ||
        'Failed to create client';
      setFormError(msg);
    } finally {
      setFormLoading(false);
    }
  };

  const toggleStatus = async (client) => {
    const next = client.status === 'active' ? 'suspended' : 'active';
    if (!window.confirm(`Set client "${client.name}" to ${next}?`)) return;
    try {
      await api.put(`/clients/${client.id}`, { status: next });
      fetchClients();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update client');
    }
  };

  const deleteClient = async (client) => {
    if (
      !window.confirm(
        `Delete client "${client.name}"? This will permanently remove their admins, conversations, escalations, and messages. This cannot be undone.`
      )
    )
      return;
    try {
      await api.delete(`/clients/${client.id}`);
      fetchClients();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete client');
    }
  };

  const openClientDashboard = async (client) => {
    const tab = window.open('about:blank', '_blank');
    setAccessingClientId(client.id);
    try {
      const { data } = await api.post(`/clients/${client.id}/operator-access`);
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
      setAccessingClientId(null);
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
            <p className="text-sm text-gray-500 mt-1">
              Businesses you've onboarded onto Nexa
            </p>
          </div>
          <button
            onClick={openModal}
            className="bg-[#3535FF] hover:bg-[#2828DD] text-white px-5 py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5"
          >
            <span className="text-lg leading-none">+</span>
            New Client
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Client</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Connection</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Admins</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Convos</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">
                      Loading clients...
                    </td>
                  </tr>
                )}
                {!loading &&
                  clients.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#3535FF] flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <Link
                              to={`/onboarding/clients/${c.id}`}
                              className="text-sm font-medium text-gray-900 hover:text-[#3535FF] truncate block"
                            >
                              {c.name}
                            </Link>
                            {c.business_name && (
                              <div className="text-[11px] text-gray-500 truncate">{c.business_name}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-xs font-bold text-gray-700">
                          {CONNECTION_LABELS[c.connection_provider] || 'Meta WhatsApp'}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono">
                          {c.meta_phone_number_id || (c.connection_provider === 'website' ? 'site chat' : 'not set')}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-[10px] px-2.5 py-1 rounded-full font-semibold capitalize ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{c.admin_count}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{c.conversation_count}</td>
                      <td className="px-5 py-3.5 text-xs text-gray-500">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => openClientDashboard(c)}
                          disabled={accessingClientId === c.id}
                          className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50 font-semibold mr-3"
                        >
                          {accessingClientId === c.id ? 'Opening...' : 'Configure Bot'}
                        </button>
                        <Link
                          to={`/onboarding/clients/${c.id}`}
                          className="text-xs text-[#3535FF] hover:text-[#2828DD] font-semibold mr-3"
                        >
                          Manage
                        </Link>
                        <button
                          onClick={() => toggleStatus(c)}
                          className="text-xs text-gray-600 hover:text-gray-900 font-semibold mr-3"
                        >
                          {c.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteClient(c)}
                          className="text-xs text-red-500 hover:text-red-700 font-semibold"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                {!loading && clients.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">
                      No clients yet. Click "New Client" to onboard your first one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-100 shrink-0">
              <h2 className="text-lg font-bold text-gray-900">
                {created ? 'Client Onboarded' : 'Onboard New Client'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {created
                  ? 'Save the webhook details below and paste them into the client’s Meta dashboard.'
                  : 'Configure Meta WhatsApp credentials and the client’s first admin login.'}
              </p>
            </div>

            {created ? (
              <div className="p-6 overflow-y-auto space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 text-sm">
                  <div className="font-semibold mb-1">Client created successfully</div>
                  <div>
                    {created.client.name} · admin login:{' '}
                    <span className="font-mono">{created.admin.email}</span>
                  </div>
                </div>

                {created.client.connection_provider === 'website' ? (
                  <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 space-y-3">
                    <div className="text-xs font-bold text-blue-700 uppercase tracking-wider">
                      Website Chat
                    </div>
                    <ReadOnlyField
                      label="Client ID"
                      value={String(created.client.id)}
                      hint="Use this ID when installing the Nexa website chat widget."
                    />
                    <ReadOnlyField
                      label="Public Config URL"
                      value={`${window.location.origin}/api/public/site-chat/${created.client.id}/config`}
                    />
                  </div>
                ) : (
                  <>
                    <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                      <div className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Meta Webhook Configuration
                      </div>
                      <ReadOnlyField
                        label="Callback URL"
                        value={`${window.location.origin}/webhook`}
                        hint="Paste into Meta > WhatsApp > Configuration > Webhook callback URL."
                      />
                      <ReadOnlyField label="Verify Token" value={created.client.meta_verify_token} />
                      <ReadOnlyField label="phone_number_id" value={created.client.meta_phone_number_id} />
                    </div>

                    <p className="text-xs text-gray-500">
                      In Meta &gt; WhatsApp &gt; Configuration, subscribe to <em>messages</em> on this
                      callback URL and paste the verify token above. You can re-open these details any
                      time from the client's "Manage" page.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="p-6 overflow-y-auto space-y-5">
                {formError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-sm">
                    {formError}
                  </div>
                )}

                <Section title="Client Identity">
                  <Field label="Client / Company Name" value={form.name} onChange={(v) => updateField('name', v)} placeholder="Acme Internet" />
                  <Field label="Business Name (shown to customers)" value={form.business_name} onChange={(v) => updateField('business_name', v)} placeholder="Acme Internet" />
                  <Field label="Contact Email" value={form.contact_email} onChange={(v) => updateField('contact_email', v)} placeholder="ceo@acme.com" type="email" />
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
                </Section>

                {form.connection_provider === 'meta' && (
                  <Section title="Meta WhatsApp Credentials" subtitle="From the client's Meta for Developers app">
                    <Field label="phone_number_id" value={form.meta_phone_number_id} onChange={(v) => updateField('meta_phone_number_id', v)} placeholder="123456789012345" mono />
                    <Field label="Access Token (System User)" value={form.meta_access_token} onChange={(v) => updateField('meta_access_token', v)} placeholder="EAAGm..." mono />
                    <Field label="WhatsApp Business Account ID" value={form.meta_business_account_id} onChange={(v) => updateField('meta_business_account_id', v)} placeholder="optional" mono />
                    <Field
                      label="Webhook Verify Token"
                      value={form.meta_verify_token}
                      onChange={(v) => updateField('meta_verify_token', v)}
                      placeholder="leave blank to auto-generate"
                      mono
                      hint="A random one will be generated if you leave this blank."
                    />
                  </Section>
                )}

                <Section title="Agent Configuration">
                  <Field label="Agent Name" value={form.agent_name} onChange={(v) => updateField('agent_name', v)} placeholder="e.g. Asha" />
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

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">System Prompt</label>
                    <textarea
                      rows={8}
                      value={form.system_prompt}
                      onChange={(e) => updateField('system_prompt', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-y"
                    />
                  </div>
                </Section>

                <Section title="First Admin Login" subtitle="The client uses these credentials to log in to their dashboard">
                  <Field label="Admin Name" value={form.admin_name} onChange={(v) => updateField('admin_name', v)} placeholder="Jane Doe" />
                  <Field label="Admin Email" value={form.admin_email} onChange={(v) => updateField('admin_email', v)} placeholder="jane@acme.com" type="email" />
                  <Field label="Admin Password" value={form.admin_password} onChange={(v) => updateField('admin_password', v)} placeholder="Min. 8 characters" type="password" />
                </Section>
              </div>
            )}

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
              {created ? (
                <button
                  onClick={() => setShowModal(false)}
                  className="ml-auto bg-[#3535FF] hover:bg-[#2828DD] text-white px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowModal(false)}
                    className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createClient}
                    disabled={formLoading}
                    className="flex-1 bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white py-2.5 rounded-full text-sm font-semibold transition-colors"
                  >
                    {formLoading ? 'Creating...' : 'Create Client'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', mono = false, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white ${mono ? 'font-mono text-xs' : ''}`}
      />
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function ReadOnlyField({ label, value, hint }) {
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
          className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono text-gray-700"
        />
        <button
          type="button"
          onClick={copy}
          className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 hover:bg-gray-100"
        >
          Copy
        </button>
      </div>
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
