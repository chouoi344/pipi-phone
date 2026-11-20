// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),E=require('../lib/engine/execution.cjs'),Aut=require('../lib/engine/autonomy.cjs'),J=require('../lib/engine/scheduler.cjs'),Runtime=require('../lib/engine/runtime.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<500;i++){if(check())return;await sleep(5);}throw new Error('isolated check timeout');}
function fixture(){
  let state=sampleState(),clock=Date.now();state.messages=[];state.settings.timezone='UTC';
  const roleId=state.roles[0].id,config={id:'mock',kind:'chat',capabilities:['text','tool_use'],maxContextTokens:128000};
  state.settings.ai.models.push({...config,sourceId:'mock',model:'mock'});state.settings.ai.sources.push({id:'mock',name:'isolated',baseUrl:'https://mock.invalid/v1',key:'ISOLATED'});state.settings.ai.assign.chat='mock';state.settings.ai.assign.chatSelections=['mock'];
  R.apply(state,'waiting',{idleSeconds:.01,maxWaitSeconds:1});R.apply(state,'segments',{minSeconds:0,maxSeconds:0});
  const getState=()=>structuredClone(state),mutate=fn=>{const s=getState(),value=fn(s);state=s;return {state:getState(),value};};
  const api={resolve:()=>config,call:async()=>({message:{content:'完成'},model:config,modelId:'mock'})};
  const runtime=Runtime.create({getState,mutate,modelApi:api,now:()=>clock});
  const send=text=>{const m=mutate(s=>S.message(s,S.role(s,roleId),'user',text,'text',{status:'pending'})).value;runtime.enqueue(roleId,m.id);return m;};
  return {getState,mutate,roleId,config,api,runtime,send,clock:()=>clock,advance:ms=>{clock+=ms;}};
}
const tool=(id,name,args)=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('执行回执与副作用同事务，重试复用结果并拒绝跨角色记录',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());const runId='isolated-run';f.mutate(s=>E.start(s,{id:runId,roleId:f.roleId}));let count=0;
  const ctx={...f,executionId:runId},perform=async(n,a,c)=>c.mutate(s=>{count++;s.profile.bio='changed';return {ok:true};}).value;
  assert.deepEqual(await E.execute('test',{},ctx,perform),{ok:true});assert.deepEqual(await E.execute('test',{},ctx,perform),{ok:true});assert.equal(count,1);
  await assert.rejects(E.execute('test',{}, {...ctx,executionId:''},perform),/执行记录/);
  await assert.rejects(E.execute('test',{}, {...ctx,roleId:f.getState().roles[1].id},perform),/执行记录/);
  const publicState=S.publicState(f.getState());assert.equal(publicState.engine.data.execution,undefined);
});
test('中断恢复后未知动作不自动重发',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());f.mutate(s=>{E.start(s,{id:'r',roleId:f.roleId});E.data(s).actions.push({id:'a',runId:'r',roleId:f.roleId,name:'send_voice',status:'running',at:Date.now()});E.recover(s);});
  assert.equal(E.data(f.getState()).actions[0].status,'unknown');assert.equal(E.data(f.getState()).runs.r.status,'interrupted');
});
test('朋友圈工具执行后模型失败，同用户消息重试不会再发动态',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());let calls=0;
  f.api.call=async()=>{calls++;if(calls===2)throw new Error('isolated model failure');return {message:calls===1||calls===3?tool('call-'+calls,'post_moment',{text:'只发布一次'}):{content:'已经发好了'},model:f.config,modelId:'mock'};};
  const m=f.send('发动态');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.getState().moments.length,1);
  f.mutate(s=>{S.find(s.messages,m.id).status='pending';});f.runtime.enqueue(f.roleId,m.id);await until(()=>!f.runtime.isBusy(f.roleId));
  assert.equal(f.getState().moments.length,1);assert.equal(S.find(f.getState().messages,m.id).status,'sent');assert.equal(E.data(f.getState()).actions.length,1);
});
test('分段发送保留标点，发生异常后只续发未发送部分',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());let once=true,calls=0;
  const module={id:'isolated-delivery-fail',data:'isolated',settings:[],tools:[],jobs:[],hooks:{afterDeliver(){if(once){once=false;throw new Error('isolated afterDeliver failure');}}}};R.modules.push(module);t.after(()=>R.modules.splice(R.modules.indexOf(module),1));
  f.api.call=async()=>{calls++;return {message:{content:'第一句。第二句！'},model:f.config,modelId:'mock'};};
  const m=f.send('分两句');await until(()=>!f.runtime.isBusy(f.roleId));
  const replies=()=>f.getState().messages.filter(m=>m.sender==='assistant').map(m=>m.content);
  assert.deepEqual(replies(),['第一句。']);
  f.mutate(s=>S.find(s.messages,m.id).status='pending');f.runtime.enqueue(f.roleId,m.id);await until(()=>!f.runtime.isBusy(f.roleId));
  assert.deepEqual(replies(),['第一句。','第二句！']);assert.equal(calls,1);
});
test('插话后模型失败再重试，继续使用原动作回执',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());let calls=0,waiting=false;
  f.api.call=async(s,req)=>{
    calls++;
    if(calls===2){waiting=true;return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}
    if(calls===3)throw new Error('补充消息生成失败');
    return {message:calls===1||calls===4?tool('pat-'+calls,'pat_user',{}):{content:'收到补充'},model:f.config,modelId:'mock'};
  };
  f.send('拍一拍');await until(()=>waiting);const m=f.send('再补充一句');await until(()=>!f.runtime.isBusy(f.roleId));
  f.mutate(s=>S.find(s.messages,m.id).status='pending');f.runtime.enqueue(f.roleId,m.id);await until(()=>!f.runtime.isBusy(f.roleId));
  assert.equal(f.getState().messages.filter(m=>m.meta?.kind==='pat').length,1);assert.equal(E.data(f.getState()).actions.length,1);
});
test('已开始执行的定时任务重启时不重复，备份保留执行回执',()=>{
  const s=sampleState(),roleId=s.roles[0].id,now=Date.now(),job=J.add(s,roleId,{note:'提醒',userRequested:true,schedule:{type:'once',at:now+1}},now);job.status='running';E.start(s,{id:`job:${job.id}:${job.nextAt}`,roleId,jobId:job.id});
  const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(s)},s);assert.equal(restored.engine.jobs[0].status,'failed');assert.equal(Object.values(E.data(restored).runs)[0].status,'interrupted');assert.equal(J.due(restored,now+10).length,0);
});
test('旧自主活动参数、待执行计划和媒体随备份保留，恢复后不会执行计划',async t=>{
  const f=fixture();
  t.after(()=>f.runtime.close());
  const at=f.clock(),roleId=f.roleId;
  const photo={id:S.id(),roleId,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZkAAAAASUVORK5CYII=',createdAt:at};
  const legacy={
    policy:{dailyChat:1,dailyMoments:1,dailyProfile:1,dailyImages:1,minIntervalMinutes:1,wakeIntervalMinutes:1,quietStart:'00:00',quietEnd:'00:00'},
    profiles:{[roleId]:{routine:'午后散步',enabled:true,updatedAt:at}},
    attempts:{[roleId]:{inputStamp:'旧版本输入',status:'completed',at}},
    plans:{[roleId]:{
      day:new Date(at).toISOString().slice(0,10),timezone:'UTC',inputStamp:'旧版本输入',revision:S.id(),preview:false,createdAt:at,
      entries:['chat','moment','profile','image'].map(activity=>({id:S.id(),at:at+60000,activity,note:'旧计划',status:'pending'})),
    }},
    history:[],
  };
  f.mutate(s=>{
    s.settings.modules.autonomy={};
    s.engine.data.autonomy=structuredClone(legacy);
    s.engine.data.actions.roleMedia=[photo];
    Object.assign(s,S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(s)},s));
  });
  let calls=0;
  f.api.call=async()=>{calls++;throw new Error('旧自主活动不应调用模型');};
  await f.runtime.tick();
  f.advance(61000);
  await f.runtime.tick();
  const restored=f.getState();
  assert.equal(calls,0);
  assert.deepEqual(restored.engine.data.autonomy,legacy);
  assert.deepEqual(restored.engine.data.actions.roleMedia,[photo]);
  assert.deepEqual(restored.settings.modules.autonomy,{});
  assert.deepEqual(E.data(restored).actions,[]);
  assert.equal(restored.messages.length,0);
  assert.equal(restored.moments.length,0);
});

test('删除好友后可恢复备份，旧自主活动与执行记录随好友清理',()=>{
  const s=sampleState(),roleId=s.roles[0].id,at=Date.now();
  const legacy=Aut.ensure(s);
  legacy.profiles[roleId]={routine:'午后散步',enabled:true,updatedAt:at};
  legacy.attempts[roleId]={inputStamp:'旧版本输入',at,status:'completed'};
  E.start(s,{id:'r',roleId});
  S.apply(s,'role.delete',{id:roleId});
  const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(s)},s);
  assert.ok(!restored.roles.some(r=>r.id===roleId));
  assert.deepEqual(restored.engine.data.autonomy.profiles,{});
  assert.deepEqual(restored.engine.data.autonomy.attempts,{});
  assert.deepEqual(E.data(restored).runs,{});
});
