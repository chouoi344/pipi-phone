'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Outreach=require('../lib/engine/modules/outreach.cjs');
test('cancelled or expired schedule items never become outreach triggers',()=>{
 const s=sampleState(),role=s.roles[0],now=Date.parse('2026-11-18T12:00:00Z'),settings=R.values(s,'outreach'),rec={};
 const cur={phone:'free',restType:'none',currentSlot:{activity:'工作',startAt:now-3600000}};
 for(const status of ['cancelled','expired','missed','done']){
  s.engine.data.schedule.promises={[role.id]:[{id:'promise',type:'tell',content:'到点告诉我',status,dueAt:now}]};
  s.engine.data.schedule.userEvents={[role.id]:[{id:'event',content:'我的安排',status,followUpAt:now}]};
  assert.equal(Outreach.pickTrigger(s,role,settings,cur,rec,'2026-11-18',now),null);
 }
 s.engine.data.schedule.promises[role.id][0].status='pending';
 assert.equal(Outreach.pickTrigger(s,role,settings,cur,rec,'2026-11-18',now).kind,'promise');
});
