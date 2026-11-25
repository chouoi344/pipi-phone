// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const restoreWhenIdle=require('./fixtures/restore-when-idle.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {Readable}=require('node:stream'),{createApp}=require('../server.cjs'),Tar=require('../lib/tar-stream.cjs'),Media=require('../lib/media-store.cjs'),S=require('../lib/state.cjs');
const png=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/receipt.png')),password='Streaming-backup-isolated!';
function wav(){const b=Buffer.alloc(204);b.write('RIFF');b.writeUInt32LE(196,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(160,40);return b;}
async function fixture(t,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-streaming-backup-'));let now=Date.now(),app=createApp({dataDir,host:'127.0.0.1',port:0,mediaTimers:false,backupClock:()=>now,...options});
  t.after(async()=>{await app?.close();fs.rmSync(dataDir,{recursive:true,force:true});});await app.listen();const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function raw(route,body,{anonymous=false,headers={}}={}){return fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(anonymous?{}:{Cookie:cookie}),...(body===undefined?{}:{Origin:base,'X-CSRF-Token':csrf,'Content-Type':Buffer.isBuffer(body)?'application/x-tar':'application/json'}),...headers},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});}
  async function request(route,body,options){const response=await raw(route,body,options),value=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};}
  async function json(route,body){const r=await request(route,body);assert.equal(r.status,200,JSON.stringify(r.value));return r.value;}
  await json('/api/setup',{password,displayName:'备份前的名称'});
  const state=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);S.apply(state,'role.save',{name:'旧好友'});
  const image=Media.saveImage(dataDir,png),sound=Media.saveAudio(dataDir,wav());
  S.message(state,state.roles[0],'user',image,'image',{meta:{caption:'图片说明'}});S.message(state,state.roles[0],'user','语音正文','voice',{meta:{audio:sound,durationMs:30,transcript:'原语音转写'}});
  app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
  return {dataDir,app,base,raw,request,json,image,sound,get cookie(){return cookie;},get csrf(){return csrf;},advance(ms){now+=ms;},read:()=>app.db.prepare('SELECT json FROM app WHERE id=1').get().json,write:s=>app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(s)),async close(){await app.close();app=null;},async archive(includeKeys=true,includeMedia=true){const prepared=await json('/api/backup/prepare',{includeKeys,includeMedia}),response=await raw('/api/backup/download?token='+prepared.token);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,prepared.estimatedBytes);assert.equal(response.headers.get('content-length'),String(bytes.length));return {prepared,bytes};}};
}
async function entries(bytes){const result=[];await Tar.unpack(Readable.from([bytes]),async(entry,contents)=>{const chunks=[];for await(const chunk of contents)chunks.push(chunk);result.push({...entry,bytes:Buffer.concat(chunks)});});return result;}
async function pack(list){const chunks=[];for await(const chunk of Tar.pack(list.map(entry=>({name:entry.name,size:entry.bytes.length,open:()=>Readable.from([entry.bytes])}))))chunks.push(chunk);return Buffer.concat(chunks);}
function pendingFiles(f){return fs.readdirSync(path.join(f.dataDir,'.streaming-backup'));}

test('streaming TAR includes manifest first, exact Content-Length and valid file checksums, and restores full media independently',async t=>{
  const source=await fixture(t),target=await fixture(t),{bytes}=await source.archive(),files=await entries(bytes),manifest=JSON.parse(files[0].bytes);
  assert.equal((await source.json('/api/status')).streamingBackup,true);assert.equal(files[0].name,'manifest.json');assert.equal(files[1].name,'state.json.gz');assert.equal(manifest.includeKeys,true);assert.equal(manifest.includeMedia,true);
  for(const row of manifest.media){const file=files.find(entry=>entry.name==='media/'+row.name);assert.equal(file.bytes.length,row.size);assert.equal(crypto.createHash('sha256').update(file.bytes).digest('hex'),row.sha256);}
  const restored=await target.json('/api/restore/tar',bytes);assert.equal(restored.state.profile.name,'备份前的名称');assert.deepEqual(Media.resolveImageBytes(target.dataDir,source.image).buffer,png);assert.deepEqual(Media.resolveAudioBytes(target.dataDir,source.sound).buffer,wav());
  assert.equal(typeof restored.clearedModelKeys,'boolean');assert.ok(Number.isInteger(restored.restoredModelKeys));assert.deepEqual(pendingFiles(target),[]);
});

test('backup snapshots pin files and state after preparation, without locking user writes during the token wait',async t=>{
  const f=await fixture(t),prepared=await f.json('/api/backup/prepare',{includeKeys:false,includeMedia:true});
  await f.json('/api/action',{type:'profile.save',payload:{name:'准备后改名'}});
  const state=JSON.parse(f.read());state.messages=[];f.write(state);fs.unlinkSync(path.join(f.dataDir,'media',f.image.split('/').at(-1)));
  const response=await f.raw('/api/backup/download?token='+prepared.token);assert.equal(response.status,200);const files=await entries(Buffer.from(await response.arrayBuffer()));
  const snapshot=JSON.parse(require('node:zlib').gunzipSync(files.find(row=>row.name==='state.json.gz').bytes));assert.equal(snapshot.state.profile.name,'备份前的名称');assert.equal(snapshot.modelKeys,undefined);
  assert.deepEqual(files.find(row=>row.name==='media/'+f.image.split('/').at(-1)).bytes,png);
});

test('download tokens require the same session, are single-use and expire after five minutes',async t=>{
  const f=await fixture(t),p=await f.json('/api/backup/prepare',{includeKeys:false,includeMedia:false}),originalCookie=f.cookie;
  assert.equal((await f.raw('/api/backup/download?token='+p.token,undefined,{anonymous:true})).status,401);
  await f.json('/api/login',{password});assert.equal((await f.raw('/api/backup/download?token='+p.token)).status,403);
  const valid=await f.raw('/api/backup/download?token='+p.token,undefined,{headers:{Cookie:originalCookie}});assert.equal(valid.status,200);await valid.arrayBuffer();
  assert.equal((await f.raw('/api/backup/download?token='+p.token,undefined,{headers:{Cookie:originalCookie}})).status,403);
  const expired=await f.json('/api/backup/prepare',{includeKeys:false,includeMedia:false});f.advance(300001);
  assert.equal((await f.raw('/api/backup/download?token='+expired.token)).status,410);
});

test('text-only TAR marks missing chat media expired and preserves permanent references and transcript text',async t=>{
  const source=await fixture(t),target=await fixture(t),s=JSON.parse(source.read());
  s.profile.avatar=source.image;S.apply(s,'message.favorite',{id:s.messages[0].id});source.write(s);
  const {bytes}=await source.archive(false,false),files=await entries(bytes);assert.equal(files.length,2);
  // Remove this independent fixture's own matching files so references really are unavailable.
  for(const file of fs.readdirSync(path.join(target.dataDir,'media')))fs.unlinkSync(path.join(target.dataDir,'media',file));
  const result=await target.json('/api/restore/tar',bytes),image=result.state.messages.find(row=>row.type==='image'),voice=result.state.messages.find(row=>row.type==='voice');
  assert.equal(image.content,'');assert.equal(image.meta.expired.kind,'image');assert.equal(voice.meta.expired.kind,'voice');assert.equal(voice.meta.transcript,'原语音转写');assert.equal(voice.content,'语音正文');
  assert.equal(result.state.profile.avatar,source.image);assert.equal(result.state.favorites[0].content,source.image);
  assert.equal((await target.request('/api/action',{type:'profile.save',payload:{bio:'恢复后仍可修改'}})).status,200);
});

test('corrupted, truncated and unsafe TAR uploads preserve current data and release their storage lock',async t=>{
  const source=await fixture(t),target=await fixture(t),{bytes}=await source.archive(),before=target.read(),list=await entries(bytes);
  const broken=list.map(row=>({...row,bytes:Buffer.from(row.bytes)}));broken.find(row=>row.name.startsWith('media/')).bytes[0]^=1;
  for(const upload of [await pack(broken),bytes.subarray(0,bytes.length/2),await pack([{name:'../outside',bytes:Buffer.from('x')}])]){
    const response=await restoreWhenIdle(()=>target.request('/api/restore/tar',upload));assert.equal(response.status,400);assert.equal(target.read(),before);assert.deepEqual(pendingFiles(target),[]);
    const probe=await target.json('/api/backup/prepare',{includeKeys:false,includeMedia:false});const download=await target.raw('/api/backup/download?token='+probe.token);await download.arrayBuffer();
  }
  assert.equal((await target.raw('/api/restore/tar',bytes,{headers:{'X-CSRF-Token':''}})).status,403);
});

test('inactivity interrupts an authenticated unfinished upload without changing data or retaining temporary files',async t=>{
  const f=await fixture(t,{backupInactivityMs:60}),before=f.read();
  await new Promise((resolve,reject)=>{
    const req=http.request(f.base+'/api/restore/tar',{method:'POST',headers:{Cookie:f.cookie,Origin:f.base,'X-CSRF-Token':f.csrf,'Content-Type':'application/x-tar','Content-Length':10000}},res=>{res.resume();res.once('end',resolve);});
    req.once('error',resolve);req.write(Buffer.alloc(64));
    const timer=setTimeout(()=>{req.destroy();reject(new Error('inactivity timeout did not run'));},1500);timer.unref();req.once('close',()=>clearTimeout(timer));
  });
  for(let i=0;i<20&&pendingFiles(f).length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.read(),before);assert.deepEqual(pendingFiles(f),[]);assert.equal((await f.request('/api/backup/prepare',{includeKeys:false,includeMedia:false})).status,200);
});

test('JSON and raw-memory requests opened before a restore cannot commit after its lock is acquired',async t=>{
  const source=await fixture(t),target=await fixture(t),{bytes}=await source.archive();
  function slow(route,body,type){
    let request;
    const result=new Promise((resolve,reject)=>{
      request=http.request(target.base+route,{method:'POST',headers:{Cookie:target.cookie,Origin:target.base,'X-CSRF-Token':target.csrf,'Content-Type':type,'Content-Length':Buffer.byteLength(body)}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks))}));});request.on('error',reject);request.write(body.slice(0,2));
    });
    return {result,finish(){request.end(body.slice(2));}};
  }
  const oldAction=slow('/api/action',JSON.stringify({type:'profile.save',payload:{name:'不应写入'}}),'application/json');
  const oldMemory=slow('/api/engine/memory/import?mode=preview&format=json','[{"content":"迟到的记忆"}]','application/json');
  let upload;
  const restored=new Promise((resolve,reject)=>{upload=http.request(target.base+'/api/restore/tar',{method:'POST',headers:{Cookie:target.cookie,Origin:target.base,'X-CSRF-Token':target.csrf,'Content-Type':'application/x-tar','Content-Length':bytes.length}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks))}));});upload.on('error',reject);upload.write(bytes.subarray(0,512));});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await target.request('/api/action',{type:'profile.save',payload:{name:'新的写入'}})).status,409);
  oldAction.finish();oldMemory.finish();assert.equal((await oldAction.result).status,409);assert.equal((await oldMemory.result).status,409);
  upload.end(bytes.subarray(512));assert.equal((await restored).status,200);assert.equal(JSON.parse(target.read()).profile.name,'备份前的名称');
});

test('an in-progress binary media upload prevents restore from racing its canonical-file commit',async t=>{
  const source=await fixture(t),target=await fixture(t),{bytes}=await source.archive();let upload;
  const result=new Promise((resolve,reject)=>{upload=http.request(target.base+'/api/media/upload',{method:'POST',headers:{Cookie:target.cookie,Origin:target.base,'X-CSRF-Token':target.csrf,'Content-Type':'image/png','Content-Length':png.length}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});upload.on('error',reject);upload.write(png.subarray(0,8));});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await target.request('/api/restore/tar',bytes)).status,409);
  upload.end(png.subarray(8));assert.equal(await result,200);assert.equal((await target.request('/api/restore/tar',bytes)).status,200);
});

test('file promotion only reserves new space when a real copy is required',async t=>{
  const f=await fixture(t),Streaming=require('../lib/streaming-backup.cjs'),name=f.image.split('/').at(-1),temp=path.join(f.dataDir,'promotion-source.png');fs.writeFileSync(temp,png);
  const received={files:new Map([[name,{name,size:png.length,sha256:crypto.createHash('sha256').update(png).digest('hex'),path:temp}]])},payload={state:{profile:{avatar:f.image}}};
  fs.unlinkSync(path.join(f.dataDir,'media',name));const checks=[];
  let rollback=await Streaming.merge(received,f.dataDir,payload,{checkSpace:bytes=>checks.push(bytes)});assert.deepEqual(checks,[0]);await rollback();
  const link=fs.promises.link;fs.promises.link=async()=>{throw Object.assign(new Error('isolated cross-device copy'),{code:'EXDEV'});};
  try{checks.length=0;rollback=await Streaming.merge(received,f.dataDir,payload,{checkSpace:bytes=>checks.push(bytes)});assert.deepEqual(checks,[0,png.length]);assert.deepEqual(fs.readFileSync(path.join(f.dataDir,'media',name)),png);await rollback();}finally{fs.promises.link=link;}
});

test('matching size and hash do not allow a PNG disguised with a JPEG suffix',async t=>{
  const source=await fixture(t),target=await fixture(t),{bytes}=await source.archive(),list=await entries(bytes),manifest=JSON.parse(list[0].bytes),row=manifest.media.find(file=>file.name.endsWith('.png'));
  const old=row.name;row.name=old.replace(/\.png$/,'.jpg');list.find(file=>file.name==='media/'+old).name='media/'+row.name;
  list[0].bytes=Buffer.from(JSON.stringify(manifest));const before=target.read(),response=await target.request('/api/restore/tar',await pack(list));
  assert.equal(response.status,400);assert.equal(target.read(),before);assert.deepEqual(pendingFiles(target),[]);
});

test('TAR restores long-term memory and optional keys with both databases returned to WAL',async t=>{
  const source=await fixture(t),target=await fixture(t),Memory=require('../lib/engine/memory-store.cjs'),state=JSON.parse(source.read()),roleId=state.roles[0].id;
  state.settings.ai.sources.find(row=>row.id==='pipi').key='DUMMY_TAR_PRIVATE_KEY';
  const card=Memory.upsertCard(source.dataDir,state,roleId,{content:'完整保留的独立长期记忆'});Memory.saveProfile(source.dataDir,state,roleId,{preferences:{爱好:'陶艺'}});source.write(state);
  const noKeys=await source.archive(false,true),payload=JSON.parse(require('node:zlib').gunzipSync((await entries(noKeys.bytes)).find(row=>row.name==='state.json.gz').bytes));assert.equal(JSON.stringify(payload).includes('DUMMY_TAR_PRIVATE_KEY'),false);
  const {bytes}=await source.archive(true,true),result=await target.json('/api/restore/tar',bytes);assert.equal(result.restoredModelKeys,1);
  assert.equal(Memory.getCard(target.dataDir,JSON.parse(target.read()),roleId,card.id).content,'完整保留的独立长期记忆');assert.deepEqual(Memory.getProfile(target.dataDir,JSON.parse(target.read()),roleId).preferences.爱好,['陶艺']);
  assert.equal(target.app.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(target.app.db.prepare('PRAGMA database_list').all().some(row=>row.name==='memory_backup'),false);
});

test('closing while a snapshot is preparing cancels it and removes its temporary directory',async t=>{
  const f=await fixture(t),link=fs.promises.link;let release,entered;
  const reached=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  fs.promises.link=async(...args)=>{entered();await gate;return link(...args);};
  try{
    const request=f.raw('/api/backup/prepare',{includeKeys:false,includeMedia:true}).then(response=>response.arrayBuffer()).catch(()=>{});
    await reached;const closing=f.close();release();await closing;await request;
    assert.deepEqual(pendingFiles(f),[]);
  }finally{fs.promises.link=link;release?.();}
});
