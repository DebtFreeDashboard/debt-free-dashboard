#!/usr/bin/env python3
"""
v1.42.0 part 4 — per-month tick-off for bills.

A bill carries paidThrough: 'YYYY-MM' — one string, not a growing list, so it
cannot bloat a backup over years of use.

The rule that makes this work for both kinds of user:

  A bill is only eligible for the "not marked paid" state once it has been
  ticked at least ONCE (paidThrough exists).

Somebody who never ticks anything — the autopay case — sees exactly the old
behaviour: bills roll forward quietly and nothing ever nags. Somebody who ticks
is telling the app they are tracking that bill by hand, so the app can honestly
say "you haven't marked this one this month". No extra setting, no toggle to
explain; using the feature opts you in.

Copy stays inside what the app knows: "not marked paid yet", never "unpaid" or
"late". Ticking is a note to yourself, not evidence of payment.
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
// ── Bill tick-off ─────────────────────────────────────────────────────
// paidThrough is the last month the user marked this bill handled, as
// 'YYYY-MM'. One value rather than a history: the app only ever asks about
// the current month, and a growing list would swell every backup forever.

function currentMonthKey() { return monthKeyOf(new Date()); }

function billMarkedThisMonth(bill) {
  return !!bill && bill.paidThrough === currentMonthKey();
}

// Has this bill ever been ticked? If not, the user is not tracking it by hand
// (autopay, or simply not interested), so it never shows an unmarked state.
function billIsTracked(bill) {
  return !!(bill && bill.paidThrough);
}

function toggleBillPaid(id) {
  var b = (bills || []).find(function (x) { return x.id === id; });
  if (!b) return;
  var now = currentMonthKey();
  if (b.paidThrough === now) {
    // Untick. Step back a month rather than clearing the field, so the bill
    // stays "tracked" and does not silently fall back to never nagging.
    var d = new Date();
    d.setDate(1); d.setMonth(d.getMonth() - 1);
    b.paidThrough = monthKeyOf(d);
  } else {
    b.paidThrough = now;
  }
  save(); render();
  trackShare('bill_marked', { _category: 'engagement', marked: b.paidThrough === now ? 'yes' : 'no' });
}
'''

def dash(s):
    s = sub(s, "function sanitizeBill(b) {", LOGIC + "\nfunction sanitizeBill(b) {", 'insert tick logic')

    # persist the field
    s = sub(s,
            "  return { id: isNaN(id) ? nextId++ : id, name: name, amount: amount, dueDay: day };",
            "  // 'YYYY-MM' or absent. Anything else is discarded rather than trusted.\n"
            "  var pt = (typeof b.paidThrough === 'string' && /^\\d{4}-\\d{2}$/.test(b.paidThrough))\n"
            "    ? b.paidThrough : null;\n"
            "  return { id: isNaN(id) ? nextId++ : id, name: name, amount: amount, dueDay: day,\n"
            "           paidThrough: pt };",
            'sanitizeBill keeps paidThrough')

    # Coming Up: bills gain marked / unmarked states
    s = sub(s, """      var when = nextDueDate(bday);
      var n = daysUntil(when);
      rows.push({
        id: bill.id, name: bill.name, kind: 'bill',
        status: n === 0 ? 'today' : (n <= DUE_SOON_DAYS ? 'soon' : 'later'),
        date: when, days: n, amount: parseFloat(bill.amount) || 0, paid: 0
      });""",
            """      var thisMonthDue = dueDateIn(new Date().getFullYear(), new Date().getMonth(), bday);
      var when, status;

      if (billMarkedThisMonth(bill)) {
        // Handled for this month; show when it next comes round.
        status = 'logged'; when = nextDueDate(bday);
      } else if (billIsTracked(bill) && daysUntil(thisMonthDue) < 0) {
        // Tracked by hand and this month's day has gone by without a tick.
        // Only reachable once the user has ticked at least once, so an autopay
        // bill never lands here.
        status = 'passed'; when = thisMonthDue;
      } else {
        when = nextDueDate(bday);
        var n = daysUntil(when);
        status = n === 0 ? 'today' : (n <= DUE_SOON_DAYS ? 'soon' : 'later');
      }

      rows.push({
        id: bill.id, name: bill.name, kind: 'bill', status: status,
        date: when, days: daysUntil(when),
        amount: parseFloat(bill.amount) || 0, paid: 0,
        marked: billMarkedThisMonth(bill)
      });""",
            'bills gain marked / unmarked states')

    # labels: a bill's wording differs from a debt's, because the evidence differs
    s = sub(s, """function dueRowLabel(r) {
  if (r.status === 'logged') return 'payment logged this month';
  if (r.status === 'today')  return 'due today';
  if (r.status === 'passed') {
    // Deliberately not "missed" or "late" — the app cannot know that.
    return 'was due ' + dueDayLabel(r.date) + ' · no payment logged yet';
  }""",
            """function dueRowLabel(r) {
  var isBill = r.kind === 'bill';
  // A tick is a note to yourself, not evidence of payment — so a bill says
  // "marked paid", never "paid".
  if (r.status === 'logged') {
    return isBill ? 'marked paid this month' : 'payment logged this month';
  }
  if (r.status === 'today')  return 'due today';
  if (r.status === 'passed') {
    // Deliberately not "missed" or "late" — the app cannot know that.
    return 'was due ' + dueDayLabel(r.date) + ' \\u00b7 '
         + (isBill ? 'not marked paid yet' : 'no payment logged yet');
  }""",
            'bill-specific labels')

    # the row control: tick for bills, Log for debts
    s = sub(s, """         +      (r.kind === 'bill'
                  ? '<span class="due-row-kind">bill</span>'
                  : '<button type="button" class="due-row-log" onclick="logFromDue(' + r.id + ')">Log</button>')""",
            """         +      (r.kind === 'bill'
                  ? '<button type="button" class="due-row-tick' + (r.marked ? ' is-marked' : '') + '" '
                    + 'onclick="toggleBillPaid(' + r.id + ')" '
                    + 'aria-pressed="' + (r.marked ? 'true' : 'false') + '" '
                    + 'title="' + (r.marked ? 'Marked paid this month' : 'Mark as paid this month') + '" '
                    + 'aria-label="' + (r.marked ? 'Unmark' : 'Mark') + ' ' + escapeHtml(r.name) + ' as paid this month">'
                    + (r.marked ? '\\u2713' : 'Mark') + '</button>'
                  : '<button type="button" class="due-row-log" onclick="logFromDue(' + r.id + ')">Log</button>')""",
            'tick control on bill rows')

    # A marked bill should still be visible somewhere this month, otherwise
    # ticking makes it vanish and the user cannot undo it.
    s = sub(s, """  var active = rows.filter(function (r) { return r.status !== 'later' && r.status !== 'logged'; });""",
            """  var active = rows.filter(function (r) { return r.status !== 'later' && r.status !== 'logged'; });

  // A bill ticked this month drops out of the attention list, but it must stay
  // reachable — otherwise ticking makes the row vanish with no way to undo a
  // mis-tap. Marked bills whose day is still ahead ride along at the bottom.
  var markedSoon = rows.filter(function (r) {
    return r.kind === 'bill' && r.marked && r.days <= DUE_SOON_DAYS;
  });
  if (active.length) active = active.concat(markedSoon);""",
            'keep a just-ticked bill reachable')

    # bills card shows the state too
    s = sub(s, """           +   '<button type="button" class="bill-del" onclick="removeBill(' + b.id + ')" aria-label="Remove ' + escapeHtml(b.name) + '">&times;</button>'""",
            """           +   '<button type="button" class="bill-tick' + (billMarkedThisMonth(b) ? ' is-marked' : '') + '" '
           +     'onclick="toggleBillPaid(' + b.id + ')" '
           +     'aria-pressed="' + (billMarkedThisMonth(b) ? 'true' : 'false') + '" '
           +     'title="' + (billMarkedThisMonth(b) ? 'Marked paid this month' : 'Mark as paid this month') + '" '
           +     'aria-label="' + (billMarkedThisMonth(b) ? 'Unmark' : 'Mark') + ' ' + escapeHtml(b.name) + ' as paid this month">\\u2713</button>'
           +   '<button type="button" class="bill-del" onclick="removeBill(' + b.id + ')" aria-label="Remove ' + escapeHtml(b.name) + '">&times;</button>'""",
            'tick in the bills card')

    CSS = """
/* v1.42.0 — bill tick-off. Unmarked is quiet; marked is a filled check. */
.due-row-tick, .bill-tick {
  font-family:var(--font-mono); font-size:0.68rem; letter-spacing:0.05em;
  padding:5px 10px; border-radius:6px; border:1px solid var(--border);
  background:var(--card2); color:var(--text-muted); cursor:pointer; line-height:1;
}
.bill-tick { width:30px; height:30px; flex-shrink:0; padding:0; font-size:0.8rem; }
.due-row-tick:hover, .bill-tick:hover { border-color:var(--accent); color:var(--accent); }
.due-row-tick.is-marked, .bill-tick.is-marked {
  background:var(--accent); border-color:var(--accent); color:#0a0a0f; font-weight:700;
}
.due-logged .due-row-sub { color:var(--text-muted); }
"""
    s = sub(s, "  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert tick CSS')
    return s

edit(sys.argv[1], dash)
