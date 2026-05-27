import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'New customer message', body: event.data?.text() || '' };
  }

  const title = data.title || 'New customer message';
  const options = {
    body: data.body || 'Open the dashboard to reply.',
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/pwa-192x192.png',
    tag: data.tag || 'nexa-message',
    data: { url: data.url || '/dashboard/conversations' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/dashboard/conversations', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(targetUrl);
        return undefined;
      }
    }
    return clients.openWindow(targetUrl);
  })());
});
