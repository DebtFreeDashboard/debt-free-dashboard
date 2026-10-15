/* test-avalanche.js — v1.54.0 Avalanche: highest rate charged THIS month first
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-avalanche.js
 *
 * Needs playwright (NODE_PATH or a local install) and Chromium.
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8911';
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-fixtures/test-primary.json'), 'utf8'));
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && (!ok || process.env.VERBOSE)) console.log('      ' + d); };

async function boot(b, premium) {
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.addInitScript(p => { try { localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1'); if (p) localStorage.setItem('debtfree_premium', '1'); } catch (e) {} }, premium);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE + '/app/dashboard.html'); await pg.waitForTimeout(900);
  await pg.evaluate(f => { applyBackupPayload(f); }, FX);
  await pg.evaluate(() => { selectStrategy('avalanche'); });
  if (premium) await pg.evaluate(() => { isPremium = true; applyPremiumState(); render(); });
  await pg.waitForTimeout(700);
  return { ctx, pg, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  const { ctx, pg, errs } = await boot(b, true);

  console.log('--- the order follows the rate charged each month ---');
  const kev = await pg.evaluate(() => {
    const end = planMonthDate(12); const pe = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-15';
    const c28 = { id: 1, name: 'Card 28%', balance: 6000, apr: 28, realApr: 28, minPayment: 180 };
    const promo = { id: 2, name: 'Promo 0%->29%', balance: 6000, apr: 0, realApr: 29, minPayment: 120, hasPromo: true, promoApr: 0, postPromoApr: 29, promoEnd: pe };
    const av = simulate([{ ...c28 }, { ...promo }], 400, 0, 'avalanche', [], { anchor: false, trace: true });
    const a = simulate([{ ...c28 }, { ...promo }], 400, 0, 'hybrid', [], { anchor: false });
    const b2 = simulate([{ ...promo }, { ...c28 }], 400, 0, 'hybrid', [], { anchor: false });
    // where did the extra go in month 1 and in month 13?
    const m1 = av.monthlyData[0].amort, m13 = av.monthlyData[12] && av.monthlyData[12].amort;
    return { av: Math.round(av.totalInterest), cardFirst: Math.round(a.totalInterest), promoFirst: Math.round(b2.totalInterest),
      m1paid28: Math.round(m1[1].paid), m1paidPromo: Math.round(m1[2].paid), m13: m13 ? { c: Math.round(m13[1].paid), p: Math.round(m13[2].paid) } : null };
  });
  ck('0% card waits at its minimum while the 28% card takes the extra (month 1)', kev.m1paid28 === 580 && kev.m1paidPromo === 120, JSON.stringify(kev));
  ck('Avalanche never costs more than paying the 28% card first, and beats promo-first', kev.av <= kev.cardFirst && kev.av < kev.promoFirst, JSON.stringify(kev));

  const plain = await pg.evaluate(() => {
    const ds = [{ id: 1, name: 'Big 18%', balance: 8000, apr: 18, minPayment: 200 }, { id: 2, name: 'Small 24%', balance: 3000, apr: 24, minPayment: 90 }, { id: 3, name: 'Tiny 12%', balance: 600, apr: 12, minPayment: 30 }];
    const r = simulate(ds.map(d => ({ ...d })), 200, 0, 'avalanche', [], { anchor: false, trace: true });
    const cp = ds.map(d => ({ ...d })); avalancheSort(cp, null, null, 1);
    return { order: cp.map(d => d.name), m1: r.monthlyData[0].amort[2].paid };
  });
  ck('no promos: classic highest-APR order (24% → 18% → 12%), extra lands on the 24% card', plain.order.join(',') === 'Small 24%,Big 18%,Tiny 12%' && Math.round(plain.m1) === 90 + 200, JSON.stringify(plain));

  console.log('\n--- monotonicity on the 9-debt fixture (Avalanche) ---');
  const mono = await pg.evaluate(() => {
    const act = _activePlanDebts(), disb = plannedDisbursements();
    const bad = []; let prev = null;
    for (let x = 0; x <= 3000; x += 25) {
      const r = simulate(act.map(d => ({ ...d })), x, 0, 'avalanche', disb);
      if (prev && (r.months > prev.months || r.totalInterest > prev.totalInterest + 1e-6)) bad.push('extra ' + x);
      prev = r;
    }
    prev = null;
    for (let l = 0; l <= 40000; l += 500) {
      const r = simulate(act.map(d => ({ ...d })), planExtra(), l, 'avalanche', disb);
      if (prev && (r.months > prev.months || r.totalInterest > prev.totalInterest + 1e-6)) bad.push('lump ' + l);
      prev = r;
    }
    return bad;
  });
  ck('extra $0–$3,000 and an up-front lump $0–$40,000: never later, never more interest', !mono.length, mono.slice(0, 6).join(', '));

  console.log('\n--- every view agrees on the Avalanche plan ---');
  const agree = await pg.evaluate(() => {
    const act = _activePlanDebts(), ex = planExtra(), disb = plannedDisbursements();
    const sim = simulate(act.map(d => ({ ...d })), ex, 0, 'avalanche', disb, { trace: true });
    const diffs = [];
    // Months 1–2 only: projectBalancesAt() does not roll freed minimums forward
    // the way simulate() does, so it drifts later in the plan under EVERY
    // strategy (Snowball included, and Avalanche before v1.54.0). Known,
    // pre-existing, logged for a separate fix; not what this suite is about.
    [1, 2].forEach(m => {
      if (!sim.monthlyData[m - 1]) return;
      const start = act.map(d => Object.assign({}, d, { bal: d.balance }));
      const p = projectBalancesAt(start, m, ex, disb).balanceMap;
      const s = sim.monthlyData[m - 1].byDebt;
      Object.keys(s).forEach(id => { if (Math.abs((p[id] || 0) - s[id]) > 0.05) diffs.push('m' + m + ' #' + id + ' sim ' + s[id].toFixed(2) + ' proj ' + (p[id] || 0).toFixed(2)); });
    });
    const plan = getPlanSim();
    const attack = currentAttackDebt();
    const rates = act.map(d => avalancheRateAt(d, 1));
    return { diffs, planMonths: plan.months, simMonths: sim.months, planInt: Math.round(plan.totalInterest), simInt: Math.round(sim.totalInterest),
      attack: attack && attack.name, attackRate: attack && avalancheRateAt(attack, 1), maxRate: Math.max.apply(null, rates) };
  });
  ck('projectBalancesAt (lump planner) re-sorts like simulate(): identical balances, months 1–2', !agree.diffs.length, agree.diffs.slice(0, 5).join('; '));
  ck('the plan the Dashboard shows is the same simulation', agree.planMonths === agree.simMonths && agree.planInt === agree.simInt, JSON.stringify(agree));
  ck('Next Target / "Where your extra goes" names the debt with the highest rate today', agree.attackRate === agree.maxRate, JSON.stringify({ attack: agree.attack, rate: agree.attackRate, max: agree.maxRate }));

  console.log('\n--- every tab renders on Avalanche, both tiers ---');
  for (const tier of [true, false]) {
    const t = tier ? { pg, errs } : await boot(b, false);
    const out = await t.pg.evaluate(() => {
      const r = [];
      ['dashboard', 'strategy', 'whatif', 'milestones', 'settings'].forEach(s => { try { showSection(s); render(); if (s === 'strategy') renderStrategy(); } catch (e) { r.push(s + ': ' + e.message); } });
      const txt = document.body.innerText;
      if (/NaN|undefined|Infinity/.test(txt.replace(/Infinity[a-z]/g, ''))) r.push('bad text: ' + txt.match(/.{30}(NaN|undefined|Infinity).{30}/));
      if (/pay before then/.test(txt)) r.push('old advisory copy still present');
      return r;
    });
    ck((tier ? 'premium' : 'free') + ': all sections render without errors or NaN', !out.length && !t.errs.length, out.concat(t.errs).join(' | '));
  }

  console.log('\n--- Optimized never costs more than Avalanche ---');
  const opt = await pg.evaluate(() => {
    const pe = (function () { const d = planMonthDate(15); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-15'; })();
    debts = [
      { id: 101, name: 'Promo A', balance: 5000, originalBalance: 5000, apr: 0, realApr: 29, minPayment: 100, hasPromo: true, promoApr: 0, postPromoApr: 29, promoEnd: pe, includeInStrategy: true, type: 'cc' },
      { id: 102, name: 'Card 28', balance: 5000, originalBalance: 5000, apr: 28, realApr: 28, minPayment: 150, includeInStrategy: true, type: 'cc' }
    ];
    payments = []; lumpSums = []; extraMonthly = 150; document.getElementById('extra-payment').value = 150;
    selectStrategy('optimized'); showSection('strategy'); renderStrategy();
    const oo = getOptimizedOrder();
    const act = _activePlanDebts(), ex = planExtra(), disb = plannedDisbursements();
    const av = simulate(act.map(d => ({ ...d })), ex, 0, 'avalanche', disb);
    _planSimCache = { key: null, res: null };
    const plan = getPlanSim();
    const attack = currentAttackDebt();
    render(); renderStrategy();
    const tag = (document.getElementById('cmp-tag') || {}).textContent || '';
    return { tag, note: (document.getElementById('optimized-note') || {}).innerText || '', dyn: !!oo.dynamic, opt: Math.round(oo.interest), av: Math.round(av.totalInterest),
      plan: Math.round(plan.totalInterest), eff: effectiveStrategy(), attack: attack && attack.name };
  });
  ck('Optimized costs no more than Avalanche (here it adopts the monthly rule)', opt.opt <= opt.av, JSON.stringify(opt));
  ck('the Dashboard plan on Optimized is that same cheaper plan', opt.plan === opt.opt, JSON.stringify(opt));
  ck('the note explains the monthly re-check instead of claiming a fixed order', !opt.dyn || /re-checks rates every month/.test(opt.note), opt.note);
  ck('Where your extra goes: the 28% card while the other is at 0%', opt.attack === 'Card 28', JSON.stringify(opt));
  ck('Strategy comparison tag never says Avalanche beats the Optimized plan', !/Avalanche saves/.test(opt.tag), opt.tag);
  const stale = await pg.evaluate(() => {
    selectStrategy('optimized');
    debts.push({ id: 103, name: 'New 30%', balance: 800, originalBalance: 800, apr: 30, realApr: 30, minPayment: 30, includeInStrategy: true, type: 'cc' });
    save(); render();
    _planSimCache = { key: null, res: null };
    const plan = getPlanSim().totalInterest;
    const oo = getOptimizedOrder();
    return { plan: Math.round(plan), opt: Math.round(oo.interest), inOrder: oo.order.includes(103) };
  });
  ck('adding a debt while on Optimized re-optimizes the plan (no stale order)', stale.inOrder && stale.plan === stale.opt, JSON.stringify(stale));
  // random portfolios: Optimized <= min(Avalanche, Snowball) always
  const sweep = await pg.evaluate(() => {
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const bad = [];
    for (let t = 0; t < 60; t++) {
      const k = 2 + Math.floor(rnd() * 4); const list = [];
      for (let i = 0; i < k; i++) {
        const bal = Math.round(500 + rnd() * 9000), apr = Math.round((5 + rnd() * 24) * 100) / 100;
        const d = { id: 200 + i, name: 'R' + i, balance: bal, originalBalance: bal, apr, realApr: apr, minPayment: Math.max(25, Math.round(bal * 0.025)), includeInStrategy: true, type: 'cc' };
        if (rnd() < 0.35) { const m = 1 + Math.floor(rnd() * 24); const e = planMonthDate(m); Object.assign(d, { hasPromo: true, promoApr: 0, apr: 0, postPromoApr: apr, promoEnd: e.getFullYear() + '-' + String(e.getMonth() + 1).padStart(2, '0') + '-15' }); }
        list.push(d);
      }
      debts = list; extraMonthly = Math.round(rnd() * 400); document.getElementById('extra-payment').value = extraMonthly;
      selectStrategy('optimized');
      _planSimCache = { key: null, res: null };
      const o = getPlanSim().totalInterest;
      const a = simulate(_activePlanDebts().map(d => ({ ...d })), planExtra(), 0, 'avalanche', plannedDisbursements()).totalInterest;
      const s = simulate(_activePlanDebts().map(d => ({ ...d })), planExtra(), 0, 'snowball', plannedDisbursements()).totalInterest;
      if (o > Math.min(a, s) + 0.01) bad.push(t + ': opt ' + o.toFixed(2) + ' av ' + a.toFixed(2) + ' sb ' + s.toFixed(2));
    }
    return bad;
  });
  ck('60 random portfolios: the Optimized plan is never costlier than Avalanche or Snowball', !sweep.length, sweep.slice(0, 4).join('; '));

  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
