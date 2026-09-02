import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import networkBackground from '../assets/polyizon-login-network.jpg';

export default function Login({ operatorOnly = false }) {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [phase, setPhase] = useState('password');
  const [enrollment, setEnrollment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [completedAdmin, setCompletedAdmin] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const finish = (adminData) => {
    if (operatorOnly && adminData.role !== 'superadmin') throw new Error('This portal is for system operators only.');
    if (!operatorOnly && adminData.role === 'superadmin') throw new Error('System operators must sign in through the onboarding portal.');
    login(adminData);
    navigate(adminData.role === 'superadmin' ? '/admin?app_route=dashboard' : '/dashboard', { replace: true });
  };

  const beginSetup = async (authChallenge) => {
    const { data } = await api.post('/auth/mfa/setup', { challenge: authChallenge }, { skipAuthRefresh: true });
    setEnrollment(data);
    setChallenge(data.confirmation_challenge);
    setPhase('setup');
  };

  useEffect(() => {
    const values = new URLSearchParams(window.location.hash.slice(1));
    const mode = values.get('auth_mode');
    const authChallenge = values.get('auth_challenge');
    if (!mode || !authChallenge) return;
    window.history.replaceState({}, '', window.location.pathname);
    setChallenge(authChallenge);
    if (mode === 'mfa') setPhase('mfa');
    if (mode === 'setup') beginSetup(authChallenge).catch((err) => setError(err.response?.data?.error || 'Secure verification could not start.'));
  }, []);

  if (admin) return <Navigate to={admin.role === 'superadmin' ? '/admin?app_route=dashboard' : '/dashboard'} replace />;

  const submitPassword = async (event) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password }, { skipAuthRefresh: true });
      if (data.mfa_required) { setChallenge(data.challenge); setPhase('mfa'); setCode(''); return; }
      if (data.mfa_setup_required) { await beginSetup(data.challenge); return; }
      finish(data.admin);
    } catch (err) { setError(err.response?.data?.error || err.message || 'Sign-in failed.'); }
    finally { setLoading(false); }
  };

  const submitMfa = async (event) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/mfa/verify', { challenge, code }, { skipAuthRefresh: true });
      finish(data.admin);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Verification failed.';
      if (/verification challenge is invalid or expired/i.test(message)) {
        setPhase('password'); setChallenge(''); setCode('');
        setError('Your verification window ended. Sign in again to use a fresh code.');
      } else { setError(message); }
    } finally { setLoading(false); }
  };

  const confirmSetup = async (event) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/mfa/setup/confirm', {
        challenge, enrollment_token: enrollment.enrollment_token, code,
      }, { skipAuthRefresh: true });
      if (operatorOnly && data.admin.role !== 'superadmin') throw new Error('This portal is for system operators only.');
      if (!operatorOnly && data.admin.role === 'superadmin') throw new Error('System operators must sign in through the onboarding portal.');
      setCompletedAdmin(data.admin);
      setRecoveryCodes(data.recovery_codes || []);
      setPhase('recovery');
    } catch (err) { setError(err.response?.data?.error || err.message || 'MFA setup failed.'); }
    finally { setLoading(false); }
  };

  const title = operatorOnly ? 'Operator sign in' : phase === 'password' ? 'Sign in' : phase === 'mfa' ? 'Verify your identity' : phase === 'setup' ? 'Secure your account' : 'Save recovery codes';

  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#080b0c] px-5 py-8 text-white" style={{ backgroundImage: `linear-gradient(115deg, rgba(2,7,7,.84), rgba(8,14,10,.68)), url(${networkBackground})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
    <section className="relative w-full max-w-[430px] rounded-[28px] border border-white/10 bg-[#1c2419]/90 p-7 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-8">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/20 bg-white/[.06]"><svg viewBox="0 0 48 48" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 10 24 20 40 10v16L24 38 8 26V10Z"/><path d="M24 20v18M8 10l16 10 16-10"/></svg></div>
      <div className="mb-6 border-b border-white/10 pb-3 text-center"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-xs text-white/55">POLYIZON BILLING SYSTEM</p></div>
      {error && <div className="mb-4 rounded-xl border border-rose-300/25 bg-rose-950/35 px-3 py-2.5 text-sm text-rose-100">{error}</div>}

      {phase === 'password' && <form onSubmit={submitPassword} className="space-y-4">
        <label className="block text-sm text-white/85">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="mt-2 w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-sm outline-none focus:border-white/45"/></label>
        <label className="block text-sm text-white/85">Password<div className="relative mt-2"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 pr-12 text-sm outline-none focus:border-white/45"/><button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-3 px-2 text-white/60">{showPassword ? 'Hide' : 'Show'}</button></div></label>
        <div className="text-right"><button type="button" onClick={() => navigate('/forgot-password')} className="text-xs text-white/70 underline">Forgot password?</button></div>
        <button disabled={loading} className="w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e] disabled:opacity-60">{loading ? 'Signing in…' : 'Sign in'}</button>
        {!operatorOnly && <><div className="flex items-center gap-3 text-xs text-white/45"><span className="h-px flex-1 bg-white/10"/>or continue with<span className="h-px flex-1 bg-white/10"/></div><button type="button" onClick={() => { window.location.href = `/api/auth/google/start?return_to=${encodeURIComponent(window.location.origin)}`; }} className="w-full rounded-xl border border-white/15 py-3 text-sm">Continue with Google</button></>}
      </form>}

      {phase === 'mfa' && <form onSubmit={submitMfa} className="space-y-4"><p className="text-sm text-white/65">Enter the six-digit authenticator code or a recovery code.</p><input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" placeholder="000000" className="w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-center text-lg tracking-[.25em] outline-none"/><button disabled={loading} className="w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e]">Verify</button></form>}

      {phase === 'setup' && enrollment && <form onSubmit={confirmSetup} className="space-y-4"><p className="text-sm text-white/65">Scan this QR code in your authenticator app. MFA is required for administrator access.</p><img src={enrollment.qr_data_url} alt="Authenticator QR code" className="mx-auto h-48 w-48 rounded-xl bg-white p-2"/><p className="break-all rounded-lg bg-black/20 p-2 text-center font-mono text-xs text-white/70">{enrollment.secret}</p><input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" placeholder="Enter 6-digit code" className="w-full rounded-xl border border-white/15 bg-black/10 px-4 py-3 text-center outline-none"/><button disabled={loading} className="w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e]">Enable MFA</button></form>}

      {phase === 'recovery' && <div className="space-y-4"><p className="text-sm text-amber-100">Store these one-time recovery codes securely. They will not be shown again.</p><div className="grid grid-cols-2 gap-2 rounded-xl bg-black/25 p-3 font-mono text-xs">{recoveryCodes.map((item) => <span key={item}>{item}</span>)}</div><button onClick={() => finish(completedAdmin)} className="w-full rounded-xl bg-[#f5f1e8] py-3.5 text-sm font-bold text-[#23291e]">I saved the codes</button></div>}
    </section>
  </main>;
}
