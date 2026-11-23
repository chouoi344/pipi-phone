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
test('OpenAI-compatible audio chat sends raw Base64 and preserves an upstream 503 without retrying',async t=>{
  const base64=src.slice(src.indexOf(',')+1);
  let unavailable=false;
  const f=await fixture(t,({body},res)=>{
    const audio=body.messages[0].content.find(part=>part.type==='input_audio').input_audio;
    if(audio.format!=='wav'||audio.data!==base64||body.stream!==false||body.stream_options||body.modalities){res.writeHead(400);res.end('Invalid audio input');return;}
    if(unavailable){res.writeHead(503);res.end('Unavailable');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'听到了'}}]}));
  });
  const config={...f.c,protocol:'audio-chat',model:'gemini-audio-test'};
  assert.equal(await A.transcribe(config,src),'听到了');assert.equal(f.seen[0].url,'/v1/chat/completions');
  unavailable=true;
  await assert.rejects(A.transcribe(config,src),{code:'PROVIDER_ERROR',upstreamStatus:503});
  assert.equal(f.seen.length,2);
});
test('audio chat is inferred only for audio-capable recognition models; an explicit adapter wins',()=>{
  for(const model of ['gpt-audio','openai/gpt-audio-mini','gpt-4o-audio-preview-2024-12-17','google/gemini-2.5-flash','gemini-3.8-flash-按次']){
    assert.equal(A.speechProtocol({kind:'stt',model}),'audio-chat');
    assert.equal(A.speechProtocol({kind:'stt',model,protocol:'transcription'}),'transcription');
    assert.notEqual(A.speechProtocol({kind:'chat',model}),'audio-chat');
  }
  for(const model of ['gemini-2.5-flash-preview-tts','gemini-2.5-flash-image','gemini-4-hydrogen-按次','gpt-4o-transcribe','unknown'])
    assert.equal(A.speechProtocol({kind:'stt',model}),'transcription');
});
test('stored codec parameters and M4A keep their original data and obey each protocol’s formats',async t=>{
  const f=await fixture(t,(_entry,res)=>res.end(JSON.stringify({text:'原话',choices:[{message:{content:'原话'}}]})));
  const b64=src.split(',')[1],whisper={...f.c,model:'whisper-1'};
  for(const [type,extension] of [['audio/webm;codecs=opus','webm'],['audio/m4a','m4a']]){
    const audio='data:'+type+';base64,'+b64;
    assert.equal(await A.transcribe(whisper,audio),'原话');
    assert.ok(f.seen.at(-1).raw.includes('filename="recording.'+extension+'"'));
    assert.ok(f.seen.at(-1).raw.includes(Buffer.from(b64,'base64').toString()));
    await assert.rejects(A.transcribe(f.c,audio),{code:'PROVIDER_AUDIO_FORMAT'});
  }
  assert.equal(await A.transcribe(f.c,src.replace(';base64',';codecs=pcm;base64')),'原话');
  assert.equal(f.seen.at(-1).body.messages[0].content[0].input_audio.data,src);
});
test('recognition failures identify each purpose, model and upstream HTTP status without leaking the upstream body',async t=>{
  const f=await fixture(t,(_entry,res)=>{res.writeHead(503);res.end(JSON.stringify({error:{message:'private-transcript '+src+' ISOLATED'}}));});
  const source={id:'custom',name:'自接服务',baseUrl:f.c.baseUrl,key:f.c.key,template:'compatible'};
  const models=['voice-1','dictation-1'].map(model=>({id:model,model,kind:'stt',sourceId:'custom',protocol:'audio-chat',extraBody:{}}));
  const state={settings:{ai:{sources:[source],models,assign:{stt:'dictation-1',voiceUnderstanding:'voice-1'}}}},logs=[];
  for(const [run,id,step,purpose] of [[P.transcribe,'dictation-1','录音转文字','stt'],[P.understandVoice,'voice-1','语音条理解','voiceUnderstanding']]){
    await assert.rejects(run(state,src,{onUsage:row=>logs.push(row)}),error=>{
      assert.equal(error.code,'PROVIDER_ERROR');assert.equal(error.status,502);assert.equal(error.upstreamStatus,503);
      assert.equal(error.message,step+'失败，模型「'+id+'」的服务商返回 HTTP 503。');
      assert.equal(error.rawBody,undefined);return true;
    });
    const row=logs.at(-1);assert.equal(row.success,false);assert.equal(row.model,id);assert.equal(row.purpose,purpose);assert.equal(row.error,'模型服务请求失败（HTTP 503）');
    assert.doesNotMatch(JSON.stringify(row),/private-transcript|ISOLATED|base64/);
  }
  assert.equal(f.seen.length,2);
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
