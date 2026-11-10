/* test-play-note.js — v1.55.3 Premium note in the Google Play app
 *   node tools/test-play-note.js            (no browser or server needed)
 * Runs the Play billing block of app/dashboard.html against stubs and checks
 * what the note says when there is no buy button: Edge or Samsung Internet
 * -> needs Chrome; Chrome without the API -> update Chrome; Play not
 * responding -> says so; never the old "not sold yet" line once billing is live.
 */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'app', 'dashboard.html'), 'utf8');
// 1. every inline script must still parse
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parseOk = true; scripts.forEach((s, i) => { try { new vm.Script(s); } catch (e) { parseOk = false; console.log('parse fail script', i, e.message); } });
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + l + (ok ? '' : '\n      ' + d)); };
ck('all ' + scripts.length + ' inline scripts parse', parseOk);
// 2. pull the Play billing block and run it against stubs
const big = scripts.find(s => s.includes('function _playNoteText'));
const from = big.indexOf('var PLAY_SKU'), to = big.indexOf('function deactivateLicenseLocally');
const block = big.slice(from, to);
function run(ua, mockSvc) {
  const els = {}; const el = id => els[id] || (els[id] = { style: {}, textContent: '' });
  const ev = [];
  const ctx = { IS_PLAY_BUILD: true, isPremium: false, licenseKey: '', debts: [], console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: ua, onLine: true },
    document: { getElementById: el, addEventListener() {}, visibilityState: 'visible' },
    window: { addEventListener() {} }, setTimeout: (f) => f(), Date, Promise, Intl, JSON, Number, String,
    trackOnce: (k, a, p) => ev.push([a, p]), trackShare: (a, p) => ev.push([a, p]),
    save() {}, applyPremiumState() {}, render() {}, fetch: async () => ({ ok: false }) };
  if (mockSvc) ctx.window.getDigitalGoodsService = mockSvc;
  vm.createContext(ctx); vm.runInContext(block + ';this.__init = initPlayBilling; this.__render = renderPlayBuy;', ctx);
  return { ctx, els, ev };
}
const CHROME = 'Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const EDGE = 'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36 EdgA/142.0.0.0';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 15; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const okSvc = async () => ({ getDetails: async () => [{ itemId: 'premium_unlock', price: { currency: 'USD', value: '24.00' } }], listPurchases: async () => [] });
const badSvc = async () => { const e = new Error('Billing service unavailable'); e.name = 'OperationError'; throw e; };
(async () => {
  for (const [label, ua, svc, want, buy] of [
    ['Chrome + working billing: buy button, note hidden', CHROME, okSvc, null, true],
    ['Edge, no billing API: says it needs Chrome', EDGE, null, /needs Chrome, and your phone opened DebtFree in a different browser/, false],
    ['Samsung Internet, no billing API: says it needs Chrome', SAMSUNG, null, /needs Chrome/, false],
    ['Chrome without the API: asks to update Chrome', CHROME, null, /up-to-date Chrome/, false],
    ['Chrome, Play not responding: says Play isn’t responding', CHROME, badSvc, /isn’t responding/, false],
  ]) {
    const t = run(ua, svc); await t.ctx.__init(false);
    const note = t.els['play-note-text'].textContent;
    const shownBuy = t.els['play-buy-wrap'].style.display === '';
    const ok = shownBuy === buy && (want ? want.test(note) && /license key below/.test(note) && !/Checking/.test(note) && !/yet\./.test(note) : true);
    ck(label, ok, JSON.stringify({ note, shownBuy }));
  }
  const t = run(EDGE, null); t.ctx.__render();
  ck('before billing has been checked: says Checking', /Checking Google Play/.test(t.els['play-note-text'].textContent), t.els['play-note-text'].textContent);
  const u = run(EDGE, null); await u.ctx.__init(false);
  ck('Edge still reports play_billing_unavailable once (no_api)', u.ev.filter(e => e[0] === 'play_billing_unavailable').length === 1 && u.ev[0][1].reason === 'no_api', JSON.stringify(u.ev));
  console.log(R.every(Boolean) ? 'ALL PASS' : 'SOME FAILED'); process.exit(R.every(Boolean) ? 0 : 1);
})();
