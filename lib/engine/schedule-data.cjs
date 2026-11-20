// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../state.cjs'),T=require('./time.cjs');
const PROFILE_FIELDS=['identity','living','routineWorkday','routineRestday','hobbiesPlaces','phoneHabits','weeklyFixed','periodic','vacations','socialCircle'];
function data(state){state.engine??={};state.engine.data??={};const d=state.engine.data.schedule??={};for(const key of ['days','profiles','profileMeta','wardrobes','promises','userEvents','weatherCache','history','events','generation','roleSettings'])d[key]??={};return d;}
function profile(input){if(!S.obj(input))S.fail('生活档案格式无效');const out={};for(const k of PROFILE_FIELDS)out[k]=S.text(String(input[k]||''),1000).trim();return out;}
function addRecord(state,roleId,input,type,now=Date.now()){
 S.role(state,roleId);const d=data(state),list=d[type][roleId]??=[];const content=S.text(String(input.content||''),500).trim();if(!content)S.fail('内容不能为空');
 const tz=state.settings?.timezone||'UTC',date=input.date||input.dueDate||input.eventDate||'',hm=input.time||input.dueHm||input.eventHm||'';
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))S.fail('日期无效');
 if(hm&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(hm))S.fail('时间无效');
 const dueAt=date?T.resolveLocal(date,hm||'23:59',tz):(input.dueAt??null);if(dueAt!==null&&!Number.isFinite(dueAt))S.fail('时间无效');
 const item={id:(type==='promises'?'pr-':'ue-')+S.id().slice(0,12),content,date,time:hm,dueAt,status:'pending',createdAt:now};
 if(type==='promises'){item.type=S.enumOf(input.type||'do',['tell','do','avoid']);item.dueHm=hm;}else{item.eventHm=hm;const hours=Number(input.followUpHours??2);if(!Number.isFinite(hours)||hours<1||hours>15)S.fail('回访间隔须为1至15小时');item.followUpHours=hours;item.followUpAt=dueAt===null?null:dueAt+hours*3600000;}
 list.push(item);return item;
}
function mark(state,roleId,id,status,type,note='',now=Date.now()){
 S.role(state,roleId);S.enumOf(status,['pending','done','completed','cancelled','missed','expired']);const item=data(state)[type][roleId]?.find(x=>x.id===id);if(!item)S.fail('记录不存在',404);if(status==='missed'&&!String(note).trim())S.fail('请填写实际失约原因');item.status=status==='completed'?'done':status;item.note=S.text(String(note),500);item.updatedAt=now;return item;
}
function expire(list,at){let changed=false;for(const item of list||[])if(item.status==='pending'&&!item.dueAt&&at-item.createdAt>=7*86400000){item.status='expired';item.updatedAt=at;changed=true;}return changed;}
function remove(state,roleId,id,type){S.role(state,roleId);const d=data(state);d[type][roleId]=(d[type][roleId]||[]).filter(x=>x.id!==id);return d[type][roleId];}
function snapshot(d,roleId,plan){const history=d.history[roleId]??=[];const at=history.findIndex(x=>x.day===plan.day);const copy=structuredClone(plan);if(at<0)history.push(copy);else history[at]=copy;d.history[roleId]=history.filter(h=>h.day>=T.addDays(plan.day,-29)).sort((a,b)=>a.day.localeCompare(b.day)).slice(-30);}
module.exports={PROFILE_FIELDS,data,profile,addRecord,mark,expire,remove,snapshot};
