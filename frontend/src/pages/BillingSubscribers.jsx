import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import PppoeSubscriberDetail from '../components/PppoeSubscriberDetail';
import polyizonLoginNetwork from '../assets/polyizon-login-network.jpg';

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10';

const emptySubscriber = { full_name: '', phone: '', email: '', account_number: '', plan_id: '', router_id: '', access_mode: '', vlan_id: '', static_pool_id: '', static_ip: '', static_mac: '', static_dhcp_server: '', grace_period_days: '0' };
const emptyHotspot = { plan_id: '', quantity: '1' };

function ClientTypeChooser({ choose, close }) { return <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-950/50 p-5"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h3 className="text-xl font-black">Choose client type</h3><p className="mt-1 text-sm text-slate-500">Choose how this client will connect.</p></div><button type="button" onClick={close} className="text-2xl text-slate-400">×</button></div><div className="mt-5 space-y-3"><button type="button" onClick={() => choose('pppoe')} className="w-full rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left"><b className="block text-violet-800">PPPoE client</b><span className="mt-1 block text-xs text-violet-600">Address assigned automatically by the router.</span></button><button type="button" onClick={() => choose('pppoe_static')} className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left"><b className="block text-indigo-800">Static client</b><span className="mt-1 block text-xs text-indigo-600">Fixed IP delivered through RADIUS or DHCP.</span></button><button type="button" onClick={() => choose('hotspot')} className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left"><b className="block text-emerald-800">Hotspot client</b><span className="mt-1 block text-xs text-emerald-600">Generate hotspot access from an active hotspot package.</span></button></div></div></div>; }

function StaticClientForm({ value, setValue, plans, routers, submit, close, busy }) { const [pools, setPools] = useState([]); useEffect(() => { api.get('/billing-workspace/ip-pools').then((r) => setPools(r.data || [])).catch(() => setPools([])); }, []); const available = pools.filter((p) => String(p.router_id) === String(value.router_id)); return <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5"><form onSubmit={submit} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Static client</h3><p className="mt-1 text-xs text-slate-500">Fixed-address connection setup.</p></div><button type="button" onClick={close} className="text-2xl text-slate-400">×</button></div><div className="mt-4 space-y-3"><input required className={field} placeholder="Full name" value={value.full_name} onChange={(e) => setValue({ ...value, full_name: e.target.value })} /><input required className={field} placeholder="Client identifier / account number" value={value.account_number} onChange={(e) => setValue({ ...value, account_number: e.target.value })} /><select className={field} value={value.plan_id} onChange={(e) => setValue({ ...value, plan_id: e.target.value })}><option value="">Select package later</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select className={field} value={value.access_mode} onChange={(e) => setValue({ ...value, access_mode: e.target.value, static_mac: '', static_dhcp_server: '' })}><option value="pppoe_static">Static PPPoE</option><option value="dhcp_static">Static DHCP</option></select><select required className={field} value={value.router_id} onChange={(e) => setValue({ ...value, router_id: e.target.value, static_pool_id: '' })}><option value="">Select router</option>{routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select><label className="block text-xs font-bold text-slate-600">VLAN ID (optional)<input type="number" min="1" max="4094" className={field + ' mt-1.5'} value={value.vlan_id} onChange={(e) => setValue({ ...value, vlan_id: e.target.value })} placeholder="Leave blank for no VLAN" /></label><select required className={field} value={value.static_pool_id} onChange={(e) => setValue({ ...value, static_pool_id: e.target.value })}><option value="">Select IP pool</option>{available.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.cidr}</option>)}</select><input required className={field} placeholder="Fixed IP address" value={value.static_ip} onChange={(e) => setValue({ ...value, static_ip: e.target.value })} />{value.access_mode === 'dhcp_static' && <><input required className={field} placeholder="MAC address (AA:BB:CC:DD:EE:FF)" value={value.static_mac} onChange={(e) => setValue({ ...value, static_mac: e.target.value })} /><input required className={field} placeholder="MikroTik DHCP server name" value={value.static_dhcp_server} onChange={(e) => setValue({ ...value, static_dhcp_server: e.target.value })} /></>}<label className="block text-xs font-bold text-slate-600">Grace period days<input type="number" min="0" max="90" className={field + ' mt-1.5'} value={value.grace_period_days} onChange={(e) => setValue({ ...value, grace_period_days: e.target.value })} /></label><button disabled={busy} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{busy ? 'Adding…' : 'Add client'}</button></div></form></div>; }

function HotspotClientForm({ value, setValue, plans, submit, close, busy }) { return <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5"><form onSubmit={submit} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Hotspot client</h3><p className="mt-1 text-xs text-slate-500">Generate hotspot access from a package.</p></div><button type="button" onClick={close} className="text-2xl text-slate-400">×</button></div><div className="mt-4 space-y-3"><label className="block text-xs font-bold text-slate-600">Hotspot package<select required className={field + ' mt-1.5'} value={value.plan_id} onChange={(e) => setValue({ ...value, plan_id: e.target.value })}><option value="">Select hotspot package</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_minutes} min</option>)}</select></label><label className="block text-xs font-bold text-slate-600">Number of access codes<input required min="1" max="100" type="number" className={field + ' mt-1.5'} value={value.quantity} onChange={(e) => setValue({ ...value, quantity: e.target.value })} /></label><p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">The generated code(s) will appear under Hotspot Users.</p><button disabled={busy} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{busy ? 'Generating…' : 'Generate hotspot access'}</button></div></form></div>; }

function formatBytes(value) { const n = Number(value || 0); if (!n) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / (1024 ** index)).toFixed(index > 1 ? 2 : 0)} ${units[index]}`; }
function formatDuration(seconds) { const total = Number(seconds || 0); const days = Math.floor(total / 86400); const hours = Math.floor((total % 86400) / 3600); const minutes = Math.floor((total % 3600) / 60); return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`; }function UsageSkeleton() { return <div className="space-y-4" aria-label="Loading bandwidth usage"><div className="grid gap-4 sm:grid-cols-3"><div className="h-28 animate-pulse rounded-2xl bg-slate-200/80" /><div className="h-28 animate-pulse rounded-2xl bg-slate-200/80" /><div className="h-28 animate-pulse rounded-2xl bg-slate-200/80" /></div><div className="h-72 animate-pulse rounded-2xl bg-slate-200/80" /><div className="h-56 animate-pulse rounded-2xl bg-slate-200/80" /></div>; }
function SubscriberDetail({ subscriber, back, setError }) {
  const [tab, setTab] = useState('usage');
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let mounted = true; setLoading(true); api.get(`/billing-workspace/subscribers/${subscriber.id}/usage?days=30`).then((response) => { if (mounted) setUsage(response.data); }).catch((error) => setError(error.response?.data?.error || 'Could not load bandwidth usage.')).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [subscriber.id, setError]);
  const total = usage?.usage?.total || {}; const daily = usage?.usage?.daily || []; const sessions = usage?.usage?.sessions || []; const download = Number(total.download_bytes || 0); const upload = Number(total.upload_bytes || 0); const combined = download + upload; const maxDay = Math.max(1, ...daily.map((day) => Number(day.download_bytes || 0) + Number(day.upload_bytes || 0)));
  return <div className="space-y-4"><button onClick={back} className="text-sm font-extrabold text-violet-600">← Back to clients</button><section className="rounded-3xl bg-gradient-to-br from-[#26006b] via-[#5600c6] to-[#8d2cff] p-6 text-white shadow-xl"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-200">Client profile</p><h2 className="mt-2 text-2xl font-black">{subscriber.full_name}</h2><p className="mt-1 text-sm text-violet-100">{subscriber.account_number} · {subscriber.plan_name || 'No package'}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${subscriber.is_online ? 'bg-emerald-300 text-emerald-950' : 'bg-white/20 text-white'}`}>{subscriber.is_online ? 'Online' : 'Offline'}</span></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] font-bold text-violet-200">Total used</p><p className="mt-1 text-lg font-black">{formatBytes(combined)}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] font-bold text-violet-200">Download</p><p className="mt-1 text-lg font-black">{formatBytes(download)}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] font-bold text-violet-200">Upload</p><p className="mt-1 text-lg font-black">{formatBytes(upload)}</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="text-[10px] font-bold text-violet-200">Sessions</p><p className="mt-1 text-lg font-black">{total.session_count || 0}</p></div></div></section><div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">{[['overview','Overview'],['usage','Bandwidth Usage'],['invoices','Invoices'],['payments','Payments'],['tickets','Tickets']].map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-3 text-xs font-extrabold ${tab === key ? 'bg-violet-600 text-white' : 'text-slate-500'}`}>{label}</button>)}</div>{loading ? <UsageSkeleton /> : tab === 'usage' ? <><section className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold text-slate-400">Online duration</p><p className="mt-2 text-2xl font-black text-slate-900">{formatDuration(total.session_seconds)}</p><p className="mt-1 text-xs text-slate-500">Last 30 days</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold text-slate-400">First seen</p><p className="mt-2 text-sm font-black text-slate-900">{total.first_seen ? new Date(total.first_seen).toLocaleString() : 'No sessions'}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold text-slate-400">Last activity</p><p className="mt-2 text-sm font-black text-slate-900">{total.last_seen ? new Date(total.last_seen).toLocaleString() : 'No activity'}</p></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><h3 className="font-black text-slate-900">30-day traffic rhythm</h3><p className="mt-1 text-xs text-slate-500">Daily download and upload totals</p></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-600">{formatBytes(combined)} total</span></div>{daily.length ? <div className="mt-6 flex h-48 items-end gap-1 overflow-x-auto">{daily.map((day) => { const down=Number(day.download_bytes||0); const up=Number(day.upload_bytes||0); const height=Math.max(4,Math.round(((down+up)/maxDay)*100)); return <div key={day.day} className="group flex min-w-[18px] flex-1 flex-col items-center justify-end gap-1"><div title={`${day.day}: ${formatBytes(down+up)}`} className="w-full rounded-t-md bg-violet-500 transition group-hover:bg-fuchsia-500" style={{height:`${height}%`}} /><span className="text-[8px] text-slate-400">{day.day.slice(5)}</span></div>; })}</div> : <p className="mt-8 text-center text-sm text-slate-400">No accounting data available yet.</p>}</section><section className="rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h3 className="font-black text-slate-900">Session history</h3><p className="mt-1 text-xs text-slate-500">Recent RADIUS sessions and traffic totals</p></div>{sessions.length ? <div className="divide-y divide-slate-100">{sessions.map((session, index) => <div key={`${session.acctstarttime}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-bold text-slate-800">{session.is_active ? 'Live session' : 'Completed session'}</p><p className="mt-1 text-xs text-slate-500">{session.acctstarttime ? new Date(session.acctstarttime).toLocaleString() : 'Unknown start'} · {session.framedipaddress || 'No IP'}</p></div><div className="text-right"><p className="text-xs font-black text-slate-700">↓ {formatBytes(session.download_bytes)} · ↑ {formatBytes(session.upload_bytes)}</p><p className="mt-1 text-[11px] text-slate-400">{formatDuration(session.acctsessiontime)}</p></div></div>)}</div> : <p className="p-8 text-center text-sm text-slate-400">No sessions recorded.</p>}</section></> : <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><h3 className="font-black text-slate-900">{tab[0].toUpperCase()+tab.slice(1)} sub-tab</h3><p className="mt-2 text-sm text-slate-500">This client record is ready for {tab} history and actions.</p></div>}</div>;
}
function StatusGlyph({ kind }) { const paths = { online: <><path d="M5 13.5a10 10 0 0 1 14 0" /><path d="M8 16.5a6 6 0 0 1 8 0" /><path d="M11 19.5a2 2 0 0 1 2 0" /></>, offline: <><circle cx="12" cy="9" r="3" /><path d="M6 20a6 6 0 0 1 12 0" /></>, expired: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></> }; return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-current/10"><svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg></span>; }
function TypeGlyph({ kind }) { const content = kind === 'pppoe' ? <><circle cx="9" cy="9" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="11" r="2" /><path d="M14 20a4 4 0 0 1 7 0" /></> : kind === 'static' ? <><circle cx="12" cy="12" r="2" /><path d="M12 4v6m0 4v6M4 12h6m4 0h6" /></> : <><path d="M5 13.5a10 10 0 0 1 14 0" /><path d="M8 16.5a6 6 0 0 1 8 0" /><path d="M11 19.5a2 2 0 0 1 2 0" /></>; return <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{content}</svg>; }export default function BillingSubscribers({ subscribers, items: sourceItems, networkClients = [], plans, hotspotPlans = [], routers = [], createOpen, setCreateOpen, search, setSearch, reload, setError, darkMode = false }) {
  const [menuId, setMenuId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [recharging, setRecharging] = useState(null);
  const [extending, setExtending] = useState(null);
  const [selectedSubscriber, setSelectedSubscriber] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [networkFilter, setNetworkFilter] = useState('all');
  const [subscriberType, setSubscriberType] = useState('pppoe');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(emptySubscriber);
  const [hotspotForm, setHotspotForm] = useState(emptyHotspot);
  const [typeChosen, setTypeChosen] = useState(false);

  useEffect(() => {
    if (!createOpen) {
      setCreating(
        emptySubscriber
      );

      setHotspotForm(
        emptyHotspot
      );

      setTypeChosen(false);
    }
  }, [createOpen]);

  const compactIdentity =
    value =>
      String(value || '')
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ''
        );

  const formatMac =
    value => {
      const compact =
        compactIdentity(value);

      if (
        !/^[0-9A-F]{12}$/.test(
          compact
        )
      ) {
        return '';
      }

      return compact
        .match(/.{2}/g)
        .join(':');
    };


  const realHotspotPackage =
    (...values) => {
      const genericProfile =
        /^(?:NEXA[-_\s]?HOTSPOT(?:[-_\s]?PROFILE)?|NEXA[-_\s]?PAID(?:[-_\s].*)?|DEFAULT)$/i;

      return (
        values
          .map(value =>
            String(
              value || ''
            ).trim()
          )
          .find(value =>
            value &&
            !genericProfile.test(
              value
            )
          ) ||
        'No active package'
      );
    };

  const normalizedNetworkClients =
    (Array.isArray(networkClients)
      ? networkClients
      : []
    ).map(client => {
      const networkIdentities =
        [
          client.username,
          client.account_number,
          client.mac_address,
          client.phone,
        ]
          .map(compactIdentity)
          .filter(Boolean);

      const managedSubscriber =
        subscribers.find(
          subscriber =>
            [
              subscriber.radius_username,
              subscriber.account_number,
              subscriber.static_mac,
              subscriber.phone,
            ]
              .map(compactIdentity)
              .filter(Boolean)
              .some(identity =>
                networkIdentities.includes(
                  identity
                )
              )
        );

      const serviceType =
        String(
          client.service_type ||
          ''
        ).toLowerCase();

      const hotspot =
        serviceType ===
        'hotspot';

      const macAddress =
        formatMac(
          client.mac_address ||
          (
            hotspot
              ? client.username
              : ''
          )
        );

      const networkName =
        hotspot
          ? (
              macAddress ||
              'Hotspot device'
            )
          : (
              managedSubscriber
                ?.full_name ||
              client.display_name ||
              client.username ||
              client.account_number ||
              'MikroTik client'
            );

      return {
        ...(managedSubscriber || {}),

        id:
          managedSubscriber?.id ||
          `mikrotik-${client.id}`,

        billing_id:
          managedSubscriber?.id ||
          null,

        mikrotik_id:
          client.id,

        is_mikrotik_live:
          true,

        service_type:
          serviceType,

        full_name:
          networkName,

        phone:
          hotspot
            ? (
                client.phone ||
                client.account_number ||
                ''
              )
            : (
                managedSubscriber
                  ?.phone ||
                client.phone ||
                ''
              ),

        email:
          managedSubscriber?.email ||
          '',

        account_number:
          hotspot
            ? (
                client.phone ||
                client.account_number ||
                managedSubscriber
                  ?.phone ||
                macAddress
              )
            : (
                client.account_number ||
                client.username
              ),

        radius_username:
          managedSubscriber
            ?.radius_username ||
          client.username,

        plan_id:
          managedSubscriber
            ?.plan_id ||
          null,

        plan_name:
          hotspot
            ? realHotspotPackage(
                client.package_name,
                client.profile,
                managedSubscriber
                  ?.plan_name
              )
            : (
                client.package_name ||
                client.profile ||
                managedSubscriber
                  ?.plan_name ||
                'No package'
              ),

        router_name:
          client.router_name ||
          managedSubscriber
            ?.router_name ||
          '',

        service_status:
          client.is_expired
            ? 'expired'
            : client.is_online
              ? 'active'
              : (
                  client.status ||
                  'offline'
                ),

        is_online:
          Boolean(
            client.is_online
          ),

        is_expired:
          Boolean(
            client.is_expired ||
            client.status ===
              'expired'
          ),

        expires_at:
          hotspot
            ? (
                client.expiry_date ||
                null
              )
            : (
                managedSubscriber
                  ?.expires_at ||
                client.expiry_date ||
                null
              ),

        mac_address:
          macAddress,

        ip_address:
          client.ip_address ||
          '',

        uptime:
          client.uptime ||
          '',

        last_seen:
          client.last_seen ||
          '',

        access_mode:
          serviceType === 'dhcp'
            ? 'dhcp_static'
            : 'pppoe',
      };
    });

  const isExpired =
    subscriber => {
      if (
        subscriber.is_expired ||
        subscriber.service_status ===
          'expired'
      ) {
        return true;
      }

      if (!subscriber.expires_at) {
        return false;
      }

      const expiry =
        new Date(
          subscriber.expires_at
        );

      return (
        !Number.isNaN(
          expiry.getTime()
        ) &&
        expiry <= new Date()
      );
    };

  const pppoeItems =
    (
      Array.isArray(
        subscribers
      )
        ? subscribers
        : []
    )
      .filter(
        subscriber => {
          const mode =
            String(
              subscriber.access_mode ||
              'pppoe'
            )
              .trim()
              .toLowerCase();

          return (
            mode !==
              'dhcp_static' &&
            mode !==
              'hotspot'
          );
        }
      )
      .map(
        subscriber => {
          const identities =
            [
              subscriber.radius_username,
              subscriber.account_number,
              subscriber.static_mac,
              subscriber.phone,
            ]
              .map(
                compactIdentity
              )
              .filter(
                Boolean
              );

          const liveClient =
            normalizedNetworkClients.find(
              networkClient => {
                if (
                  networkClient.billing_id &&
                  Number(
                    networkClient.billing_id
                  ) ===
                  Number(
                    subscriber.id
                  )
                ) {
                  return true;
                }

                const liveIdentities =
                  [
                    networkClient.radius_username,
                    networkClient.account_number,
                    networkClient.mac_address,
                    networkClient.phone,
                  ]
                    .map(
                      compactIdentity
                    )
                    .filter(
                      Boolean
                    );

                return identities.some(
                  identity =>
                    liveIdentities.includes(
                      identity
                    )
                );
              }
            );

          return {
            ...(liveClient || {}),
            ...subscriber,

            id:
              subscriber.id,

            billing_id:
              subscriber.id,

            service_type:
              'pppoe',

            full_name:
              subscriber.full_name ||
              liveClient?.full_name ||
              'PPPoE client',

            account_number:
              subscriber.account_number ||
              liveClient?.account_number ||
              '',

            radius_username:
              subscriber.radius_username ||
              liveClient?.radius_username ||
              '',

            plan_name:
              subscriber.plan_name ||
              liveClient?.plan_name ||
              'No package',

            router_name:
              subscriber.router_name ||
              liveClient?.router_name ||
              '',

            is_mikrotik_live:
              Boolean(
                liveClient
              ),

            is_online:
              Boolean(
                liveClient?.is_online
              ),

            ip_address:
              liveClient?.ip_address ||
              subscriber.static_ip ||
              '',

            mac_address:
              liveClient?.mac_address ||
              subscriber.static_mac ||
              '',

            uptime:
              liveClient?.uptime ||
              '',

            last_seen:
              liveClient?.last_seen ||
              '',
          };
        }
      );

  const staticItems =
    normalizedNetworkClients.filter(
      subscriber =>
        subscriber.service_type ===
        'dhcp'
    );

  const hotspotItems =
    normalizedNetworkClients.filter(
      subscriber =>
        subscriber.service_type ===
        'hotspot'
    );

  const selectedSource =
    subscriberType === 'hotspot'
      ? hotspotItems
      : subscriberType === 'static'
        ? staticItems
        : pppoeItems;

  const online =
    normalizedNetworkClients.filter(
      subscriber =>
        !isExpired(subscriber) &&
        subscriber.is_online
    ).length;

  const offline =
    normalizedNetworkClients.filter(
      subscriber =>
        !isExpired(subscriber) &&
        !subscriber.is_online
    ).length;

  const expiredCount =
    normalizedNetworkClients.filter(
      isExpired
    ).length;

  const searchText =
    String(search || '')
      .trim()
      .toLowerCase();

  const filteredItems =
    selectedSource.filter(
      subscriber => {
        const expired =
          isExpired(subscriber);

        if (
          networkFilter ===
          'expired'
        ) {
          if (!expired) {
            return false;
          }
        }

        if (
          networkFilter ===
          'online' &&
          (
            expired ||
            !subscriber.is_online
          )
        ) {
          return false;
        }

        if (
          networkFilter ===
          'offline' &&
          (
            expired ||
            subscriber.is_online
          )
        ) {
          return false;
        }

        if (!searchText) {
          return true;
        }

        return [
          subscriber.full_name,
          subscriber.account_number,
          subscriber.phone,
          subscriber.email,
          subscriber.mac_address,
          subscriber.ip_address,
          subscriber.router_name,
          subscriber.plan_name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(searchText);
      }
    );

  const pageSize = 8;

  const pageCount =
    Math.max(
      1,
      Math.ceil(
        filteredItems.length /
        pageSize
      )
    );

  const currentPage =
    Math.min(
      page,
      pageCount
    );

  const displayedItems =
    filteredItems.slice(
      (
        currentPage -
        1
      ) *
        pageSize,

      currentPage *
        pageSize
    );

  const items =
    displayedItems;


  const run = async (subscriber, action) => {
    try {
      setBusyId(subscriber.id);
      setError('');
      await action();
      setMenuId(null);
      await reload();
    } catch (error) {
      setError(error.response?.data?.error || error.response?.data?.errors?.[0]?.msg || 'Subscriber action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const suspend = (subscriber) => {
    if (
      subscriber.service_status ===
      'suspended'
    ) {
      return;
    }

    if (
      !window.confirm(
        `Suspend ${subscriber.full_name}? Their internet access will be disabled.`
      )
    ) {
      return;
    }

    void run(
      subscriber,
      () =>
        api.patch(
          `/billing-workspace/subscribers/${subscriber.id}`,
          {
            service_status:
              'suspended',
          }
        )
    );
  };

  const sync = (subscriber) => run(subscriber, () => api.post(`/billing-workspace/subscribers/${subscriber.id}/radius/sync`));
  const remove = (subscriber) => {
    if (!window.confirm(`Delete ${subscriber.full_name}? Their RADIUS access will be disabled first.`)) return;
    void run(subscriber, () => api.delete(`/billing-workspace/subscribers/${subscriber.id}`));
  };
  const extendSubscription = async (event) => {
    event.preventDefault();

    if (!extending) {
      return;
    }

    try {
      setBusyId(
        `extend-${extending.id}`
      );

      setError('');

      await api.post(
        `/billing-workspace/subscribers/${extending.id}/extend`,
        {
          days:
            Number(
              extending.days
            ),
        }
      );

      setExtending(
        null
      );

      await reload();
    } catch (error) {
      setError(
        error.response?.data?.error ||
        error.response?.data?.errors?.[0]?.msg ||
        'Could not extend subscription.'
      );
    } finally {
      setBusyId(
        null
      );
    }
  };

  const recharge = async (event) => {
    event.preventDefault();
    try {
      setBusyId(`recharge-${recharging.id}`);
      setError('');
      await api.post(`/billing-workspace/subscribers/${recharging.id}/recharge`, { plan_id: Number(recharging.plan_id), method: recharging.method || 'Recharge', reference: recharging.reference || null });
      setRecharging(null);
      await reload();
    } catch (error) {
      setError(error.response?.data?.error || error.response?.data?.errors?.[0]?.msg || 'Recharge failed.');
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    const subscriber = editing;
    await run(subscriber, () => api.patch(`/billing-workspace/subscribers/${subscriber.id}`, {
      full_name: subscriber.full_name,
      phone: subscriber.phone || null,
      email: subscriber.email || null,
      plan_id: subscriber.plan_id ? Number(subscriber.plan_id) : null,
      grace_period_days: Number(subscriber.grace_period_days || 0),
      service_status: subscriber.service_status,
      router_id: subscriber.router_id ? Number(subscriber.router_id) : null,
      vlan_id: subscriber.vlan_id ? Number(subscriber.vlan_id) : null,
    }));
    setEditing(null);
  };

  const saveCreate = async (event) => {
    event.preventDefault();
    if (!creating.account_number.trim()) { setError('Enter a client identifier / account number before adding the client.'); return; }
    try {
      setBusyId('create');
      setError('');
      await api.post('/billing-workspace/subscribers', {
        ...creating,
        plan_id: creating.plan_id ? Number(creating.plan_id) : null,
        router_id: creating.router_id ? Number(creating.router_id) : null,
        grace_period_days: Number(creating.grace_period_days || 0),
      });
      setCreating(emptySubscriber);
      setCreateOpen(false);
      await reload();
    } catch (error) {
      setError(error.response?.data?.error || error.response?.data?.errors?.[0]?.msg || 'Subscriber could not be created.');
    } finally {
      setBusyId(null);
    }
  };

  const saveHotspot = async (event) => {
    event.preventDefault();
    try {
      setBusyId('hotspot-create');
      setError('');
      await api.post('/billing-workspace/hotspot/vouchers', { plan_id: Number(hotspotForm.plan_id), quantity: Number(hotspotForm.quantity) });
      setHotspotForm(emptyHotspot);
      setCreateOpen(false);
      await reload();
    } catch (error) {
      setError(error.response?.data?.error || error.response?.data?.errors?.[0]?.msg || 'Hotspot access could not be generated.');
    } finally {
      setBusyId(null);
    }
  };
  if (createOpen && !typeChosen) return <ClientTypeChooser choose={(access_mode) => { setCreating({ ...emptySubscriber, access_mode }); setTypeChosen(true); }} close={() => { setCreating(emptySubscriber); setCreateOpen(false); }} />;
  if (createOpen && creating.access_mode === 'hotspot') return <HotspotClientForm value={hotspotForm} setValue={setHotspotForm} plans={hotspotPlans} busy={busyId === 'hotspot-create'} close={() => { setHotspotForm(emptyHotspot); setCreateOpen(false); }} submit={saveHotspot} />;
  if (selectedSubscriber) return <PppoeSubscriberDetail subscriber={selectedSubscriber} back={() => setSelectedSubscriber(null)} setError={setError} />;
  if (createOpen && ['pppoe_static', 'dhcp_static'].includes(creating.access_mode)) return <StaticClientForm value={creating} setValue={setCreating} plans={plans} routers={routers} busy={busyId === 'create'} close={() => { setCreating(emptySubscriber); setCreateOpen(false); }} submit={saveCreate} />;
  return <div data-subscriber-theme={darkMode ? 'dark' : 'light'} className={`-mx-5 -mt-5 min-h-screen space-y-4 pb-8 sm:-mx-8 sm:-mt-8 ${darkMode ? 'bg-[#0b1020] text-slate-100' : 'bg-[#fbfbff] text-slate-900'}`}><section className="relative isolate overflow-hidden bg-[#07090d] px-5 pb-20 pt-7 text-white sm:px-8 sm:pb-20 sm:pt-7" style={{ backgroundImage: `linear-gradient(115deg, rgba(3,22,13,.64), rgba(9,42,27,.58)), url(${polyizonLoginNetwork})`, backgroundSize: 'cover', backgroundPosition: 'center' }}><div className="relative z-10"><p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-violet-200">Subscriber management</p><h2 className="subscriber-hero-title mt-2 text-[2rem] font-semibold tracking-[-.03em] sm:text-[2.55rem]">Subscribers</h2><p className="mt-1.5 text-sm text-violet-100">View and manage all your subscribers</p></div><button type="button" onClick={() => setCreateOpen(true)} className="relative z-10 mt-5 rounded-xl bg-emerald-400 px-3.5 py-2 text-xs sm:text-sm font-extrabold text-emerald-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300 sm:absolute sm:right-8 sm:top-8 sm:mt-0">+ Add a client</button><div className="pointer-events-none absolute -bottom-1 left-0 right-0 z-0 h-24"><svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full"><path d="M0 100 C180 20 300 190 510 115 C720 40 780 175 1000 70 C1090 28 1140 65 1200 25 L1200 180 L0 180 Z" fill={darkMode ? '#0b1020' : '#fbfbff'} /></svg></div><div className="pointer-events-none absolute right-[-10%] top-4 h-44 w-3/5 opacity-20"><svg viewBox="0 0 600 180" className="h-full w-full"><path d="M0 120 C120 20 220 180 350 80 S520 20 600 70" fill="none" stroke="white" strokeWidth="2" /><path d="M0 145 C120 45 220 205 350 105 S520 45 600 95" fill="none" stroke="white" strokeWidth="1" /></svg></div></section>
    <style>{`.subscriber-hero-title{font-family:Georgia,Times,"Times New Roman",serif}.subscriber-type-tabs button.bg-violet-600{background:#10231f!important;color:#ecfff8!important;box-shadow:inset 0 0 0 1px rgba(76,214,160,.42)}.client-status-card{min-height:88px}.client-status-card svg{width:1.35rem!important;height:1.35rem!important}@media(min-width:640px){.client-status-card{padding:14px!important}.client-status-card .text-2xl{font-size:1.75rem;line-height:1.85rem}.client-status-card .text-xs{font-size:.72rem}.subscriber-type-tabs button{padding-top:.55rem!important;padding-bottom:.55rem!important}.subscriber-list-panel>div.grid{padding:12px 16px!important}}section > .grid.grid-cols-2.border-b{display:none}@media(max-width:639px){.client-status-meta{display:none}.client-status-card{min-height:92px;padding:10px!important}.client-status-card .text-xs{font-size:10px}.client-status-card .text-2xl{font-size:1.5rem;line-height:2rem}}@media(max-width:639px){table.min-w-\\[700px\\]{min-width:100%!important;table-layout:fixed}table.min-w-\\[700px\\] th,table.min-w-\\[700px\\] td{padding:8px 4px!important;font-size:9px!important;line-height:1.25;overflow-wrap:anywhere}table.min-w-\\[700px\\] th:first-child,table.min-w-\\[700px\\] td:first-child{width:29%;padding-left:8px!important}table.min-w-\\[700px\\] th:nth-child(2),table.min-w-\\[700px\\] td:nth-child(2){width:19%}table.min-w-\\[700px\\] th:nth-child(3),table.min-w-\\[700px\\] td:nth-child(3){width:18%}table.min-w-\\[700px\\] th:nth-child(4),table.min-w-\\[700px\\] td:nth-child(4){width:18%}table.min-w-\\[700px\\] th:last-child,table.min-w-\\[700px\\] td:last-child{width:16%;padding-right:8px!important}.overflow-x-auto:has(table.min-w-\\[700px\\]){overflow-x:visible!important}}`}</style>
    <style>{`
      [data-subscriber-theme="dark"] {
        color-scheme: dark;
        background:
          radial-gradient(circle at 85% 5%, rgba(124,58,237,.13), transparent 30%),
          #0b1020;
      }

      [data-subscriber-theme="dark"] .client-status-card {
        background: linear-gradient(145deg, #171d32 0%, #101527 100%) !important;
        border-color: #303956 !important;
        box-shadow: 0 14px 34px rgba(0,0,0,.24) !important;
      }

      [data-subscriber-theme="dark"] .client-status-card:hover {
        border-color: #7257db !important;
        transform: translateY(-1px);
      }

      [data-subscriber-theme="dark"] .subscriber-type-tabs,
      [data-subscriber-theme="dark"] .subscriber-list-panel {
        background: #11172a !important;
        border-color: #2c3553 !important;
        box-shadow: 0 16px 36px rgba(0,0,0,.20) !important;
      }

      [data-subscriber-theme="dark"] .subscriber-search-box,
      [data-subscriber-theme="dark"] button[aria-label="Filter subscribers"] {
        background: #0d1324 !important;
        border-color: #303a5c !important;
        color: #cbd5e1 !important;
      }

      [data-subscriber-theme="dark"] input,
      [data-subscriber-theme="dark"] select,
      [data-subscriber-theme="dark"] textarea {
        background-color: #0d1324 !important;
        border-color: #303a5c !important;
        color: #f8fafc !important;
      }

      [data-subscriber-theme="dark"] input::placeholder,
      [data-subscriber-theme="dark"] textarea::placeholder {
        color: #64748b !important;
      }

      [data-subscriber-theme="dark"] .bg-white {
        background-color: #11172a !important;
      }

      [data-subscriber-theme="dark"] .bg-slate-50 {
        background-color: #0d1324 !important;
      }

      [data-subscriber-theme="dark"] .bg-slate-100 {
        background-color: #202842 !important;
      }

      [data-subscriber-theme="dark"] .bg-violet-50,
      [data-subscriber-theme="dark"] .bg-violet-100 {
        background-color: rgba(124,58,237,.17) !important;
      }

      [data-subscriber-theme="dark"] .bg-emerald-100 {
        background-color: rgba(16,185,129,.17) !important;
      }

      [data-subscriber-theme="dark"] .bg-rose-100 {
        background-color: rgba(244,63,94,.17) !important;
      }

      [data-subscriber-theme="dark"] .border-slate-100,
      [data-subscriber-theme="dark"] .border-slate-200 {
        border-color: #29324d !important;
      }

      [data-subscriber-theme="dark"] .divide-slate-100 > :not([hidden]) ~ :not([hidden]) {
        border-color: #29324d !important;
      }

      [data-subscriber-theme="dark"] .text-slate-900,
      [data-subscriber-theme="dark"] .text-slate-800,
      [data-subscriber-theme="dark"] .text-slate-700,
      [data-subscriber-theme="dark"] .text-slate-600 {
        color: #e2e8f0 !important;
      }

      [data-subscriber-theme="dark"] .text-slate-500,
      [data-subscriber-theme="dark"] .text-slate-400 {
        color: #94a3b8 !important;
      }

      [data-subscriber-theme="dark"] thead {
        background: #0d1324 !important;
        color: #94a3b8 !important;
      }

      [data-subscriber-theme="dark"] tbody tr {
        background: #11172a;
      }

      [data-subscriber-theme="dark"] tbody tr:hover {
        background: #19213a !important;
      }

      [data-subscriber-theme="dark"] tbody td {
        border-color: #29324d !important;
      }

      [data-subscriber-theme="dark"] .subscriber-list-panel > div:last-child {
        border-color: #29324d !important;
      }

      @media (max-width: 639px) {
        [data-subscriber-theme="dark"] .client-status-card {
          background: linear-gradient(155deg, #192039, #101527) !important;
        }

        [data-subscriber-theme="dark"] .subscriber-type-tabs {
          margin-top: 8px;
        }
      }
    `}</style>

    <style>{`
      @media (max-width: 639px) {
        [data-subscriber-theme] .subscriber-mobile-lock {
          position: sticky;
          top: 0;
          z-index: 24;
          display: flex;
          height: calc(100dvh - 72px);
          min-height: 0;
          flex-direction: column;
          gap: 12px;
          margin-top: -4rem !important;
          padding-top: 8px;
          padding-bottom: 8px;
          overflow: hidden;
          background: #fbfbff;
          box-shadow: 0 -1px 0 rgba(148, 163, 184, 0.08);
        }

        [data-subscriber-theme="dark"] .subscriber-mobile-lock {
          background:
            radial-gradient(
              circle at 85% 0%,
              rgba(124, 58, 237, 0.12),
              transparent 35%
            ),
            #0b1020;
        }

        .subscriber-mobile-lock .subscriber-status-grid {
          position: relative;
          z-index: 3;
          flex: 0 0 auto;
          margin-top: 0 !important;
        }

        .subscriber-mobile-lock .subscriber-type-tabs {
          position: relative;
          z-index: 3;
          flex: 0 0 auto;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
        }

        .subscriber-mobile-lock .subscriber-list-panel {
          position: relative;
          z-index: 2;
          display: flex;
          flex: 1 1 auto;
          min-height: 0;
          flex-direction: column;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          overflow: hidden !important;
        }

        .subscriber-mobile-lock
          .subscriber-list-panel
          > .grid {
          flex: 0 0 auto;
        }

        .subscriber-mobile-lock .subscriber-list-scroll {
          flex: 1 1 auto;
          min-height: 0;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          overscroll-behavior-y: contain;
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
        }

        .subscriber-mobile-lock
          .subscriber-list-scroll
          table {
          min-height: max-content;
        }

        .subscriber-mobile-lock
          .subscriber-list-scroll
          thead {
          position: sticky;
          top: 0;
          z-index: 5;
        }

        .subscriber-mobile-lock
          .subscriber-list-panel
          > div:last-child {
          flex: 0 0 auto;
        }

        .subscriber-mobile-lock
          .subscriber-list-scroll::after {
          display: block;
          height: 18px;
          content: "";
        }
      }
    `}</style>

    <div className="subscriber-mobile-lock">
    <div className="subscriber-status-grid relative z-10 -mt-12 grid grid-cols-3 gap-2 px-5 sm:gap-4 sm:px-8">
      <button onClick={() => { setNetworkFilter(networkFilter === 'online' ? 'all' : 'online'); setPage(1); }} className={`client-status-card rounded-2xl border p-3.5 sm:p-4 text-left shadow-sm transition ${networkFilter === 'online' ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-emerald-100'} bg-gradient-to-br from-white to-emerald-50`}><div className="flex items-start gap-2 sm:gap-4 text-emerald-600"><StatusGlyph kind="online" /><div><div className="text-2xl font-black leading-none sm:text-3xl">{online}</div><div className="mt-1 text-xs font-black text-emerald-700 sm:mt-1 sm:text-sm">Online</div><p className="client-status-meta mt-1 text-sm text-emerald-700/70">Active MikroTik sessions</p></div></div></button>
      <button onClick={() => { setNetworkFilter(networkFilter === 'offline' ? 'all' : 'offline'); setPage(1); }} className={`client-status-card rounded-2xl border p-3.5 sm:p-4 text-left shadow-sm transition ${networkFilter === 'offline' ? 'border-violet-400 ring-2 ring-violet-200' : 'border-violet-100'} bg-gradient-to-br from-white to-violet-50`}><div className="flex items-start gap-2 sm:gap-4 text-violet-600"><StatusGlyph kind="offline" /><div><div className="text-2xl font-black leading-none sm:text-3xl">{offline}</div><div className="mt-1 text-xs font-black text-violet-700 sm:mt-1 sm:text-sm">Offline</div><p className="client-status-meta mt-1 text-sm text-violet-700/70">No active session</p></div></div></button>
      <button onClick={() => { setNetworkFilter(networkFilter === 'expired' ? 'all' : 'expired'); setPage(1); }} className={`client-status-card rounded-2xl border p-3.5 sm:p-4 text-left shadow-sm transition ${networkFilter === 'expired' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-rose-100'} bg-gradient-to-br from-white to-rose-50`}><div className="flex items-start gap-2 sm:gap-4 text-rose-600"><StatusGlyph kind="expired" /><div><div className="text-2xl font-black leading-none sm:text-3xl">{expiredCount}</div><div className="mt-1 text-xs font-black text-rose-700 sm:mt-1 sm:text-sm">Expired</div><p className="client-status-meta mt-1 text-sm text-rose-700/70">Recharge required</p></div></div></button>
    </div>
    <div className="subscriber-type-tabs mx-5 grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-sm sm:mx-8"><button onClick={() => { setSubscriberType('pppoe'); setPage(1); }} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-extrabold sm:text-sm ${subscriberType === 'pppoe' ? 'bg-violet-600 text-white' : 'text-slate-500'}`}><TypeGlyph kind="pppoe" /><span>PPPoE</span><span className="rounded-full bg-current/10 px-2 py-0.5">{pppoeItems.length}</span></button><button onClick={() => { setSubscriberType('static'); setPage(1); }} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-extrabold sm:text-sm ${subscriberType === 'static' ? 'bg-violet-600 text-white' : 'text-slate-500'}`}><TypeGlyph kind="static" /><span>Static</span><span className="rounded-full bg-current/10 px-2 py-0.5">{staticItems.length}</span></button><button onClick={() => { setSubscriberType('hotspot'); setPage(1); }} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-extrabold sm:text-sm ${subscriberType === 'hotspot' ? 'bg-violet-600 text-white' : 'text-slate-500'}`}><TypeGlyph kind="hotspot" /><span>Hotspot</span><span className="rounded-full bg-current/10 px-2 py-0.5">{hotspotItems.length}</span></button></div>    <section className="subscriber-list-panel overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-2 border-b border-slate-200 px-4 pt-4"><button onClick={() => setSubscriberType('pppoe')} className={`border-b-2 px-2 pb-3 text-sm font-extrabold ${subscriberType === 'pppoe' ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500'}`}>PPPoE Clients <span className="ml-2 rounded-full bg-violet-100 px-2 py-1 text-xs">{pppoeItems.length}</span></button><button onClick={() => setSubscriberType('hotspot')} className={`border-b-2 px-2 pb-3 text-sm font-extrabold ${subscriberType === 'hotspot' ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500'}`}>Hotspot Users <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs">{hotspotItems.length}</span></button></div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-100 p-4 sm:p-5">
        <label className="subscriber-search-box flex min-h-14 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/10">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-slate-500 stroke-2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" placeholder="Search subscribers…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <button aria-label="Filter subscribers" onClick={() => { setNetworkFilter(networkFilter === 'all' ? 'online' : networkFilter === 'online' ? 'offline' : networkFilter === 'offline' ? 'expired' : 'all'); setPage(1); }} className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border px-4 text-xs font-extrabold shadow-sm sm:px-5 sm:text-sm ${networkFilter === 'all' ? 'border-slate-200 bg-white text-slate-600' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/></svg>
          <span className="hidden min-[360px]:inline">Filters{networkFilter !== 'all' ? `: ${networkFilter}` : ''}</span>
        </button>
      </div>

      {items.length ? (
        <div className="subscriber-list-scroll overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">
                  Device
                </th>

                <th className="px-3 py-3">
                  Package
                </th>

                <th className="px-3 py-3">
                  {subscriberType ===
                  'hotspot'
                    ? 'Paying phone'
                    : 'Network'}
                </th>

                <th className="px-3 py-3">
                  Status
                </th>

                <th className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {items.map(
                subscriber => {
                  const managedSubscriberId =
                    subscriber.billing_id ||
                    (
                      subscriber.id &&
                      !String(
                        subscriber.id
                      ).startsWith(
                        'mikrotik-'
                      )
                        ? subscriber.id
                        : null
                    );

                  const canManage =
                    subscriberType ===
                    'pppoe'
                      ? true
                      : Boolean(
                          managedSubscriberId
                        );

                  const actionSubscriber =
                    canManage
                      ? {
                          ...subscriber,

                          id:
                            managedSubscriberId,

                          billing_id:
                            managedSubscriberId,
                        }
                      : subscriber;

                  const initials =
                    subscriber
                      .service_type ===
                      'hotspot'
                      ? (
                          subscriber
                            .mac_address
                            ?.replace(
                              /:/g,
                              ''
                            )
                            .slice(-2) ||
                          'HS'
                        )
                      : (
                          subscriber
                            .full_name
                            ?.split(/\s+/)
                            .map(
                              part =>
                                part[0]
                            )
                            .join('')
                            .slice(0, 2)
                            .toUpperCase() ||
                          'MT'
                        );

                  return (
                    <tr
                      key={
                        subscriber.id
                      }
                      onClick={() => {
                        if (canManage) {
                          setSelectedSubscriber(
                            actionSubscriber
                          );
                        }
                      }}
                      className={`transition hover:bg-violet-50/50 ${
                        canManage
                          ? 'cursor-pointer'
                          : 'cursor-default'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-black text-violet-700">
                            {initials}
                          </div>

                          <div>
                            <div className="font-bold text-slate-800">
                              {
                                subscriber.full_name
                              }
                            </div>

                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-sm text-slate-600">
                        <span className="rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">
                          {
                            subscriber.plan_name ||
                            'No package'
                          }
                        </span>
                      </td>

                      <td className="px-3 py-4 text-sm text-slate-600">
                        <div>
                          {subscriber.account_number ||
                            subscriber.phone ||
                            'No payment phone'}
                        </div>

                        <div className="mt-1 text-[10px] font-semibold text-violet-500">
                          {subscriber.router_name ||
                            'MikroTik'}
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${
                            isExpired(
                              subscriber
                            )
                              ? 'bg-rose-100 text-rose-700'
                              : subscriber.is_online
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isExpired(
                            subscriber
                          )
                            ? 'Expired'
                            : subscriber.is_online
                              ? 'Online'
                              : 'Offline'}
                        </span>
                      </td>

                      <td className="relative px-4 py-4 text-right">

                        <button
                          type="button"
                          aria-label={`Actions for ${subscriber.full_name}`}
                          title={
                            canManage
                              ? 'Subscriber actions'
                              : 'This MikroTik entry is not linked to a billing subscriber'
                          }
                          onClick={event => {
                            event.stopPropagation();

                            setMenuId(
                              menuId ===
                                subscriber.id
                                ? null
                                : subscriber.id
                            );
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xl font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                        >
                          ⋮
                        </button>


                        {menuId ===
                          subscriber.id && (
                          <div
                            className="absolute right-3 top-12 z-50 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 text-left shadow-2xl shadow-slate-300/50"
                            onClick={event =>
                              event.stopPropagation()
                            }
                          >

                            <button
                              type="button"
                              disabled={
                                !canManage ||
                                subscriber.service_status ===
                                  'suspended'
                              }
                              onClick={() => {
                                suspend(
                                  actionSubscriber
                                );

                                setMenuId(
                                  null
                                );
                              }}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] font-black text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <span>
                                Suspend
                              </span>

                              <span>
                                Ⅱ
                              </span>
                            </button>


                            <button
                              type="button"
                              disabled={
                                !canManage
                              }
                              onClick={() => {
                                setExtending({
                                  ...actionSubscriber,

                                  days:
                                    '7',
                                });

                                setMenuId(
                                  null
                                );
                              }}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <span>
                                Extend
                              </span>

                              <span>
                                +
                              </span>
                            </button>


                            <button
                              type="button"
                              disabled={
                                !canManage ||
                                !subscriber.radius_username
                              }
                              onClick={() => {
                                sync(
                                  actionSubscriber
                                );

                                setMenuId(
                                  null
                                );
                              }}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <span>
                                Sync
                              </span>

                              <span>
                                ↻
                              </span>
                            </button>


                            <div className="my-1 border-t border-slate-100" />


                            <button
                              type="button"
                              disabled={
                                !canManage
                              }
                              onClick={() => {
                                remove(
                                  actionSubscriber
                                );

                                setMenuId(
                                  null
                                );
                              }}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <span>
                                Delete
                              </span>

                              <span>
                                ×
                              </span>
                            </button>


                            <button
                              type="button"
                              disabled={
                                !canManage
                              }
                              onClick={() => {
                                setSelectedSubscriber(
                                  actionSubscriber
                                );

                                setMenuId(
                                  null
                                );
                              }}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] font-black text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <span>
                                More details
                              </span>

                              <span>
                                →
                              </span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-slate-500">
          No matching live MikroTik devices.
        </div>
      )}

      {filteredItems.length > 0 && <div className="flex items-center justify-between border-t border-slate-100 p-4 text-xs text-slate-500"><span>Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredItems.length)} of {filteredItems.length} subscriber{filteredItems.length === 1 ? '' : 's'}</span><div className="flex items-center gap-2"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40">‹</button><span className="rounded-lg bg-violet-600 px-3 py-2 font-black text-white">{currentPage}</span><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40">›</button></div></div>}
    </section>
    </div>
    {extending && (
      <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5">

        <button
          type="button"
          onClick={() =>
            setExtending(
              null
            )
          }
          className="absolute inset-0"
        />

        <form
          onSubmit={
            extendSubscription
          }
          className="relative z-10 w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6"
        >

          <div className="flex items-start justify-between gap-4">

            <div>

              <p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-500">
                Subscription
              </p>

              <h3 className="mt-1 text-xl font-black text-slate-950">
                Extend subscription
              </h3>

              <p className="mt-1 text-xs text-slate-400">
                {extending.full_name}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setExtending(
                  null
                )
              }
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500"
            >
              ×
            </button>
          </div>


          <div className="mt-5 rounded-2xl bg-emerald-50 p-4">

            <span className="text-[8px] font-black uppercase text-emerald-600">
              Current expiry
            </span>

            <strong className="mt-1 block text-sm text-emerald-900">
              {extending.expires_at
                ? new Date(
                    extending.expires_at
                  ).toLocaleString()
                : 'No expiry set'}
            </strong>
          </div>


          <div className="mt-5 grid grid-cols-4 gap-2">

            {[1, 7, 14, 30].map(
              days => (
                <button
                  type="button"
                  key={days}
                  onClick={() =>
                    setExtending({
                      ...extending,

                      days:
                        String(
                          days
                        ),
                    })
                  }
                  className={`rounded-xl border px-2 py-3 text-[10px] font-black ${
                    Number(
                      extending.days
                    ) === days
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  {days}d
                </button>
              )
            )}
          </div>


          <label className="mt-5 block">

            <span className="text-xs font-black text-slate-600">
              Number of days
            </span>

            <input
              required
              type="number"
              min="1"
              max="365"
              value={
                extending.days ||
                ''
              }
              onChange={
                event =>
                  setExtending({
                    ...extending,

                    days:
                      event
                        .target
                        .value,
                  })
              }
              className={`${field} mt-2`}
            />
          </label>


          <p className="mt-3 text-[9px] leading-5 text-slate-400">
            Days are added to the current expiry. Expired or suspended customers are reactivated and synchronized with RADIUS.
          </p>


          <button
            disabled={
              busyId ===
              `extend-${extending.id}`
            }
            className="mt-5 w-full rounded-xl bg-emerald-500 py-3 text-xs font-black text-emerald-950 disabled:opacity-50"
          >
            {busyId ===
            `extend-${extending.id}`
              ? 'Extending...'
              : 'Extend subscription'}
          </button>
        </form>
      </div>
    )}

    {recharging && <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5"><form onSubmit={recharge} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Recharge client</h3><p className="mt-1 text-xs text-slate-500">Choose the package to reactivate {recharging.full_name}.</p></div><button type="button" onClick={() => setRecharging(null)} className="text-2xl text-slate-400">×</button></div><div className="mt-4 space-y-3"><select required className={field} value={recharging.plan_id || ''} onChange={(event) => setRecharging({ ...recharging, plan_id: event.target.value })}><option value="">Select package</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.price}</option>)}</select><input className={field} value={recharging.method || ''} onChange={(event) => setRecharging({ ...recharging, method: event.target.value })} placeholder="Payment method" /><input className={field} value={recharging.reference || ''} onChange={(event) => setRecharging({ ...recharging, reference: event.target.value })} placeholder="Payment reference (optional)" /><p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">The selected package will be paid, assigned, and the client reactivated.</p><button disabled={busyId === `recharge-${recharging.id}`} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{busyId === `recharge-${recharging.id}` ? 'Recharging…' : 'Recharge client'}</button></div></form></div>}    {editing && <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5"><form onSubmit={saveEdit} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><h3 className="text-lg font-black">Edit subscriber</h3><button type="button" onClick={() => setEditing(null)} className="text-2xl text-slate-400">×</button></div><div className="mt-4 space-y-3"><input required className={field} value={editing.full_name} onChange={(event) => setEditing({ ...editing, full_name: event.target.value })} placeholder="Full name" /><input className={field} value={editing.phone || ''} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} placeholder="Phone" /><input type="email" className={field} value={editing.email || ''} onChange={(event) => setEditing({ ...editing, email: event.target.value })} placeholder="Email" /><select className={field} value={editing.plan_id || ''} onChange={(event) => setEditing({ ...editing, plan_id: event.target.value })}><option value="">No package</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><select className={field} value={editing.router_id || ''} onChange={(event) => setEditing({ ...editing, router_id: event.target.value })}><option value="">No router assigned</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}{router.last_status ? ` — ${router.last_status}` : ''}</option>)}</select><label className="block text-xs font-bold text-slate-600">VLAN ID (optional)<input type="number" min="1" max="4094" className={field + ' mt-1.5'} value={editing.vlan_id || ''} onChange={(event) => setEditing({ ...editing, vlan_id: event.target.value })} placeholder="Leave blank for no VLAN" /></label><div className="grid grid-cols-3 gap-3"><input type="number" min="0" max="90" className={field} value={editing.grace_period_days || 0} onChange={(event) => setEditing({ ...editing, grace_period_days: event.target.value })} aria-label="Grace period days" /><select className={field} value={editing.service_status} onChange={(event) => setEditing({ ...editing, service_status: event.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option><option value="pending">Pending</option></select></div><button disabled={busyId === editing.id} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">Save changes</button></div></form></div>}
    {createOpen && <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5"><form onSubmit={saveCreate} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Add subscriber</h3><p className="mt-1 text-xs text-slate-500">Assign this customer to the MikroTik that serves their connection.</p></div><button type="button" onClick={() => setCreateOpen(false)} className="text-2xl text-slate-400">×</button></div><div className="mt-4 space-y-3"><input required className={field} value={creating.full_name} onChange={(event) => setCreating({ ...creating, full_name: event.target.value })} placeholder="Full name" /><input required className={field} value={creating.account_number} onChange={(event) => setCreating({ ...creating, account_number: event.target.value })} placeholder="Client identifier / account number" /><div className="grid grid-cols-3 gap-3"><input className={field} value={creating.phone} onChange={(event) => setCreating({ ...creating, phone: event.target.value })} placeholder="Phone" /><input type="email" className={field} value={creating.email} onChange={(event) => setCreating({ ...creating, email: event.target.value })} placeholder="Email" /></div><select className={field} value={creating.plan_id} onChange={(event) => setCreating({ ...creating, plan_id: event.target.value })}><option value="">Select package later</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><select className={field} value={creating.router_id} onChange={(event) => setCreating({ ...creating, router_id: event.target.value })}><option value="">Select router later</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}{router.last_status ? ` — ${router.last_status}` : ''}</option>)}</select><label className="block text-xs font-bold text-slate-600">VLAN ID (optional)<input type="number" min="1" max="4094" className={field + ' mt-1.5'} value={creating.vlan_id} onChange={(event) => setCreating({ ...creating, vlan_id: event.target.value })} placeholder="Leave blank for no VLAN" /></label>{!routers.length && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">No MikroTik has been added to this billing account yet.</p>}<label className="block text-xs font-bold text-slate-600">Grace period days<input type="number" min="0" max="90" className={`${field} mt-1.5`} value={creating.grace_period_days} onChange={(event) => setCreating({ ...creating, grace_period_days: event.target.value })} /></label><button disabled={busyId === 'create'} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{busyId === 'create' ? 'Adding…' : 'Add subscriber'}</button></div></form></div>}
  </div>;
}
