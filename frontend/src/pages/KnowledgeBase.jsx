import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import knowledgeRobot from '../assets/knowledge-robot.jpg';
import { CreditCardIcon, PulseIcon, ShareIosIcon } from '../components/Icons';

function KnowledgeCard({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-[22px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
      <div className="flex items-start gap-4">
        <div className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl bg-[#f0e8ff] text-[#6c2cff]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-black text-[#08103f]">{title}</h2>
          <p className="mt-1 max-w-[680px] text-[13px] font-semibold leading-6 text-[#637098]">{description}</p>
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </section>
  );
}

function HeaderIcon({ className = 'h-7 w-7' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 10.5 12 15l5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4v10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.5 8H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.2 4.5h7.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DatabaseIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" stroke="currentColor" strokeWidth="2" />
      <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function FileIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9.5 13h5M9.5 17h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".12" />
      <path d="M12 10v7M12 7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read file'));
  reader.readAsDataURL(file);
});

function apiErrorMessage(err, fallback) {
  if (err.response?.data?.error) return err.response.data.error;
  if (typeof err.response?.data === 'string') {
    const text = err.response.data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return `${fallback} ${text.slice(0, 160)}`;
  }
  if (err.response?.status) return `${fallback} Server returned ${err.response.status}${err.response.statusText ? ` ${err.response.statusText}` : ''}.`;
  return err.message ? `${fallback} ${err.message}` : fallback;
}

const BILLING_IMPORT_SYSTEMS = [
  { value: 'wispman', label: 'Wispman CSV', helper: 'CLIENT_ID, USERNAME, PASSWORD, FULLNAME and package columns.' },
  { value: 'billnasi', label: 'Billnasi CSV / Excel', helper: 'Username, Names, Phone, Activity, Status, Expiry, Package and Location.' },
];

function possessiveName(name) {
  const trimmed = String(name || '').trim() || 'Agent';
  return `${trimmed}${trimmed.toLowerCase().endsWith('s') ? "'" : "'s"}`;
}

export default function KnowledgeBase() {
  const [agentName, setAgentName] = useState('Agent');
  const [billingImport, setBillingImport] = useState({ account_count: 0, last_import: null });
  const [billingImportFile, setBillingImportFile] = useState(null);
  const [billingImportSystem, setBillingImportSystem] = useState('wispman');
  const [billingImportUploading, setBillingImportUploading] = useState(false);
  const [billingImportDeleting, setBillingImportDeleting] = useState(false);
  const [billingImportStatus, setBillingImportStatus] = useState(null);
  const [websiteItems, setWebsiteItems] = useState([]);
  const [websiteLoading, setWebsiteLoading] = useState(true);
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [websiteBusyId, setWebsiteBusyId] = useState('');
  const [websiteStatus, setWebsiteStatus] = useState(null);
  const [websiteForm, setWebsiteForm] = useState({ url: '', title: '', summary: '' });
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

  const loadBillingImport = async () => {
    try {
      const { data } = await api.get('/settings/billing/import-summary');
      setBillingImport({
        account_count: Number(data.account_count || 0),
        last_import: data.last_import || null,
      });
    } catch (err) {
      setBillingImportStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load uploaded billing accounts.' });
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

  const loadWebsiteKnowledge = async () => {
    setWebsiteLoading(true);
    try {
      const { data } = await api.get('/website-knowledge');
      setWebsiteItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setWebsiteStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load website knowledge.' });
    } finally {
      setWebsiteLoading(false);
    }
  };

  const loadAgentName = async () => {
    try {
      const { data } = await api.get('/settings');
      const name = String(data.agent_name || '').trim();
      if (name) setAgentName(name);
    } catch (err) {
      setAgentName('Agent');
    }
  };

  useEffect(() => {
    loadAgentName();
    loadBillingImport();
    loadWebsiteKnowledge();
    loadMedia();
  }, []);

  const agentBrainTitle = `${possessiveName(agentName)} Brain`;

  const uploadBillingImport = async () => {
    if (!billingImportFile) {
      setBillingImportStatus({ type: 'error', message: 'Choose a billing CSV or Excel file first.' });
      return;
    }
    setBillingImportUploading(true);
    setBillingImportStatus(null);
    try {
      const dataUrl = await fileToDataUrl(billingImportFile);
      const { data } = await api.post('/settings/billing/import-csv', {
        file_name: billingImportFile.name,
        billing_system: billingImportSystem,
        data_url: dataUrl,
      });
      setBillingImport(data.summary || { account_count: data.imported || 0, last_import: data.batch || null });
      setBillingImportFile(null);
      const input = document.getElementById('knowledge-billing-import-file');
      if (input) input.value = '';
      setBillingImportStatus({ type: 'success', message: `${Number(data.imported || 0).toLocaleString()} billing accounts imported. The agent and invoices can now use them.` });
    } catch (err) {
      setBillingImportStatus({ type: 'error', message: apiErrorMessage(err, 'Failed to import billing CSV.') });
    } finally {
      setBillingImportUploading(false);
    }
  };

  const deleteBillingImport = async () => {
    if (!Number(billingImport.account_count || 0)) {
      setBillingImportStatus({ type: 'error', message: 'There is no imported billing file to delete.' });
      return;
    }
    if (!window.confirm('Delete the imported billing accounts for this dashboard account? The agent will stop using this uploaded file until you upload another one.')) return;
    setBillingImportDeleting(true);
    setBillingImportStatus(null);
    try {
      const { data } = await api.delete('/settings/billing/import-csv');
      setBillingImport(data.summary || { account_count: 0, last_import: null });
      setBillingImportFile(null);
      const input = document.getElementById('knowledge-billing-import-file');
      if (input) input.value = '';
      setBillingImportStatus({ type: 'success', message: `${Number(data.deleted || 0).toLocaleString()} imported billing accounts deleted.` });
    } catch (err) {
      setBillingImportStatus({ type: 'error', message: apiErrorMessage(err, 'Failed to delete imported billing file.') });
    } finally {
      setBillingImportDeleting(false);
    }
  };

  const updateWebsiteForm = (field, value) => {
    setWebsiteForm((current) => ({ ...current, [field]: value }));
    setWebsiteStatus(null);
  };

  const addWebsiteKnowledge = async () => {
    if (!websiteForm.url.trim()) {
      setWebsiteStatus({ type: 'error', message: 'Enter a website link first.' });
      return;
    }
    setWebsiteSaving(true);
    setWebsiteStatus(null);
    try {
      const { data } = await api.post('/website-knowledge', websiteForm);
      setWebsiteItems((current) => [data, ...current]);
      setWebsiteForm({ url: '', title: '', summary: '' });
      setWebsiteStatus({ type: 'success', message: `${agentName} can now use knowledge from ${data.title}.` });
    } catch (err) {
      setWebsiteStatus({ type: 'error', message: apiErrorMessage(err, 'Failed to add website knowledge.') });
    } finally {
      setWebsiteSaving(false);
    }
  };

  const refreshWebsiteKnowledge = async (item) => {
    setWebsiteBusyId(`refresh-${item.id}`);
    setWebsiteStatus(null);
    try {
      const { data } = await api.post(`/website-knowledge/${item.id}/refresh`);
      setWebsiteItems((current) => current.map((row) => (row.id === item.id ? data : row)));
      setWebsiteStatus({ type: 'success', message: `${data.title} refreshed from the website.` });
    } catch (err) {
      setWebsiteStatus({ type: 'error', message: apiErrorMessage(err, 'Failed to refresh website knowledge.') });
    } finally {
      setWebsiteBusyId('');
    }
  };

  const toggleWebsiteKnowledge = async (item) => {
    setWebsiteBusyId(`toggle-${item.id}`);
    try {
      const { data } = await api.patch(`/website-knowledge/${item.id}`, { is_active: !item.is_active });
      setWebsiteItems((current) => current.map((row) => (row.id === item.id ? data : row)));
    } catch (err) {
      setWebsiteStatus({ type: 'error', message: err.response?.data?.error || 'Failed to update website knowledge.' });
    } finally {
      setWebsiteBusyId('');
    }
  };

  const deleteWebsiteKnowledge = async (id) => {
    if (!window.confirm('Delete this website knowledge from the agent brain?')) return;
    setWebsiteBusyId(`delete-${id}`);
    try {
      await api.delete(`/website-knowledge/${id}`);
      setWebsiteItems((current) => current.filter((row) => row.id !== id));
    } catch (err) {
      setWebsiteStatus({ type: 'error', message: err.response?.data?.error || 'Failed to delete website knowledge.' });
    } finally {
      setWebsiteBusyId('');
    }
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

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8ff] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="relative mb-5 overflow-hidden rounded-[24px] border border-[#dfe5f5] bg-white px-7 py-6 shadow-[0_18px_45px_rgba(30,41,59,0.05)]">
          <div className="flex items-center gap-5">
            <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-2xl bg-white text-[#6d2cff] shadow-[0_12px_30px_rgba(87,38,236,0.18)] ring-1 ring-[#e2dcff]">
              <HeaderIcon className="h-8 w-8" />
            </div>
            <div className="relative z-10 min-w-0">
              <h1 className="text-[28px] font-black leading-tight text-[#07103d]">{agentBrainTitle}</h1>
              <p className="mt-2 text-[14px] font-semibold text-[#67739a]">Upload the account data and media {agentName} should use when helping customers.</p>
            </div>
          </div>
          <div className="pointer-events-none absolute right-10 top-0 hidden h-full w-[260px] items-center justify-end lg:flex">
            <div className="absolute right-8 top-8 h-24 w-44 rounded-full border border-[#d9defb] opacity-70" />
            <div className="absolute right-14 top-12 h-2 w-2 rounded-full bg-[#8f4dff]" />
            <div className="absolute right-2 top-20 h-2 w-2 rounded-full bg-[#b9f0ff]" />
            <img src={knowledgeRobot} alt="" className="relative z-10 h-[112px] w-[150px] object-cover object-top mix-blend-multiply" />
          </div>
        </div>

        <div className="grid gap-4">
          <KnowledgeCard
            icon={CreditCardIcon}
            title="Billing Accounts"
            description="Choose the billing system, then upload exported clients so the agent can identify customers, answer package and expiry questions, and generate invoices per account."
          >
            <div className="rounded-[22px] border border-[#dfe5f5] bg-white p-5 shadow-[0_14px_34px_rgba(30,41,59,0.04)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f1eaff] text-[#6c2cff]">
                    <DatabaseIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[15px] font-black text-[#07103d]">Imported account snapshot</div>
                    <p className="mt-1 text-[12px] font-semibold leading-relaxed text-[#7b86aa]">A new upload replaces the previous account snapshot for this dashboard account.</p>
                  </div>
                </div>
                <div className="rounded-full bg-[#f4eaff] px-6 py-2 text-[13px] font-black text-[#7b25ff]">
                  {Number(billingImport.account_count || 0).toLocaleString()} accounts
                </div>
              </div>

              {billingImport.last_import && (
                <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#e3e8f5] bg-white px-4 py-3 text-[12px] font-semibold text-[#647092] shadow-[0_10px_25px_rgba(30,41,59,0.06)] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileIcon className="h-5 w-5 shrink-0 text-[#7a86a8]" />
                    <div className="min-w-0 truncate">
                      Current file: <span className="font-black text-[#07103d]">{billingImport.last_import.file_name}</span>
                    </div>
                  </div>
                  <div className="text-[#6c789d]">
                    ({Number(billingImport.last_import.row_count || 0).toLocaleString()} rows)
                    {billingImport.last_import.imported_at ? ` on ${new Date(billingImport.last_import.imported_at).toLocaleString()}` : ''}
                  </div>
                  <button
                    type="button"
                    onClick={deleteBillingImport}
                    disabled={billingImportDeleting || billingImportUploading}
                    className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-lg border border-red-200 bg-red-50 px-5 text-[13px] font-black text-red-600 hover:bg-red-100 disabled:opacity-50 sm:self-auto"
                  >
                    <TrashIcon className="h-4 w-4" />
                    {billingImportDeleting ? 'Deleting...' : 'Delete file'}
                  </button>
                </div>
              )}

              <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr_auto] lg:items-end">
                <label className="text-[12px] font-black text-[#667198]">
                  Billing system
                  <select
                    value={billingImportSystem}
                    onChange={(event) => {
                      setBillingImportSystem(event.target.value);
                      setBillingImportStatus(null);
                    }}
                    className="mt-2 block h-12 w-full rounded-xl border border-[#dfe5f5] bg-white px-4 text-[14px] font-semibold normal-case text-[#101942] outline-none focus:border-[#7b25ff]"
                  >
                    {BILLING_IMPORT_SYSTEMS.map((system) => <option key={system.value} value={system.value}>{system.label}</option>)}
                  </select>
                </label>
                <label className="text-[12px] font-black text-[#667198]">
                  CSV or Excel file
                  <div className="mt-2 flex h-12 items-center rounded-xl border border-[#dfe5f5] bg-white px-2">
                    <input
                      id="knowledge-billing-import-file"
                      type="file"
                      accept=".csv,text/csv,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                      onChange={(event) => {
                        setBillingImportFile(event.target.files?.[0] || null);
                        setBillingImportStatus(null);
                      }}
                      className="sr-only"
                    />
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() => document.getElementById('knowledge-billing-import-file')?.click()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') document.getElementById('knowledge-billing-import-file')?.click();
                      }}
                      className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#dfe5f5] bg-[#f8faff] px-4 text-[13px] font-black text-[#4c5b84]"
                    >
                      <ShareIosIcon className="h-4 w-4" />
                      Choose File
                    </span>
                    <span className="min-w-0 truncate px-3 text-[13px] font-semibold text-[#6c789d]">
                      {billingImportFile?.name || 'No file chosen'}
                    </span>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={uploadBillingImport}
                  disabled={billingImportUploading || !billingImportFile}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#6d2cff] px-7 text-[14px] font-black text-white shadow-[0_12px_25px_rgba(109,44,255,0.28)] hover:bg-[#5421df] disabled:opacity-50"
                >
                  <ShareIosIcon className="h-4 w-4" />
                  {billingImportUploading ? 'Importing...' : billingImport.last_import ? 'Update File' : 'Upload Accounts'}
                </button>
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-xl bg-[#f7faff] px-4 py-3 text-[12px] font-semibold leading-relaxed text-[#7280a5]">
                <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#6d9dff]" />
                <span>
                  {BILLING_IMPORT_SYSTEMS.find((system) => system.value === billingImportSystem)?.helper}
                  {billingImport.last_import ? ' Updating uploads replaces the current imported file for this account.' : ''}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-[11px] font-semibold text-[#7d88a9] sm:grid-cols-2">
                <div>Captures ID, full name, username, account number and password.</div>
                <div>Captures phone, email, address, service, router, profile, package, price, expiry and status.</div>
              </div>
            </div>

            {billingImportStatus && (
              <div className={`mt-3 rounded-xl border px-4 py-3 text-sm font-semibold ${billingImportStatus.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                {billingImportStatus.message}
              </div>
            )}
          </KnowledgeCard>

          <KnowledgeCard
            icon={GlobeIcon}
            title="Website Knowledge"
            description={`Give ${agentName} a public website link to read and use when answering customer questions about packages, policies, coverage, setup guides or company information.`}
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Website link
                    <input value={websiteForm.url} onChange={(event) => updateWebsiteForm('url', event.target.value)} placeholder="https://example.com/packages" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Display title
                    <input value={websiteForm.title} onChange={(event) => updateWebsiteForm('title', event.target.value)} placeholder="Packages page" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Admin note
                  <textarea rows={2} value={websiteForm.summary} onChange={(event) => updateWebsiteForm('summary', event.target.value)} placeholder="Tell the agent what this website is useful for, e.g. package prices, router setup, coverage areas." className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-semibold leading-5 text-slate-500">
                    Nexa will visit the page once, extract readable text, and save it in this account's knowledge base.
                  </p>
                  <button type="button" onClick={addWebsiteKnowledge} disabled={websiteSaving} className="rounded-xl bg-[#3535FF] px-4 py-2.5 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50">
                    {websiteSaving ? 'Surfing...' : 'Add Website'}
                  </button>
                </div>
              </div>

              {websiteStatus && (
                <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${websiteStatus.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                  {websiteStatus.message}
                </div>
              )}

              {websiteLoading ? (
                <div className="text-sm font-semibold text-slate-400">Loading websites...</div>
              ) : websiteItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-400">No website knowledge added yet.</div>
              ) : (
                <div className="space-y-3">
                  {websiteItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-black text-slate-950">{item.title}</h3>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{item.is_active ? 'Active' : 'Paused'}</span>
                          </div>
                          <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs font-bold text-[#3535FF]">{item.url}</a>
                          {item.summary && <p className="mt-2 text-sm font-semibold text-slate-600">{item.summary}</p>}
                          <p className="mt-2 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">{item.content_preview}</p>
                          <p className="mt-2 text-[11px] font-semibold text-slate-400">{item.fetched_at ? `Last surfed: ${new Date(item.fetched_at).toLocaleString()}` : ''}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => refreshWebsiteKnowledge(item)} disabled={websiteBusyId === `refresh-${item.id}`} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50">{websiteBusyId === `refresh-${item.id}` ? 'Refreshing...' : 'Refresh'}</button>
                          <button type="button" onClick={() => toggleWebsiteKnowledge(item)} disabled={websiteBusyId === `toggle-${item.id}`} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50">{item.is_active ? 'Pause' : 'Activate'}</button>
                          <button type="button" onClick={() => deleteWebsiteKnowledge(item.id)} disabled={websiteBusyId === `delete-${item.id}`} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600 disabled:opacity-50">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </KnowledgeCard>

          <KnowledgeCard
            icon={PulseIcon}
            title="Agent Media Library"
            description="Upload images or PDFs the agent can share in welcome messages or when customers ask for visual explanations."
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Title
                    <input value={mediaForm.title} onChange={(event) => updateMediaForm('title', event.target.value)} placeholder="Hotspot sample design" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                    Media tag
                    <input value={mediaForm.tag} onChange={(event) => updateMediaForm('tag', event.target.value)} placeholder="image1" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Trigger keywords
                  <input value={mediaForm.trigger_keywords} onChange={(event) => updateMediaForm('trigger_keywords', event.target.value)} placeholder="hotspot sample, landing page, poster" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                </label>
                <label className="mt-3 flex flex-col gap-1 text-xs font-black uppercase text-slate-400">
                  Caption / explanation
                  <textarea rows={2} value={mediaForm.description} onChange={(event) => updateMediaForm('description', event.target.value)} placeholder="Short caption the customer will see with this media." className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-[#3535FF]" />
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex-1 text-xs font-black uppercase text-slate-400">
                    File
                    <input id="agent-media-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => updateMediaForm('file', event.target.files?.[0] || null)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-slate-700" />
                  </label>
                  <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={mediaForm.attach_on_welcome} onChange={(event) => updateMediaForm('attach_on_welcome', event.target.checked)} className="h-4 w-4 accent-[#3535FF]" />
                    Send with welcome
                  </label>
                  <button type="button" onClick={uploadMedia} disabled={mediaSaving} className="rounded-xl bg-[#3535FF] px-4 py-2.5 text-sm font-black text-white hover:bg-[#2828DD] disabled:opacity-50">
                    {mediaSaving ? 'Uploading...' : 'Upload media'}
                  </button>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  Use tags like <span className="font-black text-[#3535FF]">{'{image1}'}</span> in Agent Configuration. Keywords still trigger media automatically.
                </p>
              </div>

              {mediaStatus && (
                <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${mediaStatus.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                  {mediaStatus.message}
                </div>
              )}

              {mediaLoading ? (
                <div className="text-sm font-semibold text-slate-400">Loading media...</div>
              ) : mediaItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-400">No media uploaded yet.</div>
              ) : (
                <div className="space-y-3">
                  {mediaItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-black text-slate-950">{item.title}</h3>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-500">{item.media_type}</span>
                            {item.tag && <button type="button" onClick={() => copyMediaTag(item.tag)} className="rounded-full bg-[#f3f2ff] px-2 py-0.5 text-[10px] font-black text-[#3535FF] transition hover:bg-[#e8e4ff]">{`{${item.tag}}`}</button>}
                            {!item.is_active && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Paused</span>}
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{item.filename}</p>
                          {item.description && <p className="mt-2 text-sm text-slate-600">{item.description}</p>}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(item.trigger_keywords || []).map((keyword) => <span key={keyword} className="rounded-full bg-[#f3f2ff] px-2 py-1 text-[10px] font-black text-[#3535FF]">{keyword}</span>)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => toggleMedia(item, 'attach_on_welcome')} className={`rounded-xl px-3 py-2 text-xs font-black ${item.attach_on_welcome ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{item.attach_on_welcome ? 'Welcome on' : 'Welcome off'}</button>
                          <button type="button" onClick={() => toggleMedia(item, 'is_active')} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">{item.is_active ? 'Pause' : 'Activate'}</button>
                          <button type="button" onClick={() => deleteMedia(item.id)} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </KnowledgeCard>
        </div>
      </div>
    </div>
  );
}
