// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs'),Media=require('../lib/media-store.cjs');
const png=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/receipt.png'));
const inlineImage='data:image/png;base64,'+png.toString('base64');
const clock=Date.UTC(2026,10,20,12),password='Isolated-migration-Password!';
const enough=()=>({size:20*1024**3,available:10*1024**3,reserve:500*1024**2});
function wav(){
  const b=Buffer.alloc(204);b.write('RIFF');b.writeUInt32LE(196,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(160,40);return b;
}
const inlineAudio='data:audio/wav;base64,'+wav().toString('base64');
function rootDirectory(){return fs.mkdtempSync(path.join(os.tmpdir(),'pipi-v0130-migration-'));}
async function launch(dataDir,{space=enough,now=clock}={}){
  const app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[],mediaMigrationSpace:space,mediaMigrationClock:()=>now});
  await app.listen();const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,body){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};
  }
  async function json(route,body){const response=await request(route,body);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
  return {app,dataDir,request,json,read:()=>app.db.prepare('SELECT json FROM app WHERE id=1').get().json,write:state=>app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state)),close:()=>app.close()};
}
async function seed(dataDir,{initialized=false,invalid=false,requestId}={}){
  const f=await launch(dataDir);
  if(initialized)await f.json('/api/setup',{password,displayName:'原账户'});
  const state=JSON.parse(f.read());
  S.apply(state,'role.save',{name:'旧好友'});const role=state.roles[0];
  state.profile.name='迁移前的姓名';state.profile.avatar=invalid?'data:image/png;base64,'+Buffer.from('invalid image bytes').toString('base64'):inlineImage;
  state.profile.cover=inlineImage;role.avatar=inlineImage;role.chatBackground=inlineImage;role.faceReferences=[inlineImage];role.stickers=[{id:'role-sticker',name:'旧好友表情',image:inlineImage}];
  state.stickers=[{id:'global-sticker',name:'旧表情',image:inlineImage,createdAt:clock-1000}];
  const image=S.message(state,role,'user',inlineImage,'image',{createdAt:clock-2000});
  S.message(state,role,'user','','voice',{createdAt:clock-1000,meta:{audio:inlineAudio,durationMs:20}});
  state.favorites.push({id:'old-favorite',messageId:image.id,type:'image',content:inlineImage,createdAt:clock});
  const protectedImage=Media.saveImage(dataDir,png);
  state.personas.push({id:'old-persona',name:'原身份',prompt:'保留的文字',avatar:protectedImage});
  S.defaults(state);
  f.write(state);
  if(requestId){
    const signature=crypto.createHash('sha256').update(JSON.stringify({roleId:role.id,text:'',img:inlineImage})).digest('hex');
    f.app.db.prepare('INSERT INTO requests(id,roleId,signature,messageId) VALUES(?,?,?,?)').run(requestId,role.id,signature,image.id);
  }
  const original=f.read();await f.close();
  return {original,state,roleId:role.id,protectedImage};
}
function backupFiles(dataDir){const directory=path.join(dataDir,'backups');return fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>/^before-0\.13\.0-.*\.json$/.test(name)):[];}
function checkMigrated(state,dataDir,old){
  const image=state.messages.find(row=>row.type==='image'),voice=state.messages.find(row=>row.type==='voice');
  for(const url of [state.profile.avatar,state.profile.cover,state.roles[0].avatar,state.roles[0].chatBackground,state.roles[0].faceReferences[0],state.roles[0].stickers[0].image,state.stickers[0].image,state.favorites[0].content,image.content]){
    assert.equal(Media.isMediaUrl(url),true,url);assert.deepEqual(Media.resolveImageBytes(dataDir,url).buffer,png);
  }
  assert.equal(Media.isAudioMediaUrl(voice.meta.audio),true);assert.deepEqual(Media.resolveAudioBytes(dataDir,voice.meta.audio).buffer,wav());assert.equal(voice.meta.durationMs,20);
  assert.equal(state.personas[0].avatar,old.protectedImage);assert.deepEqual(Media.resolveImageBytes(dataDir,old.protectedImage).buffer,png);
  assert.equal(JSON.stringify(state).includes('data:image/'),false);assert.equal(JSON.stringify(state).includes('data:audio/'),false);
}

for(const initialized of [false,true])test('startup migrates pre-generated legacy SQLite '+(initialized?'before an existing account logs in':'before first setup')+' and writes a restorable old JSON snapshot first',async t=>{
  const root=rootDirectory(),dataDir=path.join(root,'source'),old=await seed(dataDir,{initialized});let f;
  t.after(async()=>{await f?.close();fs.rmSync(root,{recursive:true,force:true});});
  f=await launch(dataDir);
  const files=backupFiles(dataDir);assert.equal(files.length,1);
  const archive=JSON.parse(fs.readFileSync(path.join(dataDir,'backups',files[0]),'utf8'));
  assert.equal(archive.format,'pipi-phone');assert.equal(archive.version,1);
  assert.equal(archive.state.profile.name,'迁移前的姓名');assert.equal(archive.state.profile.avatar,inlineImage);
  assert.equal(archive.state.messages.find(row=>row.type==='image').content,inlineImage);assert.equal(archive.state.messages.find(row=>row.type==='voice').meta.audio,inlineAudio);
  assert.equal(archive.state.personas[0].avatar,old.protectedImage);assert.ok(archive.media[old.protectedImage.split('/').at(-1)]);
  const beforeLogin=JSON.parse(f.read());checkMigrated(beforeLogin,dataDir,old);
  assert.equal((await f.request('/api/storage')).status,401);
  const status=await f.json('/api/status');assert.equal(status.setupRequired,!initialized);
  await f.json(initialized?'/api/login':'/api/setup',{password});
  const migration=(await f.json('/api/storage')).migration;
  assert.equal(migration.status,'complete');assert.equal(migration.backupName,files[0]);assert.ok(migration.migratedCount>0);assert.ok(migration.beforeBytes>migration.afterBytes);
  const final=f.read(),backupBytes=fs.readFileSync(path.join(dataDir,'backups',files[0]));
  await f.close();f=undefined;f=await launch(dataDir,{now:clock+60000});
  assert.equal(f.read(),final);assert.deepEqual(backupFiles(dataDir),files);assert.deepEqual(fs.readFileSync(path.join(dataDir,'backups',files[0])),backupBytes);
});

test('insufficient migration space preserves the exact old app JSON and protected file, then a later restart migrates once',async t=>{
  const root=rootDirectory(),dataDir=path.join(root,'source'),old=await seed(dataDir,{initialized:true});let f;
  t.after(async()=>{await f?.close();fs.rmSync(root,{recursive:true,force:true});});
  const low=()=>({size:1024**3,available:1,reserve:500*1024**2});
  f=await launch(dataDir,{space:low});assert.equal(f.read(),old.original);assert.deepEqual(backupFiles(dataDir),[]);
  await f.json('/api/login',{password});const skipped=(await f.json('/api/storage')).migration;
  assert.equal(skipped.status,'skipped');assert.match(skipped.detail,/空间/);assert.deepEqual(Media.resolveImageBytes(dataDir,old.protectedImage).buffer,png);
  await f.close();f=undefined;f=await launch(dataDir,{now:clock+60000});await f.json('/api/login',{password});
  assert.equal((await f.json('/api/storage')).migration.status,'complete');assert.equal(backupFiles(dataDir).length,1);checkMigrated(JSON.parse(f.read()),dataDir,old);
});

test('migration failure leaves old SQLite unchanged and retries with a new current backup after user data changes',async t=>{
  const root=rootDirectory(),dataDir=path.join(root,'source'),old=await seed(dataDir,{initialized:true,invalid:true});let f;
  t.after(async()=>{await f?.close();fs.rmSync(root,{recursive:true,force:true});});
  f=await launch(dataDir);assert.equal(f.read(),old.original);await f.json('/api/login',{password});
  const failed=(await f.json('/api/storage')).migration;assert.equal(failed.status,'failed');
  const firstFiles=backupFiles(dataDir);assert.equal(firstFiles.length,1);const first=fs.readFileSync(path.join(dataDir,'backups',firstFiles[0]));
  const latest=JSON.parse(f.read());latest.profile.avatar=inlineImage;latest.profile.name='失败后继续使用的资料';f.write(latest);
  await f.close();f=undefined;f=await launch(dataDir,{now:clock+60000});await f.json('/api/login',{password});
  const migration=(await f.json('/api/storage')).migration;assert.equal(migration.status,'complete');assert.notEqual(migration.backupName,firstFiles[0]);assert.equal(backupFiles(dataDir).length,2);
  const current=JSON.parse(fs.readFileSync(path.join(dataDir,'backups',migration.backupName),'utf8'));assert.equal(current.state.profile.name,'失败后继续使用的资料');assert.equal(current.state.profile.avatar,inlineImage);
  assert.deepEqual(fs.readFileSync(path.join(dataDir,'backups',firstFiles[0])),first);checkMigrated(JSON.parse(f.read()),dataDir,old);
});

test('a migration-before JSON backup restores to an independent initialized instance with all media bytes intact',async t=>{
  const root=rootDirectory(),sourceDir=path.join(root,'source'),targetDir=path.join(root,'target'),old=await seed(sourceDir,{initialized:true});let source,target;
  t.after(async()=>{await source?.close();await target?.close();fs.rmSync(root,{recursive:true,force:true});});
  source=await launch(sourceDir);const files=backupFiles(sourceDir);assert.equal(files.length,1);
  const backup=JSON.parse(fs.readFileSync(path.join(sourceDir,'backups',files[0]),'utf8'));
  target=await launch(targetDir);await target.json('/api/setup',{password});
  const restored=await target.json('/api/restore',{confirm:true,backup});assert.equal(restored.state.profile.name,'迁移前的姓名');
  checkMigrated(JSON.parse(target.read()),targetDir,old);
  const raw=target.read();await target.close();target=undefined;target=await launch(targetDir,{now:clock+60000});assert.equal(target.read(),raw);
});

test('old request signatures still deduplicate an inline-image retry after migration and reject changed content using the same ID',async t=>{
  const root=rootDirectory(),dataDir=path.join(root,'source'),requestId=crypto.randomUUID(),old=await seed(dataDir,{initialized:true,requestId});let f;
  t.after(async()=>{await f?.close();fs.rmSync(root,{recursive:true,force:true});});
  f=await launch(dataDir);await f.json('/api/login',{password});
  const before=JSON.parse(f.read()),body={roleId:old.roleId,text:'',image:inlineImage,requestId};
  const retried=await f.json('/api/chat/send',body);
  assert.equal(retried.accepted,undefined);assert.deepEqual(retried.state.messages.map(row=>row.id),before.messages.map(row=>row.id));
  assert.equal(JSON.parse(f.read()).messages.length,before.messages.length);
  const changed=await f.request('/api/chat/send',{...body,text:'不同的内容'});assert.equal(changed.status,409);assert.equal(changed.value.code,'REQUEST_REUSED');
  assert.deepEqual(JSON.parse(f.read()).messages.map(row=>row.id),before.messages.map(row=>row.id));
});

test('a legacy SQLite near 64MB migrates and its real old JSON restores without changing media bytes or other data',async t=>{
  const root=rootDirectory(),sourceDir=path.join(root,'source'),targetDir=path.join(root,'target');let source,target,state,backup;
  t.after(async()=>{await source?.close();await target?.close();fs.rmSync(root,{recursive:true,force:true});});
  source=await launch(sourceDir);await source.json('/api/setup',{password,displayName:'大资料原账户'});
  state=JSON.parse(source.read());S.apply(state,'role.save',{name:'大资料旧好友',prompt:'这段原有人设要完整保留'});const role=state.roles[0];
  state.profile.bio='保留原来的文字、设置和消息顺序';
  const hashes=new Map(),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  function oldImage(index){
    const text=Buffer.alloc(190*1024-png.length-12,120);text.write('padding\0'+String(index).padStart(4,'0'));
    const type=Buffer.from('tEXt'),chunk=Buffer.alloc(text.length+12);chunk.writeUInt32BE(text.length);type.copy(chunk,4);text.copy(chunk,8);chunk.writeUInt32BE(require('node:zlib').crc32(Buffer.concat([type,text])),chunk.length-4);
    return Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
  }
  for(let i=0;i<240;i++){
    const bytes=oldImage(i),m=S.message(state,role,'user','data:image/png;base64,'+bytes.toString('base64'),'image',{createdAt:clock-100000+i});
    hashes.set(m.id,digest(bytes));
  }
  for(let i=0;i<24;i++){
    const bytes=Buffer.alloc(64*1024,i+1);wav().copy(bytes);bytes.writeUInt32LE(bytes.length-8,4);bytes.writeUInt32LE(bytes.length-44,40);
    const m=S.message(state,role,'user','','voice',{createdAt:clock-1000+i,meta:{audio:'data:audio/wav;base64,'+bytes.toString('base64'),durationMs:4093}});
    hashes.set(m.id,digest(bytes));
  }
  function otherData(value){
    return JSON.stringify({...value,revision:0},(key,item)=>typeof item==='string'&&(/^data:(?:image|audio)\//.test(item)||Media.isMediaUrl(item)||Media.isAudioMediaUrl(item))?'[media]':item);
  }
  const beforeBytes=Buffer.byteLength(JSON.stringify(state)),beforeOther=otherData(state);
  assert.ok(beforeBytes>=55*1024**2&&beforeBytes<=62*1024**2,'old JSON bytes: '+beforeBytes);
  source.write(state);state=undefined;await source.close();source=undefined;
  source=await launch(sourceDir,{now:clock+60000});await source.json('/api/login',{password});
  const migration=(await source.json('/api/storage')).migration;assert.equal(migration.status,'complete');
  const upgraded=JSON.parse(source.read());assert.deepEqual(JSON.parse(otherData(upgraded)),JSON.parse(beforeOther),'migration must preserve every non-media field');
  const afterBytes=Buffer.byteLength(JSON.stringify(upgraded)),backupOther=otherData(S.backupState(upgraded));
  assert.ok(afterBytes<beforeBytes/20,'state should shrink after base64 moves out');
  function checkBytes(value,dataDir){
    assert.equal(value.messages.length,264);
    for(const m of value.messages){
      const bytes=m.type==='image'?Media.resolveImageBytes(dataDir,m.content)?.buffer:Media.resolveAudioBytes(dataDir,m.meta.audio)?.buffer;
      assert.ok(bytes,m.id);assert.equal(digest(bytes),hashes.get(m.id));
      assert.equal(m.meta?.thumb,undefined);assert.equal(m.meta?.modelImage,undefined);
    }
  }
  checkBytes(upgraded,sourceDir);
  const filename=path.join(sourceDir,'backups',migration.backupName);assert.ok(fs.statSync(filename).size<88*1024**2);
  backup=JSON.parse(fs.readFileSync(filename,'utf8'));assert.equal(backup.format,'pipi-phone');assert.equal(backup.version,1);
  assert.deepEqual(JSON.parse(otherData(backup.state)),JSON.parse(backupOther),'backup must preserve the normal backup representation of all non-media fields');assert.match(backup.state.messages[0].content,/^data:image\/png;base64,/);assert.match(backup.state.messages.at(-1).meta.audio,/^data:audio\/wav;base64,/);
  target=await launch(targetDir);await target.json('/api/setup',{password});await target.json('/api/restore',{confirm:true,backup});backup=undefined;
  function restoreMetadata(value){
    // Restore renews credential edit tokens and supplies the legacy zero persona revision.
    const result=JSON.parse(value);for(const source of result.settings.ai.sources)delete source.keyRevision;
    for(const role of result.roles)role.personaRevision??=0;
    return result;
  }
  const restored=JSON.parse(target.read());checkBytes(restored,targetDir);assert.deepEqual(restoreMetadata(otherData(S.backupState(restored))),restoreMetadata(backupOther),'restore must preserve all non-media values apart from its edit tokens and legacy defaults');
  assert.ok(Buffer.byteLength(JSON.stringify(restored))<beforeBytes/20);
  t.diagnostic('SQLite app JSON: '+beforeBytes+' → '+afterBytes+' bytes; 240 original PNGs and 24 WAVs preserved and restored');
});
