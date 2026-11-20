'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../lib/engine/schedule-weather.cjs'),D=require('../lib/engine/schedule-wardrobe.cjs');
const day='2026-11-17',now=Date.parse(day+'T09:00:00Z');
function request(log,{rain=20,temp=18}={}){return async url=>{log.push(url);if(url.includes('geocoding'))return {results:[{name:'北京',latitude:39.9,longitude:116.4}]};return {current:{time:day+'T09:00',temperature_2m:temp,weather_code:0},daily:{time:[day,'2026-11-18'],temperature_2m_min:[8,7],temperature_2m_max:[20,18],precipitation_probability_max:[rain,20],weather_code:[0,1]},hourly:{time:[day+'T09:00',day+'T13:00','2026-11-18T09:00'],temperature_2m:[temp,20,18],weather_code:[0,1,1],precipitation_probability:[rain,10,20]}};};}
test('天气缓存返回当前小时，不修改输入缓存；强制刷新使用坐标并报告显著变化',async()=>{
  const log=[],cache={};let value=await W.resolveCityWeather('北京',day,cache,'',{now,requestJson:request(log)});
  assert.equal(value.hourly.length,3);assert.equal(value.source,'open-meteo');assert.deepEqual(cache,{});
  cache[value.cacheEntry.key]=value.cacheEntry.entry;
  value=await W.resolveCityWeather('北京',day,cache,'',{now:now+1000,requestJson:()=>{throw Error('不应请求');},localTime:day+'T13:00'});
  assert.equal(value.source,'cache');assert.equal(value.temp,20);assert.equal(value.cacheEntry,null);
  value=await W.resolveCityWeather('北京',day,cache,'',{now:now+2000,force:true,requestJson:request(log,{rain:80,temp:10})});
  assert.equal(value.significantChange,true);assert.equal(log.filter(x=>x.includes('geocoding')).length,1);
});
test('同城失败保留旧天气并冷却；换城市失败不借用旧城市',async()=>{
  const old=await W.resolveCityWeather('北京',day,{},'',{now,requestJson:request([])}),cache={北京:old.cacheEntry.entry};
  const stale=await W.resolveCityWeather('北京',day,cache,'',{now:now+4*3600000,requestJson:async()=>{throw Error('网络失败');}});
  assert.equal(stale.stale,true);assert.equal(stale.temp,20);assert.equal(stale.source,'cache');
  const other=await W.resolveCityWeather('广州',day,cache,'',{now,requestJson:async()=>{throw Error('网络失败');}});
  assert.equal(other.source,'unavailable');assert.equal(other.temp,null);assert.equal(other.city,'广州');
});
test('城市中文变体与南方参考明确标记；关闭天气无请求',async()=>{
  const log=[];const value=await W.resolveCityWeather('广东省虚构市',day,{},'',{now,requestJson:async url=>url.includes('geocoding')?{results:[]}:request(log)(url)});
  assert.equal(value.city,'广州');assert.equal(value.fallbackFrom,'广东省虚构市');assert.equal(value.requestedCity,'广东省虚构市');
  const off=await W.resolveCityWeather('北京',day,{},'',{enabled:false,now,requestJson:()=>assert.fail()});assert.equal(off.source,'seasonal');
});
test('衣柜稳定编辑、去重、不截断；历史快照与选择独立',()=>{
  let items=Array.from({length:81},(_,i)=>({id:'w'+i,description:'长袖'+i,category:'外出',seasons:['秋'],image:''}));
  const old=structuredClone(items[0]),snapshot=D.selectWardrobeOutfits(items,{tempMin:12,tempMax:20},new Set(),day,()=>0);
  const added=D.upsertItem(items,{description:'新增大衣',category:'外出',seasons:['冬']});assert.equal(added.items.length,82);
  const edited=D.upsertItem(items,{id:'w0',description:'编辑后的长袖'});assert.equal(edited.item.id,'w0');assert.deepEqual(items[0],old);assert.equal(snapshot.outdoor.description,'长袖0');
  assert.equal(D.upsertItem(items,{description:' 长袖0 ',category:'外出'}).duplicate,true);
  assert.equal(D.removeItem(items,'w0').length,80);assert.equal(snapshot.outdoor.id,'w0');
  const selected=D.selectWardrobeOutfits(items,{tempMin:12,tempMax:20},new Set(['w0']),day,()=>0);assert.equal(selected.outdoor.id,'w1');
});
test('衣服图片拒绝外部路径、GIF和假图片，不落原始dataURI',t=>{
  for(const image of ['C:\\private.png','https://example.org/image.png','data:image/gif;base64,R0lGODlh','data:image/png;base64,YWJj'])assert.throws(()=>D.normalizeImage(image,{dataDir:'unused'}));
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Media=require('../lib/media-store.cjs');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-wardrobe-image-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const image=Media.saveImage(dataDir,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=');
  assert.equal(D.normalizeImage(image,{dataDir}),image);assert.throws(()=>D.normalizeImage('/api/media/'+'a'.repeat(64)+'.png',{dataDir}),/无法读取/);
});
test('衣柜优先使用指定图片转述模型，返回待确认草稿且不改聊天模型',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),M=require('../lib/engine/models.cjs');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-wardrobe-isolated-'));
  const s={settings:{},roles:[],engine:{data:{schedule:{wardrobes:{}}}}};M.migrate(s);
  s.settings.ai.sources.push({id:'isolated',name:'隔离',baseUrl:'https://example.invalid/v1',key:'ISOLATED_TEST_ONLY'});
  s.settings.ai.models=[{id:'text',sourceId:'isolated',model:'text',kind:'chat',capabilities:['text']},{id:'vision',sourceId:'isolated',model:'vision',kind:'chat',capabilities:['text','image']}];
  Object.assign(s.settings.ai.assign,{chat:'text',caption:'vision',chatFallbacks:[]});
  const before=structuredClone(s.engine),dataUri='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';
  const draft=await D.identifyImage(s,{dataUri,dataDir,call:async(state,options)=>{
    assert.equal(state.settings.ai.assign.chat,'text');
    assert.equal(options.purpose,'caption');
    assert.equal(M.resolve(state,options.purpose).id,'vision');
    assert.match(options.messages[0].content,/不要描述或推断脸/);
    assert.throws(()=>options.validateResponse({content:'{"description":"衣服"}'}),{code:'PROVIDER_RESPONSE'});
    const message={content:JSON.stringify({description:'白色长袖衬衫与蓝色长裤',category:'外出',seasons:['春','秋']})};
    return {message,parsed:options.validateResponse(message)};
  }});
  assert.equal(draft.description,'白色长袖衬衫与蓝色长裤');assert.match(draft.image,/^\/api\/media\/[a-f0-9]+\.png$/);assert.deepEqual(s.engine,before);assert.equal(JSON.stringify(s).includes(dataUri),false);
});
test('衣服模型字段校验错误与用户图片入口错误区分',async()=>{
  for(const content of ['无JSON','[]','{"description":"衣服","category":"外出","seasons":["未知"]}'])assert.throws(()=>D.parseIdentifiedClothing({content}),{status:502,code:'PROVIDER_RESPONSE'});
  await assert.rejects(D.identifyImage({}, {dataUri:'data:image/png;base64,YWJj'}),{status:400,code:'VALIDATION'});
});
test('近期实际穿搭排除未使用的日计划并按描述避重',()=>{
  const recent=D.recentActualOutfits([{day:'2026-11-16',actual:[{outfitType:'home'}],outfits:{home:{id:'w-home',description:'棉质家居服'},outdoor:{id:'unused',description:'未穿外套'}}}],day);
  assert.equal(recent.ids.has('w-home'),true);assert.equal(recent.ids.has('unused'),false);
  const outfits=D.selectWardrobeOutfits([{id:'changed-id',description:'棉质 家居服',category:'居家'},{id:'fresh',description:'针织套装',category:'居家'}],{},recent,day,()=>0);
  assert.equal(outfits.home.id,'fresh');
});
test('已有衣柜媒体图片重新识别发送dataURI并保留原媒体URL',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),M=require('../lib/engine/models.cjs'),Media=require('../lib/media-store.cjs');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-wardrobe-existing-isolated-'));
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',image=Media.saveImage(dataDir,png);
  const s={settings:{},roles:[]};M.migrate(s);
  s.settings.ai.sources.push({id:'isolated',name:'隔离',baseUrl:'https://example.invalid/v1',key:'ISOLATED_TEST_ONLY'});
  s.settings.ai.models=[{id:'vision',sourceId:'isolated',model:'vision',kind:'chat',capabilities:['text','image']}];s.settings.ai.assign.chat='vision';
  await assert.rejects(D.identifyImage(s,{dataUri:image,dataDir,call:()=>assert.fail('未选择图片转述时不能调用模型')}),{code:'PROVIDER_UNCONFIGURED'});
  s.settings.ai.assign.caption='vision';
  const before=JSON.stringify(s),draft=await D.identifyImage(s,{dataUri:image,dataDir,call:async(state,options)=>{
    assert.equal(options.messages[1].content[0].image_url.url,png);
    const message={content:JSON.stringify({description:'白色衬衫',category:'外出',seasons:['春']})};return {message,parsed:options.validateResponse(message)};
  }});
  assert.equal(draft.image,image);assert.equal(JSON.stringify(s),before);
  await assert.rejects(D.identifyImage(s,{dataUri:'/api/media/'+'b'.repeat(64)+'.png',dataDir}),{code:'VALIDATION'});
  await assert.rejects(D.identifyImage(s,{dataUri:'https://example.invalid/image.png',dataDir}),{code:'VALIDATION'});
});
