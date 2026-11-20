// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),J=require('../lib/engine/scheduler.cjs'),T=require('../lib/engine/time.cjs'),R=require('../lib/engine/registry.cjs');
const stamp=s=>Date.parse(s);
function state(tz='Asia/Shanghai'){const s={settings:{timezone:tz,modules:{}},roles:[{id:'r',permissions:{},quietStart:'22:00',quietEnd:'08:00'}]};R.ensure(s);return s;}
const once=(at,userRequested=true)=>({note:'记得喝水',userRequested,schedule:{type:'once',at}});
test('统一时区决定日期、星期、当前时间及免打扰',()=>{
  const at=stamp('2026-11-15T16:30:00Z');assert.equal(T.dayKey(at,'Asia/Shanghai'),'2026-11-16');assert.ok(T.format(at,'Asia/Shanghai').includes('星期一 00:30'));assert.equal(T.dayKey(at,'America/Los_Angeles'),'2026-11-15');
  assert.equal(T.quiet(state().roles[0],at,'Asia/Shanghai'),true);assert.equal(T.quietEnd(state().roles[0],at,'Asia/Shanghai'),stamp('2026-11-16T00:00:00Z'));assert.throws(()=>T.validateTimezone('Not/AZone'));
});
test('本地时间转换处理夏令时跳时与重叠',()=>{
  assert.equal(T.resolveLocal('2026-03-08','02:30','America/Los_Angeles'),stamp('2026-03-08T10:30:00Z'));
  assert.equal(T.resolveLocal('2026-11-01','01:30','America/Los_Angeles'),stamp('2026-11-01T08:30:00Z'));
  assert.equal(T.resolveLocal('2026-11-15','10:00','Asia/Shanghai'),stamp('2026-11-15T02:00:00Z'));
});
test('一次性提醒持久保存、到期只领取一次、完成后不再触发',()=>{
  const s=state(),now=stamp('2026-11-15T01:00:00Z'),job=J.add(s,'r',once(now+1000),now),restored=JSON.parse(JSON.stringify(s));
  assert.equal(J.due(restored,now).length,0);assert.equal(J.due(restored,now+1000)[0].id,job.id);assert.equal(J.due(restored,now+1000).length,0);J.finish(restored,job.id,{now:now+2000});assert.equal(J.list(restored,'r').length,0);assert.equal(J.due(restored,now+3000).length,0);
});
test('每天与每周按本地时钟顺延，跨DST不漂移',()=>{
  const s=state('America/Los_Angeles'),now=stamp('2026-03-07T18:00:00Z');
  const daily=J.add(s,'r',{note:'早上好',userRequested:true,schedule:{type:'daily',time:'09:00'}},now);assert.equal(daily.nextAt,stamp('2026-03-08T16:00:00Z'));
  const weekly=J.add(s,'r',{note:'周一见',userRequested:true,schedule:{type:'weekly',time:'09:00',weekdays:[1]}},now);assert.equal(weekly.nextAt,stamp('2026-03-09T16:00:00Z'));
});
test('每好友数量上限、重复最短一小时和输入校验',()=>{
  const s=state(),now=stamp('2026-11-15T01:00:00Z');for(let i=0;i<20;i++)J.add(s,'r',once(now+1000+i),now);assert.throws(()=>J.add(s,'r',once(now+5000),now),/上限/);
  assert.throws(()=>J.add(state(),'r',{note:'过密',userRequested:true,schedule:{type:'interval',intervalMs:3599999}},now),/过短/);assert.throws(()=>J.add(state(),'r',once(now-1),now),/将来/);assert.throws(()=>J.add(state(),'r',{note:'',userRequested:true,schedule:{type:'once',at:now+1}},now));
});
test('一次性提醒接受ISO和统一时区的本地时间，拒绝不存在的日期',()=>{
  const s=state(),now=stamp('2026-11-15T01:00:00Z');
  assert.equal(J.add(s,'r',once('2026-11-15T10:00'),now).nextAt,stamp('2026-11-15T02:00:00Z'));
  assert.equal(J.add(s,'r',once('2026-11-15T10:00:00+08:00'),now).nextAt,stamp('2026-11-15T02:00:00Z'));
  assert.throws(()=>J.add(s,'r',once('2026-02-30T10:00:00+08:00'),now),/日期无效/);
  assert.throws(()=>J.add(s,'r',once('2026-13-30T10:00'),now),/日期无效/);
});
test('用户要求的提醒穿过免打扰，自主提醒推迟至结束',()=>{
  const s=state(),now=stamp('2026-11-15T13:59:59Z'),at=now+1000;
  R.apply(s,'outreach',{quietHoursEnabled:true,quietStart:'22:00',quietEnd:'08:00'});
  const asked=J.add(s,'r',once(at,true),now),self=J.add(s,'r',once(at,false),now);assert.equal(J.due(s,at)[0].id,asked.id);assert.equal(self.deferredUntil,stamp('2026-11-16T00:00:00Z'));
  assert.equal(J.due(s,stamp('2026-11-16T00:00:00Z'))[0].id,self.id);
});
test('自动提醒忽略旧的好友延后记录，全局时段关闭后恢复',()=>{
  const s=state('UTC'),now=stamp('2026-11-15T00:29:59Z'),at=now+1000;
  R.apply(s,'outreach',{quietHoursEnabled:true,quietStart:'01:00',quietEnd:'07:00'});
  const legacy=J.add(s,'r',once(at,false),now);legacy.deferredUntil=stamp('2026-11-15T07:00:00Z');
  assert.equal(J.due(s,at)[0].id,legacy.id);
  const during=stamp('2026-11-15T02:00:00Z'),job=J.add(s,'r',once(during,false),now);
  assert.equal(J.due(s,during).length,0);
  assert.equal(job.deferredUntil,stamp('2026-11-15T07:00:00Z'));
  R.apply(s,'outreach',{quietHoursEnabled:false});
  assert.equal(J.due(s,during+2*3600000)[0].id,job.id);
  assert.equal(job.deferredUntil,undefined);
});
test('全局免打扰改晚而结束时间相同时，重新判断等待中的自动提醒',()=>{
  const s=state('UTC'),now=stamp('2026-11-15T01:59:59Z'),at=now+1000;
  R.apply(s,'outreach',{quietHoursEnabled:true,quietStart:'01:00',quietEnd:'07:00'});
  const job=J.add(s,'r',once(at,false),now);
  assert.equal(J.due(s,at).length,0);
  R.apply(s,'outreach',{quietStart:'06:00'});
  assert.equal(J.due(s,stamp('2026-11-15T04:00:00Z'))[0].id,job.id);
  assert.equal(job.deferredUntil,undefined);
});
test('停机迟到一小时内补发，超过作废，重复提醒顺延',()=>{
  const now=stamp('2026-11-15T01:00:00Z'),s=state(),j1=J.add(s,'r',once(now+1000),now),j2=J.add(s,'r',once(now+2000),now),repeat=J.add(s,'r',{note:'每小时',userRequested:true,schedule:{type:'interval',intervalMs:3600000}},now);
  assert.equal(J.due(s,now+3601000).find(j=>j.id===j1.id).id,j1.id);J.finish(s,j1.id,{now:now+3601000});J.finish(s,j2.id,{now:now+3601000});J.finish(s,repeat.id,{now:now+3601000});
  const s2=state(),expired=J.add(s2,'r',once(now+1000),now),r=J.add(s2,'r',{note:'重复',userRequested:true,schedule:{type:'interval',intervalMs:3600000}},now);assert.equal(J.due(s2,now+3*3600000+1).length,0);assert.equal(expired.status,'expired');assert.equal(r.nextAt,now+4*3600000);
});
test('修改和删除提醒、重启恢复、换时区重算',()=>{
  const now=stamp('2026-11-15T01:00:00Z'),s=state(),job=J.add(s,'r',once(now+1000),now);J.edit(s,'r',job.id,{note:'新备注',schedule:{type:'daily',time:'10:00'}},now);assert.equal(job.note,'新备注');assert.equal(job.nextAt,stamp('2026-11-15T02:00:00Z'));
  s.settings.timezone='America/Los_Angeles';J.rescheduleTimezone(s,now);assert.equal(job.nextAt,stamp('2026-11-15T18:00:00Z'));J.due(s,job.nextAt);assert.equal(job.status,'running');J.recover(s);assert.equal(job.status,'pending');J.remove(s,'r',job.id);assert.equal(J.list(s,'r').length,0);
});
