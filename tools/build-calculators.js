#!/usr/bin/env node
/* build-calculators.js — generates /calculators/ (hub + one page per calculator)
 *
 *   node tools/build-calculators.js
 *
 * Page copy lives in calculators/content/<slug>.json. Calculator behaviour and
 * starting numbers live in PAGES below. Shared CSS/JS is in calculators/assets/.
 * The engine (calculators/assets/engine.js) is generated separately by
 * tools/make-calc-engine.js from the dashboard so the math can never drift.
 * The asset version query string busts the service worker's cache-first
 * handling of non-HTML files on every release.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'calculators', 'content');
const OUTDIR = path.join(ROOT, 'calculators');
const SITE = 'https://mydebtdashboard.com';
const APP_VERSION = (fs.readFileSync(path.join(ROOT, 'app', 'dashboard.html'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

// ── starting numbers ─────────────────────────────────────────
const MIX = [
  { name: 'Rewards card', type: 'cc', balance: 6800, apr: 24.99, min: 204 },
  { name: 'Everyday card', type: 'cc', balance: 2300, apr: 21.49, min: 69 },
  { name: 'Store card', type: 'cc', balance: 900, apr: 29.99, min: 35 },
  { name: 'Car loan', type: 'auto', balance: 14500, apr: 7.9, min: 395 },
  { name: 'Personal loan', type: 'personal', balance: 5200, apr: 12.5, min: 175 }
];
const MIX_PROMO = [
  { name: 'Rewards card', type: 'cc', balance: 6800, apr: 24.99, min: 204 },
  { name: 'Transfer card', type: 'cc', balance: 4000, apr: 0, min: 120, hasPromo: true, promoApr: 0, promoMonths: 8, postApr: 26.99 },
  { name: 'Store card', type: 'cc', balance: 900, apr: 29.99, min: 35 },
  { name: 'Car loan', type: 'auto', balance: 14500, apr: 7.9, min: 395 },
  { name: 'Personal loan', type: 'personal', balance: 5200, apr: 12.5, min: 175 }
];
const CARDS = [
  { name: 'Rewards card', type: 'cc', balance: 7400, apr: 26.24, min: 222 },
  { name: 'Everyday card', type: 'cc', balance: 3100, apr: 22.99, min: 93 },
  { name: 'Store card', type: 'cc', balance: 1150, apr: 29.99, min: 40 },
  { name: 'Gas card', type: 'cc', balance: 640, apr: 27.49, min: 25 }
];
const STUDENT = [
  { name: 'Undergrad loan A', type: 'student', balance: 8200, apr: 4.99, min: 87 },
  { name: 'Undergrad loan B', type: 'student', balance: 5500, apr: 3.73, min: 55 },
  { name: 'Grad loan', type: 'student', balance: 18400, apr: 7.05, min: 214 },
  { name: 'Private loan', type: 'student', balance: 9700, apr: 9.25, min: 124 }
];

// ── page definitions ─────────────────────────────────────────
// group: hub section. short: hub card text.
const PAGES = [
  { slug: 'debt-payoff-calculator', group: 'plan', short: 'Every debt, every strategy, one debt-free date.', widget: 'multi', mode: 'compare', debts: MIX_PROMO, allowPromo: true, extra: 250, strategySelect: true },
  { slug: 'debt-snowball-calculator', group: 'plan', short: 'Smallest balance first, with the rollover shown month by month.', widget: 'multi', mode: 'snowball', strategy: 'snowball', debts: MIX, extra: 250 },
  { slug: 'debt-avalanche-calculator', group: 'plan', short: 'Highest rate first, including 0% promos that end.', widget: 'multi', mode: 'avalanche', strategy: 'avalanche', debts: MIX_PROMO, allowPromo: true, extra: 250 },
  { slug: 'snowball-vs-avalanche-calculator', group: 'plan', short: 'Both methods side by side on your numbers.', widget: 'multi', mode: 'versus', debts: MIX, allowPromo: true, extra: 250 },
  { slug: 'which-debt-to-pay-off-first', group: 'plan', short: 'Ranks the payoff orders by what they cost you.', widget: 'multi', mode: 'order', strategy: 'avalanche', debts: MIX_PROMO, allowPromo: true, extra: 250 },
  { slug: 'debt-free-date-calculator', group: 'date', short: 'The month and year your last debt is gone.', widget: 'multi', mode: 'date', debts: MIX, allowPromo: true, extra: 200, strategySelect: true },
  { slug: 'pay-off-debt-by-date-calculator', group: 'date', short: 'Pick a date. See the monthly amount it takes.', widget: 'multi', mode: 'target', debts: MIX, allowPromo: true, extra: 0, strategySelect: true, targetMonths: 36 },
  { slug: 'extra-payment-calculator', group: 'date', short: 'What $50, $100 or $500 more a month changes.', widget: 'multi', mode: 'extra', debts: MIX, allowPromo: true, extra: 150, strategySelect: true },
  { slug: 'credit-card-payoff-calculator', group: 'cards', short: 'One card: payoff date, interest, or the payment it takes.', widget: 'single', mode: 'cc', defaultType: 'cc', debtName: 'Credit card', fields: { balance: 5000, apr: 22.99, payment: 175, months: 24, extra: 0 }, solveToggle: true },
  { slug: 'multiple-credit-card-payoff-calculator', group: 'cards', short: 'Several cards, one plan, freed minimums rolling forward.', widget: 'multi', mode: 'compare', defaultType: 'cc', debts: CARDS, allowPromo: true, extra: 200, strategySelect: true },
  { slug: 'minimum-payment-calculator', group: 'cards', short: 'How long minimum payments really take.', widget: 'minpay', fields: { balance: 6000, apr: 24.99, minPct: 1, minFloor: 25 } },
  { slug: 'credit-card-interest-calculator', group: 'cards', short: 'Interest per day, per month and until it is paid off.', widget: 'interest', fields: { balance: 4500, apr: 22.99, payment: 150 } },
  { slug: 'holiday-debt-payoff-calculator', group: 'cards', short: 'Clear the holiday balance by spring — what it takes.', widget: 'single', mode: 'holiday', defaultType: 'cc', debtName: 'Holiday spending', fields: { balance: 1500, apr: 24.99, payment: 150, months: 4, extra: 0 }, solveToggle: true, solveDefault: true },
  { slug: 'balance-transfer-calculator', group: 'promo', short: 'Fee, promo length and what is left when 0% ends.', widget: 'transfer', fields: { balance: 6000, apr: 24.99, fee: 4, promoApr: 0, promoMonths: 18, postApr: 24.99, payment: 300 } },
  { slug: 'deferred-interest-calculator', group: 'promo', short: '"No interest if paid in full" — the payment that clears it.', widget: 'deferred', fields: { balance: 2400, apr: 26.99, promoMonths: 12, payment: 180 } },
  { slug: 'car-loan-payoff-calculator', group: 'loans', short: 'Pay off a car loan early: months and interest saved.', widget: 'single', mode: 'loan', defaultType: 'auto', debtName: 'Car loan', fields: { balance: 18500, apr: 7.49, payment: 455, extra: 100, lump: 0 }, lump: true },
  { slug: 'student-loan-payoff-calculator', group: 'loans', short: 'Several loans at different rates, one payoff plan.', widget: 'multi', mode: 'compare', defaultType: 'student', debts: STUDENT, extra: 150, strategySelect: true },
  { slug: 'personal-loan-payoff-calculator', group: 'loans', short: 'Extra or one-time payments on a fixed-rate loan.', widget: 'single', mode: 'loan', defaultType: 'personal', debtName: 'Personal loan', fields: { balance: 12000, apr: 13.9, payment: 410, extra: 75, lump: 0 }, lump: true },
  { slug: 'lump-sum-debt-calculator', group: 'decide', short: 'Where a tax refund or bonus saves the most.', widget: 'multi', mode: 'lump', debts: MIX, allowPromo: true, extra: 200, strategySelect: true, lumpAmt: 3000 },
  { slug: 'debt-consolidation-calculator', group: 'decide', short: 'Current debts vs one loan, fees included.', widget: 'consolidate', debts: CARDS.slice(0, 3), extra: 0, fields: { loanApr: 11.99, loanTerm: 48, loanFee: 5 } },
  { slug: 'debt-to-income-ratio-calculator', group: 'decide', short: 'Your DTI, and how it moves as debts are paid off.', widget: 'dti', fields: { income: 6500 },
    dtiFields: [
      { id: 'd-housing', label: 'Rent or mortgage', housing: true, v: 1650 },
      { id: 'd-car', label: 'Car payment', v: 455 },
      { id: 'd-student', label: 'Student loans', v: 310 },
      { id: 'd-cards', label: 'Credit card minimums', v: 260 },
      { id: 'd-personal', label: 'Personal loans', v: 0 },
      { id: 'd-other', label: 'Other debt payments', v: 0 }
    ] }
];
const GROUPS = [
  { id: 'plan', title: 'Pick a payoff plan' },
  { id: 'date', title: 'When will I be debt-free?' },
  { id: 'cards', title: 'Credit cards' },
  { id: 'promo', title: '0% offers and promos' },
  { id: 'loans', title: 'Loans' },
  { id: 'decide', title: 'Big money decisions' }
];

// ── helpers ──────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => (n === '' || n == null) ? '' : String(n);
function field(id, label, value, opts = {}) {
  const pre = opts.prefix ? '<div class="affix">' + opts.prefix : (opts.suffix ? '<div class="affix suffix">' : '');
  const post = opts.prefix ? '</div>' : (opts.suffix ? opts.suffix + '</div>' : '');
  return `<div class="f"${opts.wrapId ? ` id="${opts.wrapId}"` : ''}${opts.hidden ? ' hidden' : ''}><label for="${id}">${label}</label>${pre}<input id="${id}" type="text" inputmode="${opts.numeric ? 'numeric' : 'decimal'}" value="${esc(fmt(value))}"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>${post}${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}</div>`;
}
const money = (id, l, v, o = {}) => field(id, l, v, Object.assign({ prefix: '$' }, o));
const pct = (id, l, v, o = {}) => field(id, l, v, Object.assign({ suffix: '%' }, o));
function strategySelect(p) {
  if (!p.strategySelect) return '';
  const cur = p.strategy || 'avalanche';
  const o = (v, t) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  return `<div class="f"><label for="strategy">Strategy</label><select id="strategy">${o('avalanche', 'Avalanche — highest rate first')}${o('snowball', 'Snowball — smallest balance first')}${o('hybrid', 'Your order — top of the list first')}</select></div>`;
}

function calcInputs(p) {
  const f = p.fields || {};
  switch (p.widget) {
    case 'multi':
    case 'consolidate': {
      let h = `<div class="debt-head"><h2 class="ct">${p.widget === 'consolidate' ? 'Debts you would combine' : 'Your debts'}</h2><span class="sub muted sm">Minimum blank = estimated</span></div><div id="debt-rows"></div><button type="button" class="btn-add" id="add-debt">+ Add a debt</button><div class="opts">`;
      if (p.widget === 'consolidate') {
        h += pct('loan-apr', 'Loan APR', f.loanApr) + field('loan-term', 'Loan term (months)', f.loanTerm, { numeric: true }) + pct('loan-fee', 'Origination fee', f.loanFee, { hint: '0 if none' }) + money('extra', 'Extra per month on current debts', p.extra, { hint: 'optional' });
      } else {
        if (p.mode === 'target') h += '<input type="hidden" id="extra" value="0">' + field('target-months', 'Debt-free in how many months?', p.targetMonths, { numeric: true, hint: 'From this month' });
        else h += money('extra', 'Extra per month, on top of minimums', p.extra, { hint: 'Can be $0' });
        if (p.mode === 'lump') h += money('lump', 'One-time amount', p.lumpAmt, { hint: 'Tax refund, bonus, any windfall' });
        h += strategySelect(p);
      }
      return h + '</div>';
    }
    case 'single': {
      let h = '<div class="fields">' + money('balance', p.mode === 'holiday' ? 'Holiday balance' : 'Balance owed', f.balance) + pct('apr', 'APR', f.apr) +
        money('payment', 'Monthly payment', f.payment, { wrapId: 'f-payment', hidden: !!p.solveDefault }) +
        (p.solveToggle ? field('months', 'Pay it off in (months)', f.months, { numeric: true, wrapId: 'f-months', hidden: !p.solveDefault }) : '') +
        money('extra', 'Extra per month', f.extra, { hint: 'optional' }) +
        (p.lump ? money('lump', 'One-time payment today', f.lump, { hint: 'optional' }) : '') + '</div>';
      if (p.solveToggle) h += `<div class="opts"><label class="chk"><input type="checkbox" id="solve-months"${p.solveDefault ? ' checked' : ''}> Work out the payment from a number of months instead</label></div>`;
      return h;
    }
    case 'minpay':
      return '<div class="fields">' + money('balance', 'Card balance', f.balance) + pct('apr', 'APR', f.apr) +
        pct('min-pct', 'Minimum: % of balance', f.minPct, { hint: 'plus that month’s interest' }) + money('min-floor', 'Minimum floor', f.minFloor, { hint: 'smallest minimum the card allows' }) + '</div>';
    case 'interest':
      return '<div class="fields">' + money('balance', 'Card balance', f.balance) + pct('apr', 'APR', f.apr) + money('payment', 'Monthly payment', f.payment, { hint: 'optional' }) + '</div>';
    case 'transfer':
      return '<div class="fields">' + money('balance', 'Balance to move', f.balance) + pct('apr', 'Current card APR', f.apr) + pct('fee', 'Transfer fee', f.fee) +
        pct('promo-apr', 'Promo APR', f.promoApr) + field('promo-months', 'Promo length (months)', f.promoMonths, { numeric: true }) + pct('post-apr', 'APR after the promo', f.postApr) +
        money('payment', 'Monthly payment', f.payment, { hint: 'same on both cards' }) + '</div>';
    case 'deferred':
      return '<div class="fields">' + money('balance', 'Purchase amount', f.balance) + pct('apr', 'Standard APR', f.apr, { hint: 'the rate on the agreement' }) +
        field('promo-months', 'Promo length (months)', f.promoMonths, { numeric: true }) + money('payment', 'Monthly payment', f.payment) + '</div>';
    case 'dti':
      return '<div class="fields">' + money('income', 'Gross monthly income', f.income, { hint: 'before taxes' }) + '</div><h2 class="ct" style="margin-top:16px">Monthly debt payments</h2><div class="fields">' +
        p.dtiFields.map(d => money(d.id, d.label, d.v)).join('') + '</div>';
  }
  throw new Error('unknown widget ' + p.widget);
}

function config(p) {
  const c = { slug: p.slug, widget: p.widget, mode: p.mode || null, strategy: p.strategy || 'avalanche', allowPromo: !!p.allowPromo, defaultType: p.defaultType || 'cc', debtName: p.debtName || null };
  if (p.debts) c.debts = p.debts;
  if (p.dtiFields) c.dtiFields = p.dtiFields.map(d => ({ id: d.id, label: d.label, housing: !!d.housing }));
  return JSON.stringify(c).replace(/</g, '\\u003c');
}

const GA = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-NCP56TD9BG"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  var _dfInternal = false;
  try {
    if (/[?&]internal=1(&|$)/.test(location.search)) localStorage.setItem('debtfree_internal', '1');
    if (/[?&]internal=0(&|$)/.test(location.search)) localStorage.removeItem('debtfree_internal');
    _dfInternal = localStorage.getItem('debtfree_internal') === '1';
  } catch (e) {}
  gtag('config', 'G-NCP56TD9BG', _dfInternal ? { traffic_type: 'internal' } : {});
</script>`;

function head({ title, desc, url, jsonld }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/assets/logo/debtfree-mark-transparent.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">
<meta property="og:type" content="website">
<meta property="og:site_name" content="DebtFree Dashboard">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/calculators/assets/calc.css?v=${APP_VERSION}">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
${GA}
</head>`;
}
const NAV = `<nav class="nav"><a href="/" class="nav-brand" aria-label="DebtFree Dashboard home"><img src="/assets/logo/debtfree-logo-horizontal-light.svg" alt="DebtFree Dashboard" width="150" height="32" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="fb" style="display:none">DebtFree Dashboard</span></a><div class="nav-links"><a class="txt" href="/calculators/">All calculators</a><a class="nav-cta" href="/app/dashboard.html" data-cta="nav">Open the free dashboard</a></div></nav>`;
const FOOTER = `<footer class="site"><a href="/">Home</a><a href="/calculators/">Calculators</a><a href="/app/dashboard.html">Dashboard</a><a href="/privacy.html">Privacy</a><div style="margin-top:10px">&copy; 2026 DebtFree Dashboard</div></footer>`;
const DISCLAIMER = `<p class="disclaimer">Estimates for illustration. The calculations assume interest is charged monthly at APR &divide; 12, payments are made on time, and no new charges are added; your lender’s figures may differ. These pages describe what the math shows and are not financial advice.</p>`;
const FOUNDER = `<aside class="founder"><div class="av" aria-hidden="true">K</div><div><h2>Why I built this</h2><p>I’m Kevin. About a year ago I sat down with my own credit card balances and couldn’t get a straight answer to one question: when does this actually end? Most tools I found wanted an account or a bank login. So I built the one I wanted &mdash; the same math running on this page &mdash; and I use it on my own debt every month.</p><p class="sig">&mdash; Kevin, founder of DebtFree Dashboard</p></div></aside>`;
function CTA() {
  return `<section class="cta"><div><h2>A calculator is a snapshot. Your plan keeps moving.</h2><p>The free dashboard keeps your debt-free date current as you pay &mdash; and it picks up right where this page leaves off.</p><a href="/app/dashboard.html" class="btn-primary" data-handoff>Open the free dashboard &rarr;</a><p class="fine">Your numbers go from this page into the dashboard on this device. Nothing is sent to a server.</p></div><ul>
<li>Your debt-free date updates every time you log a payment</li>
<li>Snowball, Avalanche, your own order &mdash; plus Optimized, which finds the cheapest order</li>
<li>0% promo rates that switch automatically when they end</li>
<li>What-If slider: see what extra money does, instantly</li>
<li>No account, no bank login &mdash; your data stays on your device</li>
<li>Free with unlimited debts. Premium is a one-time $24.</li></ul></section>`;
}

function page(p, c, all) {
  const url = `${SITE}/calculators/${p.slug}/`;
  const title = `${c.title} | DebtFree Dashboard`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': url, url, name: c.title, description: c.metaDescription, dateModified: TODAY, isPartOf: { '@type': 'WebSite', name: 'DebtFree Dashboard', url: SITE + '/' } },
      { '@type': 'WebApplication', name: c.title, url, applicationCategory: 'FinanceApplication', operatingSystem: 'Any web browser', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@type': 'Organization', name: 'DebtFree Dashboard', url: SITE + '/' } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Calculators', item: SITE + '/calculators/' },
        { '@type': 'ListItem', position: 3, name: c.title, item: url }] },
      { '@type': 'FAQPage', mainEntity: c.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
    ]
  };
  const related = (c.related || []).filter(s => all[s]).slice(0, 4).map(s => `<a class="card-link" href="/calculators/${s}/"><strong>${esc(all[s].c.title)}</strong><span>${esc(all[s].p.short)}</span></a>`).join('');
  return `${head({ title, desc: c.metaDescription, url, jsonld })}
<body>
${NAV}
<main class="wrap">
<div class="crumbs"><a href="/">Home</a> / <a href="/calculators/">Calculators</a> / ${esc(c.title)}</div>
<header class="hero"><h1>${esc(c.h1)}</h1><p class="lede">${esc(c.lede)}</p><div class="trust"><span>Free</span><span>No sign-up</span><span>Nothing leaves your device</span><span>Same math as the dashboard</span></div></header>
<section class="calc" id="calc" aria-label="Calculator">
${calcInputs(p)}
<div class="results" id="calc-results" aria-live="polite"></div>
<div class="handoff"><a href="/app/dashboard.html" class="btn-primary" data-handoff>Open the free dashboard &rarr;</a><span class="sub">Loads these numbers. No account needed.</span></div>
</section>
<script type="application/json" id="calc-config">${config(p)}</script>
<article class="content">
${c.sections.map(s => `<h2>${esc(s.h2)}</h2>\n${s.html}`).join('\n')}
</article>
${CTA()}
<section class="faq"><h2>Questions people ask</h2>
${c.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
</section>
${FOUNDER}
<section class="related"><h2>Related calculators</h2><div class="card-grid">${related}</div></section>
${DISCLAIMER}
</main>
${FOOTER}
<script src="/calculators/assets/engine.js?v=${APP_VERSION}"></script>
<script src="/calculators/assets/calc.js?v=${APP_VERSION}"></script>
</body>
</html>
`;
}

function hub(all) {
  const url = `${SITE}/calculators/`;
  const title = 'Free Debt Payoff Calculators | DebtFree Dashboard';
  const desc = 'Free debt calculators: snowball, avalanche, credit card payoff, balance transfer, debt-free date and more. Private, no sign-up, same math as the app.';
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': url, url, name: 'Free debt payoff calculators', description: desc, dateModified: TODAY },
    { '@type': 'ItemList', itemListElement: PAGES.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/calculators/${p.slug}/`, name: all[p.slug].c.title })) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Calculators', item: url }] }] };
  return `${head({ title, desc, url, jsonld })}
<body>
${NAV}
<main class="wrap">
<div class="crumbs"><a href="/">Home</a> / Calculators</div>
<header class="hero"><h1>Free debt payoff calculators</h1><p class="lede">Each one answers a single question with your own numbers &mdash; then hands those numbers to the free dashboard if you want to keep going.</p><div class="trust"><span>Free</span><span>No sign-up</span><span>Nothing leaves your device</span><span>Same math as the dashboard</span></div></header>
${GROUPS.map(g => `<section class="hub-group"><h2>${g.title}</h2><div class="card-grid">${PAGES.filter(p => p.group === g.id).map(p => `<a class="card-link" href="/calculators/${p.slug}/"><strong>${esc(all[p.slug].c.title)}</strong><span>${esc(p.short)}</span></a>`).join('')}</div></section>`).join('\n')}
${CTA().replace(/ data-handoff/g, ' data-cta="hub"')}
${FOUNDER}
${DISCLAIMER}
</main>
${FOOTER}
</body>
</html>
`;
}

function build() {
  if (!APP_VERSION) throw new Error('APP_VERSION not found');
  const all = {};
  PAGES.forEach(p => {
    const file = path.join(CONTENT, p.slug + '.json');
    if (!fs.existsSync(file)) {
      if (process.env.PARTIAL) return;
      throw new Error('missing content: ' + file);
    }
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.slug !== p.slug) throw new Error('slug mismatch in ' + file);
    all[p.slug] = { p, c };
  });
  PAGES.filter(p => all[p.slug]).forEach(p => {
    const dir = path.join(OUTDIR, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(p, all[p.slug].c, all));
  });
  fs.writeFileSync(path.join(OUTDIR, 'index.html'), hub(all));
  // sitemap.xml: homepage, app, hub, every calculator. Rewritten whole on every build.
  const urls = [
    { loc: SITE + '/', pri: '1.0', freq: 'monthly' },
    { loc: SITE + '/app/dashboard.html', pri: '0.9', freq: 'weekly' },
    { loc: SITE + '/calculators/', pri: '0.9', freq: 'monthly' }
  ].concat(PAGES.map(p => ({ loc: `${SITE}/calculators/${p.slug}/`, pri: '0.8', freq: 'monthly' })));
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`).join('\n') + '\n</urlset>\n');
  return { pages: PAGES.length, version: APP_VERSION };
}

module.exports = { build, PAGES, GROUPS };
if (require.main === module) {
  const r = build();
  console.log(`built ${r.pages} calculator pages + hub (assets v${r.version})`);
}
