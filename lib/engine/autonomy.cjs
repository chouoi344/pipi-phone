// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Legacy backups keep their saved plans and history without registering any jobs.
const T=require('./time.cjs');
const activities=['chat','moment','profile','image','none'],caps={chat:'dailyChat',moment:'dailyMoments',profile:'dailyProfile',image:'dailyImages'};
const fail=message=>{throw Object.assign(new Error(message),{status:400,code:'VALIDATION'});};
function ensure(state){state.engine??={};state.engine.data??={};const data=state.engine.data.autonomy??={};data.profiles??={};data.policy??=null;data.plans??={};data.attempts??={};data.history??=[];return data;}
function validatePolicy(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('请明确配置自主活动频率');
  const out={};
  for(const key of Object.values(caps)){if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>100)fail(key+'须为0到100的整数');out[key]=input[key];}
  for(const key of ['minIntervalMinutes','wakeIntervalMinutes']){if(!Number.isSafeInteger(input[key])||input[key]<1||input[key]>1440)fail(key+'须为1到1440的整数');out[key]=input[key];}
  for(const key of ['quietStart','quietEnd']){if(typeof input[key]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input[key]))fail(key+'须明确填写HH:mm');out[key]=input[key];}
  return out;
}
function recover(state){
  if(!state.engine.data.autonomy)return;
  const data=ensure(state);
  for(const attempt of Object.values(data.attempts))if(attempt.status==='running'){attempt.status='failed';attempt.error='程序重启，计划生成已中断';}
  for(const plan of Object.values(data.plans))for(const entry of plan.entries)if(entry.status==='running'){entry.status='interrupted';entry.error='程序重启，动作结果未知，不自动重试';}
  for(const item of data.history)if(item.status==='running'){item.status='interrupted';item.error='程序重启，动作结果未知，保留额度占用';}
}
function validateRestore(data){
  if(!data||typeof data!=='object'||Array.isArray(data))fail('自主活动备份无效');
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  for(const key of ['profiles','plans','attempts'])if(!object(data[key]))fail('自主活动'+key+'无效');
  if(data.policy!==null)validatePolicy(data.policy);
  if(!Array.isArray(data.history)||data.history.length>100000)fail('自主活动历史无效');
  const states=['pending','running','skipped','expired','completed','failed','interrupted'];
  for(const profile of Object.values(data.profiles))if(!object(profile)||typeof profile.routine!=='string'||profile.routine.length>12000||typeof profile.enabled!=='boolean')fail('自主活动作息无效');
  for(const attempt of Object.values(data.attempts))if(!object(attempt)||typeof attempt.inputStamp!=='string'||!['running','completed','failed'].includes(attempt.status)||!Number.isFinite(attempt.at))fail('自主活动计划状态无效');
  for(const plan of Object.values(data.plans)){
    if(!object(plan)||typeof plan.revision!=='string'||typeof plan.inputStamp!=='string'||typeof plan.day!=='string'||typeof plan.preview!=='boolean'||!Number.isFinite(plan.createdAt)||!Array.isArray(plan.entries)||plan.entries.length>100)fail('自主活动计划无效');
    T.validateTimezone(plan.timezone);
    const ids=new Set();
    for(const entry of plan.entries){
      if(!object(entry)||typeof entry.id!=='string'||ids.has(entry.id)||!Number.isFinite(entry.at)||!activities.includes(entry.activity)||typeof entry.note!=='string'||entry.note.length>2000||!states.includes(entry.status))fail('自主活动条目无效');
      ids.add(entry.id);
    }
  }
  for(const item of data.history)if(!object(item)||typeof item.roleId!=='string'||typeof item.entryId!=='string'||typeof item.planRevision!=='string'||!activities.includes(item.activity)||!Number.isFinite(item.at)||typeof item.acted!=='boolean'||!['running','completed','failed','interrupted'].includes(item.status))fail('自主活动历史条目无效');
  return data;
}
module.exports={recover,validateRestore,ensure};
