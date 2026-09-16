/*
 * test-amort.js — amortization + CSV export, v1.41.0
 *
 * The load-bearing test is REGRESSION: getPlanSim() now always runs with
 * trace on, and that must not have moved a single existing number. It runs the
 * unpatched build and the patched build against the same fixture and compares.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART = fs.readFileSync(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-primary.json'), 'utf8'));

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
}
const near = (a, b, tol = 0.02) => Math.abs(a - b) < tol;
const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

async function boot(browser, file, premium) {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await ctx.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
  await ctx.route('**/googletagmanager.com/**', r => r.abort());
  await ctx.route('**/clarity.ms/**', r => r.abort());
  await ctx.addInitScript(p => {
    try {
      localStorage.setItem('debtfree_last_seen_version', '99.0.0');   // suppress What's New
      localStorage.setItem('debtfree_demo_dismissed', '1');
      if (p) localStorage.setItem('debtfree_premium', 'TEST-PREMIUM-KEY');
    } catch (e) {}
  }, premium);

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(__dirname, file));
  await page.waitForTimeout(1200);

  // Load via the app's own path, per the engineering notes — not raw localStorage.
  await page.evaluate(f => { applyBackupPayload(f); }, FIXTURE);
  if (premium) await page.evaluate(() => { isPremium = true; applyPremiumState(); render(); });
  await page.waitForTimeout(1200);
  return { page, ctx, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ── REGRESSION: trace-on must not move any number ─────────────────────
  console.log('--- regression: forcing trace on getPlanSim() changed nothing ---');
  const oldB = await boot(b, 'dashboard.html', true);
  const newB = await boot(b, 'app/dashboard.html', true);

  const shape = p => p.evaluate(() => {
    const out = {};
    ['optimized', 'avalanche', 'snowball', 'hybrid'].forEach(st => {
      strategy = st;
      _planSimCache = { key: null, res: null };
      const s = getPlanSim();
      out[st] = s ? { months: s.months, interest: Math.round(s.totalInterest * 100) / 100 } : null;
    });
    return out;
  });
  const oldNums = await shape(oldB.page);
  const newNums = await shape(newB.page);
  for (const st of Object.keys(oldNums)) {
    const o = oldNums[st], n = newNums[st];
    check(`${st}: months + interest identical to the unpatched build`,
          o && n && o.months === n.months && near(o.interest, n.interest, 0.005),
          `before ${o.months}mo / ${money(o.interest)}   after ${n.months}mo / ${money(n.interest)}`);
  }
  await oldB.ctx.close();

  const page = newB.page;
  await page.evaluate(() => { strategy = 'avalanche'; _planSimCache = { key: null, res: null }; recalculate(); });
  await page.waitForTimeout(600);

  // ── LEDGER IDENTITY, per debt per month ───────────────────────────────
  console.log('\n--- ledger identity: close === open + interest - paid ---');
  const identity = await page.evaluate(() => {
    const sim = getPlanSim();
    let rows = 0, bad = [];
    sim.monthlyData.forEach(md => {
      if (!md.amort) return;
      for (const k in md.amort) {
        const a = md.amort[k];
        rows++;
        const expect = a.open + a.interest - a.paid;
        if (Math.abs(expect - a.close) > 0.005) {
          bad.push({ month: md.month, id: k, open: a.open, int: a.interest, paid: a.paid, close: a.close, expect });
        }
      }
    });
    return { rows, bad: bad.slice(0, 3), badCount: bad.length };
  });
  check(`every amortization row balances (${identity.rows} rows checked)`,
        identity.badCount === 0, identity.badCount ? JSON.stringify(identity.bad) : 'no discrepancies');

  // ── CROSS-TAB AGREEMENT ───────────────────────────────────────────────
  console.log('\n--- cross-tab agreement ---');
  const agree = await page.evaluate(() => {
    const sim = getPlanSim();
    const rows = amortRowsFor('all');
    const sumInt = rows.reduce((a, r) => a + r.interest, 0);
    return {
      simMonths: sim.months, rowMonths: rows.length,
      simInt: sim.totalInterest, rowInt: sumInt,
      lastClose: rows.length ? rows[rows.length - 1].close : null
    };
  });
  check('row count === sim.months (same horizon as Dashboard/Roadmap)',
        agree.simMonths === agree.rowMonths, `sim ${agree.simMonths} / rows ${agree.rowMonths}`);
  check('summed row interest === sim.totalInterest',
        near(agree.simInt, agree.rowInt, 0.02), `${money(agree.simInt)} vs ${money(agree.rowInt)}`);
  check('final month closes at zero', agree.lastClose !== null && agree.lastClose < 0.01,
        `final balance ${money(agree.lastClose || 0)}`);

  // Per-debt rows must sum to the combined view.
  const perDebt = await page.evaluate(() => {
    const active = _activePlanDebts();
    const all = amortRowsFor('all');
    let sumPaid = 0, sumInt = 0;
    active.forEach(d => {
      amortRowsFor(d.id).forEach(r => { sumPaid += r.paid; sumInt += r.interest; });
    });
    return {
      allPaid: all.reduce((a, r) => a + r.paid, 0), allInt: all.reduce((a, r) => a + r.interest, 0),
      sumPaid, sumInt, debts: active.length
    };
  });
  check(`per-debt rows sum to the combined view (${perDebt.debts} debts)`,
        near(perDebt.allPaid, perDebt.sumPaid, 0.05) && near(perDebt.allInt, perDebt.sumInt, 0.05),
        `paid ${money(perDebt.allPaid)} vs ${money(perDebt.sumPaid)} | interest ${money(perDebt.allInt)} vs ${money(perDebt.sumInt)}`);

  // ── MONOTONICITY ──────────────────────────────────────────────────────
  console.log('\n--- monotonicity: more money never costs more ---');
  const mono = await page.evaluate(() => {
    const out = [];
    for (let extra = 0; extra <= 1200; extra += 100) {
      document.getElementById('extra-payment').value = String(extra);
      _planSimCache = { key: null, res: null };
      recalculate();
      const s = getPlanSim();
      out.push({ extra, months: s.months, interest: s.totalInterest });
    }
    return out;
  });
  let monoOK = true, viol = '';
  for (let i = 1; i < mono.length; i++) {
    if (mono[i].months > mono[i - 1].months || mono[i].interest > mono[i - 1].interest + 0.01) {
      monoOK = false;
      viol = `$${mono[i - 1].extra}->${mono[i - 1].months}mo/${money(mono[i - 1].interest)} then $${mono[i].extra}->${mono[i].months}mo/${money(mono[i].interest)}`;
      break;
    }
  }
  check('sweeping extra $0-$1200 never worsens months or interest', monoOK,
        viol || `${mono[0].months}mo @ $0  ->  ${mono[mono.length - 1].months}mo @ $1200`);

  await page.evaluate(() => {
    document.getElementById('extra-payment').value = '450';
    _planSimCache = { key: null, res: null }; recalculate();
  });
  await page.waitForTimeout(500);

  // ── RENDERED DOM ──────────────────────────────────────────────────────
  console.log('\n--- rendered DOM (premium) ---');
  const dom = await page.evaluate(() => {
    const card = document.getElementById('amort-card');
    const body = document.getElementById('amort-body');
    return {
      cardShown: card && getComputedStyle(card).display !== 'none',
      teaserShown: (() => { const t = document.getElementById('amort-teaser'); return t && getComputedStyle(t).display !== 'none'; })(),
      rowCount: body ? body.querySelectorAll('tr').length : 0,
      firstRow: body && body.querySelector('tr') ? body.querySelector('tr').innerText.replace(/\s+/g, ' ').trim() : '',
      note: (document.getElementById('amort-note') || {}).textContent || '',
      options: Array.from(document.querySelectorAll('#amort-debt option')).map(o => o.textContent)
    };
  });
  check('premium sees the table, not the teaser', dom.cardShown && !dom.teaserShown);
  check('table renders 12 rows collapsed', dom.rowCount === 12, `${dom.rowCount} rows | first: ${dom.firstRow}`);
  check('summary line present', /month/.test(dom.note), dom.note);
  // 7 active + 1 combined. The fixture's excluded debt (includeInStrategy:false)
  // and its paid-off debt must NOT appear — this is a plan projection, and they
  // are not in the plan.
  check('picker = plan debts + combined, excluding out-of-plan debts',
        dom.options.length === 8
        && !dom.options.some(o => /Medical/.test(o))
        && !dom.options.some(o => /Old Best Buy/.test(o)),
        `${dom.options.length} options: ${dom.options.join(' / ')}`);
  check('debt name with & and <> is escaped, not injected',
        dom.options.some(o => o.includes("Bob & Sue's <Home> Card")),
        dom.options.find(o => o.includes('Bob')) || 'not found');

  const expanded = await page.evaluate(() => { toggleAmortRows(); return document.getElementById('amort-body').querySelectorAll('tr').length; });
  check('expand shows the full schedule', expanded === agree.simMonths, `${expanded} rows vs ${agree.simMonths} months`);

  // ── CSV ───────────────────────────────────────────────────────────────
  console.log('\n--- CSV export ---');
  const csv = await page.evaluate(() => {
    let captured = null;
    const realCreate = URL.createObjectURL;
    // Intercept the Blob rather than driving a real download.
    URL.createObjectURL = function (blob) { captured = blob; return 'blob:stub'; };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    exportAmortizationCsv();
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    if (!captured) return null;
    // Blob.text() strips a leading BOM per the UTF-8 decode spec, so the bytes
    // have to be read directly to prove the BOM actually shipped.
    return captured.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      return { bom: u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF,
               text: new TextDecoder('utf-8').decode(u8.slice(3)) };
    });
  });
  check('export produced a CSV', !!csv && csv.text.length > 100, csv ? `${csv.text.length} bytes` : 'nothing');

  if (csv) {
    const lines = csv.text.split('\r\n');
    const header = lines[0];
    const dataLines = lines.filter(l => l && !l.startsWith('Month,') && l.indexOf(',') > 0);
    check('header is the expected 8 columns',
          header === 'Month,Date,Debt,Starting balance,Payment,Interest,Principal,Ending balance', header);
    check('BOM bytes present so Excel reads UTF-8 debt names', csv.bom, 'EF BB BF');
    check('a debt name containing a comma/quote is quoted',
          csv.text.includes("Bob & Sue's <Home> Card"),
          (lines.find(l => l.includes('Bob')) || '').slice(0, 72));
    check('summary block present', csv.text.includes('Debt-free date') && csv.text.includes('Total interest'));

    // CSV totals must reconcile with the sim — this is the artifact people
    // check the math with, so it has to add up in their spreadsheet.
    let csvInterest = 0;
    dataLines.forEach(l => {
      const parts = l.match(/(".*?"|[^,]*)(,|$)/g);
      if (!parts || parts.length < 8) return;
      const v = parseFloat(parts[5].replace(/[",]/g, ''));
      if (!isNaN(v)) csvInterest += v;
    });
    check('CSV interest column reconciles with sim.totalInterest',
          near(csvInterest, agree.simInt, 1.0), `CSV ${money(csvInterest)} vs sim ${money(agree.simInt)}`);
  }

  // Formula-injection guard.
  const inj = await page.evaluate(() => {
    debts[0].name = '=HYPERLINK("http://evil","click")';
    let captured = null;
    const rc = URL.createObjectURL; URL.createObjectURL = b => { captured = b; return 'blob:stub'; };
    const cl = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    exportDebtsCsv();
    URL.createObjectURL = rc; HTMLAnchorElement.prototype.click = cl;
    return captured ? captured.text() : null;
  });
  check('a debt named =HYPERLINK(...) is neutralised in the CSV',
        !!inj && !/(^|,)"?=HYPERLINK/m.test(inj) && inj.includes("'=HYPERLINK"),
        (inj || '').split('\r\n').find(l => l.includes('HYPERLINK')) || 'not found');

  // ── FREE TIER ─────────────────────────────────────────────────────────
  console.log('\n--- free tier ---');
  const freeB = await boot(b, 'app/dashboard.html', false);
  const free = await freeB.page.evaluate(() => {
    const card = document.getElementById('amort-card');
    const teaser = document.getElementById('amort-teaser');
    let exported = null;
    const rc = URL.createObjectURL; URL.createObjectURL = x => { exported = x; return 'blob:stub'; };
    try { exportAmortizationCsv(); } catch (e) {}
    URL.createObjectURL = rc;
    return {
      cardShown: card && getComputedStyle(card).display !== 'none',
      teaserShown: teaser && getComputedStyle(teaser).display !== 'none',
      exported: !!exported
    };
  });
  check('free tier sees the teaser, not the table', !free.cardShown && free.teaserShown,
        `card ${free.cardShown} / teaser ${free.teaserShown}`);
  check('free tier cannot export even by calling the function', !free.exported);

  console.log('\n--- JS errors ---');
  check('no page errors, premium build', newB.errs.length === 0, newB.errs.slice(0, 2).join(' | ') || 'none');
  check('no page errors, free build', freeB.errs.length === 0, freeB.errs.slice(0, 2).join(' | ') || 'none');

  const passed = results.filter(Boolean).length;
  console.log(`\n${results.every(Boolean) ? 'ALL PASS' : 'FAILURES PRESENT'}  (${passed}/${results.length})`);
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})();
