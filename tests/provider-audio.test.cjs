// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const P=require('../lib/providers.cjs'),A=require('../lib/provider-audio.cjs');
process.env.ALLOW_PRIVATE_PROVIDERS='1';
const src='data:audio/wav;base64,'+Buffer.from('RIFF0000WAVE'+'.'.repeat(80)).toString('base64');
async function fixture(t,handler){
  const seen=[],server=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks).toString();const entry={url:req.url,headers:req.headers,raw,body:raw.startsWith('{')?JSON.parse(raw):null};seen.push(entry);handler(entry,res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return {seen,c:{baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',key:'ISOLATED',model:'mimo-v2.5-asr',timeoutSeconds:2}};
}
test('MiMo ASR uses data URL, Bearer, language:auto and non streaming',async t=>{
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify({choices:[{message:{content:'原话'}}]})));
  assert.equal(await A.transcribe(f.c,src),'原话');const r=f.seen[0];assert.equal(r.url,'/v1/chat/completions');assert.equal(r.headers.authorization,'Bearer ISOLATED');assert.equal(r.body.stream,false);assert.deepEqual(r.body.asr_options,{language:'auto'});assert.equal(r.body.messages[0].content[0].input_audio.data,src);
});
test('Omni SSE collects visible content and final usage, keeps transcription plain',async t=>{
  const f=await fixture(t,(_,res)=>{res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'隐藏推理',content:'原'}}]})+'\n\n');res.end('data: '+JSON.stringify({choices:[{delta:{content:'话'}}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:12,completion_tokens:2,total_tokens:14}})+'\n\ndata: [DONE]\n\n');});
  const c={...f.c,model:'qwen3.8-omni-flash'},responses=[];
  assert.equal(await A.transcribe(c,src,{send:async(...args)=>{const data=await P.request(...args);responses.push(data);return data;}}),'原话');assert.equal(f.seen[0].body.stream,true);assert.equal(f.seen[0].body.messages[0].content[1].input_audio.format,'wav');assert.equal(responses[0].usage.total_tokens,14);assert.equal(JSON.stringify(responses).includes('隐藏推理'),false);
});
test('voice understanding reads audio and validates independent emotions',async t=>{
  const value={text:'好吧',contentEmotion:'接受',voiceEmotion:'委屈'};
  const f=await fixture(t,(_,res)=>res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(value)}}]})+'\n\ndata: [DONE]\n\n'));
  assert.deepEqual(await A.understand({...f.c,model:'qwen3.8-omni-flash'},src),value);assert.equal(f.seen[0].body.messages[0].content[1].input_audio.data,src);
  const invalid=await fixture(t,(_,res)=>res.end('data: '+JSON.stringify({choices:[{delta:{content:'{"text":"x","contentEmotion":7,"voiceEmotion":""}'}}]})+'\n\n'));
  await assert.rejects(A.understand({...invalid.c,model:'qwen3.8-omni-flash'},src),{code:'PROVIDER_RESPONSE'});
});
test('default transcription stays multipart and ASR understanding adds no invented emotions',async t=>{
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify({text:'转写'})));
  assert.deepEqual(await A.understand({...f.c,model:'whisper-1'},src),{text:'转写',contentEmotion:'',voiceEmotion:''});assert.equal(f.seen[0].url,'/v1/audio/transcriptions');assert.match(f.seen[0].headers['content-type'],/^multipart/);assert.match(f.seen[0].raw,/recording.wav/);
});
test('unsupported format, streaming model, malformed SSE, HTTP errors and cancellation surface',async t=>{
  const f=await fixture(t,(_,res)=>{res.statusCode=429;res.end('{}');});
  await assert.rejects(A.transcribe(f.c,src),{code:'PROVIDER_ERROR',upstreamStatus:429});
  await assert.rejects(A.transcribe(f.c,src.replace('audio/wav','audio/webm')),{code:'PROVIDER_AUDIO_FORMAT'});
  await assert.rejects(A.transcribe({...f.c,model:'qwen3-asr-flash-realtime'},src),{code:'PROVIDER_PROTOCOL_UNSUPPORTED'});
  const abort=new AbortController();abort.abort();await assert.rejects(A.transcribe(f.c,src,{signal:abort.signal}),{name:'AbortError'});
  const slow=await fixture(t,()=>{}),controller=new AbortController();const result=A.transcribe(slow.c,src,{signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(result,{name:'AbortError'});
  const bad=await fixture(t,(_,res)=>res.end('data: bad\n\n'));await assert.rejects(A.transcribe({...bad.c,model:'qwen3.8-omni-flash'},src),{code:'PROVIDER_RESPONSE'});
});
