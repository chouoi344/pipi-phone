// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const DAY=86400000,PASSWORD='Synthetic-P0-3-session-only!';
async function fixture(t){
  let at=Date.parse('2026-11-25T12:00:00Z');t.mock.method(Date,'now',()=>at);
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-p0-3-session-')),app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[],mediaTimers:false,fcm:{credentialFile:''}});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,body,{otherCookie=cookie,otherCsrf=csrf}={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Cookie:otherCookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':otherCsrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json(),setCookie:response.headers.get('set-cookie')};
  }
  const setup=await request('/api/setup',{password:PASSWORD});assert.equal(setup.status,200);cookie=setup.setCookie.split(';')[0];csrf=setup.body.csrfToken;
  return {app,base,request,setup,get cookie(){return cookie;},get csrf(){return csrf;},advance(ms){at+=ms;},now:()=>at,expires:()=>app.db.prepare('SELECT expires FROM sessions ORDER BY expires DESC').get().expires};
}
test('P0-3 new sessions last 30 days; authenticated use after 24 hours renews the same token and cookie attributes',async t=>{
  const f=await fixture(t);assert.equal(f.expires(),f.now()+30*DAY);assert.match(f.setup.setCookie,/Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000/);
  f.advance(12*3600000);const early=await f.request('/api/account');assert.equal(early.status,200);assert.equal(early.setCookie,null);
  const old=f.expires();f.advance(13*3600000);const renewed=await f.request('/api/account');assert.equal(renewed.status,200);assert.equal(renewed.setCookie.split(';')[0],f.cookie);assert.equal(f.expires(),f.now()+30*DAY);assert.ok(f.expires()>old);
  assert.equal((await f.request('/api/account')).setCookie,null);
});
test('P0-3 daily authenticated use works for 60 days; 30 days of inactivity expires without resurrection',async t=>{
  const f=await fixture(t);
  for(let day=0;day<60;day++){f.advance(DAY+1000);const status=await f.request('/api/status');assert.equal(status.body.authenticated,true,'active day '+day);assert.equal(status.setCookie.split(';')[0],f.cookie);}
  f.advance(30*DAY+1);const expired=await f.request('/api/account');assert.equal(expired.status,401);assert.equal(expired.setCookie,null);assert.equal((await f.request('/api/status')).body.authenticated,false);
});
test('P0-3 existing valid seven-day sessions renew in place; revoked devices stay revoked after password change and revoke-others',async t=>{
  const f=await fixture(t);f.app.db.prepare('UPDATE sessions SET expires=?').run(f.now()+6*DAY);assert.equal((await f.request('/api/status')).setCookie.split(';')[0],f.cookie);assert.equal(f.expires(),f.now()+30*DAY);
  const login=await f.request('/api/login',{password:PASSWORD}),other=login.setCookie.split(';')[0];assert.notEqual(other,f.cookie);
  assert.equal((await f.request('/api/account/sessions/revoke',{})).status,200);assert.equal((await f.request('/api/account',undefined,{otherCookie:other})).status,401);
  const fresh=await f.request('/api/login',{password:PASSWORD}),device=fresh.setCookie.split(';')[0];
  const changed=await f.request('/api/account/password',{currentPassword:PASSWORD,newPassword:'Synthetic-new-password!',confirmPassword:'Synthetic-new-password!'});assert.equal(changed.status,200);assert.equal((await f.request('/api/account',undefined,{otherCookie:device})).status,401);assert.equal((await f.request('/api/account')).status,200);
});
test('P0-3 an existing SSE connection follows renewed database expiry and closes when the device is revoked',async t=>{
  const f=await fixture(t),controller=new AbortController();
  const stream=await fetch(f.base+'/api/events',{headers:{Cookie:f.cookie},signal:controller.signal});assert.equal(stream.status,200);const reader=stream.body.getReader();await reader.read();
  t.after(()=>{controller.abort();});
  const originalExpiry=f.expires();f.advance(29*DAY);assert.equal((await f.request('/api/account')).status,200);assert.ok(f.expires()>originalExpiry);
  f.advance(2*DAY);const saved=await f.request('/api/action',{type:'profile.save',payload:{name:'续期后仍有实时更新'}});assert.equal(saved.status,200);
  const next=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('SSE update timed out')),1500))]);assert.equal(next.done,false);assert.match(Buffer.from(next.value).toString(),/event: revision/);
  const other=await f.request('/api/login',{password:PASSWORD});assert.equal((await f.request('/api/account/sessions/revoke',{}, {otherCookie:other.setCookie.split(';')[0],otherCsrf:other.body.csrfToken})).status,200);
  const ended=await reader.read();assert.equal(ended.done,true);assert.equal((await f.request('/api/account')).status,401);
});

test('P0-3 rejected CSRF and foreign Origin requests never renew the session',async t=>{
  const f=await fixture(t),old=f.expires();f.advance(25*3600000);
  const csrf=await f.request('/api/action',{type:'profile.save',payload:{name:'must not change'}},{otherCsrf:'invalid'});assert.equal(csrf.status,403);assert.equal(csrf.setCookie,null);assert.equal(f.expires(),old);
  const denied=await fetch(f.base+'/api/action',{method:'POST',headers:{Cookie:f.cookie,Origin:'https://foreign.invalid','Content-Type':'application/json','X-CSRF-Token':f.csrf},body:JSON.stringify({type:'profile.save',payload:{name:'must not change'}})});assert.equal(denied.status,403);assert.equal(denied.headers.get('set-cookie'),null);assert.equal(f.expires(),old);
  const accepted=await f.request('/api/account');assert.equal(accepted.status,200);assert.ok(accepted.setCookie);assert.equal(f.expires(),f.now()+30*DAY);
});
