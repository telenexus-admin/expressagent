import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

const ROUTES = ['dashboard', 'accounts', 'create_account', 'admin_users'];
const navItems = [
  ['dashboard', 'Dashboard', '▦'],
  ['accounts', 'ISP accounts', '◫'],
  ['create_account', 'Create ISP', '+'],
  ['admin_users', 'Master admins', '♙'],
];

const blankAccount = { isp_name: '', business_name: '', contact_email: '', admin_name: '', admin_email: '', admin_password: '', account_status: 'trial', billing_plan: 'Starter', trial_ends_at: '', domain_slug: '' };

function money(value) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value || 0));
}
function date(value) {
  return value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}
function titleFor(route) {
  return { dashboard: 'System dashboard', accounts: 'ISP accounts', create_account: 'Create ISP account', admin_users: 'Master admin users' }[route];
}

export default function BillingAdminPanel() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const activeRoute = ROUTES.includes(params.get('app_route')) ? params.get('app_route') : 'dashboard';
  const [menuOpen, setMenuOpen] = useState(false);
  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [masterAdmins, setMasterAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const setRoute = (route) => {
    setNotice(''); setError(''); setMenuOpen(false);
    setParams({ app_route: route });
  };
  const load = async () => {
    setLoading(true);
    try {
      const [summary, accountList, admins] = await Promise.all([
        api.get('/billing-operator/overview'), api.get('/billing-operator/accounts'), api.get('/admins'),
      ]);
      setOverview(summary.data);
      setAccounts(accountList.data);
      setMasterAdmins(admins.data.filter((item) => item.role === 'superadmin'));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load the billing operator console.');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const switchStatus = async (account, account_status) => {
    try {
      await api.patch(`/billing-operator/accounts/${account.id}/status`, { account_status });
      setNotice(`${account.name} is now ${account_status}.`);
      await load();
    } catch (err) { setError(err.response?.data?.error || 'Status update failed.'); }
  };

  const updateAccount = async (account, payload) => {
    try { await api.patch(`/billing-operator/accounts/${account.id}`, payload); setNotice(`${account.name} was updated.`); await load(); }
    catch (err) { setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not update ISP account.'); throw err; }
  };
  const extendSubscription = async (account, trial_ends_at) => {
    try { await api.post(`/billing-operator/accounts/${account.id}/extend`, { trial_ends_at }); setNotice(`${account.name}'s subscription was extended.`); await load(); }
    catch (err) { setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not extend subscription.'); throw err; }
  };
  const deleteAccount = async (account, confirm_name) => {
    try { await api.delete(`/billing-operator/accounts/${account.id}`, { data: { confirm_name } }); setNotice(`${account.name} was deleted.`); await load(); }
    catch (err) { setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not delete ISP account.'); throw err; }
  };
  const signOut = () => { logout(); navigate('/onboarding/login'); };
  const total = overview?.summary || {};

  return (
    <div className="min-h-screen bg-[#f5f6fc] text-[#121832]">
      <header className="sticky top-0 z-30 border-b border-[#e7e9f5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMenuOpen(!menuOpen)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#e4e6f1] text-xl font-semibold hover:bg-[#f4f1ff]" aria-label="Open navigation">☰</button>
            <div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#7654ef]">Nexa billing</div><div className="text-base font-extrabold sm:text-lg">{titleFor(activeRoute)}</div></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block"><div className="text-xs font-bold">{admin?.name || 'System operator'}</div><div className="text-[11px] text-slate-500">Master admin</div></div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#5630db] to-[#bd4ae8] text-sm font-bold text-white">{(admin?.name || 'N').slice(0, 1).toUpperCase()}</div>
          </div>
        </div>
      </header>

      <aside className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-[#12152a] p-5 text-white shadow-2xl transition-transform ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-8 flex items-center justify-between"><div><div className="text-lg font-extrabold">Nexa</div><div className="text-xs text-slate-400">Billing operator console</div></div><button onClick={() => setMenuOpen(false)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close navigation">×</button></div>
        <nav className="space-y-1">{navItems.map(([route, label, icon]) => <button key={route} onClick={() => setRoute(route)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeRoute === route ? 'bg-[#7041ef] text-white' : 'text-slate-300 hover:bg-white/10'}`}><span className="grid h-6 w-6 place-items-center text-lg">{icon}</span>{label}</button>)}</nav>
        <div className="absolute bottom-5 left-5 right-5"><button onClick={signOut} className="w-full rounded-xl border border-white/15 px-3 py-3 text-sm font-bold text-slate-200 hover:bg-white/10">Sign out</button></div>
      </aside>
      {menuOpen && <button aria-label="Close navigation overlay" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-30 bg-slate-950/35" />}

      <main className="mx-auto max-w-7xl p-4 pb-12 sm:p-6">
        {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        {activeRoute === 'dashboard' && <Dashboard total={total} recent={overview?.recent_isps || []} loading={loading} openAccounts={() => setRoute('accounts')} openCreate={() => setRoute('create_account')} />}
        {activeRoute === 'accounts' && <Accounts accounts={accounts} loading={loading} onStatus={switchStatus} onUpdate={updateAccount} onExtend={extendSubscription} onDelete={deleteAccount} onCreate={() => setRoute('create_account')} />}
        {activeRoute === 'create_account' && <CreateAccount onCreated={async (name, domain, domainError) => { setNotice(domain ? `${name} is ready. ${domain.domain} is active.` : domainError ? `${name} is ready, but domain setup needs attention.` : `${name} is ready. Domain setup is pending.`); await load(); setRoute('accounts'); }} />}
        {activeRoute === 'admin_users' && <MasterAdmins admins={masterAdmins} loading={loading} onCreated={async () => { setNotice('Master administrator created.'); await load(); }} />}
      </main>
    </div>
  );
}

function DomainStatus({ account }) {
  const state = account.domain_status || 'pending';
  const active = state === 'active';
  const label = active ? 'Active' : account.domain ? 'Checking DNS' : 'Needs setup';
  const tone = active ? 'bg-emerald-50 text-emerald-700' : state === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700';
  return <div className="min-w-0"><div className="truncate text-sm font-semibold">{account.domain ? <a className="text-[#6332e5] hover:underline" href={`https://${account.domain}`} target="_blank" rel="noreferrer">{account.domain}</a> : '—'}</div><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ${tone}`}>{label}</span></div>;
}
function Dashboard({ total, recent, loading, openAccounts, openCreate }) {
  const stats = [['Total ISPs', total.total_isps, 'bg-violet-50 text-violet-700'], ['Active ISPs', total.active_isps, 'bg-emerald-50 text-emerald-700'], ['Trial ISPs', total.trial_isps, 'bg-amber-50 text-amber-700'], ['Suspended', total.suspended_isps, 'bg-rose-50 text-rose-700'], ['Revenue', money(total.revenue), 'bg-sky-50 text-sky-700'], ['Plans', total.total_plans, 'bg-indigo-50 text-indigo-700']];
  return <div className="space-y-6"><section className="rounded-3xl bg-gradient-to-br from-[#26117f] via-[#5324cb] to-[#a53be1] px-5 py-6 text-white shadow-xl sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-white/70">Billing system control</div><h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">Every ISP account, clearly separated.</h1><p className="mt-2 max-w-2xl text-sm text-white/80">Create and manage only billing workspaces. Subscribers, routers, RADIUS, packages, payments and AI evidence stay isolated inside each ISP.</p></div><button onClick={openCreate} className="rounded-xl bg-[#36d5a4] px-4 py-3 text-sm font-extrabold text-[#092b27] shadow-lg hover:bg-[#4be3b4]">+ Onboard ISP</button></div></section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">{stats.map(([label, value, tone]) => <div key={label} className="rounded-2xl border border-white bg-white p-4 shadow-sm"><div className={`mb-3 grid h-9 w-9 place-items-center rounded-xl ${tone}`}>●</div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-extrabold">{loading ? '—' : value}</div></div>)}</section>
    <section className="overflow-hidden rounded-2xl border border-[#e6e8f2] bg-white shadow-sm"><div className="flex items-center justify-between border-b border-[#eef0f6] px-5 py-4"><div><h2 className="font-extrabold">Recent ISPs</h2><p className="text-xs text-slate-500">Newest billing accounts</p></div><button onClick={openAccounts} className="text-sm font-bold text-[#6736e8]">View all</button></div><div className="divide-y divide-[#eef0f6]">{loading ? <div className="p-8 text-center text-sm text-slate-400">Loading billing accounts…</div> : recent.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No billing ISP accounts yet. Start by onboarding the first ISP.</div> : recent.map((account) => <div key={account.id} className="flex items-center gap-3 px-5 py-4"><Initial name={account.name}/><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{account.name}</div><div className="text-xs text-slate-500">{account.billing_plan} · created {date(account.created_at)}</div></div><Status value={account.billing_account_status}/></div>)}</div></section></div>;
}

function Accounts({ accounts, loading, onStatus, onUpdate, onExtend, onDelete, onCreate }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const visible = useMemo(() => accounts.filter((account) => (filter === 'all' || account.billing_account_status === filter) && `${account.name} ${account.business_name || ''} ${account.contact_email || ''} ${account.domain || ''}`.toLowerCase().includes(query.toLowerCase())), [accounts, filter, query]);
  const account = dialog?.account;
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-[#7654ef]">Billing tenants</div><h1 className="mt-1 text-2xl font-extrabold">ISP accounts</h1><p className="mt-1 text-sm text-slate-500">Each row is an isolated billing account.</p></div><button onClick={onCreate} className="rounded-xl bg-[#6231e5] px-4 py-3 text-sm font-extrabold text-white shadow-lg">+ Create ISP</button></div><div className="flex flex-wrap gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ISP accounts" className="min-w-[220px] flex-1 rounded-xl border border-[#dfe2ee] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#7144e8]"/>{['all', 'active', 'trial', 'suspended'].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-xl px-3 py-2.5 text-xs font-bold capitalize ${filter === item ? 'bg-[#ece6ff] text-[#6331e2]' : 'border border-[#e3e5ef] bg-white text-slate-500'}`}>{item}</button>)}</div><section className="overflow-x-auto rounded-2xl border border-[#e6e8f2] bg-white shadow-sm"><div className="min-w-[980px]"><div className="grid grid-cols-[minmax(190px,2fr)_1fr_minmax(150px,1fr)_100px_110px_130px_100px] gap-4 border-b border-[#eef0f6] px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500"><span>ISP</span><span>Plan</span><span>Domain</span><span>Subscribers</span><span>Revenue</span><span>Status</span><span>Actions</span></div>{loading ? <div className="p-8 text-center text-sm text-slate-400">Loading ISP accounts...</div> : visible.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No matching ISP accounts.</div> : visible.map((item) => <div key={item.id} className="grid grid-cols-[minmax(190px,2fr)_1fr_minmax(150px,1fr)_100px_110px_130px_100px] items-center gap-4 border-b border-[#f0f1f6] px-5 py-4 last:border-0"><div className="flex min-w-0 items-center gap-3"><Initial name={item.name}/><div className="min-w-0"><div className="truncate text-sm font-bold">{item.name}</div><div className="truncate text-xs text-slate-500">{item.contact_email || item.business_name || 'No contact email'}</div></div></div><div className="text-sm">{item.billing_plan || 'Starter'}</div><DomainStatus account={item}/><div className="text-sm">{item.subscriber_count}</div><div className="text-sm font-bold">{money(item.revenue)}</div><select value={item.billing_account_status} onChange={(event) => onStatus(item, event.target.value)} className="rounded-lg border border-[#e0e3ee] bg-white px-2 py-1.5 text-xs font-bold text-slate-700"><option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Suspended</option></select><button onClick={() => setDialog({ kind: 'menu', account: item })} className="rounded-lg border border-[#ded5ff] px-3 py-2 text-xs font-extrabold text-[#6231e5] hover:bg-[#f5f1ff]">Actions</button></div>)}</div></section>{dialog?.kind === 'menu' && <ActionMenu account={account} onClose={() => setDialog(null)} onEdit={() => setDialog({ kind: 'edit', account })} onExtend={() => setDialog({ kind: 'extend', account })} onSuspend={() => { onStatus(account, account.billing_account_status === 'suspended' ? 'active' : 'suspended'); setDialog(null); }} onDelete={() => setDialog({ kind: 'delete', account })} />}{dialog?.kind === 'edit' && <EditAccountDialog account={account} onClose={() => setDialog(null)} onSave={async (payload) => { await onUpdate(account, payload); setDialog(null); }} />}{dialog?.kind === 'extend' && <ExtendSubscriptionDialog account={account} onClose={() => setDialog(null)} onSave={async (value) => { await onExtend(account, value); setDialog(null); }} />}{dialog?.kind === 'delete' && <DeleteAccountDialog account={account} onClose={() => setDialog(null)} onDelete={async (value) => { await onDelete(account, value); setDialog(null); }} />}</div>;
}

function Dialog({ title, children, onClose }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold">{title}</h2><button onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close">×</button></div>{children}</div></div>; }
function ActionMenu({ account, onClose, onEdit, onExtend, onSuspend, onDelete }) { return <Dialog title={`Manage ${account.name}`} onClose={onClose}><div className="grid gap-2"><button onClick={onEdit} className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-bold hover:bg-slate-50">Edit ISP information</button><button onClick={onExtend} className="rounded-xl border border-[#ded5ff] bg-[#f8f5ff] px-4 py-3 text-left text-sm font-bold text-[#6231e5]">Extend subscription</button><button onClick={onSuspend} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-bold text-amber-800">{account.billing_account_status === 'suspended' ? 'Reactivate ISP' : 'Suspend ISP'}</button><button onClick={onDelete} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm font-bold text-rose-700">Delete empty ISP</button></div></Dialog>; }
function EditAccountDialog({ account, onClose, onSave }) { const [form, setForm] = useState({ isp_name: account.name || '', business_name: account.business_name || '', contact_email: account.contact_email || '', billing_plan: account.billing_plan || 'Starter', trial_ends_at: account.billing_trial_ends_at ? String(account.billing_trial_ends_at).slice(0, 10) : '' }); const [busy, setBusy] = useState(false); const submit = async (event) => { event.preventDefault(); setBusy(true); try { await onSave(form); } finally { setBusy(false); } }; const set = (key, value) => setForm((current) => ({ ...current, [key]: value })); return <Dialog title="Edit ISP information" onClose={onClose}><form onSubmit={submit} className="grid gap-3"><Field label="ISP name" value={form.isp_name} onChange={(value) => set('isp_name', value)} required/><Field label="Business name" value={form.business_name} onChange={(value) => set('business_name', value)}/><Field label="Account email" type="email" value={form.contact_email} onChange={(value) => set('contact_email', value)} required/><Field label="Subscription plan" value={form.billing_plan} onChange={(value) => set('billing_plan', value)} required/><Field label="Subscription end date" type="date" value={form.trial_ends_at} onChange={(value) => set('trial_ends_at', value)}/><button disabled={busy} className="mt-2 rounded-xl bg-[#6231e5] px-4 py-3 text-sm font-extrabold text-white disabled:opacity-60">{busy ? 'Saving...' : 'Save changes'}</button></form></Dialog>; }
function ExtendSubscriptionDialog({ account, onClose, onSave }) { const [dateValue, setDateValue] = useState(account.billing_trial_ends_at ? String(account.billing_trial_ends_at).slice(0, 10) : ''); const [busy, setBusy] = useState(false); return <Dialog title={`Extend ${account.name}`} onClose={onClose}><form onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onSave(dateValue); } finally { setBusy(false); } }} className="space-y-4"><p className="text-sm text-slate-600">Choose the new subscription end date. The ISP remains in its current status.</p><Field label="New end date" type="date" value={dateValue} onChange={setDateValue} required/><button disabled={busy} className="w-full rounded-xl bg-[#6231e5] px-4 py-3 text-sm font-extrabold text-white disabled:opacity-60">{busy ? 'Extending...' : 'Extend subscription'}</button></form></Dialog>; }
function DeleteAccountDialog({ account, onClose, onDelete }) { const [confirmName, setConfirmName] = useState(''); const [busy, setBusy] = useState(false); return <Dialog title="Delete ISP account" onClose={onClose}><form onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onDelete(confirmName); } finally { setBusy(false); } }} className="space-y-4"><p className="text-sm text-rose-700">This only works for an ISP with no subscribers. Type <strong>{account.name}</strong> exactly to confirm.</p><input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} className="w-full rounded-xl border border-rose-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-200" placeholder={account.name}/><button disabled={busy || confirmName !== account.name} className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50">{busy ? 'Deleting...' : 'Delete ISP permanently'}</button></form></Dialog>; }

function CreateAccount({ onCreated }) {
  const [form, setForm] = useState(blankAccount); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => { event.preventDefault(); setError(''); setSaving(true); try { const { data } = await api.post('/billing-operator/accounts', form); await onCreated(data.account.name, data.domain, data.domain_error); } catch (err) { const validation = err.response?.data?.errors?.[0]?.msg; setError(validation || err.response?.data?.error || 'Could not create the ISP account.'); } finally { setSaving(false); } };
  return <div className="mx-auto max-w-3xl"><div className="mb-5"><div className="text-xs font-bold uppercase tracking-[.18em] text-[#7654ef]">New tenant</div><h1 className="mt-1 text-2xl font-extrabold">Onboard an ISP</h1><p className="mt-1 text-sm text-slate-500">Creates a separate billing workspace and its first ISP administrator.</p></div><form onSubmit={submit} className="space-y-5 rounded-3xl border border-[#e4e7f1] bg-white p-5 shadow-sm sm:p-7">{error && <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}<div className="grid gap-4 sm:grid-cols-2"><Field label="ISP name" value={form.isp_name} onChange={(v) => update('isp_name', v)} required placeholder="Example Internet Ltd"/><Field label="Business name" value={form.business_name} onChange={(v) => update('business_name', v)} placeholder="Optional trading name"/><Field label="Account email" type="email" value={form.contact_email} onChange={(v) => update('contact_email', v)} required placeholder="billing@isp.co.ke"/><Field label="Subscription plan" value={form.billing_plan} onChange={(v) => update('billing_plan', v)} placeholder="Starter"/><Field label="Preferred subdomain" value={form.domain_slug} onChange={(v) => update('domain_slug', v)} placeholder="rivernet (optional)"/><Field label="Owner / first admin" value={form.admin_name} onChange={(v) => update('admin_name', v)} required placeholder="Full name"/><Field label="Admin login email" type="email" value={form.admin_email} onChange={(v) => update('admin_email', v)} required placeholder="admin@isp.co.ke"/><Field label="Temporary password" type="password" value={form.admin_password} onChange={(v) => update('admin_password', v)} required placeholder="At least 8 characters"/></div><div className="grid gap-4 rounded-2xl bg-[#f6f3ff] p-4 sm:grid-cols-2"><label className="block text-sm font-bold">Account state<select value={form.account_status} onChange={(e) => update('account_status', e.target.value)} className="mt-2 w-full rounded-xl border border-[#ddd5fb] bg-white px-3 py-2.5 font-medium outline-none"><option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>{form.account_status === 'trial' && <Field label="Trial end date" type="date" value={form.trial_ends_at} onChange={(v) => update('trial_ends_at', v)}/>}</div><div className="flex items-center justify-between gap-3 border-t border-[#edf0f5] pt-5"><p className="max-w-md text-xs leading-5 text-slate-500">This creates a billing-only tenant. When domain automation is ready, Nexa also creates its isolated polyizon.tech address.</p><button disabled={saving} className="shrink-0 rounded-xl bg-[#6332e5] px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60">{saving ? 'Creating…' : 'Create ISP account'}</button></div></form></div>;
}

function MasterAdmins({ admins, loading, onCreated }) {
  const [open, setOpen] = useState(false); const [form, setForm] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (e) => { e.preventDefault(); setError(''); setSaving(true); try { await api.post('/admins', { ...form, role: 'superadmin' }); setForm({ name: '', email: '', password: '' }); setOpen(false); await onCreated(); } catch (err) { setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Could not create master admin.'); } finally { setSaving(false); } };
  return <div className="mx-auto max-w-4xl space-y-5"><div className="flex items-end justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-[#7654ef]">Platform access</div><h1 className="mt-1 text-2xl font-extrabold">Master admin users</h1><p className="mt-1 text-sm text-slate-500">Operators with access to every billing ISP account.</p></div><button onClick={() => setOpen(!open)} className="rounded-xl bg-[#6332e5] px-4 py-3 text-sm font-extrabold text-white">+ Add master admin</button></div><DomainAutomation/>{open && <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-[#e3e5ef] bg-white p-5 shadow-sm sm:grid-cols-3">{error && <div className="sm:col-span-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}<Field label="Full name" value={form.name} onChange={(v) => setForm({...form, name:v})} required/><Field label="Email" type="email" value={form.email} onChange={(v) => setForm({...form, email:v})} required/><Field label="Password" type="password" value={form.password} onChange={(v) => setForm({...form, password:v})} required/><div className="sm:col-span-3 flex justify-end"><button disabled={saving} className="rounded-xl bg-[#6332e5] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Creating...' : 'Create master admin'}</button></div></form>}<section className="overflow-hidden rounded-2xl border border-[#e4e7f1] bg-white shadow-sm">{loading ? <div className="p-8 text-center text-sm text-slate-400">Loading master admins...</div> : admins.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No master admins found.</div> : admins.map((item) => <div className="flex items-center gap-3 border-b border-[#f0f1f6] px-5 py-4 last:border-0" key={item.id}><Initial name={item.name}/><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="truncate text-xs text-slate-500">{item.email}</div></div><div className="text-right"><div className="text-xs font-bold text-[#6332e5]">Master admin</div><div className="text-[11px] text-slate-400">Added {date(item.created_at)}</div></div></div>)}</section></div>;
}

function DomainAutomation() {
  const [settings, setSettings] = useState(null); const [form, setForm] = useState({ cloudflare_zone_id: '', cloudflare_api_token: '', root_domain: 'polyizon.tech', target_domain: 'billing.polyizon.tech', proxied: true }); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const loadSettings = async () => { try { const { data } = await api.get('/billing-operator/domains/settings'); setSettings(data); setForm((current) => ({ ...current, cloudflare_zone_id: data.cloudflare_zone_id || '', root_domain: data.root_domain || 'polyizon.tech', target_domain: data.target_domain || 'billing.polyizon.tech', proxied: data.proxied !== false })); } catch (err) { setError(err.response?.data?.error || 'Could not load domain automation settings.'); } };
  useEffect(() => { loadSettings(); }, []);
  const save = async (event) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const { data } = await api.put('/billing-operator/domains/settings', form); setSettings(data); setForm((current) => ({ ...current, cloudflare_api_token: '' })); setMessage('Settings saved. The API token is encrypted and shown only as masked.'); } catch (err) { setError(err.response?.data?.error || 'Could not save Cloudflare settings.'); } finally { setBusy(false); } };
  const verify = async () => { setBusy(true); setError(''); setMessage(''); try { const { data } = await api.post('/billing-operator/domains/verify'); setMessage(`Cloudflare verified. New ISP domains will point to ${data.target_domain}.`); } catch (err) { setError(err.response?.data?.error || 'Cloudflare verification failed.'); } finally { setBusy(false); } };
  return <section className="rounded-2xl border border-[#ded5ff] bg-[#faf8ff] p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.16em] text-[#7041e8]">Domain automation</div><h2 className="mt-1 text-lg font-extrabold">Automatic ISP addresses</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">Each new ISP receives an address such as rivernet.polyizon.tech. Cloudflare credentials are encrypted at rest.</p></div><button onClick={() => setOpen(!open)} className={`rounded-xl px-3 py-2 text-xs font-extrabold ${settings?.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-[#6431e4] text-white'}`}>{settings?.configured ? 'Configured' : 'Configure Cloudflare'}</button></div>{message && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}{error && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}{open && <form onSubmit={save} className="mt-5 grid gap-4 border-t border-[#e7e0fb] pt-5 sm:grid-cols-2"><Field label="Cloudflare Zone ID" value={form.cloudflare_zone_id} onChange={(v) => setForm({...form, cloudflare_zone_id:v})} required placeholder="Zone ID for polyizon.tech"/><Field label="Cloudflare API token" type="password" value={form.cloudflare_api_token} onChange={(v) => setForm({...form, cloudflare_api_token:v})} required={!settings?.cloudflare_api_token_masked} placeholder={settings?.cloudflare_api_token_masked ? 'Leave blank to keep the saved token' : 'DNS Edit token'}/><Field label="Client root domain" value={form.root_domain} onChange={(v) => setForm({...form, root_domain:v})} required/><Field label="Billing target hostname" value={form.target_domain} onChange={(v) => setForm({...form, target_domain:v})} required/><label className="flex items-center gap-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.proxied} onChange={(e) => setForm({...form, proxied:e.target.checked})} className="h-4 w-4 accent-[#6332e5]"/>Proxy ISP domains through Cloudflare</label><div className="flex flex-wrap items-end justify-end gap-2"><button type="button" disabled={busy || !settings?.configured} onClick={verify} className="rounded-xl border border-[#d8cdfb] px-4 py-2.5 text-sm font-bold text-[#6332e5] disabled:opacity-50">Verify connection</button><button disabled={busy} className="rounded-xl bg-[#6332e5] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Saving...' : 'Save automation'}</button></div></form>}</section>;
}
function Field({ label, value, onChange, type = 'text', required, placeholder }) { return <label className="block text-sm font-bold text-slate-700">{label}<input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-[#dfe2ee] bg-white px-3 py-2.5 text-sm font-normal outline-none transition focus:border-[#7041ea] focus:ring-2 focus:ring-[#ede7ff]"/></label>; }
function Initial({ name }) { return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#eee7ff] to-[#dceefe] text-sm font-extrabold text-[#6735e4]">{(name || '?').slice(0, 1).toUpperCase()}</div>; }
function Status({ value }) { const classes = { active: 'bg-emerald-50 text-emerald-700', trial: 'bg-amber-50 text-amber-700', suspended: 'bg-rose-50 text-rose-700' }; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${classes[value] || classes.active}`}>{value || 'active'}</span>; }