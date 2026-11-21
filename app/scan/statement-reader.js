/* DebtFree: statement reader (backlog B3, prototype 2026-11-21).
 *
 * Turns the words an on-device OCR engine finds on statement screenshots into
 * debt fields: balance, minimum, due date, APR, credit limit, promo rate and
 * end date, statement date, lender. Input is pages of words with positions
 * ({ x, y, w, h, t }), so it does not care which OCR produced them.
 *
 * Nothing here keeps or sends anything. Account numbers, names and addresses
 * on a statement are never read into a field.
 *
 * First tuned on 8 screenshots of Kevin's own statements (Discover, Bank of
 * America, Synchrony, a Stellantis lease, Xfinity): 34/34 fields. That is the
 * data it was written against, so it says little about other lenders yet.
 */
(function (global) {
  'use strict';

  // Group words into visual rows across the whole page, so a label and its
  // value that sit in different OCR blocks still end up on one line.
  function rows(ws) {
    var hs = ws.map(function (w) { return w.h; }).sort(function (a, b) { return a - b; });
    var mh = hs[hs.length >> 1] || 20;
    var out = [];
    ws.slice().sort(function (a, b) { return (a.y + a.h / 2) - (b.y + b.h / 2); }).forEach(function (w) {
      var cy = w.y + w.h / 2, r = null, best = Infinity;
      out.forEach(function (o) { var d = Math.abs(o.cy - cy); if (d < Math.max(mh, w.h) * 0.6 && d < best) { best = d; r = o; } });
      if (!r) { r = { cy: cy, ws: [] }; out.push(r); }
      r.ws.push(w);
      r.cy = r.ws.reduce(function (s, v) { return s + v.y + v.h / 2; }, 0) / r.ws.length;
    });
    out.forEach(function (r) { r.ws.sort(function (a, b) { return a.x - b.x; }); r.text = r.ws.map(function (w) { return w.t; }).join(' '); });
    return out.sort(function (a, b) { return a.cy - b.cy; });
  }

  // OCR often reads a thousands comma as a period ("$16.260.00"), so any
  // run of 3-digit groups counts as thousands, whichever mark separates them.
  var MONEY = /\$\s?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{2}))?(?!\d)|\b(\d{1,3}(?:[.,]\d{3})+|\d+)[.,](\d{2})(?!\d)/;
  var MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  var DATE = new RegExp('\\b(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})(?!\\d)|\\b(' + MONTHS + ')[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b', 'i');
  function money(s) {
    // A dropped decimal point ("$16.26000", "$17,00000"): one thousands mark
    // then five digits can only be X,XXX.XX.
    var d = s.match(/\$\s?(\d{1,3})[.,](\d{3})(\d{2})(?!\d)/);
    if (d) return parseFloat(d[1] + d[2] + '.' + d[3]);
    var m = s.match(MONEY); if (!m) return null;
    var whole = m[1] || m[3], cents = m[1] ? (m[2] || '00') : m[4];
    return parseFloat(whole.replace(/[.,]/g, '') + '.' + cents);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(s) {
    var m = s.match(DATE); if (!m) return null;
    if (m[1]) { var y = +m[3]; if (y < 100) y += 2000; if (+m[1] > 12 || +m[2] > 31) return null; return y + '-' + pad(+m[1]) + '-' + pad(+m[2]); }
    var mo = MONTHS.split('|').indexOf(m[4].toLowerCase().slice(0, 3)) + 1;
    return m[6] + '-' + pad(mo) + '-' + pad(+m[5]);
  }
  function pct(s) { var m = s.match(/(\d{1,2}\.\d{1,3})\s?%/); return m ? parseFloat(m[1]) : null; }

  // The value for a label: the first match to its right on the same row;
  // failing that, the nearest match directly below it (column layouts such as
  // Discover's "New Balance | Minimum Payment | Payment Due Date" header).
  // Statements repeat the key numbers (summary box, payment coupon), so every
  // place a label appears gets a vote and the value read most often wins;
  // a tie goes to the first. One misread copy is outvoted by a clean one.
  function find(R, labelRe, valueFn, opts) {
    var vals = findAll(R, labelRe, valueFn, opts);
    if (!vals.length) return null;
    var count = {}, best = null, bestN = 0;
    vals.forEach(function (v) { var k = JSON.stringify(v); count[k] = (count[k] || 0) + 1; if (count[k] > bestN) { bestN = count[k]; best = v; } });
    return best;
  }
  function findAll(R, labelRe, valueFn, opts) {
    opts = opts || {}; var found = [];
    var exact = new RegExp('^(?:' + labelRe.source + ')$', 'i');
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      if (!labelRe.test(r.text) || (opts.not && opts.not.test(r.text))) continue;
      var a = -1, b = -1;
      for (var i0 = 0; i0 < r.ws.length && a < 0; i0++) {
        var acc = '';
        for (var j0 = i0; j0 < r.ws.length; j0++) {
          acc += (acc ? ' ' : '') + r.ws[j0].t;
          if (exact.test(acc.replace(/[:.]+$/, ''))) { a = i0; b = j0; break; }
        }
      }
      if (a < 0) continue;
      var v = valueFn(r.ws.slice(b + 1).map(function (w) { return w.t; }).join(' '));
      if (v != null) { found.push(v); continue; }
      var lx0 = r.ws[a].x, lx1 = r.ws[b].x + r.ws[b].w;
      for (var j = i + 1; j < Math.min(R.length, i + 3); j++) {
        var near = R[j].ws.filter(function (w) { return w.x + w.w > lx0 - 20 && w.x < lx1 + 20; }).map(function (w) { return w.t; }).join(' ');
        var v2 = valueFn(near); if (v2 != null) { found.push(v2); break; }
      }
    }
    return found;
  }

  var LENDERS = [
    ['American Express', /american express|\bamex\b/i], ['Apple Card', /apple card/i], ['Bank of America', /bank of america/i],
    ['Barclays', /barclays/i], ['Capital One', /capital one/i], ['Chase', /\bchase\b/i], ['Citi', /\bciti(bank)?\b/i],
    ['Discover', /discover/i], ['Synchrony', /synchrony/i], ['Wells Fargo', /wells fargo/i], ['U.S. Bank', /u\.?s\.? bank/i],
    ['Navy Federal', /navy federal/i], ['USAA', /\busaa\b/i], ['PNC', /\bpnc\b/i], ['TD Bank', /\btd bank\b/i],
    ['Ally', /\bally\b/i], ['Stellantis', /stel+[a-z]*ntis|chrysler capital/i], ['Toyota Financial', /toyota financial/i],
    ['Honda Financial', /honda financial|american honda finance/i], ['Ford Credit', /ford credit|ford motor credit/i],
    ['GM Financial', /gm financial/i], ['Navient', /navient/i], ['Nelnet', /nelnet/i], ['MOHELA', /mohela/i],
    ['Aidvantage', /aidvantage/i], ['Sallie Mae', /sallie mae/i], ['SoFi', /\bsofi\b/i], ['LendingClub', /lending ?club/i],
    ['Upstart', /upstart/i], ['Best Egg', /best egg/i], ['Affirm', /\baffirm\b/i], ['PayPal', /paypal/i],
    ['Xfinity', /xfinity|comcast/i], ['Verizon', /verizon/i], ['AT&T', /\bat&t\b/i], ['T-Mobile', /t-mobile/i]
  ];

  // pages: [[{x,y,w,h,t}], ...], one array per screenshot of the same statement.
  function read(pages) {
    var R = [];
    pages.forEach(function (ws) { R = R.concat(rows(ws.filter(function (w) { return w.t && w.t.trim(); }))); });
    var all = R.map(function (r) { return r.text; }).join('\n');
    var f = {};
    f.kind = /credit (line|limit)/i.test(all) ? 'card'
      : /vehicle|\bVIN\b|\blease\b|payments made/i.test(all) ? 'auto'
      : /\bAPR\b|annual percentage/i.test(all) ? 'loan' : 'bill';
    f.balance = find(R, /new balance( total)?:?/i, money, { not: /previous/i });
    f.minimum = find(R, /(total )?minimum payment( due)?/i, money, { not: /warning|only|late|if we do not/i });
    // Bills and loans: the amount due, most specific label first.
    [/total amount due/i, /please pay/i, /amount due/i, /payment amount/i, /(regular )?monthly payment/i].forEach(function (re) {
      if (f.minimum == null) f.minimum = find(R, re, money, { not: /base monthly|past due/i });
    });
    f.dueDate = find(R, /payment due date|payment due by|amount due|due date/i, isoDate, { not: /late|warning/i });
    f.creditLimit = find(R, /(total )?credit (line|limit)/i, money, { not: /available|cash/i });
    f.statementDate = find(R, /statement (closing )?date:?|closing date|statement closing/i, isoDate);
    var purch = R.find(function (r) { return /^\W*purchases\b/i.test(r.text) && /%/.test(r.text); });
    f.apr = purch ? pct(purch.text) : null;
    if (f.apr == null && f.kind !== 'card') { var anyApr = R.find(function (r) { return /\bAPR\b|interest rate|annual percentage/i.test(r.text) && /%/.test(r.text); }); f.apr = anyApr ? pct(anyApr.text) : null; }
    var promo = R.find(function (r) { return /promotional apr|deferred interest|promo(tional)? rate/i.test(r.text) && DATE.test(r.text) && /%/.test(r.text); });
    f.promo = promo ? { apr: pct(promo.text), until: isoDate(promo.text), deferred: /deferred/i.test(promo.text) } : null;
    var made = all.match(/payments made\s+0*(\d+)\s+of\s+0*(\d+)/i);
    f.payments = made ? { made: +made[1], of: +made[2] } : null;
    var lender = LENDERS.find(function (l) { return l[1].test(all); });
    f.lender = lender ? lender[0] : null;
    return f;
  }

  var api = { read: read, _rows: rows, _money: money, _isoDate: isoDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DFStatementReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
