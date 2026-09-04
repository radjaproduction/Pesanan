/* RADJA Production — Service Worker (Robust Multi-Tab Update Handler) */
const CACHE_VERSION = 'radja-pwa-v9.3';
const RUNTIME_CACHE = 'radja-runtime-v9.3'; // Cache untuk dynamic content
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-72.png',
  './icon-96.png',
  './icon-128.png',
  './icon-144.png',
  './icon-152.png',
  './icon-180.png',
  './icon-192.png',
  './icon-256.png',
  './icon-384.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install event — caching app shell');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[SW] Cache fail:', err))
  );
  self.skipWaiting(); // Langsung aktif tanpa tunggu tab lama ditutup
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event — cleanup old caches');
  event.waitUntil(
    // Hapus SEMUA cache lama (tidak hanya beda versi)
    caches.keys()
      .then((keys) => {
        const toDelete = keys.filter((k) => k !== CACHE_VERSION && k !== RUNTIME_CACHE);
        console.log('[SW] Deleting old caches:', toDelete);
        return Promise.all(toDelete.map((k) => caches.delete(k)));
      })
      .then(() => {
        // Beritahu ALL client ada update available
        return self.clients.matchAll({ type: 'window' })
          .then((clients) => {
            if (clients.length > 0) {
              console.log('[SW] Broadcasting UPDATE_AVAILABLE to', clients.length, 'clients');
              clients.forEach((client) => {
                client.postMessage({ 
                  type: 'UPDATE_AVAILABLE',
                  timestamp: Date.now(),
                  version: CACHE_VERSION
                });
              });
            }
          });
      })
  );
  self.clients.claim(); // Langsung kontrol semua client existing
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Hanya handle GET dari origin sendiri
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Manifest: selalu coba fetch fresh, fallback ke cache (utk offline)
  if (url.pathname === '/manifest.json') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req) || new Response('{}', { status: 503 }))
    );
    return;
  }

  // Navigasi (page): network-first dengan timeout, fallback ke cache
  if (req.mode === 'navigate') {
    event.respondWith(
      Promise.race([
        fetch(req, { cache: 'no-store' }).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        }),
        new Promise((resolve) => setTimeout(resolve, 5000)) // 5s timeout
      ])
        .catch(() => caches.match(req))
        .then((res) => res || caches.match('./index.html'))
    );
    return;
  }

  // Aset statis: cache-first, update di background
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch((err) => {
          console.warn('[SW] Fetch failed for', url.pathname, err);
          return cached;
        });
      
      return cached || fetchPromise;
    })
  );
});
