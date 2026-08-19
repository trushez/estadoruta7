// Carretera Austral — service worker
// Purpose: make the app installable/launchable offline as a home-screen app.
// Strategy:
//   - App shell (HTML/CSS/JS/icons/manifest, same-origin): cache-first, refreshed
//     in the background on every fetch ("stale-while-revalidate").
//   - /api/* (reports, advisories) and cross-origin weather/map calls: always
//     go to the network. These are live data — caching them would show stale
//     road conditions, which defeats the point of the app. If offline, the
//     page's own JS already handles fetch failures gracefully.
//
// Bump CACHE_VERSION whenever shell assets change so old caches get cleared.
const CACHE_VERSION = 'v7';
const CACHE_NAME = 'carretera-austral-' + CACHE_VERSION;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // let POST/DELETE etc. pass straight through

  const url = new URL(req.url);

  // Live data: never cache. Just proxy to the network.
  if (isApiRequest(url)) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // Cross-origin (weather API, map tiles, fonts, leaflet CDN, etc.):
  // network-first, falling back to cache if we have one, else fail normally.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Same-origin app shell: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
