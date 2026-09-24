// DebtFree Dashboard — Service Worker
// v1.38.0 (plan months anchored to the current month; rolled-over minimums)
// CACHE_NAME tracks APP_VERSION in dashboard.html — bump both together on every
// release so installed PWA clients always re-fetch, and so you can tell at a
// glance which build a device has cached.

const CACHE_NAME = 'debtfree-1.49.2';
// v1.40.6 — './dashboard.html' resolved to /dashboard.html (this file sits at
// the repo root), which did not exist: every cache.addAll() rejected, the
// fallback cache.add() rejected too, and the app precached NOTHING. Runtime
// caching masked it, so offline worked for pages already visited and failed
// for anything else. The app is at /app/dashboard.html.
const CORE_ASSETS = [
  './',
  './app/dashboard.html',
  '/manifest.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_ASSETS).catch(function() {
        return cache.add('./dashboard.html').catch(function(){});
      });
    })
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // v1.35.0 — never cache Google identity or Drive traffic. The handler
  // below is cache-first for non-HTML GETs, which would pin the Drive
  // file-list response forever: after one backup the app would keep
  // seeing a stale answer about whether a backup exists. Fonts stay
  // cached (different host) so offline is unaffected.
  if (url.hostname === 'accounts.google.com' ||
      url.hostname === 'oauth2.googleapis.com' ||
      url.hostname === 'www.googleapis.com' ||
      url.hostname === 'apis.google.com') return;

  // v1.41.1 — never handle the dev build. app/dev.html is a generated
  // development copy (tools/make-dev.js) that exists only so in-progress work
  // can be opened on a real device; GitHub Pages serves only `main`, so a
  // feature branch cannot be. Two concrete problems this early return fixes:
  //
  //   1. The HTML branch below is network-first but it CACHES what it fetches,
  //      so every dev load pushed a development build into the production
  //      cache.
  //   2. Its offline fallback is caches.match('./app/dashboard.html') — a
  //      failed dev fetch would serve PRODUCTION html at the dev URL, which
  //      looks like the dev build silently reverting.
  //
  // Handing dev.html straight to the network also means the dev shim no longer
  // has to unregister this worker to protect itself, which used to leave the
  // real PWA without offline support until the app was next opened online.
  if (url.pathname.endsWith('/dev.html')) return;

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html') ||
                 url.pathname.endsWith('.html');

  if (isHTML) {
    event.respondWith(
      fetch(req).then(function(resp) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(req, copy); });
        return resp;
      }).catch(function() {
        return caches.match(req).then(function(r) {
          return r || caches.match('./app/dashboard.html');
        });
      })
    );
    return;
  }

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
