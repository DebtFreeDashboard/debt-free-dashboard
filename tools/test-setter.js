/* test-setter.js — batch due-date setter + due dates at every listing site */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const CHART=fs.readFileSync(path.join(__dirname,'../node_modules/chart.js/dist/chart.umd.js'),'utf8');
const FX=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-primary.json'),'utf8'));
FX.debts.forEach(d=>{delete d.dueDay;});                 // launch-day state
const R=[]; const ck=(l,ok,d)=>{R.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${l}`);if(d)console.log('      '+d);};

async function boot(b, premium){
  const ctx=await b.newContext({viewport:{width:402,height:874},isMobile:true,hasTouch:true});
  await ctx.route('**/chart.umd.min.js',r=>r.fulfill({status:200,contentType:'application/javascript',body:CHART}));
  await ctx.route('**/googletagmanager.com/**',r=>r.abort()); await ctx.route('**/clarity.ms/**',r=>r.abort());
  await ctx.addInitScript(p=>{try{localStorage.setItem('debtfree_last_seen_version','99.0.0');
    localStorage.setItem('debtfree_demo_dismissed','1'); if(p) localStorage.setItem('debtfree_premium','K');}catch(e){}},premium);
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
  const {pg,ctx,errs}=await boot(b,false);

  console.log('--- launch day: invitation, not an empty card and not fake dates ---');
  const inv=await pg.evaluate(()=>{
    const c=document.getElementById('upcoming-card');
    return { shown:getComputedStyle(c).display!=='none', text:c.innerText.replace(/\n+/g,' | '),
             hasBtn:!!c.querySelector('.due-invite-go'),
             anyDueDaySet: debts.some(d=>d.dueDay) };
  });
  ck('invitation shows instead of hiding', inv.shown && inv.hasBtn, inv.text.slice(0,110));
  ck('NO due date was invented for any debt', inv.anyDueDaySet===false, 'all dueDay still null');

  console.log('\n--- the setter lists every active debt at once ---');
  const open=await pg.evaluate(()=>{
    openDueSetter();
    const m=document.getElementById('duedates-modal');
    return { open:!m.classList.contains('hidden'),
             rows:document.querySelectorAll('#duedates-list .dd-row').length,
             active:debts.filter(d=>d.balance>0).length,
             masked:Array.from(document.querySelectorAll('#duedates-list .dd-input')).every(i=>i.getAttribute('data-clarity-mask')==='true') };
  });
  ck('one row per active debt, no modal-per-debt trip', open.open && open.rows===open.active,
     `${open.rows} rows for ${open.active} active debts`);
  ck('setter inputs are Clarity-masked (v1.41.2 rule holds for new fields)', open.masked);

  console.log('\n--- validation is all-or-nothing ---');
  const bad=await pg.evaluate(()=>{
    const ins=document.querySelectorAll('#duedates-list .dd-input');
    ins[0].value='15'; ins[1].value='40'; ins[2].value='7';   // middle one invalid
    saveDueSetter();
    return { err:document.getElementById('duedates-error').style.display,
             msg:document.getElementById('duedates-error').textContent,
             stillOpen:!document.getElementById('duedates-modal').classList.contains('hidden'),
             saved:debts.slice(0,3).map(d=>d.dueDay) };
  });
  ck('a bad day blocks the whole save — nothing is half-written',
     bad.stillOpen && JSON.stringify(bad.saved)==='[null,null,null]', `saved: ${JSON.stringify(bad.saved)}`);
  ck('error names the problem without jargon', /1-31/.test(bad.msg), bad.msg);

  const good=await pg.evaluate(()=>{
    const ins=document.querySelectorAll('#duedates-list .dd-input');
    ins[1].value='';                       // blank is allowed
    saveDueSetter();
    return { closed:document.getElementById('duedates-modal').classList.contains('hidden'),
             saved:debts.slice(0,3).map(d=>d.dueDay) };
  });
  ck('valid save writes all rows, blanks stay null',
     good.closed && JSON.stringify(good.saved)==='[15,null,7]', JSON.stringify(good.saved));

  console.log('\n--- due dates appear wherever a debt is listed ---');
  const free=await pg.evaluate(()=>{
    render();
    const list=document.getElementById('debt-list');
    const tags=list.querySelectorAll('.due-tag');
    // innerText reflects text-transform, so the label renders uppercase.
    return { tags:tags.length, sample:tags[0]?tags[0].textContent:'', listText:/\bdue\b/i.test(list.innerText) };
  });
  // Exactly two debts were given days above, so exactly two tags is correct.
  ck('free-tier debt cards show a due tag for each debt that has one',
     free.tags===2 && free.listText, `${free.tags} tags, e.g. "${free.sample}"`);

  const inviteGone=await pg.evaluate(()=>{
    debts.filter(d=>d.balance>0).forEach((d,i)=>{ d.dueDay=(i%28)+1; });
    render();
    return !!document.getElementById('upcoming-card').querySelector('.due-invite-go');
  });
  ck('invitation disappears once every debt has a day', inviteGone===false);

  const dismissed=await pg.evaluate(()=>{
    debts.forEach(d=>{d.dueDay=null;});
    dismissDueInvite();
    render();
    const c=document.getElementById('upcoming-card');
    return { display:getComputedStyle(c).display, flag:localStorage.getItem('debtfree_due_prompt_dismissed') };
  });
  ck('"Not now" hides it for good', dismissed.display==='none' && dismissed.flag==='1');
  ck('no JS errors (free)', errs.length===0, errs.slice(0,2).join(' | ')||'none');
  await ctx.close();

  console.log('\n--- premium portfolio table ---');
  const P=await boot(b,true);
  const prem=await P.pg.evaluate(()=>{
    debts.filter(d=>d.balance>0).forEach((d,i)=>{ d.dueDay=(i%28)+1; });
    render(); renderStrategy();
    const t=document.getElementById('portfolio-table')||document.querySelector('.pf-table,table');
    const tags=document.querySelectorAll('.pf-name .due-tag');
    return { tags:tags.length, sample:tags[0]?tags[0].textContent:'',
             cols:document.querySelectorAll('thead .pf-th').length };
  });
  ck('portfolio table shows due tags in the name cell', prem.tags>=2, `${prem.tags} tags, e.g. "${prem.sample}"`);
  ck('no new column was added (table stays readable on a phone)', prem.cols<=8, `${prem.cols} columns`);

  const overflow=await P.pg.evaluate(()=>({o:document.documentElement.scrollWidth>window.innerWidth}));
  ck('no horizontal page overflow at 402px', overflow.o===false);
  ck('no JS errors (premium)', P.errs.length===0, P.errs.slice(0,2).join(' | ')||'none');

  console.log(`\n${R.every(Boolean)?'ALL PASS':'FAILURES PRESENT'}  (${R.filter(Boolean).length}/${R.length})`);
  await b.close(); process.exit(R.every(Boolean)?0:1);
})();
