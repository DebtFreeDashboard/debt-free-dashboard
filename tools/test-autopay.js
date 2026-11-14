/*
 * test-autopay.js — v1.71.0 autopay and the payment check.
 *
 * Autopay logs each due day from the day it was turned on, once, with an id
 * that two synced devices agree on; Undo is never undone by the next open;
 * a payment logged by hand is not doubled; split days pay half each; the
 * This Month card stops asking about autopay amounts; the payment check asks
 * once per due day and logs with one tap; "It's on autopay" converts a debt;
 * notification taps log or open the check; reminders skip autopay debts.
 * Runs at fixed dates on the 9-debt fixture, free and premium.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHART = fs.readFileSync(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-primary.json'), 'utf8'));

const results = [];
const check = (label, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail && !ok) console.log(`      ${detail}`);
};

async function boot(b, at, premium) {
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('debtfree_last_seen_version', '99.0.0');
      localStorage.setItem('debtfree_demo_dismissed', '1');
      localStorage.setItem('debtfree_recap_seen', '2026-11');
      localStorage.setItem('debtfree_recap_seen', new Date().toISOString().slice(0, 7));
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.clock.install({ time: new Date(at) });
  await page.goto('file://' + path.join(__dirname, 'site/app/dashboard.html'));
  await page.waitForTimeout(800);
  await page.evaluate(f => { applyBackupPayload(f); processDuePayments(); render(); }, FIXTURE);
  if (premium) await page.evaluate(() => { isPremium = true; render(); });
  await page.waitForTimeout(400);
  return { page, ctx, errs };
}

const ledgerOk = page => page.evaluate(() => {
  const bad = [];
  debts.forEach(d => {
    const paid = payments.filter(p => p.debtId === d.id && !p.pending).reduce((s, p) => s + p.amount, 0);
    const acc = accruedInterestFor(d.id);
    const adj = adjustments.filter(a => a.debtId === d.id).reduce((s, a) => s + a.amount, 0);
    const want = Math.max(0, Math.round((d.originalBalance + acc + adj - paid) * 100) / 100);
    if (Math.abs(want - d.balance) > 0.011) bad.push(d.name + ' ' + d.balance + ' vs ' + want);
  });
  return bad;
});

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const premium of [false, true]) {
    const tier = premium ? '[premium]' : '[free]';
    console.log(`\n--- autopay engine ${tier} ---`);
    const { page, errs, ctx } = await boot(b, '2026-11-13T09:00:00', premium);

    const e1 = await page.evaluate(() => {
      const A = debts.find(d => d.id === 1), B = debts.find(d => d.id === 3), S = debts.find(d => d.id === 7);
      A.dueDay = 10; A.autopay = true; A.autopaySince = '2026-11-01'; A.autopayAmount = null;
      B.dueDay = 12;
      const before = A.balance, expect = autopayAmountFor(A);
      const made = processAutopay();
      const again = processAutopay();
      const row = payments.find(p => p.debtId === 1 && p.autopay);
      return { made: made.length, again: again.length, date: row && row.date, amt: row && row.amount, expect,
               drop: Math.round((before - A.balance) * 100) / 100, id: row && row.id, idWant: _apPayId(1, '2026-11-10') };
    });
    check(`${tier} due day since autopay began is logged once, dated the due day`, e1.made === 1 && e1.again === 0 && e1.date === '2026-11-10', JSON.stringify(e1));
    check(`${tier} amount is the minimum and the balance moves by it`, e1.amt === e1.expect && e1.drop === e1.expect && e1.expect > 0, JSON.stringify(e1));
    check(`${tier} id comes from debt and date (same on every device)`, e1.id === e1.idWant, JSON.stringify(e1));
    check(`${tier} ledger identity holds after autopay`, (await ledgerOk(page)).length === 0, JSON.stringify(await ledgerOk(page)));

    const e2 = await page.evaluate(() => {
      const row = payments.find(p => p.debtId === 1 && p.autopay);
      deletePayment(row.id);
      const back = processAutopay().length;
      return { back, any: payments.some(p => p.debtId === 1 && p.autopay) };
    });
    check(`${tier} a removed autopay payment never comes back`, e2.back === 0 && !e2.any, JSON.stringify(e2));

    const e3 = await page.evaluate(() => {
      const C = debts.find(d => d.id === 5);
      C.dueDay = 10; C.autopay = true; C.autopaySince = '2026-11-11';
      const late = processAutopay().filter(x => x.debtName === C.name).length;
      // Logged by hand two days early: no second payment.
      const D = debts.find(d => d.id === 15);
      D.dueDay = 11; D.autopay = true; D.autopaySince = '2026-11-01';
      const amt = autopayAmountFor(D);
      payments.push({ id: 777001, debtId: 15, debtName: D.name, amount: amt, date: '2026-11-09' });
      recomputeBalance(15);
      const dup = processAutopay().filter(x => x.debtName === D.name).length;
      // Split days: half on each.
      const E = debts.find(d => d.id === 11);
      E.dueDay = 5; E.dueDay2 = 12; E.autopay = true; E.autopaySince = '2026-11-01'; E.autopayAmount = 80;
      const sp = processAutopay().filter(x => x.debtName === E.name).map(x => [x.date, x.amount]);
      // Months: Oct 1 to Dec 11 covers three due days.
      const occ = _apOccurrences({ dueDay: 10 }, '2026-10-01', '2026-12-11').map(o => o.iso);
      const feb = _apOccurrences({ dueDay: 30, dueDay2: 31 }, '2027-02-01', '2027-02-28');
      return { late, dup, sp, occ, feb };
    });
    check(`${tier} due days before autopay began are not logged`, e3.late === 0, JSON.stringify(e3));
    check(`${tier} a payment already logged by hand is not doubled`, e3.dup === 0, JSON.stringify(e3));
    check(`${tier} paid twice a month logs half on each day`, JSON.stringify(e3.sp) === JSON.stringify([['2026-11-05', 40], ['2026-11-12', 40]]), JSON.stringify(e3.sp));
    check(`${tier} catch-up covers every month missed`, JSON.stringify(e3.occ) === JSON.stringify(['2026-10-10', '2026-11-10', '2026-12-10']), JSON.stringify(e3.occ));
    check(`${tier} two days on one February date are one full payment`, e3.feb.length === 1 && e3.feb[0].share === 1, JSON.stringify(e3.feb));
    check(`${tier} ledger identity holds after the mix`, (await ledgerOk(page)).length === 0, JSON.stringify(await ledgerOk(page)));

    console.log(`\n--- This Month and the payment check ${tier} ---`);
    const m1 = await page.evaluate(() => {
      // Store Card: autopay due later this month.
      const S = debts.find(d => d.id === 7);
      S.dueDay = 20; S.autopay = true; S.autopaySince = '2026-11-01';
      save(); render();
      const m = thisMonthModel();
      const row = m.rows.find(r => r.id === 7);
      const inBatch = m.batch.some(r => r.id === 7 && r.amount >= autopayAmountFor(S) - 0.01 && r.status !== 'plan');
      return { row: row && { status: row.status, amount: row.amount, sub: row.sub, autopay: row.autopay },
               left: autopayLeftThisMonth(S), inBatch,
               check: dueCheckRows().map(r => r.id) };
    });
    check(`${tier} This Month treats the autopay amount as handled`, m1.row && m1.row.autopay && /autopay/.test(m1.row.sub) && !m1.inBatch, JSON.stringify(m1));
    check(`${tier} autopay still to come this month is counted`, m1.left > 0, JSON.stringify(m1));
    check(`${tier} the payment check asks about passed manual due days, not autopay ones`, m1.check.indexOf(3) !== -1 && m1.check.indexOf(7) === -1 && m1.check.indexOf(11) === -1, JSON.stringify(m1.check));

    const c1 = await page.evaluate(() => {
      localStorage.removeItem('debtfree_due_asked');
      const busy = ['whatsnew-modal', 'celebrate-overlay', 'finish-sheet', 'add-preview-modal', 'recap-sheet', 'edit-modal'].filter(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
      busy.forEach(id => document.getElementById(id).classList.add('hidden'));
      maybeShowDueCheck();
      const sheet = document.getElementById('due-check-sheet');
      const open = !sheet.classList.contains('hidden');
      const rows = sheet.querySelectorAll('.dc-row').length;
      const amt = parseAmount(document.getElementById('dc-amt-3').value);
      dueCheckPaid(3);
      const p = payments.filter(x => x.debtId === 3).sort((a, b) => b.id - a.id)[0];
      const doneTxt = document.getElementById('dc-3').innerText;
      closeDueCheck();
      maybeShowDueCheck();
      const reopened = !sheet.classList.contains('hidden');
      return { busy, open, rows, amt, pdate: p && p.date, pamt: p && p.amount, doneTxt, reopened };
    });
    check(`${tier} the check opens on its own with the debts due`, c1.open && c1.rows >= 1, JSON.stringify(c1));
    check(`${tier} Paid logs the amount, dated the due day`, c1.pdate === '2026-11-12' && Math.abs(c1.pamt - c1.amt) < 0.01 && /Logged/.test(c1.doneTxt), JSON.stringify(c1));
    check(`${tier} the check asks once per due day`, !c1.reopened, JSON.stringify(c1));
    check(`${tier} ledger identity holds after the check`, (await ledgerOk(page)).length === 0, JSON.stringify(await ledgerOk(page)));

    const c2 = await page.evaluate(() => {
      const V = debts.find(d => d.id === 9);
      V.dueDay = 8; V.autopay = false; save(); render();
      openDueCheck('test');
      const had = !!document.getElementById('dc-9');
      document.getElementById('dc-amt-9').value = '250';
      const before = V.balance;
      dueCheckAutopay(9);
      const p = payments.find(x => x.debtId === 9 && x.autopay);
      closeDueCheck();
      return { had, on: V.autopay, since: V.autopaySince, amount: V.autopayAmount, pdate: p && p.date, pamt: p && p.amount,
               drop: Math.round((before - V.balance) * 100) / 100, gone: dueCheckRows().every(r => r.id !== 9) };
    });
    check(`${tier} "It's on autopay" turns it on from that due day and logs it`, c2.had && c2.on && c2.since === '2026-11-08' && c2.pdate === '2026-11-08' && c2.pamt === 250 && c2.drop === 250, JSON.stringify(c2));
    check(`${tier} ... and it stops being asked about`, c2.gone && c2.amount === 250, JSON.stringify(c2));

    const c3 = await page.evaluate(() => {
      const S = debts.find(d => d.id === 3);
      setDueSkipped(3, '2026-11', false);
      // Skip from the check.
      const T = debts.find(d => d.id === 1);
      T.autopay = false; T.dueDay = 9; save(); render();
      openDueCheck('test');
      dueCheckSkip(1);
      closeDueCheck();
      return { skipped: isDueSkipped(1, '2026-11'), rows: dueCheckRows().map(r => r.id) };
    });
    check(`${tier} Skip this month quiets it for the month`, c3.skipped && c3.rows.indexOf(1) === -1, JSON.stringify(c3));

    console.log(`\n--- edit, reminders, notifications ${tier} ---`);
    const ed = await page.evaluate(() => {
      const S = debts.find(d => d.id === 13);
      S.autopay = false; S.dueDay = 13; save(); render();
      openEditModal(13);
      const box = document.getElementById('edit-ap-box');
      const cb = document.getElementById('edit-autopay');
      cb.checked = true; apBoxToggle('edit');
      const amtShown = getComputedStyle(document.querySelector('#edit-ap-box .ap-amt-wrap')).display !== 'none';
      const before = payments.length;
      saveEditDebt();
      const D = debts.find(d => d.id === 13);
      const today = payments.filter(p => p.debtId === 13 && p.autopay && p.date === '2026-11-13').length;
      return { on: D.autopay, since: D.autopaySince, amtShown, today, added: payments.length - before };
    });
    check(`${tier} Edit turns autopay on from today and logs today's due day`, ed.on && ed.since === '2026-11-13' && ed.amtShown && ed.today === 1, JSON.stringify(ed));

    const ed2 = await page.evaluate(() => {
      // No due day: autopay cannot be on.
      const D = debts.find(d => d.id === 5);
      D.autopay = false; D.dueDay = null; save(); render();
      openEditModal(5);
      document.getElementById('edit-autopay').checked = true;
      document.getElementById('edit-due-day').value = '';
      saveEditDebt();
      return { on: debts.find(d => d.id === 5).autopay };
    });
    check(`${tier} autopay needs a due day`, ed2.on === false, JSON.stringify(ed2));

    const rm = await page.evaluate(() => {
      const days = _pushDays();
      localStorage.setItem('debtfree_push', JSON.stringify({ on: true, cadence: 'before', lead: 3, names: false }));
      _lastReminderState = null;
      writeReminderState();
      return new Promise(res => setTimeout(async () => {
        const c = await caches.open('debtfree-reminder-state').catch(() => null);
        const r = c ? await c.match('/__reminders') : null;
        const st = r ? await r.json() : null;
        localStorage.removeItem('debtfree_push');
        res({ days, ids: st ? st.debts.map(x => x.i) : null, noNames: st ? st.debts.every(x => x.n === null) : null });
      }, 300));
    });
    const apIds = await page.evaluate(() => debts.filter(isAutopay).map(d => d.id));
    check(`${tier} reminders skip autopay debts`, rm.ids === null || (rm.ids.every(i => apIds.indexOf(i) === -1) && rm.noNames), JSON.stringify({ rm, apIds }));

    const nh = await page.evaluate(() => {
      const R = debts.find(d => d.id === 1);
      setDueSkipped(1, '2026-11', false);
      R.autopay = false; R.dueDay = 13; save(); render();
      const before = payments.filter(p => p.debtId === 1).length;
      const want = (_tmRowById(1) || {}).amount;
      handleNotifHash('#paid=1');
      const after = payments.filter(p => p.debtId === 1);
      const p = after.sort((a, b) => b.id - a.id)[0];
      handleNotifHash('#paid=1');
      const twice = payments.filter(p => p.debtId === 1).length;
      return { added: after.length - before, amt: p.amount, want, date: p.date, twice: twice - after.length, hash: location.hash };
    });
    check(`${tier} the notification's Paid button logs that debt with one tap`, nh.added === 1 && Math.abs(nh.amt - nh.want) < 0.01 && nh.date === '2026-11-13', JSON.stringify(nh));
    check(`${tier} a second tap doesn't log it twice`, nh.twice === 0, JSON.stringify(nh));
    check(`${tier} ledger identity holds at the end`, (await ledgerOk(page)).length === 0, JSON.stringify(await ledgerOk(page)));
    check(`${tier} no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  console.log('\n--- boot: autopay on open with Undo ---');
  {
    const { page, errs, ctx } = await boot(b, '2026-11-20T09:00:00', false);
    await page.evaluate(() => {
      const A = debts.find(d => d.id === 1);
      A.dueDay = 18; A.autopay = true; A.autopaySince = '2026-11-01';
      localStorage.removeItem('debtfree_autopay_done');
      save();
    });
    await page.reload();
    await page.waitForFunction(() => /Autopay logged/.test((document.getElementById('toast-root') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
    const bt = await page.evaluate(() => ({
      n: payments.filter(p => p.debtId === 1 && p.autopay && p.date === '2026-11-18').length,
      toast: (document.getElementById('toast-root') || {}).innerText || ''
    }));
    check('opening the app logs autopay and says so, with Undo', bt.n === 1 && /Autopay logged/.test(bt.toast) && /undo/i.test(bt.toast), JSON.stringify(bt));
    await page.evaluate(() => document.getElementById('toast-undo-any').click());
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(2200);
    const bt2 = await page.evaluate(() => payments.filter(p => p.debtId === 1 && p.autopay).length);
    check('after Undo, reopening does not log it again', bt2 === 0, String(bt2));
    check('boot: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  console.log('\n--- add a debt with autopay ---');
  {
    const { page, errs, ctx } = await boot(b, '2026-11-14T09:00:00', false);
    const ad = await page.evaluate(() => {
      document.getElementById('debt-name').value = 'Gas Card';
      document.getElementById('debt-balance').value = '900';
      document.getElementById('debt-apr').value = '24';
      document.getElementById('debt-min').value = '35';
      document.getElementById('debt-due-day').value = '3';
      document.getElementById('debt-autopay').checked = true;
      document.getElementById('debt-autopay-amount').value = '50';
      addDebt(true);
      const d = debts.find(x => x.name === 'Gas Card');
      return { on: d && d.autopay, since: d && d.autopaySince, amt: d && d.autopayAmount,
               reset: !document.getElementById('debt-autopay').checked && document.getElementById('debt-autopay-amount').value === '',
               logged: payments.filter(p => d && p.debtId === d.id).length, asked: dueCheckRows().some(r => d && r.id === d.id) };
    });
    check('adding a debt with autopay saves it from today, form resets', ad.on && ad.since === '2026-11-14' && ad.amt === 50 && ad.reset, JSON.stringify(ad));
    check('a debt added after its due day is neither logged nor asked about', ad.logged === 0 && !ad.asked, JSON.stringify(ad));
    check('add: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  console.log('\n--- example screen ---');
  {
    const ctx = await b.newContext({ viewport: { width: 402, height: 874 } });
    await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route('**/googletagmanager.com/**', r => r.abort());
    await ctx.route('**/clarity.ms/**', r => r.abort());
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(__dirname, 'site/app/dashboard.html'));
    await page.waitForTimeout(3200);
    const ex = await page.evaluate(() => ({ demo: _demoMode, made: processAutopay().length,
      open: !document.getElementById('due-check-sheet').classList.contains('hidden') }));
    check('the example never logs autopay or opens the check', ex.demo && ex.made === 0 && !ex.open, JSON.stringify(ex));
    await ctx.close();
  }

  console.log('\n--- service worker notification text ---');
  {
    const src = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
    const sb = { self: { addEventListener() {}, registration: {}, clients: {} }, caches: {}, fetch() {}, URL, Response: function () {}, console };
    vm.createContext(sb);
    vm.runInContext(src, sb);
    const now = new Date(2026, 10, 14, 9);
    const one = sb.reminderText({ cadence: 'before', lead: 3, names: false, debts: [{ i: 5, n: null, t: 'cc', days: [14] }] }, now);
    check('due today: tap opens the check, Paid button logs it', /#due-check$/.test(one.url) && /#paid=5$/.test(one.paidUrl), JSON.stringify(one));
    const ahead = sb.reminderText({ cadence: 'before', lead: 3, names: false, debts: [{ i: 5, n: null, t: 'cc', days: [16] }] }, now);
    check('due ahead: no Paid button', !ahead.paidUrl && !/#/.test(ahead.url), JSON.stringify(ahead));
    const two = sb.reminderText({ cadence: 'before', lead: 3, names: true, debts: [{ i: 5, n: 'Visa', t: 'cc', days: [14] }, { i: 6, n: 'Loan', t: 'loan', days: [15] }] }, now);
    check('several, first today: opens the check', /#due-check$/.test(two.url) && !two.paidUrl, JSON.stringify(two));
  }

  await b.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
