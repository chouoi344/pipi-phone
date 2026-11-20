'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../lib/engine/modules/outreach.cjs'),Schedule=require('../lib/engine/modules/schedule.cjs');
const NOW=Date.parse('2026-11-17T10:00:00Z'),MIN=60000;
function fixture(){const s={roles:[{id:'r',name:'测试角色',prompt:'职员',outreachEnabled:true,permissions:{}}],messages:[],settings:{timezone:'UTC',modules:{}},engine:{data:{}}};Schedule.saveForRole(s,'r',{slots:[{start:'00:00',end:'08:00',activity:'夜间熟睡',restType:'night_sleep'},{start:'08:00',end:'23:59',activity:'自由阅读',phone:'free',restType:'none'}]},NOW);s.engine.data.outreach={records:{r:{day:'2026-11-17',count:0,photos:0,unanswered:0,nextDueAt:NOW-1,firedKeys:[]}}};return s;}
async function start(s,now=NOW){let entry;await O.jobs[0].run({getState:()=>s,mutate:fn=>fn(s),isBusy:()=>false,initiate:(id,e)=>{entry=e;return true;},now});return entry;}
test('changing global intervals updates an inherited active wait and holds, preserving friend overrides and counters',async()=>{
 const R=require('../lib/engine/registry.cjs'),s=fixture(),saved=s.engine.data.outreach;
 s.roles.push({...s.roles[0],id:'mine'});
 R.apply(s,'outreach',{minIdleMinutes:90,maxIdleMinutes:90,holdMinutes:120},NOW);
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);
 O.saveRoleSettings(s,'mine',{mode:'custom',minIdleMinutes:45,maxIdleMinutes:45,holdMinutes:60},NOW);
 saved.records={};await start(s);
 const mine=saved.records.mine,first=saved.records.r;
 assert.equal(first.nextDueAt,NOW+90*MIN);assert.equal(mine.nextDueAt,NOW+45*MIN);
 saved.holds={mine:{createdAt:NOW,dueAt:NOW+60*MIN,attempts:1},r:{createdAt:NOW,dueAt:NOW+120*MIN,attempts:0}};
 const mineBefore=structuredClone(mine),mineHold=structuredClone(saved.holds.mine);
 R.apply(s,'outreach',{minIdleMinutes:5,maxIdleMinutes:5,holdMinutes:30},NOW+2*MIN);
 assert.equal(first.nextDueAt,NOW+5*MIN);assert.equal(saved.holds.r.dueAt,NOW+30*MIN);
 assert.deepEqual(mine,mineBefore);assert.deepEqual(saved.holds.mine,mineHold);
 const withoutHold=structuredClone(s);delete withoutHold.engine.data.outreach.holds.r;
 assert.equal((await start(withoutHold,NOW+6*MIN)).outreach.kind,'timed');
 assert.equal((await start(s,NOW+30*MIN)).outreach.kind,'hold');
});
test('a changed busy follow-up time is effective even when the ordinary frequency is longer',async()=>{
 const R=require('../lib/engine/registry.cjs'),s=fixture();
 R.apply(s,'outreach',{minIdleMinutes:90,maxIdleMinutes:90,holdMinutes:120},NOW);
 s.messages.push({id:'u',roleId:'r',sender:'user',content:'等我忙完',status:'pending',createdAt:NOW});
 O.hooks.afterReceive({getState:()=>s,mutate:fn=>fn(s),roleId:'r',now:NOW});
 R.apply(s,'outreach',{holdMinutes:30},NOW+10*MIN);
 assert.equal(await start(s,NOW+29*MIN),undefined);assert.equal((await start(s,NOW+30*MIN)).outreach.kind,'hold');
});
test('follow schedule uses the saved custom values when today has no plan',async()=>{
 const s=fixture();
 O.saveRoleSettings(s,'r',{minIdleMinutes:75,maxIdleMinutes:100,enabled:true},NOW);
 delete s.engine.data.schedule.days.r;
 assert.equal(O.view(s,'r',NOW).settings.mode,'schedule');
 assert.equal(O.effectiveSettings(s,'r',null).minIdleMinutes,75);
 const entry=await start(s);
 assert.equal(entry.outreach.kind,'timed');
 assert.equal(entry.allowNoAction,false);
 assert(O.validate(s,'r',entry.outreach,NOW));
 assert(entry.instruction.includes('生活事实：{}'));
 assert.throws(()=>O.saveRoleSettings(s,'r',{mode:'invalid'}));
});
test('custom retains quiet, quotas and holds while mode changes invalidate pending messages',async()=>{for(const blocked of ['quiet','daily','unanswered','hold']){const s=fixture();delete s.engine.data.schedule.days.r;O.saveRoleSettings(s,'r',{mode:'custom'});if(blocked==='quiet')s.settings.modules.outreach={quietStart:'09:00',quietEnd:'11:00'};const rec=s.engine.data.outreach.records.r;if(blocked==='daily')rec.count=5;if(blocked==='unanswered')rec.unanswered=2;if(blocked==='hold')s.engine.data.outreach.holds={r:{createdAt:NOW,dueAt:NOW+MIN}};assert.equal(await start(s),undefined,blocked);}for(const mode of ['schedule','custom']){const s=fixture();O.saveRoleSettings(s,'r',{mode},NOW);s.engine.data.outreach.records.r.nextDueAt=NOW-1;const e=await start(s);assert(O.validate(s,'r',e.outreach,NOW));O.saveRoleSettings(s,'r',{mode:mode==='schedule'?'custom':'schedule'});assert.equal(O.validate(s,'r',e.outreach,NOW),false);}});

test('global default mode changes only friends without a saved choice',()=>{
 const s=fixture();
 s.roles.push({...s.roles[0],id:'legacy'});
 s.engine.data.outreach.settings={legacy:{mode:'schedule',minIdleMinutes:75,maxIdleMinutes:85}};
 O.saveRoleSettings(s,'r',{enabled:true,historyCount:12},NOW);
 assert.equal(O.view(s,'r',NOW).inheritedMode,true);
 s.settings.modules.outreach={mode:'custom',holdMinutes:90};
 assert.equal(O.view(s,'r',NOW).settings.mode,'custom');
 assert.equal(O.view(s,'r',NOW).settings.holdMinutes,90);
 assert.equal(O.view(s,'r',NOW).settings.historyCount,12);
 assert.equal(O.view(s,'legacy',NOW).settings.mode,'schedule');
 assert.equal(O.view(s,'legacy',NOW).settings.minIdleMinutes,75);
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);
 s.settings.modules.outreach.mode='schedule';
 assert.equal(O.view(s,'r',NOW).inheritedMode,false);
 assert.equal(O.view(s,'r',NOW).settings.mode,'custom');
});

test('global quiet hours cross midnight and govern both modes even with legacy friend values',async()=>{
 for(const mode of ['schedule','custom']){
  const s=fixture();
  s.engine.data.outreach.settings={r:{mode,quietHoursEnabled:false,quietStart:'06:00',quietEnd:'07:00'}};
  s.settings.modules.outreach={quietHoursEnabled:true,quietStart:'22:00',quietEnd:'10:30'};
  O.saveRoleSettings(s,'r',{historyCount:12,quietHoursEnabled:false,quietEnd:'07:00'},NOW);
  assert.equal(O.view(s,'r',NOW).settings.quietEnd,'10:30');
  assert.equal(O.allowsAutomatic(s,'r',NOW),false);
  assert.equal(await start(s),undefined);
  const afterQuiet=NOW+30*MIN,entry=await start(s,afterQuiet);
  assert(O.validate(s,'r',entry.outreach,afterQuiet));
  s.settings.modules.outreach.quietEnd='11:00';
  assert.equal(O.validate(s,'r',entry.outreach,afterQuiet),false);
  s.settings.modules.outreach.quietHoursEnabled=false;
  assert.equal(O.allowsAutomatic(s,'r',afterQuiet),true);
 }
});

test('global values remain defaults and a custom edit only overrides the edited friend',()=>{
 const s=fixture();
 s.roles.push({...s.roles[0],id:'other'});
 const R=require('../lib/engine/registry.cjs');
 R.apply(s,'outreach',{holdMinutes:90,maxUnanswered:6});
 O.saveRoleSettings(s,'r',{mode:'custom',holdMinutes:75},NOW);
 assert.equal(O.effectiveSettings(s,'r',null).holdMinutes,75);
 assert.equal(O.effectiveSettings(s,'r',null).maxUnanswered,6);
 assert.equal(O.effectiveSettings(s,'other',null).holdMinutes,90);
 assert.equal(R.values(s,'outreach').holdMinutes,90);
 R.apply(s,'outreach',{holdMinutes:120,maxUnanswered:7});
 assert.equal(O.effectiveSettings(s,'r',null).holdMinutes,75);
 assert.equal(O.effectiveSettings(s,'r',null).maxUnanswered,7);
 assert.equal(O.effectiveSettings(s,'other',null).holdMinutes,120);
});
test('custom sends through a meeting but wakes with only one contact after sleep',async()=>{
 const s=fixture();
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);
 const rec=s.engine.data.outreach.records.r;
 const slot=s.engine.data.schedule.days.r.slots.find(x=>x.phone==='free');
 rec.nextDueAt=NOW-120*MIN;
 slot.restType='nap';
 assert.equal(await start(s),undefined);
 assert.equal(await start(s,NOW+10*MIN),undefined);
 assert.equal(rec.nextDueAt,NOW-120*MIN);
 slot.restType='none';
 slot.phone='offline';
 slot.activity='正在开会';
 const wake=NOW+20*MIN,entry=await start(s,wake);
 assert.equal(entry.outreach.kind,'timed');
 assert.equal(entry.allowNoAction,false);
 assert(O.validate(s,'r',entry.outreach,wake));
 O.commit(s,'r',entry.outreach,{now:wake,text:'午间休息之后想跟你说一声'});
 O.errorRelease(s,'r',entry.outreach,{now:wake});
 assert.equal(O.view(s,'r',wake).count,1);
 assert.equal(await start(s,wake+MIN),undefined);
});
test('defaults and per-role validation preserve zero unlimited without independent models',()=>{const s=fixture();assert.equal(O.settingsFor(s,'r').minIdleMinutes,60);assert.equal(O.settingsFor(s,'r').maxIdleMinutes,90);assert.equal(O.settingsFor(s,'r').dailyMaxPerRole,5);assert.equal(O.settingsFor(s,'r').holdMinutes,60);assert.equal(O.settingsFor(s,'r').maxUnanswered,4);O.saveRoleSettings(s,'r',{maxUnanswered:0});assert.equal(O.view(s,'r',NOW).settings.maxUnanswered,0);assert.equal(O.settingsFor(s,'r').maxUnanswered,4);assert.throws(()=>O.saveRoleSettings(s,'r',{minIdleMinutes:100,maxIdleMinutes:50}));assert.throws(()=>O.saveRoleSettings(s,'r',{holdMinutes:361}));assert.equal(O.nextDue(NOW,O.settingsFor(s,'r'),()=>0),NOW+60*MIN);assert.equal(O.nextDue(NOW,O.settingsFor(s,'r'),()=>1),NOW+90*MIN);});
test('skip and generation failure release without spending counts or completing facts',async()=>{const s=fixture(),entry=await start(s);assert(entry.allowNoAction);assert.equal(O.view(s,'r',NOW).count,0);assert(O.validate(s,'r',entry.outreach,NOW));O.errorRelease(s,'r',entry.outreach,{now:NOW,error:'模拟失败'});assert.equal(O.view(s,'r',NOW).count,0);assert.equal(O.view(s,'r',NOW).unanswered,0);assert(O.view(s,'r',NOW).nextDueAt>=NOW+60*MIN);assert(!O.validate(s,'r',entry.outreach,NOW));});
test('actual delivery counts one round and retains cumulative real messages and photos',async()=>{const s=fixture(),entry=await start(s),ticket=entry.outreach;assert(O.commit(s,'r',ticket,{now:NOW,text:'刚读到有意思的一页'}));assert.equal(O.commit(s,'r',ticket,{now:NOW,text:'刚读到有意思的一页\n想起你说的事',photoCount:1}),false);assert.equal(O.commit(s,'r',ticket,{now:NOW,text:'刚读到有意思的一页\n想起你说的事',photoCount:1}),false);const v=O.view(s,'r',NOW);assert.equal(v.count,1);assert.equal(v.unanswered,1);assert.equal(v.photos,1);assert.equal(O.remainingPhotos(s,'r',NOW),0);O.errorRelease(s,'r',ticket,{now:NOW});s.messages.push({id:'u',roleId:'r',sender:'user',status:'pending',content:'我回来啦'});O.hooks.afterReceive({getState:()=>s,mutate:fn=>fn(s),roleId:'r',now:NOW+MIN});assert.equal(O.view(s,'r',NOW).unanswered,0);assert.deepEqual(s.engine.data.outreach.replyFacts.r,['刚读到有意思的一页\n想起你说的事']);});
test('new incoming message, changed persona, changed activity and expired opportunity cancel before delivery',async()=>{for(const change of [(s)=>s.messages.push({id:'new',sender:'user',roleId:'r'}),(s)=>{s.roles[0].prompt='新身份';},(s)=>{s.engine.data.schedule.days.r.slots.find(x=>x.phone==='free').activity='另一活动';}]){const s=fixture(),entry=await start(s);change(s);assert.equal(O.validate(s,'r',entry.outreach,NOW),false);}const s=fixture(),e=await start(s);assert.equal(O.validate(s,'r',e.outreach,NOW+15*MIN),false);});
test('tell ignores quiet and exhausted daily/unanswered limits, completes only on real text',async()=>{const s=fixture();s.settings.modules.outreach={quietStart:'09:00',quietEnd:'11:00'};Object.assign(s.engine.data.outreach.records.r,{count:5,unanswered:2});const p=Schedule.addPromise(s,'r',{type:'tell',content:'告诉我结果',dueAt:NOW},NOW);const e=await start(s);assert.equal(e.outreach.kind,'promise');assert.equal(p.status,'pending');assert(O.validate(s,'r',e.outreach,NOW));O.commit(s,'r',e.outreach,{now:NOW,text:'这次已经通过了'});assert.equal(p.status,'done');assert.equal(O.view(s,'r',NOW).count,5);assert.equal(O.view(s,'r',NOW).unanswered,2);assert(O.validate(s,'r',e.outreach,NOW));});
test('care uses oldest due within twelve hours and completes only after delivery',async()=>{const s=fixture();const expired=Schedule.addUserEvent(s,'r',{content:'过期事项',dueAt:NOW-20*60*MIN,followUpHours:1},NOW);const due=Schedule.addUserEvent(s,'r',{content:'考试',dueAt:NOW-3*60*MIN,followUpHours:2},NOW);const e=await start(s);assert.equal(e.outreach.refId,due.id);assert.equal(due.status,'pending');O.commit(s,'r',e.outreach,{now:NOW,text:'考试怎么样啦'});assert.equal(due.status,'done');assert.equal(expired.status,'pending');assert(O.validate(s,'r',e.outreach,NOW));});
test('unanswered zero permits further rounds, positive limit blocks',async()=>{const beforeLimit=fixture();beforeLimit.engine.data.outreach.records.r.unanswered=3;assert(await start(beforeLimit));const s=fixture();s.engine.data.outreach.records.r.unanswered=4;assert.equal(await start(s),undefined);O.saveRoleSettings(s,'r',{mode:'custom',maxUnanswered:0},NOW);s.engine.data.outreach.records.r.nextDueAt=NOW-1;assert(await start(s));});
test('wait-for-me holds one hour, quotation and goodnight do not create holds',async()=>{assert(O.contactHold('我忙完来找你'));assert(!O.contactHold('他说，等我忙完'));assert(!O.contactHold('“等我忙完”'));assert(!O.contactHold('晚安'));const s=fixture();s.messages.push({id:'u',roleId:'r',sender:'user',status:'pending',content:'等我忙完'});O.hooks.afterReceive({getState:()=>s,mutate:fn=>fn(s),roleId:'r',now:NOW});assert.equal(O.view(s,'r',NOW).hold.dueAt,NOW+60*MIN);assert.equal(await start(s,NOW+59*MIN),undefined);const e=await start(s,NOW+60*MIN);assert.equal(e.outreach.kind,'hold');O.errorRelease(s,'r',e.outreach,{now:NOW+60*MIN});assert.equal(O.view(s,'r',NOW).hold.attempts,1);});
test('night rest never sends even tell and no automatic moments job remains',async()=>{const s=fixture();s.engine.data.schedule.days.r.slots.find(x=>x.phone==='free').restType='night_sleep';Schedule.addPromise(s,'r',{type:'tell',content:'通知',dueAt:NOW},NOW);assert.equal(await start(s),undefined);assert.deepEqual(O.jobs.map(j=>j.id),['outreach-tick']);});
test('a photo alone cannot fulfill tell; later actual voice or text completes it',async()=>{const s=fixture(),p=Schedule.addPromise(s,'r',{type:'tell',content:'告诉我结果',dueAt:NOW},NOW),e=await start(s);O.commit(s,'r',e.outreach,{now:NOW,photoCount:1});assert.equal(p.status,'pending');O.commit(s,'r',e.outreach,{now:NOW,text:'结果已经通过了',photoCount:1});assert.equal(p.status,'done');assert.equal(O.view(s,'r',NOW).photos,1);assert.equal(O.view(s,'r',NOW).count,0);});
test('meal and bedtime are optional once-daily miss-you opportunities without a goodnight pause',()=>{const s=fixture(),r=s.roles[0],settings=O.settingsFor(s,'r'),rec={day:'2026-11-17',count:0,unanswered:0,nextDueAt:NOW+60*MIN};const base={phone:'free',restType:'none',currentSlot:{activity:'吃午饭',startAt:NOW-5*MIN,endAt:NOW+30*MIN}};assert.equal(O.pickTrigger(s,r,settings,base,rec,rec.day,NOW).kind,'miss_you');assert.equal(O.pickTrigger(s,r,settings,base,{...rec,missYou:1},rec.day,NOW),null);assert.equal(O.pickTrigger(s,r,settings,{...base,currentSlot:{activity:'看书',startAt:NOW-60*MIN,endAt:NOW+10*MIN},nextSlot:{restType:'night_sleep',startAt:NOW+10*MIN}},rec,rec.day,NOW).kind,'miss_you');});

test('schedule preserves custom values without using them until custom is enabled',async()=>{
 const s=fixture();s.settings.modules.outreach={minIdleMinutes:40,maxIdleMinutes:50,holdMinutes:180};
 const custom={minIdleMinutes:5,maxIdleMinutes:10,holdMinutes:30,dailyMaxPerRole:0,dailyPhotoMax:0,maxUnanswered:0,voiceEnabled:false,photoEnabled:false,historyCount:0,customPrompt:'CUSTOM_ONLY'};
 O.saveRoleSettings(s,'r',{mode:'schedule',...custom},NOW);
 assert.deepEqual(Object.fromEntries(Object.keys(custom).map(k=>[k,O.view(s,'r',NOW).settings[k]])),custom);
 const effective=O.settingsFor(s,'r');assert.equal(effective.minIdleMinutes,40);assert.equal(effective.holdMinutes,180);assert.equal(effective.dailyMaxPerRole,5);assert.equal(effective.voiceEnabled,true);assert.equal(effective.customPrompt,'');assert.equal(O.remainingPhotos(s,'r',NOW),1);
 const e=await start(s);assert(e);assert(!e.instruction.includes(custom.customPrompt));
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);assert.equal(O.settingsFor(s,'r').minIdleMinutes,5);assert.equal(O.settingsFor(s,'r').customPrompt,custom.customPrompt);assert.equal(O.remainingPhotos(s,'r',NOW),0);assert.equal(await start(s),undefined);
});
test('mode changes recompute timers and hold deadlines while retaining actual counts',()=>{
 const s=fixture(),rec=s.engine.data.outreach.records.r;O.saveRoleSettings(s,'r',{mode:'custom',minIdleMinutes:5,maxIdleMinutes:5,holdMinutes:30},NOW);
 Object.assign(rec,{count:3,photos:1,unanswered:1,retryAt:NOW+999*MIN,pending:{id:'old',committed:false}});s.engine.data.outreach.holds={r:{createdAt:NOW-10*MIN,dueAt:NOW+20*MIN,retryAt:NOW+999*MIN,attempts:2,notified:true}};
 O.saveRoleSettings(s,'r',{mode:'schedule',minIdleMinutes:7,maxIdleMinutes:7},NOW);
 assert(rec.nextDueAt>=NOW+60*MIN&&rec.nextDueAt<=NOW+90*MIN);assert.equal(rec.retryAt,undefined);assert.equal(rec.pending,undefined);assert.equal(rec.count,3);assert.equal(rec.photos,1);assert.equal(rec.unanswered,1);
 const hold=s.engine.data.outreach.holds.r;assert.equal(hold.dueAt,NOW+50*MIN);assert.equal(hold.retryAt,undefined);assert.equal(hold.attempts,2);assert.equal(hold.notified,true);
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);assert.equal(rec.nextDueAt,NOW+7*MIN);assert.equal(hold.dueAt,NOW+20*MIN);
});
test('already committed contact stays counted once after changing mode',async()=>{
 const s=fixture(),e=await start(s);O.commit(s,'r',e.outreach,{now:NOW,text:'delivered'});
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);assert.equal(O.validate(s,'r',e.outreach,NOW),false);assert.equal(O.commit(s,'r',e.outreach,{now:NOW,text:'delivered'}),false);O.errorRelease(s,'r',e.outreach,{now:NOW});
 const v=O.view(s,'r',NOW);assert.equal(v.count,1);assert.equal(v.unanswered,1);assert.equal(v.pending,null);
});
test('saved custom intervals update the next contact and an existing hold in the same mode',()=>{
 const s=fixture(),rec=s.engine.data.outreach.records.r;
 O.saveRoleSettings(s,'r',{mode:'custom'},NOW);
 const hold={createdAt:NOW-10*MIN,dueAt:NOW+50*MIN,attempts:1};
 s.engine.data.outreach.holds={r:hold};
 O.saveRoleSettings(s,'r',{minIdleMinutes:15,maxIdleMinutes:15,holdMinutes:45},NOW);
 assert.equal(rec.nextDueAt,NOW+15*MIN);
 assert.equal(hold.dueAt,NOW+35*MIN);
 assert.equal(hold.attempts,1);
});
test('glancing at the phone allows contextual contact without a second interval contact',async()=>{
 const s=fixture(),slot=s.engine.data.schedule.days.r.slots.find(x=>x.phone==='free');
 slot.phone='glance';
 slot.startAt=NOW-5*MIN;
 slot.activity='在美术馆看见熟悉的蓝色画作';
 const first=await start(s);
 assert.equal(first.outreach.kind,'miss_you');
 assert.equal(first.allowNoAction,true);
 assert.match(first.instruction,/蓝色画作/);
 O.commit(s,'r',first.outreach,{now:NOW,text:'想起你喜欢的那种蓝'});
 O.errorRelease(s,'r',first.outreach,{now:NOW});
 assert.equal(await start(s,NOW+MIN),undefined);
});

test('explicit reminder takes priority and a matching old promise cannot send it again',async()=>{
 const s=fixture(),J=require('../lib/engine/scheduler.cjs');
 const job=J.add(s,'r',{note:'出门',userRequested:true,schedule:{type:'once',at:NOW}},NOW-MIN);
 Schedule.addPromise(s,'r',{type:'tell',content:'提醒我出门。',dueAt:NOW},NOW-MIN);
 assert.equal(await start(s),undefined);
 const [due]=J.due(s,NOW);
 assert.equal(due.id,job.id);
 J.finish(s,job.id,{now:NOW});
 const entry=await start(s,NOW+MIN);
 assert.notEqual(entry?.outreach.kind,'promise');
});
