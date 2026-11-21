#!/usr/bin/env node
/* build-es.js: generates the Spanish pages (backlog D9, 2026-11-21)
 *
 *   BUILD_DATE=YYYY-MM-DD node tools/build-es.js
 *
 *   /es/                                        Spanish homepage + quick calculator
 *   /es/calculadoras/calculadora-pago-de-deudas/    (debt-payoff-calculator)
 *   /es/calculadoras/calculadora-bola-de-nieve/     (debt-snowball-calculator)
 *   /es/calculadoras/calculadora-tarjeta-de-credito/ (credit-card-payoff-calculator)
 *
 * A demand test, not a translation of the whole site: the app itself is still
 * in English and every page says so. Copy lives in PAGES below; behaviour in
 * es/assets/es.js; math in calculators/assets/engine.js (generated from the
 * app). Each page links to its English twin with hreflang, and the English
 * pages link back (tools/build-calculators.js ES map, index.html head).
 * Never hand-edit the generated HTML.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SITE = 'https://mydebtdashboard.com';
const APP_VERSION = (fs.readFileSync(path.join(ROOT, 'app', 'dashboard.html'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PLAY = c => `https://play.google.com/store/apps/details?id=com.mydebtdashboard.app&amp;referrer=utm_source%3Dmydebtdashboard%26utm_medium%3Dbadge%26utm_campaign%3D${c}`;

const MIX = [
  { name: 'Tarjeta de recompensas', type: 'cc', balance: 6800, apr: 24.99, min: 204 },
  { name: 'Tarjeta de uso diario', type: 'cc', balance: 2300, apr: 21.49, min: 69 },
  { name: 'Tarjeta de tienda', type: 'cc', balance: 900, apr: 29.99, min: 35 },
  { name: 'Préstamo de auto', type: 'auto', balance: 14500, apr: 7.9, min: 395 },
  { name: 'Préstamo personal', type: 'personal', balance: 5200, apr: 12.5, min: 175 }
];

const APP_POINTS = [
  'Tu fecha sin deudas se actualiza cada vez que registras un pago',
  'Bola de nieve, avalancha o tu propio orden, y Optimized, que busca el orden más barato',
  'Recordatorios antes de cada pago, en tu teléfono',
  'Las tasas promocionales del 0% cambian solas cuando terminan',
  'Sin cuenta y sin conectar tu banco: tus datos se quedan en tu dispositivo',
  'Gratis con deudas ilimitadas'
];

// slug: path under /es/calculadoras/. en: the English twin's path.
const PAGES = [
  {
    slug: 'calculadora-pago-de-deudas', en: '/calculators/debt-payoff-calculator/', mode: 'multi', strategy: 'avalanche', strategySelect: true, debts: MIX, extra: 250,
    title: 'Calculadora de pago de deudas', h1: 'Calculadora de pago de deudas: todas tus deudas a la vez',
    desc: 'Calculadora gratis para varias deudas. Ve en qué mes terminas de pagar, cuánto suman los intereses y el orden de pago con bola de nieve o avalancha.',
    lede: 'Escribe cada deuda y lo que puedes pagar de más cada mes. La calculadora estima el mes en que terminas de pagar la última, cuánto pagas de intereses y en qué orden se van liquidando.',
    content: [
      ['Cómo funciona', '<p>Cada mes, la calculadora suma los intereses de cada deuda, aplica los pagos mínimos y manda el dinero extra a una deuda a la vez. Cuando una deuda queda en cero, su pago mínimo pasa a la siguiente. Repite el proceso hasta que todos los saldos llegan a cero y te muestra ese mes y el total de intereses.</p>'],
      ['Avalancha o bola de nieve', '<ul><li><strong>Avalancha:</strong> el extra va primero a la deuda con la tasa más alta. Con los mismos pagos, suele dar menos intereses en total.</li><li><strong>Bola de nieve:</strong> el extra va primero a la deuda con el saldo más bajo. Las primeras deudas se terminan antes.</li><li><strong>Tu orden:</strong> el extra sigue el orden de tu lista.</li></ul><p>La diferencia depende de tus números. Con tasas muy distintas, la brecha suele ser mayor; con tasas parecidas, a veces es de pocos dólares. La calculadora muestra las dos para que veas la diferencia con tus propias deudas.</p>'],
      ['Qué necesitas', '<p>El saldo, la tasa de interés anual (APR) y el pago mínimo de cada deuda. Los encuentras en tu estado de cuenta o en la app de tu banco. Si dejas el mínimo en blanco, la calculadora lo estima.</p>']
    ],
    faq: [
      ['¿Es gratis?', 'Sí. La calculadora es gratis, sin registro, y los números que escribes se quedan en tu dispositivo.'],
      ['¿Qué tan exacta es la fecha?', 'Es una estimación con los números que escribes: sin cargos nuevos, con tasas que no cambian y con el mismo pago cada mes. Aquí los intereses se calculan por mes; muchas tarjetas los calculan por día, así que tu estado de cuenta puede variar un poco.'],
      ['¿Puedo incluir préstamos de auto o de estudiante?', 'Sí. Cualquier deuda con saldo, tasa y pago mensual funciona igual. El pago fijo de un préstamo cuenta como su pago mínimo.'],
      ['¿La app está en español?', 'Todavía no. La app de DebtFree está en inglés por ahora. Si te gustaría tenerla en español, toca el botón «Sí, la quiero en español» en esta página.']
    ]
  },
  {
    slug: 'calculadora-bola-de-nieve', en: '/calculators/debt-snowball-calculator/', mode: 'multi', strategy: 'snowball', debts: MIX, extra: 250,
    title: 'Calculadora bola de nieve para deudas', h1: 'Calculadora bola de nieve para pagar deudas',
    desc: 'Calculadora gratis del método bola de nieve: paga primero el saldo más bajo y mira cómo cada pago liberado pasa a la siguiente deuda, mes a mes.',
    lede: 'El método bola de nieve paga primero la deuda con el saldo más bajo. Cuando termina una, su pago se suma a la siguiente. Esta calculadora te muestra el orden, las fechas y lo que cuesta, comparado con el método avalancha.',
    content: [
      ['Qué es el método bola de nieve', '<p>Pagas el mínimo en todas tus deudas y pones todo el dinero extra en la de saldo más bajo. Cuando esa queda en cero, su pago mínimo más el extra pasan a la siguiente más pequeña. El pago que avanza crece con cada deuda que terminas, como una bola de nieve que rueda.</p>'],
      ['Bola de nieve o avalancha', '<p>Con el método avalancha, el extra va primero a la tasa más alta, y con los mismos pagos suele costar menos intereses. Con bola de nieve, las primeras deudas se terminan antes. La calculadora compara los dos con tus números para que veas cuánto cambia el mes final y los intereses.</p>'],
      ['Cómo leer el resultado', '<p>La lista muestra el mes en que se termina cada deuda y los intereses que pagó. Debajo verás cuándo cada pago liberado pasa a la siguiente deuda.</p>']
    ],
    faq: [
      ['¿Es gratis?', 'Sí. Es gratis, sin registro, y nada sale de tu dispositivo.'],
      ['¿Qué pasa si una deuda tiene 0% de interés?', 'Entra en la lista por su saldo, como cualquier otra. En la app puedes indicar cuándo termina la promoción y la tasa que sigue.'],
      ['¿Por qué cambió uno de mis pagos mínimos?', 'Si un mínimo es menor que un mes de intereses, el saldo crecería y nunca terminaría. En ese caso la calculadora lo sube a un mes de intereses más $1 y te lo indica.'],
      ['¿La app está en español?', 'Todavía no. La app de DebtFree está en inglés por ahora. Si te gustaría tenerla en español, toca «Sí, la quiero en español» en esta página.']
    ]
  },
  {
    slug: 'calculadora-tarjeta-de-credito', en: '/calculators/credit-card-payoff-calculator/', mode: 'card', debtName: 'Tarjeta de crédito',
    fields: { balance: 5000, apr: 22.99, payment: 175, months: 24, extra: 0 },
    title: 'Calculadora para pagar tu tarjeta de crédito', h1: 'Calculadora para pagar tu tarjeta de crédito',
    desc: 'Calculadora gratis: cuándo terminas de pagar tu tarjeta de crédito, cuánto pagas de intereses, o el pago mensual para liquidarla en los meses que elijas.',
    lede: 'Escribe el saldo, la tasa anual (APR) y lo que pagas al mes. Verás el mes en que terminas de pagar y los intereses en total. O elige en cuántos meses y la calculadora te da el pago mensual.',
    content: [
      ['Cómo se calcula', '<p>Cada mes se suman los intereses (la tasa anual dividida entre 12) y se resta tu pago. El cálculo se repite hasta que el saldo llega a cero. Supone que no se agregan compras nuevas a la tarjeta y que la tasa no cambia.</p>'],
      ['Por qué el pago mínimo tarda tanto', '<p>El mínimo de muchas tarjetas baja a medida que baja el saldo, y una buena parte de cada pago se va en intereses. Por eso pagar solo el mínimo puede tardar años. Con un pago fijo, aunque sea un poco mayor, la fecha final llega mucho antes.</p>'],
      ['Si tienes varias tarjetas', '<p>Usa la <a href="/es/calculadoras/calculadora-pago-de-deudas/">calculadora de pago de deudas</a> para verlas juntas y comparar el orden de pago.</p>']
    ],
    faq: [
      ['¿Es gratis?', 'Sí. Es gratis, sin registro, y nada sale de tu dispositivo.'],
      ['¿Dónde encuentro mi tasa anual (APR)?', 'En tu estado de cuenta, normalmente en la sección de intereses, o en la app de tu banco. Si tu tarjeta tiene varias tasas, usa la de compras.'],
      ['¿Por qué mi banco muestra otra cifra?', 'Muchas tarjetas calculan los intereses por día y el mínimo cambia cada mes. Aquí el cálculo es mensual y con pago fijo, así que la cifra puede variar un poco.'],
      ['¿La app está en español?', 'Todavía no. La app de DebtFree está en inglés por ahora. Si te gustaría tenerla en español, toca «Sí, la quiero en español» en esta página.']
    ]
  }
];

const HOME = {
  title: 'DebtFree: calcula tu fecha sin deudas, gratis',
  desc: 'Calcula gratis en qué mes terminas de pagar tus deudas. Tarjetas de crédito, préstamos de auto y de estudiante, en un solo plan. Sin cuenta y sin conectar tu banco.',
  faq: [
    ['¿Es gratis?', 'Sí. Las calculadoras y la app son gratis, con deudas ilimitadas. Hay una versión Premium opcional con herramientas de planificación avanzadas, con un solo pago.'],
    ['¿Tengo que conectar mi cuenta del banco?', 'No. DebtFree funciona con los números que tú escribes y los guarda en tu dispositivo. No pide tu contraseña del banco ni crea una cuenta.'],
    ['¿La app está en español?', 'Todavía no. La app está en inglés por ahora; estas páginas son en español. Si te gustaría la app completa en español, toca «Sí, la quiero en español». Así sabemos cuánta gente la quiere.'],
    ['¿Hay app para iPhone?', 'En iPhone, abre la app en Safari, toca Compartir y luego «Agregar a pantalla de inicio». Se abre como una app y funciona sin conexión. En Android está en Google Play.']
  ]
};

const STYLE = `<style>.is-ios .play-badge,.in-play-app .play-badge{display:none!important}.in-play-app .web-only{display:none!important}
.lang-note{margin:14px 0 0;background:var(--surface2);border-radius:10px;padding:10px 14px;font-size:0.86rem;color:var(--text-mid)}
.lang-note a{color:var(--ink)}
.es-ask{margin:22px 0;border:1px solid var(--border);border-radius:14px;padding:16px 18px;background:var(--surface)}
.es-ask h2{font-size:1.05rem;margin-bottom:4px;color:var(--ink)}.es-ask p{font-size:0.88rem;color:var(--text-mid);margin-bottom:10px}
.es-ask button{font:700 0.9rem inherit;font-family:inherit;background:var(--ink);color:#fff;border:0;border-radius:999px;padding:10px 16px;cursor:pointer}
.es-thanks{font-weight:700;color:var(--ink)!important}</style>`;

const SCRIPTS_TAIL = `<script>(function(){var h=document.documentElement,u=navigator.userAgent||'';if(/iPhone|iPad|iPod/.test(u)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))h.className+=' is-ios';try{if(sessionStorage.getItem('debtfree_play')==='1')h.className+=' in-play-app'}catch(e){}document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-play-badge]');if(a&&typeof gtag==='function')gtag('event','play_badge_click',{event_category:'acquisition',location:a.getAttribute('data-play-badge'),page_path:location.pathname})});})();</script>
<script>(function(){try{
if(sessionStorage.getItem('debtfree_arrival_seen'))return;sessionStorage.setItem('debtfree_arrival_seen','1');
var q=new URLSearchParams(location.search),utm=(q.get('utm_source')||'').toLowerCase(),ref='';
try{ref=document.referrer?new URL(document.referrer).hostname.toLowerCase():''}catch(e){}
if(ref===location.hostname)return;
var AI=/(^|\\.)(chatgpt\\.com|openai\\.com|perplexity\\.ai|gemini\\.google\\.com|bard\\.google\\.com|copilot\\.microsoft\\.com|claude\\.ai|you\\.com|phind\\.com|meta\\.ai|poe\\.com|grok\\.com|deepseek\\.com|chat\\.mistral\\.ai)$/;
var AIUTM=/^(chatgpt(\\.com)?|openai|perplexity(\\.ai)?|gemini|copilot|claude(\\.ai)?|grok|deepseek|meta\\.ai)$/;
var SE=/(^|\\.)(google\\.[a-z.]+|bing\\.com|duckduckgo\\.com|search\\.yahoo\\.com|yahoo\\.com|ecosia\\.org|search\\.brave\\.com|startpage\\.com|yandex\\.[a-z.]+|baidu\\.com)$/;
var kind=AI.test(ref)||AIUTM.test(utm)?'ai':(SE.test(ref)?'search':'');
if(!kind||typeof gtag!=='function')return;
gtag('event','arrive_from_'+kind,{event_category:'acquisition',landed_on:'es/'+(location.pathname.split('/').filter(Boolean).pop()||'es'),source:ref||utm,lang:'es'});
}catch(e){}})();</script>
<script src="/calculators/assets/engine.js?v=${APP_VERSION}"></script>
<script src="/es/assets/es.js?v=${APP_VERSION}"></script>`;

function head({ title, desc, url, enUrl, ld }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${url}">
<link rel="alternate" hreflang="es" href="${SITE}${url}">
<link rel="alternate" hreflang="en" href="${SITE}${enUrl}">
<link rel="alternate" hreflang="x-default" href="${SITE}${enUrl}">
<link rel="icon" href="/assets/logo/debtfree-mark-transparent.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">
<meta property="og:type" content="website">
<meta property="og:site_name" content="DebtFree Dashboard">
<meta property="og:locale" content="es_US">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${url}">
<meta property="og:image" content="${SITE}/assets/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/calculators/assets/calc.css?v=${APP_VERSION}">
${STYLE}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-NCP56TD9BG"></script>
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
</script>
</head>
<body>
<nav class="nav"><a href="/es/" class="nav-brand" aria-label="DebtFree Dashboard, inicio"><img src="/assets/logo/debtfree-logo-horizontal-light.svg" alt="DebtFree Dashboard" width="150" height="32" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="fb" style="display:none">DebtFree Dashboard</span></a><div class="nav-links"><a class="txt" href="${enUrl}" hreflang="en" lang="en">English</a><a class="nav-cta" href="/app/dashboard.html" data-cta="nav">Abrir la app gratis</a></div></nav>
<main class="wrap">`;
}

function ldFor(url, name, desc, faq, crumbs) {
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': SITE + url, url: SITE + url, name, description: desc, inLanguage: 'es', dateModified: TODAY, isPartOf: { '@type': 'WebSite', name: 'DebtFree Dashboard', url: SITE + '/' } },
    { '@type': 'WebApplication', name, url: SITE + url, inLanguage: 'es', applicationCategory: 'FinanceApplication', operatingSystem: 'Any web browser', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) },
    { '@type': 'FAQPage', inLanguage: 'es', mainEntity: faq.map(q => ({ '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1] } })) }
  ] };
}

const LANG_NOTE = enUrl => `<p class="lang-note">Estas páginas están en español. La app de DebtFree está en inglés por ahora. <a href="${enUrl}" hreflang="en" lang="en">Read in English</a></p>`;
const ASK = where => `<section class="es-ask"><h2>¿Te gustaría la app completa en español?</h2><p>Hoy la app está en inglés. Un toque nos dice cuánta gente la quiere en español. No pedimos tu correo ni ningún dato.</p><button type="button" data-es-interest="${where}">Sí, la quiero en español</button><p class="es-thanks" hidden>¡Gracias! Lo tomamos en cuenta.</p></section>`;
const FAQ = faq => `<section class="faq"><h2>Preguntas frecuentes</h2>\n${faq.map(q => `<details><summary>${esc(q[0])}</summary><p>${esc(q[1])}</p></details>`).join('\n')}\n</section>`;
const CTA = (campaign, title) => `<section class="cta"><div><h2>${title}</h2><a href="/app/dashboard.html" class="btn-primary" data-handoff>Abrir en la app gratis (en inglés) &rarr;</a><p class="fine">Tus números pasan de esta página a la app en este dispositivo. Nada se envía a un servidor.</p><a class="play-badge" href="${PLAY(campaign)}" target="_blank" rel="noopener" data-play-badge="${campaign}" style="display:inline-block;margin-top:14px;line-height:0"><img src="/assets/badges/google-play-badge.png" alt="Disponible en Google Play" width="162" height="63" loading="lazy" style="display:block;height:auto"></a></div><ul>
${APP_POINTS.map(p => `<li>${esc(p)}</li>`).join('\n')}
<li class="web-only">Premium es opcional: un solo pago de $24, sin suscripción.</li></ul></section>`;
const DISCLAIMER = '<p class="disclaimer">Estimaciones con fines ilustrativos. El cálculo supone intereses mensuales (tasa anual &divide; 12), pagos a tiempo y ningún cargo nuevo; las cifras de tu banco pueden variar. Estas páginas muestran lo que indican los números y no son asesoría financiera.</p>';
const FOOTER = enUrl => `</main>
<footer class="site"><a href="/es/">Inicio</a><a href="/es/calculadoras/calculadora-pago-de-deudas/">Calculadoras</a><a href="/app/dashboard.html">App</a><a href="/privacy.html">Privacidad (en inglés)</a><a href="${enUrl}" hreflang="en" lang="en">English</a><div style="margin-top:10px">&copy; 2026 DebtFree Dashboard</div></footer>
`;
function related(except) {
  const all = [['/es/', 'Inicio: tu fecha sin deudas en segundos']].concat(PAGES.map(p => ['/es/calculadoras/' + p.slug + '/', p.title]));
  return `<section class="related"><h2>Más en español</h2><div class="card-grid">${all.filter(a => a[0] !== except).map(a => `<a class="card-link" href="${a[0]}"><strong>${esc(a[1])}</strong></a>`).join('')}</div></section>`;
}

function inputs(p) {
  if (p.mode === 'multi') {
    let h = `<div class="debt-head"><h2 class="ct">Tus deudas</h2><span class="sub muted sm">Mínimo en blanco = estimado</span></div><div id="debt-rows"></div><button type="button" class="btn-add" id="add-debt">+ Agregar una deuda</button><div class="opts"><div class="f"><label for="extra">Extra al mes, además de los mínimos</label><div class="affix">$<input id="extra" type="text" inputmode="decimal" value="${p.extra}"></div><span class="hint">Puede ser $0</span></div>`;
    if (p.strategySelect) h += `<div class="f"><label for="strategy">Método</label><select id="strategy"><option value="avalanche" selected>Avalancha: primero la tasa más alta</option><option value="snowball">Bola de nieve: primero el saldo más bajo</option><option value="hybrid">Tu orden: según la lista</option></select></div>`;
    return h + '</div>';
  }
  const f = p.fields;
  return `<div class="fields"><div class="f"><label for="balance">Saldo de la tarjeta</label><div class="affix">$<input id="balance" type="text" inputmode="decimal" value="${f.balance}"></div></div><div class="f"><label for="apr">Tasa anual (APR)</label><div class="affix suffix"><input id="apr" type="text" inputmode="decimal" value="${f.apr}">%</div></div><div class="f" id="f-payment"><label for="payment">Pago mensual</label><div class="affix">$<input id="payment" type="text" inputmode="decimal" value="${f.payment}"></div></div><div class="f" id="f-months" hidden><label for="months">Pagarla en (meses)</label><input id="months" type="text" inputmode="numeric" value="${f.months}"></div><div class="f"><label for="extra">Extra al mes</label><div class="affix">$<input id="extra" type="text" inputmode="decimal" value="${f.extra}"></div><span class="hint">opcional</span></div></div><div class="opts"><label class="chk"><input type="checkbox" id="solve-months"> Calcular el pago a partir de un número de meses</label></div>`;
}

function calcPage(p) {
  const url = '/es/calculadoras/' + p.slug + '/';
  const cfg = { kind: 'calc', slug: 'es-' + p.slug, mode: p.mode, strategy: p.strategy || 'avalanche', debtName: p.debtName || null, debts: p.debts || null };
  return head({ title: p.title + ' | DebtFree', desc: p.desc, url, enUrl: p.en, ld: ldFor(url, p.title, p.desc, p.faq, [['Inicio', '/es/'], [p.title, url]]) }) + `
<div class="crumbs"><a href="/es/">Inicio</a> / ${esc(p.title)}</div>
<header class="hero"><h1>${esc(p.h1)}</h1><p class="lede">${esc(p.lede)}</p><div class="trust"><span>Gratis</span><span>Sin registro</span><span>Nada sale de tu dispositivo</span><span>Los mismos cálculos que la app</span></div>${LANG_NOTE(p.en)}</header>
<section class="calc" id="calc" aria-label="Calculadora">
${inputs(p)}
<div class="results" id="calc-results" aria-live="polite"></div>
<div class="handoff"><a href="/app/dashboard.html" class="btn-primary" data-handoff>Abrir en la app gratis (en inglés) &rarr;</a><span class="sub">Pasa estos números a la app. Sin cuenta.</span></div>
</section>
<script type="application/json" id="es-config">${JSON.stringify(cfg)}</script>
${ASK(p.slug)}
<article class="content">
${p.content.map(c => `<h2>${esc(c[0])}</h2>\n${c[1]}`).join('\n')}
</article>
${CTA('es_' + p.slug.replace(/-/g, '_'), 'Una calculadora es una foto. Tu plan sigue avanzando.')}
${FAQ(p.faq)}
${related(url)}
${DISCLAIMER}
${FOOTER(p.en)}${SCRIPTS_TAIL}
</body>
</html>
`;
}

function homePage() {
  const url = '/es/';
  const cfg = { kind: 'home', slug: 'es-home', mode: 'quick' };
  return head({ title: HOME.title, desc: HOME.desc, url, enUrl: '/', ld: ldFor(url, 'DebtFree Dashboard', HOME.desc, HOME.faq, [['Inicio', '/es/']]) }) + `
<header class="hero"><h1>Calcula en qué mes terminas de pagar tus deudas. Gratis.</h1><p class="lede">Tarjetas de crédito, préstamos de auto, de estudiante y personales en un solo plan, con cálculos claros. Sin cuenta y sin conectar tu banco.</p><div class="trust"><span>Gratis</span><span>Sin cuenta</span><span>Tus datos se quedan en tu dispositivo</span></div>${LANG_NOTE('/')}</header>
<section class="calc" id="calc" aria-label="Calculadora rápida">
<h2 class="ct">Pruébalo con tus números</h2>
<div class="fields"><div class="f"><label for="balance">Deuda total</label><div class="affix">$<input id="balance" type="text" inputmode="decimal" value="12,000"></div></div><div class="f"><label for="apr">Tasa anual promedio (APR)</label><div class="affix suffix"><input id="apr" type="text" inputmode="decimal" value="22">%</div></div><div class="f"><label for="payment">Pago mensual</label><div class="affix">$<input id="payment" type="text" inputmode="decimal" value="400"></div></div></div>
<div class="results" id="calc-results" aria-live="polite"></div>
<p class="calc-note">Un solo saldo combinado, para darte una idea rápida. Para ver cada deuda por separado y comparar el orden de pago, usa la <a href="/es/calculadoras/calculadora-pago-de-deudas/">calculadora de pago de deudas</a>.</p>
</section>
<script type="application/json" id="es-config">${JSON.stringify(cfg)}</script>
<article class="content">
<h2>Qué hace DebtFree</h2>
<ul>${APP_POINTS.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
<h2>Calculadoras en español</h2>
<p>Cada una responde una sola pregunta con tus números. Puedes pasar el resultado a la app con un toque.</p>
</article>
${related(url)}
${ASK('home')}
<section class="cta"><div><h2>Tu plan completo, en tu teléfono</h2><a href="/app/dashboard.html" class="btn-primary" data-handoff>Abrir la app gratis (en inglés) &rarr;</a><p class="fine">Sin cuenta. Tus números se quedan en tu dispositivo.</p><a class="play-badge" href="${PLAY('es_home')}" target="_blank" rel="noopener" data-play-badge="es_home" style="display:inline-block;margin-top:14px;line-height:0"><img src="/assets/badges/google-play-badge.png" alt="Disponible en Google Play" width="162" height="63" loading="lazy" style="display:block;height:auto"></a></div><ul>
<li>En Android: descárgala de Google Play</li>
<li>En iPhone: ábrela en Safari, toca Compartir y luego «Agregar a pantalla de inicio»</li>
<li>En computadora: ábrela en tu navegador</li>
<li class="web-only">Gratis con deudas ilimitadas. Premium es opcional: un solo pago de $24.</li></ul></section>
${FAQ(HOME.faq)}
${DISCLAIMER}
${FOOTER('/')}${SCRIPTS_TAIL}
</body>
</html>
`;
}

function write(rel, html) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
}

function build() {
  write('es/index.html', homePage());
  PAGES.forEach(p => write('es/calculadoras/' + p.slug + '/index.html', calcPage(p)));
  return { pages: PAGES.length + 1, version: APP_VERSION };
}

if (require.main === module) console.log(build());
module.exports = { build, PAGES };
