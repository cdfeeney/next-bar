// Next Bar service worker — minimal app-shell cache for PWA install
// eligibility on Chrome/Edge and offline fallback for the home route.
//
// Strategy: network-first for navigations, cache-fallback when offline.
// Static assets pass through to the browser cache.

const CACHE_NAME = 'next-bar-shell-v1';
const SHELL_URLS = ['/', '/quiz', '/where-next', '/tried', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// --- Web Push (P1, ships dark until VAPID keys land) ---------------------
//
// These handlers are inert until a push subscription exists — no VAPID
// keys are configured yet, so nothing can send. Defensive parsing: a
// malformed payload still shows a sane generic notification rather than
// throwing inside the SW.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload — fall through to defaults.
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Next Bar';
  const body =
    typeof payload.body === 'string'
      ? payload.body
      : 'Time for your next bar?';
  // Same-origin CONSTRAINT (DeepSeek review): a compromised sender must not
  // be able to deep-link users off-origin. client.navigate() is platform-
  // restricted to same-origin, but clients.openWindow() is NOT — so only an
  // absolute path ('/x', never '//host' or a full URL) is accepted.
  const url =
    typeof payload.url === 'string' && /^\/(?!\/)/.test(payload.url)
      ? payload.url
      : '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof payload.tag === 'string' ? payload.tag : 'next-bar',
      icon: '/icon',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Re-validate on the click side too — notification.data is attacker-
  // influenced through the same payload; both sinks stay same-origin.
  const stored =
    (event.notification.data && event.notification.data.url) || '/';
  const url = /^\/(?!\/)/.test(stored) ? stored : '/';

  // Focus an existing app window if one is open; otherwise open one.
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            client.navigate(url).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
      .catch(() => {}),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (tile servers, fonts) — let the browser handle.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations; fall back to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/'))),
    );
    return;
  }

  // Stale-while-revalidate for everything else from our origin.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        }),
    ),
  );
});
