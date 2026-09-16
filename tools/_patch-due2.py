#!/usr/bin/env python3
"""
v1.42.0 part 2 — batch due-date setter + due dates wherever a debt is shown.

No due date is ever defaulted or inferred. A wrong due date is worse than none:
the card would state it with full confidence, and someone trusting it eats a
late fee and possibly a penalty APR — the exact harm this feature exists to
prevent. Inferring from the payment log is the same mistake in a data costume,
because the log records when a payment was LOGGED, not when it was due.

What existing users get instead is a default EXPERIENCE: a dismissible
invitation and a setter that does all their debts at once. Same shape as the
debtfree_badges_seeded / rolledMinimums migrations, except this one offers
rather than assumes.
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
// ── Batch setter ──────────────────────────────────────────────────────
// Adding due dates one debt at a time means opening the edit modal once per
// debt. Kevin's own file has 12 of them; almost nobody finishes that, so the
// feature would look broken rather than unused.

var DUE_PROMPT_KEY = 'debtfree_due_prompt_dismissed';

function debtsMissingDueDay() {
  return (debts || []).filter(function (d) {
    return d && d.balance > 0 && !sanitizeDueDay(d.dueDay);
  });
}

function dueInviteDismissed() {
  try { return localStorage.getItem(DUE_PROMPT_KEY) === '1'; } catch (e) { return false; }
}

function dismissDueInvite() {
  try { localStorage.setItem(DUE_PROMPT_KEY, '1'); } catch (e) {}
  trackShare('due_invite_dismissed', { _category: 'activation' });
  render();
}

function openDueSetter() {
  var modal = document.getElementById('duedates-modal');
  if (!modal) return;
  var list = document.getElementById('duedates-list');
  var active = (debts || []).filter(function (d) { return d.balance > 0; });
  if (!list) return;

  list.innerHTML = active.map(function (d) {
    return '<div class="dd-row">'
         +   '<label class="dd-name" for="dd-in-' + d.id + '">' + escapeHtml(d.name) + '</label>'
         +   '<input class="dd-input money-input" type="text" inputmode="numeric" '
         +     'id="dd-in-' + d.id + '" data-debt="' + d.id + '" maxlength="2" placeholder="--" '
         +     'value="' + (sanitizeDueDay(d.dueDay) || '') + '" />'
         + '</div>';
  }).join('');

  var err = document.getElementById('duedates-error');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  maskFinancialInputs(list);   // v1.41.2 — new fields must be masked too
  modal.classList.remove('hidden');
  trackShare('due_setter_open', { _category: 'activation', missing: debtsMissingDueDay().length });
}

function closeDueSetter(e) {
  var modal = document.getElementById('duedates-modal');
  if (!modal) return;
  if (e && e.target !== modal) return;
  modal.classList.add('hidden');
}

function saveDueSetter() {
  var inputs = document.querySelectorAll('#duedates-list .dd-input');
  var bad = [];
  var staged = [];

  // Validate everything BEFORE writing any of it, so a typo in the last row
  // cannot leave the first nine saved and the rest lost.
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var raw = (el.value || '').trim();
    el.classList.remove('field-invalid');
    if (raw === '') { staged.push({ id: parseInt(el.dataset.debt, 10), day: null }); continue; }
    var n = parseInt(raw, 10);
    if (isNaN(n) || n < 1 || n > 31) {
      bad.push(el);
      el.classList.add('field-invalid');
      continue;
    }
    staged.push({ id: parseInt(el.dataset.debt, 10), day: n });
  }

  var err = document.getElementById('duedates-error');
  if (bad.length) {
    if (err) {
      err.textContent = bad.length === 1
        ? 'One day is outside 1-31. Fix it or clear it to leave that debt blank.'
        : bad.length + ' days are outside 1-31. Fix them or clear them to leave those debts blank.';
      err.style.display = 'block';
    }
    bad[0].focus();
    return;
  }

  var set = 0;
  staged.forEach(function (row) {
    var d = (debts || []).find(function (x) { return x.id === row.id; });
    if (!d) return;
    d.dueDay = row.day;
    if (row.day) set++;
  });

  save();
  closeDueSetter();
  render();
  trackShare('due_setter_saved', { _category: 'activation', filled: set, total: staged.length });
}
'''

# renderUpcoming gains the invitation branch.
INVITE = r'''
  // Existing users arrive with no due days at all. Rather than hiding (which
  // reads as "this feature does nothing") or inventing dates (which is worse
  // than useless), offer the setter once. Dismissible, and it stops appearing
  // the moment every active debt has a day.
  var missing = debtsMissingDueDay();
  if (!rows.length) {
    if (missing.length && !dueInviteDismissed()) {
      card.style.display = '';
      quiet.style.display = 'none';
      body.innerHTML =
        '<div class="due-invite">'
      +   '<div class="due-invite-text">Add a due day to each account and this card will show '
      +     'what&rsquo;s coming up, so nothing catches you out.</div>'
      +   '<div class="due-invite-actions">'
      +     '<button type="button" class="btn btn-primary due-invite-go" onclick="openDueSetter()">Add due dates</button>'
      +     '<button type="button" class="btn btn-ghost" onclick="dismissDueInvite()">Not now</button>'
      +   '</div>'
      + '</div>';
      return;
    }
    card.style.display = 'none';
    return;
  }
'''

MODAL = r'''<div id="duedates-modal" class="modal-overlay hidden" onclick="closeDueSetter(event)">
  <div class="modal" style="max-width:440px;">
    <div class="modal-header">
      <div class="modal-title">Due Dates</div>
      <button class="modal-close" aria-label="Close" onclick="closeDueSetter()">&times;</button>
    </div>
    <p style="font-size:0.8rem;color:var(--text-muted);line-height:1.5;margin-bottom:14px;">
      The day of the month each account is due. Leave any blank if you&rsquo;d rather not track it.
    </p>
    <div id="duedates-list"></div>
    <div class="form-error" id="duedates-error" style="display:none;"></div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveDueSetter()">Save</button>
      <button class="btn btn-ghost" onclick="closeDueSetter()">Cancel</button>
    </div>
  </div>
</div>
'''

CSS = r'''
/* v1.42.0 — batch due-date setter */
.dd-row { display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border); }
.dd-row:last-child { border-bottom:none; }
.dd-name { flex:1; min-width:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dd-input { width:58px; flex-shrink:0; text-align:center; }
#duedates-list { max-height:46vh; overflow-y:auto; -webkit-overflow-scrolling:touch; }
.due-invite-text { font-size:0.82rem; color:var(--text-muted); line-height:1.5; margin-bottom:12px; }
.due-invite-actions { display:flex; gap:8px; flex-wrap:wrap; }
.due-invite-go { flex:1; min-width:140px; }
/* the due-day tag used in the debt list and portfolio table */
.due-tag { font-family:var(--font-mono); font-size:0.6rem; letter-spacing:0.04em;
  color:var(--text-muted); border:1px solid var(--border); border-radius:4px;
  padding:1px 5px; margin-left:6px; white-space:nowrap; }
.due-tag.due-tag-soon { color:var(--accent); border-color:var(--accent); }
.due-tag.due-tag-passed { color:var(--accent4); border-color:var(--accent4); }
'''

# One helper renders the tag for every listing site, so they cannot drift apart.
TAG_FN = r'''
// One tag renderer for every place a debt is listed, so the debt list, the
// portfolio table and Next Target can never disagree about a due date.
function dueTagFor(d) {
  var day = sanitizeDueDay(d && d.dueDay);
  if (!day || !d || d.balance <= 0) return '';
  var rows = upcomingDues();
  var r = null;
  for (var i = 0; i < rows.length; i++) { if (rows[i].id === d.id) { r = rows[i]; break; } }
  var cls = 'due-tag';
  if (r && (r.status === 'today' || r.status === 'soon')) cls += ' due-tag-soon';
  else if (r && r.status === 'passed') cls += ' due-tag-passed';
  var ord = day + (day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd'
            : day % 10 === 3 && day !== 13 ? 'rd' : 'th');
  return '<span class="' + cls + '">due ' + ord + '</span>';
}
'''

def dash(s):
    s = sub(s, "// ── Batch setter PLACEHOLDER", "", 'noop') if False else s

    s = sub(s, "function renderUpcoming() {", LOGIC + TAG_FN + "\nfunction renderUpcoming() {",
            'insert batch setter + tag helper')

    # invitation branch replaces the plain hide
    s = sub(s, """  // No due days set anywhere -> the feature is not in use; show nothing at all
  // rather than an empty card asking to be filled in.
  if (!rows.length) { card.style.display = 'none'; return; }
  card.style.display = '';""",
            INVITE + "  card.style.display = '';", 'invitation branch')

    # modal markup, beside the quick-log modal
    s = sub(s, '<div id="quicklog-modal" class="modal-overlay hidden"',
            MODAL + '<div id="quicklog-modal" class="modal-overlay hidden"', 'insert setter modal')

    s = sub(s, "  .roadmap-step { position:relative;", CSS + "  .roadmap-step { position:relative;", 'insert CSS')

    # ── display site 1: free-tier debt cards (Dashboard) ──
    s = sub(s, """        <div class="debt-stat">
          <span class="debt-stat-label">Min Pmt</span>
          <span class="debt-stat-val">${fmt(d.minPayment)}</span>
        </div>""",
            """        <div class="debt-stat">
          <span class="debt-stat-label">Min Pmt</span>
          <span class="debt-stat-val">${fmt(d.minPayment)}</span>
        </div>
        ${sanitizeDueDay(d.dueDay) ? `<div class="debt-stat">
          <span class="debt-stat-label">Due</span>
          <span class="debt-stat-val">${dueTagFor(d)}</span>
        </div>` : ''}""",
            'debt cards show due date')

    # ── display site 2: premium portfolio table (Strategy) ──
    # Appended to the name cell rather than added as a ninth column: the table
    # already carries eight and a new column is unreadable at 320px.
    s = sub(s,
            "      '<td class=\"pf-td pf-name\"><span style=\"font-weight:600;\">' + escapeHtml(d.name) + '</span>' + exclTag + promoTag + tcTag + progTag + '</td>' +",
            "      '<td class=\"pf-td pf-name\"><span style=\"font-weight:600;\">' + escapeHtml(d.name) + '</span>' + dueTagFor(d) + exclTag + promoTag + tcTag + progTag + '</td>' +",
            'portfolio table shows due date')
    return s

edit(sys.argv[1], dash)
