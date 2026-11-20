// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../lib/engine/autonomy.cjs');
const now=Date.parse('2026-11-16T10:00:00Z');
function legacyData(){
  return {
    policy:{dailyChat:1,dailyMoments:1,dailyProfile:1,dailyImages:1,minIntervalMinutes:30,wakeIntervalMinutes:10,quietStart:'22:00',quietEnd:'08:00'},
    profiles:{r:{routine:'白天工作，晚上休息',enabled:true,updatedAt:now}},
    plans:{r:{day:'2026-11-16',timezone:'UTC',inputStamp:'old',revision:'revision',preview:false,createdAt:now,entries:[
      {id:'in-progress',at:now+60000,activity:'profile',note:'更新签名',status:'running'},
      {id:'pending',at:now+120000,activity:'image',note:'拍街景',status:'pending'},
    ]}},
    attempts:{r:{inputStamp:'new',at:now+60000,status:'running'}},
    history:[{roleId:'r',entryId:'in-progress',planRevision:'revision',activity:'profile',at:now+60000,status:'running',acted:false}],
  };
}

test('完整备份中的旧自主活动资料仍可读取，并检验计划和频率格式',()=>{
  const data=JSON.parse(JSON.stringify(legacyData()));
  assert.deepEqual(A.validateRestore(data),data);
  const badPlan=structuredClone(data);
  badPlan.plans.r.entries[0].status='untrusted';
  assert.throws(()=>A.validateRestore(badPlan),/条目无效/);
  const badPolicy=structuredClone(data);
  badPolicy.policy.dailyImages=-1;
  assert.throws(()=>A.validateRestore(badPolicy),/dailyImages/);
});

test('重启保留旧计划，标记此前正在生成或执行的记录',()=>{
  const state={engine:{data:{autonomy:legacyData()}}};
  A.recover(state);
  const data=A.ensure(state);
  assert.equal(data.attempts.r.status,'failed');
  assert.deepEqual(data.plans.r.entries.map(entry=>entry.status),['interrupted','pending']);
  assert.equal(data.history[0].status,'interrupted');
  assert.equal(data.history[0].acted,false);
  assert.deepEqual(A.validateRestore(data),data);
});
