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
