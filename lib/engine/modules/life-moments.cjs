// SPDX-License-Identifier: AGPL-3.0-only
// Adapted behavior: astrbot_plugin_life v1.4.4 (43003a97), qzone/core.
// Upstream: GPL-3.0, https://github.com/chouoi344/astrbot_plugin_life/tree/43003a9796acbdefeade677ce169fc97a262da44/components/qzone/core
// New Node implementation, 2026-11-17: local moments/media; no QQ login or protocol.
'use strict';
const crypto=require('node:crypto');
const S=require('../../state.cjs'),T=require('../time.cjs'),Models=require('../models.cjs');
const {visibleText}=require('../response.cjs');
const MomentVisibility=require('../../../public/moment-visibility.js');
const defaults={enabled:true,mode:'schedule',dailyMax:2,useChat:true,useMemory:true};
const locks=new Map();
const privateText=/https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d{6,}|(?:api[ _-]?key|authorization|cookie|access[ _-]?token|secret)\s*[:=：]|密码|验证码|手机号|身份证|家庭住址|详细地址/i;
function data(s){s.engine??={};s.engine.data??={};const d=s.engine.data.lifeMoments??={};d.roles??={};d.records??={};d.comments??={};d.idleRounds??={};return d;}
function settings(s,id){const role=S.role(s,id);return {...defaults,enabled:role.momentsAutoEnabled??defaults.enabled,...s.engine?.data?.lifeMoments?.roles?.[id]};}
function ownsRole(s,id){return s.roles.some(role=>role.id===id&&!role.deleted);}
function saveRoleSettings(s,id,values){S.role(s,id);if(!S.obj(values)||Object.keys(values).some(k=>!Object.hasOwn(defaults,k)))S.fail('朋友圈参数无效');const next={...settings(s,id),...values};for(const k of ['enabled','useChat','useMemory'])if(typeof next[k]!=='boolean')S.fail('朋友圈开关须为布尔值');S.enumOf(next.mode,['schedule','custom']);if(!Number.isSafeInteger(next.dailyMax)||next.dailyMax<0)S.fail('每天分享上限须为非负整数');data(s).roles[id]=next;return next;}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,20);}
function boundPersona(s,id){const r=S.role(s,id),p=s.rolePersonas?.find(x=>x.id===r.rolePersonaId);return p?p.prompt:r.prompt||r.name;}
function identityVersion(s,id){const r=S.role(s,id);return hash([r.rolePersonaId,boundPersona(s,id),r.faceReferences,r.bodyReferences,r.appearancePrompt]);}
function snapshot(s,id,at){const cur=require('./schedule.cjs').currentState(s,id,at);if(!cur)return null;const plan=s.engine.data.schedule.days[id];return {...cur,version:hash({day:plan.day,slots:plan.slots,mood:plan.mood,outfit:plan.outfit,changes:plan.changes}),generating:s.engine.data.schedule.generation?.[id]?.status==='running'};}
function eligible(s,id){const r=S.role(s,id);S.momentAllowed(r);if(r.deleted||r.permissions?.hideTheirMoments||!require('../registry.cjs').values(s,'actions').allowMoments)S.fail('当前好友不可发布可见朋友圈',403);return r;}
function pickOpportunity(cur,at){
 if(!cur||cur.generating||cur.phone==='offline')return null;
 const prev=cur.previousSlot,slot=cur.currentSlot;
 if(prev?.endAt&&at>=prev.endAt+5*60000&&at<=prev.endAt+15*60000){const delay=5+parseInt(hash(prev).slice(0,4),16)%11;if(at>=prev.endAt+delay*60000)return {kind:'activity-ended',slot:prev,expiresAt:prev.endAt+15*60000};}
 if(!slot)return null;
 const strong=/兴奋|激动|难过|失落|开心|惊喜|愤怒|幸福/.test(cur.mood);
 if(slot.restType&&slot.restType!=='none')return null;
 return {kind:strong?'strong-mood':'activity',slot,expiresAt:slot.endAt||at+15*60000};
}
function parse(raw){const str=visibleText(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let p;try{p=JSON.parse(str);}catch{S.fail('朋友圈模型返回须为JSON',502,'PROVIDER_RESPONSE');}if(!S.obj(p)||typeof p.skip!=='boolean')S.fail('朋友圈模型缺少skip判断',502,'PROVIDER_RESPONSE');if(!p.skip&&(typeof p.text!=='string'||!p.text.trim()||p.imagePrompt!==undefined&&typeof p.imagePrompt!=='string'))S.fail('朋友圈模型正文或图片描述无效',502,'PROVIDER_RESPONSE');return p;}
function publicText(value,max=2000){const text=String(value||'').trim().slice(0,max);if(privateText.test(text))S.fail('公开分享包含隐私内容');return text;}
function context(s,id,cfg,dataDir){
 const out={};
 if(cfg.useChat)out.chat=s.messages.filter(x=>x.roleId===id&&x.type==='text'&&['user','assistant'].includes(x.sender)&&x.meta?.kind!=='recalled').slice(-6).filter(x=>!privateText.test(x.content)).map(x=>({speaker:x.sender,text:x.content.trim().slice(0,350)}));
 const memory=require('./memory.cjs');
 const cards=cfg.useMemory?memory.selectForPrompt(s,id,'公开日常分享',{dataDir,limitOverride:4}).filter(x=>!privateText.test(x.content)):[];
 if(cfg.useMemory)out.memory=cards.map(x=>x.content.trim().slice(0,350));
 return {optional:out,memoryStamp:cards.length?memory.createReadStamp(s,id,cards):null};
}
async function ask(ctx,messages,purpose='chat',beforeRequest){beforeRequest?.();const s=ctx.getState();const result=await(ctx.modelApi||Models).call(s,{purpose,role:S.role(s,ctx.roleId),messages,signal:ctx.signal,onUsage:ctx.onUsage,beforeRequest,validateResponse:parse});return parse(result.message);}
function countToday(s,id,at){const tz=s.settings?.timezone||'UTC',day=T.dayKey(at,tz);return(s.moments||[]).filter(x=>x.authorId===id&&T.dayKey(x.createdAt,tz)===day).length+Object.values(s.engine?.data?.lifeMoments?.records?.[id]||{}).filter(x=>x.status==='skipped'&&T.dayKey(x.decidedAt||x.createdAt,tz)===day).length;}
function canAttachPhoto(s){
 const registry=require('../registry.cjs'),selfie=registry.values(s,'selfie');
 return selfie.enabled&&selfie.autoMomentsPhoto&&registry.values(s,'actions').allowImages;
}
function view(s,id){S.role(s,id);const d=s.engine?.data?.lifeMoments||{};return {settings:settings(s,id),owned:ownsRole(s,id),records:Object.values(d.records?.[id]||{}).slice(-30),comments:Object.values(d.comments?.[id]||{}).slice(-30),todayCount:countToday(s,id,Date.now())};}
function memoryAllowed(s,id,record,dataDir){
 const cfg=settings(s,id);
 // Older unfinished drafts have no record of which memories went into them.
 if(!Object.hasOwn(record,'memoryStamp'))return !record.decision||record.settingsVersion===hash({...cfg,useMemory:false});
 return !record.memoryStamp||cfg.useMemory&&require('./memory.cjs').readStampValid(s,id,record.memoryStamp,dataDir);
}
function check(ctx,record,at){const s=ctx.getState();if(!memoryAllowed(s,ctx.roleId,record,ctx.dataDir))S.fail('本次发圈引用的记忆已变更',409,'MOMENT_MEMORY_CHANGED');eligible(s,ctx.roleId);const cfg=settings(s,ctx.roleId),cur=(ctx.scheduleSnapshot||snapshot)(s,ctx.roleId,at);if(!cfg.enabled||!cur||cur.generating||cur.phone==='offline'||cur.version!==record.version||record.identityVersion!==identityVersion(s,ctx.roleId)||record.settingsVersion!==hash(cfg)||at>=record.expiresAt||countToday(s,ctx.roleId,at)>=cfg.dailyMax)S.fail('朋友圈机会已失效或当前不允许分享',409,'MOMENT_STALE');return cur;}
async function share(ctx){
 const at=ctx.now??Date.now(),s=ctx.getState(),id=ctx.roleId,cfg=settings(s,id);eligible(s,id);if(!cfg.enabled||!cfg.dailyMax)return {status:'disabled'};
 const cur=(ctx.scheduleSnapshot||snapshot)(s,id,at),opp=pickOpportunity(cur,at);if(!opp)return {status:'no-opportunity'};
 if(countToday(s,id,at)>=cfg.dailyMax)return {status:'daily-limit'};
 const key=hash({day:cur.day,start:opp.slot.startAt,end:opp.slot.endAt,activity:opp.slot.activity});
 let record=s.engine?.data?.lifeMoments?.records?.[id]?.[key];
 if(record&&['published','skipped','cancelled'].includes(record.status))return {status:record.status,record};
 if(!record){record={key,version:cur.version,identityVersion:identityVersion(s,id),settingsVersion:hash(settings(s,id)),kind:opp.kind,activity:opp.slot.activity,scene:opp.slot.scene,mood:cur.mood,status:'pending',stage:'decision',attempts:0,createdAt:at,expiresAt:opp.expiresAt};ctx.mutate(st=>{(data(st).records[id]??={})[key]=record;});}
 const update=values=>ctx.mutate(st=>Object.assign(data(st).records[id][key],values));
 const checkCurrent=()=>check(ctx,record,ctx.clock?.()??at);
 try{
  if(!memoryAllowed(ctx.getState(),id,record,ctx.dataDir))S.fail('本次发圈引用的记忆已变更',409,'MOMENT_MEMORY_CHANGED');
  if(record.attempts>=3||record.retryAt>at)return {status:record.status,record};
  check(ctx,record,at);update({attempts:record.attempts+1,status:'running',error:''});
  if(!record.decision){
   const live=ctx.getState(),photoFields=canAttachPhoto(live)?'，可以附加 imagePrompt 和 kind（scene、selfie、food 或 outfit）':'，本次只发文字';
   const {optional,memoryStamp}=context(live,id,cfg,ctx.dataDir);
   update({memoryStamp});record=ctx.getState().engine.data.lifeMoments.records[id][key];
   const decision=await ask(ctx,[{role:'system',content:'你是角色本人，自主判断是否公开分享自己的生活。可以skip，不为完成任务硬发。遵守人设，私聊不等于公开授权，不暴露隐私或用户私事。只返回JSON {"skip":boolean,"text":"简短自然正文"}'+photoFields+'。'}, {role:'user',content:JSON.stringify({persona:boundPersona(live,id),activity:record.activity,scene:record.scene,mood:record.mood,optional})}],'chat',checkCurrent);
   check(ctx,record,ctx.clock?.()??at);
   if(decision.skip){update({status:'skipped',stage:'done',decidedAt:ctx.clock?.()??at});return {status:'skipped'};}
   publicText(decision.text);
   if(!canAttachPhoto(ctx.getState()))delete decision.imagePrompt;
   if(decision.imagePrompt)publicText(decision.imagePrompt,4000);
   update({decision,stage:decision.imagePrompt?'image':'publish'});
  }
  record=ctx.getState().engine.data.lifeMoments.records[id][key];
  if(record.decision.imagePrompt&&!record.image&&canAttachPhoto(ctx.getState())){
   check(ctx,record,ctx.clock?.()??at);
   const kind=['scene','selfie','food','outfit'].includes(record.decision.kind)?record.decision.kind:'scene';
   try{
    const [generated]=await(ctx.generateRolePhoto||require('./selfie.cjs').generateRolePhoto)(ctx.getState(),S.role(ctx.getState(),id),{prompt:record.decision.imagePrompt,kind,count:1,at,signal:ctx.signal,onUsage:ctx.onUsage,dataDir:ctx.dataDir,beforeRequest:()=>{checkCurrent();if(!canAttachPhoto(ctx.getState()))S.fail('配图已关闭',409,'MOMENT_PHOTO_DISABLED');}});
    check(ctx,record,ctx.clock?.()??at);
    if(canAttachPhoto(ctx.getState())){
     const {image,...details}=generated,photoId=details.id||'p-'+S.id().slice(0,10);
     update({image,photoId,pendingPhoto:{...details,id:photoId,createdAt:details.createdAt||at,source:'life-moments'},stage:'caption'});
    }
   }catch(error){if(error.name==='AbortError'||canAttachPhoto(ctx.getState()))throw error;}
  }
  record=ctx.getState().engine.data.lifeMoments.records[id][key];
  if(record.image&&!record.caption&&canAttachPhoto(ctx.getState())){
   check(ctx,record,ctx.clock?.()??at);
   const url=require('../../media-store.cjs').toDataUrl(ctx.dataDir,record.image);
   try{
    const cap=await ask(ctx,[{role:'system',content:'看实际配图，以角色本人视角写自然朋友圈，不编造图片里没有的内容，不泄露私事。允许skip。JSON {"skip":boolean,"text":"正文"}。'},{role:'user',content:[{type:'text',text:JSON.stringify({persona:boundPersona(ctx.getState(),id),activity:record.activity,mood:record.mood,draft:record.decision.text})},{type:'image_url',image_url:{url}}]}],'caption',()=>{checkCurrent();if(!canAttachPhoto(ctx.getState()))S.fail('配图已关闭',409,'MOMENT_PHOTO_DISABLED');});
    checkCurrent();
    if(canAttachPhoto(ctx.getState())){
     if(cap.skip){update({status:'skipped',stage:'done',decidedAt:ctx.clock?.()??at,pendingPhoto:null,image:''});return {status:'skipped'};}
     update({caption:publicText(cap.text),stage:'publish'});
    }
   }catch(error){if(error.name==='AbortError'||canAttachPhoto(ctx.getState()))throw error;}
  }
  record=ctx.getState().engine.data.lifeMoments.records[id][key];check(ctx,record,ctx.clock?.()??at);
  const publish=async(mediaId)=>{
   const atomicCtx={...ctx,mutate:fn=>ctx.mutate(st=>{
    check({...ctx,getState:()=>st},record,ctx.clock?.()??at);
    if(mediaId){
     if(!canAttachPhoto(st))S.fail('配图已关闭',409,'MOMENT_PHOTO_DISABLED');
     if(record.pendingPhoto){
      const selfie=st.engine.data.selfie??={};const photos=(selfie.photos??={})[id]??=[];
      photos.push({...record.pendingPhoto,image:record.image});selfie.photos[id]=photos.slice(-40);
     }
     if(!record.mediaId){
      const actions=st.engine.data.actions??={};(actions.roleMedia??=[]).push({id:mediaId,photoId:record.photoId,roleId:id,image:record.image,prompt:record.decision.imagePrompt,createdAt:record.pendingPhoto?.createdAt??at});
     }
    }
    const value=fn(st),saved=data(st).records[id][key];
    delete saved.pendingPhoto;
    if(mediaId)saved.mediaId=mediaId;else{delete saved.image;delete saved.caption;}
    Object.assign(saved,{status:'published',stage:'done',momentId:value.momentId,publishedAt:at});
    return value;
   })};
   return (ctx.executeAction||require('../actions.cjs').execute)('post_moment',{text:publicText(mediaId?record.caption||record.decision.text:record.decision.text),images:mediaId?[mediaId]:[],visibility:'all'},atomicCtx);
  };
  let result;
  try{result=await publish(record.image&&canAttachPhoto(ctx.getState())?(record.mediaId||S.id()):null);}
  catch(error){if(error.code!=='MOMENT_PHOTO_DISABLED')throw error;result=await publish(null);}
  return {status:'published',...result};
 }catch(error){
  if(error.code==='MOMENT_MEMORY_CHANGED'||!memoryAllowed(ctx.getState(),id,record,ctx.dataDir)){
   ctx.mutate(st=>{
    const draft=data(st).records[id][key];
    // Older releases already showed some drafts in the album. Their IDs keep those photos linked.
    if(!draft.mediaId)delete draft.photoId;
    for(const field of ['decision','caption','image','pendingPhoto','memoryStamp','retryAt'])delete draft[field];
    Object.assign(draft,{stage:'done',status:'cancelled',error:'本次发圈引用的记忆已变更'});
   });
   return {status:'cancelled'};
  }
  update({status:error.code==='MOMENT_STALE'?'cancelled':'failed',error:String(error.message).slice(0,500),retryAt:at+5*60000});throw error;
 }
}
async function respondComments(ctx){
 const at=ctx.now??Date.now(),s=ctx.getState(),id=ctx.roleId,cfg=settings(s,id);if(!cfg.enabled)return;eligible(s,id);
 const cur=(ctx.scheduleSnapshot||snapshot)(s,id,at);if(!cur||cur.generating||cur.phone!=='free')return;
 const personaVersion=identityVersion(s,id),idleKey=hash({day:cur.day,slot:cur.currentSlot}),round=s.engine?.data?.lifeMoments?.idleRounds?.[id];if(round?.key===idleKey&&round.count>=2)return;
 const targets=(s.moments||[]).filter(m=>m.authorId===id&&MomentVisibility.allows(m.visibility,'me'));
 for(const m of targets){for(const c of m.comments||[]){if(c.authorId!=='me'||s.engine?.data?.lifeMoments?.comments?.[id]?.[c.id])continue;
  ctx.mutate(st=>{(data(st).comments[id]??={})[c.id]={status:'running',at};const r=data(st).idleRounds[id];data(st).idleRounds[id]={key:idleKey,count:(r?.key===idleKey?r.count:0)+1};});
  try{const reply=await ask(ctx,[{role:'system',content:'自主判断是否回复用户在你朋友圈下的评论。不要强行回复，不发私聊，不泄露私事。只返回JSON {"skip":boolean,"text":"简短回复"}。'},{role:'user',content:JSON.stringify({post:publicText(m.content),comment:publicText(c.content),persona:boundPersona(s,id)})}]);
   if(!reply.skip){const live=ctx.getState(),current=(ctx.scheduleSnapshot||snapshot)(live,id,ctx.clock?.()??at);eligible(live,id);const target=live.moments.find(x=>x.id===m.id);if(!settings(live,id).enabled||identityVersion(live,id)!==personaVersion||!current||current.phone!=='free'||hash({day:current.day,slot:current.currentSlot})!==idleKey||!target?.comments.some(x=>x.id===c.id&&x.authorId==='me')||!MomentVisibility.allows(target.visibility,'me'))S.fail('评论回复机会已失效');await(ctx.executeAction||require('../actions.cjs').execute)('comment_moment',{momentId:m.id,text:publicText(reply.text)},ctx);}
   ctx.mutate(st=>Object.assign(data(st).comments[id][c.id],{status:reply.skip?'skipped':'replied'}));
  }catch(error){ctx.mutate(st=>Object.assign(data(st).comments[id][c.id],{status:'failed',error:error.message}));throw error;}return;
 }}
}
async function runNow(ctx){ctx={...ctx,clock:ctx.clock||Date.now};const token=ctx.dataDir||ctx.getState;let roles=locks.get(token);if(!roles){roles=new Set();locks.set(token,roles);}if(roles.has(ctx.roleId))return {status:'busy'};roles.add(ctx.roleId);try{const result=await share(ctx);await respondComments(ctx);return result;}finally{roles.delete(ctx.roleId);if(!roles.size)locks.delete(token);}}
module.exports={id:'life-moments',data:'lifeMoments',name:'生活朋友圈',description:'根据当前生活日程自主分享和回复评论',isolated:true,settings:[],tools:[],hooks:{},defaults,ownsRole,eligible,publicText,saveRoleSettings,view,runNow,respondComments,pickOpportunity,jobs:[{id:'life-moments-tick',async run(ctx){
 if(ctx.demoModel)return;
 let failure;
 for(const r of ctx.getState().roles||[]){
  const s=ctx.getState();
  if(!require('../registry.cjs').values(s,'actions').allowMoments)return;
  if(!s.settings.ai?.assign?.chat)return;
  if(!ownsRole(s,r.id)||!settings(s,r.id).enabled||r.permissions?.blocked||r.permissions?.onlyChat||r.permissions?.hideTheirMoments||ctx.isBusy?.(r.id))continue;
  try{await runNow({...ctx,roleId:r.id});}
  catch(error){if(error.name==='AbortError'||ctx.signal?.aborted)throw error;failure??=error;}
 }
 if(failure)throw failure;
}}]};
// Deleting a friend also removes their life-moment settings, records, comment replies and idle counters.
module.exports.removeRole=(s,id)=>{const d=s.engine?.data?.lifeMoments;if(d)for(const k of ['roles','records','comments','idleRounds'])if(d[k])delete d[k][id];};
