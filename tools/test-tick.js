/* test-tick.js — per-month bill tick-off, v1.42.0 */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const CHART=fs.readFileSync(path.join(__dirname,'../node_modules/chart.js/dist/chart.umd.js'),'utf8');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-primary.json'),'utf8'));
const R=[]; const ck=(l,ok,d)=>{R.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${l}`);if(d)console.log('      '+d);};

async function boot(b,at){
  const ctx=await b.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  await ctx.route('**/chart.umd.min.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:CHART}));
  await ctx.route('**/googletagmanager.com/**',r=>r.abort()); await ctx.route('**/clarity.ms/**',r=>r.abort());
  await ctx.addInitScript(()=>{try{localStorage.setItem('debtfree_last_seen_version','99.0.0');
    localStorage.setItem('debtfree_demo_dismissed','1');localStorage.setItem('debtfree_premium','K');}catch(e){}});
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.clock.install({time:new Date(at)});
  await pg.goto('file://'+path.join(__dirname,'site/app/dashboard.html'));
  await pg.waitForTimeout(900);
  await pg.evaluate(f=>{applyBackupPayload(f);},FX);
  await pg.evaluate(()=>{isPremium=true;applyPremiumState();
    payments.length=0; debts.forEach(d=>{d.dueDay=null;}); render();});
  await pg.waitForTimeout(700);
  return {pg,ctx,errs};
}

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  // Feb 10. Rent due the 5th (passed), Phone due the 12th (soon).
  const {pg,ctx,errs}=await boot(b,'2026-02-10T09:00:00');

  console.log('--- never ticked: autopay users are never nagged ---');
  const virgin=await pg.evaluate(()=>{
    bills.length=0;
    bills.push({id:900001,name:'Rent',amount:1200,dueDay:5});
    render();
    const r=upcomingDues().find(x=>x.name==='Rent');
    return { status:r.status, month:r.date.getMonth(), tracked:billIsTracked(bills[0]) };
  });
  ck('a never-ticked bill past its day rolls forward, no "passed"',
     virgin.status!=='passed' && virgin.month===2 && virgin.tracked===false,
     `status ${virgin.status}, next month ${virgin.month} (2=Mar)`);

  console.log('\n--- ticking marks it for this month only ---');
  const tick=await pg.evaluate(()=>{
    toggleBillPaid(900001);
    const r=upcomingDues().find(x=>x.name==='Rent');
    return { paidThrough:bills[0].paidThrough, marked:r.marked, status:r.status,
             label:dueRowLabel(r), monthKey:currentMonthKey() };
  });
  ck('tick sets paidThrough to this month', tick.paidThrough===tick.monthKey && tick.marked===true, tick.paidThrough);
  ck('a marked bill reads "marked paid", never "paid"',
     tick.status==='logged' && /marked paid this month/.test(tick.label) && !/\bpaid\b(?!.*marked)/.test(tick.label.replace('marked paid','')),
     `"${tick.label}"`);

  console.log('\n--- now that it is tracked, an unmarked month is visible ---');
  const next=await pg.evaluate(()=>{
    // Simulate the month rolling on: paidThrough is now last month.
    bills[0].paidThrough='2026-01';
    const r=upcomingDues().find(x=>x.name==='Rent');
    return { status:r.status, label:dueRowLabel(r), tracked:billIsTracked(bills[0]) };
  });
  ck('tracked + day passed + not marked -> shows, honestly worded',
     next.status==='passed' && /not marked paid yet/.test(next.label), `"${next.label}"`);
  ck('copy never claims the bill is unpaid or late',
     !/\b(unpaid|late|missed|overdue)\b/i.test(next.label), next.label);

  console.log('\n--- untick stays tracked (does not silently stop reminding) ---');
  const untick=await pg.evaluate(()=>{
    bills[0].paidThrough=currentMonthKey();
    toggleBillPaid(900001);
    return { paidThrough:bills[0].paidThrough, stillTracked:billIsTracked(bills[0]),
             marked:billMarkedThisMonth(bills[0]) };
  });
  ck('untick steps back a month rather than clearing the field',
     untick.marked===false && untick.stillTracked===true && untick.paidThrough==='2026-01',
     `paidThrough ${untick.paidThrough}`);

  console.log('\n--- a just-ticked bill stays reachable (undo a mis-tap) ---');
  const reach=await pg.evaluate(()=>{
    bills.length=0;
    bills.push({id:900002,name:'Phone',amount:85,dueDay:12});   // 2 days out
    bills.push({id:900003,name:'Water',amount:60,dueDay:13});
    debts[0].dueDay=12;
    render();
    toggleBillPaid(900002);                                      // tick Phone
    render();
    const card=document.getElementById('upcoming-card');
    return { text:card.innerText.replace(/\n+/g,' | '),
             phoneVisible:/Phone/.test(card.innerText),
             marks:card.querySelectorAll('.due-row-tick.is-marked').length };
  });
  ck('ticking does not make the row vanish', reach.phoneVisible && reach.marks===1, reach.text.slice(0,120));

  console.log('\n--- persistence ---');
  const round=await pg.evaluate(()=>{
    bills.length=0;
    bills.push({id:900004,name:'Rent',amount:1200,dueDay:5,paidThrough:'2026-02'});
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    bills.length=0;
    applyBackupPayload(snap);
    return { restored:bills[0] ? bills[0].paidThrough : null };
  });
  ck('paidThrough survives a backup round-trip', round.restored==='2026-02', String(round.restored));

  const junk=await pg.evaluate(()=>{
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    snap.bills=[{name:'A',amount:10,paidThrough:'garbage'},
                {name:'B',amount:10,paidThrough:'2026-13-99'},
                {name:'C',amount:10,paidThrough:'2026-03'}];
    applyBackupPayload(snap);
    return bills.map(x=>x.name+':'+x.paidThrough);
  });
  ck('a malformed paidThrough is discarded, not trusted',
     JSON.stringify(junk)==='["A:null","B:null","C:2026-03"]', JSON.stringify(junk));

  console.log('\n--- the engine still knows nothing ---');
  const eng=await pg.evaluate(()=>{
    const read=()=>{_planSimCache={key:null,res:null};const s=getPlanSim();
                    return s.months+'/'+Math.round(s.totalInterest*100)/100;};
    bills.length=0; const a=read();
    bills.push({id:900005,name:'Rent',amount:4000,dueDay:1,paidThrough:currentMonthKey()});
    return { a, b:read() };
  });
  ck('ticking a bill changes nothing about the payoff plan', eng.a===eng.b, `${eng.a} vs ${eng.b}`);
  ck('no JS errors', errs.length===0, errs.slice(0,2).join(' | ')||'none');

  console.log(`\n${R.every(Boolean)?'ALL PASS':'FAILURES PRESENT'}  (${R.filter(Boolean).length}/${R.length})`);
  await b.close(); process.exit(R.every(Boolean)?0:1);
})();
