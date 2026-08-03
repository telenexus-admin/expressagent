import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';

export default function Overview() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/clients');
      setClients(data);
    } catch (err) {
      console.error('Failed to fetch clients:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const totals = clients.reduce(
    (acc, c) => {
      acc.clients += 1;
      if (c.status === 'active') acc.active += 1;
      if (c.status === 'suspended') acc.suspended += 1;
      acc.admins += c.admin_count || 0;
      acc.conversations += c.conversation_count || 0;
      return acc;
    },
    { clients: 0, active: 0, suspended: 0, admins: 0, conversations: 0 }
  );

  const recent = [...clients]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            A quick read on every business running on Nexa.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <Stat label="Total Clients" value={totals.clients} loading={loading} />
          <Stat label="Active" value={totals.active} loading={loading} tone="emerald" />
          <Stat label="Suspended" value={totals.suspended} loading={loading} tone="amber" />
          <Stat label="Conversations" value={totals.conversations} loading={loading} />
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Recent Clients</h2>
              <p className="text-xs text-gray-500 mt-0.5">Last 5 businesses onboarded</p>
            </div>
            <Link
              to="/onboarding/clients"
              className="text-xs text-[#3535FF] hover:text-[#2828DD] font-semibold"
            >
              View all →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {loading && (
              <div className="px-5 py-6 text-sm text-gray-400 text-center">Loading...</div>
            )}
            {!loading && recent.length === 0 && (
              <div className="px-5 py-10 text-sm text-gray-400 text-center">
                No clients yet.{' '}
                <Link to="/onboarding/clients" className="text-[#3535FF] hover:underline">
                  Onboard your first one
                </Link>
                .
              </div>
            )}
            {!loading &&
              recent.map((c) => (
                <Link
                  key={c.id}
                  to={`/onboarding/clients/${c.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-[#3535FF] flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                    {c.business_name && (
                      <div className="text-[11px] text-gray-500 truncate">{c.business_name}</div>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 shrink-0">
                    {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, loading, tone }) {
  const toneStyles =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
      ? 'text-amber-700'
      : 'text-gray-900';
  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-4 py-4 shadow-sm">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneStyles}`}>
        {loading ? '–' : value}
      </div>
    </div>
  );
}
