/* test-first-merge.js — v1.54.8 first-sync notice
 *
 *   python3 -m http.server 8911     (repo root, another shell)
 *   node tools/test-first-merge.js
 *
 * Drive calls are stubbed in the page; the real merge engine runs.
 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8911';
const CHART = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && !ok) console.log('      ' + d); };

const debt = (id, name, bal) => ({ id, name, balance: bal, originalBalance: bal, apr: 20, minPayment: 50, type: 'credit', updatedAt: '2026-01-01T00:00:00.000Z' });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
  async function run({ local, remote, synced }) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.route('**/cdn.jsdelivr.net/npm/chart.js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART }));
    await ctx.route('**/googletagmanager.com/**', r => r.abort()); await ctx.route('**/clarity.ms/**', r => r.abort());
    await ctx.addInitScript(([l, s]) => {
      if (sessionStorage.getItem('__seeded')) return;
      localStorage.setItem('debtfree_last_seen_version', '99.0.0'); localStorage.setItem('debtfree_demo_dismissed', '1');
      localStorage.setItem('debtfree_debts', JSON.stringify(l));
      if (s) localStorage.setItem('debtfree_drive_fileid', 'abc');
      sessionStorage.setItem('__seeded', '1');
    }, [local, synced]);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/app/dashboard.html'); await pg.waitForTimeout(700);
    const uploaded = await pg.evaluate(async (remoteDebts) => {
      let up = null;
      driveFindFileId = () => Promise.resolve(remoteDebts ? 'abc' : null);
      driveFetch = () => Promise.resolve({ json: () => Promise.resolve(Object.assign(buildBackupPayload(), { debts: remoteDebts, payments: [] })) });
      driveUploadPayload = (p) => { up = p; return Promise.resolve(); };
      driveSyncDo(false);
      await new Promise(r => setTimeout(r, 600));
      return up ? up.debts.length : -1;
    }, remote);
    const modal = await pg.evaluate(() => { const m = document.getElementById('drive-merge-modal'); return m ? m.innerText : null; });
    const count = await pg.evaluate(() => debts.length);
    const flag = await pg.evaluate(() => localStorage.getItem('debtfree_drive_merged_once'));
    await ctx.close();
    return { modal, count, uploaded, flag, errs };
  }

  const mine = [debt(1, 'New Visa', 3000)];
  const old = [debt(1, 'New Visa', 3000), debt(7, 'Old Store Card', 900), debt(8, 'Old Car Loan', 12000)];

  let r = await run({ local: mine, remote: old });
  ck('first sync, device has debts, backup brings 2 more: notice lists both', !!r.modal && /Old Store Card/.test(r.modal) && /Old Car Loan/.test(r.modal) && /2 debts/.test(r.modal) && !/New Visa/.test(r.modal), JSON.stringify(r));
  ck('merge itself unchanged: 3 debts on device and uploaded', r.count === 3 && r.uploaded === 3, JSON.stringify(r));
  ck('first-sync flag recorded', r.flag === '1');
  ck('no page errors', !r.errs.length, r.errs.join(' | '));

  r = await run({ local: [], remote: old });
  ck('empty device (a restore): no notice, data comes in', !r.modal && r.count === 3, JSON.stringify(r));

  r = await run({ local: mine, remote: old, synced: true });
  ck('device that has synced before: no notice', !r.modal && r.count === 3, JSON.stringify(r));

  r = await run({ local: mine, remote: [debt(1, 'New Visa', 3000)] });
  ck('backup brings nothing new: no notice', !r.modal, JSON.stringify(r));

  r = await run({ local: mine, remote: null });
  ck('nothing in Drive yet (first backup): no notice, uploads', !r.modal && r.uploaded === 1, JSON.stringify(r));

  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
