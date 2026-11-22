// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const {fingerprint}=require('../lib/android-assets.cjs');

test('bundle identity survives Git line endings but detects code and binary changes',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-bundle-lines-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const script=path.join(dir,'app.js'),image=path.join(dir,'icon.png');
  await fs.writeFile(script,'// 页面\nrun();\n');
  await fs.writeFile(image,Buffer.from([0,13,10,255]));
  const original=await fingerprint(dir);
  await fs.writeFile(script,'// 页面\r\nrun();\r\n');
  assert.deepEqual(await fingerprint(dir),original);
  await fs.writeFile(image,Buffer.from([0,10,255]));
  assert.notDeepEqual(await fingerprint(dir),original);
  await fs.writeFile(image,Buffer.from([0,13,10,255]));
  await fs.writeFile(script,'// 页面\r\nrun(1);\r\n');
  assert.notDeepEqual(await fingerprint(dir),original);
});

test('installed page bundle matches server and each authenticated session has its own cache scope',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-android-shell-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0});
  t.after(async()=>{await app.close();await fs.rm(dataDir,{recursive:true,force:true});});
  await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  const status=async cookie=>(await fetch(base+'/api/status',{headers:cookie?{Cookie:cookie}:{}})).json();
  const out=path.join(dataDir,'bundle.json');
  execFileSync(process.execPath,[path.resolve(__dirname,'../android/write-manifest.cjs'),out]);
  const bundled=JSON.parse(await fs.readFile(out,'utf8'));
  assert.match(bundled.sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(await (await fetch(base+'/api/android-shell-manifest')).json(),bundled);
  assert.equal((await status()).appSessionScope,undefined);
  const payload={displayName:'隔离检查',password:'Android-shell-local-test!'};
  async function login(route){
    const res=await fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(res.status,200);
    const cookie=res.headers.get('set-cookie').split(';')[0],body=await res.json();
    assert.match(body.appSessionScope,/^[a-f0-9]{64}$/);
    assert.notEqual(body.appSessionScope,body.csrfToken);
    assert.equal((await status(cookie)).appSessionScope,body.appSessionScope);
    return body.appSessionScope;
  }
  const first=await login('/api/setup');
  assert.notEqual(await login('/api/login'),first);
});
