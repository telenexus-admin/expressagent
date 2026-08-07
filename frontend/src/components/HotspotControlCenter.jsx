import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../utils/api';


const DEFAULTS = {
  brand_name: '',
  tagline: '',
  hero_heading:
    'Fast Internet. Everywhere.',
  support_phone: '',
  whatsapp_phone: '',
  support_text:
    'Need help? Contact support.',

  wallet_enabled: true,
  wallet_label:
    'MY WALLET',
  wallet_balance: 0,

  flash_enabled: false,
  flash_plan_id: '',
  flash_discount_price: '',
  flash_starts_at: '',
  flash_ends_at: '',

  popular_plan_id: '',

  package_layout:
    'featured',

  theme_preset:
    'blue',

  accent_color:
    '#0878f9',

  background_image_data:
    '',

  background_overlay:
    46,

  show_support:
    true,

  show_whatsapp:
    true,

  show_voucher_login:
    true,
};


const THEMES = {
  blue: {
    name:
      'Nexa Blue',

    accent:
      '#0878f9',

    background:
      'linear-gradient(135deg,#061a55,#073bc7)',
  },

  dark: {
    name:
      'Midnight',

    accent:
      '#f59e0b',

    background:
      'linear-gradient(135deg,#020617,#111827)',
  },

  orange: {
    name:
      'Hotspot Orange',

    accent:
      '#f59e0b',

    background:
      'linear-gradient(135deg,#201003,#7c2d12)',
  },

  green: {
    name:
      'Network Green',

    accent:
      '#10b981',

    background:
      'linear-gradient(135deg,#022c22,#047857)',
  },

  purple: {
    name:
      'Nexa Purple',

    accent:
      '#7c3aed',

    background:
      'linear-gradient(135deg,#2e1065,#6d28d9)',
  },
};


const LAYOUTS = [
  {
    key:
      'featured',

    name:
      'Featured',

    description:
      'Large visual cards',
  },

  {
    key:
      'grid2',

    name:
      '2 Columns',

    description:
      'Balanced package grid',
  },

  {
    key:
      'compact',

    name:
      'Compact',

    description:
      'More packages at once',
  },

  {
    key:
      'list',

    name:
      'List',

    description:
      'Simple vertical packages',
  },

  {
    key:
      'circles',

    name:
      'Circles',

    description:
      'Round package buttons',
  },
];


const inputClass =
  'h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100';


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


function toInputDateTime(
  value
) {
  if (!value) {
    return '';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '';
  }

  const local =
    new Date(
      date.getTime() -
      (
        date.getTimezoneOffset() *
        60000
      )
    );

  return local
    .toISOString()
    .slice(
      0,
      16
    );
}


function fromInputDateTime(
  value
) {
  if (!value) {
    return '';
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? ''
    : date.toISOString();
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
    const days =
      value /
      1440;

    return `${days} day${
      days === 1
        ? ''
        : 's'
    }`;
  }

  if (
    value >= 60 &&
    value % 60 ===
      0
  ) {
    const hours =
      value /
      60;

    return `${hours} hour${
      hours === 1
        ? ''
        : 's'
    }`;
  }

  return `${value} min`;
}


function Icon({
  name,
  className =
    'h-5 w-5',
}) {
  const paths = {
    package: (
      <>
        <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
        <path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
      </>
    ),

    bolt: (
      <path d="m13 2-8 12h7l-1 8 8-12h-7z" />
    ),

    design: (
      <>
        <rect
          x="3"
          y="4"
          width="18"
          height="16"
          rx="2"
        />
        <path d="M3 9h18M8 4v5" />
      </>
    ),

    wallet: (
      <>
        <path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M15 11h7v4h-7a2 2 0 1 1 0-4Z" />
      </>
    ),

    eye: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
        <circle
          cx="12"
          cy="12"
          r="2.5"
        />
      </>
    ),

    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),

    publish: (
      <>
        <path d="M4 15v5h16v-5" />
        <path d="M12 4v12" />
        <path d="m7 9 5-5 5 5" />
      </>
    ),

    plus: (
      <path d="M12 5v14M5 12h14" />
    ),

    phone: (
      <path d="M6 3h4l2 5-2.5 1.5a15 15 0 0 0 5 5L16 12l5 2v4a3 3 0 0 1-3 3C9.7 20.3 3.7 14.3 3 6a3 3 0 0 1 3-3Z" />
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


function Field({
  label,
  hint,
  children,
}) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-700">
        {label}
      </span>

      {hint && (
        <span className="ml-1 text-[10px] font-semibold text-slate-400">
          {hint}
        </span>
      )}

      <span className="mt-2 block">
        {children}
      </span>
    </label>
  );
}


function Toggle({
  checked,
  onChange,
  title,
  description,
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4">

      <div>
        <strong className="block text-xs font-black text-slate-700">
          {title}
        </strong>

        {description && (
          <span className="mt-1 block text-[10px] leading-4 text-slate-400">
            {description}
          </span>
        )}
      </div>

      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked
            ? 'bg-violet-600'
            : 'bg-slate-300'
        }`}
      >
        <input
          type="checkbox"
          checked={
            Boolean(
              checked
            )
          }
          onChange={
            event =>
              onChange(
                event
                  .target
                  .checked
              )
          }
          className="sr-only"
        />

        <i
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
            checked
              ? 'left-6'
              : 'left-1'
          }`}
        />
      </span>
    </label>
  );
}


async function compressBackground(
  file
) {
  if (
    !file ||
    !file.type
      .startsWith(
        'image/'
      )
  ) {
    throw new Error(
      'Choose a valid image.'
    );
  }

  if (
    file.size >
    12 * 1024 * 1024
  ) {
    throw new Error(
      'Background image must be smaller than 12 MB.'
    );
  }

  const source =
    await new Promise(
      (
        resolve,
        reject
      ) => {
        const reader =
          new FileReader();

        reader.onload =
          () =>
            resolve(
              reader.result
            );

        reader.onerror =
          () =>
            reject(
              new Error(
                'Could not read the background image.'
              )
            );

        reader.readAsDataURL(
          file
        );
      }
    );

  const image =
    await new Promise(
      (
        resolve,
        reject
      ) => {
        const item =
          new Image();

        item.onload =
          () =>
            resolve(
              item
            );

        item.onerror =
          () =>
            reject(
              new Error(
                'Could not process the background image.'
              )
            );

        item.src =
          source;
      }
    );

  const maxWidth =
    1400;

  const maxHeight =
    900;

  const scale =
    Math.min(
      1,
      maxWidth /
        image.width,
      maxHeight /
        image.height
    );

  const width =
    Math.max(
      1,
      Math.round(
        image.width *
        scale
      )
    );

  const height =
    Math.max(
      1,
      Math.round(
        image.height *
        scale
      )
    );

  const canvas =
    document.createElement(
      'canvas'
    );

  canvas.width =
    width;

  canvas.height =
    height;

  const context =
    canvas.getContext(
      '2d'
    );

  context.drawImage(
    image,
    0,
    0,
    width,
    height
  );

  let quality =
    0.76;

  let result =
    canvas.toDataURL(
      'image/jpeg',
      quality
    );

  while (
    result.length >
      850000 &&
    quality >
      0.42
  ) {
    quality -=
      0.08;

    result =
      canvas.toDataURL(
        'image/jpeg',
        quality
      );
  }

  if (
    result.length >
    950000
  ) {
    throw new Error(
      'The image is still too large after optimization. Use a smaller image.'
    );
  }

  return result;
}


function PackageModal({
  form,
  setForm,
  routers,
  saving,
  close,
  submit,
}) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center">

      <button
        type="button"
        aria-label="Close package form"
        onClick={
          close
        }
        className="absolute inset-0"
      />

      <form
        onSubmit={
          submit
        }
        className="relative z-10 max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-7"
      >

        <div className="flex items-start justify-between gap-4">

          <div>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
              Hotspot package
            </p>

            <h3 className="mt-1 text-xl font-black">
              Add package
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Create the internet package customers will see on the captive portal.
            </p>
          </div>

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


        <div className="mt-6 space-y-4">

          <Field label="Package name">
            <input
              required
              value={
                form.name
              }
              onChange={
                event =>
                  setForm({
                    ...form,
                    name:
                      event
                        .target
                        .value,
                  })
              }
              placeholder="Example: 6 Hours"
              className={
                inputClass
              }
            />
          </Field>


          <div className="grid grid-cols-2 gap-3">

            <Field label="Price">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">
                  KES
                </span>

                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={
                    form.price
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,
                        price:
                          event
                            .target
                            .value,
                      })
                  }
                  className={`${inputClass} pl-12`}
                />
              </div>
            </Field>


            <Field label="Duration">
              <div className="relative">
                <input
                  required
                  type="number"
                  min="1"
                  value={
                    form.duration_minutes
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,
                        duration_minutes:
                          event
                            .target
                            .value,
                      })
                  }
                  className={`${inputClass} pr-12`}
                />

                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">
                  MIN
                </span>
              </div>
            </Field>
          </div>


          <div className="grid grid-cols-2 gap-3">

            <Field
              label="Speed"
              hint="same upload/download"
            >
              <div className="relative">
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={
                    form.speed_mbps
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,
                        speed_mbps:
                          event
                            .target
                            .value,
                      })
                  }
                  className={`${inputClass} pr-14`}
                />

                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">
                  Mbps
                </span>
              </div>
            </Field>


            <Field
              label="Data limit"
              hint="optional"
            >
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  value={
                    form.data_limit_mb
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,
                        data_limit_mb:
                          event
                            .target
                            .value,
                      })
                  }
                  className={`${inputClass} pr-10`}
                />

                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">
                  MB
                </span>
              </div>
            </Field>
          </div>


          <Field
            label="MikroTik router"
            hint="optional"
          >
            <select
              value={
                form.router_id
              }
              onChange={
                event =>
                  setForm({
                    ...form,
                    router_id:
                      event
                        .target
                        .value,
                  })
              }
              className={
                inputClass
              }
            >
              <option value="">
                Available on all Hotspot routers
              </option>

              {routers.map(
                router => (
                  <option
                    key={
                      router.id
                    }
                    value={
                      router.id
                    }
                  >
                    {router.name}
                  </option>
                )
              )}
            </select>
          </Field>
        </div>


        <button
          disabled={
            saving
          }
          className="mt-6 h-12 w-full rounded-2xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
        >
          {saving
            ? 'Creating...'
            : 'Create Hotspot package'}
        </button>
      </form>
    </div>
  );
}


export default function HotspotControlCenter({
  plans = [],
  routers = [],
  reload,
  setWorkspaceError,
}) {
  const [
    settings,
    setSettings,
  ] = useState(
    DEFAULTS
  );

  const [
    portalUrl,
    setPortalUrl,
  ] = useState('');

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [
    publishing,
    setPublishing,
  ] = useState(
    false
  );

  const [
    notice,
    setNotice,
  ] = useState('');

  const [
    error,
    setError,
  ] = useState('');

  const [
    packageOpen,
    setPackageOpen,
  ] = useState(
    false
  );

  const [
    packageForm,
    setPackageForm,
  ] = useState({
    name: '',
    price: '',
    duration_minutes:
      '60',
    speed_mbps: '',
    data_limit_mb: '',
    router_id: '',
  });


  const update = (
    key,
    value
  ) => {
    setSettings(
      current => ({
        ...current,
        [key]:
          value,
      })
    );

    setNotice('');
    setError('');
  };


  const loadSettings =
    async () => {
      try {
        setLoading(
          true
        );

        const [
          settingsResult,
          portalResult,
        ] =
          await Promise.all([
            api.get(
              '/billing-workspace/hotspot/portal-settings'
            ),

            api
              .get(
                '/billing-workspace/hotspot/portal-config'
              )
              .catch(
                () => ({
                  data: {},
                })
              ),
          ]);

        setSettings({
          ...DEFAULTS,
          ...(
            settingsResult.data ||
            {}
          ),
        });

        setPortalUrl(
          portalResult
            .data
            ?.portal_url ||
          ''
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not load Hotspot configuration.'
        );
      } finally {
        setLoading(
          false
        );
      }
    };


  useEffect(
    () => {
      void loadSettings();
    },
    []
  );


  const activePlans =
    useMemo(
      () =>
        plans.filter(
          plan =>
            plan.is_active !==
            false
        ),
      [
        plans,
      ]
    );


  const lowestPrice =
    useMemo(
      () =>
        activePlans.length
          ? Math.min(
              ...activePlans.map(
                plan =>
                  Number(
                    plan.price ||
                    0
                  )
              )
            )
          : 0,
      [
        activePlans,
      ]
    );


  const flashPlan =
    useMemo(
      () =>
        plans.find(
          plan =>
            Number(
              plan.id
            ) ===
            Number(
              settings.flash_plan_id
            )
        ) ||
        null,
      [
        plans,
        settings.flash_plan_id,
      ]
    );


  const theme =
    THEMES[
      settings.theme_preset
    ] ||
    THEMES.blue;


  const backgroundStyle =
    settings
      .background_image_data
      ? {
          backgroundImage:
            `linear-gradient(rgba(2,6,23,${
              Number(
                settings.background_overlay ||
                0
              ) /
              100
            }),rgba(2,6,23,${
              Number(
                settings.background_overlay ||
                0
              ) /
              100
            })),url("${settings.background_image_data}")`,

          backgroundSize:
            'cover',

          backgroundPosition:
            'center',
        }
      : {
          background:
            theme.background,
        };


  const payload = (
    source
  ) => ({
    ...source,

    wallet_enabled:
      Boolean(
        source.wallet_enabled
      ),

    wallet_balance:
      Number(
        source.wallet_balance ||
        0
      ),

    flash_enabled:
      Boolean(
        source.flash_enabled
      ),

    flash_plan_id:
      source.flash_plan_id
        ? Number(
            source.flash_plan_id
          )
        : null,

    flash_discount_price:
      source.flash_discount_price ===
        '' ||
      source.flash_discount_price ===
        null
        ? null
        : Number(
            source.flash_discount_price
          ),

    popular_plan_id:
      source.popular_plan_id
        ? Number(
            source.popular_plan_id
          )
        : null,

    background_overlay:
      Number(
        source.background_overlay ||
        0
      ),

    show_support:
      Boolean(
        source.show_support
      ),

    show_whatsapp:
      Boolean(
        source.show_whatsapp
      ),

    show_voucher_login:
      Boolean(
        source.show_voucher_login
      ),
  });


  const persistSettings =
    async (
      next,
      message
    ) => {
      try {
        setSaving(
          true
        );

        setNotice('');
        setError('');

        const result =
          await api.put(
            '/billing-workspace/hotspot/portal-settings',
            payload(
              next
            )
          );

        setSettings({
          ...DEFAULTS,
          ...(
            result.data ||
            {}
          ),
        });

        setNotice(
          message
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          requestError
            .response
            ?.data
            ?.errors?.[0]
            ?.msg ||
          'Could not save Hotspot settings.'
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const toggleFlash =
    checked => {
      const now =
        new Date();

      const end =
        new Date(
          now.getTime() +
          60 *
          60 *
          1000
        );

      setSettings(
        current => ({
          ...current,

          flash_enabled:
            checked,

          flash_starts_at:
            current.flash_starts_at ||
            now.toISOString(),

          flash_ends_at:
            current.flash_ends_at ||
            end.toISOString(),
        })
      );
    };


  const createPackage =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        const speed =
          Number(
            packageForm
              .speed_mbps ||
            0
          );

        await api.post(
          '/billing-workspace/hotspot/plans',
          {
            name:
              packageForm.name,

            price:
              Number(
                packageForm.price
              ),

            duration_minutes:
              Number(
                packageForm
                  .duration_minutes
              ),

            data_limit_mb:
              packageForm
                .data_limit_mb
                ? Number(
                    packageForm
                      .data_limit_mb
                  )
                : null,

            mikrotik_rate_limit:
              speed > 0
                ? `${speed}M/${speed}M`
                : '',

            router_id:
              packageForm
                .router_id
                ? Number(
                    packageForm
                      .router_id
                  )
                : null,

            fup_enabled:
              false,
          }
        );

        setPackageForm({
          name: '',
          price: '',
          duration_minutes:
            '60',
          speed_mbps: '',
          data_limit_mb: '',
          router_id: '',
        });

        setPackageOpen(
          false
        );

        setNotice(
          'Hotspot package created.'
        );

        await reload?.();
      } catch (
        requestError
      ) {
        const message =
          requestError
            .response
            ?.data
            ?.error ||
          requestError
            .response
            ?.data
            ?.errors?.[0]
            ?.msg ||
          'Could not create Hotspot package.';

        setError(
          message
        );

        setWorkspaceError?.(
          message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const changePackageStatus =
    async plan => {
      try {
        setSaving(
          true
        );

        await api.patch(
          `/billing-workspace/hotspot/plans/${plan.id}/status`,
          {
            is_active:
              plan.is_active ===
              false,
          }
        );

        await reload?.();
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not update Hotspot package.'
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const deletePackage =
    async plan => {
      if (
        !window.confirm(
          `Delete ${plan.name}?`
        )
      ) {
        return;
      }

      try {
        setSaving(
          true
        );

        await api.delete(
          `/billing-workspace/hotspot/plans/${plan.id}`
        );

        await reload?.();

        setNotice(
          'Hotspot package deleted.'
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not delete Hotspot package.'
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const uploadBackground =
    async event => {
      const file =
        event.target
          .files?.[0];

      if (!file) {
        return;
      }

      try {
        setSaving(
          true
        );

        const image =
          await compressBackground(
            file
          );

        update(
          'background_image_data',
          image
        );

        setNotice(
          'Background optimized. Save Landing Page Designer to apply it.'
        );
      } catch (
        uploadError
      ) {
        setError(
          uploadError.message
        );
      } finally {
        event.target.value =
          '';

        setSaving(
          false
        );
      }
    };


  const publish =
    async () => {
      try {
        setPublishing(
          true
        );

        setNotice('');
        setError('');

        const result =
          await api.post(
            '/billing-workspace/hotspot/publish'
          );

        const published =
          Number(
            result.data
              ?.published ||
            0
          );

        const failed =
          Number(
            result.data
              ?.failed ||
            0
          );

        setNotice(
          failed
            ? `Published to ${published} router(s). ${failed} router(s) could not be reached.`
            : `Hotspot portal published to ${published} MikroTik router(s).`
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not publish the Hotspot portal to MikroTik.'
        );
      } finally {
        setPublishing(
          false
        );
      }
    };


  if (loading) {
    return (
      <div className="-mx-3 -mt-3 min-h-screen bg-[#f7f8fb] px-5 py-20 text-center text-sm text-slate-400 sm:-mx-8 sm:-mt-8">
        Loading Hotspot control center...
      </div>
    );
  }


  return (
    <div className="-mx-3 -mt-3 min-h-screen overflow-x-hidden bg-[#f7f8fb] pb-24 sm:-mx-8 sm:-mt-8">

      <section className="relative overflow-hidden bg-gradient-to-br from-[#702cff] via-[#4d22c5] to-[#24158e] px-5 pb-16 pt-7 text-white sm:px-9">

        <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">

          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-violet-200">
              Services / Hotspot
            </p>

            <h2 className="mt-2 text-3xl font-black tracking-tight">
              Hotspot Control Center
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-violet-100">
              Build packages, run timed Flash offers and design the public captive landing page from one workspace.
            </p>
          </div>


          <div className="flex flex-wrap gap-2">

            {portalUrl && (
              <a
                href={
                  portalUrl
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-[10px] font-black text-white"
              >
                <Icon
                  name="eye"
                  className="h-4 w-4"
                />

                Preview portal
              </a>
            )}

            <button
              type="button"
              disabled={
                publishing
              }
              onClick={
                publish
              }
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-[10px] font-black text-emerald-950 disabled:opacity-50"
            >
              <Icon
                name="publish"
                className="h-4 w-4"
              />

              {publishing
                ? 'Publishing...'
                : 'Publish to MikroTik'}
            </button>
          </div>
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


      <div className="space-y-5 px-3 sm:px-8">

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


        <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">

          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <small className="text-[9px] font-black uppercase tracking-wide text-violet-500">
              Active packages
            </small>

            <strong className="mt-2 block text-2xl font-black">
              {
                activePlans.length
              }
            </strong>
          </div>


          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <small className="text-[9px] font-black uppercase tracking-wide text-emerald-500">
              Starting price
            </small>

            <strong className="mt-2 block text-xl font-black">
              {money(
                lowestPrice
              )}
            </strong>
          </div>


          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <small className="text-[9px] font-black uppercase tracking-wide text-pink-500">
              Flash offer
            </small>

            <strong className="mt-2 block text-lg font-black">
              {settings.flash_enabled
                ? 'Enabled'
                : 'Off'}
            </strong>
          </div>


          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <small className="text-[9px] font-black uppercase tracking-wide text-sky-500">
              Package layout
            </small>

            <strong className="mt-2 block truncate text-lg font-black">
              {LAYOUTS.find(
                item =>
                  item.key ===
                  settings.package_layout
              )?.name ||
               'Featured'}
            </strong>
          </div>
        </section>


        {/* PACKAGE CONTAINER */}

        <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">

            <div className="flex items-start gap-3">

              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                <Icon
                  name="package"
                />
              </span>

              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
                  Packages
                </div>

                <h3 className="mt-1 text-xl font-black">
                  Hotspot packages
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-400">
                  These are the packages customers can purchase from the captive portal.
                </p>
              </div>
            </div>


            <button
              type="button"
              onClick={() =>
                setPackageOpen(
                  true
                )
              }
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-[10px] font-black text-white"
            >
              <Icon
                name="plus"
                className="h-4 w-4"
              />

              Add package
            </button>
          </div>


          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">

            {plans.map(
              plan => (
                <article
                  key={
                    plan.id
                  }
                  className={`rounded-2xl border p-4 ${
                    plan.is_active ===
                    false
                      ? 'border-slate-200 bg-slate-50 opacity-60'
                      : 'border-violet-100 bg-violet-50/30'
                  }`}
                >

                  <div className="flex items-start justify-between gap-3">

                    <div className="min-w-0">

                      <strong className="block truncate text-sm font-black">
                        {
                          plan.name
                        }
                      </strong>

                      <span className="mt-1 block text-[10px] text-slate-400">
                        {durationText(
                          plan.duration_minutes
                        )}
                      </span>
                    </div>


                    <span
                      className={`rounded-full px-2.5 py-1 text-[8px] font-black ${
                        plan.is_active ===
                        false
                          ? 'bg-slate-200 text-slate-500'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {plan.is_active ===
                      false
                        ? 'INACTIVE'
                        : 'ACTIVE'}
                    </span>
                  </div>


                  <div className="mt-4 grid grid-cols-2 gap-2">

                    <div className="rounded-xl bg-white p-3">

                      <small className="text-[8px] font-black uppercase text-slate-400">
                        Price
                      </small>

                      <b className="mt-1 block text-sm">
                        {money(
                          plan.price
                        )}
                      </b>
                    </div>


                    <div className="rounded-xl bg-white p-3">

                      <small className="text-[8px] font-black uppercase text-slate-400">
                        Speed
                      </small>

                      <b className="mt-1 block truncate text-sm">
                        {plan.mikrotik_rate_limit ||
                         'Unlimited'}
                      </b>
                    </div>
                  </div>


                  <div className="mt-3 grid grid-cols-2 gap-2">

                    <button
                      type="button"
                      disabled={
                        saving
                      }
                      onClick={() =>
                        changePackageStatus(
                          plan
                        )
                      }
                      className="rounded-xl bg-white py-2.5 text-[9px] font-black text-violet-700"
                    >
                      {plan.is_active ===
                      false
                        ? 'Enable'
                        : 'Disable'}
                    </button>

                    <button
                      type="button"
                      disabled={
                        saving
                      }
                      onClick={() =>
                        deletePackage(
                          plan
                        )
                      }
                      className="rounded-xl bg-rose-50 py-2.5 text-[9px] font-black text-rose-600"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              )
            )}


            {!plans.length && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 px-5 py-14 text-center">

                <strong className="text-sm text-slate-700">
                  No Hotspot packages yet
                </strong>

                <p className="mt-2 text-xs text-slate-400">
                  Click Add package to create the first customer package.
                </p>
              </div>
            )}
          </div>
        </section>


        {/* FLASH PACKAGE */}

        <section className="rounded-[26px] border border-pink-100 bg-white p-5 shadow-sm sm:p-6">

          <div className="flex flex-wrap items-start justify-between gap-4">

            <div className="flex items-start gap-3">

              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pink-50 text-pink-600">
                <Icon
                  name="bolt"
                />
              </span>

              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-pink-500">
                  Flash Package
                </div>

                <h3 className="mt-1 text-xl font-black">
                  Timed promotion
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Choose one existing package, discount it and show a live countdown on the landing page.
                </p>
              </div>
            </div>


            <Toggle
              checked={
                settings.flash_enabled
              }
              onChange={
                toggleFlash
              }
              title={
                settings.flash_enabled
                  ? 'Enabled'
                  : 'Disabled'
              }
            />
          </div>


          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">

            <Field label="Flash package">

              <select
                value={
                  settings.flash_plan_id ||
                  ''
                }
                onChange={
                  event =>
                    update(
                      'flash_plan_id',
                      event
                        .target
                        .value
                    )
                }
                className={
                  inputClass
                }
              >
                <option value="">
                  Select package
                </option>

                {activePlans.map(
                  plan => (
                    <option
                      key={
                        plan.id
                      }
                      value={
                        plan.id
                      }
                    >
                      {plan.name} · {money(plan.price)}
                    </option>
                  )
                )}
              </select>
            </Field>


            <Field label="Flash price">

              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">
                  KES
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={
                    settings.flash_discount_price ??
                    ''
                  }
                  onChange={
                    event =>
                      update(
                        'flash_discount_price',
                        event
                          .target
                          .value
                      )
                  }
                  className={`${inputClass} pl-12`}
                />
              </div>
            </Field>


            <Field label="Starts">

              <input
                type="datetime-local"
                value={
                  toInputDateTime(
                    settings.flash_starts_at
                  )
                }
                onChange={
                  event =>
                    update(
                      'flash_starts_at',
                      fromInputDateTime(
                        event
                          .target
                          .value
                      )
                    )
                }
                className={
                  inputClass
                }
              />
            </Field>


            <Field label="Ends">

              <input
                type="datetime-local"
                value={
                  toInputDateTime(
                    settings.flash_ends_at
                  )
                }
                onChange={
                  event =>
                    update(
                      'flash_ends_at',
                      fromInputDateTime(
                        event
                          .target
                          .value
                      )
                    )
                }
                className={
                  inputClass
                }
              />
            </Field>
          </div>


          {flashPlan && (
            <div className="mt-4 rounded-2xl bg-pink-50 p-4">

              <small className="text-[9px] font-black uppercase text-pink-500">
                Promotion preview
              </small>

              <strong className="mt-2 block text-sm">
                {flashPlan.name}
                {' · '}
                {money(
                  flashPlan.price
                )}
                {' → '}
                {money(
                  settings.flash_discount_price
                )}
              </strong>
            </div>
          )}


          <button
            type="button"
            disabled={
              saving
            }
            onClick={() =>
              persistSettings(
                settings,
                'Flash Package saved.'
              )
            }
            className="mt-5 h-12 rounded-2xl bg-pink-600 px-6 text-xs font-black text-white disabled:opacity-50"
          >
            Save Flash Package
          </button>
        </section>


        {/* LANDING PAGE DESIGNER */}

        <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-100 p-5 sm:p-6">

            <div className="flex items-start gap-3">

              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <Icon
                  name="design"
                />
              </span>

              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">
                  Landing Page Designer
                </div>

                <h3 className="mt-1 text-xl font-black">
                  Captive portal appearance
                </h3>

                <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
                  Customize the background, colors, package layout, contact details and optional portal sections.
                </p>
              </div>
            </div>
          </div>


          <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_390px]">

            <div className="space-y-7">


              <div>

                <h4 className="text-sm font-black">
                  Brand & contact
                </h4>

                <div className="mt-4 grid gap-4 md:grid-cols-2">

                  <Field label="Hotspot brand name">
                    <input
                      value={
                        settings.brand_name
                      }
                      onChange={
                        event =>
                          update(
                            'brand_name',
                            event
                              .target
                              .value
                          )
                      }
                      placeholder="My Network"
                      className={
                        inputClass
                      }
                    />
                  </Field>


                  <Field label="Main heading">
                    <input
                      value={
                        settings.hero_heading
                      }
                      onChange={
                        event =>
                          update(
                            'hero_heading',
                            event
                              .target
                              .value
                          )
                      }
                      placeholder="Fast Internet. Everywhere."
                      className={
                        inputClass
                      }
                    />
                  </Field>


                  <Field label="Tagline">
                    <input
                      value={
                        settings.tagline
                      }
                      onChange={
                        event =>
                          update(
                            'tagline',
                            event
                              .target
                              .value
                          )
                      }
                      placeholder="Connect instantly"
                      className={
                        inputClass
                      }
                    />
                  </Field>


                  <Field label="Contact number displayed">
                    <input
                      value={
                        settings.support_phone
                      }
                      onChange={
                        event =>
                          update(
                            'support_phone',
                            event
                              .target
                              .value
                          )
                      }
                      placeholder="0722 000 000"
                      className={
                        inputClass
                      }
                    />
                  </Field>


                  <Field label="WhatsApp number">
                    <input
                      value={
                        settings.whatsapp_phone
                      }
                      onChange={
                        event =>
                          update(
                            'whatsapp_phone',
                            event
                              .target
                              .value
                          )
                      }
                      placeholder="254722000000"
                      className={
                        inputClass
                      }
                    />
                  </Field>


                  <Field label="Support message">
                    <input
                      value={
                        settings.support_text
                      }
                      onChange={
                        event =>
                          update(
                            'support_text',
                            event
                              .target
                              .value
                          )
                      }
                      className={
                        inputClass
                      }
                    />
                  </Field>
                </div>
              </div>


              <div>

                <h4 className="text-sm font-black">
                  Theme
                </h4>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">

                  {Object.entries(
                    THEMES
                  ).map(
                    ([
                      key,
                      item,
                    ]) => (
                      <button
                        type="button"
                        key={
                          key
                        }
                        onClick={() => {
                          update(
                            'theme_preset',
                            key
                          );

                          update(
                            'accent_color',
                            item.accent
                          );
                        }}
                        className={`rounded-2xl border p-3 text-left transition ${
                          settings.theme_preset ===
                          key
                            ? 'border-violet-500 ring-2 ring-violet-100'
                            : 'border-slate-200'
                        }`}
                      >
                        <span
                          className="block h-12 rounded-xl"
                          style={{
                            background:
                              item.background,
                          }}
                        />

                        <b className="mt-2 block text-[10px]">
                          {
                            item.name
                          }
                        </b>
                      </button>
                    )
                  )}
                </div>


                <div className="mt-4 max-w-xs">

                  <Field label="Accent color">

                    <div className="flex gap-2">

                      <input
                        type="color"
                        value={
                          settings.accent_color ||
                          '#0878f9'
                        }
                        onChange={
                          event =>
                            update(
                              'accent_color',
                              event
                                .target
                                .value
                            )
                        }
                        className="h-12 w-16 rounded-xl border border-slate-200 bg-white p-1"
                      />

                      <input
                        value={
                          settings.accent_color
                        }
                        onChange={
                          event =>
                            update(
                              'accent_color',
                              event
                                .target
                                .value
                            )
                        }
                        className={
                          inputClass
                        }
                      />
                    </div>
                  </Field>
                </div>
              </div>


              <div>

                <h4 className="text-sm font-black">
                  Background image
                </h4>

                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">

                  <div className="flex flex-wrap items-center gap-3">

                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-[10px] font-black text-white">

                      <Icon
                        name="upload"
                        className="h-4 w-4"
                      />

                      Upload background

                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={
                          uploadBackground
                        }
                        className="hidden"
                      />
                    </label>


                    {settings.background_image_data && (
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            'background_image_data',
                            ''
                          )
                        }
                        className="rounded-xl bg-rose-50 px-4 py-2.5 text-[10px] font-black text-rose-600"
                      >
                        Remove image
                      </button>
                    )}

                    <span className="text-[10px] text-slate-400">
                      Images are compressed automatically for fast captive-portal loading.
                    </span>
                  </div>


                  <label className="mt-5 block">

                    <span className="flex items-center justify-between text-xs font-black text-slate-600">

                      <span>
                        Dark overlay
                      </span>

                      <span>
                        {Number(
                          settings.background_overlay ||
                          0
                        )}%
                      </span>
                    </span>

                    <input
                      type="range"
                      min="0"
                      max="85"
                      value={
                        settings.background_overlay
                      }
                      onChange={
                        event =>
                          update(
                            'background_overlay',
                            event
                              .target
                              .value
                          )
                      }
                      className="mt-3 w-full accent-violet-600"
                    />
                  </label>
                </div>
              </div>


              <div>

                <h4 className="text-sm font-black">
                  Package layout
                </h4>

                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">

                  {LAYOUTS.map(
                    layout => (
                      <button
                        type="button"
                        key={
                          layout.key
                        }
                        onClick={() =>
                          update(
                            'package_layout',
                            layout.key
                          )
                        }
                        className={`rounded-2xl border p-3 text-left transition ${
                          settings.package_layout ===
                          layout.key
                            ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
                            : 'border-slate-200 bg-white'
                        }`}
                      >

                        <div
                          className={`grid h-14 gap-1 ${
                            layout.key ===
                            'list'
                              ? 'grid-cols-1'
                              : layout.key ===
                                'compact'
                                ? 'grid-cols-3'
                                : 'grid-cols-2'
                          }`}
                        >

                          {[0,1,2,3].map(
                            index => (
                              <span
                                key={
                                  index
                                }
                                className={`bg-violet-300 ${
                                  layout.key ===
                                  'circles'
                                    ? 'rounded-full'
                                    : 'rounded'
                                }`}
                              />
                            )
                          )}
                        </div>

                        <b className="mt-2 block text-[10px]">
                          {
                            layout.name
                          }
                        </b>

                        <small className="mt-1 block text-[8px] leading-3 text-slate-400">
                          {
                            layout.description
                          }
                        </small>
                      </button>
                    )
                  )}
                </div>
              </div>


              <div>

                <h4 className="text-sm font-black">
                  Portal features
                </h4>

                <div className="mt-4 grid gap-3 md:grid-cols-2">

                  <Toggle
                    checked={
                      settings.wallet_enabled
                    }
                    onChange={
                      value =>
                        update(
                          'wallet_enabled',
                          value
                        )
                    }
                    title="Wallet card"
                    description="Show or hide the wallet card on the Hotspot landing page."
                  />

                  <Toggle
                    checked={
                      settings.show_voucher_login
                    }
                    onChange={
                      value =>
                        update(
                          'show_voucher_login',
                          value
                        )
                    }
                    title="Voucher login"
                    description="Allow customers with voucher codes to reconnect."
                  />

                  <Toggle
                    checked={
                      settings.show_support
                    }
                    onChange={
                      value =>
                        update(
                          'show_support',
                          value
                        )
                    }
                    title="Phone support"
                    description="Display the support telephone number."
                  />

                  <Toggle
                    checked={
                      settings.show_whatsapp
                    }
                    onChange={
                      value =>
                        update(
                          'show_whatsapp',
                          value
                        )
                    }
                    title="WhatsApp"
                    description="Display the WhatsApp contact action."
                  />
                </div>


                {settings.wallet_enabled && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">

                    <Field label="Wallet label">
                      <input
                        value={
                          settings.wallet_label
                        }
                        onChange={
                          event =>
                            update(
                              'wallet_label',
                              event
                                .target
                                .value
                            )
                        }
                        className={
                          inputClass
                        }
                      />
                    </Field>


                    <Field
                      label="Displayed wallet balance"
                      hint="visual display"
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          settings.wallet_balance
                        }
                        onChange={
                          event =>
                            update(
                              'wallet_balance',
                              event
                                .target
                                .value
                            )
                        }
                        className={
                          inputClass
                        }
                      />
                    </Field>
                  </div>
                )}


                <div className="mt-4 max-w-md">

                  <Field label="Popular package badge">

                    <select
                      value={
                        settings.popular_plan_id ||
                        ''
                      }
                      onChange={
                        event =>
                          update(
                            'popular_plan_id',
                            event
                              .target
                              .value
                          )
                      }
                      className={
                        inputClass
                      }
                    >
                      <option value="">
                        Automatic
                      </option>

                      {activePlans.map(
                        plan => (
                          <option
                            key={
                              plan.id
                            }
                            value={
                              plan.id
                            }
                          >
                            {plan.name}
                          </option>
                        )
                      )}
                    </select>
                  </Field>
                </div>
              </div>


              <button
                type="button"
                disabled={
                  saving
                }
                onClick={() =>
                  persistSettings(
                    settings,
                    'Hotspot landing page design saved.'
                  )
                }
                className="h-12 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-black text-white shadow-lg shadow-violet-200 disabled:opacity-50 sm:w-auto sm:px-8"
              >
                {saving
                  ? 'Saving...'
                  : 'Save Landing Page Designer'}
              </button>
            </div>


            {/* LIVE DESIGN PREVIEW */}

            <aside className="xl:sticky xl:top-5 xl:self-start">

              <div className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">
                Live design preview
              </div>

              <div className="mt-3 overflow-hidden rounded-[30px] border-[7px] border-slate-950 bg-slate-950 shadow-2xl">

                <div
                  className="relative min-h-[560px] overflow-hidden bg-slate-100"
                  style={
                    backgroundStyle
                  }
                >

                  <div className="p-5 text-white">

                    <div className="flex items-center justify-between">

                      <strong className="max-w-[190px] truncate text-lg font-black uppercase">
                        {settings.brand_name ||
                         'Your Hotspot'}
                      </strong>

                      <span className="text-lg">
                        Wi-Fi
                      </span>
                    </div>


                    <h4 className="mt-10 max-w-[260px] text-3xl font-black leading-tight">
                      {settings.hero_heading ||
                       'Fast Internet. Everywhere.'}
                    </h4>

                    <p className="mt-3 text-xs text-white/80">
                      {settings.tagline ||
                       'Connect instantly'}
                    </p>


                    {settings.wallet_enabled && (
                      <div className="mt-6 rounded-2xl bg-white p-4 text-slate-900 shadow-xl">

                        <small className="font-black uppercase text-slate-400">
                          {settings.wallet_label}
                        </small>

                        <strong
                          className="mt-2 block text-xl"
                          style={{
                            color:
                              settings.accent_color,
                          }}
                        >
                          {money(
                            settings.wallet_balance
                          )}
                        </strong>
                      </div>
                    )}
                  </div>


                  <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white p-4">

                    <small className="font-black uppercase tracking-wide text-slate-400">
                      Packages
                    </small>


                    <div
                      className={`mt-3 grid gap-2 ${
                        settings.package_layout ===
                        'compact'
                          ? 'grid-cols-3'
                          : settings.package_layout ===
                            'list'
                            ? 'grid-cols-1'
                            : 'grid-cols-2'
                      }`}
                    >

                      {activePlans
                        .slice(
                          0,
                          6
                        )
                        .map(
                          plan => (
                            <div
                              key={
                                plan.id
                              }
                              className={`flex min-h-16 flex-col justify-center p-2 text-center ${
                                settings.package_layout ===
                                'circles'
                                  ? 'aspect-square rounded-full'
                                  : 'rounded-xl'
                              }`}
                              style={{
                                background:
                                  settings.accent_color ||
                                  '#0878f9',

                                color:
                                  '#fff',
                              }}
                            >
                              <b className="truncate text-[9px]">
                                {plan.name}
                              </b>

                              <span className="mt-1 text-[8px] font-bold">
                                {money(
                                  plan.price
                                )}
                              </span>
                            </div>
                          )
                        )}
                    </div>


                    {settings.show_support &&
                      settings.support_phone && (
                        <div className="mt-4 flex items-center gap-2 text-[9px] font-bold text-slate-500">

                          <Icon
                            name="phone"
                            className="h-3 w-3"
                          />

                          {
                            settings.support_phone
                          }
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>


      {packageOpen && (
        <PackageModal
          form={
            packageForm
          }
          setForm={
            setPackageForm
          }
          routers={
            routers
          }
          saving={
            saving
          }
          close={() =>
            setPackageOpen(
              false
            )
          }
          submit={
            createPackage
          }
        />
      )}
    </div>
  );
}
