// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../lib/engine/schedule-core.cjs'),Schedule=require('../lib/engine/modules/schedule.cjs'),Outreach=require('../lib/engine/modules/outreach.cjs'),Life=require('../lib/engine/modules/life-moments.cjs'),R=require('../lib/engine/registry.cjs');
const {sampleState}=require('../scripts/sample-data.cjs');
const AT=Date.parse('2026-11-20T10:00:00Z'),MIN=60000;

test('日程微调只识别明确约定和改计划，方案十二个样例保持一致',()=>{
  for(const text of ['你明天下午三点陪我去看病吧，说好了','把今晚的安排改成看电影','我们约好周六早上8点一起跑步','记得明天7点叫我起床'])assert.equal(Core.hasChangeTrigger(text,''),true,text);
  assert.equal(Core.hasChangeTrigger('','好，那我把下午的健身改到晚上'),true);
  for(const text of ['今天好累啊','明天见','你几点睡？','我好开心','有点担心你','等会再聊','考试好难','把昵称改成橙子'])assert.equal(Core.hasChangeTrigger(text,''),false,text);
});
test('日程仍只覆盖72小时内实际聊过天的好友',()=>{
  const state={messages:[{roleId:'recent',sender:'user',createdAt:AT-72*3600000+1},{roleId:'boundary',sender:'user',createdAt:AT-72*3600000},{roleId:'assistant-only',sender:'assistant',createdAt:AT}]};
  assert.deepEqual([...Schedule.activeChatRoles(state,AT)],['recent']);
});
test('首次联系以当前时间随机错峰，已有等待与当天次数保持，重新开启也重新等待',async t=>{
  const state=sampleState();state.messages=[];state.settings.timezone='UTC';state.engine.data.outreach={records:{},settings:{}};
  state.roles=state.roles.slice(0,2);for(const role of state.roles){role.outreachEnabled=true;Outreach.saveRoleSettings(state,role.id,{mode:'custom',minIdleMinutes:60,maxIdleMinutes:90,quietHoursEnabled:false},AT);state.messages.push({id:role.id,roleId:role.id,sender:'user',createdAt:AT-10*86400000});}
  let index=0,calls=0;t.mock.method(Math,'random',()=>[0.1,0.9][index++%2]);
  const run=()=>Outreach.jobs[0].run({getState:()=>state,mutate:fn=>fn(state),isBusy:()=>false,initiate:()=>{calls++;},now:AT});
  await run();const records=state.engine.data.outreach.records,[first,second]=state.roles.map(role=>records[role.id]);
  assert.equal(calls,0);assert.equal(first.nextDueAt,AT+63*MIN);assert.equal(second.nextDueAt,AT+87*MIN);
  const previous=first.nextDueAt;await run();assert.equal(first.nextDueAt,previous);
  first.count=2;Outreach.saveRoleSettings(state,state.roles[0].id,{enabled:false},AT);first.nextDueAt=AT-1;Outreach.saveRoleSettings(state,state.roles[0].id,{enabled:true},AT+MIN);
  assert.ok(first.nextDueAt>=AT+61*MIN&&first.nextDueAt<=AT+91*MIN);assert.equal(first.count,2);
});
test('主动保持安静只计一次当天次数，不算未回复，也不完成告知事项',()=>{
  const state=sampleState(),roleId=state.roles[0].id,ticket={id:'skip',key:'care:event',kind:'care',counted:true,refId:'event'};
  state.settings.timezone='UTC';state.engine.data.outreach={records:{[roleId]:{day:'2026-11-20',count:0,unanswered:0,photos:0,firedKeys:[],pending:ticket}}};
  state.engine.data.schedule??={};state.engine.data.schedule.userEvents={[roleId]:[{id:'event',status:'pending'}]};
  assert.equal(Outreach.commit(state,roleId,ticket,{now:AT,skipped:true}),true);assert.equal(Outreach.commit(state,roleId,ticket,{now:AT,skipped:true}),false);
  assert.equal(Outreach.view(state,roleId,AT).count,1);assert.equal(Outreach.view(state,roleId,AT).unanswered,0);assert.equal(state.engine.data.schedule.userEvents[roleId][0].status,'pending');
  Outreach.errorRelease(state,roleId,ticket,{now:AT});assert.equal(Outreach.view(state,roleId,AT).pending,null);assert.equal(state.engine.data.outreach.records[roleId].retryAt,undefined);
});
test('朋友圈保持安静消耗当天额度，换生活机会不重复判断，次日重新计算',async t=>{
  t.mock.timers.enable({apis:['Date'],now:AT});const state=sampleState(),roleId=state.roles[0].id;state.settings.timezone='UTC';state.moments=[];
  Life.saveRoleSettings(state,roleId,{enabled:true,dailyMax:2});let calls=0,at=AT,activity='阅读';
  const run=()=>Life.runNow({getState:()=>state,mutate:fn=>({value:fn(state),state}),roleId,now:at,clock:()=>at,scheduleSnapshot:()=>({day:new Date(at).toISOString().slice(0,10),version:'v',phone:'free',mood:'平静',currentSlot:{activity,startAt:at-60000,endAt:at+3600000}}),modelApi:{call:async()=>{calls++;return {message:{content:'{"skip":true}'}};}}});
  assert.equal((await run()).status,'skipped');assert.equal(Life.view(state,roleId).todayCount,1);await run();assert.equal(calls,1);
  activity='散步';await run();assert.equal(calls,2);assert.equal(Life.view(state,roleId).todayCount,2);
  activity='做饭';assert.equal((await run()).status,'daily-limit');assert.equal(calls,2);assert.equal(state.moments.length,0);
  at+=86400000;assert.equal((await run()).status,'skipped');assert.equal(calls,3);
});
