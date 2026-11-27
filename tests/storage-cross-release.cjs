// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Run with PIPI_LEGACY_SERVER_ROOT pointing to the extracted v0.13.x source release.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const retryRestore=require('./fixtures/restore-when-idle.cjs');
const old=process.env.PIPI_LEGACY_SERVER_ROOT,current=path.resolve(__dirname,'..');

function syntheticState(root,dir){
  const S=require(path.join(root,'lib/state.cjs')),media=require(path.join(root,'lib/media-store.cjs'));
  const state=S.initial();S.apply(state,'role.save',{name:'跨版本测试好友'});
  const role=state.roles[0],text=S.message(state,role,'user','这条文字会被引用');
  const image=media.saveImage(dir,fs.readFileSync(path.join(current,'scripts/demo-assets/receipt.png')));
  const audio=media.saveAudio(dir,fs.readFileSync(path.join(current,'scripts/demo-assets/tone.mp3')));
  S.message(state,role,'user',image,'image',{meta:{caption:'测试图片'}});
  S.message(state,role,'user','测试语音','voice',{meta:{audio,durationMs:1000,transcript:'语音文字'}});
  S.apply(state,'wallet.transfer',{roleId:role.id,type:'redpacket',amountCents:123,requestId:S.id(),note:'测试红包'});
  const recall=S.message(state,role,'user','已撤回测试');S.apply(state,'message.recall',{id:recall.id});
  S.message(state,role,'assistant','引用文字','text',{meta:{quote:{messageId:text.id,type:'text',content:text.content,sender:'user'}}});
  S.apply(state,'message.forward',{targetRoleId:role.id,mode:'merged',ids:[text.id]});
  return state;
}
async function open(root,dir,initial){
  const {createApp}=require(path.join(root,'server.cjs'));
  const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,mediaTimers:false,initialState:initial});
  await app.listen();const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function call(route,body){
    const binary=Buffer.isBuffer(body);
    const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:origin,'X-CSRF-Token':csrf,'Content-Type':binary?'application/x-tar':'application/json'})},body:body===undefined?undefined:binary?body:JSON.stringify(body)});
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const value=(response.headers.get('content-type')||'').includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,value};
  }
  async function ok(route,body){
    const r=route.startsWith('/api/restore')?await retryRestore(()=>call(route,body)):await call(route,body);
    assert.equal(r.status,200,r.value?.error||route);return r.value;
  }
  const status=await ok('/api/status'),password='Version-cross-fixture-2026';
  await ok(status.setupRequired?'/api/setup':'/api/login',{displayName:'跨版本账户',password});
  return {ok,close:()=>app.close()};
}
async function bundle(server){
  const json=await server.ok('/api/backup');
  const prepared=await server.ok('/api/backup/prepare',{includeKeys:false,includeMedia:true});
  const tar=await server.ok('/api/backup/download?token='+prepared.token);
  assert.ok(Buffer.isBuffer(tar)&&tar.length>1024);
  return {json,tar};
}
async function tarContents(buffer){
  const files=new Map();
  const {Readable}=require('node:stream');
  const {unpack}=require('../lib/tar-stream.cjs');
  await unpack(Readable.from([buffer]),async(entry,stream)=>{
    const chunks=[];
    for await(const chunk of stream)chunks.push(chunk);
    files.set(entry.name,Buffer.concat(chunks));
  });
  const payload=JSON.parse(require('node:zlib').gunzipSync(files.get('state.json.gz')));
  delete payload.exportedAt;
  const manifest=JSON.parse(files.get('manifest.json'));
  files.delete('state.json.gz');files.delete('manifest.json');
  return {payload,media:files,mediaManifest:manifest.media};
}
// Successful restores issue new per-installation credential revision tokens.
function portable(state){
  const copy=structuredClone(state);
  for(const source of copy.settings.ai.sources)delete source.keyRevision;
  return copy;
}

test('old data reopens unchanged and JSON and TAR restore in both directions',async t=>{
  assert.ok(old,'Set PIPI_LEGACY_SERVER_ROOT to the extracted old version');
  assert.match(require(path.join(old,'package.json')).version,/^0\.13\./);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-s4-roundtrip-')),dir=path.join(temp,'original');
  fs.mkdirSync(dir);t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  let server=await open(old,dir,()=>syntheticState(old,dir));let original,oldBundle,newBundle;
  try{original=await server.ok('/api/state');oldBundle=await bundle(server);}finally{await server.close();}
  server=await open(current,dir);
  try{assert.deepEqual(await server.ok('/api/state'),original);newBundle=await bundle(server);}finally{await server.close();}
  const {exportedAt:oldTime,...oldPayload}=oldBundle.json;
  const {exportedAt:newTime,...newPayload}=newBundle.json;
  assert.deepEqual(newPayload,oldPayload);
  assert.deepEqual(await tarContents(newBundle.tar),await tarContents(oldBundle.tar));
  const expected=new Map();
  for(const [name,root,data] of [['old-control',old,oldBundle],['old-to-new',current,oldBundle],['new-to-old',old,newBundle]]){
    for(const format of ['json','tar']){
      const dest=await open(root,path.join(temp,name+'-'+format));
      try{
        await dest.ok(format==='tar'?'/api/restore/tar':'/api/restore',format==='tar'?data.tar:{confirm:true,backup:data.json});
        const state=await dest.ok('/api/state');
        assert.deepEqual(state.messages.map(m=>[m.id,m.type,m.content]),original.messages.map(m=>[m.id,m.type,m.content]));
        if(name==='old-control')expected.set(format,portable(state));
        else assert.deepEqual(portable(state),expected.get(format));
        for(const url of [state.messages.find(m=>m.type==='image').content,state.messages.find(m=>m.type==='voice').meta.audio]){
          const bytes=await dest.ok(url);assert.ok(bytes.length>100);
        }
      }finally{await dest.close();}
    }
  }
});
