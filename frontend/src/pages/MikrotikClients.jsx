import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import { CheckCircleIcon, PulseIcon, ShareIosIcon, UsersIcon } from '../components/Icons';

const SERVICES = [
  { key: 'all', label: 'All Clients' },
  { key: 'pppoe', label: 'PPPoE' },
  { key: 'hotspot', label: 'Hotspot' },
];

const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
  { key: 'expired', label: 'Expired' },
];

function StatCard({ title, value, icon: Icon, tone = 'violet', active = false, onClick }) {
  const tones = {
    violet: 'bg-[#f0e8ff] text-[#6c2cff]',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full rounded-[22px] border bg-white p-4 text-left shadow-[0_16px_35px_rgba(30,41,59,0.05)] transition ${
        active ? 'border-[#6c2cff] ring-4 ring-[#ede7ff]' : 'border-[#dfe5f5]'
      } ${onClick ? 'hover:-translate-y-0.5 hover:border-[#bca8ff]' : ''}`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-[24px] font-black text-[#08103f]">{value || 0}</p>
      <p className="text-[12px] font-bold text-[#637098]">{title}</p>
    </Tag>
  );
}

function FilterButton({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={`h-10 rounded-2xl px-4 text-[13px] font-black transition ${
        active ? 'bg-gradient-to-r from-[#3158ff] to-[#812cff] text-white shadow-[0_12px_26px_rgba(81,53,245,0.22)]' : 'border border-[#dfe5f5] bg-white text-[#425071]'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function ClientRow({ item }) {
  return (
    <tr className="border-t border-[#edf1f8] text-[13px] font-semibold text-[#425071]">
      <td className="px-4 py-3">
        <div className="font-black text-[#08103f]">{item.display_name || item.username}</div>
        <div className="text-[12px] text-[#7d89aa]">{item.phone || item.account_number || item.username}</div>
      </td>
      <td className="px-4 py-3 capitalize">{item.service_type}</td>
      <td className="px-4 py-3">{item.router_name || '-'}</td>
      <td className="px-4 py-3">{item.package_name || item.profile || '-'}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-3 py-1 text-[11px] font-black ${item.is_online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {item.is_online ? 'Online' : 'Offline'}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={item.is_expired ? 'font-black text-rose-600' : 'text-[#425071]'}>
          {item.expiry_date || '-'}{item.expiry_time ? ` ${item.expiry_time}` : ''}
        </span>
      </td>
      <td className="px-4 py-3">{item.ip_address || '-'}</td>
      <td className="px-4 py-3">{item.last_seen || '-'}</td>
    </tr>
  );
}

export default function MikrotikClients() {
  const [clients, setClients] = useState([]);
  const [counts, setCounts] = useState({});
  const [service, setService] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (service !== 'all') params.set('service', service);
    if (status !== 'all') params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [service, status, search]);

  const loadClients = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/mikrotik/clients${query ? `?${query}` : ''}`);
      setClients(Array.isArray(data.clients) ? data.clients : []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load MikroTik clients.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, [query]);

  const syncNow = async () => {
    setSyncing(true);
    setMessage('');
    setError('');
    try {
      const { data } = await api.post('/mikrotik/clients/sync');
      const sourceText = Array.isArray(data.sources) && data.sources.length
        ? data.sources.map((source) =>
          `${source.router}: online PPP ${source.deduped_online_pppoe || 0}, online Hotspot ${source.deduped_online_hotspot || 0}, seen hosts ${source.hotspot_hosts || 0}, DHCP ${source.dhcp_leases || 0}`
        ).join(' | ')
        : '';
      const failureText = data.failed ? ` ${data.failed} router(s) failed.` : '';
      setMessage(`Synced ${data.synced || 0} client records from ${data.routers || 0} router(s).${failureText}${sourceText ? ` Sources: ${sourceText}` : ''}`);
      await loadClients();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to sync MikroTik clients.');
    } finally {
      setSyncing(false);
    }
  };

  const setClientFilter = (nextService = 'all', nextStatus = 'all') => {
    setService(nextService);
    setStatus(nextStatus);
  };

  const clearFilters = () => {
    setClientFilter('all', 'all');
    setSearch('');
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-5 p-4 pb-10 sm:p-5">
      <section className="rounded-[28px] border border-[#dfe5f5] bg-white p-6 shadow-[0_24px_70px_rgba(30,41,59,0.08)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#f0e8ff] text-[#6c2cff]">
              <UsersIcon className="h-8 w-8" />
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#6c2cff]">Router customer data</p>
              <h1 className="mt-1 text-[28px] font-black text-[#08103f]">Clients</h1>
              <p className="mt-2 max-w-[760px] text-[14px] font-semibold leading-6 text-[#637098]">
                Store PPPoE and Hotspot clients from linked MikroTik routers so the agent can know who is online, offline, expired, and reachable for communication.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] px-5 text-[14px] font-black text-white shadow-[0_18px_40px_rgba(81,53,245,0.25)] disabled:opacity-60"
          >
            <ShareIosIcon className="h-4 w-4" />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </section>

      {(message || error) && (
        <div className={`rounded-2xl px-4 py-3 text-[13px] font-black ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {error || message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard title="Stored clients" value={counts.total} icon={UsersIcon} active={service === 'all' && status === 'all'} onClick={() => setClientFilter('all', 'all')} />
        <StatCard title="Online" value={counts.online} icon={CheckCircleIcon} tone="green" active={status === 'online'} onClick={() => setClientFilter(service, 'online')} />
        <StatCard title="Offline" value={counts.offline} icon={PulseIcon} tone="amber" active={status === 'offline'} onClick={() => setClientFilter(service, 'offline')} />
        <StatCard title="Expired" value={counts.expired} icon={PulseIcon} tone="rose" active={status === 'expired'} onClick={() => setClientFilter(service, 'expired')} />
        <StatCard title="PPPoE" value={counts.pppoe} icon={PulseIcon} tone="blue" active={service === 'pppoe'} onClick={() => setClientFilter('pppoe', status)} />
        <StatCard title="Hotspot" value={counts.hotspot} icon={PulseIcon} active={service === 'hotspot'} onClick={() => setClientFilter('hotspot', status)} />
      </div>

      <section className="rounded-[28px] border border-[#dfe5f5] bg-white p-5 shadow-[0_18px_45px_rgba(30,41,59,0.06)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((item) => <FilterButton key={item.key} active={service === item.key} onClick={() => setService(item.key)}>{item.label}</FilterButton>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((item) => <FilterButton key={item.key} active={status === item.key} onClick={() => setStatus(item.key)}>{item.label}</FilterButton>)}
          </div>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row xl:max-w-[470px]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, username..."
              className="h-11 min-w-0 flex-1 rounded-2xl border border-[#d9e1f2] bg-white px-4 text-[13px] font-bold text-[#08103f] outline-none focus:border-[#6c2cff]"
            />
            <button
              type="button"
              onClick={clearFilters}
              className="h-11 rounded-2xl border border-[#dfe5f5] bg-white px-4 text-[13px] font-black text-[#425071] transition hover:border-[#bca8ff] hover:text-[#4f2cff]"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[980px] w-full text-left">
            <thead>
              <tr className="text-[11px] font-black uppercase tracking-[0.12em] text-[#93a0bf]">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Router</th>
                <th className="px-4 py-3">Package/Profile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((item) => <ClientRow key={`${item.router_id}-${item.service_type}-${item.username}`} item={item} />)}
            </tbody>
          </table>
          {!loading && clients.length === 0 && (
            <div className="py-12 text-center text-[13px] font-black text-[#637098]">
              No MikroTik clients stored yet. Click Sync Now after linking a router.
            </div>
          )}
          {loading && <div className="py-12 text-center text-[13px] font-black text-[#637098]">Loading clients...</div>}
        </div>
      </section>
    </div>
  );
}
