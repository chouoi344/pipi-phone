// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const M=require('../lib/engine/models.cjs'),P=require('../lib/providers.cjs');
const SECRET='ISOLATED_MODEL_TEST_KEY';
const VALID_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwCsj7DwADmAHwphbYCgAAAABJRU5ErkJggg==';
process.env.ALLOW_PRIVATE_PROVIDERS='1';
test.beforeEach(t=>{t.mock.method(require('node:timers/promises'),'setTimeout',async()=>{});});
test.beforeEach(t=>t.mock.method(globalThis,'fetch',async url=>{
  assert.ok(['https://models.dev/api.json','https://models.opencode.ai/api.json'].includes(url));
  return {ok:true,json:async()=>({isolated:{models:{placeholder:{id:'isolated-placeholder'},main:{id:'auto-capacity-main',limit:{context:1500}},backup:{id:'auto-capacity-backup',limit:{context:700}}}}})};
}));
function state(){return {settings:{preset:{label:'原服务',baseUrl:'https://old.example/v1',model:'old-chat'},providers:{}},roles:[]};}
function model(id,sourceId='custom',overrides={}){return {id,sourceId,model:id,kind:'chat',capabilities:['text'],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{},voice:'alloy',...overrides};}
function configured(url,entries=[model('main'),model('backup')]){
  const s=state();M.migrate(s);
  M.save(s,{sources:[...M.sanitize(s.settings.ai).sources,{id:'custom',name:'隔离测试',baseUrl:url,key:SECRET,builtin:false}],models:entries,assign:{chat:'main',chatFallbacks:entries.some(x=>x.id==='backup')?['backup']:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''}});
  return s;
}
async function server(t,handler){
  const requests=[],s=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks).toString();const request={url:req.url,headers:req.headers,raw:body,body:req.headers['content-type']?.includes('application/json')?JSON.parse(body):null};requests.push(request);
    res.setHeader('Content-Type','application/json');handler(request,res,requests);
  });
  await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);}));
  return {url:'http://127.0.0.1:'+s.address().port+'/v1',requests};
}
function answer(res,content='隔离服务回复',usage){res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}],...(usage?{usage}:{})}));}

test('首个请求送出后撤销资料权限，同模型重试和回退均不再向接口发送旧正文',async t=>{
  for(const path of ['retry','fallback']){
    let revoked=false,checks=0;
    const mock=await server(t,(_req,res)=>{
      revoked=true;
      if(path==='retry'){res.statusCode=503;res.end('{}');}else answer(res);
    });
    await assert.rejects(M.call(configured(mock.url),{messages:[{role:'user',content:'隔离旧草稿'}],
      beforeRequest(){checks++;if(revoked)throw Object.assign(Error('资料权限已撤销'),{code:'MOMENT_MEMORY_CHANGED'});},
      validateResponse(){throw Object.assign(Error('演示无效返回，改试回退'),{code:'PROVIDER_RESPONSE'});}
    }),{code:'MOMENT_MEMORY_CHANGED'});
    assert.equal(checks,2);assert.deepEqual(mock.requests.map(r=>r.body.model),['main']);
  }
});

test('model defaults follow the provider protocol and explicit saved timeouts take precedence',()=>{
  const s=state(),initial=M.migrate(s);
  const sources=[...M.sanitize(initial).sources,{id:'custom',name:'隔离测试',baseUrl:'https://model.example/v1',key:SECRET,builtin:false}];
  const entries=[['chat','gpt-4.1-mini','chat','auto',120],['mimo','mimo-v2.5-asr','stt','auto',20],['whisper','whisper-1','stt','transcription',600],['omni','qwen3.8-omni-flash','stt','auto',45],['speech','tts-1','tts','auto',20],['minimax','speech-2.8-hd','tts','minimax',60],['breeze','breeze-tts-2','tts','auto',45],['photo','image-test','image','auto',120],['judge','jev-latest','decision','auto',5],['embed','embedding-test','embedding','auto',20],['rerank','reranker-test','rerank','auto',20]];
  const models=entries.map(([id,name,kind,protocol])=>model(id,'custom',{model:name,kind,protocol,timeoutSeconds:null}));
  const first=M.save(s,{sources,models,assign:initial.assign});
  for(const [id,,kind,,seconds] of entries){
    const saved=first.models.find(entry=>entry.id===id);
    assert.equal(saved.timeoutSeconds,kind==='image'?null:seconds,id);
    assert.equal(M.resolve(s,kind,{modelId:id}).timeoutSeconds,seconds,id);
  }
  const config=M.sanitize(first),judge=config.models.find(entry=>entry.id==='judge');
  judge.timeoutSeconds=7;M.save(s,config);
  delete judge.timeoutSeconds;M.save(s,config);
  assert.equal(M.resolve(s,'decision',{modelId:'judge'}).timeoutSeconds,7);
  judge.timeoutSeconds=null;M.save(s,config);
  assert.equal(M.resolve(s,'decision',{modelId:'judge'}).timeoutSeconds,5);
  delete s.settings.ai.models.find(entry=>entry.id==='judge').timeoutSeconds;
  assert.equal(M.resolve(s,'decision',{modelId:'judge'}).timeoutSeconds,5);
  const photo=config.models.find(entry=>entry.id==='photo');
  photo.timeoutSeconds=45;M.save(s,config);
  assert.equal(M.resolve(s,'image',{modelId:'photo'}).timeoutSeconds,45);
  M.migrate(s);
  assert.equal(M.resolve(s,'image',{modelId:'photo'}).timeoutSeconds,45);
  delete s.settings.ai.imageTimeoutDefault;
  M.migrate(s);
  assert.equal(M.resolve(s,'image',{modelId:'photo'}).timeoutSeconds,120);
  photo.timeoutSeconds=95;M.save(s,config);
  delete s.settings.ai.imageTimeoutDefault;
  M.migrate(s);
  assert.equal(M.resolve(s,'image',{modelId:'photo'}).timeoutSeconds,95);
  photo.timeoutSeconds=null;M.save(s,config);
  assert.equal(M.sanitize(s.settings.ai).models.find(entry=>entry.id==='photo').timeoutSeconds,null);
  assert.equal(M.resolve(s,'image',{modelId:'photo'}).timeoutSeconds,120);
});

test('migration preserves every legacy address/key pair and vision maps to caption',()=>{
  const s=state();s.settings.providers={chat:{mode:'preset',key:'CHAT'},vision:{mode:'preset',key:'VISION',model:'vision'},tts:{mode:'custom',baseUrl:'https://voice.example/v1',model:'tts',key:'VOICE',voice:'warm'},stt:{mode:'custom',baseUrl:'https://voice.example/v1',model:'stt',key:'VOICE'}};
  M.migrate(s);const ai=s.settings.ai;
  assert.equal(ai.sources[0].id,'pipi');assert.equal(ai.models.length,4);assert.equal(ai.assign.caption,'legacy-vision');
  for(const [purpose,key,url]of [['chat','CHAT','https://old.example/v1'],['caption','VISION','https://old.example/v1'],['tts','VOICE','https://voice.example/v1'],['stt','VOICE','https://voice.example/v1']]){
    const c=M.resolve(s,purpose);assert.equal(c.key,key);assert.equal(c.baseUrl,url);
  }
  const before=JSON.stringify(ai);M.migrate(s);assert.equal(JSON.stringify(s.settings.ai),before);
});
test('an alternate builtin address changes only at runtime and never receives the original key',()=>{
  const s=state();M.migrate(s);assert.equal(s.settings.ai.models.length,0);
  const input=M.sanitize(s.settings.ai),first=input.sources[0];
  first.key='ORIGINAL';
  input.models=[model('main','pipi')];input.assign.chat='main';input.assign.chatSelections=['main'];
  const before=process.env.PIPI_SOURCE_URL;
  try{
    delete process.env.PIPI_SOURCE_URL;
    M.save(s,input);
    const originalUrl=M.resolve(s).baseUrl;
    process.env.PIPI_SOURCE_URL='https://changed.example/v1/';
    M.migrate(s);
    assert.equal(s.settings.ai.sources[0].baseUrl,originalUrl);
    assert.equal(s.settings.ai.sources[0].key,'ORIGINAL');
    assert.deepEqual(M.sanitize(s.settings.ai).sources[0].keySet,false);
    assert.throws(()=>M.resolve(s),{code:'PROVIDER_UNCONFIGURED'});
    const changed=M.sanitize(s.settings.ai);
    changed.sources[0].key='FOR_OVERRIDE';
    M.save(s,changed);
    assert.equal(M.resolve(s).baseUrl,'https://changed.example/v1');
    assert.equal(M.resolve(s).key,'FOR_OVERRIDE');
    assert.equal(M.sanitize(s.settings.ai,{runtime:false}).sources[0].baseUrl,originalUrl);
    assert.doesNotMatch(JSON.stringify(M.sanitize(s.settings.ai)),/FOR_OVERRIDE|overrideKey/);
    assert.doesNotMatch(JSON.stringify(s.settings.ai),/changed\.example/);
    process.env.PIPI_SOURCE_URL='https://different.example/v1';
    assert.throws(()=>M.resolve(s),{code:'PROVIDER_UNCONFIGURED'});
    delete process.env.PIPI_SOURCE_URL;
    assert.equal(M.resolve(s).baseUrl,originalUrl);
    assert.equal(M.resolve(s).key,'ORIGINAL');
  }
  finally{if(before===undefined)delete process.env.PIPI_SOURCE_URL;else process.env.PIPI_SOURCE_URL=before;}
});
test('sanitized configuration has no source key and keeps keySet',()=>{
  const s=configured('https://model.example/v1'),out=M.sanitize(s.settings.ai);
  assert.equal(JSON.stringify(out).includes(SECRET),false);assert.equal(out.sources.find(x=>x.id==='custom').keySet,true);assert.equal('key'in out.sources[0],false);assert.equal(s.settings.ai.sources.find(x=>x.id==='custom').key,SECRET);
});
test('save validates references, builtin immutability and input atomically',()=>{
  const s=configured('https://model.example/v1'),before=JSON.stringify(s.settings.ai);
  const corruptions=[x=>x.sources.shift(),x=>x.sources[0].baseUrl='https://fake.example',x=>x.models.push(x.models[0]),x=>x.models[0].sourceId='missing',x=>x.assign.chat='missing',x=>x.models[0].temperature=8,x=>x.models[0].extraBody='[]',x=>x.sources.find(s=>s.id==='custom').key='bad\r\nkey',x=>x.models[0].capabilities=['text','unknown'],x=>x.assign.caption='main'];
  for(const mutate of corruptions){const input=M.sanitize(s.settings.ai);mutate(input);assert.throws(()=>M.save(s,input));assert.equal(JSON.stringify(s.settings.ai),before);}
  const input=M.sanitize(s.settings.ai);input.sources[0].key='NEW_KEY';M.save(s,input);
  assert.equal(s.settings.ai.sources[0].key,'NEW_KEY');
});
test('blank key retains saved key; changing custom URL clears the old destination credential',()=>{
  const s=configured('https://model.example/v1'),input=M.sanitize(s.settings.ai);input.sources.find(x=>x.id==='custom').key='';M.save(s,input);assert.equal(s.settings.ai.sources.find(x=>x.id==='custom').key,SECRET);
  input.sources.find(x=>x.id==='custom').baseUrl='https://different.example/v1';M.save(s,input);assert.equal(s.settings.ai.sources.find(x=>x.id==='custom').key,'');
});
test('deleting a builtin source clears both keys and only its model references; the preset can be configured again',t=>{
  const previous=process.env.PIPI_SOURCE_URL;
  t.after(()=>{if(previous===undefined)delete process.env.PIPI_SOURCE_URL;else process.env.PIPI_SOURCE_URL=previous;});
  delete process.env.PIPI_SOURCE_URL;
  const s=configured('https://model.example/v1',[model('main','custom',{capabilities:['text','image']}),model('backup')]);
  const input=M.sanitize(s.settings.ai);
  input.sources.find(source=>source.id==='pipi').key='ISOLATED_BASE_KEY';
  input.sources.find(source=>source.id==='pipi-voice').key='ISOLATED_VOICE_KEY';
  input.models.push(model('station-main','pipi'),model('station-backup','pipi'),model('station-voice','pipi-voice',{kind:'tts',capabilities:[]}));
  Object.assign(input.assign,{chat:'station-main',compress:'station-main',caption:'main',tts:'station-voice',chatSelections:['station-main','main'],chatFallbacks:['backup','station-backup','main']});
  M.save(s,input);

  process.env.PIPI_SOURCE_URL='https://override.example/v1';
  const override=M.sanitize(s.settings.ai);
  override.sources.find(source=>source.id==='pipi').key='ISOLATED_OVERRIDE_KEY';
  M.save(s,override);
  assert.equal(M.resolve(s).key,'ISOLATED_OVERRIDE_KEY');
  const before=structuredClone(s.settings.ai);
  M.removeSource(s,'pipi');
  const deleted=s.settings.ai;
  const {overrideKey,...preset}=before.sources.find(source=>source.id==='pipi');
  assert.equal(overrideKey.key,'ISOLATED_OVERRIDE_KEY');
  const cleared=deleted.sources.find(source=>source.id==='pipi');
  assert.notEqual(cleared.keyRevision,preset.keyRevision);
  assert.deepEqual(deleted.sources,before.sources.map(source=>source.id==='pipi'?{...preset,key:'',keyRevision:cleared.keyRevision}:source));
  assert.deepEqual(deleted.models,before.models.filter(item=>item.sourceId!=='pipi'));
  assert.deepEqual(deleted.assign,{...before.assign,chat:'',compress:'',chatFallbacks:['backup','main'],chatSelections:['main']});
  assert.equal(M.sanitize(deleted).sources.find(source=>source.id==='pipi').keySet,false);

  delete process.env.PIPI_SOURCE_URL;
  assert.equal(M.sanitize(deleted).sources.find(source=>source.id==='pipi').keySet,false);
  const reconfigured=M.sanitize(deleted);
  reconfigured.sources.find(source=>source.id==='pipi').key='ISOLATED_RECONFIGURED_KEY';
  const restored=M.save(s,reconfigured,{stationPreset:true});
  assert.equal(restored.models.filter(item=>item.sourceId==='pipi').length,4);
  assert.equal(restored.sources.find(source=>source.id==='pipi').key,'ISOLATED_RECONFIGURED_KEY');
  assert.equal(restored.sources.find(source=>source.id==='pipi-voice').key,'ISOLATED_VOICE_KEY');
});
test('unsaved model listing uses temporary address/key and leaves state byte-for-byte unchanged',async t=>{
  const Catalog=require('../lib/engine/model-catalog.cjs');t.mock.method(Catalog,'metadata',async name=>({...Catalog.lookup(name),known:Object.hasOwn(Catalog.catalog,name)}));
  const m=await server(t,(_,res)=>res.end(JSON.stringify({data:[{id:'gpt-4o'},{id:'unknown-model'},{id:'gpt-4o'}]}))),s=configured('https://saved.example/v1'),before=JSON.stringify(s);
  const result=await M.list(s,{baseUrl:m.url,key:'TEMP_ONLY'});
  assert.equal(m.requests[0].headers.authorization,'Bearer TEMP_ONLY');assert.deepEqual(result.map(x=>x.id),['gpt-4o','unknown-model']);assert.deepEqual(result[1].capabilities,['text','image','audio','tool_use']);assert.equal(result[1].maxContextTokens,0);assert.equal(JSON.stringify(s),before);
});
test('model listing uses saved key only for the same destination and explains unsupported lists',async t=>{
  const m=await server(t,(_,res)=>{res.statusCode=404;res.end('{}');}),s=configured(m.url);
  await assert.rejects(()=>M.list(s,{sourceId:'custom',key:''}),e=>e.code==='PROVIDER_MODELS_UNAVAILABLE');
  assert.equal(m.requests[0].headers.authorization,'Bearer '+SECRET);
  await assert.rejects(()=>M.list(s,{sourceId:'custom',baseUrl:'https://different.example/v1',key:''}),e=>e.code==='PROVIDER_UNCONFIGURED');
});

test('legacy URLs with a trailing slash keep their key in both model listing and later saves',async t=>{
  const upstream=await server(t,(_,res)=>res.end(JSON.stringify({data:[]}))),s=state();
  s.settings.providers.chat={mode:'custom',baseUrl:upstream.url+'/',key:SECRET,model:'legacy-model'};
  M.migrate(s);
  assert.deepEqual(await M.list(s,{sourceId:'legacy-chat'}),[]);
  assert.equal(upstream.requests[0].headers.authorization,'Bearer '+SECRET);
  M.save(s,M.sanitize(s.settings.ai));
  assert.equal(M.resolve(s).baseUrl,upstream.url);
  assert.equal(M.resolve(s).key,SECRET);
});

test('card saves merge separate providers and reject stale models, deleted sources, and changed credential destinations',()=>{
  const s=state();M.migrate(s);
  const makeCard=(id,key='')=>({source:{id,name:id,baseUrl:'https://'+id+'.example/v1',key},kind:'chat',expectedExisting:false,updates:[[id+'-model',model(id+'-model',id)]],assign:{}});
  const first=makeCard('first'),second=makeCard('second',SECRET);
  M.saveCard(s,first);
  assert.equal(s.settings.ai.assign.chat,'');
  M.saveCard(s,second);
  assert.deepEqual(s.settings.ai.models.map(item=>item.id),['first-model','second-model']);
  assert.equal(s.settings.ai.assign.chat,'');
  M.saveAssignments(s,{chat:'second-model'});

  const original=M.sanitize(s.settings.ai).models.find(item=>item.id==='second-model');
  const scope={source:{id:'second'},kind:'chat',expectedExisting:true,assign:{},expectedModels:[[original.id,original]]};
  M.saveCard(s,{...scope,updates:[[original.id,{...original,temperature:.4}]]});
  assert.throws(()=>M.saveCard(s,{...scope,updates:[[original.id,{...original,enabled:false}]]}),{code:'PROVIDER_CONFIG_CHANGED',status:409});
  assert.equal(s.settings.ai.models.find(item=>item.id===original.id).temperature,.4);

  const expectedBaseUrl=second.source.baseUrl,url='https://updated-second.example/v1';
  const expectedKeyRevision=M.sanitize(s.settings.ai).sources.find(item=>item.id==='second').keyRevision;
  M.saveCard(s,{...scope,expectedModels:[],source:{id:'second',baseUrl:url,key:'UPDATED_KEY'},expectedBaseUrl,expectedKeyRevision,updates:[]});
  assert.throws(()=>M.saveCard(s,{...scope,expectedModels:[],source:{id:'second',key:'OLD_DESTINATION_KEY'},expectedBaseUrl,updates:[]}),{code:'PROVIDER_CONFIG_CHANGED'});
  assert.equal(M.resolve(s).key,'UPDATED_KEY');

  M.removeSource(s,'second');
  assert.throws(()=>M.saveCard(s,{...scope,updates:[[original.id,{...original,enabled:false}]]}),{code:'PROVIDER_CONFIG_CHANGED'});
  assert.deepEqual(s.settings.ai.models.map(item=>item.id),['first-model']);
  assert.equal(s.settings.ai.assign.chat,'');
});

test('legacy credentials can be edited and pre-restore key revisions cannot overwrite restored keys',()=>{
  const s=configured('https://example.test/v1'),stored=s.settings.ai.sources.find(source=>source.id==='custom');
  delete stored.keyRevision; // Simulate a data file created before credential revisions.
  delete stored.key;
  const current=()=>M.sanitize(s.settings.ai).sources.find(source=>source.id==='custom');
  const draft={source:{id:'custom',key:'ISOLATED_REPLACEMENT'},kind:'chat',updates:[],assign:{},expectedExisting:true,expectedBaseUrl:stored.baseUrl};
  const initial=current().keyRevision;
  M.saveCard(s,{...draft,source:{id:'custom',name:'仅改名称'}});
  assert.equal(current().keyRevision,initial);
  M.saveCard(s,{...draft,expectedKeyRevision:initial});
  assert.notEqual(current().keyRevision,initial);
  const beforeRestore=current().keyRevision;
  M.restoreBackupKeys(s.settings.ai,[{sourceId:'custom',baseUrl:stored.baseUrl,key:'ISOLATED_RESTORED'}]);
  assert.throws(()=>M.saveCard(s,{...draft,expectedKeyRevision:beforeRestore}),{code:'PROVIDER_KEY_CHANGED',status:409});
  assert.equal(s.settings.ai.sources.find(source=>source.id==='custom').key,'ISOLATED_RESTORED');
});

test('card model deletion only clears affected references and settings assignments merge with recent card edits',()=>{
  const s=configured('https://example.test/v1',[model('main'),model('backup','custom',{capabilities:['text','image']}),model('third')]);
  M.saveAssignments(s,{chat:'backup',caption:'backup',chatFallbacks:['third','main']});
  assert.deepEqual(s.settings.ai.assign.chatSelections,['backup','main']);
  assert.deepEqual(s.settings.ai.assign.chatFallbacks,['third','main']);
  const existing=M.sanitize(s.settings.ai).models.find(item=>item.id==='main');
  const scope={source:{id:'custom'},kind:'chat',expectedExisting:true,assign:{}};
  M.saveCard(s,{...scope,updates:[[existing.id,null]],expectedModels:[[existing.id,existing]]});
  assert.throws(()=>M.saveCard(s,{...scope,updates:[[existing.id,existing]],expectedModels:[[existing.id,existing]]}),{code:'PROVIDER_CONFIG_CHANGED'});
  const saved=s.settings.ai;
  assert.equal(saved.assign.chat,'backup');
  assert.equal(saved.assign.caption,'backup');
  assert.deepEqual(saved.assign.chatSelections,['backup']);
  assert.deepEqual(saved.assign.chatFallbacks,['third']);
});

test('model listing accepts an empty provider list without inventing candidates or changing saved data',async t=>{
  const m=await server(t,(_,res)=>res.end(JSON.stringify({data:[]}))),s=configured(m.url),before=JSON.stringify(s);
  assert.deepEqual(await M.list(s,{sourceId:'custom'}),[]);assert.equal(JSON.stringify(s),before);
});
test('fallback takes over 503, 429 and empty replies while recording each attempt',async t=>{
  for(const failure of [503,429,'empty']){
    const m=await server(t,(req,res)=>{if(req.body.model==='main'){if(failure==='empty')return answer(res,'');res.statusCode=failure;return res.end('{}');}answer(res,'备用已接管',{prompt_tokens:17,completion_tokens:9});}),s=configured(m.url),usage=[];
    const result=await M.call(s,{messages:[{role:'user',content:'你好'}],onUsage:x=>usage.push(x)});
    assert.equal(result.modelId,'backup');assert.equal(result.message.content,'备用已接管');const attempts=failure==='empty'?3:5;assert.deepEqual(m.requests.map(x=>x.body.model),[...Array(attempts).fill('main'),'backup']);assert.equal(usage.length,attempts+1);assert.equal(usage[0].success,false);assert.equal(usage.at(-1).inputTokens,17);assert.equal(usage.at(-1).outputTokens,9);assert.equal(usage.at(-1).inputEstimated,false);
  }
});
test('authentication and other client errors do not invoke backup and retain HTTP classification',async t=>{
  for(const status of [401,403,400]){
    const m=await server(t,(_,res)=>{res.statusCode=status;res.end(JSON.stringify({error:{message:'secret '+SECRET}}));}),s=configured(m.url);
    await assert.rejects(()=>M.call(s,{messages:[]}),e=>e.upstreamStatus===status&&!e.message.includes(SECRET));assert.equal(m.requests.length,1);
  }
});
test('AbortSignal cancels an active request without fallback',async t=>{
  let started;const ready=new Promise(resolve=>{started=resolve;});const m=await server(t,()=>started()),s=configured(m.url),controller=new AbortController();
  const pending=M.call(s,{messages:[],signal:controller.signal});await ready;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(m.requests.length,1);
  const before=new AbortController();before.abort();await assert.rejects(()=>M.call(s,{messages:[],signal:before.signal}),{name:'AbortError'});assert.equal(m.requests.length,1);
});
test('per-model timeout cancels stalled HTTP and retries backup',async t=>{
  const m=await server(t,(req,res)=>{if(req.body.model==='backup')answer(res);}),s=configured(m.url);s.settings.ai.models[0].timeoutSeconds=.05;
  const result=await M.call(s,{messages:[]});assert.equal(result.modelId,'backup');assert.equal(m.requests.length,6);
});
test('request parameters and tool support follow selected model, including explicit connection selection',async t=>{
  const m=await server(t,(_,res)=>answer(res)),s=configured(m.url),tools=[{type:'function',function:{name:'tap',parameters:{type:'object'}}}];
  s.settings.ai.models[0].extraBody={tools,tool_choice:'auto',seed:7,max_tokens:90};
  await M.call(s,{messages:[],tools});assert.equal(m.requests[0].body.tools,undefined);assert.equal(m.requests[0].body.tool_choice,undefined);assert.equal(m.requests[0].body.seed,7);assert.equal(m.requests[0].body.temperature,undefined);
  s.settings.ai.models[1].capabilities.push('tool_use');s.settings.ai.models[1].temperature=.4;s.settings.ai.models[1].maxTokens=50;
  const result=await M.call(s,{role:{modelId:'main'},modelId:'backup',messages:[],tools});assert.equal(result.modelId,'backup');assert.deepEqual(m.requests[1].body.tools,tools);assert.equal(m.requests[1].body.temperature,.4);assert.equal(m.requests[1].body.max_tokens,50);assert.equal(M.resolve(s,'compress',{role:{modelId:'backup'}}).id,'main');assert.equal(M.resolve(s,'chat').maxContextTokens,128000);
});
test('disabled models keep their settings and references, and runtime skips them',async t=>{
  const upstream=await server(t,(_,res)=>answer(res));
  const s=configured(upstream.url,[
    model('main','custom',{capabilities:['text','image'],temperature:.4}),
    model('backup','custom',{capabilities:['text','image']}),
    model('voice','custom',{kind:'tts',capabilities:[]})
  ]);
  const before=M.sanitize(s.settings.ai),next=structuredClone(before);
  next.models.find(item=>item.id==='main').enabled=false;
  next.models.find(item=>item.id==='voice').enabled=false;
  next.assign.caption='main';
  M.save(s,next);

  assert.deepEqual(M.sanitize(s.settings.ai).models,next.models);
  assert.deepEqual(s.settings.ai.assign,next.assign);
  assert.equal(s.settings.ai.sources.find(source=>source.id==='custom').key,SECRET);
  assert.deepEqual(M.visionIds(s.settings.ai),[]);
  assert.throws(()=>M.resolve(s,'caption'),/已停用/);
  assert.throws(()=>M.resolve(s,'tts'),/已停用/);
  assert.throws(()=>M.resolve(s,'chat',{modelId:'main'}),/已停用/);
  assert.equal((await M.resolveChat(s)).id,'backup');
  assert.equal((await M.call(s,{messages:[{role:'user',content:'test'}]})).modelId,'backup');
  assert.deepEqual(upstream.requests.map(entry=>entry.body.model),['backup']);

  const oldClient=M.sanitize(s.settings.ai);
  delete oldClient.models.find(item=>item.id==='main').enabled;
  M.save(s,oldClient);
  assert.equal(M.sanitize(s.settings.ai).models[0].enabled,false);
  const invalid=M.sanitize(s.settings.ai);
  invalid.models[0].enabled='false';
  assert.throws(()=>M.save(s,invalid),/模型启用状态无效/);

  const {testConnection}=require('../lib/engine/model-test.cjs');
  assert.equal((await testConnection(s,'main')).ok,true);
  assert.equal(upstream.requests.at(-1).body.model,'main');
  assert.equal(s.settings.ai.models[0].enabled,false);
});
test('assistant tool calls with null content are accepted',async t=>{
  const tool={id:'call_1',type:'function',function:{name:'tap',arguments:'{}'}},m=await server(t,(_,res)=>res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[tool]}}]}))),s=configured(m.url);
  const result=await M.call(s,{messages:[]});assert.deepEqual(result.message.tool_calls,[tool]);
});
test('connection test, recognition, transcription and speech use new assignments and usage callbacks',async t=>{
  const m=await server(t,(req,res)=>{
    if(req.url.endsWith('/transcriptions'))return res.end(JSON.stringify({text:'转写文字'}));
    if(req.url.endsWith('/speech')){res.setHeader('Content-Type','audio/mpeg');return res.end(require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/demo-assets/tone.mp3')));}
    answer(res,req.body.messages[0].role==='system'?'[]':'OK',{prompt_tokens:20,completion_tokens:3});
  });
  const s=configured(m.url,[model('main'),model('stt','custom',{kind:'stt',capabilities:[]}),model('tts','custom',{kind:'tts',capabilities:[]})]);s.settings.ai.assign.caption='main';s.settings.ai.models[0].capabilities.push('image');s.settings.ai.assign.stt='stt';s.settings.ai.assign.tts='tts';const usage=[];const opts={onUsage:x=>usage.push(x)};
  assert.equal((await P.test(s,'chat',{modelId:'main',...opts})).ok,true);assert.deepEqual(await P.recognize(s,VALID_PNG,opts),[]);assert.equal(await P.transcribe(s,'data:audio/webm;base64,YWJj',opts),'转写文字');assert.match(await P.speak(s,'朗读文字',opts),/^data:audio\/mpeg;base64,/);
  assert.deepEqual(usage.map(x=>x.purpose),['test','caption','stt','tts']);assert.equal(usage[2].inputTokens,500);assert.equal(usage[3].outputTokens,500);assert.equal(m.requests[2].raw.includes('name="model"\r\n\r\nstt'),true);assert.equal(m.requests[3].body.model,'tts');
});
test('length hints count Chinese, emoji graphemes, images and voice',()=>{
  assert.equal(M.estimate('中文'),1.2);assert.equal(M.estimate('👨‍👩‍👧‍👦👍🏽🇨🇳'),6);assert.equal(M.estimate([{type:'image_url',image_url:{url:'x'}},{type:'input_audio',input_audio:{}}]),1265);assert.equal(M.lookup('unknown').maxContextTokens,0);assert.equal(M.lookup('constructor').maxContextTokens,0);assert.equal(M.capacity({model:'unknown',maxContextTokens:0}),128000);
});

test('automatic capacity applies to existing zero values and preserves manual values and saved configuration',async()=>{
  const s=configured('https://isolated.example/v1',[model('main','custom',{model:'auto-capacity-main'}),model('backup','custom',{model:'auto-capacity-backup',maxContextTokens:9000})]);M.migrate(s);const before=JSON.stringify(s);
  const auto=await M.resolveChat(s),manual=await M.resolveChat(s,'chat',{modelId:'backup'});
  assert.equal(auto.maxContextTokens,1500);assert.deepEqual(auto.capacity,{value:1500,source:'metadata',recognized:true});
  assert.equal(manual.maxContextTokens,9000);assert.equal(manual.capacity.source,'manual');assert.equal(JSON.stringify(s),before);
  s.settings.ai.models[0].model='unrecognized-model';const unknown=await M.resolveChat(s);
  assert.equal(unknown.maxContextTokens,128000);assert.equal(unknown.capacity.recognized,false);assert.equal(unknown.capacity.source,'fallback');
});

test('automatic capacity reaches the first request and each fallback budget before sending',async t=>{
  const m=await server(t,(_,res)=>{res.statusCode=503;res.end('{}');}),s=configured(m.url,[model('main','custom',{model:'auto-capacity-main'}),model('backup','custom',{model:'auto-capacity-backup'})]),capacities=[];
  await assert.rejects(M.call(s,{messages:[{role:'user',content:'字'.repeat(1500)}],prepareMessages:(config,messages)=>{
    capacities.push(config.maxContextTokens);if(M.estimate(messages)>config.maxContextTokens)throw Object.assign(new Error('capacity exceeded'),{code:'CONTEXT_LIMIT'});return messages;
  }}),{code:'CONTEXT_LIMIT'});
  assert.deepEqual(capacities,[1500,700]);assert.equal(m.requests.length,5);assert.equal(m.requests[0].body.model,'auto-capacity-main');
});
test('SSRF protection remains active unless the isolated test explicitly opts in',async()=>{
  const before=process.env.ALLOW_PRIVATE_PROVIDERS;delete process.env.ALLOW_PRIVATE_PROVIDERS;
  try{await assert.rejects(()=>P.request({baseUrl:'http://127.0.0.1:1',key:SECRET},'/models',{method:'GET'}),e=>e.code==='PROVIDER_SSRF');}
  finally{process.env.ALLOW_PRIVATE_PROVIDERS=before;}
});


test('four independent builtin groups retain saved addresses, credentials and model library',()=>{
  const s=configured('https://custom.example/v1');
  const own=s.settings.ai.sources.find(x=>x.id==='pipi');own.baseUrl='https://saved.example/v1';own.key='SAVED';
  const previous=structuredClone(s.settings.ai.models);
  M.migrate(s);const out=M.sanitize(s.settings.ai);
  assert.equal(out.sources.find(x=>x.id==='pipi').baseUrl,own.baseUrl);
  assert.equal(s.settings.ai.sources.find(x=>x.id==='pipi').key,'SAVED');
  assert.deepEqual(out.sources.filter(x=>x.builtin).map(x=>x.id),['pipi','pipi-voice','pipi-image','pipi-auxiliary']);
  assert.deepEqual(out.sources.find(x=>x.id==='pipi-voice').kinds,['tts']);
  assert.ok(out.sources.find(x=>x.id==='pipi-auxiliary').kinds.includes('stt'));
  assert.deepEqual(s.settings.ai.models,previous);
  const voice=s.settings.ai.sources.find(x=>x.id==='pipi-voice');voice.baseUrl='https://saved-voice.example/v1';voice.key='VOICE_SAVED';
  const oldUi=structuredClone(out);oldUi.sources=oldUi.sources.filter(x=>!x.builtin||x.id==='pipi');
  M.save(s,oldUi);assert.equal(s.settings.ai.sources.filter(x=>x.builtin).length,4);
  assert.equal(s.settings.ai.sources.find(x=>x.id==='pipi-voice').key,'VOICE_SAVED');
  assert.equal(s.settings.ai.sources.find(x=>x.id==='pipi-voice').baseUrl,'https://saved-voice.example/v1');
});
test('one-click station setup fills the four chat presets without changing existing model settings or fallback order',()=>{
  const s=configured('https://custom.example/v1');
  const initial=M.sanitize(s.settings.ai);
  initial.sources.find(source=>source.id==='pipi').key='ISOLATED_PRESET_KEY';
  const first=M.save(s,initial,{stationPreset:true});
  const names=first.models.filter(model=>model.sourceId==='pipi'&&model.kind==='chat').map(model=>model.model);
  assert.deepEqual(names,['gemini-3.8-flash-按次','gemini-4-hydrogen-按次','gemini-3.5-flash-按次','gemini-3.1-flash-按次']);
  assert.equal(first.assign.chat,'main');
  assert.deepEqual(first.assign.chatFallbacks,['backup']);
  assert.equal(first.assign.chatSelections.length,4);
  const unchanged=structuredClone(first);
  assert.deepEqual(M.save(s,M.sanitize(first),{stationPreset:true}),unchanged);
  const blank=state();M.migrate(blank);
  const unassigned=M.sanitize(blank.settings.ai);
  unassigned.sources.find(source=>source.id==='pipi').key='ISOLATED_PRESET_KEY';
  assert.equal(M.save(blank,unassigned,{stationPreset:true}).assign.chat,'');
});
test('station setup saves chat credentials alone and fills only keyed non-chat groups',()=>{
  const s=configured('https://custom.example/v1'),before=structuredClone(s.settings.ai);
  assert.throws(()=>M.configureStation(s,{pipi:' '}),/至少填写一组/);
  assert.throws(()=>M.configureStation(s,{custom:'不允许'}),/未知的站点分组/);
  assert.throws(()=>M.configureStation(s,{pipi:123}),/密钥格式无效/);
  assert.deepEqual(s.settings.ai,before);
  const chat=M.configureStation(s,{pipi:' ISOLATED_STATION_CHAT '});
  assert.equal(chat.sources.find(source=>source.id==='pipi').key,'ISOLATED_STATION_CHAT');
  assert.deepEqual(chat.models,before.models);
  assert.deepEqual(chat.assign,before.assign);

  const all=M.configureStation(s,{'pipi-voice':'ISOLATED_STATION_VOICE','pipi-image':'ISOLATED_STATION_IMAGE','pipi-auxiliary':'ISOLATED_STATION_AUX'});
  const configuredPurposes={stt:['pipi-auxiliary','mimo-v2.5-asr',20],voiceUnderstanding:['pipi-auxiliary','qwen3.8-omni-flash',45],tts:['pipi-voice','breeze-tts-2',45],image:['pipi-image','gpt-image-2.5-sunburst',null],decision:['pipi-auxiliary','jev-latest',5],embedding:['pipi-auxiliary','Qwen/Qwen3-VL-Embedding-8B',20],rerank:['pipi-auxiliary','Qwen/Qwen3-VL-Reranker-8B',20]};
  for(const [purpose,expected] of Object.entries(configuredPurposes)){
    const actual=all.models.find(model=>model.id===all.assign[purpose]);
    assert.deepEqual([actual.sourceId,actual.model,actual.timeoutSeconds],expected);
  }
  assert.equal(M.resolve(s,'image').timeoutSeconds,120);
  assert.deepEqual(all.models.filter(model=>model.kind==='chat'),before.models);
  const edited=M.sanitize(all),voice=edited.models.find(model=>model.id===all.assign.tts);
  Object.assign(voice,{timeoutSeconds:87,voice:'patched-voice',enabled:false,extraBody:{speed:0.9}});
  const saved=structuredClone(M.save(s,edited));
  assert.deepEqual(M.configureStation(s,{pipi:'','pipi-voice':' '}),saved);
});
test('station setup binds a redirected key to that address and requires explicit presets for it',t=>{
  const env={PIPI_VOICE_SOURCE_URL:'https://alternate.example/v1',PIPI_TTS_MODEL:''};
  for(const [name,value] of Object.entries(env)){
    const old=process.env[name];t.after(()=>{if(old===undefined)delete process.env[name];else process.env[name]=old;});
    process.env[name]=value;
  }
  const s=state();M.migrate(s);
  const saved=M.configureStation(s,{'pipi-voice':'ISOLATED_ALTERNATE_KEY'});
  const voice=saved.sources.find(source=>source.id==='pipi-voice');
  assert.equal(voice.key,'');
  assert.equal(voice.overrideKey.key,'ISOLATED_ALTERNATE_KEY');
  assert.equal(saved.models.length,0);
  process.env.PIPI_TTS_MODEL='explicit-voice-model';
  assert.equal(M.configureStation(s,{}).models.length,0);
  const configured=M.configureStation(s,{'pipi-voice':'ISOLATED_ALTERNATE_KEY'});
  assert.equal(configured.models.find(model=>model.id===configured.assign.tts).model,'explicit-voice-model');
  assert.equal(M.resolve(s,'tts').baseUrl,'https://alternate.example/v1');
  assert.equal(M.resolve(s,'tts').key,'ISOLATED_ALTERNATE_KEY');
});
test('chat selections enforce four without truncating library or changing fallbacks; old clients preserve metadata',()=>{
  const s=configured('https://custom.example/v1',[model('main'),model('backup'),model('third'),model('fourth'),model('fifth')]);
  const input=M.sanitize(s.settings.ai);input.assign.chatSelections=['main','backup','third','fourth'];
  const custom=input.sources.find(x=>x.id==='custom');custom.template='openai';custom.kinds=['chat'];
  M.save(s,input);assert.equal(s.settings.ai.models.length,5);assert.deepEqual(s.settings.ai.assign.chatFallbacks,['backup']);
  const over=M.sanitize(s.settings.ai);over.assign.chatSelections.push('fifth');assert.throws(()=>M.save(s,over),/最多选择4个/);
  const mainMissing=M.sanitize(s.settings.ai);mainMissing.assign.chat='fifth';assert.throws(()=>M.save(s,mainMissing),/必须在已选择/);
  const legacy=M.sanitize(s.settings.ai);delete legacy.assign.chatSelections;legacy.assign.chat='fifth';
  delete legacy.sources.find(x=>x.id==='custom').template;delete legacy.sources.find(x=>x.id==='custom').kinds;
  M.save(s,legacy);assert.deepEqual(s.settings.ai.assign.chatSelections,['fifth','backup','third','fourth']);
  assert.deepEqual(s.settings.ai.assign.chatFallbacks,['backup']);assert.equal(s.settings.ai.sources.find(x=>x.id==='custom').template,'openai');
  delete s.settings.ai.assign.chatSelections;assert.deepEqual(M.sanitize(s.settings.ai).assign.chatSelections,['fifth']);
});
test('decision and rerank can be saved as dedicated assignments',()=>{
  const s=configured('https://custom.example/v1'),input=M.sanitize(s.settings.ai);
  for(const kind of ['decision','rerank']){input.models.push(model(kind,'custom',{kind,capabilities:[]}));input.assign[kind]=kind;}
  M.save(s,input);assert.equal(s.settings.ai.assign.decision,'decision');assert.equal(s.settings.ai.assign.rerank,'rerank');
});
test('BreezeBlue list uses native header and model_id; unsupported native protocols never issue OpenAI requests',async t=>{
  const upstream=await server(t,(_,res)=>res.end(JSON.stringify([{model_id:'breeze-test',name:'Test'}]))),s=configured(upstream.url);
  const source=s.settings.ai.sources.find(x=>x.id==='custom');source.template='breezeblue';source.kinds=['tts'];
  const result=await M.list(s,{sourceId:'custom',kind:'tts'});
  assert.equal(upstream.requests[0].headers['xi-api-key'],SECRET);assert.equal(upstream.requests[0].headers.authorization,undefined);
  assert.equal(result[0].model,'breeze-test');assert.equal(result[0].kind,'tts');
  assert.throws(()=>M.resolve(s,'chat'),e=>e.code==='PROVIDER_PROTOCOL_UNSUPPORTED');
  for(const template of ['minimax','qwen'])await assert.rejects(()=>M.list(s,{sourceId:'custom',template,kind:'tts'}),e=>e.code==='PROVIDER_MODELS_UNAVAILABLE');
  assert.equal(upstream.requests.length,1);
});


test('builtin model defaults cover all four station groups and respect deployer overrides',()=>{
  const {builtinModels,builtinSources,BASE_URL}=require('../lib/engine/builtin-source.cjs');
  const kinds=['chat','stt','tts','image','decision','embedding','rerank','voiceUnderstanding'];
  const variable=kind=>kind==='voiceUnderstanding'?'PIPI_VOICE_UNDERSTANDING_MODEL':'PIPI_'+kind.toUpperCase()+'_MODEL';
  const saved=Object.fromEntries(kinds.map(kind=>[kind,process.env[variable(kind)]]));
  try{
    for(const kind of kinds)delete process.env[variable(kind)];
    const sources=builtinSources().map(source=>({...source,baseUrl:BASE_URL}));
    assert.deepEqual(builtinModels(sources),{chat:'gemini-3.8-flash-按次',tts:'breeze-tts-2',image:'gpt-image-2.5-sunburst',stt:'mimo-v2.5-asr',voiceUnderstanding:'qwen3.8-omni-flash',decision:'jev-latest',embedding:'Qwen/Qwen3-VL-Embedding-8B',rerank:'Qwen/Qwen3-VL-Reranker-8B'});
    const custom=sources.map(source=>source.id==='pipi-auxiliary'?{...source,baseUrl:'https://private.example/v1'}:source);
    assert.equal(builtinModels(custom).stt,'');
    assert.equal(builtinModels(custom).voiceUnderstanding,'');
    for(const kind of kinds)process.env[variable(kind)]='configured-'+kind;
    assert.deepEqual(builtinModels(custom),Object.fromEntries(kinds.map(kind=>[kind,'configured-'+kind])));
  }finally{
    for(const kind of kinds){const name=variable(kind);if(saved[kind]===undefined)delete process.env[name];else process.env[name]=saved[kind];}
  }
});
test('新增用途补全全局默认，语音输入和语音条理解分别选择并保留手动设置',()=>{
  const s=configured('https://custom.example/v1');
  let input=M.sanitize(s.settings.ai);
  const entry=(id,kind,name)=>model(id,'custom',{model:name,kind,capabilities:[]});
  input.models.push(entry('unknown','stt','unclassified'),entry('first','tts','first-tts'),entry('second','tts','second-tts'),
    entry('mimo','stt','mimo-v2.5-asr'),entry('omni','stt','qwen3.8-omni-flash'),entry('image','image','test-image'));
  M.save(s,input);
  assert.deepEqual(['chat','tts','stt','voiceUnderstanding','image','caption'].map(p=>s.settings.ai.assign[p]),['main','first','mimo','omni','image','']);
  input=M.sanitize(s.settings.ai);
  input.assign.tts='second';
  input.models.push(entry('third','tts','third-tts'));
  M.save(s,input);
  assert.equal(s.settings.ai.assign.tts,'second');
  input=M.sanitize(s.settings.ai);
  input.models=input.models.filter(item=>item.id!=='second');
  input.assign.tts='';
  M.save(s,input);
  assert.equal(s.settings.ai.assign.tts,'');
});
test('图片转述只使用手选模型，普通对话的识图和回退设置保持',async t=>{
  const upstream=await server(t,(req,res)=>{
    if(req.body.model==='explicit'){res.statusCode=400;return res.end('{}');}
    answer(res);
  });
  const s=configured(upstream.url,[
    model('main','custom',{capabilities:['text','image']}),model('backup','custom',{capabilities:['text','image']}),model('explicit','custom',{capabilities:['text','image']})
  ]);
  assert.deepEqual(M.visionIds(s.settings.ai),[]);
  await assert.rejects(M.call(s,{purpose:'caption',messages:[]}),{code:'PROVIDER_UNCONFIGURED'});
  const messages=[{role:'user',content:[{type:'image_url',image_url:{url:VALID_PNG}}]}];
  assert.equal((await M.call(s,{messages})).modelId,'main');
  assert.deepEqual(upstream.requests[0].body.messages,messages);

  M.saveAssignments(s,{caption:'backup'});
  assert.equal((await M.call(s,{purpose:'caption',messages})).modelId,'backup');
  M.saveAssignments(s,{caption:'explicit'});
  await assert.rejects(M.call(s,{purpose:'caption',messages}),{upstreamStatus:400});
  M.saveAssignments(s,{caption:''});
  await assert.rejects(M.call(s,{purpose:'caption',messages}),{code:'PROVIDER_UNCONFIGURED'});
  assert.deepEqual(upstream.requests.map(req=>req.body.model),['main','backup','explicit']);
  assert.equal(s.settings.ai.assign.chat,'main');
  assert.deepEqual(s.settings.ai.assign.chatFallbacks,['backup']);
});

test('未选对话主模型时，已设好的回退模型等待手选主模型',async t=>{
  const upstream=await server(t,(_,res)=>answer(res)),s=configured(upstream.url);
  M.saveAssignments(s,{chat:''});
  assert.deepEqual(s.settings.ai.assign.chatFallbacks,['backup']);
  await assert.rejects(M.resolveChat(s),{code:'PROVIDER_UNCONFIGURED'});
  await assert.rejects(M.call(s,{messages:[]}),{code:'PROVIDER_UNCONFIGURED'});
  assert.equal(upstream.requests.length,0);
  M.saveAssignments(s,{chat:'main'});
  assert.equal((await M.call(s,{messages:[]})).modelId,'main');
  assert.deepEqual(upstream.requests.map(req=>req.body.model),['main']);
});

test('friends with different legacy models use global chat and dedicated assignments remain effective',async t=>{
  const m=await server(t,(_,res)=>answer(res)),s=configured(m.url);
  s.roles=[{id:'one',modelId:'main'},{id:'two',modelId:'backup'}];
  const legacy=structuredClone(s.roles);
  for(const role of s.roles){assert.equal(M.resolve(s,'chat',{role}).id,'main');assert.equal((await M.call(s,{role,messages:[]})).modelId,'main');}
  assert.deepEqual(m.requests.map(x=>x.body.model),['main','main']);
  s.settings.ai.assign.compress='backup';s.settings.ai.assign.caption='backup';s.settings.ai.models[1].capabilities.push('image');
  for(const purpose of ['compress','caption']){assert.equal(M.resolve(s,purpose,{role:s.roles[0]}).id,'backup');assert.equal((await M.call(s,{purpose,role:s.roles[0],messages:[]})).modelId,'backup');}
  const input=M.sanitize(s.settings.ai);input.models=input.models.filter(x=>x.id!=='backup');input.assign.compress='';input.assign.caption='';input.assign.chatFallbacks=[];
  M.save(s,input);assert.deepEqual(s.roles,legacy);assert.equal(M.resolve(s,'chat',{role:s.roles[1]}).id,'main');
});

test('a station save keeps the groups left blank and reports a keyed group whose presets are unavailable',t=>{
  const priorVoiceUrl=process.env.PIPI_VOICE_SOURCE_URL,priorTtsModel=process.env.PIPI_TTS_MODEL;
  t.after(()=>{
    if(priorVoiceUrl===undefined)delete process.env.PIPI_VOICE_SOURCE_URL;else process.env.PIPI_VOICE_SOURCE_URL=priorVoiceUrl;
    if(priorTtsModel===undefined)delete process.env.PIPI_TTS_MODEL;else process.env.PIPI_TTS_MODEL=priorTtsModel;
  });
  delete process.env.PIPI_VOICE_SOURCE_URL;
  delete process.env.PIPI_TTS_MODEL;
  const s=state();M.migrate(s);
  M.configureStation(s,{'pipi-voice':'VOICE_KEY'});
  const voice=s.settings.ai.assign.tts;
  M.saveCard(s,{source:{id:'pipi-voice'},kind:'tts',expectedExisting:true,assign:{},updates:[[voice,null]]});
  M.configureStation(s,{pipi:'CHAT_KEY','pipi-voice':' '});
  assert.equal(s.settings.ai.models.length,0);
  assert.equal(s.settings.ai.assign.tts,'');
  assert.equal(s.settings.ai.sources.find(source=>source.id==='pipi-voice').key,'VOICE_KEY');

  process.env.PIPI_VOICE_SOURCE_URL='https://different-voice.example/v1';
  const unconfiguredGroups=[];
  M.configureStation(s,{'pipi-voice':'OVERRIDE_KEY'},{unconfiguredGroups});
  assert.deepEqual(unconfiguredGroups,['pipi-voice']);
  assert.equal(s.settings.ai.models.length,0);
  assert.equal(M.effectiveSources(s.settings.ai).find(source=>source.id==='pipi-voice').key,'OVERRIDE_KEY');
});

test('a legacy settings update works on legacy configuration and cannot overwrite current model configuration',()=>{
  const S=require('../lib/state.cjs'),s=S.initial();
  const update=model=>({providers:{chat:{mode:'custom',baseUrl:'https://legacy.example/v1',model,key:SECRET}}});
  S.apply(s,'settings.save',update('legacy-model'));
  assert.equal(M.resolve(s).model,'legacy-model');
  M.configureStation(s,{pipi:'STATION_KEY'});
  S.defaults(s);
  const before=structuredClone(s.settings);
  S.apply(s,'settings.save',update('legacy-model'));
  assert.deepEqual(s.settings,before);
  assert.throws(()=>S.apply(s,'settings.save',update('stale-model')),{code:'PROVIDER_CONFIG_CHANGED',status:409});
  assert.deepEqual(s.settings,before);
});
