import React, { useEffect, useState } from 'react';
import api from '../utils/api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export default function PushNotificationsButton({ variant = 'dark' }) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let active = true;
    async function inspect() {
      if (!supported()) {
        if (active) {
          setReason('This browser does not support phone alerts.');
          setChecked(true);
        }
        return;
      }
      try {
        const { data } = await api.get('/push/public-key');
        if (!active) return;
        if (!data.enabled || !data.publicKey) {
          setReason('Phone alerts are not configured on this server.');
          setChecked(true);
          return;
        }
        setAvailable(true);
        const registration = await navigator.serviceWorker.ready;
        const current = await registration.pushManager.getSubscription();
        if (active) setEnabled(Boolean(current));
      } catch {
        if (active) {
          setReason('Phone alerts could not be checked.');
          setChecked(true);
        }
      } finally {
        if (active) setChecked(true);
      }
    }
    inspect();
    return () => { active = false; };
  }, []);

  const subscribe = async () => {
    if (!supported() || busy) return;
    setBusy(true);
    try {
      const { data } = await api.get('/push/public-key');
      if (!data.enabled || !data.publicKey) return;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
      await api.post('/push/subscribe', { subscription });
      setEnabled(true);
    } catch (err) {
      console.error('Push subscription failed:', err.message);
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    if (!supported() || busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEnabled(false);
    } catch (err) {
      console.error('Push unsubscribe failed:', err.message);
    } finally {
      setBusy(false);
    }
  };

  const light = variant === 'light';

  if (!checked) {
    return (
      <button
        type="button"
        disabled
        className={`mt-2 w-full rounded-2xl px-4 py-3 text-sm font-bold opacity-70 ${
          light ? 'bg-slate-100 text-slate-500' : 'bg-white/10 text-white/60'
        }`}
      >
        Checking Phone Alerts...
      </button>
    );
  }

  if (!available) {
    return (
      <button
        type="button"
        disabled
        className={`mt-2 w-full rounded-2xl px-4 py-3 text-sm font-bold opacity-75 ${
          light ? 'bg-slate-100 text-slate-500' : 'bg-white/10 text-white/60'
        }`}
        title={reason}
      >
        Phone Alerts Unavailable
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={enabled ? unsubscribe : subscribe}
      disabled={busy}
      className={`mt-2 w-full rounded-2xl px-4 py-3 text-sm font-bold transition disabled:opacity-60 ${
        enabled
          ? light
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100'
            : 'bg-emerald-500/20 text-emerald-50 hover:bg-emerald-500/30'
          : light
            ? 'bg-[#3535FF] text-white shadow-sm hover:bg-[#2828DD]'
            : 'bg-white/10 text-white/75 hover:bg-white/15 hover:text-white'
      }`}
    >
      {busy ? 'Updating...' : enabled ? 'Phone Alerts On' : 'Turn On Phone Alerts'}
    </button>
  );
}
