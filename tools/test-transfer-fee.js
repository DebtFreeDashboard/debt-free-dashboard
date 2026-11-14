// v1.69.3 — a balance-transfer fee is set when the debt is created and never
// changes unless the fee % is edited. Walks one 3% transfer through payments,
// edits, statement check-in, promo off/on, reload and the edit modal's stale
// field, checking the fee dollars, the % shown and the ledger after each step.
// Needs the repo root on 8911.
const { chromium } = require('playwright');
const path = require('path');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    localStorage.clear(); localStorage.setItem('debtfree_last_seen_version', '9.9.9');
    localStorage.setItem('debtfree_demo_dismissed', '1'); localStorage.setItem('debtfree_debts', '[]');
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8911/app/dashboard.html'); await p.waitForTimeout(700);

  const hide = () => p.evaluate(() => { ['celebrate-overlay', 'add-preview-modal'].forEach(id => { const o = document.getElementById(id); if (o) o.classList.add('hidden'); }); });
  const state = id => p.evaluate(id => {
    const d = debts.find(x => x.id === id);
    const pay = payments.filter(x => x.debtId === id && !x.pending).reduce((s, x) => s + x.amount, 0);
    const acc = accruals.filter(x => x.debtId === id).reduce((s, x) => s + x.amount, 0);
    const adj = adjustments.filter(x => x.debtId === id).reduce((s, x) => s + x.amount, 0);
    return { bal: d.balance, orig: d.originalBalance, fee: d.transferFee, rate: d.transferFeeRate, base: d.transferBase, hasPromo: d.hasPromo,
      ledger: Math.abs(d.originalBalance + acc + adj - pay - d.balance) < 0.011 };
  }, id);
  const shown = async id => { await p.evaluate(id => openEditModal(id), id); await p.waitForTimeout(150); const v = await p.evaluate(() => document.getElementById('edit-transfer-fee').value); return v; };
  const saveEdit = async (fn) => { if (fn) await p.evaluate(fn); await p.evaluate(() => saveEditDebt()); await p.waitForTimeout(200); await hide(); };

  console.log('Create a 3% transfer of $3,000');
  await p.evaluate(() => goAddDebt()); await p.waitForTimeout(300);
  await p.fill('#debt-name', 'BT Card'); await p.fill('#debt-balance', '3000'); await p.fill('#debt-apr', '24.99'); await p.fill('#debt-min', '60');
  await p.click('#add-more > summary');
  await p.check('#debt-has-promo'); await p.fill('#debt-promo-end', '2027-06-30'); await p.fill('#debt-post-promo-apr', '24.99'); await p.fill('#debt-transfer-fee', '3');
  await p.click('#add-another-btn'); await p.waitForTimeout(400); await hide();
  const id = await p.evaluate(() => debts[0].id);
  let s = await state(id);
  ok(s.fee === 90 && s.bal === 3090 && s.rate === 3 && s.base === 3000 && s.ledger, 'saved: $90 fee, rate 3, base 3000');

  console.log('Edit balance down with no payments (resets the starting balance)');
  await shown(id); await saveEdit(() => { document.getElementById('edit-balance').value = '2500'; });
  s = await state(id);
  ok(s.fee === 90 && s.rate === 3 && await shown(id) === '3', 'fee stays $90 and shows 3% (was ' + s.orig + ' start)');

  console.log('Log a payment, then edit an unrelated field');
  await p.evaluate(id => logPaymentCore(id, 400, localDateStr(new Date()), ''), id); await p.waitForTimeout(150);
  await shown(id); await saveEdit(() => { document.getElementById('edit-name').value = 'BT Card 2'; });
  s = await state(id);
  ok(s.fee === 90 && s.rate === 3 && s.ledger && await shown(id) === '3', 'after a payment and a rename: $90, 3%, ledger holds');

  console.log('Edit balance up (above the start)');
  await shown(id); await saveEdit(() => { document.getElementById('edit-balance').value = '4000'; });
  s = await state(id);
  ok(s.fee === 90 && await shown(id) === '3', 'raising the balance keeps $90 and 3%');

  console.log('Change the fee to 5%');
  const before = await state(id);
  await shown(id); await saveEdit(() => { const f = document.getElementById('edit-transfer-fee'); f.value = '5'; });
  s = await state(id);
  ok(s.fee === 150 && s.rate === 5 && Math.abs(s.bal - (before.bal + 60)) < 0.01, '5% of the $3,000 transferred = $150; balance moves by +$60, not +$150 (' + before.bal + ' -> ' + s.bal + ')');
  ok(s.ledger, 'ledger still holds after the fee change');
  await shown(id); await saveEdit(() => { const f = document.getElementById('edit-transfer-fee'); f.value = '3'; });
  s = await state(id);
  ok(s.fee === 90 && Math.abs(s.bal - before.bal) < 0.01 && s.ledger, 'back to 3%: $90 and the balance returns to where it was');

  console.log('Promo off, then on again');
  const b2 = await state(id);
  await shown(id); await saveEdit(() => { const c = document.getElementById('edit-has-promo'); c.checked = false; c.dispatchEvent(new Event('change')); });
  s = await state(id);
  ok(!s.hasPromo && s.fee === 90 && s.bal === b2.bal, 'promo off: fee kept on record, balance unchanged');
  const v = await shown(id);
  await saveEdit(() => { const c = document.getElementById('edit-has-promo'); c.checked = true; c.dispatchEvent(new Event('change'));
    document.getElementById('edit-promo-end').value = '2027-06-30'; document.getElementById('edit-post-promo-apr').value = '24.99'; });
  s = await state(id);
  ok(v === '3' && s.hasPromo && s.fee === 90 && s.bal === b2.bal, 'promo on again: no second fee (field showed ' + v + ')');

  console.log('Stale fee field on another debt');
  await p.evaluate(() => goAddDebt()); await p.waitForTimeout(200);
  await p.fill('#debt-name', 'Plain Card'); await p.fill('#debt-balance', '1000'); await p.fill('#debt-apr', '19.99');
  await p.click('#add-another-btn'); await p.waitForTimeout(300); await hide();
  const id2 = await p.evaluate(() => debts.find(d => d.name === 'Plain Card').id);
  await shown(id); await p.evaluate(() => closeEditModal && closeEditModal());
  const v2 = await shown(id2);
  ok(v2 === '', 'opening a debt with no fee clears the fee field (was "' + v2 + '")');
  await saveEdit(() => { const c = document.getElementById('edit-has-promo'); c.checked = true; c.dispatchEvent(new Event('change'));
    document.getElementById('edit-promo-end').value = '2027-03-31'; document.getElementById('edit-post-promo-apr').value = '19.99'; });
  s = await state(id2);
  ok(s.fee === 0 && s.bal === 1000, 'ticking promo there adds no fee nobody typed');

  console.log('Statement check-in up and down');
  const b3 = await state(id);
  for (const target of [b3.bal + 35, b3.bal - 20]) {
    await p.evaluate(([id, t]) => applyStatement(id, t, localDateStr(new Date())), [id, target]); await p.waitForTimeout(150);
    s = await state(id);
    ok(s.fee === 90 && s.ledger && await shown(id) === '3', 'statement to ' + target.toFixed(2) + ': $90, 3%, ledger holds');
    await p.evaluate(() => closeEditModal && closeEditModal());
  }

  console.log('Reload, and an older debt with no stored rate');
  await p.evaluate(() => {
    const legacy = { id: 777, name: 'Old BT', type: 'cc', balance: 4200, originalBalance: 5150, apr: 0, realApr: 22.99, regularApr: 22.99,
      minPayment: 100, promoApr: 0, promoEnd: '2027-01-31', postPromoApr: 22.99, transferFee: 150, hasPromo: true, loanType: 'revolving', includeInStrategy: true };
    const all = JSON.parse(localStorage.getItem('debtfree_debts')); all.push(legacy); localStorage.setItem('debtfree_debts', JSON.stringify(all));
  });
  await p.reload(); await p.waitForTimeout(800); await hide();
  s = await state(id);
  ok(s.fee === 90 && s.rate === 3 && s.base === 3000, 'after reload the stored rate and base are intact');
  const L = await state(777);
  ok(L.fee === 150 && L.rate === 3 && L.base === 5000, 'older debt: rate worked out once as 3% of $5,000');
  ok(await shown(777) === '3', 'and the edit modal shows 3');
  await saveEdit(() => { document.getElementById('edit-transfer-fee').value = '3.5'; });
  const L2 = await state(777);
  ok(L2.fee === 150 && L2.bal === 4200 && L2.rate === 3.5, 'correcting an estimated rate fixes the label, not the $150 charged');

  console.log('Export / import round trip');
  const exported = await p.evaluate(() => JSON.parse(JSON.stringify({ debts: debts })));
  const d0 = exported.debts.find(x => x.id === id);
  ok(d0.transferFeeRate === 3 && d0.transferBase === 3000, 'the rate and base travel with the debt');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fail ? `FAILURES PRESENT  (${pass}/${pass + fail})` : `ALL PASS  (${pass}/${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
