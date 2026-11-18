const { page, OUT } = require('./probe');
const path = require('path');
const HIDE = '#guide-card,#guide-btn,.install-banner,#install-banner{display:none!important}';

// Nov 17, 2026 set: setup (v1.72) and autopay (v1.71) replace "Count every
// win" and "Due dates on a calendar"; light and dark still alternate.
const SETUP = n => async p => { await p.evaluate(n => { localStorage.removeItem(LS_SETUP_FINISH); _addSessionStartCount = 0; extraMonthly = 0; showSection('dashboard'); setupGo(n);
    if (n === 2) { document.getElementById('ss-amt').value = '300'; ssPreview(); }
    if (n === 3) document.querySelectorAll('#ss-due input[data-ap]').forEach((c, i) => { c.checked = i % 2 === 0; }); }, n);
  await p.waitForTimeout(700); await scrollTo(p, '#add-debt-card', 76); };
const SHOTS = [
  { n: 1, theme: 'light', go: async p => { await p.evaluate(() => { showSection('dashboard'); window.scrollTo(0, 0); }); } },
  { n: 2, theme: 'dark', go: SETUP(2) },
  { n: 3, theme: 'light', go: async p => { await p.evaluate(() => { showSection('dashboard'); setTmView('list'); }); await scrollTo(p, '#upcoming-card'); } },
  { n: 4, theme: 'dark', go: SETUP(3) },
  { n: 5, theme: 'light', go: async p => { await p.evaluate(() => { showSection('strategy'); window.scrollTo(0, 0); }); } },
  { n: 6, theme: 'dark', go: async p => { await p.evaluate(() => { showSection('whatif'); window.scrollTo(0, 0); const s=document.getElementById('wi-extra'); s.value=200; s.dispatchEvent(new Event('input',{bubbles:true})); window.scrollTo(0, 330); }); } },
  { n: 7, theme: 'light', go: async p => { await p.evaluate(() => { showSection('dashboard'); }); await scrollTo(p, '#debt-list-card'); } },
  { n: 8, theme: 'dark', go: async p => { await p.evaluate(() => { showSection('dashboard'); openCalReminders(); }); } },
];
async function scrollTo(p, sel, off) {
  await p.evaluate(([s, o]) => { const e = document.querySelector(s); const y = e.getBoundingClientRect().top + window.scrollY - (o || 64); window.scrollTo(0, y); }, [sel, off]);
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
