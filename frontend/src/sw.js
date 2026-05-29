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
  const actions = Array.isArray(data.actions)
    ? data.actions.slice(0, 2).map((item) => ({ action: item.action, title: item.title }))
    : [];
  const options = {
    body: data.body || 'Open the dashboard to reply.',
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/pwa-192x192.png',
    tag: data.tag || 'nexa-message',
    actions,
    data: {
      url: data.url || '/dashboard/conversations',
      actions: Array.isArray(data.actions) ? data.actions : [],
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/dashboard/conversations', self.location.origin).href;

  event.waitUntil((async () => {
    if (event.action === 'toggle_ai') {
      const action = (event.notification.data?.actions || []).find((item) => item.action === 'toggle_ai');
      if (action?.token) {
        try {
          const response = await fetch('/api/push/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'toggle_ai', token: action.token }),
          });
          if (response.ok) {
            const result = await response.json();
            if (result.scope === 'operator') {
              await self.registration.showNotification(
                result.ai_enabled ? 'Nexus AI turned on' : 'Nexus AI turned off',
                {
                  body: result.ai_enabled
                    ? 'Nexus can reply to this conversation again.'
                    : 'Nexus will wait for your manual reply.',
                  icon: '/nexus-pwa-192x192.png',
                  badge: '/nexus-pwa-192x192.png',
                  tag: `operator-conversation-action-${result.conversation_id}`,
                  data: { url: targetUrl },
                }
              );
              return undefined;
            }

            await self.registration.showNotification(
              result.status === 'human_takeover' ? 'AI agent turned off' : 'AI agent turned on',
              {
                body: result.status === 'human_takeover'
                  ? 'The customer will now wait for a human reply.'
                  : 'The AI agent can reply to this customer again.',
                icon: '/pwa-192x192.png',
                badge: '/pwa-192x192.png',
                tag: `conversation-action-${result.conversation_id}`,
                data: { url: targetUrl },
              }
            );
            return undefined;
          }
        } catch {
          // Fall through to opening the conversation if the quick action fails.
        }
      }
    }

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
