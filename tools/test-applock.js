/*
 * test-applock.js — v1.67.0 app lock, bottom tab bar, This Month calendar.
 *
 * Runs on the local server (localhost is a secure context, so a virtual
 * platform authenticator can stand in for Face ID / fingerprint).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART = fs.readFileSync(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-primary.json'), 'utf8'));
const URL = 'http://localhost:8911/app/dashboard.html';

const results = [];
const check = (label, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.addInitScript(() => {
    try { localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1'); } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept('2468'));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.clock.install({ time: new Date('2026-11-13T09:00:00') });
  await page.goto(URL);
  await page.waitForTimeout(1000);
  await page.evaluate(f => { applyBackupPayload(f); processDuePayments(); render(); }, FIXTURE);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')));

  // ── Bottom bar ───────────────────────────────────────────────────────
  console.log('--- bottom tab bar ---');
  const nav = await page.evaluate(() => {
    const vis = sel => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    const out = { bnav: vis('.bnav'), top: vis('.tab-nav'), gear: vis('.hdr-gear'), fab: vis('#fab-log') };
    document.querySelector('.bnav-item[data-sec="strategy"]').click();
    out.strategy = document.getElementById('section-strategy').classList.contains('active')
      && document.querySelector('.bnav-item[data-sec="strategy"]').classList.contains('active');
    document.querySelector('.hdr-gear').click();
    out.settings = document.getElementById('section-settings').classList.contains('active');
    document.querySelector('.bnav-item[data-sec="dashboard"]').click();
    document.querySelector('.bnav-plus').click();
    out.sheet = !document.getElementById('plus-sheet').classList.contains('hidden');
    out.batchOpt = getComputedStyle(document.getElementById('plus-batch')).display !== 'none';
    document.querySelector('#plus-sheet .plus-btn').click();
    out.log = !document.getElementById('quicklog-modal').classList.contains('hidden');
    closeQuickLog();
    return out;
  });
  check('phone: bottom bar and gear shown, top tabs and floating button hidden', nav.bnav && !nav.top && nav.gear && !nav.fab, JSON.stringify(nav));
  check('bar tabs switch sections and mark the active one; gear opens Settings', nav.strategy && nav.settings);
  check('"+" opens the sheet with Paid as planned; Log a payment opens the log form', nav.sheet && nav.batchOpt && nav.log);
  await page.setViewportSize({ width: 1200, height: 900 });
  const wide = await page.evaluate(() => ({ bnav: getComputedStyle(document.querySelector('.bnav')).display, top: getComputedStyle(document.querySelector('.tab-nav')).display, fab: getComputedStyle(document.getElementById('fab-log')).display }));
  check('wide screen: top tabs and floating button, no bottom bar', wide.bnav === 'none' && wide.top !== 'none' && wide.fab !== 'none', JSON.stringify(wide));
  await page.setViewportSize({ width: 390, height: 844 });

  // ── Calendar view ────────────────────────────────────────────────────
  console.log('\n--- calendar view ---');
  const cal = await page.evaluate(() => {
    debts.forEach((d, i) => { if (d.balance > 0) d.dueDay = [5, 18, 22, 28, 31, 10, 15, 20, 25][i % 9]; });
    render(); setTmView('cal');
    const cells = document.querySelectorAll('#upcoming-body .tmc-cell:not(.tmc-empty)').length;
    const dots = document.querySelectorAll('#upcoming-body .tmc-dot').length;
    const items = tmCalendarItems();
    const d18 = items.filter(i => i.date.getDate() === 18);
    tmCalPick(18);
    const dayText = document.querySelector('.tmc-day').innerText;
    const v = localStorage.getItem('debtfree_tm_view');
    // log a payment on the 18th's debt and see its dot turn done
    const id = d18[0].id;
    tmLogNow(id);
    const after = tmCalendarItems().find(i => i.id === id && i.date.getDate() === 18);
    setTmView('list');
    return { cells, dots, n: items.length, d18: d18.map(i => i.name), dayText, v, after: after && after.status,
             list: !!document.querySelector('#upcoming-body .tm-swipe') };
  });
  check('calendar: one cell per day of November, a dot per due item', cal.cells === 30 && cal.dots >= 1, `${cal.cells} days, ${cal.dots} dots, ${cal.n} items`);
  check('calendar: tapping a day lists what is due that day', cal.d18.length > 0 && cal.d18.every(n => cal.dayText.includes(n)), cal.dayText.replace(/\n/g, ' | '));
  check('calendar: the view choice is remembered', cal.v === 'cal');
  check('calendar: a logged payment marks its day done', cal.after === 'done', cal.after);
  check('back to list view shows the swipe rows', cal.list);

  // ── App lock: PIN ───────────────────────────────────────────────────
  console.log('\n--- app lock ---');
  const set = await page.evaluate(async () => {
    showSection('settings');
    await openLockSetup();
    const bioShown = getComputedStyle(document.getElementById('applock-bio-opt')).display !== 'none';
    document.getElementById('applock-new').value = '1357';
    document.getElementById('applock-new2').value = '1357';
    await saveLockSetup();
    const st = JSON.parse(localStorage.getItem('debtfree_applock'));
    return { bioShown, on: st && st.on, hasHash: !!(st && st.pinHash), noPlain: !JSON.stringify(st).includes('1357'), cred: !!(st && st.cred) };
  });
  check('setup offers Face ID / fingerprint where the phone has it', set.bioShown);
  check('PIN saved as a salted hash, never in plain text', set.on && set.hasHash && set.noPlain);
  check('biometric registered alongside the PIN', set.cred);

  await page.reload();
  await page.waitForTimeout(1000);
  const locked = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('app-locked'),
    hero: getComputedStyle(document.getElementById('hero-card')).visibility,
    screen: getComputedStyle(document.getElementById('applock-screen')).display
  }));
  check('on open: locked, numbers hidden, lock screen shown', locked.cls && locked.hero === 'hidden' && locked.screen !== 'none', JSON.stringify(locked));
  const wrong = await page.evaluate(async () => { document.getElementById('applock-pin').value = '0000'; await lockTryPin();
    return { still: document.documentElement.classList.contains('app-locked'), msg: document.getElementById('applock-msg').textContent }; });
  check('wrong PIN keeps it locked', wrong.still && /match/.test(wrong.msg), wrong.msg);
  const right = await page.evaluate(async () => { document.getElementById('applock-pin').value = '1357'; await lockTryPin();
    return !document.documentElement.classList.contains('app-locked'); });
  check('right PIN unlocks', right);

  const bio = await page.evaluate(async () => { showLockScreen(); await lockTryBio(); return !document.documentElement.classList.contains('app-locked'); });
  check('Face ID / fingerprint unlocks', bio);

  // Away and back: locks again with "right away"
  const away = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return document.documentElement.classList.contains('app-locked');
  });
  check('leaving the app and coming back locks it again', away);

  // Forgot PIN: a minute's wait removes the lock, data untouched
  const forgot = await page.evaluate(async () => {
    const n = debts.length, bal = debts.map(d => d.balance).join();
    lockForgot();
    return { n, bal, shown: getComputedStyle(document.getElementById('applock-forgot-wrap')).display !== 'none' };
  });
  await page.clock.runFor(61000);
  const forgot2 = await page.evaluate(() => ({ locked: document.documentElement.classList.contains('app-locked'),
    st: localStorage.getItem('debtfree_applock'), n: debts.length, bal: debts.map(d => d.balance).join() }));
  check('Forgot PIN: after a minute the lock is removed', forgot.shown && !forgot2.locked && forgot2.st === null, JSON.stringify([forgot.shown, forgot2.locked, forgot2.st]));
  check('Forgot PIN: no debt data touched', forgot.n === forgot2.n && forgot.bal === forgot2.bal);

  // Turning off needs the PIN (biometric absent here)
  const off = await page.evaluate(async () => {
    await openLockSetup(); document.getElementById('applock-bio-on').checked = false;
    document.getElementById('applock-new').value = '2468'; document.getElementById('applock-new2').value = '2468';
    await saveLockSetup();
    await turnOffLock();          // dialog handler answers 2468
    return localStorage.getItem('debtfree_applock');
  });
  check('Turn off asks for the PIN and removes the lock', off === null);

  check('no page errors', errs.length === 0, errs.join(' | '));
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  await b.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass === results.length ? 'ALL PASS' : 'FAILURES PRESENT'}  (${pass}/${results.length})`);
  process.exit(pass === results.length ? 0 : 1);
})();
