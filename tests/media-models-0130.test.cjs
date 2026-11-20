'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const Providers=require('../lib/providers.cjs'),Audio=require('../lib/provider-audio.cjs'),Native=require('../lib/provider-native.cjs'),Media=require('../lib/media-store.cjs');
const Pipeline=require('../lib/engine/pipeline.cjs'),One=require('../lib/engine/system-one.cjs');
const mp3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=','base64');
function wav(){const b=Buffer.alloc(204);b.write('RIFF');b.writeUInt32LE(196,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(160,40);return b;}
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-model-media-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function fixture(t,handler){
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});
  const seen=[],server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),raw=bytes.toString();const entry={url:req.url,headers:req.headers,bytes,raw,body:raw.startsWith('{')?JSON.parse(raw):null};seen.push(entry);res.setHeader('Content-Type','application/json');handler(entry,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base='http://127.0.0.1:'+server.address().port+'/v1';
  const state=(kind,template='custom')=>({roles:[],settings:{ai:{sources:[{id:'source',baseUrl:base,key:'ISOLATED',template}],models:[{id:'model',sourceId:'source',model:'model-fixture',kind,voice:'voice-fixture',capabilities:kind==='chat'?['text','image']:['text'],timeoutSeconds:2,extraBody:{}}],assign:{[kind]:'model',...(kind==='chat'?{caption:'model'}:{}),chatFallbacks:[]}}}});
  return {seen,base,state};
}

test('文件音频转写与语音理解向服务商发送原音频字节，兼容旧dataURL',async t=>{
  const dir=directory(t),buffer=wav(),ref=Media.saveAudio(dir,buffer),src='data:audio/wav;base64,'+buffer.toString('base64');
  const f=await fixture(t,(request,res)=>{
    if(request.url.endsWith('/audio/transcriptions'))return res.end(JSON.stringify({text:'转写原话'}));
    res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'{"text":"语音原话","contentEmotion":"接受","voiceEmotion":"平静"}'}}]})+'\n\ndata: [DONE]\n\n');
  });
  const transcription=f.state('stt');assert.equal(await Providers.transcribe(transcription,ref,{dataDir:dir}),'转写原话');assert(f.seen[0].bytes.includes(buffer));assert.match(f.seen[0].raw,/recording.wav/);assert.doesNotMatch(f.seen[0].raw,/\/api\/media\//);
  const understanding=f.state('stt');understanding.settings.ai.models[0].protocol='audio-chat';understanding.settings.ai.assign.voiceUnderstanding='model';
  assert.deepEqual(await Providers.understandVoice(understanding,ref,{dataDir:dir}),{text:'语音原话',contentEmotion:'接受',voiceEmotion:'平静'});assert.equal(f.seen[1].body.messages[0].content[1].input_audio.data,src);
  assert.equal(await Audio.transcribe({baseUrl:f.base,key:'ISOLATED',model:'whisper-1'},src),'转写原话');
});

test('原生Qwen转写支持本地媒体地址；丢失音频在请求模型之前报错',async t=>{
  const dir=directory(t),buffer=wav(),ref=Media.saveAudio(dir,buffer),f=await fixture(t,(request,res)=>res.end(JSON.stringify({choices:[{message:{content:'原生转写'}}]})));
  const config={baseUrl:f.base,key:'ISOLATED',model:'qwen3-asr-flash'};
  assert.equal(await Native.transcribe(config,ref,{dataDir:dir}),'原生转写');assert.equal(f.seen[0].body.messages[0].content[0].input_audio.data,Media.toAudioDataUrl(dir,ref));
  const missing='/api/media/'+'0'.repeat(64)+'.wav';
  await assert.rejects(Audio.transcribe({...config,model:'whisper-1'},missing,{dataDir:dir}),{code:'AUDIO_UNAVAILABLE'});
  await assert.rejects(Native.transcribe(config,missing,{dataDir:dir}),{code:'AUDIO_UNAVAILABLE'});assert.equal(f.seen.length,1);
});

for(const template of ['custom','minimax','breezeblue','qwen'])test('AI语音落成媒体文件并保留原字节与时长：'+template,async t=>{
  const dir=directory(t),f=await fixture(t,(request,res)=>{
    if(template==='minimax')return res.end(JSON.stringify({base_resp:{status_code:0},data:{audio:mp3.toString('hex')}}));
    if(template==='qwen')return res.end(JSON.stringify({output:{audio:{data:wav().toString('base64')}}}));
    res.setHeader('Content-Type','audio/mpeg');res.end(mp3);
  });
  const audio=await Providers.speak(f.state('tts',template),'模型媒体测试',{dataDir:dir});assert(Media.isAudioMediaUrl(audio));assert.doesNotMatch(audio,/base64/);
  const bytes=Media.resolveAudioBytes(dir,audio).buffer;assert.deepEqual(bytes,template==='qwen'?wav():mp3);
  const original=Media.toAudioDataUrl(dir,audio);assert.equal(Native.estimateAudioDurationMs(audio,'模型媒体测试',{dataDir:dir}),Native.estimateAudioDurationMs(original,'模型媒体测试'));
});

test('账单识别先读取本地图片，丢失文件不产生模型请求',async t=>{
  const dir=directory(t),ref=Media.saveImage(dir,png),f=await fixture(t,(request,res)=>res.end(JSON.stringify({choices:[{message:{content:'[]'}}]})));
  await Providers.recognize(f.state('chat'),ref,{dataDir:dir});assert.equal(f.seen[0].body.messages[1].content[1].image_url.url,Media.toDataUrl(dir,ref));
  await assert.rejects(Providers.recognize(f.state('chat'),'/api/media/'+'0'.repeat(64)+'.png',{dataDir:dir}),{code:'IMAGE_UNAVAILABLE'});assert.equal(f.seen.length,1);
});

test('主聊天与System One读取图片文件，缺失图片不把相对地址发给模型',async t=>{
  const dir=directory(t),ref=Media.saveImage(dir,png),msg={id:'image',sender:'user',type:'image',content:ref,meta:{},createdAt:1},s={messages:[msg]};
  assert.equal(Pipeline.render(s,msg,true,dir,new Set()).content[1].image_url.url,Media.toDataUrl(dir,ref));
  const missing={...msg,content:'/api/media/'+'0'.repeat(64)+'.png'};assert.doesNotMatch(JSON.stringify(Pipeline.render(s,missing,true,dir,new Set())),/\/api\/media\//);
  const f=await fixture(t,(request,res)=>res.end(JSON.stringify({answers:{complete:{probability:0.95}}}))),state=f.state('decision');state.settings.ai.models[0].protocol='system-one';
  assert.equal((await One.evaluateCompleteness(state,{images:[ref],dataDir:dir})).complete,true);assert.equal(Object.values(f.seen[0].body.assets)[0].data_base64,png.toString('base64'));
});

test('改图读取参考媒体文件，生成结果存文件且保持图片原字节',async t=>{
  const dir=directory(t),reference=Media.saveImage(dir,png),f=await fixture(t,(request,res)=>res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]})));
  const image=await Providers.generateImage(f.state('image'),'修改图片',{references:[reference],requireReference:true,dataDir:dir});
  assert.equal(f.seen[0].url,'/v1/images/edits');assert(f.seen[0].bytes.includes(png));assert.doesNotMatch(f.seen[0].raw,/\/api\/media\//);assert(Media.isMediaUrl(image));assert.deepEqual(Media.resolveImageBytes(dir,image).buffer,png);
});

test('衣柜导入与编辑接受已上传图片地址，保留实际格式和512KB批量限制',t=>{
  const Wardrobe=require('../lib/engine/schedule-wardrobe.cjs'),dir=directory(t),image=Media.saveImage(dir,png),draft={description:'蓝色外套',category:'外出',seasons:['春'],image};
  const imported=Wardrobe.importItems([],[draft],{dataDir:dir});assert.equal(imported.added,1);assert.equal(imported.items[0].image,image);assert.deepEqual(Media.resolveImageBytes(dir,image).buffer,png);
  const updated=Wardrobe.upsertItem(imported.items,{id:imported.items[0].id,category:'居家'},{dataDir:dir});assert.equal(updated.item.image,image);assert.equal(updated.item.category,'居家');
  const tooLarge=Media.saveImage(dir,Buffer.concat([png,Buffer.alloc(512*1024)])),before=structuredClone(imported.items);
  assert.throws(()=>Wardrobe.importItems(imported.items,[{...draft,image:tooLarge}],{dataDir:dir}),{code:'VALIDATION'});assert.deepEqual(imported.items,before);
  assert.throws(()=>Wardrobe.upsertItem(imported.items,{id:imported.items[0].id,image:'/api/media/'+'0'.repeat(64)+'.png'},{dataDir:dir}),/无法读取/);
});
