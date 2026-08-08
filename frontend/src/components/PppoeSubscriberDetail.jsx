import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../utils/api';

import PppoePortalAccessModal
  from './PppoePortalAccessModal';


function formatBytes(
  value
) {
  const number =
    Number(
      value ||
      0
    );

  if (!number) {
    return '0 B';
  }

  const units = [
    'B',
    'KB',
    'MB',
    'GB',
    'TB',
  ];

  const index =
    Math.min(
      units.length - 1,

      Math.floor(
        Math.log(number) /
        Math.log(1024)
      )
    );

  return `${
    (
      number /
      (
        1024 **
        index
      )
    ).toFixed(
      index > 1
        ? 2
        : 0
    )
  } ${units[index]}`;
}


function formatDuration(
  seconds
) {
  const total =
    Number(
      seconds ||
      0
    );

  const days =
    Math.floor(
      total /
      86400
    );

  const hours =
    Math.floor(
      (
        total %
        86400
      ) /
      3600
    );

  const minutes =
    Math.floor(
      (
        total %
        3600
      ) /
      60
    );

  if (days) {
    return `${days}d ${hours}h`;
  }

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}


function money(
  value
) {
  return `KSh ${Number(
    value ||
    0
  ).toLocaleString(
    'en-KE',
    {
      maximumFractionDigits:
        2,
    }
  )}`;
}


function dateText(
  value
) {
  if (!value) {
    return 'Not set';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return 'Not set';
  }

  return date
    .toLocaleDateString(
      'en-KE',
      {
        day:
          'numeric',

        month:
          'short',

        year:
          'numeric',
      }
    );
}


function dateTime(
  value
) {
  if (!value) {
    return '—';
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? '—'
    : date.toLocaleString(
        'en-KE'
      );
}


function Metric({
  label,
  value,
  caption,
}) {
  return (
    <article className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">

      <span className="text-[8px] font-black uppercase tracking-[.14em] text-slate-400">
        {label}
      </span>

      <strong className="mt-2 block truncate text-xl font-black text-slate-950">
        {value}
      </strong>

      {caption && (
        <span className="mt-1 block truncate text-[9px] text-slate-400">
          {caption}
        </span>
      )}
    </article>
  );
}


function Detail({
  label,
  value,
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">

      <span className="text-[8px] font-black uppercase tracking-[.12em] text-slate-400">
        {label}
      </span>

      <strong className="mt-1.5 block break-words text-xs text-slate-800">
        {value ||
         'Not set'}
      </strong>
    </div>
  );
}


function Empty({
  title,
  text,
}) {
  return (
    <div className="p-10 text-center">

      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-lg font-black text-emerald-600">
        ✓
      </div>

      <strong className="mt-4 block text-sm text-slate-800">
        {title}
      </strong>

      <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-slate-400">
        {text}
      </p>
    </div>
  );
}


export default function PppoeSubscriberDetail({
  subscriber,
  back,
  setError,
}) {
  const [
    tab,
    setTab,
  ] = useState(
    'overview'
  );

  const [
    details,
    setDetails,
  ] = useState(
    null
  );

  const [
    usage,
    setUsage,
  ] = useState(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    portalOpen,
    setPortalOpen,
  ] = useState(
    false
  );


  useEffect(
    () => {
      let mounted =
        true;

      const load =
        async () => {
          try {
            setLoading(
              true
            );

            const [
              detailResult,
              usageResult,
            ] =
              await Promise.all([
                api.get(
                  `/billing-workspace/subscribers/${subscriber.id}/details`
                ),

                api.get(
                  `/billing-workspace/subscribers/${subscriber.id}/usage?days=30`
                ),
              ]);

            if (!mounted) {
              return;
            }

            setDetails(
              detailResult.data
            );

            setUsage(
              usageResult.data
            );
          } catch (
            error
          ) {
            if (mounted) {
              setError(
                error.response
                  ?.data
                  ?.error ||
                'Could not load client details.'
              );
            }
          } finally {
            if (mounted) {
              setLoading(
                false
              );
            }
          }
        };

      void load();

      return () => {
        mounted =
          false;
      };
    },
    [
      subscriber.id,
      setError,
    ]
  );


  const record =
    details
      ?.subscriber ||
    subscriber;

  const invoices =
    details
      ?.invoices ||
    [];

  const payments =
    details
      ?.payments ||
    [];

  const tickets =
    details
      ?.tickets ||
    [];

  const radius =
    usage
      ?.usage ||
    {};

  const total =
    radius.total ||
    {};

  const daily =
    radius.daily ||
    [];

  const sessions =
    radius.sessions ||
    [];

  const download =
    Number(
      total.download_bytes ||
      0
    );

  const upload =
    Number(
      total.upload_bytes ||
      0
    );

  const combined =
    download +
    upload;

  const maxDay =
    Math.max(
      1,
      ...daily.map(
        day =>
          Number(
            day.download_bytes ||
            0
          ) +
          Number(
            day.upload_bytes ||
            0
          )
      )
    );


  const online =
    Boolean(
      usage
        ?.subscriber
        ?.is_online ??
      subscriber.is_online
    );


  const initials =
    useMemo(
      () =>
        String(
          record.full_name ||
          'C'
        )
          .split(/\s+/)
          .filter(Boolean)
          .slice(
            0,
            2
          )
          .map(
            part =>
              part[0]
          )
          .join('')
          .toUpperCase(),
      [
        record.full_name,
      ]
    );


  if (loading) {
    return (
      <div className="-mx-5 -mt-5 min-h-screen bg-[#f7f8fb] p-6 sm:-mx-8 sm:-mt-8">

        <button
          type="button"
          onClick={back}
          className="text-xs font-black text-violet-600"
        >
          ← Back to subscribers
        </button>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">

          {[
            1,
            2,
            3,
            4,
          ].map(
            item => (
              <div
                key={item}
                className="h-28 animate-pulse rounded-2xl bg-slate-200"
              />
            )
          )}
        </div>
      </div>
    );
  }


  return (
    <div className="-mx-5 -mt-5 min-h-screen bg-[#f7f8fb] pb-12 sm:-mx-8 sm:-mt-8">

      {/* HOTSPOT-STYLE HEADER */}

      <section className="relative overflow-hidden bg-gradient-to-r from-[#6228e6] via-[#4b21b9] to-[#30168a] px-5 pb-16 pt-6 text-white sm:px-8">

        <div className="relative z-10">

          <button
            type="button"
            onClick={back}
            className="rounded-xl bg-white/10 px-3 py-2 text-[9px] font-black text-white backdrop-blur"
          >
            ← Subscribers
          </button>


          <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">

            <div className="flex min-w-0 items-center gap-4">

              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-white/15 text-xl font-black shadow-inner">
                {initials}
              </span>


              <div className="min-w-0">

                <p className="text-[8px] font-black uppercase tracking-[.2em] text-violet-200">
                  PPPoE Client Control Center
                </p>

                <h2 className="mt-1 truncate text-2xl font-black sm:text-3xl">
                  {record.full_name}
                </h2>

                <p className="mt-1 truncate text-xs text-violet-100">
                  {record.account_number}

                  {' · '}

                  {record.plan_name ||
                   'No package'}
                </p>
              </div>
            </div>


            <div className="flex flex-wrap items-center gap-2">

              <span
                className={`rounded-full px-3 py-2 text-[8px] font-black uppercase ${
                  record.service_status ===
                  'suspended'
                    ? 'bg-amber-300 text-amber-950'
                    : online
                      ? 'bg-emerald-300 text-emerald-950'
                      : 'bg-white/15 text-white'
                }`}
              >
                {record.service_status ===
                'suspended'
                  ? 'Suspended'
                  : online
                    ? 'Online'
                    : 'Offline'}
              </span>


              <button
                type="button"
                onClick={() =>
                  setPortalOpen(
                    true
                  )
                }
                className="rounded-xl bg-white px-4 py-2.5 text-[9px] font-black text-violet-700 shadow-lg"
              >
                Portal Login
              </button>
            </div>
          </div>
        </div>


        <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-10">

          <svg
            viewBox="0 0 1200 180"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            <path
              d="M0 100 C210 30 330 178 520 112 C735 36 850 170 1040 70 C1110 34 1165 55 1200 32 L1200 180 L0 180 Z"
              fill="#f7f8fb"
            />
          </svg>
        </div>
      </section>


      <div className="space-y-4 px-3 sm:px-8">

        {/* METRICS */}

        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">

          <Metric
            label="Package"
            value={
              record.plan_name ||
              'No package'
            }
            caption={
              record.plan_price
                ? money(
                    record.plan_price
                  )
                : 'No price'
            }
          />

          <Metric
            label="Data Used"
            value={
              formatBytes(
                combined
              )
            }
            caption="Last 30 days"
          />

          <Metric
            label="Online Time"
            value={
              formatDuration(
                total.session_seconds
              )
            }
            caption={`${total.session_count || 0} sessions`}
          />

          <Metric
            label="Expires"
            value={
              dateText(
                record.expires_at
              )
            }
            caption={
              record.service_status ||
              'Unknown'
            }
          />
        </section>


        {/* NAVIGATION */}

        <nav className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">

          <div className="flex min-w-max gap-1">

            {[
              [
                'overview',
                'Overview',
              ],

              [
                'usage',
                'Bandwidth Usage',
              ],

              [
                'billing',
                'Billing',
              ],

              [
                'tickets',
                'Tickets',
              ],
            ].map(
              ([
                key,
                label,
              ]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setTab(
                      key
                    )
                  }
                  className={`rounded-xl px-4 py-2.5 text-[9px] font-black transition ${
                    tab === key
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
        </nav>


        {/* OVERVIEW */}

        {tab ===
          'overview' && (
          <div className="grid gap-4 lg:grid-cols-2">

            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">

              <div className="flex items-center justify-between">

                <div>

                  <p className="text-[8px] font-black uppercase tracking-[.18em] text-violet-500">
                    CRM
                  </p>

                  <h3 className="mt-1 text-sm font-black text-slate-950">
                    Customer profile
                  </h3>
                </div>

                <span className="rounded-full bg-violet-50 px-3 py-1 text-[8px] font-black uppercase text-violet-600">
                  Customer
                </span>
              </div>


              <div className="mt-5 grid gap-2 sm:grid-cols-2">

                <Detail
                  label="Account number"
                  value={
                    record.account_number
                  }
                />

                <Detail
                  label="Phone"
                  value={
                    record.phone
                  }
                />

                <Detail
                  label="Email"
                  value={
                    record.email
                  }
                />

                <Detail
                  label="Created"
                  value={
                    dateText(
                      record.created_at
                    )
                  }
                />
              </div>
            </section>


            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">

              <p className="text-[8px] font-black uppercase tracking-[.18em] text-blue-500">
                Subscription
              </p>

              <h3 className="mt-1 text-sm font-black text-slate-950">
                Service details
              </h3>


              <div className="mt-5 grid gap-2 sm:grid-cols-2">

                <Detail
                  label="Package"
                  value={
                    record.plan_name
                  }
                />

                <Detail
                  label="Service status"
                  value={
                    record.service_status
                  }
                />

                <Detail
                  label="Expiry"
                  value={
                    dateText(
                      record.expires_at
                    )
                  }
                />

                <Detail
                  label="Grace period"
                  value={`${Number(
                    record.grace_period_days ||
                    0
                  )} day(s)`}
                />
              </div>
            </section>


            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">

              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">

                <div>

                  <p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-500">
                    Network
                  </p>

                  <h3 className="mt-1 text-sm font-black text-slate-950">
                    PPPoE & RADIUS
                  </h3>


                  <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">

                    <Detail
                      label="RADIUS username"
                      value={
                        record.radius_username
                      }
                    />

                    <Detail
                      label="Router"
                      value={
                        record.router_name
                      }
                    />

                    <Detail
                      label="Access mode"
                      value={
                        record.access_mode
                      }
                    />

                    <Detail
                      label="Static IP"
                      value={
                        record.static_ip ||
                        subscriber.ip_address
                      }
                    />

                    <Detail
                      label="VLAN"
                      value={
                        record.vlan_id
                          ? `VLAN ${record.vlan_id}`
                          : 'No VLAN'
                      }
                    />

                    <Detail
                      label="RADIUS status"
                      value={
                        record.radius_status
                      }
                    />
                  </div>
                </div>


                {/* PORTAL LOGIN IS NOW HERE */}

                <div className="rounded-[20px] bg-gradient-to-br from-violet-50 to-blue-50 p-5">

                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-xl font-black text-white">
                    ↗
                  </span>

                  <h4 className="mt-4 text-sm font-black text-slate-900">
                    Customer Portal
                  </h4>

                  <p className="mt-2 text-[10px] leading-5 text-slate-500">
                    Create or update the credentials this PPPoE customer uses for their self-service portal.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      setPortalOpen(
                        true
                      )
                    }
                    className="mt-5 w-full rounded-xl bg-violet-600 px-4 py-3 text-[9px] font-black text-white"
                  >
                    Manage Portal Login
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}


        {/* USAGE */}

        {tab ===
          'usage' && (
          <div className="space-y-4">

            <section className="grid gap-2 sm:grid-cols-3">

              <Metric
                label="Download"
                value={
                  formatBytes(
                    download
                  )
                }
              />

              <Metric
                label="Upload"
                value={
                  formatBytes(
                    upload
                  )
                }
              />

              <Metric
                label="Last activity"
                value={
                  total.last_seen
                    ? dateText(
                        total.last_seen
                      )
                    : 'No activity'
                }
              />
            </section>


            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">

              <div className="flex flex-wrap items-center justify-between gap-3">

                <div>

                  <h3 className="text-sm font-black text-slate-950">
                    30-day traffic rhythm
                  </h3>

                  <p className="mt-1 text-[9px] text-slate-400">
                    Daily RADIUS upload + download
                  </p>
                </div>

                <span className="rounded-full bg-violet-50 px-3 py-1.5 text-[8px] font-black text-violet-600">
                  {formatBytes(
                    combined
                  )}
                </span>
              </div>


              {daily.length ? (
                <div className="mt-6 flex h-52 items-end gap-1 overflow-x-auto">

                  {daily.map(
                    day => {
                      const value =
                        Number(
                          day.download_bytes ||
                          0
                        ) +
                        Number(
                          day.upload_bytes ||
                          0
                        );

                      const height =
                        Math.max(
                          4,

                          Math.round(
                            (
                              value /
                              maxDay
                            ) *
                            100
                          )
                        );

                      return (
                        <div
                          key={day.day}
                          className="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-1"
                        >

                          <div
                            title={`${day.day}: ${formatBytes(
                              value
                            )}`}
                            className="w-full rounded-t-md bg-gradient-to-t from-violet-700 via-violet-500 to-fuchsia-400"
                            style={{
                              height:
                                `${height}%`,
                            }}
                          />

                          <span className="hidden text-[7px] text-slate-400 sm:block">
                            {String(
                              day.day
                            ).slice(
                              8
                            )}
                          </span>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <Empty
                  title="No accounting data"
                  text="Usage will appear after this PPPoE account records RADIUS sessions."
                />
              )}
            </section>


            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">

              <header className="border-b border-slate-100 p-5">

                <h3 className="text-sm font-black text-slate-950">
                  Session history
                </h3>

                <p className="mt-1 text-[9px] text-slate-400">
                  Recent RADIUS sessions
                </p>
              </header>


              <div className="divide-y divide-slate-100">

                {sessions.map(
                  (
                    session,
                    index
                  ) => (
                    <article
                      key={`${session.acctstarttime}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >

                      <div>

                        <div className="flex items-center gap-2">

                          <strong className="text-xs text-slate-800">
                            {session.is_active
                              ? 'Live session'
                              : 'Completed session'}
                          </strong>

                          {session.is_active && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[7px] font-black text-emerald-600">
                              LIVE
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-[8px] text-slate-400">
                          {dateTime(
                            session.acctstarttime
                          )}

                          {' · '}

                          {session.framedipaddress ||
                           'No IP'}
                        </p>
                      </div>


                      <div className="text-right">

                        <strong className="text-[9px] text-slate-700">
                          ↓ {
                            formatBytes(
                              session.download_bytes
                            )
                          }

                          {' · '}

                          ↑ {
                            formatBytes(
                              session.upload_bytes
                            )
                          }
                        </strong>

                        <p className="mt-1 text-[8px] text-slate-400">
                          {formatDuration(
                            session.acctsessiontime
                          )}
                        </p>
                      </div>
                    </article>
                  )
                )}


                {!sessions.length && (
                  <Empty
                    title="No sessions"
                    text="This customer has no recorded RADIUS sessions yet."
                  />
                )}
              </div>
            </section>
          </div>
        )}


        {/* BILLING */}

        {tab ===
          'billing' && (
          <div className="grid gap-4 lg:grid-cols-2">

            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">

              <header className="border-b border-slate-100 p-5">

                <p className="text-[8px] font-black uppercase tracking-[.18em] text-violet-500">
                  Billing
                </p>

                <h3 className="mt-1 text-sm font-black text-slate-950">
                  Invoices
                </h3>
              </header>


              <div className="divide-y divide-slate-100">

                {invoices.map(
                  invoice => (
                    <article
                      key={
                        invoice.invoice_number
                      }
                      className="flex items-center justify-between gap-4 p-4"
                    >

                      <div>

                        <strong className="text-xs text-slate-800">
                          {
                            invoice.invoice_number
                          }
                        </strong>

                        <p className="mt-1 text-[8px] text-slate-400">
                          Due {
                            dateText(
                              invoice.due_date
                            )
                          }
                        </p>
                      </div>


                      <div className="text-right">

                        <strong className="text-xs text-slate-900">
                          {money(
                            invoice.amount
                          )}
                        </strong>

                        <p
                          className={`mt-1 text-[8px] font-black uppercase ${
                            invoice.status ===
                            'paid'
                              ? 'text-emerald-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {
                            invoice.status
                          }
                        </p>
                      </div>
                    </article>
                  )
                )}


                {!invoices.length && (
                  <Empty
                    title="No invoices"
                    text="No invoices are recorded for this customer."
                  />
                )}
              </div>
            </section>


            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">

              <header className="border-b border-slate-100 p-5">

                <p className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-500">
                  Transactions
                </p>

                <h3 className="mt-1 text-sm font-black text-slate-950">
                  Payments
                </h3>
              </header>


              <div className="divide-y divide-slate-100">

                {payments.map(
                  (
                    payment,
                    index
                  ) => (
                    <article
                      key={`${payment.reference}-${index}`}
                      className="flex items-center justify-between gap-4 p-4"
                    >

                      <div>

                        <strong className="text-xs text-slate-800">
                          {payment.method ||
                           'Payment'}
                        </strong>

                        <p className="mt-1 max-w-[180px] truncate text-[8px] text-slate-400">
                          {payment.reference ||
                           'No reference'}
                        </p>
                      </div>


                      <div className="text-right">

                        <strong className="text-xs text-slate-900">
                          {money(
                            payment.amount
                          )}
                        </strong>

                        <p className="mt-1 text-[8px] font-black uppercase text-emerald-600">
                          {payment.status}
                        </p>
                      </div>
                    </article>
                  )
                )}


                {!payments.length && (
                  <Empty
                    title="No payments"
                    text="No payment transactions are recorded for this customer."
                  />
                )}
              </div>
            </section>
          </div>
        )}


        {/* TICKETS */}

        {tab ===
          'tickets' && (
          <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">

            <header className="border-b border-slate-100 p-5">

              <p className="text-[8px] font-black uppercase tracking-[.18em] text-violet-500">
                Customer Support
              </p>

              <h3 className="mt-1 text-sm font-black text-slate-950">
                CRM Tickets
              </h3>
            </header>


            <div className="divide-y divide-slate-100">

              {tickets.map(
                ticket => (
                  <article
                    key={ticket.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-4"
                  >

                    <div>

                      <strong className="text-xs text-slate-800">
                        {ticket.title}
                      </strong>

                      <p className="mt-1 text-[8px] text-slate-400">
                        {ticket.category ||
                         'General'}

                        {' · '}

                        {ticket.priority ||
                         'Normal'}
                      </p>
                    </div>


                    <div className="text-right">

                      <span
                        className={`rounded-full px-2.5 py-1 text-[8px] font-black uppercase ${
                          ticket.status ===
                          'closed'
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {ticket.status}
                      </span>

                      <p className="mt-1 text-[8px] text-slate-400">
                        {dateText(
                          ticket.updated_at
                        )}
                      </p>
                    </div>
                  </article>
                )
              )}


              {!tickets.length && (
                <Empty
                  title="No support tickets"
                  text="This customer currently has no matching CRM tickets."
                />
              )}
            </div>
          </section>
        )}
      </div>


      {portalOpen && (
        <PppoePortalAccessModal
          subscriber={
            record
          }
          close={() =>
            setPortalOpen(
              false
            )
          }
        />
      )}
    </div>
  );
}
