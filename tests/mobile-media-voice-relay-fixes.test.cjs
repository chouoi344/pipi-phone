// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const vm=require('node:vm');

const Media=require('../lib/media-store.cjs');
const S=require('../lib/state.cjs');
const ResponseMod=require('../lib/engine/response.cjs');
const Models=require('../lib/engine/models.cjs');
const Providers=require('../lib/providers.cjs');
const ProviderAudio=require('../lib/provider-audio.cjs');
const Usage=require('../lib/engine/usage.cjs');
const Stickers=require('../lib/engine/stickers.cjs');
const TrustedProxy=require('../lib/trusted-proxy.cjs');
const {createApp}=require('../server.cjs');

process.env.ALLOW_PRIVATE_PROVIDERS='1';

const PNG_BYTES=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=','base64');
// Minimal valid JPEG SOI + APP0 + EOI
const MIN_JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xff,0xd9]);
const MOTION_JPEG=Buffer.concat([MIN_JPEG,Buffer.from('00000018667479706d703432000000006d703432','hex')]);

test('media & state: Motion Photo JPEG trailing bytes and MIME aliases are accepted and trimmed cleanly',()=>{
  assert.equal(Media.sniffImage(MOTION_JPEG),'jpeg');
  const fromBuf=Media.decodeImageInput(MOTION_JPEG);
  assert.equal(fromBuf.mime,'jpeg');
  assert.deepEqual(fromBuf.buffer,MIN_JPEG);

  const aliasData='data:image/jpg;base64,'+MOTION_JPEG.toString('base64');
  const fromData=Media.decodeImageInput(aliasData);
  assert.equal(fromData.mime,'jpeg');
  assert.deepEqual(fromData.buffer,MIN_JPEG);

  const normalized=S.image(aliasData,false);
  assert.equal(normalized,'data:image/jpeg;base64,'+MIN_JPEG.toString('base64'));

  // Spoofed HTML claiming to be PNG is still strictly rejected.
  assert.throws(()=>S.image('data:image/png;base64,'+Buffer.from('<html></html>').toString('base64'),false),/图片内容与格式不符/);
  assert.throws(()=>S.image('data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64'),false),/图片格式无效/);
});

test('media HTTP upload: empty Content-Type, image/jpg alias, Motion Photo JPEG, and clear HEIC error',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-media-fix-'));
  const app=createApp({host:'127.0.0.1',port:0,dataDir:dir,mediaTimers:false});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Connection:'close','Content-Type':'application/json',Origin:base},body:JSON.stringify({displayName:'测试',password:'Strong-Pass-2026!'})});
  assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  const {csrfToken}=await setup.json();
  const headers={Connection:'close','Cookie':cookie,'Origin':base,'X-CSRF-Token':csrfToken};

  // 1. Motion Photo JPEG with image/jpg header
  const r1=await fetch(base+'/api/media/upload',{method:'POST',headers:{...headers,'Content-Type':'image/jpg'},body:MOTION_JPEG});
  assert.equal(r1.status,200);
  const u1=(await r1.json()).url;
  assert.match(u1,/^\/api\/media\/[a-f0-9]{64}\.jpg$/);
  const stored=Buffer.from(await (await fetch(base+u1,{headers:{Connection:'close',Cookie:cookie}})).arrayBuffer());
  assert.deepEqual(stored,MIN_JPEG);

  // 2. Empty Content-Type with PNG bytes via raw http.request
  const r2=await new Promise((resolve,reject)=>{
    const req=http.request(base+'/api/media/upload',{method:'POST',headers:{...headers,'Content-Length':PNG_BYTES.length}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
    });
    req.on('error',reject);req.end(PNG_BYTES);
  });
  assert.equal(r2.status,200);
  assert.match(r2.body.url,/\.png$/);

  // 3. HEIC ftyp box returns image format error, NOT audio format error
  const heic=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypheic'),Buffer.from([0,0,0,0]),Buffer.from('mif1heic')]);
  const r3=await fetch(base+'/api/media/upload',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:heic});
  assert.equal(r3.status,400);
  const body3=await r3.json();
  assert.match(body3.error,/不支持的图片格式/);
  assert.doesNotMatch(body3.error,/音频/);
});

test('audio sniffing & decoding accept Matroska EBML, x-m4a/x-flac, and quoted codecs',()=>{
  const mkvOpus=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3,0x93,0x42,0x82,0x88]),Buffer.from('matroska'),Buffer.from('A_OPUS'),Buffer.alloc(16)]);
  assert.equal(Media.sniffAudio(mkvOpus),'webm');
  const dataUrl='data:audio/webm; codecs="opus";base64,'+mkvOpus.toString('base64');
  assert.equal(Media.decodeAudioInput(dataUrl).ext,'webm');
  assert.equal(S.audio(dataUrl),dataUrl);
});

test('audio-input.js: passes ready 16kHz mono WAV straight through and resamples 48kHz cleanly',async()=>{
  const src=fs.readFileSync(path.join(__dirname,'../public/audio-input.js'),'utf8');
  const scope=vm.createContext({window:{},Blob,Uint8Array,Int16Array,Float32Array,DataView,ArrayBuffer,Math,Promise,Error,Number});
  vm.runInContext(src,scope);
  const A=scope.window.PipiAudio;
  const wav48k=A.encodeWav(new Float32Array(4800).fill(0.25),48000);
  assert.equal(wav48k.type,'audio/wav');
  const buf=await wav48k.arrayBuffer(),dv=new DataView(buf);
  assert.equal(dv.getUint16(22,true),1); // mono
  assert.equal(dv.getUint32(24,true),16000); // resampled 16kHz
  assert.equal(dv.getUint32(40,true),1600*2); // 0.1s * 16000 * 2 bytes
  assert.equal(A.isReadyMono16kWav(buf),true);
  // recordingWav passes ready 16kHz mono WAV directly without needing AudioContext
  const passthrough=await A.recordingWav(wav48k);
  assert.equal(passthrough.type,'audio/wav');
  assert.deepEqual(Buffer.from(await passthrough.arrayBuffer()),Buffer.from(buf));
});

test('stickers: animated sticker enqueue resolves /api/media/ frame URLs',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-sticker-frames-'));
  try{
    const frameUrl=Media.saveImage(dir,PNG_BYTES);
    let state=S.initial();
    state.stickers=[{id:'st-1',image:frameUrl,name:'anim'}];
    const queue=Stickers.create({
      getState:()=>state,
      mutate:fn=>{fn(state);return {state};},
      dataDir:dir,
      modelApi:{call:async()=>({parsed:{meaning:'开心',tags:['开心'],usage:'打招呼',description:'笑脸',visibleText:''}})}
    });
    assert.doesNotThrow(()=>queue.enqueue({ids:['st-1'],frames:{'st-1':[frameUrl,frameUrl]}}));
    await queue.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('response.cjs: handles orphan </think>, avoids false reasoning leak inside <think>, and reads output_text safely',()=>{
  assert.equal(ResponseMod.visibleText({content:'先分析一下用户意图...\n</think>\n晚上好呀！'}),'晚上好呀！');
  assert.equal(ResponseMod.leakedReasoning({content:'<think>用户想要问我晚饭吃什么</think>今晚想吃面。'}),false);
  assert.equal(ResponseMod.visibleText({content:[null,{type:'output_text',text:'第一段'},{type:'text',text:'第二段'}]}),'第一段\n第二段');
});

test('models & providers: tool_calls null, reasoning params, length-exhausted thinking, 402 fallback, and Breeze dual auth',async t=>{
  const seen=[];
  let mode='null_tools';
  const srv=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const bodyText=Buffer.concat(chunks).toString('utf8');
    let body=null;try{body=bodyText?JSON.parse(bodyText):null;}catch{}
    seen.push({url:req.url,method:req.method,headers:req.headers,body});
    if(req.url.startsWith('/v1/voices')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({voices:[{voice_id:'v1',name:'清甜'}]}));}
    if(req.url.includes('/text-to-speech/')){res.setHeader('content-type','audio/mpeg');return res.end(fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3')));}
    res.setHeader('content-type','application/json');
    if(mode==='null_tools')return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK',tool_calls:null}}],usage:{input_tokens:12,output_tokens:4}}));
    if(mode==='object_args')return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'',tool_calls:[{id:'c1',function:{name:'tap',arguments:{x:1}}}]}}]}));
    if(mode==='reasoning_length')return res.end(JSON.stringify({choices:[{finish_reason:'length',message:{role:'assistant',content:'',reasoning_content:'long thought...'}}]}));
    if(mode==='fallback_402'){
      if(body?.model==='primary'){res.statusCode=402;return res.end(JSON.stringify({error:'quota exceeded'}));}
      return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'备用接管成功'}}]}));
    }
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'默认响应'}}]}));
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{srv.closeAllConnections();srv.close(r);}));
  const base='http://127.0.0.1:'+srv.address().port+'/v1';
  const makeState=()=>({
    roles:[],
    settings:{
      ai:{
        sources:[{id:'relay',name:'中转',baseUrl:base,key:'SECRET_KEY_12345678901234567890',template:'compatible',builtin:false}],
        models:[
          {id:'m1',sourceId:'relay',model:'primary',kind:'chat',enabled:true,capabilities:['text','tool_use'],maxContextTokens:128000,temperature:0.7,maxTokens:200,timeoutSeconds:10,extraBody:{}},
          {id:'m2',sourceId:'relay',model:'backup',kind:'chat',enabled:true,capabilities:['text'],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:10,extraBody:{}},
          {id:'r1',sourceId:'relay',model:'gpt-5-mini',kind:'chat',enabled:true,capabilities:['text'],maxContextTokens:128000,temperature:0.5,maxTokens:300,timeoutSeconds:10,extraBody:{}},
          {id:'tts1',sourceId:'relay',model:'breeze-tts-2',kind:'tts',enabled:true,capabilities:[],voice:'v1',timeoutSeconds:10,extraBody:{}}
        ],
        assign:{chat:'m1',chatFallbacks:['m2'],tts:'tts1'}
      }
    }
  });

  // 1. tool_calls: null + input_tokens/output_tokens usage parsing + User-Agent
  const s=makeState();
  const res1=await Models.call(s,{messages:[{role:'user',content:'hi'}]});
  assert.equal(res1.message.content,'OK');
  assert.equal(res1.usage.inputTokens,12);
  assert.equal(res1.usage.outputTokens,4);
  assert.equal(res1.usage.inputEstimated,false);
  assert.equal(seen[0].headers['user-agent'],'pipi-phone');

  // 2. tool call missing type + object arguments normalized to JSON string
  mode='object_args';
  const res2=await Models.call(s,{messages:[{role:'user',content:'hi'}],tools:[{type:'function',function:{name:'tap',parameters:{type:'object'}}}]});
  assert.equal(res2.message.tool_calls[0].type,'function');
  assert.equal(res2.message.tool_calls[0].function.arguments,'{"x":1}');

  // 3. Reasoning model sends max_completion_tokens and omits non-1 temperature
  mode='null_tools';
  await Models.call(s,{modelId:'r1',messages:[{role:'user',content:'hi'}]});
  const rReq=seen.at(-1).body;
  assert.equal(rReq.max_completion_tokens,300);
  assert.equal(rReq.max_tokens,undefined);
  assert.equal(rReq.temperature,undefined);

  // 4. finish_reason=length with reasoning fails immediately on primary (1 attempt, NOT 3) and tries fallback once
  mode='reasoning_length';
  const beforeLen=seen.length;
  await assert.rejects(Models.call(s,{modelId:'r1',messages:[{role:'user',content:'hi'}]}),/耗尽了最大回复长度/);
  assert.equal(seen.length-beforeLen,2);
  assert.equal(seen.at(-2).body.model,'gpt-5-mini');
  assert.equal(seen.at(-1).body.model,'backup');

  // 5. HTTP 402 falls back to backup chat model
  mode='fallback_402';
  const res5=await Models.call(s,{messages:[{role:'user',content:'hi'}]});
  assert.equal(res5.modelId,'m2');
  assert.equal(res5.message.content,'备用接管成功');

  // 6. BreezeBlue on non-official relay sends BOTH xi-api-key and Authorization: Bearer
  await Providers.listSpeechVoices(s);
  const voicesReq=seen.at(-1);
  assert.equal(voicesReq.headers['xi-api-key'],'SECRET_KEY_12345678901234567890');
  assert.equal(voicesReq.headers['authorization'],'Bearer SECRET_KEY_12345678901234567890');
  await Providers.speak(s,'测试');
  const ttsReq=seen.at(-1);
  assert.equal(ttsReq.headers['xi-api-key'],'SECRET_KEY_12345678901234567890');
  assert.equal(ttsReq.headers['authorization'],'Bearer SECRET_KEY_12345678901234567890');

  // 7. hasReadyChatModel checks effectiveSources + enabled + fallbacks
  assert.equal(Models.hasReadyChatModel(s),true);
  s.settings.ai.models[0].enabled=false;
  assert.equal(Models.hasReadyChatModel(s),true); // backup m2 is still enabled!
  s.settings.ai.models[1].enabled=false;
  assert.equal(Models.hasReadyChatModel(s),false);
});

test('provider-audio parseSSE & usage safeError & RFC 7239 Forwarded proto=https',()=>{
  // BOM + plain JSON fallback
  const plain=ProviderAudio.parseSSE('\uFEFF{"choices":[{"message":{"content":"普通回复"}}]}');
  assert.equal(plain.choices[0].message.content,'普通回复');
  // SSE with whitespace around [DONE]
  const sse=ProviderAudio.parseSSE('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]  \n\n');
  assert.equal(sse.choices[0].message.content,'你好');
  // usage.safeError extracts non-standard upstream error fields while redacting secret
  const msg=Usage.safeError({code:'PROVIDER_ERROR',upstreamStatus:402,rawBody:JSON.stringify({detail:'余额不足 sk-secret-123'})},'sk-secret-123');
  assert.match(msg,/HTTP 402.*余额不足/);
  assert.doesNotMatch(msg,/sk-secret-123/);
  // RFC 7239 Forwarded proto=https
  const proxy=TrustedProxy.create('loopback');
  const ctx=proxy.context({socket:{remoteAddress:'127.0.0.1',encrypted:false},headers:{forwarded:'for=203.0.113.9;proto=https'}});
  assert.equal(ctx.secure,true);
  assert.equal(ctx.client,'203.0.113.9');
});
