import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

const emptyForm = {
  customer_name: '',
  customer_phone: '',
  alternate_phone: '',
  email: '',
  account_number: '',
  current_location: '',
  new_location: '',
  new_landmark: '',
  house_description: '',
  latitude: '',
  longitude: '',
  preferred_date: '',
  preferred_time: '',
  router_available: true,
  router_condition: 'good',
  router_power_adapter: true,
  ont_available: true,
  cable_available: false,
  reason: '',
  notes: '',
  photo_data: '',
  photo_mime_type: '',
  photo_filename: '',
  consent_accepted: false,
};

function Field({ label, value, onChange, placeholder = '', textarea = false, type = 'text' }) {
  const common = {
    value: value ?? '',
    onChange: (event) => onChange(event.target.value),
    placeholder,
    className: 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-[#3535FF] focus:ring-4 focus:ring-blue-100',
  };
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</span>
      {textarea ? <textarea rows={3} {...common} /> : <input type={type} {...common} />}
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition ${checked ? 'border-[#3535FF] bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'}`}>
      <span className="text-sm font-black">{label}</span>
      <span className={`h-5 w-5 rounded-full border-4 ${checked ? 'border-[#3535FF] bg-white' : 'border-slate-300 bg-white'}`} />
    </button>
  );
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return reject(new Error('Use a JPG, PNG or WEBP photo.'));
    if (file.size > 6 * 1024 * 1024) return reject(new Error('Photo must be 6 MB or smaller.'));
    const reader = new FileReader();
    reader.onload = () => resolve({ data: reader.result, mime: file.type, name: file.name });
    reader.onerror = () => reject(new Error('Could not read photo.'));
    reader.readAsDataURL(file);
  });
}

export default function RelocationRequest() {
  const { clientId } = useParams();
  const [searchParams] = useSearchParams();
  const [client, setClient] = useState(null);
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    customer_name: searchParams.get('name') || '',
    customer_phone: searchParams.get('phone') || '',
  }));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [locating, setLocating] = useState(false);

  const businessName = client?.business_name || 'your ISP';
  const canSubmit = useMemo(() => form.customer_name.trim() && form.customer_phone.trim() && form.new_location.trim() && form.consent_accepted, [form]);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const { data } = await api.get(`/public/relocation-request/${clientId}`);
        if (!stopped) setClient(data);
      } catch (err) {
        if (!stopped) setError(err.response?.data?.error || 'Relocation form is not available.');
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    load();
    return () => { stopped = true; };
  }, [clientId]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      setError('GPS is not available on this device. You can still type the full location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        update('latitude', String(pos.coords.latitude));
        update('longitude', String(pos.coords.longitude));
        setLocating(false);
      },
      () => {
        setError('Could not capture GPS. Please type the location and nearest landmark.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function handlePhoto(event) {
    setError('');
    try {
      const photo = await readImage(event.target.files?.[0]);
      if (!photo) return;
      setForm((current) => ({
        ...current,
        photo_data: photo.data,
        photo_mime_type: photo.mime,
        photo_filename: photo.name,
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) {
      setError('Name, phone, new location and consent are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { data } = await api.post(`/public/relocation-request/${clientId}`, form);
      setSuccess(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit relocation request.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#f6f8ff] text-sm font-black text-slate-500">Opening relocation form...</div>;

  if (success) {
    return (
      <div className="min-h-screen bg-[#eef3ff] px-4 py-8">
        <div className="mx-auto max-w-2xl rounded-[34px] bg-white p-8 text-center shadow-[0_24px_80px_rgba(31,41,55,0.14)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-3xl text-emerald-600">✓</div>
          <h1 className="mt-5 text-3xl font-black text-slate-950">Relocation request received</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">{success.message}</p>
          <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">Reference #{success.id}. You can now return to WhatsApp.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef3ff] px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="overflow-hidden rounded-[36px] bg-slate-950 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_320px] lg:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-200">Network relocation</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">{businessName} transfer request</h1>
              <p className="mt-4 max-w-2xl text-sm font-semibold leading-7 text-white/70">
                Tell us where you are moving to, when you prefer the technician to visit, and whether the router/ONT equipment is still available.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-white/8 p-5">
              <p className="text-sm font-black">What happens next?</p>
              <div className="mt-4 space-y-3 text-sm font-semibold text-white/70">
                <p>1. We review the new location.</p>
                <p>2. The field team confirms equipment condition.</p>
                <p>3. A technician schedules the transfer visit.</p>
              </div>
            </div>
          </div>
        </header>

        {error && <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        <form onSubmit={submit} className="mt-5 space-y-5 rounded-[34px] bg-white p-5 shadow-[0_22px_70px_rgba(31,41,55,0.12)] sm:p-7">
          <section>
            <h2 className="text-xl font-black text-slate-950">Customer details</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Full name" value={form.customer_name} onChange={(value) => update('customer_name', value)} placeholder="As registered on the account" />
              <Field label="Phone / account number" value={form.customer_phone} onChange={(value) => update('customer_phone', value)} placeholder="+254..." />
              <Field label="Alternative phone" value={form.alternate_phone} onChange={(value) => update('alternate_phone', value)} placeholder="Optional" />
              <Field label="Email address" value={form.email} onChange={(value) => update('email', value)} placeholder="Optional" />
              <Field label="Account / username" value={form.account_number} onChange={(value) => update('account_number', value)} placeholder="Optional but helpful" />
            </div>
          </section>

          <section className="border-t border-slate-100 pt-5">
            <h2 className="text-xl font-black text-slate-950">Move details</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Current location" value={form.current_location} onChange={(value) => update('current_location', value)} placeholder="Where the service is currently installed" textarea />
              <Field label="New location" value={form.new_location} onChange={(value) => update('new_location', value)} placeholder="Estate, road, building, house number..." textarea />
              <Field label="Nearest landmark" value={form.new_landmark} onChange={(value) => update('new_landmark', value)} placeholder="School, shop, stage, gate..." />
              <Field label="House description" value={form.house_description} onChange={(value) => update('house_description', value)} placeholder="Floor, gate color, flat number..." />
              <Field label="Preferred date" type="date" value={form.preferred_date} onChange={(value) => update('preferred_date', value)} />
              <Field label="Preferred time" type="time" value={form.preferred_time} onChange={(value) => update('preferred_time', value)} />
            </div>
            <button type="button" onClick={captureLocation} disabled={locating} className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
              {locating ? 'Capturing location...' : form.latitude && form.longitude ? 'GPS pin captured' : 'Capture GPS pin'}
            </button>
          </section>

          <section className="border-t border-slate-100 pt-5">
            <h2 className="text-xl font-black text-slate-950">Router and equipment</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Toggle label="Router is available" checked={form.router_available} onChange={(value) => update('router_available', value)} />
              <Toggle label="Power adapter available" checked={form.router_power_adapter} onChange={(value) => update('router_power_adapter', value)} />
              <Toggle label="ONT available" checked={form.ont_available} onChange={(value) => update('ont_available', value)} />
              <Toggle label="Old cables available" checked={form.cable_available} onChange={(value) => update('cable_available', value)} />
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Router condition</span>
              <select value={form.router_condition} onChange={(event) => update('router_condition', event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 outline-none focus:border-[#3535FF]">
                <option value="good">Good condition</option>
                <option value="damaged">Damaged</option>
                <option value="lost">Lost / missing</option>
                <option value="not_sure">Not sure</option>
              </select>
            </label>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <span className="text-sm font-black text-slate-900">{form.photo_filename || 'Upload router / ONT photo'}</span>
              <span className="mt-1 text-xs font-semibold text-slate-500">Optional, but helps the technician prepare.</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePhoto} />
            </label>
          </section>

          <section className="border-t border-slate-100 pt-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Reason for moving" value={form.reason} onChange={(value) => update('reason', value)} placeholder="Moved house, new office, landlord request..." textarea />
              <Field label="Extra notes" value={form.notes} onChange={(value) => update('notes', value)} placeholder="Anything the technician should know..." textarea />
            </div>
            <label className="mt-5 flex items-start gap-3 rounded-2xl bg-slate-50 p-4">
              <input type="checkbox" checked={form.consent_accepted} onChange={(event) => update('consent_accepted', event.target.checked)} className="mt-1 h-5 w-5 accent-[#3535FF]" />
              <span className="text-sm font-semibold leading-6 text-slate-600">I confirm the details are correct and consent to {businessName} using this information to process my relocation request.</span>
            </label>
          </section>

          <button type="submit" disabled={submitting || !canSubmit} className="h-14 w-full rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] text-sm font-black text-white shadow-[0_18px_40px_rgba(81,53,245,0.26)] disabled:opacity-50">
            {submitting ? 'Submitting relocation request...' : 'Submit relocation request'}
          </button>
        </form>
      </div>
    </div>
  );
}
