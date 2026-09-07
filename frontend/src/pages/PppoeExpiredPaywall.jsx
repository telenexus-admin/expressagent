import React, { useEffect, useMemo, useState } from 'react';

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

async function request(path, body) {
  const response = await fetch(`/api/public/pppoe-paywall${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
  );
}

export default function PppoeExpiredPaywall() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [form, setForm] = useState({
    account_number: String(params.get('account') || '').trim().toUpperCase(),
    phone: '',
  });
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!payment?.reference || !payment?.poll_token || success) return undefined;

    let cancelled = false;
    let attempt = 0;

    const poll = async () => {
      while (!cancelled && attempt < 30) {
        attempt += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        if (cancelled) return;

        try {
          const status = await request('/status', {
            reference: payment.reference,
            poll_token: payment.poll_token,
          });
          const effective = String(status.effective_status || '').toLowerCase();
          setPaymentStatus(effective);

          if (effective === 'applied' || status.applied_at) {
            setSuccess(status);
            setPaymentStatus('applied');
            return;
          }

          if (['failed', 'rejected', 'cancelled', 'canceled', 'underpaid'].includes(effective)) {
            setError(status.result_description || 'The M-Pesa payment was not completed. You can send another STK prompt.');
            setPayment(null);
            return;
          }
        } catch (pollError) {
          if (pollError.status === 401) {
            setError('The payment status session expired. If you already paid, wait a few seconds and try the page again.');
            setPayment(null);
            return;
          }
        }
      }

      if (!cancelled) {
        setPaymentStatus('pending');
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [payment, success]);

  const resolveAccount = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDetails(null);
    setPayment(null);
    setSuccess(null);
    setPaymentStatus('');

    try {
      const result = await request('/resolve', {
        account_number: form.account_number,
        phone: form.phone,
      });
      setDetails(result);
      setForm((current) => ({
        ...current,
        account_number: result.subscriber?.account_number || current.account_number,
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const sendStk = async () => {
    if (!details || busy) return;
    setBusy(true);
    setError('');
    setPaymentStatus('sending');

    try {
      const result = await request('/stk', {
        account_number: form.account_number,
        phone: form.phone,
      });
      setPayment(result);
      setPaymentStatus('queued');
    } catch (requestError) {
      setPaymentStatus('');
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-7 text-slate-900 sm:flex sm:items-center sm:justify-center sm:py-10">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-[30px] bg-white shadow-2xl shadow-black/30">
        <div className="relative overflow-hidden bg-gradient-to-br from-violet-700 via-violet-600 to-indigo-700 px-6 pb-8 pt-7 text-white">
          <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full border-[26px] border-white/10" />
          <div className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl">⌁</div>
            <p className="mt-6 text-[10px] font-black uppercase tracking-[.2em] text-violet-200">Internet renewal</p>
            <h1 className="mt-2 text-3xl font-black leading-tight">Your package has expired</h1>
            <p className="mt-3 max-w-sm text-xs leading-6 text-violet-100">
              Normal internet access is paused. Renew your package here with M-Pesa STK to reconnect.
            </p>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {success ? (
            <div className="py-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-black text-emerald-600">✓</div>
              <h2 className="mt-5 text-2xl font-black text-slate-950">Payment confirmed</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Your package has been renewed. Polyizon is restoring the normal PPPoE profile now.
              </p>
              {success.receipt && (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-left">
                  <span className="text-[9px] font-black uppercase text-slate-400">M-Pesa receipt</span>
                  <strong className="mt-1 block text-sm text-slate-950">{success.receipt}</strong>
                </div>
              )}
              <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-left text-xs leading-6 text-emerald-800">
                Your router may reconnect automatically within a few seconds. If it does not, disconnect and reconnect the router/PPPoE session once.
              </div>
            </div>
          ) : !details ? (
            <form onSubmit={resolveAccount}>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <strong className="text-xs text-amber-900">Payment access only</strong>
                <p className="mt-1 text-[11px] leading-5 text-amber-700">
                  This connection can reach the renewal page, but normal browsing remains blocked until payment is confirmed.
                </p>
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-black text-slate-600">Internet account number</span>
                <input
                  required
                  autoCapitalize="characters"
                  value={form.account_number}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    account_number: event.target.value.toUpperCase().replace(/\s+/g, ''),
                  }))}
                  placeholder="e.g. DEM001"
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold uppercase outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-xs font-black text-slate-600">Registered M-Pesa phone number</span>
                <input
                  required
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="0712345678"
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>

              {error && (
                <div className="mt-4 rounded-xl bg-rose-50 px-3 py-3 text-xs font-bold leading-5 text-rose-700">{error}</div>
              )}

              <button
                disabled={busy}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
              >
                {busy && <Spinner />}
                {busy ? 'Checking account...' : 'Check my package'}
              </button>
            </form>
          ) : (
            <div>
              <button
                type="button"
                disabled={Boolean(payment)}
                onClick={() => {
                  if (!payment) {
                    setDetails(null);
                    setError('');
                  }
                }}
                className="text-[10px] font-black uppercase tracking-[.14em] text-violet-600 disabled:opacity-40"
              >
                ← Change account
              </button>

              <div className="mt-4 rounded-3xl border border-slate-200 p-5">
                <p className="text-[9px] font-black uppercase tracking-[.18em] text-slate-400">{details.network?.name}</p>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black text-slate-950">{details.package?.name}</h2>
                    <p className="mt-1 text-xs text-slate-500">Account {details.subscriber?.account_number}</p>
                  </div>
                  <strong className="shrink-0 text-xl font-black text-violet-700">{money(details.package?.amount)}</strong>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="text-[8px] font-black uppercase text-slate-400">Validity</span>
                    <strong className="mt-1 block text-xs">{details.package?.validity_days} day(s)</strong>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="text-[8px] font-black uppercase text-slate-400">M-Pesa number</span>
                    <strong className="mt-1 block text-xs">{details.subscriber?.phone}</strong>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[.16em] text-emerald-600">Direct-to-bank STK</p>
                    <strong className="mt-1 block text-sm text-slate-950">{details.settlement?.institution_name}</strong>
                    <p className="mt-1 text-[10px] text-emerald-800">Bank account ending {details.settlement?.bank_account_last4}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[8px] font-black uppercase text-emerald-700">No holding wallet</span>
                </div>
                <p className="mt-3 text-[11px] font-semibold leading-5 text-emerald-800">
                  Your M-Pesa payment goes directly to your ISP's configured bank account. Polyizon receives the payment result but does not receive or hold the funds.
                </p>
              </div>

              {payment && (
                <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                  <div className="flex items-center gap-2 text-violet-800">
                    {paymentStatus !== 'applied' && <Spinner />}
                    <strong className="text-xs">Waiting for M-Pesa confirmation</strong>
                  </div>
                  <p className="mt-2 text-[10px] leading-5 text-violet-700">
                    Enter your M-Pesa PIN on the phone. Do not refresh this page while the payment is being confirmed.
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-xl bg-rose-50 px-3 py-3 text-xs font-bold leading-5 text-rose-700">{error}</div>
              )}

              <button
                type="button"
                disabled={busy || Boolean(payment)}
                onClick={sendStk}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-black text-emerald-950 disabled:opacity-50"
              >
                {busy && <Spinner />}
                {payment
                  ? 'Waiting for payment...'
                  : busy
                    ? 'Sending STK...'
                    : `Send M-Pesa STK · ${money(details.package?.amount)}`}
              </button>
            </div>
          )}

          <p className="mt-6 text-center text-[9px] leading-4 text-slate-400">
            Powered by Polyizon · Secure ISP billing
          </p>
        </div>
      </div>
    </main>
  );
}
