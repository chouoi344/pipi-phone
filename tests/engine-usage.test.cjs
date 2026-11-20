// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const U=require('../lib/engine/usage.cjs'),M=require('../lib/engine/models.cjs'),P=require('../lib/providers.cjs');
const row=(at,extra={})=>({at:Date.parse(at),modelId:'m',model:'test-model',purpose:'chat',inputTokens:10,outputTokens:5,estimated:false,success:true,...extra});
const state=rows=>({engine:{usage:rows},settings:{timezone:'America/Los_Angeles',ai:{models:[{id:'m',sourceId:'source'}],sources:[{id:'source',name:'隔离服务',key:'PRIVATE_KEY',baseUrl:'https://private.example'}]}}});
test('local-day ranges include today and fixed seven-day trend across DST',()=>{
  const s=state([row('2026-11-01T06:59:59Z'),row('2026-11-01T07:00:00Z'),row('2026-11-02T07:59:59Z'),row('2026-11-02T08:00:00Z')]);
  const report=U.report(s,{range:'1',now:Date.parse('2026-11-02T08:30:00Z')});
  assert.equal(report.summary.count,1);assert.equal(report.trend.length,7);assert.equal(report.trend.at(-2).date,'2026-11-01');assert.equal(report.trend.at(-2).count,2);
  assert.equal(U.report(s,{range:'7',now:Date.parse('2026-11-02T08:30:00Z')}).summary.count,4);
  assert.throws(()=>U.report(s,{range:'bad'}),/时间范围/);
});
test('old rows have unknown duration/error; API exposes only display data and caps logs',()=>{
  const s=state(Array.from({length:502},(_,i)=>row('2026-11-17T12:00:00Z',{at:Date.parse('2026-11-17T12:00:00Z')+i,success:false})));
  const result=U.report(s,{now:Date.parse('2026-11-17T13:00:00Z')});
  assert.equal(result.logs.total,502);assert.equal(result.logs.items.length,500);assert.equal(result.logs.truncated,true);
  assert.equal(result.logs.items[0].durationMs,null);assert.equal(result.logs.items[0].error,null);assert.equal(result.logs.items[0].sourceName,'隔离服务');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_KEY'));assert.ok(!JSON.stringify(result).includes('private.example'));
});
test('retention removes detail without decreasing persisted total or model total',()=>{
  const old=row('2026-01-01T00:00:00Z'),s=state([old]);
  const idle=U.report(s,{now:Date.parse('2026-11-17T12:00:00Z')});
  assert.equal(idle.summary.count,1);assert.equal(idle.logs.total,0);assert.deepEqual(idle.logs.items,[]);assert.equal(s.engine.usage.length,1);
  U.ensure(s);
  U.record(s,row('2026-11-17T12:00:00Z'),Date.parse('2026-11-17T12:00:00Z'));
  assert.equal(s.engine.usage.length,1);
  const restored=JSON.parse(JSON.stringify(s));U.ensure(restored);
  const report=U.report(restored,{now:Date.parse('2026-11-17T13:00:00Z')});
  assert.equal(report.summary.count,2);assert.equal(report.models[0].totalTokens,30);assert.equal(report.totalMeta.since,old.at);
  assert.equal(U.report(restored,{range:'30',now:Date.parse('2026-11-17T13:00:00Z')}).summary.count,1);
});
test('new records retain elapsed time and classify failure without raw message or payload',()=>{
  const error=Object.assign(new Error('PRIVATE_KEY user secret content'),{code:'PROVIDER_HTTP',upstreamStatus:401,rawBody:'private body'});
  const usage=M.usageRecord({id:'m',model:'x',sourceName:'隔离服务'},'chat','private prompt',null,{success:false,error,durationMs:25});
  assert.equal(usage.durationMs,25);assert.equal(usage.error,'模型服务请求失败（HTTP 401）');assert.ok(!JSON.stringify(usage).includes('PRIVATE_KEY'));assert.ok(!JSON.stringify(usage).includes('private prompt'));
  assert.equal(U.safeError(Object.assign(new Error('secret'),{name:'AbortError'})),'请求已取消');
});
test('usage exposes bounded redacted upstream error details only',()=>{
  const upstream='颜色参数不支持 key-for-test；Authorization: Bearer short-token; '+ '字'.repeat(150);
  const error={upstreamStatus:400,rawBody:JSON.stringify({error:{message:upstream},metadata:'private-metadata'})};
  const record=M.usageRecord({id:'m',model:'x',key:'key-for-test'},'chat','private prompt',null,{success:false,error,durationMs:20});
  assert.match(record.error,/HTTP 400.*颜色参数不支持/);
  assert.doesNotMatch(record.error,/key-for-test|short-token|private-metadata/);
  assert.equal(Array.from(record.error.split(' · ')[1]).length,120);
  assert.equal(U.displayError(record.error),record.error);
});
test('provider output validation reports failure once after HTTP success, success remains true',async t=>{
  let response={unexpected:'PRIVATE_CONTENT'};
  const http=require('node:http'),server=http.createServer((req,res)=>{req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  t.after(async()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const s={settings:{ai:{sources:[{id:'s',name:'隔离服务',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',key:'key'}],models:[{id:'m',sourceId:'s',model:'m',kind:'stt',protocol:'transcription',extraBody:{}}],assign:{stt:'m'}}},roles:[]};
  const records=[],sample='data:audio/wav;base64,UklGRg==';
  await assert.rejects(P.transcribe(s,sample,{onUsage:r=>records.push(r)}),/有效转写/);
  assert.equal(records.length,1);assert.equal(records[0].success,false);assert.equal(records[0].error,'模型返回格式无效');assert.ok(records[0].durationMs>=0);
  response={text:'hello'};assert.equal(await P.transcribe(s,sample,{onUsage:r=>records.push(r)}),'hello');assert.equal(records.length,2);assert.equal(records[1].success,true);
});

test('backup restores cumulative totals and safe new log fields; old backups get baseline',()=>{
  const S=require('../lib/state.cjs'),s=sampleState(),now=Date.now();
  U.record(s,row(new Date(now).toISOString(),{sourceName:'隔离服务',durationMs:18,success:false,error:'请求超时'}),now);
  const restore=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(s)},s);
  assert.deepEqual(restore.engine.usageTotals,s.engine.usageTotals);assert.equal(restore.engine.usage[0].durationMs,18);assert.equal(restore.engine.usage[0].error,'请求超时');
  const old=S.backupState(s);delete old.engine.usageTotals;
  assert.equal(S.validateBackup({format:'pipi-phone',version:1,state:old},s).engine.usageTotals.summary.count,1);
  assert.equal(U.displayError('PRIVATE_KEY response body'),null);
});

test('runtime unified usage entry persists cumulative counts after detailed cleanup',async()=>{
  const S=require('../lib/state.cjs'),Runtime=require('../lib/engine/runtime.cjs');let s=sampleState();
  delete s.engine.usageTotals;s.engine.usage=[row('2026-01-01T00:00:00Z')];
  const runtime=Runtime.create({getState:()=>structuredClone(s),mutate:fn=>{const value=fn(s);return {state:s,value};},now:()=>Date.parse('2026-11-17T12:00:00Z')});
  try{runtime.onUsage(row('2026-11-17T12:00:00Z'));assert.equal(s.engine.usage.length,1);assert.equal(s.engine.usageTotals.summary.count,2);}finally{await runtime.close();}
});
test('native and chat decision calls log success or safe parse failure with duration',async t=>{
  const S=require('../lib/state.cjs'),Decision=require('../lib/engine/system-one.cjs'),s=sampleState();
  s.settings.ai.sources.push({id:'s',name:'隔离服务',baseUrl:'https://isolated.example',key:'PRIVATE_KEY'});
  s.settings.ai.models.push({id:'d',sourceId:'s',model:'jev-test',kind:'decision',protocol:'system-one',extraBody:{}});s.settings.ai.assign.decision='d';
  let data={answers:{complete:{probability:0.9}}};t.mock.method(P,'request',async()=>data);
  const records=[],opts={text:'private user content',onUsage:r=>records.push(r)};
  assert.equal((await Decision.evaluateCompleteness(s,opts)).complete,true);assert.equal(records[0].success,true);
  data={answers:{complete:{probability:'private malformed'}}};await assert.rejects(Decision.evaluateCompleteness(s,opts));assert.equal(records[1].success,false);assert.equal(records[1].error,'模型返回格式无效');
  s.settings.ai.models.at(-1).protocol='chat';data={choices:[{message:{content:'{"probability":0.9}'}}]};
  await Decision.evaluateCompleteness(s,opts);assert.equal(records[2].success,true);
  data={choices:[{message:{content:'private malformed'}}]};await assert.rejects(Decision.evaluateCompleteness(s,opts));assert.equal(records[3].success,false);
  assert.equal(records.length,4);assert.ok(records.every(row=>row.durationMs>=0));assert.ok(!JSON.stringify(records).includes('private'));assert.ok(!JSON.stringify(records).includes('PRIVATE_KEY'));
});
