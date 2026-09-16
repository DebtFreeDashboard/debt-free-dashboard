#!/usr/bin/env python3
"""
v1.42.0 part 1 — due dates on debts + the Upcoming card (Dashboard, free tier).

Copy rule held throughout: the app knows what was LOGGED, not what was PAID.
Nothing here says missed, late or overdue. This matches the streak logic, which
already deliberately never names a missed month, and dashboard.md's rule that a
missed month usually means someone genuinely could not pay.
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
// v1.42.0 — DUE DATES  (free)
//
// A debt carries an optional dueDay (1-31). Everything derived from it lives
// here so there is exactly one place that decides what "due" means.
//
// The app only knows what the user LOGGED. It cannot know what they actually
// paid. So nothing in this file — or in any copy it produces — says missed,
// late, or overdue. A debt past its day with nothing logged reads "no payment
// logged yet", which is the only claim the data supports. This is the same
// rule the streak logic follows.
// ══════════════════════════════════════════════════════════════════════

var DUE_SOON_DAYS = 7;   // how far ahead the Upcoming card looks

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// The dueDay clamped into a given month. A card due on the 31st is due on the
// 28th in February — storing 31 and clamping at read time is right, because
// clamping at write time would permanently lose the user's actual due day.
function dueDateIn(year, month, dueDay) {
  var d = Math.min(Math.max(parseInt(dueDay, 10) || 0, 1), 31);
  return new Date(year, month, Math.min(d, daysInMonth(year, month)));
}

// This month's occurrence, whether or not it has passed.
function dueDateThisMonth(dueDay) {
  var now = new Date();
  return dueDateIn(now.getFullYear(), now.getMonth(), dueDay);
}

// The next occurrence from today, rolling into next month once today's has passed.
function nextDueDate(dueDay) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var here = dueDateIn(today.getFullYear(), today.getMonth(), dueDay);
  if (here >= today) return here;
  return dueDateIn(today.getFullYear(), today.getMonth() + 1, dueDay);
}

function daysUntil(date) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date - today) / 86400000);
}

function sanitizeDueDay(v) {
  if (v === '' || v === null || typeof v === 'undefined') return null;
  var n = parseInt(v, 10);
  if (isNaN(n) || n < 1 || n > 31) return null;
  return n;
}

// Rows for the Upcoming card. One per active debt that has a dueDay.
//   status: 'logged'   payment already logged this month
//           'today'    due today, nothing logged
//           'soon'     due within DUE_SOON_DAYS, nothing logged
//           'passed'   this month's day has gone by with nothing logged
//           'later'    due further out than DUE_SOON_DAYS
function upcomingDues() {
  var ledger = currentMonthLedger();
  var rows = [];
  (debts || []).forEach(function (d) {
    if (!d || d.balance <= 0) return;                 // cleared debts have nothing due
    var day = sanitizeDueDay(d.dueDay);
    if (!day) return;

    var paid = ledger.paid[d.id] || 0;
    var thisMonth = dueDateThisMonth(day);
    var next = nextDueDate(day);
    var status, when;

    if (paid > 0) {
      status = 'logged'; when = next;
    } else if (daysUntil(thisMonth) < 0) {
      status = 'passed'; when = thisMonth;
    } else {
      var n = daysUntil(next);
      status = n === 0 ? 'today' : (n <= DUE_SOON_DAYS ? 'soon' : 'later');
      when = next;
    }

    var floors = minPaymentFloors(d);
    rows.push({
      id: d.id, name: d.name, status: status, date: when,
      days: daysUntil(when),
      amount: Math.max(0, Math.min(d.balance, floors && floors.now ? floors.now : d.minPayment)),
      paid: paid
    });
  });
  // Anything needing attention first, then by date.
  var rank = { passed: 0, today: 1, soon: 2, later: 3, logged: 4 };
  rows.sort(function (a, b) {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.date - b.date;
  });
  return rows;
}

function dueRowLabel(r) {
  if (r.status === 'logged') return 'payment logged this month';
  if (r.status === 'today')  return 'due today';
  if (r.status === 'passed') {
    // Deliberately not "missed" or "late" — the app cannot know that.
    return 'was due ' + dueDayLabel(r.date) + ' · no payment logged yet';
  }
  if (r.days === 1) return 'due tomorrow';
  return 'due ' + dueDayLabel(r.date) + ' · in ' + r.days + ' days';
}

function dueDayLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderUpcoming() {
  var card = document.getElementById('upcoming-card');
  if (!card) return;
  var body = document.getElementById('upcoming-body');
  var quiet = document.getElementById('upcoming-quiet');
  if (!body || !quiet) return;

  var rows = upcomingDues();

  // No due days set anywhere -> the feature is not in use; show nothing at all
  // rather than an empty card asking to be filled in.
  if (!rows.length) { card.style.display = 'none'; return; }
  card.style.display = '';

  // Only rows that need attention earn space. When nothing is close, the card
  // collapses to one muted line so the Dashboard still opens on progress
  // rather than on a list of obligations.
  var active = rows.filter(function (r) { return r.status !== 'later' && r.status !== 'logged'; });

  if (!active.length) {
    body.innerHTML = '';
    var next = rows.slice().sort(function (a, b) { return a.date - b.date; })[0];
    quiet.style.display = '';
    quiet.textContent = 'Nothing due in the next ' + DUE_SOON_DAYS + ' days.'
      + (next ? ' Next up: ' + next.name + ' on ' + dueDayLabel(next.date) + '.' : '');
    return;
  }

  quiet.style.display = 'none';
  var html = '';
  active.forEach(function (r) {
    html += '<div class="due-row due-' + r.status + '">'
         +    '<div class="due-row-main">'
         +      '<div class="due-row-name">' + escapeHtml(r.name) + '</div>'
         +      '<div class="due-row-sub">' + escapeHtml(dueRowLabel(r)) + '</div>'
         +    '</div>'
         +    '<div class="due-row-right">'
         +      '<div class="due-row-amt">' + fmt(r.amount) + '</div>'
         +      '<button type="button" class="due-row-log" onclick="logFromDue(' + r.id + ')">Log</button>'
         +    '</div>'
         +  '</div>';
  });
  body.innerHTML = html;
}

// Straight from "this is due" to "I paid it", with the debt already chosen.
// Without this the trip is Dashboard -> past four cards -> Payment Log.
function logFromDue(debtId) {
  openQuickLog();
  var sel = document.getElementById('qlog-debt-select');
  if (sel) sel.value = String(debtId);
  var d = (debts || []).find(function (x) { return x.id === debtId; });
  var amt = document.getElementById('qlog-amount');
  if (amt && d && !amt.value) {
    var floors = minPaymentFloors(d);
    amt.value = Math.round(Math.max(0, Math.min(d.balance, floors && floors.now ? floors.now : d.minPayment)));
  }
  trackShare('due_quick_log', { _category: 'engagement' });
}
'''

MARKUP = '''    <!-- v1.42.0 — what else is due, beside where the extra is going. Dashboard
         rather than Strategy because this is a daily action, not a planning
         tool (the same split v1.30.0 applied when the budget card moved). -->
    <div class="card" id="upcoming-card" style="display:none">
      <div class="card-title"><div class="dot"></div> Coming Up</div>
      <div id="upcoming-body"></div>
      <div id="upcoming-quiet" style="display:none;font-size:0.8rem;color:var(--text-muted);line-height:1.5;"></div>
    </div>
'''

CSS = '''
/* v1.42.0 — Coming Up rows. Deliberately calm: no red, no alarm colouring.
   A due date is information, not a telling-off, and the person reading it may
   already know they cannot pay it. */
.due-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border); }
.due-row:last-child { border-bottom:none; }
.due-row-main { flex:1; min-width:0; }
.due-row-name { font-size:0.88rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.due-row-sub { font-size:0.72rem; color:var(--text-muted); margin-top:2px; }
.due-row-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.due-row-amt { font-family:var(--font-mono); font-size:0.82rem; font-weight:600; }
.due-row-log { font-family:var(--font-mono); font-size:0.68rem; letter-spacing:0.05em;
  padding:5px 10px; border-radius:6px; border:1px solid var(--border);
  background:var(--card2); color:var(--text); cursor:pointer; }
.due-row-log:hover { border-color:var(--accent); color:var(--accent); }
.due-today .due-row-sub { color:var(--accent); }
.due-passed .due-row-sub { color:var(--accent4); }  /* amber, not red: this is
   the row that most needs noticing, but a person looking at it may already know
   they could not pay. Amber says "look here"; red says "you failed". */
'''

FIELD_ADD = '''        <div class="form-field">
          <label>Due Day <span class="field-optional">optional</span></label>
          <input type="text" inputmode="numeric" id="debt-due-day" placeholder="15" min="1" max="31"
            oninput="clearFieldError(this)" />
          <div class="field-hint">Day of the month it&rsquo;s due</div>
        </div>
'''

FIELD_EDIT = '''      <div class="form-field" style="grid-column:1/-1">
        <label>Due Day <span class="field-optional">optional</span></label>
        <input type="text" inputmode="numeric" id="edit-due-day" min="1" max="31" placeholder="15" />
      </div>
'''

def dash(s):
    # logic block, before renderNextDebt's definition
    s = sub(s, "function renderNextDebt() {", LOGIC + "\nfunction renderNextDebt() {", 'insert due-date logic')

    # markup: directly after the Next Target card closes, before drive-card
    s = sub(s, '    <div class="card drive-card loud" id="drive-card"',
            MARKUP + '    <div class="card drive-card loud" id="drive-card"',
            'insert Coming Up card below Next Target')

    # css
    s = sub(s, "  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert CSS')

    # form fields
    s = sub(s, '''        <div class="form-field">
          <label>Min Payment ($) <span class="field-optional">optional</span></label>''',
            FIELD_ADD + '''        <div class="form-field">
          <label>Min Payment ($) <span class="field-optional">optional</span></label>''',
            'add-form due day field')
    s = sub(s, '''      <div class="form-field" style="grid-column:1/-1">
        <label>Min Payment ($)</label>
        <input type="text" inputmode="decimal" id="edit-min" min="0" step="1" />
      </div>''',
            '''      <div class="form-field" style="grid-column:1/-1">
        <label>Min Payment ($)</label>
        <input type="text" inputmode="decimal" id="edit-min" min="0" step="1" />
      </div>
''' + FIELD_EDIT,
            'edit-form due day field')

    # persist: addDebt
    s = sub(s, "    termMonths: termMonths,\n    originationDate: originationDate\n  });",
            "    termMonths: termMonths,\n    originationDate: originationDate,\n"
            "    // v1.42.0 — stored unclamped; clamped per month at read time so a\n"
            "    // card due on the 31st keeps saying 31 rather than being rewritten to 28.\n"
            "    dueDay: sanitizeDueDay((document.getElementById('debt-due-day') || {}).value)\n  });",
            'addDebt persists dueDay')

    # persist: saveEditDebt
    s = sub(s, "  d.originationDate = (_eod && _eod.value) ? _eod.value : null;",
            "  d.originationDate = (_eod && _eod.value) ? _eod.value : null;\n"
            "  var _edd = document.getElementById('edit-due-day');\n"
            "  d.dueDay = _edd ? sanitizeDueDay(_edd.value) : (d.dueDay || null);",
            'saveEditDebt persists dueDay')

    # populate the edit modal
    s = sub(s, "  document.getElementById('edit-min').value     = d.minPayment;",
            "  document.getElementById('edit-min').value     = d.minPayment;\n"
            "  var _eddIn = document.getElementById('edit-due-day');\n"
            "  if (_eddIn) _eddIn.value = d.dueDay || '';",
            'openEditModal populates dueDay')

    # sanitize on restore. Object.assign carries unknown keys through, so this
    # only needs to normalise a bad value from a hand-edited backup file.
    s = sub(s, "      termMonths: termMonths,\n      originationDate: originationDate\n    });",
            "      termMonths: termMonths,\n      originationDate: originationDate,\n"
            "      dueDay: sanitizeDueDay(debt.dueDay)\n    });",
            'restore sanitizes dueDay')

    # render wiring
    s = sub(s, "  renderNextDebt();        // v1.13.0",
            "  renderNextDebt();        // v1.13.0\n  renderUpcoming();        // v1.42.0",
            'wire renderUpcoming into render()')
    return s

edit(sys.argv[1], dash)
