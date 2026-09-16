/*
 * test-upgrade.js — an existing user's data meeting v1.42.0 for the first time.
 * Their backup predates dueDay entirely, so every debt has the field ABSENT
 * (not null) — which is the state that actually ships on launch day.
 */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const CHART=fs.readFileSync(path.join(__dirname,'../node_modules/chart.js/dist/chart.umd.js'),'utf8');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-primary.json'),'utf8'));
// Strip every trace of the new field, the way a v1.41.2 export really looks.
FX.debts.forEach(d => { delete d.dueDay; });

const results=[]; const check=(l,ok,d)=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${l}`);if(d)console.log('      '+d);};

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx=await b.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  await ctx.route('**/chart.umd.min.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:CHART}));
  await ctx.route('**/googletagmanager.com/**',r=>r.abort()); await ctx.route('**/clarity.ms/**',r=>r.abort());
  await ctx.addInitScript(()=>{try{localStorage.setItem('debtfree_last_seen_version','99.0.0');localStorage.setItem('debtfree_demo_dismissed','1');}catch(e){}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  // Network failures are the sandbox's egress proxy blocking fonts/CDN, not the
  // app. Filter them or the check grades the test environment.
  const consoleErrs=[]; p.on('console',m=>{
    if(m.type()!=='error') return;
    const t=m.text();
    if(/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|net::ERR_|Failed to load resource/.test(t)) return;
    consoleErrs.push(t);
  });
  await p.goto('file://'+path.join(__dirname,'site/app/dashboard.html'));
  await p.waitForTimeout(1000);
  await p.evaluate(f=>{applyBackupPayload(f);},FX);
  await p.waitForTimeout(1200);

  const st=await p.evaluate(()=>({
    fieldAbsent: debts.every(d=>d.dueDay===null||typeof d.dueDay==='undefined'),
    dueDayValues: debts.slice(0,3).map(d=>d.dueDay),
    upcomingRows: upcomingDues().length,
    cardDisplay: getComputedStyle(document.getElementById('upcoming-card')).display,
    hasInvite: !!document.getElementById('upcoming-card').querySelector('.due-invite-go'),
    // everything else must still work
    months: getPlanSim().months,
    nextDebt: (document.getElementById('next-debt-name')||{}).textContent,
    debtsRendered: document.querySelectorAll('#debt-list-card .debt-card, #portfolio-table tr').length
  }));

  check('no dueDay on any debt after restore (the launch-day state)', st.fieldAbsent, JSON.stringify(st.dueDayValues));
  check('upcomingDues() returns no rows, does not throw', st.upcomingRows===0, `${st.upcomingRows} rows`);
  // Launch day: the card offers the batch setter. It must never be an empty box,
  // and it must never show an invented date.
  check('Coming Up card offers the setter rather than showing an empty box',
        st.cardDisplay!=='none' && st.hasInvite, `display: ${st.cardDisplay}, invite ${st.hasInvite}`);
  check('no due date was invented for anyone', st.dueDayValues.every(v=>v===null||typeof v==='undefined'),
        JSON.stringify(st.dueDayValues));
  check('the rest of the app renders normally', st.months>0 && !!st.nextDebt, `${st.months} months, next target "${st.nextDebt}"`);
  check('no page errors', errs.length===0, errs.slice(0,3).join(' | ')||'none');
  check('no console errors', consoleErrs.length===0, consoleErrs.slice(0,3).join(' | ')||'none');

  // A render loop with no due days must stay clean across repeated renders.
  const loop=await p.evaluate(()=>{ for(let i=0;i<5;i++) render(); return 'ok'; });
  check('repeated render() with no due days stays clean', loop==='ok' && errs.length===0);

  // And one debt gaining a due day must not disturb the others.
  const partial=await p.evaluate(()=>{
    debts[1].dueDay=10; render();
    return { rows: upcomingDues().length, display: getComputedStyle(document.getElementById('upcoming-card')).display };
  });
  check('setting ONE due day shows only that debt', partial.rows===1 && partial.display!=='none',
        `${partial.rows} row, display ${partial.display}`);

  console.log(`\n${results.every(Boolean)?'ALL PASS':'FAILURES PRESENT'}  (${results.filter(Boolean).length}/${results.length})`);
  await b.close(); process.exit(results.every(Boolean)?0:1);
})();
