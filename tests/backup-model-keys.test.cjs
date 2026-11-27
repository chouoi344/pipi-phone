// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server.cjs');
const restoreWhenIdle=require('./fixtures/restore-when-idle.cjs');

test('opt-in model key backup is private and restores only to matching sources',async t=>{
  let providerRequests=0;
  const provider=http.createServer((req,res)=>{providerRequests++;res.writeHead(503).end();});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const providerOrigin='http://127.0.0.1:'+provider.address().port;
  const originalUrl=providerOrigin+'/original/v1',otherUrl=providerOrigin+'/different/v1';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-model-keys-http-'));
  const apps=[];
  t.after(async()=>{
    for(const app of apps)await app.close();
    if(path.dirname(dir)===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('pipi-model-keys-http-'))fs.rmSync(dir,{recursive:true,force:true});
  });

  async function launch(name){
    const app=createApp({dataDir:path.join(dir,name),host:'127.0.0.1',port:0,providerUrlAllowlist:[originalUrl,otherUrl]});
    apps.push(app);
    await app.listen();
    const origin='http://127.0.0.1:'+app.server.address().port;
    let cookie='',csrf='';
    async function request(route,body,{anonymous=false,headers={},expect=200}={}){
      const response=await fetch(origin+route,{
        method:body===undefined?'GET':'POST',
        headers:{...(!anonymous&&cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json',...(!anonymous&&csrf?{'X-CSRF-Token':csrf}:{})}),...headers},
        body:body===undefined?undefined:JSON.stringify(body),
        signal:AbortSignal.timeout(5000)
      });
      const value=await response.json();
      if(expect!==null)assert.equal(response.status,expect,value.error);
      if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      if(value.csrfToken)csrf=value.csrfToken;
      return {status:response.status,value,headers:response.headers};
    }
    await request('/api/setup',{displayName:name,password:'Model-key-HTTP-fixture-only!'});
    return {request};
  }
  const source=await launch('source'),target=await launch('target');
  const ids=['test-chat-group','test-voice-group'];
  const exportedKeys=['SYNTHETIC_SOURCE_CHAT_1234','SYNTHETIC_SOURCE_VOICE_5678'];
  const localKeys=['SYNTHETIC_TARGET_CHAT_9012','SYNTHETIC_TARGET_VOICE_3456'];
  const allKeys=[...exportedKeys,...localKeys];
  function noKeys(value){
    const serialized=JSON.stringify(value);
    for(const key of allKeys)assert.equal(serialized.includes(key),false);
  }
  async function configure(f,keys){
    const {value:{settings:{ai}}}=await f.request('/api/state');
    const revisions=new Map(ai.sources.map(source=>[source.id,source.keyRevision]));
    ai.sources=ai.sources.filter(item=>!ids.includes(item.id));
    for(const [i,id] of ids.entries()){
      ai.sources.push({id,name:'隔离服务商 '+i,baseUrl:originalUrl,template:'compatible',key:keys[i],keyRevision:revisions.get(id)});
    }
    const {value}=await f.request('/api/engine/models',{ai});
    noKeys(value);
  }
  const optIn={includeModelKeys:true};
  const {value:emptyBackup}=await target.request('/api/backup',optIn);
  assert.deepEqual(emptyBackup.modelKeys,[]);
  await configure(source,exportedKeys);
  noKeys((await source.request('/api/state')).value);
  noKeys((await source.request('/api/engine/config')).value);
  const {value:legacy}=await source.request('/api/backup');
  const {value:queryBackup}=await source.request('/api/backup?includeModelKeys=true');
  const {value:safePost}=await source.request('/api/backup',{includeModelKeys:false});
  for(const value of [legacy,queryBackup,safePost]){
    noKeys(value);
    assert.equal(Object.hasOwn(value,'modelKeys'),false);
  }
  for(const [body,options] of [
    [optIn,{anonymous:true,expect:401}],
    [optIn,{headers:{'X-CSRF-Token':'invalid'},expect:403}],
    [optIn,{headers:{Origin:'https://untrusted.invalid'},expect:403}],
    [{includeModelKeys:'true'},{expect:400}]
  ])noKeys((await source.request('/api/backup',body,options)).value);

  const {value:backup,headers}=await source.request('/api/backup',optIn);
  assert.equal(headers.get('cache-control'),'no-store');
  assert.match(headers.get('content-disposition'),/^attachment/);
  assert.equal(backup.version,legacy.version);
  assert.deepEqual(backup.modelKeys,ids.map((sourceId,i)=>({sourceId,baseUrl:originalUrl,key:exportedKeys[i]})));
  noKeys(backup.state);
  const restore=async(data,expect=200)=>{
    const result=await restoreWhenIdle(()=>target.request('/api/restore',{backup:data,confirm:true},{expect:null}));
    assert.equal(result.status,expect,result.value.error);
    return result;
  };
  const {value:before}=await target.request('/api/state');
  noKeys((await target.request('/api/restore',{backup,confirm:false},{expect:400})).value);
  const malformed=structuredClone(backup);
  malformed.modelKeys.push({...malformed.modelKeys[0],baseUrl:originalUrl+'/'});
  noKeys((await restore(malformed,400)).value);
  assert.deepEqual((await target.request('/api/state')).value,before);
  const {value:imported}=await restore(backup);
  noKeys(imported);
  assert.equal(imported.state.profile.name,'source');
  assert.equal(imported.restoredModelKeys,2);
  assert.equal(imported.skippedModelKeys,0);
  assert.deepEqual((await target.request('/api/backup',optIn)).value.modelKeys,backup.modelKeys);

  await configure(target,localKeys);
  const previousFormat=structuredClone(legacy);
  previousFormat.state.settings.ai.sources.find(item=>item.id===ids[0]).key=exportedKeys[0];
  const {value:previousRestored}=await restore(previousFormat);
  noKeys(previousRestored);
  assert.deepEqual((await target.request('/api/backup',optIn)).value.modelKeys,ids.map((sourceId,i)=>({sourceId,baseUrl:originalUrl,key:localKeys[i]})));

  const mismatched=structuredClone(backup);
  mismatched.modelKeys[0].baseUrl=otherUrl;
  mismatched.modelKeys.push({sourceId:'unlisted-fixture',baseUrl:originalUrl,key:exportedKeys[0]});
  const {value:partial}=await restore(mismatched);
  noKeys(partial);
  assert.equal(partial.restoredModelKeys,1);
  assert.equal(partial.skippedModelKeys,2);
  assert.deepEqual((await target.request('/api/backup',optIn)).value.modelKeys,[
    {sourceId:ids[0],baseUrl:originalUrl,key:localKeys[0]},
    backup.modelKeys[1]
  ]);
  const changedDestination=structuredClone(backup);
  changedDestination.state.settings.ai.sources.find(item=>item.id===ids[0]).baseUrl=otherUrl;
  const {value:changed}=await restore(changedDestination);
  noKeys(changed);
  assert.equal(changed.clearedModelKeys,true);
  assert.equal(changed.restoredModelKeys,1);
  assert.equal(changed.skippedModelKeys,1);
  assert.equal(changed.state.settings.ai.sources.find(item=>item.id===ids[0]).keySet,false);
  assert.deepEqual((await target.request('/api/backup',optIn)).value.modelKeys,[backup.modelKeys[1]]);
  assert.equal(providerRequests,0);
});
