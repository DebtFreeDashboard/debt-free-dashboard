#!/usr/bin/env python3
"""
Adds premium amortization tables + CSV export to app/dashboard.html.

Works on either an LF or a CRLF copy and writes back whatever it found, so it
can be developed against the raw.githubusercontent copy and then applied to
Kevin's CRLF working tree without producing a whole-file diff.

Every anchor is asserted. A silently-skipped hunk here would be a half-wired
feature, which is worse than a hard failure.
"""
import sys, io

path = sys.argv[1] if len(sys.argv) > 1 else 'app/dashboard.html'
raw = open(path, 'rb').read()
crlf = raw.count(b'\r\n') > 0
s = raw.decode('utf-8').replace('\r\n', '\n')
orig_len = len(s)

def sub(old, new, label, count=1):
    global s
    n = s.count(old)
    assert n == count, f'ANCHOR {label!r}: expected {count} match(es), found {n}'
    s = s.replace(old, new, count)
    print(f'  ok    {label}')

# ────────────────────────────────────────────────────────────────────────
# A. simulate(): per-debt, per-month accounting, under the existing trace flag
# ────────────────────────────────────────────────────────────────────────

sub(
  "  const doRollover = !opts || opts.rollover !== false;",
  "  const doRollover = !opts || opts.rollover !== false;\n"
  "  // v1.41.0 — per-debt monthly accounting for the amortization table. Rides\n"
  "  // on the existing opt-in trace flag so a caller that doesn't ask for it\n"
  "  // pays nothing and sees an unchanged result shape.\n"
  "  const _traceOn = !!(opts && opts.trace);",
  'simulate: _traceOn flag')

sub(
  "    month++;\n    let monthInterest = 0;",
  "    month++;\n    let monthInterest = 0;\n"
  "    // Opening balance must be captured before any interest posts.\n"
  "    if (_traceOn) for (let d of balances) { d._open = d.bal; d._mInt = 0; d._mPay = 0; }",
  'simulate: capture opening balances')

sub(
  "      monthInterest += interest;\n      d.interestPaid += interest;              // v1.5.0 — per-debt tracking",
  "      monthInterest += interest;\n      if (_traceOn) d._mInt += interest;\n"
  "      d.interestPaid += interest;              // v1.5.0 — per-debt tracking",
  'simulate: record per-debt interest')

sub(
  "      const payment = Math.min(d.bal, minDue);\n      d.bal -= payment;\n      d.bal = Math.max(0, d.bal);",
  "      const payment = Math.min(d.bal, minDue);\n      d.bal -= payment;\n"
  "      if (_traceOn) d._mPay += payment;\n      d.bal = Math.max(0, d.bal);",
  'simulate: record minimum payment')

sub(
  "      const payment = Math.min(d.bal, surplus);\n      d.bal -= payment;\n      surplus -= payment;\n      d.bal = Math.max(0, d.bal);",
  "      const payment = Math.min(d.bal, surplus);\n      d.bal -= payment;\n      surplus -= payment;\n"
  "      if (_traceOn) d._mPay += payment;\n      d.bal = Math.max(0, d.bal);",
  'simulate: record surplus payment')

sub(
  "          target.bal = Math.max(0, target.bal - tPay);\n          lumpRemaining -= tPay;",
  "          target.bal = Math.max(0, target.bal - tPay);\n"
  "          if (_traceOn) target._mPay += tPay;\n          lumpRemaining -= tPay;",
  'simulate: record targeted lump')

sub(
  "          balances[li].bal = Math.max(0, balances[li].bal - lPay);\n          lumpRemaining -= lPay;",
  "          balances[li].bal = Math.max(0, balances[li].bal - lPay);\n"
  "          if (_traceOn) balances[li]._mPay += lPay;\n          lumpRemaining -= lPay;",
  'simulate: record cascaded lump')

sub(
  "      _row.byDebt = {};\n      balances.forEach(function(b){ _row.byDebt[b.id] = b.bal; });",
  "      _row.byDebt = {};\n      balances.forEach(function(b){ _row.byDebt[b.id] = b.bal; });\n"
  "      // v1.41.0 — amortization row per debt. close === open + interest - paid\n"
  "      // is asserted in the test harness; it is the ledger identity applied\n"
  "      // to a single projected month.\n"
  "      _row.amort = {};\n"
  "      balances.forEach(function(b){\n"
  "        _row.amort[b.id] = { open: b._open, interest: b._mInt, paid: b._mPay, close: b.bal };\n"
  "      });",
  'simulate: emit amort rows')

# ────────────────────────────────────────────────────────────────────────
# B. getPlanSim(): trace always on, so the amortization table reads the exact
#    object Dashboard/Cashflow/Roadmap/Portfolio already read. Cross-tab
#    agreement becomes structural instead of something to test for.
# ────────────────────────────────────────────────────────────────────────

sub(
  "  const res = simulate(activeDebts.map(function(d){ return {...d}; }), extra, 0, strategy, disb);\n  _planSimCache = { key: key, res: res };",
  "  // v1.41.0 — trace on. The amortization table and CSV export are rendered\n"
  "  // from THIS object rather than a second simulation, which is what keeps\n"
  "  // them from drifting out of agreement with every other tab.\n"
  "  const res = simulate(activeDebts.map(function(d){ return {...d}; }), extra, 0, strategy, disb, { trace: true });\n"
  "  _planSimCache = { key: key, res: res };",
  'getPlanSim: enable trace')

# ────────────────────────────────────────────────────────────────────────
# C. Feature code
# ────────────────────────────────────────────────────────────────────────

FEATURE = r'''
// ══════════════════════════════════════════════════════════════════════
// v1.41.0 — AMORTIZATION TABLES + CSV EXPORT  (premium)
//
// Everything here reads getPlanSim(), the same memoized simulation the
// Dashboard, Portfolio, Cash-Flow and Roadmap read. There is deliberately no
// second month-by-month loop in this file: a private loop is how an
// amortization view drifts a month away from the Freedom Date on the tab
// above it, and that disagreement is the bug users actually report.
// ══════════════════════════════════════════════════════════════════════

var AMORT_STRAT_LABEL = {
  optimized: 'Optimized (lowest total interest)',
  avalanche: 'Avalanche (highest APR first)',
  snowball:  'Snowball (lowest balance first)',
  hybrid:    'Hybrid (custom order)'
};

var _amortDebtId = 'all';     // 'all' | numeric debt id
var _amortExpanded = false;   // show the full schedule vs the first 12 months

// Rows for one debt (or the whole plan when id === 'all').
// Shape: [{ month, date, open, interest, paid, close }]
function amortRowsFor(id) {
  var sim = getPlanSim();
  if (!sim || !sim.monthlyData || !sim.monthlyData.length) return [];
  var rows = [];
  for (var i = 0; i < sim.monthlyData.length; i++) {
    var md = sim.monthlyData[i];
    if (!md.amort) continue;             // trace off — nothing to show
    var open = 0, interest = 0, paid = 0, close = 0;
    if (id === 'all') {
      for (var k in md.amort) {
        if (!Object.prototype.hasOwnProperty.call(md.amort, k)) continue;
        open += md.amort[k].open; interest += md.amort[k].interest;
        paid += md.amort[k].paid; close += md.amort[k].close;
      }
    } else {
      var a = md.amort[id];
      if (!a) continue;
      open = a.open; interest = a.interest; paid = a.paid; close = a.close;
    }
    // A debt that is already at zero contributes nothing but padding.
    if (id !== 'all' && open <= 0.005 && paid <= 0.005) continue;
    rows.push({
      month: md.month,
      date: planMonthDate(md.month),
      open: open, interest: interest, paid: paid, close: close,
      principal: paid - interest
    });
  }
  return rows;
}

function renderAmortization() {
  var card = document.getElementById('amort-card');
  var teaser = document.getElementById('amort-teaser');
  if (!card || !teaser) return;

  var active = _activePlanDebts();
  var hasData = isPremium && active.length > 0;

  // Data-managed, like cashflow/roadmap: hide both when there is nothing to show.
  card.style.display = hasData ? '' : 'none';
  teaser.style.display = (!isPremium && active.length > 0) ? '' : 'none';
  if (!hasData) return;

  // Debt picker. Rebuilt each render so a renamed or cleared debt can't
  // strand a selection that no longer exists.
  var sel = document.getElementById('amort-debt');
  if (sel) {
    var ids = active.map(function(d){ return String(d.id); });
    if (_amortDebtId !== 'all' && ids.indexOf(String(_amortDebtId)) === -1) _amortDebtId = 'all';
    var html = '<option value="all">All debts in your plan</option>';
    active.forEach(function(d) {
      html += '<option value="' + escapeHtml(String(d.id)) + '"'
           + (String(d.id) === String(_amortDebtId) ? ' selected' : '') + '>'
           + escapeHtml(d.name) + '</option>';
    });
    sel.innerHTML = html;
  }

  var rows = amortRowsFor(_amortDebtId);
  var body = document.getElementById('amort-body');
  var note = document.getElementById('amort-note');
  var more = document.getElementById('amort-more');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" style="padding:14px;color:var(--text-muted);'
                   + 'font-size:0.78rem;">Nothing scheduled for this debt.</td></tr>';
    if (note) note.textContent = '';
    if (more) more.style.display = 'none';
    return;
  }

  var shown = _amortExpanded ? rows : rows.slice(0, 12);
  var out = '';
  for (var i = 0; i < shown.length; i++) {
    var r = shown[i];
    var isLast = (r.month === rows[rows.length - 1].month);
    out += '<tr' + (isLast ? ' class="amort-final"' : '') + '>'
        +  '<td class="amort-m">' + escapeHtml(monthLabel(r.date)) + '</td>'
        +  '<td>' + fmt(r.paid) + '</td>'
        +  '<td class="amort-int">' + fmt(r.interest) + '</td>'
        +  '<td>' + fmt(r.principal) + '</td>'
        +  '<td class="amort-bal">' + fmt(r.close) + '</td>'
        +  '</tr>';
  }
  body.innerHTML = out;

  var totalInt = rows.reduce(function(a, r){ return a + r.interest; }, 0);
  var totalPaid = rows.reduce(function(a, r){ return a + r.paid; }, 0);
  if (note) {
    note.textContent = rows.length + (rows.length === 1 ? ' month' : ' months')
      + ' · ' + fmt(totalPaid) + ' paid, of which ' + fmt(totalInt) + ' is interest';
  }
  if (more) {
    more.style.display = rows.length > 12 ? '' : 'none';
    more.textContent = _amortExpanded
      ? 'Show first 12 months'
      : 'Show all ' + rows.length + ' months';
  }
}

function setAmortDebt(v) {
  _amortDebtId = v;
  _amortExpanded = false;
  renderAmortization();
  trackShare('amort_debt_change', { scope: v === 'all' ? 'all' : 'single' });
}

function toggleAmortRows() {
  _amortExpanded = !_amortExpanded;
  renderAmortization();
}

// ── CSV ───────────────────────────────────────────────────────────────
// A debt name is user text that lands in a spreadsheet. Two separate
// problems, both handled here:
//   - CSV quoting, so a name containing a comma or quote can't shift columns.
//   - Formula injection: Excel and Sheets execute a cell beginning =, +, -, @
//     or a control character. A debt named "=HYPERLINK(...)" would otherwise
//     become a live formula in the user's spreadsheet. Prefixing with an
//     apostrophe is the standard mitigation and is invisible in the cell.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvMoney(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function downloadCsv(filename, text) {
  // BOM so Excel reads UTF-8 debt names correctly instead of mojibake.
  var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

// Full plan: every debt, every month. This is the artifact people asked for —
// something they can open in Excel and check the math themselves.
function exportAmortizationCsv() {
  if (!isPremium) return;
  var sim = getPlanSim();
  var active = _activePlanDebts();
  if (!sim || !active.length) return;

  var byId = {};
  active.forEach(function(d){ byId[d.id] = d; });

  var lines = [];
  lines.push(['Month', 'Date', 'Debt', 'Starting balance', 'Payment',
              'Interest', 'Principal', 'Ending balance'].map(csvCell).join(','));

  sim.monthlyData.forEach(function(md) {
    if (!md.amort) return;
    var label = monthLabel(planMonthDate(md.month));
    active.forEach(function(d) {
      var a = md.amort[d.id];
      if (!a) return;
      if (a.open <= 0.005 && a.paid <= 0.005) return;   // already cleared
      lines.push([
        md.month, label, d.name,
        csvMoney(a.open), csvMoney(a.paid), csvMoney(a.interest),
        csvMoney(a.paid - a.interest), csvMoney(a.close)
      ].map(csvCell).join(','));
    });
  });

  // Trailing summary, blank-line separated so a spreadsheet keeps it apart.
  lines.push('');
  lines.push(['Summary'].map(csvCell).join(','));
  lines.push(['Strategy', AMORT_STRAT_LABEL[strategy] || strategy].map(csvCell).join(','));
  lines.push(['Months to debt-free', sim.months].map(csvCell).join(','));
  lines.push(['Debt-free date', monthLabel(planMonthDate(sim.months))].map(csvCell).join(','));
  lines.push(['Total interest', csvMoney(sim.totalInterest)].map(csvCell).join(','));
  lines.push(['Monthly extra (incl. rolled minimums)', csvMoney(planExtra())].map(csvCell).join(','));
  lines.push(['Generated', localDateStr()].map(csvCell).join(','));
  lines.push(['Projection only — based on the figures entered in DebtFree Dashboard.'].map(csvCell).join(','));

  downloadCsv('debtfree-schedule-' + localDateStr() + '.csv', lines.join('\r\n'));
  trackShare('csv_export', { kind: 'schedule', months: sim.months });
}

// The debt list as entered, for someone who just wants their inputs out.
function exportDebtsCsv() {
  if (!isPremium) return;
  var list = debts || [];
  if (!list.length) return;
  var lines = [];
  lines.push(['Debt', 'Type', 'Balance', 'Original balance', 'APR %',
              'Minimum payment', 'Excluded from plan'].map(csvCell).join(','));
  list.forEach(function(d) {
    lines.push([
      d.name, d.type || '', csvMoney(d.balance), csvMoney(d.originalBalance),
      (Number(d.apr) || 0).toFixed(2), csvMoney(d.minPayment),
      d.excluded ? 'yes' : 'no'
    ].map(csvCell).join(','));
  });
  downloadCsv('debtfree-debts-' + localDateStr() + '.csv', lines.join('\r\n'));
  trackShare('csv_export', { kind: 'debts', debt_count: list.length });
}
'''

sub(
  "// ══════════════════════════════════════════════════════════════════════\n"
  "// v1.39.4 — PROGRESS IS BALANCE REDUCTION, NOT MONEY SPENT.",
  FEATURE +
  "\n// ══════════════════════════════════════════════════════════════════════\n"
  "// v1.39.4 — PROGRESS IS BALANCE REDUCTION, NOT MONEY SPENT.",
  'insert feature code')

# ────────────────────────────────────────────────────────────────────────
# D. Markup — Strategy tab, directly after the Roadmap teaser
# ────────────────────────────────────────────────────────────────────────

MARKUP = '''<div class="card" id="amort-card" data-collapse="amort" data-collapse-default="closed" data-premium data-premium-managed style="display:none">
      <div class="card-title"><div class="dot"></div> Amortization Schedule <span class="premium-tag">Premium</span></div>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">Month by month, what your payment covers in interest and what actually comes off the balance.</p>
      <div style="margin-bottom:12px;">
        <select id="amort-debt" onchange="setAmortDebt(this.value)" aria-label="Choose which debt to show"></select>
      </div>
      <div class="amort-scroll">
        <table class="amort-table">
          <thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead>
          <tbody id="amort-body"></tbody>
        </table>
      </div>
      <div id="amort-note" style="margin-top:10px;font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);"></div>
      <button id="amort-more" class="btn btn-ghost" style="margin-top:10px;display:none;" onclick="toggleAmortRows()"></button>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
        <button class="btn btn-ghost" onclick="exportAmortizationCsv()">Export schedule (CSV)</button>
        <button class="btn btn-ghost" onclick="exportDebtsCsv()">Export debt list (CSV)</button>
      </div>
      <p style="margin-top:12px;font-size:0.72rem;color:var(--text-muted);line-height:1.5;">A projection based on the figures you entered. Your lender&rsquo;s statement is the record.</p>
    </div>
<div class="card" id="amort-teaser" data-teaser data-teaser-managed style="display:none" onclick="trackTeaserClick('amort');document.getElementById('unlock-box').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="card-title"><div class="dot"></div> Amortization Schedule <span class="premium-tag">Premium</span></div>
      <div class="blur-teaser">
        <div class="blur-content">
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">Month by month, what your payment covers in interest and what actually comes off the balance.</p>
          <table class="amort-table">
            <thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead>
            <tbody>
              <tr><td class="amort-m">Sep 2026</td><td>$450</td><td class="amort-int">$182</td><td>$268</td><td class="amort-bal">$9,732</td></tr>
              <tr><td class="amort-m">Oct 2026</td><td>$450</td><td class="amort-int">$177</td><td>$273</td><td class="amort-bal">$9,459</td></tr>
              <tr><td class="amort-m">Nov 2026</td><td>$450</td><td class="amort-int">$172</td><td>$278</td><td class="amort-bal">$9,181</td></tr>
            </tbody>
          </table>
        </div>
        <div class="blur-overlay">
          <div style="font-size:1.4rem;">&#128274;</div>
          <div class="lock-card-title">See where every dollar goes</div>
          <div class="lock-card-desc" style="max-width:280px;">The full month-by-month schedule for every debt, plus CSV export for your own spreadsheet.</div>
          <div class="lock-card-cta">Unlock</div>
        </div>
      </div>
    </div>
'''

sub(
  '<div class="card" id="lump-sum-card" data-collapse="lumps"',
  MARKUP + '<div class="card" id="lump-sum-card" data-collapse="lumps"',
  'insert markup')

# ────────────────────────────────────────────────────────────────────────
# E. CSS
# ────────────────────────────────────────────────────────────────────────

CSS = '''
/* v1.41.0 — amortization table. Horizontal scroll rather than wrapping: a
   five-column money table that wraps is unreadable at 320px, and the numbers
   need to stay in columns to be comparable down the page. */
.amort-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -4px; }
.amort-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.7rem; min-width: 330px; }
.amort-table th { text-align: right; padding: 6px 6px; color: var(--text-muted); font-weight: 500;
  letter-spacing: 0.04em; border-bottom: 1px solid var(--border); white-space: nowrap; }
.amort-table th:first-child, .amort-table td:first-child { text-align: left; }
.amort-table td { text-align: right; padding: 6px 6px; border-bottom: 1px solid var(--border);
  white-space: nowrap; color: var(--text); }
.amort-table tbody tr:last-child td { border-bottom: none; }
.amort-table .amort-m { color: var(--text-muted); }
.amort-table .amort-int { color: var(--accent5); }
.amort-table .amort-bal { font-weight: 600; }
.amort-table tr.amort-final td { color: var(--accent); font-weight: 700; }
#amort-debt { width: 100%; }
'''

sub("  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert CSS')

# ────────────────────────────────────────────────────────────────────────
# F. Wire into render()
# ────────────────────────────────────────────────────────────────────────

sub(
  "  renderRoadmap();         // v1.14.0 (premium)",
  "  renderRoadmap();         // v1.14.0 (premium)\n"
  "  renderAmortization();    // v1.41.0 (premium)",
  'wire renderAmortization into render()')

out = s.replace('\n', '\r\n') if crlf else s
open(path, 'wb').write(out.encode('utf-8'))
print(f'\n  wrote {path}  ({"CRLF" if crlf else "LF"} preserved, '
      f'{orig_len} -> {len(s)} chars)\n')
