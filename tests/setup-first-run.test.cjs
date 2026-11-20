// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const password='Isolated-first-run-password';
async function fixture(t,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-first-run-'));let app,origin,cookie='';
  async function start(){app=createApp({dataDir,host:'127.0.0.1',port:0,resetPassword:false,requireSetupToken:false,...options});await app.listen();origin='http://127.0.0.1:'+app.server.address().port;}
  await start();t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {dataDir,get app(){return app;},async restart(){await app.close();await start();},async request(route,body,headers={}){
    const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Cookie:cookie,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,value:await response.json(),headers:response.headers};
  }};
}
for(const trustProxy of ['', 'loopback'])test('default first setup accepts forwarded remote access without token: '+(trustProxy||'disabled proxy'),async t=>{
  const f=await fixture(t,{trustProxy}),headers={'X-Forwarded-For':'198.51.100.9','X-Forwarded-Proto':'https'};
  const status=await f.request('/api/status');assert.equal(status.value.setupTokenRequired,false);assert.equal(status.value.setupRequired,true);
  assert.equal(fs.existsSync(path.join(f.dataDir,'setup-token.txt')),false);
  const result=await f.request('/api/setup',{displayName:'First profile',password},headers);assert.equal(result.status,200);assert.equal(result.value.state.profile.name,'First profile');
  assert.equal(/; Secure/.test(result.headers.get('set-cookie')),Boolean(trustProxy));
  assert.equal((await f.request('/api/setup',{password})).status,409);
  const before=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  await f.restart();assert.equal((await f.request('/api/state')).status,200);assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
  assert.equal((await f.request('/api/login',{password})).status,200);
});
test('concurrent first setup creates only the winning account',async t=>{
  const f=await fixture(t),attempts=[{password,displayName:'Winner A'},{password:password+'-B',displayName:'Winner B'}];
  const results=await Promise.all(attempts.map(body=>f.request('/api/setup',body)));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const winner=results.findIndex(result=>result.status===200),loser=1-winner;
  assert.equal((await f.request('/api/state')).value.profile.name,attempts[winner].displayName);
  assert.equal((await f.request('/api/login',{password:attempts[loser].password})).status,401);
  assert.equal((await f.request('/api/login',{password:attempts[winner].password})).status,200);
});
test('legacy unused setup token does not block default setup and is consumed',async t=>{
  const f=await fixture(t),token='legacy-unused-token',tokenFile=path.join(f.dataDir,'setup-token.txt');
  f.app.db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('setupToken',token);fs.writeFileSync(tokenFile,token+'\n');
  await f.restart();assert.equal((await f.request('/api/status')).value.setupTokenRequired,false);
  assert.equal((await f.request('/api/setup',{password},{'X-Forwarded-For':'198.51.100.3'})).status,200);
  assert.equal(f.app.db.prepare("SELECT value FROM meta WHERE key='setupToken'").get().value,'');assert.equal(fs.existsSync(tokenFile),false);
});
test('explicit token protection rejects missing and wrong tokens and consumes the correct one',async t=>{
  const f=await fixture(t,{requireSetupToken:true,trustProxy:'loopback'}),tokenFile=path.join(f.dataDir,'setup-token.txt'),token=fs.readFileSync(tokenFile,'utf8').trim();
  assert.equal((await f.request('/api/status')).value.setupTokenRequired,true);assert.match(token,/^[a-f0-9]{48}$/);
  for(const setupToken of [undefined,'wrong']){const result=await f.request('/api/setup',{password,setupToken});assert.equal(result.status,403);assert.equal(result.value.code,'SETUP_TOKEN');}
  assert.equal((await f.request('/api/setup',{password,setupToken:token})).status,200);assert.equal(fs.existsSync(tokenFile),false);
  assert.equal((await f.request('/api/setup',{password,setupToken:token})).status,409);
});
