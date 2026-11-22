// v1.78.0 — "Would you use DebtFree from the App Store?" (iPhone/iPad only).
// Needs the repo root served on 8911:  python3 -m http.server 8911
//   node tools/test-ios-ask.js
// Checks: shown on iPhone after first setup, never on Android/desktop, never in
// the example or during setup, never in the Play app; one answer per device;
// ios_app_interest carries only the answer and context; homepage guide asks too
// and shares the same one-answer-per-device key.
const { chromium } = require('playwright');
const path = require('path');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

async function ctxFor(browser, ua, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', userAgent: ua, isMobile: ua !== DESKTOP, hasTouch: ua !== DESKTOP });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
  await ctx.addInitScript((o) => {
    if (o.standalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
    if (o.play) { try { sessionStorage.setItem('debtfree_play', '1'); } catch (e) {} }
    localStorage.setItem('debtfree_last_seen_version', '9.9.9');
  }, opts);
  return ctx;
}
const evs = p => p.evaluate(() => (window.dataLayer || []).map(a => [].slice.call(a)).filter(e => e[0] === 'event').map(e => [e[1], e[2] || {}]));
const shown = p => p.evaluate(() => { const c = document.getElementById('ios-app-ask'); return !!c && !c.hidden && c.offsetParent !== null; });

async function setUp(p) {
  await p.evaluate(() => startMyNumbers()); await p.waitForTimeout(300);
  await p.fill('#debt-name', 'Visa'); await p.fill('#debt-balance', '4200'); await p.fill('#debt-apr', '24.9'); await p.fill('#debt-min', '120');
  await p.click('#add-save-btn'); await p.waitForTimeout(400);
}
async function finish(p) { await p.evaluate(() => setupFinish()); await p.waitForTimeout(500); }

(async () => {
  const browser = await chromium.launch();
  const errsAll = [];

  console.log('iPhone Safari: example, setup, then the question');
  let ctx = await ctxFor(browser, IOS); let p = await ctx.newPage(); p.on('pageerror', e => errsAll.push(e.message));
  await p.goto('http://localhost:8911/app/dashboard.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok(!(await shown(p)), 'not shown on the example screen');
  await setUp(p);
  ok(!(await shown(p)), 'not shown during first setup');
  await finish(p);
  ok(await shown(p), 'shown on the dashboard once setup is finished');
  let e = await evs(p);
  ok(e.filter(x => x[0] === 'ios_app_ask_shown').length === 1 && e.find(x => x[0] === 'ios_app_ask_shown')[1].where === 'app', 'ios_app_ask_shown sent once, where=app');
  await p.evaluate(() => render()); await p.evaluate(() => render());
  ok((await evs(p)).filter(x => x[0] === 'ios_app_ask_shown').length === 1, 'not re-sent on later renders');
  const card = await p.evaluate(() => document.getElementById('ios-app-ask').innerText);
  ok(!/gumroad|\$\d|you should/i.test(card), 'card copy: no price, no Gumroad, no advice');
  await p.evaluate(() => document.querySelector('#ios-app-ask .btn-primary').click()); await p.waitForTimeout(200);
  e = await evs(p);
  const yes = e.find(x => x[0] === 'ios_app_interest');
  ok(yes && yes[1].answer === 'yes' && yes[1].where === 'app' && yes[1].home_screen === 'no', 'Yes sends ios_app_interest answer=yes, where=app, home_screen=no');
  ok(yes && Object.keys(yes[1]).every(k => ['event_category', 'answer', 'where', 'home_screen'].includes(k)), 'event carries nothing else');
  ok(/Thanks/.test(await p.evaluate(() => document.getElementById('ios-app-ask').innerText)), 'thank-you shown');
  ok(await p.evaluate(() => localStorage.getItem('debtfree_ios_ask') === 'yes'), 'answer remembered on the device');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
  ok(!(await shown(p)), 'never asked again after answering');

  console.log('homepage guide on the same iPhone: already answered, so no question');
  await p.goto('http://localhost:8911/', { waitUntil: 'load' }); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-smart-cta="hero"]').click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('[data-ig-ask]').hidden), 'guide hides its App Store question when the device already answered');
  await ctx.close();

  console.log('homepage guide, fresh iPhone');
  ctx = await ctxFor(browser, IOS); p = await ctx.newPage(); p.on('pageerror', e => errsAll.push(e.message));
  await p.goto('http://localhost:8911/', { waitUntil: 'load' }); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-smart-cta="hero"]').click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const a = document.querySelector('[data-ig-ask]'); return !a.hidden && a.offsetParent !== null; }), 'guide shows "I\'d use an App Store version"');
  await p.click('[data-ig-ask-yes]'); await p.click('[data-ig-ask-yes]', { force: true }).catch(() => {}); await p.waitForTimeout(150);
  e = (await evs(p)).filter(x => x[0] === 'ios_app_interest');
  ok(e.length === 1 && e[0][1].answer === 'yes' && e[0][1].where === 'home_guide' && e[0][1].location === 'hero', 'sends ios_app_interest once, where=home_guide, location=hero');
  ok(/Thanks/.test(await p.evaluate(() => document.querySelector('[data-ig-ask-yes]').textContent)), 'button says thanks');
  await p.goto('http://localhost:8911/app/dashboard.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
  await setUp(p); await finish(p);
  ok(!(await shown(p)), 'the app does not ask again after the homepage answer');
  await ctx.close();

  console.log('No thanks and ×; Home Screen app');
  ctx = await ctxFor(browser, IOS, { standalone: true }); p = await ctx.newPage(); p.on('pageerror', e => errsAll.push(e.message));
  await p.goto('http://localhost:8911/app/dashboard.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
  await setUp(p); await finish(p);
  ok(await shown(p), 'shown in the Home Screen app too');
  await p.evaluate(() => document.querySelector('#ios-app-ask .btn-ghost').click()); await p.waitForTimeout(150);
  e = (await evs(p)).filter(x => x[0] === 'ios_app_interest');
  ok(e.length === 1 && e[0][1].answer === 'no' && e[0][1].home_screen === 'yes', 'No thanks sends answer=no, home_screen=yes');
  await p.evaluate(() => { localStorage.removeItem('debtfree_ios_ask'); _iosAskAnswered = false; render(); });
  await p.evaluate(() => document.querySelector('#ios-app-ask .guide-hide').click()); await p.waitForTimeout(150);
  e = (await evs(p)).filter(x => x[0] === 'ios_app_interest');
  ok(e.length === 2 && e[1][1].answer === 'dismiss' && !(await shown(p)), '× hides it and counts as dismiss');
  await ctx.close();

  for (const [label, ua, o] of [['Android Chrome', ANDROID, {}], ['desktop', DESKTOP, {}], ['Play app', ANDROID, { play: true }]]) {
    ctx = await ctxFor(browser, ua, o); p = await ctx.newPage(); p.on('pageerror', e => errsAll.push(e.message));
    await p.goto('http://localhost:8911/app/dashboard.html' + (o.play ? '?utm_source=x' : ''), { waitUntil: 'load' }); await p.waitForTimeout(800);
    await setUp(p); await finish(p);
    ok(!(await shown(p)) && !(await evs(p)).some(x => /^ios_app/.test(x[0])), label + ': never shown, no events');
    await ctx.close();
  }

  ok(errsAll.length === 0, 'no page errors ' + errsAll.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
