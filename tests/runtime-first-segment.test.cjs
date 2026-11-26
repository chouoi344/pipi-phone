// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{setTimeout:wait}=require('node:timers/promises');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),E=require('../lib/engine/execution.cjs'),D=require('../lib/engine/delivery.cjs'),Runtime=require('../lib/engine/runtime.cjs');
async function until(check){for(let i=0;i<400;i++){if(check())return;await wait(5);}throw Error('isolated segment delivery did not finish');}
function fixture(t,{resume=false}={}){
  const state=S.initial();R.ensure(state);S.apply(state,'role.save',{name:'分段隔离好友'});
  for(const module of R.list())if(module.settings.some(field=>field.key==='enabled'))R.apply(state,module.id,{enabled:false});
  R.apply(state,'waiting',{enabled:false,idleSeconds:0,maxWaitSeconds:1});R.apply(state,'segments',{enabled:true,minSeconds:1.5,maxSeconds:3.5});
  const roleId=state.roles[0].id,message=S.message(state,S.role(state,roleId),'user','固定协议分三段','text',{status:'pending'}),segments=['第一段。','第二段。','第三段。'];
  if(resume){S.message(state,S.role(state,roleId),'assistant',segments[0]);Object.assign(E.start(state,{id:'interrupted-segments',roleId,kind:'chat'}),{targetId:message.id,status:'interrupted',answer:segments.join(''),segments,delivered:1,resumeDelivery:true,memoryRead:null,personaRevision:0});}
  const calls=[],config={id:'synthetic',capabilities:['text'],maxContextTokens:128000};let models=0;
  const delivered=()=>state.messages.filter(row=>row.sender==='assistant').map(row=>row.content);
  t.mock.method(D,'delay',segment=>{calls.push({segment,alreadyDelivered:delivered()});return 0;});
  const runtime=Runtime.create({getState:()=>structuredClone(state),mutate:fn=>({value:fn(state),state}),modelApi:{resolve:()=>config,call:async()=>{models++;return {message:{content:segments.join('')},model:config,modelId:config.id};}}});
  t.after(()=>runtime.close());runtime.enqueue(roleId,message.id);
  return {runtime,roleId,calls,delivered,models:()=>models};
}
test('P1-14 fresh first segment is committed before any segment interval, later intervals remain',async t=>{
  const f=fixture(t);await until(()=>!f.runtime.isBusy(f.roleId));
  assert.deepEqual(f.delivered(),['第一段。','第二段。','第三段。']);assert.equal(f.models(),1);
  assert.deepEqual(f.calls.map(row=>row.segment),['第二段。','第三段。']);
  assert.deepEqual(f.calls.map(row=>row.alreadyDelivered),[['第一段。'],['第一段。','第二段。']]);
});
test('P1-14 restart resumes after a delivered segment with its original interval',async t=>{
  const f=fixture(t,{resume:true});await until(()=>!f.runtime.isBusy(f.roleId));
  assert.equal(f.models(),0);assert.deepEqual(f.delivered(),['第一段。','第二段。','第三段。']);
  assert.deepEqual(f.calls.map(row=>row.segment),['第二段。','第三段。']);assert.deepEqual(f.calls[0].alreadyDelivered,['第一段。']);
});
