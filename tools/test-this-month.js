/*
 * test-this-month.js — v1.65.0 This Month card.
 *
 * Ring, "Paid as planned", swipe to log / later, skip, scheduled rows, and the
 * calendar reminder file. Runs at a fixed date on the 9-debt fixture.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART = fs.readFileSync(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-primary.json'), 'utf8'));

const results = [];
const check = (label, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
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
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.clock.install({ time: new Date(at) });
  await page.goto('file://' + path.join(__dirname, 'site/app/dashboard.html'));
  await page.waitForTimeout(1000);
  // processDuePayments() is what a real app load runs: it settles the
  // fixture's pending payment dated in September.
  await page.evaluate(f => { applyBackupPayload(f); processDuePayments(); render(); }, FIXTURE);
  if (premium) await page.evaluate(() => { isPremium = true; render(); });
  await page.waitForTimeout(600);
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
    console.log(`\n--- card and model ${tier} ---`);
    const { page, errs, ctx } = await boot(b, '2026-11-13T09:00:00', premium);

    const st = await page.evaluate(() => {
      debts.forEach((d, i) => { if (d.balance > 0) d.dueDay = [5, 18, 22, 28, 31, 10, 15, 20, 25][i % 9]; });
      render();
      const m = thisMonthModel();
      const card = document.getElementById('upcoming-card');
      return {
        shown: getComputedStyle(card).display !== 'none',
        title: card.querySelector('.card-title').textContent.trim(),
        ring: !!card.querySelector('.tm-ring'), btn: !!card.querySelector('.tm-batch-btn'),
        logged: m.logged, remaining: m.remaining, target: m.target,
        batch: m.batch.map(r => [r.name, Math.round(r.amount)]), rows: m.rows.length,
        text: card.innerText
      };
    });
    check(`${tier} card shows as This Month with ring and Paid as planned`, st.shown && /This Month/.test(st.title) && st.ring && st.btn, JSON.stringify(st.batch));
    check(`${tier} target = logged + still planned`, Math.abs(st.target - st.logged - st.remaining) < 0.01, `${st.logged} + ${st.remaining} = ${st.target}`);
    const banned = ['missed', 'late', 'overdue', 'behind', 'you should', 'failed'];
    const found = banned.filter(w => new RegExp('\\b' + w + '\\b', 'i').test(st.text));
    check(`${tier} no punishing or advisory language`, found.length === 0, found.join(','));

    // ── Paid as planned ─────────────────────────────────────────────────
    const before = await page.evaluate(() => ({ n: payments.length, bal: debts.map(d => d.balance), months: getPlanSim().months }));
    const batch = await page.evaluate(() => {
      openPaidAsPlanned();
      const rows = document.querySelectorAll('#tm-batch-list .tm-b-row').length;
      const label = document.getElementById('tm-batch-go').textContent;
      savePaidAsPlanned();
      const m = thisMonthModel();
      return { rows, label, after: payments.length, remaining: m.remaining, batchLeft: m.batch.length,
               toast: (document.getElementById('toast-root').textContent || ''), months: getPlanSim().months,
               hidden: document.getElementById('tm-batch-modal').classList.contains('hidden') };
    });
    check(`${tier} Paid as planned logs one payment per row`, batch.after - before.n === batch.rows && batch.rows > 0 && batch.hidden, `${batch.rows} rows, label "${batch.label}"`);
    check(`${tier} nothing left planned this month after it`, batch.remaining < 1, `remaining ${batch.remaining}`);
    check(`${tier} paying exactly the plan leaves the debt-free month where it was`, batch.months === before.months, `${before.months} -> ${batch.months}`);
    check(`${tier} toast offers Undo`, /Logged \d+ payments/.test(batch.toast) && /Undo/.test(batch.toast), batch.toast);
    let bad = await ledgerOk(page);
    check(`${tier} ledger identity holds for every debt after the batch`, bad.length === 0, bad.join('; '));

    const undone = await page.evaluate(() => { document.getElementById('toast-undo-any').click(); return { n: payments.length, bal: debts.map(d => d.balance) }; });
    check(`${tier} Undo removes all of them and restores balances`, undone.n === before.n && JSON.stringify(undone.bal) === JSON.stringify(before.bal));

    // ── Swipe right logs ───────────────────────────────────────────────
    const sw = await page.evaluate(() => {
      const el = document.querySelector('#upcoming-body .tm-swipe:not(.tm-noswipe)');
      const id = +el.getAttribute('data-id'), amt = +el.getAttribute('data-amt');
      const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
      const fire = (t, x) => el.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: x, clientY: y, button: 0, bubbles: true }));
      const n = payments.length;
      fire('pointerdown', r.left + 20); fire('pointermove', r.left + 40); fire('pointermove', r.left + 120); fire('pointermove', r.left + 260); fire('pointerup', r.left + 260);
      const p = payments[payments.length - 1];
      return { added: payments.length - n, id, amt, paidId: p && p.debtId, paidAmt: p && p.amount, tip: localStorage.getItem('debtfree_swipe_tip') };
    });
    check(`${tier} swipe right logs that row's amount`, sw.added === 1 && sw.paidId === sw.id && Math.abs(sw.paidAmt - Math.min(sw.amt, 1e9)) < 0.011, JSON.stringify(sw));
    check(`${tier} first swipe retires the tip`, sw.tip === '-1');
    bad = await ledgerOk(page);
    check(`${tier} ledger identity after a swipe`, bad.length === 0, bad.join('; '));

    // A small sideways wobble does nothing.
    const wob = await page.evaluate(() => {
      const el = document.querySelector('#upcoming-body .tm-swipe:not(.tm-noswipe)');
      const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
      const fire = (t, x, yy) => el.dispatchEvent(new PointerEvent(t, { pointerId: 8, clientX: x, clientY: yy, button: 0, bubbles: true }));
      const n = payments.length;
      fire('pointerdown', r.left + 20, y); fire('pointermove', r.left + 25, y + 40); fire('pointermove', r.left + 200, y + 60); fire('pointerup', r.left + 200, y + 60);
      return { added: payments.length - n, later: !document.getElementById('tm-later-modal').classList.contains('hidden') };
    });
    check(`${tier} a vertical scroll that drifts sideways neither logs nor opens Later`, wob.added === 0 && !wob.later, JSON.stringify(wob));

    // ── Swipe left: Later sheet, schedule, skip ────────────────────────
    const later = await page.evaluate(() => {
      const el = document.querySelector('#upcoming-body .tm-swipe:not(.tm-noswipe)');
      const id = +el.getAttribute('data-id');
      const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
      const fire = (t, x) => el.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, button: 0, bubbles: true }));
      fire('pointerdown', r.right - 20); fire('pointermove', r.right - 40); fire('pointermove', r.right - 200); fire('pointerup', r.right - 260);
      const open = !document.getElementById('tm-later-modal').classList.contains('hidden');
      document.getElementById('tm-later-date').value = '2026-11-27';
      const n = payments.length;
      saveDueLater();
      const p = payments[payments.length - 1];
      return { open, id, added: payments.length - n, pending: p && p.pending, date: p && p.date, pid: p && p.debtId };
    });
    check(`${tier} swipe left opens Later; scheduling saves a pending payment`, later.open && later.added === 1 && later.pending === true && later.date === '2026-11-27' && later.pid === later.id, JSON.stringify(later));
    bad = await ledgerOk(page);
    check(`${tier} a scheduled payment leaves balances alone`, bad.length === 0, bad.join('; '));

    const skip = await page.evaluate(() => {
      const el = document.querySelector('#upcoming-body .tm-swipe:not(.tm-noswipe)');
      const id = +el.getAttribute('data-id');
      const bal = debts.map(d => d.balance), months = getPlanSim().months;
      openDueLater(id); skipDueThisMonth();
      const gone = !Array.from(document.querySelectorAll('#upcoming-body .tm-swipe')).some(e => +e.getAttribute('data-id') === id);
      const inDues = upcomingDues().some(r => r.id === id && !r.kind && monthKeyOf(r.date) === currentMonthKey());
      const same = JSON.stringify(bal) === JSON.stringify(debts.map(d => d.balance)) && months === getPlanSim().months;
      document.getElementById('toast-undo-any').click();
      const back = Array.from(document.querySelectorAll('#upcoming-body .tm-swipe')).some(e => +e.getAttribute('data-id') === id);
      return { gone, inDues, same, back };
    });
    check(`${tier} Skip this month removes the row and its due reminder`, skip.gone && !skip.inDues, JSON.stringify(skip));
    check(`${tier} Skip changes no balance and no plan figure`, skip.same);
    check(`${tier} Undo brings the skipped row back`, skip.back);

    // Tap a row: the log form opens with this row's amount.
    const tap = await page.evaluate(() => {
      const el = document.querySelector('#upcoming-body .tm-swipe:not(.tm-noswipe)');
      el.removeAttribute('data-swiped');
      el.querySelector('.due-row-main').click();
      return { open: !document.getElementById('quicklog-modal').classList.contains('hidden'),
               amt: +document.getElementById('qlog-amount').value, want: +el.getAttribute('data-amt'),
               debt: +document.getElementById('qlog-debt-select').value, id: +el.getAttribute('data-id') };
    });
    check(`${tier} tapping a row opens the log form with that amount`, tap.open && Math.abs(tap.amt - tap.want) < 0.011 && tap.debt === tap.id, JSON.stringify(tap));
    await page.evaluate(() => closeQuickLog());

    // ── Plan check ─────────────────────────────────────────────────────
    const pc = await page.evaluate(() => {
      const items = planCheckItems();
      const html = document.getElementById('tm-head').innerText;
      // Make a card hit 95% of its limit and check it shows.
      const cc = debts.find(d => d.type === 'cc' && d.balance > 0);
      cc.creditLimit = Math.round(cc.balance / 0.95); render();
      const lim = planCheckItems().some(i => i.kind === 'limit' && i.id === cc.id);
      cc.creditLimit = null; render();
      return { items, html, lim };
    });
    check(`${tier} plan check: at most 3 items, neutral wording`, pc.items.length <= 3
      && !pc.items.some(i => /\b(should|must|recommend|need to)\b/i.test(i.text)), pc.items.map(i => i.text).join(' | '));
    check(`${tier} plan check: a card at 95% of its limit is listed`, pc.lim);

    // ── Statement check-in ─────────────────────────────────────────────
    const stmt = await page.evaluate(() => {
      const d = debts.find(x => x.name === 'Big Bank Visa');
      const b0 = d.balance;
      // A payment logged after the statement date isn't on the statement.
      logPaymentCore(d.id, 100, '2026-11-12');
      const b1 = d.balance;                    // b0 - 100
      const prev = statementDelta(d.id, b0 + 40, '2026-11-10');
      openDueLater(debts.find(x => x.id === thisMonthModel().rows.find(r => r.kind === 'debt').id).id);
      _laterId = d.id;
      document.getElementById('tm-stmt-balance').value = String(b0 + 40);
      document.getElementById('tm-stmt-date').value = '2026-11-10';
      saveStatementFromSheet();
      const b2 = d.balance;
      const adj = adjustments[adjustments.length - 1];
      document.getElementById('toast-undo-any').click();
      return { b0, b1, b2, b3: d.balance, delta: prev.delta, adj: adj && [adj.amount, adj.date, adj.note] };
    });
    check(`${tier} statement: difference counts payments logged after the statement`, Math.abs(stmt.delta - 40) < 0.011, JSON.stringify(stmt));
    check(`${tier} statement: balance becomes statement minus later payments`, Math.abs(stmt.b2 - (stmt.b0 + 40 - 100)) < 0.011 && stmt.adj && stmt.adj[1] === '2026-11-10');
    check(`${tier} statement: Undo restores the balance`, Math.abs(stmt.b3 - stmt.b1) < 0.011);
    bad = await ledgerOk(page);
    check(`${tier} ledger identity after statement and undo`, bad.length === 0, bad.join('; '));

    // ── The three figures sit right under Total Owed ───────────────────
    const order = await page.evaluate(() => {
      const ids = ['hero-card', 'stat-grid', 'upcoming-card', 'next-debt-card'];
      const els = ids.map(id => document.getElementById(id));
      return els.every((e, i) => i === 0 || (els[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    check(`${tier} Total Owed, then the three figures, then This Month, then the Focus card`, order);

    check(`${tier} no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ── Calendar file ─────────────────────────────────────────────────────
  console.log('\n--- calendar reminders ---');
  const { page, errs, ctx } = await boot(b, '2026-11-13T09:00:00', false);
  const cal = await page.evaluate(() => {
    debts.forEach(d => { d.dueDay = null; d.dueDay2 = null; });
    const live = debts.filter(d => d.balance > 0);
    live[0].dueDay = 31; live[1].dueDay = 5; live[1].dueDay2 = 20; live[2].dueDay = 12;
    render();
    const priv = buildReminderIcs({ daysBefore: 3, names: false, checkin: true });
    const named = buildReminderIcs({ daysBefore: 3, names: true, checkin: false });
    const ev = calReminderEvents({ names: false });
    return {
      priv, named, names: live.slice(0, 3).map(d => d.name),
      g: ev.map(googleCalLink), n: ev.length,
      foot: document.getElementById('tm-foot').innerText
    };
  });
  const lines = cal.priv.split('\r\n').filter(Boolean);
  const count = re => (cal.priv.match(re) || []).length;
  check('one event per due day plus the monthly check-in', count(/BEGIN:VEVENT/g) === 5 && cal.n === 5, `${count(/BEGIN:VEVENT/g)} events`);
  check('BEGIN/END balanced, CRLF line endings, no line over 75 characters',
    count(/BEGIN:VEVENT/g) === count(/END:VEVENT/g) && count(/BEGIN:VALARM/g) === count(/END:VALARM/g)
    && !/[^\r]\n/.test(cal.priv) && lines.every(l => l.length <= 75), `${lines.length} lines`);
  check('the 31st repeats on the month\'s last day', /RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1/.test(cal.priv));
  check('a split debt gets both days', /BYMONTHDAY=5\r\n/.test(cal.priv) && /BYMONTHDAY=20\r\n/.test(cal.priv) && /\(1 of 2\)/.test(cal.priv));
  check('alert 3 days before at 9 AM, and on the day', /TRIGGER:-PT63H/.test(cal.priv) && /TRIGGER:PT9H/.test(cal.priv));
  check('private by default: no account names in the file', !cal.names.some(n => cal.priv.includes(n.replace(/[,;]/g, ''))), cal.names.join(', '));
  check('names appear when asked for', cal.names.some(n => cal.named.includes(n.replace(/,/g, '\\,').replace(/;/g, '\\;'))));
  check('check-in can be left out', !/check-in/.test(cal.named) && /DebtFree check-in/.test(cal.priv));
  check('Google Calendar links carry the repeat rule', cal.g.every(u => /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/.test(u) && /recur=RRULE/.test(u)));
  check('card offers to add reminders', /Get payment reminders/.test(cal.foot), cal.foot);
  const upd = await page.evaluate(() => {
    _calMarkDone('ics'); render();
    const a = document.getElementById('tm-foot').innerText;
    debts.filter(d => d.balance > 0)[2].dueDay = 13; render();
    return [a, document.getElementById('tm-foot').innerText];
  });
  check('after adding: says when; after a due day changes: offers an update', /Calendar reminders added/.test(upd[0]) && /changed/.test(upd[1]), upd.join(' / '));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ── iPhone: links to the static calendar files ───────────────────────
  console.log('\n--- iPhone calendar links ---');
  const ictx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1' });
  await ictx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ictx.addInitScript(() => { localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1'); });
  const ip = await ictx.newPage();
  await ip.clock.install({ time: new Date('2026-11-13T09:00:00') });
  await ip.goto('file://' + path.join(__dirname, 'site/app/dashboard.html'));
  await ip.waitForTimeout(800);
  const io = await ip.evaluate(f => {
    applyBackupPayload(f); processDuePayments();
    debts.forEach(d => { d.dueDay = null; d.dueDay2 = null; });
    const live = debts.filter(d => d.balance > 0);
    live[0].dueDay = 31; live[1].dueDay = 5; live[1].dueDay2 = 20; live[2].dueDay = 12;
    render(); openCalReminders();
    const links = Array.from(document.querySelectorAll('#cal-google-list a')).map(a => a.getAttribute('href'));
    const btnHidden = getComputedStyle(document.getElementById('cal-ics-btn')).display === 'none';
    const namesHidden = getComputedStyle(document.getElementById('cal-names').parentNode).display === 'none';
    const before = localStorage.getItem('debtfree_cal_export2');
    document.getElementById('cal-lead').value = '7'; renderCalGoogleLinks();
    const links7 = Array.from(document.querySelectorAll('#cal-google-list a')).map(a => a.getAttribute('href'));
    return { links, links7, btnHidden, namesHidden, before, types: live.slice(0, 3).map(d => d.type) };
  }, FIXTURE);
  const files = io.links.map(h => h.replace(/^.*\/reminders\//, ''));
  check('iPhone: one link per due day plus the check-in, each to a file that exists',
    io.links.length === 5 && files.every(f => fs.existsSync(path.join(__dirname, '..', 'reminders', f))), files.join(', '));
  check('iPhone: links follow the alert choice', io.links7.filter(h => /-7\.ics$/.test(h)).length === 4, io.links7.join(' '));
  check('iPhone: no download button, no names option, nothing marked added before a tap', io.btnHidden && io.namesHidden && io.before === null);
  await ictx.close();

  await b.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass === results.length ? 'ALL PASS' : 'FAILURES PRESENT'}  (${pass}/${results.length})`);
  process.exit(pass === results.length ? 0 : 1);
})();
