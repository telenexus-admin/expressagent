import React, { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = '/api/public/hotspot';
const params = new URLSearchParams(window.location.search);
const previewMode = params.get('preview') === '1';
const money = (value) => `KSh ${Number(value || 0).toLocaleString()}`;
const normalizeMpesaPhone = (value) => {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('0')) {
    phone = `254${phone.slice(1)}`;
  }
  if (
    phone.startsWith('7') ||
    phone.startsWith('1')
  ) {
    phone = `254${phone}`;
  }
  return phone;
};

const HOTSPOT_THEMES = {
  blue: {
    deep: '#061a55',
    secondary: '#073bc7',
    accent: '#0878f9',
    page: '#edf2fb',
  },

  dark: {
    deep: '#020617',
    secondary: '#111827',
    accent: '#f59e0b',
    page: '#0f172a',
  },

  orange: {
    deep: '#241006',
    secondary: '#7c2d12',
    accent: '#f59e0b',
    page: '#fff7ed',
  },

  green: {
    deep: '#022c22',
    secondary: '#047857',
    accent: '#10b981',
    page: '#ecfdf5',
  },

  purple: {
    deep: '#2e1065',
    secondary: '#6d28d9',
    accent: '#7c3aed',
    page: '#f5f3ff',
  },
};


const HOTSPOT_CONFIG_CACHE_TTL =
  6 * 60 * 60 * 1000;

function hotspotConfigCacheKey(token) {
  const suffix =
    String(token || '')
      .slice(-36)
      .replace(
        /[^A-Za-z0-9_-]/g,
        ''
      );

  return suffix
    ? `nexa-hotspot-config-v4:${suffix}`
    : '';
}

function readHotspotConfigCache(token) {
  const key =
    hotspotConfigCacheKey(token);

  if (!key) {
    return null;
  }

  try {
    const raw =
      window.localStorage.getItem(
        key
      );

    if (!raw) {
      return null;
    }

    const stored =
      JSON.parse(raw);

    const savedAt =
      Number(stored?.saved_at || 0);

    if (
      !stored?.payload ||
      !savedAt ||
      Date.now() - savedAt >
        HOTSPOT_CONFIG_CACHE_TTL
    ) {
      window.localStorage
        .removeItem(key);

      return null;
    }

    return stored.payload;
  } catch (_) {
    return null;
  }
}

function writeHotspotConfigCache(
  token,
  payload
) {
  const key =
    hotspotConfigCacheKey(token);

  if (!key || !payload) {
    return;
  }

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        saved_at: Date.now(),
        payload,
      })
    );
  } catch (_) {
    // Restricted captive-portal
    // storage must not block loading.
  }
}

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    wifi: (
      <>
        <path d="M3 9a14 14 0 0 1 18 0" />
        <path d="M6 13a9 9 0 0 1 12 0" />
        <path d="M9 17a4 4 0 0 1 6 0" />
        <circle cx="12" cy="21" r="1" fill="currentColor" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    wallet: (
      <>
        <path d="M5 7.5h13a2 2 0 0 1 2 2v8H5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h11v5" />
        <path d="M15 11h6v4h-6a2 2 0 0 1 0-4Z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 2v6M16 2v6M4 10h16" />
      </>
    ),
    ticket: (
      <>
        <path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V7Z" />
        <path d="M9 7v12" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    headset: (
      <>
        <path d="M4 13a8 8 0 0 1 16 0v5a2 2 0 0 1-2 2h-3v-7h5" />
        <path d="M4 13h5v7H6a2 2 0 0 1-2-2v-5Z" />
      </>
    ),
    whatsapp: (
      <>
        <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z" />
        <path d="M9 8.5c.5 2.5 2 4 4.5 5l1.4-1.4 2 1c-.5 2-2 3-4 2.3-3.5-1.2-5.5-3.3-6.5-6.5-.6-2 1-3.6 2.5-4l1 2-1 1.6Z" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function WalletArt() {
  return (
    <div className="relative flex h-16 w-20 items-center justify-center">
      <div className="absolute right-1 top-2 h-12 w-14 rounded-xl bg-gradient-to-br from-sky-400 to-blue-700 shadow-lg shadow-blue-600/30" />
      <div className="absolute right-4 top-0 h-6 w-10 rounded-lg bg-blue-300" />
      <div className="absolute right-0 top-7 h-7 w-8 rounded-lg bg-blue-800">
        <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-cyan-200" />
      </div>
      <Icon name="wallet" className="absolute left-0 bottom-0 h-8 w-8 text-blue-700" />
    </div>
  );
}

function durationParts(minutesValue) {
  const minutes = Number(minutesValue || 0);
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return { value: days, unit: days === 1 ? 'DAY' : 'DAYS', icon: 'calendar' };
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return { value: hours, unit: hours === 1 ? 'HOUR' : 'HOURS', icon: 'clock' };
  }
  return { value: minutes, unit: minutes === 1 ? 'MIN' : 'MINS', icon: 'clock' };
}

function planHeadline(plan) {
  const rate = String(plan?.mikrotik_rate_limit || '');
  const match = rate.match(/(\d+(?:\.\d+)?)\s*[mM]/);
  if (match) return `${match[1]} Mbps`;
  const nameMatch = String(plan?.name || '').match(/(\d+(?:\.\d+)?)\s*Mbps/i);
  if (nameMatch) return `${nameMatch[1]} Mbps`;
  return plan?.name || 'Internet package';
}

function planDescription(plan, index) {
  if (plan?.data_limit_mb) return `${Number(plan.data_limit_mb).toLocaleString()} MB included`;
  const descriptions = ['High speed internet', 'Ideal for browsing', 'Great for streaming', 'Perfect for all usage'];
  return descriptions[index % descriptions.length];
}

function useServerClock(
  serverNow,
  enabled
) {
  const offset = useRef(0);

  const [now, setNow] =
    useState(Date.now());

  useEffect(() => {
    const parsed =
      Date.parse(
        serverNow || ''
      );

    offset.current =
      Number.isFinite(parsed)
        ? parsed - Date.now()
        : 0;

    setNow(
      Date.now() +
      offset.current
    );

    if (!enabled) {
      return undefined;
    }

    const timer =
      window.setInterval(
        () => {
          setNow(
            Date.now() +
            offset.current
          );
        },
        1000
      );

    return () =>
      window.clearInterval(timer);
  }, [
    serverNow,
    enabled,
  ]);

  return now;
}

function CountdownRing({ offer, now }) {
  const start = Date.parse(offer?.starts_at || '');
  const end = Date.parse(offer?.ends_at || '');
  const scheduled = Number.isFinite(start) && now < start;
  const target = scheduled ? start : end;
  const remaining = Math.max(0, target - now);
  const activeTotal = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? end - start
    : 60 * 60 * 1000;
  const scheduledTotal = Number.isFinite(start)
    ? Math.max(start - Date.parse(offer?.server_now || new Date(now).toISOString()), 1000)
    : activeTotal;
  const total = scheduled ? scheduledTotal : activeTotal;
  const progress = Math.max(0.04, Math.min(1, remaining / Math.max(total, 1)));
  const circumference = 2 * Math.PI * 52;
  const dashOffset = circumference * (1 - progress);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');

  return (
    <div className="text-center">
      <p className="text-[10px] font-black uppercase tracking-[.06em] text-slate-700">
        {scheduled ? 'Starts in' : 'Time remaining'}
      </p>
      <div className="relative mx-auto mt-2 h-[126px] w-[126px]">
        <svg className="-rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="52" fill="none" stroke="#e5e7eb" strokeWidth="9" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="#ff0b61"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-[19px] font-black tracking-tight text-[#101938]">
            {pad(hours)}:{pad(minutes)}:{pad(seconds)}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-[7px] font-black uppercase text-slate-500">
            <span>HRS</span><span>MIN</span><span>SEC</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MikroTikLogin({ login }) {
  useEffect(() => {
    if (!login?.url) return undefined;
    let target;
    try {
      target = new URL(login.url);
      const currentIp = new URLSearchParams(window.location.search).get('ip') || '';
      const privateIp = (value) => /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(value);
      if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/login' || !privateIp(target.hostname) || !privateIp(currentIp) || target.hostname.split('.').slice(0, 3).join('.') !== currentIp.split('.').slice(0, 3).join('.')) throw new Error('unsafe login target');
    } catch (_) { return undefined; }
    const form = document.createElement('form');
    form.method = 'post';
    form.action = target.toString();

    [
      ['username', login.username],
      ['password', login.password],
      ['dst', login.destination || ''],
    ].forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value || '';
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
    return () => form.remove();
  }, [login]);

  return (
    <div className="rounded-2xl bg-emerald-50 p-4 text-center text-sm font-bold text-emerald-700">
      Connecting you to the internet...
    </div>
  );
}

export default function HotspotPortal() {
  const portalToken = params.get('portalToken') || '';
  const origin = params.get('link-orig') || params.get('link_orig') || '';
  const loginUrl = params.get('link-login-only') || params.get('link_login_only') || '';

  const [config, setConfig] = useState(
    () =>
      readHotspotConfigCache(
        portalToken
      )
  );
  const [draftPortal, setDraftPortal] = useState(null);
  const [voucherUser, setVoucherUser] = useState('');
  const [voucherPassword, setVoucherPassword] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [login, setLogin] = useState(null);
  const [active, setActive] = useState(null);
  const [
    selectedPlanId,
    setSelectedPlanId,
  ] = useState(
    () =>
      config?.flash_offer?.plan_id
        ? Number(
            config.flash_offer.plan_id
          )
        : null
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeHeroSlide, setActiveHeroSlide] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentPhone, setPaymentPhone] = useState(
    () => window.localStorage.getItem(
      'nexa-hotspot-mpesa-phone'
    ) || '',
  );
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('idle');
  const [paymentError, setPaymentError] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState(null);

  const packagesRef = useRef(null);
  const voucherRef = useRef(null);
  const now = useServerClock(
    config?.server_now,
    Boolean(
      config?.flash_offer?.enabled
    )
  );

  const cachedConfigOnLoad =
    useRef(Boolean(config));

useEffect(() => {
    let mounted = true;

    const controller =
      typeof AbortController !==
        'undefined'
        ? new AbortController()
        : null;

    const timeout =
      window.setTimeout(
        () => {
          controller?.abort();
        },
        8000
      );

    fetch(
      `${apiBase}/config?portalToken=${
        encodeURIComponent(
          portalToken
        )
      }`,
      {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept:
            'application/json',
        },
        signal:
          controller?.signal,
      }
    )
      .then(async response => {
        const data =
          await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ||
            'Unable to load access options'
          );
        }

        return data;
      })
      .then(data => {
        if (!mounted) {
          return;
        }

        setConfig(data);
        setError('');

        writeHotspotConfigCache(
          portalToken,
          data
        );

        if (
          data?.flash_offer?.plan_id
        ) {
          setSelectedPlanId(
            current =>
              current ??
              Number(
                data.flash_offer
                  .plan_id
              )
          );
        }

        document.title =
          `${
            data?.portal
              ?.brand_name ||
            data?.client?.name ||
            'Nexa'
          } Hotspot`;
      })
      .catch(requestError => {
        if (
          mounted &&
          !cachedConfigOnLoad.current
        ) {
          setError(
            requestError?.name ===
              'AbortError'
              ? 'The hotspot is taking too long to respond. Reconnect to Wi-Fi and reload.'
              : requestError.message
          );
        }
      })
      .finally(() => {
        window.clearTimeout(
          timeout
        );
      });

    return () => {
      mounted = false;

      window.clearTimeout(
        timeout
      );

      controller?.abort();
    };
  }, [
    portalToken,
  ]);


  useEffect(() => {
    if (!previewMode) return undefined;
    const receiveDraft = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'polyizon-hotspot-preview') return;
      setDraftPortal(event.data.settings || null);
    };
    window.addEventListener('message', receiveDraft);
    return () => window.removeEventListener('message', receiveDraft);
  }, []);

  const portal = draftPortal ? { ...(config?.portal || {}), ...draftPortal } : (config?.portal || {});

  const plans = useMemo(() => config?.plans || [], [config]);
  const flashOffer = useMemo(() => {
    const offer = config?.flash_offer;
    const end = Date.parse(offer?.ends_at || '');
    if (!offer?.enabled || !Number.isFinite(end) || now >= end) return null;
    return { ...offer, server_now: config?.server_now };
  }, [config, now]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => Number(plan.id) === Number(selectedPlanId)) || null,
    [plans, selectedPlanId],
  );

  const popularPlanId = Number(portal?.popular_plan_id || 0);
  const brandName = portal?.brand_name || config?.client?.name || 'Nexa';
  const tagline = portal?.tagline || `Stay connected with ${brandName} Hotspot`;
  const supportPhone = config?.support?.phone || '';
  const whatsappPhone = config?.support?.whatsapp || supportPhone;
  const walletBalance = Number(portal?.wallet_balance || 0);
  const walletLabel = portal?.wallet_label || 'MY WALLET';
  const paymentEnabled = Boolean(
    config?.payments?.enabled &&
    Number(config?.payments?.channel_id) === 9010
  );

  const packageLayout =
    [
      'featured',
      'grid2',
      'compact',
      'list',
      'circles',
    ].includes(
      String(
        portal
          ?.package_layout ||
        ''
      )
    )
      ? String(
          portal
            .package_layout
        )
      : 'featured';

  const themePreset =
    String(
      portal
        ?.theme_preset ||
      'blue'
    );

  const theme =
    HOTSPOT_THEMES[
      themePreset
    ] ||
    HOTSPOT_THEMES.blue;

  const accentColor =
    /^#[0-9A-Fa-f]{6}$/
      .test(
        String(
          portal
            ?.accent_color ||
          ''
        )
      )
      ? String(
          portal
            .accent_color
        )
      : theme.accent;

  const walletEnabled =
    portal
      ?.wallet_enabled !==
    false;

  const showSupport =
    portal
      ?.show_support !==
    false;

  const showWhatsApp =
    portal
      ?.show_whatsapp !==
    false;

  const showVoucherLogin =
    portal
      ?.show_voucher_login !==
    false;

  const heroHeading =
    portal
      ?.hero_heading ||
    'Fast Internet. Everywhere.';

  const promoSlides = Array.isArray(portal?.promo_slides) ? portal.promo_slides.slice(0, 5).filter((slide) => slide?.id !== undefined) : [];
  const campaignEnabled = portal?.campaign_enabled === true;
  const campaignMessage = String(portal?.campaign_message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const campaignDuration = Math.min(28, Math.max(13, 11 + campaignMessage.length * 0.08));
  const heroSlideCount = 1 + promoSlides.length;
  const visiblePromoSlide = activeHeroSlide > 0 ? promoSlides[activeHeroSlide - 1] : null;
  const visiblePromoSource = visiblePromoSlide?.image_data || (visiblePromoSlide ? `${apiBase}/promo-slide?portalToken=${encodeURIComponent(portalToken)}&index=${activeHeroSlide - 1}&v=${encodeURIComponent(visiblePromoSlide.version || '')}` : '');

  useEffect(() => {
    setActiveHeroSlide((current) => Math.min(current, Math.max(0, heroSlideCount - 1)));
    if (heroSlideCount < 2) return undefined;
    const timer = window.setInterval(() => setActiveHeroSlide((current) => (current + 1) % heroSlideCount), 5500);
    return () => window.clearInterval(timer);
  }, [heroSlideCount]);
  const designTemplate = portal?.design_template === 'green_portrait' ? 'green_portrait' : 'classic';

  const backgroundOverlay =
    Math.max(
      0,
      Math.min(
        85,
        Number(
          portal
            ?.background_overlay ||
          46
        )
      )
    );

  const backgroundImageUrl =
    portal
      ?.background_image_enabled &&
    portalToken
      ? `${apiBase}/theme-background?portalToken=${
          encodeURIComponent(
            portalToken
          )
        }&v=${
          encodeURIComponent(
            portal
              ?.background_image_version ||
            ''
          )
        }`
      : '';

  const heroStyle =
    backgroundImageUrl
      ? {
          backgroundImage:
            `linear-gradient(rgba(2,6,23,${
              backgroundOverlay /
              100
            }),rgba(2,6,23,${
              backgroundOverlay /
              100
            })),url("${backgroundImageUrl}")`,

          backgroundSize:
            'cover',

          backgroundPosition:
            'center',
        }
      : {
          background:
            `linear-gradient(135deg,${
              theme.deep
            },${
              theme.secondary
            })`,
        };

  const selectedCheckoutPrice = (() => {
    if (!selectedPlan) return 0;

    const flashStart = Date.parse(
      flashOffer?.starts_at || ''
    );
    const flashEnd = Date.parse(
      flashOffer?.ends_at || ''
    );

    const flashActive = (
      Number(flashOffer?.plan_id) ===
        Number(selectedPlan.id) &&
      (
        !Number.isFinite(flashStart) ||
        now >= flashStart
      ) &&
      Number.isFinite(flashEnd) &&
      now < flashEnd
    );

    return flashActive
      ? Number(flashOffer.discount_price)
      : Number(selectedPlan.price);
  })();

  const scrollToPackages = () => {
    packagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  };

  const scrollToVoucher = () => {
    voucherRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setMenuOpen(false);
  };

  const choosePlan = (plan) => {
    const planId = Number(
      plan?.id || plan?.plan_id
    );

    setSelectedPlanId(planId);
    setPaymentError('');
    setPaymentReference('');
    setPaymentAmount(null);
    setPaymentStatus('idle');

    if (!paymentEnabled) {
      setError(
        'M-Pesa package checkout is not available. Use a voucher or contact support.',
      );
      window.setTimeout(scrollToVoucher, 80);
      return;
    }

    setPaymentOpen(true);
  };

  const submitPackagePayment = async (event) => {
    event.preventDefault();

    if (!selectedPlan) {
      setPaymentError(
        'Choose a hotspot package first.',
      );
      return;
    }

    const phone =
      normalizeMpesaPhone(paymentPhone);

    if (!/^254[17]\d{8}$/.test(phone)) {
      setPaymentError(
        'Enter a valid Safaricom M-Pesa number.',
      );
      return;
    }

    setPaymentBusy(true);
    setPaymentError('');
    setPaymentStatus('sending');

    try {
      window.localStorage.setItem(
        'nexa-hotspot-mpesa-phone',
        phone,
      );

      const response = await fetch(
        `${apiBase}/checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            portal_token: portalToken,
            plan_id: selectedPlan.id,
            phone,
            mac: params.get('mac') || '',
            ip: params.get('ip') || '',
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          'Could not send the M-Pesa prompt',
        );
      }

      setPaymentReference(data.reference);
      setPaymentAmount(data.amount);
      setPaymentStatus('pending');
    } catch (requestError) {
      setPaymentStatus('failed');
      setPaymentError(requestError.message);
    } finally {
      setPaymentBusy(false);
    }
  };

  useEffect(() => {
    if (
      !paymentReference ||
      paymentStatus !== 'pending'
    ) {
      return undefined;
    }

    let stopped = false;
    let timer = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `${apiBase}/checkout/${
            encodeURIComponent(paymentReference)
          }?portalToken=${
            encodeURIComponent(portalToken)
          }`,
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
            'Could not confirm the payment',
          );
        }

        if (stopped) return;

        if (data.status === 'active') {
          setPaymentStatus('active');
          setPaymentOpen(false);
          setActive(data.voucher);

          if (
            data.authentication === 'mac'
          ) {
            setPaymentError(
              'Payment confirmed. Internet access is active.',
            );

            window.setTimeout(() => {
              window.location.replace(
                origin ||
                'http://neverssl.com/'
              );
            }, 1200);

            return;
          }

          if (loginUrl && data.login) {
            setLogin({
              ...data.login,
              url: loginUrl,
              destination: origin,
            });
          }

          return;
        }

        if (data.status === 'failed') {
          setPaymentStatus('failed');
          setPaymentError(
            data.error ||
            'The M-Pesa payment was not completed.',
          );
          return;
        }

        setPaymentStatus(
          data.status === 'activating'
            ? 'pending'
            : 'pending',
        );

        if (data.message) {
          setPaymentError(data.message);
        }
      } catch (requestError) {
        if (!stopped) {
          setPaymentError(
            'Still waiting for payment confirmation...',
          );
        }
      }

      if (!stopped) {
        timer = window.setTimeout(
          poll,
          2000,
        );
      }
    };

    void poll();

    return () => {
      stopped = true;

      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [
    paymentReference,
    paymentStatus,
    portalToken,
    loginUrl,
    origin,
  ]);

  const updateVoucherUser = (value) => {
    const next = value.toUpperCase();
    setVoucherUser(next);
    if (!passwordTouched) setVoucherPassword(next);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (!voucherUser.trim()) {
      setError('Enter your voucher username.');
      return;
    }
    if (!voucherPassword.trim()) {
      setError('Enter your voucher password.');
      return;
    }
    if (voucherPassword.trim().toUpperCase() !== voucherUser.trim().toUpperCase()) {
      setError('For this hotspot, the voucher username and password must be the same code.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBase}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portal_token: portalToken,
          code: voucherUser.trim(),
          mac: params.get('mac') || '',
          ip: params.get('ip') || '',
          link_login_only: loginUrl,
          link_orig: origin,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Voucher login failed');
      setActive(data.voucher);
      setLogin(data.login?.url ? data.login : null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const whatsAppHref = whatsappPhone
    ? `https://wa.me/${String(whatsappPhone).replace(/\D/g, '')}`
    : '#';

  const flashDiscount = flashOffer
    ? Math.max(
      0,
      Math.round(
        ((Number(flashOffer.original_price) - Number(flashOffer.discount_price))
          / Math.max(Number(flashOffer.original_price), 1)) * 100,
      ),
    )
    : 0;

  return (
    <main
      className="min-h-screen text-[#101938]"
      style={{
        backgroundColor:
          theme.page,
      }}
    >
      <style>{`
        @font-face { font-family: 'Bebas Neue'; src: url('/fonts/bebas-neue.woff2') format('woff2'); font-display: swap; }
        .hotspot-page {
          font-family: Inter, "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .hotspot-green-portrait-name { font-family: 'Bebas Neue', 'Arial Narrow', sans-serif; font-weight: 700; letter-spacing: 2px; color: #00A651; text-shadow: 0 1px 0 rgba(255,255,255,.18); }
        .hotspot-green-template { background: #06180d !important; padding: 12px !important; }
        .hotspot-green-template > header, .hotspot-green-template > .relative.z-10 { display: none; }
        .hotspot-blue-grid {
          background:
            radial-gradient(circle at 88% 18%, rgba(0, 136, 255, .55), transparent 31%),
            radial-gradient(circle at 10% 85%, rgba(18, 72, 190, .38), transparent 36%),
            linear-gradient(135deg, #061a55 0%, #031243 48%, #073bc7 100%);
        }
        .hotspot-blue-grid::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: .25;
          background-image:
            repeating-radial-gradient(ellipse at 100% 0%, transparent 0 12px, rgba(75, 166, 255, .28) 13px 14px, transparent 15px 23px);
          transform: scale(1.15);
        }
        .hotspot-card-shadow {
          box-shadow: 0 12px 32px rgba(22, 39, 82, .13);
        }
        .hotspot-flash-badge {
          clip-path: polygon(8% 0, 92% 0, 100% 15%, 100% 78%, 50% 100%, 0 78%, 0 15%);
        }
        .hotspot-packages {
          display: grid;
          gap: 14px;
        }

        .hotspot-layout-list {
          grid-template-columns:
            minmax(0, 1fr);
        }

        .hotspot-layout-featured {
          grid-template-columns:
            repeat(6, minmax(0, 1fr));
        }

        .hotspot-layout-featured
        .hotspot-package-card {
          grid-column:
            span 2;

          grid-template-columns:
            minmax(0, 1fr) !important;
        }

        .hotspot-layout-featured
        .hotspot-package-card:nth-child(4) {
          grid-column:
            2 / span 2;
        }

        .hotspot-layout-featured
        .hotspot-package-card:nth-child(5) {
          grid-column:
            4 / span 2;
        }

        .hotspot-layout-grid2 {
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
        }

        .hotspot-layout-compact {
          grid-template-columns:
            repeat(3, minmax(0, 1fr));

          gap:
            10px;
        }

        .hotspot-layout-circles {
          grid-template-columns:
            repeat(3, minmax(0, 1fr));

          gap:
            14px;
        }

        .hotspot-layout-grid2
        .hotspot-package-card,
        .hotspot-layout-compact
        .hotspot-package-card,
        .hotspot-layout-circles
        .hotspot-package-card {
          grid-template-columns:
            minmax(0, 1fr) !important;
        }

        .hotspot-layout-circles
        .hotspot-package-card {
          aspect-ratio:
            1;

          align-content:
            center;

          border-radius:
            9999px !important;
        }

        .hotspot-layout-grid2
        .hotspot-package-card
        > div:last-child,
        .hotspot-layout-compact
        .hotspot-package-card
        > div:last-child,
        .hotspot-layout-featured
        .hotspot-package-card
        > div:last-child {
          justify-content:
            center;

          padding-bottom:
            14px;
        }

        .hotspot-layout-circles
        .hotspot-package-card
        > div:first-child {
          min-height:
            68px !important;
        }

        .hotspot-layout-circles
        .hotspot-package-card
        > div:nth-child(2)
        p {
          display:
            none;
        }

        .hotspot-layout-circles
        .hotspot-package-card
        > div:last-child {
          justify-content:
            center;

          padding-bottom:
            18px;
        }

        .hotspot-package-card
        > div:first-child {
          background:
            linear-gradient(
              135deg,
              var(--hs-accent),
              var(--hs-deep)
            ) !important;
        }

        @media (max-width: 520px) {
          .hotspot-layout-featured {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }

          .hotspot-layout-featured
          .hotspot-package-card,
          .hotspot-layout-featured
          .hotspot-package-card:nth-child(4),
          .hotspot-layout-featured
          .hotspot-package-card:nth-child(5) {
            grid-column:
              auto;
          }

          .hotspot-layout-compact,
          .hotspot-layout-circles {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>

      <div
        className="hotspot-page mx-auto min-h-screen w-full max-w-[760px] overflow-hidden bg-[#fbfcff] shadow-2xl shadow-slate-900/10"
        style={{
          '--hs-accent':
            accentColor,

          '--hs-deep':
            theme.deep,
        }}
      >
        {paymentOpen && selectedPlan && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-4 backdrop-blur-sm sm:items-center">
            <div className="w-full max-w-md rounded-[26px] bg-white p-6 shadow-2xl sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[.18em] text-blue-600">
                    M-Pesa checkout
                  </p>
                  <h2 className="mt-2 text-2xl font-black text-[#101938]">
                    {selectedPlan.name}
                  </h2>
                  <p className="mt-2 text-3xl font-black text-[#0871ee]">
                    {money(
                      paymentAmount ??
                      selectedCheckoutPrice
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={
                    paymentStatus === 'sending' ||
                    paymentStatus === 'pending'
                  }
                  onClick={() => setPaymentOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl font-black text-slate-600 disabled:opacity-40"
                  aria-label="Close payment"
                >
                  ×
                </button>
              </div>

              <form
                onSubmit={submitPackagePayment}
                className="mt-6"
              >
                <label className="block text-sm font-black text-slate-700">
                  M-Pesa phone number
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={paymentPhone}
                    disabled={
                      paymentStatus === 'sending' ||
                      paymentStatus === 'pending'
                    }
                    onChange={(event) => {
                      setPaymentPhone(
                        event.target.value
                      );
                      setPaymentError('');
                    }}
                    placeholder="0712 345 678"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-4 text-lg font-bold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100"
                  />
                </label>

                {paymentStatus === 'pending' && (
                  <div className="mt-4 rounded-xl bg-blue-50 px-4 py-4 text-sm font-semibold leading-6 text-blue-700">
                    M-Pesa prompt sent. Enter your PIN on your phone. Internet access will connect automatically after confirmation.
                  </div>
                )}

                {paymentError && (
                  <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${
                    paymentStatus === 'failed'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {paymentError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    paymentBusy ||
                    paymentStatus === 'pending'
                  }
                  className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#0876f9] to-[#073cc9] py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-700/20 disabled:opacity-60"
                >
                  {paymentStatus === 'sending'
                    ? 'Sending M-Pesa prompt...'
                    : paymentStatus === 'pending'
                      ? 'Waiting for payment...'
                      : paymentStatus === 'failed'
                        ? 'Try payment again'
                        : `Pay ${money(selectedCheckoutPrice)}`}
                </button>
              </form>

              <p className="mt-4 text-center text-xs font-semibold text-slate-500">
                Pay securely through PayHero channel 9010.
              </p>
            </div>
          </div>
        )}

        <section
          className={designTemplate === 'green_portrait' ? 'hotspot-green-template relative overflow-hidden text-white' : 'hotspot-blue-grid relative overflow-hidden px-5 pb-28 pt-6 text-white sm:px-9 sm:pb-32 sm:pt-8'}
          style={designTemplate === 'green_portrait' ? undefined : heroStyle}
        >
          {designTemplate === 'green_portrait' && <div className="relative mx-auto w-[70%] max-w-[434px] overflow-hidden rounded-[22px]">
            {activeHeroSlide === 0 ? <div className="relative"><img src="/hotspot-templates/green-portrait-hotspot.webp?v=green-portrait-v1" alt="Green Portrait hotspot" width="689" height="821" fetchPriority="high" decoding="async" className="block w-full" /><div className="hotspot-green-portrait-name absolute left-[34.8%] top-[15.2%] flex h-[6.5%] w-[30.1%] items-center justify-center overflow-hidden px-1 text-center text-[clamp(13px,5.3vw,35px)] leading-none">{brandName}</div></div> : <img src={visiblePromoSource} alt={`Promotion ${activeHeroSlide}`} width="1080" height="1350" decoding="async" className="block aspect-[4/5] w-full object-cover" />}
            {heroSlideCount > 1 && <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/35 px-2 py-1.5 backdrop-blur"><button type="button" aria-label="Show first hotspot image" onClick={() => setActiveHeroSlide(0)} className={`h-1.5 rounded-full transition-all ${activeHeroSlide === 0 ? 'w-5 bg-white' : 'w-1.5 bg-white/55'}`} />{promoSlides.map((slide, index) => <button type="button" key={slide.id || index} aria-label={`Show promotion ${index + 1}`} onClick={() => setActiveHeroSlide(index + 1)} className={`h-1.5 rounded-full transition-all ${activeHeroSlide === index + 1 ? 'w-5 bg-white' : 'w-1.5 bg-white/55'}`} />)}</div>}
          </div>}
          <header className="relative z-20 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Icon name="wifi" className="h-12 w-12 sm:h-14 sm:w-14" />
              <div className="leading-none">
                <div className="max-w-[210px] truncate text-xl font-black uppercase tracking-wide sm:text-2xl">
                  {brandName}
                </div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-[.38em] text-blue-100 sm:text-sm">
                  Hotspot
                </div>
              </div>
            </div>

            <button
              type="button"
              aria-label="Open hotspot menu"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-white transition hover:bg-white/10"
            >
              <Icon name="menu" className="h-8 w-8" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-[52px] w-48 overflow-hidden rounded-2xl border border-white/15 bg-[#071747]/95 p-2 shadow-2xl backdrop-blur">
                <button type="button" onClick={scrollToPackages} className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold hover:bg-white/10">
                  Packages
                </button>
                <button type="button" onClick={scrollToVoucher} className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold hover:bg-white/10">
                  Voucher login
                </button>
                {showSupport &&
                  supportPhone && (
                    <a href={`tel:${supportPhone}`} className="block rounded-xl px-4 py-3 text-sm font-bold hover:bg-white/10">
                      Contact support
                    </a>
                  )}
              </div>
            )}
          </header>

          <div className="relative z-10 mt-10 grid gap-7 min-[520px]:grid-cols-[.92fr_1.08fr] min-[520px]:items-center sm:mt-12">
            <div>
              <h1 className="text-[38px] font-black leading-[1.05] tracking-tight sm:text-[48px]">
                {heroHeading}
              </h1>
              <p className="mt-5 max-w-[320px] text-lg font-medium leading-7 text-blue-50">
                {tagline}
              </p>
            </div>

            {walletEnabled && (
            <div className="rounded-[24px] bg-white p-5 text-[#101938] shadow-2xl shadow-blue-950/25">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">
                    {walletLabel}
                  </p>
                  <p className="mt-3 text-[28px] font-black tracking-tight text-[#0462dc]">
                    {money(walletBalance)}
                  </p>
                </div>
                <WalletArt />
              </div>
              <button
                type="button"
                onClick={scrollToPackages}
                className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#0876f9] to-[#073cc9] py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-600/25"
              >
                Top up
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-blue-700">
                  <Icon name="plus" className="h-4 w-4" />
                </span>
              </button>
            </div>
            )}
          </div>
        </section>
        {designTemplate !== 'green_portrait' && promoSlides.length > 0 && (
          <section className="relative mx-auto w-[70%] max-w-[434px] overflow-hidden rounded-[22px] px-5 pt-6 sm:px-9">
            <img src={visiblePromoSource || promoSlides[0]?.image_data || `/api/public/hotspot/promo-slide?portalToken=${encodeURIComponent(portalToken)}&index=0&v=${encodeURIComponent(promoSlides[0]?.version || '')}`} alt="Promotion" width="1080" height="1350" decoding="async" className="block aspect-[4/5] w-full rounded-[22px] object-cover shadow-xl" />
            <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/35 px-2 py-1.5 backdrop-blur">
              {promoSlides.map((slide, index) => <button type="button" key={slide.id || index} aria-label={`Show promotion ${index + 1}`} onClick={() => setActiveHeroSlide(index + 1)} className={`h-1.5 rounded-full transition-all ${activeHeroSlide === index + 1 ? 'w-5 bg-white' : 'w-1.5 bg-white/55'}`} />)}
            </div>
          </section>
        )}

        {campaignEnabled && campaignMessage && (
          <section
            className="relative z-20 px-5 pt-4 sm:px-9"
            aria-label="Hotspot notification"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
              <span
                className="shrink-0 px-3 py-2.5 text-[8px] font-black uppercase tracking-[.16em] text-white sm:px-4 sm:text-[9px]"
                style={{ backgroundColor: accentColor }}
              >
                Notice
              </span>

              <div className="hotspot-campaign-track py-2.5">
                <span
                  className="hotspot-campaign-message text-[11px] font-extrabold tracking-[.01em] text-slate-700 sm:text-xs"
                  style={{ '--hotspot-campaign-duration': `${campaignDuration}s` }}
                >
                  {campaignMessage}
                </span>
              </div>
            </div>
          </section>
        )}

        {flashOffer && (
          <section
            className={`relative z-20 px-5 sm:px-9 ${
              campaignEnabled && campaignMessage
                ? 'mt-4'
                : '-mt-5 sm:-mt-7'
            }`}
          >
            <button
              type="button"
              onClick={() => choosePlan(flashOffer)}
              className="hotspot-card-shadow mx-auto flex w-full max-w-[270px] items-center gap-3 rounded-2xl border border-pink-100 bg-white p-2.5 text-left transition hover:-translate-y-0.5"
            >
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-[#ff0b61] text-[11px] font-black leading-3 text-white shadow-sm shadow-pink-500/25">
                -{flashDiscount}%
                <span className="text-[8px] tracking-wide">OFF</span>
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[8px] font-black uppercase tracking-[.18em] text-pink-500">Flash offer</span>
                <span className="mt-0.5 block truncate text-sm font-black text-[#111a38]">
                  {planHeadline(flashOffer)} · {durationParts(flashOffer.duration_minutes).value}{durationParts(flashOffer.duration_minutes).unit}
                </span>
                <span className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 line-through">{money(flashOffer.original_price)}</span>
                  <span className="text-base font-black text-[#ff0b61]">{money(flashOffer.discount_price)}</span>
                </span>
              </span>

              <Icon name="chevron" className="h-4 w-4 shrink-0 text-pink-500" />
            </button>
          </section>
        )}

        <section ref={packagesRef} className={`${flashOffer ? 'pt-8' : 'pt-10'} px-5 sm:px-9`}>
          <div className="flex items-center justify-center gap-5">
            <span className="h-px w-16 bg-slate-300" />
            <h2 className="text-base font-black uppercase tracking-wide text-[#121b3b]">Packages</h2>
            <span className="h-px w-16 bg-slate-300" />
          </div>

          {plans.length ? (
            <div
              className={`mt-5 hotspot-packages hotspot-layout-${packageLayout}`}
            >
              {plans.map((plan, index) => {
                const duration = durationParts(plan.duration_minutes);
                const popular = popularPlanId
                  ? Number(plan.id) === popularPlanId
                  : index === Math.min(2, plans.length - 1);
                const selected = Number(selectedPlanId) === Number(plan.id);

                return (
                  <button
                    type="button"
                    key={plan.id}
                    onClick={() => choosePlan(plan)}
                    className={`hotspot-package-card hotspot-card-shadow grid w-full grid-cols-[105px_minmax(0,1fr)_auto] overflow-hidden rounded-[18px] border bg-white text-left transition hover:-translate-y-0.5 sm:grid-cols-[145px_minmax(0,1fr)_auto] ${
                      selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex min-h-[92px] items-center justify-center gap-3 bg-gradient-to-br from-[#0781ff] to-[#064ccf] px-3 text-white sm:min-h-[102px]">
                      <Icon name={duration.icon} className="h-8 w-8 shrink-0" />
                      <div className="text-center leading-none">
                        <div className="text-[28px] font-black">{duration.value}</div>
                        <div className="mt-2 text-[11px] font-black uppercase">{duration.unit}</div>
                      </div>
                    </div>

                    <div className="min-w-0 px-4 py-4 sm:px-6">
                      {popular && (
                        <span className="inline-flex rounded-md bg-[#ff0b61] px-2 py-1 text-[9px] font-black uppercase text-white">
                          Popular
                        </span>
                      )}
                      <div className={`${popular ? 'mt-2' : ''} truncate text-base font-black text-[#101938]`}>
                        {planHeadline(plan)}
                      </div>
                      <p className="mt-1 truncate text-xs font-medium text-slate-600 sm:text-sm">
                        {planDescription(plan, index)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 px-3 text-[#0656d7] sm:gap-4 sm:px-6">
                      <span className="whitespace-nowrap text-base font-black sm:text-xl">
                        {money(plan.price)}
                      </span>
                      <Icon name="chevron" className="h-5 w-5 text-slate-600" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500">
              Access packages will appear here.
            </div>
          )}
        </section>

        {showVoucherLogin && (
        <section ref={voucherRef} className="px-5 pb-7 pt-7 sm:px-9">
          <div className="hotspot-card-shadow rounded-[20px] border border-slate-200 bg-white p-5 sm:p-7">
            <div className="flex items-center gap-3 text-[#064ebd]">
              <Icon name="ticket" className="h-7 w-7" />
              <h2 className="text-lg font-black uppercase tracking-wide">Voucher login</h2>
            </div>

            {selectedPlan && (
              <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-xs font-bold text-blue-700">
                Selected: {selectedPlan.name} - {money(selectedPlan.price)}
              </p>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#3e6eca]">
                  <Icon name="user" className="h-6 w-6" />
                </span>
                <input
                  required
                  value={voucherUser}
                  onChange={(event) => updateVoucherUser(event.target.value)}
                  placeholder="Voucher Username"
                  autoComplete="username"
                  className="w-full rounded-xl border border-[#b9c9e7] bg-white py-4 pl-[52px] pr-4 font-mono text-sm font-bold uppercase tracking-wider outline-none transition placeholder:font-sans placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                />
              </label>

              <label className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#3e6eca]">
                  <Icon name="lock" className="h-6 w-6" />
                </span>
                <input
                  required
                  type="password"
                  value={voucherPassword}
                  onChange={(event) => {
                    setPasswordTouched(true);
                    setVoucherPassword(event.target.value.toUpperCase());
                  }}
                  placeholder="Voucher Password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#b9c9e7] bg-white py-4 pl-[52px] pr-4 font-mono text-sm font-bold uppercase tracking-wider outline-none transition placeholder:font-sans placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                />
              </label>

              {error && (
                <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                  {error}
                </p>
              )}

              {login && <MikroTikLogin login={login} />}

              {active && !login && (
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <b>Voucher activated.</b>
                  <br />
                  Valid until {new Date(active.expires_at).toLocaleString()}.
                </div>
              )}

              <button
                disabled={busy || Boolean(login)}
                className="w-full rounded-xl bg-gradient-to-r from-[#0876f9] to-[#073cc9] py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-700/20 disabled:opacity-60"
              >
                {busy ? 'Checking voucher...' : login ? 'Connecting...' : 'Login'}
              </button>
            </form>
          </div>
        </section>

        )}

        {(showSupport ||
          showWhatsApp) && (
          <footer
            className={`grid ${
              showSupport &&
              showWhatsApp
                ? 'grid-cols-2 divide-x divide-white/20'
                : 'grid-cols-1'
            } px-5 py-5 text-white sm:px-9`}
            style={{
              background:
                `linear-gradient(90deg,${
                  theme.deep
                },${
                  theme.secondary
                })`,
            }}
          >
            {showSupport && (
              <a
                href={
                  supportPhone
                    ? `tel:${supportPhone}`
                    : '#'
                }
                className="flex items-center justify-center gap-3 px-4"
              >
                <Icon
                  name="headset"
                  className="h-9 w-9"
                />

                <span>
                  <span className="block text-xs text-white/70">
                    Support
                  </span>

                  <b className="mt-1 block text-sm">
                    {supportPhone ||
                     'Contact admin'}
                  </b>
                </span>
              </a>
            )}

            {showWhatsApp && (
              <a
                href={
                  whatsAppHref
                }
                target={
                  whatsappPhone
                    ? '_blank'
                    : undefined
                }
                rel={
                  whatsappPhone
                    ? 'noreferrer'
                    : undefined
                }
                className="flex items-center justify-center gap-3 px-4"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#20c763] text-white">
                  <Icon
                    name="whatsapp"
                    className="h-7 w-7"
                  />
                </span>

                <span>
                  <span className="block text-xs text-white/70">
                    WhatsApp
                  </span>

                  <b className="mt-1 block text-sm">
                    {whatsappPhone ||
                     'Contact admin'}
                  </b>
                </span>
              </a>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}
