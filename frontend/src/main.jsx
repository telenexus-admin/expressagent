import React from 'react';
import ReactDOM from 'react-dom/client';

import HotspotPortal from './pages/HotspotPortal.jsx';
import './index.css';

const rootElement =
  document.getElementById('root');

const hotspotPath =
  /^\/hotspot\/?$/.test(
    window.location.pathname
  );

function recoveryUrl() {
  const url =
    new URL(
      window.location.href
    );

  url.searchParams.set(
    'refresh',
    String(Date.now())
  );

  return url.toString();
}

window.addEventListener(
  'vite:preloadError',
  event => {
    event.preventDefault();

    const retryKey =
      'nexa-preload-retry-v4';

    if (
      sessionStorage.getItem(
        retryKey
      )
    ) {
      return;
    }

    sessionStorage.setItem(
      retryKey,
      '1'
    );

    window.location.replace(
      recoveryUrl()
    );
  }
);

function showFatalError(error) {
  console.error(
    'Nexa bootstrap failed:',
    error
  );

  rootElement.innerHTML = `
    <main style="
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:24px;
      background:#edf2fb;
      font-family:system-ui,sans-serif;
    ">
      <section style="
        width:100%;
        max-width:390px;
        padding:28px;
        border-radius:24px;
        background:white;
        text-align:center;
        box-shadow:0 20px 55px rgba(15,23,42,.14);
      ">
        <strong style="
          display:block;
          color:#101938;
          font-size:20px;
        ">
          Unable to open Nexa
        </strong>

        <p style="
          margin:10px 0 0;
          color:#64748b;
          line-height:1.6;
        ">
          Check the Wi-Fi connection and reload this page.
        </p>

        <button
          type="button"
          id="nexa-fatal-reload"
          style="
            width:100%;
            margin-top:20px;
            border:0;
            border-radius:13px;
            padding:14px;
            background:#086de9;
            color:white;
            font-weight:800;
          "
        >
          Reload
        </button>
      </section>
    </main>
  `;
  rootElement.querySelector('#nexa-fatal-reload')?.addEventListener('click', () => window.location.replace(recoveryUrl()));
}

function showDashboardLoader() {
  rootElement.innerHTML = `
    <main style="
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#f8fafc;
      font-family:system-ui,sans-serif;
      color:#64748b;
    ">
      Loading Nexa...
    </main>
  `;
}

async function cleanupLegacyRuntime() {
  const cleanupKey =
    'nexa-runtime-clean-v4';

  if (
    sessionStorage.getItem(
      cleanupKey
    )
  ) {
    return;
  }

  sessionStorage.setItem(
    cleanupKey,
    '1'
  );

  try {
    if (
      'serviceWorker' in navigator
    ) {
      const registrations =
        await navigator
          .serviceWorker
          .getRegistrations();

      await Promise.all(
        registrations.map(
          registration =>
            registration.unregister()
        )
      );
    }
  } catch (_) {
    // A legacy service worker must
    // never block application startup.
  }
}

function preloadHotspotHero() {
  if (document.querySelector('link[data-hotspot-hero-preload]')) return;

  const preload = document.createElement('link');
  preload.rel = 'preload';
  preload.as = 'image';
  preload.href = '/hotspot-templates/green-portrait-hotspot.webp?v=green-portrait-v1';
  preload.type = 'image/webp';
  preload.fetchPriority = 'high';
  preload.dataset.hotspotHeroPreload = 'true';
  document.head.appendChild(preload);
}

function showHotspotLoader() {
  rootElement.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#06140e;color:#d8f7e4;font:600 15px system-ui,sans-serif">
      Opening hotspot portal…
    </main>
  `;
}

async function mountDashboard() {
  showDashboardLoader();

  const [
    appModule,
    themeModule,
    crmModule,
  ] = await Promise.all([
    import('./App.jsx'),
    import('./utils/theme'),
    import('./subscriberCrm'),
  ]);

  themeModule.applyTheme?.();
  crmModule.mountSubscriberCrm?.();

  const App =
    appModule.default;

  ReactDOM
    .createRoot(rootElement)
    .render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

  void cleanupLegacyRuntime();
}

try {
  if (hotspotPath) {
    preloadHotspotHero();
    ReactDOM
      .createRoot(rootElement)
      .render(
        <HotspotPortal />
      );
  } else {
    void mountDashboard()
      .catch(showFatalError);
  }
} catch (error) {
  showFatalError(error);
}
