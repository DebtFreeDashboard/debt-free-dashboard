/* test-calculators.js — calculator pages + the dashboard handoff
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-calculators.js
 *
 * Needs playwright (NODE_PATH or a local install) and Chromium.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8911';
const { extractFunction, FUNCS, CONSTS } = require('./make-calc-engine.js');
const { PAGES } = require('./build-calculators.js');
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && (!ok || process.env.VERBOSE)) console.log('      ' + d); };

function loadEngine() {
  const ctx = { console };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'calculators/assets/engine.js'), 'utf8'), ctx);
  return ctx.DFEngine;
}

(async () => {
  console.log('--- engine is a verbatim copy of the dashboard ---');
  const html = fs.readFileSync(path.join(ROOT, 'app/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
  const lines = html.split('\n');
  const eng = fs.readFileSync(path.join(ROOT, 'calculators/assets/engine.js'), 'utf8');
  const stale = FUNCS.filter(n => !eng.includes(extractFunction(lines, n)));
  const staleC = CONSTS.filter(n => !eng.includes(lines.find(l => l.startsWith('const ' + n + ' ='))));
  ck('every copied function is byte-identical to app/dashboard.html', !stale.length && !staleC.length, stale.concat(staleC).join(', '));
  const appVer = html.match(/APP_VERSION = '([^']+)'/)[1];
  ck('engine header matches APP_VERSION ' + appVer, eng.includes('dashboard.html v' + appVer));

  const E = loadEngine();
  console.log('\n--- monotonicity: more money never finishes later or costs more ---');
  const multi = PAGES.filter(p => p.debts);
  let monoBad = [];
  multi.forEach(p => {
    const debts = p.debts.map((d, i) => {
      const o = { id: i + 1, name: d.name, type: d.type, balance: d.balance, apr: d.apr, realApr: d.apr, minPayment: d.min };
      if (d.hasPromo) { Object.assign(o, { hasPromo: true, promoApr: d.promoApr, apr: d.promoApr, postPromoApr: d.postApr, realApr: d.postApr, promoEnd: E.planMonthDate(d.promoMonths).toISOString().slice(0, 10) }); }
      return o;
    });
    ['avalanche', 'snowball', 'hybrid'].forEach(s => {
      let prev = null;
      for (let x = 0; x <= 3000; x += 25) {
        const r = E.run(debts, x, s);
        if (prev && (r.months > prev.months || r.totalInterest > prev.totalInterest + 1e-6)) { monoBad.push(`${p.slug} ${s} extra=${x}`); break; }
        prev = r;
      }
    });
  });
  ck('extra $0–$3,000 in $25 steps, every multi-debt page, all three orders', !monoBad.length, monoBad.slice(0, 5).join('; '));

  console.log('\n--- the browser ---');
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function open(url, vp, init) {
    const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500, serviceWorkers: 'block' });
    await ctx.route('**/googletagmanager.com/**', r => r.abort());
    await ctx.route('**/clarity.ms/**', r => r.abort());
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    if (init) await ctx.addInitScript(init);
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
    await pg.goto(url, { waitUntil: 'load' });
    return { ctx, pg, errs };
  }

  // Inputs to nudge per widget, to prove results react.
  const nudge = { multi: 'extra', single: 'balance', minpay: 'balance', interest: 'balance', transfer: 'balance', deferred: 'payment', consolidate: 'loan-apr', dti: 'income' };
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    let fails = [];
    for (const p of PAGES) {
      const { ctx, pg, errs } = await open(`${BASE}/calculators/${p.slug}/`, vp);
      await pg.waitForTimeout(350);
      const st = await pg.evaluate(() => ({
        res: document.getElementById('calc-results').innerText,
        overflow: Math.max(document.documentElement.scrollWidth - window.innerWidth,
          ...[...document.querySelectorAll('#calc input, #calc select, #calc button, #calc-results *')].map(el => { const r = el.getBoundingClientRect(), c = document.getElementById('calc').getBoundingClientRect(); return r.width ? r.right - c.right : 0; })),
        h1: document.querySelector('h1').innerText,
        faqs: document.querySelectorAll('.faq details').length,
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].every(s => { try { JSON.parse(s.textContent); return true; } catch (e) { return false; } })
      }));
      const id = nudge[p.mode === 'target' ? 'target' : p.widget] || nudge[p.widget];
      const sel = p.mode === 'target' ? '#target-months' : '#' + id;
      const before = st.res;
      const cur = await pg.inputValue(sel);
      await pg.fill(sel, String(p.mode === 'target' ? 24 : Math.round(parseFloat(cur || '0') * 0.8 + 7)));
      await pg.waitForTimeout(400);
      const after = await pg.evaluate(() => document.getElementById('calc-results').innerText);
      const probs = [];
      if (errs.length) probs.push('errors: ' + errs.join(' | '));
      if (!st.res || st.res.length < 40) probs.push('no results');
      if (/Something went wrong|NaN|undefined|Infinity/.test(st.res + after)) probs.push('bad text in results: ' + (st.res + after).match(/Something went wrong|NaN|undefined|Infinity/)[0]);
      if (st.overflow > 1) probs.push('horizontal overflow ' + st.overflow + 'px');
      if (before === after) probs.push('results did not change after editing ' + sel);
      if (st.faqs < 4) probs.push('faq count ' + st.faqs);
      if (!st.ld) probs.push('JSON-LD does not parse');
      if (probs.length) fails.push(p.slug + ': ' + probs.join('; '));
      await ctx.close();
    }
    ck(`all ${PAGES.length} pages at ${vp.width}px: load clean, compute, react to input, no overflow, valid JSON-LD`, !fails.length, fails.join('\n      '));
  }

  console.log('\n--- calculator numbers match the dashboard for the same inputs ---');
  {
    const { ctx, pg } = await open(`${BASE}/calculators/debt-payoff-calculator/`, { width: 1280, height: 900 });
    await pg.waitForTimeout(300);
    const calc = await pg.evaluate(() => {
      const t = document.querySelector('table.rank tbody');
      return [...t.rows].map(r => [...r.cells].map(c => c.innerText.trim()));
    });
    // Hand off and read the app's own numbers.
    await pg.click('.handoff [data-handoff]');
    await pg.waitForURL(/app\/dashboard\.html/);
    await pg.waitForTimeout(1500);
    const app = await pg.evaluate(() => {
      const out = {};
      ['snowball', 'avalanche', 'hybrid'].forEach(s => {
        const r = simulate(debts.filter(d => d.balance > 0).map(d => ({ ...d })), extraMonthly, 0, s, [], { anchor: false });
        out[s] = { months: r.months, interest: Math.round(r.totalInterest) };
      });
      return { n: debts.length, extra: extraMonthly, strategy, out, demo: document.body.classList.contains('demo-mode') };
    });
    const map = { 'Snowball': 'snowball', 'Avalanche': 'avalanche', 'Your order (as listed)': 'hybrid' };
    const mism = calc.filter(r => { const k = map[r[0]]; const a = app.out[k]; return !a || +r[2] !== a.months || r[3].replace(/[$,]/g, '') !== String(a.interest); });
    ck('handoff: 5 debts, extra and strategy arrive; example data never shown', app.n === 5 && app.extra === 250 && !app.demo, JSON.stringify({ n: app.n, extra: app.extra, strategy: app.strategy, demo: app.demo }));
    ck('Snowball / Avalanche / Your order: months and interest identical in the app', !mism.length, JSON.stringify({ calc, app: app.out }));
    const left = await pg.evaluate(() => localStorage.getItem('debtfree_calc_import'));
    ck('the handoff is consumed exactly once (key removed)', left === null);
    await pg.reload(); await pg.waitForTimeout(1200);
    const n2 = await pg.evaluate(() => debts.length);
    ck('reloading does not import again', n2 === 5, 'debts=' + n2);
    await ctx.close();
  }

  console.log('\n--- existing plan: asked first, add-only ---');
  {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-fixtures/test-primary.json'), 'utf8'));
    const { ctx, pg } = await open(`${BASE}/calculators/credit-card-payoff-calculator/`, { width: 390, height: 844 }, f => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('debtfree_last_seen_version', '99.0.0');
        localStorage.setItem('debtfree_debts', JSON.stringify(f.debts));
        localStorage.setItem('debtfree_payments', JSON.stringify(f.payments || []));
        localStorage.setItem('debtfree_strategy', 'snowball');
        localStorage.setItem('debtfree_extra', '321');
      }
    });
    // init script runs per page; pass the fixture through evaluate instead
    await ctx.close();
    const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c2.route('**/googletagmanager.com/**', r => r.abort()); await c2.route('**/clarity.ms/**', r => r.abort());
    await c2.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    const pg2 = await c2.newPage(); const errs2 = []; pg2.on('pageerror', e => errs2.push(e.message));
    await pg2.goto(`${BASE}/calculators/credit-card-payoff-calculator/`);
    await pg2.evaluate(f => {
      localStorage.setItem('debtfree_last_seen_version', '99.0.0');
      localStorage.setItem('debtfree_debts', JSON.stringify(f.debts));
      localStorage.setItem('debtfree_payments', JSON.stringify(f.payments || []));
      localStorage.setItem('debtfree_strategy', 'snowball');
      localStorage.setItem('debtfree_extra', '321');
    }, fx);
    await pg2.waitForTimeout(300);
    await pg2.click('.handoff [data-handoff]');
    await pg2.waitForURL(/app\/dashboard\.html/); await pg2.waitForTimeout(1600);
    const modal = await pg2.evaluate(() => { const m = document.getElementById('calc-import-modal'); return m ? m.innerText : null; });
    ck('existing user sees "Add debts from the calculator?" instead of an overwrite', !!modal && /Add debts from the calculator/.test(modal), modal);
    const before = await pg2.evaluate(() => ({ n: debts.length, s: strategy, x: extraMonthly, p: payments.length }));
    await pg2.click('#calc-import-yes'); await pg2.waitForTimeout(500);
    const after = await pg2.evaluate(() => ({ n: debts.length, s: strategy, x: extraMonthly, p: payments.length, last: debts[debts.length - 1].name }));
    ck('accepting adds exactly one debt and leaves strategy, extra and payments alone',
      after.n === before.n + 1 && after.s === before.s && after.x === before.x && after.p === before.p, JSON.stringify({ before, after }));
    ck('no page errors in the existing-user flow', !errs2.length, errs2.join(' | '));
    await c2.close();
  }

  console.log('\n--- a stale or malformed handoff is ignored ---');
  {
    const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c3.route('**/googletagmanager.com/**', r => r.abort()); await c3.route('**/clarity.ms/**', r => r.abort());
    await c3.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    const pg3 = await c3.newPage(); const e3 = []; pg3.on('pageerror', e => e3.push(e.message));
    await pg3.goto(`${BASE}/calculators/`);
    await pg3.evaluate(() => localStorage.setItem('debtfree_calc_import', JSON.stringify({ v: 1, ts: Date.now() - 2 * 3600e3, debts: [{ name: 'Old', balance: 100, apr: 10, minPayment: 25 }] })));
    await pg3.goto(`${BASE}/app/dashboard.html`); await pg3.waitForTimeout(1200);
    const s1 = await pg3.evaluate(() => ({ demo: document.body.classList.contains('demo-mode'), names: debts.map(d => d.name), key: localStorage.getItem('debtfree_calc_import') }));
    ck('a two-hour-old handoff is dropped; the fresh-visitor example shows as usual', s1.demo && !s1.names.includes('Old') && s1.key === null, JSON.stringify(s1));
    await pg3.evaluate(() => { localStorage.clear(); localStorage.setItem('debtfree_calc_import', '{not json'); });
    await pg3.reload(); await pg3.waitForTimeout(1200);
    const s2 = await pg3.evaluate(() => ({ demo: document.body.classList.contains('demo-mode') }));
    ck('malformed JSON is ignored without breaking boot', s2.demo && !e3.length, e3.join(' | '));
    await pg3.evaluate(() => { localStorage.clear(); localStorage.setItem('debtfree_calc_import', JSON.stringify({ v: 1, ts: Date.now(), debts: [{ name: '<img src=x onerror=alert(1)>', balance: 500, apr: 20, minPayment: 25 }] })); });
    await pg3.reload(); await pg3.waitForTimeout(1500);
    const s3 = await pg3.evaluate(() => ({ imgs: document.querySelectorAll('img[src="x"]').length, n: debts.length }));
    ck('an HTML-bait debt name imports as text, never markup', s3.n === 1 && s3.imgs === 0, JSON.stringify(s3));
    await c3.close();
  }
  await b.close();

  console.log('\n--- built pages: links, copy ---');
  const files = [path.join(ROOT, 'calculators/index.html')].concat(PAGES.map(p => path.join(ROOT, 'calculators', p.slug, 'index.html')));
  const broken = [];
  files.forEach(f => {
    const h = fs.readFileSync(f, 'utf8');
    (h.match(/href="(\/[^"#?]*)"/g) || []).forEach(m => {
      const u = m.slice(6, -1);
      const t = path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u);
      if (!fs.existsSync(t)) broken.push(path.relative(ROOT, f) + ' -> ' + u);
    });
  });
  ck('every internal link resolves to a file in the repo', !broken.length, [...new Set(broken)].slice(0, 10).join('\n      '));
  const BANNED = /\byou should\b|\bwe recommend\b|\bconsider (?:paying|using|moving|a )|\bmake sure\b|\bit'?s smart\b|\bthe best (?:choice|option|way)\b/i;
  const copyHits = [];
  files.forEach(f => {
    const h = fs.readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<summary>[\s\S]*?<\/summary>/g, '');
    const t = h.replace(/<[^>]+>/g, ' ');
    const m = t.match(BANNED); if (m) copyHits.push(path.relative(ROOT, f) + ': "' + m[0] + '"');
  });
  const js = fs.readFileSync(path.join(ROOT, 'calculators/assets/calc.js'), 'utf8');
  const jm = js.match(BANNED); if (jm) copyHits.push('calc.js: "' + jm[0] + '"');
  ck('no advice phrasing in page copy or calculator output strings', !copyHits.length, copyHits.join('\n      '));
  const titles = files.map(f => (fs.readFileSync(f, 'utf8').match(/<title>([^<]+)<\/title>/) || [])[1]);
  ck('every page has a unique <title>', new Set(titles).size === titles.length);
  const descs = files.map(f => (fs.readFileSync(f, 'utf8').match(/name="description" content="([^"]+)"/) || [])[1]);
  ck('every page has a unique meta description, 120–160 chars', new Set(descs).size === descs.length && descs.every(d => d && d.length >= 120 && d.length <= 160), descs.map(d => d.length).join(','));

  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
