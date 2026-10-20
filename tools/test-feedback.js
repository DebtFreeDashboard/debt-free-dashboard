/* test-feedback.js — v1.54.9 Send feedback button
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-feedback.js
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && !ok) console.log('      ' + d); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function run(query, ua) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', userAgent: ua });
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
    await ctx.addInitScript(() => {
      localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1');
      localStorage.setItem('debtfree_debts', JSON.stringify([{ id: 1, name: 'SecretCard 4321', balance: 5555.55, originalBalance: 6000, apr: 22, minPayment: 120, type: 'credit' }]));
    });
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/app/dashboard.html' + query); await pg.waitForTimeout(800);
    await pg.evaluate(() => { showSection('settings'); });
    await pg.waitForTimeout(300);
    const visible = await pg.isVisible('#feedback-row button');
    const mailto = await pg.evaluate(() => buildFeedbackMailto());
    // Click without actually navigating away: intercept location change.
    const fallback = await pg.evaluate(() => {
      const realBuild = buildFeedbackMailto; let captured = null;
      window.buildFeedbackMailto = () => { captured = realBuild(); return 'javascript:void(0)'; };
      sendFeedback(); window.buildFeedbackMailto = realBuild;
      return { shown: getComputedStyle(document.getElementById('feedback-fallback')).display !== 'none', captured };
    });
    await ctx.close();
    return { visible, mailto: decodeURIComponent(mailto), fallback, errs };
  }

  const android = 'Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

  let r = await run('?source=twa', android);
  ck('Play build: button visible in Settings', r.visible, JSON.stringify(r));
  ck('Play build: mailto to debtfreedashboard@gmail.com with version', /^mailto:debtfreedashboard@gmail\.com\?subject=DebtFree feedback \(v1\.54\.9\)/.test(r.mailto), r.mailto);
  ck('Play build: platform + device filled', /Platform: Google Play app/.test(r.mailto) && /Device: Android/.test(r.mailto), r.mailto);
  ck('no debt data in email (name, balance)', !/SecretCard|5555|4321|6000/.test(r.mailto), r.mailto);
  ck('fallback address shown after tap', r.fallback.shown);
  ck('no page errors (Play)', !r.errs.length, r.errs.join(' | '));

  r = await run('', iphone);
  ck('Web (iPhone): button visible', r.visible);
  ck('Web (iPhone): platform Web browser, device iPhone/iPad', /Platform: Web browser/.test(r.mailto) && /Device: iPhone\/iPad/.test(r.mailto), r.mailto);
  ck('no page errors (web)', !r.errs.length, r.errs.join(' | '));

  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
