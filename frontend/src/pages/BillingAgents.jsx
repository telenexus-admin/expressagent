import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../utils/api';

import {
  AgentLocationOverview,
  AgentLocationPicker,
} from '../components/AgentMaps';

const money = value =>
  `KSh ${Number(
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

    plus: (
      <path d="M12 5v14M5 12h14" />
    ),

    users: (
      <>
        <circle
          cx="9"
          cy="8"
          r="3"
        />

        <path d="M3 20a6 6 0 0 1 12 0" />

        <circle
          cx="17"
          cy="9"
          r="2"
        />

        <path d="M16 15a5 5 0 0 1 5 5" />
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

    external: (
      <>
        <path d="M14 4h6v6" />
        <path d="m20 4-9 9" />
        <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
      </>
    ),

    search: (
      <>
        <circle
          cx="11"
          cy="11"
          r="7"
        />
        <path d="m20 20-4-4" />
      </>
    ),

    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),

    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
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

function Metric({
  label,
  value,
  hint,
  tone,
  icon,
}) {
  const styles = {
    violet:
      'bg-violet-50 text-violet-600',
    emerald:
      'bg-emerald-50 text-emerald-600',
    sky:
      'bg-sky-50 text-sky-600',
    amber:
      'bg-amber-50 text-amber-600',
  };

  return (
    <section className="min-w-0 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <small className="block text-[9px] font-black uppercase tracking-[.14em] text-slate-400 sm:text-[10px]">
            {label}
          </small>

          <strong className="mt-2 block truncate text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
            {value}
          </strong>

          {hint && (
            <span className="mt-1 block truncate text-[10px] text-slate-400 sm:text-xs">
              {hint}
            </span>
          )}
        </div>

        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            styles[tone] ||
            styles.violet
          }`}
        >
          <Icon
            name={icon}
            className="h-5 w-5"
          />
        </span>
      </div>
    </section>
  );
}

function FlowGraph({
  summary,
}) {
  const rows = [
    {
      label:
        'Cash funded',
      value:
        Number(
          summary.total_funded ||
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
          summary.total_credit_issued ||
          0
        ),
      className:
        'bg-violet-500',
    },
    {
      label:
        'Voucher value generated',
      value:
        Number(
          summary.total_generated ||
          0
        ),
      className:
        'bg-emerald-500',
    },
    {
      label:
        'Credit still available',
      value:
        Number(
          summary.outstanding_credit ||
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
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
          Wallet movement
        </div>

        <h3 className="mt-1 text-lg font-black text-slate-950">
          Agent voucher economy
        </h3>

        <p className="mt-1 text-xs leading-5 text-slate-400">
          Live relationship between agent funding, issued credit and vouchers sold.
        </p>
      </div>

      <div className="mt-6 space-y-5">
        {rows.map(
          row => {
            const percent =
              Math.max(
                row.value > 0
                  ? 4
                  : 0,
                Math.round(
                  (
                    row.value /
                    maximum
                  ) *
                  100
                )
              );

            return (
              <div
                key={
                  row.label
                }
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[11px] font-bold text-slate-500">
                    {
                      row.label
                    }
                  </span>

                  <strong className="text-xs text-slate-900">
                    {money(
                      row.value
                    )}
                  </strong>
                </div>

                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${row.className}`}
                    style={{
                      width:
                        `${percent}%`,
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

function PerformanceGraph({
  agents,
}) {
  const ranked =
    [...agents]
      .sort(
        (
          a,
          b
        ) =>
          Number(
            b.total_generated ||
            0
          ) -
          Number(
            a.total_generated ||
            0
          )
      )
      .slice(
        0,
        5
      );

  const maximum =
    Math.max(
      1,
      ...ranked.map(
        agent =>
          Number(
            agent.total_generated ||
            0
          )
      )
    );

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
            Agent performance
          </div>

          <h3 className="mt-1 text-lg font-black text-slate-950">
            Voucher generation
          </h3>

          <p className="mt-1 text-xs text-slate-400">
            Highest voucher value generated by your registered agents.
          </p>
        </div>

        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
          <Icon
            name="users"
            className="h-5 w-5"
          />
        </span>
      </div>

      {ranked.length ? (
        <div className="mt-6 space-y-4">
          {ranked.map(
            (
              agent,
              index
            ) => {
              const amount =
                Number(
                  agent.total_generated ||
                  0
                );

              const percent =
                amount > 0
                  ? Math.max(
                      5,
                      Math.round(
                        (
                          amount /
                          maximum
                        ) *
                        100
                      )
                    )
                  : 0;

              return (
                <div
                  key={
                    agent.id
                  }
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-[10px] font-black text-slate-500">
                    {
                      index +
                      1
                    }
                  </span>

                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-black text-slate-800">
                      {
                        agent.business_name ||
                        agent.name
                      }
                    </div>

                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500"
                        style={{
                          width:
                            `${percent}%`,
                        }}
                      />
                    </div>
                  </div>

                  <strong className="text-[11px] text-slate-700">
                    {money(
                      amount
                    )}
                  </strong>
                </div>
              );
            }
          )}
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-slate-400">
          Agent activity will appear here after agents begin generating vouchers.
        </div>
      )}
    </section>
  );
}

function AddAgentModal({
  form,
  setForm,
  saving,
  close,
  submit,
}) {
  const fields = [
    [
      'name',
      'Agent name',
      'text',
      'Jane Wanjiku',
      true,
    ],
    [
      'business_name',
      'Shop / business',
      'text',
      'Jane Salon',
      false,
    ],
    [
      'business_area',
      'Business area',
      'text',
      'Example: Roysambu, Kilimani, Kitengela',
      false,
    ],
    [
      'business_address',
      'Physical address / landmark',
      'text',
      'Example: Taji Mall, 1st floor',
      false,
    ],
    [
      'email',
      'Login email',
      'email',
      'agent@example.com',
      true,
    ],
    [
      'phone',
      'Phone number',
      'tel',
      '0712345678',
      true,
    ],
    [
      'password',
      'Initial password',
      'password',
      'Minimum 8 characters',
      true,
    ],
  ];

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label="Close add agent"
        onClick={close}
        className="absolute inset-0"
      />

      <form
        onSubmit={
          submit
        }
        className="relative z-10 max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
              Network representative
            </p>

            <h3 className="mt-1 text-xl font-black text-slate-950">
              Add an agent
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Create the account the shop, salon or business representative will use.
            </p>
          </div>

          <button
            type="button"
            onClick={close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
          >
            <Icon
              name="close"
              className="h-4 w-4"
            />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {fields.map(
            ([
              key,
              label,
              type,
              placeholder,
              required,
            ]) => (
              <label
                key={key}
                className="block"
              >
                <span className="text-xs font-black text-slate-600">
                  {label}
                </span>

                <input
                  required={
                    required
                  }
                  type={type}
                  value={
                    form[key]
                  }
                  placeholder={
                    placeholder
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,
                        [key]:
                          event
                            .target
                            .value,
                      })
                  }
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </label>
            )
          )}
        </div>


        <div className="mt-6">
          <div className="mb-3">
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">
              Business location
            </p>

            <h4 className="mt-1 text-sm font-black text-slate-900">
              Pin the agent on the map
            </h4>

            <p className="mt-1 text-[10px] leading-4 text-slate-400">
              This location will appear in the network's Agent Locations statistics map.
            </p>
          </div>

          <AgentLocationPicker
            latitude={
              form.latitude
            }
            longitude={
              form.longitude
            }
            onChange={({
              latitude,
              longitude,
            }) =>
              setForm({
                ...form,
                latitude,
                longitude,
              })
            }
          />
        </div>


        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={close}
            className="h-12 rounded-2xl border border-slate-200 text-sm font-black text-slate-600"
          >
            Cancel
          </button>

          <button
            disabled={
              saving
            }
            className="h-12 rounded-2xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
          >
            {saving
              ? 'Creating...'
              : 'Create agent'}
          </button>
        </div>
      </form>
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

  const [view, setView] =
    useState(
      'overview'
    );

  const [addOpen, setAddOpen] =
    useState(false);

  const [search, setSearch] =
    useState('');

  const [
    agentStatus,
    setAgentStatus,
  ] = useState(
    'all'
  );

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [notice, setNotice] =
    useState('');

  const [error, setError] =
    useState('');

  const [
    agentForm,
    setAgentForm,
  ] = useState({
    name: '',
    business_name: '',
    business_area: '',
    business_address: '',
    latitude: null,
    longitude: null,
    email: '',
    phone: '',
    password: '',
  });

  const [
    settingsForm,
    setSettingsForm,
  ] = useState({
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

  const load =
    async () => {
      try {
        setLoading(
          true
        );

        const [
          summaryResult,
          agentResult,
          configResult,
        ] =
          await Promise.all([
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
          summaryResult.data ||
          {}
        );

        setAgents(
          Array.isArray(
            agentResult.data
          )
            ? agentResult.data
            : []
        );

        const nextConfig =
          configResult.data ||
          {};

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
              current
                .bonus_percent ??
              50
            ),

          default_device_limit:
            String(
              current
                .default_device_limit ??
              1
            ),

          minimum_funding_amount:
            String(
              current
                .minimum_funding_amount ??
              10
            ),

          maximum_funding_amount:
            String(
              current
                .maximum_funding_amount ??
              500000
            ),

          sms_enabled:
            current
              .sms_enabled !==
            false,
        });

        setDenominationForm(
          previous => ({
            ...previous,

            device_limit:
              String(
                current
                  .default_device_limit ??
                1
              ),
          })
        );

        setError('');
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not load agent platform'
        );
      } finally {
        setLoading(
          false
        );
      }
    };

  useEffect(
    () => {
      void load();
    },
    []
  );

  const filteredAgents =
    useMemo(
      () =>
        agents.filter(
          agent => {
            const matchesStatus =
              agentStatus ===
              'all' ||
              agent.status ===
              agentStatus;

            const term =
              search
                .trim()
                .toLowerCase();

            const matchesSearch =
              !term ||
              [
                agent.name,
                agent.business_name,
                agent.business_area,
                agent.business_address,
                agent.email,
                agent.phone,
              ]
                .filter(
                  Boolean
                )
                .join(' ')
                .toLowerCase()
                .includes(
                  term
                );

            return (
              matchesStatus &&
              matchesSearch
            );
          }
        ),
      [
        agents,
        search,
        agentStatus,
      ]
    );

  const bonusExample =
    useMemo(
      () => {
        const bonus =
          Number(
            settingsForm
              .bonus_percent ||
            0
          );

        return (
          1000 *
          (
            1 +
            bonus /
              100
          )
        );
      },
      [
        settingsForm
          .bonus_percent,
      ]
    );

  const createAgent =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');

        await api.post(
          '/billing-agents',
          agentForm
        );

        setAgentForm({
          name: '',
          business_name: '',
          business_area: '',
          business_address: '',
          latitude: null,
          longitude: null,
          email: '',
          phone: '',
          password: '',
        });

        setAddOpen(
          false
        );

        setNotice(
          'Agent account created successfully.'
        );

        await load();
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not create agent'
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const changeStatus =
    async agent => {
      try {
        setSaving(
          true
        );

        await api.patch(
          `/billing-agents/${agent.id}`,
          {
            status:
              agent.status ===
              'active'
                ? 'suspended'
                : 'active',
          }
        );

        await load();
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not update agent'
        );
      } finally {
        setSaving(
          false
        );
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
        password.length <
        8
      ) {
        setError(
          'Password must contain at least 8 characters.'
        );

        return;
      }

      try {
        setSaving(
          true
        );

        await api.patch(
          `/billing-agents/${agent.id}`,
          {
            password,
          }
        );

        setNotice(
          `${agent.name}'s password was changed.`
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not reset password'
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const saveSettings =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

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
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not save settings'
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const saveDenomination =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

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
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not save denomination'
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const deleteDenomination =
    async denomination => {
      if (
        !window.confirm(
          `Remove the KES ${Number(
            denomination
              .face_value
          ).toLocaleString()} agent voucher?`
        )
      ) {
        return;
      }

      try {
        setSaving(
          true
        );

        await api.delete(
          `/billing-agents/denominations/${denomination.id}`
        );

        await load();
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not remove denomination'
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  if (loading) {
    return (
      <div className="-mx-3 -mt-3 min-h-screen bg-[#f7f8fb] px-4 py-20 text-center text-sm text-slate-400 sm:-mx-8 sm:-mt-8">
        Loading agent network...
      </div>
    );
  }

  return (
    <div className="-mx-3 -mt-3 min-h-screen overflow-x-hidden bg-[#f7f8fb] pb-24 sm:-mx-8 sm:-mt-8">

      <section className="relative overflow-hidden bg-gradient-to-br from-[#702cff] via-[#4d22c5] to-[#24158e] px-5 pb-16 pt-7 text-white sm:px-9 sm:pt-8">

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-violet-200">
              Agent voucher network
            </p>

            <h2 className="mt-2 text-3xl font-black">
              {view ===
              'settings'
                ? 'Agent Settings'
                : 'Agents'}
            </h2>

            <p className="mt-2 max-w-xl text-sm leading-6 text-violet-100">
              {view ===
              'settings'
                ? 'Control wallet bonuses, funding limits, SMS sharing and the packages agents are allowed to sell.'
                : 'Monitor agent wallets, voucher sales and representatives operating across your network.'}
            </p>
          </div>

          <button
            type="button"
            aria-label="Agent settings"
            onClick={() =>
              setView(
                current =>
                  current ===
                  'settings'
                    ? 'overview'
                    : 'settings'
              )
            }
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
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


        <div className="relative z-10 mt-5 flex flex-wrap gap-2">

          {view ===
          'overview' ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setAddOpen(
                    true
                  )
                }
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-3.5 py-2.5 text-[10px] font-black text-emerald-950 shadow-lg shadow-violet-950/20"
              >
                <Icon
                  name="plus"
                  className="h-3.5 w-3.5"
                />
                Add agent
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
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-[10px] font-black text-white"
                >
                  <Icon
                    name="external"
                    className="h-3.5 w-3.5"
                  />
                  Agent portal
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                setView(
                  'overview'
                )
              }
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-[10px] font-black text-violet-700"
            >
              Back to agents
            </button>
          )}
        </div>


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


      <div className="space-y-4 px-3 sm:px-8">

        {error && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-xs font-bold text-emerald-700 shadow-sm">
            {notice}
          </div>
        )}


        {view ===
        'overview' ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Active agents"
                value={
                  summary.active_agents ||
                  0
                }
                hint={`${summary.total_agents || 0} registered`}
                tone="violet"
                icon="users"
              />

              <Metric
                label="Cash funded"
                value={money(
                  summary.total_funded
                )}
                hint="Actual deposits"
                tone="sky"
                icon="wallet"
              />

              <Metric
                label="Credit issued"
                value={money(
                  summary.total_credit_issued
                )}
                hint="Including agent bonus"
                tone="amber"
                icon="wallet"
              />

              <Metric
                label="Vouchers generated"
                value={money(
                  summary.total_generated
                )}
                hint={`${summary.vouchers_generated || 0} vouchers`}
                tone="emerald"
                icon="voucher"
              />
            </div>


            <div className="grid gap-4 xl:grid-cols-2">
              <FlowGraph
                summary={
                  summary
                }
              />

              <PerformanceGraph
                agents={
                  agents
                }
              />
            </div>


            <AgentLocationOverview
              agents={
                agents
              }
            />


            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">

              <div className="border-b border-slate-100 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-5">
                <div>
                  <h3 className="font-black text-slate-950">
                    Registered agents
                  </h3>

                  <p className="mt-1 text-xs text-slate-400">
                    Current representatives, wallet balances and voucher activity.
                  </p>
                </div>

                <div className="mt-4 flex gap-2 sm:mt-0">

                  <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 sm:w-64">
                    <Icon
                      name="search"
                      className="h-4 w-4 shrink-0 text-slate-400"
                    />

                    <input
                      value={
                        search
                      }
                      onChange={
                        event =>
                          setSearch(
                            event
                              .target
                              .value
                          )
                      }
                      placeholder="Search agents"
                      className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                    />
                  </label>

                  <select
                    value={
                      agentStatus
                    }
                    onChange={
                      event =>
                        setAgentStatus(
                          event
                            .target
                            .value
                        )
                    }
                    className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"
                  >
                    <option value="all">
                      All
                    </option>

                    <option value="active">
                      Active
                    </option>

                    <option value="suspended">
                      Suspended
                    </option>
                  </select>
                </div>
              </div>


              {filteredAgents.length ? (
                <div className="divide-y divide-slate-100">
                  {filteredAgents.map(
                    agent => (
                      <article
                        key={
                          agent.id
                        }
                        className="p-4 transition hover:bg-violet-50/30 sm:p-5"
                      >
                        <div className="flex items-start gap-3 sm:gap-4">

                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-sm font-black text-violet-600">
                            {String(
                              agent.name ||
                              'A'
                            )
                              .slice(
                                0,
                                1
                              )
                              .toUpperCase()}
                          </span>

                          <div className="min-w-0 flex-1">

                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="truncate text-sm font-black text-slate-950">
                                  {
                                    agent.business_name ||
                                    agent.name
                                  }
                                </h4>

                                <p className="mt-1 truncate text-[10px] text-slate-400 sm:text-xs">
                                  {agent.name}
                                  {' · '}
                                  {agent.phone}
                                  {' · '}
                                  {agent.email}
                                </p>

                                {(agent.business_area ||
                                  agent.business_address) && (
                                  <p className="mt-1 truncate text-[10px] font-bold text-violet-500">
                                    {agent.business_area ||
                                     agent.business_address}
                                  </p>
                                )}
                              </div>

                              <span
                                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${
                                  agent.status ===
                                  'active'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-rose-50 text-rose-600'
                                }`}
                              >
                                <i
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    agent.status ===
                                    'active'
                                      ? 'bg-emerald-500'
                                      : 'bg-rose-500'
                                  }`}
                                />

                                {
                                  agent.status
                                }
                              </span>
                            </div>


                            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">

                              <div className="rounded-xl bg-slate-50 p-3">
                                <small className="text-[9px] font-black uppercase text-slate-400">
                                  Balance
                                </small>

                                <b className="mt-1 block truncate text-xs text-slate-900">
                                  {money(
                                    agent.voucher_balance
                                  )}
                                </b>
                              </div>

                              <div className="rounded-xl bg-slate-50 p-3">
                                <small className="text-[9px] font-black uppercase text-slate-400">
                                  Funded
                                </small>

                                <b className="mt-1 block truncate text-xs text-slate-900">
                                  {money(
                                    agent.total_funded
                                  )}
                                </b>
                              </div>

                              <div className="rounded-xl bg-slate-50 p-3">
                                <small className="text-[9px] font-black uppercase text-slate-400">
                                  Generated
                                </small>

                                <b className="mt-1 block truncate text-xs text-slate-900">
                                  {money(
                                    agent.total_generated
                                  )}
                                </b>
                              </div>

                              <div className="rounded-xl bg-slate-50 p-3">
                                <small className="text-[9px] font-black uppercase text-slate-400">
                                  Vouchers
                                </small>

                                <b className="mt-1 block text-xs text-slate-900">
                                  {
                                    agent.vouchers_generated ||
                                    0
                                  }
                                </b>
                              </div>
                            </div>


                            <div className="mt-3 flex flex-wrap gap-2">
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
                                className={`rounded-xl px-3 py-2 text-[10px] font-black ${
                                  agent.status ===
                                  'active'
                                    ? 'bg-rose-50 text-rose-600'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
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
                                className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-600"
                              >
                                Reset password
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  )}
                </div>
              ) : (
                <div className="px-5 py-16 text-center">
                  <Icon
                    name="users"
                    className="mx-auto h-10 w-10 text-slate-300"
                  />

                  <h4 className="mt-3 text-sm font-black text-slate-800">
                    No matching agents
                  </h4>

                  <p className="mt-1 text-xs text-slate-400">
                    Add a representative or change the current filter.
                  </p>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">

            <form
              onSubmit={
                saveSettings
              }
              className="h-fit rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            >
              <div className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">
                Wallet policy
              </div>

              <h3 className="mt-1 text-lg font-black text-slate-950">
                Agent settings
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                These rules control every agent under this billing account.
              </p>


              <div className="mt-6 space-y-4">

                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    Voucher bonus percentage
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
                    className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
                  />

                  <small className="mt-2 block text-[10px] leading-4 text-slate-400">
                    KES 1,000 funding currently gives {money(bonusExample)} in voucher credit.
                  </small>
                </label>


                <label className="block">
                  <span className="text-xs font-black text-slate-600">
                    Default device limit
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
                    className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
                  />
                </label>


                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="text-xs font-black text-slate-600">
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
                      className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-violet-400"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-black text-slate-600">
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
                      className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-violet-400"
                    />
                  </label>
                </div>


                <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                  <div>
                    <span className="block text-xs font-black text-slate-700">
                      Voucher SMS sharing
                    </span>

                    <small className="mt-1 block text-[10px] text-slate-400">
                      Allow agents to send generated codes using your SMS provider.
                    </small>
                  </div>

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
                    className="h-5 w-5"
                  />
                </label>
              </div>


              <button
                disabled={
                  saving
                }
                className="mt-5 h-12 w-full rounded-2xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
              >
                {saving
                  ? 'Saving...'
                  : 'Save agent settings'}
              </button>
            </form>


            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

              <div>
                <div className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">
                  Voucher catalogue
                </div>

                <h3 className="mt-1 text-lg font-black text-slate-950">
                  Agent denominations
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Map the cash value entered by an agent to an existing Hotspot package and device limit.
                </p>
              </div>


              <form
                onSubmit={
                  saveDenomination
                }
                className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-[130px_minmax(0,1fr)_120px_auto]"
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
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
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
                  className="h-12 min-w-0 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
                >
                  <option value="">
                    Hotspot package
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
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
                />

                <button
                  disabled={
                    saving
                  }
                  className="h-12 rounded-2xl bg-emerald-500 px-5 text-xs font-black text-white disabled:opacity-50"
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
                      <div className="min-w-0">
                        <strong className="block text-base font-black text-slate-950">
                          KES {Number(
                            denomination.face_value
                          ).toLocaleString()}
                        </strong>

                        <span className="mt-1 block text-[10px] text-slate-400 sm:text-xs">
                          {denomination.plan_name}
                          {' · '}
                          {denomination.duration_minutes} min
                          {' · '}
                          {denomination.device_limit} device(s)
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={
                          saving
                        }
                        onClick={() =>
                          deleteDenomination(
                            denomination
                          )
                        }
                        className="rounded-xl bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-600"
                      >
                        Remove
                      </button>
                    </div>
                  )
                )}

                {!config.denominations.length && (
                  <div className="py-12 text-center text-sm text-slate-400">
                    No agent voucher denominations are configured yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>


      {addOpen && (
        <AddAgentModal
          form={
            agentForm
          }
          setForm={
            setAgentForm
          }
          saving={
            saving
          }
          close={() =>
            setAddOpen(
              false
            )
          }
          submit={
            createAgent
          }
        />
      )}
    </div>
  );
}
