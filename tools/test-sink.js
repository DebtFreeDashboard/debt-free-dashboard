/* test-sink.js — sinking funds, v1.43.0. The engine changed here, so most of
   this is about proving it changed only in the way intended. */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const CHART=fs.readFileSync(path.join(__dirname,'../node_modules/chart.js/dist/chart.umd.js'),'utf8');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-primary.json'),'utf8'));
const R=[]; const ck=(l,ok,d)=>{R.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${l}`);if(d)console.log('      '+d);};

async function boot(b,file,premium){
  const ctx=await b.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  await ctx.route('**/chart.umd.min.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:CHART}));
  await ctx.route('**/googletagmanager.com/**',r=>r.abort()); await ctx.route('**/clarity.ms/**',r=>r.abort());
  await ctx.addInitScript(p=>{try{localStorage.setItem('debtfree_last_seen_version','99.0.0');
    localStorage.setItem('debtfree_demo_dismissed','1'); if(p)localStorage.setItem('debtfree_premium','K');}catch(e){}},premium);
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('file://'+path.join(__dirname,file));
  await pg.waitForTimeout(1000);
  await pg.evaluate(f=>{applyBackupPayload(f);},FX);
  if(premium) await pg.evaluate(()=>{isPremium=true;applyPremiumState();render();});
  await pg.waitForTimeout(1000);
  return {pg,ctx,errs};
}
const plan = p => p.evaluate(()=>{_planSimCache={key:null,res:null};const s=getPlanSim();
  return {months:s.months, interest:Math.round(s.totalInterest*100)/100};});

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});

  console.log('--- the engine is untouched when no fund is counted ---');
  const OLD=await boot(b,'dashboard.html',true);      // v1.42.0
  const NEW=await boot(b,'site/app/dashboard.html',true);
  const shape = p => p.evaluate(()=>{const o={};
    ['optimized','avalanche','snowball','hybrid'].forEach(st=>{strategy=st;_planSimCache={key:null,res:null};
      const s=getPlanSim(); o[st]=s.months+'/'+Math.round(s.totalInterest*100)/100;});
    strategy='avalanche'; _planSimCache={key:null,res:null}; return o;});
  const a=await shape(OLD.pg), c=await shape(NEW.pg);
  ck('no funds -> all four strategies identical to v1.42.0', JSON.stringify(a)===JSON.stringify(c),
     JSON.stringify(a));
  const trackOnly=await NEW.pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:300,target:null,counted:false}));
    _planSimCache={key:null,res:null};
    const s=getPlanSim(); return s.months+'/'+Math.round(s.totalInterest*100)/100;});
  ck('a "tracking only" fund of $300/mo changes nothing', trackOnly===c.avalanche, `${trackOnly} vs ${c.avalanche}`);
  await OLD.ctx.close();
  const pg=NEW.pg;

  console.log('\n--- a counted fund moves the date, and by the right amount ---');
  const counted=await pg.evaluate(()=>{
    document.getElementById('extra-payment').value='450'; recalculate();
    sinkingFunds.length=0; _planSimCache={key:null,res:null};
    const base=getPlanSim();
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:150,target:null,counted:true}));
    _planSimCache={key:null,res:null};
    const withFund=getPlanSim();
    // equivalent: the same plan with extra reduced by 150 and no fund
    sinkingFunds.length=0;
    document.getElementById('extra-payment').value='300'; recalculate();
    _planSimCache={key:null,res:null};
    const equiv=getPlanSim();
    document.getElementById('extra-payment').value='450'; recalculate();
    return { base:[base.months,Math.round(base.totalInterest)],
             withFund:[withFund.months,Math.round(withFund.totalInterest)],
             equiv:[equiv.months,Math.round(equiv.totalInterest)] };
  });
  ck('a counted recurring fund pushes the payoff later',
     counted.withFund[0] >= counted.base[0] && counted.withFund[1] >= counted.base[1],
     `base ${counted.base} -> with fund ${counted.withFund}`);
  ck('$150/mo into a fund == $150 less extra (exactly)',
     JSON.stringify(counted.withFund)===JSON.stringify(counted.equiv),
     `fund ${counted.withFund} vs extra-reduced ${counted.equiv}`);

  console.log('\n--- a TARGET fund completes and hands the money back ---');
  const target=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:150,target:600,saved:0,counted:true}));
    const sched=buildSinkSchedule(24);
    const first6=[]; for(let m=1;m<=6;m++) first6.push(sched[m]);
    _planSimCache={key:null,res:null};
    const finite=getPlanSim();
    sinkingFunds[0].target=null;                 // same money, never ends
    _planSimCache={key:null,res:null};
    const forever=getPlanSim();
    return { first6, finite:[finite.months,Math.round(finite.totalInterest)],
             forever:[forever.months,Math.round(forever.totalInterest)] };
  });
  ck('schedule funds $150 x4 then stops', JSON.stringify(target.first6)==='[150,150,150,150,0,0]',
     JSON.stringify(target.first6));
  ck('a finishing fund costs strictly less than a permanent one',
     target.finite[0] <= target.forever[0] && target.finite[1] < target.forever[1],
     `finishes ${target.finite} vs forever ${target.forever}`);

  const partial=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'X',monthly:100,target:250,saved:0,counted:true}));
    const s=buildSinkSchedule(12); return [s[1],s[2],s[3],s[4]];
  });
  ck('the final month is a part payment, not an overpay', JSON.stringify(partial)==='[100,100,50,0]',
     JSON.stringify(partial));

  const alreadySaved=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'X',monthly:100,target:500,saved:300,counted:true}));
    const s=buildSinkSchedule(12); return [s[1],s[2],s[3],fundsMonthlyTotal(true)];
  });
  ck('money already saved shortens the schedule', JSON.stringify(alreadySaved)==='[100,100,0,100]',
     JSON.stringify(alreadySaved));

  const done=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'X',monthly:100,target:500,saved:500,counted:true}));
    _planSimCache={key:null,res:null};
    const s=getPlanSim();
    return { sched:buildSinkSchedule(6)[1], total:fundsMonthlyTotal(false),
             plan:s.months+'/'+Math.round(s.totalInterest*100)/100 };
  });
  ck('a fully funded fund costs nothing and the plan returns to baseline',
     done.sched===0 && done.total===0 && done.plan===c.avalanche, JSON.stringify(done));

  console.log('\n--- monotonicity still holds with a fund running ---');
  const mono=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:200,target:null,counted:true}));
    const out=[];
    for(let e=0;e<=1500;e+=100){
      document.getElementById('extra-payment').value=String(e);
      _planSimCache={key:null,res:null}; recalculate();
      const s=getPlanSim(); out.push([e,s.months,s.totalInterest]);
    }
    document.getElementById('extra-payment').value='450'; recalculate();
    return out;
  });
  let ok=true, viol='';
  for(let i=1;i<mono.length;i++){
    if(mono[i][1]>mono[i-1][1] || mono[i][2]>mono[i-1][2]+0.01){ ok=false;
      viol=`$${mono[i-1][0]}->${mono[i-1][1]}mo then $${mono[i][0]}->${mono[i][1]}mo`; break; }
  }
  ck('sweeping extra $0-$1500 with a $200 fund never worsens months or interest', ok,
     viol||`${mono[0][1]}mo @ $0 -> ${mono[mono.length-1][1]}mo @ $1500`);

  const clamp=await pg.evaluate(()=>{
    document.getElementById('extra-payment').value='100'; recalculate();
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'Big',monthly:5000,target:null,counted:true}));
    _planSimCache={key:null,res:null};
    const s=getPlanSim();
    document.getElementById('extra-payment').value='450'; recalculate();
    return { months:s.months, finite:isFinite(s.months)&&s.months>0 };
  });
  ck('a fund larger than the extra floors at zero, never negative (minimums still paid)',
     clamp.finite, `${clamp.months} months`);

  console.log('\n--- the cache must see fund edits ---');
  const cache=await pg.evaluate(()=>{
    sinkingFunds.length=0; _planSimCache={key:null,res:null};
    const before=getPlanSim().months;             // populates the cache
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:400,target:null,counted:true}));
    const after=getPlanSim().months;              // NO manual cache clear
    return { before, after, keyChanged: before!==after };
  });
  ck('adding a fund invalidates the plan cache without a manual clear',
     cache.keyChanged, `${cache.before} months -> ${cache.after} months`);

  console.log('\n--- cross-tab agreement ---');
  const cross=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:150,target:null,counted:true}));
    _planSimCache={key:null,res:null}; recalculate(); render(); renderStrategy();
    const sim=getPlanSim();
    const rows=amortRowsFor('all');
    return { simMonths:sim.months, amortRows:rows.length,
             simInt:Math.round(sim.totalInterest*100)/100,
             amortInt:Math.round(rows.reduce((a,r)=>a+r.interest,0)*100)/100,
             lastClose:rows.length?rows[rows.length-1].close:null };
  });
  ck('amortization still agrees with the plan once a fund is running',
     cross.simMonths===cross.amortRows && Math.abs(cross.simInt-cross.amortInt)<0.05 && cross.lastClose<0.01,
     `${cross.simMonths}mo/${cross.amortRows} rows, $${cross.simInt}/$${cross.amortInt}`);

  console.log('\n--- money plan counts every fund, counted or not ---');
  const money=await pg.evaluate(()=>{
    sinkingFunds.length=0; bills.length=0;
    sinkingFunds.push(sanitizeFund({name:'A',monthly:150,target:null,counted:true}));
    sinkingFunds.push(sanitizeFund({name:'B',monthly:80,target:null,counted:false}));
    render();
    setPlanBudget(3000);
    render();
    return { breakdown:document.getElementById('plan-budget-breakdown').textContent,
             line:document.getElementById('plan-budget-line').textContent,
             matchBtn:document.getElementById('plan-budget-match').textContent,
             committed:committedMonthlyTotal(),
             mins:allMinimumsTotal(),
             countedOnly:fundsMonthlyTotal(true), all:fundsMonthlyTotal(false) };
  });
  ck('budget check includes a tracking-only fund (the money still leaves)',
     money.all===230 && money.countedOnly===150 && /set aside \$230/.test(money.breakdown),
     money.breakdown);
  // The version that would have caught the NaN: assert the TOTAL, not just the parts.
  ck('committed total is a real number and equals its parts',
     Number.isFinite(money.committed) && Math.abs(money.committed-(money.mins+450+230))<0.01,
     `committed ${money.committed}, parts ${money.mins}+450+230`);
  ck('no rendered money figure is NaN',
     ![money.breakdown,money.line,money.matchBtn].some(t=>/NaN/.test(t)),
     [money.breakdown,money.line,money.matchBtn].filter(t=>/NaN/.test(t)).join(' | ')||'clean');

  console.log('\n--- persistence ---');
  const round=await pg.evaluate(()=>{
    sinkingFunds.length=0;
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:150,target:2000,saved:400,counted:true}));
    sinkingFunds.push(sanitizeFund({name:'Ins',monthly:100,target:null,saved:0,counted:false}));
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    sinkingFunds.length=0;
    applyBackupPayload(snap);
    return sinkingFunds.map(f=>[f.name,f.monthly,f.target,f.saved,f.counted].join('/'));
  });
  ck('funds ride in the backup and restore exactly',
     JSON.stringify(round)==='["Car/150/2000/400/true","Ins/100//0/false"]', JSON.stringify(round));
  const updPath=await pg.evaluate(()=>/sinkingFunds: sinkingFunds,\s+\/\/ v1\.43\.0/.test(document.documentElement.innerHTML));
  ck('the UPDATE-restore payload carries funds too', updPath);
  const junk=await pg.evaluate(()=>{
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    snap.sinkingFunds=[{name:'',monthly:5},{name:'A',monthly:'x',target:-4,saved:-9},
                       {name:'B',monthly:50,target:100,saved:999},null,'z'];
    applyBackupPayload(snap);
    return sinkingFunds.map(f=>[f.name,f.monthly,f.target,f.saved].join('/'));
  });
  ck('junk funds in a hand-edited backup sanitize rather than crash',
     JSON.stringify(junk)==='["A/0//0","B/50/100/100"]', JSON.stringify(junk));

  console.log('\n--- free tier ---');
  const F=await boot(b,'site/app/dashboard.html',false);
  const free=await F.pg.evaluate(()=>{
    sinkingFunds.push(sanitizeFund({name:'Car',monthly:300,target:null,counted:true}));
    _planSimCache={key:null,res:null}; render();
    return { card:getComputedStyle(document.getElementById('funds-card')).display,
             teaser:getComputedStyle(document.getElementById('funds-teaser')).display,
             breakdown:document.getElementById('plan-budget-breakdown').textContent };
  });
  ck('free tier: card hidden, teaser shown, funds absent from the budget line',
     free.card==='none' && free.teaser!=='none' && !/set aside/.test(free.breakdown), free.breakdown);
  ck('no JS errors (free)', F.errs.length===0, F.errs.slice(0,2).join(' | ')||'none');
  ck('no JS errors (premium)', NEW.errs.length===0, NEW.errs.slice(0,2).join(' | ')||'none');

  console.log(`\n${R.every(Boolean)?'ALL PASS':'FAILURES PRESENT'}  (${R.filter(Boolean).length}/${R.length})`);
  await b.close(); process.exit(R.every(Boolean)?0:1);
})();
