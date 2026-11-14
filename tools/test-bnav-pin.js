/*
 * test-bnav-pin.js — v1.71.1 bottom bar pinned on the iPhone Home Screen app.
 * Simulates the iOS bug (the viewport height going stale and shorter after a
 * sheet with typing) and checks the bar stays at the bottom of the screen;
 * Safari tabs and Android keep the plain CSS.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CHART = fs.readFileSync(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-primary.json'), 'utf8'));
const results = [];
const check = (l, ok, d) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && !ok) console.log('      ' + d); };
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function open(b, ua, standalone) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ua });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.addInitScript(sa => {
    if (sa) Object.defineProperty(navigator, 'standalone', { get: () => true });
    localStorage.setItem('debtfree_last_seen_version', '99.0.0');
    localStorage.setItem('debtfree_demo_dismissed', '1');
  }, standalone);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'site/app/dashboard.html'));
  await page.waitForTimeout(800);
  await page.evaluate(f => { applyBackupPayload(f); render(); document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')); }, FIXTURE);
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const barBottom = p => p.evaluate(() => { const r = document.querySelector('.bnav').getBoundingClientRect(); return { bottom: Math.round(r.bottom), pin: document.documentElement.classList.contains('bnav-pin'), hidden: document.querySelector('.bnav').classList.contains('bnav-hide') }; });

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  {
    const { ctx, page, errs } = await open(b, IOS, true);
    const a = await barBottom(page);
    check('iPhone Home Screen app: bar pinned at the screen bottom', a.pin && a.bottom === 844, JSON.stringify(a));
    // The bug: iOS reports a shorter viewport after a sheet with typing.
    await page.setViewportSize({ width: 390, height: 760 });
    await page.waitForTimeout(900);
    const b1 = await barBottom(page);
    check('stale shorter viewport: bar stays at the real bottom', b1.bottom === 844, JSON.stringify(b1));
    await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(300);
    const b2 = await barBottom(page);
    check('scrolling does not move it', b2.bottom === 844, JSON.stringify(b2));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
    // Landscape keeps its own height.
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
    const l = await barBottom(page);
    check('landscape: placed at its own bottom', l.bottom === 390 || l.bottom === 0, JSON.stringify(l));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
    const p2 = await barBottom(page);
    check('back to portrait: bottom again', p2.bottom === 844, JSON.stringify(p2));
    check('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(b, IOS, false);
    const a = await barBottom(page);
    check('iPhone Safari tab: plain CSS, not pinned by script', !a.pin && a.bottom === 844, JSON.stringify(a));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(b, 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', false);
    const a = await barBottom(page);
    check('Android: plain CSS', !a.pin && a.bottom === 844, JSON.stringify(a));
    await ctx.close();
  }
  await b.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
