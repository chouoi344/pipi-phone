// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setImmediate:turn}=require('node:timers/promises');
const {sampleState}=require('../scripts/sample-data.cjs');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Runtime=require('../lib/engine/runtime.cjs');
const Schedule=require('../lib/engine/modules/schedule.cjs'),Memory=require('../lib/engine/modules/memory.cjs'),Models=require('../lib/engine/models.cjs'),T=require('../lib/engine/time.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw new Error('隔离任务未按时完成');}
function fixture(options={}){
  const state=sampleState();state.messages=[];state.settings.timezone='UTC';
  const roleId=state.roles[0].id;
  const getState=()=>state,mutate=fn=>({value:fn(state),state});
  const runtime=Runtime.create({getState,mutate,...options});
  return {state,roleId,getState,mutate,runtime};
}

test('后台tick从初始化检查起计忙，恢复锁关闭初始化时不读取资料或启动任务',async t=>{
  const ready=deferred();let reads=0,jobs=0;
  const f=fixture({isInitialized:()=>ready.promise,getState:()=>{reads++;return f.state;}});
  t.mock.method(R,'runJobs',async()=>{jobs++;});
  try{
    const running=f.runtime.tick();
    assert.equal(f.runtime.backgroundBusy,true);
    const second=f.runtime.tick();
    assert.equal(reads,0);
    ready.resolve(false);await Promise.all([running,second]);
    assert.equal(f.runtime.backgroundBusy,false);assert.equal(reads,0);assert.equal(jobs,0);
  }finally{ready.resolve(false);await f.runtime.close();}
});

test('后台任务跨await保持计忙，完成后才允许恢复，关闭初始化后不再启动',async t=>{
  const hold=deferred();let started=0,scheduled=0,ready=true;
  const f=fixture({isInitialized:()=>ready});
  t.mock.method(R,'runJobs',async()=>{started++;await hold.promise;});
  t.mock.method(R.get('scheduler').jobs[0],'run',()=>{scheduled++;});
  try{
    const running=f.runtime.tick();await until(()=>started===1);
    assert.equal(f.runtime.active,0);assert.equal(f.runtime.backgroundBusy,true);
    await f.runtime.tick();assert.equal(started,1);assert.equal(scheduled,0);
    hold.resolve();await running;assert.equal(f.runtime.backgroundBusy,false);
    ready=false;await f.runtime.tick();assert.equal(started,1);assert.equal(f.runtime.backgroundBusy,false);
  }finally{hold.resolve();await f.runtime.close();}
});

test('无到期提醒时少读一次快照，暂停期间到期的提醒恢复后立即送达',async t=>{
  let at=Date.now(),ready=true,reads=0;
  const f=fixture({now:()=>at,isInitialized:()=>ready,getState:()=>{reads++;return f.state;}});
  t.mock.method(R,'runJobs',async()=>{});
  const job=require('../lib/engine/scheduler.cjs').add(f.state,f.roleId,{note:'隔离提醒',userRequested:true,schedule:{type:'once',at:at+1000}},at);
  try{
    await f.runtime.tick();assert.equal(reads,1);assert.equal(f.state.messages.length,0);
    ready=false;at+=1000;await f.runtime.tick();assert.equal(reads,1);assert.equal(job.status,'pending');
    ready=true;await f.runtime.tick();assert.equal(reads,3);assert.equal(job.status,'completed');
    assert.equal(f.state.messages.at(-1).content,'隔离提醒');
    reads=0;await f.runtime.tick();assert.equal(reads,1);assert.equal(f.state.messages.length,1);
  }finally{await f.runtime.close();}
});

test('后台同轮复用修订快照，跨await的外部写入及本轮写入立即刷新',async t=>{
  let revision=0,reads=0;
  const held=deferred(),resume=deferred();
  const f=fixture({getRevision:()=>revision,getState:()=>{reads++;return structuredClone(f.state);},mutate:fn=>{const value=fn(f.state);revision++;return {state:f.state,value};}});
  t.mock.method(R,'runJobs',async ctx=>{
    assert.equal(ctx.getState(),ctx.getState());assert.equal(reads,1);
    held.resolve();await resume.promise;
    assert.equal(ctx.getState().profile.name,'外部保存');assert.equal(reads,2);
    ctx.mutate(s=>{s.profile.name='后台保存';});
    assert.equal(ctx.getState().profile.name,'后台保存');assert.equal(reads,3);
  });
  try{
    const tick=f.runtime.tick();await held.promise;
    f.state.profile.name='外部保存';revision++;
    resume.resolve();await tick;
  }finally{resume.resolve();await f.runtime.close();}
});

test('修订快照不跨tick保留，未发生写入也按时间送达提醒并读取新配置',async t=>{
  let at=Date.now(),revision=0,reads=0;
  const f=fixture({now:()=>at,getRevision:()=>revision,getState:()=>{reads++;return structuredClone(f.state);},mutate:fn=>{const value=fn(f.state);revision++;return {state:f.state,value};}});
  t.mock.method(R,'runJobs',async()=>{});
  const scheduler=require('../lib/engine/scheduler.cjs');
  scheduler.add(f.state,f.roleId,{note:'按时到达',userRequested:true,schedule:{type:'once',at:at+1000}},at);
  try{
    await f.runtime.tick();assert.equal(reads,1);
    at+=1000;await f.runtime.tick();assert.equal(f.state.messages.at(-1).content,'按时到达');
    R.apply(f.state,'memory',{enabled:false});revision++;
    let enabled;
    t.mock.method(R,'runJobs',async ctx=>{enabled=R.isEnabled(ctx.getState(),'memory');});
    await f.runtime.tick();assert.equal(enabled,false);
    R.apply(f.state,'memory',{enabled:true});revision++;
    await f.runtime.tick();assert.equal(enabled,true);
  }finally{await f.runtime.close();}
});

test('延迟日程微调的计时和模型任务都计忙，恢复期间到期不调用模型',async t=>{
  const f=fixture(),timers=[],original=setTimeout,check=deferred(),model=deferred();let calls=0;
  f.state.settings.ai.sources.push({id:'busy-test',baseUrl:'http://127.0.0.1:1',key:'isolated'});
  f.state.settings.ai.models.push({id:'busy-test',sourceId:'busy-test',kind:'chat',capabilities:['text']});f.state.settings.ai.assign.chat='busy-test';
  S.message(f.state,S.role(f.state,f.roleId),'user','记得明天7点叫我起床','text',{status:'sent'});
  f.state.engine.data.schedule??={};f.state.engine.data.schedule.days={[f.roleId]:{day:T.dayKey(Date.now(),'UTC'),slots:[{start:'00:00',end:'23:59',activity:'日常活动'}]}};
  t.mock.method(global,'setTimeout',(fn,ms,...args)=>{if(ms===5000){timers.push(fn);return {unref(){}};}return original(fn,ms,...args);});
  t.mock.method(Models,'call',async()=>{calls++;await model.promise;return {message:{content:'{}'}};});
  const ctx={getState:f.getState,mutate:f.mutate,roleId:f.roleId,text:'好，约好了',kind:'chat',isInitialized:()=>check.promise};
  try{
    Schedule.hooks.afterDeliver(ctx);assert.equal(f.runtime.backgroundBusy,true);assert.equal(timers.length,1);
    timers.shift()();await turn();assert.equal(f.runtime.backgroundBusy,true);
    check.resolve(false);await turn();await turn();assert.equal(calls,0);assert.equal(f.runtime.backgroundBusy,false);
    Schedule.hooks.afterDeliver({...ctx,isInitialized:()=>true});assert.equal(f.runtime.backgroundBusy,true);
    timers.shift()();await until(()=>calls===1);assert.equal(f.runtime.backgroundBusy,true);
    model.resolve();await turn();await turn();assert.equal(f.runtime.backgroundBusy,false);
  }finally{check.resolve(false);model.resolve();await f.runtime.close();}
});

test('聊天送达后的记忆整理由runtime跟踪，暂停和关闭时不会启动迟到整理',async t=>{
  const extraction=deferred();let extracting=0,ready=true,runBackground;
  const config={id:'busy-model',capabilities:['text'],maxContextTokens:128000};
  const api={resolve:()=>config,call:async(s,request)=>{
    if(request.messages[0].content.includes('长期记忆提炼器')){extracting++;await extraction.promise;return {message:{content:'{"memories":[],"profileUpdates":[]}'},model:config};}
    return {message:{content:'记下了。'},model:config};
  }};
  const f=fixture({modelApi:api,isInitialized:()=>ready});
  f.state.settings.ai.sources.push({id:'busy-model',baseUrl:'http://127.0.0.1:1',key:'isolated'});f.state.settings.ai.models.push({...config,sourceId:'busy-model',kind:'chat'});f.state.settings.ai.assign.chat='busy-model';
  R.apply(f.state,'memory',{extractEveryRounds:1});R.apply(f.state,'segments',{enabled:false});
  S.message(f.state,S.role(f.state,f.roleId),'user','我喜欢香菜','text',{status:'sent'});
  t.mock.method(R,'hooks',async(name,ctx)=>{if(name==='afterDeliver'){runBackground=ctx.runBackground;Memory.hooks.afterDeliver({...ctx,modelApi:api});}});
  try{
    assert.equal(f.runtime.initiate(f.roleId,{instruction:'自然回答'}),true);
    await until(()=>extracting===1&&!f.runtime.isBusy(f.roleId));assert.equal(f.runtime.active,0);assert.equal(f.runtime.backgroundBusy,true);
    extraction.resolve();await until(()=>!f.runtime.backgroundBusy);
    let late=0;ready=false;await runBackground(()=>{late++;});assert.equal(late,0);
    ready=true;const pending=runBackground(()=>{late++;});await f.runtime.close();await pending;assert.equal(late,0);
  }finally{extraction.resolve();await f.runtime.close();}
});
