// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {randomUUID}=require('node:crypto'),T=require('./time.cjs'),R=require('./registry.cjs');
function fail(message){throw Object.assign(new Error(message),{status:400,code:'VALIDATION'});}
function schedule(input,settings,timezone='UTC'){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['once','daily','weekly','interval'].includes(input.type))fail('提醒重复方式无效');
  if(input.type==='once'){
    let at=input.at;
    if(typeof at==='string'){
      const datePart=at.slice(0,10),dateValue=Date.parse(datePart+'T00:00:00Z');
      if(!Number.isFinite(dateValue)||new Date(dateValue).toISOString().slice(0,10)!==datePart)fail('提醒日期无效');
      const local=at.match(/^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)(?::00)?$/);
      if(local)at=T.resolveLocal(local[1],local[2],timezone||'UTC');
      else if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(at))at=Date.parse(at);
      else fail('提醒时间无效，请使用具体日期与时间');
    }
    if(!Number.isSafeInteger(at)||at<0||at>8640000000000000)fail('提醒时间无效');
    return {type:'once',at};
  }
  if(input.type==='interval'){
    if(!Number.isSafeInteger(input.intervalMs)||input.intervalMs<settings.minIntervalHours*3600000||input.intervalMs>366*86400000)fail('重复提醒间隔过短或无效');
    return {type:'interval',intervalMs:input.intervalMs};
  }
  if(typeof input.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))fail('提醒时间须为 HH:mm');
  if(input.type==='daily')return {type:'daily',time:input.time};
  if(!Array.isArray(input.weekdays)||!input.weekdays.length||input.weekdays.length>7||input.weekdays.some(v=>!Number.isSafeInteger(v)||v<0||v>6))fail('提醒星期无效');
  return {type:'weekly',time:input.time,weekdays:[...new Set(input.weekdays)].sort()};
}
function next(plan,after,timezone='UTC',anchor=after){
  if(plan.type==='once')return plan.at>after?plan.at:null;
  if(plan.type==='interval')return anchor+Math.max(1,Math.floor((after-anchor)/plan.intervalMs)+1)*plan.intervalMs;
  const day=T.dayKey(after,timezone);
  for(let i=0;i<=7;i++){
    const d=T.addDays(day,i),weekday=new Date(d+'T12:00:00Z').getUTCDay();
    if(plan.type==='weekly'&&!plan.weekdays.includes(weekday))continue;
    const candidate=T.resolveLocal(d,plan.time,timezone);
    if(candidate>after)return candidate;
  }
}
function add(state,roleId,input,now=Date.now()){
  R.ensure(state);
  if(!state.roles.some(r=>r.id===roleId))fail('好友不存在');
  const p=R.values(state,'scheduler');
  if(list(state,roleId).length>=p.maxJobs)fail('这位好友的未完成提醒已达上限');
  if(typeof input.note!=='string'||!input.note.trim()||input.note.length>4000)fail('提醒内容须在 1 到 4000 字以内');
  if(typeof input.userRequested!=='boolean')fail('请说明提醒是否由用户要求');
  const plan=schedule(input.schedule,p,state.settings.timezone||'UTC'),nextAt=next(plan,now,state.settings.timezone||'UTC',now);
  if(nextAt===null)fail('提醒时间必须在将来');
  const job={id:randomUUID(),roleId,note:input.note.trim(),userRequested:input.userRequested,schedule:plan,nextAt,status:'pending',createdAt:now};
  state.engine.jobs.push(job);return job;
}
const awaiting=job=>job.status==='pending'||job.status==='running';
function list(state,roleId,{includeHistory=false}={}){
  const jobs=(state.engine?.jobs||[]).filter(job=>job.roleId===roleId);
  const pending=jobs.filter(awaiting).sort((a,b)=>(a.deferredUntil||a.nextAt)-(b.deferredUntil||b.nextAt));
  if(!includeHistory)return pending;
  const recent=job=>job.completedAt??job.lastFinishedAt??job.lastRunAt??job.nextAt;
  return [...pending,...jobs.filter(job=>!awaiting(job)).sort((a,b)=>recent(b)-recent(a))];
}
function overview(state){
  const friends=new Map(state.roles.filter(role=>!role.deleted).map(role=>[role.id,{
    roleId:role.id,name:role.remark||role.name,pendingCount:0,totalCount:0,next:null
  }]));
  for(const job of state.engine.jobs){
    const friend=friends.get(job.roleId);
    if(!friend)continue;
    friend.totalCount++;
    if(!awaiting(job))continue;
    friend.pendingCount++;
    const at=job.deferredUntil??job.nextAt;
    if(!friend.next||at<friend.next.at)friend.next={note:job.note,at};
  }
  return [...friends.values()].filter(friend=>friend.totalCount).sort((a,b)=>
    (a.next?.at??Number.MAX_SAFE_INTEGER)-(b.next?.at??Number.MAX_SAFE_INTEGER));
}
function find(state,roleId,id){const j=state.engine.jobs.find(j=>j.id===id&&j.roleId===roleId);if(!j)fail('提醒不存在');return j;}
function edit(state,roleId,id,input,now=Date.now()){
  const job=find(state,roleId,id),old=structuredClone(job);
  if(job.status!=='pending')fail('只能修改尚未触发的提醒');
  const p=R.values(state,'scheduler'),plan=input.schedule===undefined?job.schedule:schedule(input.schedule,p,state.settings.timezone||'UTC');
  if(input.note!==undefined&&(typeof input.note!=='string'||!input.note.trim()||input.note.length>4000))fail('提醒内容须在 1 到 4000 字以内');
  if(input.userRequested!==undefined&&typeof input.userRequested!=='boolean')fail('请说明提醒是否由用户要求');
  const nextAt=input.schedule===undefined?job.nextAt:next(plan,now,state.settings.timezone||'UTC',now);
  if(nextAt===null)fail('提醒时间必须在将来');
  Object.assign(job,{note:input.note===undefined?old.note:input.note.trim(),userRequested:input.userRequested??old.userRequested,schedule:plan,nextAt,updatedAt:now});delete job.deferredUntil;delete job.deferredByGlobalQuiet;
  return job;
}
function remove(state,roleId,id){const job=find(state,roleId,id);state.engine.jobs=state.engine.jobs.filter(j=>j!==job);return job;}
function explicitDue(state,roleId,now){
  const grace=R.values(state,'scheduler').lateGraceHours*3600000;
  return (state.engine?.jobs||[]).some(job=>job.roleId===roleId&&job.userRequested&&job.status==='pending'&&job.nextAt<=now&&now-job.nextAt<=grace);
}
function matchesExplicit(state,roleId,content,at){
  if(!Number.isFinite(at))return false;
  const normalize=text=>text.normalize('NFKC').replace(/^[\s\p{P}]*(?:请)?(?:提醒|告诉)(?:我|用户|对方|你)?/u,'').replace(/[\p{P}\s]/gu,'');
  const note=normalize(content);
  if(!note)return false;
  const minute=Math.floor(at/60000);
  return (state.engine?.jobs||[]).some(job=>job.roleId===roleId&&job.userRequested&&['pending','running','completed'].includes(job.status)&&normalize(job.note)===note&&
    (Math.floor(job.nextAt/60000)===minute||Math.floor(job.lastRunAt/60000)===minute));
}
function globalQuietEnd(state,at){
  const outreach=R.values(state,'outreach');
  return outreach.quietHoursEnabled?T.quietEnd(outreach,at,state.settings.timezone||'UTC'):at;
}
function planDue(state,now,available=()=>true){
  const changes=[],p=R.values(state,'scheduler'),tz=state.settings.timezone||'UTC';
  const quietEnd=at=>globalQuietEnd(state,at);
  const quietUntil=quietEnd(now);
  for(const job of state.engine.jobs){
    if(job.status!=='pending'||job.nextAt>now)continue;
    const role=state.roles.find(r=>r.id===job.roleId);
    let update;
    if(!role||role.deleted||role.permissions?.blocked)update={status:'cancelled',completedAt:now};
    else{
      // Ignore deferrals saved under the old per-friend rule.
      const saved=job.deferredByGlobalQuiet?job.deferredUntil:0;
      const deferred=saved&&quietEnd(saved-1)===saved&&(saved<=now||quietUntil===saved)?saved:0;
      const dueAt=job.userRequested?job.nextAt:Math.max(quietEnd(job.nextAt),deferred);
      const graceFrom=job.userRequested?dueAt:Math.max(dueAt,Math.min(saved,now));
      if(now-graceFrom>p.lateGraceHours*3600000){
        update=job.schedule.type==='once'
          ?{status:'expired',completedAt:now}
          :{nextAt:next(job.schedule,now,tz,job.nextAt)};
        update.lastStatus='expired';update.lastFinishedAt=now;
      }else if(!job.userRequested&&(dueAt>now||quietUntil>now)){
        const deferredUntil=Math.max(dueAt,quietUntil);
        if(deferredUntil!==saved)update={deferredUntil,deferredByGlobalQuiet:true};
      }else if(available(job))update={status:'running',lastRunAt:now};
      else if(job.deferredUntil&&saved!==dueAt)update={};
    }
    if(update)changes.push([job.id,update]);
  }
  return changes;
}
function claimDue(state,changes){
  const updates=new Map(changes),ready=[];
  for(const job of state.engine.jobs){
    const update=updates.get(job.id);
    if(!update)continue;
    delete job.deferredUntil;
    delete job.deferredByGlobalQuiet;
    if(update.lastStatus==='expired')delete job.lastError;
    Object.assign(job,update);
    if(job.status==='running')ready.push(structuredClone(job));
  }
  return ready;
}
function due(state,now=Date.now()){
  R.ensure(state);
  return claimDue(state,planDue(state,now));
}
function finish(state,id,{now=Date.now(),error=''}={}){
  const job=state.engine.jobs.find(j=>j.id===id);if(!job)return;
  if(error)job.lastError=String(error).slice(0,1000);else delete job.lastError;
  job.lastStatus=error?'failed':'completed';job.lastFinishedAt=now;
  if(job.schedule.type==='once'){job.status=job.lastStatus;job.completedAt=now;}
  else{job.nextAt=next(job.schedule,now,state.settings.timezone||'UTC',job.nextAt);job.status='pending';}
  return job;
}
function recover(state){
  const E=require('./execution.cjs');E.recover(state);require('./autonomy.cjs').recover(state);
  for(const job of state.engine?.jobs||[])if(job.status==='running'){
    const run=E.data(state).runs[`job:${job.id}:${job.nextAt}`];
    if(run)finish(state,job.id,{error:run.status==='completed'||run.delivered>0?'':'服务重启中断了提醒，未重复执行已开始的动作'});
    else job.status='pending';
  }
}
function rescheduleTimezone(state,now=Date.now()){
  for(const job of state.engine?.jobs||[])if(job.status==='pending'&&['daily','weekly'].includes(job.schedule.type)){job.nextAt=next(job.schedule,now,state.settings.timezone);delete job.deferredUntil;delete job.deferredByGlobalQuiet;}
}
module.exports={schedule,next,add,edit,list,overview,remove,explicitDue,matchesExplicit,globalQuietEnd,due,planDue,claimDue,finish,recover,rescheduleTimezone};
