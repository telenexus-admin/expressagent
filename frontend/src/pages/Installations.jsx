import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { WrenchIcon, CheckCircleIcon, ChartIcon } from '../components/Icons';

const NOTIFY_STYLES = {
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  no_support_number: 'bg-amber-100 text-amber-700',
  logged: 'bg-blue-100 text-blue-700',
};

const NOTIFY_LABELS = {
  sent: 'Support notified',
  failed: 'Notify failed',
  no_support_number: 'No support number set',
  logged: 'CRM intake',
};

const EMAIL_STYLES = {
  sent: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};

const EMAIL_LABELS = {
  sent: 'Email sent',
  failed: 'Email failed',
  skipped: 'Email not sent',
};

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseInstallDetails(trigger) {
  const result = { plan: null, location: null };
  if (!trigger) return result;
  const planMatch = trigger.match(/Plan:\s*([^|]+?)(?:\s*\||$)/i);
  const locMatch = trigger.match(/Location:\s*(.+)$/i);
  if (planMatch) result.plan = planMatch[1].trim();
  if (locMatch) result.location = locMatch[1].trim();
  return result;
}

function normalizeEscalation(item) {
  const { plan, location } = parseInstallDetails(item.trigger_message);
  return {
    ...item,
    source_type: 'chat',
    uid: `chat-${item.id}`,
    plan_interest: plan,
    location_label: location,
    notify_status: item.notify_status,
  };
}

function normalizeIntake(item) {
  const location = [item.county, item.area, item.landmark].filter(Boolean).join(' | ');
  return {
    ...item,
    source_type: 'intake',
    uid: `intake-${item.id}`,
    customer_email: item.email,
    trigger_message: item.notes || '',
    plan_interest: item.plan_interest,
    location_label: location || item.area,
    notify_status: 'logged',
  };
}

function Detail({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-bold text-slate-800">{value || '-'}</div>
    </div>
  );
}

function InstallationDetailsModal({ item, onClose, onDownloadId, downloadingId }) {
  if (!item) return null;
  const isIntake = item.source_type === 'intake';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-7">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#3535FF]">
              {isIntake ? 'Customer intake CRM' : 'Chat installation request'}
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{item.customer_name || 'Unknown customer'}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">+{item.customer_phone} - {formatDateTime(item.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600">
            Close
          </button>
        </div>

        <div className="max-h-[calc(92vh-92px)] overflow-y-auto p-5 sm:p-7">
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <main className="space-y-5">
              <section className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-slate-500">Customer Profile</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Full name" value={item.customer_name} />
                  <Detail label="Phone" value={`+${item.customer_phone || ''}`} />
                  <Detail label="Alternative phone" value={item.alternate_phone ? `+${item.alternate_phone}` : ''} />
                  <Detail label="Email" value={item.customer_email || item.email} />
                  <Detail label="ID number" value={item.id_number} />
                  <Detail label="Consent" value={isIntake ? (item.consent_accepted ? 'Accepted' : 'Not accepted') : 'Chat request'} />
                </div>
              </section>

              <section className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-slate-500">Installation Details</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Preferred package" value={item.plan_interest} />
                  <Detail label="Service type" value={item.service_type} />
                  <Detail label="County / town" value={item.county} />
                  <Detail label="Estate / area" value={item.area || item.location_label} />
                  <Detail label="Landmark" value={item.landmark} />
                  <Detail label="Building type" value={item.building_type} />
                  <Detail label="Preferred date" value={item.preferred_date} />
                  <Detail label="Preferred time" value={item.preferred_time} />
                </div>
                <div className="mt-3 grid gap-3">
                  <Detail label="House / building description" value={item.house_description} />
                  <Detail label="Customer notes" value={item.notes || item.trigger_message} />
                </div>
              </section>

              {isIntake && (
                <section className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm">
                  <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-slate-500">Identity Document</h3>
                  <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-black text-slate-900">{item.identity_filename || 'Identity document'}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{item.identity_mime_type || 'Uploaded file'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDownloadId(item)}
                      disabled={!item.has_identity_document || downloadingId === item.id}
                      className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
                    >
                      {downloadingId === item.id ? 'Opening...' : 'View ID'}
                    </button>
                  </div>
                </section>
              )}
            </main>

            <aside className="space-y-4">
              <div className="rounded-[26px] bg-[#0A0A0F] p-5 text-white">
                <div className="text-xs font-black uppercase tracking-wide text-white/45">Request status</div>
                <div className="mt-3 text-2xl font-black">{item.resolved_at ? 'Confirmed' : item.ticket_status || 'Pending'}</div>
                <div className="mt-2 text-sm font-semibold text-white/60">{isIntake ? 'Submitted through public form' : 'Submitted through chat'}</div>
              </div>
              <div className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-black text-slate-950">Location</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.location_label || '-'}</p>
                {item.latitude && item.longitude && (
                  <a
                    href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex rounded-xl bg-blue-50 px-4 py-2 text-xs font-black text-blue-700"
                  >
                    Open GPS pin
                  </a>
                )}
              </div>
              <div className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-black text-slate-950">Internal IDs</h3>
                <div className="mt-3 space-y-2 text-xs font-bold text-slate-500">
                  <div>Source: {item.source_type}</div>
                  <div>Record: #{item.id}</div>
                  {item.ticket_id && <div>Ticket: #{item.ticket_id}</div>}
                  {item.conversation_id && <div>Conversation: #{item.conversation_id}</div>}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Installations() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const fetchItems = async (currentFilter) => {
    try {
      const params = new URLSearchParams({ type: 'installation' });
      if (currentFilter !== 'all') params.set('status', currentFilter);
      const intakeParams = new URLSearchParams();
      if (currentFilter !== 'all') intakeParams.set('status', currentFilter);
      const [chatRes, intakeRes] = await Promise.all([
        api.get(`/escalations?${params.toString()}`),
        api.get(`/escalations/installation-intakes?${intakeParams.toString()}`),
      ]);
      const merged = [
        ...(Array.isArray(chatRes.data) ? chatRes.data.map(normalizeEscalation) : []),
        ...(Array.isArray(intakeRes.data) ? intakeRes.data.map(normalizeIntake) : []),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setItems(merged);
      setSelected((current) => current && merged.find((row) => row.uid === current.uid) ? merged.find((row) => row.uid === current.uid) : current);
    } catch (err) {
      console.error('Failed to fetch installations:', err.message);
      setActionError(err.response?.data?.error || 'Failed to fetch installation requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchItems(filter);
    const interval = setInterval(() => fetchItems(filter), 15000);
    return () => clearInterval(interval);
  }, [filter]);

  const confirmInstallation = async (item) => {
    if (!window.confirm(`Confirm installation for ${item.customer_name || 'this customer'} and send confirmation SMS/email?`)) return;
    setActionError('');
    setConfirmingId(item.id);
    try {
      await api.post(`/conversations/${item.conversation_id}/confirm-installation`, {});
      fetchItems(filter);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to confirm installation');
    } finally {
      setConfirmingId(null);
    }
  };

  const downloadIdentity = async (item) => {
    setDownloadingId(item.id);
    setActionError('');
    try {
      const response = await api.get(`/escalations/installation-intakes/${item.id}/identity`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to open ID document');
    } finally {
      setDownloadingId(null);
    }
  };

  const openCount = items.filter((e) => !e.resolved_at && e.ticket_status !== 'resolved' && e.ticket_status !== 'closed').length;
  const doneCount = items.filter((e) => e.resolved_at || e.ticket_status === 'resolved' || e.ticket_status === 'closed').length;
  const totalCount = items.length;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950">Installation Requests</h1>
            <p className="mt-1 text-sm text-slate-500">
              CRM view for chat requests and public form submissions, including customer details and ID uploads.
            </p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 text-xs font-bold text-slate-500 shadow-sm">
            Form submissions appear here automatically.
          </div>
        </div>

        {actionError && (
          <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><WrenchIcon className="h-5 w-5" /></div>
            <div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pending</div><div className="text-lg font-bold text-slate-900">{openCount}</div></div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><CheckCircleIcon className="h-5 w-5" /></div>
            <div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Closed</div><div className="text-lg font-bold text-slate-900">{doneCount}</div></div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-[#3535FF] px-4 py-3 text-white">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20"><ChartIcon className="h-5 w-5" /></div>
            <div><div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Total</div><div className="text-lg font-bold">{totalCount}</div></div>
          </div>
        </div>

        <div className="mb-5 flex gap-2">
          {[{ key: 'open', label: 'Pending' }, { key: 'resolved', label: 'Confirmed' }, { key: 'all', label: 'All' }].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${filter === f.key ? 'bg-[#3535FF] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">{filter === 'open' ? 'No pending installation requests.' : filter === 'resolved' ? 'No confirmed installations yet.' : 'No installation requests recorded yet.'}</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((item) => {
              const emailStatus = item.resolved_at ? item.confirmation_email_status : item.request_email_status;
              const isIntake = item.source_type === 'intake';
              return (
                <div key={item.uid} className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex items-center gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white ${isIntake ? 'bg-slate-950' : 'bg-[#3535FF]'}`}>
                        {(item.customer_name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-black text-slate-950">{item.customer_name || 'Unknown customer'}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isIntake ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                            {isIntake ? 'Form CRM' : 'Chat'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">+{item.customer_phone} - {formatDateTime(item.created_at)}</p>
                        {(item.customer_email || item.email) && <p className="mt-1 text-xs font-semibold text-[#3535FF]">{item.customer_email || item.email}</p>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${NOTIFY_STYLES[item.notify_status] || 'bg-gray-100 text-gray-500'}`}>{NOTIFY_LABELS[item.notify_status] || 'Logged'}</span>
                      {!isIntake && <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${EMAIL_STYLES[emailStatus] || EMAIL_STYLES.skipped}`}>{EMAIL_LABELS[emailStatus] || EMAIL_LABELS.skipped}</span>}
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Plan</p><p className="text-sm font-bold text-slate-700">{item.plan_interest || '-'}</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Location</p><p className="line-clamp-2 text-sm font-bold text-slate-700">{item.location_label || '-'}</p></div>
                  </div>

                  {item.has_identity_document && (
                    <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                      ID document uploaded
                    </div>
                  )}

                  {(item.notify_error || item.request_email_error || item.confirmation_email_error) && (
                    <div className="mb-3 rounded-xl border border-red-100 bg-red-50 p-2.5">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500">Delivery error</p>
                      <p className="break-all font-mono text-xs text-red-700">{item.notify_error || item.confirmation_email_error || item.request_email_error}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => setSelected(item)} className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">View CRM Details</button>
                    {item.conversation_id && (
                      <button onClick={() => navigate(`/dashboard/conversations/${item.conversation_id}`)} className="text-xs font-semibold text-[#3535FF] hover:text-[#2828DD]">Open conversation</button>
                    )}
                    {!isIntake && !item.resolved_at && (
                      <button onClick={() => confirmInstallation(item)} disabled={confirmingId === item.id} className="ml-auto rounded-full bg-[#3535FF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2828DD] disabled:opacity-50">
                        {confirmingId === item.id ? 'Sending...' : 'Confirm & Notify'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <InstallationDetailsModal
        item={selected}
        onClose={() => setSelected(null)}
        onDownloadId={downloadIdentity}
        downloadingId={downloadingId}
      />
    </div>
  );
}
