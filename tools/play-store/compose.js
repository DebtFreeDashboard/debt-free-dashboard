const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const F = '/tmp/fontsrc/node_modules/@fontsource/atkinson-hyperlegible/files';
const font = w => `@font-face{font-family:Atkinson;font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(`${F}/atkinson-hyperlegible-latin-${w}-normal.woff2`).toString('base64')}) format('woff2');}`;
const C = [
  [1, 'light', 'Every debt, *one total*', 'What you owe, what’s paid off and your debt-free date.'],
  [2, 'dark', 'Set up in *under a minute*', 'Add your debts, pick a monthly amount, see your date.'],
  [3, 'light', 'This month *at a glance*', 'Log a payment with one tap or a swipe.'],
  [4, 'dark', 'Autopay *logs itself*', 'Tick autopay and those payments are logged for you.'],
  [5, 'light', 'Pick your *payoff method*', 'Snowball, avalanche or optimized, with your own numbers.'],
  [6, 'dark', 'Try a *what-if*', 'See how an extra $200 a month moves the date.'],
  [7, 'light', 'Each debt *in detail*', 'Credit used, daily interest and payoff date.'],
  [8, 'dark', 'Payment *reminders*', 'Phone notifications or calendar alerts. No bank login.'],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const FINAL = process.env.FINAL || path.join(__dirname, 'final');
  fs.mkdirSync(FINAL, { recursive: true });
  for (const [n, t, h, s] of C) {
    const img = fs.readFileSync(path.join(process.env.RAW || path.join(__dirname, 'raw'), `s${n}.png`)).toString('base64');
    const dark = t === 'dark';
    // Highlighter identity: plain paper or graphite, the key phrase highlighted.
    const head = h.replace(/\*([^*]+)\*/, '<mark>$1</mark>');
    const html = `<style>${font(400)}${font(700)}
      body{margin:0;width:1080px;height:1920px;overflow:hidden;font-family:Atkinson;
        background:${dark ? '#1c1d20' : '#f1f2f0'};
        color:${dark ? '#ededea' : '#1c1e21'};display:flex;flex-direction:column;align-items:center}
      h1{font-weight:700;font-size:78px;line-height:1.1;letter-spacing:-1px;text-align:center;margin:120px 70px 0}
      mark{background:linear-gradient(transparent 10%,#f5d000 10%,#f5d000 92%,transparent 92%);color:#1c1e21;padding:0 10px;border-radius:4px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
      p{font-weight:400;font-size:40px;line-height:1.3;text-align:center;margin:30px 90px 0;color:${dark ? '#a3a6aa' : '#5d6166'}}
      .ph{margin:70px 0 0;flex:0 0 auto;width:700px;height:1400px;border-radius:56px;overflow:hidden;
        border:14px solid ${dark ? '#000000' : '#1c1e21'};box-shadow:0 30px 70px rgba(0,0,0,${dark ? .5 : .18})}
      .ph img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
    </style><h1>${head}</h1><p>${s}</p><div class="ph"><img src="data:image/png;base64,${img}"></div>`;
    await p.setContent(html);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(FINAL, `${String(n).padStart(2, '0')}-${t}.png`) });
  }
  await b.close();
})();
