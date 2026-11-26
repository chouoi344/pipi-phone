// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{setTimeout:wait}=require('node:timers/promises');
const publicRoot=path.resolve(__dirname,'../public'),isPublic=file=>typeof file==='string'&&path.resolve(file).startsWith(publicRoot+path.sep);
function freshAssets(){const key=require.resolve('../lib/android-assets.cjs');delete require.cache[key];return require(key);}
test('P2-13 public bundle fingerprint stays cached past the former 30 second expiry and concurrent callers',async t=>{
  const assets=freshAssets(),read=fs.readFile.bind(fs);let reads=0;
  t.mock.method(fs,'readFile',(...args)=>{if(isPublic(args[0]))reads++;return read(...args);});
  const first=await assets.manifest(),initialReads=reads;assert.ok(initialReads>0);
  const at=Date.now();t.mock.method(Date,'now',()=>at+60000);
  for(const result of await Promise.all(Array.from({length:20},()=>assets.manifest())))assert.deepEqual(result,first);
  assert.equal(reads,initialReads,'unauthenticated callers must not cause another full public scan');
});
test('P2-13 listen hashes before accepting requests, rejects a startup read error and reuses the successful value',async t=>{
  const assets=freshAssets(),{createApp}=require('../server.cjs'),read=fs.readFile.bind(fs),gate=Promise.withResolvers();let fail=true,held=false,reads=0;
  t.mock.method(fs,'readFile',async(...args)=>{if(isPublic(args[0])){reads++;if(fail){fail=false;throw Error('synthetic startup asset read failure');}if(!held){held=true;await gate.promise;}}return read(...args);});
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-assets-startup-')),app=createApp({dataDir,host:'127.0.0.1',port:0,mediaTimers:false,providerUrlAllowlist:[],resetPassword:false,updates:{updateDir:''},fcm:{credentialFile:''}});let starting;
  t.after(async()=>{gate.resolve();await starting?.catch(()=>{});await app.close();await fs.rm(dataDir,{recursive:true,force:true});});
  await assert.rejects(app.listen(),/synthetic startup asset read failure/);assert.equal(app.server.listening,false);
  starting=app.listen();for(let i=0;i<400&&!held;i++)await wait(5);assert.equal(held,true);assert.equal(app.server.listening,false,'requests cannot arrive before the one startup fingerprint is ready');
  gate.resolve();await starting;const initialReads=reads,base='http://127.0.0.1:'+app.server.address().port,expected=await assets.manifest();
  const at=Date.now();t.mock.method(Date,'now',()=>at+60000);
  for(let i=0;i<3;i++){const response=await fetch(base+'/api/android-shell-manifest');assert.equal(response.status,200);assert.equal((await response.json()).sha256,expected.sha256);}
  assert.equal(reads,initialReads,'running manifest requests must reuse the startup fingerprint');
});
