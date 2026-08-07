import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../utils/api';

const money = value =>
  `KSh ${Number(
    value || 0
  ).toLocaleString(
    'en-KE',
    {
      maximumFractionDigits: 2,
    }
  )}`;

function Stat({
  label,
  value,
  hint,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[.15em] text-slate-400">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black text-slate-950">
        {value}
      </div>

      {hint && (
        <div className="mt-1 text-xs text-slate-400">
          {hint}
        </div>
      )}
    </div>
  );
}

export default function BillingAgents() {
  const [summary, setSummary] =
    useState({});

  const [agents, setAgents] =
    useState([]);

  const [config, setConfig] =
    useState({
      settings: {},
      denominations: [],
      plans: [],
      portal_url: '',
    });

  const [section, setSection] =
    useState('agents');

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [notice, setNotice] =
    useState('');

  const [error, setError] =
    useState('');

  const [agentForm, setAgentForm] =
    useState({
      name: '',
      business_name: '',
      email: '',
      phone: '',
      password: '',
    });

  const [settingsForm, setSettingsForm] =
    useState({
      bonus_percent: '50',
      default_device_limit: '1',
      minimum_funding_amount: '10',
      maximum_funding_amount: '500000',
      sms_enabled: true,
    });

  const [
    denominationForm,
    setDenominationForm,
  ] = useState({
    face_value: '',
    plan_id: '',
    device_limit: '1',
  });

  const load = async () => {
    try {
      setLoading(true);

      const [
        summaryResult,
        agentResult,
        configResult,
      ] = await Promise.all([
        api.get(
          '/billing-agents/summary'
        ),

        api.get(
          '/billing-agents'
        ),

        api.get(
          '/billing-agents/settings'
        ),
      ]);

      setSummary(
        summaryResult.data || {}
      );

      setAgents(
        Array.isArray(
          agentResult.data
        )
          ? agentResult.data
          : []
      );

      const nextConfig =
        configResult.data || {};

      setConfig({
        settings:
          nextConfig.settings ||
          {},

        denominations:
          Array.isArray(
            nextConfig.denominations
          )
            ? nextConfig.denominations
            : [],

        plans:
          Array.isArray(
            nextConfig.plans
          )
            ? nextConfig.plans
            : [],

        portal_url:
          nextConfig.portal_url ||
          '',
      });

      const current =
        nextConfig.settings ||
        {};

      setSettingsForm({
        bonus_percent:
          String(
            current.bonus_percent ??
            50
          ),

        default_device_limit:
          String(
            current.default_device_limit ??
            1
          ),

        minimum_funding_amount:
          String(
            current.minimum_funding_amount ??
            10
          ),

        maximum_funding_amount:
          String(
            current.maximum_funding_amount ??
            500000
          ),

        sms_enabled:
          current.sms_enabled !==
          false,
      });

      setDenominationForm(
        form => ({
          ...form,

          device_limit:
            String(
              current.default_device_limit ??
              1
            ),
        })
      );

      setError('');
    } catch (requestError) {
      setError(
        requestError.response?.data
          ?.error ||
        'Could not load agent platform'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAgent = async event => {
    event.preventDefault();

    try {
      setSaving(true);
      setError('');

      await api.post(
        '/billing-agents',
        agentForm
      );

      setAgentForm({
        name: '',
        business_name: '',
        email: '',
        phone: '',
        password: '',
      });

      setNotice(
        'Agent account created successfully.'
      );

      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data
          ?.error ||
        'Could not create agent'
      );
    } finally {
      setSaving(false);
    }
  };

  const changeStatus =
    async agent => {
      try {
        setSaving(true);

        await api.patch(
          `/billing-agents/${
            agent.id
          }`,
          {
            status:
              agent.status ===
              'active'
                ? 'suspended'
                : 'active',
          }
        );

        await load();
      } catch (requestError) {
        setError(
          requestError.response?.data
            ?.error ||
          'Could not update agent'
        );
      } finally {
        setSaving(false);
      }
    };

  const resetPassword =
    async agent => {
      const password =
        window.prompt(
          `Enter a new password for ${agent.name}. Minimum 8 characters.`
        );

      if (!password) {
        return;
      }

      if (
        password.length < 8
      ) {
        setError(
          'Password must contain at least 8 characters.'
        );

        return;
      }

      try {
        setSaving(true);

        await api.patch(
          `/billing-agents/${
            agent.id
          }`,
          {
            password,
          }
        );

        setNotice(
          `${agent.name}'s password was changed.`
        );
      } catch (requestError) {
        setError(
          requestError.response?.data
            ?.error ||
          'Could not reset password'
        );
      } finally {
        setSaving(false);
      }
    };

  const saveSettings =
    async event => {
      event.preventDefault();

      try {
        setSaving(true);

        await api.put(
          '/billing-agents/settings',
          {
            bonus_percent:
              Number(
                settingsForm
                  .bonus_percent
              ),

            default_device_limit:
              Number(
                settingsForm
                  .default_device_limit
              ),

            minimum_funding_amount:
              Number(
                settingsForm
                  .minimum_funding_amount
              ),

            maximum_funding_amount:
              Number(
                settingsForm
                  .maximum_funding_amount
              ),

            sms_enabled:
              Boolean(
                settingsForm
                  .sms_enabled
              ),
          }
        );

        setNotice(
          'Agent settings saved.'
        );

        await load();
      } catch (requestError) {
        setError(
          requestError.response?.data
            ?.error ||
          'Could not save settings'
        );
      } finally {
        setSaving(false);
      }
    };

  const saveDenomination =
    async event => {
      event.preventDefault();

      try {
        setSaving(true);

        await api.post(
          '/billing-agents/denominations',
          {
            face_value:
              Number(
                denominationForm
                  .face_value
              ),

            plan_id:
              Number(
                denominationForm
                  .plan_id
              ),

            device_limit:
              Number(
                denominationForm
                  .device_limit
              ),
          }
        );

        setDenominationForm({
          face_value: '',
          plan_id: '',
          device_limit:
            settingsForm
              .default_device_limit ||
            '1',
        });

        setNotice(
          'Voucher denomination saved.'
        );

        await load();
      } catch (requestError) {
        setError(
          requestError.response?.data
            ?.error ||
          'Could not save denomination'
        );
      } finally {
        setSaving(false);
      }
    };

  const deleteDenomination =
    async denomination => {
      if (
        !window.confirm(
          `Remove the KES ${Number(
            denomination.face_value
          ).toLocaleString()} agent voucher?`
        )
      ) {
        return;
      }

      try {
        setSaving(true);

        await api.delete(
          `/billing-agents/denominations/${
            denomination.id
          }`
        );

        await load();
      } finally {
        setSaving(false);
      }
    };

  const bonusExample =
    useMemo(() => {
      const bonus =
        Number(
          settingsForm.bonus_percent ||
          0
        );

      return (
        1000 *
        (
          1 +
          bonus / 100
        )
      );
    }, [
      settingsForm.bonus_percent,
    ]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
        Loading agent platform...
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 text-white shadow-xl shadow-emerald-200/60">
        <div className="relative z-10">
          <div className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-100">
            Agent network
          </div>

          <h2 className="mt-2 text-3xl font-black tracking-tight">
            Voucher Agents
          </h2>

          <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50">
            Register shops, salons, barbers and other network representatives. Agents fund a voucher wallet and generate prepaid Hotspot vouchers.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setSection(
                  'agents'
                )
              }
              className={`rounded-xl px-4 py-2.5 text-xs font-black ${
                section ===
                'agents'
                  ? 'bg-white text-emerald-700'
                  : 'bg-white/15 text-white'
              }`}
            >
              Agents
            </button>

            <button
              type="button"
              onClick={() =>
                setSection(
                  'settings'
                )
              }
              className={`rounded-xl px-4 py-2.5 text-xs font-black ${
                section ===
                'settings'
                  ? 'bg-white text-emerald-700'
                  : 'bg-white/15 text-white'
              }`}
            >
              Settings
            </button>

            {config.portal_url && (
              <button
                type="button"
                onClick={() =>
                  window.open(
                    config.portal_url,
                    '_blank'
                  )
                }
                className="rounded-xl bg-slate-950/25 px-4 py-2.5 text-xs font-black text-white"
              >
                Open agent portal
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active agents"
          value={
            summary.active_agents ||
            0
          }
          hint={`${summary.total_agents || 0} registered`}
        />

        <Stat
          label="Cash funded"
          value={money(
            summary.total_funded
          )}
        />

        <Stat
          label="Voucher credit issued"
          value={money(
            summary.total_credit_issued
          )}
        />

        <Stat
          label="Voucher value generated"
          value={money(
            summary.total_generated
          )}
          hint={`${summary.vouchers_generated || 0} vouchers`}
        />
      </div>


      {section === 'agents' && (
        <div className="grid gap-6 xl:grid-cols-[390px_1fr]">

          <form
            onSubmit={createAgent}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h3 className="text-lg font-black">
              Register an agent
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Create the credentials the representative will use on the agent portal.
            </p>

            <div className="mt-5 space-y-3">
              {[
                [
                  'name',
                  'Agent name',
                  'text',
                ],
                [
                  'business_name',
                  'Shop / business',
                  'text',
                ],
                [
                  'email',
                  'Login email',
                  'email',
                ],
                [
                  'phone',
                  'Phone number',
                  'tel',
                ],
                [
                  'password',
                  'Initial password',
                  'password',
                ],
              ].map(
                ([
                  key,
                  label,
                  type,
                ]) => (
                  <label
                    key={key}
                    className="block"
                  >
                    <span className="text-xs font-bold text-slate-700">
                      {label}
                    </span>

                    <input
                      required={
                        key !==
                        'business_name'
                      }
                      type={type}
                      value={
                        agentForm[
                          key
                        ]
                      }
                      onChange={
                        event =>
                          setAgentForm({
                            ...agentForm,
                            [key]:
                              event
                                .target
                                .value,
                          })
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </label>
                )
              )}
            </div>

            <button
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-black text-white disabled:opacity-50"
            >
              Create agent account
            </button>
          </form>


          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h3 className="font-black">
                Registered agents
              </h3>

              <p className="mt-1 text-xs text-slate-400">
                Wallet credit and voucher activity update in real time.
              </p>
            </div>

            {!agents.length ? (
              <div className="p-12 text-center text-sm text-slate-400">
                No agents have been registered.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {agents.map(
                  agent => (
                    <div
                      key={
                        agent.id
                      }
                      className="p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="font-black text-slate-900">
                            {
                              agent.name
                            }
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {
                              agent.business_name ||
                              'Network agent'
                            }
                            {' · '}
                            {
                              agent.phone
                            }
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                            agent.status ===
                            'active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-600'
                          }`}
                        >
                          {
                            agent.status
                          }
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <small className="text-[9px] font-black uppercase text-emerald-600">
                            Credit
                          </small>

                          <b className="mt-1 block text-sm">
                            {money(
                              agent.voucher_balance
                            )}
                          </b>
                        </div>

                        <div className="rounded-xl bg-sky-50 p-3">
                          <small className="text-[9px] font-black uppercase text-sky-600">
                            Funded
                          </small>

                          <b className="mt-1 block text-sm">
                            {money(
                              agent.total_funded
                            )}
                          </b>
                        </div>

                        <div className="rounded-xl bg-violet-50 p-3">
                          <small className="text-[9px] font-black uppercase text-violet-600">
                            Generated
                          </small>

                          <b className="mt-1 block text-sm">
                            {money(
                              agent.total_generated
                            )}
                          </b>
                        </div>

                        <div className="rounded-xl bg-amber-50 p-3">
                          <small className="text-[9px] font-black uppercase text-amber-600">
                            Vouchers
                          </small>

                          <b className="mt-1 block text-sm">
                            {agent.vouchers_generated || 0}
                          </b>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={
                            saving
                          }
                          onClick={() =>
                            changeStatus(
                              agent
                            )
                          }
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
                        >
                          {agent.status ===
                          'active'
                            ? 'Suspend'
                            : 'Activate'}
                        </button>

                        <button
                          type="button"
                          disabled={
                            saving
                          }
                          onClick={() =>
                            resetPassword(
                              agent
                            )
                          }
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
                        >
                          Reset password
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </section>
        </div>
      )}


      {section === 'settings' && (
        <div className="grid gap-6 xl:grid-cols-[390px_1fr]">

          <form
            onSubmit={
              saveSettings
            }
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h3 className="font-black">
              Agent wallet settings
            </h3>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs font-bold">
                  Voucher bonus %
                </span>

                <input
                  type="number"
                  min="0"
                  max="500"
                  step="0.01"
                  value={
                    settingsForm
                      .bonus_percent
                  }
                  onChange={
                    event =>
                      setSettingsForm({
                        ...settingsForm,
                        bonus_percent:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3"
                />

                <small className="mt-1 block text-[11px] text-slate-400">
                  Example: KES 1,000 funding gives {money(bonusExample)} voucher credit.
                </small>
              </label>

              <label className="block">
                <span className="text-xs font-bold">
                  Default devices
                </span>

                <input
                  type="number"
                  min="1"
                  max="50"
                  value={
                    settingsForm
                      .default_device_limit
                  }
                  onChange={
                    event =>
                      setSettingsForm({
                        ...settingsForm,
                        default_device_limit:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="text-xs font-bold">
                    Min funding
                  </span>

                  <input
                    type="number"
                    value={
                      settingsForm
                        .minimum_funding_amount
                    }
                    onChange={
                      event =>
                        setSettingsForm({
                          ...settingsForm,
                          minimum_funding_amount:
                            event
                              .target
                              .value,
                        })
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3"
                  />
                </label>

                <label>
                  <span className="text-xs font-bold">
                    Max funding
                  </span>

                  <input
                    type="number"
                    value={
                      settingsForm
                        .maximum_funding_amount
                    }
                    onChange={
                      event =>
                        setSettingsForm({
                          ...settingsForm,
                          maximum_funding_amount:
                            event
                              .target
                              .value,
                        })
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3"
                  />
                </label>
              </div>

              <label className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                <span className="text-xs font-bold">
                  Allow voucher sharing by SMS
                </span>

                <input
                  type="checkbox"
                  checked={
                    settingsForm
                      .sms_enabled
                  }
                  onChange={
                    event =>
                      setSettingsForm({
                        ...settingsForm,
                        sms_enabled:
                          event
                            .target
                            .checked,
                      })
                  }
                />
              </label>
            </div>

            <button
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white"
            >
              Save settings
            </button>
          </form>


          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-black">
              Voucher denominations
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Map the amount entered by an agent to the Hotspot package and number of devices they are allowed to sell.
            </p>

            <form
              onSubmit={
                saveDenomination
              }
              className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-[150px_1fr_130px_auto]"
            >
              <input
                required
                type="number"
                min="1"
                placeholder="KES value"
                value={
                  denominationForm
                    .face_value
                }
                onChange={
                  event =>
                    setDenominationForm({
                      ...denominationForm,
                      face_value:
                        event
                          .target
                          .value,
                    })
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
              />

              <select
                required
                value={
                  denominationForm
                    .plan_id
                }
                onChange={
                  event =>
                    setDenominationForm({
                      ...denominationForm,
                      plan_id:
                        event
                          .target
                          .value,
                    })
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
              >
                <option value="">
                  Select Hotspot package
                </option>

                {config.plans.map(
                  plan => (
                    <option
                      key={
                        plan.id
                      }
                      value={
                        plan.id
                      }
                    >
                      {plan.name} · {plan.duration_minutes} min
                    </option>
                  )
                )}
              </select>

              <input
                required
                type="number"
                min="1"
                max="50"
                placeholder="Devices"
                value={
                  denominationForm
                    .device_limit
                }
                onChange={
                  event =>
                    setDenominationForm({
                      ...denominationForm,
                      device_limit:
                        event
                          .target
                          .value,
                    })
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
              />

              <button
                disabled={saving}
                className="rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black text-white"
              >
                Save
              </button>
            </form>

            <div className="mt-5 space-y-2">
              {config.denominations.map(
                denomination => (
                  <div
                    key={
                      denomination.id
                    }
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 p-4"
                  >
                    <div>
                      <div className="text-lg font-black">
                        KES {Number(
                          denomination.face_value
                        ).toLocaleString()}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {denomination.plan_name}
                        {' · '}
                        {denomination.duration_minutes} min
                        {' · '}
                        {denomination.device_limit} device(s)
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        deleteDenomination(
                          denomination
                        )
                      }
                      className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                )
              )}

              {!config.denominations.length && (
                <div className="py-10 text-center text-sm text-slate-400">
                  Configure at least one denomination before agents can generate vouchers.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
