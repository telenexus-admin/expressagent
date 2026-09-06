import React, { useMemo, useState } from 'react';
import api from '../utils/api';

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomCharacters(length, source = alphabet) {
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => source[value % source.length]).join('');
}

function usernameSuggestion(fullName, accountNumber) {
  const firstName = String(fullName || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z0-9]/g, '')
    .slice(0, 18) || 'user';
  const suffix = String(accountNumber || '').replace(/\D/g, '').slice(-5) || randomCharacters(5, '0123456789');
  return `${firstName}.${suffix}`;
}

function FieldLabel({ children, hint }) {
  return (
    <span className="flex items-center justify-between gap-3 text-xs font-black text-slate-700">
      <span>{children}</span>
      {hint && <span className="text-[10px] font-bold text-slate-400">{hint}</span>}
    </span>
  );
}

export default function PppoeClientCreate({ routers = [], plans = [], reload, close }) {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    plan_id: '',
    router_id: '',
    radius_username: '',
    radius_password: randomCharacters(12),
  });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentStarted, setPaymentStarted] = useState(null);

  const activePlans = plans.filter((plan) => plan.is_active !== false);
  const activeRouters = routers.filter((router) => router.is_active !== false);
  const selectedPlan = activePlans.find((plan) => String(plan.id) === String(form.plan_id));

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const regenerateUsername = () => {
    set('radius_username', usernameSuggestion(form.full_name));
  };

  const choosePlan = (planId) => {
    const plan = activePlans.find((item) => String(item.id) === String(planId));
    setForm((current) => ({
      ...current,
      plan_id: planId,
      router_id: plan?.router_id ? String(plan.router_id) : current.router_id,
    }));
  };

  const copy = async (label, value) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1400);
    } catch {
      setCopied('');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await api.post('/billing-workspace/pppoe-subscribers', {
        ...form,
        plan_id: Number(form.plan_id),
        router_id: Number(form.router_id),
      });
      setCreated(response.data);
      await reload?.();
    } catch (requestError) {
      const validationMessage = requestError.response?.data?.errors?.[0]?.msg;
      setError(requestError.response?.data?.error || validationMessage || 'Could not create the PPPoE subscriber.');
    } finally {
      setBusy(false);
    }
  };

  const startDirectBankPayment = async () => {
    if (!created?.subscriber?.id || paymentBusy) return;
    setPaymentBusy(true);
    setPaymentError('');
    setPaymentStarted(null);

    try {
      const response = await api.post(
        `/billing-workspace/pppoe-subscribers/${created.subscriber.id}/payments/initiate`,
        { phone: created.subscriber?.phone || form.phone || '' }
      );
      setPaymentStarted(response.data);
    } catch (requestError) {
      const validationMessage = requestError.response?.data?.errors?.[0]?.msg;
      setPaymentError(requestError.response?.data?.error || validationMessage || 'Could not send the direct-bank M-Pesa prompt.');
    } finally {
      setPaymentBusy(false);
    }
  };

  if (created) {
    const directBankReady = created.payment?.ready === true && created.payment?.method === 'direct_bank_stk';
    const phoneAvailable = Boolean(created.subscriber?.phone || form.phone);

    return (
      <div className="fixed inset-0 z-[11000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
        <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
          <div className="rounded-3xl bg-emerald-50 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-xl font-black text-white">✓</div>
            <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-950">PPPoE client is ready</h3>
            <p className="mt-1 text-sm text-emerald-800">The account is waiting for payment. RADIUS access stays disabled until the direct-bank M-Pesa payment is confirmed.</p>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-500">Polyizon subscriber reference</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <strong className="text-xl text-slate-950">{created.payment?.account_number}</strong>
                <button type="button" onClick={() => copy('account', created.payment?.account_number)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-violet-700 shadow-sm">
                  {copied === 'account' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">This reference identifies the subscriber inside Polyizon. It is not a Polyizon collection account and must not be paid through a central Polyizon Paybill.</p>
            </div>

            {directBankReady ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">Direct-to-bank M-Pesa</p>
                    <h4 className="mt-1 text-base font-black text-slate-950">{created.payment?.institution_name}</h4>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black uppercase text-emerald-700 shadow-sm">No holding wallet</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white p-3">
                    <span className="text-[9px] font-bold uppercase text-slate-400">Amount</span>
                    <strong className="mt-1 block text-sm text-slate-950">KES {Number(created.payment?.amount || 0).toLocaleString()}</strong>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <span className="text-[9px] font-bold uppercase text-slate-400">Bank account</span>
                    <strong className="mt-1 block text-sm text-slate-950">••••{created.payment?.bank_account_last4}</strong>
                  </div>
                </div>
                <p className="mt-3 text-[11px] font-semibold leading-5 text-emerald-800">Money is sent by Safaricom directly to the ISP's configured bank account. Polyizon only receives the payment result and never receives or holds the funds.</p>

                {phoneAvailable ? (
                  <button
                    type="button"
                    disabled={paymentBusy || Boolean(paymentStarted)}
                    onClick={startDirectBankPayment}
                    className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-xs font-black text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {paymentStarted ? 'M-Pesa prompt sent' : paymentBusy ? 'Sending direct-bank prompt…' : 'Send M-Pesa prompt to customer'}
                  </button>
                ) : (
                  <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">Add a valid Safaricom phone number before sending a payment prompt.</p>
                )}

                {paymentError && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">{paymentError}</p>}

                {paymentStarted && (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="text-xs font-black text-emerald-700">Prompt sent successfully</p>
                    <p className="mt-1 text-[10px] leading-5 text-slate-500">Reference {paymentStarted.reference}. Funds will go directly to {paymentStarted.settlement?.institutionName} account ending {paymentStarted.settlement?.accountLast4} after the customer approves the STK.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-rose-600">Payment blocked</p>
                <p className="mt-2 text-xs font-bold leading-5 text-rose-800">{created.payment?.error || 'Direct-to-bank payment is not configured for this ISP.'}</p>
                <p className="mt-2 text-[11px] leading-5 text-rose-700">Polyizon will not fall back to collecting or holding this subscriber's money.</p>
              </div>
            )}

            {created.notifications?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">Welcome delivery</p>
                <div className="mt-2 space-y-1.5">
                  {created.notifications.map((delivery, index) => (
                    <p key={`${delivery.channel}-${index}`} className={`text-xs font-bold ${delivery.status === 'sent' ? 'text-emerald-700' : delivery.status === 'failed' ? 'text-rose-700' : 'text-slate-500'}`}>
                      {delivery.channel}: {delivery.status}{delivery.error ? ` — ${delivery.error}` : ''}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">PPPoE internet login</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-[10px] font-bold text-slate-400">Username</span>
                  <strong className="mt-1 block break-all text-sm text-slate-950">{created.pppoe?.username}</strong>
                  <button type="button" onClick={() => copy('username', created.pppoe?.username)} className="mt-2 text-xs font-black text-violet-600">{copied === 'username' ? 'Copied' : 'Copy username'}</button>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-[10px] font-bold text-slate-400">Password</span>
                  <strong className="mt-1 block break-all text-sm text-slate-950">{created.pppoe?.password}</strong>
                  <button type="button" onClick={() => copy('password', created.pppoe?.password)} className="mt-2 text-xs font-black text-violet-600">{copied === 'password' ? 'Copied' : 'Copy password'}</button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <span className="text-[10px] font-black uppercase text-slate-400">Router</span>
                <strong className="mt-1 block text-sm text-slate-900">{created.subscriber?.router_name || 'Assigned router'}</strong>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <span className="text-[10px] font-black uppercase text-slate-400">RADIUS</span>
                <strong className="mt-1 block text-sm text-amber-700">Pending payment · {created.pppoe?.rate_limit}</strong>
              </div>
            </div>
          </div>

          <button type="button" onClick={close} className="mt-5 w-full rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[11000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <button type="button" aria-label="Close" onClick={close} className="absolute inset-0" />
      <form onSubmit={submit} className="relative z-10 max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-violet-500">Native Polyizon subscriber</p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Add PPPoE client</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Central RADIUS handles authentication. No local MikroTik PPP secret is created.</p>
          </div>
          <button type="button" onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500">×</button>
        </div>

        {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold leading-5 text-rose-700">{error}</div>}

        <section className="mt-5 rounded-2xl border border-slate-200 p-4">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">1 · Customer</p>
            <h4 className="mt-1 text-sm font-black text-slate-900">Subscriber details</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <FieldLabel>Full name</FieldLabel>
              <input required autoFocus className={inputClass} value={form.full_name} onChange={(event) => set('full_name', event.target.value)} onBlur={() => { if (!form.radius_username) regenerateUsername(); }} placeholder="John Kamau" />
            </label>
            <label>
              <FieldLabel hint="recommended">Phone</FieldLabel>
              <input className={inputClass} value={form.phone} onChange={(event) => set('phone', event.target.value)} placeholder="0712345678" />
            </label>
            <label>
              <FieldLabel hint="optional">Email</FieldLabel>
              <input type="email" className={inputClass} value={form.email} onChange={(event) => set('email', event.target.value)} placeholder="john@example.com" />
            </label>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-500">2 · Billing</p>
          <h4 className="mt-1 text-sm font-black text-slate-900">Permanent subscriber reference · direct bank payment</h4>
          <p className="mt-2 text-[11px] leading-5 text-violet-700">Polyizon generates a permanent subscriber reference when this client is saved. M-Pesa payments are sent by STK directly to the ISP's configured bank account; Polyizon never receives or holds the subscriber funds.</p>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 p-4">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">3 · Service</p>
            <h4 className="mt-1 text-sm font-black text-slate-900">Package and MikroTik</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <FieldLabel>PPPoE package</FieldLabel>
              <select required className={inputClass} value={form.plan_id} onChange={(event) => choosePlan(event.target.value)}>
                <option value="">Choose package</option>
                {activePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name} · KES {Number(plan.price || 0).toLocaleString()}</option>
                ))}
              </select>
            </label>
            <label>
              <FieldLabel hint={selectedPlan?.router_id ? 'assigned by package' : undefined}>MikroTik router</FieldLabel>
              <select required disabled={Boolean(selectedPlan?.router_id)} className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`} value={form.router_id} onChange={(event) => set('router_id', event.target.value)}>
                <option value="">Choose router</option>
                {activeRouters.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
              </select>
            </label>
          </div>
          {selectedPlan && (
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black text-slate-500">
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">{selectedPlan.download_speed_mbps || '—'} Mbps down</span>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">{selectedPlan.upload_speed_mbps || '—'} Mbps up</span>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">{selectedPlan.validity_days || 30} days</span>
            </div>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">4 · Internet login</p>
            <h4 className="mt-1 text-sm font-black text-slate-900">PPPoE RADIUS credentials</h4>
          </div>
          <div className="space-y-3">
            <label>
              <FieldLabel>PPPoE username</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <input required minLength={3} maxLength={64} className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3.5 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" value={form.radius_username} onChange={(event) => set('radius_username', event.target.value.replace(/\s/g, ''))} placeholder="john.48231" />
                <button type="button" onClick={regenerateUsername} className="rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">Generate</button>
              </div>
            </label>
            <label>
              <FieldLabel>PPPoE password</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <input required minLength={8} maxLength={128} type={showPassword ? 'text' : 'password'} className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3.5 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" value={form.radius_password} onChange={(event) => set('radius_password', event.target.value.replace(/\s/g, ''))} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">{showPassword ? 'Hide' : 'Show'}</button>
                <button type="button" onClick={() => set('radius_password', randomCharacters(12))} className="rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">Generate</button>
              </div>
            </label>
            <p className="rounded-xl bg-white/80 px-3 py-2 text-[11px] leading-5 text-emerald-800">These credentials go into the customer's router/CPE PPPoE settings. They are separate from the permanent Polyizon subscriber reference.</p>
          </div>
        </section>

        <button disabled={busy || !activePlans.length || !activeRouters.length} className="mt-5 w-full rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-45">
          {busy ? 'Creating subscriber reference…' : 'Create pending PPPoE client'}
        </button>
      </form>
    </div>
  );
}
