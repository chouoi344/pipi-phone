// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{setTimeout:wait}=require('node:timers/promises');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Runtime=require('../lib/engine/runtime.cjs');
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
async function until(check){const end=Date.now()+2500;while(Date.now()<end){const result=check();if(result)return result;await wait(5);}throw Error('隔离聊天进度等待超时');}
function fixture(t){
  let state=S.initial();R.ensure(state);S.apply(state,'role.save',{name:'进度验证角色'});
  for(const module of R.list())if(module.settings.some(setting=>setting.key==='enabled'))R.apply(state,module.id,{enabled:false});
  R.apply(state,'waiting',{enabled:false,mode:'timer',idleSeconds:0,maxWaitSeconds:1});R.apply(state,'segments',{enabled:false,minSeconds:0,maxSeconds:0});
  state.settings.ai.sources=[{id:'fixture',name:'不发网络的固定协议',baseUrl:'http://127.0.0.1:1',key:'synthetic',builtin:false}];
  state.settings.ai.models=[{id:'fixture',sourceId:'fixture',model:'fixture',kind:'chat',capabilities:['text','tool_use'],maxContextTokens:128000}];state.settings.ai.assign.chat='fixture';
  const roleId=state.roles[0].id,events=[],requests=[],config={id:'fixture',capabilities:['text','tool_use'],maxContextTokens:128000};
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state:getState(),value};};
  const api={resolve:()=>config,call:async(_state,request)=>{requests.push(request);return {model:config,modelId:'fixture',message:{content:'原来的完整回复。'}};}};
  const runtime=Runtime.create({getState,mutate,publish:(event,payload)=>events.push({event,...payload}),modelApi:api});t.after(()=>runtime.close());
  const send=text=>{const result=mutate(s=>S.message(s,S.role(s,roleId),'user',text,'text',{status:'pending'}));runtime.enqueue(roleId,result.value.id);return result.value;};
  return {runtime,api,config,events,requests,roleId,getState,mutate,send};
}
test('真实Runtime/Pipeline/转账路径发布等待、模型、工具、投递阶段，正文及余额照常',async t=>{
  const f=fixture(t);let round=0;
  f.api.call=async()=>({model:f.config,modelId:'fixture',message:++round===1?{content:null,tool_calls:[call('real-transfer','send_transfer',{amountYuan:1,note:'固定工具协议'})]}:{content:'原来的完整回复。'}});
  f.send('验证转账进度');await until(()=>!f.runtime.isBusy(f.roleId));
  const phases=f.events.filter(row=>row.event==='typing').map(row=>row.phase);t.diagnostic(JSON.stringify({phases,events:f.events.filter(row=>row.event==='typing')}));
  for(const phase of ['queued','preparing','model','tool','delivering'])assert.ok(phases.includes(phase),'缺少实际阶段：'+phase);
  assert.equal(phases.at(-1),null);assert.equal(f.getState().wallet.transactions.length,1);assert.equal(f.getState().wallet.roleBalances[f.roleId],99900);
  assert.deepEqual(f.getState().messages.filter(row=>row.sender==='assistant'&&row.type==='text').map(row=>row.content),['原来的完整回复。']);
});
test('真实语音工具等待合成时报告media；无假typing，结束清进度',async t=>{
  const f=fixture(t);f.mutate(s=>{s.settings.ai.models.push({id:'tts',sourceId:'fixture',kind:'tts',model:'tts'});s.settings.ai.assign.tts='tts';R.apply(s,'voice',{enabled:true});});
  let release,round=0;t.mock.method(require('../lib/providers.cjs'),'speak',()=>new Promise(resolve=>{release=resolve;}));
  f.api.call=async()=>({model:f.config,modelId:'fixture',message:++round===1?{content:null,tool_calls:[call('voice-media','send_voice',{text:'原来的语音正文。'})]}:{content:'原来的语音正文。'}});
  try{
    f.send('说一句话');await until(()=>release);const progress=f.runtime.chatProgress(f.roleId);
    assert.equal(progress.phase,'media');assert.equal(progress.operation,'voice');assert.equal(progress.typing,false);assert.ok(progress.startedAt>0);
    release('data:audio/wav;base64,UklGRg==');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.runtime.chatProgress(f.roleId).phase,null);assert.equal(f.getState().messages.filter(row=>row.sender==='assistant'&&row.type==='voice').length,1);
  }finally{release?.('data:audio/wav;base64,UklGRg==');}
});
test('跨轮工具回执缓存复用不再报告一次实际执行',async t=>{
  const f=fixture(t);let round=0;f.api.call=async()=>({model:f.config,modelId:'fixture',message:++round<=2?{content:null,tool_calls:[call('repeat-'+round,'send_transfer',{amountYuan:1,note:'同一动作重放'})]}:{content:'结束。'}});
  f.send('验证缓存回执');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.getState().wallet.transactions.length,1);assert.equal(f.events.filter(row=>row.phase==='tool').length,1);
});
test('真实图片工具：原等待气泡与图片各一次，生成等待阶段media不改投递节奏',async t=>{
  const f=fixture(t),image='data:image/png;base64,'+(await require('sharp')({create:{width:2,height:2,channels:3,background:'#ff0000'}}).png().toBuffer()).toString('base64');
  f.mutate(s=>{s.settings.ai.models.push({id:'image',sourceId:'fixture',kind:'image',model:'image'});s.settings.ai.assign.image='image';});
  let release;t.mock.method(require('../lib/providers.cjs'),'generateImage',()=>new Promise(resolve=>{release=resolve;}));
  f.api.call=async()=>({model:f.config,modelId:'fixture',message:{content:null,tool_calls:[call('image-media','generate_image',{prompt:'红色方块',mode:'text',waitingText:'等一下，我画给你。',sendToChat:true})]}});
  try{
    f.send('画个红色方块');await until(()=>release);const status=f.runtime.chatProgress(f.roleId);
    assert.equal(status.phase,'media');assert.equal(status.operation,'image');assert.equal(status.typing,false);
    assert.deepEqual(f.getState().messages.filter(row=>row.sender==='assistant').map(row=>row.content),['等一下，我画给你。']);
    release(image);await until(()=>!f.runtime.isBusy(f.roleId));const sent=f.getState().messages.filter(row=>row.sender==='assistant');
    assert.equal(sent.filter(row=>row.type==='image').length,1);assert.equal(sent.filter(row=>row.type==='text').length,1);assert.equal(sent.at(-1).content,image);assert.equal(f.runtime.chatProgress(f.roleId).phase,null);
  }finally{release?.(image);}
});
test('旧run晚到不清除新run阶段；取消和失败都明确清空',async t=>{
  const f=fixture(t),pending=[];f.api.call=async()=>new Promise(resolve=>pending.push(resolve));
  try{
  f.send('第一轮');await until(()=>pending.length===1);f.send('第二轮');await until(()=>pending.length===2);
  const newer=f.runtime.chatProgress(f.roleId);pending[0]({model:f.config,modelId:'fixture',message:{content:'不该发送的旧回复'}});await wait(20);
  assert.equal(f.runtime.chatProgress(f.roleId).phase,'model');assert.equal(f.runtime.chatProgress(f.roleId).startedAt,newer.startedAt);
  f.runtime.cancel(f.roleId);assert.equal(f.runtime.chatProgress(f.roleId).phase,null);pending[1]({model:f.config,modelId:'fixture',message:{content:'已取消'}});await until(()=>f.runtime.active===0);
  assert.ok(!f.getState().messages.some(row=>row.content==='不该发送的旧回复'||row.content==='已取消'));
  f.api.call=async()=>{throw Error('明确失败的固定协议');};f.send('失败路径');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.runtime.chatProgress(f.roleId).phase,null);assert.match(f.getState().messages.at(-1).error,/明确失败/);
  }finally{f.runtime.cancel(f.roleId);for(const resolve of pending)resolve({model:f.config,modelId:'fixture',message:{content:'清理隔离测试'}});}
});
