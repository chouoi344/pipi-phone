// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sampleState}=require('../scripts/sample-data.cjs');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs');
const Runtime=require('../lib/engine/runtime.cjs'),SystemOne=require('../lib/engine/system-one.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=1500){const end=Date.now()+timeout;while(!check()){assert.ok(Date.now()<end,'isolated waiting condition timed out');await sleep(5);}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(waiting={},runtimeOptions={}){
  let state=sampleState(),offset=0;state.messages=[];state.settings.timezone='UTC';
  state.settings.ai.sources.push({id:'isolated',name:'隔离假模型',baseUrl:'http://isolated.invalid',key:'never-sent',builtin:false});
  state.settings.ai.models.push({id:'isolated',sourceId:'isolated',model:'isolated',kind:'chat',capabilities:['text'],maxContextTokens:128000});
  state.settings.ai.assign.chat='isolated';state.settings.ai.assign.decision='isolated';
  R.apply(state,'waiting',{maxWaitSeconds:8});
  // Short internal timings keep isolated runtime checks fast; public settings retain their bounds.
  Object.assign(state.settings.modules.waiting,{idleSeconds:.05,draftHoldSeconds:.08,incompleteWaitSeconds:.18,maxWaitSeconds:.3,...waiting});
  R.apply(state,'segments',{intervalMode:'random',minSeconds:0,maxSeconds:0});
  const roleId=state.roles[0].id,requests=[],config={id:'isolated',capabilities:['text'],maxContextTokens:128000};
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state:getState(),value};};
  const runtime=Runtime.create({getState,mutate,publish:()=>{},now:()=>Date.now()+offset,...runtimeOptions,modelApi:{resolve:()=>config,call:async(s,req)=>{requests.push(req);return {message:{content:'模拟回复'},model:config,modelId:'isolated'};}}});
  const send=text=>{const msg=mutate(s=>S.message(s,S.role(s,roleId),'user',text,'text',{status:'pending',createdAt:Date.now()+offset})).value;runtime.enqueue(roleId,msg.id);return msg;};
  return {runtime,roleId,requests,send,state:()=>state,advance:ms=>{offset+=ms;}};
}
async function withDecision(implementation,run){const original=SystemOne.evaluateCompleteness;SystemOne.evaluateCompleteness=implementation;try{await run();}finally{SystemOne.evaluateCompleteness=original;}}

test('快速防抖：连续发送只产生一个含全部已发消息的回复',async()=>{
  await withDecision(async()=>({complete:true,probability:1}),async()=>{
    const f=fixture();try{f.send('第一句');await sleep(10);f.send('第二句');await sleep(10);f.send('第三句');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);for(const text of ['第一句','第二句','第三句'])assert.ok(JSON.stringify(f.requests[0].messages).includes(text));}finally{await f.runtime.close();}
  });
});

test('防抖：停顿结束才开始判断，慢判断在整轮上限停止，迟到结果不再生成',async()=>{
  const decision=deferred();let checks=0;
  await withDecision(()=>{checks++;return decision.promise;},async()=>{
    const f=fixture();try{f.send('这句话已经说完');await sleep(25);assert.equal(checks,0);await until(()=>checks===1);assert.equal(f.requests.length,0);await until(()=>f.requests.length===1,400);decision.resolve({complete:false,probability:0});await sleep(220);assert.equal(f.requests.length,1);await until(()=>!f.runtime.isBusy(f.roleId));}finally{decision.resolve({complete:true,probability:1});await f.runtime.close();}
  });
});

test('快速防抖：及时返回的半句话判断延长等待，随后正常回复',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  let checks=0;
  await withDecision(async()=>{checks++;return {complete:false,probability:0};},async()=>{
    const f=fixture();R.apply(f.state(),'segments',{enabled:false});
    try{
      f.send('如果明天');t.mock.timers.tick(49);await new Promise(setImmediate);assert.equal(checks,0);
      t.mock.timers.tick(1);await new Promise(setImmediate);assert.equal(checks,1);assert.equal(f.requests.length,0);
      t.mock.timers.tick(129);await new Promise(setImmediate);assert.equal(f.requests.length,0);
      t.mock.timers.tick(1);await new Promise(setImmediate);assert.equal(f.requests.length,1);assert.equal(f.runtime.isBusy(f.roleId),false);
    }finally{await f.runtime.close();}
  });
});

test('快速防抖：持续输入超过8秒先回复已发送内容',async()=>{
  await withDecision(async()=>({complete:false,probability:0}),async()=>{
    const f=fixture({idleSeconds:1,draftHoldSeconds:3.5,incompleteWaitSeconds:12,maxWaitSeconds:8});try{f.send('已经发送的内容');f.runtime.userTyping(f.roleId);await sleep(10);assert.equal(f.requests.length,0);f.advance(8001);f.runtime.userTyping(f.roleId);await until(()=>f.requests.length===1,400);assert.ok(JSON.stringify(f.requests[0].messages).includes('已经发送的内容'));assert.equal(f.state().messages.filter(m=>m.sender==='user').length,1);await until(()=>!f.runtime.isBusy(f.roleId));}finally{await f.runtime.close();}
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

test('防抖：明确旧格式沿用此前可见1秒3秒8秒，原始存储保留',()=>{
  const state=sampleState(),saved={enabled:true,mode:'cloud',idleSeconds:1.5,incompleteWaitSeconds:12,maxWaitSeconds:30};
  state.settings.modules.waiting=structuredClone(saved);
  const current=R.values(state,'waiting');
  assert.equal(current.idleSeconds,1);assert.equal(current.incompleteWaitSeconds,3);assert.equal(current.maxWaitSeconds,8);
  assert.deepEqual(state.settings.modules.waiting,saved);
});

test('防抖：自定义停顿和半句时间保留，沿用已生效8秒整轮上限',()=>{
  const state=sampleState();state.settings.modules.waiting={idleSeconds:2,incompleteWaitSeconds:5,maxWaitSeconds:20,cancelOnNewMessage:false};
  const current=R.values(state,'waiting');
  assert.equal(current.idleSeconds,2);assert.equal(current.incompleteWaitSeconds,5);assert.equal(current.maxWaitSeconds,8);assert.equal(current.cancelOnNewMessage,false);
});

test('防抖：旧备份长等待和旧判断超时原样兼容，当前生效与保存均遵守8秒上限',()=>{
  const state=sampleState(),backup={idleSeconds:10,incompleteWaitSeconds:12,maxWaitSeconds:60,decisionTimeoutSeconds:5};
  state.settings.modules.waiting=R.validate('waiting',backup,{},true);
  assert.equal(state.settings.modules.waiting.maxWaitSeconds,60);
  const current=R.values(state,'waiting');assert.equal(current.maxWaitSeconds,8);assert.equal(current.idleSeconds,8);
  assert.equal(state.settings.modules.waiting.decisionTimeoutSeconds,5);
  assert.equal(R.apply(state,'waiting',{sendThreshold:.85}).maxWaitSeconds,8);
});

test('防抖：显式2.5秒及小于8秒的已生效上限保留，新配置使用2.5秒',()=>{
  const state=sampleState();state.settings.modules.waiting={idleSeconds:2.5,incompleteWaitSeconds:5,maxWaitSeconds:6};
  assert.deepEqual([R.values(state,'waiting').idleSeconds,R.values(state,'waiting').incompleteWaitSeconds,R.values(state,'waiting').maxWaitSeconds],[2.5,5,6]);
  delete state.settings.modules.waiting;assert.equal(R.values(state,'waiting').idleSeconds,2.5);
  assert.throws(()=>R.apply(state,'waiting',{maxWaitSeconds:30}),/范围/);
  assert.equal(R.get('waiting').settings.find(field=>field.key==='maxWaitSeconds').max,8);
});

test('防抖：持续连发期间判断零调用，稳定后的判断仅一次且包含整批消息',async()=>{
  const calls=[];
  await withDecision(async(s,req)=>{calls.push(req.text);return {complete:true,probability:1};},async()=>{
    const f=fixture();try{f.send('甲');await sleep(30);f.send('乙');await sleep(30);f.send('丙');assert.equal(calls.length,0);await until(()=>!f.runtime.isBusy(f.roleId));assert.deepEqual(calls,['甲\n乙\n丙']);assert.equal(f.requests.length,1);}finally{await f.runtime.close();}
  });
});

test('防抖：打字使旧判断失效，新稳定批次重新判断，旧结果不能提前回复',async()=>{
  const old=deferred();let count=0;
  await withDecision(()=>++count===1?old.promise:Promise.resolve({complete:true,probability:1}),async()=>{
    const f=fixture();try{f.send('已经发出');await until(()=>count===1);f.runtime.userTyping(f.roleId);old.resolve({complete:true,probability:1});await sleep(30);assert.equal(f.requests.length,0);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(count,2);assert.equal(f.requests.length,1);}finally{old.resolve({complete:true,probability:1});await f.runtime.close();}
  });
});

test('防抖：主模型忙时稳定批次只判断一次，排队期间补发不会丢失',async()=>{
  let busy=8,count=0;
  await withDecision(async()=>{count++;return {complete:true,probability:1};},async()=>{
    const f=fixture({maxWaitSeconds:1},{externalBusy:()=>busy});
    try{
      f.send('排队的第一句');await until(()=>count===1);await sleep(80);assert.equal(count,1);assert.equal(f.requests.length,0);
      f.send('排队时的补充');await until(()=>count===2);busy=0;await until(()=>!f.runtime.isBusy(f.roleId));
      assert.equal(f.requests.length,1);for(const text of ['排队的第一句','排队时的补充'])assert.ok(JSON.stringify(f.requests[0].messages).includes(text));
      assert.ok(f.state().messages.filter(message=>message.sender==='user').every(message=>message.status==='sent'));
    }finally{await f.runtime.close();}
  });
});

test('防抖：判断失败明确记录原因并继续主回复，不重试同一批判断',async()=>{
  let count=0;
  await withDecision(async()=>{count++;throw new Error('隔离判断失败');},async()=>{
    const f=fixture();try{f.send('完整消息');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(count,1);assert.equal(f.requests.length,1);assert.equal(f.state().engine.data.waiting.lastError.message,'隔离判断失败');}finally{await f.runtime.close();}
  });
});
