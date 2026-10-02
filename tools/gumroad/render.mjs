// Renders cover.html -> cover.png (2560x1281; the extra pixel row is fine for Gumroad) and thumbnail.html -> thumbnail.png (1200x1200).
// Run from this folder:  node render.mjs   (needs: npm i playwright, and a Chromium;
// set PW_CHROMIUM to its path if Playwright cannot find one).
import { chromium } from 'playwright';
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [f, w, h, s, o, clip] of [
  ['cover.html', 1005, 503, 2560 / 1005, 'cover.png', null],
  ['thumbnail.html', 600, 600, 2, 'thumbnail.png', null],
]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: s });
  await p.goto(new URL(f, import.meta.url).href);
  await p.screenshot(clip ? { path: o, clip } : { path: o });
  await p.close();
}
await b.close();
