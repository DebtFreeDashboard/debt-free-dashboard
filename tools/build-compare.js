#!/usr/bin/env node
/* build-compare.js — generates /compare/ (hub + comparison pages for search)
 *
 *   BUILD_DATE=YYYY-MM-DD node tools/build-compare.js
 *
 * Backlog D7 (2026-11-28). People who search "<app> alternative" or "debt payoff
 * app without bank login" are already choosing a tool. These pages answer that
 * with facts only: price, account, bank login, platforms, payoff orders.
 *
 * RULES FOR THIS FILE
 * - Every fact about another product comes from that product's own website or
 *   store listing, and the date it was checked goes in CHECKED. Re-check them
 *   before changing a claim, and when a page is rebuilt months later.
 * - Neutral tool framing (Project_Instructions: Compliance). No "you should",
 *   no advice on what to do with money, nothing that runs another product down.
 *   Say where the other product is stronger, too.
 * - No Gumroad link or price outside a `web-only` element (Play payments policy).
 * Shared header, nav, footer, analytics and CTA come from build-calculators.js,
 * which also lists these pages in sitemap.xml.
 */
const fs = require('fs');
const path = require('path');
const C = require('./build-calculators.js');
const { SITE, APP_VERSION, esc, head, NAV, FOOTER, CTA, FOUNDER } = C;
const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, 'compare');
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const CHECKED = 'November 28, 2026';

// ── facts ────────────────────────────────────────────────────
// Sources, checked 2026-11-28:
//  Undebt.it: undebt.it (home: free, calculator without an account, installable
//    from the browser on iPhone and Android, 8 payoff methods, bank sync via
//    SimpleFIN with Undebt.it+); undebt.it/plus-info.php ($10 a year, 30-day
//    trial, bank sync, YNAB sync); undebt.it/how-undebt.it-works.php (step 1 is
//    "Create a free account", email or Google).
//  Debt Payoff Planner & Tracker (OxbowSoft LLC): Google Play listing
//    com.oxbowsoft.debtplanner (Contains ads, In-app purchases, 500K+ downloads,
//    snowball / avalanche / snowflake / custom, account optional for backup and
//    other devices, payments typed in); App Store listing id1009323715
//    (subscriptions $6.99 a month, $27.99 a year; iPhone and iPad).
const ROWS = [
  // [label, DebtFree, Undebt.it, Debt Payoff Planner]
  ['Price', 'Free. Premium is a one-time $24', 'Free. Undebt.it+ is $10 a year', 'Free with ads. Pro is $6.99 a month or $27.99 a year (App Store)'],
  ['Account', 'None. No sign-up at all', 'Free account (email or Google) to save and track a plan', 'Optional, for a backup and other devices'],
  ['Bank login', 'Never. You type your own numbers', 'Optional bank sync with Undebt.it+', 'None. Payments are typed in'],
  ['Where your data lives', 'On your device. Optional backup to your own Google Drive', 'In your Undebt.it account', 'In the app, and in your account if you make one'],
  ['Phones', 'Android app on Google Play. On iPhone, a Home Screen web app', 'Web app, installable from the browser on iPhone and Android', 'App Store and Google Play apps'],
  ['Computers', 'Any browser', 'Any browser', 'Phone and tablet apps'],
  ['Payoff orders', 'Snowball, avalanche, your own order, and Optimized (tests orders for the lowest total interest)', '8 methods, including snowball, avalanche and custom', 'Snowball, avalanche, custom, plus one-time extra payments'],
  ['Payment tracking', 'One-tap logging, autopay logged for you, due-date reminders', 'Payment manager in your dashboard', 'Type in the amount and date']
];
const NAMES = ['DebtFree', 'Undebt.it', 'Debt Payoff Planner'];

function table(cols) {
  // cols: indexes into NAMES (0 is always DebtFree)
  return `<div class="cmp-wrap" role="region" aria-label="Comparison table" tabindex="0"><table class="cmp"><caption>As listed on each product’s own website or app store page, checked ${CHECKED}. Prices and features change.</caption>
<thead><tr><th scope="col"></th>${cols.map(i => `<th scope="col"${i === 0 ? ' class="us"' : ''}>${esc(NAMES[i])}</th>`).join('')}</tr></thead>
<tbody>${ROWS.map(r => `<tr><th scope="row">${esc(r[0])}</th>${cols.map(i => `<td${i === 0 ? ' class="us"' : ''}>${esc(r[i + 1])}</td>`).join('')}</tr>`).join('\n')}</tbody></table></div>`;
}
const NOTE = `<p class="disclaimer">Undebt.it and Debt Payoff Planner are trademarks of their owners. DebtFree Dashboard is not affiliated with either. Facts about them come from their own websites and app store pages, checked ${CHECKED}; if something has changed, <a href="mailto:debtfreedashboard@gmail.com">tell me</a> and I’ll fix it. These pages describe tools and what their math shows, and are not financial advice.</p>`;

// ── pages ────────────────────────────────────────────────────
const PAGES = [
  {
    slug: '', // the hub, /compare/
    title: 'Debt Payoff Apps Compared: DebtFree, Undebt.it, Debt Payoff Planner',
    h1: 'Debt payoff apps, side by side',
    lede: 'Three popular ways to plan a debt payoff, compared on the things people ask about first: price, sign-up, bank login, where your data lives and which phones they run on.',
    desc: 'DebtFree, Undebt.it and Debt Payoff Planner compared: price, account, bank login, data privacy, phones and payoff methods. Facts from each product’s own pages.',
    cols: [0, 1, 2],
    sections: [
      ['The short version', `<ul>
<li><strong>DebtFree</strong> needs no account and never asks for a bank login. Your numbers stay on your device, the core planner is free, and Premium is one payment of $24.</li>
<li><strong>Undebt.it</strong> is a long-running web planner with eight payoff methods. The core is free with an account; Undebt.it+ adds bank sync and more tools for $10 a year.</li>
<li><strong>Debt Payoff Planner</strong> is a phone app on both stores with a large user base. The free version shows ads; Pro is a subscription.</li></ul>`],
      ['What all three do', '<p>Each one takes your balances, interest rates and minimum payments, adds the extra you can put toward debt each month, and shows a payoff order and a debt-free date. Each one does the debt snowball (smallest balance first) and the debt avalanche (highest rate first), and lets you set your own order. The differences are in price, sign-up, bank access and where your numbers are kept.</p>'],
      ['Where each one is strongest', `<ul>
<li><strong>Undebt.it:</strong> the most payoff methods of the three, a very low yearly price for its paid tier, and optional bank sync for people who want balances to update on their own.</li>
<li><strong>Debt Payoff Planner:</strong> native apps on both the App Store and Google Play, and an optional account that carries a plan across devices.</li>
<li><strong>DebtFree:</strong> nothing to sign up for and no bank login, an Optimized order that tests payoff orders for the lowest total interest, autopay payments logged for you, and a one-time price instead of a subscription.</li></ul>`],
      ['Compare one at a time', `<div class="card-grid">
<a class="card-link" href="/compare/undebt-it-alternative/"><strong>DebtFree vs Undebt.it</strong><span>No account versus an account-based web planner</span></a>
<a class="card-link" href="/compare/debt-payoff-planner-alternative/"><strong>DebtFree vs Debt Payoff Planner</strong><span>One-time price, no ads, versus a subscription</span></a>
<a class="card-link" href="/compare/debt-payoff-app-without-bank-login/"><strong>Debt payoff without a bank login</strong><span>How a plan stays current when you type your own numbers</span></a></div>`]
    ],
    faq: [
      ['Which debt payoff app is free?', 'All three have a free version. DebtFree’s planner, tracking and reminders are free with unlimited debts, and Premium is a one-time $24. Undebt.it’s core planner is free with an account, and Undebt.it+ is $10 a year. Debt Payoff Planner is free with ads, and Pro is a subscription.'],
      ['Which debt payoff apps work without linking a bank account?', 'DebtFree never asks for a bank login. Debt Payoff Planner has you type in payments. Undebt.it works without one, and offers bank sync as an option in its paid tier.'],
      ['Do I need to create an account?', 'Not for DebtFree, which has no accounts at all. Debt Payoff Planner’s account is optional. Undebt.it uses a free account to save and track a plan.'],
      ['Is there a DebtFree app for iPhone?', 'Not in the App Store yet. On iPhone, DebtFree runs in Safari and can be added to the Home Screen, where it opens like an app and works offline. On Android it is on Google Play.']
    ]
  },
  {
    slug: 'undebt-it-alternative',
    title: 'Undebt.it Alternative With No Account or Bank Login',
    h1: 'An Undebt.it alternative with no account',
    lede: 'Undebt.it is a capable, low-cost web planner. If what you want is a payoff plan with nothing to sign up for and your numbers kept on your own device, here is how DebtFree differs.',
    desc: 'Comparing DebtFree and Undebt.it: no account versus a free account, no bank login, data on your device, Android app, and one-time Premium versus $10 a year.',
    cols: [0, 1],
    sections: [
      ['How they differ', `<ul>
<li><strong>Sign-up.</strong> Undebt.it saves and tracks a plan in a free account, created with an email or a Google login. DebtFree has no accounts: open it and start typing.</li>
<li><strong>Where your numbers live.</strong> Undebt.it keeps your plan in your account on its service. DebtFree keeps everything on your phone or computer, with an optional backup to your own Google Drive.</li>
<li><strong>Bank access.</strong> Undebt.it+ offers bank sync as an option. DebtFree never connects to a bank; you type your own balances and payments, and autopay payments are logged for you on their due day.</li>
<li><strong>Phones.</strong> Both run in a browser and can be added to a phone’s home screen. DebtFree is also on Google Play as an Android app.</li>
<li><strong>Price.</strong> Undebt.it’s core is free and Undebt.it+ is $10 a year. DebtFree’s core is free and Premium is a single payment of $24, with no renewal.</li></ul>`],
      ['Where Undebt.it is stronger', '<p>Undebt.it offers eight payoff methods to DebtFree’s four, has years of history behind it, and its paid tier costs less in its first two years than DebtFree Premium. If automatic balance updates from your bank matter most, its optional bank sync does something DebtFree deliberately does not.</p>'],
      ['What DebtFree adds', `<ul>
<li><strong>Optimized order:</strong> tests payoff orders and uses the one with the lowest total interest, next to snowball, avalanche and your own order.</li>
<li><strong>0% promos that end on time:</strong> promo and balance-transfer rates switch to the regular rate on the end date, so the plan shows what happens after.</li>
<li><strong>Logging in one tap:</strong> “Paid as planned” for the month, autopay logged for you, and reminders before each due date.</li>
<li><strong>Fill from a statement:</strong> pick screenshots of a card statement and the phone reads the balance, rate and minimum on the device. The images never leave it.</li></ul>`],
      ['Moving from Undebt.it', '<p>There is no import yet. Setup asks for four things per debt (name, balance, rate, minimum payment) and most people finish in about a minute. Your Undebt.it account stays as it is, so you can run both side by side and compare the dates.</p>']
    ],
    faq: [
      ['Is DebtFree free like Undebt.it?', 'Yes. The planner, all four payoff orders, payment tracking and reminders are free with unlimited debts. Premium adds What-If tools, bills, sinking funds and amortization export for a one-time $24.'],
      ['Does DebtFree need an email address?', 'No. There is no account, no email and no password. Your data stays on your device.'],
      ['Can DebtFree sync with my bank like Undebt.it+?', 'No, by design. DebtFree never asks for a bank login. Autopay payments are logged for you, and you can update a balance from your statement whenever you like.'],
      ['Will my numbers match Undebt.it’s?', 'They should be close for the same order and the same monthly amount. Small differences come from how each tool rounds and when it applies interest within a month.']
    ]
  },
  {
    slug: 'debt-payoff-planner-alternative',
    title: 'Debt Payoff Planner Alternative With No Ads or Subscription',
    h1: 'A Debt Payoff Planner alternative with no ads and no subscription',
    lede: 'Debt Payoff Planner is one of the most downloaded payoff apps. If you would rather skip the ads and pay once instead of every month, here is how DebtFree compares.',
    desc: 'Comparing DebtFree and Debt Payoff Planner: no ads, one-time $24 Premium versus a $6.99 a month subscription, no account, no bank login, and an Optimized payoff order.',
    cols: [0, 2],
    sections: [
      ['How they differ', `<ul>
<li><strong>Price.</strong> Debt Payoff Planner is free with ads, and its Pro version is a subscription ($6.99 a month or $27.99 a year on the App Store). DebtFree shows no ads, and Premium is one payment of $24.</li>
<li><strong>Account.</strong> Both work without one. Debt Payoff Planner offers an optional account for backup and other devices; DebtFree has none and offers an optional backup to your own Google Drive.</li>
<li><strong>Payoff orders.</strong> Both do snowball, avalanche and a custom order. DebtFree adds Optimized, which tests orders and uses the one with the lowest total interest.</li>
<li><strong>Tracking.</strong> Both have you record payments yourself. DebtFree logs autopay payments for you on their due day, logs a month of planned payments in one tap, and can remind you before each due date.</li>
<li><strong>Phones.</strong> Debt Payoff Planner is in both app stores. DebtFree is on Google Play; on iPhone it runs from the Home Screen as a web app.</li></ul>`],
      ['Where Debt Payoff Planner is stronger', '<p>It has a native iPhone app in the App Store, years of updates and a large community of users and reviews. Its optional account also carries a plan between devices automatically.</p>'],
      ['What DebtFree adds', `<ul>
<li><strong>0% promos that end on time:</strong> promo and balance-transfer rates switch to the regular rate on the end date.</li>
<li><strong>What-If slider:</strong> drag an extra monthly amount and watch the debt-free date and interest change.</li>
<li><strong>Fill from a statement:</strong> the phone reads a card statement’s balance, rate and minimum from screenshots, on the device.</li>
<li><strong>Monthly recap and milestones:</strong> what changed last month, and the wins along the way.</li></ul>`]
    ],
    faq: [
      ['Does DebtFree have ads?', 'No. There are no ads in the free version or in Premium.'],
      ['Is DebtFree a subscription?', 'No. The planner is free, and Premium is a one-time $24 purchase with nothing to renew.'],
      ['Does DebtFree do the debt snowball?', 'Yes. It does the debt snowball, the debt avalanche, your own order, and an Optimized order that tests orders for the lowest total interest. You can compare them on your own numbers.'],
      ['Can I use DebtFree on iPhone?', 'Yes, in Safari. Add it to the Home Screen and it opens like an app and works offline. It is not in the App Store yet.']
    ]
  },
  {
    slug: 'debt-payoff-app-without-bank-login',
    title: 'Debt Payoff App Without a Bank Login',
    h1: 'A debt payoff app that never asks for your bank login',
    lede: 'Many money apps start by asking you to connect your bank. You can plan a debt payoff without that: the math only needs a balance, a rate and a minimum payment for each debt.',
    desc: 'Plan and track a debt payoff without linking a bank account. What a payoff plan needs, how it stays current without bank access, and how DebtFree keeps your data on your device.',
    cols: [0, 1, 2],
    sections: [
      ['What a payoff plan needs', '<p>Three numbers per debt: the balance, the interest rate (APR) and the minimum payment. Add the extra you can put toward debt each month, and the math gives a payoff order, a month-by-month schedule and a debt-free date. None of that needs access to your bank.</p>'],
      ['Why some apps ask for a bank login', '<p>A bank connection lets an app pull balances and payments on its own, so there is less to type. The trade-off is that a third-party service holds a connection to your accounts, and the app can see your transactions. Some people are fine with that; others would rather not share it for a payoff plan.</p>'],
      ['How DebtFree stays current without one', `<ul>
<li><strong>Autopay logged for you:</strong> mark a debt as on autopay and its payment is logged on the due day.</li>
<li><strong>One tap for the month:</strong> “Paid as planned” logs every planned payment at once.</li>
<li><strong>Statement check-in:</strong> type the balance from a new statement and the app squares up the interest.</li>
<li><strong>Fill from a statement:</strong> pick screenshots of a card statement and the phone reads the balance, rate and minimum. The images never leave the device.</li>
<li><strong>Reminders:</strong> an optional nudge before each due date.</li></ul>`],
      ['Where your numbers are kept', '<p>On your phone or computer, in the app’s own storage. There is no account and no server copy of your debts. If you want a backup, it goes to your own Google Drive, and only when you turn that on.</p>'],
      ['Other apps, at a glance', '<p>How DebtFree, Undebt.it and Debt Payoff Planner handle accounts and bank access:</p>']
    ],
    tableAfterSections: true,
    faq: [
      ['Is it safe to use a debt app without linking my bank?', 'Without a bank login there are no bank credentials to share. In DebtFree your debt details stay on your device; nothing about your debts is sent to a server.'],
      ['How accurate is a plan if I type my own balances?', 'As accurate as the numbers you enter. Updating each balance from your statement once a month keeps the plan close to what your lender shows.'],
      ['Does DebtFree work offline?', 'Yes. Once opened, it works without a connection on Android and on the iPhone Home Screen.'],
      ['Is it free?', 'Yes. Planning, tracking, autopay logging and reminders are free with unlimited debts. Premium is a one-time $24.']
    ]
  }
];

const STYLE = `<style>
.cmp-wrap{overflow-x:auto;margin:14px 0 6px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.cmp{border-collapse:collapse;width:100%;min-width:560px;font-size:.88rem;line-height:1.45}
.cmp caption{caption-side:bottom;text-align:left;font-size:.74rem;color:var(--text-muted);padding:10px 14px}
.cmp th,.cmp td{padding:10px 14px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
.cmp thead th{font-weight:800;color:var(--ink);background:var(--surface2)}
.cmp tbody th{font-weight:700;color:var(--text-mid);width:22%}
.cmp .us{background:rgba(245,208,0,.10)}
.cmp thead th.us{background:rgba(245,208,0,.28)}
.cmp tr:last-child th,.cmp tr:last-child td{border-bottom:0}
.content ul{padding-left:1.1em}.content li{margin:6px 0}
.content .card-grid{margin-top:10px}
</style>`;

function url(p) { return `${SITE}/compare/${p.slug ? p.slug + '/' : ''}`; }
function render(p) {
  const u = url(p);
  const title = `${p.title} | DebtFree Dashboard`;
  const crumbs = [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Compare', item: `${SITE}/compare/` }];
  if (p.slug) crumbs.push({ '@type': 'ListItem', position: 3, name: p.h1, item: u });
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': u, url: u, name: p.title, description: p.desc, dateModified: TODAY, isPartOf: { '@type': 'WebSite', name: 'DebtFree Dashboard', url: SITE + '/' } },
    { '@type': 'BreadcrumbList', itemListElement: crumbs },
    { '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  ] };
  const loc = 'compare_' + (p.slug || 'hub').replace(/-/g, '_');
  const tbl = table(p.cols);
  const secs = p.sections.map(([h, html]) => `<h2>${esc(h)}</h2>\n${html}`).join('\n');
  const body = p.tableAfterSections ? `${secs}\n${tbl}` : `<h2>At a glance</h2>\n${tbl}\n${secs}`;
  return head({ title, desc: p.desc, url: u, jsonld }).replace('</head>', `${STYLE}\n</head>`) + `
<body>
${NAV}
<main class="wrap">
<div class="crumbs"><a href="/">Home</a> / ${p.slug ? `<a href="/compare/">Compare</a> / ${esc(p.h1)}` : 'Compare'}</div>
<header class="hero"><h1>${esc(p.h1)}</h1><p class="lede">${esc(p.lede)}</p><div class="trust"><span>Facts from each product’s own pages</span><span>Checked ${CHECKED}</span></div></header>
<article class="content">
${body}
</article>
${CTA(loc).replace(/ data-handoff/g, ` data-cta="${loc}"`).replace(/<p class="fine">[^<]*<\/p>/, '<p class="fine">No account and no bank login. Your numbers stay on your device.</p>').replace(/<h2>[^<]*<\/h2><p>[^<]*<\/p>/, '<h2>See it on your own numbers</h2><p>Open the free dashboard, add your debts, and your debt-free date appears in about a minute. Nothing to install and nothing to sign up for.</p>')}
<section class="faq"><h2>Questions people ask</h2>
${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</section>
${FOUNDER}
<section class="related"><h2>Free calculators</h2><div class="card-grid">
<a class="card-link" href="/calculators/debt-snowball-calculator/"><strong>Debt snowball calculator</strong><span>Smallest balance first, on your numbers</span></a>
<a class="card-link" href="/calculators/snowball-vs-avalanche-calculator/"><strong>Snowball vs avalanche</strong><span>Which order costs less, side by side</span></a>
<a class="card-link" href="/calculators/debt-payoff-planner/"><strong>Debt payoff planner</strong><span>Your debt-free date and this month’s payments</span></a></div></section>
${NOTE}
</main>
${FOOTER}
</body>
</html>
`;
}

function build() {
  if (!APP_VERSION) throw new Error('APP_VERSION not found');
  PAGES.forEach(p => {
    const dir = path.join(OUTDIR, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), render(p));
  });
  return PAGES.length;
}

// Listed in sitemap.xml by build-calculators.js (it rewrites the sitemap whole).
const URLS = PAGES.map(p => '/compare/' + (p.slug ? p.slug + '/' : ''));
module.exports = { build, PAGES, URLS };
if (require.main === module) console.log(`built ${build()} compare pages`);
