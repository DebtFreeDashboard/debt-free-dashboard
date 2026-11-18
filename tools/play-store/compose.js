const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const F = '/tmp/fontsrc/node_modules/@fontsource/sora/files';
const font = w => `@font-face{font-family:Sora;font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(`${F}/sora-latin-${w}-normal.woff2`).toString('base64')}) format('woff2');}`;
const C = [
  [1, 'light', 'Every debt, one total', 'What you owe, what’s paid off and your debt-free date.'],
  [2, 'dark', 'Set up in under a minute', 'Add your debts, pick a monthly amount, see your date.'],
  [3, 'light', 'This month at a glance', 'Log a payment with one tap or a swipe.'],
  [4, 'dark', 'Autopay logs itself', 'Tick autopay and those payments are logged for you.'],
  [5, 'light', 'Pick your payoff method', 'Snowball, avalanche or optimized, with your own numbers.'],
  [6, 'dark', 'Try a what-if', 'See how an extra $200 a month moves the date.'],
  [7, 'light', 'Each debt in detail', 'Credit used, daily interest and payoff date.'],
  [8, 'dark', 'Payment reminders', 'Phone notifications or calendar alerts. No bank login.'],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const FINAL = process.env.FINAL || path.join(__dirname, 'final');
  fs.mkdirSync(FINAL, { recursive: true });
  for (const [n, t, h, s] of C) {
    const img = fs.readFileSync(path.join(process.env.RAW || path.join(__dirname, 'raw'), `s${n}.png`)).toString('base64');
    const dark = t === 'dark';
    const html = `<style>${font(400)}${font(800)}
      body{margin:0;width:1080px;height:1920px;overflow:hidden;font-family:Sora;
        background:${dark ? 'radial-gradient(120% 60% at 50% 0%,#12382c 0%,#0b0c10 60%)' : 'radial-gradient(120% 60% at 50% 0%,#d9f5ea 0%,#f5f6f8 60%)'};
        color:${dark ? '#f2f4f7' : '#14161c'};display:flex;flex-direction:column;align-items:center}
      h1{font-weight:800;font-size:76px;line-height:1.08;letter-spacing:-1.5px;text-align:center;margin:120px 70px 0}
      p{font-weight:400;font-size:40px;line-height:1.3;text-align:center;margin:28px 90px 0;color:${dark ? '#aab1bd' : '#555c68'}}
      .ph{margin:70px 0 0;flex:0 0 auto;width:700px;height:1400px;border-radius:56px;overflow:hidden;
        border:14px solid ${dark ? '#262a33' : '#1b1e25'};box-shadow:0 40px 90px rgba(0,0,0,${dark ? .55 : .25})}
      .ph img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
    </style><h1>${h}</h1><p>${s}</p><div class="ph"><img src="data:image/png;base64,${img}"></div>`;
    await p.setContent(html);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(FINAL, `${String(n).padStart(2, '0')}-${t}.png`) });
  }
  await b.close();
})();
