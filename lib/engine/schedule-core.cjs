// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const https=require('node:https');

const SLEEP_MIN_MINUTES=22*60;      // 22:00
const SLEEP_MAX_MINUTES=25*60+30;   // 01:30 (next day)
const WAKE_MIN_MINUTES=6*60+30;     // 06:30
const WAKE_MAX_MINUTES=10*60;       // 10:00
const NIGHT_LOCK_START=2*60;        // 02:00
const NIGHT_LOCK_END=6*60;          // 06:00
const DAY_AWAKE_START=10*60+30;     // 10:30
const DAY_AWAKE_END=21*60+30;       // 21:30
const LIFE_BUDGET=720;
const SLEEP_PROFILES={
  day_normal:{label:'正常',sleepMin:SLEEP_MIN_MINUTES,sleepMax:SLEEP_MAX_MINUTES,wakeMin:WAKE_MIN_MINUTES,wakeMax:WAKE_MAX_MINUTES,lockStart:NIGHT_LOCK_START,lockEnd:NIGHT_LOCK_END,awakeStart:DAY_AWAKE_START,awakeEnd:DAY_AWAKE_END,enforceCircadian:true},
  night_owl:{label:'夜猫子',sleepMin:25*60+30,sleepMax:28*60,wakeMin:9*60+30,wakeMax:12*60+30,lockStart:4*60,lockEnd:9*60+30,awakeStart:13*60,awakeEnd:24*60,enforceCircadian:true},
  free:{label:'自由',sleepMin:0,sleepMax:24*60-1,wakeMin:0,wakeMax:24*60-1,enforceCircadian:false}
};

const COLD_INCOMPATIBLE=['短袖','短裙','短裤','凉鞋','吊带','背心','比基尼','露脐','超短'];
const HOT_INCOMPATIBLE=['羽绒','厚毛衣','羊绒大衣','棉袄','皮草','厚棉服','加绒'];
const SPORTS_WORDS=['运动','健身','跑步','瑜伽','锻炼','篮球','足球','网球','羽毛球','游泳','普拉提'];
const MEAL_RE=/早餐|午餐|晚餐|早饭|午饭|晚饭|早茶|下午茶|夜宵|宵夜|吃(?:饭|早饭|午饭|晚饭|面|火锅|外卖)|便当/;
const TIME_TRIGGER_RE=/(?:\d{1,2}|[零一二两三四五六七八九十]+)\s*(?:点|[:：]\d{2})|(?:今天|明天|后天|今晚|周[一二三四五六日天]|星期[一二三四五六日天])(?:早上|上午|中午|下午|傍晚|晚上|夜里)?|(?:\d+|[一二两三四五六七八九十]+)\s*(?:分钟|小时|天)后/;
const DIRECT_CHANGE_RE=/(?:把|将)[^。！？\n]{1,30}(?:改成|改为|改到|调整为|调整到|换成)|(?:修改|调整|改一下)[^。！？\n]{0,16}(?:日程|行程|时间表|安排|计划)|我[^。！？\n]{0,24}(?:推迟到|提前到|改到)/;
const SCHEDULE_TRIGGER_RE=/日程|行程|时间表|安排|计划|今天|明天|后天|今晚|上午|下午|晚上|早上|周[一二三四五六日天]|星期[一二三四五六日天]/;

const FORBIDDEN_RE=/(?:线下见面|线下约会|去你家|来我家|来我这|去你那|同居|一起住|同住|当面(?:见|聊|抱|亲)|去找你|来找你|陪你逛街|一起(?:吃|逛|去玩|看电影)|拥抱你|亲吻你|牵手|语音通话|视频通话|连麦|打电话给你|开视频)/;
const NEGATIVE_PREFIX_RE=/(?:不|没|别|无法|拒绝|推掉|取消|禁止|避免)[^，。；;\n]{0,6}$/;
const OTHER_PERSON_RE=/(?:家人|父母|爸妈|爸爸|妈妈|朋友|闺蜜|室友|同学|同事|老师|邻居|哥哥|姐姐|弟弟|妹妹)/;

const WMO_ZH={0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'小阵雨',81:'阵雨',82:'强阵雨',95:'雷雨'};
const SEASON_WEATHER={春:{summary:'多云间晴',tempMin:14,tempMax:22,precipProb:20},夏:{summary:'晴热午后偶有阵雨',tempMin:25,tempMax:33,precipProb:30},秋:{summary:'晴朗微凉',tempMin:13,tempMax:21,precipProb:10},冬:{summary:'阴冷晴间多云',tempMin:2,tempMax:10,precipProb:10}};
const SOUTH_REGIONS=['广东','广州','深圳','福建','厦门','泉州','浙江','杭州','江苏','南京','上海','湖南','长沙','湖北','武汉','四川','成都','重庆','云南','广西','海南'];

function clamp(n,lo,hi){return Math.max(lo,Math.min(hi,n));}
function toMinutes(hhmm){
  const m=String(hhmm||'').trim().match(/^([01]?\d|2[0-4]):([0-5]\d)$/);
  if(!m)return null;
  const h=Number(m[1]),min=Number(m[2]);
  if(h===24&&min>0)return null;
  return h*60+min;
}
function fromMinutes(total){
  const clamped=clamp(Math.round(total),0,24*60);
  if(clamped===24*60)return '23:59';
  const h=Math.floor(clamped/60),m=clamped%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
function formatWrapMinutes(total){
  const norm=((Math.round(total)%1440)+1440)%1440;
  return fromMinutes(norm);
}

function seasonForDay(dayKey){
  const month=Number(String(dayKey||'').split('-')[1])||new Date().getMonth()+1;
  return month>=3&&month<=5?'春':month>=6&&month<=8?'夏':month>=9&&month<=11?'秋':'冬';
}

function isNightSleepText(text){
  return /(?:夜间|夜里|晚上|深夜|凌晨)?(?:睡觉|睡眠|入睡|就寝|熟睡|安睡)|^睡到|^继续睡/.test(String(text||''));
}
function isNapText(text){
  return /(?:午睡|午休|午觉|小睡|小憩|打盹)/.test(String(text||''));
}

function extractClockFromRoutineText(text,{forSleep=false,enforceCircadian=true}={}){
  const str=String(text||'');
  const pattern=forSleep
    ?/(?:(?:晚上|夜里|深夜|凌晨)?\s*(\d{1,2})\s*[:：点]\s*(\d{1,2}|半)?\s*(?:分)?[^，。；;\n\d]{0,4}(?:睡|入睡|就寝|熄灯))|(?:(?:睡|入睡|就寝)[^，。；;\n]{0,6}?(\d{1,2})\s*[:：点]\s*(\d{1,2}|半)?)/d
    :/(?:(?:早上|上午|中午|下午)?\s*(\d{1,2})\s*[:：点]\s*(\d{1,2}|半)?\s*(?:分)?[^，。；;\n\d]{0,4}(?:起|起床|醒))|(?:(?:起|起床|醒)[^，。；;\n]{0,6}?(\d{1,2})\s*[:：点]\s*(\d{1,2}|半)?)/d;
  const m=str.match(pattern);
  if(!m)return null;
  const h=Number(m[1]??m[3]),rawMin=m[2]??m[4];
  if(!Number.isFinite(h)||h<0||h>23)return null;
  const min=rawMin==='半'?30:(Number(rawMin)||0);
  if(min<0||min>59)return null;
  // Nearest time-of-day word in the same clause: 晚上11点 is 23:00, 12点睡 is 24:00; 凌晨/早上/上午 keep their hour.
  const part=[...str.slice(0,(m.indices[1]||m.indices[3])[0]).split(/[，。；;\n]/).pop().matchAll(/晚上|夜里|下午|傍晚|凌晨|早上|上午|中午|深夜/g)].pop()?.[0]||'';
  let total=h*60+min;
  if(['晚上','夜里','深夜','下午','傍晚'].includes(part)&&h>=1&&h<=11&&!(forSleep&&['晚上','夜里'].includes(part)&&h<=5))total+=12*60;
  else if(forSleep&&h===12&&(enforceCircadian&&!['早上','上午','中午'].includes(part)||['晚上','夜里','深夜'].includes(part)))total+=12*60;
  else if(forSleep&&enforceCircadian&&!part&&h>=9&&h<=11)total+=12*60;
  else if(forSleep&&enforceCircadian&&h<=8)total+=24*60;
  return total;
}

function computeRoutine(profile={},options={}){
  const sleepProfile=options.sleepProfile||'day_normal',config=SLEEP_PROFILES[sleepProfile];
  const isWorkday=options.isWorkday!==false;
  const jitter=clamp(Number(options.jitterMinutes??20)||0,0,45);
  const rand=typeof options.rng==='function'?options.rng:Math.random;
  const rawText=isWorkday?(profile.routineWorkday||''):(profile.routineRestday||profile.routineWorkday||'');
  const defaultWake=sleepProfile==='night_owl'?(isWorkday?10*60+30:11*60+30):(isWorkday?7*60+45:9*60);
  const defaultSleep=sleepProfile==='night_owl'?(isWorkday?26*60+30:27*60):(isWorkday?23*60+30:24*60+15);
  const parsedWake=extractClockFromRoutineText(rawText,{forSleep:false,enforceCircadian:config.enforceCircadian});
  const parsedSleep=extractClockFromRoutineText(rawText,{forSleep:true,enforceCircadian:config.enforceCircadian});
  const jitterWake=(rand()*2-1)*jitter;
  const jitterSleep=(rand()*2-1)*jitter;
  const sleepDebt=clamp(Number(options.sleepDebtMinutes||0)||0,0,45);
  const wakeMin=clamp(Math.round((parsedWake??defaultWake)+jitterWake+sleepDebt),config.wakeMin,config.wakeMax);
  const sleepClock=config.enforceCircadian?(parsedSleep??defaultSleep):(parsedSleep??defaultSleep)%1440;
  const sleepMin=clamp(Math.round(sleepClock+jitterSleep),config.sleepMin,config.sleepMax);
  return {
    sleepProfile,enforceCircadian:config.enforceCircadian,
    wakeMin,
    sleepMin,
    wakeHm:fromMinutes(wakeMin),
    sleepHm:formatWrapMinutes(sleepMin),
    sleepsAfterMidnight:sleepMin>=24*60
  };
}

function containsForbidden(value,extraForbidden=[]){
  const text=typeof value==='string'?value:JSON.stringify(value||'');
  if(!text.trim())return false;
  for(const clause of text.split(/[。！？!?\n；;，,]+/)){
    const trimmed=clause.trim();
    if(!trimmed)continue;
    const match=FORBIDDEN_RE.exec(trimmed);
    if(match){
      const prefix=trimmed.slice(0,match.index);
      if(NEGATIVE_PREFIX_RE.test(prefix))continue;
      if(OTHER_PERSON_RE.test(prefix)&&!/你|主人/.test(trimmed))continue;
      return true;
    }
    for(const term of extraForbidden){
      const t=String(term||'').trim();
      if(t&&trimmed.includes(t)&&!NEGATIVE_PREFIX_RE.test(trimmed.slice(0,trimmed.indexOf(t))))return true;
    }
  }
  return false;
}

function sanitizeForbiddenText(text,replacement='独自在家安排自己的事'){
  const lines=String(text||'').split(/(?<=[。！？!?\n])/).filter(Boolean);
  const kept=lines.filter(part=>!containsForbidden(part));
  return kept.join('').trim()||replacement;
}

function repairSlots(rawSlots,roleName='TA',{routine=null,sleepProfile=routine?.sleepProfile||'day_normal',enforceCircadian=SLEEP_PROFILES[sleepProfile].enforceCircadian,preserveSingleFullDay=false}={}){
  const config=SLEEP_PROFILES[sleepProfile];
  const list=Array.isArray(rawSlots)?rawSlots:[];
  const valid=[];
  for(const item of list){
    if(!item||typeof item!=='object')continue;
    let sMin=toMinutes(item.start),eMin=toMinutes(item.end);
    const rawAct=String(item.activity||'').trim().slice(0,200);
    if(sMin===null||eMin===null||!rawAct)continue;
    if(eMin===0&&sMin>0)eMin=24*60;
    if(eMin===24*60-1)eMin=24*60;
    if(eMin<=sMin){
      if(eMin===sMin)continue;
      valid.push({sMin,eMin:24*60,item});
      if(eMin>0)valid.push({sMin:0,eMin,item});
      continue;
    }
    valid.push({sMin,eMin,item});
  }

  if(!valid.length){
    const wMin=routine?.wakeMin??8*60,slMin=Math.min(23*60+45,routine?.sleepMin??23*60+30);
    return [
      {start:'00:00',end:fromMinutes(wMin),activity:'夜间熟睡',scene:'卧室床上',phone:'offline',restType:'night_sleep',outfitType:'sleepwear',mood:'熟睡'},
      {start:fromMinutes(wMin),end:'12:00',activity:`${roleName}上午日常忙碌`,scene:'家中或工作室',phone:'glance',restType:'none',outfitType:'outdoor',mood:'专注'},
      {start:'12:00',end:'18:00',activity:'午后继续日常安排与休息',scene:'工作室或常去的街区',phone:'free',restType:'none',outfitType:'outdoor',mood:'惬意'},
      {start:'18:00',end:fromMinutes(slMin),activity:'晚间在家放松刷手机',scene:'客厅沙发',phone:'free',restType:'none',outfitType:'home',mood:'放松'},
      {start:fromMinutes(slMin),end:'23:59',activity:'准备入睡',scene:'卧室床上',phone:'offline',restType:'night_sleep',outfitType:'sleepwear',mood:'困倦'}
    ];
  }

  if(preserveSingleFullDay&&valid.length===1&&valid[0].sMin===0&&valid[0].eMin>=23*60+58){
    const raw=valid[0].item;
    const act=containsForbidden(raw.activity)?'在街角安静处理手头的事':String(raw.activity).trim();
    const scene=containsForbidden(raw.scene||raw.location)?'常去的街角':String(raw.scene||raw.location||'日常空间').trim();
    return [{start:'00:00',end:'23:59',activity:act,scene,phone:raw.phone||'free',restType:'none',outfitType:raw.outfitType||'outdoor',mood:String(raw.mood||'轻松').slice(0,40)}];
  }

  const normalized=valid.map(({sMin,eMin,item})=>{
    let act=String(item.activity||'').trim();
    let scene=String(item.scene||item.location||'').trim();
    if(containsForbidden(act))act='在家处理自己的事';
    if(containsForbidden(scene))scene='家中';
    let restType=['night_sleep','nap','none'].includes(item.restType||item.rest_type)?(item.restType||item.rest_type):'none';
    if(restType==='none'){
      if(isNightSleepText(act))restType='night_sleep';
      else if(isNapText(act))restType='nap';
    }
    let phone=['free','glance','offline'].includes(item.phone)?item.phone:'free';
    let outfitType=['outdoor','home','sleepwear'].includes(item.outfitType||item.outfit_type)?(item.outfitType||item.outfit_type):(restType==='night_sleep'?'sleepwear':'home');
    if(restType!=='none')phone='offline';
    return {sMin,eMin,activity:act.slice(0,200),scene:scene.slice(0,200),phone,restType,outfitType,mood:String(item.mood||'平静').trim().slice(0,40)};
  }).sort((a,b)=>a.sMin-b.sMin||a.eMin-b.eMin);

  // Enforce normal human sleep-wake guardrails on 24h segments
  let guarded=[];
  for(const slot of normalized.flatMap(s=>s.restType==='nap'&&s.eMin-s.sMin>45?[{...s,eMin:s.sMin+45},{...s,sMin:s.sMin+45,activity:'结束小憩，继续日常安排',restType:'none',phone:'free'}]:[s])){
    if(!enforceCircadian){guarded.push(slot);continue;}
    let {sMin,eMin,activity,scene,phone,restType,outfitType,mood}=slot;
    // Keep long sleep outside the selected profile’s daytime activity window
    if(restType==='night_sleep'&&sMin<config.awakeEnd&&eMin>config.awakeStart){
      if(eMin-sMin<=60&&sMin>=12*60&&eMin<=15*60){
        restType='nap';outfitType='home';
        if(isNightSleepText(activity))activity='午后小憩休息';
      }else{
        restType='none';phone='free';outfitType='home';
        activity='在家放松或处理手头小事';
      }
    }
    // Split across the selected profile’s mandatory sleep window
    if(sMin<config.lockEnd&&eMin>config.lockStart){
      if(sMin<config.lockStart){
        guarded.push({sMin,eMin:config.lockStart,activity,scene,phone,restType,outfitType,mood});
      }
      guarded.push({sMin:Math.max(sMin,config.lockStart),eMin:Math.min(eMin,config.lockEnd),activity:'夜间熟睡',scene:'卧室床上',phone:'offline',restType:'night_sleep',outfitType:'sleepwear',mood:'熟睡'});
      if(eMin>config.lockEnd){
        guarded.push({sMin:config.lockEnd,eMin,activity,scene,phone,restType,outfitType,mood});
      }
    }else{
      guarded.push({sMin,eMin,activity,scene,phone,restType,outfitType,mood});
    }
  }

  // Ensure continuous non-overlapping 00:00..24:00 coverage
  guarded.sort((a,b)=>a.sMin-b.sMin);
  const continuous=[];
  let cursor=0;
  for(const seg of guarded){
    const start=Math.max(cursor,seg.sMin),end=seg.eMin;
    if(end<=start)continue;
    if(start>cursor){
      const fillSleep=enforceCircadian&&(cursor<config.lockEnd&&start<=config.lockEnd||sleepProfile==='day_normal'&&cursor>=23*60);
      continuous.push({
        sMin:cursor,eMin:start,
        activity:fillSleep?'夜间休息':'自由安排与休息',
        scene:fillSleep?'卧室':'家中',
        phone:fillSleep?'offline':'free',
        restType:fillSleep?'night_sleep':'none',
        outfitType:fillSleep?'sleepwear':'home',
        mood:'平静'
      });
    }
    continuous.push({...seg,sMin:start,eMin:end});
    cursor=end;
  }
  if(cursor<24*60){
    const nightTail=enforceCircadian&&sleepProfile==='day_normal'&&cursor>=21*60+30;
    continuous.push({
      sMin:cursor,eMin:24*60,
      activity:nightTail?'夜间入睡休息':'晚间自由放松',
      scene:nightTail?'卧室床上':'家中',
      phone:nightTail?'offline':'free',
      restType:nightTail?'night_sleep':'none',
      outfitType:nightTail?'sleepwear':'home',
      mood:'平静'
    });
  }

  // Merge adjacent identical slots without dropping distinct scene, phone status or mood
  const merged=[];
  for(const seg of continuous){
    const prev=merged.at(-1);
    if(prev&&prev.activity===seg.activity&&prev.scene===seg.scene&&prev.phone===seg.phone&&prev.restType===seg.restType&&prev.outfitType===seg.outfitType&&prev.mood===seg.mood&&prev.eMin===seg.sMin){
      prev.eMin=seg.eMin;
    }else merged.push(seg);
  }
  return merged.map(seg=>({
    start:fromMinutes(seg.sMin),
    end:seg.eMin>=24*60?'23:59':fromMinutes(seg.eMin),
    activity:seg.activity,
    scene:seg.scene,
    phone:seg.phone,
    restType:seg.restType,
    outfitType:seg.outfitType,
    mood:seg.mood
  }));
}

function temperatureSafe(description,weather){
  const text=String(description||'');
  const low=weather?.tempMin,high=weather?.tempMax;
  if(typeof low==='number'&&low<10&&COLD_INCOMPATIBLE.some(t=>text.includes(t)))return false;
  if(typeof high==='number'&&high>=30&&HOT_INCOMPATIBLE.some(t=>text.includes(t)))return false;
  return true;
}

function selectWardrobeOutfits(wardrobe=[],weather={},recentIds=new Set(),dayKey='',rng=Math.random){
  const season=seasonForDay(dayKey);
  const result={};
  for(const [kind,label]of [['outdoor','外出'],['home','居家'],['sleepwear','睡衣'],['sports','运动']]){
    const eligible=(wardrobe||[]).filter(item=>item&&item.category===label&&item.description?.trim()&&temperatureSafe(item.description,weather));
    const seasonal=eligible.filter(item=>!Array.isArray(item.seasons)||!item.seasons.length||item.seasons.includes(season));
    const fresh=seasonal.filter(item=>!recentIds.has(item.id));
    const pool=fresh.length?fresh:(seasonal.length?seasonal:eligible);
    if(pool.length){
      const picked=pool[Math.floor(rng()*pool.length)%pool.length];
      result[kind]={id:picked.id,description:picked.description,category:label,image:picked.image||'',temporary:false};
    }else if(kind!=='sports'){
      result[kind]={id:'',description:'',category:label,image:'',temporary:true};
    }
  }
  return result;
}

function weatherHttpsGet(urlStr){
  return new Promise((resolve,reject)=>{
    const req=https.get(urlStr,{timeout:8000,headers:{'User-Agent':'PipiPhone/1.0'}},res=>{
      if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error(`Weather HTTP ${res.statusCode}`));}
      const chunks=[];
      let totalSize=0;
      const MAX_SIZE=1*1024*1024;// 1MB limit
      res.on('data',c=>{
        totalSize+=c.length;
        if(totalSize>MAX_SIZE){res.destroy();reject(new Error('Weather response too large'));}
        else chunks.push(c);
      });
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}});
    });
    req.on('timeout',()=>{req.destroy();reject(new Error('Weather timeout'));});
    req.on('error',reject);
  });
}

async function resolveCityWeather(city,dayKey,cache={},personaHint=''){
  const cleanCity=String(city||'').trim();
  const season=seasonForDay(dayKey);
  const fallbackSeasonal=SEASON_WEATHER[season]||SEASON_WEATHER['春'];
  if(!cleanCity){
    return {city:'',...fallbackSeasonal,source:'seasonal'};
  }
  const cached=cache[cleanCity];
  if(cached&&cached.day===dayKey&&Date.now()-cached.fetchedAt<3*3600000){
    return cached.data;
  }
  if(process.env.ALLOW_PRIVATE_PROVIDERS==='1'){
    return {city:cleanCity,...fallbackSeasonal,source:'seasonal'};
  }
  try{
    const geo=await weatherHttpsGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=3&language=zh&format=json`);
    const match=geo?.results?.[0];
    let targetCity=cleanCity,lat=match?.latitude,lon=match?.longitude;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){
      const south=SOUTH_REGIONS.some(w=>cleanCity.includes(w)||personaHint.includes(w));
      targetCity=south?'广州':'北京';
      const fallbackGeo=await weatherHttpsGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(targetCity)}&count=1&language=zh&format=json`);
      const fb=fallbackGeo?.results?.[0];
      if(!fb)return {city:cleanCity,...fallbackSeasonal,source:'seasonal'};
      lat=fb.latitude;lon=fb.longitude;
    }
    const fc=await weatherHttpsGet(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
    const daily=fc?.daily||{};
    const data={
      city:targetCity,
      summary:WMO_ZH[fc?.current?.weather_code??daily.weather_code?.[0]]||'多云',
      temp:Number.isFinite(fc?.current?.temperature_2m)?Math.round(fc.current.temperature_2m):null,
      tempMin:Number.isFinite(daily.temperature_2m_min?.[0])?Math.round(daily.temperature_2m_min[0]):fallbackSeasonal.tempMin,
      tempMax:Number.isFinite(daily.temperature_2m_max?.[0])?Math.round(daily.temperature_2m_max[0]):fallbackSeasonal.tempMax,
      precipProb:Number.isFinite(daily.precipitation_probability_max?.[0])?Math.round(daily.precipitation_probability_max[0]):0,
      source:'open-meteo'
    };
    cache[cleanCity]={day:dayKey,fetchedAt:Date.now(),data};
    return data;
  }catch{
    return cached?.data||{city:cleanCity,...fallbackSeasonal,source:'seasonal'};
  }
}

function hasChangeTrigger(userText,replyText){
  return [userText,replyText].some(value=>String(value||'').split(/[。！？!?\n]/).some(text=>
    /约好|说好|答应|记得/.test(text)&&TIME_TRIGGER_RE.test(text)||DIRECT_CHANGE_RE.test(text)&&SCHEDULE_TRIGGER_RE.test(text)));
}

function resolveSlotOutfit(slot,outfits={},fallbackOutfit=''){
  if(!slot)return {type:'home',text:fallbackOutfit||'',image:''};
  if(slot.outfitSnapshot)return {type:slot.outfitSnapshot.type||slot.outfitType||'home',text:slot.outfitSnapshot.description||slot.outfitSnapshot.text||'',image:slot.outfitSnapshot.image||''};
  const isSport=SPORTS_WORDS.some(w=>String(slot.activity||'').includes(w));
  if(isSport&&outfits.sports?.description){
    return {type:'sports',text:outfits.sports.description,image:outfits.sports.image||''};
  }
  const kind=slot.restType==='night_sleep'?'sleepwear':(slot.outfitType||'home');
  const picked=outfits[kind];
  if(picked?.description)return {type:kind,text:picked.description,image:picked.image||''};
  return {type:kind,text:outfits.outdoor?.description||fallbackOutfit||'',image:outfits.outdoor?.image||''};
}

function promptWeather(weather){
  // Keep stored labels for the UI; prompts get no failure text and a natural seasonal summary.
  if(!weather?.summary||weather.source==='unavailable')return '';
  return weather.source==='seasonal'&&!weather.aiSimulated&&String(weather.summary).includes('模拟')?(SEASON_WEATHER[seasonForDay(weather.day)]||SEASON_WEATHER['春']).summary:weather.summary;
}

function buildLifeInjection({nowHm,nowLabel,dayKey,weather,currentSlot,nextSlots,outfits,fallbackOutfit,daySummary,promises=[],recentChanges=[]}){
  const essential=[`现在：${nowLabel}（${dayKey}）`];
  const weatherText=promptWeather(weather);
  if(weatherText){
    const tempPart=weather.temp!==undefined&&weather.temp!==null?`${weather.temp}℃`:`${weather.tempMin??''}~${weather.tempMax??''}℃`;
    essential.push(`天气：${weather.city?weather.city+' ':''}${weatherText} ${tempPart}`);
  }
  const phone=currentSlot?.restType&&currentSlot.restType!=='none'?'offline':(currentSlot?.phone||'free');
  if(currentSlot){
    essential.push(`正在做：${currentSlot.start}—${currentSlot.end} ${currentSlot.scene?currentSlot.scene+' ':''}${currentSlot.activity}${currentSlot.mood?'；心情：'+currentSlot.mood:''}`);
    if(phone!=='free')essential.push('此刻本来不太方便一直看手机，不过你刚好看到了对方的消息。');
  }
  const details=[];
  const activeOutfit=resolveSlotOutfit(currentSlot,outfits,fallbackOutfit);
  if(activeOutfit.text)details.push(`当前穿着：${activeOutfit.text.slice(0,90)}`);
  if(nextSlots?.length){
    details.push('接下来：'+nextSlots.slice(0,2).map(s=>`${s.start} ${s.activity.slice(0,22)}`).join('；'));
  }
  if(daySummary)details.push(`今日概况：${daySummary.slice(0,45)}`);

  const lines=[...essential];
  const fits=line=>lines.join('\n').length+line.length+1<=LIFE_BUDGET;
  const missed=promises.filter(p=>p.status==='missed'),pending=promises.filter(p=>p.status==='pending');
  for(const p of missed){
    const line=`和对方的约定（已失约需自然解释原因）：${p.content.slice(0,60)}${p.note?'；原因：'+p.note.slice(0,40):''}`;
    if(fits(line))lines.push(line);
  }
  for(const p of pending){
    const line=`待履行的约定：${p.content.slice(0,60)}${p.dueHm?'（约 '+p.dueHm+'）':''}`;
    if(fits(line))lines.push(line);
  }
  for(const d of details)if(fits(d))lines.push(d);
  for(const ch of (recentChanges||[]).slice(-2)){
    const line=`刚发生的变化：${String(ch.description||'').slice(0,50)}`;
    if(fits(line))lines.push(line);
  }
  const phoneDesc={free:'随时可以看手机',glance:'忙碌中偶尔看一眼手机',offline:'本来不看手机'}[phone]||'正常';
  return `<character_life>\n${lines.join('\n')}\n</character_life>\n${buildOnlineRules(phoneDesc)}`;
}

function buildOnlineRules(phoneDesc='正常线上聊天'){
  return `<life_rules>\n这是严格的纯线上网恋/好友关系，你与用户不在同一座城市或同一空间：严禁把“线下见面、去对方家里、同居、面对面拥抱亲吻或实时语音/视频通话”当作现实发生或约入未来日程；所有互动均通过线上聊天、发语音条、发照片与朋友圈完成。你此刻看手机状态是「${phoneDesc}」。禁止说教式提醒作息，不要生硬报菜单式背日程。\n</life_rules>`;
}

module.exports={
  SLEEP_PROFILES,
  SPORTS_WORDS,MEAL_RE,FORBIDDEN_RE,
  seasonForDay,toMinutes,fromMinutes,computeRoutine,containsForbidden,sanitizeForbiddenText,
  repairSlots,temperatureSafe,selectWardrobeOutfits,resolveCityWeather,hasChangeTrigger,
  resolveSlotOutfit,buildLifeInjection,buildOnlineRules,promptWeather
};
