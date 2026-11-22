// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../lib/state.cjs'),N=require('../lib/android-notifications.cjs');
const {createApp}=require('../server.cjs');

function state(){
  const value=S.initial();S.apply(value,'role.save',{name:'隔离好友'});
  value.settings.modules.outreach={quietHoursEnabled:false,quietStart:'22:00',quietEnd:'08:00'};
  value.roles[0].unread=5;
  return value;
}
function add(value,id,createdAt,extra={}){
  value.messages.push({id,roleId:value.roles[0].id,sender:'assistant',status:'sent',type:'text',content:'正文不应发往通知接口',createdAt,...extra});
}

test('first connection establishes a baseline; same-millisecond delivery and reconnect do not drop or duplicate messages',()=>{
  const value=state();add(value,'old',1000);
  const first=N.view(value,null,1000);assert.deepEqual(first.messages,[]);
  add(value,'new',1000);
  const next=N.view(value,first.cursor,1000);assert.deepEqual(next.messages.map(item=>item.id),['new']);
  assert.deepEqual(N.view(value,next.cursor,1001).messages,[]);
  add(value,'later',1002);
  assert.deepEqual(N.view(value,next.cursor,1003).messages.map(item=>item.id),['later']);
});

test('only committed incoming unread messages can notify; muted, expired, pending and outgoing messages are excluded',()=>{
  const value=state(),first=N.view(value,null,1);
  add(value,'expired',2);add(value,'fresh',N.lifetimeMs);
  add(value,'pending',N.lifetimeMs,{status:'pending'});
  add(value,'outgoing',N.lifetimeMs,{sender:'user'});
  add(value,'system',N.lifetimeMs,{sender:'system'});
  add(value,'pat',N.lifetimeMs,{sender:'system',meta:{kind:'pat',author:value.roles[0].id}});
  const now=N.lifetimeMs+3,result=N.view(value,first.cursor,now);
  assert.deepEqual(result.messages.map(item=>item.id),['fresh','pat']);
  value.roles[0].muted=true;
  assert.deepEqual(N.view(value,first.cursor,now).messages,[]);
  assert.equal(N.view(value,first.cursor,now).conversations[0].muted,true);
  value.roles[0].muted=false;value.roles[0].unread=0;
  assert.deepEqual(N.view(value,first.cursor,now).messages,[]);
  assert.equal(N.view(value,first.cursor,now).conversations[0].unread,0);
});

test('invalid notification cursors fail at the request boundary',()=>{
  for(const cursor of ['','+bad',Buffer.from('{"at":1,"ids":[true]}').toString('base64url')]){
    assert.throws(()=>N.view(state(),cursor,1000),/通知游标无效/);
  }
});

test('global quiet hours use the configured timezone and crossing midnight; blocked friends stay silent',()=>{
  const value=state(),at=Date.parse('2026-11-22T15:30:00Z');
  value.settings.timezone='Asia/Shanghai';
  value.settings.modules.outreach.quietHoursEnabled=true;
  const first=N.view(value,null,at-1);add(value,'night',at);
  assert.deepEqual(N.view(value,first.cursor,at).messages,[]);
  assert.equal(N.view(value,first.cursor,at).conversations[0].muted,true);
  value.settings.timezone='UTC';
  assert.equal(N.view(value,first.cursor,at).messages.length,1);
  value.roles[0].permissions.blocked=true;
  assert.deepEqual(N.view(value,first.cursor,at).messages,[]);
});

test('notification HTTP endpoint authenticates each check, returns metadata only and never mutates the stored state',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-android-notifications-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[]});
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'Isolated-Android-Notifications!',displayName:'隔离'})});
  assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0],session=await setup.json();
  const get=(route,authenticated=true)=>fetch(base+route,{headers:{Connection:'close',...(authenticated?{Cookie:cookie}:{})}});
  assert.equal((await get('/api/android/notifications',false)).status,401);
  const seeded=state();seeded.settings.ai.sources[0]&&(seeded.settings.ai.sources[0].key='never-send-key');
  seeded.revision=42;
  app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(seeded));
  const baseline=await (await get('/api/android/notifications')).json();
  const at=JSON.parse(Buffer.from(baseline.cursor,'base64url').toString()).at;
  add(seeded,'committed',at);seeded.revision++;
  app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(seeded));
  const before=app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  const response=await get('/api/android/notifications?cursor='+encodeURIComponent(baseline.cursor));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.messages.map(item=>item.id),['committed']);
  assert.deepEqual(Object.keys(result.messages[0]),['id','roleId','createdAt','expiresAt']);
  assert.deepEqual(Object.keys(result).sort(),['conversations','cursor','messages','revision']);
  assert.equal(JSON.stringify(result).includes('正文不应发往通知接口'),false);
  assert.equal(app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
  const logout=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:'{}'});
  assert.equal(logout.status,200);
  assert.equal((await get('/api/android/notifications?cursor='+encodeURIComponent(result.cursor))).status,401);
});
