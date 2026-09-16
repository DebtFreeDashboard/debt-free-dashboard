/*
 * verify-dev.js — proves app/dev.html is actually isolated from real data.
 *
 * Run this after any change to tools/make-dev.js, and after dashboard.html
 * changes shape around one of the transform anchors. A dev build that has
 * silently lost its storage namespace writes straight into Kevin's real debt
 * data on his own phone, with no undo — that is the failure this guards.
 *
 *   npx playwright install chromium     # first time only
 *   python3 -m http.server 8911         # from the repo root, in another shell
 *   node tools/verify-dev.js
 *
 * Expect ALL PASS. The last check is a negative control: prod must STILL send
 * analytics, so a passing run can't just mean everything is broken.
 */

const { chromium } = require('playwright');
const B = 'http://127.0.0.1:8911';

const pass = [];
function check(label, ok, detail) {
  pass.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

(async () => {
  const b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  // ONE context = one origin = one shared localStorage. This is the whole point:
  // on Kevin's phone, prod and dev live in the same browser storage.
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });

  // ── 1. Establish "real" data via prod ────────────────────────────────
  const prod = await ctx.newPage();
  await prod.goto(B + '/app/dashboard.html');
  await prod.waitForTimeout(2500);
  await prod.evaluate(() => {
    localStorage.setItem('debtfree_debts', JSON.stringify([
      { id: 1, name: 'REAL Visa', balance: 8412.55, apr: 24.99, minPayment: 210 }
    ]));
    localStorage.setItem('debtfree_premium', 'REAL-LICENSE-KEY');
    localStorage.setItem('installDismissed', '1'); // the un-prefixed key
  });
  const before = await prod.evaluate(() => ({
    debts: localStorage.getItem('debtfree_debts'),
    lic: localStorage.getItem('debtfree_premium'),
    inst: localStorage.getItem('installDismissed')
  }));
  // Full snapshot of the native store. Anything outside dev:: that differs
  // afterwards is dev leaking, whoever wrote it.
  const snapBefore = await prod.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  console.log('seeded real data:', before.debts.slice(0, 48) + '...\n');

  // ── 2. Dev build does its worst in the same browser ──────────────────
  const dev = await ctx.newPage();
  const errs = [];
  dev.on('pageerror', e => { if (!/Chart/.test(e.message)) errs.push(e.message); });
  await dev.goto(B + '/app/dev.html');
  await dev.waitForTimeout(3000);

  await dev.evaluate(() => {
    // Simulate an in-progress feature mangling the schema, plus the un-prefixed key.
    localStorage.setItem('debtfree_debts', JSON.stringify([{ id: 99, BROKEN: true }]));
    localStorage.setItem('debtfree_premium', 'dev-fake');
    localStorage.setItem('installDismissed', 'dev-clobber');
    localStorage.clear();                 // the nuclear case
    localStorage.setItem('debtfree_debts', '[{"id":7,"name":"dev debt"}]');
  });

  const devView = await dev.evaluate(() => ({
    sees: localStorage.getItem('debtfree_debts'),
    len: localStorage.length,
    badge: !!document.getElementById('dev-build-badge'),
    robots: !!document.querySelector('meta[name="robots"][content*="noindex"]'),
    manifest: !!document.querySelector('link[rel="manifest"]'),
    title: document.title.startsWith('[DEV]'),
    version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'
  }));

  // What actually landed in the REAL store. Read it from the PROD page, which
  // has a native localStorage — the dev page's façade can't see past itself,
  // and that is exactly the property under test.
  // Read BEFORE prod reloads — a reload re-runs prod's own boot writes and
  // would look like a leak.
  const rawKeys = await prod.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
    return out.sort();
  });
  const snapAfter = await prod.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });

  // ── 3. Did prod survive? ─────────────────────────────────────────────
  await prod.reload();
  await prod.waitForTimeout(2000);
  const after = await prod.evaluate(() => ({
    debts: localStorage.getItem('debtfree_debts'),
    lic: localStorage.getItem('debtfree_premium'),
    inst: localStorage.getItem('installDismissed')
  }));

  console.log('--- the thing that must never happen ---');
  check('real debts survived a dev clobber + localStorage.clear()',
        after.debts === before.debts, `now: ${String(after.debts).slice(0, 48)}...`);
  check('real license key survived', after.lic === before.lic, `now: ${after.lic}`);
  check('un-prefixed key (installDismissed) survived', after.inst === before.inst, `now: ${after.inst}`);

  console.log('\n--- dev is genuinely isolated, not just quiet ---');
  check('dev sees only its own writes', devView.sees === '[{"id":7,"name":"dev debt"}]', devView.sees);
  // Compare the native store against its pre-dev snapshot. Prod's own reload
  // happens after this read, so any non-dev:: key that changed value or
  // appeared between the snapshot and now can only have come from dev.
  const leaked = Object.keys(snapAfter)
    .filter(k => !k.startsWith('dev::'))
    .filter(k => snapAfter[k] !== snapBefore[k]);
  const deleted = Object.keys(snapBefore).filter(k => !(k in snapAfter));
  check('dev changed nothing outside its dev:: namespace',
        leaked.length === 0 && deleted.length === 0,
        `changed: ${leaked.join(', ') || 'none'} | deleted: ${deleted.join(', ') || 'none'}`);
  check('dev keys exist', rawKeys.some(k => k.startsWith('dev::')),
        rawKeys.filter(k => k.startsWith('dev::')).slice(0, 4).join(', '));

  console.log('\n--- the other three transforms ---');
  const swBlocked = await dev.evaluate(() =>
    navigator.serviceWorker.register('/sw.js').then(() => 'REGISTERED', e => 'blocked: ' + e.message));
  check('service worker refused', swBlocked.startsWith('blocked'), swBlocked);
  check('noindex present', devView.robots);
  check('manifest removed (cannot install over real PWA)', !devView.manifest);
  check('title marked [DEV]', devView.title);
  check('DEV badge rendered', devView.badge);
  check('app actually booted (not broken by the shim)', devView.version !== '?', 'v' + devView.version);
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');

  console.log('\n--- analytics must not fire from dev ---');
  const net = [];
  const dev2 = await ctx.newPage();
  dev2.on('request', r => { const u = r.url(); if (/googletagmanager|clarity\.ms|google-analytics/i.test(u)) net.push(u); });
  await dev2.goto(B + '/app/dev.html');
  await dev2.waitForTimeout(3000);
  check('no GA4 / Clarity requests from dev', net.length === 0, net.slice(0,3).join(' | ') || 'none');

  const prodNet = [];
  const prod2 = await ctx.newPage();
  prod2.on('request', r => { const u = r.url(); if (/googletagmanager|clarity\.ms|google-analytics/i.test(u)) prodNet.push(u); });
  await prod2.goto(B + '/app/dashboard.html');
  await prod2.waitForTimeout(3000);
  check('prod still DOES send analytics (transform is dev-only)', prodNet.length > 0, `${prodNet.length} request(s)`);

  console.log(`\n${pass.every(Boolean) ? 'ALL PASS' : 'FAILURES PRESENT'}  (${pass.filter(Boolean).length}/${pass.length})`);
  await b.close();
  process.exit(pass.every(Boolean) ? 0 : 1);
})();
