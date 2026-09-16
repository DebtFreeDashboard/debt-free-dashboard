#!/usr/bin/env python3
"""
v1.42.0 part 3 — recurring bills (premium).

Bills ride the SAME nextId counter as debts. A separate counter would be one
more thing to persist and one more thing to get wrong on restore, and the
Coming Up card merges both kinds into one list keyed by id — a shared counter
makes a collision impossible by construction.

Deliberate limitation, worth knowing before it looks like a bug: a bill has no
"no payment logged yet" state. The app tracks payments against debts, not
bills, so it genuinely cannot know whether a bill was paid. Once its day
passes, a bill simply rolls to next month. Showing a permanent amber "was due"
on a bill somebody autopays would be noise every month forever, and the app
would be asserting something it cannot know.
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
// v1.42.0 — RECURRING BILLS  (premium)
//
// A bill is { id, name, amount, dueDay }. Rent, utilities, subscriptions —
// money that leaves every month and is NOT part of the payoff plan. Bills
// never touch simulate(), extraMonthly or any plan figure; they exist so the
// Coming Up card shows everything that is actually due, and so the Monthly
// Money Plan can check a budget against real outgoings.
//
// ids come from the shared nextId counter, so a bill id can never collide
// with a debt id in the merged Coming Up list.
// ══════════════════════════════════════════════════════════════════════

function sanitizeBill(b) {
  if (!b || typeof b !== 'object') return null;
  var name = String(b.name == null ? '' : b.name).trim().slice(0, 60);
  var amount = parseFloat(b.amount);
  var day = sanitizeDueDay(b.dueDay);
  if (!name) return null;
  if (isNaN(amount) || amount < 0 || amount > 1000000) amount = 0;
  var id = parseInt(b.id, 10);
  return { id: isNaN(id) ? nextId++ : id, name: name, amount: amount, dueDay: day };
}

function billsMonthlyTotal() {
  return (bills || []).reduce(function (a, b) { return a + (parseFloat(b.amount) || 0); }, 0);
}

function addBill() {
  var nameEl = document.getElementById('bill-name');
  var amtEl  = document.getElementById('bill-amount');
  var dayEl  = document.getElementById('bill-due-day');
  var err    = document.getElementById('bill-error');
  if (!nameEl || !amtEl) return;

  var name = (nameEl.value || '').trim();
  var amount = parseAmount(amtEl.value);
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  nameEl.classList.remove('field-invalid'); amtEl.classList.remove('field-invalid');

  if (!name) {
    if (err) { err.textContent = 'Give the bill a name so you can tell it apart.'; err.style.display = 'block'; }
    nameEl.classList.add('field-invalid'); nameEl.focus(); return;
  }
  if (isNaN(amount) || amount <= 0) {
    if (err) { err.textContent = 'Enter what this bill costs each month.'; err.style.display = 'block'; }
    amtEl.classList.add('field-invalid'); amtEl.focus(); return;
  }

  bills.push({ id: nextId++, name: name.slice(0, 60), amount: amount,
               dueDay: sanitizeDueDay(dayEl ? dayEl.value : null) });
  nameEl.value = ''; amtEl.value = ''; if (dayEl) dayEl.value = '';
  save(); render();
  trackShare('bill_added', { _category: 'engagement', bill_count: bills.length,
                             has_due_day: (dayEl && dayEl.value) ? 'yes' : 'no' });
  nameEl.focus();
}

function removeBill(id) {
  var i = (bills || []).findIndex(function (b) { return b.id === id; });
  if (i === -1) return;
  bills.splice(i, 1);
  save(); render();
  trackShare('bill_removed', { _category: 'engagement', bill_count: bills.length });
}

// Inline edit: the row's fields write straight back. A modal for three fields
// would be more ceremony than the data deserves.
function updateBill(id, field, value) {
  var b = (bills || []).find(function (x) { return x.id === id; });
  if (!b) return;
  if (field === 'name')   b.name = String(value || '').trim().slice(0, 60) || b.name;
  if (field === 'amount') { var a = parseAmount(value); if (!isNaN(a) && a >= 0) b.amount = a; }
  if (field === 'dueDay') b.dueDay = sanitizeDueDay(value);
  save(); render();
}

function renderBills() {
  var card = document.getElementById('bills-card');
  var teaser = document.getElementById('bills-teaser');
  if (!card || !teaser) return;
  card.style.display = isPremium ? '' : 'none';
  teaser.style.display = isPremium ? 'none' : '';
  if (!isPremium) return;

  var list = document.getElementById('bills-list');
  var total = document.getElementById('bills-total');
  if (!list) return;

  if (!bills.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5;padding:4px 0 10px;">'
                   + 'Nothing added yet. Rent, utilities, insurance, subscriptions — whatever leaves every month.'
                   + '</div>';
  } else {
    list.innerHTML = bills.map(function (b) {
      return '<div class="bill-row">'
           +   '<input class="bill-name" type="text" value="' + escapeHtml(b.name) + '" maxlength="60" '
           +     'onchange="updateBill(' + b.id + ', \'name\', this.value)" aria-label="Bill name" />'
           +   '<input class="bill-amt money-input" type="text" inputmode="decimal" value="' + b.amount + '" '
           +     'onchange="updateBill(' + b.id + ', \'amount\', this.value)" aria-label="Monthly amount" />'
           +   '<input class="bill-day" type="text" inputmode="numeric" maxlength="2" placeholder="--" '
           +     'value="' + (sanitizeDueDay(b.dueDay) || '') + '" '
           +     'onchange="updateBill(' + b.id + ', \'dueDay\', this.value)" aria-label="Due day" />'
           +   '<button type="button" class="bill-del" onclick="removeBill(' + b.id + ')" aria-label="Remove ' + escapeHtml(b.name) + '">&times;</button>'
           + '</div>';
    }).join('');
  }
  if (total) {
    total.textContent = bills.length
      ? fmt(billsMonthlyTotal()) + ' a month across ' + bills.length + (bills.length === 1 ? ' bill' : ' bills')
      : '';
  }
  maskFinancialInputs(list);
}
'''

MARKUP = r'''<div class="card" id="bills-card" data-collapse="bills" data-collapse-default="closed" data-premium data-premium-managed style="display:none">
      <div class="card-title"><div class="dot"></div> Recurring Bills <span class="premium-tag">Premium</span></div>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">Money that leaves every month besides your debts. Add a due day and it shows up alongside your payments in Coming Up.</p>
      <div id="bills-list"></div>
      <div id="bills-total" style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);margin:8px 0 14px;"></div>
      <div class="bill-add">
        <input id="bill-name" type="text" placeholder="Rent" maxlength="60" aria-label="Bill name" />
        <input id="bill-amount" type="text" inputmode="decimal" placeholder="1,200" aria-label="Monthly amount" />
        <input id="bill-due-day" type="text" inputmode="numeric" maxlength="2" placeholder="Day" aria-label="Due day" />
      </div>
      <div class="form-error" id="bill-error" style="display:none;"></div>
      <button class="btn btn-ghost" style="margin-top:10px;" onclick="addBill()">Add bill</button>
    </div>
<div class="card" id="bills-teaser" data-teaser data-teaser-managed style="display:none" onclick="trackTeaserClick('bills');document.getElementById('unlock-box').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="card-title"><div class="dot"></div> Recurring Bills <span class="premium-tag">Premium</span></div>
      <div class="blur-teaser">
        <div class="blur-content">
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">Money that leaves every month besides your debts.</p>
          <div class="bill-row"><div class="bill-name-static">Rent</div><div class="bill-amt-static">$1,200</div><div class="bill-day-static">1st</div></div>
          <div class="bill-row"><div class="bill-name-static">Car insurance</div><div class="bill-amt-static">$142</div><div class="bill-day-static">12th</div></div>
          <div class="bill-row"><div class="bill-name-static">Phone</div><div class="bill-amt-static">$85</div><div class="bill-day-static">20th</div></div>
        </div>
        <div class="blur-overlay">
          <div style="font-size:1.4rem;">&#128274;</div>
          <div class="lock-card-title">Everything due, in one place</div>
          <div class="lock-card-desc" style="max-width:280px;">Your bills alongside your debt payments, so nothing lands on you unexpectedly.</div>
          <div class="lock-card-cta">Unlock</div>
        </div>
      </div>
    </div>
'''

CSS = r'''
/* v1.42.0 — recurring bills */
.bill-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); }
.bill-row:last-child { border-bottom:none; }
.bill-row input, .bill-add input { font-family:inherit; font-size:0.82rem; padding:7px 8px;
  border:1px solid var(--border); border-radius:6px; background:var(--card2); color:var(--text); min-width:0; }
.bill-name, .bill-name-static { flex:1; min-width:0; }
.bill-amt, .bill-amt-static { width:86px; flex-shrink:0; text-align:right; font-family:var(--font-mono); }
.bill-day, .bill-day-static { width:52px; flex-shrink:0; text-align:center; font-family:var(--font-mono); }
.bill-name-static, .bill-amt-static, .bill-day-static { font-size:0.82rem; padding:7px 0; }
.bill-del { flex-shrink:0; width:30px; height:30px; border-radius:6px; border:1px solid var(--border);
  background:var(--card2); color:var(--text-muted); cursor:pointer; font-size:1rem; line-height:1; }
.bill-del:hover { border-color:var(--accent3); color:var(--accent3); }
.bill-add { display:flex; gap:8px; margin-top:10px; }
.bill-add #bill-name { flex:1; min-width:0; }
.bill-add #bill-amount { width:86px; flex-shrink:0; }
.bill-add #bill-due-day { width:60px; flex-shrink:0; }
'''

def dash(s):
    # state
    s = sub(s, "let rolledMinimums = [];",
            "let rolledMinimums = [];\nlet bills = [];              // v1.42.0 — recurring non-debt outgoings (premium)",
            'declare bills')

    s = sub(s, "function renderUpcoming() {", LOGIC + "\nfunction renderUpcoming() {", 'insert bills logic')

    # persistence
    s = sub(s, "    localStorage.setItem('debtfree_rolled', JSON.stringify(rolledMinimums)); // v1.38.0",
            "    localStorage.setItem('debtfree_rolled', JSON.stringify(rolledMinimums)); // v1.38.0\n"
            "    localStorage.setItem('debtfree_bills', JSON.stringify(bills));          // v1.42.0",
            'save bills')

    # load — must happen BEFORE selectStrategy, which triggers save() and would
    # otherwise write an empty array over the stored one (the lumpSums trap).
    s = sub(s, "    const rl = localStorage.getItem('debtfree_rolled');",
            "    // v1.42.0 — same ordering rule as lumpSums above: load before\n"
            "    // selectStrategy() fires save(), or the stored bills are overwritten.\n"
            "    const bl = localStorage.getItem('debtfree_bills');\n"
            "    if (bl) { try { bills = (JSON.parse(bl) || []).map(sanitizeBill).filter(Boolean); } catch (e) { bills = []; } }\n"
            "    const rl = localStorage.getItem('debtfree_rolled');",
            'load bills before selectStrategy')

    # both payload sites (backup AND update-restore) carry identical text
    # Newline-prefixed: the 4-space form is a substring of the 6-space form, so
    # a bare indent anchor matches both and the count assert misfires.
    s = sub(s, "\n      rolledMinimums: rolledMinimums,   // v1.38.0",
            "\n      rolledMinimums: rolledMinimums,   // v1.38.0\n      bills: bills,                     // v1.42.0",
            'update-restore payload carries bills')
    s = sub(s, "\n    rolledMinimums: rolledMinimums,   // v1.38.0",
            "\n    rolledMinimums: rolledMinimums,   // v1.38.0\n    bills: bills,                     // v1.42.0",
            'backup payload carries bills')

    # both restore sites
    s = sub(s, "      if (Array.isArray(data.rolledMinimums)) { rolledMinimums = data.rolledMinimums; }",
            "      if (Array.isArray(data.bills)) { bills = data.bills.map(sanitizeBill).filter(Boolean); }\n"
            "      else { bills = []; }\n"
            "      if (Array.isArray(data.rolledMinimums)) { rolledMinimums = data.rolledMinimums; }",
            'applyBackupPayload restores bills')
    s = sub(s, "        if (Array.isArray(data.rolledMinimums)) rolledMinimums = data.rolledMinimums;   // v1.38.0",
            "        if (Array.isArray(data.bills)) bills = data.bills.map(sanitizeBill).filter(Boolean);   // v1.42.0\n"
            "        if (Array.isArray(data.rolledMinimums)) rolledMinimums = data.rolledMinimums;   // v1.38.0",
            'update-restore reads bills')

    # markup + css, on Strategy beside the Money Plan work
    s = sub(s, '<div class="card" id="amort-card"', MARKUP + '<div class="card" id="amort-card"', 'insert bills card')
    s = sub(s, "  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert bills CSS')

    # Coming Up merges bills, premium only
    s = sub(s, """  // Anything needing attention first, then by date.
  var rank = { passed: 0, today: 1, soon: 2, later: 3, logged: 4 };""",
            """  // v1.42.0 — bills join the same list, premium only. A bill is money that is
  // genuinely due; leaving it out would make this card a partial answer to the
  // one question it exists to answer.
  //
  // Bills have no 'passed' state: payments are tracked against debts, not
  // bills, so the app cannot know whether one was paid. Once its day passes a
  // bill rolls to next month rather than sitting amber forever on something
  // the user may well have on autopay.
  if (isPremium) {
    (bills || []).forEach(function (bill) {
      var bday = sanitizeDueDay(bill.dueDay);
      if (!bday) return;
      var when = nextDueDate(bday);
      var n = daysUntil(when);
      rows.push({
        id: bill.id, name: bill.name, kind: 'bill',
        status: n === 0 ? 'today' : (n <= DUE_SOON_DAYS ? 'soon' : 'later'),
        date: when, days: n, amount: parseFloat(bill.amount) || 0, paid: 0
      });
    });
  }

  // Anything needing attention first, then by date.
  var rank = { passed: 0, today: 1, soon: 2, later: 3, logged: 4 };""",
            'Coming Up merges bills')

    # a bill row cannot open the payment log — that logs against debts
    s = sub(s, """         +      '<div class="due-row-amt">' + fmt(r.amount) + '</div>'
         +      '<button type="button" class="due-row-log" onclick="logFromDue(' + r.id + ')">Log</button>'""",
            """         +      '<div class="due-row-amt">' + fmt(r.amount) + '</div>'
         +      (r.kind === 'bill'
                  ? '<span class="due-row-kind">bill</span>'
                  : '<button type="button" class="due-row-log" onclick="logFromDue(' + r.id + ')">Log</button>')""",
            'bill rows show a tag, not a Log button')

    # render wiring
    s = sub(s, "  renderUpcoming();        // v1.42.0",
            "  renderUpcoming();        // v1.42.0\n  renderBills();           // v1.42.0 (premium)",
            'wire renderBills')
    return s

edit(sys.argv[1], dash)
