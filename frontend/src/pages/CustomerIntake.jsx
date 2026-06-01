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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await api.get(`/public/customer-intake/${clientId}`);
        if (!cancelled) setClient(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'This form is not available.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const businessName = client?.business_name || 'your provider';
  const fileLabel = useMemo(() => {
    if (!form.identity_file) return 'No ID file selected';
    return `${form.identity_file.name} (${Math.ceil(form.identity_file.size / 1024)} KB)`;
  }, [form.identity_file]);

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
    if (!form.identity_file) {
      setError('Please upload a clear ID scan, photo or PDF.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const identityData = await readFileAsDataUrl(form.identity_file);
      const { data } = await api.post(`/public/customer-intake/${clientId}`, {
        ...form,
        identity_file: undefined,
        identity_data: identityData,
        identity_mime_type: form.identity_file.type,
        identity_filename: form.identity_file.name,
      });
      setSuccess(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit details. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-6 text-sm font-bold text-slate-400">
        Loading secure form...
      </div>
    );
  }

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
              <div className="mb-5 inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-black text-white/75">
                Secure customer intake
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{businessName} installation form</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                Share your identity, contact and location details so the installation team can prepare before calling you.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/10 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-white/50">What you need</div>
              <div className="mt-3 space-y-2 text-sm font-bold text-white/85">
                <div>National ID photo or PDF</div>
                <div>Exact estate, building and landmark</div>
                <div>Phone number for scheduling</div>
              </div>
            </div>
          </div>
        </header>

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
                <Field label="Alternative phone">
                  <input type="tel" value={form.alternate_phone} onChange={(event) => update('alternate_phone', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="Email">
                  <input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
              </div>
            </Section>

            <Section number="2" title="ID Verification" description="Upload a clear scan, photo or PDF of the ID used for registration.">
              <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
                <Field label="ID number">
                  <input value={form.id_number} onChange={(event) => update('id_number', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="ID scan / photo" helper={fileLabel}>
                  <input
                    required
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    capture="environment"
                    onChange={(event) => update('identity_file', event.target.files?.[0] || null)}
                    className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 file:mr-3 file:rounded-xl file:border-0 file:bg-[#3535FF] file:px-3 file:py-2 file:text-xs file:font-black file:text-white"
                  />
                </Field>
              </div>
            </Section>

            <Section number="3" title="Service And Location" description="Give the team enough detail to find the premises without calling repeatedly.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Service type">
                  <select value={form.service_type} onChange={(event) => update('service_type', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                    {serviceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Preferred package">
                  <select value={form.plan_interest} onChange={(event) => update('plan_interest', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                    <option value="">Choose package</option>
                    {plans.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                  </select>
                </Field>
                <Field label="County / town">
                  <input value={form.county} onChange={(event) => update('county', event.target.value)} placeholder="e.g. Nairobi" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="Estate / area">
                  <input required value={form.area} onChange={(event) => update('area', event.target.value)} placeholder="e.g. Githurai 45" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
                <Field label="Building type">
                  <select value={form.building_type} onChange={(event) => update('building_type', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF]">
                    {buildingTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Nearest landmark">
                  <input value={form.landmark} onChange={(event) => update('landmark', event.target.value)} placeholder="School, stage, shop, church..." className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
                </Field>
              </div>
              <Field label="House / building description" helper="Example: Blue gate, 3rd floor, door B12, near the water tank.">
                <textarea rows={3} value={form.house_description} onChange={(event) => update('house_description', event.target.value)} className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
              </Field>
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
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
              </div>
            </Section>

            <Section number="4" title="Scheduling Notes" description="Tell the team when you prefer to be contacted or visited.">
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
              <Field label="Extra notes">
                <textarea rows={4} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Gate contact, access notes, router location, special requests..." className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800 outline-none focus:border-[#3535FF] focus:bg-white" />
              </Field>
            </Section>
          </main>

          <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
            <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">Before submitting</h2>
              <div className="mt-4 space-y-3 text-sm font-semibold leading-6 text-slate-600">
                <p>The ID scan is stored securely for installation verification.</p>
                <p>The location details are used only by the installation team.</p>
                <p>The team may call you before visiting.</p>
              </div>
            </div>
            <label className="flex gap-3 rounded-[24px] border border-slate-100 bg-white p-4 text-sm font-semibold leading-6 text-slate-600 shadow-sm">
              <input type="checkbox" checked={form.consent_accepted} onChange={(event) => update('consent_accepted', event.target.checked)} className="mt-1 h-4 w-4 accent-[#3535FF]" />
              <span>I confirm the details are correct and consent to {businessName} using them for installation verification and scheduling.</span>
            </label>
            <button type="submit" disabled={submitting || !form.consent_accepted} className="w-full rounded-[22px] bg-[#3535FF] px-6 py-4 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-[#2828DD] disabled:opacity-50">
              {submitting ? 'Submitting details...' : 'Submit installation details'}
            </button>
          </aside>
        </div>
      </form>
    </div>
  );
}
