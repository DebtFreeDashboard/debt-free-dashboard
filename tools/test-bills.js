/* test-bills.js — recurring bills (premium), v1.42.0 */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const CHART=fs.readFileSync(path.join(__dirname,'../node_modules/chart.js/dist/chart.umd.js'),'utf8');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-primary.json'),'utf8'));
const R=[]; const ck=(l,ok,d)=>{R.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${l}`);if(d)console.log('      '+d);};

async function boot(b,premium,at){
  const ctx=await b.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  await ctx.route('**/chart.umd.min.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:CHART}));
  await ctx.route('**/googletagmanager.com/**',r=>r.abort()); await ctx.route('**/clarity.ms/**',r=>r.abort());
  await ctx.addInitScript(p=>{try{localStorage.setItem('debtfree_last_seen_version','99.0.0');
    localStorage.setItem('debtfree_demo_dismissed','1'); if(p)localStorage.setItem('debtfree_premium','K');}catch(e){}},premium);
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  if(at) await pg.clock.install({time:new Date(at)});
  await pg.goto('file://'+path.join(__dirname,'site/app/dashboard.html'));
  await pg.waitForTimeout(900);
  await pg.evaluate(f=>{applyBackupPayload(f);},FX);
  if(premium) await pg.evaluate(()=>{isPremium=true;applyPremiumState();render();});
  await pg.waitForTimeout(900);
  return {pg,ctx,errs};
}

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const P=await boot(b,true,'2026-02-10T09:00:00');

  console.log('--- add / edit / remove ---');
  const add=await P.pg.evaluate(()=>{
    document.getElementById('bill-name').value='Rent';
    document.getElementById('bill-amount').value='1,200';
    document.getElementById('bill-due-day').value='1';
    addBill();
    document.getElementById('bill-name').value='Phone';
    document.getElementById('bill-amount').value='85';
    document.getElementById('bill-due-day').value='20';
    addBill();
    return { count:bills.length, total:billsMonthlyTotal(), ids:bills.map(x=>x.id),
             parsedComma:bills[0].amount, rows:document.querySelectorAll('#bills-list .bill-row').length,
             totalText:document.getElementById('bills-total').textContent };
  });
  ck('two bills added, comma amount parsed', add.count===2 && add.parsedComma===1200, `total ${add.total}, first ${add.parsedComma}`);
  ck('rows render with a running total', add.rows===2 && /2 bills/.test(add.totalText), add.totalText);

  const uniq=await P.pg.evaluate(()=>{
    const debtIds=debts.map(d=>d.id), billIds=bills.map(b=>b.id);
    return { collision: billIds.some(id=>debtIds.includes(id)), debtIds:debtIds.slice(0,3), billIds };
  });
  ck('bill ids cannot collide with debt ids (shared nextId)', uniq.collision===false,
     `debts ${uniq.debtIds}... bills ${uniq.billIds}`);

  const val=await P.pg.evaluate(()=>{
    document.getElementById('bill-name').value='';
    document.getElementById('bill-amount').value='50';
    addBill();
    const e1=document.getElementById('bill-error').textContent;
    document.getElementById('bill-name').value='Gym';
    document.getElementById('bill-amount').value='';
    addBill();
    const e2=document.getElementById('bill-error').textContent;
    return { e1, e2, count:bills.length };
  });
  ck('a nameless or priceless bill is rejected, nothing added', val.count===2, `${val.count} bills`);
  ck('errors are plain language', /name/i.test(val.e1) && /cost/i.test(val.e2), `"${val.e1}" / "${val.e2}"`);

  const edit=await P.pg.evaluate(()=>{
    updateBill(bills[1].id,'amount','95');
    updateBill(bills[1].id,'dueDay','40');     // invalid -> null, not 40
    return { amount:bills[1].amount, day:bills[1].dueDay };
  });
  ck('inline edit writes back, bad due day sanitizes', edit.amount===95 && edit.day===null, JSON.stringify(edit));

  console.log('\n--- bills appear on Coming Up beside debts ---');
  const merged=await P.pg.evaluate(()=>{
    payments.length=0;
    debts.forEach(d=>{d.dueDay=null;});
    debts[0].dueDay=12;                       // 2 days out
    bills[0].dueDay=13; bills[1].dueDay=14;
    render();
    const rows=upcomingDues();
    const card=document.getElementById('upcoming-card');
    return { names:rows.map(r=>r.name+':'+(r.kind||'debt')),
             text:card.innerText.replace(/\n+/g,' | '),
             logButtons:card.querySelectorAll('.due-row-log').length,
             // part 4 replaced the passive "bill" label with a tick control
             billTicks:card.querySelectorAll('.due-row-tick').length };
  });
  ck('debts and bills share the card', merged.names.length===3, merged.names.join(', '));
  ck('debt rows offer Log, bill rows offer a tick (payments track debts, not bills)',
     merged.logButtons===1 && merged.billTicks===2, `${merged.logButtons} log, ${merged.billTicks} ticks`);

  const rollFwd=await P.pg.evaluate(()=>{
    bills[0].dueDay=3;                        // already passed on Feb 10
    const r=upcomingDues().find(x=>x.kind==='bill'&&x.name==='Rent');
    return { status:r.status, month:r.date.getMonth(), days:r.days };
  });
  ck('a passed bill rolls to next month rather than nagging',
     rollFwd.status!=='passed' && rollFwd.month===2, `status ${rollFwd.status}, month ${rollFwd.month} (2=Mar), in ${rollFwd.days}d`);

  console.log('\n--- free tier sees nothing of bills ---');
  const F=await boot(b,false,'2026-02-10T09:00:00');
  const free=await F.pg.evaluate(()=>{
    bills.push({id:999001,name:'Rent',amount:1200,dueDay:12});
    debts.forEach(d=>{d.dueDay=null;}); debts[0].dueDay=12; payments.length=0;
    render();
    const card=document.getElementById('upcoming-card');
    return { rows:upcomingDues().length,
             billsCard:getComputedStyle(document.getElementById('bills-card')).display,
             teaser:getComputedStyle(document.getElementById('bills-teaser')).display,
             mentionsRent:/Rent/.test(card.innerText) };
  });
  ck('free tier: bills excluded from Coming Up', free.rows===1 && !free.mentionsRent, `${free.rows} row`);
  ck('free tier: bills card hidden, teaser shown', free.billsCard==='none' && free.teaser!=='none');
  ck('no JS errors (free)', F.errs.length===0, F.errs.slice(0,2).join(' | ')||'none');
  await F.ctx.close();

  console.log('\n--- persistence: the 1.38/1.40 trap ---');
  const round=await P.pg.evaluate(()=>{
    bills.length=0;
    bills.push({id:900001,name:'Rent',amount:1200,dueDay:1});
    bills.push({id:900002,name:'Phone',amount:85,dueDay:20});
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    bills.length=0;                            // wipe live state only
    applyBackupPayload(snap);
    return { inPayload:(snap.bills||[]).length, restored:bills.map(b=>b.name+'/'+b.amount+'/'+b.dueDay) };
  });
  ck('bills ride in buildBackupPayload', round.inPayload===2, `${round.inPayload} in payload`);
  ck('bills restore intact', JSON.stringify(round.restored)==='["Rent/1200/1","Phone/85/20"]', JSON.stringify(round.restored));

  const upd=await P.pg.evaluate(()=>{
    // the update-restore payload is a separate object literal from the backup one
    const src=document.documentElement.innerHTML;
    return { updatePayloadHasBills: /bills: bills,\s+\/\/ v1\.42\.0/.test(src) };
  });
  ck('the UPDATE-restore payload carries bills too (not just backup)', upd.updatePayloadHasBills);

  const junk=await P.pg.evaluate(()=>{
    const snap=JSON.parse(JSON.stringify(buildBackupPayload()));
    snap.bills=[{name:'',amount:50},{name:'OK',amount:'abc',dueDay:99},{name:'Fine',amount:12,dueDay:5},null,'x'];
    applyBackupPayload(snap);
    return bills.map(b=>b.name+'/'+b.amount+'/'+b.dueDay);
  });
  ck('a hand-edited backup with junk bills is sanitized, not crashed',
     JSON.stringify(junk)==='["OK/0/null","Fine/12/5"]', JSON.stringify(junk));

  console.log('\n--- the engine still must not know bills exist ---');
  // The invariant is "identical with and without bills" measured in the SAME
  // state — not equality with a number computed elsewhere. Earlier steps in this
  // file cleared `payments`, which legitimately moves month-1 netting, and the
  // clock is pinned to February; a hardcoded expectation would be comparing
  // against a different world.
  const eng=await P.pg.evaluate(()=>{
    const read=()=>{ _planSimCache={key:null,res:null}; const s=getPlanSim();
                     return { months:s.months, interest:Math.round(s.totalInterest*100)/100 }; };
    bills.length=0;
    const without=read();
    bills.push({id:900003,name:'Rent',amount:5000,dueDay:1});
    bills.push({id:900004,name:'Storage',amount:250,dueDay:9});
    const withBills=read();
    return { without, withBills };
  });
  ck('$5,250 of bills changes nothing about the payoff plan',
     eng.without.months===eng.withBills.months && eng.without.interest===eng.withBills.interest,
     `without ${eng.without.months}mo/$${eng.without.interest} vs with ${eng.withBills.months}mo/$${eng.withBills.interest}`);
  ck('no JS errors (premium)', P.errs.length===0, P.errs.slice(0,2).join(' | ')||'none');

  console.log(`\n${R.every(Boolean)?'ALL PASS':'FAILURES PRESENT'}  (${R.filter(Boolean).length}/${R.length})`);
  await b.close(); process.exit(R.every(Boolean)?0:1);
})();
