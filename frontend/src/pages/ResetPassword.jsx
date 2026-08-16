import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

export default function ResetPassword() {
  const navigate = useNavigate(); const [params] = useSearchParams();
  const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [token, setToken] = useState(params.get('token') || '');
  useEffect(() => {
    if (!token) return;
    let active = true;
    api.get(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .catch(() => { if (active) { setError('This reset link is invalid or has already been used. Request a new link.'); setToken(''); } });
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    if (password !== confirmPassword) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try { const { data } = await api.post('/auth/reset-password', { token, password }); setMessage(data.message); setTimeout(() => navigate('/login'), 1400); }
    catch (err) { setError(err.response?.data?.error || 'Could not reset password. Request a new link.'); }
    finally { setBusy(false); }
  };
  return <div className="min-h-screen flex items-center justify-center bg-[#E8E9FF] p-4"><div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl"><div className="mb-7 text-center"><div className="text-xs font-bold uppercase tracking-[.18em] text-[#3535FF]">POLYIZON Billing</div><h1 className="mt-2 text-2xl font-extrabold text-gray-900">Choose a new password</h1><p className="mt-2 text-sm text-gray-500">Use at least 10 characters. This link works once and expires after 15 minutes.</p></div>{message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}{error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{!token ? <button onClick={() => navigate('/forgot-password')} className="w-full rounded-full bg-[#3535FF] py-3 text-sm font-semibold text-white">Request a new link</button> : <form onSubmit={submit} className="space-y-4"><label className="block text-xs font-semibold text-gray-700">New password<input type="password" minLength="10" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#3535FF]" /></label><label className="block text-xs font-semibold text-gray-700">Confirm new password<input type="password" minLength="10" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#3535FF]" /></label><button disabled={busy || Boolean(message)} className="w-full rounded-full bg-[#3535FF] py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Updating password...' : 'Save new password'}</button></form>}</div></div>;
}