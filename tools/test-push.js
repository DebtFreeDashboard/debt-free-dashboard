/*
 * test-push.js — v1.68.0 phone notifications, app side and service worker text.
 *
 * The push service itself can't run headless, so the browser's subscribe and
 * permission calls are stubbed and the reminder server is a route that
 * records what it receives. The point is what leaves the device.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHART = fs.readFileSync(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-primary.json'), 'utf8'));
const SW = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');

const results = [];
const check = (label, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (detail) console.log(`      ${detail}`); };

(async () => {
  // ── Service worker wording ───────────────────────────────────────────
  console.log('--- notification text (service worker) ---');
  const ctx0 = { self: { addEventListener() {}, skipWaiting() {} }, caches: {}, fetch() {}, URL, console };
  vm.createContext(ctx0); vm.runInContext(SW, ctx0);
  const txt = (state, iso) => ctx0.reminderText(state, new Date(iso));
  const st = { cadence: 'before', lead: 3, names: false, debts: [{ n: null, t: 'cc', days: [16], m: null }, { n: null, t: 'auto', days: [30], m: null }] };
  let t = txt(st, '2026-11-13T09:00:00');
  check('private: "A card payment is due Monday", no name', /^A card payment is due Monday$/.test(t.title) && !/Store/.test(t.title + t.body), JSON.stringify(t));
  t = txt({ ...st, names: true, debts: [{ n: 'Store Card', t: 'cc', days: [16], m: '$55' }] }, '2026-11-13T09:00:00');
  check('names on: "Store Card is due Monday" with the minimum', /^Store Card is due Monday$/.test(t.title) && /Minimum \$55/.test(t.body), JSON.stringify(t));
  t = txt(st, '2026-11-16T09:00:00');
  check('on the day: "due today"', /due today$/.test(t.title), t.title);
  t = txt({ ...st, cadence: 'weekly' }, '2026-11-24T09:00:00');
  check('weekly: counts the week', /^1 payments? due|due Monday|is due/.test(t.title) || /payments due this week/.test(t.title), t.title);
  t = txt({ ...st, cadence: 'monthly' }, '2026-12-01T09:00:00');
  check('monthly / the 1st: check-in', /New month/.test(t.title), t.title);
  t = txt(null, '2026-12-01T09:00:00');
  check('no summary on the phone: still shows a general check-in', /New month/.test(t.title));
  check('the version cache cleanup keeps the reminder summary', /name !== 'debtfree-reminder-state'/.test(SW));

  // ── App side ─────────────────────────────────────────────────────────
  console.log('\n--- app ---');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  const got = [];
  await ctx.route('https://debtfree-reminders.debtfreedashboard.workers.dev/**', async r => {
    const u = r.request().url();
    if (u.endsWith('/push/key')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'BEPmUj24L6PHNK5E2g-8I57DDE1LSvTzKWIwFmEVqFDxL9AesAhg7T9qaaBrB0SrEnXLWGc_iJ9nkfDJlLjUBCU' }) });
    got.push({ path: new URL(u).pathname, body: JSON.parse(r.request().postData() || '{}') });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1'); } catch (e) {}
    // Stub the parts a headless browser can't do.
    window.Notification = { permission: 'default', requestPermission: async () => 'granted' };
    window.PushManager = function () {};
    window.__sub = null;
    const fakeReg = { pushManager: {
      getSubscription: async () => window.__sub,
      subscribe: async () => (window.__sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-123', unsubscribe: async () => { window.__sub = null; return true; } })
    } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(fakeReg), register: async () => fakeReg, addEventListener() {}, controller: null, getRegistrations: async () => [] } });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8911/app/dashboard.html');
  await page.waitForTimeout(900);
  await page.evaluate(f => { applyBackupPayload(f); processDuePayments();
    debts.forEach((d, i) => { if (d.balance > 0) d.dueDay = [5, 18, 22, 28, 31, 10, 15, 20, 25][i % 9]; }); save(); render(); }, FIXTURE);
  await page.waitForTimeout(400);

  await page.evaluate(() => openCalReminders());
  await page.waitForTimeout(500);
  const ui = await page.evaluate(() => document.getElementById('push-box').innerText);
  check('reminders sheet offers notifications with the three cadences', /Turn on notifications/.test(ui) && /before each payment/.test(ui), ui.replace(/\n/g, ' | '));

  await page.evaluate(async () => { document.getElementById('push-cadence').value = 'before'; document.getElementById('cal-lead').value = '3'; await pushSaveFromSheet(); });
  await page.waitForTimeout(300);
  const sub = got.find(g => g.path === '/push/subscribe');
  const names = await page.evaluate(() => debts.map(d => d.name));
  const sent = JSON.stringify(sub && sub.body);
  check('turning on sends the push address, due days, cadence, lead, time zone and hour', !!sub
    && JSON.stringify(Object.keys(sub.body).sort()) === JSON.stringify(['cadence', 'days', 'endpoint', 'hour', 'lead', 'tz']), sent);
  check('no debt name, amount or balance leaves the device', !names.some(n => sent.includes(n)) && !/\$|balance|apr/i.test(sent));
  const state = await page.evaluate(async () => { const r = await (await caches.open('debtfree-reminder-state')).match('/__reminders'); return r ? r.json() : null; });
  check('the wording summary is kept on the phone, private by default', state && state.debts.length > 0 && state.debts.every(d => d.n === null && d.m === null), JSON.stringify(state && state.debts[0]));
  const foot = await page.evaluate(() => { closeCalReminders(); return document.getElementById('tm-foot').innerText; });
  check('This Month says notifications are on', /Notifications on/.test(foot), foot.replace(/\n/g, ' | '));

  // A due day changes: the server hears about it once.
  const n0 = got.length;
  await page.evaluate(() => { debts.find(d => d.balance > 0).dueDay = 3; save(); render(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => render());
  await page.waitForTimeout(300);
  const resync = got.slice(n0).filter(g => g.path === '/push/subscribe');
  check('a changed due day is sent once, quietly', resync.length === 1 && resync[0].body.days.includes(3), JSON.stringify(resync.map(r => r.body.days)));

  // Names on: only the on-phone summary changes.
  await page.evaluate(async () => { openCalReminders(); document.getElementById('cal-names').checked = true; await pushSaveFromSheet(); closeCalReminders(); });
  await page.waitForTimeout(300);
  const state2 = await page.evaluate(async () => (await (await caches.open('debtfree-reminder-state')).match('/__reminders')).json());
  const last = got.filter(g => g.path === '/push/subscribe').pop();
  check('names on: names appear in the on-phone summary only', state2.debts.some(d => d.n) && !names.some(n => JSON.stringify(last.body).includes(n)));

  await page.evaluate(async () => { await pushOffFromSheet(); });
  const off = got.filter(g => g.path === '/push/unsubscribe');
  const cleared = await page.evaluate(async () => !(await (await caches.open('debtfree-reminder-state')).match('/__reminders')) && !localStorage.getItem('debtfree_push'));
  check('turning off unsubscribes and clears the summary', off.length === 1 && cleared);

  // iPhone in a Safari tab: explains Add to Home Screen.
  const ipCtx = await b.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1' });
  await ipCtx.addInitScript(() => { try { localStorage.setItem('debtfree_demo_dismissed', '1'); } catch (e) {} delete window.PushManager; });
  await ipCtx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  const ip = await ipCtx.newPage();
  await ip.goto('http://localhost:8911/app/dashboard.html'); await ip.waitForTimeout(800);
  const ipTxt = await ip.evaluate(f => { applyBackupPayload(f); debts[0].dueDay = 5; render(); openCalReminders(); return document.getElementById('push-box').innerText; }, FIXTURE);
  check('iPhone Safari tab: explains Add to Home Screen', /Home Screen/.test(ipTxt), ipTxt);

  // The service can't be reached: no button that would fail.
  const dCtx = await b.newContext();
  await dCtx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await dCtx.route('https://debtfree-reminders.debtfreedashboard.workers.dev/**', r => r.abort());
  await dCtx.addInitScript(() => { try { localStorage.setItem('debtfree_demo_dismissed', '1'); } catch (e) {} window.Notification = { permission: 'default', requestPermission: async () => 'granted' }; window.PushManager = function () {}; });
  const dp = await dCtx.newPage();
  await dp.goto('http://localhost:8911/app/dashboard.html'); await dp.waitForTimeout(800);
  await dp.evaluate(f => { applyBackupPayload(f); debts[0].dueDay = 5; render(); openCalReminders(); }, FIXTURE);
  await dp.waitForTimeout(800);
  const dTxt = await dp.evaluate(() => document.getElementById('push-box').innerText);
  check('service unreachable: says so, offers no button', /aren.t available/.test(dTxt) && !/Turn on/.test(dTxt), dTxt);

  check('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass === results.length ? 'ALL PASS' : 'FAILURES PRESENT'}  (${pass}/${results.length})`);
  process.exit(pass === results.length ? 0 : 1);
})();
