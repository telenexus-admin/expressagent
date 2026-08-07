import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import AgentPortalSettings from '../components/AgentPortalSettings';

const TOKEN_KEY =
  'nexa-agent-token-v1';

const money = value =>
  `KES ${Number(
    value || 0
  ).toLocaleString(
    'en-KE',
    {
      maximumFractionDigits: 2,
    }
  )}`;

function Icon({
  name,
  className = 'h-5 w-5',
}) {
  const paths = {
    settings: (
      <>
        <circle
          cx="12"
          cy="12"
          r="3"
        />

        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),

    wallet: (
      <>
        <path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M15 11h7v4h-7a2 2 0 1 1 0-4Z" />
      </>
    ),

    voucher: (
      <>
        <path d="M3 7h18v10H3z" />
        <path d="M8 7v10M16 7v10" />
      </>
    ),

    plus: (
      <path d="M12 5v14M5 12h14" />
    ),

    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    ),

    print: (
      <>
        <path d="M6 9V3h12v6" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v7H6z" />
      </>
    ),

    sms: (
      <>
        <path d="M4 5h16v12H7l-3 3V5Z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),

    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M21 19V5a2 2 0 0 0-2-2h-6" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function durationText(
  minutes
) {
  const value =
    Number(
      minutes ||
      0
    );

  if (
    value >= 1440 &&
    value % 1440 ===
      0
  ) {
    return `${
      value / 1440
    } day(s)`;
  }

  if (
    value >= 60 &&
    value % 60 ===
      0
  ) {
    return `${
      value / 60
    } hour(s)`;
  }

  return `${value} minutes`;
}

function escapeHtml(
  value
) {
  return String(
    value ||
    ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    );
}

async function apiRequest(
  path,
  {
    token,
    method = 'GET',
    body,
  } = {}
) {
  const response =
    await fetch(
      `/api/agent-portal${path}`,
      {
        method,

        headers: {
          Accept:
            'application/json',

          ...(body
            ? {
                'Content-Type':
                  'application/json',
              }
            : {}),

          ...(token
            ? {
                Authorization:
                  `Bearer ${token}`,
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

function WalletFlow({
  dashboard,
}) {
  const agent =
    dashboard.agent ||
    {};

  const rows = [
    {
      label:
        'Cash funded',
      value:
        Number(
          agent.total_funded ||
          0
        ),
      className:
        'bg-sky-500',
    },
    {
      label:
        'Voucher credit issued',
      value:
        Number(
          agent.total_credit_issued ||
          0
        ),
      className:
        'bg-violet-500',
    },
    {
      label:
        'Voucher value sold',
      value:
        Number(
          agent.total_generated ||
          0
        ),
      className:
        'bg-emerald-500',
    },
    {
      label:
        'Available credit',
      value:
        Number(
          agent.voucher_balance ||
          0
        ),
      className:
        'bg-amber-400',
    },
  ];

  const maximum =
    Math.max(
      1,
      ...rows.map(
        row =>
          row.value
      )
    );

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
        Wallet movement
      </div>

      <h3 className="mt-1 text-lg font-black">
        Your voucher business
      </h3>

      <p className="mt-1 text-xs text-slate-400">
        Funding, bonus credit and voucher value generated.
      </p>

      <div className="mt-6 space-y-4">
        {rows.map(
          row => {
            const width =
              row.value > 0
                ? Math.max(
                    4,
                    Math.round(
                      (
                        row.value /
                        maximum
                      ) *
                      100
                    )
                  )
                : 0;

            return (
              <div
                key={
                  row.label
                }
              >
                <div className="flex justify-between gap-4 text-[11px]">
                  <span className="font-bold text-slate-500">
                    {
                      row.label
                    }
                  </span>

                  <strong>
                    {money(
                      row.value
                    )}
                  </strong>
                </div>

                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${row.className}`}
                    style={{
                      width:
                        `${width}%`,
                    }}
                  />
                </div>
              </div>
            );
          }
        )}
      </div>
    </section>
  );
}

function VoucherMix({
  dashboard,
}) {
  const denominations =
    dashboard.denominations ||
    [];

  const generations =
    dashboard.generations ||
    [];

  const rows =
    denominations.map(
      denomination => ({
        ...denomination,

        count:
          generations.filter(
            item =>
              Number(
                item.face_value
              ) ===
              Number(
                denomination.face_value
              )
          ).length,
      })
    );

  const maximum =
    Math.max(
      1,
      ...rows.map(
        row =>
          row.count
      )
    );

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
        Voucher activity
      </div>

      <h3 className="mt-1 text-lg font-black">
        Popular voucher values
      </h3>

      <p className="mt-1 text-xs text-slate-400">
        Recent generation activity by configured voucher value.
      </p>

      {rows.length ? (
        <div className="mt-6 space-y-4">
          {rows.map(
            row => {
              const width =
                row.count
                  ? Math.max(
                      8,
                      Math.round(
                        (
                          row.count /
                          maximum
                        ) *
                        100
                      )
                    )
                  : 0;

              return (
                <div
                  key={
                    row.id
                  }
                  className="grid grid-cols-[70px_minmax(0,1fr)_30px] items-center gap-3"
                >
                  <strong className="text-xs text-slate-700">
                    KES {Number(
                      row.face_value
                    ).toLocaleString()}
                  </strong>

                  <div className="h-8 overflow-hidden rounded-xl bg-slate-100">
                    <div
                      style={{
                        width:
                          `${width}%`,
                      }}
                      className="flex h-full min-w-0 items-center rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2 text-[9px] font-black text-white"
                    >
                      {row.count
                        ? row.plan_name
                        : ''}
                    </div>
                  </div>

                  <strong className="text-right text-xs">
                    {
                      row.count
                    }
                  </strong>
                </div>
              );
            }
          )}
        </div>
      ) : (
        <div className="py-12 text-center text-xs text-slate-400">
          The network has not configured agent voucher values yet.
        </div>
      )}
    </section>
  );
}

export default function AgentPortal() {
  const [token, setToken] =
    useState(
      () =>
        localStorage.getItem(
          TOKEN_KEY
        ) ||
        ''
    );

  const [
    dashboard,
    setDashboard,
  ] = useState(
    null
  );

  const [view, setView] =
    useState(
      'overview'
    );

  const [
    fundOpen,
    setFundOpen,
  ] = useState(
    false
  );

  const [
    voucherOpen,
    setVoucherOpen,
  ] = useState(
    false
  );

  const [
    loginForm,
    setLoginForm,
  ] = useState({
    identity: '',
    password: '',
  });

  const [
    fundForm,
    setFundForm,
  ] = useState({
    amount: '',
    phone: '',
  });

  const [
    voucherAmount,
    setVoucherAmount,
  ] = useState('');

  const [
    generated,
    setGenerated,
  ] = useState(
    null
  );

  const [
    smsPhone,
    setSmsPhone,
  ] = useState('');

  const [
    loading,
    setLoading,
  ] = useState(
    Boolean(token)
  );

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [error, setError] =
    useState('');

  const [notice, setNotice] =
    useState('');

  const loadDashboard =
    async currentToken => {
      try {
        const activeToken =
          currentToken ||
          token;

        const [
          base,
          extension,
        ] =
          await Promise.all([
            apiRequest(
              '/dashboard',
              {
                token:
                  activeToken,
              }
            ),

            apiRequest(
              '/extensions/dashboard-data',
              {
                token:
                  activeToken,
              }
            ),
          ]);

        const data = {
          ...base,
          ...extension,

          agent: {
            ...(base.agent ||
              {}),
            ...(extension.agent ||
              {}),
          },

          network: {
            ...(base.network ||
              {}),
            ...(extension.network ||
              {}),
          },

          settings: {
            ...(base.settings ||
              {}),
            ...(extension.settings ||
              {}),
          },

          products:
            extension.products ||
            [],

          denominations:
            extension.denominations ||
            [],

          generations:
            extension.generations ||
            base.generations ||
            [],

          access:
            extension.access ||
            {
              role:
                'owner',
            },
        };

        setDashboard(
          data
        );

        setFundForm(
          current => ({
            ...current,

            phone:
              current.phone ||
              data.agent
                ?.phone ||
              '',
          })
        );

        setError('');

        return data;
      } catch (
        requestError
      ) {
        if (
          requestError
            .status ===
            401 ||
          requestError
            .status ===
            403
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
            requestError
              .message
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
    []
  );

  const login =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        let result;

        try {
          result =
            await apiRequest(
              '/login',
              {
                method:
                  'POST',

                body:
                  loginForm,
              }
            );
        } catch (
          ownerError
        ) {
          if (
            ownerError.status !==
              401 &&
            ownerError.status !==
              403
          ) {
            throw ownerError;
          }

          result =
            await apiRequest(
              '/extensions/team-login',
              {
                method:
                  'POST',

                body:
                  loginForm,
              }
            );
        }

        localStorage.setItem(
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
          requestError
            .message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const logout =
    () => {
      localStorage.removeItem(
        TOKEN_KEY
      );

      setToken('');
      setDashboard(
        null
      );

      setGenerated(
        null
      );

      setView(
        'overview'
      );
    };

  const pollFunding =
    async reference => {
      for (
        let attempt = 0;
        attempt < 40;
        attempt += 1
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              2000
            )
        );

        try {
          const status =
            await apiRequest(
              `/wallet/funding/${encodeURIComponent(reference)}`,
              {
                token,
              }
            );

          if (
            status.status ===
            'paid'
          ) {
            setNotice(
              `Wallet funded successfully. Available voucher credit is ${money(status.balance)}.`
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
            ].includes(
              String(
                status.status
              ).toLowerCase()
            )
          ) {
            setError(
              status
                .result_description ||
              'The M-Pesa payment was not completed.'
            );

            return;
          }
        } catch (_) {
          // Continue polling.
        }
      }

      setNotice(
        'The M-Pesa request is still processing. Refresh after completing payment.'
      );
    };

  const fundWallet =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        const result =
          await apiRequest(
            '/wallet/fund',
            {
              token,

              method:
                'POST',

              body: {
                amount:
                  Number(
                    fundForm
                      .amount
                  ),

                phone:
                  fundForm
                    .phone,
              },
            }
          );

        setFundOpen(
          false
        );

        setNotice(
          `M-Pesa prompt sent for ${money(result.funding_amount)}. Successful payment will add ${money(result.credit_amount)} voucher credit.`
        );

        void pollFunding(
          result.reference
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .message
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const generateVoucher =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        const result =
          await apiRequest(
            '/extensions/vouchers/generate',
            {
              token,

              method:
                'POST',

              body: {
                amount:
                  Number(
                    voucherAmount
                  ),
              },
            }
          );

        setGenerated(
          result
        );

        setVoucherOpen(
          false
        );

        setNotice(
          `Voucher ${result.code} generated successfully.`
        );

        await loadDashboard(
          token
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .message
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const sendSms =
    async () => {
      if (!generated) {
        return;
      }

      try {
        setSaving(
          true
        );

        const result =
          await apiRequest(
            `/extensions/vouchers/${generated.generation_id}/sms`,
            {
              token,

              method:
                'POST',

              body: {
                phone:
                  smsPhone,
              },
            }
          );

        setNotice(
          `Voucher sent by SMS to +${result.phone}.`
        );

        await loadDashboard(
          token
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .message
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const printVoucher =
    () => {
      if (!generated) {
        return;
      }

      const popup =
        window.open(
          '',
          '_blank',
          'width=430,height=620'
        );

      if (!popup) {
        setError(
          'Allow pop-ups to print the voucher.'
        );

        return;
      }

      popup.document.write(`
<!doctype html>
<html>
<head>
<title>Voucher ${escapeHtml(generated.code)}</title>
<style>
body{font-family:system-ui,sans-serif;padding:30px;background:#f3f4f6}
.ticket{max-width:320px;margin:auto;padding:28px;border:2px dashed #111827;border-radius:18px;background:white;text-align:center}
.code{margin:20px 0;font-size:25px;font-weight:900;letter-spacing:2px}
p{margin:8px 0;color:#475569}
strong{color:#0f172a}
</style>
</head>
<body onload="window.print()">
<div class="ticket">
<h2>${escapeHtml(dashboard?.network?.name || 'Internet Voucher')}</h2>
<p>Hotspot Voucher</p>
<div class="code">${escapeHtml(generated.code)}</div>
<p>Value: <strong>${escapeHtml(money(generated.amount))}</strong></p>
<p>Package: <strong>${escapeHtml(generated.plan_name)}</strong></p>
${generated.speed_mbps ? `<p>Speed: <strong>${escapeHtml(generated.speed_mbps)} Mbps</strong></p>` : ''}
<p>Time: <strong>${escapeHtml(durationText(generated.duration_minutes))}</strong></p>
<p>Devices: <strong>${escapeHtml(generated.device_limit)}</strong></p>
<p style="margin-top:20px;font-size:12px">Enter this code on the Hotspot login page.</p>
</div>
</body>
</html>`);

      popup.document.close();
    };

  const expectedCredit =
    useMemo(
      () => {
        const amount =
          Number(
            fundForm.amount ||
            0
          );

        const bonus =
          Number(
            dashboard
              ?.settings
              ?.bonus_percent ||
            0
          );

        return (
          amount *
          (
            1 +
            bonus /
              100
          )
        );
      },
      [
        fundForm.amount,
        dashboard
          ?.settings
          ?.bonus_percent,
      ]
    );

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0b0e1b] px-4 py-10 text-slate-950 sm:py-16">
        <div className="mx-auto max-w-md">

          <div className="mb-8 text-center text-white">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-xl font-black shadow-xl shadow-violet-950/40">
              N
            </div>

            <p className="mt-5 text-[10px] font-black uppercase tracking-[.2em] text-violet-300">
              Nexa agent network
            </p>

            <h1 className="mt-2 text-3xl font-black">
              Agent Portal
            </h1>

            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-400">
              Sign in to manage your voucher wallet and generate customer access.
            </p>
          </div>

          <form
            onSubmit={
              login
            }
            className="rounded-[28px] bg-white p-6 shadow-2xl sm:p-7"
          >
            <h2 className="text-xl font-black">
              Welcome back
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Use the account created by your network administrator.
            </p>

            {error && (
              <div className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">
                {error}
              </div>
            )}

            <label className="mt-6 block">
              <span className="text-xs font-black text-slate-600">
                Email or phone
              </span>

              <input
                required
                value={
                  loginForm
                    .identity
                }
                onChange={
                  event =>
                    setLoginForm({
                      ...loginForm,
                      identity:
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
                Password
              </span>

              <input
                required
                type="password"
                value={
                  loginForm
                    .password
                }
                onChange={
                  event =>
                    setLoginForm({
                      ...loginForm,
                      password:
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
              className="mt-6 h-12 w-full rounded-2xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
            >
              {saving
                ? 'Signing in...'
                : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (
    loading ||
    !dashboard
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0e1b] text-sm text-slate-400">
        Loading agent dashboard...
      </div>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f8fb] pb-20 text-slate-950">

      <section className="relative overflow-hidden bg-gradient-to-br from-[#702cff] via-[#4d22c5] to-[#24158e] px-5 pb-16 pt-7 text-white sm:px-8 lg:px-10">

        <div className="relative z-10 mx-auto flex max-w-6xl items-start justify-between gap-3">

          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[.2em] text-violet-200">
              {dashboard
                .network
                ?.name}
            </p>

            <h1 className="mt-2 truncate text-2xl font-black sm:text-3xl">
              {view ===
              'settings'
                ? 'Account Settings'
                : dashboard
                    .agent
                    ?.business_name ||
                  dashboard
                    .agent
                    ?.name ||
                  'Agent Portal'}
            </h1>

            <p className="mt-2 max-w-xl text-xs leading-5 text-violet-100 sm:text-sm sm:leading-6">
              {view ===
              'settings'
                ? 'Manage your voucher meter, profile picture, portal administrators and network policy.'
                : 'Monitor your voucher credit, fund your wallet and generate customer access instantly.'}
            </p>
          </div>


          <button
            type="button"
            aria-label="Agent portal settings"
            onClick={() =>
              setView(
                current =>
                  current ===
                  'settings'
                    ? 'overview'
                    : 'settings'
              )
            }
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              view ===
              'settings'
                ? 'bg-white text-violet-700'
                : 'bg-white/15 text-white'
            }`}
          >
            <Icon
              name="settings"
            />
          </button>
        </div>


        {view ===
        'overview' && (
          <div className="relative z-10 mx-auto mt-5 flex max-w-6xl flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setFundOpen(
                  true
                )
              }
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-3.5 py-2.5 text-[10px] font-black text-emerald-950"
            >
              <Icon
                name="wallet"
                className="h-3.5 w-3.5"
              />
              Fund wallet
            </button>

            <button
              type="button"
              onClick={() =>
                setVoucherOpen(
                  true
                )
              }
              disabled={
                !dashboard
                  .denominations
                  ?.length
              }
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-[10px] font-black text-violet-700 disabled:opacity-40"
            >
              <Icon
                name="plus"
                className="h-3.5 w-3.5"
              />
              Generate voucher
            </button>
          </div>
        )}


        <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-12">
          <svg
            viewBox="0 0 1200 180"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            <path
              d="M0 100 C180 20 300 190 510 115 C720 40 780 175 1000 70 C1090 28 1140 65 1200 25 L1200 180 L0 180 Z"
              fill="#f7f8fb"
            />
          </svg>
        </div>
      </section>


      <div className="mx-auto max-w-6xl space-y-4 px-3 sm:px-6 lg:px-8">

        {error && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-2xl border border-violet-100 bg-white px-4 py-3 text-xs font-bold text-violet-700 shadow-sm">
            {notice}
          </div>
        )}


        {view ===
        'overview' ? (
          <>
            <section className="rounded-[26px] bg-[#11172a] p-5 text-white shadow-xl shadow-slate-300/40 sm:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <small className="text-[10px] font-black uppercase tracking-[.16em] text-violet-300">
                    Voucher wallet
                  </small>

                  <strong className="mt-2 block text-3xl font-black tracking-tight sm:text-4xl">
                    {money(
                      dashboard
                        .agent
                        ?.voucher_balance
                    )}
                  </strong>

                  <p className="mt-2 text-xs text-slate-400">
                    Available credit for generating vouchers.
                  </p>
                </div>

                {dashboard.agent
                  ?.profile_image_data ? (
                  <img
                    src={
                      dashboard.agent
                        .profile_image_data
                    }
                    alt=""
                    className="h-11 w-11 rounded-2xl object-cover ring-2 ring-white/20"
                  />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/20 text-violet-300">
                    <Icon
                      name="wallet"
                    />
                  </span>
                )}
              </div>


              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white/5 p-3">
                  <small className="text-[8px] font-black uppercase text-slate-400 sm:text-[9px]">
                    Funded
                  </small>

                  <b className="mt-1 block truncate text-xs sm:text-sm">
                    {money(
                      dashboard
                        .agent
                        ?.total_funded
                    )}
                  </b>
                </div>

                <div className="rounded-2xl bg-white/5 p-3">
                  <small className="text-[8px] font-black uppercase text-slate-400 sm:text-[9px]">
                    Credit
                  </small>

                  <b className="mt-1 block truncate text-xs sm:text-sm">
                    {money(
                      dashboard
                        .agent
                        ?.total_credit_issued
                    )}
                  </b>
                </div>

                <div className="rounded-2xl bg-white/5 p-3">
                  <small className="text-[8px] font-black uppercase text-slate-400 sm:text-[9px]">
                    Generated
                  </small>

                  <b className="mt-1 block truncate text-xs sm:text-sm">
                    {money(
                      dashboard
                        .agent
                        ?.total_generated
                    )}
                  </b>
                </div>
              </div>
            </section>


            <div className="grid gap-4 lg:grid-cols-2">
              <WalletFlow
                dashboard={
                  dashboard
                }
              />

              <VoucherMix
                dashboard={
                  dashboard
                }
              />
            </div>


            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">

              <div className="border-b border-slate-100 p-5">
                <div className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">
                  Activity
                </div>

                <h3 className="mt-1 text-lg font-black">
                  Recent vouchers
                </h3>

                <p className="mt-1 text-xs text-slate-400">
                  Customer vouchers generated from your wallet.
                </p>
              </div>


              {dashboard
                .generations
                ?.length ? (
                <div className="divide-y divide-slate-100">
                  {dashboard
                    .generations
                    .slice(
                      0,
                      20
                    )
                    .map(
                      voucher => (
                        <div
                          key={
                            voucher.id
                          }
                          className="flex items-center gap-3 p-4 sm:px-5"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                            <Icon
                              name="voucher"
                              className="h-4 w-4"
                            />
                          </span>

                          <div className="min-w-0 flex-1">
                            <strong className="block truncate font-mono text-xs tracking-wide text-slate-900">
                              {
                                voucher.code
                              }
                            </strong>

                            <span className="mt-1 block truncate text-[10px] text-slate-400">
                              {voucher.plan_name}
                              {' · '}
                              {durationText(
                                voucher.duration_minutes
                              )}
                              {' · '}
                              {voucher.device_limit} device(s)
                            </span>
                          </div>

                          <div className="shrink-0 text-right">
                            <strong className="block text-xs">
                              {money(
                                voucher.face_value
                              )}
                            </strong>

                            <small
                              className={`mt-1 inline-flex rounded-full px-2 py-1 text-[8px] font-black uppercase ${
                                voucher.voucher_status ===
                                'active'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-violet-50 text-violet-600'
                              }`}
                            >
                              {
                                voucher.voucher_status
                              }
                            </small>
                          </div>
                        </div>
                      )
                    )}
                </div>
              ) : (
                <div className="px-5 py-14 text-center text-xs text-slate-400">
                  Your generated vouchers will appear here.
                </div>
              )}
            </section>
          </>
        ) : (
          <AgentPortalSettings
            dashboard={
              dashboard
            }
            token={
              token
            }
            onReload={() =>
              loadDashboard(
                token
              )
            }
            onNotice={
              setNotice
            }
            onError={
              setError
            }
            onLogout={
              logout
            }
          />
        )}
      </div>


      {fundOpen && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center">
          <button
            type="button"
            aria-label="Close wallet funding"
            className="absolute inset-0"
            onClick={() =>
              setFundOpen(
                false
              )
            }
          />

          <form
            onSubmit={
              fundWallet
            }
            className="relative z-10 w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
                  Voucher wallet
                </p>

                <h3 className="mt-1 text-xl font-black">
                  Fund wallet
                </h3>
              </div>

              <button
                type="button"
                onClick={() =>
                  setFundOpen(
                    false
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
              >
                <Icon
                  name="close"
                  className="h-4 w-4"
                />
              </button>
            </div>

            <input
              required
              type="number"
              min={
                dashboard
                  .settings
                  ?.minimum_funding_amount
              }
              max={
                dashboard
                  .settings
                  ?.maximum_funding_amount
              }
              placeholder="Amount to pay"
              value={
                fundForm
                  .amount
              }
              onChange={
                event =>
                  setFundForm({
                    ...fundForm,
                    amount:
                      event
                        .target
                        .value,
                  })
              }
              className="mt-6 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
            />

            <input
              required
              type="tel"
              placeholder="M-Pesa phone"
              value={
                fundForm
                  .phone
              }
              onChange={
                event =>
                  setFundForm({
                    ...fundForm,
                    phone:
                      event
                        .target
                        .value,
                  })
              }
              className="mt-3 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
            />

            {Number(
              fundForm
                .amount
            ) > 0 && (
              <div className="mt-3 rounded-2xl bg-violet-50 p-4 text-xs font-bold leading-5 text-violet-700">
                Pay {money(
                  fundForm.amount
                )} and receive approximately {money(
                  expectedCredit
                )} voucher credit.
              </div>
            )}

            <button
              disabled={
                saving
              }
              className="mt-4 h-12 w-full rounded-2xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
            >
              {saving
                ? 'Sending...'
                : 'Send M-Pesa prompt'}
            </button>
          </form>
        </div>
      )}


      {voucherOpen && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center">
          <button
            type="button"
            aria-label="Close voucher generator"
            className="absolute inset-0"
            onClick={() =>
              setVoucherOpen(
                false
              )
            }
          />

          <form
            onSubmit={
              generateVoucher
            }
            className="relative z-10 w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
                  Sell internet
                </p>

                <h3 className="mt-1 text-xl font-black">
                  Generate voucher
                </h3>

                <p className="mt-1 text-xs text-slate-400">
                  Choose the customer voucher amount.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setVoucherOpen(
                    false
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
              >
                <Icon
                  name="close"
                  className="h-4 w-4"
                />
              </button>
            </div>


            <input
              required
              type="number"
              list="nexa-agent-values"
              placeholder="Voucher amount"
              value={
                voucherAmount
              }
              onChange={
                event =>
                  setVoucherAmount(
                    event
                      .target
                      .value
                  )
              }
              className="mt-6 h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xl font-black outline-none focus:border-violet-400"
            />

            <datalist id="nexa-agent-values">
              {dashboard
                .denominations
                .map(
                  item => (
                    <option
                      key={
                        item.id
                      }
                      value={
                        item.face_value
                      }
                    />
                  )
                )}
            </datalist>


            <div className="mt-3 flex flex-wrap gap-2">
              {dashboard
                .denominations
                .map(
                  item => (
                    <button
                      key={
                        item.id
                      }
                      type="button"
                      onClick={() =>
                        setVoucherAmount(
                          item.face_value
                        )
                      }
                      className="rounded-full bg-violet-50 px-3 py-2 text-[10px] font-black text-violet-700"
                    >
                      KES {Number(
                        item.face_value
                      ).toLocaleString()}
                    </button>
                  )
                )}
            </div>

            <button
              disabled={
                saving ||
                !dashboard
                  .denominations
                  .length
              }
              className="mt-5 h-12 w-full rounded-2xl bg-emerald-500 text-sm font-black text-white disabled:opacity-40"
            >
              {saving
                ? 'Generating...'
                : 'Generate voucher'}
            </button>
          </form>
        </div>
      )}


      {generated && (
        <div className="fixed inset-0 z-[10001] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center">
          <button
            type="button"
            aria-label="Close generated voucher"
            onClick={() =>
              setGenerated(
                null
              )
            }
            className="absolute inset-0"
          />

          <div className="relative z-10 w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-7">

            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.17em] text-emerald-600">
                  Voucher ready
                </p>

                <h3 className="mt-1 text-xl font-black">
                  Customer access
                </h3>
              </div>

              <button
                type="button"
                onClick={() =>
                  setGenerated(
                    null
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
              >
                <Icon
                  name="close"
                  className="h-4 w-4"
                />
              </button>
            </div>


            <div className="mt-5 rounded-3xl border-2 border-dashed border-violet-300 bg-violet-50/50 p-5 text-center">

              <small className="text-[9px] font-black uppercase tracking-[.17em] text-violet-500">
                Hotspot voucher
              </small>

              <div className="mt-3 break-all font-mono text-2xl font-black tracking-wider text-slate-950">
                {
                  generated.code
                }
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[
                  money(
                    generated.amount
                  ),

                  generated
                    .plan_name,

                  durationText(
                    generated
                      .duration_minutes
                  ),

                  `${generated.device_limit} device(s)`,
                ].map(
                  item => (
                    <span
                      key={
                        item
                      }
                      className="rounded-full bg-white px-3 py-2 text-[10px] font-black text-slate-600"
                    >
                      {item}
                    </span>
                  )
                )}
              </div>
            </div>


            <input
              type="tel"
              placeholder="Customer phone for SMS"
              value={
                smsPhone
              }
              onChange={
                event =>
                  setSmsPhone(
                    event
                      .target
                      .value
                  )
              }
              className="mt-4 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
            />


            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={
                  printVoucher
                }
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-xs font-black text-white"
              >
                <Icon
                  name="print"
                  className="h-4 w-4"
                />
                Print
              </button>

              <button
                type="button"
                disabled={
                  saving ||
                  !smsPhone ||
                  !dashboard
                    .settings
                    ?.sms_enabled
                }
                onClick={
                  sendSms
                }
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-xs font-black text-white disabled:opacity-40"
              >
                <Icon
                  name="sms"
                  className="h-4 w-4"
                />
                Send SMS
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
