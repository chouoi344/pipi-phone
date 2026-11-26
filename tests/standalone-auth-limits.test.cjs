// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const PASSWORD='Standalone-fixture-only';
async function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-standalone-auth-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',resetPassword:false,providerUrlAllowlist:[]});
  await app.listen();t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+app.server.address().port;
  const request=async(route,password=PASSWORD)=>{
    const response=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({password})});
    return {status:response.status,value:await response.json(),retryAfter:response.headers.get('retry-after')};
  };
  assert.equal((await request('/api/setup')).status,200);
  return request;
}
test('setup and repeated successful device logins do not consume the password failure quota',async t=>{
  const request=await fixture(t);
  for(let i=0;i<12;i++){const r=await request('/api/login');assert.equal(r.status,200,`correct login ${i+1}: ${JSON.stringify(r.value)}`);}
});
test('a successful login clears earlier wrong-password attempts',async t=>{
  const request=await fixture(t);
  for(let cycle=0;cycle<2;cycle++){
    for(let i=0;i<9;i++)assert.equal((await request('/api/login','wrong')).status,401);
    assert.equal((await request('/api/login')).status,200);
  }
});
test('ten wrong passwords still block login and report the real remaining wait',async t=>{
  const request=await fixture(t);
  for(let i=0;i<10;i++)assert.equal((await request('/api/login','wrong')).status,401,`wrong login ${i+1}`);
  const result=await request('/api/login');
  assert.equal(result.status,429);assert.equal(result.value.code,'RATE_LIMIT');
  assert.ok(result.value.retryAfter>0&&result.value.retryAfter<=900);
  assert.equal(Number(result.retryAfter),result.value.retryAfter);
});
test('parallel wrong passwords cannot race past the ten-failure allowance',async t=>{
  const request=await fixture(t);
  for(let i=0;i<9;i++)assert.equal((await request('/api/login','wrong')).status,401);
  const attempts=await Promise.all(Array.from({length:8},()=>request('/api/login','wrong')));
  assert.equal(attempts.filter(result=>result.status===401).length,1);
  assert.equal(attempts.filter(result=>result.status===429).length,7);
  assert.equal((await request('/api/login')).status,429);
});
