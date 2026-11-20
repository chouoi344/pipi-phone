// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createApp}=require('../scripts/sample-data.cjs');
const S=require('../lib/state.cjs');
const Media=require('../lib/media-store.cjs');
const {day,cleanOrphans,mediaReferences}=require('../lib/media-retention.cjs');

const start=Date.parse('2026-11-01T00:00:00Z');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=','base64');
const wav=Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000','hex');
const bytes=tag=>Buffer.concat([png,Buffer.alloc(128,tag)]);
async function fixture(t){
  const temp=fs.realpathSync(os.tmpdir()),dataDir=fs.mkdtempSync(path.join(temp,'pipi-retention-0130-'));
  let now=start,free=2e9,cookie='',csrf='';
  const app=createApp({dataDir,port:0,mediaMigrationClock:()=>start,mediaClock:()=>now,mediaTimers:false,
    mediaDiskSpace:()=>({size:3e9,available:typeof free==='function'?free():free,reserve:1000})});
  t.after(async()=>{await app.close();assert.equal(path.dirname(fs.realpathSync(dataDir)),temp);fs.rmSync(dataDir,{recursive:true,force:true});});
  const {port}=await app.listen(),base='http://127.0.0.1:'+port;
  async function request(uri,body,{binary=false,status=200}={}){
    const headers={Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':binary?'image/png':'application/json','X-CSRF-Token':csrf})};
    const response=await fetch(base+uri,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
    const parsed=await response.json();
    assert.equal(response.status,status,JSON.stringify(parsed));
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(parsed.csrfToken)csrf=parsed.csrfToken;
    return parsed;
  }
  await request('/api/setup',{password:'Retention-Fake-Only!'});
  const read=()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  return {request,dataDir,read,bump:at=>{now=at;},space:value=>{free=value;},seed(fn){
    const state=read();
    const value=fn(state,state.roles[0]);
    state.revision++;
    app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
    return value;
  }};
}
function chat(state,role,type,content,at,meta={}){
  const message=S.message(state,role,'user',content,type,{status:'sent',meta});
  message.createdAt=at;
  return message;
}

test('shortening counts at the seven-day boundary; expiry retains captions, thumbnails, transcripts and independent favorites',async t=>{
  const f=await fixture(t);
  const original=Media.saveImage(f.dataDir,bytes(1)),thumb=Media.saveImage(f.dataDir,bytes(2));
  const audio=Media.saveAudio(f.dataDir,wav);
  const {photo,voice,quote}=f.seed((s,r)=>{
    const photo=chat(s,r,'image',original,start-day,{thumb,caption:'河边'});
    const voice=chat(s,r,'voice','',start-2*day,{audio,durationMs:200,transcript:'问候的语音'});
    const quote=chat(s,r,'text','附带引用',start,{quote:S.quote(s,r.id,voice.id)});
    S.apply(s,'message.favorite',{id:photo.id});
    return {photo,voice,quote};
  });
  await f.request('/api/storage/retention',{retention:90});
  f.bump(start+7*day-1);
  const early=await f.request('/api/storage/retention',{retention:7,preview:true});
  assert.deepEqual(early.affected,{images:0,voices:0,bytes:0});
  f.bump(start+7*day);
  const plan=await f.request('/api/storage/retention',{retention:7,confirmationToken:early.confirmationToken});
  assert.equal(plan.requiresConfirmation,true);assert.deepEqual(plan.affected,{images:1,voices:1,bytes:bytes(1).length+wav.length});
  const {state,storage}=await f.request('/api/storage/retention',{retention:7,confirmationToken:plan.confirmationToken});
  assert.equal(storage.retention,7);
  const imageAfter=state.messages.find(message=>message.id===photo.id),voiceAfter=state.messages.find(message=>message.id===voice.id);
  assert.equal(imageAfter.content,'');assert.equal(imageAfter.meta.thumb,thumb);assert.equal(imageAfter.meta.caption,'河边');
  assert.equal(imageAfter.meta.expired.kind,'image');assert.equal(voiceAfter.meta.expired.kind,'voice');
  assert.equal(voiceAfter.meta.audio,undefined);assert.equal(voiceAfter.meta.transcript,'问候的语音');
  assert.equal(state.messages.find(message=>message.id===quote.id).meta.quote.transcript,'问候的语音');
  assert.equal(state.favorites.find(item=>item.messageId===photo.id).content,original);
  assert.ok(Media.resolveImageBytes(f.dataDir,original));
  assert.equal((await f.request('/api/voice/transcribe',{messageId:voice.id},{status:409})).code,'MEDIA_EXPIRED');
  assert.equal((await f.request('/api/chat/retry',{messageId:photo.id},{status:409})).code,'MEDIA_EXPIRED');
});

test('disk pressure in permanent mode reclaims the oldest unpinned chat attachment and rejects an upload if all remaining files are pinned',async t=>{
  const f=await fixture(t);
  const pinned=Media.saveImage(f.dataDir,bytes(3)),oldest=Media.saveImage(f.dataDir,bytes(4)),later=Media.saveImage(f.dataDir,bytes(5));
  const files=[pinned,oldest,later].map(ref=>Media.describeMediaFile(f.dataDir,ref.split('/').at(-1)).path);
  for(const file of files)fs.utimesSync(file,new Date(start-10*day),new Date(start-10*day));
  f.seed((s,r)=>{
    const preserve=chat(s,r,'image',pinned,start-4*day);
    S.apply(s,'message.favorite',{id:preserve.id});
    chat(s,r,'image',oldest,start-3*day);
    chat(s,r,'image',later,start-2*day);
  });
  await f.request('/api/storage/retention',{retention:'forever'});
  const incoming=bytes(6);
  f.space(()=>1000+(fs.existsSync(files[1])?0:incoming.length));
  const upload=await f.request('/api/media/upload',incoming,{binary:true});
  assert.match(upload.url,/^\/api\/media\/.*\.png$/);
  assert.deepEqual(files.map(file=>fs.existsSync(file)),[true,false,true]);
  const status=await f.request('/api/storage');
  assert.equal(status.retention,'forever');assert.equal(status.lastEarlyCleanup.images,1);
  f.seed(s=>{const stillKept=s.messages.find(message=>message.content===later);S.apply(s,'message.favorite',{id:stillKept.id});});
  f.space(850);
  const failed=await f.request('/api/media/upload',bytes(7),{binary:true,status:507});
  assert.equal(failed.code,'DISK_SPACE');
  assert.ok(fs.existsSync(files[0])&&fs.existsSync(files[2]));
  assert.ok(!fs.readdirSync(path.join(f.dataDir,'media')).some(file=>file.endsWith('.tmp')));
});

test('orphan cleanup leaves bare filenames, memory links and freshly uploaded duplicates intact',async t=>{
  const f=await fixture(t);
  const urls=[8,9,10,11].map(tag=>Media.saveImage(f.dataDir,bytes(tag)));
  const names=urls.map(ref=>ref.split('/').at(-1));
  const paths=names.map(name=>Media.describeMediaFile(f.dataDir,name).path);
  for(const filename of paths)fs.utimesSync(filename,new Date(start-3*day),new Date(start-3*day));
  const incoming=await f.request('/api/media/upload',bytes(10),{binary:true});
  assert.equal(incoming.url,urls[2]);
  const references=mediaReferences({frames:[names[0]]},{cells:[{summary:'照片 '+urls[1]}]});
  assert.deepEqual(cleanOrphans(f.dataDir,references,start),{count:1,bytes:bytes(11).length});
  assert.deepEqual(paths.map(filename=>fs.existsSync(filename)),[true,true,true,false]);
});

test('pressure clears an older generated chat picture while keeping a life-album photograph',async t=>{
  const f=await fixture(t);
  const album=Media.saveImage(f.dataDir,bytes(12)),drawing=Media.saveImage(f.dataDir,bytes(13));
  const paths=[album,drawing].map(ref=>Media.describeMediaFile(f.dataDir,ref.split('/').at(-1)).path);
  for(const filename of paths)fs.utimesSync(filename,new Date(start-10*day),new Date(start-10*day));
  f.seed((state,role)=>{
    state.engine.data.selfie={photos:{[role.id]:[{id:'life-album-photo',image:album,createdAt:start-5*day}]}};
    state.engine.data.actions.roleMedia=[
      {id:'album-id',photoId:'life-album-photo',roleId:role.id,image:album,createdAt:start-5*day},
      {id:'drawing-id',roleId:role.id,image:drawing,createdAt:start-4*day}
    ];
    for(const [index,ref] of [album,drawing].entries()){
      S.message(state,role,'assistant',ref,'image',{status:'sent'}).createdAt=start-(5-index)*day;
    }
  });
  f.space(()=>1000+(fs.existsSync(paths[1])?0:bytes(14).length));
  await f.request('/api/media/upload',bytes(14),{binary:true});
  assert.deepEqual(paths.map(filename=>fs.existsSync(filename)),[true,false]);
  const state=f.read();
  assert.deepEqual(state.engine.data.actions.roleMedia.map(row=>row.id),['album-id']);
  assert.ok(state.messages.some(message=>message.content===album&&!message.meta?.expired));
  assert.ok(state.messages.some(message=>message.meta?.expired?.kind==='image'));
});

test('expired merged chat snapshots remove nested originals and retain their captions and transcripts',async t=>{
  const f=await fixture(t);
  const image=Media.saveImage(f.dataDir,bytes(15)),thumb=Media.saveImage(f.dataDir,bytes(16)),audio=Media.saveAudio(f.dataDir,wav);
  const merged=f.seed((state,role)=>chat(state,role,'forward','聊天记录',start,{entries:[
    {senderName:'好友',type:'image',content:image,meta:{thumb,caption:'河边照片'}},
    {senderName:'好友',type:'forward',content:'聊天记录',meta:{entries:[
      {senderName:'好友',type:'voice',content:'',meta:{audio,durationMs:1000,transcript:'语音原文'}}]}}
  ]}));
  await f.request('/api/storage/retention',{retention:90});
  f.bump(start+8*day);
  const plan=await f.request('/api/storage/retention',{retention:7,preview:true});
  assert.deepEqual(plan.affected,{images:1,voices:1,bytes:bytes(15).length+wav.length});
  const {state}=await f.request('/api/storage/retention',{retention:7,confirmationToken:plan.confirmationToken});
  const [photo,folder]=state.messages.find(row=>row.id===merged.id).meta.entries;
  assert.equal(photo.content,'');assert.equal(photo.meta.expired.kind,'image');
  assert.equal(photo.meta.thumb,thumb);assert.equal(photo.meta.caption,'河边照片');
  const [voice]=folder.meta.entries;
  assert.equal(voice.meta.expired.kind,'voice');assert.equal(voice.meta.audio,undefined);
  assert.equal(voice.meta.durationMs,1000);assert.equal(voice.meta.transcript,'语音原文');
});
