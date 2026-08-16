import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import networkBackground from '../assets/polyizon-login-network.jpg';

export default function Login() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('google_token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'superadmin') { setError('System operators must sign in through the onboarding portal.'); return; }
      login(token, { id: payload.id, name: payload.name, email: payload.email, role: payload.role, client_id: payload.client_id, account_type: payload.account_type, permissions: payload.permissions || [] });
      window.history.replaceState({}, '', window.location.pathname);
      navigate('/dashboard', { replace: true });
    } catch { setError('Google sign-in could not be completed. Please try again.'); }
  }, [login, navigate]);

  if (admin) return <Navigate to={admin.role === 'superadmin' ? '/onboarding' : '/dashboard'} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.admin.role === 'superadmin') { setError('System operators must sign in through the onboarding portal.'); return; }
      login(data.token, data.admin); navigate('/dashboard');
    } catch (err) { setError(err.response?.data?.error || 'Login failed. Please try again.'); }
    finally { setLoading(false); }
  };

  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#080b0c] px-5 py-8 text-white" style={{ backgroundImage: 'linear-gradient(115deg, rgba(2,7,7,.82), rgba(8,14,10,.66)), url(' + networkBackground + ')', backgroundSize: 'cover', backgroundPosition: 'center' }}>
    <div className="absolute inset-0 bg-[#243313]/25" />
    <section className="relative w-full max-w-[390px] rounded-[28px] border border-white/10 bg-[#1c2419]/85 p-7 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-8">
      <div className="mx-auto mb-7 grid h-14 w-14 place-items-center rounded-2xl border border-white/20 bg-white/[.06]">
        <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 10 24 20 40 10v16L24 38 8 26V10Z"/><path d="M24 20v18M8 10l16 10 16-10"/></svg>
      </div>
      <div className="mb-7 border-b border-white/10 pb-3 text-center"><h1 className="text-xl font-semibold tracking-tight">Sign in</h1><p className="mt-1 text-xs text-white/55">POLYIZON BILLING SYSTEM</p></div>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-xl border border-rose-300/25 bg-rose-950/35 px-3 py-2.5 text-sm text-rose-100">{error}</div>}
        <label className="block text-sm font-medium text-white/85">Email<div className="relative mt-2"><span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-white/40">✉</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoFocus className="w-full rounded-xl border border-white/15 bg-black/10 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/45 focus:bg-black/20"/></div></label>
        <label className="block text-sm font-medium text-white/85">Password<div className="relative mt-2"><span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-white/40">⌑</span><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required className="w-full rounded-xl border border-white/15 bg-black/10 py-3 pl-11 pr-12 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/45 focus:bg-black/20"/><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-3 px-2 text-sm text-white/55 hover:text-white">{showPassword ? '◉' : '◌'}</button></div></label>
        <div className="text-right"><button type="button" onClick={() => navigate('/forgot-password')} className="text-xs text-white/70 underline decoration-white/35 underline-offset-4 hover:text-white">Forgot password?</button></div>
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e] transition hover:bg-white disabled:opacity-60">{loading ? 'Signing in...' : 'Sign in'}</button>
        <div className="flex items-center gap-3 py-1 text-xs text-white/45"><span className="h-px flex-1 bg-white/10"/>or continue with<span className="h-px flex-1 bg-white/10"/></div>
        <button type="button" onClick={() => { window.location.href = 'https://billing.polyizon.tech/api/auth/google/start?return_to=' + encodeURIComponent(window.location.origin); }} className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-black/10 py-3 text-sm font-medium text-white/85 transition hover:bg-white/10"><span className="text-lg font-black text-[#4285F4]">G</span>Continue with Google</button>
      </form>
    </section>
  </main>;
}
