import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

const INITIAL_FORM = {
  customer_name: '',
  customer_phone: '',
  alternate_phone: '',
  email: '',
  id_number: '',
  plan_interest: '',
  service_type: 'home',
  county: '',
  area: '',
  landmark: '',
  building_type: 'apartment',
  house_description: '',
  latitude: '',
  longitude: '',
  preferred_date: '',
  preferred_time: '',
  notes: '',
  identity_file: null,
  special_package_type: '',
  institution_name: '',
  student_number: '',
  expected_graduation_year: '',
  disability_support_category: '',
  special_document_file: null,
  special_verification_consent: false,
  consent_accepted: false,
};

const plans = ['10 Mbps', '15 Mbps', '20 Mbps', '30 Mbps', '40 Mbps', '50 Mbps', 'Not sure yet'];
const serviceTypes = [
  ['home', 'Home internet'],
  ['business', 'Business internet'],
  ['apartment', 'Apartment / rental unit'],
  ['hotspot', 'Hotspot setup'],
];
const buildingTypes = [
  ['apartment', 'Apartment'],
  ['standalone', 'Standalone house'],
  ['shop', 'Shop / office'],
  ['estate', 'Estate / gated community'],
  ['other', 'Other'],
];
const DEFAULT_INSTALLATION_FORM = {
  enabled: true,
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

function Field({ label, children, helper }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {helper && <span className="mt-1.5 block text-xs font-semibold leading-5 text-slate-400">{helper}</span>}
    </label>
  );
}

function Section({ number, title, description, children }) {
  return (
    <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#edeaff] text-sm font-black text-[#3535FF]">
          {number}
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const MAX_DIRECT_UPLOAD_BYTES = 650 * 1024;
const MAX_PDF_BYTES = 650 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not open image'));
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

async function compressImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.78, 0.68, 0.58, 0.48]) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= MAX_DIRECT_UPLOAD_BYTES) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    }
    const fallbackBlob = await canvasToBlob(canvas, 0.42);
    return fallbackBlob ? new File([fallbackBlob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareIdentityFile(file) {
  const type = String(file.type || '').toLowerCase();
  if (type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error('PDF is too large. Please upload a smaller PDF under 650 KB, or take a clear photo instead.');
    }
    return file;
  }
  if (type === 'image/heic' || type === 'image/heif') {
    if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
      throw new Error('This phone saved the ID as a large HEIC image. Please retake it as JPG, screenshot it, or upload a smaller image.');
    }
    return file;
  }
  if (type.startsWith('image/')) {
    return file.size > MAX_DIRECT_UPLOAD_BYTES ? compressImageFile(file) : file;
  }
  throw new Error('ID file must be JPG, PNG, WEBP, HEIC or PDF.');
}

function responseErrorMessage(err) {
  const data = err.response?.data;
  if (data?.error) return data.error;
  if (typeof data === 'string') {
    if (/payload too large|request entity too large/i.test(data)) {
      return 'The ID file is too large for the server. Please upload a smaller image.';
    }
    return data.slice(0, 160);
  }
  if (err.message) return err.message;
  return 'Failed to submit details. Please try again.';
}

export default function CustomerIntake() {
  const { clientId } = useParams();
  const [searchParams] = useSearchParams();
  const [client, setClient] = useState(null);
  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    customer_name: searchParams.get('name') || '',
    customer_phone: searchParams.get('phone') || '',
  }));
  const [clientLoading, setClientLoading] = useState(true);
  const [formConfig, setFormConfig] = useState(DEFAULT_INSTALLATION_FORM);
  const [loadNotice, setLoadNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    async function load() {
      try {
        const { data } = await api.get(`/public/customer-intake/${clientId}`, { signal: controller.signal });
        if (!cancelled) {
          setClient(data);
          setFormConfig({ ...DEFAULT_INSTALLATION_FORM, ...(data.installation_form || {}) });
        }
      } catch (err) {
        if (!cancelled && err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') {
          setLoadNotice(err.response?.data?.error || 'Provider details are still loading. You can continue filling the form.');
        } else if (!cancelled) {
          setLoadNotice('Provider details are still loading. You can continue filling the form.');
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setClientLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [clientId]);

  const businessName = client?.business_name || 'your provider';
  const fileLabel = useMemo(() => {
    if (!form.identity_file) return 'No ID file selected';
    return `${form.identity_file.name} (${Math.ceil(form.identity_file.size / 1024)} KB)`;
  }, [form.identity_file]);
  const specialFileLabel = useMemo(() => {
    if (!form.special_document_file) return 'No verification document selected';
    return `${form.special_document_file.name} (${Math.ceil(form.special_document_file.size / 1024)} KB)`;
  }, [form.special_document_file]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setError('Your browser cannot share GPS location. Please type the location and landmark.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        update('latitude', String(position.coords.latitude));
        update('longitude', String(position.coords.longitude));
        setLocating(false);
      },
      () => {
        setError('Could not capture GPS location. Please type the location and landmark.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const submit = async (event) => {
    event.preventDefault();
    if (formConfig.show_id && formConfig.require_id && !form.identity_file) {
      setError('Please upload a clear ID scan, photo or PDF.');
      return;
    }
    if (form.special_package_type && !form.special_document_file) {
      setError('Please upload the verification document for the special package application.');
      return;
    }
    if (form.special_package_type && !form.special_verification_consent) {
      setError('Please accept the special-package verification consent.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const preparedFile = formConfig.show_id && form.identity_file ? await prepareIdentityFile(form.identity_file) : null;
      const identityData = preparedFile ? await readFileAsDataUrl(preparedFile) : '';
      const specialFile = form.special_document_file ? await prepareIdentityFile(form.special_document_file) : null;
      const specialDocumentData = specialFile ? await readFileAsDataUrl(specialFile) : '';
      const { data } = await api.post(`/public/customer-intake/${clientId}`, {
        ...form,
        identity_file: undefined,
        special_document_file: undefined,
        identity_data: identityData,
        identity_mime_type: preparedFile?.type || '',
        identity_filename: preparedFile?.name || '',
        special_document_data: specialDocumentData,
        special_document_mime_type: specialFile?.type || '',
        special_document_filename: specialFile?.name || '',
      });
      setSuccess(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(responseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#f8fafc] px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-xl rounded-[32px] border border-emerald-100 bg-white p-7 text-center shadow-xl shadow-emerald-100/60">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-2xl font-black text-emerald-600">OK</div>
          <h1 className="mt-5 text-2xl font-black text-slate-950">Details received</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {success.message || 'Our team will review your installation details and contact you shortly.'}
          </p>
          <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
            Reference #{success.id}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-5 sm:px-6 sm:py-8">
      <form onSubmit={submit} className="mx-auto max-w-5xl">
        <header className="mb-5 overflow-hidden rounded-[32px] bg-[#0A0A0F] text-white shadow-xl">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_320px] lg:items-end">
            <div>
              <div className="mb-5 inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-black text-white/75" style={{ color: formConfig.accent_color }}>
                {clientLoading ? 'Opening secure form...' : 'Secure customer intake'}
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{businessName} {formConfig.title || 'installation form'}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                {formConfig.intro || DEFAULT_INSTALLATION_FORM.intro}
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/10 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-white/50">What you need</div>
              <div className="mt-3 space-y-2 text-sm font-bold text-white/85">
                {formConfig.show_id && <div>{formConfig.require_id ? 'National ID photo or PDF' : 'ID photo or PDF if available'}</div>}
                <div>Exact estate, building and landmark</div>
                <div>Phone number for scheduling</div>
              </div>
            </div>
          </div>
        </header>

        {loadNotice && (
          <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            {loadNotice}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <main className="space-y-5">
            <Section number="1" title="Personal Details" description="Use the same details the team should use when scheduling installation.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name">
                  <input required value={form.customer_name} onChange={(event) => update('customer_name', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="Main phone">
                  <input required type="tel" value={form.customer_phone} onChange={(event) => update('customer_phone', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                {formConfig.show_alternate_phone && (
                  <Field label="Alternative phone">
                    <input type="tel" value={form.alternate_phone} onChange={(event) => update('alternate_phone', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                  </Field>
                )}
                {formConfig.show_email && (
                  <Field label="Email">
                    <input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                  </Field>
                )}
              </div>
            </Section>

            {formConfig.show_id && <Section number="2" title="ID Verification" description={formConfig.require_id ? 'Upload a clear scan, photo or PDF of the ID used for registration.' : 'Upload an ID if the provider requested it.'}>
              <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
                <Field label="ID number">
                  <input value={form.id_number} onChange={(event) => update('id_number', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="ID scan / photo" helper={fileLabel}>
                  <input
                    required={formConfig.require_id}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                    capture="environment"
                    onChange={(event) => update('identity_file', event.target.files?.[0] || null)}
                    className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 file:mr-3 file:rounded-xl file:border-0 file:bg-[#3535FF] file:px-3 file:py-2 file:text-xs file:font-black file:text-white"
                  />
                </Field>
              </div>
            </Section>}

            <Section number={formConfig.show_id ? '3' : '2'} title="Special Package Application" description="Students and persons with disabilities can request a supported package. Applications are reviewed privately before approval.">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['', 'Standard package', 'Continue without special-package verification.'],
                  ['student', 'Student package', 'For currently enrolled students.'],
                  ['disability', 'Disability support', 'For applicants requesting an accessibility-supported package.'],
                ].map(([value, label, helper]) => (
                  <button key={label} type="button" onClick={() => update('special_package_type', value)} className={`rounded-2xl border p-4 text-left transition ${form.special_package_type === value ? 'border-[#3535FF] bg-[#f3f2ff]' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="text-sm font-black text-slate-900">{label}</div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">{helper}</div>
                  </button>
                ))}
              </div>
              {form.special_package_type && (
                <div className="mt-5 space-y-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {['Submit current evidence', 'Private human review', 'Approval before activation'].map((step, index) => (
                      <div key={step} className="rounded-xl bg-white p-3 text-xs font-bold text-blue-800">
                        <span className="mr-2 text-[#3535FF]">{index + 1}.</span>{step}
                      </div>
                    ))}
                  </div>
                  {form.special_package_type === 'student' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Institution name"><input required value={form.institution_name} onChange={(e) => update('institution_name', e.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-[#3535FF]" /></Field>
                      <Field label="Student / admission number"><input required value={form.student_number} onChange={(e) => update('student_number', e.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-[#3535FF]" /></Field>
                      <Field label="Expected graduation year"><input inputMode="numeric" value={form.expected_graduation_year} onChange={(e) => update('expected_graduation_year', e.target.value)} placeholder="e.g. 2028" className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-[#3535FF]" /></Field>
                    </div>
                  ) : (
                    <Field label="Accessibility support category" helper="Choose the broad category only. Do not disclose a diagnosis.">
                      <select required value={form.disability_support_category} onChange={(e) => update('disability_support_category', e.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-[#3535FF]">
                        <option value="">Choose category</option>
                        <option value="mobility">Mobility support</option>
                        <option value="visual">Visual accessibility support</option>
                        <option value="hearing">Hearing accessibility support</option>
                        <option value="cognitive_or_learning">Cognitive or learning support</option>
                        <option value="other">Other accessibility support</option>
                      </select>
                    </Field>
                  )}
                  <Field label={form.special_package_type === 'student' ? 'Current student ID or enrollment letter' : 'Accepted verification document'} helper={specialFileLabel}>
                    <input required type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" capture="environment" onChange={(e) => update('special_document_file', e.target.files?.[0] || null)} className="block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold file:mr-3 file:rounded-xl file:border-0 file:bg-[#3535FF] file:px-3 file:py-2 file:text-xs file:font-black file:text-white" />
                  </Field>
                  <label className="flex gap-3 rounded-2xl bg-white p-4 text-xs font-semibold leading-5 text-slate-600">
                    <input type="checkbox" checked={form.special_verification_consent} onChange={(e) => update('special_verification_consent', e.target.checked)} className="mt-1 h-4 w-4 accent-[#3535FF]" />
                    <span>I consent to the provider reviewing this evidence only to determine special-package eligibility. I understand approval is not automatic.</span>
                  </label>
                </div>
              )}
            </Section>

            <Section number={formConfig.show_id ? '4' : '3'} title="Service And Location" description="Give the team enough detail to find the premises without calling repeatedly.">
              <div className="grid gap-4 sm:grid-cols-2">
                {formConfig.show_service_type && (
                  <Field label="Service type">
                    <select value={form.service_type} onChange={(event) => update('service_type', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                      {serviceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                )}
                {formConfig.show_plan && (
                  <Field label="Preferred package">
                    <select value={form.plan_interest} onChange={(event) => update('plan_interest', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                      <option value="">Choose package</option>
                      {plans.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                    </select>
                  </Field>
                )}
                {formConfig.show_county && (
                  <Field label="County / town">
                    <input value={form.county} onChange={(event) => update('county', event.target.value)} placeholder="e.g. Nairobi" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                  </Field>
                )}
                <Field label="Estate / area">
                  <input required value={form.area} onChange={(event) => update('area', event.target.value)} placeholder="e.g. Githurai 45" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="Building type">
                  <select value={form.building_type} onChange={(event) => update('building_type', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                    {buildingTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                {formConfig.show_landmark && (
                  <Field label="Nearest landmark">
                    <input value={form.landmark} onChange={(event) => update('landmark', event.target.value)} placeholder="School, stage, shop, church..." className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                  </Field>
                )}
              </div>
              {formConfig.show_house_description && (
                <Field label="House / building description" helper="Example: Blue gate, 3rd floor, door B12, near the water tank.">
                  <textarea rows={3} value={form.house_description} onChange={(event) => update('house_description', event.target.value)} className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
              )}
              {formConfig.show_gps && <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-blue-950">GPS pin</div>
                    <div className="mt-1 text-xs font-semibold text-blue-700">
                      {form.latitude && form.longitude ? `${form.latitude}, ${form.longitude}` : 'Optional, but helps the team locate you faster.'}
                    </div>
                  </div>
                  <button type="button" onClick={captureLocation} disabled={locating} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                    {locating ? 'Capturing...' : 'Use my location'}
                  </button>
                </div>
              </div>}
            </Section>

            {(formConfig.show_schedule || formConfig.show_notes) && <Section number={formConfig.show_id ? '5' : '4'} title="Scheduling Notes" description="Tell the team when you prefer to be contacted or visited.">
              {formConfig.show_schedule && <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Preferred date">
                  <input type="date" value={form.preferred_date} onChange={(event) => update('preferred_date', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]" />
                </Field>
                <Field label="Preferred time">
                  <select value={form.preferred_time} onChange={(event) => update('preferred_time', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                    <option value="">Any time</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                </Field>
              </div>}
              {formConfig.show_notes && (
                <Field label="Extra notes">
                  <textarea rows={4} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Gate contact, access notes, router location, special requests..." className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
              )}
            </Section>}
          </main>

          <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
            <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">Before submitting</h2>
              <div className="mt-4 space-y-3 text-sm font-semibold leading-6 text-slate-600">
                {formConfig.show_id && <p>The ID scan is stored securely for installation verification.</p>}
                <p>The location details are used only by the installation team.</p>
                <p>The team may call you before visiting.</p>
              </div>
            </div>
            <label className="flex gap-3 rounded-[24px] border border-slate-100 bg-white p-4 text-sm font-semibold leading-6 text-slate-600 shadow-sm">
              <input type="checkbox" checked={form.consent_accepted} onChange={(event) => update('consent_accepted', event.target.checked)} className="mt-1 h-4 w-4 accent-[#3535FF]" />
              <span>I confirm the details are correct and consent to {businessName} using them for installation scheduling.</span>
            </label>
            <button type="submit" disabled={submitting || !form.consent_accepted} style={{ backgroundColor: formConfig.accent_color }} className="w-full rounded-[22px] px-6 py-4 text-sm font-black text-white shadow-lg shadow-blue-200 transition disabled:opacity-50">
              {submitting ? 'Submitting details...' : 'Submit installation details'}
            </button>
          </aside>
        </div>
      </form>
    </div>
  );
}
