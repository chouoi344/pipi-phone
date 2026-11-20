// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const formatters=new Map();
function validateTimezone(value){
  if(typeof value!=='string'||value.length>100)throw Object.assign(new Error('时区无效'),{status:400,code:'VALIDATION'});
  try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}
  catch{throw Object.assign(new Error('时区无效'),{status:400,code:'VALIDATION'});}
}
function parts(at,timezone='UTC'){
  timezone=timezone||'UTC';
  if(!formatters.has(timezone))formatters.set(timezone,new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  const out=Object.fromEntries(formatters.get(timezone).formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  out.weekday=new Date(Date.UTC(out.year,out.month-1,out.day)).getUTCDay();
  return out;
}
const pad=n=>String(n).padStart(2,'0');
function dayKey(at=Date.now(),timezone='UTC'){const p=parts(at,timezone);return `${p.year}-${pad(p.month)}-${pad(p.day)}`;}
function format(at=Date.now(),timezone='UTC'){timezone=timezone||'UTC';const p=parts(at,timezone);return `${dayKey(at,timezone)} 星期${'日一二三四五六'[p.weekday]} ${pad(p.hour)}:${pad(p.minute)}（${timezone}）`;}
function addDays(day,count){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
function wallStamp(at,timezone){const p=parts(at,timezone);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
// Resolve a wall clock with only Intl: choose the first occurrence on an autumn
// overlap and move a missing spring time forward by the size of the clock jump.
function resolveLocal(day,time,timezone='UTC'){
  const nominal=Date.parse(day+'T'+time+':00Z'),offsets=new Set();
  for(let h=-36;h<=36;h+=6){const at=nominal+h*3600000;offsets.add(wallStamp(at,timezone)-at);}
  const candidates=[...offsets].map(offset=>nominal-offset).sort((a,b)=>a-b);
  const exact=candidates.filter(at=>wallStamp(at,timezone)===nominal);
  if(exact.length)return exact[0];
  return candidates.filter(at=>wallStamp(at,timezone)>nominal).sort((a,b)=>wallStamp(a,timezone)-wallStamp(b,timezone))[0];
}
function quiet(role,at=Date.now(),timezone='UTC'){
  const p=parts(at,timezone),minute=p.hour*60+p.minute;
  const [sh,sm]=role.quietStart.split(':').map(Number),[eh,em]=role.quietEnd.split(':').map(Number),start=sh*60+sm,end=eh*60+em;
  return start===end?false:start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
function quietEnd(role,at=Date.now(),timezone='UTC'){
  if(!quiet(role,at,timezone))return at;
  const p=parts(at,timezone),minute=p.hour*60+p.minute,[sh,sm]=role.quietStart.split(':').map(Number),[eh,em]=role.quietEnd.split(':').map(Number),start=sh*60+sm,end=eh*60+em;
  const day=addDays(dayKey(at,timezone),start>end&&minute>=start?1:0);
  return resolveLocal(day,role.quietEnd,timezone);
}
function gap(milliseconds){const hours=Math.floor(milliseconds/3600000);return hours>=24?`${Math.floor(hours/24)}天${hours%24?' '+hours%24+'小时':''}`:`${hours}小时`;}
module.exports={validateTimezone,parts,dayKey,format,addDays,resolveLocal,quiet,quietEnd,gap};
