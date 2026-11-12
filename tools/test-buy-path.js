/* test-buy-path.js — v1.57.0 Play badge for Android browsers + in-app click events
 *   node tools/test-buy-path.js            (no browser or server needed)
 * Checks: every inline script in the app and install page still parses; the
 * is-android / play-build classes come out right for Android Chrome, iPhone and
 * the Play app; the CSS hides the badge everywhere but Android browsers; the
 * app's Gumroad buttons send gumroad_click (plus the old buy_clicked); a tap on
 * the app's Play badge sends play_badge_click with its location.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('app/dashboard.html'), inst = read('app/index.html');
const R = []; const ck = (l, ok, d) => { R.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + l + (ok ? '' : '\n      ' + d)); };
const inline = h => [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
for (const [name, h] of [['app', app], ['install page', inst]]) {
  let ok = true; inline(h).forEach((s, i) => { try { new vm.Script(s); } catch (e) { ok = false; console.log(name, 'script', i, e.message); } });
  ck(name + ': all inline scripts parse', ok);
}
// 1. head script: which classes land on <html>
const head = inline(app).find(s => s.includes('var IS_PLAY_BUILD'));
function classesFor(ua, search, ref) {
  const cls = new Set(); const ss = {};
  const ctx = { location: { search }, navigator: { userAgent: ua }, document: { referrer: ref || '', documentElement: { classList: { add: c => cls.add(c) } } },
    sessionStorage: { getItem: k => ss[k] || null, setItem: (k, v) => { ss[k] = v; } } };
  vm.createContext(ctx); vm.runInContext(head, ctx); return cls;
}
const CHROME_A = 'Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
let c = classesFor(CHROME_A, '');
ck('Android browser: is-android, not play-build', c.has('is-android') && !c.has('play-build'), [...c]);
c = classesFor(IPHONE, '');
ck('iPhone: neither class', !c.has('is-android') && !c.has('play-build'), [...c]);
c = classesFor(CHROME_A, '?source=twa');
ck('Play app: play-build set (badge rule excludes it)', c.has('play-build'), [...c]);
// 2. CSS + markup
ck('badge hidden by default, shown only for html.is-android:not(.play-build)',
  /\.android-web-only \{ display: none !important; \}/.test(app) && /html\.is-android:not\(\.play-build\) \.android-web-only \{ display: inline-flex !important; \}/.test(app), '');
const badge = (app.match(/<a class="demo-banner-play[^>]*>/) || [''])[0];
ck('example-screen badge: android-web-only, location app_demo, Play referrer tagged',
  badge.includes('android-web-only') && badge.includes('data-play-badge="app_demo"') && badge.includes('utm_campaign%3Dapp_demo') && !/gumroad/i.test(badge), badge);
// 3. trackBuyClick + trackPlayBadges
const big = inline(app).find(s => s.includes('function trackBuyClick'));
const grab = name => { const i = big.indexOf('function ' + name + '('); let d = 0, j = big.indexOf('{', i); for (; j < big.length; j++) { if (big[j] === '{') d++; else if (big[j] === '}' && --d === 0) break; } return big.slice(i, j + 1); };
const ev = []; let clickHandler = null;
const ctx = { debts: [{}], isPremium: false, window: { location: { pathname: '/app/dashboard.html' } },
  storedAttribution: () => ({ source: 'tiktok' }), trackShare: (a, p) => ev.push([a, p]),
  document: { addEventListener: (t, f) => { if (t === 'click') clickHandler = f; } } };
vm.createContext(ctx); vm.runInContext(grab('trackBuyClick') + grab('trackPlayBadges') + ';this.b=trackBuyClick;this.p=trackPlayBadges;', ctx);
ctx.b('settings');
const g = ev.find(e => e[0] === 'gumroad_click'), b = ev.find(e => e[0] === 'buy_clicked');
ck('Gumroad button sends gumroad_click (location app_settings) and still buy_clicked',
  g && g[1].location === 'app_settings' && g[1].page_path === '/app/dashboard.html' && b && b[1].placement === 'settings', JSON.stringify(ev));
ev.length = 0; ctx.p();
const target = { closest: s => s === '[data-play-badge]' ? { getAttribute: () => 'app_demo' } : null };
clickHandler({ target });
ck('Play badge tap sends play_badge_click location app_demo', ev.length === 1 && ev[0][0] === 'play_badge_click' && ev[0][1].location === 'app_demo', JSON.stringify(ev));
ev.length = 0; clickHandler({ target: { closest: () => null } });
ck('other taps send nothing', ev.length === 0, JSON.stringify(ev));
ck('trackPlayBadges is started at boot', /stampGumroadLinks\(\);\s*\ntrackPlayBadges\(\);/.test(app), '');
// 4. install page
ck('install page: Play badge in the Android panel, hidden in the Play app, tracked',
  /id="panel-android">[\s\S]{0,400}id="install-play-badge"/.test(inst) && /debtfree_play'\) === '1'[\s\S]{0,120}install-play-badge/.test(inst) && /'play_badge_click'[\s\S]{0,80}install_page/.test(inst), '');
// 5. versions agree
const v = (app.match(/APP_VERSION = '([^']*)'/) || [])[1], sw = (read('sw.js').match(/CACHE_NAME = 'debtfree-([^']*)'/) || [])[1], vj = JSON.parse(read('app/version.json')).version;
ck('APP_VERSION, CACHE_NAME and version.json agree (' + v + ')', v === sw && sw === vj, [v, sw, vj].join(' '));
console.log(R.every(Boolean) ? 'ALL PASS' : 'SOME FAILED'); process.exit(R.every(Boolean) ? 0 : 1);
