import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const { data } = await api.post('/auth/forgot-password', { email }); setMessage(data.message); }
    catch { setError('We could not start password recovery. Please try again shortly.'); }
    finally { setBusy(false); }
  };
  return <div className="min-h-screen flex items-center justify-center bg-[#E8E9FF] p-4"><div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl"><div className="mb-7 text-center"><div className="text-xs font-bold uppercase tracking-[.18em] text-[#3535FF]">Account recovery</div><h1 className="mt-2 text-2xl font-extrabold text-gray-900">Reset your password</h1><p className="mt-2 text-sm text-gray-500">Enter your administrator email and we will send a secure reset link.</p></div>{message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}{error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<form onSubmit={submit} className="space-y-4"><label className="block text-xs font-semibold text-gray-700">Email address<input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@yourisp.co.ke" className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#3535FF]" /></label><button disabled={busy} className="w-full rounded-full bg-[#3535FF] py-3 text-sm font-semibold text-white shadow-lg shadow-[#3535FF]/20 disabled:opacity-60">{busy ? 'Sending secure link...' : 'Email reset link'}</button></form><button onClick={() => navigate('/login')} className="mt-5 w-full text-sm font-semibold text-[#3535FF]">Back to sign in</button></div></div>;
}