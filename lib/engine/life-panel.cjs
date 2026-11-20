// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../state.cjs'),Outreach=require('./modules/outreach.cjs'),Moments=require('./modules/life-moments.cjs'),Photo=require('./modules/selfie.cjs');
const T=require('./time.cjs'),Timeline=require('./schedule-timeline.cjs');
const Voice=require('./modules/voice.cjs');

function dayTimeline({plan,timezone,settings}){
  const slots=plan?.slots||[];
  if(plan?.timelineVersion!==2)return slots.filter(slot=>slot.start!==slot.end);
  const boundary=plan.boundary||settings.boundary;
  const dayStart=plan.startAt??T.resolveLocal(plan.day,boundary,timezone);
  const dayEnd=plan.endAt??T.resolveLocal(T.addDays(plan.day,1),boundary,timezone);
  return slots.flatMap(slot=>{
    const startAt=Math.max(slot.startAt,dayStart),endAt=Math.min(slot.endAt,dayEnd);
    if(Math.floor(endAt/60000)<=Math.floor(startAt/60000))return [];
    return [{
      startAt,endAt,start:Timeline.clock(startAt,timezone),end:Timeline.clock(endAt,timezone),
      activity:slot.activity,scene:slot.scene,mood:slot.mood,phone:slot.phone,restType:slot.restType,
      outfitType:slot.outfitSnapshot?.type||slot.outfitType
    }];
  });
}
function view(state,roleId,{preview=false}={}){
  const role=S.role(state,roleId),{id,name,remark,avatar,cover,wechatId,bio,patText,voiceId,voiceMode}=role;
  const schedule=require('./modules/schedule.cjs').view(state,roleId);
  const {settings,inheritedMode,defaultMode}=Outreach.view(state,roleId);
  return {isolated:preview,revision:state.revision,role:{id,name,remark,avatar,cover,wechatId,bio,patText,voiceId,voiceMode},
    voiceAvailability:{...Voice.availability(state),friendEnabled:Voice.friendEnabled(state,role)},
    schedule:{...schedule,timeline:dayTimeline(schedule)},
    interaction:{settings,inheritedMode,defaultMode,hasCurrentSchedule:Boolean(schedule.current?.currentSlot)},
    interactionFields:Outreach.settings.filter(x=>!x.advanced&&!x.globalOnly),
    moments:{settings:Moments.view(state,roleId).settings},
    ...(preview?{photos:state.engine.data.selfie?.photos?.[roleId]||[],messages:state.messages.filter(m=>m.roleId===roleId).slice(-30)}:{})};
}
function albumPage(items,size,requested){
  const pages=Math.max(1,Math.ceil(items.length/size)),page=Math.min(requested,pages);
  return {page,pages,items:items.slice((page-1)*size,page*size)};
}
function album(state,roleId,{month='',day='',page=1}={}){
  S.role(state,roleId);
  const recent=state.engine.data.selfie?.photos?.[roleId]||[];
  const recentIds=new Set(recent.map(photo=>photo.id)),media=state.engine.data.actions?.roleMedia||[];
  const linked=new Map(Object.values(state.engine.data.lifeMoments?.records?.[roleId]||{}).filter(r=>r.mediaId&&r.photoId).map(r=>[r.mediaId,r.photoId]));
  for(const photo of media)if(photo.roleId===roleId&&photo.photoId)linked.set(photo.id,photo.photoId);
  const linkedPhotos=new Set(linked.values());
  const portraitsByTime=new Map();
  const dates=new Map(),months=new Map();
  const add=(photo,brief='')=>{
    if(!photo.image||!Number.isFinite(photo.createdAt))return;
    const date=T.dayKey(photo.createdAt,state.settings.timezone);
    const key=date.slice(0,7);
    if(!dates.has(date))dates.set(date,[]);
    dates.get(date).push({id:photo.id,image:photo.image,brief,createdAt:photo.createdAt});
    months.set(key,(months.get(key)||0)+1);
  };
  for(const photo of recent){
    if(!linkedPhotos.has(photo.id)){
      if(!portraitsByTime.has(photo.createdAt))portraitsByTime.set(photo.createdAt,[]);
      portraitsByTime.get(photo.createdAt).push(photo);
    }
    add(photo,photo.brief);
  }
  for(const photo of media){
    if(photo.roleId!==roleId)continue;
    if(linked.has(photo.id)){
      if(!recentIds.has(linked.get(photo.id)))add(photo);
      continue;
    }
    const siblings=portraitsByTime.get(photo.createdAt);
    const match=siblings?.findIndex(item=>item.image===photo.image&&item.prompt===photo.prompt)??-1;
    if(match>=0)siblings.splice(match,1);
    else add(photo);
  }
  const newest=(a,b)=>b.createdAt-a.createdAt;
  if(day){
    const photos=(dates.get(day)||[]).sort(newest);
    return {...albumPage(photos,6,page),total:photos.length};
  }
  const choices=[...months.keys()].sort().map(key=>({month:key,count:months.get(key)}));
  const selected=months.has(month)?month:choices.at(-1)?.month||'';
  const days=[...dates.keys()].filter(key=>key.startsWith(selected+'-')).sort().reverse();
  const result=albumPage(days,4,page);
  return {...result,month:selected,months:choices,total:months.get(selected)||0,revision:state.revision,items:result.items.map(date=>{
    const photos=dates.get(date).sort(newest);
    return {date,count:photos.length,covers:photos.slice(0,3).map(photo=>photo.image)};
  })};
}
function momentPage(state,roleId,{month='',page=1}={}){
  const {permissions}=S.role(state,roleId);
  const restricted=permissions?.blocked||permissions?.onlyChat||permissions?.hideTheirMoments||false;
  const days=new Map(),monthCounts=new Map(),items=[];
  const posts=restricted?[]:state.moments.filter(post=>post.authorId===roleId);
  for(const post of posts){
    const day=T.dayKey(post.createdAt,state.settings.timezone),key=day.slice(0,7);
    monthCounts.set(key,(monthCounts.get(key)||0)+1);
    days.set(day,(days.get(day)||0)+1);
    items.push({day,post});
  }
  const months=[...monthCounts.keys()].sort().map(key=>({month:key,count:monthCounts.get(key)}));
  const selected=monthCounts.has(month)?month:months.at(-1)?.month||'';
  const matching=items.filter(({day})=>day.startsWith(selected+'-')).sort((a,b)=>b.post.createdAt-a.post.createdAt);
  const result=albumPage(matching,4,page);
  return {revision:state.revision,month:selected,months,total:matching.length,restricted,...result,
    items:result.items.map(item=>({...item,dayCount:days.get(item.day)}))};
}
const settingsActions=['saveInteraction','saveMoments'];
const previewActions=['clearHold','evaluateContact','evaluateMoments','previewVoice','generatePhoto','sendPhoto'];
const configurationFields={basic:['name','wechatId','bio','patText','voiceId','voiceMode','avatar','cover'],schedule:['enabled','weatherEnabled','city']};
function saveConfiguration(state,roleId,sections){
  if(!S.obj(sections)||!Object.keys(sections).length||Object.entries(sections).some(([key,value])=>!['basic','schedule','profile','interaction','moments'].includes(key)||!S.obj(value)))S.fail('角色配置格式无效');
  for(const [key,fields] of Object.entries(configurationFields))if(sections[key]&&Object.keys(sections[key]).some(field=>!fields.includes(field)))S.fail('角色配置包含未知字段');
  const {basic,schedule,profile,interaction,moments}=sections;
  const scheduleModule=require('./modules/schedule.cjs');
  if(basic){
    if(basic.name!==undefined&&!S.text(basic.name,80).trim())S.fail('请填写角色名字');
    S.apply(state,'role.save',{...basic,id:roleId});
  }
  if(schedule){
    scheduleModule.saveSettings(state,roleId,schedule);
  }
  if(profile)scheduleModule.saveProfile(state,roleId,{...state.engine.data.schedule.profiles?.[roleId],...profile});
  if(interaction)Outreach.saveRoleSettings(state,roleId,interaction);
  if(moments)Moments.saveRoleSettings(state,roleId,moments);
}
async function act(body,ctx){
  const {getState,mutate,runtime,dataDir,preview=false}=ctx,roleId=S.role(getState(),S.text(body.roleId,100)).id;
  const action=S.enumOf(body.action,['saveConfiguration',...settingsActions,...previewActions]);
  if(action==='saveConfiguration'){
    const {state}=mutate(s=>saveConfiguration(s,roleId,body.sections));
    return {view:view(state,roleId,{preview}),state:S.publicState(state)};
  }
  if(!preview&&previewActions.includes(action))S.fail('此操作仅在隔离验收开放',404,'NOT_FOUND');
  let result;
  if(action==='saveInteraction')result=mutate(s=>Outreach.saveRoleSettings(s,roleId,body.values)).value;
  if(action==='saveMoments')result=mutate(s=>Moments.saveRoleSettings(s,roleId,body.values)).value;
  if(action==='clearHold')mutate(s=>{if(s.engine.data.outreach.holds)delete s.engine.data.outreach.holds[roleId];});
  const options={getState,mutate,roleId,dataDir,onUsage:runtime.onUsage,now:Date.now()};
  if(['evaluateContact','evaluateMoments','previewVoice','generatePhoto','sendPhoto'].includes(action))S.chatAllowed(S.role(getState(),roleId));
  if(action==='evaluateContact'){
    if(runtime.isBusy(roleId))S.fail('这位好友正在处理消息，请稍后再试',409,'BUSY');
    let accepted=false;
    await Outreach.jobs[0].run({...options,getState:()=>({...getState(),roles:getState().roles.filter(r=>r.id===roleId)}),isBusy:runtime.isBusy,initiate:(id,args)=>{accepted=runtime.initiate(id,args);return accepted;}});
    result={accepted,status:accepted?'accepted':'no_opportunity'};
  }
  if(action==='evaluateMoments'){
    if(runtime.isBusy(roleId))S.fail('这位好友正在处理消息，请稍后再试',409,'BUSY');
    result=await Moments.runNow(options);
  }
  if(action==='previewVoice')result=await require('./modules/voice.cjs').previewVoice(getState(),S.role(getState(),roleId),{text:S.text(body.text,2000),dataDir,onUsage:runtime.onUsage});
  if(action==='generatePhoto'){
    if(!require('./registry.cjs').values(getState(),'actions').allowImages)S.fail('当前已关闭图片生成',403);
    const args={prompt:S.text(body.prompt,2000).trim(),kind:S.enumOf(body.kind||'selfie',['selfie','outfit','food','scene','edit']),action:S.enumOf(body.photoAction||'create',['create','continue','edit']),count:body.count===undefined?1:S.integer(body.count,1,4),aspectRatio:S.text(body.aspectRatio||'',20),resolution:S.text(body.resolution||'',20),sourcePhotoId:S.text(body.sourcePhotoId||'',100),withUserImage:S.bool(body.withUserImage),shot_plan:body.shot_plan};
    if(!args.prompt)S.fail('请填写想拍摄的画面');
    result=await Photo.generateRolePhoto(getState(),S.role(getState(),roleId),{...args,dataDir,onUsage:runtime.onUsage,onPhoto:photo=>mutate(s=>{
      S.chatAllowed(S.role(s,roleId));if(!require('./registry.cjs').values(s,'actions').allowImages)S.fail('当前已关闭图片生成',403);
      const d=s.engine.data.selfie;d.photos??={};(d.photos[roleId]??=[]).push(photo);d.photos[roleId]=d.photos[roleId].slice(-40);
      (s.engine.data.actions.roleMedia??=[]).push({id:S.id(),photoId:photo.id,roleId,image:photo.image,prompt:photo.prompt,createdAt:photo.createdAt});
    })});
  }
  if(action==='sendPhoto')result=await require('./registry.cjs').executeTool('send_selfie',{action:'resend',sourcePhotoId:S.text(body.photoId,100)},options);
  const state=getState();return {result,view:view(state,roleId,{preview}),...(preview?{state:S.publicState(state)}:{})};
}
module.exports={view,act,album,momentPage};
