import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';


const TOKEN_KEY =
  'nexa_pppoe_portal_token';


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


function bytes(
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
      units.length -
      1,

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
      index >
      1
        ? 2
        : 0
    )
  } ${units[index]}`;
}


function duration(
  seconds
) {
  const value =
    Number(
      seconds ||
      0
    );

  const days =
    Math.floor(
      value /
      86400
    );

  const hours =
    Math.floor(
      (
        value %
        86400
      ) /
      3600
    );

  const minutes =
    Math.floor(
      (
        value %
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

  return new Date(
    value
  ).toLocaleString(
    'en-KE'
  );
}


async function request(
  path,
  {
    token,
    method =
      'GET',

    body,
  } = {}
) {
  const response =
    await fetch(
      `/api/pppoe-portal${path}`,
      {
        method,

        headers: {
          Accept:
            'application/json',

          ...(token
            ? {
                Authorization:
                  `Bearer ${token}`,
              }
            : {}),

          ...(body
            ? {
                'Content-Type':
                  'application/json',
              }
            : {}),
        },

        ...(body
          ? {
              body:
                JSON.stringify(
                  body
                ),
            }
          : {}),
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    const error =
      new Error(
        data.error ||
        'Request failed'
      );

    error.status =
      response.status;

    throw error;
  }

  return data;
}


function Icon({
  name,
  className =
    'h-5 w-5',
}) {
  const paths = {
    home: (
      <>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10.5V20h14v-9.5M9 20v-6h6v6" />
      </>
    ),

    usage: (
      <>
        <path d="M4 18V9" />
        <path d="M10 18V4" />
        <path d="M16 18v-6" />
        <path d="M22 18H2" />
      </>
    ),

    traffic: (
      <>
        <circle
          cx="12"
          cy="12"
          r="8"
        />
        <path d="M12 4v8l6 4" />
      </>
    ),

    billing: (
      <>
        <rect
          x="4"
          y="3"
          width="16"
          height="18"
          rx="2"
        />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),

    profile: (
      <>
        <circle
          cx="12"
          cy="8"
          r="4"
        />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),

    wifi: (
      <>
        <path d="M4 10a12 12 0 0 1 16 0" />
        <path d="M7 14a8 8 0 0 1 10 0" />
        <path d="M10 18a3 3 0 0 1 4 0" />
      </>
    ),

    clock: (
      <>
        <circle
          cx="12"
          cy="12"
          r="9"
        />
        <path d="M12 7v5l3 2" />
      </>
    ),

    data: (
      <>
        <path d="M5 8h14M5 12h14M5 16h14" />
        <circle
          cx="3"
          cy="8"
          r=".5"
        />
        <circle
          cx="3"
          cy="12"
          r=".5"
        />
        <circle
          cx="3"
          cy="16"
          r=".5"
        />
      </>
    ),

    card: (
      <>
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2"
        />
        <path d="M3 10h18" />
      </>
    ),

    pause: (
      <>
        <path d="M8 6v12M16 6v12" />
      </>
    ),

    upgrade: (
      <>
        <path d="M12 20V5" />
        <path d="m6 11 6-6 6 6" />
      </>
    ),

    logout: (
      <>
        <path d="M10 4H5v16h5" />
        <path d="M14 8l4 4-4 4M18 12H9" />
      </>
    ),

    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),

    shield: (
      <>
        <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}


function Modal({
  title,
  close,
  children,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5">

      <button
        type="button"
        className="absolute inset-0"
        onClick={
          close
        }
      />

      <div className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">

        <div className="flex items-center justify-between">

          <h3 className="text-lg font-black text-slate-950">
            {title}
          </h3>

          <button
            type="button"
            onClick={
              close
            }
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
          >
            <Icon
              name="close"
              className="h-4 w-4"
            />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}


function StatusPill({
  online,
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] font-black uppercase ${
        online
          ? 'bg-emerald-400/20 text-emerald-200'
          : 'bg-white/10 text-white/70'
      }`}
    >
      <i
        className={`h-2 w-2 rounded-full ${
          online
            ? 'bg-emerald-400'
            : 'bg-slate-400'
        }`}
      />

      {online
        ? 'Online'
        : 'Offline'}
    </span>
  );
}


export default function PppoePortal() {
  const [
    token,
    setToken,
  ] = useState(
    () =>
      localStorage.getItem(
        TOKEN_KEY
      ) ||
      ''
  );

  const [
    login,
    setLogin,
  ] = useState({
    identity:
      '',

    password:
      '',
  });

  const [
    dashboard,
    setDashboard,
  ] = useState(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(
    Boolean(
      token
    )
  );

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [
    error,
    setError,
  ] = useState('');

  const [
    notice,
    setNotice,
  ] = useState('');

  const [
    tab,
    setTab,
  ] = useState(
    'home'
  );

  const [
    packageOpen,
    setPackageOpen,
  ] = useState(
    false
  );

  const [
    paymentOpen,
    setPaymentOpen,
  ] = useState(
    false
  );

  const [
    pauseOpen,
    setPauseOpen,
  ] = useState(
    false
  );

  const [
    selectedPlan,
    setSelectedPlan,
  ] = useState(
    null
  );

  const [
    paymentPhone,
    setPaymentPhone,
  ] = useState('');

  const [
    pauseDays,
    setPauseDays,
  ] = useState(
    1
  );

  const [
    pendingPayment,
    setPendingPayment,
  ] = useState(
    null
  );

  const [
    profileForm,
    setProfileForm,
  ] = useState({
    phone:
      '',

    email:
      '',
  });

  const [
    passwordForm,
    setPasswordForm,
  ] = useState({
    current_password:
      '',

    new_password:
      '',
  });


  const loadDashboard =
    async currentToken => {
      const activeToken =
        currentToken ||
        token;

      try {
        const data =
          await request(
            '/dashboard',
            {
              token:
                activeToken,
            }
          );

        setDashboard(
          data
        );

        setProfileForm({
          phone:
            data.customer
              ?.phone ||
            '',

          email:
            data.customer
              ?.email ||
            '',
        });

        setPaymentPhone(
          current =>
            current ||
            data.customer
              ?.phone ||
            ''
        );

        setError('');

        return data;
      } catch (
        requestError
      ) {
        if (
          requestError.status ===
          401
        ) {
          localStorage
            .removeItem(
              TOKEN_KEY
            );

          setToken('');
          setDashboard(
            null
          );
        } else {
          setError(
            requestError.message
          );
        }

        return null;
      } finally {
        setLoading(
          false
        );
      }
    };


  useEffect(
    () => {
      if (token) {
        void loadDashboard(
          token
        );
      }
    },
    [
      token,
    ]
  );


  const loginCustomer =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        const result =
          await request(
            '/login',
            {
              method:
                'POST',

              body:
                login,
            }
          );

        localStorage
          .setItem(
            TOKEN_KEY,
            result.token
          );

        setToken(
          result.token
        );

        setLoading(
          true
        );

        await loadDashboard(
          result.token
        );
      } catch (
        requestError
      ) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const logout =
    () => {
      localStorage
        .removeItem(
          TOKEN_KEY
        );

      setToken('');
      setDashboard(
        null
      );

      setTab(
        'home'
      );
    };


  const currentPlan =
    dashboard
      ?.subscription
      ?.current_plan ||
    null;

  const plans =
    dashboard
      ?.subscription
      ?.plans ||
    [];

  const usage =
    dashboard
      ?.usage ||
    {};

  const total =
    usage.total ||
    {};

  const daily =
    usage.daily ||
    [];

  const sessions =
    usage.sessions ||
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

  const totalUsed =
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

  const trafficItems =
    dashboard
      ?.traffic
      ?.items ||
    [];

  const trafficTotal =
    trafficItems
      .reduce(
        (
          sum,
          item
        ) =>
          sum +
          Number(
            item.total_bytes ||
            0
          ),
        0
      );


  const openPayment =
    plan => {
      setSelectedPlan(
        plan
      );

      setPaymentPhone(
        dashboard
          ?.customer
          ?.phone ||
        paymentPhone ||
        ''
      );

      setPaymentOpen(
        true
      );

      setPackageOpen(
        false
      );

      setError('');
    };


  const watchPayment =
    async reference => {
      for (
        let attempt = 0;
        attempt <
        30;
        attempt +=
        1
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              2500
            )
        );

        try {
          const status =
            await request(
              `/payments/${encodeURIComponent(
                reference
              )}`,
              {
                token,
              }
            );

          if (
            status.effective_status ===
              'applied' ||
            status.applied_at
          ) {
            setPendingPayment(
              null
            );

            setPaymentOpen(
              false
            );

            setNotice(
              'Payment confirmed. Your subscription has been updated.'
            );

            await loadDashboard(
              token
            );

            return;
          }

          if (
            [
              'failed',
              'cancelled',
              'canceled',
              'rejected',
              'underpaid',
            ].includes(
              String(
                status.effective_status ||
                ''
              ).toLowerCase()
            )
          ) {
            setPendingPayment(
              null
            );

            setError(
              status.result_description ||
              'The M-Pesa payment was not completed.'
            );

            return;
          }
        } catch (_) {
          // Continue checking while the provider callback arrives.
        }
      }

      setPendingPayment(
        null
      );

      setNotice(
        'The M-Pesa prompt was sent. If you completed it, refresh the dashboard shortly.'
      );
    };


  const pay =
    async event => {
      event.preventDefault();

      if (!selectedPlan) {
        return;
      }

      try {
        setSaving(
          true
        );

        setError('');
        setNotice('');

        const result =
          await request(
            '/payments/initiate',
            {
              token,

              method:
                'POST',

              body: {
                plan_id:
                  selectedPlan.id,

                phone:
                  paymentPhone,
              },
            }
          );

        setPendingPayment(
          result.reference
        );

        setNotice(
          `M-Pesa prompt sent for ${selectedPlan.name}. Complete it using your PIN.`
        );

        void watchPayment(
          result.reference
        );
      } catch (
        requestError
      ) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const pauseSubscription =
    async () => {
      try {
        setSaving(
          true
        );

        setError('');

        await request(
          '/subscription/pause',
          {
            token,

            method:
              'POST',

            body: {
              days:
                Number(
                  pauseDays
                ),
            },
          }
        );

        setPauseOpen(
          false
        );

        setNotice(
          `Subscription paused for ${pauseDays} day(s). Your remaining subscription time will be preserved.`
        );

        await loadDashboard(
          token
        );
      } catch (
        requestError
      ) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const resumeSubscription =
    async () => {
      try {
        setSaving(
          true
        );

        setError('');

        await request(
          '/subscription/resume',
          {
            token,

            method:
              'POST',
          }
        );

        setNotice(
          'Subscription resumed.'
        );

        await loadDashboard(
          token
        );
      } catch (
        requestError
      ) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const saveProfile =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        await request(
          '/profile',
          {
            token,

            method:
              'PUT',

            body:
              profileForm,
          }
        );

        setNotice(
          'Profile updated.'
        );

        await loadDashboard(
          token
        );
      } catch (
        requestError
      ) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const changePassword =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        await request(
          '/password',
          {
            token,

            method:
              'PUT',

            body:
              passwordForm,
          }
        );

        setPasswordForm({
          current_password:
            '',

          new_password:
            '',
        });

        setNotice(
          'Portal password changed.'
        );
      } catch (
        requestError
      ) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  if (!token) {
    return (
      <main className="min-h-screen bg-[#f5f6fb]">

        <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-[1.05fr_.95fr]">

          <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#35116f] via-[#5b21b6] to-[#7c3aed] p-12 text-white lg:flex lg:flex-col lg:justify-between">

            <div>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <Icon
                  name="wifi"
                  className="h-7 w-7"
                />
              </div>

              <h1 className="mt-8 max-w-md text-5xl font-black leading-[1.05]">
                Your internet.
                <span className="block text-violet-200">
                  In your hands.
                </span>
              </h1>

              <p className="mt-5 max-w-md text-sm leading-7 text-violet-100">
                Track usage, renew your package, change speeds, view invoices and manage your subscription from one place.
              </p>
            </div>


            <div className="grid grid-cols-3 gap-3">

              {[
                [
                  'Usage',
                  'Live bandwidth',
                ],

                [
                  'Packages',
                  'Upgrade anytime',
                ],

                [
                  'M-Pesa',
                  'Quick renewals',
                ],
              ].map(
                ([
                  title,
                  text,
                ]) => (
                  <div
                    key={
                      title
                    }
                    className="rounded-2xl bg-white/10 p-4"
                  >
                    <strong className="text-xs">
                      {title}
                    </strong>

                    <p className="mt-1 text-[9px] text-violet-200">
                      {text}
                    </p>
                  </div>
                )
              )}
            </div>
          </section>


          <section className="flex items-center justify-center p-5 sm:p-10">

            <form
              onSubmit={
                loginCustomer
              }
              className="w-full max-w-md rounded-[30px] bg-white p-6 shadow-2xl shadow-slate-200/70 sm:p-8"
            >

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white lg:hidden">
                <Icon
                  name="wifi"
                  className="h-6 w-6"
                />
              </div>

              <p className="mt-6 text-[9px] font-black uppercase tracking-[.2em] text-violet-500">
                Customer Portal
              </p>

              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                Welcome back
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Use the portal credentials provided by your internet provider.
              </p>


              <label className="mt-7 block">

                <span className="text-xs font-black text-slate-600">
                  Username
                </span>

                <input
                  required
                  autoComplete="username"
                  value={
                    login.identity
                  }
                  onChange={
                    event =>
                      setLogin({
                        ...login,

                        identity:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>


              <label className="mt-4 block">

                <span className="text-xs font-black text-slate-600">
                  Password
                </span>

                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={
                    login.password
                  }
                  onChange={
                    event =>
                      setLogin({
                        ...login,

                        password:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>


              {error && (
                <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-600">
                  {error}
                </div>
              )}


              <button
                disabled={
                  saving
                }
                className="mt-6 h-12 w-full rounded-2xl bg-violet-600 text-sm font-black text-white shadow-lg shadow-violet-200 disabled:opacity-50"
              >
                {saving
                  ? 'Signing in...'
                  : 'Open My Internet'}
              </button>


              <p className="mt-5 text-center text-[9px] leading-4 text-slate-400">
                Portal access is separate from your router or PPPoE password.
              </p>
            </form>
          </section>
        </div>
      </main>
    );
  }


  if (
    loading ||
    !dashboard
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] text-sm font-bold text-slate-400">
        Loading your internet...
      </div>
    );
  }


  const customer =
    dashboard.customer;

  const subscription =
    dashboard.subscription;

  const paused =
    subscription.paused;

  const currentExpiry =
    customer.expires_at;

  const paymentsEnabled =
    dashboard.billing
      ?.payments_enabled;


  return (
    <main className="min-h-screen bg-[#f6f7fb] pb-24 text-slate-900">

      <header className="bg-gradient-to-br from-[#32106a] via-[#5520ae] to-[#7735e8] px-4 pb-24 pt-5 text-white sm:px-7">

        <div className="mx-auto max-w-6xl">

          <div className="flex items-center justify-between gap-4">

            <div className="flex min-w-0 items-center gap-3">

              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <Icon
                  name="wifi"
                  className="h-5 w-5"
                />
              </span>

              <div className="min-w-0">

                <p className="truncate text-[9px] font-black uppercase tracking-[.18em] text-violet-200">
                  {customer.network_name ||
                   'Internet Portal'}
                </p>

                <strong className="block truncate text-sm sm:text-base">
                  My Internet
                </strong>
              </div>
            </div>


            <div className="flex items-center gap-2">

              <StatusPill
                online={
                  customer.is_online
                }
              />

              <button
                type="button"
                onClick={
                  logout
                }
                title="Sign out"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white"
              >
                <Icon
                  name="logout"
                  className="h-4 w-4"
                />
              </button>
            </div>
          </div>


          <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">

            <div>

              <p className="text-xs text-violet-200">
                Welcome back,
              </p>

              <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">
                {customer.full_name}
              </h1>

              <p className="mt-2 text-xs text-violet-100">
                Account {
                  customer.account_number
                }
              </p>
            </div>


            <div className="flex gap-2">

              <button
                type="button"
                onClick={() =>
                  openPayment(
                    currentPlan
                  )
                }
                disabled={
                  !currentPlan ||
                  !paymentsEnabled
                }
                className="rounded-xl bg-emerald-400 px-4 py-2.5 text-[10px] font-black text-emerald-950 disabled:opacity-40"
              >
                Pay / Renew
              </button>

              <button
                type="button"
                onClick={() =>
                  setPackageOpen(
                    true
                  )
                }
                className="rounded-xl bg-white/15 px-4 py-2.5 text-[10px] font-black text-white"
              >
                Change Package
              </button>
            </div>
          </div>
        </div>
      </header>


      <div className="mx-auto -mt-16 max-w-6xl space-y-4 px-3 sm:px-6">

        {error && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-xs font-bold text-emerald-700 shadow-sm">
            {notice}
          </div>
        )}


        {/* SUBSCRIPTION HERO */}

        <section className="overflow-hidden rounded-[26px] bg-white shadow-xl shadow-slate-200/70">

          <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6">

            <div className="min-w-0">

              <div className="flex flex-wrap items-center gap-2">

                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[8px] font-black uppercase text-violet-600">
                  Current package
                </span>

                {paused && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[8px] font-black uppercase text-amber-600">
                    Paused
                  </span>
                )}
              </div>

              <h2 className="mt-3 truncate text-2xl font-black text-slate-950">
                {currentPlan
                  ?.name ||
                 'No package'}
              </h2>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-500">

                <span>
                  ↓ {
                    currentPlan
                      ?.download_speed_mbps ||
                    '—'
                  } Mbps
                </span>

                <span>
                  ↑ {
                    currentPlan
                      ?.upload_speed_mbps ||
                    '—'
                  } Mbps
                </span>

                <span>
                  {money(
                    currentPlan
                      ?.price
                  )}
                </span>
              </div>


              <div className="mt-5 flex flex-wrap gap-2">

                {paused ? (
                  <button
                    type="button"
                    disabled={
                      saving
                    }
                    onClick={
                      resumeSubscription
                    }
                    className="rounded-xl bg-emerald-500 px-4 py-2.5 text-[9px] font-black text-white"
                  >
                    Resume Internet
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setPauseOpen(
                        true
                      )
                    }
                    disabled={
                      customer.service_status !==
                      'active'
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[9px] font-black text-amber-700 disabled:opacity-40"
                  >
                    <Icon
                      name="pause"
                      className="h-3.5 w-3.5"
                    />

                    Pause Subscription
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setPackageOpen(
                      true
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-2.5 text-[9px] font-black text-violet-700"
                >
                  <Icon
                    name="upgrade"
                    className="h-3.5 w-3.5"
                  />

                  Upgrade / Downgrade
                </button>
              </div>
            </div>


            <div className="grid min-w-[180px] grid-cols-2 gap-2 sm:grid-cols-1">

              <div className="rounded-2xl bg-slate-50 p-3">

                <small className="text-[8px] font-black uppercase text-slate-400">
                  Renewal date
                </small>

                <strong className="mt-1 block text-xs">
                  {dateText(
                    currentExpiry
                  )}
                </strong>
              </div>

              <div className="rounded-2xl bg-violet-50 p-3">

                <small className="text-[8px] font-black uppercase text-violet-400">
                  Remaining
                </small>

                <strong className="mt-1 block text-xs text-violet-800">
                  {customer.days_remaining ===
                    null
                    ? 'No expiry'
                    : `${customer.days_remaining} day(s)`}
                </strong>
              </div>
            </div>
          </div>
        </section>


        {/* STATS */}

        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">

          <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">

            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Icon
                name="data"
                className="h-4 w-4"
              />
            </span>

            <strong className="mt-4 block text-xl font-black">
              {bytes(
                totalUsed
              )}
            </strong>

            <span className="mt-1 block text-[9px] font-black uppercase text-slate-400">
              30-day usage
            </span>
          </div>


          <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">

            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Icon
                name="clock"
                className="h-4 w-4"
              />
            </span>

            <strong className="mt-4 block text-xl font-black">
              {duration(
                total.session_seconds
              )}
            </strong>

            <span className="mt-1 block text-[9px] font-black uppercase text-slate-400">
              Online time
            </span>
          </div>


          <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">

            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Icon
                name="usage"
                className="h-4 w-4"
              />
            </span>

            <strong className="mt-4 block text-xl font-black">
              {Number(
                total.session_count ||
                0
              )}
            </strong>

            <span className="mt-1 block text-[9px] font-black uppercase text-slate-400">
              Sessions
            </span>
          </div>


          <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">

            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Icon
                name="pause"
                className="h-4 w-4"
              />
            </span>

            <strong className="mt-4 block text-xl font-black">
              {subscription
                .pause_policy
                ?.remaining_days ??
               7}
            </strong>

            <span className="mt-1 block text-[9px] font-black uppercase text-slate-400">
              Pause days left
            </span>
          </div>
        </section>


        {/* NAVIGATION */}

        <nav className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">

          <div className="flex min-w-max gap-1">

            {[
              [
                'home',
                'Overview',
                'home',
              ],

              [
                'usage',
                'Usage',
                'usage',
              ],

              [
                'traffic',
                'Traffic Insights',
                'traffic',
              ],

              [
                'billing',
                'Billing',
                'billing',
              ],

              [
                'profile',
                'Profile',
                'profile',
              ],
            ].map(
              ([
                key,
                label,
                icon,
              ]) => (
                <button
                  key={
                    key
                  }
                  type="button"
                  onClick={() =>
                    setTab(
                      key
                    )
                  }
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[9px] font-black ${
                    tab ===
                    key
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-500'
                  }`}
                >
                  <Icon
                    name={
                      icon
                    }
                    className="h-3.5 w-3.5"
                  />

                  {label}
                </button>
              )
            )}
          </div>
        </nav>


        {/* OVERVIEW */}

        {tab ===
        'home' && (
          <div className="grid gap-4 lg:grid-cols-[1.35fr_.65fr]">

            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">

              <div className="flex items-center justify-between">

                <div>

                  <h3 className="text-sm font-black">
                    Internet activity
                  </h3>

                  <p className="mt-1 text-[9px] text-slate-400">
                    Daily upload + download over the last 30 days
                  </p>
                </div>

                <span className="rounded-full bg-violet-50 px-3 py-1 text-[8px] font-black text-violet-600">
                  {bytes(
                    totalUsed
                  )}
                </span>
              </div>


              {daily.length ? (
                <div className="mt-6 flex h-48 items-end gap-1 overflow-x-auto">

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
                          key={
                            day.day
                          }
                          className="flex min-w-[13px] flex-1 flex-col items-center justify-end gap-1"
                        >

                          <div
                            title={`${day.day}: ${bytes(value)}`}
                            className="w-full rounded-t-md bg-gradient-to-t from-violet-600 to-fuchsia-400"
                            style={{
                              height:
                                `${height}%`,
                            }}
                          />

                          <span className="hidden text-[7px] text-slate-400 sm:block">
                            {day.day
                              ?.slice(
                                8
                              )}
                          </span>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <div className="py-16 text-center text-xs text-slate-400">
                  Usage appears here after RADIUS accounting sessions are recorded.
                </div>
              )}
            </section>


            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">

              <h3 className="text-sm font-black">
                Quick actions
              </h3>

              <div className="mt-4 space-y-2">

                <button
                  type="button"
                  disabled={
                    !paymentsEnabled ||
                    !currentPlan
                  }
                  onClick={() =>
                    openPayment(
                      currentPlan
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-left disabled:opacity-40"
                >

                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
                    <Icon
                      name="card"
                      className="h-4 w-4"
                    />
                  </span>

                  <span>
                    <b className="block text-xs text-emerald-900">
                      Pay package
                    </b>

                    <small className="text-[9px] text-emerald-600">
                      Send an M-Pesa prompt
                    </small>
                  </span>
                </button>


                <button
                  type="button"
                  onClick={() =>
                    setPackageOpen(
                      true
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-2xl bg-violet-50 p-4 text-left"
                >

                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white">
                    <Icon
                      name="upgrade"
                      className="h-4 w-4"
                    />
                  </span>

                  <span>
                    <b className="block text-xs text-violet-900">
                      Change package
                    </b>

                    <small className="text-[9px] text-violet-600">
                      Upgrade or downgrade
                    </small>
                  </span>
                </button>


                <button
                  type="button"
                  onClick={
                    paused
                      ? resumeSubscription
                      : () =>
                          setPauseOpen(
                            true
                          )
                  }
                  className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-4 text-left"
                >

                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white">
                    <Icon
                      name="pause"
                      className="h-4 w-4"
                    />
                  </span>

                  <span>
                    <b className="block text-xs text-amber-900">
                      {paused
                        ? 'Resume internet'
                        : 'Pause internet'}
                    </b>

                    <small className="text-[9px] text-amber-600">
                      Preserve your remaining time
                    </small>
                  </span>
                </button>
              </div>
            </section>
          </div>
        )}


        {/* USAGE */}

        {tab ===
        'usage' && (
          <div className="space-y-4">

            <section className="grid gap-3 sm:grid-cols-3">

              <div className="rounded-[20px] border border-slate-200 bg-white p-5">

                <small className="text-[9px] font-black uppercase text-slate-400">
                  Download
                </small>

                <strong className="mt-2 block text-2xl">
                  {bytes(
                    download
                  )}
                </strong>
              </div>


              <div className="rounded-[20px] border border-slate-200 bg-white p-5">

                <small className="text-[9px] font-black uppercase text-slate-400">
                  Upload
                </small>

                <strong className="mt-2 block text-2xl">
                  {bytes(
                    upload
                  )}
                </strong>
              </div>


              <div className="rounded-[20px] border border-slate-200 bg-white p-5">

                <small className="text-[9px] font-black uppercase text-slate-400">
                  Last activity
                </small>

                <strong className="mt-2 block text-sm">
                  {dateTime(
                    total.last_seen
                  )}
                </strong>
              </div>
            </section>


            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">

              <header className="border-b border-slate-100 p-5">

                <h3 className="text-sm font-black">
                  Session history
                </h3>

                <p className="mt-1 text-[9px] text-slate-400">
                  Your latest RADIUS internet sessions
                </p>
              </header>


              <div className="divide-y divide-slate-100">

                {sessions.map(
                  (
                    session,
                    index
                  ) => (
                    <div
                      key={`${session.acctstarttime}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >

                      <div>

                        <div className="flex items-center gap-2">

                          <b className="text-xs">
                            {session.is_active
                              ? 'Live session'
                              : 'Completed session'}
                          </b>

                          {session.is_active && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[7px] font-black text-emerald-600">
                              LIVE
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-[9px] text-slate-400">
                          {dateTime(
                            session.acctstarttime
                          )}

                          {' · '}

                          {session.framedipaddress ||
                           'No IP'}
                        </p>
                      </div>


                      <div className="text-right">

                        <b className="text-[10px] text-slate-700">
                          ↓ {bytes(
                            session.download_bytes
                          )}
                          {' · '}
                          ↑ {bytes(
                            session.upload_bytes
                          )}
                        </b>

                        <p className="mt-1 text-[8px] text-slate-400">
                          {duration(
                            session.acctsessiontime
                          )}
                        </p>
                      </div>
                    </div>
                  )
                )}


                {!sessions.length && (
                  <div className="p-10 text-center text-xs text-slate-400">
                    No session history yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}


        {/* TRAFFIC INSIGHTS */}

        {tab ===
        'traffic' && (
          <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

            <div>

              <p className="text-[9px] font-black uppercase tracking-[.18em] text-violet-500">
                Application Intelligence
              </p>

              <h3 className="mt-1 text-xl font-black">
                Traffic Insights
              </h3>

              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
                See which applications and content categories are using your internet.
              </p>
            </div>


            {dashboard
              .traffic
              ?.classification_available ? (
              <div className="mt-6 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">

                <div className="flex items-center justify-center">

                  <div
                    className="flex h-48 w-48 items-center justify-center rounded-full"
                    style={{
                      background:
                        'conic-gradient(#7c3aed 0 36%, #ec4899 36% 58%, #0ea5e9 58% 77%, #10b981 77% 90%, #f59e0b 90% 100%)',
                    }}
                  >

                    <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-white">

                      <small className="text-[8px] font-black uppercase text-slate-400">
                        Classified
                      </small>

                      <strong className="mt-1 text-lg">
                        {bytes(
                          trafficTotal
                        )}
                      </strong>
                    </div>
                  </div>
                </div>


                <div className="space-y-2">

                  {trafficItems.map(
                    (
                      item,
                      index
                    ) => {
                      const percent =
                        trafficTotal >
                        0
                          ? (
                              Number(
                                item.total_bytes ||
                                0
                              ) /
                              trafficTotal
                            ) *
                            100
                          : 0;

                      return (
                        <div
                          key={`${item.application}-${index}`}
                          className="rounded-2xl bg-slate-50 p-4"
                        >

                          <div className="flex items-center justify-between gap-4">

                            <div>

                              <strong className="text-xs">
                                {item.application}
                              </strong>

                              <p className="mt-0.5 text-[8px] uppercase text-slate-400">
                                {item.category}
                              </p>
                            </div>

                            <div className="text-right">

                              <b className="text-xs">
                                {bytes(
                                  item.total_bytes
                                )}
                              </b>

                              <p className="mt-0.5 text-[8px] text-slate-400">
                                {percent.toFixed(1)}%
                              </p>
                            </div>
                          </div>


                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">

                            <div
                              className="h-full rounded-full bg-violet-600"
                              style={{
                                width:
                                  `${Math.max(
                                    1,
                                    percent
                                  )}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[22px] border border-dashed border-violet-200 bg-violet-50/50 p-7">

                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white">
                  <Icon
                    name="traffic"
                    className="h-6 w-6"
                  />
                </span>

                <h4 className="mt-4 text-base font-black text-slate-900">
                  Application classification is ready for DPI
                </h4>

                <p className="mt-2 max-w-xl text-xs leading-6 text-slate-500">
                  Your total upload/download usage above is already real. To distinguish YouTube, TikTok, Facebook, Netflix, gaming and other applications, the network needs DPI/IPFIX telemetry such as nDPI or ntopng. No estimated or fabricated application percentages are shown.
                </p>

                <div className="mt-5 flex flex-wrap gap-2">

                  {[
                    'YouTube',
                    'TikTok',
                    'Facebook',
                    'Netflix',
                    'Gaming',
                    'WhatsApp',
                  ].map(
                    item => (
                      <span
                        key={
                          item
                        }
                        className="rounded-full bg-white px-3 py-1.5 text-[8px] font-black text-violet-700 shadow-sm"
                      >
                        {item}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}
          </section>
        )}


        {/* BILLING */}

        {tab ===
        'billing' && (
          <div className="grid gap-4 lg:grid-cols-2">

            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">

              <header className="border-b border-slate-100 p-5">

                <h3 className="text-sm font-black">
                  Invoices
                </h3>
              </header>

              <div className="divide-y divide-slate-100">

                {dashboard
                  .billing
                  .invoices
                  .map(
                    invoice => (
                      <div
                        key={
                          invoice.invoice_number
                        }
                        className="flex items-center justify-between gap-4 p-4"
                      >

                        <div>

                          <b className="text-xs">
                            {
                              invoice.invoice_number
                            }
                          </b>

                          <p className="mt-1 text-[8px] text-slate-400">
                            {dateText(
                              invoice.created_at
                            )}
                          </p>
                        </div>

                        <div className="text-right">

                          <b className="text-xs">
                            {money(
                              invoice.amount
                            )}
                          </b>

                          <p className={`mt-1 text-[8px] font-black uppercase ${
                            invoice.status ===
                            'paid'
                              ? 'text-emerald-600'
                              : 'text-amber-600'
                          }`}>
                            {
                              invoice.status
                            }
                          </p>
                        </div>
                      </div>
                    )
                  )}


                {!dashboard
                  .billing
                  .invoices
                  .length && (
                  <div className="p-10 text-center text-xs text-slate-400">
                    No invoices yet.
                  </div>
                )}
              </div>
            </section>


            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">

              <header className="border-b border-slate-100 p-5">

                <h3 className="text-sm font-black">
                  Payments
                </h3>
              </header>

              <div className="divide-y divide-slate-100">

                {dashboard
                  .billing
                  .payments
                  .map(
                    (
                      payment,
                      index
                    ) => (
                      <div
                        key={`${payment.reference}-${index}`}
                        className="flex items-center justify-between gap-4 p-4"
                      >

                        <div>

                          <b className="text-xs">
                            {payment.method ||
                             'Payment'}
                          </b>

                          <p className="mt-1 max-w-[180px] truncate text-[8px] text-slate-400">
                            {payment.reference ||
                             'No reference'}
                          </p>
                        </div>

                        <div className="text-right">

                          <b className="text-xs">
                            {money(
                              payment.amount
                            )}
                          </b>

                          <p className="mt-1 text-[8px] font-black uppercase text-emerald-600">
                            {
                              payment.status
                            }
                          </p>
                        </div>
                      </div>
                    )
                  )}


                {!dashboard
                  .billing
                  .payments
                  .length && (
                  <div className="p-10 text-center text-xs text-slate-400">
                    No payments yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}


        {/* PROFILE */}

        {tab ===
        'profile' && (
          <div className="grid gap-4 lg:grid-cols-2">

            <form
              onSubmit={
                saveProfile
              }
              className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm"
            >

              <p className="text-[9px] font-black uppercase tracking-[.18em] text-violet-500">
                My Profile
              </p>

              <h3 className="mt-1 text-lg font-black">
                Contact information
              </h3>


              <div className="mt-5 rounded-2xl bg-slate-50 p-4">

                <small className="text-[8px] font-black uppercase text-slate-400">
                  Account number
                </small>

                <strong className="mt-1 block text-sm">
                  {customer.account_number}
                </strong>
              </div>


              <label className="mt-4 block">

                <span className="text-xs font-black text-slate-600">
                  Phone number
                </span>

                <input
                  value={
                    profileForm.phone
                  }
                  onChange={
                    event =>
                      setProfileForm({
                        ...profileForm,

                        phone:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
                />
              </label>


              <label className="mt-4 block">

                <span className="text-xs font-black text-slate-600">
                  Email
                </span>

                <input
                  type="email"
                  value={
                    profileForm.email
                  }
                  onChange={
                    event =>
                      setProfileForm({
                        ...profileForm,

                        email:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
                />
              </label>


              <button
                disabled={
                  saving
                }
                className="mt-5 h-11 w-full rounded-xl bg-violet-600 text-xs font-black text-white"
              >
                Save Profile
              </button>
            </form>


            <form
              onSubmit={
                changePassword
              }
              className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm"
            >

              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Icon
                  name="shield"
                  className="h-5 w-5"
                />
              </span>

              <h3 className="mt-4 text-lg font-black">
                Portal Security
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                Change only your customer-portal password. Your network PPPoE password is managed separately.
              </p>


              <input
                required
                type="password"
                placeholder="Current portal password"
                value={
                  passwordForm
                    .current_password
                }
                onChange={
                  event =>
                    setPasswordForm({
                      ...passwordForm,

                      current_password:
                        event
                          .target
                          .value,
                    })
                }
                className="mt-5 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
              />


              <input
                required
                type="password"
                minLength="8"
                placeholder="New password"
                value={
                  passwordForm
                    .new_password
                }
                onChange={
                  event =>
                    setPasswordForm({
                      ...passwordForm,

                      new_password:
                        event
                          .target
                          .value,
                    })
                }
                className="mt-3 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
              />


              <button
                disabled={
                  saving
                }
                className="mt-5 h-11 w-full rounded-xl bg-slate-950 text-xs font-black text-white"
              >
                Change Password
              </button>
            </form>
          </div>
        )}
      </div>


      {/* PACKAGE SELECTOR */}

      {packageOpen && (
        <Modal
          title="Choose Internet Package"
          close={() =>
            setPackageOpen(
              false
            )
          }
        >

          <p className="mt-2 text-xs leading-5 text-slate-400">
            Choose a faster or lower-cost package. The new package is applied after successful payment.
          </p>


          <div className="mt-5 space-y-2">

            {plans.map(
              plan => (
                <button
                  key={
                    plan.id
                  }
                  type="button"
                  disabled={
                    plan.direction ===
                    'current'
                  }
                  onClick={() =>
                    openPayment(
                      plan
                    )
                  }
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    plan.direction ===
                    'current'
                      ? 'border-violet-200 bg-violet-50'
                      : 'border-slate-200 bg-white hover:border-violet-300'
                  }`}
                >

                  <div className="flex items-start justify-between gap-3">

                    <div>

                      <div className="flex items-center gap-2">

                        <strong className="text-sm">
                          {
                            plan.name
                          }
                        </strong>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[7px] font-black uppercase ${
                            plan.direction ===
                            'upgrade'
                              ? 'bg-emerald-50 text-emerald-600'
                              : plan.direction ===
                                'downgrade'
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-violet-100 text-violet-600'
                          }`}
                        >
                          {
                            plan.direction
                          }
                        </span>
                      </div>

                      <p className="mt-1 text-[9px] text-slate-400">
                        ↓ {
                          plan.download_speed_mbps ||
                          '—'
                        } Mbps
                        {' · '}
                        ↑ {
                          plan.upload_speed_mbps ||
                          '—'
                        } Mbps
                        {' · '}
                        {
                          plan.validity_days
                        } days
                      </p>
                    </div>


                    <strong className="shrink-0 text-sm">
                      {money(
                        plan.price
                      )}
                    </strong>
                  </div>
                </button>
              )
            )}
          </div>
        </Modal>
      )}


      {/* PAYMENT */}

      {paymentOpen &&
      selectedPlan && (
        <Modal
          title={
            selectedPlan.direction ===
            'upgrade'
              ? 'Upgrade Package'
              : selectedPlan.direction ===
                'downgrade'
                ? 'Downgrade Package'
                : 'Renew Package'
          }
          close={() => {
            if (
              !pendingPayment
            ) {
              setPaymentOpen(
                false
              );
            }
          }}
        >

          <form
            onSubmit={
              pay
            }
          >

            <div className="mt-4 rounded-2xl bg-violet-50 p-4">

              <div className="flex items-start justify-between gap-3">

                <div>

                  <strong className="text-sm text-violet-950">
                    {
                      selectedPlan.name
                    }
                  </strong>

                  <p className="mt-1 text-[9px] text-violet-600">
                    ↓ {
                      selectedPlan.download_speed_mbps ||
                      '—'
                    } Mbps
                    {' · '}
                    ↑ {
                      selectedPlan.upload_speed_mbps ||
                      '—'
                    } Mbps
                  </p>
                </div>

                <strong className="text-lg text-violet-900">
                  {money(
                    selectedPlan.price
                  )}
                </strong>
              </div>
            </div>


            <label className="mt-5 block">

              <span className="text-xs font-black text-slate-600">
                M-Pesa phone number
              </span>

              <input
                required
                value={
                  paymentPhone
                }
                onChange={
                  event =>
                    setPaymentPhone(
                      event
                        .target
                        .value
                    )
                }
                placeholder="0712345678"
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
              />
            </label>


            {pendingPayment && (
              <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-3 text-xs font-bold text-emerald-700">
                Waiting for M-Pesa confirmation...
              </div>
            )}


            <button
              disabled={
                saving ||
                Boolean(
                  pendingPayment
                )
              }
              className="mt-5 h-12 w-full rounded-2xl bg-emerald-500 text-xs font-black text-emerald-950 disabled:opacity-50"
            >
              {pendingPayment
                ? 'Waiting for payment...'
                : saving
                  ? 'Sending prompt...'
                  : `Pay ${money(
                      selectedPlan.price
                    )}`}
            </button>
          </form>
        </Modal>
      )}


      {/* PAUSE */}

      {pauseOpen && (
        <Modal
          title="Pause Subscription"
          close={() =>
            setPauseOpen(
              false
            )
          }
        >

          <div className="mt-4 rounded-2xl bg-amber-50 p-4">

            <strong className="text-xs text-amber-900">
              Preserve your subscription time
            </strong>

            <p className="mt-1 text-[9px] leading-5 text-amber-700">
              Your internet access is suspended during the pause. When it resumes, the actual paused time is added back to your expiry date.
            </p>
          </div>


          <div className="mt-5 grid grid-cols-3 gap-2">

            {[
              1,
              3,
              7,
            ].map(
              days => (
                <button
                  type="button"
                  key={
                    days
                  }
                  onClick={() =>
                    setPauseDays(
                      days
                    )
                  }
                  className={`rounded-2xl border p-4 text-center ${
                    pauseDays ===
                    days
                      ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : 'border-slate-200'
                  }`}
                >

                  <strong className="block text-xl">
                    {days}
                  </strong>

                  <span className="text-[8px] font-black uppercase">
                    Day{days ===
                    1
                      ? ''
                      : 's'}
                  </span>
                </button>
              )
            )}
          </div>


          <p className="mt-4 text-center text-[9px] text-slate-400">
            Remaining pause allowance: {
              subscription
                .pause_policy
                ?.remaining_days ??
              7
            } day(s)
          </p>


          <button
            type="button"
            disabled={
              saving
            }
            onClick={
              pauseSubscription
            }
            className="mt-5 h-12 w-full rounded-2xl bg-amber-500 text-xs font-black text-amber-950"
          >
            Pause for {
              pauseDays
            } day(s)
          </button>
        </Modal>
      )}
    </main>
  );
}
