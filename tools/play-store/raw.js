const { page, OUT } = require('./probe');
const path = require('path');
const HIDE = '#guide-card,#guide-btn,.install-banner,#install-banner{display:none!important}';

const SHOTS = [
  { n: 1, theme: 'light', go: async p => { await p.evaluate(() => { showSection('dashboard'); window.scrollTo(0, 0); }); } },
  { n: 2, theme: 'dark', go: async p => { await p.evaluate(() => { showSection('dashboard'); setTmView('list'); }); await scrollTo(p, '#upcoming-card'); } },
  { n: 3, theme: 'light', go: async p => { await p.evaluate(() => { showSection('strategy'); window.scrollTo(0, 0); }); } },
  { n: 4, theme: 'dark', go: async p => { await p.evaluate(() => { showSection('whatif'); window.scrollTo(0, 0); const s=document.getElementById('wi-extra'); s.value=200; s.dispatchEvent(new Event('input',{bubbles:true})); window.scrollTo(0, 330); }); } },
  { n: 5, theme: 'light', go: async p => { await p.evaluate(() => { showSection('dashboard'); }); await scrollTo(p, '#debt-list-card'); } },
  { n: 6, theme: 'dark', go: async p => { await p.evaluate(() => { showSection('milestones'); window.scrollTo(0, 0); }); } },
  { n: 7, theme: 'light', go: async p => { await p.evaluate(() => { showSection('dashboard'); setTmView('cal'); }); await scrollTo(p, '#upcoming-card'); } },
  { n: 8, theme: 'dark', go: async p => { await p.evaluate(() => { showSection('dashboard'); openCalReminders(); }); } },
];
async function scrollTo(p, sel) {
  await p.evaluate(s => { const e = document.querySelector(s); const y = e.getBoundingClientRect().top + window.scrollY - 64; window.scrollTo(0, y); }, sel);
}
(async () => {
  const only = process.argv.slice(2).map(Number);
  for (const theme of ['light', 'dark']) {
    const todo = SHOTS.filter(s => s.theme === theme && (!only.length || only.includes(s.n)));
    if (!todo.length) continue;
    for (const s of todo) {
      const { browser, p } = await page(theme);
      await p.addStyleTag({ content: HIDE });
      await s.go(p);
      await p.waitForTimeout(1200);
      await p.screenshot({ path: path.join(OUT, `s${s.n}.png`) });
      await browser.close();
      console.log('shot', s.n);
    }
  }
})();
