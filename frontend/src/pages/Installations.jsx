import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { WrenchIcon, CheckCircleIcon, ChartIcon } from '../components/Icons';

const EMPTY_INSTALLATION = {
  customer_name: '',
  customer_phone: '',
  location: '',
  assigned_employee_id: '',
  priority: 'normal',
};

const EMPTY_RESCHEDULE = {
  scheduled_for: '',
  assigned_employee_id: '',
  reason: '',
};

const INSTALLATION_SECTIONS = [
  { key: 'requests', label: 'Requests' },
  { key: 'forms', label: 'Submitted Forms' },
  { key: 'reports', label: 'Technician Reports' },
  { key: 'schedule', label: 'Schedule' },
];

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

function normalizeRelocation(item) {
  const location = [item.new_location, item.new_landmark].filter(Boolean).join(' | ');
  return {
    ...item,
    source_type: 'relocation',
    uid: `relocation-${item.id}`,
    customer_email: item.email,
    trigger_message: item.notes || item.reason || '',
    plan_interest: 'Service relocation',
    area: item.new_location,
    landmark: item.new_landmark,
    location_label: location || item.new_location,
    notify_status: 'logged',
  };
}

function Field({ label, value, onChange, placeholder, type = 'text', textarea = false }) {
  const className = "h-12 w-full rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-300 focus:border-[#3535FF]";
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {textarea ? (
        <textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${className} h-auto py-3`} />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={className} />
      )}
    </label>
  );
}

function InstallationDetailsModal({ item, onClose, onDownloadId, downloadingId, onDownloadSpecial, downloadingSpecial, onSpecialStatus }) {
  if (!item) return null;
  const isIntake = item.source_type === 'intake';
  const isRelocation = item.source_type === 'relocation';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-7">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#3535FF]">
              {isRelocation ? 'Relocation transfer CRM' : isIntake ? 'Customer intake CRM' : 'Chat installation request'}
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
                <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-slate-500">{isRelocation ? 'Relocation Details' : 'Installation Details'}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label={isRelocation ? 'Request type' : 'Preferred package'} value={item.plan_interest} />
                  <Detail label="Service type" value={item.service_type} />
                  <Detail label="County / town" value={item.county} />
                  <Detail label={isRelocation ? 'New location' : 'Estate / area'} value={item.area || item.location_label} />
                  <Detail label={isRelocation ? 'New landmark' : 'Landmark'} value={item.landmark} />
                  <Detail label={isRelocation ? 'Current location' : 'Building type'} value={isRelocation ? item.current_location : item.building_type} />
                  <Detail label="Preferred date" value={item.preferred_date} />
                  <Detail label="Preferred time" value={item.preferred_time} />
                </div>
                <div className="mt-3 grid gap-3">
                  <Detail label="House / building description" value={item.house_description} />
                  <Detail label="Customer notes" value={item.notes || item.trigger_message} />
                </div>
              </section>

              {isRelocation && (
                <section className="rounded-[26px] border border-purple-100 bg-purple-50/40 p-4 shadow-sm">
                  <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-purple-700">Equipment Check</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Detail label="Router available" value={item.router_available ? 'Yes' : 'No'} />
                    <Detail label="Router condition" value={String(item.router_condition || 'not_sure').replaceAll('_', ' ')} />
                    <Detail label="Power adapter" value={item.router_power_adapter ? 'Available' : 'Missing / not sure'} />
                    <Detail label="ONT" value={item.ont_available ? 'Available' : 'Missing / not sure'} />
                    <Detail label="Old cables" value={item.cable_available ? 'Available' : 'Not available'} />
                    <Detail label="Reason" value={item.reason} />
                  </div>
                </section>
              )}

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
              {isIntake && item.special_package_type && (
                <section className="rounded-[26px] border border-blue-100 bg-blue-50/50 p-4 shadow-sm">
                  <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-blue-700">Special Package Verification</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Detail label="Application type" value={item.special_package_type === 'student' ? 'Student package' : 'Disability support package'} />
                    <Detail label="Review status" value={String(item.special_package_status || 'pending_review').replaceAll('_', ' ')} />
                    {item.special_package_type === 'student' && <Detail label="Institution" value={item.metadata?.special_package?.institution_name} />}
                    {item.special_package_type === 'student' && <Detail label="Student number" value={item.metadata?.special_package?.student_number} />}
                    {item.special_package_type === 'student' && <Detail label="Expected graduation" value={item.metadata?.special_package?.expected_graduation_year} />}
                    {item.special_package_type === 'disability' && <Detail label="Support category" value={item.metadata?.special_package?.disability_support_category} />}
                    <Detail label="Duplicate application" value={item.metadata?.special_package?.duplicate_application ? 'Review required' : 'No duplicate found'} />
                    <Detail label="Verification consent" value={item.metadata?.special_package?.verification_consent ? 'Accepted' : 'Missing'} />
                  </div>
                  <div className="mt-4 rounded-2xl bg-white p-4">
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Automated completeness checks</div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {Object.entries(item.metadata?.special_package?.checks || {}).map(([key, passed]) => (
                        <div key={key} className={`rounded-xl px-3 py-2 text-xs font-black ${passed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {passed ? 'Ready: ' : 'Review: '}{key.replaceAll('_', ' ')}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onDownloadSpecial(item)} disabled={!item.has_special_document || downloadingSpecial === item.id} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
                      {downloadingSpecial === item.id ? 'Opening...' : 'View verification evidence'}
                    </button>
                    {[['approved', 'Approve'], ['more_information', 'Request more info'], ['declined', 'Decline']].map(([status, label]) => (
                      <button key={status} type="button" onClick={() => onSpecialStatus(item, status)} className="rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-xs font-black text-blue-700">{label}</button>
                    ))}
                  </div>
                </section>
              )}
            </main>

            <aside className="space-y-4">
              <div className="rounded-[26px] bg-[#0A0A0F] p-5 text-white">
                <div className="text-xs font-black uppercase tracking-wide text-white/45">Request status</div>
                <div className="mt-3 text-2xl font-black">{item.resolved_at ? 'Confirmed' : item.ticket_status || 'Pending'}</div>
                <div className="mt-2 text-sm font-semibold text-white/60">{isRelocation ? 'Submitted through relocation form' : isIntake ? 'Submitted through public form' : 'Submitted through chat'}</div>
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
                {isRelocation && item.has_photo && (
                  <button type="button" onClick={() => onDownloadSpecial(item)} disabled={downloadingSpecial === item.id} className="mt-3 inline-flex rounded-xl bg-purple-50 px-4 py-2 text-xs font-black text-purple-700">
                    {downloadingSpecial === item.id ? 'Opening...' : 'View router photo'}
                  </button>
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
  const [downloadingSpecial, setDownloadingSpecial] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installationForm, setInstallationForm] = useState(EMPTY_INSTALLATION);
  const [formError, setFormError] = useState('');
  const [creatingInstall, setCreatingInstall] = useState(false);
  const [activeSection, setActiveSection] = useState('requests');
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduleForm, setScheduleForm] = useState(EMPTY_RESCHEDULE);
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [scheduleError, setScheduleError] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const fetchItems = async (currentFilter) => {
    try {
      const params = new URLSearchParams({ type: 'installation' });
      if (currentFilter !== 'all') params.set('status', currentFilter);
      const intakeParams = new URLSearchParams();
      if (currentFilter !== 'all') intakeParams.set('status', currentFilter);
      const [chatRes, intakeRes, relocationRes] = await Promise.all([
        api.get(`/escalations?${params.toString()}`),
        api.get(`/escalations/installation-intakes?${intakeParams.toString()}`),
        api.get(`/escalations/relocation-requests?${intakeParams.toString()}`),
      ]);
      const merged = [
        ...(Array.isArray(chatRes.data) ? chatRes.data.map(normalizeEscalation) : []),
        ...(Array.isArray(intakeRes.data) ? intakeRes.data.map(normalizeIntake) : []),
        ...(Array.isArray(relocationRes.data) ? relocationRes.data.map(normalizeRelocation) : []),
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

  const fetchWorkOrders = async (currentFilter) => {
    try {
      const params = new URLSearchParams();
      if (currentFilter !== 'all') params.set('status', currentFilter);
      const { data } = await api.get(`/tickets/installations/work-orders?${params.toString()}`);
      setWorkOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch technician reports:', err.message);
      setActionError(err.response?.data?.error || 'Failed to fetch technician reports');
    }
  };

  const refreshAll = async (currentFilter = filter) => {
    await Promise.all([fetchItems(currentFilter), fetchWorkOrders(currentFilter)]);
  };

  useEffect(() => {
    setLoading(true);
    refreshAll(filter);
    const interval = setInterval(() => refreshAll(filter), 15000);
    return () => clearInterval(interval);
  }, [filter]);

  useEffect(() => {
    let stopped = false;
    async function loadEmployees() {
      try {
        const { data } = await api.get('/employees');
        if (!stopped) setEmployees(data.filter((employee) => employee.role === 'technician' && employee.is_active));
      } catch (err) {
        if (!stopped) setEmployees([]);
      }
    }
    loadEmployees();
    return () => { stopped = true; };
  }, []);

  const createInstallation = async () => {
    const payload = {
      ...installationForm,
      customer_name: installationForm.customer_name.trim(),
      customer_phone: installationForm.customer_phone.trim(),
      location: installationForm.location.trim(),
      assigned_employee_id: Number(installationForm.assigned_employee_id),
    };
    if (!payload.customer_name || !payload.customer_phone || !payload.location || !payload.assigned_employee_id) {
      setFormError('Client name, phone number, location and technician are required.');
      return;
    }
    setCreatingInstall(true);
    setFormError('');
    try {
      const { data } = await api.post('/tickets/installations', payload);
      setShowInstallModal(false);
      setInstallationForm(EMPTY_INSTALLATION);
      await refreshAll(filter);
      navigate(`/dashboard/tickets/${data.id}`);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create installation request');
    } finally {
      setCreatingInstall(false);
    }
  };

  const confirmInstallation = async (item) => {
    if (!window.confirm(`Confirm installation for ${item.customer_name || 'this customer'} and send confirmation SMS/email?`)) return;
    setActionError('');
    setConfirmingId(item.id);
    try {
      await api.post(`/conversations/${item.conversation_id}/confirm-installation`, {});
      refreshAll(filter);
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
  const downloadSpecial = async (item) => {
    setDownloadingSpecial(item.id);
    try {
      const urlPath = item.source_type === 'relocation'
        ? `/escalations/relocation-requests/${item.id}/photo`
        : `/escalations/installation-intakes/${item.id}/special-document`;
      const response = await api.get(urlPath, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to open verification document');
    } finally {
      setDownloadingSpecial(null);
    }
  };
  const updateSpecialStatus = async (item, status) => {
    try {
      await api.patch(`/escalations/installation-intakes/${item.id}/special-status`, { status });
      await refreshAll(filter);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to update verification status');
    }
  };

  const openCount = items.filter((e) => !e.resolved_at && e.ticket_status !== 'resolved' && e.ticket_status !== 'closed').length;
  const doneCount = items.filter((e) => e.resolved_at || e.ticket_status === 'resolved' || e.ticket_status === 'closed').length;
  const totalCount = items.length;
  const submittedForms = items.filter((item) => item.source_type === 'intake' || item.source_type === 'relocation');
  const submittedReports = workOrders.filter((order) => order.submitted_at || order.technician_status !== 'pending');
  const scheduledOrders = workOrders.filter((order) => order.scheduled_for || order.last_rescheduled_at || order.ticket_status !== 'resolved');
  const visibleItems = activeSection === 'forms' ? submittedForms : items;
  const emptyMessage = activeSection === 'forms'
    ? 'No submitted customer forms yet.'
    : filter === 'open'
      ? 'No pending installation requests.'
      : filter === 'resolved'
        ? 'No confirmed installations yet.'
        : 'No installation requests recorded yet.';

  const openSchedule = async (order) => {
    setScheduleTarget(order);
    setScheduleError('');
    setScheduleForm({
      scheduled_for: order.scheduled_for ? String(order.scheduled_for).slice(0, 16) : '',
      assigned_employee_id: order.assigned_employee_id || '',
      reason: order.latest_schedule_reason || order.schedule_note || '',
    });
    try {
      const { data } = await api.get(`/tickets/installations/${order.ticket_id}/schedule`);
      setScheduleEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      setScheduleEvents([]);
      setScheduleError(err.response?.data?.error || 'Failed to load schedule history');
    }
  };

  const submitSchedule = async () => {
    if (!scheduleTarget) return;
    if (!scheduleForm.scheduled_for) {
      setScheduleError('Choose the new installation date and time.');
      return;
    }
    setSavingSchedule(true);
    setScheduleError('');
    try {
      await api.post(`/tickets/installations/${scheduleTarget.ticket_id}/reschedule`, {
        scheduled_for: scheduleForm.scheduled_for,
        assigned_employee_id: scheduleForm.assigned_employee_id || null,
        reason: scheduleForm.reason,
      });
      await refreshAll(filter);
      const { data } = await api.get(`/tickets/installations/${scheduleTarget.ticket_id}/schedule`);
      setScheduleEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      setScheduleError(err.response?.data?.error || 'Failed to reschedule installation');
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950">Installation Requests</h1>
            <p className="mt-1 text-sm text-slate-500">
              CRM view for installations, relocation transfers and public form submissions, including customer details and field-team notes.
            </p>
          </div>
          <button onClick={() => { setInstallationForm(EMPTY_INSTALLATION); setFormError(''); setShowInstallModal(true); }} className="flex h-12 w-fit items-center gap-3 rounded-xl bg-gradient-to-r from-[#2f72ff] to-[#8028ff] px-6 text-sm font-black text-white shadow-[0_14px_28px_rgba(73,85,255,0.26)] hover:brightness-105">
            <span className="text-xl leading-none">+</span>
            Add Installation
          </button>
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

        <div className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-2">
          {INSTALLATION_SECTIONS.map((section) => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-black transition ${activeSection === section.key ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
            >
              {section.label}
            </button>
          ))}
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
        ) : activeSection === 'reports' ? (
          submittedReports.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center">
              <p className="text-sm text-slate-500">No technician reports submitted yet.</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {submittedReports.map((order) => (
                <div key={order.id} className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-[#3535FF]">Technician report</div>
                      <h3 className="mt-2 text-lg font-black text-slate-950">{order.customer_name || 'Installation customer'}</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">+{order.customer_phone} - Ticket #{order.ticket_id}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{order.technician_status || 'pending'}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Detail label="Technician" value={order.technician_name || 'Unassigned'} />
                    <Detail label="Submitted" value={formatDateTime(order.submitted_at)} />
                    <Detail label="Power / DCBs" value={order.power_dcbs} />
                    <Detail label="Signal" value={order.signal_power} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => setSelectedReport(order)} className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">Open report</button>
                    <button onClick={() => openSchedule(order)} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-600">Reschedule</button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeSection === 'schedule' ? (
          scheduledOrders.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center">
              <p className="text-sm text-slate-500">No installation schedule records yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {scheduledOrders.map((order) => (
                <div key={order.id} className="grid gap-4 rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm lg:grid-cols-[1fr_220px_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-slate-950">{order.customer_name || 'Installation customer'}</h3>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700">{order.ticket_status}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-500">+{order.customer_phone} - {order.summary || order.title}</p>
                    {order.latest_schedule_reason && <p className="mt-2 text-xs font-bold text-slate-400">Last reason: {order.latest_schedule_reason}</p>}
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Scheduled for</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{formatDateTime(order.scheduled_for) || 'Not scheduled'}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{order.technician_name || 'No technician assigned'}</div>
                  </div>
                  <button onClick={() => openSchedule(order)} className="h-11 rounded-full bg-[#3535FF] px-5 text-xs font-black text-white">Reschedule</button>
                </div>
              ))}
            </div>
          )
        ) : visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">{emptyMessage}</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleItems.map((item) => {
              const emailStatus = item.resolved_at ? item.confirmation_email_status : item.request_email_status;
              const isIntake = item.source_type === 'intake';
              return (
                <div key={item.uid} className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex items-center gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white ${item.source_type === 'relocation' ? 'bg-purple-600' : isIntake ? 'bg-slate-950' : 'bg-[#3535FF]'}`}>
                        {(item.customer_name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-black text-slate-950">{item.customer_name || 'Unknown customer'}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isIntake ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                            {item.source_type === 'relocation' ? 'Relocation' : isIntake ? 'Form CRM' : 'Chat'}
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
                  {item.special_package_type && (
                    <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                      {item.special_package_type === 'student' ? 'Student' : 'Disability support'} package: {String(item.special_package_status || 'pending_review').replaceAll('_', ' ')}
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
        onDownloadSpecial={downloadSpecial}
        downloadingSpecial={downloadingSpecial}
        onSpecialStatus={updateSpecialStatus}
      />

      <WorkOrderDetailsModal report={selectedReport} onClose={() => setSelectedReport(null)} />

      <ScheduleModal
        target={scheduleTarget}
        form={scheduleForm}
        setForm={setScheduleForm}
        employees={employees}
        events={scheduleEvents}
        onClose={() => setScheduleTarget(null)}
        onSubmit={submitSchedule}
        saving={savingSchedule}
        error={scheduleError}
      />

      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-6">
              <h3 className="text-lg font-black text-slate-950">Add installation request</h3>
              <p className="mt-1 text-sm font-semibold text-slate-400">Assign the request to a technician. Only that technician receives the SMS.</p>
            </div>
            <div className="space-y-4 p-6">
              {formError && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{formError}</div>}
              <Field label="Name of client" value={installationForm.customer_name} onChange={(value) => setInstallationForm((form) => ({ ...form, customer_name: value }))} placeholder="As registered on the system" />
              <Field label="Phone number / account number" value={installationForm.customer_phone} onChange={(value) => setInstallationForm((form) => ({ ...form, customer_phone: value }))} placeholder="+254..." />
              <Field label="Detailed location" value={installationForm.location} onChange={(value) => setInstallationForm((form) => ({ ...form, location: value }))} placeholder="Estate, building, floor, nearest landmark..." />
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Technician</span>
                <select value={installationForm.assigned_employee_id} onChange={(event) => setInstallationForm((form) => ({ ...form, assigned_employee_id: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                  <option value="">Select technician</option>
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.phone}</option>)}
                </select>
              </label>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setShowInstallModal(false)} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-black text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={createInstallation} disabled={creatingInstall} className="flex-1 rounded-full bg-[#3535FF] py-3 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50">
                {creatingInstall ? 'Creating...' : 'Create and notify'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkOrderDetailsModal({ report, onClose }) {
  if (!report) return null;
  const equipment = Array.isArray(report.equipment_used) ? report.equipment_used : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#3535FF]">Technician Site Report</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{report.customer_name || 'Installation customer'}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Ticket #{report.ticket_id} - +{report.customer_phone}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600">Close</button>
        </div>
        <div className="max-h-[calc(92vh-100px)] overflow-y-auto p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Detail label="Technician" value={report.technician_name || 'Unassigned'} />
            <Detail label="Report status" value={report.technician_status || report.work_order_status} />
            <Detail label="Submitted at" value={formatDateTime(report.submitted_at)} />
            <Detail label="Started at" value={formatDateTime(report.installation_started_at)} />
            <Detail label="Completed at" value={formatDateTime(report.installation_completed_at)} />
            <Detail label="Time taken" value={report.installation_time_minutes ? `${report.installation_time_minutes} minutes` : ''} />
            <Detail label="Power / DCBs" value={report.power_dcbs} />
            <Detail label="Signal power" value={report.signal_power} />
            <Detail label="Next schedule" value={formatDateTime(report.scheduled_for)} />
          </div>
          <section className="mt-5 rounded-[24px] border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Equipment Used</h3>
            {equipment.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-slate-400">No equipment lines submitted yet.</p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {equipment.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="grid gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_90px_90px_1fr]">
                    <div className="font-black text-slate-900">{item.name || 'Inventory item'}</div>
                    <div className="font-bold text-slate-600">{item.quantity || 0}</div>
                    <div className="font-bold text-slate-500">{item.unit || 'pcs'}</div>
                    <div className="text-slate-500">{item.notes || '-'}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="mt-5 rounded-[24px] border border-slate-100 bg-white p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Technician Notes</h3>
            <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-600">{report.notes || 'No notes submitted yet.'}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({ target, form, setForm, employees, events, onClose, onSubmit, saving, error }) {
  if (!target) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#3535FF]">Installation Schedule</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{target.customer_name || 'Installation customer'}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Ticket #{target.ticket_id} - +{target.customer_phone}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600">Close</button>
        </div>
        <div className="max-h-[calc(92vh-100px)] overflow-y-auto p-6">
          {error && <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New date and time" type="datetime-local" value={form.scheduled_for} onChange={(value) => setForm((current) => ({ ...current, scheduled_for: value }))} />
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Technician</span>
              <select value={form.assigned_employee_id} onChange={(event) => setForm((current) => ({ ...current, assigned_employee_id: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#3535FF]">
                <option value="">Keep current technician</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.phone}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <Field label="Reason / note" value={form.reason} onChange={(value) => setForm((current) => ({ ...current, reason: value }))} textarea placeholder="Customer requested afternoon visit, technician unavailable, weather delay..." />
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onClose} className="h-12 flex-1 rounded-full border border-slate-200 text-sm font-black text-slate-600">Cancel</button>
            <button type="button" onClick={onSubmit} disabled={saving} className="h-12 flex-1 rounded-full bg-[#3535FF] text-sm font-black text-white disabled:opacity-50">
              {saving ? 'Rescheduling...' : 'Save and notify'}
            </button>
          </div>
          <section className="mt-6 rounded-[24px] border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Schedule History</h3>
            {events.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-slate-400">No reschedule history yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="rounded-2xl bg-white p-4 text-sm shadow-sm">
                    <div className="font-black text-slate-950">{formatDateTime(event.scheduled_for)}</div>
                    <div className="mt-1 text-slate-500">{event.reason || 'No reason recorded'}</div>
                    <div className="mt-2 text-xs font-bold text-slate-400">
                      Customer: {event.customer_notify_status} - Technician: {event.technician_notify_status}
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
