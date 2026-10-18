/* test-play-billing.js — Google Play Billing inside the Play app (v1.54.5, live in v1.54.6)
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-play-billing.js
 *
 * Google's Digital Goods + Payment Request APIs exist only inside the Play app,
 * so they are mocked here; the verify server is mocked with page.route().
 * The real end-to-end purchase is a manual test on a phone (Play license tester).
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const VERIFY = 'https://verify.test/verify';
const PROD_VERIFY = 'https://debtfree-verify.debtfreedashboard.workers.dev/verify'; // shipped since v1.54.6
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && (!ok || process.env.VERBOSE)) console.log('      ' + d); };

// Mock Play: state lives in sessionStorage so it survives reloads within a test.
function mockPlay(opts) {
  window.__play = Object.assign({ purchases: [], buy: 'ok', priceValue: '24.00' }, opts || {});
  try { const saved = sessionStorage.getItem('__play'); if (saved) window.__play = JSON.parse(saved); } catch (e) {}
  const persist = () => { try { sessionStorage.setItem('__play', JSON.stringify(window.__play)); } catch (e) {} };
  persist();
  if (window.__play.noApi) return;
  window.getDigitalGoodsService = async (url) => {
    if (url !== 'https://play.google.com/billing') throw new Error('bad url');
    return {
      getDetails: async (ids) => (!window.__play.noProduct && ids.includes('premium_unlock')) ? [{ itemId: 'premium_unlock', title: 'Premium', price: { currency: 'USD', value: window.__play.priceValue } }] : [],
      listPurchases: async () => { if (window.__play.offline) throw new Error('offline'); return window.__play.purchases.slice(); }
    };
  };
  window.PaymentRequest = function (methods) {
    this.show = async () => {
      if (methods[0].supportedMethods !== 'https://play.google.com/billing' || methods[0].data.sku !== 'premium_unlock') throw new Error('bad request');
      if (window.__play.buy === 'cancel') { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
      const tok = 'tok_' + 'x'.repeat(30);
      window.__play.purchases.push({ itemId: 'premium_unlock', purchaseToken: tok }); persist();
      return { details: { purchaseToken: tok }, complete: async (r) => { window.__play.completed = r; persist(); } };
    };
  };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function boot({ play = true, mock = {}, server = 'valid', seed } = {}) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
    const calls = [];
    const verifyHandler = async r => {
      calls.push(JSON.parse(r.request().postData() || '{}'));
      const mode = typeof server === 'function' ? server() : server;
      if (mode === 'down') return r.fulfill({ status: 502, body: '{"error":"server"}', contentType: 'application/json' });
      if (mode === 'refunded') return r.fulfill({ status: 200, body: '{"valid":false,"reason":"not_purchased"}', contentType: 'application/json' });
      return r.fulfill({ status: 200, body: '{"valid":true,"acknowledged":true}', contentType: 'application/json' });
    };
    // Mock both the test URL and the shipped one, so no test ever reaches the real server.
    await ctx.route(VERIFY, verifyHandler); await ctx.route(PROD_VERIFY, verifyHandler);
    await ctx.addInitScript(([m, s]) => {
      try {
        localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1');
        if (s && !sessionStorage.getItem('__seeded')) { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); sessionStorage.setItem('__seeded', '1'); }
      } catch (e) {}
    }, [mock, seed || null]);
    await ctx.addInitScript(mockPlay, mock);
    // The production page ships PLAY_VERIFY_URL; point it at the test server.
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/app/dashboard.html' + (play ? '?source=twa' : ''));
    await pg.waitForTimeout(700);
    if (!(await pg.evaluate(() => PLAY_VERIFY_URL))) { await pg.evaluate(v => { PLAY_VERIFY_URL = v; return initPlayBilling(); }, VERIFY); }
    await pg.waitForTimeout(400);
    return { ctx, pg, errs, calls };
  }
  const state = pg => pg.evaluate(() => {
    showSection('settings');
    const vis = id => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
    return { premium: isPremium, source: localStorage.getItem('debtfree_premium_source'), ack: localStorage.getItem('debtfree_play_ack'),
      btn: vis('play-buy-btn') ? document.getElementById('play-buy-btn').textContent : null, note: vis('play-premium-note'),
      gumroadVisible: [...document.querySelectorAll('a[href*="gumroad.com"]')].some(a => a.offsetWidth > 0),
      msg: (document.getElementById('play-buy-msg') || {}).textContent || '' };
  });

  console.log('--- outside the Play app nothing changes ---');
  {
    const t = await boot({ play: false });
    const s = await state(t.pg);
    ck('website: no Play button, Gumroad links shown, no server calls', !s.btn && s.gumroadVisible && !t.calls.length, JSON.stringify(s));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { noApi: true } });
    const s = await state(t.pg);
    ck('Play app without the billing API: the "not sold here yet" note, no button', !s.btn && s.note && !s.premium, JSON.stringify(s));
    await t.ctx.close();
  }
  {
    // shipped state: PLAY_VERIFY_URL empty means dormant even with the API present
    const ctx = await b.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
    await ctx.addInitScript(mockPlay, {}); await ctx.route(PROD_VERIFY, r => r.abort());
    const pg = await ctx.newPage(); await pg.goto(BASE + '/app/dashboard.html?source=twa'); await pg.waitForTimeout(800);
    const shipped = await pg.evaluate(() => PLAY_VERIFY_URL);
    const s = await state(pg);
    ck('shipped build points at the live verify server', shipped === PROD_VERIFY, JSON.stringify({ shipped }));
    await ctx.close();
  }

  {
    const t = await boot({ mock: { noProduct: true } });
    const s = await state(t.pg);
    const diag = await t.pg.evaluate(() => document.getElementById('play-diag').textContent);
    ck('product not visible to Play yet: note stays, no button, status code says why', !s.btn && s.note && diag === 'Status: no_product', JSON.stringify({ s, diag }));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { noApi: true } });
    const diag = await t.pg.evaluate(() => (showSection('settings'), document.getElementById('play-diag').textContent));
    ck('billing API missing: status code no_api', diag === 'Status: no_api', diag);
    await t.ctx.close();
  }
  {
    const t = await boot();
    const diag = await t.pg.evaluate(() => (showSection('settings'), document.getElementById('play-diag').textContent));
    ck('when the button shows, no status code is left behind', diag === '', diag);
    await t.ctx.close();
  }
  console.log('\n--- buying ---');
  {
    const t = await boot();
    let s = await state(t.pg);
    ck('Play app: button shows Google\'s price, note hidden, no Gumroad link', s.btn === 'Unlock Premium — $24.00' && !s.note && !s.gumroadVisible, JSON.stringify(s));
    await t.pg.click('#play-buy-btn'); await t.pg.waitForTimeout(600);
    s = await state(t.pg);
    const done = await t.pg.evaluate(() => window.__play.completed);
    ck('purchase unlocks Premium immediately and tells Play it succeeded', s.premium && s.source === 'play' && done === 'success' && /unlocked/.test(s.msg), JSON.stringify({ s, done }));
    ck('the server is asked to confirm exactly that purchase token, and nothing else is sent', t.calls.length === 1 && t.calls[0].productId === 'premium_unlock' && /^tok_/.test(t.calls[0].purchaseToken) && Object.keys(t.calls[0]).length === 2, JSON.stringify(t.calls));
    ck('the confirmed token is remembered (no re-check on every launch)', s.ack === t.calls[0].purchaseToken);
    await t.pg.reload(); await t.pg.waitForTimeout(900);
    s = await state(t.pg);
    ck('after a reload: still Premium, no second server call', s.premium && t.calls.length === 1, JSON.stringify({ s, calls: t.calls.length }));
    ck('no page errors', !t.errs.length, t.errs.join(' | '));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { buy: 'cancel' } });
    await state(t.pg);
    await t.pg.click('#play-buy-btn'); await t.pg.waitForTimeout(500);
    const s = await state(t.pg);
    ck('closing Google\'s sheet: no Premium, no server call, no error message', !s.premium && !t.calls.length && !s.msg, JSON.stringify(s));
    await t.ctx.close();
  }

  console.log('\n--- restore, refunds, outages ---');
  {
    const t = await boot({ mock: { purchases: [{ itemId: 'premium_unlock', purchaseToken: 'tok_restore_' + 'y'.repeat(20) }] } });
    const s = await state(t.pg);
    ck('new phone / reinstall: an existing Play purchase restores Premium on launch', s.premium && s.source === 'play' && t.calls.length === 1, JSON.stringify(s));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { purchases: [{ itemId: 'premium_unlock', purchaseToken: 'tok_' + 'z'.repeat(30) }] }, server: 'down' });
    let s = await state(t.pg);
    ck('server down at purchase time: Premium still works, confirmation left pending', s.premium && !s.ack, JSON.stringify(s));
    await t.ctx.close();
  }
  {
    // Refund: Play stops listing the purchase.
    const t = await boot({ mock: { purchases: [] }, seed: { debtfree_premium: '1', debtfree_premium_source: 'play' } });
    const s = await state(t.pg);
    ck('refunded on Play (no longer listed): Premium removed', !s.premium && !s.source, JSON.stringify(s));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { purchases: [{ itemId: 'premium_unlock', purchaseToken: 'tok_' + 'r'.repeat(30) }] }, server: 'refunded' });
    await t.pg.waitForTimeout(300);
    const s = await state(t.pg);
    ck('server says "not purchased" (voided): Premium removed', !s.premium, JSON.stringify(s));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { purchases: [], offline: true }, seed: { debtfree_premium: '1', debtfree_premium_source: 'play' } });
    const s = await state(t.pg);
    ck('offline (Play can\'t list purchases): Premium kept, nothing revoked', s.premium && s.source === 'play', JSON.stringify(s));
    await t.ctx.close();
  }
  {
    const t = await boot({ mock: { purchases: [] }, seed: { debtfree_premium: '1', debtfree_license: 'GUMROAD-KEY-1234' } });
    const s = await state(t.pg);
    ck('a website (Gumroad) license is never removed by Play', s.premium, JSON.stringify(s));
    await t.ctx.close();
  }
  await b.close();

  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
