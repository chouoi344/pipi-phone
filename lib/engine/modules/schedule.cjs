// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../../state.cjs'),T=require('../time.cjs');
const defaultModels=require('../models.cjs');
const {visibleText}=require('../response.cjs');
const Core=require('../schedule-core.cjs');
const Weather=require('../schedule-weather.cjs'),Wardrobe=require('../schedule-wardrobe.cjs'),Calendar=require('../schedule-calendar.cjs');
const Data=require('../schedule-data.cjs'), Timeline=require('../schedule-timeline.cjs');
const inFlight=new Map();
const ACTIVE_CHAT_WINDOW=72*3600000;
const STALE_PERSONA='SCHEDULE_PERSONA_CHANGED';
const STALE_WEATHER='SCHEDULE_WEATHER_CHANGED';
const globalSettingKeys=['boundary','routineJitterMinutes','surpriseProbability','chatChangeEnabled','outfitNoRepeatDays','referenceHistoryDays'];
function roleSettings(state,roleId){
  const defaults=require('../registry.cjs').values(state,'schedule');
  const saved=state.settings.modules?.schedule||{};
  const settings={...defaults,sleepProfile:'day_normal',weatherEnabled:true,longEventProbability:0,...state.engine?.data?.schedule?.roleSettings?.[roleId]};
  for(const key of globalSettingKeys)if(Object.hasOwn(saved,key))settings[key]=saved[key];
  return settings;
}
function weatherRequest(state,roleId,at){
  const role=S.role(state,roleId),settings=roleSettings(state,roleId);
  return {city:role.city?.trim()||'',enabled:settings.weatherEnabled!==false,scheduleEnabled:settings.enabled,timezone:state.settings.timezone||'UTC',day:businessDay(state,roleId,at),persona:schedulePersona(state,role)};
}
function checkWeatherRequest(state,roleId,at,request){
  const current=weatherRequest(state,roleId,at);
  if(current.city!==request.city||current.enabled!==request.enabled||current.scheduleEnabled!==request.scheduleEnabled||current.timezone!==request.timezone||current.day!==request.day||current.persona.id!==request.persona.id||current.persona.text!==request.persona.text)
    S.fail('城市、天气设置或当前日程已变化，请重新获取天气',409,STALE_WEATHER);
}
function scheduleWindow(state,roleId,at){
  const tz=state.settings?.timezone||'UTC',boundary=roleSettings(state,roleId).boundary;
  const naturalDay=Timeline.day(at,tz,boundary),plan=state.engine?.data?.schedule?.days?.[roleId];
  if(plan?.timelineVersion===2){
    const oldBoundary=plan.boundary||'07:00',nextDay=T.addDays(plan.day,1);
    const startAt=plan.startAt??T.resolveLocal(plan.day,oldBoundary,tz);
    const endAt=plan.endAt??T.resolveLocal(nextDay,oldBoundary,tz);
    if(startAt<=at&&at<endAt)return {day:plan.day,boundary:oldBoundary,startAt,endAt};
    if(at>=endAt&&naturalDay<=nextDay)return {day:nextDay,boundary,startAt:endAt,endAt:T.resolveLocal(T.addDays(nextDay,1),boundary,tz)};
  }
  return {day:naturalDay,boundary,startAt:T.resolveLocal(naturalDay,boundary,tz),endAt:T.resolveLocal(T.addDays(naturalDay,1),boundary,tz)};
}
function businessDay(state,roleId,at){return scheduleWindow(state,roleId,at).day;}

const lastAutoChecks=new Map();
const chatJudges=new Map(),closedChatJudges=new WeakSet();
function backgroundBusy(getState){const scope=chatJudges.get(getState);return Boolean(scope&&(scope.timers.size||scope.tasks.size));}

async function close(getState){
  closedChatJudges.add(getState);
  const scope=chatJudges.get(getState);if(!scope)return;
  for(const timer of scope.timers.values())clearTimeout(timer);
  scope.timers.clear();
  await Promise.allSettled([...scope.tasks]);
  chatJudges.delete(getState);
}

function ensureData(state){return Data.data(state);}
function slotBrief(s,full){const outfit=String(s?.outfitSnapshot?.description||s?.outfitSnapshot?.text||'').slice(0,60);return {start:s.start,end:s.end,activity:s.activity,scene:s.scene,...(full?{phone:s.phone,restType:s.restType,outfitType:s.outfitType}:{}),mood:s.mood,...(outfit?{outfit}:{})};}

function nowHmInTz(at,tz){
  const p=T.parts(at,tz);
  return {hm:String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0'),hour:p.hour,minute:p.minute,totalMin:p.hour*60+p.minute};
}


function slotIndexAt(slots,nowHm){
  const idx=slots.findIndex(s=>s.start<=nowHm&&(nowHm<s.end||(s.end==='23:59'&&nowHm==='23:59')));
  if(idx>=0)return idx;
  const upcoming=slots.findIndex(s=>nowHm<s.start);
  return upcoming>=0?upcoming:Math.max(0,slots.length-1);
}

function currentState(state,roleId,at=Date.now()){
  if(!roleSettings(state,roleId).enabled)return null;
  const tz=state.settings?.timezone||'UTC',today=businessDay(state,roleId,at);
  const plan=state.engine?.data?.schedule?.days?.[roleId];
  if(!plan||plan.day!==(plan.timelineVersion===2?today:T.dayKey(at,tz)))return null;
  const {hm}=nowHmInTz(at,tz);
  const slots=Array.isArray(plan.slots)?plan.slots:[];
  const idx=plan.timelineVersion===2?slots.findIndex(s=>s.startAt<=at&&at<s.endAt):slotIndexAt(slots,hm);
  const active=slots[idx]||null,previousSlot=idx>0?slots[idx-1]:null,nextSlot=idx+1<slots.length?slots[idx+1]:null;
  const outfitInfo=Core.resolveSlotOutfit(active,plan.outfits,plan.outfit);
  return {
    day:plan.day,
    time:hm,
    outfit:outfitInfo.text||plan.outfit||'',
    outdoorOutfit:plan.outfit||'',
    outfitType:outfitInfo.type,
    outfitImage:outfitInfo.image||'',
    outfits:plan.outfits||{},
    mood:active?.mood||plan.mood||'',
    activity:active?.activity||'',
    scene:active?.scene||'',
    phone:active?.restType&&active.restType!=='none'?'offline':(active?.phone||'free'),
    restType:active?.restType||'none',
    currentSlot:active,
    previousSlot,
    nextSlot,
    weather:plan.weather||{},
    daySummary:plan.daySummary||'',
    slots,
    changes:plan.changes||[],
    surprises:plan.surprises||[]
  };
}
function activeChatRoles(state,now){
  return new Set((state.messages||[])
    .filter(m=>m.sender==='user'&&m.status!=='demo'&&m.createdAt>now-ACTIVE_CHAT_WINDOW&&m.createdAt<=now)
    .map(m=>m.roleId));
}

function validateSlots(slots,sleepProfile='day_normal'){
  if(!Array.isArray(slots)||slots.length>40)S.fail('日程时段列表无效');
  const raw=slots.map(item=>{
    if(!S.obj(item))S.fail('日程时段格式无效');
    const startMin=Core.toMinutes(item.start),endMin=Core.toMinutes(item.end);
    if(startMin===null||endMin===null)S.fail('日程时段须为 HH:mm 格式');
    const activity=S.text(String(item.activity||''),200).trim();
    const scene=S.text(String(item.scene||''),200).trim();
    if(!activity)S.fail('日程活动内容不能为空');
    return {start:Core.fromMinutes(startMin),end:endMin>=24*60?'23:59':Core.fromMinutes(endMin),activity,scene,phone:item.phone,restType:item.restType,outfitType:item.outfitType,mood:item.mood};
  });
  return Core.repairSlots(raw,'TA',{sleepProfile,preserveSingleFullDay:false});
}

function schedulePersona(state,role){
 const id=role.rolePersonaId||'';
 return {id,text:state.rolePersonas?.find(p=>p.id===id)?.prompt||role.prompt||role.name};
}
function assertCurrentPersona(state,role,persona){
 const current=schedulePersona(state,role);
 if(current.id!==persona.id||current.text!==persona.text)S.fail('人设已变更，请重新生成',409,STALE_PERSONA);
}
function saveProfile(state,roleId,profile){
 const role=S.role(state,roleId);const d=ensureData(state);d.profiles[roleId]=Data.profile(profile);d.profileMeta[roleId]={...d.profileMeta[roleId],source:'manual',personaSnapshot:schedulePersona(state,role).text,updatedAt:Date.now()};return d.profiles[roleId];
}
async function generateProfileContent(state,{mutate,roleId,modelApi=defaultModels,onUsage,signal,now=Date.now}={}){
 const role=S.role(state,roleId);S.chatAllowed(role);const persona=schedulePersona(state,role);
 const parse=raw=>{const input=parseJson(raw);for(const k of Data.PROFILE_FIELDS)if(typeof input[k]!=='string'||!input[k].trim())S.fail('生活档案缺少字段 '+k,502,'PROVIDER_RESPONSE');return Data.profile(Object.fromEntries(Data.PROFILE_FIELDS.map(k=>[k,input[k].slice(0,1000)])));};
 const sleepProfile=roleSettings(state,roleId).sleepProfile;
 const rule=sleepProfile==='free'?'按人设保留夜班、倒班、白天睡眠和自由生活节奏，不强制昼夜时间。':sleepProfile==='night_owl'?'采用规律的夜猫子作息：01:30–04:00入睡，09:30–12:30起床；04:00–09:30保持睡眠。':'每天白天活动，凌晨02:00–06:00必须睡眠。人设写了夜班或倒班时，保留职业和身份，把班次、定期活动和手机习惯写成符合这一作息的白天安排。';
 const result=await modelApi.call(state,{purpose:'chat',role,signal,onUsage,messages:[{role:'system',content:'根据角色人设生成独立生活档案，只输出JSON，以下10个字段全部填写字符串：'+Data.PROFILE_FIELDS.join(',')+'。identity身份职业；living居住；routineWorkday工作时作息；routineRestday休息时作息；weeklyFixed每周固定安排；periodic周期事项；vacations假期；socialCircle社交圈；hobbiesPlaces兴趣地点；phoneHabits手机习惯。工作日/休息日由职业和生活设定决定，不能固定周一至五。与生成今日日程采用同一作息规则：'+rule+'此规则适用于档案所有字段，勿写与睡眠段重叠的值班或定期事项。'},{role:'user',content:persona.text}],validateResponse:message=>parse(message)});
 const profile=parse(result.message),at=now();
 mutate(s=>{
  assertCurrentPersona(s,S.role(s,roleId),persona);
  const d=ensureData(s),old=d.profiles[roleId],backups=d.profileMeta[roleId]?.backups||[];
  if(old)backups.push({at,profile:structuredClone(old)});
  d.profiles[roleId]=profile;
  d.profileMeta[roleId]={source:'generated',generatedAt:at,updatedAt:at,personaSnapshot:persona.text,backups};
 });
 return profile;
}
async function generateProfile(state,opts={}){
 const key=(opts.scope||'default')+':'+opts.roleId+':profile';if(inFlight.has(key))return inFlight.get(key);
 const at=(opts.now||Date.now)();
 const task=(async()=>{opts.mutate(s=>{S.role(s,opts.roleId);const d=ensureData(s);d.generation[opts.roleId]={...d.generation[opts.roleId],status:'running',stage:'profile',updatedAt:at};});
 try{const profile=await generateProfileContent(state,opts);opts.mutate(s=>{if(!s.roles.some(r=>r.id===opts.roleId))return;const d=ensureData(s);d.generation[opts.roleId]={...d.generation[opts.roleId],status:'ready',stage:'profile',updatedAt:(opts.now||Date.now)()};});return profile;}
 catch(error){try{opts.mutate(s=>{if(!s.roles.some(r=>r.id===opts.roleId))return;const d=ensureData(s);d.generation[opts.roleId]={...d.generation[opts.roleId],status:error.code===STALE_PERSONA?'interrupted':'failed',stage:'profile',error:error.message,updatedAt:(opts.now||Date.now)()};});}catch{}throw error;}})();
 inFlight.set(key,task);try{return await task;}finally{inFlight.delete(key);}
}

function parseJson(raw){const text=visibleText(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{const p=JSON.parse(text.slice(text.indexOf('{')));if(!S.obj(p))throw Error();return p;}catch{S.fail('日程模型返回格式无效',502,'PROVIDER_RESPONSE');}}

function addWardrobeItem(state,roleId,item,{dataDir}={}){
 S.role(state,roleId);const d=ensureData(state),result=Wardrobe.upsertItem(d.wardrobes[roleId]||[],item,{dataDir});d.wardrobes[roleId]=result.items;return result.item;
}
function importWardrobe(state,roleId,items,{dataDir}={}){
 S.role(state,roleId);const d=ensureData(state),result=Wardrobe.importItems(d.wardrobes[roleId]||[],items,{dataDir});
 d.wardrobes[roleId]=result.items;return {added:result.added,duplicates:result.duplicates};
}

function removeWardrobeItem(state,roleId,itemId){
  const d=ensureData(state);
  const list=d.wardrobes[roleId]||[];
  d.wardrobes[roleId]=list.filter(x=>x.id!==itemId);
  return d.wardrobes[roleId];
}

function collectTodayOutfit(state,roleId,kind='outdoor'){
  const d=ensureData(state);
  const plan=d.days[roleId];
  if(!plan)S.fail('今天还没有生成日程与穿搭');
  const label={outdoor:'外出',home:'居家',sleepwear:'睡衣'}[kind]||'外出';
  const desc=plan.outfits?.[kind]?.description||(kind==='outdoor'?plan.outfit:'');
  if(!desc)S.fail('这一场景还没有穿搭可收藏');
  const item=addWardrobeItem(state,roleId,{description:desc,category:label,seasons:[Core.seasonForDay(plan.day)]});
  if(plan.outfits?.[kind]){plan.outfits[kind].id=item.id;plan.outfits[kind].temporary=false;}
  return item;
}

function saveForRole(state,roleId,input,now=Date.now()){
  const r=S.role(state,roleId);
  const tz=state.settings?.timezone||'UTC',window=scheduleWindow(state,roleId,now);
  const {day,boundary,startAt,endAt}=window;
  const d=ensureData(state);
  const prev=d.days[roleId]?.day===day?d.days[roleId]:{};
  const outfit=S.text(String(input.outfit??prev.outfit??''),400).trim();
  const mood=S.text(String(input.mood??prev.mood??''),100).trim();
  const slots=input.slots!==undefined?(input.slots.every(x=>Number.isFinite(x.startAt))?input.slots:validateSlots(input.slots,roleSettings(state,roleId).sleepProfile)):(prev.slots||[]);
  const outfits=input.outfits||prev.outfits||{outdoor:{id:'',description:outfit,category:'外出',temporary:true},home:{id:'',description:'',category:'居家',temporary:true},sleepwear:{id:'',description:'',category:'睡衣',temporary:true}};
  const stamped=slots.some(x=>Number.isFinite(x.startAt))?slots:Timeline.normalizeWindow(slots,window,tz,r.name,{sleepProfile:roleSettings(state,roleId).sleepProfile});
  const actualSlots=stamped.map(slot=>{if(slot.outfitSnapshot)return slot;const resolved=Core.resolveSlotOutfit(slot,outfits,outfit),picked=outfits[resolved.type]||{};return {...slot,outfitSnapshot:{...picked,type:resolved.type,description:resolved.text,text:resolved.text,image:resolved.image}};});
  const plan={
    day,timelineVersion:2,boundary,startAt,endAt,waitReplyReaction:input.waitReplyReaction??prev.waitReplyReaction??'',waitReplyRecover:input.waitReplyRecover??prev.waitReplyRecover??'',dayType:input.dayType??prev.dayType??'',dayTypeReason:input.dayTypeReason??prev.dayTypeReason??'',review:input.review??prev.review??'',yesterdayReview:input.yesterdayReview??prev.yesterdayReview??'',originalSlots:prev.originalSlots||structuredClone(actualSlots),knownFrom:prev.knownFrom??now,actualSlots:actualSlots.filter(slot=>slot.endAt>(prev.knownFrom??now)).map(slot=>({...slot,startAt:Math.max(slot.startAt,prev.knownFrom??now),start:Timeline.clock(Math.max(slot.startAt,prev.knownFrom??now),tz)})),
    outfit,
    outfits,
    mood,
    daySummary:S.text(String(input.daySummary??prev.daySummary??''),300),
    weather:input.weather?Object.fromEntries(Object.entries(input.weather).filter(([k])=>!['cacheEntry','significantChange'].includes(k))):(prev.weather||{}),
    slots:actualSlots,
    changes:input.changes??prev.changes??[],
    surprises:input.surprises??prev.surprises??[],
    updatedAt:now
  };
  d.days[roleId]=plan;
  Data.snapshot(d,roleId,plan);
  if(roleSettings(state,roleId).syncBioStatus&&mood){
    r.bio=(mood+(outfit?' · '+outfit:'')).slice(0,200);
  }
  return plan;
}

function parsePlanJson(raw,roleName,routines){
  const cleaned=visibleText(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const jsonStart=cleaned.indexOf('{');
  let parsed;
  try{parsed=JSON.parse(jsonStart>=0?cleaned.slice(jsonStart):cleaned);}
  catch{S.fail('今日日程生成格式无效，请重试',502,'PROVIDER_RESPONSE');}
  if(!S.obj(parsed))S.fail('今日日程生成格式无效',502,'PROVIDER_RESPONSE');
  const tempOutfits=S.obj(parsed.temporaryOutfits||parsed.temporary_outfits)?(parsed.temporaryOutfits||parsed.temporary_outfits):{};
  const outdoorText=Core.sanitizeForbiddenText(String(tempOutfits.outdoor||parsed.outfit||'简约日常穿搭').trim(),roleName).slice(0,400)||'简约日常穿搭';
  const homeText=Core.sanitizeForbiddenText(String(tempOutfits.home||'舒适棉质居家服').trim(),'舒适居家服').slice(0,400);
  const sleepText=Core.sanitizeForbiddenText(String(tempOutfits.sleepwear||'柔软宽松睡衣').trim(),'柔软睡衣').slice(0,400);
  const mood=Core.sanitizeForbiddenText(String(parsed.mood||'轻松').trim(),'轻松').slice(0,100);
  const daySummary=Core.sanitizeForbiddenText(String(parsed.daySummary||parsed.day_summary||'').trim(),'普通充实的一天').slice(0,300);
  const rawSlots=Array.isArray(parsed.slots)?parsed.slots:[];
  if(rawSlots.length<10||rawSlots.length>25||rawSlots.some(x=>!x.activity||Core.toMinutes(x.start)===null||Core.toMinutes(x.end)===null))S.fail('日程须含10至25个有效时段',502,'PROVIDER_RESPONSE');
  const dayType=/^(rest|restday|rest_day|休息日|休息)$/i.test(String(parsed.dayType||''))?'rest':'work';
  const routine=routines?.work?(dayType==='rest'?routines.rest:routines.work):routines;
  const enforceCircadian=routine?.enforceCircadian!==false;
  const windows=routine&&enforceCircadian?[[routine.sleepMin>=1440?routine.sleepMin-1440:0,routine.wakeMin],...(routine.sleepMin<1440?[[routine.sleepMin,1440]]:[])]:[];
  let arranged=Core.repairSlots(rawSlots,roleName,{routine,enforceCircadian,preserveSingleFullDay:false});
  for(const [start,end]of windows){const next=[];for(const slot of arranged){const from=Core.toMinutes(slot.start),to=slot.end==='23:59'?1440:Core.toMinutes(slot.end);if(to<=start||from>=end){next.push(slot);continue;}if(from<start)next.push({...slot,end:Core.fromMinutes(start)});if(to>end)next.push({...slot,start:Core.fromMinutes(end)});}next.push({start:Core.fromMinutes(start),end:Core.fromMinutes(end),activity:'夜间熟睡',scene:'卧室床上',phone:'offline',restType:'night_sleep',outfitType:'sleepwear',mood:'熟睡'});arranged=next;}
  arranged=arranged.map(slot=>{if(!enforceCircadian||slot.restType!=='night_sleep'||windows.some(([start,end])=>Core.toMinutes(slot.start)>=start&&(slot.end==='23:59'?1440:Core.toMinutes(slot.end))<=end))return slot;return {...slot,activity:'醒着处理日常安排',phone:'free',restType:'none',outfitType:'home',mood:'平静'};});
  const slots=Core.repairSlots(arranged,roleName,{routine,enforceCircadian,preserveSingleFullDay:false});
  let simulatedWeather=null;if(S.obj(parsed.simulatedWeather)){const w=parsed.simulatedWeather;if(typeof w.summary==='string'&&w.summary.trim()&&Number.isFinite(w.tempMin)&&Number.isFinite(w.tempMax)&&w.tempMin>=-80&&w.tempMax<=65&&w.tempMin<=w.tempMax)simulatedWeather={summary:w.summary.trim().slice(0,100),tempMin:w.tempMin,tempMax:w.tempMax,precipProb:Number.isFinite(w.precipProb)?Math.max(0,Math.min(100,w.precipProb)):0};}
  return {waitReplyReaction:['无反应','轻微在意','有点在意','会失落'].includes(parsed.wait_reply_reaction)?parsed.wait_reply_reaction:'',waitReplyRecover:['自动恢复','对方回复后恢复','需要对方主动一点'].includes(parsed.wait_reply_recover)?parsed.wait_reply_recover:'',simulatedWeather,longEvents:Array.isArray(parsed.longEvents)?parsed.longEvents:[],dayType,dayTypeReason:String(parsed.dayTypeReason||''),yesterdayReview:String(parsed.yesterdayReview||''),outfit:outdoorText,tempOutfits:{outdoor:outdoorText,home:homeText,sleepwear:sleepText},mood,daySummary,slots};
}

function scheduleSurprisePoints(slots,nowMs,tz,prob=0.5){
  if(Math.random()>=prob)return [];
  const minute=60000;
  const candidates=[];
  for(const slot of slots){
    if(slot.restType!=='none'||slot.phone==='offline')continue;
    const from=Math.ceil(Math.max(slot.startAt,nowMs)/minute)+10,to=Math.floor(slot.endAt/minute)-10;
    if(to>from)candidates.push(Math.round(from+Math.random()*(to-from)));
  }
  if(!candidates.length)return [];
  const chosen=candidates[Math.floor(Math.random()*candidates.length)];
  const points=[chosen];if(candidates.length>1&&Math.random()<0.5){const other=candidates.find(x=>Math.abs(x-chosen)>60);if(other)points.push(other);}
  return points.sort((a,b)=>a-b).map(min=>({id:'sp-'+S.id().slice(0,8),at:min*minute,atHm:Timeline.clock(min*minute,tz),triggered:false}));
}

async function generatePlan(stateSnapshot,{mutate,roleId,signal,onUsage,modelApi=defaultModels,now=Date.now,force=false,extra='',outfitId=''}={}){
  const at=now();
  const tz=stateSnapshot.settings?.timezone||'UTC',window=scheduleWindow(stateSnapshot,roleId,at),today=window.day;
  const d=stateSnapshot.engine?.data?.schedule||{};
  const existing=d.days?.[roleId];
  if(existing&&existing.day===(existing.timelineVersion===2?today:T.dayKey(at,tz))&&!force)return existing;
  const role=S.role(stateSnapshot,roleId);S.chatAllowed(role);
  const persona=schedulePersona(stateSnapshot,role),personaPrompt=persona.text;
  const profile=d.profiles?.[roleId]||{};
  const requestedWeather=weatherRequest(stateSnapshot,roleId,at),city=requestedWeather.city;
  const settings=roleSettings(stateSnapshot,roleId);
  let weather=await Weather.resolveCityWeather(city,today,d.weatherCache||{},personaPrompt,{enabled:settings.weatherEnabled!==false,now:at,timezone:tz});
  const history=d.history?.[roleId]||[],historyStart=T.addDays(today,-settings.referenceHistoryDays);
  const historyDays=history.filter(h=>h.day>=historyStart&&h.day<today);
  const yesterday=historyDays.find(h=>h.day===T.addDays(today,-1));
  const recentOutfitIds=Wardrobe.recentActualOutfits(history,today,settings.outfitNoRepeatDays);
  let wardrobeOutfits=Wardrobe.selectWardrobeOutfits(d.wardrobes?.[roleId]||[],weather,recentOutfitIds,today);
  const routines={work:Core.computeRoutine(profile,{isWorkday:true,sleepProfile:settings.sleepProfile,jitterMinutes:settings.routineJitterMinutes??20}),rest:Core.computeRoutine(profile,{isWorkday:false,sleepProfile:settings.sleepProfile,jitterMinutes:settings.routineJitterMinutes??20})};
  const sysPrompt=role.schedulePrompt?.trim()||'根据角色性格、职业与习惯自然安排普通一天的作息';
  // Check the requested wardrobe outfit before paying for the model call.
  if(outfitId&&!(d.wardrobes?.[roleId]||[]).some(x=>x.id===outfitId))S.fail('衣柜穿搭不存在');

  const slotExample=settings.sleepProfile==='day_normal'?`[{"start":"00:00","end":"${routines.work.wakeHm}","activity":"夜间熟睡","scene":"卧室床上","phone":"offline","restType":"night_sleep","outfitType":"sleepwear"},{"start":"${routines.work.wakeHm}","end":"12:00","activity":"上午活动","scene":"地点","phone":"glance","restType":"none","outfitType":"outdoor"}]`:'[{"start":"00:00","end":"01:00","activity":"按所选作息与人设安排活动或睡眠","scene":"地点","phone":"free","restType":"none","outfitType":"home"}]';
  const messages=[
    {role:'system',content:`你是角色日常生活策划助手。请严格遵循以下两条铁律：
1. 【作息规则：${Core.SLEEP_PROFILES[settings.sleepProfile].label}】先按人设判断dayType为work或rest，再参考对应作息：工作日起床约${routines.work.wakeHm}、入睡约${routines.work.sleepHm}；休息日起床约${routines.rest.wakeHm}、入睡约${routines.rest.sleepHm}。${settings.sleepProfile==='free'?'保留人设中的夜班、倒班、白天睡眠和自由生活节奏，不强制正常昼夜时间。':settings.sleepProfile==='night_owl'?'入睡保持01:30–04:00、起床保持09:30–12:30；04:00–09:30必须为熟睡，允许凌晨工作和上午补觉；午休小憩最多45分钟。':'起床保持06:30–10:00、入睡保持22:00–01:30；02:00–06:00必须为夜间熟睡，不能安排工作或出门；午休小憩最多45分钟。'}睡眠时restType=night_sleep、phone=offline、outfitType=sleepwear。
2. 【纯线上异地恋爱边界】你和用户在各自的城市生活，绝不把与用户“线下见面、同居、去对方家、连麦通话”写进日程或穿搭理由。
只输出 JSON 对象：{"outfit":"本日外出穿搭（含颜色款式，结合气温 ${weather.tempMin??15}~${weather.tempMax??22}℃）","temporaryOutfits":{"outdoor":"外出服","home":"居家服","sleepwear":"睡衣"},"mood":"今日基调心情","daySummary":"今日30字概括","slots":${slotExample}}，10～25 个连贯时段覆盖 00:00 到 23:59。工作/休息日请依角色职业、人设和具体日期自主判断，不要固定周一到周五。如果天气是季节概况而非实况，可结合人设环境输出simulatedWeather:{summary:'明确模拟的天气概况',tempMin:数字,tempMax:数字,precipProb:0到100}，不得声称为真实天气。额外输出wait_reply_reaction（无反应/轻微在意/有点在意/会失落）和wait_reply_recover（自动恢复/对方回复后恢复/需要对方主动一点），按角色性格填写，只作之后回复时的性格参考。额外输出 dayType、dayTypeReason、yesterdayReview（只回顾提供的昨日真实记录，不编造已发生的事）、longEvents（未来1至7天事件，默认不自动新增）。`},
    {role:'user',content:`角色：${role.name}\n人设：${personaPrompt}\n作息与穿搭偏好：${sysPrompt}\n生活档案：${JSON.stringify(profile)}\n业务日：${today} ${settings.boundary}至次日${settings.boundary}\n日期背景：${JSON.stringify(Calendar.calendarForDay(today))}\n今日日期与天气：${T.format(at,tz)}，${weather.city?weather.city+' ':''}${weather.summary} ${weather.tempMin??''}~${weather.tempMax??''}℃\n已从衣柜预选（留空项请在 temporaryOutfits 补充）：${JSON.stringify(wardrobeOutfits)}\n额外要求：${String(extra).slice(0,2000)}\n昨日完整记录：${JSON.stringify(yesterday?{day:yesterday.day,actualSlots:(yesterday.actualSlots||[]).map(x=>slotBrief(x,true)),changes:yesterday.changes||[],review:yesterday.review||''}:null)}\n相关长期事件：${JSON.stringify((d.events?.[roleId]||[]).filter(e=>e.status==='active'&&e.startDate<=T.addDays(today,1)&&e.endDate>=today))}\n未完约定：${JSON.stringify((d.promises?.[roleId]||[]).filter(p=>p.status==='pending'&&!Data.overdue(p,at)))}\n用户事项：${JSON.stringify((d.userEvents?.[roleId]||[]).filter(e=>e.status==='pending'&&!Data.overdue(e,at)))}\n近期摘要：${historyDays.map(h=>h.day+':'+(h.daySummary||h.summary||'')).join('；')||'无'}`}
  ];
  const result=await modelApi.call(stateSnapshot,{purpose:'chat',role,messages,signal,onUsage,validateResponse:message=>parsePlanJson(message,role.name,routines)});
  const parsed=parsePlanJson(result.message,role.name,routines);
  if(weather.source==='seasonal'&&parsed.simulatedWeather){weather={...weather,...parsed.simulatedWeather,source:'seasonal',sourceLabel:'AI模拟天气',simulated:true,aiSimulated:true};wardrobeOutfits=Wardrobe.selectWardrobeOutfits(d.wardrobes?.[roleId]||[],weather,recentOutfitIds,today);}
  const finalOutfits={
    outdoor:wardrobeOutfits.outdoor?.description?wardrobeOutfits.outdoor:{id:'',description:parsed.tempOutfits.outdoor,category:'外出',image:'',temporary:true},
    home:wardrobeOutfits.home?.description?wardrobeOutfits.home:{id:'',description:parsed.tempOutfits.home,category:'居家',image:'',temporary:true},
    sleepwear:wardrobeOutfits.sleepwear?.description?wardrobeOutfits.sleepwear:{id:'',description:parsed.tempOutfits.sleepwear,category:'睡衣',image:'',temporary:true},
    ...(wardrobeOutfits.sports?{sports:wardrobeOutfits.sports}:{})
  };
  if(outfitId){const chosen=(d.wardrobes?.[roleId]||[]).find(x=>x.id===outfitId);if(!chosen)S.fail('衣柜穿搭不存在');finalOutfits.outdoor={...chosen,temporary:false};}
  const outfitMain=finalOutfits.outdoor.description||parsed.outfit;

  let saved;
  mutate(s=>{
    assertCurrentPersona(s,S.role(s,roleId),persona);
    const commitNow=now(),liveWindow=scheduleWindow(s,roleId,commitNow);
    if(liveWindow.day!==today||liveWindow.startAt!==window.startAt||liveWindow.endAt!==window.endAt)S.fail('生成期间业务日已变化，请重新生成',409);
    checkWeatherRequest(s,roleId,commitNow,requestedWeather);
    if(weather.cacheEntry)ensureData(s).weatherCache[weather.cacheEntry.key]=weather.cacheEntry.entry;
    const live=ensureData(s).days[roleId];
    // A plan saved meanwhile (by the user or another run) wins over a background generation.
    if(!force&&live&&live.day===(live.timelineVersion===2?today:T.dayKey(at,tz))){saved=live;return;}
    if(force&&live&&live.day===(live.timelineVersion===2?today:T.dayKey(at,tz))){const base=live.timelineVersion===2?live.slots:Timeline.timeline(live.slots,today,tz,'00:00');parsed.slots=Timeline.merge(base,parsed.slots,commitNow,today,tz,window.boundary,role.name,window,{sleepProfile:settings.sleepProfile});}
    else parsed.slots=Timeline.normalizeWindow(parsed.slots,window,tz,role.name,{sleepProfile:settings.sleepProfile});
    if(Math.random()<roleSettings(s,roleId).longEventProbability)for(const ev of parsed.longEvents.slice(0,1)){try{const start=String(ev.startDate||''),end=String(ev.endDate||'');if(start>=today&&start<=T.addDays(today,7)&&end>=start&&end<=T.addDays(start,6))saveEvent(s,roleId,{...ev,source:'ai'},at);}catch{/* a malformed AI event is skipped, not the whole plan */}}
    saved=saveForRole(s,roleId,{waitReplyReaction:parsed.waitReplyReaction,waitReplyRecover:parsed.waitReplyRecover,changes:force&&live?[...(live.changes||[]),{time:commitNow,description:'手动重新生成后续日程'}]:[],dayType:parsed.dayType,dayTypeReason:parsed.dayTypeReason,yesterdayReview:yesterday?parsed.yesterdayReview:'',outfit:outfitMain,outfits:finalOutfits,mood:parsed.mood,daySummary:parsed.daySummary,weather,slots:parsed.slots,surprises:force&&live?.day===today?live.surprises: scheduleSurprisePoints(parsed.slots,commitNow,tz,settings.surpriseProbability??0.5)},commitNow);
    if(yesterday&&parsed.yesterdayReview){const history=ensureData(s).history[roleId],entry=history.find(h=>h.day===yesterday.day);if(entry)entry.review=parsed.yesterdayReview;}
  });
  return saved;
}

async function generateForRole(state,opts={}){
 const key=(opts.scope||'default')+':'+opts.roleId;
 if(inFlight.has(key)){
  // A user's regeneration waits for a background run instead of silently dropping its extra request or outfit.
  const running=inFlight.get(key);if(!opts.force||running.force)return running;
  try{await running;}catch{}
  return generateForRole(opts.getState?.()||state,opts);
 }
 const at=(opts.now||Date.now)();
 const previous=state.engine?.data?.schedule?.days?.[opts.roleId],tz=state.settings?.timezone||'UTC';if(previous&&previous.day===(previous.timelineVersion===2?businessDay(state,opts.roleId,at):T.dayKey(at,tz))&&!opts.force)return previous;
 const task=(async()=>{
  let priorAttempts;
  opts.mutate(s=>{
   S.role(s,opts.roleId);
   const d=ensureData(s),previous=d.generation[opts.roleId],day=businessDay(s,opts.roleId,at);
   priorAttempts=previous?.day===day?previous.attempts||0:0;
   d.generation[opts.roleId]={status:'running',stage:'daily',startedAt:at,attempts:priorAttempts+1,day};
  });
  try{let snapshot=state;if(!state.engine?.data?.schedule?.profiles?.[opts.roleId]){const profile=await generateProfile(state,opts);snapshot=structuredClone(state);ensureData(snapshot).profiles[opts.roleId]=profile;opts.mutate(s=>{S.role(s,opts.roleId);const d=ensureData(s);d.generation[opts.roleId]={...d.generation[opts.roleId],status:'running',stage:'daily'};});}
   const result=await generatePlan(snapshot,opts);opts.mutate(s=>{S.role(s,opts.roleId);const d=ensureData(s);d.generation[opts.roleId]={...d.generation[opts.roleId],status:'ready',updatedAt:(opts.now||Date.now)()};});return result;
  }catch(error){
   opts.mutate(s=>{
    S.role(s,opts.roleId);
    const d=ensureData(s),generation=d.generation[opts.roleId];
    d.generation[opts.roleId]={...generation,error:error.message,updatedAt:at,...([STALE_PERSONA,STALE_WEATHER].includes(error.code)
      ?{status:'interrupted',attempts:priorAttempts}
      :{status:'failed',retryAt:at+5*60000})};
   });
   throw error;
  }
 })();task.force=Boolean(opts.force);inFlight.set(key,task);try{return await task;}finally{inFlight.delete(key);}
}

async function refreshWeather(state,{mutate,getState=()=>state,roleId,onUsage,modelApi=defaultModels,now=Date.now,force=true}={}){
 const at=now(),request=weatherRequest(state,roleId,at),d=state.engine?.data?.schedule||{};
 const result=await Weather.resolveCityWeather(request.city,request.day,d.weatherCache||{},request.persona.text,{force,enabled:request.enabled,now:at,timezone:request.timezone});
 const weather=Object.fromEntries(Object.entries(result).filter(([k])=>!['cacheEntry','significantChange'].includes(k)));
 mutate(latest=>{
   const commitAt=now();checkWeatherRequest(latest,roleId,commitAt,request);
   const bucket=ensureData(latest),plan=bucket.days[roleId];
   if(result.cacheEntry)bucket.weatherCache[result.cacheEntry.key]=result.cacheEntry.entry;
   if(plan&&plan.day===(plan.timelineVersion===2?request.day:T.dayKey(commitAt,request.timezone))){
     // Keep the day's AI-simulated weather (outfits were chosen for it) when a refresh only has the generic seasonal value.
     if(!(plan.weather?.aiSimulated&&['seasonal','unavailable'].includes(weather.source)))plan.weather=weather;
     plan.weatherCheckedAt=at;Data.snapshot(bucket,roleId,plan);
   }
 });
 if(result.significantChange)await applyScheduleChange({getState,mutate,roleId,onUsage,modelApi,now,requestedWeather:request,reason:'天气显著变化：'+weather.summary});
 return weather;
}

function refreshPromises(list,nowMs){return Data.expire(list,nowMs);}

async function applyScheduleChange({getState,mutate,roleId,reason,recentText='',fromChat=false,requestedWeather,onUsage,modelApi=defaultModels,now=Date.now}){
  const at=now();
  const s=getState(),role=S.role(s,roleId);
  if(requestedWeather)checkWeatherRequest(s,roleId,at,requestedWeather);
  if(fromChat&&!roleSettings(s,roleId).chatChangeEnabled)return;
  const d=s.engine?.data?.schedule||{},tz=s.settings?.timezone||'UTC';
  const plan=d.days?.[roleId],today=plan?.timelineVersion===2?businessDay(s,roleId,at):T.dayKey(at,tz);
  if(!plan||plan.day!==today)return;
  const persona=schedulePersona(s,role);
  const {hm}=nowHmInTz(at,tz);
  const futureSlots=plan.slots.filter(sl=>plan.timelineVersion===2?sl.endAt>at:sl.end>hm);
  const existingEvents=(d.userEvents?.[roleId]||[]).filter(e=>e.status==='pending'&&!Data.overdue(e,at));
  const existingPromises=(d.promises?.[roleId]||[]).filter(p=>p.status==='pending'&&!Data.overdue(p,at));
  const messages=[
    {role:'system',content:`你是角色生活动态判断助手。根据刚才的对话或突发插曲，判断角色【从此刻 ${hm} 起】今天的未来日程、约定、心情，以及用户提到的待回访事件（userEvents）是否需要更新。用户明确指定时间的提醒由聊天中的 future_task 工具安排，不要再把同一提醒写成约定或回访。严格禁写线下见面、去对方家里或实时语音通话。输出严格 JSON：{"scheduleChanges":[{"start":"HH:mm","end":"HH:mm","activity":"...","scene":"...","phone":"free|glance|offline","outfitType":"outdoor|home|sleepwear"}],"promises":[{"type":"tell|do|avoid","content":"...","date":"YYYY-MM-DD或空(未约日期)","dueHm":"HH:mm"}],"userEvents":[{"content":"用户要做的事","date":"YYYY-MM-DD或空","eventHm":"HH:mm","followUpHours":2}],"promiseUpdates":[{"id":"已有约定ID","status":"done|cancelled|missed","note":"实际依据，失约必须有真实原因，无依据不更新"}],"userEventUpdates":[{"id":"已有用户事项ID","status":"done|cancelled","note":"实际依据"}],"longEventUpdates":[{"id":"已有长期事件ID","status":"active|done|cancelled","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD（总持续1至7天）","content":"更新后的内容","note":"实际依据"}],"userEventDoneIds":[],"moodUpdate":"","changeNote":"15字内概括变动"}；无变动则数组留空。`},
    {role:'user',content:`角色：${role.name}\n人设：${persona.text}\n原因：${reason}\n现在时间：${T.format(at,tz)} (${hm})\n今日未来日程：${JSON.stringify(futureSlots.map(x=>slotBrief(x,true)))}\n待履约约定：${JSON.stringify(existingPromises)}\n用户提及事项：${JSON.stringify(existingEvents)}\n长期事件：${JSON.stringify(d.events?.[roleId]||[])}\n近期对话：\n${recentText.slice(0,2500)}`}
  ];
  const res=await modelApi.call(s,{purpose:'chat',role,messages,onUsage,validateResponse:parseJson});
  const parsed=parseJson(res.message);
  try{mutate(latest=>{
    if(fromChat&&!roleSettings(latest,roleId).chatChangeEnabled)return;
    const commitNow=now();if((plan.timelineVersion===2?businessDay(latest,roleId,commitNow):T.dayKey(commitNow,tz))!==today)S.fail('调整期间业务日已变化，请重试',409);
    if(requestedWeather)checkWeatherRequest(latest,roleId,commitNow,requestedWeather);
    const liveRole=S.role(latest,roleId);S.chatAllowed(liveRole);
    assertCurrentPersona(latest,liveRole,persona);
    const bucket=ensureData(latest);
    const live=bucket.days[roleId];
    if(!live||live.day!==today)return;
    let touched=false;
    // Each AI item is checked on its own: a malformed one is skipped instead of rolling back the whole adjustment.
    const clockOf=v=>{const m=Core.toMinutes(String(v??'').trim());return m===null?'':Core.fromMinutes(m);};
    const padTime=v=>{const m=Core.toMinutes(String(v||'').trim());return m===null||m>=1440?String(v||''):Core.fromMinutes(m);};
    if(Array.isArray(parsed.scheduleChanges)&&parsed.scheduleChanges.length){
      const safeChanges=parsed.scheduleChanges.filter(sl=>S.obj(sl)&&clockOf(sl.start)&&clockOf(sl.end)&&!Core.containsForbidden(sl)).map(sl=>({...sl,start:clockOf(sl.start),end:clockOf(sl.end)}));
      if(safeChanges.length){
        const base=live.timelineVersion===2?live.slots:Timeline.timeline(live.slots,T.dayKey(at,tz),tz,'00:00');
        const window=live.timelineVersion===2?scheduleWindow(latest,roleId,commitNow):undefined;
        let merged=base,applied=0;
        for(const change of safeChanges){try{merged=Timeline.merge(merged,[change],commitNow,today,tz,window?.boundary||'00:00',role.name,window,{sleepProfile:roleSettings(latest,roleId).sleepProfile});applied++;}catch{}}
        if(applied){
        live.slots=merged.map(slot=>{if(slot.outfitSnapshot)return slot;const outfit=Core.resolveSlotOutfit(slot,live.outfits,live.outfit);return {...slot,outfitSnapshot:{...(live.outfits?.[outfit.type]||{}),type:outfit.type,description:outfit.text,text:outfit.text,image:outfit.image}};});
        live.changes??=[];
        live.changes.push({time:commitNow,description:Core.sanitizeForbiddenText(parsed.changeNote||reason,'日程小调整')});
        live.changes=live.changes.slice(-100);
        touched=true;
        }
      }
    }
    if(Array.isArray(parsed.promises)){
      const list=bucket.promises[roleId]??=[];
      for(const pr of parsed.promises.slice(0,3)){
        if(!pr?.content||Core.containsForbidden(pr.content))continue;
        const text=String(pr.content).trim().slice(0,100);
        if(list.some(x=>String(x.content).trim().slice(0,100)===text&&x.status==='pending'))continue;
        try{
          const record=Data.addRecord(latest,roleId,{...pr,content:String(pr.content).trim().slice(0,500),date:pr.date||pr.dueDate||'',time:padTime(pr.time||pr.dueHm||'')},'promises',commitNow);
          if(require('../scheduler.cjs').matchesExplicit(latest,roleId,record.content,record.dueAt)){list.pop();continue;}
          touched=true;
        }catch{}
      }
      bucket.promises[roleId]=list.slice(-20);
    }
    if(Array.isArray(parsed.userEvents)){
      const evs=bucket.userEvents[roleId]??=[];
      for(const ev of parsed.userEvents.slice(0,3)){
        const content=String(ev?.content||'').trim().slice(0,60);
        if(!content||Core.containsForbidden(content)||evs.some(x=>String(x.content).trim().slice(0,60)===content&&x.status==='pending'))continue;
        try{Data.addRecord(latest,roleId,{...ev,content:String(ev.content).trim().slice(0,500),date:ev.date||ev.eventDate||'',time:padTime(ev.time||ev.eventHm||'')},'userEvents',commitNow);touched=true;}catch{}
      }
      bucket.userEvents[roleId]=evs.slice(-20);
    }
    if(Array.isArray(parsed.userEventDoneIds)&&bucket.userEvents[roleId]){
      for(const item of bucket.userEvents[roleId])if(parsed.userEventDoneIds.includes(item.id))item.status='done';
    }
    for(const [key,type]of [['promiseUpdates','promises'],['userEventUpdates','userEvents']])for(const update of Array.isArray(parsed[key])?parsed[key]:[]){
      if(!(bucket[type][roleId]||[]).some(x=>x.id===update?.id))continue;
      if(!['done','cancelled','missed'].includes(update.status)||!String(update.note||'').trim())continue;
      try{Data.mark(latest,roleId,update.id,update.status,type,String(update.note).slice(0,500),commitNow);}catch{}
    }
    for(const update of Array.isArray(parsed.longEventUpdates)?parsed.longEventUpdates:[]){const item=(bucket.events[roleId]||[]).find(x=>x.id===update?.id);if(!item||!String(update.note||'').trim())continue;try{const saved=saveEvent(latest,roleId,{...item,...update},commitNow);saved.note=String(update.note).slice(0,500);}catch{}}
    if(typeof parsed.moodUpdate==='string'&&parsed.moodUpdate.trim()){
      const idx=live.timelineVersion===2?live.slots.findIndex(x=>x.startAt<=commitNow&&x.endAt>commitNow):slotIndexAt(live.slots,hm);
      if(idx>=0){const mood=parsed.moodUpdate.trim().slice(0,30);for(const slot of live.slots.slice(idx,idx+3))slot.mood=mood;live.mood=mood;}
    }
    live.updatedAt=commitNow;live.actualSlots=live.slots.filter(slot=>slot.endAt>(live.knownFrom??at)).map(slot=>({...slot,startAt:Math.max(slot.startAt,live.knownFrom??at),start:Timeline.clock(Math.max(slot.startAt,live.knownFrom??at),tz)}));
    Data.snapshot(bucket,roleId,live);
  });}catch(error){
    // An adjustment for a previous persona is obsolete, not a failed daily generation.
    if(error.code!==STALE_PERSONA)throw error;
  }
}

function dueUserEvents(state,roleId,nowMs=Date.now()){
  const list=state.engine?.data?.schedule?.userEvents?.[roleId]||[];
  return list.filter(e=>e.status==='pending'&&e.followUpAt<=nowMs&&nowMs<e.followUpAt+12*3600000);
}
function duePromises(state,roleId,nowMs=Date.now()){
  const list=state.engine?.data?.schedule?.promises?.[roleId]||[];
  return list.filter(p=>p.type==='tell'&&p.status==='pending'&&p.dueAt&&p.dueAt<=nowMs&&nowMs<p.dueAt+30*60000);
}
function markPromiseStatus(state,roleId,id,status,note='',now=Date.now()){return Data.mark(state,roleId,id,status,'promises',note,now);}
function markUserEventStatus(state,roleId,id,status,note='',now=Date.now()){return Data.mark(state,roleId,id,status,'userEvents',note,now);}
function saveSettings(state,roleId,input,now=Date.now()){
 const role=S.role(state,roleId),clean={};
 for(const k of ['enabled','autoGenerate','weatherEnabled','chatChangeEnabled','injectIntoChat','syncBioStatus'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')S.fail('开关格式无效');clean[k]=input[k];}
 for(const [k,min,max]of [['routineJitterMinutes',0,45],['surpriseProbability',0,1],['longEventProbability',0,1]])if(input[k]!==undefined){if(!Number.isFinite(input[k])||input[k]<min||input[k]>max)S.fail('参数范围无效');clean[k]=input[k];}
 if(input.boundary!==undefined){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.boundary))S.fail('业务日起点无效');clean.boundary=input.boundary;}
 if(input.sleepProfile!==undefined)clean.sleepProfile=S.enumOf(input.sleepProfile,Object.keys(Core.SLEEP_PROFILES));
 const d=ensureData(state);
 if(input.city!==undefined){
   const city=S.text(input.city,100).trim(),plan=d.days[roleId];
   if(city!==(role.city?.trim()||'')&&plan&&plan.day===(plan.timelineVersion===2?businessDay(state,roleId,now):T.dayKey(now,state.settings.timezone||'UTC'))){
     plan.weather={};plan.weatherCheckedAt=0;Data.snapshot(d,roleId,plan);
   }
   role.city=city;
 }
 d.roleSettings[roleId]={...d.roleSettings[roleId],...clean};return roleSettings(state,roleId);
}
function saveRecord(state,roleId,input,type,now=Date.now()){
 if(!input.id)return Data.addRecord(state,roleId,input,type,now);
 const d=ensureData(state),list=d[type][roleId]||[],index=list.findIndex(x=>x.id===input.id);if(index<0)S.fail('记录不存在',404);
 const old=list[index],fresh=Data.addRecord(state,roleId,{...old,...input,...(('date'in input||'time'in input)?{dueAt:null,followUpAt:null}:{})},type,now);list.pop();list[index]={...old,...fresh,id:old.id,createdAt:old.createdAt,status:old.status};return list[index];
}
function saveEvent(state,roleId,input,now=Date.now()){
 S.role(state,roleId);const d=ensureData(state),list=d.events[roleId]??=[];const startDate=S.text(String(input.startDate||''),10),endDate=S.text(String(input.endDate||''),10);Calendar.calendarForDay(startDate);Calendar.calendarForDay(endDate);const start=Date.parse(startDate+'T00:00:00Z'),end=Date.parse(endDate+'T00:00:00Z');if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>6*86400000)S.fail('长期事件须为完整日期、持续1至7天');
 const content=S.text(String(input.content||input.title||''),500).trim();if(!content)S.fail('事件内容不能为空');
 const old=input.id?list.find(x=>x.id===input.id):null;if(input.id&&!old)S.fail('事件不存在',404);const item={id:old?.id||'le-'+S.id().slice(0,12),content,startDate,endDate,status:S.enumOf(input.status||old?.status||'active',['active','done','cancelled']),source:input.source||old?.source||'manual',updatedAt:now};if(old)Object.assign(old,item);else list.push(item);return item;
}
function restoreProfileBackup(state,roleId,index){const d=ensureData(state),backup=d.profileMeta[roleId]?.backups?.[index];if(!backup)S.fail('档案备份不存在',404);return saveProfile(state,roleId,backup.profile);}
const ROLE_KEYS=['days','profiles','profileMeta','wardrobes','promises','userEvents','history','events','generation','roleSettings'];
// Entries of deleted friends are dropped, not fatal: a leftover from a background task must not make a backup unrestorable.
function dropOrphans(d,ids){let dropped=false;for(const key of ROLE_KEYS)for(const id of Object.keys(S.obj(d?.[key])?d[key]:{}))if(!ids.has(id)){delete d[key][id];dropped=true;}return dropped;}
function validateRestore(state){
 const d=state.engine?.data?.schedule;if(!d)return;if(!S.obj(d))S.fail('日程备份格式无效');const ids=new Set((state.roles||[]).map(r=>r.id));
 const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 for(const key of ROLE_KEYS)if(d[key]!==undefined&&!S.obj(d[key]))S.fail('日程备份格式无效');
 dropOrphans(d,ids);
 for(const settings of Object.values(d.roleSettings||{})){if(!S.obj(settings))S.fail('日程设置备份格式无效');if(settings.sleepProfile!==undefined)S.enumOf(settings.sleepProfile,Object.keys(Core.SLEEP_PROFILES));}
 for(const key of ['wardrobes','promises','userEvents','history','events'])for(const list of Object.values(d[key]||{}))if(!Array.isArray(list))S.fail('日程备份列表无效');
 for(const plan of [...Object.values(d.days||{}),...Object.values(d.history||{}).flat()]){
  if(!S.obj(plan)||!date(plan.day))S.fail('日程备份日期无效');
  if(plan.startAt!==undefined||plan.endAt!==undefined){if(!Number.isFinite(plan.startAt)||!Number.isFinite(plan.endAt)||plan.startAt>=plan.endAt)S.fail('日程备份时间范围无效');}
  for(const key of ['slots','originalSlots','actualSlots'])if(plan[key]!==undefined){if(!Array.isArray(plan[key]))S.fail('日程备份时段无效');for(const slot of plan[key])if(!S.obj(slot)||Core.toMinutes(slot.start)===null||Core.toMinutes(slot.end)===null||(plan.timelineVersion===2&&(!Number.isFinite(slot.startAt)||!Number.isFinite(slot.endAt)||slot.endAt<=slot.startAt)))S.fail('日程备份时段无效');}
 }
 for(const key of ['promises','userEvents'])for(const list of Object.values(d[key]||{}))for(const item of list){if(!S.obj(item)||typeof item.id!=='string'||typeof item.content!=='string'||!['pending','done','completed','cancelled','missed','expired'].includes(item.status))S.fail('事项备份格式无效');if(item.date&&!date(item.date))S.fail('事项备份日期无效');for(const k of ['dueAt','followUpAt'])if(item[k]!==undefined&&item[k]!==null&&!Number.isFinite(item[k]))S.fail('事项备份时间无效');if(key==='promises'&&!['tell','do','avoid'].includes(item.type))S.fail('约定类型无效');}
 for(const profile of Object.values(d.profiles||{}))if(!S.obj(profile)||Object.values(profile).some(x=>typeof x!=='string'))S.fail('生活档案备份格式无效');
 for(const list of Object.values(d.events||{}))for(const item of list)if(!S.obj(item)||!date(item.startDate)||!date(item.endDate)||item.endDate<item.startDate||Date.parse(item.endDate)-Date.parse(item.startDate)>6*86400000)S.fail('长期事件备份日期无效');
}

function eventsForDay(state,roleId,at=Date.now()){
 const day=businessDay(state,roleId,at);return (state.engine?.data?.schedule?.events?.[roleId]||[]).map(item=>({...item,phase:item.status==='cancelled'?'cancelled':item.status==='done'?'ended':item.endDate<day?'ended':item.startDate>day?'upcoming':'ongoing',status:item.status==='active'&&item.endDate<day?'done':item.status}));
}

function getDay(state,roleId,day){const d=state.engine?.data?.schedule||{};return d.days?.[roleId]?.day===day?d.days[roleId]:(d.history?.[roleId]||[]).find(x=>x.day===day)||null;}
function view(state,roleId,now=Date.now(),{day}={}){S.role(state,roleId);const d=state.engine?.data?.schedule||{};const tz=state.settings?.timezone||'UTC';return {today:businessDay(state,roleId,now),nowHm:Timeline.clock(now,tz),timezone:tz,city:S.role(state,roleId).city||'',current:currentState(state,roleId,now),plan:(day?getDay(state,roleId,day):(d.days?.[roleId]?.day===(d.days?.[roleId]?.timelineVersion===2?businessDay(state,roleId,now):T.dayKey(now,tz))?d.days[roleId]:null))||null,history:d.history?.[roleId]||[],profile:d.profiles?.[roleId]||{},profileMeta:{...d.profileMeta?.[roleId],personaChanged:!!d.profileMeta?.[roleId]?.personaSnapshot&&d.profileMeta[roleId].personaSnapshot!==(state.rolePersonas?.find(p=>p.id===S.role(state,roleId).rolePersonaId)?.prompt||S.role(state,roleId).prompt||S.role(state,roleId).name)},wardrobe:d.wardrobes?.[roleId]||[],promises:d.promises?.[roleId]||[],userEvents:d.userEvents?.[roleId]||[],events:eventsForDay(state,roleId,now),settings:roleSettings(state,roleId),generation:d.generation?.[roleId]||{status:'idle'}};}
// Compact answer for query_life_schedule: times, activity, place, mood and outfit summary; history as day + summary.
function toolView(result){
 const p=result.plan,w=p?.weather||{};
 return {plan:p?{day:p.day,dayType:p.dayType||'',waitReplyReaction:p.waitReplyReaction||'',waitReplyRecover:p.waitReplyRecover||'',mood:p.mood||'',daySummary:p.daySummary||'',outfit:String(p.outfit||'').slice(0,80),weather:{city:w.city||'',summary:Core.promptWeather(w),temp:w.temp??null,tempMin:w.tempMin??null,tempMax:w.tempMax??null},slots:(p.slots||[]).map(x=>slotBrief(x)),originalSlots:(p.originalSlots||[]).map(x=>slotBrief(x)),changes:(p.changes||[]).map(c=>({time:Number.isFinite(c?.time)?Timeline.clock(c.time,result.timezone):'',description:c?.description||''}))}:null,
  events:(result.events||[]).map(e=>({content:e.content,startDate:e.startDate,endDate:e.endDate,status:e.status,phase:e.phase})),
  wardrobe:(result.wardrobe||[]).map(x=>({description:String(x.description||'').slice(0,80),category:x.category,seasons:x.seasons})),
  profile:result.profile,
  promises:(result.promises||[]).map(x=>({content:x.content,type:x.type,date:x.date,time:x.time,status:x.status})),
  userEvents:(result.userEvents||[]).map(x=>({content:x.content,date:x.date,time:x.time,status:x.status})),
  history:(result.history||[]).map(h=>({day:h.day,summary:h.daySummary||h.summary||''}))};
}
// Stay below the 32768-character tool result limit: shorten long text first, then keep the latest half of long lists.
function fitToolResult(value,limit=30000){
 const size=v=>JSON.stringify(v).length;if(size(value)<=limit)return value;
 const walk=(v,fn)=>Array.isArray(v)?fn(v.map(x=>walk(x,fn))):S.obj(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,fn)])):fn(v);
 let out=value;
 for(const max of [300,120,60]){out=walk(out,x=>typeof x==='string'&&x.length>max?x.slice(0,max)+'…':x);if(size(out)<=limit)return {...out,truncated:true};}
 for(let i=0;i<12&&size(out)>limit;i++)out=walk(out,x=>Array.isArray(x)&&x.length>1?x.slice(-Math.ceil(x.length/2)):x);
 return {...out,truncated:true};
}

module.exports={
  id:'schedule',
  name:'日程与穿搭',
  isolated:true,
  globalSettingKeys,
  description:'按人设与城市天气每天规划符合正常人类作息的穿搭与全天行程，聊天、发语音与自拍时自动同步。',
  settings:[
    {key:'enabled',label:'开启每日日程与穿搭',type:'boolean',default:true,roleOnly:true},
    {key:'sleepProfile',label:'作息类型',type:'select',default:'day_normal',roleOnly:true,options:Object.entries(Core.SLEEP_PROFILES).map(([value,profile])=>({value,label:profile.label}))},
    {key:'autoGenerate',label:'为常聊角色每天自动生成日程',type:'boolean',default:true,hint:'符合原有活跃条件的角色按各自业务日起点自动生成。'},
    {key:'injectIntoChat',label:'聊天时同步感知此刻日程、天气与穿搭',type:'boolean',default:true},
    {key:'syncBioStatus',label:'生成日程后自动同步好友个性签名',type:'boolean',default:false},
    {key:'boundary',label:'每日换日时间',type:'text',default:'07:00',maxLength:5},
    {key:'outfitNoRepeatDays',label:'穿搭避免重复天数',type:'number',default:3,min:0,max:7,integer:true},
    {key:'referenceHistoryDays',label:'参考过去几天日程',type:'number',default:3,min:1,max:7,integer:true},
    {key:'surpriseProbability',label:'日间生活小插曲发生概率（0~1）',type:'number',default:0.5,min:0,max:1,step:0.1,advanced:true},
    {key:'routineJitterMinutes',label:'每天起床入睡自然浮动范围（分钟）',type:'number',default:20,min:0,max:45,integer:true,advanced:true},
    {key:'chatChangeEnabled',label:'允许聊天内容自动微调今日后续安排',type:'boolean',default:true,advanced:true}
  ],
  hooks:{
    afterAssemble(ctx){
      const s=ctx.getState?.();if(!s||!ctx.messages?.[0])return;
      const settings=roleSettings(s,ctx.roleId);
      if(!settings.enabled||!settings.injectIntoChat){
        if(typeof ctx.messages[0].content==='string')ctx.messages[0].content+='\n'+Core.buildOnlineRules();
        return;
      }
      const at=Date.now(),tz=s.settings?.timezone||'UTC';
      const cur=currentState(s,ctx.roleId,at);
      if(!cur){
        if(typeof ctx.messages[0].content==='string')ctx.messages[0].content+='\n'+Core.buildOnlineRules();
        return;
      }
      const list=s.engine?.data?.schedule?.promises?.[ctx.roleId]||[];
      refreshPromises(list,at);
      const nextSlots=cur.slots.filter(sl=>Number.isFinite(sl.startAt)?sl.startAt>at:sl.start>cur.time).slice(0,2);
      const injection=Core.buildLifeInjection({
        nowHm:cur.time,
        nowLabel:T.format(at,tz),
        dayKey:cur.day,
        weather:cur.weather,
        currentSlot:cur.currentSlot,
        nextSlots,
        outfits:cur.outfits,
        fallbackOutfit:cur.outdoorOutfit,
        daySummary:cur.daySummary,
        promises:list,
        recentChanges:cur.changes
      });
      if(typeof ctx.messages[0].content==='string')ctx.messages[0].content+='\n'+injection;
    },
    afterDeliver(ctx){
      if(ctx.kind==='moment'||!ctx.text||ctx.demoModel||closedChatJudges.has(ctx.getState))return;
      const s=ctx.getState?.();if(!s)return;
      if(!activeChatRoles(s,Date.now()).has(ctx.roleId))return;
      const settings=roleSettings(s,ctx.roleId);
      if(!settings.enabled||settings.chatChangeEnabled===false)return;
      const role=s.roles?.find(r=>r.id===ctx.roleId);
      if(!role||!defaultModels.hasReadyChatModel(s,{skipMock:true}))return;
      const recentMsgs=s.messages.filter(m=>m.roleId===ctx.roleId&&m.status==='sent').slice(-6);
      const lastUser=recentMsgs.filter(m=>m.sender==='user').at(-1)?.content||'';
      if(!Core.hasChangeTrigger(lastUser,ctx.text))return;
      let scope=chatJudges.get(ctx.getState);
      if(!scope){scope={timers:new Map(),tasks:new Set()};chatJudges.set(ctx.getState,scope);}
      clearTimeout(scope.timers.get(ctx.roleId));
      const timer=setTimeout(()=>{
        scope.timers.delete(ctx.roleId);
        const task=Promise.resolve().then(async()=>{
          try{
            if(closedChatJudges.has(ctx.getState)||ctx.isInitialized&&!await ctx.isInitialized()||closedChatJudges.has(ctx.getState))return;
            if(!activeChatRoles(ctx.getState(),Date.now()).has(ctx.roleId))return;
            const snippet=getStateMsgs(ctx.getState,ctx.roleId,role.name);
            await applyScheduleChange({getState:ctx.getState,mutate:ctx.mutate,roleId:ctx.roleId,reason:'聊天约定或动态调整',recentText:snippet,fromChat:true,onUsage:ctx.onUsage});
          }catch(error){try{ctx.mutate(latest=>{if(!latest.roles.some(r=>r.id===ctx.roleId))return;const d=ensureData(latest);d.generation[ctx.roleId]={status:'failed',stage:'adjustment',error:String(error?.message||error),updatedAt:Date.now()};});}catch(recordError){console.error('Failed to record schedule adjustment error:',recordError);}}
        }).finally(()=>scope.tasks.delete(task));
        scope.tasks.add(task);
      },5000);
      timer.unref();
      scope.timers.set(ctx.roleId,timer);
    }
  },
  tools:[{
    definitions:(state,role)=>role&&roleSettings(state,role.id).enabled?[{type:'function',function:{name:'query_life_schedule',description:'只读查询自己的完整日程、原计划与实际记录、长期事件、衣柜或生活档案。只能查询当前好友自己。',parameters:{type:'object',properties:{day:{type:'string',description:'可选日期 YYYY-MM-DD，省略为当前业务日'},section:{type:'string',enum:['all','plan','events','wardrobe','profile','history'],description:'查询范围，默认all'}},additionalProperties:false}}}]:[],
    async execute(name,args,ctx){
      if(!S.obj(args)||Object.keys(args).some(k=>!['day','section'].includes(k)))S.fail('日程工具参数无效');const state=ctx.getState(),role=S.role(state,ctx.roleId);S.chatAllowed(role);
      const section=S.enumOf(args.section||'all',['all','plan','events','wardrobe','profile','history']);if(args.day)Calendar.calendarForDay(args.day);
      const result=view(state,ctx.roleId,typeof ctx.now==='function'?ctx.now():(ctx.now||Date.now()),{day:args.day}),brief=toolView(result);
      if(section==='all')return fitToolResult({day:args.day||result.today,plan:brief.plan,events:brief.events,wardrobe:brief.wardrobe,profile:brief.profile,promises:brief.promises,userEvents:brief.userEvents});
      return fitToolResult({[section]:brief[section]});
    }
  }],
  jobs:[{
    id:'schedule-daily',
    async run({getState,mutate,isBusy,now,dataDir,demoModel,onUsage,clock,modelApi=defaultModels}){
      const tickStarted=Date.now(),liveNow=clock||(()=>now+(Date.now()-tickStarted));
      if(demoModel)return;
      const checkKey=dataDir||'mem',prevCheck=lastAutoChecks.get(checkKey)||0;
      if(now-prevCheck<60000)return;
      lastAutoChecks.set(checkKey,now);
      const s=getState();
      const ai=s.settings?.ai,tz=s.settings?.timezone||'UTC',active=activeChatRoles(s,now);
      for(const role of s.roles||[]){
        if(role.permissions?.blocked||isBusy(role.id))continue;
        const localSettings=roleSettings(s,role.id);if(!localSettings.enabled)continue;
        const records=[...(s.engine?.data?.schedule?.promises?.[role.id]||[]),...(s.engine?.data?.schedule?.userEvents?.[role.id]||[])];
        const expiredEvents=(s.engine?.data?.schedule?.events?.[role.id]||[]).filter(item=>item.status==='active'&&item.endDate<businessDay(s,role.id,now));
        if(expiredEvents.length||records.some(item=>Data.overdue(item,now)))mutate(st=>{const d=ensureData(st);Data.expire(d.promises[role.id],now);Data.expire(d.userEvents[role.id],now);for(const event of d.events[role.id]||[])if(expiredEvents.some(x=>x.id===event.id)){event.status='done';event.updatedAt=now;event.endedByDate=true;}});
        if(!active.has(role.id))continue;
        if(!defaultModels.hasReadyChatModel(s,{skipMock:true}))continue;
        const today=businessDay(s,role.id,now),generation=s.engine?.data?.schedule?.generation?.[role.id];
        if(generation?.status==='running'&&!inFlight.has(checkKey+':'+role.id)&&!inFlight.has('default:'+role.id))mutate(st=>{const d=ensureData(st);d.generation[role.id]={...generation,status:d.days[role.id]?.day===today?'ready':'interrupted',updatedAt:now};});
        if(generation?.status==='failed'&&generation.day===today&&(generation.attempts>=3||now<generation.retryAt))continue;
        const plan=s.engine?.data?.schedule?.days?.[role.id];
        const expectedPlanDay=plan?.timelineVersion===2?today:T.dayKey(liveNow(),tz);
        if(plan?.day!==expectedPlanDay){
          if(!localSettings.autoGenerate)continue;
          try{await generateForRole(getState(),{mutate,roleId:role.id,now:liveNow,scope:checkKey,onUsage,modelApi});}catch{
            // generateForRole saves the failure and next retry for this friend.
          }
          continue;
        }else {
          if(localSettings.weatherEnabled&&now-(plan.weatherCheckedAt??plan.updatedAt??0)>=3*3600000){
            try{await refreshWeather(s,{getState,mutate,roleId:role.id,now:liveNow,onUsage,modelApi,force:false});}
            catch(error){if(error.code!==STALE_WEATHER)try{mutate(st=>{if(!st.roles.some(r=>r.id===role.id))return;ensureData(st).generation[role.id]={status:'failed',stage:'weather-adjustment',error:error.message,updatedAt:now};});}catch{}}
          }
          if(!Array.isArray(plan.surprises))continue;
          const surpriseAt=sp=>sp.at??Timeline.stamp(plan.day,sp.atHm,tz,plan.timelineVersion===2?(plan.boundary||'07:00'):'00:00');
          const skipped=plan.surprises.filter(sp=>!sp.triggered&&liveNow()-surpriseAt(sp)>90000);
          if(skipped.length)mutate(st=>{const live=st.engine?.data?.schedule?.days?.[role.id];for(const point of live?.surprises||[])if(skipped.some(sp=>sp.id===point.id)){point.triggered=true;point.skipped=true;}});
          const dueSp=plan.surprises.find(sp=>!sp.triggered&&!skipped.some(x=>x.id===sp.id)&&surpriseAt(sp)<=liveNow()&&liveNow()-surpriseAt(sp)<=90000);
          if(dueSp){
            mutate(st=>{const cur=st.engine?.data?.schedule?.days?.[role.id]?.surprises?.find(x=>x.id===dueSp.id);if(cur)cur.triggered=true;});
            try{await applyScheduleChange({getState,mutate,roleId:role.id,reason:'日常小插曲',recentText:'',now:liveNow,onUsage,modelApi});}catch(error){try{mutate(st=>{if(!st.roles.some(r=>r.id===role.id))return;const sp=ensureData(st).days[role.id]?.surprises.find(x=>x.id===dueSp.id);if(sp)sp.error=error.message;});}catch{}}
            continue;
          }
        }
      }
    }
  }],
  data:'schedule',
  page:'schedule',
  currentState,
  close,
  backgroundBusy,
  activeChatRoles,
  saveForRole,
  generateForRole,
  saveProfile,generateProfile,view,getDay,saveSettings,applyScheduleChange,refreshWeather,validateRestore,saveEvent,restoreProfileBackup,
  savePromise:(s,r,i,n)=>saveRecord(s,r,i,'promises',n),saveUserEvent:(s,r,i,n)=>saveRecord(s,r,i,'userEvents',n),
  removeEvent:(s,r,id)=>Data.remove(s,r,id,'events'),
  addPromise:(s,r,i,n)=>Data.addRecord(s,r,i,'promises',n),
  addUserEvent:(s,r,i,n)=>Data.addRecord(s,r,i,'userEvents',n),
  removePromise:(s,r,id)=>Data.remove(s,r,id,'promises'),
  removeUserEvent:(s,r,id)=>Data.remove(s,r,id,'userEvents'),
  addWardrobeItem,
  importWardrobe,
  removeWardrobeItem,
  collectTodayOutfit,
  dueUserEvents,
  duePromises,
  markPromiseStatus,
  markUserEventStatus,
  removeRole(state,roleId){
    for(const scope of chatJudges.values()){clearTimeout(scope.timers.get(roleId));scope.timers.delete(roleId);}
    const d=state.engine?.data?.schedule;if(!d)return;
    delete d.days?.[roleId];delete d.profiles?.[roleId];delete d.wardrobes?.[roleId];
    for(const key of ['promises','userEvents','history','profileMeta','events','generation','roleSettings'])delete d[key]?.[roleId];
  }
};

function getStateMsgs(getState,roleId,roleName){
  const s=getState?.();if(!s)return '';
  return (s.messages||[]).filter(m=>m.roleId===roleId&&m.status==='sent').slice(-6).map(m=>(m.sender==='user'?'用户':roleName)+'：'+(m.meta?.transcript||m.content||'')).join('\n');
}
