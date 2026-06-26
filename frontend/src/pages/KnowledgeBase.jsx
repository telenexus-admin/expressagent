import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { AgentIcon, CreditCardIcon, PulseIcon } from '../components/Icons';

function KnowledgeCard({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
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

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read file'));
  reader.readAsDataURL(file);
});

export default function KnowledgeBase() {
  const [billingImport, setBillingImport] = useState({ account_count: 0, last_import: null });
  const [billingImportFile, setBillingImportFile] = useState(null);
  const [billingImportUploading, setBillingImportUploading] = useState(false);
  const [billingImportStatus, setBillingImportStatus] = useState(null);
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

  useEffect(() => {
    loadBillingImport();
    loadMedia();
  }, []);

  const uploadBillingImport = async () => {
    if (!billingImportFile) {
      setBillingImportStatus({ type: 'error', message: 'Choose a billing CSV file first.' });
      return;
    }
    setBillingImportUploading(true);
    setBillingImportStatus(null);
    try {
      const dataUrl = await fileToDataUrl(billingImportFile);
      const { data } = await api.post('/settings/billing/import-csv', {
        file_name: billingImportFile.name,
        data_url: dataUrl,
      });
      setBillingImport(data.summary || { account_count: data.imported || 0, last_import: data.batch || null });
      setBillingImportFile(null);
      const input = document.getElementById('knowledge-billing-import-file');
      if (input) input.value = '';
      setBillingImportStatus({ type: 'success', message: `${Number(data.imported || 0).toLocaleString()} billing accounts imported. The agent and invoices can now use them.` });
    } catch (err) {
      setBillingImportStatus({ type: 'error', message: err.response?.data?.error || 'Failed to import billing CSV.' });
    } finally {
      setBillingImportUploading(false);
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
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#dedbff] bg-white text-[#4f35f5] shadow-sm">
            <AgentIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-950">Knowledge Base</h1>
            <p className="mt-1 text-sm text-slate-500">Upload the account data and media the AI agent should use when helping customers.</p>
          </div>
        </div>

        <div className="grid gap-4">
          <KnowledgeCard
            icon={CreditCardIcon}
            title="Billing CSV Accounts"
            description="Upload exported billing clients so the agent can identify customers, answer package and expiry questions, and generate invoices per account."
          >
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-950">Imported account snapshot</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">A new upload replaces the previous account snapshot for this dashboard account.</p>
                </div>
                <div className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-600 shadow-sm">
                  {Number(billingImport.account_count || 0).toLocaleString()} accounts
                </div>
              </div>

              {billingImport.last_import && (
                <div className="mt-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                  Last import: <span className="text-slate-800">{billingImport.last_import.file_name}</span>
                  {' '}({Number(billingImport.last_import.row_count || 0).toLocaleString()} rows)
                  {billingImport.last_import.imported_at ? ` on ${new Date(billingImport.last_import.imported_at).toLocaleString()}` : ''}
                </div>
              )}

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-xs font-black uppercase text-slate-400">
                  CSV file
                  <input
                    id="knowledge-billing-import-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      setBillingImportFile(event.target.files?.[0] || null);
                      setBillingImportStatus(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-slate-700"
                  />
                </label>
                <button
                  type="button"
                  onClick={uploadBillingImport}
                  disabled={billingImportUploading || !billingImportFile}
                  className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {billingImportUploading ? 'Importing...' : 'Upload CSV'}
                </button>
              </div>

              <div className="mt-3 grid gap-2 text-[11px] font-semibold text-slate-500 sm:grid-cols-2">
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
