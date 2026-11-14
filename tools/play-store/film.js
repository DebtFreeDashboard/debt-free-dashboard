// Films the app (Play build, sample data, light theme) as phone-size scenes.
// Each scene -> its own mp4 (same size, 30 fps, same encoder), then concat.
const { page } = require('./probe');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const OUTDIR = '/home/claude/build/video';
fs.mkdirSync(OUTDIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FINGER = `
(() => { if (window.__finger) return;
  const f = document.createElement('div'); window.__finger = f;
  f.style.cssText = 'position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(20,20,30,.22);border:2px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.25);pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .15s, transform .15s;transform:scale(.8)';
  document.documentElement.appendChild(f);
  const at = e => { f.style.left = e.clientX + 'px'; f.style.top = e.clientY + 'px'; };
  addEventListener('pointerdown', e => { at(e); f.style.opacity = 1; f.style.transform = 'scale(1)'; }, true);
  addEventListener('pointermove', at, true);
  addEventListener('pointerup', () => { setTimeout(() => { f.style.opacity = 0; f.style.transform = 'scale(.8)'; }, 120); }, true);
})();`;

async function centre(p, sel) {
  const b = await p.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function tap(p, sel, hold = 120) {
  const c = await centre(p, sel);
  await p.mouse.move(c.x, c.y);
  await p.mouse.down(); await sleep(hold); await p.mouse.up();
}
async function drag(p, from, to, ms) {
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await p.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(16);
  }
  await sleep(80); await p.mouse.up();
}
async function scrollTo(p, y, ms = 900) {
  await p.evaluate(([y, ms]) => new Promise(res => {
    const y0 = scrollY, t0 = performance.now();
    const f = now => { const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      scrollTo(0, y0 + (y - y0) * e); t < 1 ? requestAnimationFrame(f) : res(); };
    requestAnimationFrame(f);
  }), [y, ms]);
}
const yOf = (p, sel, off = 64) => p.evaluate(([s, o]) => document.querySelector(s).getBoundingClientRect().top + scrollY - o, [sel, off]);

// Records CDP screencast frames while fn runs, then encodes one mp4.
async function scene(p, cdp, name, fn) {
  const frames = [];
  const onFrame = async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch (e) {}
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1560, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await fn();
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  const dir = path.join(OUTDIR, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  let list = '';
  frames.forEach((f, i) => {
    const fn = `f${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, fn), Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : t1;
    list += `file '${fn}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  const tmp = path.join(OUTDIR, name + '.tmp.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'scale=780:1560:force_original_aspect_ratio=decrease,pad=780:1560:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, path.join(OUTDIR, name + '.mp4'));
  console.log(name, frames.length, 'frames', (t1 - t0).toFixed(1) + 's');
}

(async () => {
  const { browser, p } = await page('light');
  await p.addStyleTag({ content: '#guide-card,#guide-btn{display:none!important} .tm-swipe-tip{display:none!important}' });
  await p.evaluate(FINGER);
  await p.evaluate(() => { showSection('dashboard'); setTmView('list'); scrollTo(0, 0); });
  await sleep(800);
  const cdp = await p.context().newCDPSession(p);

  await scene(p, cdp, 's1-home', async () => {
    await sleep(1600);
    await scrollTo(p, await yOf(p, '#upcoming-card', 70), 1100);
    await sleep(700);
  });
  await scene(p, cdp, 's2-swipe', async () => {
    const r = await centre(p, '#upcoming-card .tm-swipe:not(.tm-noswipe) .tm-row');
    await sleep(300);
    await drag(p, { x: r.b.x + 40, y: r.y }, { x: r.b.x + 40 + r.b.width * 0.55, y: r.y }, 650);
    await sleep(1800);
  });
  await scene(p, cdp, 's3-paid', async () => {
    await tap(p, '#upcoming-card .tm-batch-btn');
    await sleep(1700);
    await tap(p, '#tm-batch-go');
    await sleep(2200);
    const done = p.getByRole('button', { name: 'Done', exact: true }).filter({ visible: true }).first();
    if (await done.count()) { const b = await done.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await sleep(120); await p.mouse.up(); }
    await sleep(1300);
  });
  await scene(p, cdp, 's4-calendar', async () => {
    await tap(p, '#tmv-cal');
    await sleep(2200);
    await tap(p, '#tmv-list');
    await sleep(400);
  });
  await scene(p, cdp, 's5-strategy', async () => {
    await tap(p, '.bnav-item[data-sec="strategy"]');
    await p.evaluate(() => scrollTo(0, 0));
    await sleep(1100);
    await scrollTo(p, await yOf(p, '#picker-card', 70), 700);
    await tap(p, '#picker-card .card-title');
    await sleep(2400);
  });
  await scene(p, cdp, 's6-whatif', async () => {
    await tap(p, '.bnav-item[data-sec="whatif"]');
    await p.evaluate(() => scrollTo(0, 0));
    await sleep(500);
    await scrollTo(p, await yOf(p, '#wi-extra', 260), 800);
    await sleep(300);
    const s = await centre(p, '#wi-extra');
    const x0 = s.b.x + 14, x1 = s.b.x + 14 + (s.b.width - 28) * (300 / 2000);
    await drag(p, { x: x0, y: s.y }, { x: x1, y: s.y }, 1400);
    await sleep(500);
    await scrollTo(p, (await p.evaluate(() => scrollY)) + 330, 900);
    await sleep(1800);
  });
  await scene(p, cdp, 's7-wins', async () => {
    await tap(p, '.bnav-item[data-sec="milestones"]');
    await p.evaluate(() => scrollTo(0, 0));
    await sleep(2400);
  });
  await scene(p, cdp, 's8-reminders', async () => {
    await tap(p, '.bnav-item[data-sec="dashboard"]');
    await p.evaluate(() => scrollTo(0, document.querySelector('#upcoming-card').getBoundingClientRect().top + scrollY - 70));
    await sleep(700);
    await tap(p, '#upcoming-card .tm-link');
    await sleep(2800);
  });
  await browser.close();
})();
