// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {createHash}=require('node:crypto');
const S=require('../state.cjs');
function data(state){state.engine.data.execution??={runs:{},actions:[]};return state.engine.data.execution;}
function canonical(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
function start(state,{id,roleId,kind='chat',jobId='',now=Date.now()}){
  const d=data(state);let run=d.runs[id];
  if(!run){run=d.runs[id]={id,roleId,kind,jobId,status:'running',createdAt:now,updatedAt:now,delivered:0};}
  if(run.roleId!==roleId)S.fail('执行记录不属于这位好友');
  return run;
}
function recoveryNote(state,runId){
  const rows=data(state).actions.filter(a=>a.runId===runId&&!require('./modules/memory.cjs').isMemoryTool(a.name));
  return rows.length?'\n本次请求已经执行过的动作（不要重复执行，未确认的结果不要声称成功）：\n'+rows.map(a=>a.status==='completed'?require('./tool-receipt.cjs').describe(a.name,a.result):'动作结果尚未确认，不要声称成功。').join('\n'):'';
}
async function execute(name,args,ctx,perform){
  const {getState,mutate,roleId,executionId,signal}=ctx;
  const run=data(getState()).runs[executionId];
  if(!executionId||!run||run.roleId!==roleId)S.fail('动作缺少所属好友的执行记录',409,'ACTION_CONTEXT');
  const key=createHash('sha256').update(canonical({roleId,executionId,name,args,...(ctx.dedupeSeq?{seq:ctx.dedupeSeq}:{})})).digest('hex');
  const existing=data(getState()).actions.find(a=>a.id===key);
  if(existing){
    if(existing.status==='completed'){
      const memory=require('./modules/memory.cjs');
      return memory.isMemoryTool(name)?memory.toolResultForAI(name,existing.result,getState(),roleId,ctx.dataDir):existing.result;
    }
    S.fail(existing.error||'此动作执行结果尚未确认，已阻止自动重复操作',409,'ACTION_UNCERTAIN');
  }
  signal?.throwIfAborted();
  mutate(s=>data(s).actions.push({id:key,runId:executionId,roleId,name,callId:ctx.callId||'',status:'running',at:Date.now()}));
  let committed=false;
  const actionMutate=fn=>{
    signal?.throwIfAborted();
    const result=(ctx.mutateFromModel||mutate)(s=>{
      const value=fn(s),row=data(s).actions.find(a=>a.id===key);
      row.status='completed';row.result=value??{ok:true};row.completedAt=Date.now();
      return value;
    });committed=true;return result;
  };
  try{
    const result=await perform(name,args,{...ctx,mutate:actionMutate});
    if(!committed)(ctx.mutateFromModel||mutate)(s=>{const row=data(s).actions.find(a=>a.id===key);row.status='completed';row.result=result??{ok:true};row.completedAt=Date.now();});
    return result;
  }catch(error){
    if(!committed)mutate(s=>{const row=data(s).actions.find(a=>a.id===key);row.status='failed';row.error=String(error.message).slice(0,1000);});
    throw error;
  }
}
function recover(state){
  const d=data(state);
  for(const action of d.actions)if(action.status==='running'){action.status='unknown';action.error='服务重启中断了动作，结果未确认，未自动重试';}
  for(const run of Object.values(d.runs))if(run.status==='running'){
    run.status='interrupted';run.error='服务重启中断了执行';
    if(run.kind==='chat'&&!run.jobId&&run.targetId&&typeof run.answer==='string'&&Array.isArray(run.segments)&&(run.delivered<run.segments.length||run.pendingActionMessages?.length)){
      const message=state.messages.find(m=>m.id===run.targetId&&m.roleId===run.roleId&&m.sender==='user');
      if(message){run.resumeDelivery=true;message.status='error';message.error='服务重启中断了回复，请重试继续接收';}
    }
  }
}
function removeRole(state,roleId){const d=data(state);d.actions=d.actions.filter(a=>a.roleId!==roleId);for(const [id,run]of Object.entries(d.runs))if(run.roleId===roleId)delete d.runs[id];}
function validMemoryStamp(stamp){
  if(stamp==null)return true;
  const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  return S.obj(stamp)&&Number.isSafeInteger(stamp.revision)&&stamp.revision>=0
    &&Array.isArray(stamp.cards)&&stamp.cards.every(c=>Array.isArray(c)&&c.length===2&&typeof c[0]==='string'&&hash(c[1]))
    &&Array.isArray(stamp.fields)&&stamp.fields.every(f=>Array.isArray(f)&&f.length===4&&['basic','preferences','status','relationship'].includes(f[0])&&typeof f[1]==='string'&&Number.isSafeInteger(f[2])&&f[2]>0&&hash(f[3]));
}
function validateRestore(state){
  const d=data(state);
  if(!S.obj(d.runs)||!Array.isArray(d.actions))S.fail('执行记录备份无效');
  for(const [id,run]of Object.entries(d.runs)){
    if(!S.obj(run)||run.id!==id||!['running','failed','interrupted','completed'].includes(run.status))S.fail('执行记录备份无效');
    S.role(state,run.roleId);S.integer(run.delivered,0,1000);
    if(run.answer!==undefined&&typeof run.answer!=='string'||run.segments!==undefined&&(!Array.isArray(run.segments)||run.segments.some(x=>typeof x!=='string'))||run.pendingActionMessages!==undefined&&!Array.isArray(run.pendingActionMessages))S.fail('待发送内容备份无效');
    if(!validMemoryStamp(run.memoryRead)||run.pendingMemoryReads!==undefined&&(!S.obj(run.pendingMemoryReads)||!Object.values(run.pendingMemoryReads).every(validMemoryStamp)))S.fail('待发送消息的记忆引用无效');
  }
  const seen=new Set();
  for(const action of d.actions){
    if(!S.obj(action)||typeof action.id!=='string'||seen.has(action.id)||!d.runs[action.runId]||d.runs[action.runId].roleId!==action.roleId||!['running','completed','failed','unknown'].includes(action.status))S.fail('动作记录备份无效');
    seen.add(action.id);S.role(state,action.roleId);
  }
}
module.exports={data,canonical,start,execute,recoveryNote,recover,removeRole,validateRestore};
