/*
 * test-sw.js — v1.41.1 service-worker bypass for the dev build.
 *
 * Needs a real origin with a real service worker; file:// will not do. The
 * assertion that matters is that dev.html never enters the production cache,
 * because the old HTML branch was network-first-but-still-caching.
 */
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:8912';

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 } });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){};window.Chart.register=function(){};' }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.route('**/fonts.googleapis.com/**', r => r.abort());

  const page = await ctx.newPage();

  // ── Prod first: get a real worker installed and controlling ───────────
  await page.goto(B + '/app/dashboard.html');
  await page.waitForTimeout(1500);
  await page.reload();                                  // second load = claimed
  await page.waitForTimeout(2500);

  const prodState = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const names = await caches.keys();
    let entries = [];
    for (const n of names) { const c = await caches.open(n); entries = entries.concat((await c.keys()).map(r => new URL(r.url).pathname)); }
    return { regs: regs.length, controlled: !!navigator.serviceWorker.controller, caches: names, entries };
  });
  check('prod registers a service worker and is controlled by it',
        prodState.regs === 1 && prodState.controlled,
        `${prodState.regs} reg, controlled=${prodState.controlled}, cache=${prodState.caches.join(',')}`);
  check('prod precaches its own assets',
        prodState.entries.some(p => p.includes('/app/dashboard.html')),
        prodState.entries.join(' '));

  // ── Now the dev build, in the same origin, with that worker live ──────
  const dev = await ctx.newPage();
  const devErrs = [];
  dev.on('pageerror', e => { if (!/Chart/.test(e.message)) devErrs.push(e.message); });
  await dev.goto(B + '/app/dev.html');
  await dev.waitForTimeout(2500);
  await dev.reload();                                   // a second pass at caching it
  await dev.waitForTimeout(2000);

  const after = await dev.evaluate(async () => {
    const names = await caches.keys();
    let entries = [];
    for (const n of names) { const c = await caches.open(n); entries = entries.concat((await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search)); }
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      entries, regs: regs.length,
      title: document.title,
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'DID NOT BOOT',
      badge: !!document.getElementById('dev-build-badge')
    };
  });

  console.log('\n--- the fix ---');
  check('dev.html NEVER enters the production cache',
        !after.entries.some(p => p.includes('dev.html')),
        `cache holds: ${after.entries.join(' ') || '(empty)'}`);

  console.log('\n--- and no collateral damage on prod ---');
  check('prod service worker still registered after a dev visit',
        after.regs === 1, `${after.regs} registration(s)`);
  check('prod precache survived a dev visit',
        after.entries.some(p => p.includes('/app/dashboard.html')),
        after.entries.join(' '));

  console.log('\n--- dev build still behaves ---');
  check('dev booted at the new version', after.version === '1.41.1', 'v' + after.version);
  check('dev still marked [DEV] with its badge', after.title.startsWith('[DEV]') && after.badge);
  const reg = await dev.evaluate(() => navigator.serviceWorker.register('/sw.js').then(() => 'REGISTERED (bad)', e => 'refused: ' + e.message));
  check('dev still cannot install a worker of its own', reg.startsWith('refused'), reg);
  check('no JS errors on dev', devErrs.length === 0, devErrs.join(' | ') || 'none');

  // ── Offline behaviour: dev must not be served prod HTML ───────────────
  console.log('\n--- the confusing failure mode is gone ---');
  await ctx.setOffline(true);
  const off = await dev.goto(B + '/app/dev.html', { waitUntil: 'load' }).then(() => 'loaded', e => 'network error');
  await dev.waitForTimeout(800);
  const offTitle = await dev.evaluate(() => document.title).catch(() => '(unavailable)');
  check('offline dev fails honestly instead of serving production HTML',
        off === 'network error' || offTitle.startsWith('[DEV]'),
        `result=${off}, title=${offTitle}`);
  await ctx.setOffline(false);

  // Prod must still work offline — that is the whole point of the worker.
  const prod2 = await ctx.newPage();
  await prod2.goto(B + '/app/dashboard.html');
  await prod2.waitForTimeout(1500);
  await ctx.setOffline(true);
  const prodOff = await prod2.reload({ waitUntil: 'load' }).then(() => 'loaded', () => 'failed');
  await prod2.waitForTimeout(1200);
  const prodOffV = await prod2.evaluate(() => typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'no boot').catch(() => 'no boot');
  check('prod still works offline', prodOff === 'loaded' && prodOffV === '1.41.1', `${prodOff}, v${prodOffV}`);
  await ctx.setOffline(false);

  console.log(`\n${results.every(Boolean) ? 'ALL PASS' : 'FAILURES PRESENT'}  (${results.filter(Boolean).length}/${results.length})`);
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})();
