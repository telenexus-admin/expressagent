import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';

const initialForm = { isp_name: '', owner_name: '', email: '', phone: '', password: '', confirm_password: '' };

function GoogleMark() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.24a4.48 4.48 0 0 1-1.94 2.94v2.51h3.14c1.84-1.69 2.91-4.19 2.91-7.28Z"/><path fill="#34A853" d="M12 21.75c2.62 0 4.82-.87 6.44-2.36L15.3 16.9c-.87.58-1.98.93-3.3.93-2.54 0-4.7-1.71-5.47-4.01H3.29v2.59A9.73 9.73 0 0 0 12 21.75Z"/><path fill="#FBBC05" d="M6.53 13.82A5.86 5.86 0 0 1 6.22 12c0-.63.11-1.23.31-1.82V7.59H3.29A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.06 1.04 4.41l3.24-2.59Z"/><path fill="#EA4335" d="M12 6.17c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.81 3.24 14.62 2.25 12 2.25a9.73 9.73 0 0 0-8.71 5.34l3.24 2.59c.77-2.3 2.93-4.01 5.47-4.01Z"/></svg>;
}

export default function BillingSignup() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [googleToken, setGoogleToken] = useState('');
  const [googleVerified, setGoogleVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const values = new URLSearchParams(window.location.hash.slice(1));
    const token = values.get('google_signup_token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.email) throw new Error('Missing email');
      setGoogleToken(token); setGoogleVerified(true);
      setForm((current) => ({ ...current, email: payload.email, owner_name: payload.name || current.owner_name }));
      window.history.replaceState({}, '', window.location.pathname);
    } catch (_error) { setError('Your Google verification expired. Please choose Continue with Google again.'); }
  }, []);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const startGoogle = () => { window.location.href = `/api/auth/google/start?return_to=${encodeURIComponent(window.location.origin)}&mode=signup`; };
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (!googleToken && form.password !== form.confirm_password) { setError('Your passwords do not match.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/signup', {
        isp_name: form.isp_name, owner_name: form.owner_name, email: form.email, phone: form.phone,
        ...(googleToken ? { google_signup_token: googleToken } : { password: form.password }),
      }, { skipAuthRefresh: true });
      setComplete(true);
    } catch (err) { setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'We could not create your account. Please try again.'); }
    finally { setLoading(false); }
  };

  if (complete) return <main className="min-h-screen bg-[#080b0c] px-5 py-10 text-white"><section className="mx-auto mt-12 max-w-[520px] rounded-[30px] border border-white/10 bg-[#1c2419]/90 p-8 text-center shadow-2xl"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-300/15 text-3xl text-emerald-200">✓</div><p className="mt-6 text-xs font-black uppercase tracking-[.2em] text-emerald-200">Account created</p><h1 className="mt-3 text-3xl font-semibold">Your Polyizon Billing trial is ready.</h1><p className="mt-4 text-sm leading-6 text-white/65">We sent the account details to your email. Sign in to set up multi-factor authentication and start your 14-day Starter trial.</p><button onClick={() => googleToken ? (window.location.href = `/api/auth/google/start?return_to=${encodeURIComponent(window.location.origin)}`) : navigate('/login')} className="mt-7 w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e]">{googleToken ? 'Continue with Google' : 'Sign in to Polyizon Billing'}</button></section></main>;

  return <main className="relative min-h-screen overflow-hidden bg-[#080b0c] px-5 py-8 text-white"><div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl"/><section className="relative mx-auto w-full max-w-[560px]"><Link to="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white">← Back to sign in</Link><div className="mt-7 rounded-[30px] border border-white/10 bg-[#1c2419]/90 p-7 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-9"><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-200">Polyizon Billing</p><h1 className="mt-3 text-3xl font-semibold">Create your ISP account.</h1><p className="mt-3 text-sm leading-6 text-white/60">Start a 14-day Starter trial for your billing workspace. No card required.</p>{error && <div className="mt-5 rounded-xl border border-rose-300/25 bg-rose-950/35 px-3 py-2.5 text-sm text-rose-100">{error}</div>}<button type="button" onClick={startGoogle} className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white py-3.5 text-sm font-bold text-slate-900"><GoogleMark/> Continue with Google</button><div className="my-6 flex items-center gap-3 text-xs text-white/40"><span className="h-px flex-1 bg-white/10"/>or create with email<span className="h-px flex-1 bg-white/10"/></div><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-white/80 sm:col-span-2">ISP / business name<input required value={form.isp_name} onChange={(e) => update('isp_name', e.target.value)} autoComplete="organization" placeholder="e.g. Horizon Fibre" className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none focus:border-white/45"/></label><label className="block text-sm text-white/80 sm:col-span-2">Your full name<input required value={form.owner_name} onChange={(e) => update('owner_name', e.target.value)} autoComplete="name" placeholder="Business owner or manager" className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none focus:border-white/45"/></label><label className="block text-sm text-white/80">Business email<input required type="email" value={form.email} disabled={googleVerified} onChange={(e) => update('email', e.target.value)} autoComplete="email" placeholder="you@business.com" className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none disabled:opacity-60 focus:border-white/45"/></label><label className="block text-sm text-white/80">Phone number<input required type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} autoComplete="tel" placeholder="+254 700 000 000" className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none focus:border-white/45"/></label>{!googleVerified && <><label className="block text-sm text-white/80">Create password<input required type="password" minLength="12" value={form.password} onChange={(e) => update('password', e.target.value)} autoComplete="new-password" placeholder="12+ characters" className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none focus:border-white/45"/></label><label className="block text-sm text-white/80">Confirm password<input required type="password" minLength="12" value={form.confirm_password} onChange={(e) => update('confirm_password', e.target.value)} autoComplete="new-password" placeholder="Repeat password" className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none focus:border-white/45"/></label><p className="-mt-1 text-xs leading-5 text-white/45 sm:col-span-2">Use 12+ characters and at least three of: uppercase, lowercase, number, or symbol.</p></>}<button disabled={loading} className="mt-2 w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e] disabled:opacity-60 sm:col-span-2">{loading ? 'Creating your workspace…' : 'Create my billing account'}</button></form><p className="mt-5 text-center text-xs text-white/45">Already have an account? <Link to="/login" className="font-bold text-white/80 underline">Sign in</Link></p></div></section></main>;
}
