import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';

const emptyBroadcast = {
  title: '',
  message: '',
  selectedOnly: false,
  clientIds: [],
};

function phoneDisplay(value) {
  const phone = String(value || '').replace(/[^0-9]/g, '');
  return phone ? `+${phone}` : 'Not added';
}

export default function UpdateContacts() {
  const [contacts, setContacts] = useState([]);
  const [summary, setSummary] = useState({ total: 0, configured: 0, enabled: 0 });
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [form, setForm] = useState(emptyBroadcast);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);

  const enabledContacts = useMemo(
    () => contacts.filter((contact) => contact.has_update_contact && contact.update_notifications_enabled),
    [contacts]
  );
  const selectedCount = form.selectedOnly ? form.clientIds.length : enabledContacts.length;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setNotice(null);
    try {
      const [contactRes, broadcastRes] = await Promise.all([
        api.get('/operator-update-contacts/contacts'),
        api.get('/operator-update-contacts/broadcasts').catch(() => ({ data: [] })),
      ]);
      setContacts(contactRes.data.contacts || []);
      setSummary(contactRes.data.summary || { total: 0, configured: 0, enabled: 0 });
      setBroadcasts(broadcastRes.data || []);
      const nextDrafts = {};
      (contactRes.data.contacts || []).forEach((contact) => {
        nextDrafts[contact.id] = {
          official_whatsapp_number: contact.official_whatsapp_number || '',
          official_contact_name: contact.official_contact_name || '',
          update_notifications_enabled: contact.update_notifications_enabled !== false,
        };
      });
      setDrafts(nextDrafts);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.error || 'Failed to load update contacts.' });
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(id, key, value) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), [key]: value },
    }));
  }

  async function saveContact(contact) {
    setSavingId(contact.id);
    setNotice(null);
    try {
      await api.put(`/operator-update-contacts/contacts/${contact.id}`, drafts[contact.id] || {});
      setNotice({ type: 'success', message: 'Update contact saved.' });
      await loadData();
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to save contact.' });
    } finally {
      setSavingId(null);
    }
  }

  function toggleClient(id) {
    setForm((current) => {
      const exists = current.clientIds.includes(id);
      return {
        ...current,
        clientIds: exists ? current.clientIds.filter((item) => item !== id) : [...current.clientIds, id],
      };
    });
  }

  async function sendBroadcast() {
    if (!form.title.trim() || !form.message.trim()) {
      setNotice({ type: 'error', message: 'Add a title and update message first.' });
      return;
    }
    if (form.selectedOnly && form.clientIds.length === 0) {
      setNotice({ type: 'error', message: 'Select at least one client, or send to all enabled contacts.' });
      return;
    }
    if (!window.confirm(`Send this update to ${selectedCount} WhatsApp contact(s)?`)) return;
    setSending(true);
    setNotice(null);
    try {
      const { data } = await api.post('/operator-update-contacts/broadcasts', {
        title: form.title,
        message: form.message,
        client_ids: form.selectedOnly ? form.clientIds : [],
      });
      setNotice({ type: 'success', message: `Update sent. Sent: ${data.sent_count}, failed: ${data.failed_count}.` });
      setForm(emptyBroadcast);
      await loadData();
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.error || 'Failed to send update broadcast.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#3535FF]">Operator Broadcast Center</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Client Update Contacts</h1>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
              Store each client admin's official WhatsApp number and send product updates from the official Nexa WhatsApp number.
            </p>
          </div>
          <button onClick={loadData} className="h-11 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white">
            Refresh
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Clients" value={summary.total} helper="All onboarded accounts" />
          <Stat label="Numbers Added" value={summary.configured} helper="Official update contacts" tone="blue" />
          <Stat label="Receiving Updates" value={summary.enabled} helper="Enabled WhatsApp recipients" tone="green" />
        </div>

        {notice && (
          <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${notice.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
            {notice.message}
          </div>
        )}

        <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="rounded-[28px] border border-indigo-100 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-black text-slate-950">Send System Update</h2>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                Use this for deployment notes, new features, maintenance windows and important Nexa changes.
              </p>
            </div>
            <div className="space-y-4">
              <Field label="Update title">
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="New dashboard features"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-[#3535FF]"
                />
              </Field>
              <Field label="Message to send">
                <textarea
                  rows={8}
                  value={form.message}
                  onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                  placeholder="We have added automatic client domains, improved router monitoring, and..."
                  className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-[#3535FF]"
                />
              </Field>
              <label className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-[#f7f5ff] p-4 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={form.selectedOnly}
                  onChange={(event) => setForm((current) => ({ ...current, selectedOnly: event.target.checked }))}
                  className="mt-1 h-4 w-4 accent-[#3535FF]"
                />
                <span>
                  Send only to selected clients
                  <span className="mt-1 block text-xs font-semibold text-slate-500">
                    Off means all enabled update contacts receive the message.
                  </span>
                </span>
              </label>
              <button
                onClick={sendBroadcast}
                disabled={sending || selectedCount === 0}
                className="h-12 w-full rounded-2xl bg-[#3535FF] text-sm font-black text-white shadow-[0_16px_34px_rgba(53,53,255,0.25)] disabled:opacity-50"
              >
                {sending ? 'Sending...' : `Send to ${selectedCount} contact(s)`}
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-indigo-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-950">Client Official Numbers</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">This is separate from the WhatsApp number connected to the AI agent.</p>
              </div>
            </div>
            {loading ? (
              <div className="rounded-2xl bg-slate-50 py-12 text-center text-sm font-bold text-slate-400">Loading contacts...</div>
            ) : (
              <div className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
                {contacts.map((contact) => {
                  const draft = drafts[contact.id] || {};
                  const selected = form.clientIds.includes(contact.id);
                  return (
                    <div key={contact.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-950">{contact.business_name || contact.name}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">{phoneDisplay(contact.official_whatsapp_number)}</div>
                        </div>
                        {form.selectedOnly && contact.has_update_contact && contact.update_notifications_enabled && (
                          <button
                            onClick={() => toggleClient(contact.id)}
                            className={`rounded-full px-4 py-2 text-xs font-black ${selected ? 'bg-[#3535FF] text-white' : 'bg-white text-[#3535FF] ring-1 ring-indigo-100'}`}
                          >
                            {selected ? 'Selected' : 'Select'}
                          </button>
                        )}
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                        <input
                          value={draft.official_contact_name || ''}
                          onChange={(event) => updateDraft(contact.id, 'official_contact_name', event.target.value)}
                          placeholder="Contact name"
                          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-[#3535FF]"
                        />
                        <input
                          value={draft.official_whatsapp_number || ''}
                          onChange={(event) => updateDraft(contact.id, 'official_whatsapp_number', event.target.value)}
                          placeholder="2547XXXXXXXX"
                          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-[#3535FF]"
                        />
                        <button
                          onClick={() => saveContact(contact)}
                          disabled={savingId === contact.id}
                          className="h-11 rounded-xl bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-50"
                        >
                          {savingId === contact.id ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                      <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-600">
                        <input
                          type="checkbox"
                          checked={draft.update_notifications_enabled !== false}
                          onChange={(event) => updateDraft(contact.id, 'update_notifications_enabled', event.target.checked)}
                          className="h-4 w-4 accent-[#3535FF]"
                        />
                        Receive Nexa system update messages
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-indigo-100 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black text-slate-950">Recent Update Broadcasts</h2>
          <div className="mt-4 space-y-3">
            {broadcasts.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 py-10 text-center text-sm font-bold text-slate-400">No update broadcasts sent yet.</div>
            ) : broadcasts.map((broadcast) => (
              <div key={broadcast.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-950">{broadcast.title}</div>
                    <div className="mt-1 text-xs font-bold text-slate-500">
                      Sent {broadcast.sent_count} · Failed {broadcast.failed_count} · {new Date(broadcast.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-100">
                    {broadcast.total_recipients} recipient(s)
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, helper, tone = 'purple' }) {
  const tones = {
    purple: 'bg-[#efe9ff] text-[#4f35f5]',
    blue: 'bg-sky-50 text-sky-700',
    green: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <div className="rounded-[24px] border border-indigo-100 bg-white p-5 shadow-sm">
      <div className={`mb-4 h-12 w-12 rounded-2xl ${tones[tone] || tones.purple}`} />
      <div className="text-xs font-black text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{helper}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}
