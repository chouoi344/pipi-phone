'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const P=require('../lib/providers.cjs'),M=require('../lib/engine/models.cjs'),S=require('../lib/state.cjs'),Usage=require('../lib/engine/usage.cjs');
process.env.ALLOW_PRIVATE_PROVIDERS='1';
const MB=1024*1024;
async function peer(t,status=200){
  const requests=[],server=http.createServer(async(req,res)=>{let bytes=0;for await(const chunk of req)bytes+=chunk.length;requests.push(bytes);res.writeHead(status,{'Content-Type':'application/json'});res.end(status===200?JSON.stringify({choices:[{message:{role:'assistant',content:'固定本机回复'}}]}):JSON.stringify({error:{message:'upstream body may contain secret-fixture-value'}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {requests,config:{baseUrl:'http://127.0.0.1:'+server.address().port,key:'SYNTHETIC_NO_PAID_API',timeoutSeconds:10}};
}
function configured(baseUrl){
  const state=S.initial(),ai=M.sanitize(state.settings.ai);
  M.save(state,{...ai,sources:[...ai.sources,{id:'limit-fixture',name:'测试服务',baseUrl,key:'SYNTHETIC_NO_PAID_API'}],models:[{id:'limit-model',sourceId:'limit-fixture',model:'fixed',kind:'chat',capabilities:['text'],maxContextTokens:128000,extraBody:{},timeoutSeconds:10}],assign:{...ai.assign,chat:'limit-model',chatFallbacks:[]}});
  return state;
}
test('default transport accepts the old 20 MiB boundary and larger requests',async t=>{
  const f=await peer(t);for(const size of [20*MB,20*MB+1,25*MB])await P.request(f.config,'/probe',{body:Buffer.alloc(size,32)});
  assert.deepEqual(f.requests,[20*MB,20*MB+1,25*MB]);
});
test('upstream HTTP 413 is distinct, stops after one request and remains clear in usage',async t=>{
  const f=await peer(t,413),state=configured(f.config.baseUrl),usage=[];
  await assert.rejects(M.call(state,{messages:[{role:'user',content:'合成请求'}],onUsage:row=>usage.push(row)}),e=>e.code==='PROVIDER_REQUEST_TOO_LARGE'&&e.upstreamStatus===413&&e.requestBytes>0&&/模型服务/.test(e.message));
  assert.equal(f.requests.length,1);assert.equal(usage.length,1);assert.equal(usage[0].success,false);assert.match(usage[0].error,/模型服务拒绝.*HTTP 413/);assert.doesNotMatch(usage[0].error,/secret-fixture/);assert.match(Usage.displayError(usage[0].error),/模型服务拒绝/);
});
function syntheticWav(){
  const wav=Buffer.alloc(364);wav.write('RIFF');wav.writeUInt32LE(356,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(320,40);
  return 'data:audio/wav;base64,'+wav.toString('base64');
}
for(const purpose of ['stt','voiceUnderstanding'])test(purpose+' keeps actual upstream 413 request bytes through counted and usage, without retry',async t=>{
  const f=await peer(t,413),state=configured(f.config.baseUrl),ai=M.sanitize(state.settings.ai),usage=[];
  ai.models.push({id:'speech-limit-model',sourceId:'limit-fixture',kind:'stt',model:purpose==='stt'?'whisper-1':'gpt-audio-mini',protocol:purpose==='stt'?'transcription':'audio-chat',capabilities:[],maxContextTokens:0,extraBody:{},timeoutSeconds:10});
  ai.assign[purpose]='speech-limit-model';M.save(state,ai);
  const error=await (purpose==='stt'?P.transcribe(state,syntheticWav(),{onUsage:row=>usage.push(row)}):P.understandVoice(state,syntheticWav(),{onUsage:row=>usage.push(row)})).then(()=>assert.fail('loopback HTTP413 must reject'),error=>error);
  assert.equal(error.code,'PROVIDER_REQUEST_TOO_LARGE');assert.equal(error.upstreamStatus,413);assert.equal(f.requests.length,1,'upstream 413 must not be retried');
  assert.equal(error.requestBytes,f.requests[0],'counted must preserve the exact final sent bytes');
  const size=require('../lib/request-budget.cjs').sizeLabel(f.requests[0]);assert.ok(error.message.includes(size));
  assert.equal(usage.length,1);assert.equal(usage[0].success,false);assert.match(usage[0].error,/模型服务拒绝过大请求（HTTP 413）/);
  assert.ok(usage[0].error.includes(size));assert.ok(Usage.displayError(usage[0].error).includes(size));
  assert.doesNotMatch(usage[0].error,/NaN|undefined|secret-fixture/);
  t.diagnostic(JSON.stringify({purpose,requests:f.requests.length,actualRequestBytes:f.requests[0],errorRequestBytes:error.requestBytes,usageError:usage[0].error}));
});
