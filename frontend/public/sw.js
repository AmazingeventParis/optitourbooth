// OptiTour Booth - Service Worker for Push Notifications + PWA Install

// Fetch handler - required for PWA install prompt
self.addEventListener('fetch', (event) => {
  // Network-first strategy: let the browser handle requests normally
  // This minimal handler satisfies Chrome's PWA installability requirement
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'OptiTour', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' },
    vibrate: [200, 100, 200],
    tag: 'optitour-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'OptiTour', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(url);
    })
  );
});
