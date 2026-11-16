// v1.73.0 — Total Owed, progress and the other headline figures count only
// debts in the payoff plan. Seeds a plan with one excluded lease and one
// excluded mortgage, then checks the hero, the excluded line, progress %,
// Interest/mo, the Wins figures, recaps, the share card, the What-If lump
// slider, debt-free, and that the switch and an include/exclude toggle never
// celebrate a win nobody paid for. Needs the repo root on 8911.
const { chromium } = require('playwright');
const path = require('path');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const near = (a, b) => Math.abs(a - b) < 0.01;

const today = new Date();
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysAgo = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
const base = { hasPromo: false, transferFee: 0, promoApr: null, promoEnd: null, postPromoApr: null };
const debts = [
  Object.assign({ id: 1, name: 'Visa', type: 'cc', balance: 4000, originalBalance: 5000, apr: 22.99, realApr: 22.99, regularApr: 22.99, minPayment: 120, loanType: 'revolving', includeInStrategy: true }, base),
  Object.assign({ id: 2, name: 'Discover', type: 'cc', balance: 2000, originalBalance: 3000, apr: 18, realApr: 18, regularApr: 18, minPayment: 60, loanType: 'revolving', includeInStrategy: true }, base),
  Object.assign({ id: 3, name: 'Jeep Lease', type: 'auto', balance: 11055, originalBalance: 11390, apr: 0, realApr: 0, regularApr: 0, minPayment: 335, loanType: 'installment', includeInStrategy: false, termMonths: 33 }, base),
  Object.assign({ id: 4, name: 'Mortgage', type: 'mortgage', balance: 200000, originalBalance: 200000, apr: 6, realApr: 6, regularApr: 6, minPayment: 1400, loanType: 'installment', includeInStrategy: false }, base)
];
const payments = [
  { id: 11, debtId: 1, debtName: 'Visa', amount: 1000, date: daysAgo(20), eliminated: false },
  { id: 12, debtId: 2, debtName: 'Discover', amount: 1000, date: daysAgo(18), eliminated: false },
  { id: 13, debtId: 3, debtName: 'Jeep Lease', amount: 335, date: daysAgo(10), eliminated: false }
];
const seed = { debtfree_last_seen_version: '9.9.9', debtfree_demo_dismissed: '1', debtfree_setup_finish: 'done',
  debtfree_debts: JSON.stringify(debts), debtfree_payments: JSON.stringify(payments), debtfree_extra: '200',
  debtfree_milestones: JSON.stringify(['d.debt1', 'd.pay1']), debtfree_badges_seeded: '1' };

async function open(browser, s, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
  await ctx.addInitScript(s => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    localStorage.clear(); Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v));
  }, s);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url || 'http://localhost:8911/app/dashboard.html'); await p.waitForTimeout(2600);
  return { ctx, p, errs };
}

(async () => {
  const browser = await chromium.launch();
  console.log('Headline figures cover the plan only');
  let { ctx, p, errs } = await open(browser, seed);
  let r = await p.evaluate(() => ({
    total: document.getElementById('stat-total').textContent, acc: document.getElementById('hero-accounts').textContent,
    ex: document.getElementById('hero-excluded').hidden ? null : document.getElementById('hero-excluded').textContent,
    tb: totalBalance(), to: totalOriginal(), tp: totalPaid(), pct: progressPct(), mi: monthlyInterest(),
    interestTxt: document.getElementById('stat-interest').textContent, legend: document.getElementById('hero-legend').textContent,
    ringPct: document.getElementById('hero-ring-pct').textContent, barPct: document.getElementById('progress-pct').textContent,
    ex2: excludedSummary(), seeded: localStorage.getItem('debtfree_plan_scope'),
    ms: JSON.parse(localStorage.getItem('debtfree_milestones')), log: JSON.parse(localStorage.getItem('debtfree_ms_log') || '{}')
  }));
  ok(near(r.tb, 6000) && r.total === '$6,000', 'Total Owed is the plan: $6,000 (was $217,055 with the lease and mortgage)');
  ok(r.acc === 'across 2 accounts in your plan', 'subline: "' + r.acc + '"');
  ok(r.ex && /\+\$211,055 not in your plan/.test(r.ex) && /2 accounts/.test(r.ex) && /\$1,000\/mo interest/.test(r.ex), 'excluded line: "' + r.ex + '"');
  ok(near(r.to, 8000) && near(r.pct, 25), 'progress is plan only: $2,000 of $8,000 = 25%');
  ok(r.ringPct === '25.0%' && r.barPct === '25.0%', 'ring and bar both read 25.0%');
  ok(near(r.tp, 2000), 'total paid leaves out the $335 lease payment');
  ok(near(r.mi, 4000 * 0.2299 / 12 + 2000 * 0.18 / 12) && near(r.ex2.interest, 1000), 'Interest/mo is plan only; the mortgage\'s $1,000 is on the excluded line');
  ok(!/Jeep|Mortgage/.test(r.legend), 'by-account split leaves out excluded debts');
  ok(r.seeded === '1', 'switch recorded once on this device');
  ok(r.ms.indexOf('b.pct.25') !== -1 && r.ms.indexOf('b.pct.20') !== -1 && !(r.log['b.pct.25'] && r.log['b.pct.25'].e), 'wins the switch made true are noted quietly, with no earned date');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));

  console.log('Wins tab, share card, What-If, recaps');
  await p.evaluate(() => showSection('milestones')); await p.waitForTimeout(200);
  r = await p.evaluate(() => ({ pct: document.getElementById('ms-total-paid').textContent, sub: document.getElementById('ms-total-paid-sub').textContent }));
  ok(r.pct === '25.0%' && r.sub === '$2,000 of $8,000', 'Wins: 25.0%, "$2,000 of $8,000"');
  await p.evaluate(() => shareProgress()); await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ c: _celebrateContent }));
  ok(r.c && /25%/.test(r.c.big + r.c.sub + (r.c.headline || '')), 'share card says 25%');
  await p.evaluate(() => closeCelebrate());
  r = await p.evaluate(() => { showSection('whatif'); resetWiInputs(); return +document.getElementById('wi-lump').max; });
  ok(r === 20000, 'What-If lump slider is sized to the plan (20,000 floor, not 217,055)');
  r = await p.evaluate(() => { const d = recapData('2000-01-01', localDateStr(new Date())); return { paid: d.paid, count: d.count, owedEnd: d.owedEnd }; });
  ok(near(r.paid, 2000) && r.count === 2 && near(r.owedEnd, 6000), 'recap: $2,000 in 2 payments, owed now $6,000 (lease left out)');

  console.log('No win celebrates without a payment');
  r = await p.evaluate(() => { _msCauseAt = { l: Date.now(), p: 0, m: 0 }; const before = shownMilestones.slice(); checkMilestones();
    return { overlay: !document.getElementById('celebrate-overlay').classList.contains('hidden'), h: document.getElementById('celebrate-headline').textContent }; });
  ok(!(r.overlay && /25%|quarter|20%/i.test(r.h)), 'a payment right after the switch does not celebrate 20% / a quarter gone' + (r.overlay ? ' (showed: ' + r.h + ')' : ''));
  await p.evaluate(() => { try { closeCelebrate(); } catch (e) {} });

  console.log('Moving a debt in and out of the plan');
  r = await p.evaluate(() => {
    openEditModal(3); document.getElementById('edit-include-strategy').checked = true; saveEditDebt();
    const a = { tb: totalBalance(), pct: progressPct(), ex: document.getElementById('hero-excluded').textContent };
    openEditModal(3); document.getElementById('edit-include-strategy').checked = false; saveEditDebt();
    return { a: a, b: { tb: totalBalance(), pct: progressPct() } };
  });
  ok(near(r.a.tb, 17055) && /\+\$200,000 not in your plan/.test(r.a.ex) && /Mortgage/.test(r.a.ex), 'lease back in the plan: $17,055 owed, excluded line names the mortgage');
  ok(near(r.b.tb, 6000) && near(r.b.pct, 25), 'and out again: back to $6,000 and 25%');

  console.log('Debt-free when the plan is clear');
  await ctx.close();
  const cleared = debts.map(d => d.includeInStrategy ? Object.assign({}, d, { balance: 0 }) : d);
  ({ ctx, p, errs } = await open(browser, Object.assign({}, seed, { debtfree_debts: JSON.stringify(cleared) })));
  r = await p.evaluate(() => ({ keys: milestoneKeysAchieved(), total: document.getElementById('stat-total').textContent, acc: document.getElementById('hero-accounts').textContent, ex: document.getElementById('hero-excluded').textContent }));
  ok(r.keys.indexOf('debtfree') !== -1, 'plan cleared counts as debt-free even with a lease and mortgage left out');
  ok(r.total === '$0' && r.acc === 'nothing left in your plan' && /not in your plan/.test(r.ex), 'hero: $0, "nothing left in your plan", excluded line still shown');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  console.log('Nothing excluded: unchanged');
  ({ ctx, p, errs } = await open(browser, Object.assign({}, seed, { debtfree_debts: JSON.stringify(debts.slice(0, 2)), debtfree_payments: JSON.stringify(payments.slice(0, 2)) })));
  r = await p.evaluate(() => ({ acc: document.getElementById('hero-accounts').textContent, hid: document.getElementById('hero-excluded').hidden, total: document.getElementById('stat-total').textContent }));
  ok(r.acc === 'across 2 accounts' && r.hid && r.total === '$6,000', 'no excluded debts: "across 2 accounts", no extra line');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  console.log('Example screen');
  ({ ctx, p, errs } = await open(browser, { debtfree_last_seen_version: '9.9.9' }));
  ok(await p.evaluate(() => _demoMode && document.getElementById('hero-excluded').hidden), 'example screen shows no excluded line');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  await browser.close();
  console.log(fail ? `FAILURES PRESENT  (${pass}/${pass + fail})` : `ALL PASS  (${pass}/${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
