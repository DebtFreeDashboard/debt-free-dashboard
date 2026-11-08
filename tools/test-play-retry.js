/* test-play-retry.js — v1.55.1 Play billing retries + Play-build detection
 *   python3 -m http.server 8911   (repo root)   then   node tools/test-play-retry.js
 * Mocks the Digital Goods API with failures that clear after N attempts, and
 * captures gtag events, to check: retries rescue transient failures, each
 * launch reports play_billing_unavailable at most once (with reason/detail),
 * and only OUR app's android-app:// referrer turns on the Play build.
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && (!ok || process.env.VERBOSE)) console.log('      ' + d); };

function mock(o) {
  // The page's own gtag pushes its arguments onto dataLayer; read events from there.
  window.__evs = () => (window.dataLayer || []).filter(a => a[0] === 'event').map(a => [a[1], a[2] || {}]);
  if (o.ref) Object.defineProperty(Document.prototype, 'referrer', { get: () => o.ref, configurable: true });
  if (o.noApi) return;
  let svcCalls = 0, detCalls = 0;
  window.getDigitalGoodsService = async () => { svcCalls++; if (svcCalls <= (o.svcFail || 0)) { const e = new Error('Billing service unavailable'); e.name = 'OperationError'; throw e; }
    return { getDetails: async () => { detCalls++; if (detCalls <= (o.detFail || 0)) { const e = new Error('timeout'); e.name = 'NetworkError'; throw e; }
        return [{ itemId: 'premium_unlock', price: { currency: 'USD', value: '24.00' } }]; },
      listPurchases: async () => [] }; };
}
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function boot({ q = '?source=twa', ref, m = {}, wait = 600 }) {
    const ctx = await b.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route(/googletagmanager|clarity\.ms|fonts\.g/, r => r.abort());
    await ctx.route('**/workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"valid":true}' }));
    await ctx.addInitScript(() => { try { localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1'); } catch (e) {} });
    await ctx.addInitScript(mock, Object.assign({ ref }, m));
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/app/dashboard.html' + q);
    await pg.waitForTimeout(wait);
    const st = await pg.evaluate(() => ({ play: IS_PLAY_BUILD, ready: playBillingReady(), attempts: _playAttempts,
      ev: window.__evs().filter(e => /^play_billing/.test(e[0])).map(e => [e[0], e[1].reason || '', e[1].detail || '', e[1].attempts]) }));
    return { ctx, pg, errs, st };
  }
  const n = (st, name) => st.ev.filter(e => e[0] === name).length;

  let t = await boot({});
  ck('healthy: ready on first try, one play_billing_ready, no unavailable', t.st.ready && t.st.attempts === 1 && n(t.st, 'play_billing_ready') === 1 && !n(t.st, 'play_billing_unavailable'), JSON.stringify(t.st)); await t.ctx.close();

  t = await boot({ m: { svcFail: 1 }, wait: 3500 });
  ck('service fails once: recovered on retry, no unavailable event, recovered event logged', t.st.ready && t.st.attempts === 2 && !n(t.st, 'play_billing_unavailable') && n(t.st, 'play_billing_recovered') === 1 && t.st.ev.find(e => e[0] === 'play_billing_recovered')[1] === 'no_service', JSON.stringify(t.st)); await t.ctx.close();

  t = await boot({ m: { detFail: 2 }, wait: 9500 });
  ck('getDetails fails twice: ready on 3rd try', t.st.ready && t.st.attempts === 3 && !n(t.st, 'play_billing_unavailable'), JSON.stringify(t.st)); await t.ctx.close();

  t = await boot({ m: { svcFail: 99 }, wait: 9500 });
  const u = t.st.ev.filter(e => e[0] === 'play_billing_unavailable');
  ck('persistent failure: exactly one unavailable event, reason + detail + attempts=3', !t.st.ready && u.length === 1 && u[0][1] === 'no_service' && /OperationError/.test(u[0][2]) && u[0][3] === 3, JSON.stringify(t.st));
  // foreground retry once the failure clears
  await t.pg.evaluate(() => { window.getDigitalGoodsService = async () => ({ getDetails: async () => [{ itemId: 'premium_unlock', price: { currency: 'USD', value: '24.00' } }], listPurchases: async () => [] }); _playLastRetry = 0; document.dispatchEvent(new Event('visibilitychange')); });
  await t.pg.waitForTimeout(500);
  ck('back to foreground after failure: billing retried and button ready', await t.pg.evaluate(() => playBillingReady())); await t.ctx.close();

  t = await boot({ m: { noApi: true }, wait: 1500 });
  ck('no billing API: no retries, one unavailable(no_api)', t.st.attempts === 1 && n(t.st, 'play_billing_unavailable') === 1 && t.st.ev[0][1] === 'no_api', JSON.stringify(t.st)); await t.ctx.close();

  t = await boot({ q: '', ref: 'android-app://com.google.android.gm/', m: { noApi: true } });
  ck('link opened from Gmail: NOT the Play build, no billing events', !t.st.play && !t.st.ev.length, JSON.stringify(t.st)); await t.ctx.close();
  t = await boot({ q: '', ref: 'android-app://com.google.android.googlequicksearchbox/' , m: { noApi: true } });
  ck('link opened from the Google app: NOT the Play build', !t.st.play, JSON.stringify(t.st)); await t.ctx.close();
  t = await boot({ q: '', ref: 'android-app://com.mydebtdashboard.app/' });
  ck('launched by our Play app (referrer only): Play build + billing ready', t.st.play && t.st.ready, JSON.stringify(t.st));
  ck('no page errors', !t.errs.length, t.errs.join('; ')); await t.ctx.close();

  await b.close();
  console.log(`\n${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);
})();
