// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sampleState}=require('../scripts/sample-data.cjs');
const S=require('../lib/state.cjs');
const Memory=require('../lib/engine/modules/memory.cjs');
const Outreach=require('../lib/engine/modules/outreach.cjs');
const Registry=require('../lib/engine/registry.cjs');
const Schedule=require('../lib/engine/modules/schedule.cjs');
const Jobs=require('../lib/engine/scheduler.cjs');

const hour=3600000;
const now=Date.parse('2026-11-17T10:00:00Z');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=';

test('old backups retain live friends and reminders while dropping deleted-friend media and autonomy',()=>{
  const state=sampleState(),[living,deleted]=state.roles;
  S.apply(state,'role.delete',{id:deleted.id});
  const media=(id,roleId,image)=>({id,roleId,image,createdAt:now});
  state.engine.data.actions.roleMedia=[media(S.id(),living.id,png),media(S.id(),deleted.id,'unused legacy image')];
  state.engine.data.autonomy={profiles:{[living.id]:{routine:'早睡',enabled:true},[deleted.id]:{routine:'晚睡',enabled:true}},policy:null,plans:{},attempts:{},history:[]};
  for(const note of ['第一件事','第二件事']){
    Jobs.add(state,living.id,{note,userRequested:true,schedule:{type:'interval',intervalMs:hour}},now);
  }
  Registry.apply(state,'scheduler',{maxJobs:1,minIntervalHours:2});
  const backup={format:'pipi-phone',version:1,state:S.backupState(state)};
  const restored=S.validateBackup(backup,state);
  assert.deepEqual(restored.engine.data.actions.roleMedia,backup.state.engine.data.actions.roleMedia.slice(0,1));
  assert.deepEqual(Object.keys(restored.engine.data.autonomy.profiles),[living.id]);
  assert.equal(Jobs.list(restored,living.id).length,2);
  assert.equal(restored.settings.modules.scheduler.minIntervalHours,2);
});

test('a scheduled promise gets a five-minute delay and at most two delivery attempts',async()=>{
  const state=sampleState(),roleId=state.roles[0].id;
  state.settings.timezone='UTC';
  Outreach.saveRoleSettings(state,roleId,{mode:'custom',enabled:true},now);
  Schedule.addPromise(state,roleId,{type:'tell',content:'告诉你包裹到了',dueAt:now},now-60000);
  const attempt=async at=>{
    let ticket;
    await Outreach.jobs[0].run({
      getState:()=>state,mutate:fn=>fn(state),isBusy:()=>false,now:at,
      initiate:(_,entry)=>{ticket=entry.outreach;return true;}
    });
    return ticket;
  };
  const first=await attempt(now);
  assert.equal(first.kind,'promise');
  assert.equal(Outreach.errorRelease(state,roleId,first,{now,error:'模拟失败'}),true);
  const retry=now+5*60000;
  assert.equal(state.engine.data.outreach.records[roleId].retryAt,retry);
  assert.equal(await attempt(retry-1),undefined);
  const second=await attempt(retry);
  assert.equal(second.key,first.key);
  assert.equal(Outreach.errorRelease(state,roleId,second,{now:retry,error:'模拟再次失败'}),true);
  assert.notEqual((await attempt(retry+5*60000))?.key,first.key);
});

test('memory extraction counts new turns after the conversation history is cleared',async()=>{
  const state=sampleState(),roleId=state.roles[0].id;
  Registry.apply(state,'memory',{extractEveryRounds:2});
  const turn=(index)=>({
    id:S.id(),roleId,type:'text',status:'sent',sender:index%2?'assistant':'user',
    content:'记忆测试 '+index,createdAt:now+index
  });
  state.messages=Array.from({length:8},(_,i)=>turn(i));
  let calls=0;
  const opts={
    getState:()=>state,mutate:fn=>fn(state),roleId,
    modelApi:{call:async()=>{calls++;return {message:{content:'{"memories":[]}'}};}},
    now:()=>now+5000
  };
  await Memory.extractForRole(opts);
  assert.equal(state.engine.data.memory.lastExtractedAt[roleId],now+7);
  state.messages=[9,10,11].map(turn);
  await Memory.extractForRole(opts);
  assert.equal(calls,1);
  state.messages.push(turn(12));
  await Memory.extractForRole(opts);
  assert.equal(calls,2);
  assert.equal(state.engine.data.memory.lastExtractedAt[roleId],now+12);
});

test('memory extraction in flight cannot repopulate state from a cleared conversation',async()=>{
  const state=sampleState(),roleId=state.roles[0].id;
  state.messages.push({id:S.id(),roleId,type:'text',status:'sent',sender:'user',content:'不用保留的闲聊',createdAt:now});
  let finish;
  const pending=Memory.extractForRole({
    getState:()=>state,mutate:fn=>fn(state),roleId,manual:true,
    modelApi:{call:()=>new Promise(resolve=>{finish=resolve;})}
  });
  S.apply(state,'conversation.clear',{roleId});
  finish({message:{content:'{"memories":["不用保留的闲聊"]}'}});
  assert.deepEqual(await pending,[]);
  assert.equal(state.engine.data.memory.lastExtractedAt?.[roleId],undefined);
  assert.equal(state.memories.some(card=>card.roleId===roleId),false);
});
