// DebtFree Dashboard — Service Worker
// v1.7.0 (Release E — Installment Loans)
// Bump CACHE_NAME when you want installed PWA clients to re-fetch cached assets.

const CACHE_NAME = 'debtfree-v9';
const CORE_ASSETS = [
  './',
  './dashboard.html',
  './manifest.webmanifest'
];

// Install — warm the cache with core assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_ASSETS).catch(function() {
        // Some entries may 404 in dev; fail open
        return cache.add('./dashboard.html').catch(function(){});
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) {
        if (name !== CACHE_NAME) return caches.delete(name);
      }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch — network-first for HTML (so updates propagate), cache-first for assets
self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html') ||
                 url.pathname.endsWith('.html');

  if (isHTML) {
    // Network-first for HTML
    event.respondWith(
      fetch(req).then(function(resp) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(req, copy); });
        return resp;
      }).catch(function() {
        return caches.match(req).then(function(r) {
          return r || caches.match('./dashboard.html');
        });
      })
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(resp) {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});
