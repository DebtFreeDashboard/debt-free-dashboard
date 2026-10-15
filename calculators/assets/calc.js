/* DebtFree Dashboard — calculator pages
 * All payoff math comes from engine.js, which is generated from the dashboard
 * itself (tools/make-calc-engine.js), so a calculator and the app always give
 * the same answer for the same numbers. The only math written here is for
 * questions the app does not model: a shrinking card minimum, deferred
 * interest charged back at a deadline, and debt-to-income.
 */
(function () {
  'use strict';
  var E = window.DFEngine;
  var CFG = JSON.parse(document.getElementById('calc-config').textContent);
  var root = document.getElementById('calc');
  var out = document.getElementById('calc-results');
  if (!E || !root || !out) return;

  // ── formatting ───────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function money2(n) { return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function parseAmt(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : NaN; }
  function monthShort(m) { return E.planMonthDate(m).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
  function monthLong(m) { return E.planMonthDate(m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function duration(m) {
    var y = Math.floor(m / 12), r = m % 12;
    if (!y) return plural(r, 'month');
    return plural(y, 'year') + (r ? ', ' + plural(r, 'month') : '');
  }
  function track(name, params) {
    try { if (typeof gtag === 'function') gtag('event', name, Object.assign({ calc_page: CFG.slug }, params || {})); } catch (e) {}
  }
  var _used = false;
  function markUsed() { if (!_used) { _used = true; track('calc_used', {}); } }

  // ── small building blocks ────────────────────────────────────
  function stat(label, value, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div>' + (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
  }
  function note(html, cls) { return '<p class="calc-note ' + (cls || '') + '">' + html + '</p>'; }

  // Balance-over-time chart, inline SVG. series: [{name, cls, data:[remaining after month 1..n]}]
  function chart(series, startBalance) {
    var maxM = 0, maxV = startBalance || 0;
    series.forEach(function (s) { maxM = Math.max(maxM, s.data.length); s.data.forEach(function (v) { if (v > maxV) maxV = v; }); });
    if (!maxM || !maxV) return '';
    var W = 640, H = 220, L = 54, R = 12, T = 12, B = 28;
    var x = function (m) { return L + (W - L - R) * (m / maxM); };
    var y = function (v) { return T + (H - T - B) * (1 - v / maxV); };
    var grid = '', i;
    for (i = 0; i <= 4; i++) {
      var v = maxV * i / 4, yy = y(v);
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (yy + 4) + '" class="axis" text-anchor="end">' + (v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)) + '</text>';
    }
    var step = maxM <= 24 ? 6 : maxM <= 60 ? 12 : maxM <= 180 ? 24 : 60;
    for (i = 0; i <= maxM; i += step) {
      grid += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="axis" text-anchor="middle">' + (i === 0 ? 'Now' : E.planMonthDate(i + 1).getFullYear()) + '</text>';
    }
    var paths = series.map(function (s) {
      var d = 'M' + x(0) + ' ' + y(startBalance);
      s.data.forEach(function (v, k) { d += ' L' + x(k + 1).toFixed(1) + ' ' + y(v).toFixed(1); });
      return '<path d="' + d + '" class="line ' + (s.cls || '') + '"/>';
    }).join('');
    var legend = series.length > 1 ? '<div class="legend">' + series.map(function (s) { return '<span class="lg ' + (s.cls || '') + '">' + esc(s.name) + '</span>'; }).join('') + '</div>' : '';
    return '<figure class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Balance over time">' + grid + paths + '</svg>' + legend + '<figcaption>Total balance remaining, month by month</figcaption></figure>';
  }
  function remainingSeries(r) { return r.monthlyData.map(function (m) { return m.remaining; }); }

  // ── debt list input (multi-debt pages) ───────────────────────
  var TYPES = { cc: 'Credit card', student: 'Student loan', auto: 'Auto loan', personal: 'Personal loan', mortgage: 'Mortgage', other: 'Other' };
  var debtRows = [];
  var rowSeq = 0;

  function rowHTML(r) {
    var promo = CFG.allowPromo;
    return '<div class="debt-row" data-row="' + r.key + '">' +
      '<div class="f f-name"><label for="n' + r.key + '">Name</label><input id="n' + r.key + '" data-k="name" type="text" maxlength="40" value="' + esc(r.name) + '" placeholder="e.g. Visa"></div>' +
      '<div class="f"><label for="b' + r.key + '">Balance</label><div class="affix">$<input id="b' + r.key + '" data-k="balance" type="text" inputmode="decimal" value="' + esc(r.balance) + '"></div></div>' +
      '<div class="f"><label for="a' + r.key + '">APR</label><div class="affix suffix"><input id="a' + r.key + '" data-k="apr" type="text" inputmode="decimal" value="' + esc(r.apr) + '">%</div></div>' +
      '<div class="f"><label for="m' + r.key + '">Minimum</label><div class="affix">$<input id="m' + r.key + '" data-k="min" type="text" inputmode="decimal" value="' + esc(r.min) + '" placeholder="auto"></div></div>' +
      '<button type="button" class="row-x" data-act="remove" aria-label="Remove ' + esc(r.name || 'this debt') + '">&times;</button>' +
      (promo ? '<div class="promo-line">' +
        '<label class="chk"><input type="checkbox" data-k="hasPromo"' + (r.hasPromo ? ' checked' : '') + '> 0% / promo rate</label>' +
        '<span class="promo-fields"' + (r.hasPromo ? '' : ' hidden') + '>' +
        '<label>Promo APR <span class="affix suffix sm"><input data-k="promoApr" type="text" inputmode="decimal" value="' + esc(r.promoApr == null ? 0 : r.promoApr) + '">%</span></label>' +
        '<label>for <input data-k="promoMonths" class="sm" type="text" inputmode="numeric" value="' + esc(r.promoMonths || 12) + '"> more months, then</label>' +
        '<label><span class="affix suffix sm"><input data-k="postApr" type="text" inputmode="decimal" value="' + esc(r.postApr || '') + '">%</span></label>' +
        '</span></div>' : '') +
      '</div>';
  }
  function renderRows() {
    var box = document.getElementById('debt-rows');
    box.innerHTML = debtRows.map(rowHTML).join('');
    var add = document.getElementById('add-debt');
    if (add) add.hidden = debtRows.length >= 12;
  }
  function addRow(d) {
    debtRows.push({
      key: ++rowSeq, name: d.name || '', type: d.type || CFG.defaultType || 'cc',
      balance: d.balance != null ? String(d.balance) : '', apr: d.apr != null ? String(d.apr) : '', min: d.min != null ? String(d.min) : '',
      hasPromo: !!d.hasPromo, promoApr: d.promoApr != null ? d.promoApr : 0, promoMonths: d.promoMonths || 12, postApr: d.postApr || ''
    });
  }
  function bindRows() {
    var box = document.getElementById('debt-rows');
    box.addEventListener('input', function (e) {
      var rowEl = e.target.closest('.debt-row'); if (!rowEl) return;
      var r = debtRows.find(function (x) { return String(x.key) === rowEl.dataset.row; }); if (!r) return;
      var k = e.target.dataset.k; if (!k) return;
      r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'hasPromo') { var pf = rowEl.querySelector('.promo-fields'); if (pf) pf.hidden = !e.target.checked; }
      schedule();
    });
    box.addEventListener('change', function (e) { if (e.target.type === 'checkbox') box.dispatchEvent(new Event('input')); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="remove"]'); if (!b) return;
      var rowEl = b.closest('.debt-row');
      debtRows = debtRows.filter(function (x) { return String(x.key) !== rowEl.dataset.row; });
      renderRows(); schedule();
    });
    var add = document.getElementById('add-debt');
    if (add) add.addEventListener('click', function () {
      addRow({ name: '', type: CFG.defaultType || 'cc' }); renderRows(); schedule();
      var last = box.querySelector('.debt-row:last-child input[data-k="name"]'); if (last) last.focus();
    });
  }
  // Read rows into engine debts. Invalid rows are flagged, not silently dropped.
  function readDebts() {
    var list = [], problems = [];
    debtRows.forEach(function (r, i) {
      var bal = parseAmt(r.balance), apr = parseAmt(r.apr), min = parseAmt(r.min);
      var label = r.name || ('Debt ' + (i + 1));
      var rowEl = document.querySelector('[data-row="' + r.key + '"]');
      var flag = function (k, bad) { var el = rowEl && rowEl.querySelector('[data-k="' + k + '"]'); if (el) el.classList.toggle('bad', !!bad); };
      var empty = String(r.balance).trim() === '' && String(r.apr).trim() === '';
      flag('balance', !empty && !(bal > 0)); flag('apr', !empty && !(apr >= 0 && apr <= 100));
      if (empty) return;
      if (!(bal > 0) || !(apr >= 0 && apr <= 100)) { problems.push(label); return; }
      var estimated = !(min >= 0) || String(r.min).trim() === '';
      if (estimated) min = E.estimateMinPayment(bal, apr, r.type);
      var d = { id: i + 1, name: label, type: r.type, balance: bal, apr: apr, realApr: apr, minPayment: min, _estimated: estimated };
      if (CFG.allowPromo && r.hasPromo) {
        var pApr = parseAmt(r.promoApr), pm = Math.round(parseAmt(r.promoMonths)), post = parseAmt(r.postApr);
        if (pm > 0 && post >= 0 && post <= 100) {
          d.hasPromo = true; d.promoApr = pApr >= 0 ? pApr : 0; d.apr = d.promoApr; d.postPromoApr = post; d.realApr = post;
          d.promoEnd = isoDate(E.planMonthDate(pm)); d._promoMonths = pm;
        }
      }
      list.push(d);
    });
    return { debts: list, problems: problems };
  }
  function isoDate(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }

  // ── field helpers for single-value pages ─────────────────────
  function val(id) { var el = document.getElementById(id); return el ? parseAmt(el.value) : NaN; }
  function bad(id, isBad) { var el = document.getElementById(id); if (el) el.classList.toggle('bad', !!isBad); return !!isBad; }

  // ── strategy helpers ─────────────────────────────────────────
  var STRAT_NAME = { snowball: 'Snowball', avalanche: 'Avalanche', hybrid: 'Your order (as listed)' };
  function runStrat(debts, extra, s) { return E.run(debts, extra, s, { trace: true }); }
  function orderList(r, debts) {
    var by = {}; debts.forEach(function (d) { by[d.id] = d; });
    var rows = r.perDebt.slice().sort(function (a, b) { return (a.paidOffMonth || 9999) - (b.paidOffMonth || 9999); });
    return '<ol class="payoff-order">' + rows.map(function (p) {
      var d = by[p.id];
      return '<li><span class="po-name">' + esc(d.name) + '</span><span class="po-when">' + (p.paidOffMonth ? monthShort(p.paidOffMonth) : 'not paid off') + '</span><span class="po-int">' + money(p.interestPaid) + ' interest</span></li>';
    }).join('') + '</ol>';
  }
  function rolloverNotes(r, debts) {
    var by = {}; debts.forEach(function (d) { by[d.id] = d; });
    var rows = r.perDebt.filter(function (p) { return p.paidOffMonth; }).sort(function (a, b) { return a.paidOffMonth - b.paidOffMonth; });
    var acc = 0, items = [];
    rows.slice(0, -1).forEach(function (p) {
      var d = by[p.id]; acc += d.minPayment;
      items.push('<li><strong>' + monthShort(p.paidOffMonth) + ':</strong> ' + esc(d.name) + ' is paid off. Its ' + money(d.minPayment) + ' minimum joins the payment on the next debt in line, so ' + money(acc) + ' a month of freed-up minimums is now rolling forward.</li>');
    });
    return items.length ? '<ul class="rollover">' + items.join('') + '</ul>' : '';
  }
  function minFloorNotice(debts) {
    var low = debts.filter(function (d) { return E.minPaymentFloors(d).now > d.minPayment + 0.005; });
    var lowPost = debts.filter(function (d) { var f = E.minPaymentFloors(d); return f.now <= d.minPayment + 0.005 && f.post > d.minPayment + 0.005; });
    var est = debts.filter(function (d) { return d._estimated; });
    var s = '';
    if (low.length) s += note('The minimum on ' + low.map(function (d) { return esc(d.name); }).join(', ') + ' is less than a month of interest, so the balance would grow forever. The calculation raises it to one month of interest plus $1.', 'warn');
    if (lowPost.length) s += note('Once its promo ends, the minimum on ' + lowPost.map(function (d) { return esc(d.name); }).join(', ') + ' would be less than a month of interest. From then on the calculation raises it to one month of interest plus $1.', 'warn');
    if (est.length) s += note('Minimum estimated for ' + est.map(function (d) { return esc(d.name); }).join(', ') + ' (left blank). Enter the real minimum from your statement for an exact match.');
    return s;
  }
  function totalMins(debts) { return debts.reduce(function (a, d) { return a + Math.max(d.minPayment, E.minPaymentFloors(d).now); }, 0); }
  function totalBal(debts) { return debts.reduce(function (a, d) { return a + d.balance; }, 0); }
  function diverged(r) { return r.diverged ? note('This plan does not reach zero within 50 years at these payments.', 'warn') : ''; }

  function optimizedTeaser(debts, extra, baseline) {
    if (debts.length < 2) return '';
    var o = E.optimizedOrder(debts, extra);
    if (!o) return '';
    var save = baseline.totalInterest - o.interest;
    if (save >= 1) {
      return '<div class="teaser"><strong>' + money(save) + ' less interest</strong> is possible with these exact numbers. The dashboard&rsquo;s <em>Optimized</em> strategy tests every payoff order' + (o.exhaustive ? '' : ' it can') + ' and finds the cheapest one &mdash; free, in the app below.</div>';
    }
    return '<div class="teaser">The dashboard&rsquo;s <em>Optimized</em> strategy checked every payoff order for these debts: none costs less than this one.</div>';
  }

  // ── handoff into the dashboard ───────────────────────────────
  var handoff = { debts: [], extra: 0, strategy: 'avalanche' };
  function setHandoff(debts, extra, strategy) {
    handoff = { debts: debts || [], extra: extra || 0, strategy: strategy || 'avalanche' };
    document.querySelectorAll('[data-handoff]').forEach(function (b) {
      var n = handoff.debts.length;
      b.textContent = n ? 'Open ' + (n === 1 ? 'this debt' : 'these ' + n + ' debts') + ' in the free dashboard →' : 'Open the free dashboard →';
    });
  }
  function goHandoff(e) {
    e.preventDefault();
    var n = handoff.debts.length;
    if (n) {
      try {
        localStorage.setItem('debtfree_calc_import', JSON.stringify({
          v: 1, ts: Date.now(), page: CFG.slug, extra: handoff.extra, strategy: handoff.strategy,
          debts: handoff.debts.map(function (d) {
            return { name: d.name, type: d.type || 'cc', balance: Math.round(d.balance * 100) / 100, apr: d.hasPromo ? d.postPromoApr : (d.realApr != null ? d.realApr : d.apr),
              minPayment: Math.round(d.minPayment * 100) / 100, hasPromo: !!d.hasPromo, promoApr: d.hasPromo ? d.promoApr : null,
              promoEnd: d.hasPromo ? d.promoEnd : null, postPromoApr: d.hasPromo ? d.postPromoApr : null };
          })
        }));
      } catch (err) { /* storage blocked: the app still opens, just empty */ }
    }
    track('calc_handoff', { debt_count: n });
    location.href = '/app/dashboard.html?from=calculator&page=' + encodeURIComponent(CFG.slug);
  }

  // ── recompute scheduling ─────────────────────────────────────
  var timer = null, firstRun = true;
  function schedule() { clearTimeout(timer); timer = setTimeout(compute, 220); }
  function compute() {
    var html;
    try { html = MODES[CFG.widget](); } catch (err) { html = note('Something went wrong with these numbers. Please check the inputs.', 'warn'); if (window.console) console.error(err); }
    out.innerHTML = html;
    if (!firstRun) markUsed();
    firstRun = false;
  }

  // ════════════════════════════════════════════════════════════
  //  WIDGETS
  // ════════════════════════════════════════════════════════════
  var MODES = {};

  // Multi-debt planner — modes: compare, snowball, avalanche, versus, order, date, target, extra, lump
  MODES.multi = function () {
    var rd = readDebts(), debts = rd.debts;
    var extra = Math.max(0, val('extra') || 0);
    bad('extra', !(val('extra') >= 0) && String(document.getElementById('extra').value).trim() !== '');
    var problems = rd.problems.length ? note('Check the balance and APR for: ' + rd.problems.map(esc).join(', ') + '.', 'warn') : '';
    if (!debts.length) { setHandoff([], 0); return problems + note('Add at least one debt with a balance and an APR to see results.'); }
    var mode = CFG.mode, chosen = CFG.strategy || 'avalanche';
    var stratSel = document.getElementById('strategy');
    if (stratSel) chosen = stratSel.value;
    var start = totalBal(debts), mins = totalMins(debts);
    var s = problems + minFloorNotice(debts);

    if (mode === 'target') return s + targetMode(debts, extra, chosen, start, mins);
    if (mode === 'lump') return s + lumpMode(debts, extra, chosen, start);

    var res = {
      snowball: runStrat(debts, extra, 'snowball'),
      avalanche: runStrat(debts, extra, 'avalanche'),
      hybrid: runStrat(debts, extra, 'hybrid')
    };
    var main = res[chosen];
    setHandoff(debts, extra, chosen);
    var hdr = '<div class="stats">' +
      stat('Debt-free', monthLong(main.months), plural(main.months, 'monthly payment'), 'big') +
      stat('Total interest', money(main.totalInterest), STRAT_NAME[chosen]) +
      stat('Monthly payment', money(mins + extra), money(mins) + ' minimums + ' + money(extra) + ' extra') +
      '</div>';

    if (mode === 'snowball' || mode === 'avalanche') {
      var other = mode === 'snowball' ? 'avalanche' : 'snowball', r = res[mode], o = res[other];
      var diff = o.totalInterest - r.totalInterest, md = o.months - r.months;
      var cmp = Math.abs(diff) < 1 && md === 0
        ? 'With these debts, ' + STRAT_NAME[other] + ' gives the same result.'
        : STRAT_NAME[other] + ' with the same numbers: ' + money(o.totalInterest) + ' interest, debt-free ' + monthShort(o.months) + ' &mdash; ' +
          (diff > 0 ? money(diff) + ' more interest' : money(-diff) + ' less interest') + (md ? ', ' + plural(Math.abs(md), 'month') + (md > 0 ? ' later' : ' sooner') : ', same month') + '.';
      return s + hdr + '<h3 class="rh">' + STRAT_NAME[mode] + ' payoff order</h3>' + orderList(r, debts) + rolloverNotes(r, debts) +
        note(cmp) + chart([{ name: STRAT_NAME[mode], data: remainingSeries(r) }], start) + diverged(r) + optimizedTeaser(debts, extra, r);
    }
    if (mode === 'versus') {
      var sn = res.snowball, av = res.avalanche;
      var dI = sn.totalInterest - av.totalInterest, dM = sn.months - av.months;
      var verdict = Math.abs(dI) < 1 && dM === 0 ? 'For these debts the two methods land on the same month and the same interest.'
        : 'For these debts, Avalanche costs ' + (dI >= 0 ? money(dI) + ' less' : money(-dI) + ' more') + ' in interest than Snowball' +
          (dM ? ' and finishes ' + plural(Math.abs(dM), 'month') + (dM > 0 ? ' sooner' : ' later') : ' and finishes in the same month') + '.';
      return s + '<div class="versus">' + vsCard('Snowball', 'Smallest balance first', sn, debts, 'snowball') + vsCard('Avalanche', 'Highest rate first', av, debts, 'avalanche') + '</div>' +
        '<p class="verdict">' + verdict + '</p>' + chart([{ name: 'Snowball', cls: 's1', data: remainingSeries(sn) }, { name: 'Avalanche', cls: 's2', data: remainingSeries(av) }], start) +
        optimizedTeaser(debts, extra, sn.totalInterest < av.totalInterest ? sn : av);
    }
    if (mode === 'order') {
      var rows = ['avalanche', 'snowball', 'hybrid'].map(function (k) { return { k: k, r: res[k] }; })
        .sort(function (a, b) { return a.r.totalInterest - b.r.totalInterest || a.r.months - b.r.months; });
      var best = rows[0].r;
      var first = E.firstTarget(debts, rows[0].k);
      return s + '<table class="rank"><thead><tr><th>Approach</th><th>Pays first</th><th>Debt-free</th><th>Interest</th></tr></thead><tbody>' +
        rows.map(function (x, i) {
          var f = E.firstTarget(debts, x.k);
          return '<tr' + (i === 0 ? ' class="win"' : '') + '><td>' + STRAT_NAME[x.k] + '</td><td>' + esc(f ? f.name : '') + '</td><td>' + monthShort(x.r.months) + '</td><td>' + money(x.r.totalInterest) + (i ? ' <span class="muted">(+' + money(x.r.totalInterest - best.totalInterest) + ')</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        note('Lowest interest of these three: <strong>' + STRAT_NAME[rows[0].k] + '</strong>, which starts with ' + esc(first ? first.name : '') + '. "Your order" pays debts from the top of your list down, so you can test any order by listing debts the way you would tackle them.') +
        optimizedTeaser(debts, extra, best);
    }
    if (mode === 'date') {
      var r2 = main;
      var none = runStrat(debts, 0, chosen);
      return s + '<div class="date-hero"><div class="dh-label">Your estimated debt-free month</div><div class="dh-date">' + monthLong(r2.months) + '</div><div class="dh-sub">' + plural(r2.months, 'monthly payment') + ' from now &middot; ' + duration(r2.months) + '</div></div>' +
        '<div class="stats">' + stat('Total interest', money(r2.totalInterest)) + stat('Total paid', money(start + r2.totalInterest)) +
        (extra > 0 ? stat('Without the extra', monthShort(none.months), plural(none.months - r2.months, 'month') + ' later') : stat('Monthly payment', money(mins))) + '</div>' +
        '<h3 class="rh">When each debt is paid off (' + STRAT_NAME[chosen] + ')</h3>' + orderList(r2, debts) + chart([{ name: STRAT_NAME[chosen], data: remainingSeries(r2) }], start) + diverged(r2) + optimizedTeaser(debts, extra, r2);
    }
    if (mode === 'extra') {
      var base = runStrat(debts, 0, chosen), withX = main;
      var ladder = [50, 100, 250, 500, 1000].map(function (x) { var r = runStrat(debts, x, chosen); return { x: x, r: r }; });
      return s + '<div class="stats">' +
        stat('Minimums only', monthShort(base.months), money(base.totalInterest) + ' interest') +
        stat('With ' + money(extra) + ' extra', monthShort(withX.months), money(withX.totalInterest) + ' interest', 'big') +
        stat('Difference', extra > 0 ? plural(base.months - withX.months, 'month') + ' sooner' : '&mdash;', extra > 0 ? money(base.totalInterest - withX.totalInterest) + ' less interest' : 'enter an extra amount') + '</div>' +
        '<h3 class="rh">What different extra amounts do (' + STRAT_NAME[chosen] + ')</h3><table class="rank"><thead><tr><th>Extra / month</th><th>Debt-free</th><th>Months saved</th><th>Interest saved</th></tr></thead><tbody>' +
        ladder.map(function (l) { return '<tr><td>+' + money(l.x) + '</td><td>' + monthShort(l.r.months) + '</td><td>' + (base.months - l.r.months) + '</td><td>' + money(base.totalInterest - l.r.totalInterest) + '</td></tr>'; }).join('') +
        '</tbody></table>' + note('"Minimums only" still rolls each paid-off minimum into the next debt; the extra comes on top.') +
        chart([{ name: 'Minimums only', cls: 's1', data: remainingSeries(base) }, { name: 'With ' + money(extra) + ' extra', cls: 's2', data: remainingSeries(withX) }], start);
    }
    // compare (default)
    var keys = ['snowball', 'avalanche', 'hybrid'];
    var bestK = keys.slice().sort(function (a, b) { return res[a].totalInterest - res[b].totalInterest; })[0];
    return s + hdr + '<table class="rank"><thead><tr><th>Strategy</th><th>Debt-free</th><th>Payments</th><th>Interest</th></tr></thead><tbody>' +
      keys.map(function (k) { var r = res[k]; return '<tr' + (k === bestK ? ' class="win"' : '') + '><td>' + STRAT_NAME[k] + '</td><td>' + monthShort(r.months) + '</td><td>' + r.months + '</td><td>' + money(r.totalInterest) + '</td></tr>'; }).join('') +
      '</tbody></table><h3 class="rh">Payoff order &middot; ' + STRAT_NAME[chosen] + '</h3>' + orderList(main, debts) +
      chart([{ name: STRAT_NAME[chosen], data: remainingSeries(main) }], start) + diverged(main) + optimizedTeaser(debts, extra, res[bestK]);
  };
  function vsCard(title, sub, r, debts, strat) {
    var first = E.firstTarget(debts, strat);
    return '<div class="vs-card"><div class="vs-title">' + title + '</div><div class="vs-sub">' + sub + '</div>' +
      '<div class="vs-num">' + monthShort(r.months) + '</div><div class="vs-line">' + money(r.totalInterest) + ' interest</div>' +
      '<div class="vs-line muted">Starts with ' + esc(first ? first.name : '') + '</div>' + orderList(r, debts) + '</div>';
  }

  // Solve the extra needed to finish by a target month (monotonic in extra).
  function targetMode(debts, extra, chosen, start, mins) {
    var tm = Math.round(val('target-months'));
    if (bad('target-months', !(tm >= 1 && tm <= 600))) return note('Enter how many months from now you want to be debt-free (1 to 600).');
    var base = runStrat(debts, 0, chosen);
    setHandoff(debts, 0, chosen);
    var goal = monthLong(tm);
    if (base.months <= tm && !base.diverged) {
      setHandoff(debts, 0, chosen);
      return '<div class="date-hero"><div class="dh-label">Extra needed to be debt-free by ' + goal + '</div><div class="dh-date">$0</div><div class="dh-sub">Minimums alone (with rollover) finish in ' + monthLong(base.months) + '.</div></div>' + orderList(base, debts);
    }
    var lo = 0, hi = Math.max(100, start), r;
    for (var k = 0; k < 40 && runStrat(debts, hi, chosen).months > tm; k++) hi *= 2;
    for (k = 0; k < 40; k++) { var mid = (lo + hi) / 2; r = runStrat(debts, mid, chosen); if (r.months <= tm && !r.diverged) hi = mid; else lo = mid; }
    var need = Math.ceil(hi);
    r = runStrat(debts, need, chosen);
    setHandoff(debts, need, chosen);
    return '<div class="date-hero"><div class="dh-label">Extra needed each month to be debt-free by ' + goal + '</div><div class="dh-date">' + money(need) + '</div><div class="dh-sub">' + money(mins + need) + ' a month in total (' + money(mins) + ' minimums + ' + money(need) + ' extra)</div></div>' +
      '<div class="stats">' + stat('Debt-free', monthShort(r.months)) + stat('Total interest', money(r.totalInterest), 'vs ' + money(base.totalInterest) + ' on minimums') + stat('Minimums only', monthShort(base.months), plural(base.months - r.months, 'month') + ' later') + '</div>' +
      '<h3 class="rh">Payoff order &middot; ' + STRAT_NAME[chosen] + '</h3>' + orderList(r, debts) + chart([{ name: 'Minimums only', cls: 's1', data: remainingSeries(base) }, { name: 'Target plan', cls: 's2', data: remainingSeries(r) }], start);
  }

  // Test a one-time payment against each debt; rank by interest saved.
  function lumpMode(debts, extra, chosen, start) {
    var lump = val('lump');
    if (bad('lump', !(lump > 0))) { setHandoff(debts, extra, chosen); return note('Enter the one-time amount (a tax refund, bonus or any windfall).'); }
    var base = runStrat(debts, extra, chosen);
    setHandoff(debts, extra, chosen);
    var applyTo = function (targetId) {
      var left = lump, list = debts.map(function (d) { return Object.assign({}, d); });
      var order = targetId ? list.filter(function (d) { return d.id === targetId; }).concat(list.filter(function (d) { return d.id !== targetId; }))
        : base.order.map(function (o) { return list.find(function (d) { return d.id === o.id; }); });
      order.forEach(function (d) { var p = Math.min(d.balance, left); d.balance -= p; left -= p; });
      var alive = list.filter(function (d) { return d.balance > 0.005; });
      // Keep the plan's ordering for what remains.
      var r = alive.length ? runStrat(alive, extra + list.filter(function (d) { return d.balance <= 0.005; }).reduce(function (a, d) { return a + d.minPayment; }, 0), chosen) : { months: 0, totalInterest: 0, monthlyData: [] };
      return { r: r, left: left };
    };
    var opts = debts.map(function (d) { var x = applyTo(d.id); return { label: d.name, sub: d.apr + '% APR, ' + money(d.balance), r: x.r, left: x.left }; });
    opts.push(Object.assign({ label: 'Follow the plan order', sub: STRAT_NAME[chosen] + ' focus debt first' }, (function () { var x = applyTo(null); return { r: x.r, left: x.left }; })()));
    opts.forEach(function (o) { o.saved = base.totalInterest - o.r.totalInterest; o.ms = base.months - o.r.months; });
    opts.sort(function (a, b) { return b.saved - a.saved || b.ms - a.ms; });
    var top = opts[0];
    return '<div class="stats">' + stat('Without the lump sum', monthShort(base.months), money(base.totalInterest) + ' interest') +
      stat('Most interest saved', money(top.saved), esc(top.label), 'big') + stat('Debt-free', top.r.months ? monthShort(top.r.months) : 'right away', plural(Math.max(0, top.ms), 'month') + ' sooner') + '</div>' +
      '<h3 class="rh">Where ' + money(lump) + ' saves the most</h3><table class="rank"><thead><tr><th>Put it toward</th><th>Interest saved</th><th>Months sooner</th></tr></thead><tbody>' +
      opts.map(function (o, i) { return '<tr' + (i === 0 ? ' class="win"' : '') + '><td>' + esc(o.label) + '<div class="muted sm">' + o.sub + '</div></td><td>' + money(o.saved) + '</td><td>' + Math.max(0, o.ms) + '</td></tr>'; }).join('') +
      '</tbody></table>' + note('Each row applies the whole amount today. If it is more than that debt owes, the rest goes to the next debt in the plan. The freed minimum of any debt it clears rolls forward.') +
      (top.left > 0.5 ? note(money(top.left) + ' is left over after every debt is cleared.') : '');
  }

  // Single installment loan or card — modes: cc, holiday, loan
  MODES.single = function () {
    var bal = val('balance'), apr = val('apr');
    var e1 = bad('balance', !(bal > 0)), e2 = bad('apr', !(apr >= 0 && apr <= 100));
    if (e1 || e2) { setHandoff([], 0); return note('Enter a balance and an APR to see results.'); }
    var r = apr / 100 / 12;
    var byMonths = CFG.solveFor === 'months' || (document.getElementById('solve-months') && document.getElementById('solve-months').checked);
    var pay, months;
    if (byMonths) {
      months = Math.round(val('months'));
      if (bad('months', !(months >= 1 && months <= 600))) return note('Enter a number of months between 1 and 600.');
      pay = r > 0 ? bal * r / (1 - Math.pow(1 + r, -months)) : bal / months;
      pay = Math.ceil(pay * 100) / 100;
    } else {
      pay = val('payment');
      if (bad('payment', !(pay > 0))) return note('Enter your monthly payment.');
    }
    var extra = Math.max(0, val('extra') || 0), lump = Math.max(0, val('lump') || 0);
    var type = CFG.defaultType || 'cc';
    var debt = { id: 1, name: CFG.debtName || 'Debt', type: type, balance: bal, apr: apr, realApr: apr, minPayment: pay };
    var monthInt = bal * r;
    if (pay <= monthInt + 0.004) {
      setHandoff([debt], 0, 'avalanche');
      return '<div class="date-hero warnbox"><div class="dh-label">At ' + money2(pay) + ' a month</div><div class="dh-date">Never</div><div class="dh-sub">The first month&rsquo;s interest is ' + money2(monthInt) + '. A payment at or below that never reduces the balance.</div></div>' +
        note('The smallest payment that reduces this balance is about ' + money2(Math.floor(monthInt * 100 + 1) / 100) + ' a month.');
    }
    var base = E.run([debt], 0, 'hybrid', { trace: true });
    var after = Object.assign({}, debt, { balance: Math.max(0, bal - lump) });
    var plan = after.balance > 0 ? E.run([after], extra, 'hybrid', { trace: true }) : { months: 0, totalInterest: 0, monthlyData: [] };
    setHandoff([after.balance > 0 ? after : debt], extra, 'avalanche');
    var changed = extra > 0 || lump > 0;
    var first = base.monthlyData[0] || { interest: 0 };
    var s = '<div class="stats">' +
      stat(changed ? 'Paid off with extra' : 'Paid off', plan.months ? monthLong(plan.months) : 'today', plan.months ? plural(plan.months, 'payment') + ' &middot; ' + duration(plan.months) : '', 'big') +
      stat('Total interest', money(plan.totalInterest), changed ? money(base.totalInterest - plan.totalInterest) + ' less than without extra' : '') +
      stat(byMonths ? 'Monthly payment needed' : 'Monthly payment', money2(pay) + (extra ? ' + ' + money(extra) : ''), byMonths ? 'to clear it in ' + plural(months, 'month') : money2(first.interest) + ' of the first payment is interest') + '</div>';
    if (changed) s += '<div class="stats">' + stat('Without extra', monthShort(base.months), money(base.totalInterest) + ' interest') + stat('Time saved', plural(base.months - plan.months, 'month')) + stat('Total paid', money(bal + plan.totalInterest)) + '</div>';
    else s += note('Total paid: <strong>' + money(bal + plan.totalInterest) + '</strong> &mdash; ' + money(bal) + ' borrowed plus ' + money(plan.totalInterest) + ' interest.');
    if (CFG.mode === 'holiday') {
      s += note('On this plan, the holiday spending costs ' + money(plan.totalInterest) + ' in interest on top of the ' + money(bal) + ' itself (' + (bal > 0 ? Math.round(plan.totalInterest / bal * 1000) / 10 : 0) + '% more).');
    }
    var series = [{ name: changed ? 'Without extra' : 'Balance', cls: changed ? 's1' : '', data: remainingSeries(base) }];
    if (changed && plan.monthlyData.length) series.push({ name: 'With extra', cls: 's2', data: remainingSeries(plan) });
    return s + chart(series, bal) + yearTable(changed ? plan : base, after.balance > 0 ? after.balance : bal);
  };
  function yearTable(r, startBal) {
    if (!r.monthlyData || !r.monthlyData.length) return '';
    var rows = [], paid = 0, int = 0, prev = startBal;
    r.monthlyData.forEach(function (m, i) {
      int += m.interest; paid += prev + m.interest - m.remaining; prev = m.remaining;
      if ((i + 1) % 12 === 0 || i === r.monthlyData.length - 1) { rows.push({ y: Math.ceil((i + 1) / 12), paid: paid, int: int, left: m.remaining }); paid = 0; int = 0; }
    });
    return '<details class="ytable"><summary>Year-by-year breakdown</summary><table class="rank"><thead><tr><th>Year</th><th>Paid</th><th>Interest</th><th>Balance left</th></tr></thead><tbody>' +
      rows.map(function (x) { return '<tr><td>' + x.y + '</td><td>' + money(x.paid) + '</td><td>' + money(x.int) + '</td><td>' + money(x.left) + '</td></tr>'; }).join('') + '</tbody></table></details>';
  }

  // Minimum-payment trap: shrinking minimum vs paying today's minimum every month
  MODES.minpay = function () {
    var bal = val('balance'), apr = val('apr'), pct = val('min-pct'), floor = val('min-floor');
    var bads = [bad('balance', !(bal > 0)), bad('apr', !(apr >= 0 && apr <= 100)), bad('min-pct', !(pct > 0 && pct <= 20)), bad('min-floor', !(floor >= 0))];
    if (bads.some(Boolean)) { setHandoff([], 0); return note('Enter a balance, APR, the minimum percentage (often 1&ndash;3%) and the dollar floor.'); }
    var r = apr / 100 / 12;
    // Shrinking minimum: pct of balance + this month's interest, never below floor.
    var b = bal, m = 0, interest = 0, firstMin = null, series = [];
    while (b > 0.005 && m < 1200) {
      m++;
      var i = b * r; interest += i; b += i;
      var due = Math.min(b, Math.max(floor, (b - i) * pct / 100 + i));
      if (firstMin === null) firstMin = due;
      b -= due; series.push(Math.max(0, b));
    }
    var shrinkM = m, shrinkI = interest;
    var debt = { id: 1, name: 'Credit card', type: 'cc', balance: bal, apr: apr, realApr: apr, minPayment: Math.round(firstMin * 100) / 100 };
    var fixed = E.run([debt], 0, 'hybrid', { trace: true });
    setHandoff([debt], 0, 'avalanche');
    return '<div class="versus">' +
      '<div class="vs-card"><div class="vs-title">Minimum shrinks as you pay</div><div class="vs-sub">' + pct + '% of balance + interest, at least ' + money(floor) + '</div><div class="vs-num">' + duration(shrinkM) + '</div><div class="vs-line">' + money(shrinkI) + ' interest</div><div class="vs-line muted">Last payment ' + (shrinkM < 1200 ? monthShort(shrinkM) : 'beyond 100 years') + '</div></div>' +
      '<div class="vs-card"><div class="vs-title">Keep paying today&rsquo;s minimum</div><div class="vs-sub">' + money2(debt.minPayment) + ' every month, fixed</div><div class="vs-num">' + duration(fixed.months) + '</div><div class="vs-line">' + money(fixed.totalInterest) + ' interest</div><div class="vs-line muted">Last payment ' + monthShort(fixed.months) + '</div></div>' +
      '</div><p class="verdict">Holding the payment at today&rsquo;s ' + money2(debt.minPayment) + ' instead of letting it shrink: <strong>' + duration(Math.max(0, shrinkM - fixed.months)) + ' sooner</strong> and <strong>' + money(shrinkI - fixed.totalInterest) + ' less interest</strong>.</p>' +
      chart([{ name: 'Shrinking minimum', cls: 's1', data: series }, { name: 'Fixed at today’s minimum', cls: 's2', data: remainingSeries(fixed) }], bal) +
      note('Card issuers set their own minimum formula; it is printed on your statement. Many use a percentage of the balance plus that month&rsquo;s interest, with a dollar floor.');
  };

  // Credit card interest cost
  MODES.interest = function () {
    var bal = val('balance'), apr = val('apr'), pay = val('payment');
    if ([bad('balance', !(bal > 0)), bad('apr', !(apr >= 0 && apr <= 100))].some(Boolean)) { setHandoff([], 0); return note('Enter a balance and an APR.'); }
    var daily = apr / 100 / 365, monthly = apr / 100 / 12;
    var s = '<div class="stats">' + stat('Interest per day', money2(bal * daily), 'APR &divide; 365 = ' + (apr / 365).toFixed(4) + '% a day') +
      stat('Interest this month', money2(bal * monthly), 'APR &divide; 12 = ' + (apr / 12).toFixed(3) + '% a month', 'big') +
      stat('Interest over a year', money(bal * monthly * 12), 'if the balance stayed at ' + money(bal)) + '</div>';
    if (!(pay > 0)) { bad('payment', String(document.getElementById('payment').value).trim() !== ''); return s + note('Add a monthly payment to see total interest until it is paid off.'); }
    var debt = { id: 1, name: 'Credit card', type: 'cc', balance: bal, apr: apr, realApr: apr, minPayment: pay };
    setHandoff([debt], 0, 'avalanche');
    if (pay <= bal * monthly + 0.004) return s + note('At ' + money2(pay) + ' a month, the payment does not cover the ' + money2(bal * monthly) + ' of monthly interest, so the balance never goes down.', 'warn');
    var r = E.run([debt], 0, 'hybrid', { trace: true });
    var first = r.monthlyData[0];
    return s + '<div class="stats">' + stat('Total interest at ' + money(pay) + '/mo', money(r.totalInterest), 'paid off ' + monthShort(r.months), 'big') +
      stat('First payment', money2(first.interest) + ' interest', money2(pay - first.interest) + ' to the balance') +
      stat('Interest share of all payments', Math.round(r.totalInterest / (bal + r.totalInterest) * 100) + '%') + '</div>' + chart([{ name: 'Balance', data: remainingSeries(r) }], bal) + yearTable(r, bal);
  };

  // Balance transfer: stay vs transfer
  MODES.transfer = function () {
    var bal = val('balance'), apr = val('apr'), fee = val('fee'), pApr = val('promo-apr'), pm = Math.round(val('promo-months')), post = val('post-apr'), pay = val('payment');
    var bads = [bad('balance', !(bal > 0)), bad('apr', !(apr >= 0 && apr <= 100)), bad('fee', !(fee >= 0 && fee <= 10)), bad('promo-apr', !(pApr >= 0 && pApr <= 100)),
      bad('promo-months', !(pm >= 1 && pm <= 60)), bad('post-apr', !(post >= 0 && post <= 100)), bad('payment', !(pay > 0))];
    if (bads.some(Boolean)) { setHandoff([], 0); return note('Fill in every field to compare (transfer fees are commonly 3&ndash;5%).'); }
    var feeAmt = Math.round(bal * fee) / 100, newBal = bal + feeAmt;
    var stay = { id: 1, name: 'Current card', type: 'cc', balance: bal, apr: apr, realApr: apr, minPayment: pay };
    var moved = { id: 1, name: 'Balance transfer', type: 'cc', balance: newBal, apr: pApr, realApr: post, minPayment: pay, hasPromo: true, promoApr: pApr, postPromoApr: post, promoEnd: isoDate(E.planMonthDate(pm)) };
    var rs = pay > bal * apr / 1200 ? E.run([stay], 0, 'hybrid', { trace: true }) : null;
    var rm = E.run([moved], 0, 'hybrid', { trace: true });
    setHandoff([moved], 0, 'avalanche');
    var leftAtEnd = rm.months <= pm ? 0 : (rm.monthlyData[pm - 1] ? rm.monthlyData[pm - 1].remaining : newBal);
    var pr = pApr / 1200, need = pr > 0 ? newBal * pr / (1 - Math.pow(1 + pr, -pm)) : newBal / pm;
    need = Math.ceil(need * 100) / 100;
    var costMoved = feeAmt + rm.totalInterest;
    var s = '<div class="stats">' + stat('Transfer fee', money2(feeAmt), fee + '% of ' + money(bal)) +
      stat('Left when the promo ends', money(leftAtEnd), leftAtEnd > 0 ? 'starts charging ' + post + '% in ' + monthShort(pm + 1) : 'cleared inside the promo', 'big') +
      stat('Payment to clear it in time', money2(need) + '/mo', 'over ' + plural(pm, 'month')) + '</div>';
    s += '<table class="rank"><thead><tr><th></th><th>Stay on current card</th><th>Transfer</th></tr></thead><tbody>' +
      '<tr><td>Paid off</td><td>' + (rs ? monthShort(rs.months) : 'never at this payment') + '</td><td>' + monthShort(rm.months) + '</td></tr>' +
      '<tr><td>Interest</td><td>' + (rs ? money(rs.totalInterest) : '&mdash;') + '</td><td>' + money(rm.totalInterest) + '</td></tr>' +
      '<tr><td>Fee</td><td>$0</td><td>' + money(feeAmt) + '</td></tr>' +
      '<tr class="win"><td>Total cost</td><td>' + (rs ? money(rs.totalInterest) : '&mdash;') + '</td><td>' + money(costMoved) + '</td></tr></tbody></table>';
    if (rs) s += '<p class="verdict">At ' + money(pay) + ' a month, the transfer ' + (costMoved < rs.totalInterest ? 'costs ' + money(rs.totalInterest - costMoved) + ' less' : 'costs ' + money(costMoved - rs.totalInterest) + ' more') + ' than staying, fee included.</p>';
    var series = [{ name: 'Transfer', cls: 's2', data: remainingSeries(rm) }];
    if (rs) series.unshift({ name: 'Stay', cls: 's1', data: remainingSeries(rs) });
    return s + chart(series, newBal) + note('Assumes no new purchases on either card and that the promo rate applies to the whole transferred balance. The card&rsquo;s terms set how payments and fees are applied.');
  };

  // Deferred interest ("no interest if paid in full")
  MODES.deferred = function () {
    var P = val('balance'), apr = val('apr'), n = Math.round(val('promo-months')), pay = val('payment');
    var bads = [bad('balance', !(P > 0)), bad('apr', !(apr >= 0 && apr <= 100)), bad('promo-months', !(n >= 1 && n <= 60)), bad('payment', !(pay > 0))];
    if (bads.some(Boolean)) { setHandoff([], 0); return note('Enter the purchase amount, the standard APR, the promo length and your monthly payment.'); }
    var need = Math.ceil(P / n * 100) / 100, r = apr / 1200;
    var b = P, accrued = 0, m = 0, series = [];
    while (m < n && b > 0.005) { m++; accrued += b * r; b = Math.max(0, b - pay); series.push(b); }
    var cleared = b <= 0.005;
    var s = '<div class="stats">' + stat('Payment that clears it in time', money2(need) + '/mo', plural(n, 'month') + ' &times; ' + money2(need) + ' &ge; ' + money(P), 'big') +
      stat('Your plan', cleared ? 'Cleared in ' + plural(m, 'month') : money(b) + ' left at the deadline', cleared ? 'before the promo ends' : 'when the promo ends ' + monthShort(n)) +
      stat('Interest building in the background', money(accrued), 'at ' + apr + '% while the promo runs') + '</div>';
    if (cleared) return s + '<p class="verdict">Paid in full before the deadline: <strong>$0 interest</strong>. The ' + money(accrued) + ' that built up in the background is never charged.</p>' + chart([{ name: 'Balance', data: series }], P);
    var total = b + accrued;
    var debt = { id: 1, name: 'Promo purchase', type: 'cc', balance: total, apr: apr, realApr: apr, minPayment: pay };
    setHandoff([debt], 0, 'avalanche');
    var after = pay > total * r ? E.run([debt], 0, 'hybrid', { trace: true }) : null;
    return s + '<p class="verdict warn">With ' + money(b) + ' still owed at the deadline, the ' + money(accrued) + ' of deferred interest is typically added in one charge, making the balance ' + money(total) + '.</p>' +
      '<div class="stats">' + stat('Paid off after that', after ? monthShort(n + after.months) : 'never at this payment') + stat('Interest after the promo', after ? money(after.totalInterest) : '&mdash;') +
      stat('Total interest on the purchase', after ? money(accrued + after.totalInterest) : '&mdash;', 'vs $0 if cleared in time', 'big') + '</div>' +
      chart([{ name: 'Balance', data: series.concat(after ? remainingSeries(after) : []) }], P) +
      note('Estimate. Deferred-interest plans commonly charge interest from the purchase date on the full original amount if any balance remains; your agreement sets the exact rules.');
  };

  // Debt consolidation: current debts vs one loan
  MODES.consolidate = function () {
    var rd = readDebts(), debts = rd.debts;
    var lApr = val('loan-apr'), term = Math.round(val('loan-term')), fee = val('loan-fee'), extra = Math.max(0, val('extra') || 0);
    var bads = [bad('loan-apr', !(lApr >= 0 && lApr <= 100)), bad('loan-term', !(term >= 6 && term <= 120)), bad('loan-fee', !(fee >= 0 && fee < 15))];
    if (!debts.length) { setHandoff([], 0); return note('Add the debts you are thinking of combining.'); }
    if (bads.some(Boolean)) { setHandoff(debts, extra); return note('Enter the loan&rsquo;s APR, term (6&ndash;120 months) and origination fee (0 if none).'); }
    var start = totalBal(debts), mins = totalMins(debts);
    var cur = E.run(debts, extra, 'avalanche', { trace: true });
    // Fee is commonly taken out of the loan, so the loan must be larger to pay everything off.
    var principal = fee > 0 ? start / (1 - fee / 100) : start, feeAmt = principal - start;
    var r = lApr / 1200, pmt = r > 0 ? principal * r / (1 - Math.pow(1 + r, -term)) : principal / term;
    pmt = Math.ceil(pmt * 100) / 100;
    var loan = { id: 1, name: 'Consolidation loan', type: 'personal', balance: principal, apr: lApr, realApr: lApr, minPayment: pmt };
    var lr = E.run([loan], 0, 'hybrid', { trace: true });
    setHandoff(debts, extra, 'avalanche');
    var lCost = lr.totalInterest + feeAmt;
    return (rd.problems.length ? note('Check: ' + rd.problems.map(esc).join(', '), 'warn') : '') +
      '<table class="rank cmp"><thead><tr><th></th><th>Keep current debts</th><th>One loan</th></tr></thead><tbody>' +
      '<tr><td>Amount owed</td><td>' + money(start) + '</td><td>' + money(principal) + (feeAmt > 0.5 ? '<div class="muted sm">includes ' + money(feeAmt) + ' fee</div>' : '') + '</td></tr>' +
      '<tr><td>Monthly payment</td><td>' + money(mins + extra) + '</td><td>' + money2(pmt) + '</td></tr>' +
      '<tr><td>Debt-free</td><td>' + monthShort(cur.months) + '</td><td>' + monthShort(lr.months) + '</td></tr>' +
      '<tr><td>Interest</td><td>' + money(cur.totalInterest) + '</td><td>' + money(lr.totalInterest) + '</td></tr>' +
      '<tr class="win"><td>Total cost (interest + fees)</td><td>' + money(cur.totalInterest) + '</td><td>' + money(lCost) + '</td></tr></tbody></table>' +
      '<p class="verdict">The loan path costs ' + (lCost <= cur.totalInterest ? money(cur.totalInterest - lCost) + ' less' : money(lCost - cur.totalInterest) + ' more') + ' in total, with a monthly payment ' +
      (pmt <= mins + extra ? money(mins + extra - pmt) + ' lower' : money(pmt - mins - extra) + ' higher') + ', and finishes ' + plural(Math.abs(cur.months - lr.months), 'month') + (lr.months <= cur.months ? ' sooner' : ' later') + '.</p>' +
      chart([{ name: 'Current debts (Avalanche)', cls: 's1', data: remainingSeries(cur) }, { name: 'One loan', cls: 's2', data: remainingSeries(lr) }], Math.max(start, principal)) +
      note('"Keep current debts" pays your minimums plus the extra you entered, Avalanche order, with paid-off minimums rolling forward. The loan assumes a fixed rate, a fixed payment for the full term, and that the old balances stay at zero.') + minFloorNotice(debts);
  };

  // Debt-to-income ratio
  MODES.dti = function () {
    var inc = val('income');
    if (bad('income', !(inc > 0))) { setHandoff([], 0); return note('Enter your gross monthly income (before taxes).'); }
    var fields = CFG.dtiFields, total = 0, housing = 0, rows = [];
    fields.forEach(function (f) {
      var v = val(f.id); var ok = !(String(document.getElementById(f.id).value).trim() !== '' && !(v >= 0)); bad(f.id, !ok);
      v = v >= 0 ? v : 0; total += v; if (f.housing) housing += v; if (v > 0) rows.push({ label: f.label, v: v, housing: f.housing });
    });
    setHandoff([], 0);
    var back = total / inc * 100, front = housing / inc * 100;
    var nonHousing = rows.filter(function (x) { return !x.housing; }).sort(function (a, b) { return b.v - a.v; });
    var s = '<div class="stats">' + stat('Debt-to-income (all debts)', back.toFixed(1) + '%', money(total) + ' of ' + money(inc) + ' a month', 'big') +
      stat('Housing only', front.toFixed(1) + '%', money(housing) + ' a month') + stat('Left after debt payments', money(inc - total), 'before taxes and other bills') + '</div>';
    s += '<div class="dti-bar" role="img" aria-label="Debt payments as a share of income"><span style="width:' + Math.min(100, front).toFixed(1) + '%" class="h"></span><span style="width:' + Math.max(0, Math.min(100 - front, back - front)).toFixed(1) + '%" class="o"></span></div><div class="legend"><span class="lg s2">Housing</span><span class="lg s1">Other debt payments</span></div>';
    if (nonHousing.length) s += '<h3 class="rh">If one payment went away</h3><table class="rank"><thead><tr><th>Paid off</th><th>New ratio</th><th>Change</th></tr></thead><tbody>' +
      nonHousing.map(function (x) { var n = (total - x.v) / inc * 100; return '<tr><td>' + esc(x.label) + ' (' + money(x.v) + '/mo)</td><td>' + n.toFixed(1) + '%</td><td>&minus;' + (back - n).toFixed(1) + ' pts</td></tr>'; }).join('') + '</tbody></table>';
    return s + note('Uses the monthly payments you enter (for cards, the minimum due). Lenders each set their own limits and may count debts differently.');
  };

  // ════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════
  if (CFG.widget === 'multi' || CFG.widget === 'consolidate') {
    (CFG.debts || []).forEach(addRow); renderRows(); bindRows();
  }
  root.addEventListener('input', function (e) { if (!e.target.closest('#debt-rows')) schedule(); });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'solve-months') toggleSolve();
    if (!e.target.closest('#debt-rows')) schedule();
  });
  function toggleSolve() {
    var cb = document.getElementById('solve-months'); if (!cb) return;
    var pf = document.getElementById('f-payment'), mf = document.getElementById('f-months');
    if (pf) pf.hidden = cb.checked; if (mf) mf.hidden = !cb.checked;
  }
  toggleSolve();
  document.querySelectorAll('[data-handoff]').forEach(function (b) { b.addEventListener('click', goHandoff); });
  var reset = document.getElementById('calc-reset');
  if (reset) reset.addEventListener('click', function () { location.reload(); });
  compute();
})();
