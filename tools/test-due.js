/*
 * test-due.js — v1.42.0 due dates + Coming Up card.
 *
 * Date-dependent logic, so most of this runs under page.clock at fixed dates
 * rather than trusting whatever today happens to be.
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

async function boot(b, file, at) {
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
  if (at) await page.clock.install({ time: new Date(at) });
  await page.goto('file://' + path.join(__dirname, file));
  await page.waitForTimeout(1000);
  await page.evaluate(f => { applyBackupPayload(f); }, FIXTURE);
  await page.waitForTimeout(800);
  return { page, ctx, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ── Month-end clamping ────────────────────────────────────────────────
  console.log('--- month-end clamping (a card due on the 31st) ---');
  const cal = await boot(b, 'site/app/dashboard.html', '2026-02-10T09:00:00');
  const clamp = await cal.page.evaluate(() => {
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return {
      feb31: iso(dueDateIn(2026, 1, 31)),      // Feb 2026 -> 28th
      febLeap: iso(dueDateIn(2028, 1, 31)),    // Feb 2028 is a leap year -> 29th
      apr31: iso(dueDateIn(2026, 3, 31)),      // April has 30 days
      jan31: iso(dueDateIn(2026, 0, 31)),      // unchanged
      sanitize: [sanitizeDueDay('15'), sanitizeDueDay(0), sanitizeDueDay(32), sanitizeDueDay(''), sanitizeDueDay('abc')]
    };
  });
  check('31st clamps to Feb 28 in a common year', clamp.feb31 === '2026-02-28', clamp.feb31);
  check('31st clamps to Feb 29 in a leap year', clamp.febLeap === '2028-02-29', clamp.febLeap);
  check('31st clamps to Apr 30', clamp.apr31 === '2026-04-30', clamp.apr31);
  check('31st is untouched in a 31-day month', clamp.jan31 === '2026-01-31', clamp.jan31);
  check('bad due days sanitize to null', JSON.stringify(clamp.sanitize) === '[15,null,null,null,null]', JSON.stringify(clamp.sanitize));

  // ── Status logic at a fixed date ──────────────────────────────────────
  console.log('\n--- status logic on 2026-02-10, nothing logged this month ---');
  const statuses = await cal.page.evaluate(() => {
    payments.length = 0;                         // clear the fixture's logged payments
    debts[0].dueDay = 5;                         // already passed this month
    debts[1].dueDay = 10;                        // today
    debts[2].dueDay = 14;                        // in 4 days -> soon
    debts[3].dueDay = 28;                        // in 18 days -> later
    const rows = upcomingDues();
    const by = {};
    rows.forEach(r => { by[r.name] = { status: r.status, days: r.days, label: dueRowLabel(r) }; });
    return by;
  });
  check('day already past, nothing logged -> "passed"',
        statuses['Auto Loan'] && statuses['Auto Loan'].status === 'passed', JSON.stringify(statuses['Auto Loan']));
  check('due today -> "today"',
        statuses['Big Bank Visa'] && statuses['Big Bank Visa'].status === 'today', JSON.stringify(statuses['Big Bank Visa']));
  check('due in 4 days -> "soon"',
        statuses['Costco Citi'] && statuses['Costco Citi'].status === 'soon', JSON.stringify(statuses['Costco Citi']));
  check('due in 18 days -> "later" (does not clutter the card)',
        statuses['Store Card'] && statuses['Store Card'].status === 'later', JSON.stringify(statuses['Store Card']));

  const logged = await cal.page.evaluate(() => {
    payments.push({ id: 99999, debtId: debts[0].id, debtName: debts[0].name, amount: 312, date: '2026-02-03' });
    const r = upcomingDues().find(x => x.name === 'Auto Loan');
    return { status: r.status, label: dueRowLabel(r) };
  });
  check('a logged payment flips "passed" to "logged"', logged.status === 'logged', JSON.stringify(logged));

  // ── The copy rule ─────────────────────────────────────────────────────
  console.log('\n--- copy: the app knows what was logged, not what was paid ---');
  const copy = await cal.page.evaluate(() => {
    payments.length = 0;
    render();
    const card = document.getElementById('upcoming-card');
    return { text: card ? card.innerText : '', shown: card && getComputedStyle(card).display !== 'none' };
  });
  const banned = ['missed', 'late', 'overdue', 'behind', 'failed', 'delinquent', 'you should'];
  const found = banned.filter(w => new RegExp('\\b' + w + '\\b', 'i').test(copy.text));
  check('card renders', copy.shown, copy.text.replace(/\n+/g, ' | ').slice(0, 130));
  check('no punishing or advisory language anywhere in the card',
        found.length === 0, found.join(', ') || 'none of: ' + banned.join(', '));
  check('past-due row says "no payment logged yet"',
        /no payment logged yet/i.test(copy.text), (copy.text.split('\n').find(l => /logged yet/i.test(l)) || '').trim());

  // ── Quiet mode ────────────────────────────────────────────────────────
  console.log('\n--- quiet when nothing is close ---');
  const quiet = await cal.page.evaluate(() => {
    debts.forEach(d => { d.dueDay = null; });
    debts[3].dueDay = 28;                       // 18 days out, nothing else set
    render();
    const card = document.getElementById('upcoming-card');
    const q = document.getElementById('upcoming-quiet');
    const body = document.getElementById('upcoming-body');
    return {
      shown: getComputedStyle(card).display !== 'none',
      quietShown: getComputedStyle(q).display !== 'none',
      quietText: q.textContent,
      rows: body.querySelectorAll('.due-row').length
    };
  });
  check('card collapses to one muted line, no rows', quiet.quietShown && quiet.rows === 0, quiet.quietText);

  // v1.42.0 part 2 changed this deliberately: with no due days set the card now
  // offers the batch setter rather than vanishing, because vanishing reads as
  // "this feature does nothing". It still vanishes once dismissed.
  const noDays = await cal.page.evaluate(() => {
    debts.forEach(d => { d.dueDay = null; });
    try { localStorage.removeItem('debtfree_due_prompt_dismissed'); } catch (e) {}
    render();
    const c = document.getElementById('upcoming-card');
    return { display: getComputedStyle(c).display, invite: !!c.querySelector('.due-invite-go') };
  });
  check('no due days -> invitation to add them, not an empty card',
        noDays.display !== 'none' && noDays.invite, `display ${noDays.display}, invite ${noDays.invite}`);

  const afterDismiss = await cal.page.evaluate(() => {
    dismissDueInvite();
    return getComputedStyle(document.getElementById('upcoming-card')).display;
  });
  check('card hidden entirely once the invitation is dismissed', afterDismiss === 'none', `display: ${afterDismiss}`);

  // ── Quick-log wiring ──────────────────────────────────────────────────
  console.log('\n--- one tap from due to logged ---');
  const qlog = await cal.page.evaluate(() => {
    debts[1].dueDay = 10;
    payments.length = 0;
    render();
    logFromDue(debts[1].id);
    const modal = document.getElementById('quicklog-modal');
    return {
      open: modal && !modal.classList.contains('hidden'),
      selected: document.getElementById('qlog-debt-select').value,
      expected: String(debts[1].id),
      amount: document.getElementById('qlog-amount').value
    };
  });
  check('quick-log opens with the right debt preselected and amount prefilled',
        qlog.open && qlog.selected === qlog.expected && qlog.amount !== '',
        `debt ${qlog.selected} (want ${qlog.expected}), amount ${qlog.amount}`);

  check('no JS errors', cal.errs.length === 0, cal.errs.slice(0, 2).join(' | ') || 'none');
  await cal.ctx.close();

  // ── Persistence ───────────────────────────────────────────────────────
  console.log('\n--- dueDay survives a backup round-trip ---');
  const p2 = await boot(b, 'site/app/dashboard.html');
  const round = await p2.page.evaluate(() => {
    debts[0].dueDay = 17; debts[1].dueDay = 31; debts[2].dueDay = null;
    // Snapshot FIRST: buildBackupPayload() hands back references to the live
    // debt objects, so poisoning `debts` would poison the payload too and the
    // test would be grading its own corruption rather than the restore path.
    const snapshot = JSON.parse(JSON.stringify(buildBackupPayload()));
    const inPayload = snapshot.debts.map(d => d.dueDay);
    debts.forEach(d => { d.dueDay = 999; });          // poison the live array only
    applyBackupPayload(snapshot);
    return { inPayload: inPayload.slice(0, 3), restored: debts.slice(0, 3).map(d => d.dueDay) };
  });
  check('dueDay rides in buildBackupPayload', JSON.stringify(round.inPayload) === '[17,31,null]', JSON.stringify(round.inPayload));
  check('dueDay restores intact', JSON.stringify(round.restored) === '[17,31,null]', JSON.stringify(round.restored));

  const badRestore = await p2.page.evaluate(() => {
    const payload = buildBackupPayload();
    payload.debts[0].dueDay = 99; payload.debts[1].dueDay = 'x';
    applyBackupPayload(payload);
    return debts.slice(0, 2).map(d => d.dueDay);
  });
  check('a hand-edited backup with a bad dueDay sanitizes to null',
        JSON.stringify(badRestore) === '[null,null]', JSON.stringify(badRestore));

  // ── The engine must be untouched ──────────────────────────────────────
  console.log('\n--- engine untouched (this release adds no plan math) ---');
  const before = await boot(b, 'dashboard.html');
  const nums = p => p.evaluate(() => {
    const out = {};
    ['optimized', 'avalanche', 'snowball', 'hybrid'].forEach(st => {
      strategy = st; _planSimCache = { key: null, res: null };
      const s = getPlanSim();
      out[st] = s ? s.months + '/' + Math.round(s.totalInterest * 100) / 100 : null;
    });
    return out;
  });
  const a = await nums(before.page), c = await nums(p2.page);
  check('all four strategies identical to v1.41.2',
        JSON.stringify(a) === JSON.stringify(c), `${JSON.stringify(a)} vs ${JSON.stringify(c)}`);
  check('no JS errors on the persistence page', p2.errs.length === 0, p2.errs.slice(0, 2).join(' | ') || 'none');

  console.log(`\n${results.every(Boolean) ? 'ALL PASS' : 'FAILURES PRESENT'}  (${results.filter(Boolean).length}/${results.length})`);
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})();
