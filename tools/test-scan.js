#!/usr/bin/env node
/* test-scan.js: the statement reader test page (backlog B3).
 *
 *   python3 -m http.server 8911    # from the repo root, another shell
 *   node tools/test-scan.js
 *
 * Uses a made-up statement drawn in the browser (no real statement is ever
 * committed), reads it through app/scan-test.html with the self-hosted OCR,
 * and checks the fields, plus the reader's repair rules on their own.
 */
const path = require('path'), fs = require('fs');
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const ROOT = path.join(__dirname, '..');
const R = require('../app/scan/statement-reader.js');
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (detail ? '\n      ' + detail : '')); } }

// ── reader rules on their own ──
ok('money: commas, whole dollars, misread comma, dropped decimal',
  R._money('$19,039.71') === 19039.71 && R._money('$26,000') === 26000 && R._money('$16.260.00') === 16260 && R._money('$16.26000') === 16260 && R._money('$17,00000') === 17000 && R._money('1.5x') === null);
ok('dates: numeric, short year, month name; impossible dates refused',
  R._isoDate('12/07/2026') === '2026-12-07' && R._isoDate('10/19/27') === '2027-10-19' && R._isoDate('November 15, 2026') === '2026-11-15' && R._isoDate('Oct 08, 2026') === '2026-10-08' && R._isoDate('13/45/2026') === null);
{
  // one misread copy of the balance is outvoted by two clean ones
  const W = (t, x, y) => t.split(' ').map((s, i) => ({ x: x + i * 90, y, w: 80, h: 20, t: s }));
  const page = [].concat(W('New Balance $1.00', 0, 100), W('New Balance $2,500.00', 0, 300), W('New Balance $2,500.00', 0, 500));
  ok('a value read the same way twice beats a misread one', R.read([page]).balance === 2500);
}
{
  // USAA statement (2026-11-21): "New Balance Transfers +$0.00" was read as the
  // balance, "Regular Purchases (v) 29.65%" was missed, and the title bar's
  // "American Express" beat the lender, USAA, printed all over the page.
  const W = (t, x, y) => t.split(' ').map((s, i) => ({ x: x + i * 90, y, w: 80, h: 20, t: s }));
  const page = [].concat(W('USAA American Express Card', 0, 50), W('New Balance $2,374.10', 0, 100), W('New Balance Transfers + $0.00', 0, 150),
    W('Fees Charged + $0.00', 0, 200), W('USAA Credit Card Payments', 0, 250), W('Credit Limit $15,000.00', 0, 300),
    W('Regular Purchases (v) 29.65% $0.00 $0.00', 0, 350), W('Regular Cash Advances (v) 29.65% $2,188.35 $54.07', 0, 400), W('Visit usaa.com', 0, 450));
  const f = R.read([page]);
  ok('a longer line that starts with a label is not that label', f.balance === 2374.1, 'balance ' + f.balance);
  ok('"Regular Purchases" counts as the purchase APR', f.apr === 29.65, 'apr ' + f.apr);
  ok('the lender printed most often wins', f.lender === 'USAA', 'lender ' + f.lender);
}
{
  const html = fs.readFileSync(path.join(ROOT, 'app/scan-test.html'), 'utf8');
  ok('test page: noindex, no analytics, OCR files served from this site',
    /noindex/.test(html) && !/googletagmanager|clarity|gtag\(/.test(html) && /corePath: '\/app\/scan\/ocr\/'/.test(html) && /langPath: '\/app\/scan\/ocr\/'/.test(html));
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  ok('test page is not in the sitemap', !/scan-test/.test(sm));
}

const STATEMENT = `<!doctype html><html><body style="margin:0;font:22px Arial,sans-serif;color:#111;background:#fff;width:1206px">
<div style="padding:40px">
<div style="font-size:34px;font-weight:bold">EXAMPLE BANK</div>
<div style="display:flex;gap:60px;margin-top:40px">
 <table style="width:520px;font-size:22px">
  <tr><td>Previous Balance</td><td align=right>$4,500.00</td></tr>
  <tr><td>Payments and Credits</td><td align=right>-$250.00</td></tr>
  <tr><td>Interest Charged</td><td align=right>$71.09</td></tr>
  <tr><td><b>New Balance</b></td><td align=right><b>$4,321.09</b></td></tr>
  <tr><td>Credit Line</td><td align=right>$8,000</td></tr>
  <tr><td>Credit Line Available</td><td align=right>$3,678</td></tr>
 </table>
 <table style="width:520px;font-size:22px">
  <tr><td>Minimum Payment Due</td><td align=right>$87.00</td></tr>
  <tr><td>Payment Due Date</td><td align=right>12/15/2026</td></tr>
  <tr><td>Statement Closing Date</td><td align=right>11/18/2026</td></tr>
 </table>
</div>
<div style="margin-top:60px;font-weight:bold">Interest Charge Calculation</div>
<table style="width:1100px;font-size:22px;margin-top:10px">
 <tr><td>Type of Balance</td><td>APR</td><td>Expires</td><td>Balance</td></tr>
 <tr><td>Purchases</td><td>22.49% V</td><td>N/A</td><td>$2,321.09</td></tr>
 <tr><td>Promotional APR</td><td>0.00%</td><td>06/30/2027</td><td>$2,000.00</td></tr>
</table>
<div style="margin-top:80px;border-top:2px dashed #999;padding-top:30px">
 <div>New Balance $4,321.09</div><div>Minimum Payment Due $87.00</div><div>Payment Due Date 12/15/2026</div>
</div></div></body></html>`;

(async () => {
  const b = await chromium.launch();
  const tmp = path.join(require('os').tmpdir(), 'df-scan-' + process.pid + '.png');
  {
    const p = await b.newPage({ viewport: { width: 1206, height: 1500 } });
    await p.setContent(STATEMENT);
    await p.screenshot({ path: tmp, fullPage: true });
    await p.close();
  }
  const ctx = await b.newContext({ ...devices['iPhone 14'] });
  const p = await ctx.newPage();
  const off = []; p.on('request', r => { const u = r.url(); if (!u.startsWith(BASE) && !/^(blob|data):/.test(u)) off.push(u); });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/app/scan-test.html');
  await p.setInputFiles('#files', [tmp]);
  await p.waitForSelector('#result:not([hidden])', { timeout: 180000 });
  const rows = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#fields tr')].map(tr => [tr.children[0].textContent, tr.children[1].textContent])));
  const want = { 'Type': 'Credit card', 'Balance': '$4,321.09', 'Minimum / amount due': '$87.00', 'Due date': '2026-12-15', 'APR (purchases)': '22.49%', 'Credit limit': '$8,000.00', 'Promo rate': '0% until 2027-06-30' };
  Object.keys(want).forEach(k => ok('made-up statement: ' + k, rows[k] === want[k], 'got ' + rows[k]));
  // The statement date is printed once and the OCR sometimes misreads it: it
  // may be missing, but it must never be wrong.
  ok('made-up statement: Statement date right or left blank, never wrong', rows['Statement date'] === '2026-11-18' || /not found/.test(rows['Statement date']), 'got ' + rows['Statement date']);
  ok('no request leaves the site, no page errors', !off.length && !errs.length, JSON.stringify({ off, errs }));
  // copied results never carry the numbers
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await p.click('#fields tr:first-child button[data-ok="1"]');
  await p.click('#copy'); await p.waitForTimeout(300);
  const copied = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('Copy results holds marks, not amounts or dates', copied && /Statement scan test/.test(copied) && !/4,321|87\.00|2026-12-15|22\.49/.test(copied), copied);
  fs.unlinkSync(tmp);
  await b.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})();
