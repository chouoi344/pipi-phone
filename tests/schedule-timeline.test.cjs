'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Timeline=require('../lib/engine/schedule-timeline.cjs'),D=require('../lib/engine/schedule-data.cjs');
test('business day spans midnight and timeline covers its two ends',()=>{const tz='UTC',at=Date.parse('2026-11-18T02:00:00Z');assert.equal(Timeline.day(at,tz),'2026-11-17');const slots=Timeline.normalize([{start:'00:00',end:'08:00',activity:'夜间熟睡',restType:'night_sleep'},{start:'08:00',end:'23:59',activity:'日常活动'}],'2026-11-17',tz);assert.equal(slots[0].startAt,Date.parse('2026-11-17T07:00:00Z'));assert.equal(slots.at(-1).endAt,Date.parse('2026-11-18T07:00:00Z'));assert(slots.find(x=>x.startAt<=at&&at<x.endAt).restType==='night_sleep');});
test('rewrite preserves elapsed minutes and unrelated future slots',()=>{const key='2026-11-17',tz='UTC',at=Date.parse(key+'T10:30:00Z'),base=Timeline.timeline([{start:'09:00',end:'12:00',activity:'工作'},{start:'12:00',end:'14:00',activity:'午饭'},{start:'14:00',end:'18:00',activity:'办事'}],key,tz);const next=Timeline.merge(base,[{start:'10:00',end:'11:00',activity:'休息'}],at,key,tz);assert.deepEqual(next.map(x=>[x.start,x.end,x.activity]),[['09:00','10:30','工作'],['10:30','11:00','休息'],['11:00','12:00','工作'],['12:00','14:00','午饭'],['14:00','18:00','办事']]);});
test('promises keep full dates, do not invent missed reasons, and expire undated after 7 days',()=>{const state={roles:[{id:'r'}],settings:{timezone:'UTC'}};const at=Date.parse('2026-11-17T10:00:00Z'),p=D.addRecord(state,'r',{content:'提醒',date:'2026-12-01',time:'09:00',type:'avoid'},'promises',at);assert.equal(p.dueAt,Date.parse('2026-12-01T09:00:00Z'));assert.throws(()=>D.mark(state,'r',p.id,'missed','promises','',at));D.expire([p],at+20*86400000);assert.equal(p.status,'pending');const q=D.addRecord(state,'r',{content:'以后提醒'},'promises',at);D.expire([q],at+7*86400000);assert.equal(q.status,'expired');});
const Schedule=require('../lib/engine/modules/schedule.cjs');
function fixture(){return {roles:[{id:'r',name:'测试角色',prompt:'普通职员',permissions:{}},{id:'other',name:'其他角色',permissions:{}}],settings:{timezone:'UTC',modules:{}},engine:{data:{}}};}
const Registry=require('../lib/engine/registry.cjs');
function rawSchedule(){
 return {slots:Array.from({length:12},(_,i)=>({
  start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String((i+1)*2).padStart(2,'0')+':00',activity:'日常活动'
 }))};
}
test('moving the global boundary earlier or later keeps the current plan and joins to the next plan once',async()=>{
 const parse=time=>Date.parse(time+'Z');
 for(const boundary of ['05:00','09:00']){
  let now=parse('2026-11-17T10:00'),calls=0;
  const s=jobFixture(now),raw=rawSchedule();
  Schedule.saveProfile(s,'r',{identity:'测试档案'});
  const old=Schedule.saveForRole(s,'r',raw,now),oldCopy=structuredClone(old);
  Registry.apply(s,'schedule',{boundary,surpriseProbability:0});
  const run=()=>Schedule.jobs[0].run({getState:()=>s,mutate:fn=>fn(s),isBusy:()=>false,now,clock:()=>now,dataDir:'boundary-'+boundary,
   modelApi:{call:async()=>{calls++;return {message:{content:JSON.stringify(raw)}};}}});
  now=parse('2026-11-18T06:30');await run();
  assert.equal(calls,0);assert.ok(Schedule.currentState(s,'r',now).currentSlot);assert.deepEqual(Schedule.view(s,'r',now).plan,oldCopy);
  now=parse('2026-11-18T07:00');await run();
  const next=Schedule.view(s,'r',now).plan;
  assert.equal(calls,1);assert.equal(next.day,'2026-11-18');assert.equal(next.boundary,boundary);
  assert.equal(next.slots[0].startAt,oldCopy.slots.at(-1).endAt);
  assert.equal(next.slots.at(-1).endAt,parse('2026-11-19T'+boundary));
  for(let i=1;i<next.slots.length;i++)assert.equal(next.slots[i-1].endAt,next.slots[i].startAt);
  assert.deepEqual(Schedule.getDay(s,'r',oldCopy.day),oldCopy);
  now=parse('2026-11-18T09:30');await run();assert.equal(calls,1);
  now=parse('2026-11-19T'+boundary);await run();assert.equal(calls,2);
  assert.equal(Schedule.view(s,'r',now).plan.startAt,next.endAt);
 }
});

test('reference days and wardrobe look-back are separate global rules on the actual generated request',async()=>{
 const s=fixture(),roleId='r',now=()=>Date.parse('2026-11-17T10:00:00Z');
 Schedule.saveProfile(s,roleId,{identity:'职员'});
 Schedule.saveSettings(s,roleId,{weatherEnabled:false,routineJitterMinutes:30,surpriseProbability:1});
 Registry.apply(s,'schedule',{referenceHistoryDays:1,outfitNoRepeatDays:7,routineJitterMinutes:0,surpriseProbability:0});
 const data=D.data(s);
 const oldOutfit={id:'old-coat',category:'外出',seasons:['秋'],description:'深蓝外套'},fresh={id:'fresh-coat',category:'外出',seasons:['秋'],description:'米色外套'};
 data.wardrobes[roleId]=[oldOutfit,fresh];
 data.history[roleId]=[{day:'2026-11-11',daySummary:'历史中穿过深蓝外套',actualSlots:[{outfitSnapshot:oldOutfit}]},{day:'2026-11-16',daySummary:'昨日记录要参考'}];
 const plan=await Schedule.generateForRole(s,{roleId,now,mutate:fn=>fn(s),modelApi:{call:async(_,req)=>{
  const prompt=req.messages[1].content;
  assert.match(prompt,/昨日记录要参考/);assert.doesNotMatch(prompt,/历史中穿过深蓝外套/);
  return {message:{content:JSON.stringify(rawSchedule())}};
 }}});
 assert.equal(plan.outfits.outdoor.id,fresh.id);assert.deepEqual(plan.surprises,[]);
 assert.equal(Schedule.view(s,roleId,now()).settings.routineJitterMinutes,0);
});

test('unconfigured legacy friend settings survive restore, with explicit global saves taking precedence',()=>{
 const s=fixture();
 Schedule.saveSettings(s,'r',{enabled:false,weatherEnabled:false,boundary:'06:45',chatChangeEnabled:true});
 s.settings.modules.schedule=Registry.validate('schedule',{enabled:true},{},true);
 assert.equal(Schedule.view(s,'r').settings.boundary,'06:45');
 Registry.apply(s,'schedule',{boundary:'09:10',chatChangeEnabled:false});
 Schedule.saveSettings(s,'r',{boundary:'05:00',chatChangeEnabled:true});
 const settings=Schedule.view(s,'r').settings;
 assert.equal(settings.boundary,'09:10');assert.equal(settings.chatChangeEnabled,false);
 assert.equal(settings.enabled,false);assert.equal(settings.weatherEnabled,false);
 assert.equal(Schedule.view(s,'other').settings.boundary,'09:10');
});
test('profile generation preserves prior profile and keeps roles isolated',async()=>{const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',{identity:'原资料'});const profile=Object.fromEntries(D.PROFILE_FIELDS.map(k=>[k,k+'资料']));await Schedule.generateProfile(s,{roleId:'r',mutate,now:()=>123,modelApi:{call:async()=>({message:{content:JSON.stringify(profile)}})}});assert.equal(Schedule.view(s,'r').profileMeta.backups[0].profile.identity,'原资料');assert.deepEqual(Schedule.view(s,'other').profile,{});});
test('generation stores full history and original plan, reuses one in-flight model call',async()=>{const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',Object.fromEntries(D.PROFILE_FIELDS.map(k=>[k,'生活资料'])));Schedule.saveSettings(s,'r',{weatherEnabled:false,surpriseProbability:0});const raw={mood:'轻松',simulatedWeather:{summary:'模拟晴朗',tempMin:12,tempMax:20,precipProb:10},slots:Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:'活动'+i}))};let count=0;const modelApi={call:async()=>{count++;await new Promise(resolve=>setTimeout(resolve,10));return {message:{content:JSON.stringify(raw)}};}};const opts={roleId:'r',force:true,mutate,modelApi,now:()=>Date.parse('2026-11-17T08:00:00Z')};const [a,b]=await Promise.all([Schedule.generateForRole(s,opts),Schedule.generateForRole(s,opts)]);assert.equal(count,1);assert.deepEqual(a,b);assert.equal(a.timelineVersion,2);assert.equal(a.weather.aiSimulated,true);assert.equal(a.weather.summary,'模拟晴朗');assert(a.originalSlots.length);assert(Schedule.view(s,'r').history[0].slots.length);assert.equal(Schedule.view(s,'r').generation.status,'ready');});
test('mood update applies alongside schedule changes and preserves original',async()=>{const s=fixture(),mutate=fn=>fn(s),at=Date.parse('2026-11-17T10:30:00Z');Schedule.saveForRole(s,'r',{slots:[{start:'00:00',end:'08:00',activity:'夜间熟睡'},{start:'08:00',end:'23:59',activity:'日常安排'}]},at);const original=structuredClone(s.engine.data.schedule.days.r.originalSlots);await Schedule.applyScheduleChange({getState:()=>s,mutate,roleId:'r',now:()=>at,modelApi:{call:async()=>({message:{content:JSON.stringify({scheduleChanges:[{start:'10:00',end:'11:00',activity:'喝茶'}],moodUpdate:'开心'})}})}});assert.equal(Schedule.currentState(s,'r',at).mood,'开心');assert.deepEqual(s.engine.data.schedule.days.r.originalSlots,original);});
test('failed generation is visible and does not replace an existing profile',async()=>{const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',{identity:'保留'});Schedule.saveSettings(s,'r',{weatherEnabled:false});await assert.rejects(Schedule.generateForRole(s,{roleId:'r',scope:'failed-test',mutate,now:()=>Date.parse('2026-11-17T08:00:00Z'),modelApi:{call:async()=>{throw Error('上游失败');}}}),/上游失败/);assert.equal(Schedule.view(s,'r').generation.status,'failed');assert.equal(Schedule.view(s,'r').profile.identity,'保留');});
test('editing full dates recalculates deadline and follow-up; invalid restore is rejected without migration',()=>{const s=fixture(),at=Date.parse('2026-11-17T08:00:00Z');const p=Schedule.saveUserEvent(s,'r',{content:'面试',date:'2026-11-18',time:'10:00',followUpHours:3},at);const updated=Schedule.saveUserEvent(s,'r',{id:p.id,content:'面试',date:'2026-11-20',time:'11:00',followUpHours:4},at);assert.equal(updated.dueAt,Date.parse('2026-11-20T11:00:00Z'));assert.equal(updated.followUpAt,Date.parse('2026-11-20T15:00:00Z'));const legacy={day:'2026-11-17',slots:[{start:'00:00',end:'23:59',activity:'旧活动'}]};s.engine.data.schedule.days.r=legacy;const before=JSON.stringify(s);Schedule.validateRestore(s);assert.equal(JSON.stringify(s),before);assert(Schedule.currentState(s,'r',Date.parse('2026-11-17T02:00:00Z')));s.engine.data.schedule.days.unknown=legacy;assert.throws(()=>Schedule.validateRestore(s),/不存在的好友/);});
test('nighttime adjustment retains forced sleep and normal daytime naps stay within 45 minutes',()=>{const C=require('../lib/engine/schedule-core.cjs'),key='2026-11-17',tz='UTC',at=Date.parse('2026-11-18T01:00:00Z'),base=Timeline.normalize([{start:'00:00',end:'08:00',activity:'夜间熟睡'},{start:'08:00',end:'23:59',activity:'工作'}],key,tz),next=Timeline.merge(base,[{start:'02:00',end:'04:00',activity:'出门工作'}],at,key,tz);assert(next.filter(x=>x.startAt>=Date.parse('2026-11-18T02:00:00Z')&&x.endAt<=Date.parse('2026-11-18T04:00:00Z')).every(x=>x.restType==='night_sleep'));const slots=C.repairSlots([{start:'12:00',end:'14:00',activity:'午睡',restType:'nap'}]);assert(slots.filter(x=>x.restType==='nap').every(x=>C.toMinutes(x.end)-C.toMinutes(x.start)<=45));});
test('slow regeneration keeps elapsed activities and frozen outfits; cross-day results are refused',async()=>{const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',{identity:'职员'});Schedule.saveSettings(s,'r',{weatherEnabled:false,surpriseProbability:0});let at=Date.parse('2026-11-17T08:00:00Z');const raw=outfit=>({outfit,temporaryOutfits:{outdoor:outfit,home:outfit,sleepwear:'睡衣'},slots:Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:'活动'+i,outfitType:'outdoor'}))});await Schedule.generateForRole(s,{roleId:'r',scope:'slow',mutate,now:()=>at,modelApi:{call:async()=>({message:{content:JSON.stringify(raw('上午蓝衣'))}})}});at=Date.parse('2026-11-17T10:00:00Z');await Schedule.generateForRole(s,{roleId:'r',scope:'slow',force:true,mutate,now:()=>at,modelApi:{call:async()=>{at=Date.parse('2026-11-17T12:00:00Z');return {message:{content:JSON.stringify(raw('下午白衣'))}};}}});const plan=s.engine.data.schedule.days.r;assert.equal(Schedule.currentState(s,'r',Date.parse('2026-11-17T11:00:00Z')).outfit,'上午蓝衣');assert.equal(Schedule.currentState(s,'r',Date.parse('2026-11-17T13:00:00Z')).outfit,'下午白衣');assert(plan.originalSlots.some(x=>x.outfitSnapshot.description==='上午蓝衣'));const before=structuredClone(plan);await assert.rejects(Schedule.generateForRole(s,{roleId:'r',scope:'slow',force:true,mutate,now:()=>at,modelApi:{call:async()=>{at=Date.parse('2026-11-18T08:00:00Z');return {message:{content:JSON.stringify(raw('过期衣服'))}};}}}),/业务日已变化/);assert.deepEqual(s.engine.data.schedule.days.r,before);});
test('undated expiry still runs with automatic daily generation switched off',async()=>{const s=fixture(),at=Date.parse('2026-11-17T08:00:00Z');s.settings.modules.schedule={autoGenerate:false};const record=Schedule.addPromise(s,'r',{content:'某天提醒',type:'tell'},at-8*86400000);let mutations=0;await Schedule.jobs[0].run({getState:()=>s,mutate:fn=>{mutations++;fn(s);},isBusy:()=>false,now:at,dataDir:'expiry-only-test'});assert.equal(record.status,'expired');assert.equal(mutations,1);});
test('read-only life tool cannot query another role or mutate state',async()=>{const s=fixture();Schedule.saveProfile(s,'r',{identity:'当前好友'});Schedule.saveProfile(s,'other',{identity:'其他好友秘密'});const before=JSON.stringify(s),tool=Schedule.tools[0],result=await tool.execute('query_life_schedule',{section:'profile'},{getState:()=>s,roleId:'r'});assert.equal(result.profile.identity,'当前好友');assert(!JSON.stringify(result).includes('其他好友秘密'));assert.equal(JSON.stringify(s),before);await assert.rejects(tool.execute('query_life_schedule',{roleId:'other'},{getState:()=>s,roleId:'r'}),/参数无效/);});
test('long event dates expose upcoming/ongoing/ended and edits enforce a seven-day span',()=>{const s=fixture(),at=Date.parse('2026-11-17T10:00:00Z');const ev=Schedule.saveEvent(s,'r',{content:'出差',startDate:'2026-11-18',endDate:'2026-11-20'},at);assert.equal(Schedule.view(s,'r',at).events[0].phase,'upcoming');assert.equal(Schedule.view(s,'r',Date.parse('2026-11-19T10:00:00Z')).events[0].phase,'ongoing');assert.equal(Schedule.view(s,'r',Date.parse('2026-11-21T10:00:00Z')).events[0].phase,'ended');assert.equal(Schedule.view(s,'r',Date.parse('2026-11-21T10:00:00Z')).events[0].status,'done');assert.throws(()=>Schedule.saveEvent(s,'r',{...ev,endDate:'2026-11-26'},at),/1至7天/);});
test('accepting a profile clears persona-changed and deleted roles cannot be recreated by late generation',async()=>{const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',{identity:'旧资料'});s.roles[0].prompt='新的人设';assert.equal(Schedule.view(s,'r').profileMeta.personaChanged,true);Schedule.saveProfile(s,'r',{identity:'保留资料'});assert.equal(Schedule.view(s,'r').profileMeta.personaChanged,false);await assert.rejects(Schedule.generateProfile(s,{roleId:'r',mutate,scope:'deleted',modelApi:{call:async()=>{Schedule.removeRole(s,'r');s.roles=s.roles.filter(r=>r.id!=='r');return {message:{content:JSON.stringify(Object.fromEntries(D.PROFILE_FIELDS.map(k=>[k,'生成资料'])))}};}}}));const d=s.engine.data.schedule;for(const key of ['profiles','profileMeta','generation'])assert(!Object.hasOwn(d[key]||{},'r'));});
test('profile generation rejects a new binding with the same prompt, and only backs up the profile it replaces',async()=>{
 const s=fixture(),role=s.roles[0],mutate=fn=>fn(s);
 s.rolePersonas=[{id:'a',prompt:'业余画家'},{id:'b',prompt:'业余画家'}];role.rolePersonaId='a';
 Schedule.saveProfile(s,'r',{identity:'原有档案'});
 const initial=structuredClone(Schedule.view(s,'r').profileMeta);
 const generated=Object.fromEntries(D.PROFILE_FIELDS.map(key=>[key,'模型档案']));
 const reply={message:{content:JSON.stringify(generated)}};
 const opts={roleId:'r',mutate,now:()=>123};
 await assert.rejects(Schedule.generateProfile(s,{...opts,modelApi:{call:async(_state,{messages})=>{
  assert.equal(messages.at(-1).content,'业余画家');role.rolePersonaId='b';return reply;
 }}}),{code:'SCHEDULE_PERSONA_CHANGED',status:409});
 let current=Schedule.view(s,'r');
 assert.equal(current.profile.identity,'原有档案');assert.deepEqual(current.profileMeta,initial);assert.equal(current.generation.status,'interrupted');
 await Schedule.generateProfile(s,{...opts,modelApi:{call:async()=>{
  Schedule.saveProfile(s,'r',{identity:'等待期间手动保存'});return reply;
 }}});
 current=Schedule.view(s,'r');
 assert.equal(current.profile.identity,'模型档案');assert.equal(current.profileMeta.backups.length,1);
 assert.equal(current.profileMeta.backups[0].profile.identity,'等待期间手动保存');
});
test('unbind during daily generation preserves the existing plan and does not consume a retry',async()=>{
 const s=fixture(),role=s.roles[0],mutate=fn=>fn(s),at=Date.parse('2026-11-17T10:00:00Z');
 s.rolePersonas=[{id:'a',prompt:'绑定的插画师'}];role.rolePersonaId='a';
 Schedule.saveSettings(s,'r',{weatherEnabled:false,surpriseProbability:0});Schedule.saveProfile(s,'r',{identity:'现有档案'});
 Schedule.saveForRole(s,'r',{slots:[{start:'00:00',end:'23:59',activity:'原有日程'}]},at);
 const d=s.engine.data.schedule,days=structuredClone(d.days),history=structuredClone(d.history);
 d.generation.r={day:'2026-11-17',status:'failed',attempts:2,retryAt:at};
 const slots=Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:'等待写入的活动'+i}));
 let calls=0;
 const opts={roleId:'r',mutate,now:()=>at,modelApi:{call:async(_state,{messages})=>{
  calls++;
  assert.match(messages.at(-1).content,calls===1?/人设：绑定的插画师/:/人设：普通职员/);
  role.rolePersonaId='';return {message:{content:JSON.stringify({slots})}};
 }}};
 await assert.rejects(Schedule.generateForRole(s,{...opts,force:true}),{code:'SCHEDULE_PERSONA_CHANGED',status:409});
 assert.deepEqual(d.days,days);assert.deepEqual(d.history,history);
 assert.equal(d.generation.r.status,'interrupted');assert.equal(d.generation.r.attempts,2);
 assert.equal(d.generation.r.retryAt,undefined);
 await Schedule.generateForRole(s,opts);assert.equal(calls,1);
 await Schedule.generateForRole(s,{...opts,force:true});assert.equal(calls,2);
 assert.equal(d.generation.r.status,'ready');assert.equal(d.generation.r.attempts,3);
});
test('adjustments use the bound prompt and discard changes if that prompt is edited during the request',async()=>{
 const s=fixture(),at=Date.parse('2026-11-17T10:30:00Z'),mutate=fn=>fn(s);
 s.rolePersonas=[{id:'a',prompt:'绑定的人设正文'}];s.roles[0].rolePersonaId='a';
 Schedule.saveForRole(s,'r',{slots:[{start:'00:00',end:'23:59',activity:'保留的日程'}]},at);
 const before=structuredClone(s.engine.data.schedule);
 const reply={moodUpdate:'过期心情',promises:[{type:'tell',content:'过期约定'}],scheduleChanges:[{start:'10:00',end:'11:00',activity:'过期活动'}]};
 await Schedule.applyScheduleChange({getState:()=>s,mutate,roleId:'r',reason:'日常小插曲',now:()=>at,modelApi:{call:async(_state,{messages})=>{
  assert.match(messages.at(-1).content,/人设：绑定的人设正文/);
  assert.doesNotMatch(messages.at(-1).content,/普通职员/);
  s.rolePersonas[0].prompt='编辑后的正文';return {message:{content:JSON.stringify(reply)}};
 }}});
 assert.deepEqual(s.engine.data.schedule,before);
});
function jobFixture(at){const s=fixture();s.messages=[{sender:'user',status:'sent',roleId:'r',createdAt:at-3600000}];s.settings.ai={assign:{chat:'m'},models:[{id:'m',sourceId:'src'}],sources:[{id:'src',baseUrl:'https://unit.invalid',key:'isolated-fixture'}]};Schedule.saveSettings(s,'r',{weatherEnabled:false});return s;}
test('a friend who enabled schedules gets the chat tool and automatic schedule despite an earlier global off setting',async()=>{
 const at=Date.parse('2026-11-19T12:00:00Z'),s=jobFixture(at);
 for(const role of s.roles)role.stickers=[];
 Registry.apply(s,'schedule',{enabled:false});
 Schedule.saveSettings(s,'r',{enabled:true});Schedule.saveProfile(s,'r',{identity:'测试'});
 assert(Registry.tools(s,s.roles[0],{}).some(t=>t.function.name==='query_life_schedule'));
 assert(!Registry.tools(s,s.roles[1],{}).some(t=>t.function.name==='query_life_schedule'));
 await Schedule.jobs[0].run({getState:()=>s,mutate:fn=>fn(s),isBusy:()=>false,now:at,clock:()=>at,dataDir:'local-switch',modelApi:{call:async()=>({message:{content:JSON.stringify(rawSchedule())}})}});
 assert(Schedule.currentState(s,'r',at)?.currentSlot);assert.equal(s.engine.data.schedule.days.other,undefined);
 Schedule.saveSettings(s,'r',{enabled:false});assert.equal(Schedule.currentState(s,'r',at),null);assert(s.engine.data.schedule.days.r);
});
test('changing cities interrupts old weather from manual refresh, the daily job and a long model request',async t=>{
 const Weather=require('../lib/engine/schedule-weather.cjs'),at=Date.parse('2026-11-19T12:00:00Z');
 for(const kind of ['manual','automatic','generation','adjustment'])await t.test(kind,async t=>{
  const s=jobFixture(at),mutate=fn=>fn(s),now=()=>at;
  Schedule.saveProfile(s,'r',{identity:'测试'});
  Schedule.saveSettings(s,'r',{city:'北京',weatherEnabled:true},at);
  const plan=Schedule.saveForRole(s,'r',{slots:rawSchedule().slots,weather:{city:'北京',summary:'旧天气'}},at);
  plan.weatherCheckedAt=0;
  function changeCity(){Schedule.saveSettings(s,'r',{city:'广州'},at);}
  t.mock.method(Weather,'resolveCityWeather',async(city,day)=>{
   if(['manual','automatic'].includes(kind)&&city==='北京')changeCity();
   return {city,day,summary:city+'天气',cacheEntry:{key:city,entry:{day}},significantChange:kind==='adjustment'&&city==='北京'};
  });
  const opts={getState:()=>s,mutate,roleId:'r',now,modelApi:{call:async()=>{
   changeCity();return {message:{content:JSON.stringify(kind==='adjustment'?{moodUpdate:'北京天气'}:rawSchedule())}};
  }}};
  if(kind==='automatic')await Schedule.jobs[0].run({...opts,dataDir:'old-city-job',isBusy:()=>false,now:at,clock:now});
  else if(kind==='generation')await assert.rejects(Schedule.generateForRole(s,{...opts,force:true}),{code:'SCHEDULE_WEATHER_CHANGED'});
  else await assert.rejects(Schedule.refreshWeather(s,opts),{code:'SCHEDULE_WEATHER_CHANGED'});
  assert.equal(s.roles[0].city,'广州');assert.deepEqual(plan.weather,{});assert.notEqual(plan.mood,'北京天气');
  if(kind!=='adjustment')assert.equal(s.engine.data.schedule.weatherCache['北京'],undefined);
  await Schedule.refreshWeather(s,opts);assert.equal(plan.weather.city,'广州');
 });
});
test('only a new user message restarts automatic scheduling after 72 hours',async()=>{
 const at=Date.parse('2026-11-18T12:00:00Z'),s=jobFixture(at);
 s.roles[0].pinned=true;
 s.roles[0].outreachEnabled=true;
 s.roles[0].lastActiveAt=at-30000;
 s.messages[0].createdAt=at-72*3600000;
 s.messages.push({sender:'assistant',roleId:'r',status:'sent',createdAt:at-30000});
 Schedule.saveProfile(s,'r',{identity:'验收角色'});
 const raw={slots:Array.from({length:12},(_,i)=>({
   start:String(i*2).padStart(2,'0')+':00',
   end:i===11?'23:59':String((i+1)*2).padStart(2,'0')+':00',
   activity:i<4?'熟睡':'画画',restType:i<4?'night_sleep':'none'
 }))};
 let now=at,calls=0;
 const run=()=>Schedule.jobs[0].run({
   getState:()=>s,mutate:fn=>fn(s),isBusy:()=>false,now,clock:()=>now,
   dataDir:'paused-role-test',modelApi:{call:async()=>{calls++;return {message:{content:JSON.stringify(raw)}};}}
 });
 await run();
 assert.equal(calls,0);
 assert.equal(Schedule.currentState(s,'r',at),null);
 now+=60000;
 s.messages.push({sender:'user',roleId:'r',status:'pending',createdAt:now});
 await run();
 assert.equal(calls,1);
 assert.equal(Schedule.currentState(s,'r',now).activity,'画画');
});
test('missed surprise points are skipped after restart and legacy points use calendar dates',async()=>{const at=Date.parse('2026-11-18T02:00:00Z'),s=jobFixture(at);D.data(s).days.r={day:'2026-11-18',slots:[{start:'00:00',end:'23:59',activity:'旧日程'}],surprises:[{id:'old',atHm:'01:00',triggered:false}]};let calls=0;await Schedule.jobs[0].run({getState:()=>s,mutate:fn=>fn(s),isBusy:()=>false,now:at,clock:()=>at,dataDir:'missed-surprise-test',modelApi:{call:async()=>{calls++;throw Error('不应调用模型');}}});assert.equal(calls,0);assert.equal(s.engine.data.schedule.days.r.surprises[0].skipped,true);assert.equal(s.engine.data.schedule.days.r.surprises[0].triggered,true);});
test('job clocks advance during slow adjustments and mood reaches current plus two future slots',async()=>{let at=Date.parse('2026-11-17T10:00:30Z');const s=jobFixture(at);Schedule.saveForRole(s,'r',{slots:[{start:'00:00',end:'08:00',activity:'夜间熟睡'},{start:'08:00',end:'10:00',activity:'上午'},{start:'10:00',end:'12:00',activity:'保留已过活动'},{start:'12:00',end:'14:00',activity:'午间'},{start:'14:00',end:'16:00',activity:'下午'},{start:'16:00',end:'23:59',activity:'晚间'}]},Date.parse('2026-11-17T08:00:00Z'));s.engine.data.schedule.days.r.surprises=[{id:'due',atHm:'10:00',triggered:false}];await Schedule.jobs[0].run({getState:()=>s,mutate:fn=>fn(s),isBusy:()=>false,now:at,clock:()=>at,dataDir:'live-clock-test',modelApi:{call:async()=>{at=Date.parse('2026-11-17T12:00:00Z');return {message:{content:JSON.stringify({scheduleChanges:[{start:'10:00',end:'13:00',activity:'新安排'}],moodUpdate:'开心'})}};}}});assert.equal(Schedule.currentState(s,'r',Date.parse('2026-11-17T11:00:00Z')).activity,'保留已过活动');const slots=s.engine.data.schedule.days.r.slots,index=slots.findIndex(x=>x.startAt===at);assert.deepEqual(slots.slice(index,index+3).map(x=>x.mood),['开心','开心','开心']);});
test('personality waiting reactions are retained without additional cross-module behavior',async()=>{const s=fixture(),at=Date.parse('2026-11-17T10:00:00Z');Schedule.saveForRole(s,'r',{waitReplyReaction:'会失落',waitReplyRecover:'对方回复后恢复',slots:[{start:'00:00',end:'08:00',activity:'熟睡'},{start:'08:00',end:'23:59',activity:'工作'}]},at);const result=await Schedule.tools[0].execute('query_life_schedule',{section:'plan'},{getState:()=>s,roleId:'r',now:at});assert.equal(result.plan.waitReplyReaction,'会失落');assert.equal(result.plan.waitReplyRecover,'对方回复后恢复');});
test('work and rest day selections use their own profile wake times without another model request',async()=>{for(const [dayType,wake]of [['work','07:00'],['rest','09:00']]){const s=fixture(),at=Date.parse('2026-11-17T06:00:00Z');Schedule.saveProfile(s,'r',{routineWorkday:'07:00起床，23:00睡觉',routineRestday:'09:00起床，00:30睡觉'});Schedule.saveSettings(s,'r',{weatherEnabled:false,routineJitterMinutes:0,surpriseProbability:0});let calls=0;const raw={dayType,slots:Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:i<4?'夜间熟睡':'活动'+i,restType:i<4?'night_sleep':'none'}))};const plan=await Schedule.generateForRole(s,{roleId:'r',scope:'routine-'+dayType,force:true,mutate:fn=>fn(s),now:()=>at,modelApi:{call:async()=>{calls++;return {message:{content:JSON.stringify(raw)}};}}});const morning=plan.slots.find(x=>x.start==='06:00'||x.start<'06:00'&&x.end>wake);assert(plan.slots.some(x=>x.end===wake&&x.restType==='night_sleep'));assert.equal(plan.dayType,dayType);assert.equal(calls,1);}});
test('midnight 23:59 sentinel does not create overlapping final minute slots',()=>{const C=require('../lib/engine/schedule-core.cjs');const raw=[{start:'00:00',end:'08:00',activity:'夜间熟睡'},{start:'08:00',end:'22:00',activity:'日常活动'},{start:'22:00',end:'23:59',activity:'夜间熟睡'},{start:'23:59',end:'23:59',activity:'旧补尾睡眠'}];const repaired=C.repairSlots(raw);assert(!repaired.some(x=>x.start==='23:59'&&x.end==='23:59'));const slots=Timeline.normalize(repaired,'2026-11-17','UTC');for(let i=1;i<slots.length;i++)assert.equal(slots[i-1].endAt,slots[i].startAt);assert.equal(slots.at(-1).endAt,Date.parse('2026-11-18T07:00:00Z'));});
