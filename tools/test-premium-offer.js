/* test-premium-offer.js — v1.76.0 Premium offer on the dashboard (Play app only)
 *   node tools/test-premium-offer.js            (no browser or server needed)
 * Runs the Play billing block of app/dashboard.html against stubs and checks
 * when the offer shows: Play app, buy button working, not Premium, setup over,
 * real debts, not dismissed. Also: Not now hides it for good, its buy button
 * starts Google's purchase with via=offer, and the card never links Gumroad.
 * The real purchase sheet is a manual test on a phone (Play license tester).
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'app', 'dashboard.html'), 'utf8');
const R = []; const ck = (l, ok, d) => { R.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + l + (ok ? '' : '\n      ' + d)); };
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let parseOk = true; scripts.forEach((s, i) => { try { new vm.Script(s); } catch (e) { parseOk = false; console.log('parse fail script', i, e.message); } });
ck('all ' + scripts.length + ' inline scripts parse', parseOk);

// The card's markup: Play-only, hidden by default, no Gumroad, no hard-coded price.
const card = (html.match(/<div class="card po-offer play-only" id="premium-offer" hidden>[\s\S]*?<div class="po-offer-msg"[^>]*><\/div>\s*<\/div>/) || [''])[0];
ck('card markup found, Play-only and hidden by default', !!card);
ck('card has no Gumroad link and no $ price', card && !/gumroad/i.test(card) && !/\$\d/.test(card), card.slice(0, 200));
ck('card buy button calls buyOnPlay(\'offer\')', /onclick="buyOnPlay\('offer'\)"/.test(card));
ck('render() draws the offer', /renderPremiumOffer\(\);\s+\/\/ v1\.76\.0/.test(html));

const big = scripts.find(s => s.includes('function renderPremiumOffer'));
const block = big.slice(big.indexOf('var PLAY_SKU'), big.indexOf('function deactivateLicenseLocally'));
const okSvc = async () => ({ getDetails: async () => [{ itemId: 'premium_unlock', price: { currency: 'USD', value: '23.99' } }], listPurchases: async () => [] });
const CHROME = 'Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';

function run(o) {
  o = Object.assign({ play: true, premium: false, svc: okSvc, demo: false, inSetup: false, debts: 2, store: {}, buy: 'ok' }, o);
  const els = {}; const el = id => els[id] || (els[id] = { style: {}, textContent: '', hidden: id === 'premium-offer' });
  const ev = []; const toasts = [];
  const store = Object.assign({}, o.store);
  const ctx = { IS_PLAY_BUILD: o.play, isPremium: o.premium, licenseKey: '', debts: Array(o.debts).fill({ balance: 1 }), console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { userAgent: CHROME, onLine: true },
    document: { getElementById: el, addEventListener() {}, visibilityState: 'visible' },
    window: { addEventListener() {} }, setTimeout: (f) => f(), Date, Promise, Intl, JSON, Number, String,
    trackOnce: (k, a, p) => { if (!ev.some(e => e[2] === k)) ev.push([a, p, k]); }, trackShare: (a, p) => ev.push([a, p]),
    save() {}, applyPremiumState() {}, render() { ctx.__renderOffer && ctx.__renderOffer(); }, fetch: async () => ({ ok: true, json: async () => ({ valid: true }) }),
    _demoMode: o.demo, _inFirstSetup: () => o.inSetup, _activePlanDebts: () => Array(o.debts).fill({}), _infoToast: t => toasts.push(t),
    PaymentRequest: function () { this.show = async () => { if (o.buy === 'cancel') throw new Error('cancel'); return { details: { purchaseToken: 'tok' }, complete: async () => {} }; }; } };
  if (o.svc) ctx.window.getDigitalGoodsService = o.svc;
  vm.createContext(ctx);
  vm.runInContext(block + ';this.__init = initPlayBilling; this.__renderOffer = renderPremiumOffer; this.__dismiss = dismissPremiumOffer; this.__buy = buyOnPlay; this.__isPrem = function(){ return isPremium; };', ctx);
  return { ctx, els, ev, store, toasts, shown: () => els['premium-offer'] && els['premium-offer'].hidden === false };
}

(async () => {
  const cases = [
    ['Play app, billing works, setup done, 2 debts: shows', {}, true],
    ['website (not Play app): never shows', { play: false }, false],
    ['already Premium: never shows', { premium: true }, false],
    ['billing not ready (Edge, no API): never shows', { svc: null }, false],
    ['during first setup: never shows (setup and its reminders offer come first)', { inSetup: true }, false],
    ['example screen: never shows', { demo: true }, false],
    ['no real debts yet: never shows', { debts: 0 }, false],
    ['dismissed before: never shows again', { store: { debtfree_play_offer: 'dismissed' } }, false],
  ];
  for (const [label, o, want] of cases) {
    const t = run(o); await t.ctx.__init(false); t.ctx.__renderOffer();
    ck(label, t.shown() === want, JSON.stringify({ shown: t.shown(), ev: t.ev.map(e => e[0]) }));
  }
  // price on the button comes from Google Play, and premium_offer_shown fires once
  const a = run({}); await a.ctx.__init(false); a.ctx.__renderOffer(); a.ctx.__renderOffer(); a.ctx.__renderOffer();
  ck('button shows Play\'s own price', /Unlock Premium — \$23\.99/.test(a.els['premium-offer-buy'].textContent), a.els['premium-offer-buy'].textContent);
  ck('premium_offer_shown fires once per launch, with debt_count', a.ev.filter(e => e[0] === 'premium_offer_shown').length === 1 && a.ev.find(e => e[0] === 'premium_offer_shown')[1].debt_count === 2, JSON.stringify(a.ev));
  ck('no premium_offer_shown when hidden', (() => { const t = run({ inSetup: true }); t.ctx.__renderOffer(); return !t.ev.some(e => e[0] === 'premium_offer_shown'); })());

  // Not now: hides, remembers, says where Premium lives, tracks
  const d = run({}); await d.ctx.__init(false); d.ctx.__renderOffer(); d.ctx.__dismiss('not_now');
  d.ctx.__renderOffer();
  ck('Not now hides it and it stays hidden', !d.shown() && d.store.debtfree_play_offer === 'dismissed');
  ck('Not now tracks premium_offer_dismiss via=not_now', d.ev.some(e => e[0] === 'premium_offer_dismiss' && e[1].via === 'not_now'), JSON.stringify(d.ev));
  ck('Not now says Premium is in Settings', /Settings/.test(d.toasts[0] || ''), d.toasts.join('|'));
  const x = run({}); await x.ctx.__init(false); x.ctx.__dismiss('x');
  ck('× tracks via=x', x.ev.some(e => e[0] === 'premium_offer_dismiss' && e[1].via === 'x'));

  // Buying from the card
  const b = run({}); await b.ctx.__init(false); b.ctx.__renderOffer(); await b.ctx.__buy('offer');
  ck('buy from card: play_purchase_start via=offer', b.ev.some(e => e[0] === 'play_purchase_start' && e[1].via === 'offer'), JSON.stringify(b.ev));
  ck('buy from card: success via=offer, Premium on, card gone', b.ev.some(e => e[0] === 'play_purchase_success' && e[1].via === 'offer') && b.ctx.__isPrem() && !b.shown(), JSON.stringify({ prem: b.ctx.__isPrem(), shown: b.shown() }));
  ck('buy from card: message shows on the card, not in Settings', /Premium unlocked/.test(b.els['play-offer-msg'].textContent) && !(b.els['play-buy-msg'] || {}).textContent);
  const c = run({ buy: 'cancel' }); await c.ctx.__init(false); await c.ctx.__buy('offer');
  ck('cancel from card: play_purchase_cancel via=offer, no Premium', c.ev.some(e => e[0] === 'play_purchase_cancel' && e[1].via === 'offer') && !c.ctx.__isPrem());
  const s = run({}); await s.ctx.__init(false); await s.ctx.__buy();
  ck('Settings button unchanged: via=settings, message in Settings', s.ev.some(e => e[0] === 'play_purchase_start' && e[1].via === 'settings') && /Premium unlocked/.test(s.els['play-buy-msg'].textContent));

  console.log(R.every(Boolean) ? 'ALL PASS' : 'SOME FAILED'); process.exit(R.every(Boolean) ? 0 : 1);
})();
