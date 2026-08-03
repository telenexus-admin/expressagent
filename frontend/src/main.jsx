import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

import { applyTheme } from './utils/theme';
import { mountSubscriberCrm } from './subscriberCrm';

applyTheme();
mountSubscriberCrm();

// A stale service worker can retain an older hashed route bundle after a
// deployment. Vite raises this event when that bundle can no longer be loaded;
// recover once automatically instead of leaving the application blank.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const retryKey = 'nexa-preload-retry-v3';
  if (!sessionStorage.getItem(retryKey)) {
    sessionStorage.setItem(retryKey, '1');
    const recover = async () => {
      const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.includes('workbox') || key.includes('precache') || key.includes('nexa')).map((key) => caches.delete(key)));
      }
      window.location.replace(`${window.location.pathname}?refresh=${Date.now()}`);
    };
    void recover();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

void (async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
})();
