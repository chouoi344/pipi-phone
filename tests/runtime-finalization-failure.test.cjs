// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{setTimeout:wait}=require('node:timers/promises');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Runtime=require('../lib/engine/runtime.cjs'),Outreach=require('../lib/engine/modules/outreach.cjs');
async function until(check){for(let i=0;i<400;i++){if(check())return;await wait(5);}throw Error('isolated finalization did not settle');}
test('P2-12 outreach finalization write failure releases active slot and role while reporting the error',async t=>{
  let state=S.initial();R.ensure(state);S.apply(state,'role.save',{name:'收尾写入隔离角色'});
  for(const module of R.list())if(module.settings.some(field=>field.key==='enabled'))R.apply(state,module.id,{enabled:false});
  const roleId=state.roles[0].id,ticket={},events=[],config={id:'synthetic',capabilities:['text'],maxContextTokens:128000};
  let cleanupWrite=false,injected=false;
  t.mock.method(Outreach,'validate',()=>true);t.mock.method(Outreach,'commit',()=>{});
  t.mock.method(Outreach,'errorRelease',()=>{if(!injected)cleanupWrite=true;});
  const runtime=Runtime.create({getState:()=>structuredClone(state),isInitialized:()=>false,publish:(event,payload)=>events.push({event,...payload}),mutate:fn=>{
    const next=structuredClone(state),value=fn(next);
    if(cleanupWrite){cleanupWrite=false;injected=true;throw Error('synthetic finalization database write failure');}
    state=next;return {state:next,value};
  },modelApi:{resolve:()=>config,call:async()=>({message:{content:'[NO_ACTION]'},model:config,modelId:config.id})}});
  t.after(()=>runtime.close());assert.equal(runtime.initiate(roleId,{instruction:'固定协议无操作',outreach:ticket,allowNoAction:true}),true);
  await until(()=>injected&&state.settings.backgroundStatus?.lastError);
  assert.equal(runtime.active,0,'failed finalization must not leak a concurrency slot');assert.equal(runtime.isBusy(roleId),false,'failed finalization must not leave the role permanently busy');
  assert.equal(events.at(-1).typing,false);assert.match(state.settings.backgroundStatus.lastError,/synthetic finalization database write failure/);
  assert.equal(runtime.initiate(roleId,{instruction:'重新使用已释放的槽位',allowNoAction:true}),true);await until(()=>runtime.active===0&&!runtime.isBusy(roleId));
});
