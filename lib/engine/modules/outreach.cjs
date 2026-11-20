// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Behavior adapted from astrbot_plugin_life 43003a97 components/chat/proactive.
const {randomUUID}=require('node:crypto'),T=require('../time.cjs');
const MIN=60000,HOUR=60*MIN;
const schema=[
 {key:'enabled',label:'主动消息',type:'boolean',default:true,advanced:true,roleOnly:true},
 {key:'mode',label:'主动消息方式',type:'select',default:'schedule',options:[{value:'schedule',label:'跟随日程'},{value:'custom',label:'自己配置'}],advanced:true},
 {key:'quietHoursEnabled',label:'启用免打扰时段',type:'boolean',default:true,globalOnly:true},
 {key:'quietStart',label:'免打扰开始时间',type:'text',default:'01:00',maxLength:5,globalOnly:true},
 {key:'quietEnd',label:'免打扰结束时间',type:'text',default:'07:00',maxLength:5,globalOnly:true},
 {key:'minIdleMinutes',label:'主动联系最短间隔（分钟）',type:'number',default:60,min:1,max:1440,integer:true},
 {key:'maxIdleMinutes',label:'主动联系最长间隔（分钟）',type:'number',default:90,min:1,max:1440,integer:true},
 {key:'holdMinutes',label:'等我忙完后多久问一句（分钟）',type:'number',default:60,min:30,max:360,integer:true},
 {key:'maxUnanswered',label:'最多未回轮数（0表示不限）',type:'number',default:4,min:0,max:100,integer:true},
 {key:'dailyMaxPerRole',label:'每日主动联系上限',type:'number',default:5,min:0,max:100,integer:true},
 {key:'dailyPhotoMax',label:'每日主动照片上限',type:'number',default:1,min:0,max:20,integer:true},
 {key:'voiceEnabled',label:'允许主动语音',type:'boolean',default:true},
 {key:'photoEnabled',label:'允许主动照片',type:'boolean',default:true},
 {key:'historyCount',label:'参考近期消息条数',type:'number',default:20,min:0,max:200,integer:true},
 {key:'customPrompt',label:'主动联系补充提示词',type:'textarea',default:'',maxLength:12000},
 {key:'frequencyPreset',label:'旧联系频率',type:'select',default:'normal',options:['quiet','normal','lively'],advanced:true},
 {key:'cooldownMinutes',label:'旧冷却时间',type:'number',default:45,min:1,max:1440,integer:true,advanced:true}
];
const defaults=Object.fromEntries(schema.map(x=>[x.key,x.default]));
const globalOnlyKeys=schema.filter(field=>field.globalOnly).map(field=>field.key);
function data(s){s.engine??={};s.engine.data??={};const d=s.engine.data.outreach??={};for(const k of ['settings','records','holds','replyFacts'])d[k]??={};return d;}
function role(s,id){return require('../../state.cjs').role(s,id);}
function globalSettings(s){return {...defaults,...s.settings.modules?.outreach};}
function savedSettings(s,id){
 const r=role(s,id),global=globalSettings(s);
 const saved={...global,enabled:r.outreachEnabled??defaults.enabled,...s.engine?.data?.outreach?.settings?.[id]};
 for(const key of globalOnlyKeys)saved[key]=global[key];
 return saved;
}
function settingsFor(s,id){const saved=savedSettings(s,id);return saved.mode==='custom'?saved:{...globalSettings(s),enabled:saved.enabled,mode:saved.mode};}
function effectiveSettings(s,id,cur){
 const saved=savedSettings(s,id);
 return saved.mode==='schedule'&&cur?.currentSlot?settingsFor(s,id):{...saved,mode:'custom'};
}
function enabled(s,id){return savedSettings(s,id).enabled;}
function updateDeadlines(s,id,previous,settings,now,modeChanged){
 const bucket=s.engine?.data?.outreach,rec=bucket?.records?.[id],hold=bucket?.holds?.[id];
 if(rec&&(modeChanged||settings.minIdleMinutes!==previous.minIdleMinutes||settings.maxIdleMinutes!==previous.maxIdleMinutes)){
  const lastContact=Math.max(rec.lastUserAt||0,rec.lastAt||0,lastUserMessage(s,id)?.createdAt||0);
  const oldFixedStart=previous.minIdleMinutes===previous.maxIdleMinutes&&rec.nextDueAt?rec.nextDueAt-previous.minIdleMinutes*MIN:0;
  const start=modeChanged?now:rec.waitStartedAt||lastContact||oldFixedStart||now;
  setNextDue(rec,start,settings);rec.timingMode=settings.mode;
  delete rec.retryAt;
  if(!rec.pending?.committed)delete rec.pending;
 }
 if(hold&&(modeChanged||settings.holdMinutes!==previous.holdMinutes)){
  hold.dueAt=hold.createdAt+settings.holdMinutes*MIN;delete hold.retryAt;
 }
}
function saveGlobalSettings(s,settings,now=Date.now()){
 const old=globalSettings(s);
 if(['minIdleMinutes','maxIdleMinutes','holdMinutes','mode'].every(key=>settings[key]===old[key])){s.settings.modules.outreach=settings;return;}
 const bucket=s.engine?.data?.outreach,waiting=(s.roles||[]).filter(r=>bucket?.records?.[r.id]||bucket?.holds?.[r.id]);
 const before=waiting.map(r=>{
  const cur=current(s,r.id,now);
  return {id:r.id,cur,previous:effectiveSettings(s,r.id,cur),mode:savedSettings(s,r.id).mode};
 });
 s.settings.modules.outreach=settings;
 for(const {id,cur,previous,mode} of before)updateDeadlines(s,id,previous,effectiveSettings(s,id,cur),now,mode!==savedSettings(s,id).mode);
}
function saveRoleSettings(s,id,input,now=Date.now()){
 const S=require('../../state.cjs');
 if(!S.obj(input))S.fail('功能参数须为对象');
 const previous=savedSettings(s,id);
 const changedKeys=Object.keys(input).filter(key=>!globalOnlyKeys.includes(key));
 if(!changedKeys.length)return previous;
 const changes=Object.fromEntries(changedKeys.map(key=>[key,input[key]]));
 const clean=require('../registry.cjs').validate('outreach',changes,previous);
 // Keep a mode inherited until the friend explicitly chooses one. Store interval bounds together.
 if('minIdleMinutes'in changes||'maxIdleMinutes'in changes){
  changes.minIdleMinutes=clean.minIdleMinutes;
  changes.maxIdleMinutes=clean.maxIdleMinutes;
 }
 const cur=current(s,id,now),before=effectiveSettings(s,id,cur);
 const d=data(s);d.settings[id]={...d.settings[id],...changes};
 const modeChanged=clean.mode!==previous.mode;
 const effective=effectiveSettings(s,id,cur);
 updateDeadlines(s,id,before,effective,now,modeChanged);
 if(!previous.enabled&&clean.enabled){const rec=record(s,id,now);setNextDue(rec,now,effective);rec.timingMode=effective.mode;delete rec.retryAt;delete rec.pending;}
 return clean;
}
function limitsFor(s){return {dailyMax:s.dailyMaxPerRole??5,minIdle:s.minIdleMinutes??60,maxIdle:s.maxIdleMinutes??90,holdMinutes:s.holdMinutes??defaults.holdMinutes,maxUnanswered:s.maxUnanswered??defaults.maxUnanswered,dailyPhotoMax:s.dailyPhotoMax??1};}
function record(s,id,now){const d=data(s),today=T.dayKey(now,s.settings.timezone||'UTC');const r=d.records[id]??={};r.unanswered??=0;r.unansweredMsgs??=[];if(r.day!==today){r.day=today;r.count=0;r.photos=0;r.missYou=0;r.firedKeys=[];r.promiseFailures={};}r.photos??=0;r.missYou??=0;r.firedKeys??=[];return r;}
function nextDue(now,settings,random=Math.random){return now+(settings.minIdleMinutes+random()*(settings.maxIdleMinutes-settings.minIdleMinutes))*MIN;}
function setNextDue(rec,start,settings){rec.waitStartedAt=start;rec.nextDueAt=nextDue(start,settings);}
function current(s,id,now){return require('./schedule.cjs').currentState(s,id,now);}
function sleeping(cur){return cur?.restType==='night_sleep'||cur?.restType==='nap';}
function canContact(settings,cur){
 return !sleeping(cur)&&(settings.mode==='custom'||!!cur?.currentSlot&&cur.phone!=='offline'&&cur.restType==='none');
}
function lastUserMessage(s,id){return (s.messages||[]).findLast(m=>m.roleId===id&&m.sender==='user');}
function slotStamp(cur){return JSON.stringify(cur?.currentSlot||null);}
function personaStamp(s,r){return JSON.stringify([r.rolePersonaId,r.personaId,r.prompt,s.rolePersonas?.find(p=>p.id===r.rolePersonaId)?.prompt]);}
function quiet(s,settings,now){return settings.quietHoursEnabled&&T.quiet(settings,now,s.settings.timezone||'UTC');}
function allowsAutomatic(s,id,now){
 if(!enabled(s,id))return false;
 const cur=current(s,id,now),settings=effectiveSettings(s,id,cur);
 return canContact(settings,cur)&&!quiet(s,settings,now);
}
function contactHold(text){
 let held=false;
 const stripped=text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g,' ');
 for(const sentence of stripped.split(/[。！？!?；;…\n]+/))for(const raw of sentence.split(/[,，:：]|但是|不过|可是|但/)){
  const clause=raw.trim();
  if(/^(?:他|她|他们|她们|别人|对方|我)(?:刚才|刚|之前|曾经)?(?:说|问|喊|讲|发|回)(?:过|了)?$/.test(clause))break;
  if(/^(?:(?:现在|还是|先|再)?聊(?:会儿|一会儿)?|不用等我(?:了)?|我回来(?:了)?|我忙完了)(?:[吧呀哈哦啊啦喔~～])?$/.test(clause))held=false;
  else if(/^(?:(?:你|先)?(?:等我|等我忙完|等我找你)|(?:我|等我)?(?:忙完|忙完了|好了|有空了|忙好了)(?:再|就)?(?:来)?找你|等我(?:来)?找你|等我(?:一下|一会儿|半小时|[一二三四五六七八九十\d]+(?:个)?(?:小时|分钟))(?:后)?再聊)(?:[吧呀哈哦啊啦喔~～])?$/.test(clause))held=true;
 }
 return held;
}
function pickTrigger(s,r,settings,cur,rec,day,now){
 const reminders=require('../scheduler.cjs');
 if(!canContact(settings,cur)||reminders.explicitDue(s,r.id,now))return null;
 const d=s.engine?.data?.schedule||{},fired=new Set(rec.day===day?rec.firedKeys||[]:[]);
 for(const p of d.promises?.[r.id]||[]){
  if(p.type==='tell'&&p.status==='pending'&&p.dueAt<=now&&now<p.dueAt+30*MIN&&!fired.has('promise:'+p.id)&&!reminders.matchesExplicit(s,r.id,p.content,p.dueAt)){
   return {kind:'promise',key:'promise:'+p.id,refId:p.id,reason:'到了此前约好的告知时间：'+p.content,content:p.content,expiresAt:p.dueAt+30*MIN,counted:false};
  }
 }
 const limits=limitsFor(settings);
 if(quiet(s,settings,now)||rec.count>=limits.dailyMax||(limits.maxUnanswered>0&&rec.unanswered>=limits.maxUnanswered))return null;
 for(const e of [...(d.userEvents?.[r.id]||[])].sort((a,b)=>a.followUpAt-b.followUpAt))if(e.status==='pending'&&e.followUpAt<=now&&now<e.followUpAt+12*HOUR&&!fired.has('care:'+e.id))return {kind:'care',key:'care:'+e.id,refId:e.id,reason:'对方提过的事情现在应该有结果了：'+e.content,expiresAt:e.followUpAt+12*HOUR,counted:true};
 const hold=s.engine?.data?.outreach?.holds?.[r.id];
 if(hold){
  if(now<hold.dueAt)return null;
  if(!hold.notified&&now<hold.dueAt+6*HOUR&&(hold.attempts||0)<3){
   if(now>=(hold.retryAt||0))return {kind:'hold',key:'hold:'+hold.createdAt,reason:'对方说过「'+hold.reason+'」，约好的等待时间已经过去，可以自然问一句忙完了吗',expiresAt:hold.dueAt+6*HOUR,counted:true};
   return null;
  }
 }
 const recent=Math.max(lastUserMessage(s,r.id)?.createdAt||0,rec.lastAt||0,rec.lastUserAt||0);
 if(now-recent<settings.minIdleMinutes*MIN)return null;
 const previous=cur?.previousSlot,end=previous?.endAt,slot=cur?.currentSlot;
 const bedtime=cur?.nextSlot?.restType==='night_sleep'&&now>=cur.nextSlot.startAt-30*MIN;
 const routine=/^(?:起床|醒来|上班|下班|工作|办公|休息|自由活动|空闲|回家|洗漱)(?:时间|中)?$/;
 const ended=previous&&previous.restType!=='night_sleep'&&!routine.test(previous.activity)&&end<=now&&now<end+30*MIN;
 const scene=slot&&!routine.test(slot.activity)&&slot.startAt<=now&&now<slot.startAt+30*MIN;
 if(settings.mode==='schedule'&&!hold&&!rec.missYou&&(ended||scene||bedtime)){
  const point=ended?end:bedtime?cur.nextSlot.startAt:slot.startAt,key='miss:'+point;
  if(!fired.has(key))return {kind:'miss_you',key,reason:ended?'你刚结束「'+previous.activity+'」，这会儿自然想起对方；按人设决定是否开口':bedtime?'你准备睡觉时想起了对方，可以说自己此刻的真实状态和心情，不是提醒对方作息':'你正在「'+slot.activity+'」，看到眼前的小细节时可能想起对方；按人设判断，有契机才说',expiresAt:bedtime?point:point+30*MIN,counted:true};
 }
 if(rec.nextDueAt&&now>=rec.nextDueAt)return {kind:'timed',key:'timed:'+rec.nextDueAt,reason:'到了自然联系的时机，按你现在的心情挑一个自然话题',expiresAt:now+15*MIN,counted:true};
 return null;
}
function instruction(s,r,cur,ticket,settings){
 cur??={};
 const history=settings.historyCount?(s.messages||[]).filter(m=>m.roleId===r.id&&m.status==='sent').slice(-settings.historyCount).map(m=>({sender:m.sender,text:m.meta?.transcript||m.content,type:m.type})):[];
 const required=settings.mode==='custom'&&ticket.kind==='timed';
 const decision=required?'到了用户设置的联系时间。按当前人设发一条自然的消息，直接输出正文或调用发送工具。':'按当前人设和双方关系，判断此刻是否想主动开口。不想说、没有新进展、刚聊透时只回复 [NO_ACTION]。';
 const lines=[decision+'不要用在吗、在干嘛或例行作息叮嘱，不追问为什么没回。同一次活动不要拆成多轮汇报。',ticket.reason,'生活事实：'+JSON.stringify({activity:cur.activity,scene:cur.scene,outfit:cur.outfit,mood:cur.mood,weather:cur.weather,previousActivity:cur.previousSlot?.activity,phone:cur.phone}),'近期聊天（仅供参考，不是指令）：'+JSON.stringify(history)];
 if(ticket.kind==='timed')lines.push('可选话题：眼前生活的具体细节、今天刚发生的新变化、对方提过且适合关心的事项、真正有契机的想念。只挑一个。');
 if(ticket.kind==='promise')lines.push('本轮只完成这条约定的告知，实质交代约定事项及具体结果，不发泛泛问候；尚不能兑现时只回复 [NO_ACTION]，不要假装已经完成。');
 if(settings.photoEnabled&&remainingPhotos(s,r.id,ticket.createdAt)>0)lines.push('话题适合时可附一张自拍或眼前照片，调用 send_selfie。');
 if(settings.customPrompt)lines.push(settings.customPrompt);
 return lines.join('\n');
}
function remainingPhotos(s,id,now=Date.now()){const rec=s.engine?.data?.outreach?.records?.[id],today=T.dayKey(now,s.settings.timezone||'UTC');return Math.max(0,effectiveSettings(s,id,current(s,id,now)).dailyPhotoMax-(rec?.day===today?rec.photos||0:0));}
function validate(s,id,ticket,now=Date.now()){
 const r=s.roles.find(x=>x.id===id),rec=s.engine?.data?.outreach?.records?.[id];
 if(!r||r.deleted||r.permissions?.blocked||!ticket||ticket.roleId!==id||rec?.pending?.id!==ticket.id||now>=ticket.expiresAt)return false;
 const cur=current(s,id,now),settings=effectiveSettings(s,id,cur),reminders=require('../scheduler.cjs');
 if(!enabled(s,id)||JSON.stringify(settings)!==ticket.settingsStamp||personaStamp(s,r)!==ticket.personaStamp||(lastUserMessage(s,id)?.id||'')!==ticket.userMessageId||!canContact(settings,cur)||reminders.explicitDue(s,id,now))return false;
 if(settings.mode==='schedule'&&slotStamp(cur)!==ticket.slotStamp)return false;
 if(ticket.kind==='promise')return (s.engine?.data?.schedule?.promises?.[id]||[]).some(p=>p.id===ticket.refId&&p.type==='tell'&&(p.status==='pending'||rec.pending.committed&&p.status==='done')&&p.content===ticket.content&&!reminders.matchesExplicit(s,id,p.content,p.dueAt));
 if(quiet(s,settings,now))return false;
 const limits=limitsFor(settings),today=T.dayKey(now,s.settings.timezone||'UTC');
 if(!rec.pending.committed&&((rec.day===today&&rec.count>=limits.dailyMax)||(limits.maxUnanswered>0&&rec.unanswered>=limits.maxUnanswered)))return false;
 if(ticket.kind==='care'&&!(s.engine?.data?.schedule?.userEvents?.[id]||[]).some(e=>e.id===ticket.refId&&(e.status==='pending'||rec.pending.committed&&e.status==='done')))return false;
 return true;
}
function commit(s,id,ticket,{now=Date.now(),text='',photoCount=0,delivered=false,skipped=false}={}){
 const rec=record(s,id,now);if(rec.pending?.id!==ticket.id)return false;
 if(!skipped&&!delivered&&!text.trim()&&!photoCount)return false;
 const first=!rec.pending.committed;
 if(first){
  rec.pending.committed=true;rec.lastAt=now;setNextDue(rec,now,effectiveSettings(s,id,current(s,id,now)));rec.firedKeys.push(ticket.key);rec.firedKeys=rec.firedKeys.slice(-100);
  if(ticket.counted||skipped)rec.count++;
  if(ticket.counted&&!skipped)rec.unanswered++;
  if(ticket.kind==='miss_you')rec.missYou++;
  if(!skipped&&ticket.kind==='hold'&&data(s).holds[id])data(s).holds[id].notified=true;
  if(!skipped&&ticket.kind==='care')require('./schedule.cjs').markUserEventStatus(s,id,ticket.refId,'done','主动联系已实际发出',now);
 }
 if(skipped)return first;
 rec.pending.text=text||rec.pending.text||'';
 if(ticket.counted&&text.trim()){
  const list=rec.unansweredMsgs??=[],index=list.findIndex(x=>typeof x==='object'&&x.ticketId===ticket.id),actual={ticketId:ticket.id,text};
  if(index<0)list.push(actual);else list[index]=actual;rec.unansweredMsgs=list.slice(-5);
 }
 const newPhotos=Math.max(0,photoCount-(rec.pending.photos||0));rec.photos+=newPhotos;rec.pending.photos=Math.max(photoCount,rec.pending.photos||0);
 if(ticket.kind==='promise'&&text.trim()&&!rec.pending.promiseDone){require('./schedule.cjs').markPromiseStatus(s,id,ticket.refId,'done','实际告知：'+text.slice(0,300),now);rec.pending.promiseDone=true;}
 return first;
}
function errorRelease(s,id,ticket,{now=Date.now(),error=''}={}){
 const rec=s.engine?.data?.outreach?.records?.[id];if(!ticket||rec?.pending?.id!==ticket.id)return false;
 const sent=!!rec.pending.committed;delete rec.pending;
 if(!sent){
  const cur=current(s,id,now),settings=effectiveSettings(s,id,cur);
  if(ticket.kind==='miss_you'){rec.firedKeys.push(ticket.key);rec.firedKeys=rec.firedKeys.slice(-100);}
  if(ticket.kind==='timed'&&ticket.mode==='custom'&&sleeping(cur))return true;
  setNextDue(rec,now,settings);rec.retryAt=now+(ticket.kind==='promise'?5:Math.min(120,Math.max(30,settings.minIdleMinutes)))*MIN;
  // A promised message is tried at most twice, instead of calling the model every minute for its whole window.
  if(ticket.kind==='promise'){const failures=rec.promiseFailures??={};failures[ticket.key]=(failures[ticket.key]||0)+1;if(failures[ticket.key]>=2){rec.firedKeys.push(ticket.key);rec.firedKeys=rec.firedKeys.slice(-100);delete failures[ticket.key];}}
 }
 if(error)rec.lastError={message:String(error?.message||error).slice(0,500),at:now};return true;
}
function view(s,id,now=Date.now()){
 const d=s.engine?.data?.outreach||{},r=d.records?.[id]||{},today=T.dayKey(now,s.settings.timezone||'UTC');
 return {settings:savedSettings(s,id),inheritedMode:!Object.hasOwn(d.settings?.[id]||{},'mode'),defaultMode:globalSettings(s).mode,
  today,count:r.day===today?r.count||0:0,photos:r.day===today?r.photos||0:0,
  unanswered:r.unanswered||0,nextDueAt:r.nextDueAt||null,lastAt:r.lastAt||null,hold:d.holds?.[id]||null,pending:r.pending||null,lastError:r.lastError||null};
}
module.exports={
 id:'outreach',name:'主动信息',isolated:true,description:'按角色日程、约定与近期聊天自然联系，允许保持安静。',settings:schema,data:'outreach',page:null,
 settingsFor,effectiveSettings,enabled,allowsAutomatic,saveRoleSettings,saveGlobalSettings,view,validate,commit,errorRelease,remainingPhotos,limitsFor,pickTrigger,contactHold,nextDue,
 hooks:{
  afterReceive(ctx){
   const s=ctx.getState(),pending=s.messages.filter(m=>m.roleId===ctx.roleId&&m.sender==='user'&&m.status==='pending');if(!pending.length)return;
   const latest=pending.at(-1),text=pending.map(m=>m.meta?.transcript||m.content||'').join('\n'),now=typeof ctx.now==='function'?ctx.now():ctx.now??Date.now();
   ctx.mutate(st=>{const d=data(st),rec=record(st,ctx.roleId,now);if(rec.receivedId===latest.id)return;
    const actual=rec.unansweredMsgs?.filter(x=>typeof x==='object'&&x.text).map(x=>x.text)||[];if(actual.length)d.replyFacts[ctx.roleId]=actual.slice(-3);
    const settings=effectiveSettings(st,ctx.roleId,current(st,ctx.roleId,now));
    rec.receivedId=latest.id;rec.lastUserAt=latest.createdAt||now;rec.unanswered=0;rec.unansweredMsgs=[];delete rec.pending;setNextDue(rec,now,settings);
    if(contactHold(text))d.holds[ctx.roleId]={reason:text.slice(0,200),createdAt:now,dueAt:now+settings.holdMinutes*MIN,attempts:0};else delete d.holds[ctx.roleId];
   });
  },
  afterAssemble(ctx){const facts=ctx.getState().engine?.data?.outreach?.replyFacts?.[ctx.role?.id];if(facts?.length&&typeof ctx.messages?.[0]?.content==='string')ctx.messages[0].content+='\n【前情衔接】对方回复了。你之前实际发出且没收到回复的话：'+JSON.stringify(facts)+'。按人设自然衔接，隔夜没回或晚安后的收尾不算冷落，不追问为什么没回。';},
  afterDeliver(ctx){if(ctx.roleId&&ctx.finalTurn!==false)ctx.mutate(s=>{if(s.engine?.data?.outreach?.replyFacts)delete s.engine.data.outreach.replyFacts[ctx.roleId];});}
 },
 tools:[],jobs:[{id:'outreach-tick',async run({getState,mutate,isBusy,initiate,now}){
  for(const r of getState().roles){
   const s=getState();if(!enabled(s,r.id)||r.deleted||r.permissions?.blocked||isBusy(r.id))continue;
   const cur=current(s,r.id,now),settings=effectiveSettings(s,r.id,cur),user=lastUserMessage(s,r.id),day=T.dayKey(now,s.settings.timezone||'UTC');
   let rec=s.engine?.data?.outreach?.records?.[r.id];
   if(rec?.pending){if(now>=rec.pending.expiresAt)mutate(st=>errorRelease(st,r.id,rec.pending,{now,error:'联系机会已过期'}));else continue;}
   if(!rec?.nextDueAt||rec.day!==day||rec.timingMode&&rec.timingMode!==settings.mode)mutate(st=>{
    const row=record(st,r.id,now);
    if(!row.nextDueAt||row.timingMode&&row.timingMode!==settings.mode)setNextDue(row,now,settings);
    row.timingMode=settings.mode;
   });
   rec=getState().engine.data.outreach.records[r.id];if(rec.retryAt>now)continue;
   const trigger=pickTrigger(getState(),r,settings,cur,rec,day,now);if(!trigger)continue;
   const ticket={...trigger,id:randomUUID(),roleId:r.id,mode:settings.mode,settingsStamp:JSON.stringify(settings),createdAt:now,expiresAt:Math.min(trigger.expiresAt,now+15*MIN),userMessageId:user?.id||'',personaStamp:personaStamp(s,r),slotStamp:slotStamp(cur)};
   mutate(st=>{const row=record(st,r.id,now);row.pending=ticket;const hold=data(st).holds[r.id];if(ticket.kind==='hold'&&hold){hold.attempts++;hold.retryAt=now+Math.min(120,Math.max(30,settings.minIdleMinutes))*MIN;}});
   const started=initiate(r.id,{kind:'chat',allowNoAction:!(settings.mode==='custom'&&ticket.kind==='timed'),instruction:instruction(getState(),r,cur,ticket,settings),outreach:ticket});
   if(started===false)mutate(st=>errorRelease(st,r.id,ticket,{now}));return;
  }
 }}],
 removeRole(s,id){const d=s.engine?.data?.outreach;if(d)for(const k of ['settings','records','holds','replyFacts','momentRuns'])if(d[k])delete d[k][id];}
};
