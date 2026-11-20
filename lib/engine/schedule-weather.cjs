// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from astrbot_plugin_life weather.py, revision 43003a9796acbdefeade677ce169fc97a262da44.
'use strict';
const Core=require('./schedule-core.cjs');
const WMO={0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'强毛毛雨',56:'冻毛毛雨',57:'强冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'小冻雨',67:'强冻雨',71:'小雪',73:'中雪',75:'大雪',77:'米雪',80:'小阵雨',81:'阵雨',82:'强阵雨',85:'小阵雪',86:'强阵雪',95:'雷雨',96:'雷雨伴小冰雹',99:'雷雨伴大冰雹'};
const SEASON={春:[14,22,20],夏:[25,33,30],秋:[13,21,10],冬:[2,10,10]};
const SOUTH=/广东|广州|深圳|福建|厦门|泉州|浙江|杭州|江苏|南京|上海|湖南|长沙|湖北|武汉|江西|四川|成都|重庆|云南|贵州|广西|海南|港澳台/;
async function requestJson(url){
  const u=new URL(url);
  return require('../providers.cjs').request({baseUrl:u.origin,timeoutSeconds:8},u.pathname+u.search,{method:'GET',anonymous:true,maxBytes:1024*1024,timeoutSeconds:8});
}
function simulated(city,day,now,reason){
  const [tempMin,tempMax,precipProb]=SEASON[Core.seasonForDay(day)];
  return {city,requestedCity:city,fallbackFrom:'',summary:'季节模拟天气',temp:Math.round((tempMin+tempMax)/2),tempMin,tempMax,precipProb,source:'seasonal',day,updatedAt:now,periods:{},hourly:[],stale:false,reason,cacheEntry:null,significantChange:false};
}
function currentSlice(data,localTime){
  const row=data.hourly?.find(x=>x.time.slice(0,13)===localTime.slice(0,13));
  return {...data,...(row?{temp:row.temp,summary:row.summary,precipProb:row.precipProb}: {})};
}
function significantChange(old,current){
  if(!old||old.source==='seasonal'||current.source==='seasonal')return false;
  return Number.isFinite(old.precipProb)&&Number.isFinite(current.precipProb)&&old.precipProb<70&&current.precipProb>=70||Number.isFinite(old.temp??old.tempMax)&&Number.isFinite(current.temp??current.tempMax)&&(old.temp??old.tempMax)-(current.temp??current.tempMax)>=6;
}
function cityVariants(city){return [...new Set([city,...(!city.includes('市')?[city+'市']:[]),city.replace(/(?:特别行政区|自治区|自治州|地区|省|市|县|区)$/u,''),...city.split(/[省市、,，\s]+/u).filter(Boolean).reverse()])].filter(Boolean).slice(0,4);}
function localClock(now,timezone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
async function resolveCityWeather(city,day,cache={},personaHint='',options={}){
  const clean=String(city||'').trim(),now=options.now??Date.now(),localTime=options.localTime||localClock(now,options.timezone||'UTC'),get=options.requestJson||requestJson;
  if(!clean||options.enabled===false)return simulated(clean,day,now,!clean?'未设置城市':'实时天气已关闭');
  const cached=cache[clean],previous=cached?.data;
  if(!options.force&&cached?.day===day&&now-(cached.checkedAt??cached.fetchedAt)<3*3600000)return {...currentSlice(previous,localTime),source:['seasonal','unavailable'].includes(previous.source)?previous.source:'cache',cacheEntry:null,significantChange:false};
  try{
    let coordinates=cached?.coordinates,actual=clean,fallbackFrom='';
    if(!coordinates){
      for(const name of cityVariants(clean)){
        const geo=await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=3&language=zh&format=json`);
        const result=geo.results?.find(x=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
        if(result){coordinates={latitude:result.latitude,longitude:result.longitude,city:result.name||clean,fallbackFrom:''};break;}
      }
      if(!coordinates){actual=SOUTH.test(clean+' '+personaHint)?'广州':'北京';fallbackFrom=clean;coordinates={latitude:actual==='广州'?23.1291:39.9042,longitude:actual==='广州'?113.2644:116.4074,city:actual,fallbackFrom};}
    }
    actual=coordinates.city;fallbackFrom=coordinates.fallbackFrom||'';
    const fc=await get(`https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`);
    const daily=fc.daily,h=fc.hourly;
    if(!daily?.time?.length||!h?.time?.length)throw new Error('天气接口没有返回逐时预报');
    const index=Math.max(0,daily.time.indexOf(day));
    if(![daily.temperature_2m_min?.[index],daily.temperature_2m_max?.[index]].every(Number.isFinite))throw new Error('天气接口温度无效');
    const hourly=h.time.map((time,i)=>({time,temp:h.temperature_2m?.[i],summary:WMO[h.weather_code?.[i]]||'天气不明',precipProb:h.precipitation_probability?.[i]}));
    if(hourly.some(x=>typeof x.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.time)||!Number.isFinite(x.temp)||!Number.isFinite(x.precipProb)))throw new Error('天气接口逐时数据无效');
    const periods={};
    for(const [name,start,end]of [['morning',6,12],['afternoon',12,18],['evening',18,24],['night',0,6]]){
      const rows=hourly.filter(x=>x.time.startsWith(day)&&Number(x.time.slice(11,13))>=start&&Number(x.time.slice(11,13))<end);
      if(rows.length)periods[name]={summary:rows[0].summary,tempMin:Math.min(...rows.map(x=>x.temp)),tempMax:Math.max(...rows.map(x=>x.temp)),precipProb:Math.max(...rows.map(x=>x.precipProb))};
    }
    const data=currentSlice({city:actual,requestedCity:clean,fallbackFrom,summary:WMO[fc.current?.weather_code??daily.weather_code?.[index]]||'天气不明',temp:fc.current?.temperature_2m??null,tempMin:daily.temperature_2m_min[index],tempMax:daily.temperature_2m_max[index],precipProb:daily.precipitation_probability_max?.[index]??null,source:'open-meteo',day,updatedAt:now,periods,hourly,stale:false},options.localTime||fc.current?.time||localTime);
    return {...data,cacheEntry:{key:clean,entry:{day,fetchedAt:now,checkedAt:now,coordinates,data}},significantChange:significantChange(previous,data)};
  }catch(error){
    const data=previous?{...currentSlice(previous,localTime),source:['seasonal','unavailable'].includes(previous.source)?previous.source:'cache',stale:true,reason:error.message}:{...simulated(clean,day,now,error.message),summary:'天气暂时获取失败，稍后重试',source:'unavailable',temp:null,tempMin:null,tempMax:null,precipProb:null};
    const {cacheEntry:_,significantChange:__,...stored}=data;
    return {...stored,cacheEntry:{key:clean,entry:{...cached,day,checkedAt:now,data:stored}},significantChange:false};
  }
}
module.exports={resolveCityWeather,refresh:resolveCityWeather,significantChange,currentSlice,cityVariants};
