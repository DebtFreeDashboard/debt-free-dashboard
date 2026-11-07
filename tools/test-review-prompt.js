/* test-review-prompt.js — v1.55.0 Google Play review prompt
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-review-prompt.js
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && !ok) console.log('      ' + d); };

const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const DEBTS = [{ id: 1, name: 'Card A', balance: 3000, originalBalance: 3500, apr: 22, minPayment: 90, type: 'credit' },
               { id: 2, name: 'Card B', balance: 1200, originalBalance: 1500, apr: 18, minPayment: 40, type: 'credit' }];
const PAYS = [{ id: 11, debtId: 1, debtName: 'Card A', amount: 250, date: day(9), eliminated: false },
              { id: 12, debtId: 2, debtName: 'Card B', amount: 300, date: day(5), eliminated: false }];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function run({ play = true, openDays = [day(10), day(6), day(2)], pays = PAYS, state = null, modal = false, act = 'log' }) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
    await ctx.addInitScript(([d, p, od, st]) => {
      if (sessionStorage.getItem('__seeded')) return;
      localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1');
      localStorage.setItem('debtfree_debts', JSON.stringify(d)); localStorage.setItem('debtfree_payments', JSON.stringify(p));
      localStorage.setItem('debtfree_open_days', JSON.stringify(od));
      if (st) localStorage.setItem('debtfree_review_prompt', JSON.stringify(st));
      sessionStorage.setItem('__seeded', '1');
    }, [DEBTS, pays, openDays, state]);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/app/dashboard.html' + (play ? '?source=twa' : '')); await pg.waitForTimeout(800);
    const out = await pg.evaluate(async ([modal, act]) => {
      window.__opened = 0; openPlayListing = function () { window.__opened++; };
      window.__ev = []; const _ts = trackShare; trackShare = function (a, p) { window.__ev.push(a + ':' + (p && p.choice)); };
      if (modal) document.getElementById('whatsnew-modal').classList.remove('hidden');
      logPaymentCore(1, 50, localDateStr());
      await new Promise(r => setTimeout(r, 2900));
      const shown = !!document.getElementById('review-prompt');
      if (shown && act === 'later') document.getElementById('review-later').click();
      if (shown && act === 'go') document.getElementById('review-go').click();
      const st1 = JSON.parse(localStorage.getItem('debtfree_review_prompt') || '{}');
      // A second payment right away must not ask again.
      logPaymentCore(2, 20, localDateStr());
      await new Promise(r => setTimeout(r, 2900));
      const again = !!document.getElementById('review-prompt');
      const btn = [...document.querySelectorAll('button')].find(x => /Rate DebtFree on Google Play/.test(x.textContent));
      return { shown, again, st1, opened: window.__opened, ev: window.__ev, days: JSON.parse(localStorage.getItem('debtfree_open_days')), rateBtnVisible: !!(btn && btn.offsetParent !== null || (btn && getComputedStyle(btn).display !== 'none')) };
    }, [modal, act]);
    // Settings button visibility (needs the Settings tab shown)
    out.rateBtn = await pg.evaluate(() => { showSection('settings'); const btn = [...document.querySelectorAll('button')].find(x => /Rate DebtFree on Google Play/.test(x.textContent)); return btn ? getComputedStyle(btn).display !== 'none' && btn.offsetHeight > 0 : false; });
    out.errs = errs; await ctx.close(); return out;
  }

  let r = await run({ act: 'later' });
  ck('eligible Play user: prompt shows after a logged payment', r.shown, JSON.stringify(r));
  ck('"Not now" records the ask (shown=1, last set, not done)', r.st1.shown === 1 && r.st1.last > 0 && !r.st1.done, JSON.stringify(r.st1));
  ck('no second ask right after "Not now"', !r.again);
  ck('events: shown + later', r.ev.includes('review_prompt:shown') && r.ev.includes('review_prompt:later'), r.ev.join(','));
  ck('today is recorded as an open day', r.days[r.days.length - 1] === day(0), JSON.stringify(r.days));
  ck('Settings "Rate on Google Play" visible in Play app', r.rateBtn);
  ck('no page errors', !r.errs.length, r.errs.join(' | '));

  r = await run({ act: 'go' });
  ck('"Leave a review" opens the Play listing and ends prompting', r.opened === 1 && r.st1.done === true && !r.again, JSON.stringify(r));

  r = await run({ play: false });
  ck('website (not Play app): never prompts', !r.shown);
  ck('website: Settings rate button hidden', !r.rateBtn);

  r = await run({ openDays: [day(10), day(2)] });
  ck('only 2 open days (+today = 3) still OK? -> today counts', r.shown, JSON.stringify(r.days));

  r = await run({ openDays: [day(10)] });
  ck('fewer than 3 open days: no prompt', !r.shown, JSON.stringify(r.days));

  r = await run({ openDays: [day(4), day(2), day(1)] });
  ck('first use under 7 days ago: no prompt', !r.shown);

  r = await run({ pays: [] });
  ck('first-ever payment (fewer than 2 logged): no prompt', !r.shown);

  r = await run({ state: { shown: 1, last: Date.now() - 30 * 864e5 } });
  ck('asked 30 days ago: no prompt', !r.shown);

  r = await run({ state: { shown: 1, last: Date.now() - 61 * 864e5 } });
  ck('asked 61 days ago: asks again', r.shown);

  r = await run({ state: { shown: 3, last: Date.now() - 200 * 864e5 } });
  ck('already asked 3 times: never again', !r.shown);

  r = await run({ state: { done: true } });
  ck('already reviewed: never again', !r.shown);

  r = await run({ modal: true });
  ck('another dialog open: skips this time', !r.shown);

  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
