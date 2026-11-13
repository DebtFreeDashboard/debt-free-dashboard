const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { debts, payments } = require('./seed');
const FONTS = '/tmp/fontsrc/node_modules/@fontsource';
const CHART = '/home/claude/debt-free-dashboard/tools/node_modules/chart.js/dist/chart.umd.js';
const OUT = process.env.OUT || '/home/claude/build/shots/raw';
fs.mkdirSync(OUT, { recursive: true });

const fontCss = [400, 600, 700, 800].map(w => `@font-face{font-family:'Sora';font-weight:${w};font-style:normal;src:url(https://fonts.gstatic.com/local/sora-${w}.woff2) format('woff2');}`).join('\n') + '\n' +
  [300, 400, 500, 700].map(w => `@font-face{font-family:'JetBrains Mono';font-weight:${w};font-style:normal;src:url(https://fonts.gstatic.com/local/jbm-${w}.woff2) format('woff2');}`).join('\n');

async function page(theme) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: fontCss, contentType: 'text/css' }));
  await ctx.route('**/fonts.gstatic.com/local/**', r => {
    const m = r.request().url().match(/(sora|jbm)-(\d+)/);
    const f = m[1] === 'sora' ? `${FONTS}/sora/files/sora-latin-${m[2]}-normal.woff2` : `${FONTS}/jetbrains-mono/files/jetbrains-mono-latin-${m[2]}-normal.woff2`;
    r.fulfill({ path: f, contentType: 'font/woff2' });
  });
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms/, r => r.abort());
  await ctx.addInitScript(([debts, payments, theme]) => {
    try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch (e) {}
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    const S = (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    S('debtfree_debts', debts); S('debtfree_payments', payments);
    S('debtfree_strategy', 'optimized'); S('debtfree_extra', '300'); S('debtfree_nextid', '200');
    S('debtfree_premium', '1'); S('debtfree_premium_source', 'play'); S('debtfree_theme', theme);
    S('debtfree_demo_dismissed', '1'); S('debtfree_last_seen_version', '1.68.0');
    S('debtfree_badges_seeded', '1'); S('debtfree_push', {on:true,cadence:'before',lead:3,names:false});
  }, [debts, payments, theme]);
  await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8911' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://localhost:8911/app/dashboard.html?source=twa', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  return { browser, p };
}
module.exports = { page, OUT };

if (require.main === module) (async () => {
  const { browser, p } = await page(process.argv[2] || 'light');
  await p.screenshot({ path: path.join(OUT, 'probe.png') });
  console.log(await p.evaluate(() => [APP_VERSION, IS_PLAY_BUILD, isPremium, debts.length, [...document.querySelectorAll('.modal-overlay')].filter(m => getComputedStyle(m).display !== 'none').map(m => m.id)]));
  await browser.close();
})();
