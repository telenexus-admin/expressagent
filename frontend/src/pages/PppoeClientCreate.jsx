import React, { useState } from 'react';
import api from '../utils/api';

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomCharacters(length, source = alphabet) {
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => source[value % source.length]).join('');
}

function usernameSuggestion(fullName) {
  const firstName = String(fullName || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z0-9]/g, '')
    .slice(0, 18) || 'user';
  return `${firstName}.${randomCharacters(5, '0123456789')}`;
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

  const [stkBusy, setStkBusy] = useState(false);
  const [stkResult, setStkResult] = useState(null);
  const [stkError, setStkError] = useState('');

  const [receipt, setReceipt] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claim, setClaim] = useState(null);
  const [claimError, setClaimError] = useState('');
  const [confirmAmount, setConfirmAmount] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const activePlans = plans.filter((plan) => plan.is_active !== false);
  const activeRouters = routers.filter((router) => router.is_active !== false);
  const selectedPlan = activePlans.find((plan) => String(plan.id) === String(form.plan_id));

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

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
      setConfirmAmount(String(response.data?.payment?.amount || ''));
      await reload?.();
    } catch (requestError) {
      const validationMessage = requestError.response?.data?.errors?.[0]?.msg;
      setError(requestError.response?.data?.error || validationMessage || 'Could not create the PPPoE subscriber.');
    } finally {
      setBusy(false);
    }
  };

  const startStk = async () => {
    if (!created?.subscriber?.id || stkBusy) return;
    setStkBusy(true);
    setStkError('');
    setStkResult(null);
    try {
      const response = await api.post(
        `/billing-workspace/pppoe-subscribers/${created.subscriber.id}/payments/initiate`,
        { phone: created.subscriber?.phone || form.phone || '' }
      );
      setStkResult(response.data);
    } catch (requestError) {
      setStkError(requestError.response?.data?.error || 'Could not send the direct-bank M-Pesa prompt.');
    } finally {
      setStkBusy(false);
    }
  };

  const recordManualReceipt = async () => {
    if (!created?.subscriber?.id || claimBusy || !receipt.trim()) return;
    setClaimBusy(true);
    setClaimError('');
    try {
      const response = await api.post(
        `/billing-workspace/pppoe-subscribers/${created.subscriber.id}/payments/manual-claim`,
        {
          receipt_number: receipt.trim(),
          payer_phone: created.subscriber?.phone || form.phone || '',
        }
      );
      setClaim(response.data?.claim || null);
      setConfirmAmount(String(response.data?.claim?.expected_amount || created.payment?.amount || ''));
    } catch (requestError) {
      setClaimError(requestError.response?.data?.error || 'Could not record the M-Pesa receipt.');
    } finally {
      setClaimBusy(false);
    }
  };

  const verifyManualReceipt = async () => {
    if (!created?.subscriber?.id || !claim?.id || verifyBusy) return;
    setVerifyBusy(true);
    setClaimError('');
    try {
      const response = await api.post(
        `/billing-workspace/pppoe-subscribers/${created.subscriber.id}/payments/manual-claims/${claim.id}/verify`,
        {
          confirmed_amount: Number(confirmAmount),
          notes: 'Verified by ISP against the configured bank account before activation.',
        }
      );
      setVerifyResult(response.data);
      setClaim(response.data?.claim || claim);
      await reload?.();
    } catch (requestError) {
      setClaimError(requestError.response?.data?.error || 'Could not verify the manual bank payment.');
    } finally {
      setVerifyBusy(false);
    }
  };

  if (created) {
    const payment = created.payment || {};
    const stk = payment.stk || {};
    const manual = payment.manual || {};
    const hasPhone = Boolean(created.subscriber?.phone || form.phone);

    return (
      <div className="fixed inset-0 z-[11000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
        <div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
          <div className="rounded-3xl bg-emerald-50 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-xl font-black text-white">✓</div>
            <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-950">PPPoE client is ready</h3>
            <p className="mt-1 text-sm text-emerald-800">The account is pending payment. Polyizon does not receive or hold the customer's subscription money.</p>
          </div>

          <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-500">Polyizon subscriber reference</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <strong className="text-xl text-slate-950">{payment.account_number}</strong>
              <button type="button" onClick={() => copy('reference', payment.account_number)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-violet-700 shadow-sm">
                {copied === 'reference' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">This identifies the subscriber inside Polyizon. It is not a Polyizon Paybill account.</p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">Option 1 · Direct-bank STK</p>
              {stk.ready ? (
                <>
                  <h4 className="mt-1 text-base font-black text-slate-950">{stk.institution_name}</h4>
                  <p className="mt-2 text-[11px] leading-5 text-emerald-800">The STK sends money straight to the ISP bank account ending {stk.bank_account_last4}. Polyizon only receives the payment result.</p>
                  {hasPhone ? (
                    <button type="button" disabled={stkBusy || Boolean(stkResult)} onClick={startStk} className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-xs font-black text-white disabled:opacity-50">
                      {stkResult ? 'Prompt sent' : stkBusy ? 'Sending…' : 'Send direct-bank STK'}
                    </button>
                  ) : (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">Add a valid Safaricom phone number to use STK.</p>
                  )}
                  {stkError && <p className="mt-3 text-[11px] font-bold text-rose-700">{stkError}</p>}
                  {stkResult && <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-emerald-700">STK sent. Reference: {stkResult.reference}</p>}
                </>
              ) : (
                <p className="mt-2 text-[11px] font-bold leading-5 text-rose-700">{stk.error || 'Direct-bank STK is unavailable.'}</p>
              )}
            </section>

            <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">Option 2 · Manual Paybill</p>
              {manual.ready ? (
                <>
                  <h4 className="mt-1 text-base font-black text-slate-950">Pay the ISP bank directly</h4>
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl bg-white p-3">
                      <span className="text-[9px] font-bold uppercase text-slate-400">Business number</span>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <strong className="text-sm text-slate-950">{manual.paybill}</strong>
                        <button type="button" onClick={() => copy('paybill', manual.paybill)} className="text-[10px] font-black text-sky-700">{copied === 'paybill' ? 'Copied' : 'Copy'}</button>
                      </div>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <span className="text-[9px] font-bold uppercase text-slate-400">Bank account number</span>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <strong className="break-all text-sm text-slate-950">{manual.bank_account_number}</strong>
                        <button type="button" onClick={() => copy('bank-account', manual.bank_account_number)} className="text-[10px] font-black text-sky-700">{copied === 'bank-account' ? 'Copied' : 'Copy'}</button>
                      </div>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <span className="text-[9px] font-bold uppercase text-slate-400">Amount</span>
                      <strong className="mt-1 block text-sm text-slate-950">KES {Number(manual.amount || 0).toLocaleString()}</strong>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] font-semibold leading-5 text-sky-800">Customer opens M-Pesa → Pay Bill → enters the bank Paybill and bank account above. The money goes directly to {manual.institution_name}. Keep the M-Pesa receipt.</p>

                  {!claim ? (
                    <div className="mt-4 rounded-xl border border-sky-200 bg-white p-3">
                      <label className="text-[10px] font-black uppercase text-slate-500">M-Pesa receipt after customer pays</label>
                      <input value={receipt} onChange={(event) => setReceipt(event.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="e.g. TQH7ABC123" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none" />
                      <button type="button" disabled={claimBusy || !receipt.trim()} onClick={recordManualReceipt} className="mt-2 w-full rounded-xl bg-sky-600 py-2.5 text-xs font-black text-white disabled:opacity-50">
                        {claimBusy ? 'Recording…' : 'Record receipt for verification'}
                      </button>
                    </div>
                  ) : !verifyResult ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-black text-amber-800">Receipt {claim.receipt_number} recorded — not activated yet</p>
                      <p className="mt-1 text-[10px] leading-5 text-amber-700">Check the ISP's bank account and confirm this exact credit before activating the subscriber.</p>
                      <label className="mt-3 block text-[10px] font-black uppercase text-slate-500">Confirmed bank credit amount</label>
                      <input type="number" min="1" step="0.01" value={confirmAmount} onChange={(event) => setConfirmAmount(event.target.value)} className="mt-1.5 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm font-bold outline-none" />
                      <button type="button" disabled={verifyBusy} onClick={verifyManualReceipt} className="mt-2 w-full rounded-xl bg-slate-950 py-2.5 text-xs font-black text-white disabled:opacity-50">
                        {verifyBusy ? 'Verifying…' : 'Verified in bank — activate internet'}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs font-black text-emerald-700">Payment verified and applied</p>
                      <p className="mt-1 text-[10px] leading-5 text-emerald-700">Subscriber activation has been queued to RADIUS. Polyizon did not receive the funds.</p>
                    </div>
                  )}
                  {claimError && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">{claimError}</p>}
                </>
              ) : (
                <p className="mt-2 text-[11px] font-bold leading-5 text-rose-700">{manual.error || 'Manual direct-bank Paybill is unavailable.'}</p>
              )}
            </section>
          </div>

          {created.notifications?.length > 0 && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
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

          <div className="mt-4 rounded-2xl border border-slate-200 p-4">
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">PPPoE internet login</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-[10px] font-bold text-slate-400">Username</span>
                <strong className="mt-1 block break-all text-sm text-slate-950">{created.pppoe?.username}</strong>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-[10px] font-bold text-slate-400">Password</span>
                <strong className="mt-1 block break-all text-sm text-slate-950">{created.pppoe?.password}</strong>
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
            <p className="mt-1 text-xs leading-5 text-slate-500">Central RADIUS handles authentication. Payment goes directly to the ISP's configured bank account.</p>
          </div>
          <button type="button" onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500">×</button>
        </div>

        {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold leading-5 text-rose-700">{error}</div>}

        <section className="mt-5 rounded-2xl border border-slate-200 p-4">
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">1 · Customer</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <FieldLabel>Full name</FieldLabel>
              <input required autoFocus className={inputClass} value={form.full_name} onChange={(event) => set('full_name', event.target.value)} onBlur={() => { if (!form.radius_username) set('radius_username', usernameSuggestion(form.full_name)); }} placeholder="John Kamau" />
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
          <h4 className="mt-1 text-sm font-black text-slate-900">Direct-to-bank payments only</h4>
          <p className="mt-2 text-[11px] leading-5 text-violet-700">Polyizon creates a permanent subscriber reference, but subscription money is paid directly to the ISP's verified bank account by STK or manual bank Paybill.</p>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 p-4">
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">3 · Service</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
        </section>

        <section className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">4 · Internet login</p>
          <div className="mt-3 space-y-3">
            <label>
              <FieldLabel>PPPoE username</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <input required minLength={3} maxLength={64} className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3.5 py-3 text-sm font-bold text-slate-900 outline-none" value={form.radius_username} onChange={(event) => set('radius_username', event.target.value.replace(/\s/g, ''))} placeholder="john.48231" />
                <button type="button" onClick={() => set('radius_username', usernameSuggestion(form.full_name))} className="rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">Generate</button>
              </div>
            </label>
            <label>
              <FieldLabel>PPPoE password</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <input required minLength={8} maxLength={128} type={showPassword ? 'text' : 'password'} className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3.5 py-3 text-sm font-bold text-slate-900 outline-none" value={form.radius_password} onChange={(event) => set('radius_password', event.target.value.replace(/\s/g, ''))} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">{showPassword ? 'Hide' : 'Show'}</button>
                <button type="button" onClick={() => set('radius_password', randomCharacters(12))} className="rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">Generate</button>
              </div>
            </label>
          </div>
        </section>

        <button disabled={busy || !activePlans.length || !activeRouters.length} className="mt-5 w-full rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-45">
          {busy ? 'Creating subscriber…' : 'Create pending PPPoE client'}
        </button>
      </form>
    </div>
  );
}
