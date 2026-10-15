/* test-play.js — v1.54.1 Google Play (TWA) build mode
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-play.js
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && (!ok || process.env.VERBOSE)) console.log('      ' + d); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function look(url, ctxIn) {
    const ctx = ctxIn || await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    if (!ctxIn) {
      await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
      await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
    }
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(url); await pg.waitForTimeout(1000);
    const st = await pg.evaluate(() => {
      showSection('settings');
      const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).display !== 'none';
      const links = [...document.querySelectorAll('a[href*="gumroad.com"]')];
      const prices = [...document.querySelectorAll('.price-copy')];
      const playOnly = [...document.querySelectorAll('.play-only')];
      return { play: typeof IS_PLAY_BUILD !== 'undefined' && IS_PLAY_BUILD, linksVisible: links.filter(vis).length, links: links.length,
        priceVisible: prices.filter(p => getComputedStyle(p).display !== 'none').length, prices: prices.length,
        playOnlyVisible: playOnly.filter(p => getComputedStyle(p).display !== 'none').length,
        licenseInput: !!document.getElementById('license-input') && getComputedStyle(document.getElementById('license-input')).display !== 'none' };
    });
    return { ctx, pg, st, errs };
  }
  const web = await look(BASE + '/app/dashboard.html');
  ck('website: buy links and prices shown, Play note hidden', !web.st.play && web.st.linksVisible >= 1 && web.st.priceVisible === web.st.prices && web.st.playOnlyVisible === 0, JSON.stringify(web.st));
  const play = await look(BASE + '/app/dashboard.html?source=twa');
  ck('Play build (?source=twa): no visible Gumroad link, no price copy, Play note shown', play.st.play && play.st.linksVisible === 0 && play.st.priceVisible === 0 && play.st.playOnlyVisible === 1, JSON.stringify(play.st));
  ck('Play build: license key entry still available for existing owners', play.st.licenseInput);
  // a reload inside the TWA without the query string keeps the mode (same session)
  await play.pg.goto(BASE + '/app/dashboard.html'); await play.pg.waitForTimeout(800);
  const again = await play.pg.evaluate(() => IS_PLAY_BUILD);
  ck('Play mode survives an in-app reload without the query string', again === true);
  // a fresh browser session on the same device does not inherit it
  const p2 = await play.ctx.newPage(); await p2.goto(BASE + '/app/dashboard.html'); await p2.waitForTimeout(800);
  const fresh = await p2.evaluate(() => IS_PLAY_BUILD);
  ck('a new browser tab on the same device is NOT the Play build (sessionStorage, not localStorage)', fresh === false);
  ck('no page errors in either mode', !web.errs.length && !play.errs.length, web.errs.concat(play.errs).join(' | '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
