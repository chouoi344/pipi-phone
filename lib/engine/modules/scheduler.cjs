// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../../state.cjs');
module.exports={id:'scheduler',name:'定时提醒',description:'保存好友安排的未来事项，按统一时区触发。',settings:[
  {key:'maxJobs',label:'每位好友最多未完成提醒',type:'number',default:20,min:1,max:200,integer:true},
  {key:'minIntervalHours',label:'重复提醒最短间隔（小时）',type:'number',default:1,min:1,max:8760},
  {key:'lateGraceHours',label:'停机后允许补发（小时）',type:'number',default:1,min:0,max:24,step:0.1,advanced:true}
],hooks:{},tools:[],jobs:[{id:'reminders',run({getState,mutate,isBusy,initiate,now}){
  const J=require('../scheduler.cjs'),state=getState();
  if(!state.engine.jobs.some(job=>job.status==='pending'&&job.nextAt<=now))return;
  const available=job=>job.userRequested||!isBusy(job.roleId);
  const changes=J.planDue(state,now,available);
  if(!changes.length)return;
  const automatic=mutate(s=>{
    const queued=[];
    for(const job of J.claimDue(s,changes)){
      if(!job.userRequested){queued.push(job);continue;}
      const role=S.role(s,job.roleId);
      S.message(s,role,'assistant',job.note,'text',{createdAt:now});
      role.lastActiveAt=now;
      role.unread=Math.min(100000,(role.unread||0)+1);
      J.finish(s,job.id,{now});
    }
    return queued;
  }).value;
  for(const job of automatic)if(!initiate(job.roleId,{instruction:'现在到了约定时间，完成这件事：'+job.note,kind:'reminder',jobId:job.id}))mutate(s=>{const waiting=s.engine.jobs.find(j=>j.id===job.id);if(waiting)waiting.status='pending';});
}}],data:'scheduler',page:null};
