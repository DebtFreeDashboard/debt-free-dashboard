// v1.69.0 — add-debt form: four core fields, More details, Save & add another,
// running session strip, type guessed from name/lender, estimated minimum flag.
// Needs the repo root served on 8911 (python3 -m http.server 8911).
const { chromium } = require('playwright');
const path = require('path');
const CHART = path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

async function fresh(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|fonts\.g/, r => r.abort());
  await ctx.addInitScript(seed => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    localStorage.clear(); localStorage.setItem('debtfree_last_seen_version', '9.9.9'); Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v));
  }, seed);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8911/app/dashboard.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  return { ctx, p, errs };
}
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; return e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : e.getClientRects().length > 0; }, sel);

(async () => {
  const browser = await chromium.launch();

  console.log('A. Core form and Save & add another');
  let { ctx, p, errs } = await fresh(browser, { debtfree_demo_dismissed: '1', debtfree_debts: '[]' });
  await p.evaluate(() => goAddDebt()); await p.waitForTimeout(500);
  ok(await vis(p, '#debt-balance') && await vis(p, '#debt-apr') && await vis(p, '#debt-min') && await vis(p, '#debt-name'), 'name, balance, APR and minimum are visible');
  ok(!(await vis(p, '#debt-type')) && !(await vis(p, '#debt-issuer')) && !(await vis(p, '#debt-due-day')) && !(await vis(p, '#debt-has-promo')), 'type, lender, due day and promo are behind More details');
  ok(await vis(p, '#add-another-btn') && await vis(p, '#add-save-btn'), 'both buttons visible');
  ok(await p.evaluate(() => document.getElementById('add-session').hidden), 'session strip hidden before anything is added');

  await p.fill('#debt-name', 'Rewards Visa'); await p.fill('#debt-balance', '5000'); await p.fill('#debt-apr', '22.99');
  await p.click('#add-another-btn'); await p.waitForTimeout(400);
  let st = await p.evaluate(() => ({ n: debts.length, d: debts[0], form: ['debt-name','debt-balance','debt-apr','debt-min'].map(i => document.getElementById(i).value).join('|'), strip: document.getElementById('add-session').hidden ? '' : document.getElementById('add-session').textContent, modal: !document.getElementById('add-preview-modal').classList.contains('hidden') }));
  ok(st.n === 1 && st.d.name === 'Rewards Visa' && st.d.balance === 5000 && st.d.type === 'cc', 'first debt saved as a credit card');
  ok(st.d.minEstimated === true && st.d.minPayment > 0, 'blank minimum estimated and flagged (' + st.d.minPayment + ')');
  ok(st.d.originalBalance === st.d.balance, 'ledger starts balanced');
  ok(st.form === '|||', 'form cleared for the next debt');
  ok(!st.modal, 'no preview modal on Save & add another');
  ok(/1 debt added/.test(st.strip) && /Debt-free date so far/.test(st.strip), 'session strip shows count and date: ' + st.strip.slice(0, 80));
  ok(await p.evaluate(() => document.getElementById('celebrate-overlay').classList.contains('hidden')), 'no celebration popup interrupts adding the next debt');

  await p.fill('#debt-name', 'Car loan');
  ok(await p.evaluate(() => document.getElementById('debt-type').value) === 'auto', 'typing "Car loan" sets type to Auto loan');
  await p.fill('#debt-balance', '9800'); await p.fill('#debt-apr', '6.49'); await p.fill('#debt-min', '340');
  await p.click('#add-another-btn'); await p.waitForTimeout(400);
  st = await p.evaluate(() => ({ n: debts.length, d: debts[1], type: document.getElementById('debt-type').value, strip: document.getElementById('add-session').textContent }));
  ok(st.n === 2 && st.d.type === 'auto' && st.d.loanType === 'installment' && st.d.minEstimated === false && st.d.minPayment === 340, 'car loan saved as installment, typed minimum kept');
  ok(st.type === 'cc', 'type resets to credit card for the next debt');
  ok(/2 debts added/.test(st.strip) && /Rewards Visa/.test(st.strip) && /Car loan/.test(st.strip), 'strip lists both debts');

  await p.fill('#debt-name', 'Store card'); await p.click('#add-another-btn'); await p.waitForTimeout(300);
  st = await p.evaluate(() => ({ n: debts.length, err: document.getElementById('add-debt-error').style.display !== 'none' }));
  ok(st.n === 2 && st.err, 'missing balance blocks the save with a message');
  await p.fill('#debt-name', '');
  await p.click('#add-another-btn'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => debts.length) === 2, 'blank form + add another adds nothing');

  ok(await p.evaluate(() => document.getElementById('add-save-btn').textContent.trim()) === 'Next: monthly plan →', 'first setup: the main button says Next: monthly plan');
  ok(await p.evaluate(() => !document.getElementById('setup-steps').hidden), 'first setup: step bar shows');
  await p.click('#add-save-btn'); await p.waitForTimeout(600);
  st = await p.evaluate(() => ({ s2: !document.getElementById('setup-s2').hidden, s1: !document.getElementById('setup-s1').hidden, n: debts.length,
    preview: !document.getElementById('add-preview-modal').classList.contains('hidden'), finish: !document.getElementById('finish-sheet').classList.contains('hidden'),
    celebrate: !document.getElementById('celebrate-overlay').classList.contains('hidden'), sect: document.querySelector('#section-dashboard, [data-section="dashboard"]') ? 'ok' : 'ok' }));
  ok(st.s2 && !st.s1 && st.n === 2, 'Next with an empty form moves to step 2 in the same card');
  ok(!st.preview && !st.finish && !st.celebrate, 'no preview, no finish popup, no celebration on the way');
  console.log('A2. Monthly plan step');
  await p.evaluate(() => { document.getElementById('ss-amt').value = ''; ssPreview(); });
  const s2a = await p.evaluate(() => ({ mins: _ssMins(), date: document.getElementById('ss-date').textContent, sum: document.getElementById('ss-sum').textContent }));
  ok(s2a.mins === 486 && /Minimums \$486 \+ extra \$0 = \$486/.test(s2a.sum), 'shows minimums + extra = total: ' + s2a.sum);
  await p.evaluate(() => { ssBump(100); ssBump(100); ssBump(100); });
  const s2b = await p.evaluate(() => ({ v: document.getElementById('ss-amt').value, sum: document.getElementById('ss-sum').textContent, date: document.getElementById('ss-date').textContent, gain: document.getElementById('ss-gain').textContent }));
  ok(s2b.v === '300' && /= \$786\/mo/.test(s2b.sum), 'three taps of +$100 make $300 extra, $786 a month');
  ok(s2b.date !== s2a.date && /sooner/.test(s2b.gain), 'date moves and shows the gain: ' + s2a.date + ' -> ' + s2b.date + ' (' + s2b.gain + ')');
  await p.evaluate(() => ssMode('total'));
  ok(await p.evaluate(() => document.getElementById('ss-amt').value) === '786' && /minimums included/.test(await p.evaluate(() => document.getElementById('ss-lbl').textContent)), 'Total shows $786 with its own label');
  await p.evaluate(() => { document.getElementById('ss-amt').value = '400'; ssPreview(); });
  ok(/Minimums alone are \$486/.test(await p.evaluate(() => document.getElementById('ss-sum').textContent)), 'a total under the minimums says so');
  await p.evaluate(() => { document.getElementById('ss-amt').value = '786'; ssPreview(); ssMode('extra'); });
  ok(await p.evaluate(() => document.getElementById('ss-amt').value) === '300', 'back to Extra keeps the same $300');
  await p.evaluate(() => document.querySelector('#setup-s2 .btn-ghost').click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.getElementById('setup-s1').hidden && document.getElementById('setup-s2').hidden && extraMonthly === 300), 'Back returns to the debts and keeps $300');
  await p.click('#add-save-btn'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.getElementById('ss-amt').value) === '300', 'and Next brings it back');
  await p.evaluate(() => document.querySelector('#setup-s2 .btn-primary').click()); await p.waitForTimeout(400);
  console.log('A3. Reminders step');
  const cal = await p.evaluate(() => /calendar/i.test(document.getElementById('ss-notify').textContent));
  ok(cal, 'without notification support (this test browser) it offers calendar reminders in place');
  await p.evaluate(() => { window.pushSupport = () => ({ ok: true }); setupNotifyRender(); });
  const s3 = await p.evaluate(() => ({ on: !document.getElementById('setup-s3').hidden, rows: document.querySelectorAll('#ss-due .ss-due-row').length, btn: !!document.getElementById('ss-push-btn'),
    dis: document.getElementById('ss-push-btn') && document.getElementById('ss-push-btn').disabled }));
  ok(s3.on && s3.rows === 2, 'step 3 lists both debts for due days');
  ok(await p.evaluate(() => document.getElementById('celebrate-overlay').classList.contains('hidden')), 'no celebration popup during setup');
  ok(s3.btn && s3.dis, 'Turn on notifications waits for a due day');
  await p.evaluate(() => { const i = document.querySelectorAll('#ss-due input[data-id]'); i[0].value = '18'; i[1].value = '40'; setupNotifySync(); document.querySelectorAll('#ss-due input[data-ap]')[1].checked = true; });
  ok(await p.evaluate(() => !document.getElementById('ss-push-btn').disabled), 'a due day enables it');
  await p.evaluate(() => setupFinish()); await p.waitForTimeout(700);
  const fs3 = await p.evaluate(() => ({ extra: extraMonthly, field: document.getElementById('extra-payment').value, d0: debts[0].dueDay, d1: debts[1].dueDay, ap1: debts[1].autopay,
    stat: document.getElementById('stat-date').textContent, flag: localStorage.getItem('debtfree_setup_finish'), bar: document.getElementById('setup-steps').hidden,
    btn: document.getElementById('add-save-btn').textContent.trim(), s1: !document.getElementById('setup-s1').hidden }));
  ok(fs3.extra === 300 && fs3.field === '300', 'the plan has $300 extra');
  ok(fs3.d0 === 18 && !fs3.d1 && !fs3.ap1, 'due day 18 saved; invalid 40 ignored; autopay needs a day');
  ok(fs3.stat === s2b.date, 'Home shows the date step 2 showed (' + fs3.stat + ')');
  ok(fs3.flag === 'done' && fs3.bar && fs3.s1 && fs3.btn === 'Save & see my plan', 'setup done: card back to normal Add a Debt');
  await p.waitForTimeout(500);
  const cel = await p.evaluate(() => { const o = document.getElementById('celebrate-overlay'); return { shown: !o.classList.contains('hidden'), h: document.getElementById('celebrate-headline').textContent }; });
  ok(cel.shown && /First debt|Plan avoids/.test(cel.h), 'one held win card shows after See my plan, none during setup: ' + cel.h);
  ok(await p.evaluate(() => _inFirstSetup()) === false, 'setup never runs twice');
  await p.evaluate(() => document.getElementById('celebrate-overlay').classList.add('hidden'));

  console.log('B. Single debt with More details and preview');
  await p.evaluate(() => goAddDebt()); await p.waitForTimeout(400);
  await p.fill('#debt-name', 'Balance Transfer'); await p.fill('#debt-balance', '3000'); await p.fill('#debt-apr', '24.99'); await p.fill('#debt-min', '60');
  await p.click('#add-more > summary'); await p.waitForTimeout(200);
  ok(await vis(p, '#debt-has-promo') && await vis(p, '#debt-due-day'), 'More details opens the extra fields');
  await p.fill('#debt-due-day', '20');
  await p.check('#debt-has-promo'); await p.fill('#debt-promo-end', '2027-06-30'); await p.fill('#debt-post-promo-apr', '24.99'); await p.fill('#debt-transfer-fee', '3');
  await p.click('#add-save-btn'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !document.getElementById('add-preview-modal').classList.contains('hidden')), 'Save & see my plan shows the preview');
  await p.click('#add-preview-confirm'); await p.waitForTimeout(600);
  st = await p.evaluate(() => ({ n: debts.length, d: debts[2], hidden: document.getElementById('add-session').hidden, more: document.getElementById('add-more').open }));
  ok(st.n === 3 && st.d.hasPromo && st.d.promoEnd === '2027-06-30' && st.d.dueDay === 20 && st.d.balance === 3090 && st.d.transferFee === 90, 'promo, due day and 3% fee saved');
  ok(st.hidden && !st.more, 'after confirm: session strip cleared, More details closed');
  const btId = await p.evaluate(() => debts[2].id);
  await p.evaluate(id => { document.getElementById('celebrate-overlay').classList.add('hidden'); openEditModal(id); }, btId); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById('edit-transfer-fee').value) === '3', 'edit shows the 3% fee as 3, not 2.91');
  await p.evaluate(() => saveEditDebt()); await p.waitForTimeout(300);
  ok(await p.evaluate(id => { const d = debts.find(x => x.id === id); return d.balance === 3090 && d.transferFee === 90; }, btId), 're-saving the transfer does not add the fee again');

  console.log('C. Estimated label on both debt views, and edits');
  ok(await p.evaluate(() => /\$\d[\d,]* min \(est\.\)/.test(document.getElementById('debt-list').textContent)), 'free card shows "min (est.)"');
  await p.evaluate(() => { localStorage.setItem('debtfree_premium', '1'); });
  await p.reload(); await p.waitForTimeout(800);
  const prem = await p.evaluate(() => typeof isPremium !== 'undefined' && isPremium);
  if (prem) ok(await p.evaluate(() => /min \(est\.\)/.test(document.getElementById('debt-list').textContent)), 'premium table shows "min (est.)"');
  else console.log('  skip premium table (premium flag not honoured without a licence)');
  const visaId = await p.evaluate(() => debts.find(d => d.name === 'Rewards Visa').id);
  await p.evaluate(id => { openEditModal(id); }, visaId); await p.waitForTimeout(300);
  await p.evaluate(() => saveEditDebt()); await p.waitForTimeout(300);
  ok(await p.evaluate(id => debts.find(d => d.id === id).minEstimated === true, visaId), 're-saving an untouched estimate keeps the flag');
  await p.evaluate(id => openEditModal(id), visaId); await p.waitForTimeout(300);
  await p.fill('#edit-min', '150'); await p.evaluate(() => saveEditDebt()); await p.waitForTimeout(300);
  ok(await p.evaluate(id => { const d = debts.find(d => d.id === id); return d.minEstimated === false && d.minPayment === 150; }, visaId), 'typing a minimum clears the flag');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  console.log('D. From the example screen');
  ({ ctx, p, errs } = await fresh(browser, {}));
  const demo = await p.evaluate(() => typeof _demoMode !== 'undefined' && _demoMode);
  if (demo) {
    await p.evaluate(() => goAddDebt()); await p.waitForTimeout(400);
    await p.fill('#debt-balance', '1200'); await p.fill('#debt-apr', '19.99');
    await p.click('#add-another-btn'); await p.waitForTimeout(500);
    st = await p.evaluate(() => ({ demo: _demoMode, n: debts.length, name: debts[0] && debts[0].name }));
    ok(!st.demo && st.n === 1 && st.name === 'Credit Card', 'first save leaves the example and keeps only the new debt (named by type)');
  } else console.log('  skip (example screen not shown in this setup)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  console.log('E. Lender sets the type');
  ({ ctx, p, errs } = await fresh(browser, { debtfree_demo_dismissed: '1', debtfree_debts: '[]' }));
  await p.evaluate(() => goAddDebt()); await p.waitForTimeout(300);
  const lenders = await p.evaluate(() => {
    const out = {};
    ['student', 'auto', 'home', 'loan'].forEach(g => { const i = ISSUERS.find(x => x.group === g); if (i) { document.getElementById('debt-issuer').value = i.id; onIssuerPicked(); out[g] = document.getElementById('debt-type').value; } });
    document.getElementById('debt-type').value = 'cc'; document.getElementById('debt-type').dispatchEvent(new Event('change'));
    const s = ISSUERS.find(x => x.group === 'student'); document.getElementById('debt-issuer').value = s.id; onIssuerPicked();
    out.afterManual = document.getElementById('debt-type').value;
    return out;
  });
  ok(lenders.student === 'student' && lenders.auto === 'auto' && lenders.home === 'mortgage' && lenders.loan === 'personal', 'lender group sets type: ' + JSON.stringify(lenders));
  ok(lenders.afterManual === 'cc', 'a type picked by hand is never overridden');
  await ctx.close();

  await browser.close();
  console.log(fail ? `FAILURES PRESENT  (${pass}/${pass + fail})` : `ALL PASS  (${pass}/${pass + fail})`);
  process.exit(fail ? 1 : 0);
})();
