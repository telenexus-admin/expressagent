import React, { useMemo, useState } from 'react';

function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stateOf(request) {
  if (request.profile?.routing_status === 'active') return 'active';
  return request.profile?.verification_status || 'pending';
}

function Status({ value }) {
  const tones = {
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rejected: 'border-rose-200 bg-rose-50 text-rose-700',
    suspended: 'border-slate-200 bg-slate-100 text-slate-600',
    verified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
  const label = value === 'active' ? 'Approved / active' : value === 'pending' ? 'Pending review' : value;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-extrabold capitalize ${tones[value] || tones.pending}`}>{label}</span>;
}

export default function PaymentRequests({ requests, loading, busyId, onReview }) {
  const [filter, setFilter] = useState('pending');
  const pendingCount = requests.filter((request) => stateOf(request) === 'pending').length;
  const visible = useMemo(
    () => requests.filter((request) => filter === 'all' || stateOf(request) === filter),
    [requests, filter]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.18em] text-[#7654ef]">Settlement control</div>
          <h1 className="mt-1 text-2xl font-extrabold">Payment requests</h1>
          <p className="mt-1 text-sm text-slate-500">Review ISP bank destination changes before they become active.</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-extrabold text-amber-800">
          {pendingCount} pending
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {['pending', 'active', 'rejected', 'all'].map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`rounded-xl px-3 py-2 text-xs font-bold capitalize ${filter === item ? 'bg-[#ece6ff] text-[#6331e2]' : 'border border-[#e3e5ef] bg-white text-slate-500'}`}
          >
            {item === 'active' ? 'Approved' : item}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#e6e8f2] bg-white shadow-sm">
        <div className="hidden grid-cols-[minmax(180px,1.5fr)_minmax(160px,1fr)_150px_150px_145px] gap-4 border-b border-[#eef0f6] px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500 lg:grid">
          <span>ISP</span><span>Bank destination</span><span>Account</span><span>Requested</span><span>Status / action</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading payment requests...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No {filter === 'all' ? '' : filter} payment requests.</div>
        ) : (
          <div className="divide-y divide-[#eef0f6]">
            {visible.map((request) => {
              const state = stateOf(request);
              const profile = request.profile || {};
              const busy = busyId === request.request_id;
              return (
                <div key={request.request_id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(180px,1.5fr)_minmax(160px,1fr)_150px_150px_145px] lg:items-center lg:gap-4">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">{request.client?.name || `ISP #${request.client?.id}`}</div>
                    <div className="mt-0.5 text-xs text-slate-400">Account #{request.client?.id}</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-800">{profile.institution_name || '—'}</div>
                    <div className="mt-0.5 text-xs font-bold text-emerald-700">{request.direct_stk?.mpesa_paybill ? `M-PESA Paybill ${request.direct_stk.mpesa_paybill}` : 'Route unavailable'}</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-800">{profile.account_number_masked || '—'}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">{profile.account_name || ''}</div>
                  </div>
                  <div className="text-xs text-slate-500">{dateTime(profile.updated_at)}</div>
                  <div>
                    <Status value={state} />
                    {state === 'pending' && (
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => onReview(request, 'verified')}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busy ? 'Working...' : 'Approve'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => onReview(request, 'rejected')}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-extrabold text-rose-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
