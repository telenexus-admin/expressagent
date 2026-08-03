import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

export default function ClientAccess() {
  const navigate = useNavigate();
  const { impersonateClient } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/clients')
      .then(({ data }) => setClients(data || []))
      .catch((err) => setError(err.response?.data?.error || 'Could not load clients'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) =>
      `${client.name || ''} ${client.business_name || ''} ${client.contact_email || ''}`
        .toLowerCase()
        .includes(query)
    );
  }, [clients, search]);

  const openDashboard = async (client) => {
    setBusyId(client.id);
    setError('');
    try {
      const { data } = await api.post(`/operator-access/${client.id}`);
      impersonateClient(data.token, data.admin);
      navigate('/dashboard/statistics', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open this client dashboard');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-full bg-[#f6f7ff] p-5 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-[#e9e9ff] px-4 py-2 text-xs font-black text-[#3535FF]">OPERATOR ACCESS</span>
            <h1 className="mt-3 text-3xl font-black text-slate-950">Open Client Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Enter any active client workspace without viewing or changing their login credentials.</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search client..."
            className="w-full rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#3535FF]/20 sm:w-80"
          />
        </div>

        {error && <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>}

        <div className="overflow-hidden rounded-[30px] bg-white shadow-xl shadow-indigo-100/50">
          {loading ? (
            <div className="p-12 text-center text-sm text-slate-400">Loading client workspaces...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-400">No matching clients found.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((client) => (
                <div key={client.id} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ececff] text-lg font-black text-[#3535FF]">
                      {(client.business_name || client.name || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-black text-slate-950">{client.business_name || client.name}</h2>
                      <p className="mt-1 truncate text-xs text-slate-400">{client.name}{client.contact_email ? ` · ${client.contact_email}` : ''}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${client.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{client.status}</span>
                        <span className="text-[11px] text-slate-400">{client.conversation_count || 0} conversations</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === client.id || client.status !== 'active'}
                    onClick={() => openDashboard(client)}
                    className="rounded-2xl bg-[#3535FF] px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyId === client.id ? 'Opening...' : 'Open Dashboard'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
