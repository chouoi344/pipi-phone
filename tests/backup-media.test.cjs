// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../scripts/sample-data.cjs');
const MemoryStore=require('../lib/engine/memory-store.cjs');

test('complete backup restores images and the full memory history to an independent instance and accepts legacy JSON',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-portable-backup-'));
  const apps=[];
  t.after(async()=>{
    for(const app of apps)await app.close();
    if(path.dirname(dir)===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('pipi-portable-backup-'))fs.rmSync(dir,{recursive:true,force:true});
  });
  async function launch(name){
    const dataDir=path.join(dir,name),app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[]});
    apps.push(app);
    await app.listen();
    const base='http://127.0.0.1:'+app.server.address().port;
    let cookie='',csrf='';
    async function raw(url,body){
      const response=await fetch(base+url,{method:body===undefined?'GET':'POST',
        headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf})},
        body:body===undefined?undefined:JSON.stringify(body)});
      if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      return response;
    }
    async function json(url,body,status=200){
      const response=await raw(url,body),result=await response.json();
      assert.equal(response.status,status,JSON.stringify(result));
      if(result.csrfToken)csrf=result.csrfToken;
      return result;
    }
    const login=await json('/api/setup',{password:'Private-Test-Backup_2026!',displayName:name});
    return {app,dataDir,raw,json,roleId:login.state.roles[0].id};
  }

  const source=await launch('source'),target=await launch('target');
  const listed=await source.json('/api/engine/models/list',{sourceId:'pipi',kind:'chat'},422);
  assert.equal(listed.code,'PROVIDER_LOCAL_ONLY');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
  const {url}=await source.json('/api/media/upload',{image:'data:image/png;base64,'+png});
  const literal='/api/media/'+'0'.repeat(64)+'.png';
  await source.json('/api/action',{type:'role.save',payload:{id:source.roleId,avatar:url,cover:url,bio:literal,faceReferences:[url]}});
  await source.json('/api/engine/schedule',{roleId:source.roleId,action:'addWardrobe',item:{description:'测试外套',category:'外出',seasons:['春'],image:url}});
  const untouched=JSON.parse(source.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  untouched.settings.providers.tts.key='DUMMY_BACKUP_SECRET_SHOULD_NOT_EXPORT';
  for(let i=0;i<52;i++)MemoryStore.upsertCard(source.dataDir,untouched,source.roleId,{id:'only-side-'+i,content:'展览测试记忆'+i},{skipMirrorSync:i!==51});
  MemoryStore.upsertCard(source.dataDir,untouched,source.roleId,{id:'archived',content:'展览归档记忆',status:'archived'},{vector:[0.25,0.75]});
  MemoryStore.saveProfile(source.dataDir,untouched,source.roleId,{basic:{所在地:'苏州'}},Date.now());
  source.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(untouched));

  const backup=await source.json('/api/backup'),filename=url.split('/').at(-1);
  assert.equal(backup.version,1);
  assert.equal(JSON.stringify(backup).includes('DUMMY_BACKUP_SECRET_SHOULD_NOT_EXPORT'),false);
  assert.deepEqual(Object.keys(backup.media),[filename]);
  assert.deepEqual(backup.media[filename],{sha256:filename.split('.')[0],base64:png});
  assert.equal(backup.state.memories.length,50);
  assert.equal(backup.livingMemory.cards.length,53);
  assert.equal(backup.livingMemory.profiles.length,1);
  assert.equal((await target.raw(url)).status,404);
  const stale=structuredClone(backup);stale.media[filename].base64=Buffer.from('错误图片').toString('base64');
  await target.json('/api/restore',{backup:stale,confirm:true},400);
  await target.json('/api/restore',{backup:{...backup,media:{}},confirm:true},400);
  await target.json('/api/restore',{backup:{...backup,livingMemory:{version:2}},confirm:true},400);
  assert.equal((await target.raw(url)).status,404);
  assert.equal((await target.json('/api/state')).profile.name,'target');
  assert.equal((await target.json('/api/restore',{backup,confirm:true})).state.profile.name,'source');

  const restored=(await target.json('/api/state')).roles.find(role=>role.id===source.roleId);
  assert.deepEqual([restored.avatar,restored.cover,restored.faceReferences[0],restored.bio],[url,url,url,literal]);
  assert.equal((await target.json('/api/engine/schedule?roleId='+source.roleId)).view.wardrobe[0].image,url);
  const download=await target.raw(url);
  assert.equal(download.status,200);
  assert.equal(download.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(png,'base64'));
  assert.deepEqual((await target.json('/api/backup')).livingMemory,backup.livingMemory);
  const {media,livingMemory,...legacy}=backup;
  await target.json('/api/restore',{backup:legacy,confirm:true});
  assert.equal((await target.raw(url)).status,200);
});
