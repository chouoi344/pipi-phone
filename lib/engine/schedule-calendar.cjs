// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Node's ICU Chinese calendar supplies lunar conversion without a runtime dependency.
const lunarFormat=new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
const MONTHS=['正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','腊月'];
const LUNAR_FESTIVALS={'1-1':'春节','1-15':'元宵节','2-2':'龙抬头','3-3':'上巳节','5-5':'端午节','7-7':'七夕','7-15':'中元节','8-15':'中秋节','9-9':'重阳节','12-8':'腊八节'};
const SOLAR_FESTIVALS={'01-01':'元旦','02-14':'情人节','03-08':'妇女节','03-12':'植树节','05-01':'劳动节','05-04':'青年节','06-01':'儿童节','09-10':'教师节','10-01':'国庆节','12-24':'平安夜','12-25':'圣诞节'};
const TERM_NAMES='小寒 大寒 立春 雨水 惊蛰 春分 清明 谷雨 立夏 小满 芒种 夏至 小暑 大暑 立秋 处暑 白露 秋分 寒露 霜降 立冬 小雪 大雪 冬至'.split(' ');
// Official Hong Kong Observatory civil dates, UTC+08:00; verified 2026-11-17.
// https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T{year}c.txt
// 2026 PDF cross-check: https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
// Each month has two terms. Only published table dates are used; no extrapolation.
const TERM_DAYS={
  2025:[5,20,3,18,5,20,4,20,5,21,5,21,7,22,7,23,7,23,8,23,7,22,7,21],
  2026:[5,20,4,18,5,20,5,20,5,21,5,21,7,23,7,23,7,23,8,23,7,22,7,22],
  2027:[5,20,4,19,6,21,5,20,6,21,6,21,7,23,8,23,8,23,8,23,7,22,7,22],
  2028:[6,20,4,19,5,20,4,19,5,20,5,21,6,22,7,22,7,22,8,23,7,22,6,21],
  2029:[5,20,3,18,5,20,4,20,5,21,5,21,7,22,7,23,7,23,8,23,7,22,7,21],
  2030:[5,20,4,18,5,20,5,20,5,21,5,21,7,23,7,23,7,23,8,23,7,22,7,22]
};
const TERM_ROWS=Object.entries(TERM_DAYS).flatMap(([year,days])=>days.map((day,i)=>({name:TERM_NAMES[i],date:`${year}-${String(Math.floor(i/2)+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`})));
function solarTermInfo(dayKey){
  const year=Number(dayKey.slice(0,4)),available=Object.hasOwn(TERM_DAYS,year);
  const exact=available?TERM_ROWS.find(x=>x.date===dayKey):null,next=available?TERM_ROWS.find(x=>x.date>dayKey):null;
  const upcoming=next?{...next,daysAway:(Date.parse(next.date+'T00:00:00Z')-Date.parse(dayKey+'T00:00:00Z'))/86400000}:null;
  return {solarTerms:exact?[exact.name]:[],solarTerm:exact?.name||(upcoming?`${upcoming.name}前${upcoming.daysAway}天`:''),nextSolarTerm:upcoming,solarTermStatus:exact||upcoming?'official':'unavailable',solarTermSource:available?`https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T${year}c.txt`:'',solarTermTimezone:'Asia/Hong_Kong',solarTermSupportedYears:[2025,2030]};
}
function lunarForDate(date){
  const parts=Object.fromEntries(lunarFormat.formatToParts(date).map(x=>[x.type,x.value]));
  const leap=parts.month.startsWith('闰'),monthName=parts.month,month=MONTHS.indexOf(monthName.replace(/^闰/,''))+1;
  if(!month)throw new Error('当前运行环境没有提供可识别的中国农历月份');
  const day=Number(parts.day),digits=['一','二','三','四','五','六','七','八','九','十'];
  const dayName=day<=10?'初'+digits[day-1]:day<20?'十'+digits[day-11]:day===20?'二十':day<30?'廿'+digits[day-21]:'三十';
  return {year:Number(parts.relatedYear),yearName:parts.yearName,month,monthName,day,leap,text:`${parts.yearName}年${monthName}${dayName}`};
}
function calendarForDay(dayKey){
  if(typeof dayKey!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dayKey))throw Object.assign(new Error('日期格式无效'),{code:'VALIDATION',status:400});
  const date=new Date(dayKey+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dayKey)throw Object.assign(new Error('日期无效'),{code:'VALIDATION',status:400});
  const lunar=lunarForDate(date),festivals=[];
  if(SOLAR_FESTIVALS[dayKey.slice(5)])festivals.push(SOLAR_FESTIVALS[dayKey.slice(5)]);
  if(!lunar.leap&&LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`])festivals.push(LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`]);
  const tomorrow=lunarForDate(new Date(date.getTime()+86400000));
  if(lunar.month===12&&!tomorrow.leap&&tomorrow.month===1&&tomorrow.day===1)festivals.push('除夕');
  const terms=solarTermInfo(dayKey);
  if(terms.solarTerms.includes('清明'))festivals.push('清明节');
  return {date:dayKey,weekday:['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getUTCDay()],lunar,festivals,...terms};
}
module.exports={calendarForDay};
