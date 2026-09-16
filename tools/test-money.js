/* test-money.js — Monthly Money Plan: budget as a CHECK, never a driver */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const CHART=fs.readFileSync(path.join(__dirname,'../node_modules/chart.js/dist/chart.umd.js'),'utf8');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-primary.json'),'utf8'));
const R=[]; const ck=(l,ok,d)=>{R.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${l}`);if(d)console.log('      '+d);};

async function boot(b,premium){
  const ctx=await b.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  await ctx.route('**/chart.umd.min.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:CHART}));
  await ctx.route('**/googletagmanager.com/**',r=>r.abort()); await ctx.route('**/clarity.ms/**',r=>r.abort());
  await ctx.addInitScript(p=>{try{localStorage.setItem('debtfree_last_seen_version','99.0.0');
    localStorage.setItem('debtfree_demo_dismissed','1'); if(p)localStorage.setItem('debtfree_premium','K');}catch(e){}},premium);
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('file://'+path.join(__dirname,'site/app/dashboard.html'));
  await pg.waitForTimeout(900);
  await pg.evaluate(f=>{applyBackupPayload(f);},FX);
  if(premium) await pg.evaluate(()=>{isPremium=true;applyPremiumState();render();});
  await pg.waitForTimeout(900);
  return {pg,ctx,errs};
}

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});

  console.log('--- THE load-bearing property: budget never moves the plan ---');
  const P=await boot(b,true);
  const inert=await P.pg.evaluate(()=>{
    const read=()=>{_planSimCache={key:null,res:null};const s=getPlanSim();
      return { months:s.months, interest:Math.round(s.totalInterest*100)/100,
               extra:planExtra(), field:document.getElementById('extra-payment').value };};
    monthlyBudget=0; const before=read();
    const seen=[];
    [500,1500,2500,50000,0].forEach(v=>{ setPlanBudget(v); seen.push(JSON.stringify(read())); });
    return { before:JSON.stringify(before), seen, allSame:seen.every(x=>x===JSON.stringify(before)) };
  });
  ck('sweeping the budget $0-$50,000 changes nothing: months, interest, planExtra, the extra field',
     inert.allSame, `baseline ${inert.before}`);

  console.log('\n--- the check itself ---');
  const check=await P.pg.evaluate(()=>{
    bills.length=0;
    bills.push({id:900001,name:'Rent',amount:1200,dueDay:1});
    document.getElementById('extra-payment').value='450';
    recalculate();
    const mins=allMinimumsTotal(), committed=committedMonthlyTotal();
    setPlanBudget(Math.round(committed)+300);
    render();
    const under=document.getElementById('plan-budget-line');
    const u={text:under.textContent, cls:under.className};
    setPlanBudget(Math.round(committed)-200);
    render();
    const over=document.getElementById('plan-budget-line');
    const o={text:over.textContent, cls:over.className};
    setPlanBudget(Math.round(committed));
    render();
    const level=document.getElementById('plan-budget-line');
    return { mins, committed, u, o, l:{text:level.textContent, cls:level.className},
             breakdown:document.getElementById('plan-budget-breakdown').textContent };
  });
  ck('breakdown shows bills + minimums + extra and totals correctly',
     /bills/.test(check.breakdown) && /minimums/.test(check.breakdown) && /extra/.test(check.breakdown),
     check.breakdown);
  ck('under budget reads as unallocated, in accent', /isn.t allocated/.test(check.u.text) && /is-under/.test(check.u.cls), check.u.text);
  ck('over budget states the gap plainly, amber not red', /more than your/.test(check.o.text) && /is-over/.test(check.o.cls), check.o.text);
  ck('exact match says so', /matches your/.test(check.l.text) && /is-level/.test(check.l.cls), check.l.text);

  console.log('\n--- copy stays descriptive, never advisory ---');
  const copy=await P.pg.evaluate(()=>{
    const out=[];
    [ -500, -1, 0, 1, 500 ].forEach(delta=>{
      setPlanBudget(Math.round(committedMonthlyTotal())+delta); render();
      out.push(document.getElementById('plan-budget-line').textContent);
    });
    return out.join(' ');
  });
  const banned=['you should','you need to','afford','cut back','too much','can’t afford','reduce your','try to'];
  const hits=banned.filter(w=>new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(copy));
  ck('no advice language anywhere in the budget line', hits.length===0, hits.join(', ')||'clean');

  console.log('\n--- "all accounts" really means all accounts ---');
  const excl=await P.pg.evaluate(()=>{
    const planOnly=_activePlanDebts().reduce((a,d)=>a+Math.min(d.balance,(minPaymentFloors(d).now||d.minPayment)),0);
    const all=allMinimumsTotal();
    const excluded=debts.filter(d=>d.balance>0&&d.includeInStrategy===false).map(d=>d.name);
    return { planOnly:Math.round(planOnly), all:Math.round(all), excluded, diff:Math.round(all-planOnly) };
  });
  ck('Money Plan counts excluded debts that the plan summary omits',
     excl.all>excl.planOnly && excl.excluded.length>0,
     `plan-only ${excl.planOnly}, all ${excl.all} (+${excl.diff} from ${excl.excluded.join(', ')})`);

  console.log('\n--- match button ---');
  const match=await P.pg.evaluate(()=>{
    setPlanBudget(0); render();
    const btn=document.getElementById('plan-budget-match');
    const shownWhenUnset=getComputedStyle(btn).display!=='none';
    const label=btn.textContent;
    planBudgetMatchCommitted();
    render();
    return { shownWhenUnset, label, budget:Math.round(monthlyBudget),
             committed:Math.round(committedMonthlyTotal()),
             hiddenAfter:getComputedStyle(document.getElementById('plan-budget-match')).display==='none' };
  });
  ck('match button offers the committed total, then hides once adopted',
     match.shownWhenUnset && match.budget===match.committed && match.hiddenAfter,
     `${match.label} -> budget ${match.budget}`);

  console.log('\n--- free tier: bills are premium, budget is not ---');
  const F=await boot(b,false);
  const free=await F.pg.evaluate(()=>{
    bills.push({id:900009,name:'Rent',amount:1200,dueDay:1});
    setPlanBudget(2000); render();
    return { breakdown:document.getElementById('plan-budget-breakdown').textContent,
             line:document.getElementById('plan-budget-line').textContent,
             cardVisible:getComputedStyle(document.getElementById('budget-card')).display!=='none',
             title:document.querySelector('#budget-card .card-title').textContent.trim() };
  });
  ck('free tier gets the budget check', free.cardVisible && /budget/.test(free.line), free.line);
  ck('free tier breakdown excludes bills (premium data)', !/bills/.test(free.breakdown), free.breakdown);
  ck('card is titled Monthly Money Plan', /Monthly Money Plan/.test(free.title), free.title);
  ck('no JS errors (free)', F.errs.length===0, F.errs.slice(0,2).join(' | ')||'none');
  await F.ctx.close();

  console.log('\n--- persistence ---');
  const round=await P.pg.evaluate(()=>{
    setPlanBudget(2750);
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    monthlyBudget=0;
    applyBackupPayload(snap);
    return { inPayload:snap.monthlyBudget, restored:monthlyBudget };
  });
  ck('budget rides in the backup payload and restores', round.inPayload===2750 && round.restored===2750,
     `payload ${round.inPayload}, restored ${round.restored}`);
  const updPath=await P.pg.evaluate(()=>/monthlyBudget: monthlyBudget,\s+\/\/ v1\.42\.0/.test(document.documentElement.innerHTML));
  ck('the UPDATE-restore payload carries it too', updPath);
  const junk=await P.pg.evaluate(()=>{
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    snap.monthlyBudget='nonsense'; applyBackupPayload(snap); const a=monthlyBudget;
    snap.monthlyBudget=-40; applyBackupPayload(snap); const c=monthlyBudget;
    return [a,c];
  });
  ck('a junk or negative budget sanitizes to 0', JSON.stringify(junk)==='[0,0]', JSON.stringify(junk));
  ck('no JS errors (premium)', P.errs.length===0, P.errs.slice(0,2).join(' | ')||'none');

  console.log(`\n${R.every(Boolean)?'ALL PASS':'FAILURES PRESENT'}  (${R.filter(Boolean).length}/${R.length})`);
  await b.close(); process.exit(R.every(Boolean)?0:1);
})();
