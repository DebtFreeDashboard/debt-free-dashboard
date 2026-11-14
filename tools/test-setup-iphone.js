// v1.72.0 — iPhone hand-off: setup started in Safari, finished in the Home
// Screen app (separate storage on iOS). Needs the repo root served on 8911.
const { chromium } = require('playwright');
const path = require('path');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function open(browser, standalone, clip) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', userAgent: IOS, isMobile: true, hasTouch: true });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
  await ctx.addInitScript(([sa, clip]) => {
    if (sa) Object.defineProperty(navigator, 'standalone', { get: () => true });
    window.__clip = clip || '';
    try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__clip = t; }, readText: async () => window.__clip } }); } catch (e) {}
    localStorage.setItem('debtfree_last_seen_version', '9.9.9');
  }, [standalone, clip]);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8911/app/dashboard.html', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}

(async () => {
  const browser = await chromium.launch();
  console.log('Safari: debts, plan, then the Home Screen steps');
  let { ctx, p, errs } = await open(browser, false);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('demo-paste-btn')).display === 'none'), 'Safari: no paste button');
  await p.evaluate(() => startMyNumbers()); await p.waitForTimeout(300);
  await p.fill('#debt-name', 'Visa'); await p.fill('#debt-balance', '4200'); await p.fill('#debt-apr', '24.9'); await p.fill('#debt-min', '120');
  await p.click('#add-another-btn'); await p.waitForTimeout(300);
  await p.fill('#debt-name', 'Car'); await p.fill('#debt-balance', '9000'); await p.fill('#debt-apr', '7'); await p.fill('#debt-min', '310');
  await p.click('#add-save-btn'); await p.waitForTimeout(400);
  await p.evaluate(() => { ssBump(250); document.querySelector('#setup-s2 .btn-primary').click(); }); await p.waitForTimeout(300);
  const s3 = await p.evaluate(() => ({ txt: document.getElementById('ss-notify').innerText, copy: !!document.getElementById('ss-copy-btn') }));
  ok(s3.copy && /Home Screen/.test(s3.txt) && /Add to Home Screen/.test(s3.txt) && /Paste my setup/.test(s3.txt), 'step 3 shows the three Home Screen steps');
  ok(/calendar/i.test(s3.txt), 'with a calendar option for now');
  await p.evaluate(() => { document.querySelectorAll('#ss-due input[data-id]')[0].value = '12'; });
  await p.evaluate(() => setupCopy()); await p.waitForTimeout(200);
  const clip = await p.evaluate(() => window.__clip);
  ok(/^DEBTFREE-SETUP:/.test(clip) && /Copied/.test(await p.evaluate(() => document.getElementById('ss-copy-btn').textContent)), 'Copy my setup copies it and says so');
  ok(await p.evaluate(() => debts.find(d => d.name === 'Visa').dueDay === 12), 'copying saves the due days typed so far');
  ok(errs.length === 0, 'Safari: no page errors ' + errs.join('|'));
  await ctx.close();

  console.log('Home Screen app: paste, then notifications');
  ({ ctx, p, errs } = await open(browser, true, clip));
  ok(await p.evaluate(() => _demoMode && getComputedStyle(document.getElementById('demo-paste-btn')).display !== 'none'), 'first open: "Paste my setup from Safari" on the example banner');
  await p.evaluate(() => setupPaste()); await p.waitForTimeout(600);
  const h = await p.evaluate(() => ({ demo: _demoMode, n: debts.length, names: debts.map(d => d.name).join(','), extra: extraMonthly, due: (debts.find(d => d.name === 'Visa')||{}).dueDay,
    s3: !document.getElementById('setup-s3').hidden, bar: !document.getElementById('setup-steps').hidden, clip: window.__clip }));
  ok(!h.demo && h.n === 2 && h.names === 'Visa,Car' && h.extra === 250 && h.due === 12, 'debts, $250 extra and due day all arrive');
  ok(h.s3 && h.bar, 'and it opens straight on step 3, Reminders');
  ok(h.clip === '', 'the clipboard is cleared after pasting');
  await p.evaluate(() => { window.pushSupport = () => ({ ok: true }); setupNotifyRender(); });
  ok(await p.evaluate(() => !!document.getElementById('ss-push-btn') && !document.getElementById('ss-push-btn').disabled), 'Turn on notifications is ready');
  await p.evaluate(() => setupFinish()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => localStorage.getItem('debtfree_setup_finish') === 'done' && document.getElementById('setup-steps').hidden), 'See my plan finishes setup');
  ok(errs.length === 0, 'Home Screen: no page errors ' + errs.join('|'));
  await ctx.close();

  console.log('Bad paste');
  ({ ctx, p, errs } = await open(browser, true, 'hello'));
  await p.evaluate(() => { window.prompt = () => ''; setupPaste(); }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => _demoMode), 'something else on the clipboard changes nothing');
  await ctx.close();

  await browser.close();
  console.log(fail ? `FAILURES (${fail})` : `ALL PASS  (${pass}/${pass})`);
  process.exit(fail ? 1 : 0);
})();
