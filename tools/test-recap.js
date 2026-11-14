// v1.70.0 — monthly recap and year in review. Seeds last month's payments and
// a snapshot from the start of last month, then checks the automatic recap,
// its numbers against the ledger, the share card, the Wins link, the once-only
// rule, the year view and that the example screen never shows one.
// Needs the repo root on 8911.
const { chromium } = require('playwright');
const path = require('path');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

const now = new Date();
const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const LM = ym(lm), TM = ym(now);
const day = (base, n) => base + '-' + String(n).padStart(2, '0');
const monthName = lm.toLocaleDateString('en-US', { month: 'long' });

const debts = [
  { id: 1, name: 'Visa', type: 'cc', balance: 4000, originalBalance: 4600, apr: 22.99, realApr: 22.99, regularApr: 22.99, minPayment: 120, hasPromo: false, transferFee: 0, loanType: 'revolving', includeInStrategy: true },
  { id: 2, name: 'Store Card', type: 'cc', balance: 0, originalBalance: 300, apr: 26.99, realApr: 26.99, regularApr: 26.99, minPayment: 25, hasPromo: false, transferFee: 0, loanType: 'revolving', includeInStrategy: true }
];
const payments = [
  { id: 11, debtId: 1, debtName: 'Visa', amount: 300, date: day(LM, 3), eliminated: false },
  { id: 12, debtId: 1, debtName: 'Visa', amount: 300, date: day(LM, 20), eliminated: false },
  { id: 13, debtId: 2, debtName: 'Store Card', amount: 300, date: day(LM, 12), eliminated: true }
];
const snap = {}; snap[LM] = { free: '2032-12', owed: 4900, pct: 5 };

async function open(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
  await ctx.addInitScript(seed => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    localStorage.clear(); Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v));
  }, seed);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8911/app/dashboard.html'); await p.waitForTimeout(2600);
  return { ctx, p, errs };
}
const base = { debtfree_last_seen_version: '9.9.9', debtfree_demo_dismissed: '1', debtfree_debts: JSON.stringify(debts), debtfree_payments: JSON.stringify(payments),
  debtfree_month_snap: JSON.stringify(snap), debtfree_extra: '200', debtfree_setup_finish: 'done', debtfree_milestones: '[]' };

(async () => {
  const browser = await chromium.launch();
  console.log('Automatic monthly recap');
  let { ctx, p, errs } = await open(browser, base);
  let r = await p.evaluate(() => ({ open: !document.getElementById('recap-sheet').classList.contains('hidden'), title: document.getElementById('rc-title').textContent, body: document.getElementById('rc-body').innerText,
    seen: localStorage.getItem('debtfree_recap_seen'), snaps: Object.keys(JSON.parse(localStorage.getItem('debtfree_month_snap') || '{}')) }));
  ok(r.open && r.title === 'Your ' + monthName, 'opens "Your ' + monthName + '" on the first open of the month');
  ok(/\$900/.test(r.body) && /3 payments logged/.test(r.body), 'paid toward debt $900 in 3 payments');
  ok(/Paid off: Store Card/.test(r.body), 'names the debt paid off');
  ok(/months? sooner than Dec 2032/.test(r.body), 'debt-free date compared with the start of the month');
  ok(r.seen === TM && r.snaps.indexOf(TM) !== -1, 'marked seen and this month\'s snapshot recorded');
  const owed = await p.evaluate(() => ({ asOf: owedAsOf(localDateStr(new Date())), total: totalBalance() }));
  ok(Math.abs(owed.asOf - owed.total) < 0.01, 'owed today from the ledger equals the balance (' + owed.asOf + ')');
  ok(!/should|recommend/i.test(r.body), 'neutral wording');
  await p.evaluate(() => shareRecap()); await p.waitForTimeout(300);
  const card = await p.evaluate(() => ({ shown: !document.getElementById('celebrate-overlay').classList.contains('hidden'), h: document.getElementById('celebrate-headline').textContent, c: _celebrateContent }));
  ok(card.shown && card.h === 'My ' + monthName && /paid off/.test(card.c.big) && !/\$/.test(card.c.big + card.c.sub), 'share card: "' + card.c.big + '" / "' + card.c.sub + '", no dollar amounts');
  await p.evaluate(() => closeCelebrate());
  await p.evaluate(() => showSection('milestones')); await p.waitForTimeout(200);
  ok(await p.evaluate(() => /recap/.test(document.getElementById('rc-links').textContent)), 'Wins tab has a link to the recap');
  await p.reload(); await p.waitForTimeout(2600);
  ok(await p.evaluate(() => document.getElementById('recap-sheet').classList.contains('hidden')), 'does not open again the same month');
  console.log('Year in review');
  await p.evaluate(() => openYearReview(new Date().getFullYear())); await p.waitForTimeout(200);
  r = await p.evaluate(() => ({ title: document.getElementById('rc-title').textContent, body: document.getElementById('rc-body').innerText }));
  ok(/in review/.test(r.title) && /\$900/.test(r.body) && /Debts paid off\s*1/i.test(r.body), 'year view: $900 paid and 1 debt paid off');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  console.log('Nothing logged last month');
  ({ ctx, p, errs } = await open(browser, Object.assign({}, base, { debtfree_payments: '[]' })));
  ok(await p.evaluate(() => document.getElementById('recap-sheet').classList.contains('hidden')), 'no recap when last month has no payments');
  await ctx.close();

  console.log('Example screen');
  ({ ctx, p, errs } = await open(browser, { debtfree_last_seen_version: '9.9.9' }));
  ok(await p.evaluate(() => _demoMode && document.getElementById('recap-sheet').classList.contains('hidden') && !localStorage.getItem('debtfree_month_snap')), 'example screen: no recap, no snapshot');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  await browser.close();
  console.log(fail ? `FAILURES PRESENT  (${pass}/${pass + fail})` : `ALL PASS  (${pass}/${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
