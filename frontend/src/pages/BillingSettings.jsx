import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const permissions = ['statistics', 'conversations', 'tickets', 'invoices', 'admins', 'employees', 'workflow', 'agent', 'logs'];
const blank = { name: '', email: '', password: '', permissions: ['statistics'] };
const settlementBlank = { institution_code: 'equity', account_name: '', account_number: '', branch_name: '', collection_reference: '' };

const statusClass = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  suspended: 'border-slate-200 bg-slate-100 text-slate-600',
};

function Icon({ name, className = 'h-5 w-5' }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true,
  };

  const paths = {
    bank: <><path d="M3 10h18"/><path d="M5 10v8"/><path d="M9 10v8"/><path d="M15 10v8"/><path d="M19 10v8"/><path d="M3 18h18"/><path d="M12 3 3 8h18L12 3Z"/></>,
    user: <><circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.8 2.9 8.2 7 10 4.1-1.8 7-5.2 7-10V6l-7-3Z"/><path d="m9.3 12 1.8 1.8 3.8-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.2 2.2 4.8-5"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function BankIdentity({ code, compact = false }) {
  if (code === 'coop') {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-sky-100 bg-white shadow-sm ${compact ? 'h-10 w-10' : 'h-16 w-16'}`}>
        <div className="text-center leading-none">
          <div className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-black tracking-tight text-sky-800`}>CO-OP</div>
          <div className={`${compact ? 'text-[6px]' : 'text-[7px]'} mt-0.5 font-black uppercase tracking-[.14em] text-emerald-600`}>BANK</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center rounded-2xl border border-rose-100 bg-white shadow-sm ${compact ? 'h-10 w-10' : 'h-16 w-16'}`}>
      <div className="text-center leading-none">
        <svg viewBox="0 0 54 28" className={`${compact ? 'h-4 w-8' : 'h-6 w-11'} mx-auto`} aria-hidden="true">
          <path d="M3 24 25 5l10 9 6-5 10 15H39l-5-7-9-8-17 15Z" fill="currentColor" className="text-rose-700"/>
        </svg>
        <div className={`${compact ? 'text-[6px]' : 'text-[8px]'} mt-0.5 font-black tracking-[.08em] text-slate-900`}>EQUITY</div>
      </div>
    </div>
  );
}

function InputShell({ icon, children }) {
  return (
    <div className="relative mt-2">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-center text-slate-400">
        <Icon name={icon} className="h-[19px] w-[19px]" />
      </div>
      {children}
    </div>
  );
}

export default function BillingSettings() {
  const [p, setP] = useState({ name: '', business_name: '', contact_email: '', support_number: '', official_contact_name: '', official_whatsapp_number: '' });
  const [staff, setStaff] = useState([]);
  const [newStaff, setNewStaff] = useState(blank);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [institutions, setInstitutions] = useState([]);
  const [settlement, setSettlement] = useState(settlementBlank);
  const [settlementProfile, setSettlementProfile] = useState(null);
  const [settlementSaving, setSettlementSaving] = useState(false);
  const [settlementMsg, setSettlementMsg] = useState('');
  const [canManageSettlement, setCanManageSettlement] = useState(false);

  const load = async () => {
    try {
      const [profile, admins, banks, settlementResult] = await Promise.all([
        api.get('/billing-workspace/settings/profile'),
        api.get('/admins'),
        api.get('/settlements/institutions'),
        api.get('/settlements/profile'),
      ]);
      setP(profile.data);
      setStaff(admins.data || []);
      const available = banks.data?.institutions || [];
      setInstitutions(available);
      const saved = settlementResult.data?.profile || null;
      setSettlementProfile(saved);
      setCanManageSettlement(Boolean(settlementResult.data?.can_manage));
      const fallback = available[0]?.code || 'equity';
      setSettlement(saved ? {
        institution_code: available.some((x) => x.code === saved.institution_code) ? saved.institution_code : fallback,
        account_name: saved.account_name || '',
        account_number: '',
        branch_name: saved.branch_name || '',
        collection_reference: '',
      } : { ...settlementBlank, institution_code: fallback });
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not load Settings');
    }
  };

  useEffect(() => { load(); }, []);

  const selectedInstitution = useMemo(
    () => institutions.find((x) => x.code === settlement.institution_code) || null,
    [institutions, settlement.institution_code]
  );

  const settlementStatus = settlementProfile?.routing_status === 'active'
    ? 'active'
    : settlementProfile?.verification_status === 'pending'
      ? 'pending'
      : settlementProfile?.verification_status || null;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.put('/billing-workspace/settings/profile', p);
      setP(r.data);
      setMsg('Business profile saved.');
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not save profile');
    } finally {
      setBusy(false);
    }
  };

  const saveSettlement = async (e) => {
    e.preventDefault();
    setSettlementSaving(true);
    setSettlementMsg('');
    try {
      const { data } = await api.put('/settlements/profile', settlement);
      setSettlementProfile(data.profile);
      setSettlement((v) => ({ ...v, account_number: '', collection_reference: '' }));
      setSettlementMsg('Your bank destination request has been received and will be reviewed within 24 hours. You will be notified once it has been approved and activated.');
    } catch (e) {
      setSettlementMsg(e.response?.data?.error || 'Could not submit the bank destination request.');
    } finally {
      setSettlementSaving(false);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admins', newStaff);
      setNewStaff(blank);
      setOpen(false);
      setMsg('Staff account created.');
      load();
    } catch (e) {
      setMsg(e.response?.data?.error || e.response?.data?.errors?.[0]?.msg || 'Could not create staff account');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this staff account?')) return;
    try {
      await api.delete(`/admins/${id}`);
      setMsg('Staff account removed.');
      load();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not remove staff account');
    }
  };

  const field = (key, label, type = 'text') => (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <input
        type={type}
        value={p[key] || ''}
        onChange={(e) => setP({ ...p, [key]: e.target.value })}
        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5"
      />
    </label>
  );

  return (
    <div className="-mx-3 -mt-3 min-h-screen bg-[#f6f8fb] pb-20 sm:-mx-8 sm:-mt-8">
      <section className="relative overflow-hidden billing-network-hero bg-[#0a2417] px-5 pb-14 pt-6 text-white sm:px-8">
        <div className="relative z-10 mx-auto flex max-w-[1500px] items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-200">Account control</p>
            <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">Settings</h2>
            <p className="mt-1.5 max-w-xl text-xs leading-5 text-emerald-100 sm:text-sm">Business profile, direct bank payments, staff access, and permissions for your billing account.</p>
          </div>
          <button onClick={() => setOpen(true)} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-emerald-950">+ Add staff</button>
        </div>
        <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-9">
          <svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full"><path d="M0 100 C180 20 300 190 510 115 C720 40 780 175 1000 70 C1090 28 1140 65 1200 25 L1200 180 L0 180 Z" fill="#f6f8fb"/></svg>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
        {msg && <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{msg}</div>}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div><h3 className="font-black text-slate-950">Business profile</h3><p className="mt-1 text-xs text-slate-400">Identity shown across billing, support, and customer communication.</p></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">{field('name', 'Account name')}{field('business_name', 'Business name')}{field('contact_email', 'Business email', 'email')}{field('support_number', 'Support phone')}{field('official_contact_name', 'Primary contact')}{field('official_whatsapp_number', 'WhatsApp number')}</div>
            <button disabled={busy} className="mt-5 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save business profile'}</button>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-black text-slate-950">Access overview</h3>
            <div className="mt-5 space-y-3">
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Team access</p><p className="mt-1 text-sm font-bold text-slate-800">{staff.length} staff account{staff.length === 1 ? '' : 's'}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Account scope</p><p className="mt-1 text-sm font-bold text-slate-800">This ISP only</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Security</p><p className="mt-1 text-sm font-bold text-slate-800">Audited changes</p></div>
            </div>
          </section>
        </div>

        <form onSubmit={saveSettlement} className="mt-5 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_14px_45px_rgba(15,23,42,.06)]">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-6 sm:px-7 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <p className="text-[10px] font-black uppercase tracking-[.19em] text-emerald-600">Polyizon M-PESA Gateway</p>
              <h3 className="mt-1.5 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">Configure your direct bank destination</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Add the bank account where you want your customer payments to be deposited. The account should belong to you or your registered ISP/business. Polyizon securely initiates the M-PESA STK, while your bank details remain encrypted and masked after submission.</p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm"><Icon name="shield" className="h-5 w-5" /></div>
              <div><p className="text-[10px] font-black uppercase tracking-wider">Secure payments</p><p className="mt-0.5 text-xs font-semibold text-emerald-700">Encrypted bank details</p></div>
            </div>
          </div>

          {settlementMsg && (
            <div className="mx-5 mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-4 sm:mx-7">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"><Icon name="check" className="h-5 w-5" /></div>
              <div className="min-w-0"><p className="text-sm font-black text-emerald-900">Request received successfully</p><p className="mt-1 text-xs leading-5 text-emerald-800 sm:text-sm">{settlementMsg}</p></div>
            </div>
          )}

          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><Icon name="bank" className="h-5 w-5" /></div>
                <div><h4 className="text-sm font-black text-slate-950">Bank account details</h4><p className="mt-0.5 text-xs text-slate-500">Provide the account that should receive your customer payments.</p></div>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <label className="block text-xs font-black text-slate-700">
                  Bank
                  <div className="relative mt-2">
                    <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center"><BankIdentity code={settlement.institution_code} compact /></div>
                    <select
                      value={settlement.institution_code}
                      onChange={(e) => {
                        const code = e.target.value;
                        setSettlement((v) => ({ ...v, institution_code: code, account_number: settlementProfile?.institution_code === code ? '' : v.account_number }));
                      }}
                      className="h-[54px] w-full appearance-none rounded-2xl border border-slate-200 bg-white pl-16 pr-10 text-sm font-bold text-slate-900 outline-none transition hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5"
                    >
                      {institutions.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400"><Icon name="chevron" className="h-4 w-4 rotate-90" /></div>
                  </div>
                </label>

                <label className="block text-xs font-black text-slate-700">
                  Account holder name
                  <InputShell icon="user">
                    <input
                      required
                      value={settlement.account_name}
                      onChange={(e) => setSettlement({ ...settlement, account_name: e.target.value })}
                      placeholder="Your name or registered business name"
                      className="h-[54px] w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-bold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5"
                    />
                  </InputShell>
                </label>

                <label className="block text-xs font-black text-slate-700 sm:col-span-2">
                  Bank account number
                  <InputShell icon="card">
                    <input
                      value={settlement.account_number}
                      onChange={(e) => setSettlement({ ...settlement, account_number: e.target.value.replace(/\s/g, '') })}
                      inputMode="numeric"
                      placeholder={settlementProfile?.institution_code === settlement.institution_code && settlementProfile?.account_number_masked ? `Saved ${settlementProfile.account_number_masked} — leave blank to keep` : 'Enter your bank account number'}
                      className="h-[54px] w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-bold tracking-[.02em] text-slate-900 outline-none transition placeholder:font-medium placeholder:tracking-normal placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5"
                    />
                  </InputShell>
                </label>

                <label className="block text-xs font-black text-slate-700 sm:col-span-2">
                  Branch / relationship branch <span className="font-semibold text-slate-400">(optional)</span>
                  <InputShell icon="pin">
                    <input
                      value={settlement.branch_name}
                      onChange={(e) => setSettlement({ ...settlement, branch_name: e.target.value })}
                      placeholder="e.g. Westlands, Moi Avenue"
                      className="h-[54px] w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5"
                    />
                  </InputShell>
                </label>
              </div>
            </section>

            <aside className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 p-5">
              <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-emerald-100/50 blur-2xl" />
              <div className="relative">
                <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Selected payment route</p>
                <div className="mt-4 flex items-center justify-between gap-4">
                  <div><p className="text-base font-black text-slate-950">{selectedInstitution?.name || 'Choose a bank'}</p><p className="mt-1 text-sm font-black text-emerald-700">{selectedInstitution?.mpesa_paybill ? `M-PESA Paybill ${selectedInstitution.mpesa_paybill}` : ''}</p></div>
                  <BankIdentity code={settlement.institution_code} />
                </div>

                <div className="my-5 h-px bg-slate-200" />

                <div className="flex gap-3 text-slate-600">
                  <div className="mt-0.5 text-sky-500"><Icon name="info" className="h-5 w-5" /></div>
                  <p className="text-xs leading-5">Once approved, customer M-PESA STKs initiated by Polyizon will be deposited directly into your registered {selectedInstitution?.name || 'bank'} account.</p>
                </div>

                <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm"><Icon name="lock" className="h-[18px] w-[18px]" /></div>
                    <div><p className="text-xs font-black text-emerald-900">Secure and encrypted</p><p className="mt-1 text-[11px] leading-5 text-emerald-800/80">Your account details are encrypted and only masked values are displayed after submission.</p></div>
                  </div>
                </div>

                {settlementProfile && (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-xs">
                    <div className="flex items-center justify-between gap-4"><span className="text-slate-500">Saved account</span><b className="text-slate-900">{settlementProfile.account_number_masked || '—'}</b></div>
                    <div className="mt-3 flex items-center justify-between gap-4"><span className="text-slate-500">Status</span><span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${settlementStatus === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : statusClass[settlementProfile.verification_status] || statusClass.pending}`}>{settlementStatus === 'active' ? 'Active' : settlementStatus === 'pending' ? 'Review pending' : settlementStatus}</span></div>
                  </div>
                )}
              </div>
            </aside>
          </div>

          <div className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Icon name="clock" className="h-5 w-5" /></div>
              <div>
                <p className="text-xs font-black text-slate-900">Bank destination requests are reviewed before activation</p>
                <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">Please confirm the account holder name and bank account number carefully. After submission, our team will review your request within 24 hours and notify you when the destination is approved.</p>
                {!canManageSettlement && <p className="mt-1 text-[11px] font-bold text-amber-700">Only an ISP administrator with account-management permission can submit or change this bank destination.</p>}
              </div>
            </div>
            <button
              disabled={settlementSaving || !institutions.length || !canManageSettlement}
              className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-700 to-emerald-600 px-6 text-sm font-black text-white shadow-[0_10px_28px_rgba(5,150,105,.22)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(5,150,105,.28)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              <Icon name="send" className="h-[18px] w-[18px]" />
              {settlementSaving ? 'Submitting request...' : 'Submit bank destination request'}
            </button>
          </div>
        </form>

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h3 className="font-black text-slate-950">Staff and permissions</h3><p className="mt-1 text-xs text-slate-400">Choose exactly which areas each staff member can access.</p></div><button onClick={() => setOpen(true)} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">+ Add staff</button></div>
          {staff.map((a) => <div key={a.id} className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-slate-900">{a.name}</p><p className="text-xs text-slate-400">{a.email}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700">{a.role === 'superadmin' ? 'Owner' : 'Staff'}</span><span className="text-xs text-slate-500">{(a.permissions || []).length} permissions</span><button onClick={() => remove(a.id)} className="text-xs font-bold text-rose-600">Remove</button></div></div>)}
        </section>
      </main>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={create} className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Team access</p><h3 className="mt-1 text-xl font-black">Add staff member</h3></div><button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Icon name="close" className="h-4 w-4" /></button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><input required placeholder="Full name" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><input required type="email" placeholder="Email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><input required minLength="10" type="password" placeholder="Strong password" value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm sm:col-span-2"/></div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{permissions.map((x) => <label key={x} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-2 text-xs"><input type="checkbox" checked={newStaff.permissions.includes(x)} onChange={(e) => setNewStaff({ ...newStaff, permissions: e.target.checked ? [...newStaff.permissions, x] : newStaff.permissions.filter((v) => v !== x) })}/>{x.replace('_', ' ')}</label>)}</div>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-500">Cancel</button><button disabled={busy} className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-white">Create staff account</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
