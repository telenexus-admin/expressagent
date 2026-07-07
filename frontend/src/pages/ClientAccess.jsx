import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function decodeAdmin(raw) {
  const json = decodeURIComponent(escape(window.atob(raw)));
  return JSON.parse(json);
}

export default function ClientAccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    const adminParam = params.get('admin');
    const next = params.get('next') || '/dashboard/agent';

    if (!token || !adminParam) {
      setError('This dashboard access link is incomplete.');
      return;
    }

    try {
      login(token, decodeAdmin(adminParam), { sessionOnly: true });
      navigate(next.startsWith('/dashboard') ? next : '/dashboard/agent', { replace: true });
    } catch {
      setError('This dashboard access link is invalid or expired.');
    }
  }, [login, navigate, params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f6ff] p-6">
      <div className="w-full max-w-sm rounded-[28px] border border-purple-100 bg-white p-8 text-center shadow-xl shadow-purple-100/70">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#4B16B5] text-lg font-black text-white">
          N
        </div>
        <h1 className="text-lg font-black text-slate-950">
          {error ? 'Access link failed' : 'Opening client dashboard...'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {error || 'Preparing a temporary operator session for this client.'}
        </p>
      </div>
    </div>
  );
}
