#!/usr/bin/env python3
"""
v1.43.0 — sinking funds (premium).

This is the only feature in the run that changes the payoff engine, so the
change is deliberately narrow:

  simulate() gains ONE optional input, opts.sinkDraw — a function returning how
  much of the monthly extra is diverted in a given plan month. Absent, the
  engine behaves exactly as before. The surplus line becomes

      surplus = max(0, extraPerMonth - sinkDraw(month))

  and nothing else in the loop moves.

Why a per-month function and not a flat reduction: a TARGET fund finishes. Once
"$2,000 for the car by June" is funded, that money goes back to the debts, and
the Freedom Date has to reflect that. A flat reduction would model the fund as
permanent and make every projection needlessly pessimistic. Recurring funds
(insurance, property tax) never finish and return a constant.

Monotonicity is preserved by construction: sinkDraw does not depend on
extraPerMonth, so surplus is still monotonically non-decreasing in extra, and
the max(0, ...) clamp is monotonic too. Swept in the test suite regardless.

The clamp is a modelling choice worth knowing: if a fund's contributions exceed
the extra, surplus floors at zero rather than going negative. The app will not
model someone missing a minimum payment to feed a savings pot.

Per-fund `counted` toggle:
  counted true  -> enters sinkDraw, moves the Freedom Date, honest
  counted false -> tracking only; progress and totals still shown, plan untouched
Either way the fund counts in the Monthly Money Plan budget check, because the
money leaves the account regardless of how it is modelled.
"""
import sys

def edit(path, fn):
    raw = open(path, 'rb').read(); crlf = raw.count(b'\r\n') > 0
    s = raw.decode('utf-8').replace('\r\n', '\n')
    s = fn(s)
    open(path, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
    print(f'  ok    wrote {path} ({"CRLF" if crlf else "LF"})')

def sub(s, old, new, label, count=1):
    n = s.count(old)
    assert n == count, f'ANCHOR {label!r}: expected {count}, found {n}'
    print(f'  ok    {label}')
    return s.replace(old, new, count)

LOGIC = r'''
// ══════════════════════════════════════════════════════════════════════
// v1.43.0 — SINKING FUNDS  (premium)
//
// A sinking fund is money set aside monthly for a known future cost — car
// repairs, insurance, Christmas. It matters in a DEBT tool because the single
// most common way a payoff plan collapses is an unexpected $900 bill landing
// on a credit card. A fund is what stops that becoming new debt.
//
// Shape: { id, name, monthly, target, saved, counted }
//   target null  -> recurring, never completes (insurance, property tax)
//   target set   -> completes once `saved` reaches it, and the money returns
//                   to the debts from that month on
//   counted      -> whether this fund is modelled in the payoff plan
// ══════════════════════════════════════════════════════════════════════

// simulate()'s MAX_MONTHS is scoped inside that function, so the schedule
// builder carries its own horizon. Kept equal to it on purpose.
var SINK_HORIZON = 600;

function sanitizeFund(f) {
  if (!f || typeof f !== 'object') return null;
  var name = String(f.name == null ? '' : f.name).trim().slice(0, 60);
  if (!name) return null;
  var monthly = parseFloat(f.monthly);
  if (isNaN(monthly) || monthly < 0 || monthly > 1000000) monthly = 0;
  var target = (f.target === null || f.target === '' || typeof f.target === 'undefined')
    ? null : parseFloat(f.target);
  if (target !== null && (isNaN(target) || target <= 0 || target > 10000000)) target = null;
  var saved = parseFloat(f.saved);
  if (isNaN(saved) || saved < 0) saved = 0;
  if (target !== null) saved = Math.min(saved, target);
  var id = parseInt(f.id, 10);
  return {
    id: isNaN(id) ? nextId++ : id,
    name: name, monthly: monthly, target: target, saved: saved,
    counted: f.counted !== false          // default on: the honest reading
  };
}

function fundIsComplete(f) {
  return f && f.target !== null && f.saved >= f.target - 0.005;
}

// How many more months this fund still needs. Infinity for a recurring fund.
function fundMonthsRemaining(f) {
  if (!f || f.monthly <= 0) return f && f.target !== null ? Infinity : Infinity;
  if (f.target === null) return Infinity;
  var left = Math.max(0, f.target - f.saved);
  return left <= 0 ? 0 : Math.ceil(left / f.monthly);
}

function fundsMonthlyTotal(onlyCounted) {
  return (sinkingFunds || []).reduce(function (a, f) {
    if (onlyCounted && f.counted === false) return a;
    if (fundIsComplete(f)) return a;         // finished funds cost nothing
    return a + (parseFloat(f.monthly) || 0);
  }, 0);
}

// The diversion schedule the engine reads. Index 1 = this month, matching the
// engine's month numbering (v1.38.0 anchors month 1 to the current month).
// Built once per simulation rather than per month so the per-month lookup is
// a array read in the hot loop.
function buildSinkSchedule(maxMonths) {
  var sched = new Float64Array(maxMonths + 2);
  (sinkingFunds || []).forEach(function (f) {
    if (!f || f.counted === false) return;
    var monthly = parseFloat(f.monthly) || 0;
    if (monthly <= 0) return;

    if (f.target === null) {
      for (var m = 1; m <= maxMonths; m++) sched[m] += monthly;   // never ends
      return;
    }
    var left = Math.max(0, f.target - (parseFloat(f.saved) || 0));
    for (var k = 1; k <= maxMonths && left > 0.005; k++) {
      var take = Math.min(monthly, left);    // last month is a part payment
      sched[k] += take;
      left -= take;
    }
  });
  return sched;
}

// Signature for the simulation cache key. Without this, editing a fund would
// leave every plan figure showing the previous answer — the same class of bug
// _ledgerKey() exists to prevent.
function sinkKey() {
  return (sinkingFunds || []).map(function (f) {
    return [f.id, f.monthly, f.target, f.saved, f.counted !== false].join(':');
  }).join('|');
}

function addFund() {
  var nameEl = document.getElementById('fund-name');
  var monEl  = document.getElementById('fund-monthly');
  var tgtEl  = document.getElementById('fund-target');
  var err    = document.getElementById('fund-error');
  if (!nameEl || !monEl) return;
  var name = (nameEl.value || '').trim();
  var monthly = parseAmount(monEl.value);
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  nameEl.classList.remove('field-invalid'); monEl.classList.remove('field-invalid');

  if (!name) {
    if (err) { err.textContent = 'Give the fund a name so you can tell it apart.'; err.style.display = 'block'; }
    nameEl.classList.add('field-invalid'); nameEl.focus(); return;
  }
  if (isNaN(monthly) || monthly <= 0) {
    if (err) { err.textContent = 'Enter how much you’re setting aside each month.'; err.style.display = 'block'; }
    monEl.classList.add('field-invalid'); monEl.focus(); return;
  }
  var target = tgtEl && tgtEl.value.trim() !== '' ? parseAmount(tgtEl.value) : null;
  if (target !== null && (isNaN(target) || target <= 0)) target = null;

  sinkingFunds.push(sanitizeFund({ name: name, monthly: monthly, target: target, saved: 0, counted: true }));
  nameEl.value=''; monEl.value=''; if (tgtEl) tgtEl.value='';
  _planSimCache = { key: null, res: null };
  save(); recalculate(); render();
  trackShare('fund_added', { _category: 'planning', fund_count: sinkingFunds.length,
                             kind: target === null ? 'recurring' : 'target' });
  nameEl.focus();
}

function removeFund(id) {
  var i = (sinkingFunds || []).findIndex(function (f) { return f.id === id; });
  if (i === -1) return;
  sinkingFunds.splice(i, 1);
  _planSimCache = { key: null, res: null };
  save(); recalculate(); render();
  trackShare('fund_removed', { _category: 'planning', fund_count: sinkingFunds.length });
}

function updateFund(id, field, value) {
  var f = (sinkingFunds || []).find(function (x) { return x.id === id; });
  if (!f) return;
  if (field === 'name')    f.name = String(value||'').trim().slice(0,60) || f.name;
  if (field === 'monthly') { var m = parseAmount(value); if (!isNaN(m) && m >= 0) f.monthly = m; }
  if (field === 'saved')   { var s = parseAmount(value); if (!isNaN(s) && s >= 0) f.saved = f.target !== null ? Math.min(s, f.target) : s; }
  if (field === 'target')  {
    var t = String(value||'').trim() === '' ? null : parseAmount(value);
    f.target = (t !== null && !isNaN(t) && t > 0) ? t : null;
    if (f.target !== null) f.saved = Math.min(f.saved, f.target);
  }
  _planSimCache = { key: null, res: null };
  save(); recalculate(); render();
}

function toggleFundCounted(id) {
  var f = (sinkingFunds || []).find(function (x) { return x.id === id; });
  if (!f) return;
  f.counted = f.counted === false;
  _planSimCache = { key: null, res: null };
  save(); recalculate(); render();
  trackShare('fund_counted_toggled', { _category: 'planning', counted: f.counted ? 'yes' : 'no' });
}

function renderFunds() {
  var card = document.getElementById('funds-card');
  var teaser = document.getElementById('funds-teaser');
  if (!card || !teaser) return;
  card.style.display = isPremium ? '' : 'none';
  teaser.style.display = isPremium ? 'none' : '';
  if (!isPremium) return;

  var list = document.getElementById('funds-list');
  var note = document.getElementById('funds-note');
  if (!list) return;

  if (!sinkingFunds.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5;padding:4px 0 10px;">'
      + 'Nothing set aside yet. Car repairs, insurance, the holidays — the costs that turn into '
      + 'credit card debt when they arrive without warning.</div>';
    if (note) note.textContent = '';
    return;
  }

  list.innerHTML = sinkingFunds.map(function (f) {
    var done = fundIsComplete(f);
    var pct = f.target ? Math.max(0, Math.min(100, (f.saved / f.target) * 100)) : 0;
    var months = fundMonthsRemaining(f);
    var sub;
    if (done) sub = 'fully funded';
    else if (f.target === null) sub = fmt(f.monthly) + '/mo, ongoing';
    else if (months === Infinity) sub = 'set a monthly amount to see when this is funded';
    else sub = fmt(f.saved) + ' of ' + fmt(f.target) + ' · '
             + months + (months === 1 ? ' month to go' : ' months to go');

    return '<div class="fund-row' + (done ? ' is-done' : '') + '">'
      + '<div class="fund-head">'
      +   '<input class="fund-name" type="text" value="' + escapeHtml(f.name) + '" maxlength="60" '
      +     'onchange="updateFund(' + f.id + ', \'name\', this.value)" aria-label="Fund name" />'
      +   '<button type="button" class="fund-del" onclick="removeFund(' + f.id + ')" '
      +     'aria-label="Remove ' + escapeHtml(f.name) + '">&times;</button>'
      + '</div>'
      + '<div class="fund-fields">'
      +   '<label class="fund-f"><span>Monthly</span><input class="money-input" type="text" inputmode="decimal" '
      +     'value="' + f.monthly + '" onchange="updateFund(' + f.id + ', \'monthly\', this.value)" /></label>'
      +   '<label class="fund-f"><span>Target</span><input class="money-input" type="text" inputmode="decimal" '
      +     'placeholder="ongoing" value="' + (f.target === null ? '' : f.target) + '" '
      +     'onchange="updateFund(' + f.id + ', \'target\', this.value)" /></label>'
      +   '<label class="fund-f"><span>Saved</span><input class="money-input" type="text" inputmode="decimal" '
      +     'value="' + f.saved + '" onchange="updateFund(' + f.id + ', \'saved\', this.value)" /></label>'
      + '</div>'
      + (f.target !== null ? '<div class="fund-bar"><div class="fund-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' : '')
      + '<div class="fund-foot">'
      +   '<span class="fund-sub">' + escapeHtml(sub) + '</span>'
      +   '<button type="button" class="fund-counted' + (f.counted !== false ? ' is-on' : '') + '" '
      +     'onclick="toggleFundCounted(' + f.id + ')" aria-pressed="' + (f.counted !== false) + '" '
      +     'title="' + (f.counted !== false
             ? 'Counted in your payoff plan'
             : 'Tracking only — not reflected in your payoff plan') + '">'
      +     (f.counted !== false ? 'in the plan' : 'tracking only') + '</button>'
      + '</div>'
      + '</div>';
  }).join('');

  if (note) {
    var counted = fundsMonthlyTotal(true), all = fundsMonthlyTotal(false);
    if (all <= 0) { note.textContent = ''; }
    else if (counted <= 0) {
      note.textContent = fmt(all) + ' a month set aside · none of it counted in your payoff plan.';
    } else if (counted === all) {
      note.textContent = fmt(all) + ' a month set aside, and your payoff plan reflects it.';
    } else {
      note.textContent = fmt(all) + ' a month set aside · ' + fmt(counted) + ' of it counted in your payoff plan.';
    }
  }
  maskFinancialInputs(list);
}
'''

MARKUP = r'''<div class="card" id="funds-card" data-collapse="funds" data-collapse-default="closed" data-premium data-premium-managed style="display:none">
      <div class="card-title"><div class="dot"></div> Sinking Funds <span class="premium-tag">Premium</span></div>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">Money set aside each month for costs you know are coming. A fund marked &ldquo;in the plan&rdquo; is money not going to debt, so your payoff dates account for it.</p>
      <div id="funds-list"></div>
      <div id="funds-note" style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);margin:10px 0 14px;line-height:1.5;"></div>
      <div class="fund-add">
        <input id="fund-name" type="text" placeholder="Car repairs" maxlength="60" aria-label="Fund name" />
        <input id="fund-monthly" type="text" inputmode="decimal" placeholder="Monthly" aria-label="Monthly amount" />
        <input id="fund-target" type="text" inputmode="decimal" placeholder="Target" aria-label="Target amount, optional" />
      </div>
      <div class="form-error" id="fund-error" style="display:none;"></div>
      <button class="btn btn-ghost" style="margin-top:10px;" onclick="addFund()">Add fund</button>
      <p style="margin-top:12px;font-size:0.72rem;color:var(--text-muted);line-height:1.5;">Leave the target blank for something ongoing, like insurance. With a target, the fund stops once it&rsquo;s full and that money goes back to your debts.</p>
    </div>
<div class="card" id="funds-teaser" data-teaser data-teaser-managed style="display:none" onclick="trackTeaserClick('funds');document.getElementById('unlock-box').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="card-title"><div class="dot"></div> Sinking Funds <span class="premium-tag">Premium</span></div>
      <div class="blur-teaser">
        <div class="blur-content">
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">Money set aside each month for costs you know are coming.</p>
          <div class="fund-row"><div class="fund-head"><div class="fund-name-static">Car repairs</div></div>
            <div class="fund-bar"><div class="fund-bar-fill" style="width:62%"></div></div>
            <div class="fund-foot"><span class="fund-sub">$1,240 of $2,000 &middot; 4 months to go</span></div></div>
          <div class="fund-row"><div class="fund-head"><div class="fund-name-static">Car insurance</div></div>
            <div class="fund-foot"><span class="fund-sub">$100/mo, ongoing</span></div></div>
        </div>
        <div class="blur-overlay">
          <div style="font-size:1.4rem;">&#128274;</div>
          <div class="lock-card-title">Stop the next surprise becoming debt</div>
          <div class="lock-card-desc" style="max-width:290px;">Set money aside for what you know is coming, and see exactly what it costs your payoff date.</div>
          <div class="lock-card-cta">Unlock</div>
        </div>
      </div>
    </div>
'''

CSS = r'''
/* v1.43.0 — sinking funds */
.fund-row { padding:12px 0; border-bottom:1px solid var(--border); }
.fund-row:last-child { border-bottom:none; }
.fund-row.is-done .fund-sub { color:var(--accent); }
.fund-head { display:flex; align-items:center; gap:8px; }
.fund-name, .fund-name-static { flex:1; min-width:0; font-family:inherit; font-size:0.86rem; font-weight:600;
  padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--card2); color:var(--text); }
.fund-name-static { border-color:transparent; background:transparent; }
.fund-del { flex-shrink:0; width:28px; height:28px; border-radius:6px; border:1px solid var(--border);
  background:var(--card2); color:var(--text-muted); cursor:pointer; font-size:1rem; line-height:1; }
.fund-del:hover { border-color:var(--accent3); color:var(--accent3); }
.fund-fields { display:flex; gap:8px; margin-top:8px; }
.fund-f { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.fund-f span { font-size:0.64rem; color:var(--text-muted); letter-spacing:0.04em; text-transform:uppercase; }
.fund-f input { width:100%; min-width:0; font-family:var(--font-mono); font-size:0.78rem; text-align:right;
  padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--card2); color:var(--text); }
.fund-bar { height:4px; border-radius:2px; background:var(--card2); margin-top:10px; overflow:hidden; }
.fund-bar-fill { height:100%; background:var(--accent5); border-radius:2px; }
.fund-foot { display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap; }
.fund-sub { flex:1; min-width:0; font-size:0.72rem; color:var(--text-muted); }
.fund-counted { flex-shrink:0; font-family:var(--font-mono); font-size:0.62rem; letter-spacing:0.05em;
  padding:4px 9px; border-radius:6px; border:1px solid var(--border); background:var(--card2);
  color:var(--text-muted); cursor:pointer; }
.fund-counted.is-on { border-color:var(--accent5); color:var(--accent5); }
.fund-add { display:flex; gap:8px; margin-top:12px; }
.fund-add input { font-family:inherit; font-size:0.82rem; padding:7px 8px; min-width:0;
  border:1px solid var(--border); border-radius:6px; background:var(--card2); color:var(--text); }
.fund-add #fund-name { flex:1; }
.fund-add #fund-monthly, .fund-add #fund-target { width:82px; flex-shrink:0; }
'''

def dash(s):
    s = sub(s, "let monthlyBudget = 0;       // v1.42.0 — budget-as-check; never read by the engine",
            "let monthlyBudget = 0;       // v1.42.0 — budget-as-check; never read by the engine\n"
            "let sinkingFunds = [];       // v1.43.0 — money set aside monthly (premium)",
            'declare sinkingFunds')

    s = sub(s, "function renderBills() {", LOGIC + "\nfunction renderBills() {", 'insert sinking-fund logic')

    # ── the engine change: one optional input, one line in the loop ──
    s = sub(s, "  const _traceOn = !!(opts && opts.trace);",
            "  const _traceOn = !!(opts && opts.trace);\n"
            "  // v1.43.0 — optional per-month diversion into sinking funds. Absent,\n"
            "  // this is a no-op and the engine behaves exactly as it did before.\n"
            "  const _sink = (opts && opts.sinkSchedule) || null;",
            'simulate: accept sinkSchedule')

    s = sub(s, "    let surplus = extraPerMonth;",
            "    // v1.43.0 — money going into a sinking fund is money not going to the\n"
            "    // debts. It comes out of the EXTRA only: the clamp at zero means the\n"
            "    // app will never model someone skipping a minimum to feed a fund.\n"
            "    let surplus = _sink ? Math.max(0, extraPerMonth - (_sink[month] || 0)) : extraPerMonth;",
            'simulate: divert into funds')

    # cache key must see the funds, or edits show a stale plan
    s = sub(s, "  return JSON.stringify([strategy, extra, rollover, _ledgerKey(),",
            "  // v1.43.0 — sinkKey() included: without it, editing a fund leaves every\n"
            "  // plan figure showing the previous answer.\n"
            "  return JSON.stringify([strategy, extra, rollover, _ledgerKey(), sinkKey(),",
            'cache key includes funds')

    s = sub(s, "  const res = simulate(activeDebts.map(function(d){ return {...d}; }), extra, 0, strategy, disb, { trace: true });",
            "  const res = simulate(activeDebts.map(function(d){ return {...d}; }), extra, 0, strategy, disb,\n"
            "                       { trace: true, sinkSchedule: buildSinkSchedule(SINK_HORIZON) });",
            'getPlanSim passes the schedule')

    # money plan: every fund is money leaving, counted or not
    s = sub(s, "  return allMinimumsTotal() + extra + rolledOverTotal()\n       + (isPremium ? billsMonthlyTotal() : 0);",
            "  // Funds count here whether or not they are modelled in the payoff plan:\n"
            "  // the money leaves the account either way, and this line is about cash.\n"
            "  return allMinimumsTotal() + extra + rolledOverTotal()\n"
            "       + (isPremium ? billsMonthlyTotal() + fundsMonthlyTotal(false) : 0);",
            'money plan counts funds')

    s = sub(s, "  if (billTotal > 0) parts.push('bills ' + fmt(billTotal));",
            "  if (billTotal > 0) parts.push('bills ' + fmt(billTotal));\n"
            "  if (fundTotal > 0) parts.push('set aside ' + fmt(fundTotal));",
            'money plan breakdown shows funds')
    # fundTotal is declared WITH billTotal, above `committed`. Declaring it lower
    # down beside its parts.push() left it undefined here -- `var` hoists, the
    # assignment does not -- and `committed` rendered as $NaN.
    s = sub(s, "  var committed = mins + extra + billTotal;",
            "  // Declared with billTotal, NOT further down beside its parts.push(): `var`\n"
            "  // hoists but the assignment does not, so a later declaration left this\n"
            "  // undefined here and `committed` came out NaN.\n"
            "  var fundTotal = isPremium ? fundsMonthlyTotal(false) : 0;\n"
            "  var committed = mins + extra + billTotal + fundTotal;",
            'money plan total includes funds')

    # persistence — both payloads, both restores (the 1.38/1.40/1.42 trap)
    s = sub(s, "    localStorage.setItem('debtfree_budget', String(monthlyBudget || 0));     // v1.42.0",
            "    localStorage.setItem('debtfree_budget', String(monthlyBudget || 0));     // v1.42.0\n"
            "    localStorage.setItem('debtfree_funds', JSON.stringify(sinkingFunds));   // v1.43.0",
            'save funds')
    s = sub(s, "    const mb = localStorage.getItem('debtfree_budget');",
            "    // Same ordering rule as lumpSums/bills: load before selectStrategy()\n"
            "    // fires save(), or the stored funds are overwritten with an empty array.\n"
            "    const fl = localStorage.getItem('debtfree_funds');\n"
            "    if (fl) { try { sinkingFunds = (JSON.parse(fl) || []).map(sanitizeFund).filter(Boolean); } catch (e) { sinkingFunds = []; } }\n"
            "    const mb = localStorage.getItem('debtfree_budget');",
            'load funds before selectStrategy')

    s = sub(s, "\n      monthlyBudget: monthlyBudget,     // v1.42.0",
            "\n      monthlyBudget: monthlyBudget,     // v1.42.0\n      sinkingFunds: sinkingFunds,       // v1.43.0",
            'update-restore payload carries funds')
    s = sub(s, "\n    monthlyBudget: monthlyBudget,     // v1.42.0",
            "\n    monthlyBudget: monthlyBudget,     // v1.42.0\n    sinkingFunds: sinkingFunds,       // v1.43.0",
            'backup payload carries funds')

    s = sub(s, "      var _mbR = parseFloat(data.monthlyBudget);",
            "      if (Array.isArray(data.sinkingFunds)) { sinkingFunds = data.sinkingFunds.map(sanitizeFund).filter(Boolean); }\n"
            "      else { sinkingFunds = []; }\n"
            "      var _mbR = parseFloat(data.monthlyBudget);",
            'applyBackupPayload restores funds')
    s = sub(s, "        var _mbU = parseFloat(data.monthlyBudget);",
            "        if (Array.isArray(data.sinkingFunds)) sinkingFunds = data.sinkingFunds.map(sanitizeFund).filter(Boolean);   // v1.43.0\n"
            "        var _mbU = parseFloat(data.monthlyBudget);",
            'update-restore reads funds')

    # markup, css, render wiring
    s = sub(s, '<div class="card" id="bills-card"', MARKUP + '<div class="card" id="bills-card"', 'insert funds card')
    s = sub(s, "  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert CSS')
    s = sub(s, "  renderBills();           // v1.42.0 (premium)",
            "  renderBills();           // v1.42.0 (premium)\n  renderFunds();           // v1.43.0 (premium)",
            'wire renderFunds')
    return s

edit(sys.argv[1], dash)
