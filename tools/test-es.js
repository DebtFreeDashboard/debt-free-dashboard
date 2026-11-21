#!/usr/bin/env node
/* test-es.js: the Spanish pages (tools/build-es.js, es/assets/es.js).
 *
 *   python3 -m http.server 8911    # from the repo root, another shell
 *   node tools/test-es.js
 *
 * Checks every Spanish page loads clean and computes, that its numbers are the
 * engine's numbers, the hand-off into the app, the "app in Spanish" signal,
 * hreflang both ways, no horizontal overflow on a phone, and no advice wording.
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8911';
const { PAGES } = require('./build-es.js');
const URLS = ['/es/'].concat(PAGES.map(p => '/es/calculadoras/' + p.slug + '/'));
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (detail ? '\n      ' + detail : '')); } }

(async () => {
  const b = await chromium.launch();
  async function open(url, opts) {
    const ctx = await b.newContext(opts || { viewport: { width: 1280, height: 900 } });
    await ctx.route(/googletagmanager|clarity|fonts\.g/, r => r.abort());
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return { p, ctx, errs };
  }
  const events = p => p.evaluate(() => [].slice.call(window.dataLayer || []).map(a => [].slice.call(a)).filter(e => e[0] === 'event').map(e => [e[1], e[2] || {}]));

  // 1. every page: loads clean, computes, Spanish, no overflow at 390px
  for (const u of URLS) {
    const { p, ctx, errs } = await open(u, { viewport: { width: 390, height: 844 } });
    const r = await p.evaluate(() => ({
      lang: document.documentElement.lang, out: (document.getElementById('calc-results') || {}).innerText || '',
      over: document.documentElement.scrollWidth - window.innerWidth,
      note: !!document.querySelector('.lang-note'), ld: (() => { try { JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); return true; } catch (e) { return false; } })()
    }));
    ok(u + ': loads clean, lang=es, result shown, app-language note, valid JSON-LD, no overflow',
      !errs.length && r.lang === 'es' && /Sin deudas? en/.test(r.out) && r.note && r.ld && r.over <= 1,
      JSON.stringify({ errs, lang: r.lang, out: r.out.slice(0, 80), over: r.over, note: r.note, ld: r.ld }));
    await ctx.close();
  }

  // 2. numbers are the engine's numbers
  {
    const { p, ctx } = await open('/es/calculadoras/calculadora-pago-de-deudas/');
    const r = await p.evaluate(() => {
      const cfg = JSON.parse(document.getElementById('es-config').textContent), E = window.DFEngine;
      const ds = cfg.debts.map((d, i) => ({ id: i + 1, name: d.name, type: d.type, balance: d.balance, apr: d.apr, realApr: d.apr, minPayment: d.min }));
      const want = E.run(ds, 250, 'avalanche');
      return { want: '$' + Math.round(want.totalInterest).toLocaleString('en-US'), out: document.getElementById('calc-results').innerText };
    });
    ok('pago de deudas: interest equals engine (avalanche, $250 extra)', r.out.includes(r.want), r.want + ' not in ' + r.out.slice(0, 200));
    // monotonicity: more extra never finishes later or costs more
    const mono = await p.evaluate(() => {
      const cfg = JSON.parse(document.getElementById('es-config').textContent), E = window.DFEngine;
      const ds = cfg.debts.map((d, i) => ({ id: i + 1, name: d.name, type: d.type, balance: d.balance, apr: d.apr, realApr: d.apr, minPayment: d.min }));
      let prev = null, bad = [];
      for (let x = 0; x <= 3000; x += 50) { const r = E.run(ds, x, 'avalanche'); if (prev && (r.months > prev.months || r.totalInterest > prev.totalInterest + 0.01)) bad.push(x); prev = r; }
      return bad;
    });
    ok('pago de deudas: extra $0–$3,000 never later or costlier', !mono.length, 'at ' + mono.join(','));
    // hand-off into the app
    await p.click('.handoff [data-handoff]');
    await p.waitForURL(/dashboard\.html/, { timeout: 15000 });
    await p.waitForTimeout(2500);
    const app = await p.evaluate(() => ({ url: location.href, left: localStorage.getItem('debtfree_calc_import'), debts: (JSON.parse(localStorage.getItem('debtfree_debts') || '[]') || []).map(d => d.name) }));
    ok('hand-off: app opens from the Spanish page and imports the 5 debts', /page=es-calculadora-pago-de-deudas/.test(app.url) && app.left === null && app.debts.length === 5 && app.debts.includes('Tarjeta de tienda'), JSON.stringify(app));
    await ctx.close();
  }
  {
    const { p, ctx } = await open('/es/calculadoras/calculadora-bola-de-nieve/');
    const first = await p.evaluate(() => (document.querySelector('.payoff-order li .po-name') || {}).textContent);
    ok('bola de nieve: smallest balance is paid first', first === 'Tarjeta de tienda', first);
    await ctx.close();
  }
  {
    const { p, ctx } = await open('/es/calculadoras/calculadora-tarjeta-de-credito/');
    const r = await p.evaluate(() => {
      const E = window.DFEngine, d = { id: 1, name: 'x', type: 'cc', balance: 5000, apr: 22.99, realApr: 22.99, minPayment: 175 };
      const res = E.run([d], 0, 'avalanche');
      return { months: res.months, want: '$' + Math.round(res.totalInterest).toLocaleString('en-US'), out: document.getElementById('calc-results').innerText };
    });
    ok('tarjeta: payoff interest and payments equal engine', r.out.includes(r.want) && r.out.includes(r.months + ' pagos'), JSON.stringify(r).slice(0, 300));
    await p.check('#solve-months'); await p.waitForTimeout(400);
    const s = await p.evaluate(() => document.getElementById('calc-results').innerText);
    const i = 22.99 / 1200, need = Math.ceil(5000 * i / (1 - Math.pow(1 + i, -24)) * 100) / 100;
    ok('tarjeta: payment for 24 months is the amortised payment', s.includes('$' + need.toFixed(2)), need + ' not in ' + s.slice(0, 120));
    await p.uncheck('#solve-months'); await p.fill('#payment', '90'); await p.waitForTimeout(400);
    const low = await p.evaluate(() => document.getElementById('calc-results').innerText);
    ok('tarjeta: a payment below the monthly interest says it never reaches zero', /nunca llega a cero/.test(low), low);
    await ctx.close();
  }
  {
    const { p, ctx } = await open('/es/');
    const out = await p.evaluate(() => document.getElementById('calc-results').innerText);
    const want = await p.evaluate(() => { const E = window.DFEngine; const r = E.run([{ id: 1, name: 'x', type: 'cc', balance: 12000, apr: 22, realApr: 22, minPayment: 400 }], 0, 'avalanche'); return E.planMonthDate(r.months).toLocaleDateString('es-US', { month: 'long', year: 'numeric' }); });
    ok('inicio: quick calculator shows the engine month (' + want + ')', out.includes(want), out);
    // the "app in Spanish" signal: once per browser
    await p.click('[data-es-interest]'); await p.waitForTimeout(150);
    let ev = (await events(p)).filter(e => e[0] === 'es_interest');
    const thanks = await p.isVisible('.es-thanks');
    await p.reload(); await p.waitForTimeout(300);
    await p.click('[data-es-interest]'); await p.waitForTimeout(150);
    const ev2 = (await events(p)).filter(e => e[0] === 'es_interest');
    ok('es_interest: sent once with location, thanks shown, not sent again', ev.length === 1 && ev[0][1].location === 'home' && ev[0][1].lang === 'es' && thanks && ev2.length === 0, JSON.stringify({ ev, thanks, ev2 }));
    await ctx.close();
  }

  // 3. hreflang both ways
  const read = u => fs.readFileSync(path.join(ROOT, u.replace(/^\//, ''), u.endsWith('/') ? 'index.html' : ''), 'utf8');
  for (const u of URLS) {
    const es = read(u);
    const en = (es.match(/hreflang="en" href="https:\/\/mydebtdashboard\.com([^"]+)"/) || [])[1];
    const back = en ? read(en) : '';
    ok('hreflang: ' + u + ' <-> ' + en, !!en && back.includes('hreflang="es" href="https://mydebtdashboard.com' + u + '"'));
  }
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  ok('sitemap lists every Spanish page', URLS.every(u => sm.includes('https://mydebtdashboard.com' + u)));

  // 4. compliance: no advice wording, Gumroad never named, price hidden in the Play app
  const ADVICE = /\b(deber[ií]as|debes|tienes que|te recomendamos|recomendamos|lo mejor es|te conviene)\b/i;
  const js = fs.readFileSync(path.join(ROOT, 'es/assets/es.js'), 'utf8');
  const hits = URLS.map(u => [u, (read(u).replace(/<script[\s\S]*?<\/script>/g, '').match(ADVICE) || [])[0]]).filter(x => x[1]).concat(ADVICE.test(js) ? [['es.js', js.match(ADVICE)[0]]] : []);
  ok('no advice phrasing in Spanish copy or output strings', !hits.length, JSON.stringify(hits));
  ok('no Gumroad link on Spanish pages; $24 only inside .web-only', URLS.every(u => { const h = read(u); return !/gumroad/i.test(h) && (h.match(/\$24/g) || []).length === (h.match(/class="web-only"[^<]*\$24/g) || []).length; }));

  await b.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})();
