// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sampleState}=require('../scripts/sample-data.cjs');
const memory=require('../lib/engine/modules/memory.cjs');
const store=require('../lib/engine/memory-store.cjs');
const registry=require('../lib/engine/registry.cjs');

function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-memory-policy-'));
  t.after(()=>{store.close(dataDir);fs.rmSync(dataDir,{recursive:true,force:true});});
  const state=sampleState(),roleId=state.roles[0].id;
  return {state,roleId,dataDir,getState:()=>state,mutate:fn=>({value:fn(state),state})};
}

test('old records are searchable beyond 400; stale mirror, tool result and profile cannot reintroduce an archived fact',async t=>{
  const f=fixture(t),{state,roleId,dataDir}=f;
  for(let i=0;i<430;i++)store.upsertCard(dataDir,state,roleId,{content:'第'+i+'次浇花',locked:true},{skipMirrorSync:true});
  const secret='金桔花瓣书签';
  const card=store.upsertCard(dataDir,state,roleId,{content:secret,importance:0.1});
  store.saveProfile(dataDir,state,roleId,{preferences:{收藏:[secret,'旧地图']}});
  const run=(name,args)=>memory.tools[0].execute(name,args,f);
  const result=await run('recall_memory',{query:secret});
  assert.ok(result.memories.some(m=>m.id===card.id));
  assert.ok(memory.selectForPrompt(state,roleId,secret,{dataDir}).some(m=>m.id===card.id));
  assert.ok((await memory.recallForPrompt(state,roleId,secret,f)).cards.some(m=>m.id===card.id));
  assert.equal((await run('forget_memory',{memoryId:card.id})).forgotten,true);
  state.memories.push({id:card.id,roleId,content:secret});
  assert.ok(memory.listMergedCards(state,roleId,{dataDir,status:'archived'}).some(c=>c.id===card.id));
  assert.ok(!JSON.stringify(await memory.recallForPrompt(state,roleId,secret,f)).includes(secret));
  assert.ok(!JSON.stringify(await run('recall_memory',{query:secret})).includes(secret));
  assert.ok(!JSON.stringify(memory.toolResultForAI('recall_memory',result,state,roleId,dataDir)).includes(secret));
  assert.equal((await run('memorize_memory',{content:secret})).saved,false);
  store.setCardStatus(dataDir,state,roleId,card.id,{status:'active'});
  assert.ok(JSON.stringify(await memory.recallForPrompt(state,roleId,secret,f)).includes(secret));
  registry.apply(state,'memory',{enabled:false});
  assert.deepEqual(memory.selectForPrompt(state,roleId,secret,{dataDir}),[]);
  assert.deepEqual(await memory.recallForPrompt(state,roleId,secret,f),{cards:[],profile:null,profileText:''});
});

test('changes to another friend preserve legacy-only memories beyond the mirror cap',t=>{
  const {state,roleId,dataDir}=fixture(t),otherId=state.roles[1].id;
  state.memories=Array.from({length:2950},(_,i)=>({id:'legacy-'+i,roleId:otherId,content:'记录'+i,createdAt:i+1}));
  store.upsertCard(dataDir,state,roleId,{content:'另一位好友的记录'});
  assert.equal(state.memories.filter(m=>m.roleId===otherId).length,2950);
  assert.equal(store.getCard(dataDir,state,otherId,'legacy-0').content,'记录0');
});

test('reflection switched off and back on while awaiting the model cannot write cards or profile updates',async t=>{
  const f=fixture(t),{state,roleId,dataDir}=f;
  state.messages.push({roleId,sender:'user',type:'text',content:'练习陶艺',status:'sent',createdAt:1});
  let finish;
  const inFlight=memory.extractForRole({...f,manual:true,modelApi:{call:()=>new Promise(resolve=>{finish=resolve;})}});
  registry.apply(state,'memory',{enabled:false});
  registry.apply(state,'memory',{enabled:true});
  finish({message:{content:JSON.stringify({memories:['练习陶艺'],profileUpdates:[{section:'preferences',field:'兴趣',value:'陶艺'}]})}});
  assert.deepEqual(await inFlight,[]);
  assert.equal(store.listCards(dataDir,state,roleId).length,0);
  assert.equal(store.formatProfileText(store.getProfile(dataDir,state,roleId)),'');
});

test('idle reflection failure waits before retrying, leaving the next tick available for another friend',async t=>{
  const f=fixture(t),{state}=f;
  const at=Date.now(),attempts=[];
  state.settings.ai={models:[{id:'chat',sourceId:'s'}],sources:[{id:'s',baseUrl:'https://provider.invalid',key:'fixture'}],assign:{chat:'chat'}};
  state.engine.data.memory.cursors={};
  for(const r of state.roles){
    state.messages.push({roleId:r.id,sender:'user',type:'text',status:'sent',content:'测试记录',createdAt:at-7200000});
    state.engine.data.memory.cursors[r.id]={roundsSinceExtract:1,lastTurnAt:at-7200000};
  }
  const modelApi={call:async(s,{role})=>{
    attempts.push(role.id);
    if(role===state.roles[0])throw Error('测试服务暂不可用');
    return {message:{content:'{"memories":[]}'}};
  }};
  const tick=now=>memory.jobs[0].run({...f,now,isBusy:()=>false,modelApi});
  for(let i=0;i<4;i++)await tick(at+i*1000);
  assert.deepEqual(attempts,state.roles.map(r=>r.id));
  assert.equal(state.engine.data.memory.lastError.roleId,state.roles[0].id);
  await tick(state.engine.data.memory.cursors[state.roles[0].id].retryAt);
  assert.equal(attempts.length,3);
});
