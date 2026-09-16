#!/usr/bin/env python3
"""
v1.42.0 part 5 — Monthly Money Plan (budget as a CHECK, never a driver).

monthlyBudget is what the user says they can put toward debts and bills each
month. It is compared against what they have actually committed. It never feeds
simulate(), never touches extraMonthly, and never changes a single plan figure
— extraMonthly stays the one input that drives the plan.

Deliberate divergence, flagged because it looks like an inconsistency:
renderMonthlySummary counts PLAN minimums only ("a mortgage excluded from the
strategy is paid, but it is not part of this commitment" — v1.38.0). The Money
Plan counts EVERY debt with a balance, because its question is "does what I owe
each month fit the number I chose?" and an excluded debt's minimum still leaves
the account. Counting plan debts only would report headroom that does not
exist, which is the kind of wrong that causes a missed payment. The label says
"all accounts" so the difference is visible rather than mysterious.

Naming: budgetSet / budgetNudge already exist and mean "set the EXTRA". These
are planBudget*, and #extra-payment is untouched — sixteen plan sites and the
video pipeline's preflight read that id.
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
// v1.42.0 — MONTHLY MONEY PLAN  (free)
//
// A budget the user sets, checked against what they have committed. It is a
// mirror, not a lever: nothing here is read by simulate(), planExtra(),
// getPlanSim() or any figure on any other tab. extraMonthly remains the single
// input that drives the plan.
//
// Why a budget rather than income: a budget is a number the user chooses and
// revisits, so it does not silently rot the way a salary entered once does,
// and it works for hourly, gig and commission earners who cannot honestly
// answer "net monthly income". It also keeps the app clear of anything that
// reads as telling someone what they can afford.
// ══════════════════════════════════════════════════════════════════════

var PLAN_BUDGET_STEP = 50;

// Every debt with a balance, not just the plan ones — see the header note.
function allMinimumsTotal() {
  return (debts || []).reduce(function (a, d) {
    if (!d || d.balance <= 0) return a;
    var f = minPaymentFloors(d);
    return a + Math.min(d.balance, (f && f.now) ? f.now : (d.minPayment || 0));
  }, 0);
}

// What the user has actually committed this month: every minimum they owe,
// plus the extra they chose, plus bills (premium — free users have none).
function committedMonthlyTotal() {
  var extra = parseAmount((document.getElementById('extra-payment') || {}).value) || 0;
  return allMinimumsTotal() + extra + rolledOverTotal()
       + (isPremium ? billsMonthlyTotal() : 0);
}

function setPlanBudget(v) {
  var n = parseFloat(v);
  monthlyBudget = (isNaN(n) || n < 0) ? 0 : Math.min(n, 10000000);
  save();
  renderMoneyPlan();
  trackShare('budget_set', { _category: 'planning', has_budget: monthlyBudget > 0 ? 'yes' : 'no' });
}

function planBudgetNudge(dir) {
  var el = document.getElementById('plan-budget');
  var cur = parseAmount(el ? el.value : '') || 0;
  var next = Math.max(0, cur + dir * PLAN_BUDGET_STEP);
  if (el) el.value = next;
  setPlanBudget(next);
}

function planBudgetInput(v) {
  var n = parseAmount(v);
  monthlyBudget = (isNaN(n) || n < 0) ? 0 : n;
  save();
  renderMoneyPlan();
}

// Adopt what they are already committing. Turns an unanswerable question
// ("what is my monthly budget?") into a confirmable one.
function planBudgetMatchCommitted() {
  var t = Math.round(committedMonthlyTotal());
  var el = document.getElementById('plan-budget');
  if (el) el.value = t;
  setPlanBudget(t);
  trackShare('budget_matched', { _category: 'planning' });
}

function renderMoneyPlan() {
  var line = document.getElementById('plan-budget-line');
  var breakdown = document.getElementById('plan-budget-breakdown');
  var matchBtn = document.getElementById('plan-budget-match');
  var input = document.getElementById('plan-budget');
  if (!line || !breakdown || !input) return;

  if (document.activeElement !== input) {
    input.value = monthlyBudget > 0 ? Math.round(monthlyBudget) : '';
  }

  var mins = allMinimumsTotal();
  var extra = (parseAmount((document.getElementById('extra-payment') || {}).value) || 0)
            + rolledOverTotal();
  var billTotal = isPremium ? billsMonthlyTotal() : 0;
  var committed = mins + extra + billTotal;

  if (matchBtn) {
    matchBtn.textContent = 'Match what I’m committing (' + fmt(committed) + ')';
    matchBtn.style.display = (committed > 0 && Math.round(committed) !== Math.round(monthlyBudget)) ? '' : 'none';
  }

  var parts = [];
  if (billTotal > 0) parts.push('bills ' + fmt(billTotal));
  parts.push('minimums ' + fmt(mins) + ' (all accounts)');
  if (extra > 0) parts.push('extra ' + fmt(extra));
  breakdown.textContent = parts.join('  ·  ') + '  =  ' + fmt(committed) + ' a month';

  if (!monthlyBudget || monthlyBudget <= 0) {
    line.textContent = '';
    line.className = 'plan-budget-line';
    return;
  }

  var diff = monthlyBudget - committed;
  // Both readings are plain arithmetic against a number the user chose. Nothing
  // here tells anyone what they can afford or what they ought to do about it.
  if (Math.abs(diff) < 1) {
    line.textContent = 'That matches your ' + fmt(monthlyBudget) + ' budget exactly.';
    line.className = 'plan-budget-line is-level';
  } else if (diff > 0) {
    line.textContent = fmt(diff) + ' of your ' + fmt(monthlyBudget) + ' budget isn’t allocated yet.';
    line.className = 'plan-budget-line is-under';
  } else {
    line.textContent = 'That’s ' + fmt(-diff) + ' more than your ' + fmt(monthlyBudget) + ' budget.';
    line.className = 'plan-budget-line is-over';
  }
}
'''

MARKUP = r'''      <!-- v1.42.0 — the budget check. Deliberately lighter than Extra Per Month
           above it: extra drives the plan, this only measures it. -->
      <div class="money-plan">
        <label class="money-plan-label" for="plan-budget">Monthly budget for debts and bills <span class="field-optional">optional</span></label>
        <div class="wi-stepper money-plan-stepper">
          <button type="button" class="wi-nudge" onclick="planBudgetNudge(-1)" aria-label="$50 less">&minus;</button>
          <input type="text" inputmode="decimal" id="plan-budget" placeholder="2,000" min="0"
            style="flex:1;min-width:0;" oninput="planBudgetInput(this.value)" onchange="setPlanBudget(this.value)" />
          <button type="button" class="wi-nudge" onclick="planBudgetNudge(1)" aria-label="$50 more">+</button>
        </div>
        <button type="button" class="btn btn-ghost money-plan-match" id="plan-budget-match" onclick="planBudgetMatchCommitted()"></button>
        <div class="plan-budget-breakdown" id="plan-budget-breakdown"></div>
        <div class="plan-budget-line" id="plan-budget-line"></div>
      </div>
'''

CSS = r'''
/* v1.42.0 — Monthly Money Plan. Visually quieter than the extra-payment
   control above it, because it checks the plan rather than driving it. */
.money-plan { grid-column:1/-1; margin-top:14px; padding-top:14px; border-top:1px solid var(--border); }
.money-plan-label { display:block; font-size:0.78rem; color:var(--text-muted); margin-bottom:6px; }
.money-plan-stepper { width:100%; max-width:260px; }
.money-plan-match { font-size:0.7rem; padding:6px 10px; margin-top:8px; }
.plan-budget-breakdown { font-family:var(--font-mono); font-size:0.68rem; color:var(--text-muted);
  margin-top:10px; line-height:1.5; }
.plan-budget-line { font-size:0.8rem; margin-top:6px; line-height:1.5; }
.plan-budget-line.is-under { color:var(--accent); }
.plan-budget-line.is-level { color:var(--text-muted); }
/* Over budget is amber, never red: the user picked both numbers and either one
   can move. It is a mismatch to look at, not a verdict. */
.plan-budget-line.is-over  { color:var(--accent4); }
'''

def dash(s):
    s = sub(s, "let bills = [];              // v1.42.0 — recurring non-debt outgoings (premium)",
            "let bills = [];              // v1.42.0 — recurring non-debt outgoings (premium)\n"
            "let monthlyBudget = 0;       // v1.42.0 — budget-as-check; never read by the engine",
            'declare monthlyBudget')

    s = sub(s, "function renderBills() {", LOGIC + "\nfunction renderBills() {", 'insert money plan logic')

    # title
    s = sub(s, '<div class="card-title"><div class="dot"></div> Monthly Payoff Budget</div>',
            '<div class="card-title"><div class="dot"></div> Monthly Money Plan</div>',
            'rename card to Monthly Money Plan')

    # markup: after the strategy field, inside the same form-grid
    s = sub(s, """            <option value="hybrid">Hybrid &mdash; custom order</option>
          </select>
        </div>
      </div>
    </div>""",
            """            <option value="hybrid">Hybrid &mdash; custom order</option>
          </select>
        </div>
""" + MARKUP + """      </div>
    </div>""",
            'insert money plan markup')

    s = sub(s, "  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert CSS')

    # persistence
    s = sub(s, "    localStorage.setItem('debtfree_bills', JSON.stringify(bills));          // v1.42.0",
            "    localStorage.setItem('debtfree_bills', JSON.stringify(bills));          // v1.42.0\n"
            "    localStorage.setItem('debtfree_budget', String(monthlyBudget || 0));     // v1.42.0",
            'save monthlyBudget')

    s = sub(s, "    const bl = localStorage.getItem('debtfree_bills');",
            "    const mb = localStorage.getItem('debtfree_budget');\n"
            "    if (mb !== null) { var _mb = parseFloat(mb); monthlyBudget = (isNaN(_mb) || _mb < 0) ? 0 : _mb; }\n"
            "    const bl = localStorage.getItem('debtfree_bills');",
            'load monthlyBudget')

    # both payloads
    s = sub(s, "\n      bills: bills,                     // v1.42.0",
            "\n      bills: bills,                     // v1.42.0\n      monthlyBudget: monthlyBudget,     // v1.42.0",
            'update-restore payload carries budget')
    s = sub(s, "\n    bills: bills,                     // v1.42.0",
            "\n    bills: bills,                     // v1.42.0\n    monthlyBudget: monthlyBudget,     // v1.42.0",
            'backup payload carries budget')

    # both restore sites
    s = sub(s, "      if (Array.isArray(data.bills)) { bills = data.bills.map(sanitizeBill).filter(Boolean); }",
            "      var _mbR = parseFloat(data.monthlyBudget);\n"
            "      monthlyBudget = (isNaN(_mbR) || _mbR < 0) ? 0 : _mbR;\n"
            "      if (Array.isArray(data.bills)) { bills = data.bills.map(sanitizeBill).filter(Boolean); }",
            'applyBackupPayload restores budget')
    s = sub(s, "        if (Array.isArray(data.bills)) bills = data.bills.map(sanitizeBill).filter(Boolean);   // v1.42.0",
            "        var _mbU = parseFloat(data.monthlyBudget);\n"
            "        if (!isNaN(_mbU) && _mbU >= 0) monthlyBudget = _mbU;   // v1.42.0\n"
            "        if (Array.isArray(data.bills)) bills = data.bills.map(sanitizeBill).filter(Boolean);   // v1.42.0",
            'update-restore reads budget')

    # render wiring — after renderBills so bill totals are current
    s = sub(s, "  renderBills();           // v1.42.0 (premium)",
            "  renderBills();           // v1.42.0 (premium)\n  renderMoneyPlan();       // v1.42.0",
            'wire renderMoneyPlan')
    return s

edit(sys.argv[1], dash)
