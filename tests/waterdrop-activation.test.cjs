// SPDX-License-Identifier: MIT
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const {normalizeInstallationId,verifyCode}=require('../lib/waterdrop-activation.cjs');
const fixture=require('./fixtures/waterdrop-activation.cjs');
test('waterdrop signature is canonical and bound to installation',()=>{
  const {publicKey,code,installationId:id}=fixture;
  assert.equal(normalizeInstallationId(id.toUpperCase()),id);
  assert.equal(normalizeInstallationId(' '+id),null);
  assert.equal(verifyCode(id,code,publicKey),true);
  assert.equal(verifyCode(fixture.otherInstallationId,code,publicKey),false);
  assert.equal(verifyCode(id,code,fixture.rotatedPublicKey),false);
  assert.equal(verifyCode(id,code+'=',publicKey),false);
  assert.equal(verifyCode(id,'PIPI-W1-'+'_'.repeat(86),publicKey),false);
  assert.equal(Object.hasOwn(require('../lib/waterdrop-activation.cjs'),'signCode'),false);
});
test('isolated setup, auth, activation, restore, restart and key rotation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-waterdrop-'));
  const {publicKey,code}=fixture;
  const pem=publicKey,apps=new Set();
  t.after(async()=>{
    for(const app of apps)await app.close();
    // Only this test's randomly created directory is removed.
    fs.rmSync(root,{recursive:true,force:true});
  });
  async function launch(name,key=pem){
    const dataDir=path.join(root,name);
    if(!fs.existsSync(path.join(dataDir,'pipi.sqlite')))fixture.seedInstallation(dataDir,name==='b'?fixture.otherInstallationId:fixture.installationId);
    const app=createApp({dataDir,waterdropPublicKey:key});apps.add(app);
    await app.listen(0,'127.0.0.1');
    const origin='http://127.0.0.1:'+app.server.address().port;
    let cookie='',csrf='';
    async function request(route,value,expected=200,extra={}){
      const response=await fetch(origin+route,{method:value===undefined?'GET':'POST',headers:{Cookie:cookie,...(value===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},body:value===undefined?undefined:JSON.stringify(value)});
      const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));
      if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      if(result.csrfToken)csrf=result.csrfToken;
      return result;
    }
    return {app,request,async close(){await app.close();apps.delete(app);}};
  }
  const a=await launch('a'),b=await launch('b');
  assert.equal((await a.request('/api/status')).appearance,undefined);
  await a.request('/api/appearance',undefined,401);
  const setupA=await a.request('/api/setup',{password:'test-password'});
  const setupB=await b.request('/api/setup',{password:'test-password'});
  const appearance=setupA.appearance;
  assert.equal(appearance.waterdropActivated,false);
  assert.notEqual(appearance.installationId,setupB.appearance.installationId);
  await a.request('/api/appearance/waterdrop',{code},403,{'X-CSRF-Token':'wrong'});
  await a.request('/api/appearance/waterdrop',{code:''},400);
  await a.request('/api/appearance/waterdrop',{code:'bad'},400);
  await b.request('/api/appearance/waterdrop',{code},400);
  const active={...appearance,waterdropActivated:true};
  assert.deepEqual(await a.request('/api/appearance/waterdrop',{code}),active);
  assert.deepEqual((await a.request('/api/status')).appearance,active);
  const backup=await a.request('/api/backup');
  assert.equal(JSON.stringify(backup).includes(code),false);
  await b.request('/api/restore',{backup,confirm:true});
  assert.deepEqual(await b.request('/api/appearance'),setupB.appearance);
  // Simultaneous app instances see the same persisted identity.
  const concurrent=await launch('a');
  assert.deepEqual((await concurrent.request('/api/login',{password:'test-password'})).appearance,active);
  await concurrent.close();await a.close();
  const restarted=await launch('a');
  assert.deepEqual((await restarted.request('/api/login',{password:'test-password'})).appearance,active);
  await restarted.close();
  const rotated=await launch('a',fixture.rotatedPublicKey);
  assert.deepEqual((await rotated.request('/api/login',{password:'test-password'})).appearance,appearance);
  // Simulate a pre-activation existing installation without replacing its app data.
  b.app.db.prepare("DELETE FROM meta WHERE key IN ('installationId','waterdropCode')").run();
  await b.close();
  const upgraded=await launch('b',publicKey);
  const login=await upgraded.request('/api/login',{password:'test-password'});
  assert.ok(normalizeInstallationId(login.appearance.installationId));
  assert.equal(login.appearance.waterdropActivated,false);
  assert.equal(login.state.profile.name,setupB.state.profile.name);
});
