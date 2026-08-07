import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

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

function durationText(minutes) {
  const value =
    Number(minutes || 0);

  if (
    value >= 1440 &&
    value % 1440 === 0
  ) {
    return `${
      value / 1440
    } day(s)`;
  }

  if (
    value >= 60 &&
    value % 60 === 0
  ) {
    return `${
      value / 60
    } hour(s)`;
  }

  return `${value} minutes`;
}

function escapeHtml(value) {
  return String(value || '')
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
      .catch(() => ({}));

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

export default function AgentPortal() {
  const [token, setToken] =
    useState(
      () =>
        localStorage.getItem(
          TOKEN_KEY
        ) || ''
    );

  const [dashboard, setDashboard] =
    useState(null);

  const [loginForm, setLoginForm] =
    useState({
      identity: '',
      password: '',
    });

  const [fundForm, setFundForm] =
    useState({
      amount: '',
      phone: '',
    });

  const [voucherAmount, setVoucherAmount] =
    useState('');

  const [generated, setGenerated] =
    useState(null);

  const [smsPhone, setSmsPhone] =
    useState('');

  const [loading, setLoading] =
    useState(Boolean(token));

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState('');

  const [notice, setNotice] =
    useState('');

  const loadDashboard =
    async currentToken => {
      try {
        const data =
          await apiRequest(
            '/dashboard',
            {
              token:
                currentToken ||
                token,
            }
          );

        setDashboard(data);

        setFundForm(
          current => ({
            ...current,

            phone:
              current.phone ||
              data.agent?.phone ||
              '',
          })
        );

        setError('');

        return data;
      } catch (requestError) {
        if (
          requestError.status ===
          401 ||
          requestError.status ===
          403
        ) {
          localStorage
            .removeItem(
              TOKEN_KEY
            );

          setToken('');
          setDashboard(null);
        } else {
          setError(
            requestError.message
          );
        }

        return null;
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    if (token) {
      void loadDashboard(
        token
      );
    }
  }, []);

  const login = async event => {
    event.preventDefault();

    try {
      setSaving(true);

      const result =
        await apiRequest(
          '/login',
          {
            method:
              'POST',

            body:
              loginForm,
          }
        );

      localStorage.setItem(
        TOKEN_KEY,
        result.token
      );

      setToken(
        result.token
      );

      setLoading(true);

      await loadDashboard(
        result.token
      );
    } catch (requestError) {
      setError(
        requestError.message
      );
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(
      TOKEN_KEY
    );

    setToken('');
    setDashboard(null);
    setGenerated(null);
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
              `/wallet/funding/${
                encodeURIComponent(
                  reference
                )
              }`,
              {
                token,
              }
            );

          if (
            status.status ===
            'paid'
          ) {
            setNotice(
              `Wallet funded successfully. Voucher credit balance is ${money(status.balance)}.`
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
              status.result_description ||
              'The M-Pesa payment was not completed.'
            );

            return;
          }
        } catch (_) {
          // Poll again.
        }
      }

      setNotice(
        'The M-Pesa request is still being processed. Refresh the dashboard after completing payment.'
      );
    };

  const fundWallet =
    async event => {
      event.preventDefault();

      try {
        setSaving(true);
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
                    fundForm.amount
                  ),

                phone:
                  fundForm.phone,
              },
            }
          );

        setNotice(
          `M-Pesa prompt sent for ${money(result.funding_amount)}. Successful payment will add ${money(result.credit_amount)} voucher credit.`
        );

        void pollFunding(
          result.reference
        );
      } catch (requestError) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(false);
      }
    };

  const generateVoucher =
    async event => {
      event.preventDefault();

      try {
        setSaving(true);
        setError('');

        const result =
          await apiRequest(
            '/vouchers/generate',
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

        setNotice(
          `Voucher ${result.code} generated successfully.`
        );

        await loadDashboard(
          token
        );
      } catch (requestError) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(false);
      }
    };

  const sendSms =
    async () => {
      if (
        !generated
      ) {
        return;
      }

      try {
        setSaving(true);

        const result =
          await apiRequest(
            `/vouchers/${
              generated.generation_id
            }/sms`,
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
      } catch (requestError) {
        setError(
          requestError.message
        );
      } finally {
        setSaving(false);
      }
    };

  const printVoucher = () => {
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
      body{
        font-family:system-ui,sans-serif;
        padding:30px;
        background:#f3f4f6
      }
      .ticket{
        max-width:320px;
        margin:auto;
        padding:28px;
        border:2px dashed #111827;
        border-radius:18px;
        background:white;
        text-align:center
      }
      .code{
        margin:20px 0;
        font-size:25px;
        font-weight:900;
        letter-spacing:2px
      }
      p{margin:8px 0;color:#475569}
      strong{color:#0f172a}
      </style>
      </head>

      <body onload="window.print()">
        <div class="ticket">
          <h2>${escapeHtml(
            dashboard?.network?.name ||
            'Internet Voucher'
          )}</h2>

          <p>Hotspot Voucher</p>

          <div class="code">
            ${escapeHtml(
              generated.code
            )}
          </div>

          <p>
            Value:
            <strong>
              ${escapeHtml(
                money(
                  generated.amount
                )
              )}
            </strong>
          </p>

          <p>
            Package:
            <strong>
              ${escapeHtml(
                generated.plan_name
              )}
            </strong>
          </p>

          <p>
            Time:
            <strong>
              ${escapeHtml(
                durationText(
                  generated.duration_minutes
                )
              )}
            </strong>
          </p>

          <p>
            Devices:
            <strong>
              ${escapeHtml(
                generated.device_limit
              )}
            </strong>
          </p>

          <p style="margin-top:20px;font-size:12px">
            Enter this code on the Hotspot login page.
          </p>
        </div>
      </body>
      </html>
    `);

    popup.document.close();
  };

  const availableCredit =
    Number(
      dashboard?.agent
        ?.voucher_balance ||
      0
    );

  const expectedCredit =
    useMemo(() => {
      const amount =
        Number(
          fundForm.amount ||
          0
        );

      const bonus =
        Number(
          dashboard?.settings
            ?.bonus_percent ||
          0
        );

      return (
        amount *
        (
          1 +
          bonus / 100
        )
      );
    }, [
      fundForm.amount,
      dashboard?.settings
        ?.bonus_percent,
    ]);

  if (!token) {
    return (
      <main className="min-h-screen bg-[#07111f] px-4 py-12 text-slate-900">
        <div className="mx-auto max-w-sm">

          <div className="mb-8 text-center text-white">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400 text-xl font-black text-emerald-950">
              N
            </div>

            <h1 className="mt-4 text-2xl font-black">
              Agent Portal
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Fund your wallet and generate customer Hotspot vouchers.
            </p>
          </div>

          <form
            onSubmit={login}
            className="rounded-[28px] bg-white p-6 shadow-2xl"
          >
            <h2 className="text-xl font-black">
              Sign in
            </h2>

            {error && (
              <div className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">
                {error}
              </div>
            )}

            <label className="mt-5 block text-xs font-bold">
              Email or phone

              <input
                required
                value={
                  loginForm.identity
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
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-emerald-500"
              />
            </label>

            <label className="mt-4 block text-xs font-bold">
              Password

              <input
                required
                type="password"
                value={
                  loginForm.password
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
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-emerald-500"
              />
            </label>

            <button
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-black text-white disabled:opacity-50"
            >
              Sign in
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Loading agent wallet...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7f6] pb-12 text-slate-950">
      <header className="bg-[#07111f] px-4 pb-20 pt-5 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.16em] text-emerald-400">
              {dashboard.network?.name}
            </div>

            <h1 className="mt-1 text-xl font-black">
              {dashboard.agent?.business_name ||
               dashboard.agent?.name}
            </h1>
          </div>

          <button
            onClick={logout}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="-mt-12 mx-auto max-w-6xl space-y-5 px-4">

        <section className="rounded-[28px] bg-gradient-to-br from-emerald-500 to-teal-500 p-6 text-white shadow-xl shadow-emerald-200/50">
          <div className="text-xs font-bold text-emerald-50">
            Voucher wallet
          </div>

          <div className="mt-2 text-4xl font-black">
            {money(
              availableCredit
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/15 p-3">
              <small className="text-[9px] uppercase text-emerald-50">
                Funded
              </small>

              <b className="mt-1 block text-sm">
                {money(
                  dashboard.agent
                    ?.total_funded
                )}
              </b>
            </div>

            <div className="rounded-xl bg-white/15 p-3">
              <small className="text-[9px] uppercase text-emerald-50">
                Credit issued
              </small>

              <b className="mt-1 block text-sm">
                {money(
                  dashboard.agent
                    ?.total_credit_issued
                )}
              </b>
            </div>

            <div className="rounded-xl bg-white/15 p-3">
              <small className="text-[9px] uppercase text-emerald-50">
                Generated
              </small>

              <b className="mt-1 block text-sm">
                {money(
                  dashboard.agent
                    ?.total_generated
                )}
              </b>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
            {notice}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">

          <form
            onSubmit={fundWallet}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="font-black">
              Fund voucher wallet
            </h2>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Current bonus: {dashboard.settings?.bonus_percent || 0}%.
            </p>

            <input
              required
              type="number"
              min={
                dashboard.settings
                  ?.minimum_funding_amount
              }
              max={
                dashboard.settings
                  ?.maximum_funding_amount
              }
              placeholder="Amount to pay"
              value={
                fundForm.amount
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
              className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3.5"
            />

            <input
              required
              type="tel"
              placeholder="M-Pesa phone"
              value={
                fundForm.phone
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
              className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3.5"
            />

            {Number(
              fundForm.amount
            ) > 0 && (
              <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                You will receive approximately {money(expectedCredit)} voucher credit after confirmed payment.
              </div>
            )}

            <button
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white"
            >
              Send M-Pesa prompt
            </button>
          </form>


          <form
            onSubmit={
              generateVoucher
            }
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="font-black">
              Generate voucher
            </h2>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Enter the customer voucher value. The network automatically selects the package, time and allowed devices.
            </p>

            <input
              required
              type="number"
              list="agent-denominations"
              placeholder="Example: 20"
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
              className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3.5 text-lg font-black"
            />

            <datalist id="agent-denominations">
              {dashboard.denominations.map(
                denomination => (
                  <option
                    key={
                      denomination.id
                    }
                    value={
                      denomination.face_value
                    }
                  />
                )
              )}
            </datalist>

            <div className="mt-3 flex flex-wrap gap-2">
              {dashboard.denominations.map(
                denomination => (
                  <button
                    key={
                      denomination.id
                    }
                    type="button"
                    onClick={() =>
                      setVoucherAmount(
                        denomination.face_value
                      )
                    }
                    className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"
                  >
                    KES {Number(
                      denomination.face_value
                    ).toLocaleString()}
                  </button>
                )
              )}
            </div>

            <button
              disabled={
                saving ||
                !dashboard.denominations
                  .length
              }
              className="mt-5 w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-black text-white disabled:opacity-40"
            >
              Generate voucher
            </button>
          </form>
        </div>


        {generated && (
          <section className="rounded-[28px] border-2 border-dashed border-emerald-400 bg-white p-6 text-center shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">
              Voucher generated
            </div>

            <div className="mt-4 text-2xl font-black tracking-widest">
              {generated.code}
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-3 py-2 font-bold">
                {money(
                  generated.amount
                )}
              </span>

              <span className="rounded-full bg-slate-100 px-3 py-2 font-bold">
                {generated.plan_name}
              </span>

              <span className="rounded-full bg-slate-100 px-3 py-2 font-bold">
                {durationText(
                  generated.duration_minutes
                )}
              </span>

              <span className="rounded-full bg-slate-100 px-3 py-2 font-bold">
                {generated.device_limit} device(s)
              </span>
            </div>

            <div className="mx-auto mt-6 max-w-md">
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
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />

              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={
                    printVoucher
                  }
                  className="rounded-xl bg-slate-950 py-3 text-sm font-black text-white"
                >
                  Print
                </button>

                <button
                  type="button"
                  disabled={
                    !smsPhone ||
                    !dashboard.settings
                      ?.sms_enabled
                  }
                  onClick={
                    sendSms
                  }
                  className="rounded-xl bg-emerald-500 py-3 text-sm font-black text-white disabled:opacity-40"
                >
                  Send SMS
                </button>
              </div>
            </div>
          </section>
        )}


        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black">
            Recent vouchers
          </h2>

          <div className="mt-4 space-y-2">
            {dashboard.generations
              .slice(0, 15)
              .map(
                voucher => (
                  <div
                    key={
                      voucher.id
                    }
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"
                  >
                    <div>
                      <b className="text-sm">
                        {
                          voucher.code
                        }
                      </b>

                      <div className="mt-1 text-[11px] text-slate-400">
                        {voucher.plan_name}
                        {' · '}
                        {durationText(
                          voucher.duration_minutes
                        )}
                        {' · '}
                        {voucher.device_limit} device(s)
                      </div>
                    </div>

                    <div className="text-right">
                      <b className="text-sm">
                        {money(
                          voucher.face_value
                        )}
                      </b>

                      <div className="mt-1 text-[10px] uppercase text-slate-400">
                        {
                          voucher.voucher_status
                        }
                      </div>
                    </div>
                  </div>
                )
              )}

            {!dashboard.generations.length && (
              <div className="py-8 text-center text-sm text-slate-400">
                No vouchers generated yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
