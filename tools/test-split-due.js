/* test-split-due.js — v1.56.0 Pay twice a month (dueDay2)
 *   node tools/test-split-due.js            (no browser or server needed)
 *
 * Runs the Due Dates block of app/dashboard.html against stubs at fixed dates.
 *  1. every inline script still parses
 *  2. regression: for debts with ONE due day, upcomingDues() is identical to
 *     the previous release across a year of dates and payment patterns
 *  3. split debts: the right half, date, status and label at each point in the month
 *  4. sanitizing and migration: old data (no dueDay2) and bad values load safely
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const NEW = fs.readFileSync(process.argv[2] || path.join(ROOT, 'app', 'dashboard.html'), 'utf8');
let OLD = null;
try { OLD = cp.execSync('git show HEAD:app/dashboard.html', { cwd: ROOT, maxBuffer: 64e6 }).toString(); } catch (e) {}
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + l + (ok ? '' : '\n      ' + d)); };

const scriptsOf = html => [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parseOk = true; scriptsOf(NEW).forEach((s, i) => { try { new vm.Script(s); } catch (e) { parseOk = false; console.log('parse fail script', i, e.message); } });
ck('all inline scripts parse', parseOk);

function block(html) {
  const big = scriptsOf(html).find(s => s.includes('function upcomingDues'));
  return big.slice(big.indexOf('var DUE_SOON_DAYS'), big.indexOf('// v1.42.0 — RECURRING BILLS'));
}
function fixedDate(iso) {
  const T = new Date(iso).getTime(), RD = Date;
  function D(...a) { return a.length ? new RD(...a) : new RD(T); }
  D.prototype = RD.prototype; D.now = () => T; D.UTC = RD.UTC; D.parse = RD.parse;
  return D;
}
function load(html, iso, debts, payments) {
  const ctx = { Date: fixedDate(iso), Math, parseInt, parseFloat, isNaN, String, JSON, console,
    debts, payments, bills: [], isPremium: false,
    minPaymentFloors: d => ({ now: d.minPayment }),
    fmt: n => '$' + Math.round(n).toLocaleString('en-US'),
    billMarkedThisMonth: () => false, billMarkedFor: () => false, billIsTracked: () => false };
  vm.createContext(ctx);
  vm.runInContext(`
    function _monthKey(s){return String(s||'').slice(0,7);}
    function localDateStr(d){var t=d||new Date();return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');}
    function monthKeyOf(t){return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0');}
    function currentMonthKey(){return monthKeyOf(new Date());}
  ` + block(html), ctx);
  return ctx;
}
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const view = rows => JSON.stringify(rows.map(r => ({ ...r, date: iso(r.date) })));

// ── 2. regression on single-day debts ───────────────────────────────────
if (OLD && !OLD.includes('function splitDueRow')) {
  const base = [
    { id: 1, name: 'A', balance: 900, minPayment: 50, dueDay: 1 },
    { id: 2, name: 'B', balance: 900, minPayment: 75, dueDay: 15 },
    { id: 3, name: 'C', balance: 900, minPayment: 40, dueDay: 31 },
    { id: 4, name: 'D', balance: 30, minPayment: 40, dueDay: 28 },
    { id: 5, name: 'E', balance: 900, minPayment: 40, dueDay: null },
  ];
  let diffs = 0, cases = 0, first = '';
  for (let day = 0; day < 366; day += 3) {
    const t = new Date(2026, 0, 1 + day, 9);
    const ym = iso(t).slice(0, 7);
    const patterns = [[], [{ debtId: 1, amount: 50, date: ym + '-01' }],
      [{ debtId: 2, amount: 30, date: ym + '-03' }],
      [{ debtId: 2, amount: 75, date: ym + '-28', pending: true }, { debtId: 3, amount: 40, date: ym + '-02' }]];
    for (const p of patterns) {
      const a = view(load(OLD, t.toISOString(), JSON.parse(JSON.stringify(base)), p).upcomingDues());
      const b = view(load(NEW, t.toISOString(), JSON.parse(JSON.stringify(base)), p).upcomingDues());
      cases++; if (a !== b) { diffs++; if (!first) first = iso(t) + '\n old ' + a + '\n new ' + b; }
    }
  }
  ck(`single-day debts unchanged vs previous release (${cases} date/payment cases)`, diffs === 0, first);
} else console.log('SKIP  regression vs previous release (HEAD already has the change)');

// ── 3. split debts ──────────────────────────────────────────────────────
const card = () => [{ id: 7, name: 'Visa', balance: 2000, minPayment: 100, dueDay: 15, dueDay2: 1 }];
function at(isoT, pays) { const c = load(NEW, isoT, card(), pays || []); const r = c.upcomingDues()[0]; return { r, label: c.dueRowLabel(r), tag: c.dueTagFor(c.debts[0]) }; }

let x = at('2026-11-11T09:00:00', []);
ck('Nov 11, nothing logged: 1st-day half shows as passed for $50',
   x.r.status === 'passed' && iso(x.r.date) === '2026-11-01' && x.r.amount === 50 && /1st of 2/.test(x.label), JSON.stringify(x));
ck('due tag reads "due 1st & 15th"', /due 1st &amp; 15th/.test(x.tag), x.tag);

x = at('2026-11-11T09:00:00', [{ debtId: 7, amount: 50, date: '2026-11-01' }]);
ck('Nov 11, $50 logged Nov 1: next is Nov 15, $50 left, "soon", 2nd of 2',
   x.r.status === 'soon' && iso(x.r.date) === '2026-11-15' && x.r.amount === 50 && x.r.partial && /\$50 of \$100 logged/.test(x.label) && /2nd of 2/.test(x.label), JSON.stringify(x));

x = at('2026-11-20T09:00:00', [{ debtId: 7, amount: 50, date: '2026-11-01' }]);
ck('Nov 20, only first half logged: Nov 15 passed with $50 of $100 logged',
   x.r.status === 'passed' && iso(x.r.date) === '2026-11-15' && x.r.amount === 50 && /\$50 of \$100 logged/.test(x.label), JSON.stringify(x));
ck('passed label never says missed, late or overdue', !/missed|late|overdue/i.test(x.label), x.label);

x = at('2026-11-20T09:00:00', [{ debtId: 7, amount: 50, date: '2026-11-01' }, { debtId: 7, amount: 50, date: '2026-11-15' }]);
ck('Nov 20, both halves logged: logged, next owed Dec 1', x.r.status === 'logged' && iso(x.r.nextOwed) === '2026-12-01', JSON.stringify(x));

x = at('2026-11-27T09:00:00', [{ debtId: 7, amount: 100, date: '2026-11-03' }]);
ck('Nov 27, month covered: Dec 1 is inside the window, shows $50 soon for next month',
   x.r.forNext && x.r.status === 'soon' && iso(x.r.date) === '2026-12-01' && x.r.amount === 50, JSON.stringify(x));

x = at('2026-11-27T09:00:00', [{ debtId: 7, amount: 100, date: '2026-11-03' }, { debtId: 7, amount: 50, date: '2026-11-26' }]);
ck('Nov 27, Dec 1 half paid early: logged for Dec 1, next owed Dec 15',
   x.r.forNext && x.r.status === 'logged' && iso(x.r.nextOwed) === '2026-12-15' && /payment logged for Dec 1/.test(x.label), JSON.stringify(x));

x = at('2026-11-05T09:00:00', [{ debtId: 7, amount: 50, date: '2026-11-14', pending: true }]);
ck('pending payment dated after Nov 1 does not count for the 1st', x.r.status === 'passed' && iso(x.r.date) === '2026-11-01', JSON.stringify(x));

{ const c = load(NEW, '2026-11-11T09:00:00', [{ id: 8, name: 'Odd', balance: 500, minPayment: 125.25, dueDay: 1, dueDay2: 15 }], []);
  const r = c.upcomingDues()[0];
  ck('odd minimum splits to cents ($62.63 then the rest)', r.amount === 62.63, JSON.stringify(r)); }

{ const c = load(NEW, '2026-02-10T09:00:00', [{ id: 9, name: 'Feb', balance: 500, minPayment: 80, dueDay: 30, dueDay2: 31 }], []);
  const r = c.upcomingDues()[0];
  ck('30th and 31st in February collapse to one Feb 28 row for the whole minimum',
     iso(r.date) === '2026-02-28' && r.amount === 80 && !/of 2/.test(c.dueRowLabel(r)), JSON.stringify(r)); }

{ const c = load(NEW, '2026-11-11T09:00:00', [{ id: 10, name: 'Small', balance: 30, minPayment: 100, dueDay: 1, dueDay2: 15 }], [{ debtId: 10, amount: 15, date: '2026-11-01' }]);
  const r = c.upcomingDues()[0];
  ck('balance below the minimum: halves are of the balance ($15 left on the 15th)', r.amount === 15 && iso(r.date) === '2026-11-15', JSON.stringify(r)); }

// ── 4. sanitizing / migration ───────────────────────────────────────────
{ const c = load(NEW, '2026-11-11T09:00:00', [], []);
  const s = [c.sanitizeSecondDueDay(15, 1), c.sanitizeSecondDueDay(15, 15), c.sanitizeSecondDueDay(null, 1),
             c.sanitizeSecondDueDay(15, undefined), c.sanitizeSecondDueDay(15, '32'), c.sanitizeSecondDueDay('15', '1')];
  ck('second day: kept, equal->null, no due day->null, missing->null, bad->null', JSON.stringify(s) === '[1,null,null,null,null,1]', JSON.stringify(s));
  ck('old saved debt (no dueDay2) is not split', c.splitDueDays({ dueDay: 15 }) === null);
  ck('orphan dueDay2 with no due day is ignored', c.splitDueDays({ dueDay: null, dueDay2: 5 }) === null); }

// sanitizeDebts must carry dueDay2 through a save/load and drop bad values.
{ const big = scriptsOf(NEW).find(s => s.includes('function sanitizeDebts'));
  ck('sanitizeDebts sanitizes dueDay2', /dueDay2: sanitizeSecondDueDay\(debt\.dueDay, debt\.dueDay2\)/.test(big));
  ck('add form, edit modal and batch setter all write dueDay2',
     /debt-due-day2/.test(big) && /edit-due-day2/.test(big) && /d\.dueDay2 = sanitizeSecondDueDay\(row\.day/.test(big)); }

console.log(R.every(Boolean) ? 'ALL PASS' : 'SOME FAILED'); process.exit(R.every(Boolean) ? 0 : 1);
