// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const P=require('../lib/providers.cjs'),M=require('../lib/engine/models.cjs');
const mp3=require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/demo-assets/tone.mp3'));
function wav(){
  const b=Buffer.alloc(204);b.write('RIFF');b.writeUInt32LE(196,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(160,40);return b;
}
process.env.ALLOW_PRIVATE_PROVIDERS='1';
async function fixture(t,handler){
  const seen=[],server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks).toString(),entry={url:req.url,headers:req.headers,body:raw?JSON.parse(raw):null};seen.push(entry);
    res.setHeader('content-type','application/json');handler(entry,res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base='http://127.0.0.1:'+server.address().port;
  const state=(kind,template='custom')=>({roles:[],settings:{ai:{sources:[{id:'custom',baseUrl:base+(template==='qwen'?(kind==='tts'?'/api/v1':'/compatible-mode/v1'):'/v1'),key:'ISOLATED',template}],models:[{id:'m',sourceId:'custom',model:'native-model',kind,voice:'voice/id',extraBody:{},capabilities:['text','tool_use'],timeoutSeconds:2}],assign:{[kind]:'m',chatFallbacks:[]}}}});
  return {seen,base,state};
}
test('native speech protocols preserve voice and return actual audio fixture bytes',async t=>{
  for(const template of ['minimax','breezeblue','qwen']){
    const f=await fixture(t,(req,res)=>{
      if(req.url==='/asset.wav'){assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['xi-api-key'],undefined);res.setHeader('content-type','audio/wav');return res.end(wav());}
      if(template==='minimax')return res.end(JSON.stringify({base_resp:{status_code:0},data:{audio:mp3.toString('hex')}}));
      if(template==='qwen')return res.end(JSON.stringify({output:{audio:{url:f.base+'/asset.wav'}}}));
      res.setHeader('content-type','audio/mpeg');res.end(mp3);
    });
    const result=await P.speak(f.state('tts',template),'你好');assert.deepEqual(Buffer.from(result.split(',')[1],'base64'),template==='qwen'?wav():mp3);
    const req=f.seen[0];
    if(template==='minimax'){assert.equal(req.url,'/v1/t2a_v2');assert.equal(req.body.voice_setting.voice_id,'voice/id');assert.equal(req.body.stream,false);}
    if(template==='breezeblue'){assert.equal(req.url,'/v1/text-to-speech/voice%2Fid?output_format=mp3&delivery=sync');assert.equal(req.headers['xi-api-key'],'ISOLATED');assert.equal(req.headers.authorization,undefined);}
    if(template==='qwen'){assert.equal(req.url,'/api/v1/services/aigc/multimodal-generation/generation');assert.equal(req.body.input.voice,'voice/id');}
  }
});
test('音色候选跟随全局合成模型，每位好友合成时仍使用自己的选择',async t=>{
  const f=await fixture(t,(req,res)=>{
    if(req.url==='/v1/get_voice'){
      return res.end(JSON.stringify({base_resp:{status_code:0},system_voice:[{voice_id:'system-id',voice_name:'系统'}],voice_cloning:[{voice_id:'role-a',voice_name:'甲'}],voice_generation:[{voice_id:'role-b',voice_name:'乙'}]}));
    }
    return res.end(JSON.stringify({base_resp:{status_code:0},data:{audio:mp3.toString('hex')}}));
  });
  const s=f.state('tts','minimax');
  assert.deepEqual(await P.listSpeechVoices(s),{
    modelId:'m',complete:true,
    voices:[{voice_id:'system-id',name:'系统',category:'default'},{voice_id:'role-a',name:'甲',category:'personal'},{voice_id:'role-b',name:'乙',category:'personal'}]
  });
  for(const voice of ['role-a','role-b'])await P.speak(s,'合成音色验证',{voice});
  assert.deepEqual(f.seen.map(req=>req.body.voice_setting?.voice_id??req.body.voice_type),['all','role-a','role-b']);
  assert.equal(s.settings.ai.models[0].voice,'voice/id');
  s.settings.ai.sources.find(source=>source.id==='custom').template='openai';
  s.settings.ai.models[0].model='tts-1';
  const openAI=await P.listSpeechVoices(s);
  assert.ok(openAI.voices.some(v=>v.voice_id==='nova'));
  assert.ok(!openAI.voices.some(v=>v.voice_id==='marin'));
  assert.equal(f.seen.length,3);
});
test('Breeze shared synthesis and cache count only actual synthesis once',async t=>{
  const fs=require('node:fs'),path=require('node:path'),dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pipi-voice-usage-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f=await fixture(t,(_,res)=>{res.setHeader('content-type','audio/mpeg');setTimeout(()=>res.end(mp3),20);});
  const records=[],options={dataDir:dir,onUsage:r=>records.push(r)},state=f.state('tts','breezeblue');
  const [a,b]=await Promise.all([P.speak(state,'隔离测试',options),P.speak(state,'隔离测试',options)]);
  assert.equal(a,b);assert.equal(f.seen.length,1);assert.equal(records.length,1);
  assert.equal(await P.speak(state,'隔离测试',options),a);assert.equal(f.seen.length,1);assert.equal(records.length,1);
});
test('Qwen ASR uses input_audio chat endpoint',async t=>{
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify({choices:[{message:{content:'识别文本'}}]})));
  const src='data:audio/wav;base64,'+wav().toString('base64');
  assert.equal(await P.transcribe(f.state('stt','qwen'),src),'识别文本');assert.equal(f.seen[0].url,'/compatible-mode/v1/chat/completions');assert.equal(f.seen[0].body.messages[0].content[0].input_audio.data,src);
});
test('image generation validates bytes, requests base64 and rejects fake success',async t=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=','base64');
  let valid=true;const f=await fixture(t,(_,res)=>res.end(JSON.stringify({data:[{b64_json:(valid?png:Buffer.from('not image')).toString('base64')}]})));
  assert.match(await P.generateImage(f.state('image'),'云'),/^data:image\/png;base64,/);assert.equal(f.seen[0].body.response_format,'b64_json');
  valid=false;await assert.rejects(P.generateImage(f.state('image'),'云'),/图片内容与格式不符/);
});
test('generated audio and image links use the selected model timeout without provider credentials',async t=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=','base64');
  const f=await fixture(t,(req,res)=>{
    if(req.url==='/slow.wav'||req.url==='/slow.png'){
      const isAudio=req.url.endsWith('.wav');
      res.setHeader('content-type',isAudio?'audio/wav':'image/png');
      const timer=setTimeout(()=>res.end(isAudio?wav():png),600);
      res.on('close',()=>clearTimeout(timer));
      return;
    }
    if(req.url.endsWith('/images/generations'))return res.end(JSON.stringify({data:[{url:f.base+'/slow.png'}]}));
    res.end(JSON.stringify({output:{audio:{url:f.base+'/slow.wav'}}}));
  });
  const voice=f.state('tts','qwen'),image=f.state('image');
  voice.settings.ai.models[0].timeoutSeconds=.25;
  image.settings.ai.models[0].timeoutSeconds=.25;
  await Promise.all([
    assert.rejects(P.speak(voice,'下载语音'),error=>error.code==='PROVIDER_TIMEOUT'),
    assert.rejects(P.generateImage(image,'下载图片'),error=>error.code==='PROVIDER_TIMEOUT')
  ]);
  const downloads=f.seen.filter(req=>req.url.startsWith('/slow.'));
  assert.deepEqual(downloads.map(req=>req.url).sort(),['/slow.png','/slow.wav']);
  for(const req of downloads){assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['xi-api-key'],undefined);}
});
test('visible-only empty responses fail and raw tool signatures survive next call',async t=>{
  const message={role:'assistant',content:null,tool_calls:[{id:'one',type:'function',function:{name:'tool',arguments:'{}'},extra_content:{google:{thought_signature:'signature-one'}}},{id:'two',type:'function',function:{name:'tool',arguments:'{}'}}]};
  let mode='tools';const f=await fixture(t,(_,res)=>res.end(JSON.stringify({choices:[{message:mode==='tools'?message:{role:'assistant',content:'<think>secret</think>',reasoning_content:'private'}}]})));
  const state=f.state('chat');const result=await M.call(state,{messages:[]});assert.deepEqual(result.message,message);
  await M.call(state,{messages:[result.message]});assert.deepEqual(f.seen[1].body.messages[0],message);
  mode='empty';await assert.rejects(M.call(state,{messages:[]}),e=>e.code==='PROVIDER_EMPTY');
});
test('native API failures and empty binary audio are errors',async t=>{
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify({base_resp:{status_code:1000},data:{audio:'ff'}})));
  await assert.rejects(P.speak(f.state('tts','minimax'),'你好'),e=>e.code==='PROVIDER_ERROR');
  assert.throws(()=>require('../lib/provider-native.cjs').audioData({buffer:Buffer.alloc(0),contentType:'audio/mpeg'}),e=>e.code==='PROVIDER_RESPONSE');
});
test('BreezeBlue rejects JSON errors and forged audio without reporting success',async t=>{
  let format='json';const f=await fixture(t,(_,res)=>{
    res.setHeader('content-type',format==='json'?'application/json':'audio/mpeg');res.end('{"error":"failed"}');
  });
  for(const value of ['json','forged']){
    format=value;const usage=[];await assert.rejects(P.speak(f.state('tts','breezeblue'),'你好',{onUsage:u=>usage.push(u)}),e=>e.code==='PROVIDER_RESPONSE');assert.equal(usage[0].success,false);
  }
});
test('compatible model listing retains requested non-chat kind without chat capabilities',async t=>{
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify({data:[{id:'unknown-native-model'}]})));
  for(const kind of ['tts','stt','image','embedding']){
    const result=await M.list(f.state(kind),{sourceId:'custom',kind});assert.equal(result[0].kind,kind);assert.deepEqual(result[0].capabilities,[]);assert.equal(result[0].maxContextTokens,0);
  }
});
test('download rejects redirected or private media and sends no key',async t=>{
  const f=await fixture(t,(req,res)=>{assert.equal(req.headers.authorization,undefined);res.statusCode=302;res.setHeader('location','http://127.0.0.1/private');res.end();});
  const {download}=require('../lib/provider-native.cjs');await assert.rejects(download(f.base+'/redirect'),e=>e.code==='PROVIDER_REDIRECT');
  const before=process.env.ALLOW_PRIVATE_PROVIDERS;delete process.env.ALLOW_PRIVATE_PROVIDERS;
  try{await assert.rejects(download(f.base+'/private'),e=>e.code==='PROVIDER_SSRF');}finally{process.env.ALLOW_PRIVATE_PROVIDERS=before;}
});
test('multiple sequential and parallel signed tool calls are replayed verbatim',async t=>{
  const round=n=>({role:'assistant',content:null,tool_calls:[1,2].map(i=>({id:`r${n}-${i}`,type:'function',function:{name:'tool',arguments:JSON.stringify({round:n,index:i})},extra_content:{google:{thought_signature:`signature-${n}-${i}`}}}))});
  let index=0;const f=await fixture(t,(_,res)=>res.end(JSON.stringify({choices:[{message:++index===1?round(1):index===2?round(2):{role:'assistant',content:null}}]})));
  const state=f.state('chat'),messages=[{role:'user',content:'执行两个动作'}];
  for(let n=1;n<=2;n++){
    const result=await M.call(state,{messages});messages.push(result.message,...result.message.tool_calls.map(call=>({role:'tool',tool_call_id:call.id,content:'{"ok":true}'})));
  }
  const result=await M.call(state,{messages,allowEmptyResponse:true});assert.equal(result.message.content,null);assert.deepEqual(f.seen[2].body.messages,messages);assert.deepEqual(messages[1],round(1));assert.deepEqual(messages[4],round(2));
});
test('GPT Image omits legacy response_format, compatible overrides survive, oversized image is explicit',async t=>{
  let large=false;const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify({data:[{b64_json:large?Buffer.alloc(6*1024*1024+1).toString('base64'):png}]})));
  for(const name of ['gpt-image-1.5','chatgpt-image-latest','dall-e-3','custom-image']){
    const state=f.state('image'),model=state.settings.ai.models[0];model.model=name;model.extraBody={response_format:'url',size:'1024x1024'};
    await P.generateImage(state,'云');const body=f.seen.at(-1).body;
    assert.equal(body.response_format,/image-(?:1|latest)/.test(name)?undefined:'url');assert.equal(body.size,'1024x1024');
  }
  const state=f.state('image');state.settings.ai.models[0].extraBody={response_format:null};await P.generateImage(state,'云');assert.equal('response_format' in f.seen.at(-1).body,false);
  state.settings.ai.models[0].model='gpt-image-1.5';large=true;
  await assert.rejects(P.generateImage(state,'云'),e=>e.status===502&&e.code==='PROVIDER_RESPONSE_LIMIT');
});
