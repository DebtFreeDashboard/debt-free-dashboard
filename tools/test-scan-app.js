// v1.77.0 — Fill from a statement, inside the app's Add a Debt card.
// Needs the repo root served on 8911 (python3 -m http.server 8911).
// Statements here are made up and drawn in the browser; never commit real ones.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, d ? '\n        ' + d : ''); } };

const PAGE = body => `<!doctype html><html><body style="margin:0;font:22px Arial,sans-serif;color:#111;background:#fff;width:1206px"><div style="padding:40px">${body}</div></body></html>`;
const CARD = PAGE(`<div style="font-size:34px;font-weight:bold">CITI</div>
<table style="width:560px;margin-top:30px"><tr><td>New balance</td><td align=right>$4,321.09</td></tr><tr><td>Minimum payment due</td><td align=right>$87.00</td></tr>
<tr><td>Payment due date</td><td align=right>12/15/2026</td></tr><tr><td>Credit limit</td><td align=right>$8,000</td></tr></table>
<p style="margin-top:30px">Minimum Payment Warning: If you make only the minimum payment each period, you will pay more in interest.</p>
<div style="margin-top:40px;font-weight:bold">Interest charge calculation</div>
<table style="width:1100px;margin-top:10px"><tr><td>Balance type</td><td>APR</td><td>Balance</td></tr><tr><td>Standard Purch</td><td>22.49% (V)</td><td>$2,321.09</td></tr>
<tr><td>Promotional APR</td><td>0.00%</td><td>06/30/2027 $2,000.00</td></tr></table>
<div style="margin-top:60px;border-top:2px dashed #999;padding-top:20px">New balance $4,321.09<br>Minimum payment due $87.00<br>Payment due date 12/15/2026</div>`);
const MORTGAGE = PAGE(`<div style="font-size:34px;font-weight:bold">Riverside Savings Bank</div><div>Mortgage Statement</div>
<table style="width:560px;margin-top:30px"><tr><td>Outstanding Principal Balance</td><td align=right>$212,400.00</td></tr><tr><td>Interest Rate</td><td align=right>5.25%</td></tr></table>
<table style="width:560px;margin-top:30px"><tr><td>Principal</td><td align=right>$310.00</td></tr><tr><td>Interest</td><td align=right>$929.25</td></tr>
<tr><td>Escrow (Taxes/Insurance)</td><td align=right>$450.00</td></tr><tr><td>Total Amount Due</td><td align=right>$1,689.25</td></tr><tr><td>Payment Due Date</td><td align=right>12/01/2026</td></tr></table>`);
const BILL = PAGE(`<div style="font-size:34px;font-weight:bold">Example Cable</div><table style="width:560px;margin-top:30px"><tr><td>Regular monthly charges</td><td align=right>$120.00</td></tr>
<tr><td>Please pay</td><td align=right>$131.40</td></tr><tr><td>Amount due Oct 08, 2026</td><td align=right>$131.40</td></tr></table>`);

(async () => {
  const b = await chromium.launch();
  const shots = {};
  for (const [k, html] of Object.entries({ CARD, MORTGAGE, BILL })) {
    const pg = await b.newPage({ viewport: { width: 1206, height: 1400 } });
    await pg.setContent(html); shots[k] = path.join(os.tmpdir(), 'df-scanapp-' + k + '-' + process.pid + '.png');
    await pg.screenshot({ path: shots[k], fullPage: true }); await pg.close();
  }
  async function fresh(seed) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
    await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
    await ctx.addInitScript(seed => {
      window.__ev = []; window.gtag = function () { window.__ev.push([].slice.call(arguments)); };
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
      localStorage.clear(); localStorage.setItem('debtfree_last_seen_version', '9.9.9'); Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v));
    }, seed);
    const p = await ctx.newPage();
    const errs = [], off = []; p.on('pageerror', e => errs.push(e.message));
    p.on('request', r => { const u = r.url(); if (/scan|tesseract|traineddata/.test(u) && !u.startsWith('http://localhost:8911')) off.push(u); });
    await p.goto('http://localhost:8911/app/dashboard.html', { waitUntil: 'load' });
    await p.waitForTimeout(700);
    await p.evaluate(() => goAddDebt()); await p.waitForTimeout(400);
    return { ctx, p, errs, off };
  }
  const val = (p, id) => p.evaluate(i => document.getElementById(i).value, id);
  const scan = async (p, file) => {
    await p.click('#scan-cta button'); await p.waitForTimeout(200);
    await p.setInputFiles('#scan-files', [file]);
    await p.waitForFunction(() => document.getElementById('scan-sheet').classList.contains('hidden') || document.getElementById('scan-error').style.display === 'block', null, { timeout: 120000 });
  };

  console.log('A. Card statement fills the form; nothing saved until the person saves');
  let { ctx, p, errs, off } = await fresh({ debtfree_demo_dismissed: '1', debtfree_debts: '[]' });
  const vis = await p.evaluate(() => { const e = document.getElementById('scan-cta'); return !!e && e.getClientRects().length > 0; });
  ok(vis, 'Fill from statement shows at the top of Add a Debt');
  await p.click('#scan-cta button'); await p.waitForTimeout(200);
  const intro = await p.evaluate(() => document.getElementById('scan-intro').innerText);
  ok(/statement/.test(intro) && /APR/.test(intro) && /up to 4/.test(intro) && /Check every number/.test(intro) && /never uploaded or saved/.test(intro), 'sheet explains what to screenshot, checking, and privacy');
  await p.click('#scan-sheet .modal-close');
  await scan(p, shots.CARD);
  let f = await p.evaluate(() => { const debt = i => document.getElementById(i).value; return ({ name: debt('debt-name'), bal: debt('debt-balance'), min: debt('debt-min'), apr: debt('debt-apr'), due: debt('debt-due-day'), lim: debt('debt-credit-limit'), type: debt('debt-type'),
    promo: document.getElementById('debt-has-promo').checked, pend: debt('debt-promo-end'), papr: debt('debt-promo-apr'), post: debt('debt-post-promo-apr'), fee: debt('debt-transfer-fee'),
    banner: document.getElementById('scan-banner').hidden ? '' : document.getElementById('scan-banner').innerText, marked: document.querySelectorAll('.scan-filled').length, saved: debts.length,
    more: document.getElementById('add-more').open }); });
  ok(f.name === 'Citi' && f.bal === '4321.09' && f.min === '87.00' && f.apr === '22.49' && f.due === '15' && f.lim === '8000.00' && f.type === 'cc', 'balance, minimum, APR, due day, limit, lender, type filled', JSON.stringify(f));
  ok(f.promo && f.pend === '2027-06-30' && f.papr === '0' && f.post === '22.49' && f.fee === '', 'promo ticked with end date, 0%, APR after; transfer fee left empty', JSON.stringify(f));
  ok(/please check each number/.test(f.banner) && f.marked >= 6 && f.more, 'banner asks to check, filled fields outlined, More details opened', f.banner);
  ok(f.saved === 0, 'nothing saved by the scan itself');
  await p.fill('#debt-min', '90');
  ok(await p.evaluate(() => !document.getElementById('debt-min').classList.contains('scan-filled')), 'editing a field clears its outline');
  await p.click('#add-another-btn'); await p.waitForTimeout(500);
  let s = await p.evaluate(() => ({ n: debts.length, d: debts[0], banner: document.getElementById('scan-banner').hidden, marked: document.querySelectorAll('.scan-filled').length, ev: [].slice.call(window.dataLayer || []).map(a => [].slice.call(a)).filter(e => e[0] === 'event').map(e => e[1]) }));
  ok(s.n === 1 && s.d.balance === 4321.09 && s.d.minPayment === 90 && s.d.realApr === 22.49 && s.d.hasPromo && s.d.promoEnd === '2027-06-30' && s.d.transferFee === 0 && s.d.dueDay === 15 && s.d.creditLimit === 8000, 'saved debt matches the checked form', JSON.stringify(s.d).slice(0, 300));
  ok(s.banner && s.marked === 0, 'banner and outlines cleared after saving');
  ok(['scan_open', 'scan_done', 'scan_saved'].every(e => s.ev.includes(e)), 'events: scan_open, scan_done, scan_saved', s.ev.join(','));
  const done = await p.evaluate(() => [].slice.call(window.dataLayer || []).map(a => [].slice.call(a)).find(e => e[0] === 'event' && e[1] === 'scan_done')[2]);
  ok(done.pages === 1 && done.kind === 'card' && done.found >= 7 && typeof done.secs === 'number' && Object.keys(done).every(k => ['event_category', 'pages', 'kind', 'found', 'secs'].includes(k)), 'scan_done carries counts only', JSON.stringify(done));
  ok(!errs.length && !off.length, 'no page errors; reader loaded from this site only', JSON.stringify({ errs, off }));
  await ctx.close();

  console.log('B. Mortgage: escrow taken out of the payment');
  ({ ctx, p, errs } = await fresh({ debtfree_demo_dismissed: '1', debtfree_debts: '[]' }));
  await scan(p, shots.MORTGAGE);
  f = await p.evaluate(() => ({ name: document.getElementById('debt-name').value, bal: document.getElementById('debt-balance').value, min: document.getElementById('debt-min').value, apr: document.getElementById('debt-apr').value, type: document.getElementById('debt-type').value, banner: document.getElementById('scan-banner').innerText }));
  ok(f.type === 'mortgage' && f.bal === '212400.00' && f.apr === '5.25' && f.name === 'Riverside Savings Bank', 'mortgage, principal balance, rate, lender', JSON.stringify(f));
  ok(f.min === '1239.25' && /escrow/.test(f.banner), 'minimum is the amount due minus escrow, and the banner says why', JSON.stringify(f));
  ok(!errs.length, 'no page errors');
  await ctx.close();

  console.log('C. A bill fills nothing');
  ({ ctx, p, errs } = await fresh({ debtfree_demo_dismissed: '1', debtfree_debts: '[]' }));
  await scan(p, shots.BILL);
  f = await p.evaluate(() => ({ bal: document.getElementById('debt-balance').value, min: document.getElementById('debt-min').value, banner: document.getElementById('scan-banner').innerText }));
  ok(f.bal === '' && f.min === '' && /bill/.test(f.banner) && /Nothing was filled in/.test(f.banner), 'bill: nothing filled, banner explains', JSON.stringify(f));
  ok(!errs.length, 'no page errors');
  await ctx.close();

  console.log('D. First setup shows it too');
  ({ ctx, p, errs } = await fresh({}));
  await p.evaluate(() => { if (typeof dismissDemo === 'function') dismissDemo('start_my_numbers'); }); await p.waitForTimeout(500);
  await p.evaluate(() => goAddDebt()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const e = document.getElementById('scan-cta'); return !!e && e.getClientRects().length > 0 && !document.getElementById('setup-s1').hidden; }), 'Fill from statement visible in setup step 1');
  await ctx.close();

  Object.values(shots).forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  await b.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
