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

  wallet_enabled:
    true,

  wallet_label:
    'MY WALLET',

  wallet_balance:
    0,

  flash_enabled:
    false,

  flash_plan_id:
    '',

  flash_discount_price:
    '',

  flash_starts_at:
    '',

  flash_ends_at:
    '',

  popular_plan_id:
    '',

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
      'linear-gradient(135deg,#241006,#9a3412)',
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
  },

  {
    key:
      'grid2',

    name:
      '2 Columns',
  },

  {
    key:
      'compact',

    name:
      'Compact',
  },

  {
    key:
      'list',

    name:
      'List',
  },

  {
    key:
      'circles',

    name:
      'Circles',
  },
];


const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100';


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


function localDateTime(
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

  const adjusted =
    new Date(
      date.getTime() -
      date.getTimezoneOffset() *
      60000
    );

  return adjusted
    .toISOString()
    .slice(
      0,
      16
    );
}


function isoDateTime(
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

    settings: (
      <>
        <circle
          cx="12"
          cy="12"
          r="3"
        />

        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21h-4v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3v-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3h4v.1A1.6 1.6 0 0 0 15 4.6a1.6 1.6 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1v4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
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

    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    ),

    image: (
      <>
        <rect
          x="3"
          y="4"
          width="18"
          height="16"
          rx="2"
        />

        <circle
          cx="8.5"
          cy="9"
          r="1.5"
        />

        <path d="m5 18 5-5 3 3 2-2 4 4" />
      </>
    ),

    phone: (
      <path d="M6 3h4l2 5-2.5 1.5a15 15 0 0 0 5 5L16 12l5 2v4a3 3 0 0 1-3 3C9.7 20.3 3.7 14.3 3 6a3 3 0 0 1 3-3Z" />
    ),

    layout: (
      <>
        <rect
          x="3"
          y="4"
          width="8"
          height="7"
          rx="1"
        />

        <rect
          x="13"
          y="4"
          width="8"
          height="7"
          rx="1"
        />

        <rect
          x="3"
          y="13"
          width="18"
          height="7"
          rx="1"
        />
      </>
    ),

    wallet: (
      <>
        <path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M15 11h7v4h-7a2 2 0 1 1 0-4Z" />
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


function Toggle({
  checked,
  onChange,
  label,
  description,
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-3.5">

      <div>
        <strong className="block text-xs font-black text-slate-700">
          {label}
        </strong>

        {description && (
          <span className="mt-0.5 block text-[9px] leading-4 text-slate-400">
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

        <span
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


function Field({
  label,
  children,
}) {
  return (
    <label className="block">

      <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </span>

      <span className="mt-1.5 block">
        {children}
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
                'Could not read image.'
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
                'Could not process image.'
              )
            );

        item.src =
          source;
      }
    );

  const maximumWidth =
    1400;

  const maximumHeight =
    900;

  const scale =
    Math.min(
      1,
      maximumWidth /
        image.width,
      maximumHeight /
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
    0.78;

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
      'Image remains too large after compression.'
    );
  }

  return result;
}


function ModalShell({
  title,
  eyebrow,
  close,
  children,
  width =
    'max-w-3xl',
}) {
  return (
    <div className="fixed inset-0 z-[10020] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5">

      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={
          close
        }
        className="absolute inset-0"
      />

      <div
        className={`relative z-10 max-h-[94vh] w-full ${width} overflow-y-auto rounded-t-[28px] bg-[#f7f8fb] shadow-2xl sm:rounded-[28px]`}
      >

        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">

          <div>
            <p className="text-[9px] font-black uppercase tracking-[.18em] text-violet-500">
              {eyebrow}
            </p>

            <h3 className="mt-0.5 text-lg font-black text-slate-950">
              {title}
            </h3>
          </div>

          <button
            type="button"
            onClick={
              close
            }
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
          >
            <Icon
              name="close"
              className="h-4 w-4"
            />
          </button>
        </header>

        {children}
      </div>
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
    packageOpen,
    setPackageOpen,
  ] = useState(
    false
  );

  const [
    flashOpen,
    setFlashOpen,
  ] = useState(
    false
  );

  const [
    settingsOpen,
    setSettingsOpen,
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


  const layoutName =
    LAYOUTS.find(
      item =>
        item.key ===
        settings.package_layout
    )?.name ||
    'Featured';


  const update =
    (
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

      setError('');
      setNotice('');
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
            settingsResult
              .data ||
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
          'Could not load Hotspot settings.'
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


  useEffect(
    () => {
      const modalOpen =
        packageOpen ||
        flashOpen ||
        settingsOpen;

      if (!modalOpen) {
        return undefined;
      }

      const old =
        document.body
          .style
          .overflow;

      document.body
        .style
        .overflow =
        'hidden';

      return () => {
        document.body
          .style
          .overflow =
          old;
      };
    },
    [
      packageOpen,
      flashOpen,
      settingsOpen,
    ]
  );


  const payload =
    source => ({
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


  const saveSettings =
    async (
      message
    ) => {
      try {
        setSaving(
          true
        );

        setError('');

        const result =
          await api.put(
            '/billing-workspace/hotspot/portal-settings',
            payload(
              settings
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

        return true;
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

        return false;
      } finally {
        setSaving(
          false
        );
      }
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


  const togglePackage =
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
          'Could not update package.'
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
          'Package deleted.'
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not delete package.'
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const toggleFlash =
    value => {
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
            value,

          flash_starts_at:
            current.flash_starts_at ||
            now.toISOString(),

          flash_ends_at:
            current.flash_ends_at ||
            end.toISOString(),
        })
      );
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

        const result =
          await compressBackground(
            file
          );

        update(
          'background_image_data',
          result
        );

        setNotice(
          'Background prepared. Save settings to apply it.'
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
            ? `${published} router(s) updated, ${failed} failed.`
            : `Hotspot portal published to ${published} router(s).`
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not publish Hotspot portal.'
        );
      } finally {
        setPublishing(
          false
        );
      }
    };


  const previewStyle =
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


  if (loading) {
    return (
      <div className="-mx-3 -mt-3 min-h-[70vh] bg-[#f7f8fb] px-6 py-24 text-center text-sm font-bold text-slate-400 sm:-mx-8 sm:-mt-8">
        Loading Hotspot...
      </div>
    );
  }


  return (
    <div className="-mx-3 -mt-3 min-h-screen bg-[#f7f8fb] pb-20 sm:-mx-8 sm:-mt-8">

      {/* CLEAN HEADER */}

      <section className="relative overflow-hidden bg-gradient-to-r from-[#6228e6] via-[#4b21b9] to-[#30168a] px-5 pb-14 pt-6 text-white sm:px-8">

        <div className="relative z-10 flex items-start justify-between gap-4">

          <div className="min-w-0">

            <p className="text-[9px] font-black uppercase tracking-[.2em] text-violet-200">
              Services / Hotspot
            </p>

            <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">
              Hotspot
            </h2>

            <p className="mt-1.5 max-w-xl text-xs leading-5 text-violet-100 sm:text-sm">
              Packages, promotions and captive portal management.
            </p>
          </div>


          <div className="flex shrink-0 gap-2">

            <button
              type="button"
              onClick={() =>
                setSettingsOpen(
                  true
                )
              }
              title="Hotspot settings"
              aria-label="Hotspot settings"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
            >
              <Icon
                name="settings"
                className="h-5 w-5"
              />
            </button>


            {portalUrl && (
              <a
                href={
                  portalUrl
                }
                target="_blank"
                rel="noreferrer"
                title="Preview portal"
                className="hidden h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20 sm:flex"
              >
                <Icon
                  name="eye"
                  className="h-5 w-5"
                />
              </a>
            )}


            <button
              type="button"
              onClick={
                publish
              }
              disabled={
                publishing
              }
              title="Publish to MikroTik"
              className="hidden h-10 items-center gap-2 rounded-xl bg-emerald-400 px-3 text-[9px] font-black text-emerald-950 disabled:opacity-50 sm:flex"
            >
              <Icon
                name="publish"
                className="h-4 w-4"
              />

              {publishing
                ? 'Publishing'
                : 'Publish'}
            </button>
          </div>
        </div>


        <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-9">

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

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-100 bg-white px-4 py-3 text-xs font-bold text-emerald-700 shadow-sm">
            {notice}
          </div>
        )}


        {/* QUICK OVERVIEW */}

        <section className="grid grid-cols-3 gap-2">

          <article className="rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">

            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Icon
                name="package"
                className="h-4 w-4"
              />
            </div>

            <strong className="mt-3 block text-xl font-black text-slate-950 sm:text-2xl">
              {
                activePlans.length
              }
            </strong>

            <span className="mt-0.5 block truncate text-[9px] font-black uppercase text-slate-400">
              Packages
            </span>
          </article>


          <article
            role="button"
            tabIndex={0}
            onClick={() =>
              setFlashOpen(
                true
              )
            }
            className="cursor-pointer rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm transition hover:border-pink-200 sm:p-4"
          >

            <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${
              settings.flash_enabled
                ? 'bg-pink-50 text-pink-600'
                : 'bg-slate-100 text-slate-400'
            }`}>
              <Icon
                name="bolt"
                className="h-4 w-4"
              />
            </div>

            <strong className="mt-3 block truncate text-sm font-black text-slate-950 sm:text-lg">
              {settings.flash_enabled
                ? 'Active'
                : 'Off'}
            </strong>

            <span className="mt-0.5 block truncate text-[9px] font-black uppercase text-slate-400">
              Flash Offer
            </span>
          </article>


          <article
            role="button"
            tabIndex={0}
            onClick={() =>
              setSettingsOpen(
                true
              )
            }
            className="cursor-pointer rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm transition hover:border-sky-200 sm:p-4"
          >

            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Icon
                name="layout"
                className="h-4 w-4"
              />
            </div>

            <strong className="mt-3 block truncate text-sm font-black text-slate-950 sm:text-lg">
              {layoutName}
            </strong>

            <span className="mt-0.5 block truncate text-[9px] font-black uppercase text-slate-400">
              Portal
            </span>
          </article>
        </section>


        {/* PACKAGES */}

        <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">

          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">

            <div>

              <h3 className="text-sm font-black text-slate-950 sm:text-base">
                Hotspot Packages
              </h3>

              <p className="mt-0.5 text-[9px] text-slate-400 sm:text-[10px]">
                Starting from {
                  money(
                    lowestPrice
                  )
                }
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setPackageOpen(
                  true
                )
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-3 text-[9px] font-black text-white"
            >
              <Icon
                name="plus"
                className="h-3.5 w-3.5"
              />

              Add Package
            </button>
          </header>


          <div className="divide-y divide-slate-100">

            {plans.map(
              plan => (
                <article
                  key={
                    plan.id
                  }
                  className={`flex items-center gap-3 px-4 py-3.5 sm:px-5 ${
                    plan.is_active ===
                    false
                      ? 'bg-slate-50 opacity-60'
                      : 'bg-white'
                  }`}
                >

                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <Icon
                      name="package"
                      className="h-4 w-4"
                    />
                  </span>


                  <div className="min-w-0 flex-1">

                    <div className="flex items-center gap-2">

                      <strong className="truncate text-xs font-black text-slate-900 sm:text-sm">
                        {
                          plan.name
                        }
                      </strong>

                      <span
                        className={`hidden rounded-full px-2 py-0.5 text-[7px] font-black uppercase sm:inline ${
                          plan.is_active ===
                          false
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {plan.is_active ===
                        false
                          ? 'Inactive'
                          : 'Active'}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-[9px] text-slate-400">
                      {durationText(
                        plan.duration_minutes
                      )}

                      {' · '}

                      {plan.mikrotik_rate_limit ||
                       'Unlimited speed'}
                    </p>
                  </div>


                  <strong className="shrink-0 text-xs font-black text-slate-900 sm:text-sm">
                    {money(
                      plan.price
                    )}
                  </strong>


                  <div className="flex shrink-0 gap-1">

                    <button
                      type="button"
                      disabled={
                        saving
                      }
                      onClick={() =>
                        togglePackage(
                          plan
                        )
                      }
                      className="rounded-lg bg-slate-100 px-2 py-1.5 text-[8px] font-black text-slate-600"
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
                      className="hidden rounded-lg bg-rose-50 px-2 py-1.5 text-[8px] font-black text-rose-600 sm:block"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              )
            )}


            {!plans.length && (
              <div className="px-6 py-12 text-center">

                <strong className="text-sm text-slate-700">
                  No Hotspot packages
                </strong>

                <p className="mt-1 text-xs text-slate-400">
                  Create the first package to start selling Hotspot access.
                </p>
              </div>
            )}
          </div>
        </section>


        {/* FLASH SUMMARY */}

        <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

          <div className="flex items-center gap-3">

            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              settings.flash_enabled
                ? 'bg-pink-50 text-pink-600'
                : 'bg-slate-100 text-slate-400'
            }`}>
              <Icon
                name="bolt"
              />
            </span>


            <div className="min-w-0 flex-1">

              <div className="flex items-center gap-2">

                <h3 className="text-sm font-black text-slate-900">
                  Flash Package
                </h3>

                <span
                  className={`rounded-full px-2 py-0.5 text-[7px] font-black uppercase ${
                    settings.flash_enabled
                      ? 'bg-pink-50 text-pink-600'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {settings.flash_enabled
                    ? 'Active'
                    : 'Off'}
                </span>
              </div>


              {settings.flash_enabled &&
              flashPlan ? (
                <p className="mt-1 truncate text-[10px] text-slate-500">

                  {flashPlan.name}

                  {' · '}

                  <span className="line-through">
                    {money(
                      flashPlan.price
                    )}
                  </span>

                  {' → '}

                  <b className="text-pink-600">
                    {money(
                      settings.flash_discount_price
                    )}
                  </b>
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-400">
                  Create a temporary discounted package with a countdown.
                </p>
              )}
            </div>


            <button
              type="button"
              onClick={() =>
                setFlashOpen(
                  true
                )
              }
              className="shrink-0 rounded-xl bg-pink-50 px-3 py-2 text-[9px] font-black text-pink-600"
            >
              Configure
            </button>
          </div>
        </section>


        {/* MOBILE ACTIONS */}

        <div className="grid grid-cols-2 gap-2 sm:hidden">

          {portalUrl && (
            <a
              href={
                portalUrl
              }
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-[9px] font-black text-slate-600 shadow-sm"
            >
              <Icon
                name="eye"
                className="h-4 w-4"
              />

              Preview Portal
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
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 text-[9px] font-black text-emerald-950"
          >
            <Icon
              name="publish"
              className="h-4 w-4"
            />

            Publish
          </button>
        </div>
      </div>


      {/* ADD PACKAGE MODAL */}

      {packageOpen && (
        <ModalShell
          title="Add Hotspot Package"
          eyebrow="Packages"
          close={() =>
            setPackageOpen(
              false
            )
          }
          width="max-w-lg"
        >

          <form
            onSubmit={
              createPackage
            }
            className="space-y-4 p-4 sm:p-6"
          >

            <Field label="Package name">

              <input
                required
                value={
                  packageForm.name
                }
                onChange={
                  event =>
                    setPackageForm({
                      ...packageForm,

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

                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={
                    packageForm.price
                  }
                  onChange={
                    event =>
                      setPackageForm({
                        ...packageForm,

                        price:
                          event
                            .target
                            .value,
                      })
                  }
                  placeholder="20"
                  className={
                    inputClass
                  }
                />
              </Field>


              <Field label="Duration (minutes)">

                <input
                  required
                  type="number"
                  min="1"
                  value={
                    packageForm
                      .duration_minutes
                  }
                  onChange={
                    event =>
                      setPackageForm({
                        ...packageForm,

                        duration_minutes:
                          event
                            .target
                            .value,
                      })
                  }
                  className={
                    inputClass
                  }
                />
              </Field>
            </div>


            <div className="grid grid-cols-2 gap-3">

              <Field label="Speed Mbps">

                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={
                    packageForm
                      .speed_mbps
                  }
                  onChange={
                    event =>
                      setPackageForm({
                        ...packageForm,

                        speed_mbps:
                          event
                            .target
                            .value,
                      })
                  }
                  placeholder="2"
                  className={
                    inputClass
                  }
                />
              </Field>


              <Field label="Data limit MB">

                <input
                  type="number"
                  min="1"
                  value={
                    packageForm
                      .data_limit_mb
                  }
                  onChange={
                    event =>
                      setPackageForm({
                        ...packageForm,

                        data_limit_mb:
                          event
                            .target
                            .value,
                      })
                  }
                  placeholder="Optional"
                  className={
                    inputClass
                  }
                />
              </Field>
            </div>


            <Field label="MikroTik router">

              <select
                value={
                  packageForm
                    .router_id
                }
                onChange={
                  event =>
                    setPackageForm({
                      ...packageForm,

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
                  All Hotspot routers
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


            <button
              disabled={
                saving
              }
              className="h-11 w-full rounded-xl bg-violet-600 text-xs font-black text-white disabled:opacity-50"
            >
              {saving
                ? 'Creating...'
                : 'Create Package'}
            </button>
          </form>
        </ModalShell>
      )}


      {/* FLASH MODAL */}

      {flashOpen && (
        <ModalShell
          title="Flash Package"
          eyebrow="Promotion"
          close={() =>
            setFlashOpen(
              false
            )
          }
          width="max-w-2xl"
        >

          <div className="space-y-4 p-4 sm:p-6">

            <Toggle
              checked={
                settings.flash_enabled
              }
              onChange={
                toggleFlash
              }
              label="Enable Flash Package"
              description="Show a temporary discounted package with a countdown."
            />


            <div className="grid gap-3 sm:grid-cols-2">

              <Field label="Package">

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
                  placeholder="15"
                  className={
                    inputClass
                  }
                />
              </Field>


              <Field label="Starts">

                <input
                  type="datetime-local"
                  value={
                    localDateTime(
                      settings.flash_starts_at
                    )
                  }
                  onChange={
                    event =>
                      update(
                        'flash_starts_at',
                        isoDateTime(
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
                    localDateTime(
                      settings.flash_ends_at
                    )
                  }
                  onChange={
                    event =>
                      update(
                        'flash_ends_at',
                        isoDateTime(
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
              <div className="rounded-xl bg-pink-50 p-4">

                <span className="text-[9px] font-black uppercase text-pink-500">
                  Preview
                </span>

                <strong className="mt-1.5 block text-sm text-slate-900">

                  {flashPlan.name}

                  {' · '}

                  {money(
                    flashPlan.price
                  )}

                  {' → '}

                  <span className="text-pink-600">
                    {money(
                      settings.flash_discount_price
                    )}
                  </span>
                </strong>
              </div>
            )}


            <button
              type="button"
              disabled={
                saving
              }
              onClick={
                async () => {
                  const saved =
                    await saveSettings(
                      'Flash Package updated.'
                    );

                  if (saved) {
                    setFlashOpen(
                      false
                    );
                  }
                }
              }
              className="h-11 w-full rounded-xl bg-pink-600 text-xs font-black text-white disabled:opacity-50"
            >
              {saving
                ? 'Saving...'
                : 'Save Flash Package'}
            </button>
          </div>
        </ModalShell>
      )}


      {/* SETTINGS DRAWER */}

      {settingsOpen && (
        <div className="fixed inset-0 z-[10030] flex justify-end bg-slate-950/50 backdrop-blur-sm">

          <button
            type="button"
            aria-label="Close Hotspot settings"
            onClick={() =>
              setSettingsOpen(
                false
              )
            }
            className="absolute inset-0"
          />


          <section className="relative z-10 h-full w-full overflow-y-auto bg-[#f7f8fb] shadow-2xl lg:max-w-[1080px]">

            <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">

              <div className="flex items-center gap-3">

                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <Icon
                    name="settings"
                    className="h-5 w-5"
                  />
                </span>

                <div>

                  <p className="text-[8px] font-black uppercase tracking-[.18em] text-violet-500">
                    Hotspot Settings
                  </p>

                  <h3 className="text-base font-black text-slate-950 sm:text-lg">
                    Landing Page Customization
                  </h3>
                </div>
              </div>


              <button
                type="button"
                onClick={() =>
                  setSettingsOpen(
                    false
                  )
                }
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
              >
                <Icon
                  name="close"
                  className="h-4 w-4"
                />
              </button>
            </header>


            <div className="grid gap-4 p-3 sm:p-5 xl:grid-cols-[minmax(0,1fr)_340px]">

              <div className="space-y-4">

                {/* BRAND */}

                <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

                  <div className="mb-4 flex items-center gap-3">

                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <Icon
                        name="phone"
                        className="h-4 w-4"
                      />
                    </span>

                    <div>

                      <h4 className="text-sm font-black">
                        Brand & Contact
                      </h4>

                      <p className="text-[9px] text-slate-400">
                        Information customers see on the portal.
                      </p>
                    </div>
                  </div>


                  <div className="grid gap-3 sm:grid-cols-2">

                    <Field label="Brand name">

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
                        placeholder="My Hotspot"
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


                    <Field label="Contact number">

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
                </section>


                {/* THEME */}

                <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

                  <div className="mb-4 flex items-center gap-3">

                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                      <Icon
                        name="image"
                        className="h-4 w-4"
                      />
                    </span>

                    <div>

                      <h4 className="text-sm font-black">
                        Theme & Background
                      </h4>

                      <p className="text-[9px] text-slate-400">
                        Control the visual style of the landing page.
                      </p>
                    </div>
                  </div>


                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">

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
                          onClick={() =>
                            setSettings(
                              current => ({
                                ...current,

                                theme_preset:
                                  key,

                                accent_color:
                                  item.accent,
                              })
                            )
                          }
                          className={`rounded-xl border p-2 text-left ${
                            settings.theme_preset ===
                            key
                              ? 'border-violet-500 ring-2 ring-violet-100'
                              : 'border-slate-200'
                          }`}
                        >

                          <span
                            className="block h-10 rounded-lg"
                            style={{
                              background:
                                item.background,
                            }}
                          />

                          <b className="mt-1.5 block text-[8px]">
                            {
                              item.name
                            }
                          </b>
                        </button>
                      )
                    )}
                  </div>


                  <div className="mt-4 grid gap-3 sm:grid-cols-2">

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
                          className="h-11 w-14 rounded-xl border border-slate-200 bg-white p-1"
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


                    <Field label="Background darkness">

                      <div className="flex h-11 items-center gap-3 rounded-xl bg-slate-50 px-3">

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
                          className="min-w-0 flex-1 accent-violet-600"
                        />

                        <b className="text-[9px]">
                          {
                            settings.background_overlay
                          }%
                        </b>
                      </div>
                    </Field>
                  </div>


                  <div className="mt-3 flex flex-wrap items-center gap-2">

                    <label className="cursor-pointer rounded-xl bg-slate-950 px-4 py-2.5 text-[9px] font-black text-white">

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
                        className="rounded-xl bg-rose-50 px-4 py-2.5 text-[9px] font-black text-rose-600"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                </section>


                {/* LAYOUT */}

                <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

                  <h4 className="text-sm font-black">
                    Package Layout
                  </h4>

                  <p className="mt-0.5 text-[9px] text-slate-400">
                    Choose how packages appear to customers.
                  </p>


                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">

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
                          className={`rounded-xl border p-3 ${
                            settings.package_layout ===
                            layout.key
                              ? 'border-violet-500 bg-violet-50 text-violet-700 ring-2 ring-violet-100'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >

                          <Icon
                            name="layout"
                            className="mx-auto h-5 w-5"
                          />

                          <b className="mt-2 block text-[8px]">
                            {
                              layout.name
                            }
                          </b>
                        </button>
                      )
                    )}
                  </div>
                </section>


                {/* FEATURES */}

                <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

                  <h4 className="text-sm font-black">
                    Portal Features
                  </h4>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">

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
                      label="Wallet"
                      description="Show the wallet card."
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
                      label="Voucher Login"
                      description="Allow voucher-code login."
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
                      label="Phone Support"
                      description="Display support number."
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
                      label="WhatsApp"
                      description="Display WhatsApp support."
                    />
                  </div>


                  {settings.wallet_enabled && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">

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


                      <Field label="Displayed balance">

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


                  <div className="mt-3">

                    <Field label="Popular package">

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
                              {
                                plan.name
                              }
                            </option>
                          )
                        )}
                      </select>
                    </Field>
                  </div>
                </section>


                <button
                  type="button"
                  disabled={
                    saving
                  }
                  onClick={
                    async () => {
                      const saved =
                        await saveSettings(
                          'Hotspot customization saved.'
                        );

                      if (saved) {
                        setSettingsOpen(
                          false
                        );
                      }
                    }
                  }
                  className="h-11 w-full rounded-xl bg-violet-600 text-xs font-black text-white shadow-lg shadow-violet-200 disabled:opacity-50"
                >
                  {saving
                    ? 'Saving...'
                    : 'Save Customization'}
                </button>
              </div>


              {/* LIVE PREVIEW */}

              <aside className="xl:sticky xl:top-20 xl:self-start">

                <p className="mb-2 text-[8px] font-black uppercase tracking-[.18em] text-slate-400">
                  Live Preview
                </p>

                <div className="overflow-hidden rounded-[26px] border-[6px] border-slate-950 bg-white shadow-xl">

                  <div
                    className="relative min-h-[520px] overflow-hidden"
                    style={
                      previewStyle
                    }
                  >

                    <div className="p-5 text-white">

                      <strong className="block truncate text-base font-black uppercase">
                        {settings.brand_name ||
                         'Your Hotspot'}
                      </strong>

                      <h4 className="mt-12 text-3xl font-black leading-tight">
                        {settings.hero_heading ||
                         'Fast Internet. Everywhere.'}
                      </h4>

                      <p className="mt-2 text-[10px] text-white/75">
                        {settings.tagline ||
                         'Connect instantly'}
                      </p>


                      {settings.wallet_enabled && (
                        <div className="mt-6 rounded-2xl bg-white p-4 text-slate-950">

                          <small className="text-[8px] font-black uppercase text-slate-400">
                            {
                              settings.wallet_label
                            }
                          </small>

                          <strong
                            className="mt-1 block text-lg"
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


                    <div className="absolute inset-x-0 bottom-0 rounded-t-[24px] bg-white p-4">

                      <small className="text-[8px] font-black uppercase text-slate-400">
                        Packages
                      </small>


                      <div
                        className={`mt-3 grid gap-2 ${
                          settings.package_layout ===
                          'list'
                            ? 'grid-cols-1'
                            : settings.package_layout ===
                              'compact'
                              ? 'grid-cols-3'
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
                                className={`flex min-h-14 flex-col items-center justify-center p-2 text-center text-white ${
                                  settings.package_layout ===
                                  'circles'
                                    ? 'aspect-square rounded-full'
                                    : 'rounded-xl'
                                }`}
                                style={{
                                  background:
                                    settings.accent_color ||
                                    '#0878f9',
                                }}
                              >

                                <b className="max-w-full truncate text-[8px]">
                                  {
                                    plan.name
                                  }
                                </b>

                                <span className="mt-0.5 text-[7px]">
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
                          <div className="mt-3 flex items-center gap-1.5 text-[8px] font-bold text-slate-500">

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
      )}
    </div>
  );
}
