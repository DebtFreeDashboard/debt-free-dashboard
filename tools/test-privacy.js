/*
 * test-privacy.js — v1.41.2
 *
 * Asserts on window.dataLayer, NOT on the source. The engineering notes are
 * explicit that stubbing window.gtag does not work here (the page declares its
 * own `function gtag(){}` which shadows an init-script assignment), so reading
 * dataLayer is the only way to see what would actually be sent.
 *
 * The strong assertion is generic: after exercising the app, NO parameter on
 * ANY event may look like a dollar figure from the fixture. That catches a
 * future leak this test was never written for.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART = fs.readFileSync(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-primary.json'), 'utf8'));

const results = [];
const check = (label, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
};

async function boot(b, file) {
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('debtfree_last_seen_version', '99.0.0');
      localStorage.setItem('debtfree_demo_dismissed', '1');
      localStorage.setItem('debtfree_premium', 'TEST-KEY');
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(__dirname, file));
  await page.waitForTimeout(1200);
  await page.evaluate(f => { applyBackupPayload(f); }, FIXTURE);
  await page.evaluate(() => { isPremium = true; applyPremiumState(); render(); });
  await page.waitForTimeout(1200);
  return { page, ctx, errs };
}

// Every event the four fixed call sites can emit, triggered through real code.
const EXERCISE = () => {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.length = 0;
  const out = [];
  try { trackShare('dialdate_apply', { extra_band: amountBand(1460) }); out.push('dialdate'); } catch (e) { out.push('dialdate ERR ' + e.message); }
  try { wiSet('extra', 900); out.push('whatif'); } catch (e) { out.push('whatif ERR ' + e.message); }
  try { trackShare('debt_reclassified_transfer', { _category: 'data_quality', amount_band: amountBand(8750) }); out.push('transfer'); } catch (e) { out.push('transfer ERR ' + e.message); }
  try { trackShare('lumps_optimized', { _category: 'planning', saved_band: amountBand(1234) }); out.push('lumps'); } catch (e) { out.push('lumps ERR ' + e.message); }
  return out;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ── Confirm the OLD build really did leak (proves the test can detect it) ──
  console.log('--- the old build, to prove this test can see a leak ---');
  const old = await boot(b, 'dashboard.html');
  const oldLeak = await old.page.evaluate(() => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.length = 0;
    try { wiSet('extra', 900); } catch (e) {}
    return window.dataLayer.map(a => JSON.stringify(Array.from(a)));
  });
  check('v1.41.1 whatif_set did send the raw figure 900',
        oldLeak.some(s => /"control_value":900|control_value.*900/.test(s)),
        oldLeak.find(s => /whatif/.test(s)) || '(nothing captured)');
  await old.ctx.close();

  // ── The new build ─────────────────────────────────────────────────────
  console.log('\n--- v1.41.2 ---');
  const nb = await boot(b, 'site/app/dashboard.html');
  const page = nb.page;

  const fired = await page.evaluate(EXERCISE);
  check('all four call sites fire without error', fired.every(f => !f.includes('ERR')), fired.join(', '));

  const events = await page.evaluate(() =>
    window.dataLayer.map(a => { const x = Array.from(a); return { name: x[1], params: x[2] || {} }; })
      .filter(e => e.name));

  console.log(`      captured ${events.length} event(s): ${events.map(e => e.name).join(', ')}`);

  // Generic sweep: no parameter may equal a real figure from the fixture.
  const realFigures = [1460, 900, 8750, 1234, 450, 11400, 14200, 3900, 680, 6400, 2200, 1850];
  const offenders = [];
  for (const e of events) {
    for (const [k, v] of Object.entries(e.params)) {
      const num = typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : null);
      if (num !== null && realFigures.includes(Math.round(Math.abs(num)))) {
        offenders.push(`${e.name}.${k} = ${v}`);
      }
    }
  }
  check('no event parameter carries a real dollar figure',
        offenders.length === 0, offenders.join(' | ') || 'none');

  // And the bands are actually present and sensible.
  const bands = await page.evaluate(() => ({
    zero: amountBand(0), small: amountBand(37), mid: amountBand(1460),
    big: amountBand(8750), huge: amountBand(99999), negative: amountBand(-1234)
  }));
  check('amountBand produces ranges, never figures',
        bands.mid === '1000-1999' && bands.big === '5000-9999' && bands.zero === '0' &&
        bands.huge === '25000+' && bands.negative === '1000-1999',
        JSON.stringify(bands));

  const whatif = events.find(e => e.name === 'whatif_set');
  check('whatif_set now sends a band, and no control_value at all',
        whatif && whatif.params.control_band && !('control_value' in whatif.params),
        whatif ? JSON.stringify(whatif.params) : 'event not captured');

  // ── Clarity masking ───────────────────────────────────────────────────
  console.log('\n--- session-recording masking ---');
  const mask = await page.evaluate(() => {
    const money = Array.from(document.querySelectorAll('input[inputmode="decimal"], input[type="number"]'));
    const unmasked = money.filter(i => i.getAttribute('data-clarity-mask') !== 'true').map(i => i.id || i.name || '(unnamed)');
    return { total: money.length, unmasked };
  });
  check(`every money input is masked (${mask.total} found)`,
        mask.unmasked.length === 0, mask.unmasked.join(', ') || 'none unmasked');

  // Fields created later (modals build lazily) must get masked too.
  const late = await page.evaluate(async () => {
    const d = document.createElement('div');
    d.innerHTML = '<input inputmode="decimal" id="late-money-field">';
    document.body.appendChild(d);
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('late-money-field');
    return el ? el.getAttribute('data-clarity-mask') : 'missing';
  });
  check('a money input added after boot is masked automatically', late === 'true', `data-clarity-mask=${late}`);

  check('no JS errors', nb.errs.length === 0, nb.errs.slice(0, 2).join(' | ') || 'none');

  console.log(`\n${results.every(Boolean) ? 'ALL PASS' : 'FAILURES PRESENT'}  (${results.filter(Boolean).length}/${results.length})`);
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})();
