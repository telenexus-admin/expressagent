// One-release cleanup worker for browsers that were previously controlled by
// the PWA cache. It removes itself and all old caches as soon as the browser
// checks for an update, returning the billing workspace to normal HTTP loading.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => undefined)));
  })());
});
