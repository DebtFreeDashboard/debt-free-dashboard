/* DebtFree Dashboard: Spanish pages (/es/), backlog D9, 2026-11-21.
 * A demand test: a Spanish homepage and three Spanish calculators. All payoff
 * math comes from /calculators/assets/engine.js, which is generated from the
 * app itself, so these pages give the same answers as the English calculators
 * and the app. Everything runs on the device; nothing is sent to a server.
 * The app is still in English: every page says so before the hand-off.
 */
(function () {
  'use strict';
  var E = window.DFEngine;
  var cfgEl = document.getElementById('es-config');
  var CFG = cfgEl ? JSON.parse(cfgEl.textContent) : { kind: 'home', slug: 'es-home' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function money2(n) { return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function parseAmt(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : NaN; }
  function monthLong(m) { return E.planMonthDate(m).toLocaleDateString('es-US', { month: 'long', year: 'numeric' }); }
  function monthShort(m) { return E.planMonthDate(m).toLocaleDateString('es-US', { month: 'short', year: 'numeric' }); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function track(name, p) { try { if (typeof gtag === 'function') gtag('event', name, Object.assign({ calc_page: CFG.slug, lang: 'es' }, p || {})); } catch (e) {} }
  var used = false;
  function markUsed() { if (!used) { used = true; track('calc_used', {}); } }
  function stat(label, value, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div>' + (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
  }
  function note(html, cls) { return '<p class="calc-note ' + (cls || '') + '">' + html + '</p>'; }
  function val(id) { var el = document.getElementById(id); return el ? parseAmt(el.value) : NaN; }
  function bad(id, isBad) { var el = document.getElementById(id); if (el) el.classList.toggle('bad', !!isBad); return !!isBad; }

  // ── hand-off into the app (same format as the English calculators) ──
  var handoff = { debts: [], extra: 0, strategy: 'avalanche' };
  function setHandoff(debts, extra, strategy) { handoff = { debts: debts || [], extra: extra || 0, strategy: strategy || 'avalanche' }; }
  function goHandoff(e) {
    var n = handoff.debts.length;
    if (n) {
      e.preventDefault();
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
      track('calc_handoff', { debt_count: n });
      location.href = '/app/dashboard.html?from=calculator&page=' + encodeURIComponent(CFG.slug);
    } else {
      track('calc_handoff', { debt_count: 0 });
    }
  }

  // ── balance-over-time chart (inline SVG) ──
  function chart(series, start) {
    var maxM = 0, maxV = start || 0;
    series.forEach(function (s) { maxM = Math.max(maxM, s.data.length); s.data.forEach(function (v) { if (v > maxV) maxV = v; }); });
    if (!maxM || !maxV) return '';
    var W = 640, H = 220, L = 54, R = 12, T = 12, B = 28, i;
    var x = function (m) { return L + (W - L - R) * (m / maxM); };
    var y = function (v) { return T + (H - T - B) * (1 - v / maxV); };
    var g = '';
    for (i = 0; i <= 4; i++) {
      var v = maxV * i / 4, yy = y(v);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="grid"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" class="axis" text-anchor="end">' + (v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)) + '</text>';
    }
    var step = maxM <= 24 ? 6 : maxM <= 60 ? 12 : maxM <= 180 ? 24 : 60;
    for (i = 0; i <= maxM; i += step) g += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="axis" text-anchor="middle">' + (i === 0 ? 'Hoy' : E.planMonthDate(i + 1).getFullYear()) + '</text>';
    var paths = series.map(function (s) {
      var d = 'M' + x(0) + ' ' + y(start);
      s.data.forEach(function (v, k) { d += ' L' + x(k + 1).toFixed(1) + ' ' + y(v).toFixed(1); });
      return '<path d="' + d + '" class="line ' + (s.cls || '') + '"/>';
    }).join('');
    var legend = series.length > 1 ? '<div class="legend">' + series.map(function (s) { return '<span class="lg ' + (s.cls || '') + '">' + esc(s.name) + '</span>'; }).join('') + '</div>' : '';
    return '<figure class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Saldo a lo largo del tiempo">' + g + paths + '</svg>' + legend + '<figcaption>Saldo total pendiente, mes a mes</figcaption></figure>';
  }
  function remaining(r) { return r.monthlyData.map(function (m) { return m.remaining; }); }

  // ── debt list (multi-debt pages) ──
  var rows = [], seq = 0;
  function addRow(d) { rows.push({ key: ++seq, name: d.name || '', type: d.type || 'cc', balance: d.balance != null ? String(d.balance) : '', apr: d.apr != null ? String(d.apr) : '', min: d.min != null ? String(d.min) : '' }); }
  function rowHTML(r) {
    return '<div class="debt-row" data-row="' + r.key + '">' +
      '<div class="f f-name"><label for="n' + r.key + '">Nombre</label><input id="n' + r.key + '" data-k="name" type="text" maxlength="40" value="' + esc(r.name) + '" placeholder="ej. Visa"></div>' +
      '<div class="f"><label for="b' + r.key + '">Saldo</label><div class="affix">$<input id="b' + r.key + '" data-k="balance" type="text" inputmode="decimal" value="' + esc(r.balance) + '"></div></div>' +
      '<div class="f"><label for="a' + r.key + '">Tasa (APR)</label><div class="affix suffix"><input id="a' + r.key + '" data-k="apr" type="text" inputmode="decimal" value="' + esc(r.apr) + '">%</div></div>' +
      '<div class="f"><label for="m' + r.key + '">Pago mínimo</label><div class="affix">$<input id="m' + r.key + '" data-k="min" type="text" inputmode="decimal" value="' + esc(r.min) + '" placeholder="auto"></div></div>' +
      '<button type="button" class="row-x" data-act="remove" aria-label="Quitar ' + esc(r.name || 'esta deuda') + '">&times;</button></div>';
  }
  function renderRows() {
    var box = document.getElementById('debt-rows');
    box.innerHTML = rows.map(rowHTML).join('');
    var add = document.getElementById('add-debt'); if (add) add.hidden = rows.length >= 12;
  }
  function readDebts() {
    var list = [], problems = [];
    rows.forEach(function (r, i) {
      var b = parseAmt(r.balance), a = parseAmt(r.apr), m = parseAmt(r.min);
      var label = r.name || ('Deuda ' + (i + 1));
      var el = document.querySelector('[data-row="' + r.key + '"]');
      var flag = function (k, isBad) { var f = el && el.querySelector('[data-k="' + k + '"]'); if (f) f.classList.toggle('bad', !!isBad); };
      var empty = String(r.balance).trim() === '' && String(r.apr).trim() === '';
      flag('balance', !empty && !(b > 0)); flag('apr', !empty && !(a >= 0 && a <= 100));
      if (empty) return;
      if (!(b > 0) || !(a >= 0 && a <= 100)) { problems.push(label); return; }
      var est = !(m >= 0) || String(r.min).trim() === '';
      if (est) m = E.estimateMinPayment(b, a, r.type);
      list.push({ id: i + 1, name: label, type: r.type, balance: b, apr: a, realApr: a, minPayment: m, _estimated: est });
    });
    return { debts: list, problems: problems };
  }
  function totalMins(ds) { return ds.reduce(function (s, d) { return s + Math.max(d.minPayment, E.minPaymentFloors(d).now); }, 0); }
  function totalBal(ds) { return ds.reduce(function (s, d) { return s + d.balance; }, 0); }
  function floorNotes(ds) {
    var low = ds.filter(function (d) { return E.minPaymentFloors(d).now > d.minPayment + 0.005; });
    var est = ds.filter(function (d) { return d._estimated; });
    var s = '';
    if (low.length) s += note('El pago mínimo de ' + low.map(function (d) { return esc(d.name); }).join(', ') + ' es menor que un mes de intereses, así que el saldo crecería sin fin. El cálculo lo sube a un mes de intereses más $1.', 'warn');
    if (est.length) s += note('Pago mínimo estimado para ' + est.map(function (d) { return esc(d.name); }).join(', ') + ' (en blanco). Con el mínimo real de tu estado de cuenta, el resultado es exacto.');
    return s;
  }
  var NAME = { avalanche: 'Avalancha', snowball: 'Bola de nieve', hybrid: 'Tu orden (como está en la lista)' };
  function run(ds, extra, s) { return E.run(ds, extra, s, { trace: true }); }
  function orderList(r, ds) {
    var by = {}; ds.forEach(function (d) { by[d.id] = d; });
    return '<ol class="payoff-order">' + r.perDebt.slice().sort(function (a, b) { return (a.paidOffMonth || 9999) - (b.paidOffMonth || 9999); }).map(function (p) {
      return '<li><span class="po-name">' + esc(by[p.id].name) + '</span><span class="po-when">' + (p.paidOffMonth ? monthShort(p.paidOffMonth) : 'no se termina') + '</span><span class="po-int">' + money(p.interestPaid) + ' de interés</span></li>';
    }).join('') + '</ol>';
  }
  function rollover(r, ds) {
    var by = {}; ds.forEach(function (d) { by[d.id] = d; });
    var done = r.perDebt.filter(function (p) { return p.paidOffMonth; }).sort(function (a, b) { return a.paidOffMonth - b.paidOffMonth; });
    var acc = 0, items = [];
    done.slice(0, -1).forEach(function (p) {
      var d = by[p.id]; acc += d.minPayment;
      items.push('<li><strong>' + monthShort(p.paidOffMonth) + ':</strong> ' + esc(d.name) + ' queda pagada. Su mínimo de ' + money(d.minPayment) + ' se suma al pago de la siguiente deuda, así que ahora ' + money(acc) + ' al mes de mínimos liberados pasan adelante.</li>');
    });
    return items.length ? '<ul class="rollover">' + items.join('') + '</ul>' : '';
  }

  var out = document.getElementById('calc-results');
  var MODES = {};

  MODES.multi = function () {
    var rd = readDebts(), ds = rd.debts, extra = Math.max(0, val('extra') || 0);
    bad('extra', !(val('extra') >= 0) && String(document.getElementById('extra').value).trim() !== '');
    var probs = rd.problems.length ? note('Revisa el saldo y la tasa de: ' + rd.problems.map(esc).join(', ') + '.', 'warn') : '';
    if (!ds.length) { setHandoff([], 0); return probs + note('Agrega al menos una deuda con saldo y tasa anual para ver el resultado.'); }
    var chosen = CFG.strategy || 'avalanche', sel = document.getElementById('strategy');
    if (sel) chosen = sel.value;
    var res = { snowball: run(ds, extra, 'snowball'), avalanche: run(ds, extra, 'avalanche'), hybrid: run(ds, extra, 'hybrid') };
    var main = res[chosen], start = totalBal(ds), mins = totalMins(ds);
    setHandoff(ds, extra, chosen);
    var s = probs + floorNotes(ds) + '<div class="stats">' +
      stat('Sin deudas en', monthLong(main.months), plural(main.months, 'pago mensual', 'pagos mensuales'), 'big') +
      stat('Intereses en total', money(main.totalInterest), NAME[chosen]) +
      stat('Pago mensual', money(mins + extra), money(mins) + ' de mínimos + ' + money(extra) + ' extra') + '</div>';
    var other = chosen === 'snowball' ? 'avalanche' : 'snowball', o = res[other];
    var dI = o.totalInterest - main.totalInterest, dM = o.months - main.months;
    var cmp = Math.abs(dI) < 1 && dM === 0 ? 'Con estas deudas, ' + NAME[other] + ' da el mismo resultado.'
      : NAME[other] + ' con los mismos números: ' + money(o.totalInterest) + ' de interés, sin deudas en ' + monthShort(o.months) + ' (' +
        (dI > 0 ? money(dI) + ' más de interés' : money(-dI) + ' menos de interés') + (dM ? ', ' + plural(Math.abs(dM), 'mes', 'meses') + (dM > 0 ? ' después' : ' antes') : ', el mismo mes') + ').';
    s += '<h3 class="rh">Orden de pago: ' + NAME[chosen] + '</h3>' + orderList(main, ds) + rollover(main, ds) + note(cmp) +
      chart([{ name: NAME[chosen], data: remaining(main) }], start) + (main.diverged ? note('Con estos pagos, el plan no llega a cero en 50 años.', 'warn') : '');
    return s;
  };

  MODES.card = function () {
    var bal = val('balance'), apr = val('apr'), pay = val('payment'), months = Math.round(val('months')), extra = Math.max(0, val('extra') || 0);
    var solve = document.getElementById('solve-months') && document.getElementById('solve-months').checked;
    var bads = [bad('balance', !(bal > 0)), bad('apr', !(apr >= 0 && apr <= 100))];
    if (solve) bads.push(bad('months', !(months >= 1 && months <= 600))); else bads.push(bad('payment', !(pay > 0)));
    if (bads.some(Boolean)) { setHandoff([], 0); return note(solve ? 'Escribe el saldo, la tasa anual y en cuántos meses (1 a 600).' : 'Escribe el saldo, la tasa anual y el pago mensual.'); }
    var r = apr / 1200;
    if (solve) {
      var need = r > 0 ? bal * r / (1 - Math.pow(1 + r, -months)) : bal / months;
      need = Math.ceil(need * 100) / 100;
      var d1 = { id: 1, name: CFG.debtName, type: 'cc', balance: bal, apr: apr, realApr: apr, minPayment: need };
      var rr = E.run([d1], 0, 'avalanche', { trace: true });
      setHandoff([d1], 0, 'avalanche');
      return '<div class="stats">' + stat('Pago mensual necesario', money2(need), 'durante ' + plural(months, 'mes', 'meses'), 'big') +
        stat('Sin deuda en', monthLong(rr.months)) + stat('Intereses en total', money(rr.totalInterest)) + '</div>' +
        chart([{ name: CFG.debtName, data: remaining(rr) }], bal) + note('Supone que no se agregan cargos nuevos y que la tasa no cambia.');
    }
    var interest = bal * r;
    if (pay + extra <= interest + 0.005) {
      setHandoff([], 0);
      return note('A ' + apr + '% anual, ' + money(bal) + ' genera unos ' + money2(interest) + ' de interés al mes, así que un pago de ' + money2(pay + extra) + ' nunca llega a cero.', 'warn');
    }
    var d = { id: 1, name: CFG.debtName, type: 'cc', balance: bal, apr: apr, realApr: apr, minPayment: pay };
    var res = E.run([d], extra, 'avalanche', { trace: true });
    setHandoff([d], extra, 'avalanche');
    var s = '<div class="stats">' + stat('Sin deuda en', monthLong(res.months), plural(res.months, 'pago', 'pagos'), 'big') +
      stat('Intereses en total', money(res.totalInterest)) + stat('Pagas en total', money(bal + res.totalInterest)) + '</div>';
    if (extra === 0) {
      var more = E.run([d], 100, 'avalanche');
      if (more && !more.diverged && more.months < res.months) s += note('Con $100 más al mes: sin deuda en ' + monthShort(more.months) + (res.totalInterest - more.totalInterest >= 1 ? ', con ' + money(res.totalInterest - more.totalInterest) + ' menos de interés' : '') + '.');
    }
    return s + chart([{ name: CFG.debtName, data: remaining(res) }], bal) + note('Supone que no se agregan cargos nuevos y que la tasa no cambia.');
  };

  // ── quick calculator on the Spanish homepage (one combined balance) ──
  MODES.quick = function () {
    var bal = val('balance'), apr = val('apr'), pay = val('payment');
    if ([bad('balance', !(bal > 0)), bad('apr', !(apr >= 0 && apr <= 100)), bad('payment', !(pay > 0))].some(Boolean)) return note('Escribe tu deuda total, una tasa anual entre 0 y 100 y un pago mensual.');
    var interest = bal * apr / 1200;
    if (pay <= interest + 0.005) return note('A ' + apr + '% anual, ' + money(bal) + ' genera unos ' + money(interest) + ' de interés al mes, así que un pago de ' + money(pay) + ' nunca llega a cero.', 'warn');
    var d = { id: 1, name: 'Deuda total', type: 'cc', balance: bal, apr: apr, realApr: apr, minPayment: pay };
    var r = E.run([d], 0, 'avalanche');
    if (!r || r.diverged) return note('Este pago no llega a cero en 50 años.', 'warn');
    var more = E.run([d], 100, 'avalanche'), extra = '';
    if (more && !more.diverged && more.months < r.months) {
      var saved = r.totalInterest - more.totalInterest;
      extra = note('Con $100 más al mes: <strong>' + monthShort(more.months) + '</strong>' + (saved >= 1 ? ', ' + money(saved) + ' menos de interés' : '') + '.');
    }
    return '<div class="stats">' + stat('Sin deudas en', monthLong(r.months), plural(r.months, 'pago', 'pagos') + ' &middot; ' + money(r.totalInterest) + ' de interés', 'big') + '</div>' + extra;
  };

  // ── boot ──
  var root = document.getElementById('calc');
  if (E && root && out && MODES[CFG.mode]) {
    if (CFG.mode === 'multi') {
      (CFG.debts || []).forEach(addRow); renderRows();
      var box = document.getElementById('debt-rows');
      box.addEventListener('input', function (e) {
        var el = e.target.closest('.debt-row'); if (!el) return;
        var r = rows.find(function (x) { return String(x.key) === el.dataset.row; }); if (!r || !e.target.dataset.k) return;
        r[e.target.dataset.k] = e.target.value; schedule();
      });
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act="remove"]'); if (!b) return;
        var el = b.closest('.debt-row'); rows = rows.filter(function (x) { return String(x.key) !== el.dataset.row; }); renderRows(); schedule();
      });
      var add = document.getElementById('add-debt');
      if (add) add.addEventListener('click', function () { addRow({ type: 'cc' }); renderRows(); schedule(); var last = box.querySelector('.debt-row:last-child input'); if (last) last.focus(); });
    }
    var timer = null, first = true;
    var schedule = function () { clearTimeout(timer); timer = setTimeout(compute, 200); };
    var compute = function () {
      var h; try { h = MODES[CFG.mode](); } catch (err) { h = note('Algo salió mal con estos números. Revisa los datos.', 'warn'); if (window.console) console.error(err); }
      out.innerHTML = h; if (!first) markUsed(); first = false;
    };
    root.addEventListener('input', function (e) { if (!e.target.closest('#debt-rows')) schedule(); });
    root.addEventListener('change', function (e) {
      if (e.target.id === 'solve-months') toggleSolve();
      if (!e.target.closest('#debt-rows')) schedule();
    });
    var toggleSolve = function () {
      var cb = document.getElementById('solve-months'); if (!cb) return;
      var pf = document.getElementById('f-payment'), mf = document.getElementById('f-months');
      if (pf) pf.hidden = cb.checked; if (mf) mf.hidden = !cb.checked;
    };
    toggleSolve(); compute();
  } else if (root) {
    root.hidden = true;
  }
  document.querySelectorAll('[data-handoff]').forEach(function (b) { b.addEventListener('click', goHandoff); });

  // ── "I'd like the app in Spanish": the demand signal for translating the app ──
  document.querySelectorAll('[data-es-interest]').forEach(function (b) {
    b.addEventListener('click', function () {
      var done = false; try { done = localStorage.getItem('debtfree_es_interest') === '1'; localStorage.setItem('debtfree_es_interest', '1'); } catch (e) {}
      if (!done) track('es_interest', { location: b.getAttribute('data-es-interest') });
      var msg = b.parentNode.querySelector('.es-thanks');
      b.hidden = true; if (msg) msg.hidden = false;
    });
  });
})();
