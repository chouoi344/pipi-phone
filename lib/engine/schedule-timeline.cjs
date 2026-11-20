// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const T=require('./time.cjs'),C=require('./schedule-core.cjs');
function day(at,tz,boundary='07:00'){const key=T.dayKey(at,tz);return at<T.resolveLocal(key,boundary,tz)?T.addDays(key,-1):key;}
function stamp(key,hm,tz,boundary='07:00'){return T.resolveLocal(T.addDays(key,hm<boundary?1:0),hm,tz);}
function timeline(slots,key,tz,boundary='07:00'){
 return slots.map(s=>{const startAt=stamp(key,s.start,tz,boundary);let endAt=stamp(key,s.end,tz,boundary);if(s.end==='23:59')endAt=T.resolveLocal(T.addDays(T.dayKey(startAt,tz),1),'00:00',tz);else if(endAt<=startAt)endAt=T.resolveLocal(T.addDays(T.dayKey(endAt,tz),1),s.end,tz);return {...s,startAt,endAt};}).sort((a,b)=>a.startAt-b.startAt);
}
function normalize(raw,key,tz,boundary='07:00',name='TA',routine){
 const startAt=T.resolveLocal(key,boundary,tz),endAt=T.resolveLocal(T.addDays(key,1),boundary,tz);
 return normalizeWindow(raw,{startAt,endAt},tz,name,routine);
}
function clock(at,tz){const p=T.parts(at,tz);return String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');}
function normalizeWindow(raw,{startAt,endAt},tz,name,routine){
  const repaired=C.repairSlots(raw,name,{routine,preserveSingleFullDay:false}),slots=[];
  const last=T.dayKey(endAt-1,tz);
  let covered=startAt;
  // Place the repaired wall-clock day on each real date, then clip the plan window.
  for(let key=T.dayKey(startAt,tz);key<=last;key=T.addDays(key,1)){
    const midnight=T.resolveLocal(T.addDays(key,1),'00:00',tz);
    for(const slot of repaired){
      const from=Math.max(covered,T.resolveLocal(key,slot.start,tz));
      const to=Math.min(endAt,slot.end==='23:59'?midnight:T.resolveLocal(key,slot.end,tz));
      if(to<=from)continue;
      slots.push({...slot,startAt:from,endAt:to,start:clock(from,tz),end:clock(to,tz)});
      covered=to;
    }
  }
  return slots;
}
function merge(slots,changes,at,key,tz,boundary='07:00',name='TA',window,routine){
 let out=slots.map(s=>({...s}));
 const replacements=[];
 const leadingDay=window&&at<T.resolveLocal(key,boundary,tz)?T.addDays(key,-1):null;
 for(const raw of changes){const requested=timeline([raw],key,tz,boundary)[0];if(!requested)continue;
  const earlier=leadingDay&&timeline([raw],leadingDay,tz,boundary)[0];
  const range=earlier?.endAt>at?earlier:requested;
  const safe=window?normalizeWindow([raw],window,tz,name,routine):normalize([raw],key,tz,boundary,name,routine);
  for(const segment of safe){const from=Math.max(segment.startAt,range.startAt),to=Math.min(segment.endAt,range.endAt);if(to>from)replacements.push({...segment,startAt:from,endAt:to,start:clock(from,tz),end:clock(to,tz)});}
 }
 for(const change of replacements){const from=Math.max(at,change.startAt),to=change.endAt;if(to<=from)continue;const next=[];for(const s of out){if(s.endAt<=from||s.startAt>=to){next.push(s);continue;}if(s.startAt<from)next.push({...s,endAt:from,end:clock(from,tz)});if(s.endAt>to)next.push({...s,startAt:to,start:clock(to,tz)});}next.push({...change,startAt:from,start:clock(from,tz)});out=next;}
 return out.sort((a,b)=>a.startAt-b.startAt);
}
module.exports={day,stamp,timeline,normalize,normalizeWindow,merge,clock};
