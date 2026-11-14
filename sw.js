// DebtFree Dashboard — Service Worker
// v1.38.0 (plan months anchored to the current month; rolled-over minimums)
// CACHE_NAME tracks APP_VERSION in dashboard.html — bump both together on every
// release so installed PWA clients always re-fetch, and so you can tell at a
// glance which build a device has cached.

const CACHE_NAME = 'debtfree-1.70.0';
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
        // v1.68.0 — the reminder state is the app's, not a version cache.
        if (name !== CACHE_NAME && name !== 'debtfree-reminder-state') return caches.delete(name);
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

  // v1.65.1 — calendar files go to Safari / Calendar untouched, never cached.
  if (url.pathname.indexOf('/reminders/') !== -1) return;

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

// ══════════════════════════════════════════════════════════════════════
// v1.68.0 — payment reminder notifications
// The reminder server sends an EMPTY push at the right hour. What the
// notification says is worked out here, from a small summary the app keeps on
// this device (cache "debtfree-reminder-state"), so no debt name or amount is
// ever sent anywhere. A push must always show something, so if the summary is
// missing the notification falls back to a general check-in.
// ══════════════════════════════════════════════════════════════════════
function _rmDaysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }
function _rmDue(y, m, day) { return new Date(y, m, Math.min(day, _rmDaysIn(y, m))); }
function _rmWhen(date, today) {
  var n = Math.round((date - today) / 864e5);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}
function _rmLabel(d, names) {
  if (names && d.n) return d.n;
  return d.t === 'cc' ? 'A card payment' : d.t === 'mortgage' ? 'Your mortgage payment' : 'A loan payment';
}
function reminderText(state, now) {
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var url = '/app/dashboard.html';
  var checkin = { title: 'New month in DebtFree', body: 'Log last month’s payments and see where your debt-free date landed.', url: url };
  if (!state || !Array.isArray(state.debts)) return checkin;
  var span = state.cadence === 'weekly' ? 7 : state.cadence === 'monthly' ? -1 : (state.lead || 3);
  var due = [];
  state.debts.forEach(function (d) {
    (d.days || []).forEach(function (day) {
      [0, 1].forEach(function (k) {
        var when = _rmDue(today.getFullYear(), today.getMonth() + k, day);
        var n = Math.round((when - today) / 864e5);
        if (n >= 0 && n <= span) due.push({ d: d, when: when, n: n });
      });
    });
  });
  due.sort(function (a, b) { return a.n - b.n; });
  if (!due.length) {
    if (state.cadence === 'weekly') return { title: 'Nothing due this week', body: 'If you paid anything recently, log it to keep your plan current.', url: url };
    return checkin;
  }
  var names = !!state.names;
  if (due.length === 1) {
    var x = due[0];
    var who = _rmLabel(x.d, names);
    var t = _rmWhen(x.when, today);
    return { title: (names && x.d.n ? who + ' is due ' : who + ' is due ') + t,
             body: (names && x.d.m ? 'Minimum ' + x.d.m + '. ' : '') + 'Tap to log it when it’s paid.', url: url };
  }
  var first = due[0];
  return { title: due.length + ' payments due ' + (state.cadence === 'weekly' ? 'this week' : 'soon'),
           body: 'First: ' + _rmLabel(first.d, names) + ', ' + _rmWhen(first.when, today) + '. Tap to see them.', url: url };
}
self.addEventListener('push', function (event) {
  event.waitUntil(
    caches.open('debtfree-reminder-state')
      .then(function (c) { return c.match('/__reminders'); })
      .then(function (r) { return r ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (state) {
        var msg = reminderText(state, new Date());
        return self.registration.showNotification(msg.title, {
          body: msg.body, tag: 'debtfree-reminder', renotify: true,
          icon: '/assets/icons/icon-192.png', badge: '/assets/icons/icon-192.png', data: { url: msg.url }
        });
      })
  );
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/app/dashboard.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf('/app/dashboard.html') !== -1 && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

