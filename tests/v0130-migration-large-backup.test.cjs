// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs'),Media=require('../lib/media-store.cjs');
const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=','base64');

test('a hybrid old state exceeding the JSON export limit is backed up as a restorable TAR before migration',async t=>{
  const tmp=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(tmp,'pipi-large-legacy-0130-'));
  const sourceDir=path.join(directory,'source'),targetDir=path.join(directory,'target');
  const apps=[];
  t.after(async()=>{
    for(const app of apps)await app.close();
    assert.equal(path.dirname(fs.realpathSync(directory)),tmp);
    assert.match(path.basename(directory),/^pipi-large-legacy-0130-/);
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const setup=()=>{
    const state=S.initial();
    S.apply(state,'role.save',{name:'升级隔离好友'});
    state.settings.modules.schedule={enabled:false,autoGenerate:false};
    return state;
  };
  const legacy=setup(),role=legacy.roles[0],media=Buffer.alloc(15*1024*1024);
  original.copy(media);
  const references=[];
  for(let index=0;index<5;index++){
    media.writeUInt32BE(index,media.length-4);
    const ref=Media.saveImage(sourceDir,media);
    references.push(ref);
    S.message(legacy,role,'user',ref,'image',{status:'sent'});
  }
  S.message(legacy,role,'user','data:image/png;base64,'+original.toString('base64'),'image',{status:'sent'});
  const smallRef='/api/media/'+crypto.createHash('sha256').update(original).digest('hex')+'.png';
  references.push(smallRef);
  const source=createApp({dataDir:sourceDir,initialState:()=>legacy,mediaTimers:false,port:0});
  apps.push(source);
  const migrated=JSON.parse(source.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  assert.deepEqual(migrated.messages.map(message=>message.content),references);
  const names=fs.readdirSync(path.join(sourceDir,'backups'));
  assert.equal(names.length,1);
  assert.match(names[0],/^before-0\.13\.0-.*\.tar$/);
  const backup=path.join(sourceDir,'backups',names[0]);

  const target=createApp({dataDir:targetDir,initialState:setup,mediaTimers:false,port:0});
  apps.push(target);
  const {port}=await target.listen(),base='http://127.0.0.1:'+port;
  const auth=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'Isolated-Legacy-Large-Backup!'})});
  assert.equal(auth.status,200);
  const cookie=auth.headers.get('set-cookie').split(';')[0],{csrfToken}=await auth.json();
  const restored=await fetch(base+'/api/restore/tar',{method:'POST',duplex:'half',headers:{Origin:base,Cookie:cookie,'X-CSRF-Token':csrfToken,'Content-Type':'application/x-tar','Content-Length':String(fs.statSync(backup).size)},body:fs.createReadStream(backup)});
  const response=await restored.json();
  assert.equal(restored.status,200,JSON.stringify(response));
  assert.deepEqual(response.state.messages.map(message=>message.content),references);
  for(const ref of references){
    const filename=ref.split('/').at(-1),hash=crypto.createHash('sha256');
    for await(const chunk of fs.createReadStream(path.join(targetDir,'media',filename)))hash.update(chunk);
    assert.equal(hash.digest('hex'),filename.slice(0,-4));
  }
});
