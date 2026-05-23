import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import expressnetLogo from '../assets/expressnetLogo';

export default function ExpressnetLogin() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (admin) return <Navigate to={admin.role === 'superadmin' ? '/onboarding' : '/dashboard'} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.admin.role === 'superadmin' || Number(data.admin.client_id) !== 1) {
        setError('This sign-in page is reserved for ExpressNet Solutions administrators.');
        return;
      }
      login(data.token, data.admin);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#eef7fc] p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-96 h-96 bg-[#58bce0] opacity-10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#286596] opacity-10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
      <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-md relative border border-white">
        <div className="text-center mb-7">
          <img src={expressnetLogo} alt="ExpressNet Solutions" className="mx-auto w-full max-w-[265px] h-auto mb-5" />
          <p className="text-gray-500 text-sm">Sign in to your admin dashboard</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#58bce0] focus:bg-white" placeholder="admin@example.com" required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#58bce0] focus:bg-white" placeholder="••••••••" required />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-[#286596] hover:bg-[#214f76] disabled:opacity-60 text-white font-semibold py-3 rounded-full transition-colors text-sm shadow-lg shadow-[#286596]/20">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
