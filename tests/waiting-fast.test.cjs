// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sampleState}=require('../scripts/sample-data.cjs');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs');
const Runtime=require('../lib/engine/runtime.cjs'),SystemOne=require('../lib/engine/system-one.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=1500){const end=Date.now()+timeout;while(!check()){assert.ok(Date.now()<end,'isolated waiting condition timed out');await sleep(5);}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(waiting={}){
  let state=sampleState(),offset=0;state.messages=[];state.settings.timezone='UTC';
  state.settings.ai.sources.push({id:'isolated',name:'隔离假模型',baseUrl:'http://isolated.invalid',key:'never-sent',builtin:false});
  state.settings.ai.models.push({id:'isolated',sourceId:'isolated',model:'isolated',kind:'chat',capabilities:['text'],maxContextTokens:128000});
  state.settings.ai.assign.chat='isolated';state.settings.ai.assign.decision='isolated';
  R.apply(state,'waiting',{maxWaitSeconds:8});
  // Short internal timings keep isolated runtime checks fast; public settings retain their bounds.
  Object.assign(state.settings.modules.waiting,{idleSeconds:.05,draftHoldSeconds:.08,incompleteWaitSeconds:.18,...waiting});
  R.apply(state,'segments',{intervalMode:'random',minSeconds:0,maxSeconds:0});
  const roleId=state.roles[0].id,requests=[],config={id:'isolated',capabilities:['text'],maxContextTokens:128000};
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state:getState(),value};};
  const runtime=Runtime.create({getState,mutate,publish:()=>{},now:()=>Date.now()+offset,modelApi:{resolve:()=>config,call:async(s,req)=>{requests.push(req);return {message:{content:'模拟回复'},model:config,modelId:'isolated'};}}});
  const send=text=>{const msg=mutate(s=>S.message(s,S.role(s,roleId),'user',text,'text',{status:'pending',createdAt:Date.now()+offset})).value;runtime.enqueue(roleId,msg.id);return msg;};
  return {runtime,roleId,requests,send,state:()=>state,advance:ms=>{offset+=ms;}};
}
async function withDecision(implementation,run){const original=SystemOne.evaluateCompleteness;SystemOne.evaluateCompleteness=implementation;try{await run();}finally{SystemOne.evaluateCompleteness=original;}}

test('快速防抖：连续发送只产生一个含全部已发消息的回复',async()=>{
  await withDecision(async()=>({complete:true,probability:1}),async()=>{
    const f=fixture();try{f.send('第一句');await sleep(10);f.send('第二句');await sleep(10);f.send('第三句');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);for(const text of ['第一句','第二句','第三句'])assert.ok(JSON.stringify(f.requests[0].messages).includes(text));}finally{await f.runtime.close();}
  });
});

test('快速防抖：慢判断未返回时按停顿期限回复，迟到结果不再启动生成',async()=>{
  const decision=deferred();let checks=0;
  await withDecision(()=>{checks++;return decision.promise;},async()=>{
    const f=fixture();try{f.send('这句话已经说完');await until(()=>checks===1);await until(()=>f.requests.length===1,400);decision.resolve({complete:false,probability:0});await sleep(220);assert.equal(f.requests.length,1);await until(()=>!f.runtime.isBusy(f.roleId));}finally{decision.resolve({complete:true,probability:1});await f.runtime.close();}
  });
});

test('快速防抖：及时返回的半句话判断延长等待，随后正常回复',async()=>{
  let checks=0;
  await withDecision(async()=>{checks++;return {complete:false,probability:0};},async()=>{
    const f=fixture();try{f.send('如果明天');await until(()=>checks===1);await sleep(85);assert.equal(f.requests.length,0);await until(()=>f.requests.length===1);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);}finally{await f.runtime.close();}
  });
});

test('快速防抖：持续输入超过8秒先回复已发送内容',async()=>{
  await withDecision(async()=>({complete:false,probability:0}),async()=>{
    const f=fixture({idleSeconds:1,draftHoldSeconds:3.5,incompleteWaitSeconds:12});try{f.send('已经发送的内容');f.runtime.userTyping(f.roleId);await sleep(10);assert.equal(f.requests.length,0);f.advance(8001);f.runtime.userTyping(f.roleId);await until(()=>f.requests.length===1,400);assert.ok(JSON.stringify(f.requests[0].messages).includes('已经发送的内容'));assert.equal(f.state().messages.filter(m=>m.sender==='user').length,1);await until(()=>!f.runtime.isBusy(f.roleId));}finally{await f.runtime.close();}
  });
});

test('快速防抖：判断期间输入重排与旧批次迟到结果均不重复生成',async()=>{
  const oldDecision=deferred();let checks=0;
  await withDecision(()=>++checks===1?oldDecision.promise:Promise.resolve({complete:true,probability:1}),async()=>{
    const f=fixture();try{f.send('先发送');await until(()=>checks===1);f.runtime.userTyping(f.roleId);f.send('补充一句');await until(()=>f.requests.length===1,500);oldDecision.resolve({complete:true,probability:1});await sleep(250);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);assert.ok(JSON.stringify(f.requests[0].messages).includes('补充一句'));}finally{oldDecision.resolve({complete:true,probability:1});await f.runtime.close();}
  });
});

test('快速防抖：同批次判断与输入计时同时到期只生成一次',async()=>{
  const decision=deferred();let checks=0;
  await withDecision(()=>{checks++;return decision.promise;},async()=>{
    const f=fixture();try{f.send('已发消息');await until(()=>checks===1);f.runtime.userTyping(f.roleId);await until(()=>f.requests.length===1,400);decision.resolve({complete:true,probability:1});await sleep(150);assert.equal(f.requests.length,1);await until(()=>!f.runtime.isBusy(f.roleId));}finally{decision.resolve({complete:true,probability:1});await f.runtime.close();}
  });
});

test('快速防抖：已保存的旧默认读取为新等待节奏，原数据保留',()=>{
  const state=sampleState(),saved={enabled:true,mode:'cloud',idleSeconds:1.5,incompleteWaitSeconds:12,maxWaitSeconds:30};
  state.settings.modules.waiting=structuredClone(saved);
  const current=R.values(state,'waiting');
  assert.equal(current.idleSeconds,1);assert.equal(current.incompleteWaitSeconds,3);assert.equal(current.maxWaitSeconds,8);
  assert.deepEqual(state.settings.modules.waiting,saved);
});

test('快速防抖：自定义停顿和半句时间保留，最长等待读取时限制为8秒',()=>{
  const state=sampleState();state.settings.modules.waiting={idleSeconds:2,incompleteWaitSeconds:5,maxWaitSeconds:20,cancelOnNewMessage:false};
  const current=R.values(state,'waiting');
  assert.equal(current.idleSeconds,2);assert.equal(current.incompleteWaitSeconds,5);assert.equal(current.maxWaitSeconds,8);assert.equal(current.cancelOnNewMessage,false);
});

test('快速防抖：旧备份长等待和旧判断超时可读，生效值遵守8秒上限',()=>{
  const state=sampleState(),backup={idleSeconds:10,incompleteWaitSeconds:12,maxWaitSeconds:60,decisionTimeoutSeconds:5};
  state.settings.modules.waiting=R.validate('waiting',backup,{},true);
  assert.equal(state.settings.modules.waiting.maxWaitSeconds,60);
  const current=R.values(state,'waiting');assert.equal(current.maxWaitSeconds,8);assert.equal(current.idleSeconds,8);
  assert.equal(state.settings.modules.waiting.decisionTimeoutSeconds,5);
});
