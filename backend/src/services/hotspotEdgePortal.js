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
} = require('./hotspotPortalToken');

const API_ORIGIN =
  process.env.PUBLIC_BACKEND_URL ||
  'https://nexa.telenexustechnologies.com';

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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#061a55">
<meta http-equiv="Cache-Control" content="no-store">
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; connect-src ${API_ORIGIN}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self' http: https:;"
>
<title>Hotspot Packages</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#edf2fb;color:#101938}
button,input{font:inherit}
button{cursor:pointer}
.shell{width:100%;max-width:720px;min-height:100vh;margin:auto;background:#fbfcff}
.hero{padding:25px 20px 78px;background:radial-gradient(circle at 90% 10%,#148cff88,transparent 34%),linear-gradient(135deg,#061a55,#031243 52%,#073bc7);color:#fff}
.brand{display:flex;align-items:center;gap:12px}
.wifi{font-size:35px}
.brand b{font-size:21px;text-transform:uppercase}
.brand small{display:block;margin-top:4px;letter-spacing:.28em;color:#b9d8ff}
.hero h1{margin:38px 0 0;font-size:38px;line-height:1.02}
.hero h1 span{display:block;color:#24adff}
.hero p{margin:17px 0 0;max-width:420px;color:#d9eaff;line-height:1.6}
.content{position:relative;margin-top:-48px;padding:0 16px 28px}
.panel{background:#fff;border:1px solid #e2e8f0;border-radius:22px;box-shadow:0 14px 36px #1627521c}
.heading{padding:20px 20px 6px}
.heading h2{margin:0;font-size:17px}
.heading p{margin:7px 0 0;color:#64748b;font-size:13px}
.plans{padding:12px}
.plan{display:grid;grid-template-columns:88px 1fr auto;width:100%;margin:10px 0;padding:0;overflow:hidden;border:1px solid #dbe3f0;border-radius:16px;background:#fff;text-align:left}
.plan-duration{display:grid;place-items:center;min-height:88px;padding:10px;background:linear-gradient(145deg,#0781ff,#0645c4);color:#fff;text-align:center}
.plan-duration b{font-size:25px}
.plan-duration small{display:block;margin-top:4px;font-size:9px;font-weight:900}
.plan-main{min-width:0;padding:15px}
.plan-main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plan-main small{display:block;margin-top:7px;color:#64748b}
.price{display:flex;align-items:center;padding:14px;color:#075bd4;font-size:17px;font-weight:900;white-space:nowrap}
.flash{border-color:#ff236b;box-shadow:0 0 0 2px #ff236b18}
.badge{display:inline-block;margin-bottom:6px;border-radius:6px;background:#ff0b61;padding:4px 7px;color:#fff;font-size:9px;font-weight:900;text-transform:uppercase}
.voucher{margin-top:16px;padding:20px}
.voucher h2{margin:0;font-size:17px}
.field{width:100%;margin-top:12px;border:1px solid #b9c9e7;border-radius:12px;padding:14px;outline:none}
.field:focus{border-color:#0876f9;box-shadow:0 0 0 4px #0876f919}
.primary{width:100%;margin-top:13px;border:0;border-radius:12px;padding:14px;background:linear-gradient(90deg,#0876f9,#073cc9);color:#fff;font-weight:900}
.support{display:flex;justify-content:space-between;gap:10px;margin-top:16px;padding:17px 20px;border-radius:18px;background:#071b50;color:#fff}
.support a{color:#fff;text-decoration:none;font-size:13px;font-weight:800}
.modal{position:fixed;inset:0;z-index:50;display:none;align-items:flex-end;justify-content:center;padding:14px;background:#020617b8}
.modal.open{display:flex}
.dialog{width:100%;max-width:420px;border-radius:24px;background:#fff;padding:22px;box-shadow:0 30px 80px #0006}
.dialog-head{display:flex;justify-content:space-between;gap:15px}
.dialog h2{margin:0}
.dialog-price{margin-top:7px;color:#0871ee;font-size:28px;font-weight:900}
.close{width:38px;height:38px;border:0;border-radius:50%;background:#eef2f7;font-size:22px}
.notice{display:none;margin-top:13px;border-radius:11px;padding:12px;background:#fff7dd;color:#9a6700;font-size:13px;font-weight:700;line-height:1.45}
.notice.show{display:block}
.empty{padding:30px;text-align:center;color:#64748b}
.ready{position:fixed;right:10px;bottom:10px;z-index:10;border-radius:999px;background:#052a77dd;padding:6px 10px;color:#fff;font-size:9px;font-weight:900}
@media(min-width:560px){
.hero{padding:34px 38px 92px}
.content{padding:0 30px 36px}
.modal{align-items:center}
}
</style>
</head>
<body>
<meta id="ctx-mac" content="$(mac)">
<meta id="ctx-ip" content="$(ip)">
<meta id="ctx-login" content="$(link-login-only)">
<meta id="ctx-origin" content="$(link-orig)">

<main class="shell">
  <section class="hero">
    <div class="brand">
      <div class="wifi">◉</div>
      <div>
        <b id="brand">Nexa</b>
        <small>HOTSPOT</small>
      </div>
    </div>

    <h1>
      Fast Internet.
      <span>Everywhere.</span>
    </h1>

    <p id="tagline">
      Choose a package and connect instantly.
    </p>
  </section>

  <section class="content">
    <div class="panel">
      <div class="heading">
        <h2>Internet packages</h2>
        <p>Tap a package to pay securely through M-Pesa.</p>
      </div>

      <div id="plans" class="plans"></div>
    </div>

    <div class="panel voucher">
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

    <div class="support">
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
  return "KSh " +
    Number(value || 0)
      .toLocaleString();
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
    amount >= 1440 &&
    amount % 1440 === 0
  ){
    var days =
      amount / 1440;

    return {
      value:days,
      unit:days===1
        ? "DAY"
        : "DAYS"
    };
  }

  if(
    amount >= 60 &&
    amount % 60 === 0
  ){
    var hours =
      amount / 60;

    return {
      value:hours,
      unit:hours===1
        ? "HOUR"
        : "HOURS"
    };
  }

  return {
    value:amount,
    unit:amount===1
      ? "MIN"
      : "MINS"
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

  supportCall.href =
    phone
      ? "tel:" + phone
      : "#";

  var supportWhatsapp =
    byId(
      "support-whatsapp"
    );

  supportWhatsapp.href =
    whatsapp
      ? "https://wa.me/" +
        whatsapp
      : "#";

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
            time.value +
          '</b><small>' +
            time.unit +
          '</small></div>' +
        '</div>' +
        '<div class="plan-main">' +
          (
            flash
              ? '<span class="badge">Flash offer</span>'
              : ''
          ) +
          '<b>' +
            headline(plan) +
          '</b>' +
          '<small>' +
            (
              plan.data_limit_mb
                ? Number(
                    plan.data_limit_mb
                  ).toLocaleString() +
                  " MB included"
                : plan.name ||
                  "High speed internet"
            ) +
          '</small>' +
        '</div>' +
        '<div class="price">' +
          money(
            effectivePrice(plan)
          ) +
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

async function replaceHotspotPortalFiles(
  client,
  edgeHtml
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

  const fullPortalNames = [
    'edge.html',
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
          edgeHtml,
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
    portalToken,
  ] = await Promise.all([
    loadHotspotEdgeConfig(
      clientId
    ),

    Promise.resolve(
      createHotspotPortalToken(
        clientId
      )
    ),
  ]);

  const edgeHtml =
    buildHotspotEdgeHtml({
      portalToken,
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
        edgeHtml
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
