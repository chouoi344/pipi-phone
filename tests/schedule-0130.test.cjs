'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../lib/engine/schedule-core.cjs'),Schedule=require('../lib/engine/modules/schedule.cjs');
const Data=require('../lib/engine/schedule-data.cjs'),Weather=require('../lib/engine/schedule-weather.cjs'),Wardrobe=require('../lib/engine/schedule-wardrobe.cjs');
const Timeline=require('../lib/engine/schedule-timeline.cjs');
const at=Date.parse('2026-11-20T08:00:00Z');
function fixture(){return {roles:[{id:'r',name:'角色',prompt:'独居的自由职业者',permissions:{}}],settings:{timezone:'UTC',modules:{}},engine:{data:{}}};}
function plan(){return {dayType:'work',slots:Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:i===5?'白天睡觉':'工作安排'+i,restType:i===5?'night_sleep':'none'}))};}
const routineCases=[
  ['day_normal','7点起11点睡','07:00','23:00'],
  ['day_normal','晚上11点睡',null,'23:00'],
  ['day_normal','12点睡',null,'00:00'],
  ['night_owl','11点起，凌晨3点睡','11:00','03:00'],
  ['night_owl','下午1点起','12:30',null],
  ['free','10点睡，18点起','18:00','10:00'],
  ['free','晚上11点睡',null,'23:00'],
  ['day_normal','晚上7点睡',null,'22:00'],
  ['night_owl','晚上11点睡',null,'01:30']
];
for(const [sleepProfile,text,wake,sleep]of routineCases)test('作息解析 '+sleepProfile+' '+text,()=>{
  const result=Core.computeRoutine({routineWorkday:text},{sleepProfile,jitterMinutes:0,rng:()=>0.5});
  if(wake)assert.equal(result.wakeHm,wake);if(sleep)assert.equal(result.sleepHm,sleep);
});
test('旧好友默认正常作息；三模式独立保存并校验备份和非法选项',()=>{
  const s=fixture();assert.equal(Schedule.view(s,'r',at).settings.sleepProfile,'day_normal');
  Schedule.saveSettings(s,'r',{sleepProfile:'night_owl'});assert.equal(Schedule.view(s,'r',at).settings.sleepProfile,'night_owl');
  Schedule.validateRestore(s);assert.throws(()=>Schedule.saveSettings(s,'r',{sleepProfile:'unknown'}));
  Data.data(s).roleSettings.r.sleepProfile='unknown';assert.throws(()=>Schedule.validateRestore(s));
});
for(const sleepProfile of ['day_normal','night_owl','free'])test('生成、保存和重新生成保留 '+sleepProfile+' 作息',async()=>{
  const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',{routineWorkday:sleepProfile==='night_owl'?'凌晨4点睡，11点起':'10点睡，18点起'});
  Schedule.saveSettings(s,'r',{sleepProfile,weatherEnabled:false,routineJitterMinutes:0,surpriseProbability:0});
  let prompt='';const opts={roleId:'r',scope:'profile-'+sleepProfile,mutate,getState:()=>s,now:()=>at,modelApi:{call:async(state,options)=>{prompt=options.messages[0].content;return {message:{content:JSON.stringify(plan())}};}}};
  let result=await Schedule.generateForRole(s,opts);assert.match(prompt,new RegExp('作息规则：'+Core.SLEEP_PROFILES[sleepProfile].label));
  const before=structuredClone(result.slots);result=await Schedule.generateForRole(s,{...opts,force:true});
  assert.equal(result.startAt,before[0].startAt);
  const find=hm=>result.slots.find(slot=>slot.startAt<=Date.parse('2026-11-21T'+hm+':00Z')&&Date.parse('2026-11-21T'+hm+':00Z')<slot.endAt);
  if(sleepProfile==='day_normal')assert.equal(find('03:00').restType,'night_sleep');
  if(sleepProfile==='night_owl'){assert.equal(find('03:00').restType,'none');assert.equal(find('05:00').restType,'night_sleep');}
  if(sleepProfile==='free'){assert.equal(find('03:00').restType,'none');assert(result.slots.some(slot=>slot.start==='10:00'&&slot.restType==='night_sleep'));}
});
test('夜猫子与自由作息的后续调整不会被正常作息的凌晨锁覆盖',()=>{
  const raw=[{start:'00:00',end:'23:59',activity:'工作',restType:'none'}],key='2026-11-20';
  for(const sleepProfile of ['night_owl','free']){
    const routine={sleepProfile},base=Timeline.normalize(raw,key,'UTC','07:00','角色',routine);
    const next=Timeline.merge(base,[{start:'02:00',end:'03:00',activity:'写作'}],at,key,'UTC','07:00','角色',undefined,routine);
    assert.equal(next.find(slot=>slot.activity==='写作').restType,'none');
  }
});
test('生活档案按模式生成且每个模型字段最多保存1000字',async()=>{
  const s=fixture();Schedule.saveSettings(s,'r',{sleepProfile:'free'});let prompt='';
  await Schedule.generateProfile(s,{roleId:'r',mutate:fn=>fn(s),now:()=>at,modelApi:{call:async(state,options)=>{prompt=options.messages[0].content;return {message:{content:JSON.stringify(Object.fromEntries(Data.PROFILE_FIELDS.map(key=>[key,'长'.repeat(1500)])))}};}}});
  assert.match(prompt,/不强制昼夜时间/);for(const value of Object.values(Data.data(s).profiles.r))assert.equal(value.length,1000);
});
test('不存在的指定穿搭在模型调用前报错；后台生成不覆盖同时保存的日程',async()=>{
  const s=fixture();Schedule.saveProfile(s,'r',{identity:'职员'});Schedule.saveSettings(s,'r',{weatherEnabled:false});
  await assert.rejects(Schedule.generateForRole(s,{roleId:'r',scope:'missing-outfit',outfitId:'missing',mutate:fn=>fn(s),now:()=>at,modelApi:{call:()=>assert.fail('不应调用模型')}}),/衣柜穿搭不存在/);
  const opts={roleId:'r',scope:'background-preserve',mutate:fn=>fn(s),now:()=>at,modelApi:{call:async()=>{
    Schedule.saveForRole(s,'r',{daySummary:'手动安排',slots:[{start:'00:00',end:'23:59',activity:'手动写入'}]},at);
    return {message:{content:JSON.stringify(plan())}};
  }}};
  const result=await Schedule.generateForRole(s,opts);assert.equal(result.daySummary,'手动安排');
});
test('手动重写等待后台结束，读取最新状态并保留额外要求',async()=>{
  const s=fixture(),mutate=fn=>fn(s);Schedule.saveProfile(s,'r',{identity:'职员'});Schedule.saveSettings(s,'r',{weatherEnabled:false,surpriseProbability:0});
  let release,calls=0;const gate=new Promise(resolve=>release=resolve),extra=[];
  const opts={roleId:'r',scope:'force-rerun',mutate,getState:()=>s,now:()=>at,modelApi:{call:async(state,options)=>{calls++;extra.push(options.messages[1].content);if(calls===1)await gate;return {message:{content:JSON.stringify(plan())}};}}};
  const background=Schedule.generateForRole(s,opts),manual=Schedule.generateForRole(s,{...opts,force:true,extra:'去图书馆'});release();await Promise.all([background,manual]);assert.equal(calls,2);assert.match(extra[1],/额外要求：去图书馆/);
});
test('日程工具限制30000字，不包含图片或时间戳，并保留人物等待反应',async()=>{
  const s=fixture(),d=Data.data(s);Schedule.saveForRole(s,'r',{waitReplyReaction:'会失落',slots:[{start:'00:00',end:'23:59',activity:'安排'}]},at);
  const current=d.days.r;for(const slot of current.slots)slot.outfitSnapshot={description:'衣服',image:'data:image/png;base64,'+'A'.repeat(100000)};
  d.wardrobes.r=Array.from({length:80},()=>({description:'衣'.repeat(400),category:'外出',image:'data:image/png;base64,AAAA'}));
  d.history.r=Array.from({length:30},(_,i)=>({...structuredClone(current),day:'2026-11-'+String(i+1).padStart(2,'0'),daySummary:'摘'.repeat(300)}));
  const result=await Schedule.tools[0].execute('query_life_schedule',{}, {getState:()=>s,roleId:'r',now:at});
  const text=JSON.stringify(result);assert(text.length<=30000);assert.doesNotMatch(text,/base64|startAt|endAt|outfitSnapshot/);assert.equal(result.plan.waitReplyReaction,'会失落');
});
test('日程恢复清理全部已删好友条目并保留有效资料',()=>{
  const s=fixture(),d=Data.data(s),keys=['days','profiles','profileMeta','wardrobes','promises','userEvents','history','events','generation','roleSettings'];
  for(const key of keys)d[key].deleted={invalid:'已删好友坏资料'};
  Schedule.saveProfile(s,'r',{identity:'保留的资料'});Schedule.validateRestore(s);
  for(const key of keys)assert.equal(d[key].deleted,undefined);assert.equal(d.profiles.r.identity,'保留的资料');
});
test('生成请求精简昨日记录并排除过期事项，坏长期事件不使日程失败',async()=>{
  const s=fixture(),d=Data.data(s);Schedule.saveProfile(s,'r',{identity:'职员'});
  Schedule.saveSettings(s,'r',{weatherEnabled:false,longEventProbability:1,surpriseProbability:0});
  d.promises.r=[{id:'old',content:'过期约定标识',status:'pending',createdAt:at-86400000,dueAt:at-3600000}];
  d.userEvents.r=[{id:'old-event',content:'过期事项标识',status:'pending',createdAt:at-86400000,dueAt:at-86400000,followUpAt:at-13*3600000}];
  d.history.r=[{day:'2026-11-19',actualSlots:[{start:'12:00',end:'13:00',activity:'吃饭',startAt:123,outfitSnapshot:{description:'蓝色衬衫',image:'data:image/png;base64,不应传给模型'}}]}];
  let prompt='';await Schedule.generateForRole(s,{roleId:'r',scope:'compact-generation',mutate:fn=>fn(s),now:()=>at,modelApi:{call:async(state,options)=>{prompt=options.messages[1].content;return {message:{content:JSON.stringify({...plan(),longEvents:[null]})}};}}});
  assert.doesNotMatch(prompt,/过期约定标识|过期事项标识|base64|startAt|outfitSnapshot/);assert.match(prompt,/蓝色衬衫/);assert.equal(d.days.r.day,'2026-11-20');
});
test('动态调整逐条跳过模型坏数据，保留有效时段并补齐事项时间',async()=>{
  const s=fixture();Schedule.saveSettings(s,'r',{sleepProfile:'free'});Schedule.saveForRole(s,'r',{slots:[{start:'00:00',end:'23:59',activity:'原安排'}]},at);
  const update={scheduleChanges:[null,{start:'坏时间',end:'12:00',activity:'错误'},{start:'9:00',end:'10:00',activity:'喝茶'}],promises:[{content:' 记得伸展 ',date:'2026-11-20',time:'9:00',type:'do'},{content:'坏日期',date:'坏日期',time:'10:00'}],userEvents:[null],promiseUpdates:{},longEventUpdates:[null]};
  await Schedule.applyScheduleChange({getState:()=>s,mutate:fn=>fn(s),roleId:'r',now:()=>at,reason:'日常变化',modelApi:{call:async()=>({message:{content:JSON.stringify(update)}})}});
  const d=Data.data(s);assert(d.days.r.slots.some(slot=>slot.start==='09:00'&&slot.activity==='喝茶'));assert.equal(d.promises.r.length,1);assert.equal(d.promises.r[0].content,'记得伸展');assert.equal(d.promises.r[0].time,'09:00');
});
test('过期窗口分别为无日期7天、约定30分钟、回访12小时',()=>{
  const items=[{status:'pending',createdAt:at,dueAt:null},{status:'pending',createdAt:at,dueAt:at},{status:'pending',createdAt:at,dueAt:at,followUpAt:at+3600000}];
  for(const [index,offset]of [[0,7*86400000],[1,30*60000],[2,13*3600000]]){assert.equal(Data.overdue(items[index],at+offset-1),false);assert.equal(Data.overdue(items[index],at+offset),true);}
  Data.expire(items,at+8*86400000);assert(items.every(item=>item.status==='expired'));
});
test('天气显著变化比较相同小时；正常傍晚降温不触发',()=>{
  const old={source:'open-meteo',day:'2026-11-20',temp:25,hourly:[{time:'2026-11-20T18:00',temp:15,precipProb:20}]};
  assert.equal(Weather.significantChange(old,{...old,temp:15},'2026-11-20T18:30'),false);
  assert.equal(Weather.significantChange(old,{...old,hourly:[{time:'2026-11-20T18:00',temp:9,precipProb:20}]},'2026-11-20T18:30'),true);
  assert.equal(Weather.significantChange(old,{...old,hourly:[{time:'2026-11-20T18:00',temp:15,precipProb:70}]},'2026-11-20T18:30'),true);
});
test('天气失败文本不注入提示词；未识别衣服返回明确提示',()=>{
  assert.equal(Core.promptWeather({source:'unavailable',summary:'天气获取失败'}),'');
  assert.doesNotMatch(Core.promptWeather({source:'seasonal',summary:'季节模拟天气'}),/模拟|获取失败/);
  assert.throws(()=>Wardrobe.parseIdentifiedClothing({content:'{"description":"","category":"外出","seasons":["春"]}'}),{status:422,code:'NO_CLOTHING'});
});
