// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const Probe=require('../lib/engine/model-test.cjs'),Models=require('../lib/engine/models.cjs');
const kinds=['chat','stt','tts','decision','embedding','rerank'];
const sample=fs.readFileSync(path.join(__dirname,'../lib/engine/assets/model-test.wav'));

async function fixture(t){
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  t.mock.method(require('../lib/engine/model-catalog.cjs'),'resolveCapacity',async()=>({value:128000,source:'manual',recognized:true}));
  const seen=[];
  let respond=(entry,res)=>{
    if(entry.url.endsWith('/audio/speech')){res.setHeader('Content-Type','audio/wav');return res.end(sample);}
    if(entry.url.endsWith('/audio/transcriptions'))return res.end(JSON.stringify({text:'今天真开心，我们出去走走吧。'}));
    if(entry.url.endsWith('/embeddings'))return res.end(JSON.stringify({data:[{embedding:[0.1,0.2,0.3]}]}));
    if(entry.url.endsWith('/rerank'))return res.end(JSON.stringify({results:[{index:0,relevance_score:0.9},{index:1,relevance_score:0.1}]}));
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:entry.body.model.includes('decision')?'{"probability":0.95}':'OK'}}]}));
  };
  const mock=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks),entry={url:req.url,raw,headers:req.headers,body:req.headers['content-type']?.includes('application/json')?JSON.parse(raw):null};
    seen.push(entry);res.setHeader('Content-Type','application/json');respond(entry,res);
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-model-test-'));
  const providerUrl='http://127.0.0.1:'+mock.address().port+'/v1';
  const app=createApp({dataDir:directory,host:'127.0.0.1',port:0,providerUrlAllowlist:[providerUrl,providerUrl+'-alternate']});await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  let cookie='',csrf='';
  async function request(route,body,headers={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,body:value};
  }
  t.after(async()=>{
    await app.close();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('pipi-model-test-'));
    fs.rmSync(directory,{recursive:true,force:true});
    if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;
  });
  const setup=await request('/api/setup',{password:'Isolated-model-tests_2026!',displayName:'隔离模型测试'});
  assert.equal(setup.status,200);
  const models=[...kinds,'image'].flatMap(kind=>['assigned','selected'].map(choice=>({id:kind+'-'+choice,sourceId:'isolated',model:'upstream-'+kind+'-'+choice,kind,capabilities:kind==='chat'?['text']:[],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{},voice:'isolated-voice'})));
  const sources=setup.body.state.settings.ai.sources;
  const ai={...setup.body.state.settings.ai,sources:[sources[0],{id:'isolated',name:'隔离服务',baseUrl:providerUrl,key:'ISOLATED_MODEL_ENDPOINT_KEY',builtin:false},...sources.slice(1)],models,assign:{...setup.body.state.settings.ai.assign,...Object.fromEntries([...kinds,'image'].map(kind=>[kind,kind+'-assigned'])),chatFallbacks:['chat-assigned'],chatSelections:['chat-assigned']}};
  assert.equal((await request('/api/engine/models',{ai})).status,200);
  return {app,seen,request,providerUrl,set respond(handler){respond=handler;},state:()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json)};
}

test('provider deletion endpoint drops only the named custom provider and clears its assignments',async t=>{
  const f=await fixture(t),route='/api/engine/models/source/delete';
  const before=f.state().settings.ai;
  assert.equal((await f.request(route,{sourceId:'unknown'})).status,404);
  assert.equal((await f.request(route,{sourceId:[]})).status,400);
  assert.deepEqual(f.state().settings.ai,before);

  const deletion=await f.request(route,{sourceId:'isolated',expectedKeyRevision:Models.sanitize(before).sources.find(source=>source.id==='isolated').keyRevision});
  assert.equal(deletion.status,200);
  assert.equal(f.seen.length,0);
  const ai=deletion.body.state.settings.ai;
  assert.ok(ai.sources.every(source=>source.builtin&&source.keySet===false));
  assert.equal(ai.models.length,0);
  assert.deepEqual(ai.assign,Object.fromEntries(Object.entries(before.assign).map(([key,value])=>[key,Array.isArray(value)?[]:''])));
});

test('station setup endpoint saves keys without exposing them or requesting upstream models',async t=>{
  const f=await fixture(t),before=f.state().settings.ai,route='/api/engine/models/station';
  const env={PIPI_SOURCE_URL:f.providerUrl,PIPI_VOICE_SOURCE_URL:f.providerUrl,PIPI_TTS_MODEL:'breeze-tts-2'};
  for(const [name,value] of Object.entries(env)){
    const old=process.env[name];t.after(()=>{if(old===undefined)delete process.env[name];else process.env[name]=old;});
    process.env[name]=value;
  }
  assert.equal((await f.request(route,{keys:{unknown:'invalid'}})).status,400);
  assert.deepEqual(f.state().settings.ai,before);
  const expectedKeyRevisions=Object.fromEntries(Models.sanitize(before).sources.map(source=>[source.id,source.keyRevision]));
  const first=await f.request(route,{keys:{pipi:'ISOLATED_STATION_CHAT_KEY'},expectedKeyRevisions});
  assert.equal(first.status,200);
  assert.equal(first.body.state.settings.ai.sources.find(source=>source.id==='pipi').keySet,true);
  assert.equal(JSON.stringify(first.body).includes('ISOLATED_STATION_CHAT_KEY'),false);
  assert.deepEqual(f.state().settings.ai.models,before.models);
  const voice=await f.request(route,{keys:{'pipi-voice':'ISOLATED_STATION_VOICE_KEY'},expectedKeyRevisions});
  assert.equal(voice.status,200);
  assert.equal(f.state().settings.ai.models.find(model=>model.sourceId==='pipi-voice').model,'breeze-tts-2');
  assert.deepEqual(f.state().settings.ai.assign,before.assign);
  assert.equal(f.seen.length,0);
});

test('card and assignment endpoints apply only the submitted changes and reject an old model edit',async t=>{
  const f=await fixture(t),card='/api/engine/models/card',assign='/api/engine/models/assign';
  const ai=Models.sanitize(f.state().settings.ai),previous=ai.models.find(model=>model.id==='chat-selected');
  const update={source:{id:'isolated'},kind:'chat',expectedExisting:true,expectedModels:[[previous.id,previous]],assign:{}};
  const newSource={id:'second-service',name:'第二服务商',baseUrl:f.providerUrl,key:'SECOND_SERVICE_KEY',template:'compatible'};
  const model={...previous,id:'second-chat',sourceId:newSource.id};
  const saves=await Promise.all([
    f.request(card,{...update,updates:[[previous.id,{...previous,temperature:.5}]]}),
    f.request(card,{source:newSource,kind:'chat',expectedExisting:false,updates:[[model.id,model]],assign:{}})
  ]);
  assert.deepEqual(saves.map(result=>result.status),[200,200]);
  assert.equal(JSON.stringify(saves[1].body).includes(newSource.key),false);
  assert.equal(f.state().settings.ai.models.find(model=>model.id===previous.id).temperature,.5);
  assert.equal(f.state().settings.ai.sources.find(source=>source.id===newSource.id).key,newSource.key);

  const choice=await f.request(assign,{assign:{chat:model.id,chatFallbacks:['chat-selected','chat-assigned']}});
  assert.equal(choice.status,200);
  assert.deepEqual(choice.body.state.settings.ai.assign.chatSelections,[model.id,'chat-assigned']);
  const stale=await f.request(card,{...update,updates:[[previous.id,{...previous,enabled:false}]]});
  assert.equal(stale.status,409);
  assert.equal(stale.body.code,'PROVIDER_CONFIG_CHANGED');
  assert.equal(f.state().settings.ai.models.find(model=>model.id===previous.id).enabled,true);
  assert.deepEqual(f.state().settings.ai.assign.chatFallbacks,['chat-selected','chat-assigned']);
  const oldBrowser=await f.request('/api/engine/models',{ai},{'Sec-Fetch-Site':'same-origin'});
  assert.equal(oldBrowser.status,409);
  assert.equal(f.state().settings.ai.sources.find(source=>source.id===newSource.id).key,newSource.key);
  assert.equal(f.seen.length,0);
});

test('concurrent key edits require a fresh confirmation; a rejected save leaves the whole card intact',async t=>{
  const f=await fixture(t),route='/api/engine/models/card';
  const stored=()=>f.state().settings.ai.sources.find(item=>item.id==='isolated');
  const edit=(key,revision,name)=>({source:{id:'isolated',key,name},kind:'chat',updates:[],assign:{},expectedExisting:true,expectedBaseUrl:f.providerUrl,expectedKeyRevision:revision});
  const original=stored(),drafts=['fixture-A','fixture-B'].map((key,index)=>edit(key,original.keyRevision,'草稿'+index));
  const responses=await Promise.all(drafts.map(draft=>f.request(route,draft)));
  const accepted=responses.findIndex(result=>result.status===200),rejected=1-accepted;
  assert.ok(accepted!==-1);
  const first=stored(),conflict=responses[rejected];
  assert.equal(conflict.status,409);assert.equal(conflict.body.code,'PROVIDER_KEY_CHANGED');
  assert.deepEqual(conflict.body.keyRevisions,{isolated:first.keyRevision});
  assert.equal(first.key,drafts[accepted].source.key);
  assert.equal(first.name,drafts[accepted].source.name);
  for(const secret of [original.key,...drafts.map(draft=>draft.source.key)])assert.ok(!JSON.stringify(responses).includes(secret));

  const stale=drafts[rejected];
  for(const fields of [{clearKey:true},{baseUrl:f.providerUrl+'/new'}]){
    const result=await f.request(route,{...stale,source:{id:'isolated',...fields}});
    assert.equal(result.body.code,'PROVIDER_KEY_CHANGED');assert.deepEqual(stored(),first);
  }
  assert.equal((await f.request('/api/engine/models/source/delete',{sourceId:'isolated',expectedKeyRevision:original.keyRevision})).body.code,'PROVIDER_KEY_CHANGED');
  const rename=await f.request(route,{...stale,source:{id:'isolated',name:'仅改名称'}});
  assert.equal(rename.status,200);assert.equal(stored().keyRevision,first.keyRevision);assert.equal(stored().key,first.key);
  const other=await f.request(route,edit('fixture-C',first.keyRevision,'第三次编辑'));
  assert.equal(other.status,200);
  const repeated=await f.request(route,{...stale,expectedKeyRevision:conflict.body.keyRevisions.isolated});
  assert.equal(repeated.status,409);assert.equal(stored().key,'fixture-C');
  const confirmed=await f.request(route,{...stale,expectedKeyRevision:repeated.body.keyRevisions.isolated});
  assert.equal(confirmed.status,200);
  assert.equal(stored().key,stale.source.key);assert.equal(stored().name,stale.source.name);
  assert.equal(f.seen.length,0);
});

test('a stale one-click credential is rejected before any other group changes',async t=>{
  const f=await fixture(t),route='/api/engine/models/station';
  for(const key of ['PIPI_SOURCE_URL','PIPI_VOICE_SOURCE_URL']){
    const prior=process.env[key];process.env[key]=f.providerUrl;
    t.after(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});
  }
  const fromPage=Models.sanitize(f.state().settings.ai);
  const expectedKeyRevisions=Object.fromEntries(fromPage.sources.map(source=>[source.id,source.keyRevision]));
  const keyUpdate=await f.request(route,{keys:{pipi:'fixture-station-A'},expectedKeyRevisions});
  assert.equal(keyUpdate.status,200);
  const first=f.state().settings.ai;
  const conflicting={keys:{'pipi-voice':'fixture-voice',pipi:'fixture-station-B'},expectedKeyRevisions};
  const rejected=await f.request(route,conflicting);
  assert.equal(rejected.status,409);assert.equal(rejected.body.code,'PROVIDER_KEY_CHANGED');
  assert.deepEqual(Object.keys(rejected.body.keyRevisions),['pipi']);
  assert.deepEqual(f.state().settings.ai,first);
  const previousModelPage=structuredClone(fromPage);previousModelPage.sources.find(source=>source.id==='pipi').key='fixture-legacy';
  const oldAPI=await f.request('/api/engine/models',{ai:previousModelPage},{'Sec-Fetch-Site':'same-origin','X-Pipi-Model-Page':'card-save'});
  assert.equal(oldAPI.body.code,'PROVIDER_KEY_CHANGED');assert.deepEqual(f.state().settings.ai,first);
  const confirmed=await f.request(route,{...conflicting,expectedKeyRevisions:{...expectedKeyRevisions,...rejected.body.keyRevisions}});
  assert.equal(confirmed.status,200);assert.equal(f.seen.length,0);
});

test('phone settings separately choose STT and TTS while preserving voice-message understanding',async t=>{
  const f=await fixture(t),route='/api/engine/models/assign';
  const ai=Models.sanitize(f.state().settings.ai);
  ai.assign.voiceUnderstanding='stt-assigned';
  ai.models.find(model=>model.id==='tts-assigned').enabled=false;
  assert.equal((await f.request('/api/engine/models',{ai})).status,200);
  const selected=await f.request(route,{assign:{stt:'stt-selected',tts:'tts-selected'}});
  assert.equal(selected.status,200);
  const expected={...ai.assign,stt:'stt-selected',tts:'tts-selected'};
  assert.deepEqual(selected.body.state.settings.ai.assign,expected);
  assert.equal((await f.request(route,{assign:{stt:'tts-selected'}})).status,400);
  assert.equal((await f.request(route,{assign:{tts:'tts-assigned'}})).status,400);
  assert.deepEqual(f.state().settings.ai.assign,expected);
  assert.equal(f.seen.length,0);
});

test('model metadata and list accept a draft without saving source data or reusing a cleared key',async t=>{
  const f=await fixture(t),before=f.state();
  const catalog=require('../lib/engine/model-catalog.cjs'),originalMetadata=catalog.metadata;
  const metadata=t.mock.method(catalog,'metadata',originalMetadata);
  const route='/api/engine/models/metadata';
  const draft={sourceId:'pending',baseUrl:f.providerUrl+'/',model:'gpt-4.1-mini',maxContextTokens:8192};
  const info=await f.request(route,draft);
  assert.equal(info.status,200);assert.equal(info.body.capacity.value,8192);
  assert.equal(info.body.timeoutSeconds,120);
  const decision=await f.request(route,{...draft,model:'jev-latest',kind:'decision',protocol:'system-one'});
  assert.equal(decision.status,200);assert.deepEqual(decision.body,{timeoutSeconds:5});
  const image=await f.request(route,{...draft,model:'gpt-image-2.5-sunburst',kind:'image'});
  assert.equal(image.status,200);assert.deepEqual(image.body,{timeoutSeconds:120});
  const rerank=await f.request(route,{...draft,model:'rerank-test',kind:'rerank'});
  assert.equal(rerank.status,200);assert.deepEqual(rerank.body,{timeoutSeconds:20});
  assert.equal(metadata.mock.calls.length,1);
  assert.deepEqual(metadata.mock.calls[0].arguments,['gpt-4.1-mini',{baseUrl:f.providerUrl,maxContextTokens:8192}]);
  assert.equal((await f.request(route,{...draft,baseUrl:'file:///model'})).status,400);
  assert.equal((await f.request(route,{...draft,baseUrl:undefined})).status,404);
  const builtin=await f.request(route,{...draft,sourceId:'pipi'});
  assert.equal(builtin.status,200);
  assert.equal(metadata.mock.calls.at(-1).arguments[1].baseUrl,before.settings.ai.sources.find(source=>source.id==='pipi').baseUrl);

  f.respond=(_,res)=>res.end(JSON.stringify({data:[{id:'gpt-4.1-mini'}]}));
  const list='/api/engine/models/list',query={sourceId:'isolated',baseUrl:f.providerUrl,kind:'chat'};
  for(const patch of [{clearKey:true},{baseUrl:f.providerUrl+'-alternate'}]){
    const response=await f.request(list,{...query,...patch});
    assert.equal(response.body.code,'PROVIDER_UNCONFIGURED');
  }
  assert.equal(f.seen.length,0);
  const existing=await f.request(list,query);
  assert.deepEqual(existing.body.models.map(entry=>entry.model),['gpt-4.1-mini']);
  assert.equal(f.seen[0].headers.authorization,'Bearer ISOLATED_MODEL_ENDPOINT_KEY');
  const fetched=await f.request(list,{...query,sourceId:'pending',key:'PENDING_MODEL_ENDPOINT_KEY'});
  assert.equal(fetched.status,200);assert.equal(f.seen[1].headers.authorization,'Bearer PENDING_MODEL_ENDPOINT_KEY');
  assert.deepEqual(f.state(),before);
});

test('model test uses the supplied draft source and model without saving either',async t=>{
  const f=await fixture(t),before=f.state();
  Models.migrate(before);
  const ai=Models.sanitize(before.settings.ai),source=ai.sources.find(item=>item.id==='isolated');
  const model={...ai.models.find(item=>item.id==='chat-selected'),id:'chat-pending',model:'upstream-draft',enabled:false};
  const route='/api/engine/models/test',draft={modelId:model.id,source,model};
  const existing=await f.request(route,draft);
  assert.equal(existing.status,200,JSON.stringify(existing.body));
  assert.equal(f.seen[0].body.model,'upstream-draft');
  assert.equal(f.seen[0].headers.authorization,'Bearer ISOLATED_MODEL_ENDPOINT_KEY');
  const fresh=await f.request(route,{...draft,source:{...source,id:'pending',key:'PENDING_MODEL_ENDPOINT_KEY'},model:{...model,sourceId:'pending'}});
  assert.equal(fresh.status,200,JSON.stringify(fresh.body));
  assert.equal(f.seen[1].headers.authorization,'Bearer PENDING_MODEL_ENDPOINT_KEY');
  assert.equal((await f.request(route,{...draft,model:{...model,sourceId:'invalid'}})).status,400);
  for(const changedSource of [{...source,clearKey:true},{...source,baseUrl:f.providerUrl+'-alternate'}]){
    assert.equal((await f.request(route,{...draft,source:changedSource})).body.code,'PROVIDER_UNCONFIGURED');
  }
  const foreign=await f.request(route,{...draft,source:{...source,baseUrl:'http://127.0.0.1:1/v1',key:'PENDING_MODEL_ENDPOINT_KEY'}});
  assert.equal(foreign.body.code,'PROVIDER_LOCAL_ONLY');
  assert.equal(f.seen.length,2);
  assert.deepEqual(f.state().settings.ai,before.settings.ai);
  assert.equal((await f.request(route,{modelId:model.id})).status,404);
});

test('model-test HTTP dispatches six kinds to the selected model and preserves settings and private data',async t=>{
  const f=await fixture(t),before=f.state();
  // read() applies this existing source ordering before every usage write.
  Models.migrate(before);
  for(const kind of kinds){
    const result=await f.request('/api/engine/models/test',{modelId:kind+'-selected'});
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(result.body.kind,kind);assert.equal(result.body.modelId,kind+'-selected');assert.equal(result.body.ok,true);assert.ok(result.body.detail);
    if(kind==='tts')assert.match(result.body.audio,/^data:audio\/wav;base64,/);
    const entry=f.seen.at(-1);
    if(kind==='stt'){
      assert.match(entry.raw.toString(),/name="model"\r\n\r\nupstream-stt-selected\r\n/);
      assert.ok(entry.raw.includes(sample));
    }else assert.equal(entry.body.model,'upstream-'+kind+'-selected');
    assert.equal(entry.headers.authorization,'Bearer ISOLATED_MODEL_ENDPOINT_KEY');
  }
  assert.equal(f.seen.length,6);
  const after=f.state();
  for(const key of ['settings','roles','messages','personas','memories','profile'])assert.deepEqual(after[key],before[key]);
  const config=(await f.request('/api/engine/config')).body;
  assert.equal(config.usage.reduce((sum,item)=>sum+item.count,0),6);
  const usage=await f.request('/api/engine/usage?range=all');assert.equal(usage.status,200);assert.equal(usage.body.summary.count,6);assert.equal(usage.body.logs.items.length,6);assert.equal(usage.body.trend.length,7);assert.ok(usage.body.logs.items.every(row=>row.durationMs>=0&&row.success));assert.ok(!JSON.stringify(usage.body).includes('ISOLATED_MODEL_ENDPOINT_KEY'));
  assert.equal((await f.request('/api/engine/usage?range=invalid')).status,400);
});

test('model-test HTTP exposes provider failures, rejects empty outputs and never tries another model',async t=>{
  const f=await fixture(t);
  f.respond=(_,res)=>{res.statusCode=503;res.end('{}');};
  const failure=await f.request('/api/engine/models/test',{modelId:'chat-selected'});
  assert.equal(failure.status,502);assert.equal(failure.body.code,'PROVIDER_ERROR');assert.equal(f.seen.length,1);assert.equal(f.seen[0].body.model,'upstream-chat-selected');
  const invalid={chat:{choices:[{message:{content:' '}}]},stt:{text:' '},tts:{error:'not audio'},decision:{choices:[{message:{content:'{"probability":2}'}}]},embedding:{data:[{embedding:[]}]},rerank:{results:[{index:99}]}};
  for(const kind of kinds){
    f.respond=(_,res)=>res.end(JSON.stringify(invalid[kind]));
    const start=f.seen.length,result=await f.request('/api/engine/models/test',{modelId:kind+'-selected'});
    assert.equal(result.status,502,kind+': '+JSON.stringify(result.body));assert.equal(result.body.ok,undefined);assert.equal(f.seen.length,start+1);
  }
  const count=f.seen.length;
  assert.equal((await f.request('/api/engine/models/test',{modelId:'missing'})).status,404);
  assert.equal((await f.request('/api/engine/models/test',{modelId:'image-selected'})).body.code,'UNSUPPORTED_TEST');
  assert.equal((await f.request('/api/engine/models/test',{})).status,404);
  assert.equal(f.seen.length,count);
  assert.ok(f.state().engine.usage.every(record=>record.success===false));
});

test('model-test uses selected native protocols and reports failed empty vectors accurately without changing its input',async t=>{
  const f=await fixture(t),state=f.state(),usage=[];
  const stt=state.settings.ai.models.find(model=>model.id==='stt-selected');
  for(const protocol of ['mimo-asr','qwen-asr','qwen-omni','audio-chat']){
    stt.protocol=protocol;
    f.respond=(entry,res)=>{
      assert.equal(entry.url,'/v1/chat/completions');assert.equal(entry.body.model,'upstream-stt-selected');
      const audio=entry.body.messages[0].content.find(part=>part.type==='input_audio').input_audio.data;
      assert.equal(audio,(protocol==='audio-chat'?'':'data:audio/wav;base64,')+sample.toString('base64'));
      if(protocol!=='qwen-omni')res.end(JSON.stringify({choices:[{message:{content:'原话'}}]}));
      else res.end('data: '+JSON.stringify({choices:[{delta:{content:'原话'}}]})+'\n\ndata: [DONE]\n\n');
    };
    const before=structuredClone(state),result=await Probe.testConnection(state,'stt-selected',{onUsage:record=>usage.push(record)});
    assert.equal(result.detail,'原话');assert.deepEqual(state,before);
  }
  const decision=state.settings.ai.models.find(model=>model.id==='decision-selected');decision.protocol='system-one';
  f.respond=(entry,res)=>{assert.equal(entry.url,'/v1/systemone');assert.equal(entry.body.model,'upstream-decision-selected');res.end(JSON.stringify({answers:{complete:{noul:0.8}}}));};
  assert.equal((await Probe.testConnection(state,'decision-selected')).ok,true);
  f.respond=(_,res)=>res.end(JSON.stringify({data:[]}));
  await assert.rejects(()=>Probe.testConnection(state,'embedding-selected',{onUsage:record=>usage.push(record)}),{code:'PROVIDER_RESPONSE'});
  assert.equal(usage.at(-1).success,false);assert.equal(usage.at(-1).modelId,'embedding-selected');
});

test('model-test preserves the chosen voice and model for all native TTS adapters',async t=>{
  const f=await fixture(t),state=f.state(),model=state.settings.ai.models.find(model=>model.id==='tts-selected');
  const mp3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));
  for(const protocol of ['breezeblue','minimax','qwen-tts']){
    model.protocol=protocol;
    f.respond=(entry,res)=>{
      if(protocol==='breezeblue'){
        assert.equal(entry.url,'/v1/text-to-speech/isolated-voice?output_format=mp3&delivery=sync');
        assert.equal(entry.body.model_id,'upstream-tts-selected');assert.equal(entry.headers['xi-api-key'],'ISOLATED_MODEL_ENDPOINT_KEY');
        res.setHeader('Content-Type','audio/mpeg');return res.end(mp3);
      }
      if(protocol==='minimax'){
        assert.equal(entry.url,'/v1/t2a_v2');assert.equal(entry.body.model,'upstream-tts-selected');assert.equal(entry.body.voice_setting.voice_id,'isolated-voice');
        return res.end(JSON.stringify({base_resp:{status_code:0},data:{audio:mp3.toString('hex')}}));
      }
      assert.equal(entry.url,'/v1/services/aigc/multimodal-generation/generation');assert.equal(entry.body.model,'upstream-tts-selected');assert.equal(entry.body.input.voice,'isolated-voice');
      res.end(JSON.stringify({output:{audio:{data:sample.toString('base64')}}}));
    };
    const before=structuredClone(state),result=await Probe.testConnection(state,'tts-selected');
    assert.equal(result.kind,'tts');assert.match(result.audio,/^data:audio\/(?:mpeg|wav);base64,/);assert.deepEqual(state,before);
  }
});

test('built-in Breeze connection test uses a voice from the supplied key without saving a voice',async t=>{
  const f=await fixture(t),state=f.state(),model=state.settings.ai.models.find(item=>item.id==='tts-selected');
  const source=state.settings.ai.sources.find(item=>item.id==='pipi-voice');
  source.baseUrl=state.settings.ai.sources.find(item=>item.id==='isolated').baseUrl;
  source.key='ISOLATED_VOICE_GROUP_KEY';
  Object.assign(model,{sourceId:source.id,model:'breeze-tts-2',voice:''});
  const mp3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));
  f.respond=(entry,res)=>{
    assert.equal(entry.headers['xi-api-key'],'ISOLATED_VOICE_GROUP_KEY');
    if(entry.url.startsWith('/v1/voices?')){
      return res.end(JSON.stringify({voices:[{voice_id:'temporary-voice',name:'隔离试听',category:'default'}]}));
    }
    assert.equal(entry.url,'/v1/text-to-speech/temporary-voice?output_format=mp3&delivery=sync');
    assert.equal(entry.body.model_id,'breeze-tts-2');
    res.setHeader('Content-Type','audio/mpeg');
    res.end(mp3);
  };
  const result=await Probe.testConnection(state,model.id);
  assert.match(result.audio,/^data:audio\/mpeg;base64,/);
  assert.equal(f.seen.length,2);
  assert.equal(model.voice,'');
});

test('custom native TTS connection tests temporarily use an available voice when none is saved',async t=>{
  const f=await fixture(t),state=f.state(),model=state.settings.ai.models.find(item=>item.id==='tts-selected');
  const mp3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));
  for(const protocol of ['breezeblue','minimax','qwen-tts']){
    Object.assign(model,{protocol,model:protocol==='qwen-tts'?'qwen3-tts-flash':'upstream-tts-selected',voice:''});
    f.respond=(entry,res)=>{
      if(entry.url.startsWith('/v1/voices?'))return res.end(JSON.stringify({voices:[{voice_id:'temp',name:'试音',category:'default'}]}));
      if(entry.url==='/v1/get_voice')return res.end(JSON.stringify({base_resp:{status_code:0},system_voice:[{voice_id:'temp',voice_name:'试音'}]}));
      if(protocol==='breezeblue'){
        assert.equal(entry.url,'/v1/text-to-speech/temp?output_format=mp3&delivery=sync');
        res.setHeader('Content-Type','audio/mpeg');return res.end(mp3);
      }
      if(protocol==='minimax'){
        assert.equal(entry.url,'/v1/t2a_v2');assert.equal(entry.body.voice_setting.voice_id,'temp');
        return res.end(JSON.stringify({base_resp:{status_code:0},data:{audio:mp3.toString('hex')}}));
      }
      assert.equal(entry.url,'/v1/services/aigc/multimodal-generation/generation');assert.equal(entry.body.input.voice,'Cherry');
      res.end(JSON.stringify({output:{audio:{data:sample.toString('base64')}}}));
    };
    const before=structuredClone(state),result=await Probe.testConnection(state,model.id);
    assert.match(result.audio,/^data:audio\/(?:mpeg|wav);base64,/);assert.deepEqual(state,before);
  }
});
