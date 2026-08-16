const db = require('../db');

const {
  connectRouter,
  decryptSecret,
} = require('./mikrotik');

const {
  loadPayHeroConfig,
} = require('./payhero');

const {
  createHotspotPortalToken,
  createHotspotPortalBootstrapToken,
} = require('./hotspotPortalToken');

const API_ORIGIN =
  process.env.PUBLIC_BACKEND_URL ||
  process.env.PUBLIC_API_URL ||
  process.env.FRONTEND_URL ||
  'https://billing.polyizon.tech';

const API_BASE =
  `${API_ORIGIN.replace(/\/$/, '')}/api/public/hotspot`;

function rows(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function rowId(value) {
  return value?.['.id'] || null;
}

function routerBoolean(value) {
  return [
    true,
    1,
    '1',
    'true',
    'yes',
    'on',
  ].includes(value);
}

function publicBoolean(value) {
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    value === 'true'
  );
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(
      /\u2028/g,
      '\\u2028'
    )
    .replace(
      /\u2029/g,
      '\\u2029'
    );
}

function hotspotRedirectResponse() {
  return `$(if http-status == 302)Hotspot redirect$(endif)
$(if http-header == "Location")$(link-redirect)$(endif)`;
}

function hotspotApiDocument() {
  return `{
  "captive": $(if logged-in == 'yes')false$(else)true$(endif),
  "user-portal-url": "$(link-login-only)",
  $(if session-timeout-secs != 0)
  "seconds-remaining": $(session-timeout-secs),
  $(endif)
  $(if remain-bytes-total)
  "bytes-remaining": $(remain-bytes-total),
  $(endif)
  "can-extend-session": true
}`;
}

async function loadHotspotEdgeConfig(
  clientId
) {
  await db.query(`
    ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS
      hotspot_portal_config
      JSONB NOT NULL
      DEFAULT '{}'::jsonb
  `);

  const [
    clientResult,
    planResult,
    settingsResult,
  ] = await Promise.all([
    db.query(
      `SELECT
         id,
         name,
         hotspot_portal_config
       FROM clients
       WHERE id = $1
         AND account_type =
             'billing'
       LIMIT 1`,
      [clientId]
    ),

    db.query(
      `SELECT
         id,
         name,
         price,
         duration_minutes,
         data_limit_mb,
         mikrotik_rate_limit,
         router_id
       FROM billing_hotspot_plans
       WHERE client_id = $1
         AND is_active = TRUE
       ORDER BY
         price ASC,
         duration_minutes ASC`,
      [clientId]
    ),

    db.query(
      `SELECT
         key,
         value
       FROM client_settings
       WHERE client_id = $1
         AND key IN (
           'hotspot_brand_name',
           'hotspot_support_phone',
           'hotspot_support_text'
         )`,
      [clientId]
    ).catch(() => ({
      rows: [],
    })),
  ]);

  const client =
    clientResult.rows[0];

  if (!client) {
    throw new Error(
      'Hotspot billing account was not found'
    );
  }

  const saved =
    client.hotspot_portal_config ||
    {};

  const legacy =
    Object.fromEntries(
      settingsResult.rows.map(
        setting => [
          setting.key,
          setting.value,
        ]
      )
    );

  const paymentConfig =
    await loadPayHeroConfig(
      clientId
    ).catch(() => ({
      enabled: false,
      basicAuth: '',
      channelId: null,
    }));

  const brandName =
    String(
      saved.brand_name ||
      legacy.hotspot_brand_name ||
      client.name ||
      'Nexa'
    ).trim();

  const supportPhone =
    String(
      saved.support_phone ||
      legacy.hotspot_support_phone ||
      ''
    ).trim();

  const flashPlan =
    planResult.rows.find(
      plan =>
        Number(plan.id) ===
        Number(
          saved.flash_plan_id
        )
    );

  const discountPrice =
    Number(
      saved.flash_discount_price
    );

  const originalPrice =
    Number(
      flashPlan?.price || 0
    );

  const startsAt =
    saved.flash_starts_at ||
    null;

  const endsAt =
    saved.flash_ends_at ||
    null;

  const now =
    Date.now();

  const startTime =
    startsAt
      ? Date.parse(startsAt)
      : null;

  const endTime =
    endsAt
      ? Date.parse(endsAt)
      : null;

  const validFlash =
    publicBoolean(
      saved.flash_enabled
    ) &&
    flashPlan &&
    Number.isFinite(
      discountPrice
    ) &&
    discountPrice >= 0 &&
    discountPrice <
      originalPrice &&
    Number.isFinite(
      endTime
    ) &&
    endTime > now;

  const flashOffer =
    validFlash
      ? {
          enabled: true,

          status:
            Number.isFinite(
              startTime
            ) &&
            now < startTime
              ? 'scheduled'
              : 'active',

          plan_id:
            flashPlan.id,

          name:
            flashPlan.name,

          original_price:
            originalPrice,

          discount_price:
            discountPrice,

          starts_at:
            startsAt,

          ends_at:
            endsAt,

          duration_minutes:
            flashPlan.duration_minutes,

          data_limit_mb:
            flashPlan.data_limit_mb,

          mikrotik_rate_limit:
            flashPlan.mikrotik_rate_limit,
        }
      : null;

  return {
    server_now:
      new Date()
        .toISOString(),

    client: {
      id:
        client.id,

      name:
        brandName,
    },

    portal: {
      brand_name:
        brandName,

      tagline:
        String(
          saved.tagline ||
          `Stay connected with ${brandName} Hotspot`
        ).trim(),

      popular_plan_id:
        saved.popular_plan_id
          ? Number(
              saved.popular_plan_id
            )
          : null,

      wallet_enabled:
        saved.wallet_enabled ===
          undefined
          ? true
          : publicBoolean(
              saved.wallet_enabled
            ),

      wallet_label:
        String(
          saved.wallet_label ||
          'MY WALLET'
        ).trim(),

      wallet_balance:
        Number.isFinite(
          Number(
            saved.wallet_balance
          )
        )
          ? Math.max(
              0,
              Number(
                saved.wallet_balance
              )
            )
          : 0,

      package_layout:
        [
          'featured',
          'grid2',
          'compact',
          'list',
          'circles',
        ].includes(
          String(
            saved.package_layout ||
            ''
          )
        )
          ? String(
              saved.package_layout
            )
          : 'featured',

      theme_preset:
        String(
          saved.theme_preset ||
          'orange'
        ),

      design_template:
        String(saved.design_template || '') === 'green_portrait'
          ? 'green_portrait'
          : 'classic',

      accent_color:
        /^#[0-9A-Fa-f]{6}$/
          .test(
            String(
              saved.accent_color ||
              ''
            )
          )
            ? String(
                saved.accent_color
              )
            : '#ffb221',

      background_image_enabled:
        Boolean(
          saved.background_image_data
        ),

      background_image_version:
        saved.background_image_updated_at ||
        saved.updated_at ||
        '',

      background_overlay:
        Number.isFinite(
          Number(
            saved.background_overlay
          )
        )
          ? Math.max(
              0,
              Math.min(
                85,
                Number(
                  saved.background_overlay
                )
              )
            )
          : 46,

      show_support:
        saved.show_support ===
          undefined
          ? true
          : publicBoolean(
              saved.show_support
            ),

      show_whatsapp:
        saved.show_whatsapp ===
          undefined
          ? true
          : publicBoolean(
              saved.show_whatsapp
            ),

      show_voucher_login:
        saved.show_voucher_login ===
          undefined
          ? true
          : publicBoolean(
              saved.show_voucher_login
            ),
    },

    support: {
      phone:
        supportPhone,

      whatsapp:
        String(
          saved.whatsapp_phone ||
          supportPhone
        ).trim(),

      text:
        String(
          saved.support_text ||
          legacy.hotspot_support_text ||
          'Need help? Contact support.'
        ).trim(),
    },

    payments: {
      enabled:
        Boolean(
          paymentConfig.enabled &&
          paymentConfig.basicAuth &&
          Number(
            paymentConfig.channelId
          ) === 9010
        ),

      channel_id:
        paymentConfig.channelId ||
        null,
    },

    flash_offer:
      flashOffer,

    plans:
      planResult.rows,
  };
}

function buildHotspotEdgeHtml({
  portalToken,
  config,
}) {
  const embedded =
    safeJson(config);

  const token =
    safeJson(
      String(
        portalToken || ''
      )
    );

  const apiBase =
    safeJson(API_BASE);

  const apiOrigin =
    safeJson(API_ORIGIN);

  const portraitAsset =
    safeJson(API_ORIGIN + '/hotspot-templates/green-portrait-hotspot.webp');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#061a55">
<meta http-equiv="Cache-Control" content="no-store">
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; connect-src ${API_ORIGIN}; img-src 'self' data: ${API_ORIGIN}; font-src 'self' ${API_ORIGIN}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self' http: https:;"
>
<title>Hotspot Packages</title>
<style>
*{
  box-sizing:border-box
}

:root{
  --accent:#ffb221;
  --accent-text:#050505;
}

html,
body{
  margin:0;
  min-height:100%;
  background:#000;
  color:#fff;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}

body{
  padding:0;
}

button,
input{
  font:inherit
}

button{
  cursor:pointer
}

.shell{
  width:100%;
  max-width:720px;
  min-height:100vh;
  margin:0 auto;
  padding:
    26px
    15px
    44px;
  background:#000;
}


/* HERO */

.hero{
  position:relative;
  min-height:550px;
  overflow:hidden;
  border-radius:28px;
  background:
    radial-gradient(
      circle at 54% 26%,
      #ffad18 0,
      #ffad18 18%,
      transparent 18.4%
    ),
    radial-gradient(
      circle at 50% 28%,
      #202020 0,
      #111 45%,
      #050505 80%
    );
  box-shadow:
    inset 0 0 60px #000,
    0 18px 45px #000;
}

 @font-face{
  font-family:"Bebas Neue";
  src:url("${API_ORIGIN}/fonts/bebas-neue.woff2") format("woff2");
  font-display:swap;
}

.hero.green-portrait{
  width:75%;
  min-height:0;
  aspect-ratio:1019/1367;
  margin-left:auto;
  margin-right:auto;
  background:#f5f5f0;
  box-shadow:0 18px 45px #0008;
}

.hero.green-portrait::before{display:none;}
.hero.green-portrait .hero-person,
.hero.green-portrait .brand,
.hero.green-portrait .hero-copy{display:none;}

.portrait-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;}
.hero.green-portrait .portrait-art{display:block;}

.portrait-isp-name{display:none;position:absolute;z-index:4;left:34.8%;top:15.2%;width:30.1%;height:6.5%;overflow:hidden;align-items:center;justify-content:center;text-align:center;color:#00A651;font-family:"Bebas Neue","Arial Narrow",Impact,sans-serif;font-size:clamp(16px,5vw,48px);font-weight:700;letter-spacing:2px;line-height:1;white-space:nowrap;text-transform:uppercase;}
.hero.green-portrait .portrait-isp-name{display:flex;}

.hero::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  opacity:.32;
  background:
    repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 2px,
      #ffffff08 3px,
      transparent 4px
    );
}

.brand{
  position:absolute;
  left:22px;
  bottom:115px;
  z-index:3;
}

.brand-logo{
  display:inline-flex;
  width:84px;
  height:84px;
  align-items:center;
  justify-content:center;
  border-radius:50%;
  background:#fff;
  color:#111;
  font-size:21px;
  font-weight:1000;
  letter-spacing:-1px;
}

.brand-word{
  display:block;
  margin:
    -4px
    0
    0
    64px;
  color:#fff;
  font-family:cursive;
  font-size:54px;
  font-weight:400;
  line-height:.85;
  transform:rotate(-5deg);
}

.hero-person{
  position:absolute;
  top:95px;
  left:50%;
  width:225px;
  height:310px;
  transform:translateX(-50%);
}

.hero-person::before{
  content:"";
  position:absolute;
  left:52%;
  top:0;
  width:118px;
  height:118px;
  transform:translateX(-50%);
  border-radius:48% 52% 45% 55%;
  background:#141414;
  box-shadow:
    0 100px 0 34px #151515;
}

.hero-person::after{
  content:"";
  position:absolute;
  left:14px;
  top:181px;
  width:197px;
  height:165px;
  border-radius:
    70px
    70px
    24px
    24px;
  background:
    linear-gradient(
      145deg,
      #242424,
      #090909
    );
}

.hero-copy{
  position:absolute;
  left:22px;
  right:22px;
  bottom:25px;
  z-index:3;
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:20px;
}

.hero-contact{
  font-size:11px;
  color:#ddd;
  line-height:1.25;
}

.hero-contact strong{
  display:block;
  font-size:16px;
  color:#fff;
}

.hero-qr{
  display:grid;
  width:62px;
  height:62px;
  place-items:center;
  border:4px solid #fff;
  background:
    repeating-conic-gradient(
      #000 0 25%,
      #fff 0 50%
    )
    0 0/10px 10px;
}


/* PACKAGES */

.content{
  padding-top:34px;
}

.heading{
  display:none;
}

.panel{
  background:transparent;
  border:0;
  box-shadow:none;
}

.plans{
  display:grid;
  grid-template-columns:
    repeat(6,minmax(0,1fr));
  gap:15px;
  padding:0;
}

.plan{
  position:relative;
  display:flex;
  min-width:0;
  min-height:96px;
  grid-column:span 2;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  margin:0;
  padding:8px 5px;
  border:0;
  border-radius:12px;
  background:var(--accent);
  color:var(--accent-text);
  text-align:center;
  box-shadow:none;
  transition:
    transform .15s ease,
    filter .15s ease;
}

.plan:nth-child(4){
  grid-column:
    2/span 2;
}

.plan:nth-child(5){
  grid-column:
    4/span 2;
}

.plan:active{
  transform:scale(.96);
}

.plan::before,
.plan::after{
  content:"";
  position:absolute;
  width:46px;
  height:25px;
  background:#fff;
}

.plan::before{
  right:-25px;
  top:-19px;
  border-radius:
    0
    0
    0
    80%;
  transform:rotate(7deg);
}

.plan::after{
  right:-26px;
  bottom:-21px;
  border-radius:
    80%
    0
    0
    0;
  transform:rotate(-8deg);
}

.plan-duration{
  min-height:auto;
  padding:0;
  background:transparent;
  color:#050505;
}

.plan-duration b{
  font-size:16px;
  font-weight:900;
}

.plan-duration small{
  margin-top:3px;
  color:#050505;
  font-size:10px;
  font-weight:800;
}

.plan-main{
  padding:4px 2px 0;
}

.plan-main .badge{
  position:absolute;
  left:9px;
  top:9px;
  z-index:5;
  margin:0;
  padding:4px 7px;
  border-radius:7px;
  background:#000;
  color:var(--accent);
  font-size:8px;
}

.plan-main b{
  display:none;
}

.plan-main small{
  display:none;
}

.price{
  display:block;
  padding:4px 0 0;
  color:#050505;
  font-size:13px;
  font-weight:900;
}

.price::before{
  content:"KSH:";
}

.flash{
  border:2px solid #fff;
  box-shadow:
    0 0 0 2px var(--accent);
}



.wallet-card{
  display:none;
  margin-top:18px;
  border:1px solid #252525;
  border-radius:18px;
  padding:15px 18px;
  background:#111;
  color:#fff;
}

.wallet-card small{
  display:block;
  color:#888;
  font-size:9px;
  font-weight:900;
  letter-spacing:.12em;
}

.wallet-card b{
  display:block;
  margin-top:5px;
  color:var(--accent);
  font-size:21px;
}

.plans.layout-list{
  display:flex;
  flex-direction:column;
}

.plans.layout-list .plan{
  min-height:56px;
  display:grid;
  grid-template-columns:58px 1fr auto;
  padding:6px 8px;
  text-align:left;
}

.plans.layout-list .plan-duration{
  text-align:center;
}

.plans.layout-list .plan-main b,
.plans.layout-list .plan-main small{
  display:block;
}

.plans.layout-list .price{
  align-self:center;
  padding:0 8px;
}

.plans.layout-grid2{
  grid-template-columns:
    repeat(2,minmax(0,1fr));
}

.plans.layout-grid2 .plan{
  grid-column:auto;
}

.plans.layout-grid2 .plan:nth-child(4),
.plans.layout-grid2 .plan:nth-child(5){
  grid-column:auto;
}

.plans.layout-compact{
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:10px;
}

.plans.layout-compact .plan{
  min-height:74px;
  grid-column:auto;
}

.plans.layout-compact .plan:nth-child(4),
.plans.layout-compact .plan:nth-child(5){
  grid-column:auto;
}

.plans.layout-circles{
  grid-template-columns:
    repeat(4,minmax(0,1fr));
  gap:8px;
}

.plans.layout-circles .plan{
  min-height:0;
  grid-column:auto;
  aspect-ratio:1;
  border-radius:50%;
}

.plans.layout-circles .plan:nth-child(4),
.plans.layout-circles .plan:nth-child(5){
  grid-column:auto;
}

@media(max-width:430px){
  .plans.layout-compact{
    grid-template-columns:
      repeat(2,minmax(0,1fr));
  }

  .plans.layout-circles{
    grid-template-columns:
      repeat(3,minmax(0,1fr));
  }

  .plans.layout-list .plan{
    grid-template-columns:
      78px 1fr auto;
  }
}


/* RECONNECT / VOUCHER */

.voucher{
  margin-top:72px;
  padding:0;
  text-align:center;
}

.voucher h2{
  margin:0;
  color:#eee;
  font-size:22px;
  font-weight:400;
}

.voucher h2::after{
  content:"\A\A(Enter your voucher code below to reconnect)";
  white-space:pre;
  color:#eee;
  font-size:15px;
  line-height:1.55;
}

.field{
  width:90%;
  margin-top:25px;
  border:3px solid #ff1717;
  border-radius:6px;
  padding:17px 15px;
  background:#fff;
  color:#111;
  font-size:18px;
  outline:none;
}

.field:focus{
  border-color:var(--accent);
  box-shadow:
    0 0 0 4px #ffb22133;
}

.primary{
  width:90%;
  margin-top:15px;
  border:0;
  border-radius:8px;
  padding:16px;
  background:var(--accent);
  color:var(--accent-text);
  font-weight:900;
}

.support{
  display:flex;
  justify-content:center;
  gap:26px;
  margin-top:40px;
  padding:20px 0;
  background:transparent;
  color:#999;
}

.support a{
  color:#aaa;
  font-size:13px;
  font-weight:700;
  text-decoration:none;
}


/* M-PESA */

.modal{
  position:fixed;
  inset:0;
  z-index:100;
  display:none;
  align-items:flex-end;
  justify-content:center;
  padding:13px;
  background:#000c;
}

.modal.open{
  display:flex;
}

.dialog{
  width:100%;
  max-width:430px;
  border:
    1px solid
    #303030;
  border-radius:
    25px
    25px
    12px
    12px;
  padding:24px;
  background:#111;
  color:#fff;
  box-shadow:
    0 -16px 50px #000;
}

.dialog-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:15px;
}

.dialog h2{
  margin:0;
  color:#fff;
}

.dialog-price{
  margin-top:6px;
  color:var(--accent);
  font-size:30px;
  font-weight:900;
}

.close{
  width:40px;
  height:40px;
  border:0;
  border-radius:50%;
  background:#282828;
  color:#fff;
  font-size:24px;
}

.dialog .field{
  width:100%;
  margin-top:20px;
}

.dialog .primary{
  width:100%;
}

.notice{
  display:none;
  margin-top:14px;
  border-radius:10px;
  padding:13px;
  background:#241b05;
  color:#ffce65;
  font-size:13px;
  font-weight:700;
  line-height:1.5;
}

.notice.show{
  display:block;
}

.empty{
  grid-column:1/-1;
  padding:35px;
  color:#aaa;
  text-align:center;
}

.ready{
  position:fixed;
  right:8px;
  bottom:8px;
  z-index:120;
  padding:5px 8px;
  border-radius:999px;
  background:#121212d9;
  color:#777;
  font-size:8px;
}


/* SMALL PHONES */

@media(max-width:390px){
  .shell{
    padding-left:10px;
    padding-right:10px;
  }

  .hero{
    min-height:500px;
  }

  .plan{
    min-height:165px;
    border-radius:16px;
  }

  .plan-duration b{
    font-size:21px;
  }

  .price{
    font-size:17px;
  }

  .plans{
    gap:10px;
  }
}
</style>
</head>
<body>
<meta id="ctx-mac" content="$(mac)">
<meta id="ctx-ip" content="$(ip)">
<meta id="ctx-login" content="$(link-login-only)">
<meta id="ctx-origin" content="$(link-orig)">

<main class="shell">
  <section id="hero" class="hero">

    <img id="portrait-art" class="portrait-art" alt="" aria-hidden="true">
    <div id="portrait-isp-name" class="portrait-isp-name"></div>
    <div class="hero-person"></div>

    <div class="brand">
      <div
        id="brand"
        class="brand-logo"
      >
        Nexa
      </div>

      <span class="brand-word">
        hotspot
      </span>
    </div>

    <div class="hero-copy">

      <div class="hero-contact">
        For inquiries contact

        <strong id="hero-phone">
          Internet Support
        </strong>
      </div>

      <div
        class="hero-qr"
        aria-hidden="true"
      ></div>

    </div>

    <p
      id="tagline"
      style="display:none"
    >
      Fast Internet
    </p>

  </section>

  <section
    id="wallet-card"
    class="wallet-card"
  >
    <small id="wallet-label">
      MY WALLET
    </small>

    <b id="wallet-balance">
      KSh 0
    </b>
  </section>

  <section class="content">
    <div class="panel">
      <div class="heading">
        <h2>Internet packages</h2>
        <p>Tap a package to pay securely through M-Pesa.</p>
      </div>

      <div id="plans" class="plans"></div>
    </div>

    <div id="voucher-panel" class="panel voucher">
      <h2>Voucher login</h2>

      <form
        id="voucher-form"
        method="post"
        action="$(link-login-only)"
      >
        <input
          id="voucher-code"
          class="field"
          name="username"
          autocomplete="username"
          placeholder="Voucher code"
          required
        >

        <input
          id="voucher-password"
          type="hidden"
          name="password"
        >

        <input
          type="hidden"
          name="dst"
          value="$(link-orig)"
        >

        <button class="primary">
          Connect with voucher
        </button>
      </form>
    </div>

    <div id="support-panel" class="support">
      <a id="support-call" href="#">Support</a>
      <a id="support-whatsapp" href="#">WhatsApp</a>
    </div>
  </section>
</main>

<div id="payment-modal" class="modal">
  <div class="dialog">
    <div class="dialog-head">
      <div>
        <h2 id="payment-plan">Package</h2>
        <div
          id="payment-price"
          class="dialog-price"
        >
          KSh 0
        </div>
      </div>

      <button
        id="payment-close"
        type="button"
        class="close"
      >
        ×
      </button>
    </div>

    <form id="payment-form">
      <input
        id="payment-phone"
        class="field"
        type="tel"
        inputmode="numeric"
        autocomplete="tel"
        placeholder="0712 345 678"
        required
      >

      <div
        id="payment-notice"
        class="notice"
      ></div>

      <button
        id="payment-button"
        class="primary"
      >
        Send M-Pesa prompt
      </button>
    </form>
  </div>
</div>

<div id="ready-speed" class="ready">
  LOCAL EDGE
</div>

<script>
(function(){
"use strict";

var PAGE_START =
  performance.now();

var EMBEDDED =
  ${embedded};

var PORTAL_TOKEN =
  ${token};

var API_BASE =
  ${apiBase};

var API_ORIGIN =
  ${apiOrigin};

var PORTRAIT_ASSET_URL =
  ${portraitAsset};

var MAC =
  document
    .getElementById("ctx-mac")
    .getAttribute("content") || "";

var IP =
  document
    .getElementById("ctx-ip")
    .getAttribute("content") || "";

var LOGIN_URL =
  document
    .getElementById("ctx-login")
    .getAttribute("content") || "";

var ORIGIN =
  document
    .getElementById("ctx-origin")
    .getAttribute("content") || "";

var currentConfig =
  EMBEDDED;

var selectedPlan =
  null;

var pollTimer =
  null;

function byId(id){
  return document.getElementById(id);
}

function money(value){
  return Number(
    value || 0
  ).toLocaleString() +
  "/-";
}

function normalizePhone(value){
  var phone =
    String(value || "")
      .replace(/\\D/g,"");

  if(phone.charAt(0)==="0"){
    phone =
      "254" +
      phone.slice(1);
  }

  if(
    phone.charAt(0)==="7" ||
    phone.charAt(0)==="1"
  ){
    phone =
      "254" +
      phone;
  }

  return phone;
}

function duration(minutes){
  var amount =
    Number(minutes || 0);

  if(
    amount >= 43200 &&
    amount % 43200 === 0
  ){
    var months =
      amount / 43200;

    return {
      value:
        months === 1
          ? "Monthly"
          : months + " Months",

      unit:""
    };
  }

  if(
    amount === 10080
  ){
    return {
      value:"Weekly",
      unit:""
    };
  }

  if(
    amount >= 1440 &&
    amount % 1440 === 0
  ){
    var days =
      amount / 1440;

    return {
      value:
        days === 7
          ? "Weekly"
          : days + " days",

      unit:""
    };
  }

  if(
    amount >= 60 &&
    amount % 60 === 0
  ){
    var hours =
      amount / 60;

    return {
      value:
        hours + "hours",

      unit:""
    };
  }

  return {
    value:
      amount + "mins",

    unit:""
  };
}

function headline(plan){
  var rate =
    String(
      plan.mikrotik_rate_limit ||
      ""
    );

  var match =
    rate.match(
      /(\\d+(?:\\.\\d+)?)\\s*[mM]/
    );

  return match
    ? match[1] + " Mbps"
    : plan.name ||
      "Internet package";
}

function effectivePrice(plan){
  var offer =
    currentConfig.flash_offer;

  if(
    offer &&
    Number(offer.plan_id) ===
      Number(plan.id) &&
    Date.parse(
      offer.ends_at || ""
    ) > Date.now() &&
    (
      !offer.starts_at ||
      Date.parse(
        offer.starts_at
      ) <= Date.now()
    )
  ){
    return Number(
      offer.discount_price
    );
  }

  return Number(
    plan.price || 0
  );
}

function render(config){
  currentConfig =
    config || EMBEDDED;

  var portal =
    currentConfig.portal ||
    {};

  var accent =
    /^#[0-9A-Fa-f]{6}$/
      .test(
        String(
          portal.accent_color ||
          ""
        )
      )
      ? portal.accent_color
      : "#ffb221";

  document.documentElement
    .style
    .setProperty(
      "--accent",
      accent
    );

  var layout =
    [
      "featured",
      "grid2",
      "compact",
      "list",
      "circles"
    ].indexOf(
      String(
        portal.package_layout ||
        ""
      )
    ) >= 0
      ? String(
          portal.package_layout
        )
      : "featured";

  var plansNode =
    byId("plans");

  plansNode.className =
    "plans layout-" +
    layout;

  var walletCard =
    byId(
      "wallet-card"
    );

  if(walletCard){
    walletCard.style.display =
      portal.wallet_enabled === false
        ? "none"
        : "block";

    byId(
      "wallet-label"
    ).textContent =
      portal.wallet_label ||
      "MY WALLET";

    byId(
      "wallet-balance"
    ).textContent =
      "KSh " +
      Number(
        portal.wallet_balance ||
        0
      ).toLocaleString();
  }

  var voucherPanel =
    byId(
      "voucher-panel"
    );

  if(voucherPanel){
    voucherPanel.style.display =
      portal.show_voucher_login === false
        ? "none"
        : "block";
  }

  var supportPanel =
    byId(
      "support-panel"
    );

  if(supportPanel){
    supportPanel.style.display =
      (
        portal.show_support === false &&
        portal.show_whatsapp === false
      )
        ? "none"
        : "flex";
  }

  var hero =
    byId(
      "hero"
    );

  var themeMap = {
    blue:[
      "#061a55",
      "#073bc7"
    ],

    dark:[
      "#050505",
      "#202020"
    ],

    orange:[
      "#211005",
      "#a64b05"
    ],

    green:[
      "#022c22",
      "#047857"
    ],

    purple:[
      "#2e1065",
      "#6d28d9"
    ]
  };

  var theme =
    themeMap[
      portal.theme_preset
    ] ||
    themeMap.orange;

  if(hero){
    if(
      portal.background_image_enabled
    ){
      var overlay =
        Math.max(
          0,
          Math.min(
            85,
            Number(
              portal.background_overlay ||
              46
            )
          )
        ) / 100;

      var backgroundUrl =
        API_BASE +
        "/theme-background?portalToken=" +
        encodeURIComponent(
          PORTAL_TOKEN
        ) +
        "&v=" +
        encodeURIComponent(
          portal.background_image_version ||
          ""
        );

      hero.style.backgroundImage =
        "linear-gradient(rgba(0,0,0," +
        overlay +
        "),rgba(0,0,0," +
        overlay +
        ")),url('" +
        backgroundUrl +
        "')";

      hero.style.backgroundSize =
        "cover";

      hero.style.backgroundPosition =
        "center";
    }else{
      hero.style.background =
        "linear-gradient(145deg," +
        theme[0] +
        "," +
        theme[1] +
        ")";
    }
  }

  var brand =
    currentConfig.portal &&
    currentConfig.portal
      .brand_name ||
    currentConfig.client &&
    currentConfig.client.name ||
    "Nexa";

  byId("brand")
    .textContent =
      brand;

  var portraitArt = byId("portrait-art");
  var portraitName = byId("portrait-isp-name");
  if(hero && portal.design_template === "green_portrait"){
    hero.classList.add("green-portrait");
    if(portraitArt) portraitArt.src = PORTRAIT_ASSET_URL;
    if(portraitName) portraitName.textContent = brand;
  }else if(hero){
    hero.classList.remove("green-portrait");
  }

  byId("tagline")
    .textContent =
      currentConfig.portal &&
      currentConfig.portal
        .tagline ||
      "Choose a package and connect instantly.";

  document.title =
    brand + " Hotspot";

  var support =
    currentConfig.support ||
    {};

  var phone =
    String(
      support.phone || ""
    );

  var whatsapp =
    String(
      support.whatsapp ||
      phone
    ).replace(/\\D/g,"");

  var supportCall =
    byId("support-call");

  supportCall.textContent =
    phone || "Support";

  var heroPhone =
    byId("hero-phone");

  if(heroPhone){
    heroPhone.textContent =
      phone ||
      "Internet Support";
  }

  supportCall.href =
    phone
      ? "tel:" + phone
      : "#";

  supportCall.style.display =
    currentConfig.portal &&
    currentConfig.portal
      .show_support === false
      ? "none"
      : "inline";

  var supportWhatsapp =
    byId(
      "support-whatsapp"
    );

  supportWhatsapp.href =
    whatsapp
      ? "https://wa.me/" +
        whatsapp
      : "#";

  supportWhatsapp.style.display =
    currentConfig.portal &&
    currentConfig.portal
      .show_whatsapp === false
      ? "none"
      : "inline";

  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>\"']/g,function(character){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[character];
    });
  }

  var container =
    byId("plans");

  container.innerHTML = "";

  var plans =
    Array.isArray(
      currentConfig.plans
    )
      ? currentConfig.plans
      : [];

  if(!plans.length){
    container.innerHTML =
      '<div class="empty">No packages are currently available.</div>';

    return;
  }

  plans.forEach(
    function(plan,index){
      var time =
        duration(
          plan.duration_minutes
        );

      var button =
        document.createElement(
          "button"
        );

      button.type =
        "button";

      button.className =
        "plan";

      var offer =
        currentConfig.flash_offer;

      var flash =
        offer &&
        Number(offer.plan_id) ===
          Number(plan.id) &&
        Date.parse(
          offer.ends_at || ""
        ) > Date.now();

      if(flash){
        button.className +=
          " flash";
      }

      var main =
        '<div class="plan-duration">' +
          '<div><b>' +
            escapeHtml(time.value) +
          '</b><small>' +
            escapeHtml(time.unit) +
          '</small></div>' +
        '</div>' +
        '<div class="plan-main">' +
          (
            flash
              ? '<span class="badge">Flash offer</span>'
              : ''
          ) +
          '<b>' +
            escapeHtml(headline(plan)) +
          '</b>' +
          '<small>' +
            (
              plan.data_limit_mb
                ? Number(
                    plan.data_limit_mb
                  ).toLocaleString() +
                  " MB included"
                : escapeHtml(plan.name ||
                  "High speed internet")
            ) +
          '</small>' +
        '</div>' +
        '<div class="price">' +
          escapeHtml(money(
            effectivePrice(plan)
          )) +
        '</div>';

      button.innerHTML =
        main;

      button.addEventListener(
        "click",
        function(){
          openPayment(plan);
        }
      );

      container.appendChild(
        button
      );
    }
  );
}

function setNotice(
  message,
  type
){
  var notice =
    byId("payment-notice");

  notice.textContent =
    message || "";

  notice.className =
    message
      ? "notice show"
      : "notice";

  if(type==="error"){
    notice.style.background =
      "#fff0f2";

    notice.style.color =
      "#b42336";
  }else{
    notice.style.background =
      "#fff7dd";

    notice.style.color =
      "#9a6700";
  }
}

function openPayment(plan){
  if(
    !currentConfig.payments ||
    !currentConfig.payments.enabled
  ){
    alert(
      "M-Pesa checkout is not enabled. Contact support."
    );

    return;
  }

  selectedPlan =
    plan;

  byId("payment-plan")
    .textContent =
      plan.name ||
      "Internet package";

  byId("payment-price")
    .textContent =
      money(
        effectivePrice(plan)
      );

  setNotice("");

  byId("payment-modal")
    .classList.add("open");

  window.setTimeout(
    function(){
      byId("payment-phone")
        .focus();
    },
    80
  );
}

function closePayment(){
  if(pollTimer){
    window.clearTimeout(
      pollTimer
    );

    pollTimer = null;
  }

  byId("payment-modal")
    .classList.remove("open");
}

function pollPayment(reference){
  fetch(
    API_BASE +
    "/checkout/" +
    encodeURIComponent(
      reference
    ) +
    "?portalToken=" +
    encodeURIComponent(
      PORTAL_TOKEN
    ),
    {
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store"
    }
  )
    .then(function(response){
      return response
        .json()
        .then(function(data){
          if(!response.ok){
            throw new Error(
              data.error ||
              "Payment confirmation failed"
            );
          }

          return data;
        });
    })
    .then(function(data){
      if(
        data.status ===
        "active"
      ){
        setNotice(
          "Payment confirmed. Connecting your device…"
        );

        window.setTimeout(
          function(){
            window.location.replace(
              ORIGIN ||
              "http://neverssl.com/"
            );
          },
          450
        );

        return;
      }

      if(
        data.status ===
        "failed"
      ){
        setNotice(
          data.error ||
          "The payment was not completed.",
          "error"
        );

        byId(
          "payment-button"
        ).disabled = false;

        return;
      }

      setNotice(
        data.message ||
        "Waiting for M-Pesa confirmation…"
      );

      pollTimer =
        window.setTimeout(
          function(){
            pollPayment(reference);
          },
          1500
        );
    })
    .catch(function(){
      setNotice(
        "Still waiting for payment confirmation…"
      );

      pollTimer =
        window.setTimeout(
          function(){
            pollPayment(reference);
          },
          1800
        );
    });
}

byId("payment-close")
  .addEventListener(
    "click",
    closePayment
  );

byId("payment-modal")
  .addEventListener(
    "click",
    function(event){
      if(
        event.target ===
        byId("payment-modal")
      ){
        closePayment();
      }
    }
  );

byId("payment-form")
  .addEventListener(
    "submit",
    function(event){
      event.preventDefault();

      if(!selectedPlan){
        return;
      }

      var phone =
        normalizePhone(
          byId(
            "payment-phone"
          ).value
        );

      if(
        !/^254[17]\\d{8}$/
          .test(phone)
      ){
        setNotice(
          "Enter a valid Safaricom M-Pesa number.",
          "error"
        );

        return;
      }

      var button =
        byId("payment-button");

      button.disabled =
        true;

      setNotice(
        "Sending M-Pesa prompt…"
      );

      try{
        localStorage.setItem(
          "nexa-hotspot-mpesa-phone",
          phone
        );
      }catch(error){}

      /*
       * Use a CORS-simple form request.
       * application/json causes an OPTIONS
       * preflight, which captive portals can
       * block before authentication.
       */
      var checkoutBody =
        new URLSearchParams();

      checkoutBody.set(
        "portal_token",
        PORTAL_TOKEN
      );

      checkoutBody.set(
        "plan_id",
        String(
          selectedPlan.id
        )
      );

      checkoutBody.set(
        "phone",
        phone
      );

      checkoutBody.set(
        "mac",
        MAC
      );

      checkoutBody.set(
        "ip",
        IP
      );

      fetch(
        API_BASE +
        "/checkout",
        {
          method:"POST",
          mode:"cors",
          credentials:"omit",
          cache:"no-store",

          headers:{
            "Accept":
              "application/json"
          },

          body:
            checkoutBody
        }
      )
        .then(function(response){
          return response
            .json()
            .then(function(data){
              if(!response.ok){
                throw new Error(
                  data.error ||
                  "Could not send M-Pesa prompt"
                );
              }

              return data;
            });
        })
        .then(function(data){
          setNotice(
            "M-Pesa prompt sent. Enter your PIN."
          );

          pollPayment(
            data.reference
          );
        })
        .catch(function(error){
          button.disabled =
            false;

          setNotice(
            error.message,
            "error"
          );
        });
    }
  );

byId("voucher-form")
  .addEventListener(
    "submit",
    function(){
      var code =
        byId("voucher-code")
          .value
          .trim()
          .toUpperCase();

      byId("voucher-code")
        .value =
          code;

      byId("voucher-password")
        .value =
          code;
    }
  );

try{
  var savedPhone =
    localStorage.getItem(
      "nexa-hotspot-mpesa-phone"
    );

  if(savedPhone){
    byId("payment-phone")
      .value =
        savedPhone;
  }
}catch(error){}

render(EMBEDDED);

requestAnimationFrame(
  function(){
    var elapsed =
      Math.round(
        performance.now() -
        PAGE_START
      );

    byId("ready-speed")
      .textContent =
        "READY " +
        elapsed +
        " ms";
  }
);

function refreshConfig(){
  fetch(
    API_BASE +
    "/config?portalToken=" +
    encodeURIComponent(
      PORTAL_TOKEN
    ),
    {
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store"
    }
  )
    .then(function(response){
      if(!response.ok){
        throw new Error(
          "Configuration refresh failed"
        );
      }

      return response.json();
    })
    .then(function(data){
      render(data);
    })
    .catch(function(){
      /* Embedded configuration remains usable. */
    });
}

window.addEventListener(
  "load",
  function(){
    window.setTimeout(
      refreshConfig,
      5000
    );
  },
  {
    once:true
  }
);
})();
</script>
</body>
</html>`;
}

function normalizeRouterFilePath(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function routerFileSize(value) {
  const text =
    String(value || '')
      .trim();

  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  const match =
    text.match(
      /^([\d.]+)\s*(B|KiB|KB|MiB|MB)$/i
    );

  if (!match) {
    return 0;
  }

  const amount =
    Number(match[1]);

  const unit =
    match[2]
      .toUpperCase();

  if (unit === 'B') {
    return amount;
  }

  if (
    unit === 'KIB' ||
    unit === 'KB'
  ) {
    return Math.round(
      amount * 1024
    );
  }

  if (
    unit === 'MIB' ||
    unit === 'MB'
  ) {
    return Math.round(
      amount * 1024 * 1024
    );
  }

  return 0;
}

function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(
      resolve,
      milliseconds
    );
  });
}

async function printRouterFiles(client) {
  return rows(
    await client.command(
      '/file/print'
    )
  );
}

function findRouterFile(
  files,
  expectedPath
) {
  const normalizedExpected =
    normalizeRouterFilePath(
      expectedPath
    );

  return files.find(
    file =>
      normalizeRouterFilePath(
        file.name
      ) === normalizedExpected
  );
}

async function waitForRouterFile({
  client,
  path,
  minimumSize = null,
  timeoutMs = 45000,
}) {
  const startedAt =
    Date.now();

  while (
    Date.now() - startedAt <
    timeoutMs
  ) {
    const files =
      await printRouterFiles(
        client
      );

    const file =
      findRouterFile(
        files,
        path
      );

    if (
      file &&
      (
        minimumSize === null ||
        routerFileSize(
          file.size
        ) >= minimumSize
      )
    ) {
      return file;
    }

    await delay(500);
  }

  throw new Error(
    minimumSize === null
      ? `RouterOS did not create ${path}`
      : `RouterOS did not finish writing ${path}`
  );
}

async function removeRouterFile(
  client,
  path
) {
  const files =
    await printRouterFiles(
      client
    );

  const file =
    findRouterFile(
      files,
      path
    );

  if (
    file &&
    rowId(file)
  ) {
    await client.command(
      '/file/remove',
      {
        '.id':
          rowId(file),
      }
    );
  }
}

async function detectHotspotDirectory(
  client
) {
  const files =
    await printRouterFiles(
      client
    );

  const names =
    files.map(file =>
      normalizeRouterFilePath(
        file.name
      )
    );

  const hasFlash =
    names.some(
      name =>
        name === 'flash' ||
        name.startsWith(
          'flash/'
        )
    );

  return hasFlash
    ? 'flash/nexa-hotspot'
    : 'nexa-hotspot';
}

async function ensureRouterDirectory(
  client,
  directoryPath
) {
  const normalized =
    normalizeRouterFilePath(
      directoryPath
    );

  let files =
    await printRouterFiles(
      client
    );

  let directory =
    findRouterFile(
      files,
      normalized
    );

  if (directory) {
    return directory;
  }

  await client.command(
    '/file/add',
    {
      name:
        `/${normalized}`,

      type:
        'directory',
    }
  );

  directory =
    await waitForRouterFile({
      client,
      path:
        normalized,
      timeoutMs:
        15000,
  });

  return directory;
}

async function writeRouterFile({
  client,
  path,
  contents,
}) {
  const normalized =
    normalizeRouterFilePath(
      path
    );

  const expectedBytes =
    Buffer.byteLength(
      contents,
      'utf8'
    );

  if (expectedBytes > 60000) {
    throw new Error(
      `${normalized} exceeds the RouterOS editable file limit`
    );
  }

  await removeRouterFile(
    client,
    normalized
  );

  await client.command(
    '/file/add',
    {
      name:
        `/${normalized}`,

      type:
        'file',
    }
  );

  const created =
    await waitForRouterFile({
      client,
      path:
        normalized,
      timeoutMs:
        15000,
    });

  if (!rowId(created)) {
    throw new Error(
      `RouterOS created ${normalized} without a file ID`
    );
  }

  await client.command(
    '/file/set',
    {
      '.id':
        rowId(created),

      contents,
    }
  );

  const completed =
    await waitForRouterFile({
      client,
      path:
        normalized,

      minimumSize:
        expectedBytes,

      timeoutMs:
        45000,
    });

  return {
    name:
      normalizeRouterFilePath(
        completed.name
      ),

    size:
      routerFileSize(
        completed.size
      ),

    expected_size:
      expectedBytes,
  };
}

function buildHostedPortalBootstrap({
  bootstrapToken,
}) {
  const hostedPortal =
    `${API_BASE}/bootstrap?bootstrapToken=${encodeURIComponent(bootstrapToken || '')}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="cache-control" content="no-store">
  <title>Connecting…</title>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06140e;color:#fff;font:600 16px system-ui,sans-serif}.card{padding:24px;text-align:center}a{color:#78e7ad}</style>
</head>
<body>
  <div class="card">Opening your hotspot portal…<noscript><p><a id="portal-link" href="#">Open portal</a></p></noscript></div>
  <script>
    (function(){
      var target=${JSON.stringify(hostedPortal)};
      var query={
        mac:"$(mac)",
        ip:"$(ip)",
        "link-login-only":"$(link-login-only)",
        "link-orig":"$(link-orig)"
      };
      Object.keys(query).forEach(function(key){
        if(query[key]) target += "&"+encodeURIComponent(key)+"="+encodeURIComponent(query[key]);
      });
      var link=document.getElementById("portal-link");
      if(link) link.href=target;
      window.location.replace(target);
    })();
  </script>
</body>
</html>`;
}


async function replaceHotspotPortalFiles(
  client,
  edgeHtml,
  bootstrapToken
) {
  /*
   * The complete portal must be returned as the first
   * rlogin/login response. Android's captive browser keeps
   * the original connectivity-check hostname, so no relative
   * navigation is allowed.
   */
  const htmlDirectory =
    await detectHotspotDirectory(
      client
    );

  await ensureRouterDirectory(
    client,
    htmlDirectory
  );

  // The hosted portal is the authoritative visual renderer.
  // Keep edge.html as a local fallback, but only replace the entry pages.
  const fullPortalNames = [
    'login.html',
    'rlogin.html',
    'flogin.html',
  ];

  const auxiliaryContents = {
    'redirect.html':
      hotspotRedirectResponse(),

    'alogin.html':
      hotspotRedirectResponse(),

    'api.json':
      hotspotApiDocument(),
  };

  /*
   * Remove stale copies from both the RAM-root and
   * persistent flash directory before installing.
   */
  const possibleDirectories =
    new Set([
      'nexa-hotspot',
      'flash/nexa-hotspot',
      htmlDirectory,
    ]);

  const allNames = [
    ...fullPortalNames,
    ...Object.keys(
      auxiliaryContents
    ),
  ];

  for (
    const directory
    of possibleDirectories
  ) {
    for (
      const fileName
      of allNames
    ) {
      await removeRouterFile(
        client,
        `${directory}/${fileName}`
      );
    }
  }

  await ensureRouterDirectory(
    client,
    htmlDirectory
  );

  const writtenFiles = [];

  const hostedBootstrap =
    buildHostedPortalBootstrap({
      bootstrapToken,
    });

  for (
    const fileName
    of fullPortalNames
  ) {
    writtenFiles.push(
      await writeRouterFile({
        client,

        path:
          `${htmlDirectory}/${fileName}`,

        contents:
          hostedBootstrap,
      })
    );
  }

  for (
    const [
      fileName,
      contents,
    ]
    of Object.entries(
      auxiliaryContents
    )
  ) {
    writtenFiles.push(
      await writeRouterFile({
        client,

        path:
          `${htmlDirectory}/${fileName}`,

        contents,
      })
    );
  }

  const fullPortalFiles =
    fullPortalNames.map(
      fileName =>
        `${htmlDirectory}/${fileName}`
    );

  const managedFiles =
    allNames.map(
      fileName =>
        `${htmlDirectory}/${fileName}`
    );

  return {
    html_directory:
      htmlDirectory,

    edge_bytes:
      Buffer.byteLength(
        edgeHtml,
        'utf8'
      ),

    redirect_bytes:
      Buffer.byteLength(
        hotspotRedirectResponse(),
        'utf8'
      ),

    api_bytes:
      Buffer.byteLength(
        hotspotApiDocument(),
        'utf8'
      ),

    full_portal_files:
      fullPortalFiles,

    files:
      managedFiles,

    written_files:
      writtenFiles,
  };
}

async function loadEdgeRouter(
  clientId,
  routerId = null
) {
  const result =
    await db.query(
      `SELECT
         router.*,

         executor.username
           AS executor_username,

         executor.password_encrypted
           AS executor_password_encrypted

       FROM mikrotik_routers
         router

       JOIN network_router_executor_credentials
         executor
         ON executor.client_id =
              router.client_id
        AND executor.router_id =
              router.id

       WHERE router.client_id = $1
         AND router.is_active = TRUE
         AND executor.enabled = TRUE
         AND executor.verification_status =
               'verified'

       ORDER BY
         CASE
           WHEN router.id = $2
           THEN 0
           ELSE 1
         END,

         router.last_seen_at DESC
           NULLS LAST

       LIMIT 1`,
      [
        clientId,
        routerId || null,
      ]
    );

  return result.rows[0] ||
    null;
}

async function installHotspotEdgePortal({
  clientId,
  routerId = null,
}) {
  const router =
    await loadEdgeRouter(
      clientId,
      routerId
    );

  if (!router) {
    throw new Error(
      'Verified MikroTik executor was not found'
    );
  }

  const [
    edgeConfig,
    bootstrapToken,
    fallbackPortalToken,
  ] = await Promise.all([
    loadHotspotEdgeConfig(
      clientId
    ),

    Promise.resolve(
      createHotspotPortalBootstrapToken(
        clientId,
        Number(router.id)
      )
    ),

    Promise.resolve(
      createHotspotPortalToken(clientId, { routerId: Number(router.id), ttlSeconds: 600 })
    ),
  ]);

  const edgeHtml =
    buildHotspotEdgeHtml({
      portalToken: fallbackPortalToken,
      config:
        edgeConfig,
    });

  const client =
    await connectRouter({
      ...router,

      host:
        router.wireguard_tunnel_ip ||
        router.host,

      username:
        router.executor_username,

      password:
        decryptSecret(
          router.executor_password_encrypted
        ),
    });

  try {
    const install =
      await replaceHotspotPortalFiles(
        client,
        edgeHtml,
        bootstrapToken
      );

    const profiles =
      rows(
        await client.command(
          '/ip/hotspot/profile/print'
        )
      );

    const profile =
      profiles.find(
        item =>
          item.name ===
          'NEXA-HOTSPOT-PROFILE'
      );

    if (
      !profile ||
      !rowId(profile)
    ) {
      throw new Error(
        'NEXA Hotspot profile was not found'
      );
    }

    await client.command(
      '/ip/hotspot/profile/set',
      {
        '.id':
          rowId(profile),

        'html-directory':
          install.html_directory,
      }
    );

    const domain =
      new URL(
        API_ORIGIN
      ).hostname;

    const garden =
      rows(
        await client.command(
          '/ip/hotspot/walled-garden/print'
        )
      );

    const existingRule =
      garden.find(
        item =>
          item['dst-host'] ===
          domain
      );

    if (
      existingRule &&
      rowId(existingRule)
    ) {
      await client.command(
        '/ip/hotspot/walled-garden/set',
        {
          '.id':
            rowId(existingRule),

          action:
            'allow',

          disabled:
            'no',
        }
      );
    } else {
      await client.command(
        '/ip/hotspot/walled-garden/add',
        {
          'dst-host':
            domain,

          action:
            'allow',

          disabled:
            'no',
        }
      );
    }

    const portalPrefix =
      `${normalizeRouterFilePath(
        install.html_directory
      )}/`;

    const files =
      rows(
        await client.command(
          '/file/print'
        )
      ).filter(
        file =>
          normalizeRouterFilePath(
            file.name
          ).startsWith(
            portalPrefix
          )
      );

    return {
      status:
        'installed',

      router_id:
        router.id,

      router_name:
        router.name,

      ...install,

      router_files:
        files.map(
          file => ({
            name:
              file.name,

            size:
              routerFileSize(
                file.size
              ),
          })
        ),
    };
  } finally {
    client.close();
  }
}

module.exports = {
  buildHotspotEdgeHtml,
  installHotspotEdgePortal,
  loadHotspotEdgeConfig,
  replaceHotspotPortalFiles,
};
