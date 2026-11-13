/* test-example-screen.js — v1.64.0 ways out of the example screen
 *   node tools/test-example-screen.js      (no browser or server needed)
 * Checks: the floating button offers "Start with my numbers" on the example and
 * goes back to Add Debt / Log Payment after; the Coming Up card hides its
 * due-date invite on the example; inside Instagram/Facebook/TikTok the
 * "open in your browser" warning waits for "Start with my numbers" (then
 * "Continue anyway" carries on to the form) or for a first real debt; outside
 * those apps nothing changes; scroll and tab events fire only on the example.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('app/dashboard.html');
const R = []; const ck = (l, ok, d) => { R.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + l + (ok ? '' : '\n      ' + d)); };
const inline = h => [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parses = true; inline(app).forEach((s, i) => { try { new vm.Script(s); } catch (e) { parses = false; console.log('script', i, e.message); } });
ck('all inline scripts parse', parses);
const big = inline(app).find(s => s.includes('function startMyNumbers'));
const grab = name => { const i = big.indexOf('function ' + name + '('); if (i < 0) throw new Error('missing ' + name); let d = 0, j = big.indexOf('{', i); for (; j < big.length; j++) { if (big[j] === '{') d++; else if (big[j] === '}' && --d === 0) break; } return big.slice(i, j + 1); };

const IG_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';

function world(ua, demo) {
  const els = {}, log = [], ev = [];
  const el = id => els[id] || (els[id] = { id, style: {}, textContent: '', innerHTML: '', onclick: null,
    classList: { add() {}, remove() {} }, scrollIntoView() { log.push('scroll:' + id); }, focus() { log.push('focus:' + id); } });
  const ss = {};
  const ctx = {
    navigator: { userAgent: ua }, _storageOK: true, _demoMode: demo,
    debts: demo ? [{ id: -1, balance: 100 }] : [], payments: [], lumpSums: [], extraMonthly: 0,
    sessionStorage: { getItem: k => ss[k] || null, setItem: (k, v) => { ss[k] = v; } },
    localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: el, querySelector: () => null, body: { classList: { add() {}, remove() {} } } },
    setTimeout: f => f(), trackShare: (a, p) => ev.push([a, p]),
    guideState: () => ({}), GUIDE_KEY: 'g', selectStrategy() {}, save() {}, render() {},
    showSection: id => log.push('section:' + id), expandCollapse() {},
    openQuickLog() { log.push('quicklog'); }, goAddDebt() { log.push('goadd'); },
    upcomingDues: () => [], debtsMissingDueDay: () => [{ id: -1 }], dueInviteDismissed: () => false,
    escapeHtml: s => s, fmtDec: n => String(n), legacyCopy() {},
    // v1.65.0 — This Month reads these
    currentMonthKey: () => '2026-11', _monthKey: s => String(s || '').slice(0, 7), monthKeyOf: () => '2026-11',
    sanitizeDueDay: v => (v >= 1 && v <= 31 ? v : null), splitDueDays: () => null, fmt: n => '$' + n,
    DUE_SOON_DAYS: 7, localDateStr: () => '2026-11-13', dueRowLabel: () => '', dueDayLabel: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(['var _inAppDeferred = null; var _inAppThenForm = false;',
    grab('detectInAppBrowser'), grab('showDeferredInAppBanner'), grab('initInAppBanner'), grab('dismissInAppBanner'),
    grab('exitDemo'), grab('startMyNumbers'), grab('focusFirstDebtField'), grab('renderUpcoming'), grab('populateDebtSelects'),
    'var LS_DUE_SKIPS = "s", LS_CAL_EXPORT = "c", LS_SWIPE_TIP = "t", _tmTipCounted = false;',
    grab('thisMonthModel'), grab('_tmRing'), grab('_tmFootHtml'), grab('_tmQuietLine'), grab('_tmBindSwipes'),
    grab('_calExportState'), grab('calReminderHash'), grab('_dueSkips'), grab('isDueSkipped'), grab('_pendingAheadFor')].join('\n'), ctx);
  return { ctx, el, log, ev, els };
}

// 1. Floating button
let w = world(SAFARI, true); w.ctx.populateDebtSelects();
const fab = w.el('fab-log');
ck('example: floating button says Start with my numbers', fab.textContent === 'Start with my numbers', fab.textContent);
fab.onclick();
ck('tapping it leaves the example, sends demo_dismissed via fab, opens the form',
  w.ctx._demoMode === false && w.ev.some(e => e[0] === 'demo_dismissed' && e[1].via === 'fab') && w.log.includes('scroll:add-debt-card') && w.log.includes('focus:debt-balance'),
  JSON.stringify([w.ev, w.log]));
w.ctx.populateDebtSelects();
ck('after the example, no debts: floating button is + Add Debt', fab.textContent === '+ Add Debt', fab.textContent);
w.ctx.debts.push({ id: 1, balance: 500, name: 'Visa' }); w.ctx.populateDebtSelects();
ck('with a real debt: floating button is + Log Payment again', fab.textContent === '+ Log Payment', fab.textContent);

// 2. Coming Up invite
w = world(SAFARI, true); w.el('upcoming-card').style.display = ''; w.ctx.renderUpcoming();
ck('example: Coming Up card hidden, no due-date invite', w.el('upcoming-card').style.display === 'none' && !/Add due dates/.test(w.el('upcoming-body').innerHTML), w.el('upcoming-body').innerHTML);
w = world(SAFARI, false); w.ctx.debts = [{ id: 1, balance: 500 }]; w.ctx.renderUpcoming();
ck('real debts without due days: invite still shows', /Add due dates/.test(w.el('tm-foot').innerHTML), w.el('tm-foot').innerHTML);

// 3. In-app warning
w = world(IG_IPHONE, true); w.ctx.initInAppBanner();
ck('Instagram, on the example: warning not shown on arrival', w.el('inapp-banner').style.display !== 'block' && !w.ev.some(e => e[0] === 'inapp_banner_shown'), JSON.stringify(w.ev));
w.ctx.startMyNumbers();
ck('Instagram, Start with my numbers: warning shown and scrolled to, form not yet focused',
  w.el('inapp-banner').style.display === 'block' && w.log.includes('scroll:inapp-banner') && !w.log.includes('focus:debt-balance') && w.ev.some(e => e[0] === 'inapp_banner_shown'),
  JSON.stringify([w.ev, w.log]));
w.ctx.dismissInAppBanner();
ck('Continue anyway: carries on to the form', w.el('inapp-banner').style.display === 'none' && w.log.includes('focus:debt-balance'), JSON.stringify(w.log));

w = world(IG_IPHONE, true); w.ctx.initInAppBanner(); w.ctx.exitDemo(true);
ck('Instagram, first real debt typed into the form: warning shown then', w.el('inapp-banner').style.display === 'block' && !w.log.includes('scroll:inapp-banner'), JSON.stringify(w.log));

w = world(IG_IPHONE, false); w.ctx.initInAppBanner();
ck('Instagram, returning visitor (no example): warning shown on arrival as before', w.el('inapp-banner').style.display === 'block', '');

w = world(SAFARI, true); w.ctx.initInAppBanner(); w.ctx.startMyNumbers();
ck('Safari: no warning, Start with my numbers goes straight to the form',
  w.el('inapp-banner').style.display !== 'block' && w.log.includes('focus:debt-balance') && w.ev.some(e => e[0] === 'demo_dismissed' && e[1].via === 'start_my_numbers'), JSON.stringify([w.ev, w.log]));

w = world(IG_IPHONE, true); w.ss = null; w.ctx.sessionStorage.setItem('debtfree_inapp_dismissed', '1'); w.ctx.initInAppBanner(); w.ctx.startMyNumbers();
ck('Instagram, warning already dismissed this visit: straight to the form', w.log.includes('focus:debt-balance') && w.el('inapp-banner').style.display !== 'block', JSON.stringify(w.log));

// 4. Example-screen events
ck('demo_tab_view sent from showSection only while the example shows',
  /if \(_demoMode && typeof trackShare === 'function'\) trackShare\('demo_tab_view'/.test(app), '');
ck('scroll events: demo_scrolled_half and demo_scrolled_end, only while the example shows',
  /function trackDemoScroll\(\) \{\s*if \(!_demoMode\) return;/.test(app) && /'demo_scrolled_half'/.test(app) && /'demo_scrolled_end'/.test(app), '');
ck('scroll tracking starts after the example is seeded',
  app.indexOf('_shouldSeedDemo()) seedDemo();') < app.indexOf('(function trackDemoScroll()') && app.indexOf('(function trackDemoScroll()') < app.indexOf('\ninitInAppBanner();'), '');
ck('in-app warning check runs after the example is seeded',
  app.indexOf('_shouldSeedDemo()) seedDemo();') < app.indexOf('\ninitInAppBanner();'), '');

// 5. versions agree
const v = (app.match(/APP_VERSION = '([^']*)'/) || [])[1], sw = (read('sw.js').match(/CACHE_NAME = 'debtfree-([^']*)'/) || [])[1], vj = JSON.parse(read('app/version.json')).version;
ck('APP_VERSION, CACHE_NAME and version.json agree (' + v + ')', v === sw && sw === vj && /version: '1\.64\.0'/.test(app), [v, sw, vj].join(' '));
console.log(R.every(Boolean) ? 'ALL PASS' : 'SOME FAILED'); process.exit(R.every(Boolean) ? 0 : 1);
