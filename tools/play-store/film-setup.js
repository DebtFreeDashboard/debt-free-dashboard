// Films first setup from an empty app, in real time, for the homepage
// ("A real payoff plan, built in under a minute"). Light theme, Play build,
// no data. A caption bar and a running timer are drawn over the page.
// Output: assets/videos/setup-demo.mp4 (+ -cover.jpg) via ffmpeg, 780x1560.
// Needs the repo root on 8911 and the fonts described in README.md.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FONTS = '/tmp/fontsrc/node_modules/@fontsource';
const CHART = path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js');
const OUTDIR = process.env.OUTDIR || '/home/claude/build/video';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });

const fontCss = [400, 700].map(w => `@font-face{font-family:'Atkinson Hyperlegible';font-weight:${w};font-style:normal;src:url(https://fonts.gstatic.com/local/atk-${w}.woff2) format('woff2');}`).join('\n');

const OVERLAY = `
(() => { if (window.__cap) return;
  const bar = document.createElement('div'); window.__cap = bar;
  bar.style.cssText = 'position:fixed;left:12px;right:12px;top:10px;z-index:2147483646;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px 10px 16px;border-radius:14px;background:#1c1e21;color:#ededea;font:700 15px "Atkinson Hyperlegible",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
  bar.innerHTML = '<span id="__capt"></span><span id="__clock" style="background:#f5d000;color:#1c1e21;border-radius:999px;padding:3px 10px;font-variant-numeric:tabular-nums">0:00</span>';
  document.documentElement.appendChild(bar);
  const f = document.createElement('div'); window.__finger = f;
  f.style.cssText = 'position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(20,20,30,.22);border:2px solid rgba(255,255,255,.85);pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .15s';
  document.documentElement.appendChild(f);
  addEventListener('pointerdown', e => { f.style.left = e.clientX + 'px'; f.style.top = e.clientY + 'px'; f.style.opacity = 1; }, true);
  addEventListener('pointerup', () => setTimeout(() => { f.style.opacity = 0; }, 140), true);
  window.__t0 = Date.now();
  setInterval(() => { const s = Math.floor((Date.now() - window.__t0) / 1000); document.getElementById('__clock').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 200);
})();`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', serviceWorkers: 'block' });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: fontCss, contentType: 'text/css' }));
  await ctx.route('**/fonts.gstatic.com/local/**', r => { const m = r.request().url().match(/atk-(\d+)/); r.fulfill({ path: `${FONTS}/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${m[1]}-normal.woff2`, contentType: 'font/woff2' }); });
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms/, r => r.abort());
  await ctx.addInitScript(() => {
    try { Object.defineProperty(Notification, 'permission', { get: () => 'default' }); } catch (e) {}
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear();
    localStorage.setItem('debtfree_last_seen_version', '99.0.0');
  });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8911/app/dashboard.html?source=twa', { waitUntil: 'networkidle' });
  await sleep(1200);
  await p.addStyleTag({ content: '.sticky-top{padding-top:58px} #guide-card,#guide-btn{display:none!important}' });
  await p.evaluate(OVERLAY);
  const cap = t => p.evaluate(t => { document.getElementById('__capt').textContent = t; }, t);
  const tap = async sel => { const bb = await p.locator(sel).first().boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await sleep(110); await p.mouse.up(); };
  const type = async (sel, text) => { await tap(sel); await p.keyboard.type(text, { delay: 85 }); await sleep(180); };
  const into = async sel => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await p.evaluate(sel => { const e = document.querySelector(sel); scrollTo({ top: e.getBoundingClientRect().top + scrollY - 140, behavior: 'smooth' }); }, sel); await sleep(450); };

  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', async f => { frames.push({ data: f.data, t: f.metadata.timestamp }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {} });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await p.evaluate(() => { window.__t0 = Date.now(); });
  const t0 = Date.now() / 1000;

  await cap('Start with your own numbers'); await sleep(1500);
  await tap('#demo-banner button, .demo-banner button'); await sleep(900);
  await cap('Add your debts');
  const debts = [['Rewards card', '5400', '24.99', ''], ['Car loan', '9800', '6.49', '340'], ['Store card', '1250', '29.99', '']];
  for (let i = 0; i < debts.length; i++) {
    const [n, bal, apr, min] = debts[i];
    await into('#debt-name');
    await type('#debt-name', n); await type('#debt-balance', bal); await type('#debt-apr', apr);
    if (min) await type('#debt-min', min);
    await sleep(250);
    if (i < debts.length - 1) { await into('#add-another-btn'); await tap('#add-another-btn'); await sleep(900); }
  }
  await into('#add-save-btn'); await tap('#add-save-btn'); await sleep(900);
  await cap('Pick a monthly amount');
  await into('#ss-amt'); await sleep(500);
  await tap('[onclick="ssBump(100)"]'); await sleep(900);
  await tap('[onclick="ssBump(100)"]'); await sleep(1600);
  await cap('Debt-free date moves as you tap');
  await into('#ss-date'); await sleep(2200);
  await into('[onclick="setupSaveExtra(); setupGo(3)"]'); await tap('[onclick="setupSaveExtra(); setupGo(3)"]'); await sleep(900);
  await cap('Due days and autopay');
  const dues = await p.locator('#ss-due input[type=text], #ss-due input[inputmode=numeric]').count();
  const days = ['5', '18', '22'];
  for (let i = 0; i < Math.min(dues, 3); i++) { const sel = `#ss-due input[type=text] >> nth=${i}`; await p.locator(sel).scrollIntoViewIfNeeded(); await type(sel, days[i]); }
  const boxes = await p.locator('#ss-due input[type=checkbox]').count();
  if (boxes > 1) { const bx = await p.locator('#ss-due input[type=checkbox]').nth(1).boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.down(); await sleep(110); await p.mouse.up(); }
  await sleep(1800);
  await cap('Your plan');
  await into('[onclick="setupFinish()"]'); await tap('[onclick="setupFinish()"]'); await sleep(1200);
  await p.evaluate(() => { document.querySelectorAll('#celebrate-overlay, .modal-overlay, #due-check-sheet').forEach(e => e.classList && e.classList.add('hidden')); scrollTo({ top: 0, behavior: 'smooth' }); });
  await sleep(3200);
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  console.log('filmed', (t1 - t0).toFixed(1) + 's', frames.length, 'frames');

  const dir = path.join(OUTDIR, 'setup'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let list = '';
  frames.forEach((f, i) => {
    const fn = `f${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, fn), Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : t1;
    list += `file '${fn}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  const out = path.join(OUTDIR, 'setup-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'scale=780:1560:force_original_aspect_ratio=decrease,pad=780:1560:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-q:v', '3', path.join(OUTDIR, 'setup-demo-cover.jpg')]);
  console.log('wrote', out);
  await b.close();
})();
