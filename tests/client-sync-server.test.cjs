// SPDX-License-Identifier: MIT
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs'),Registry=require('../lib/engine/registry.cjs'),Sync=require('../lib/client-sync.cjs');
const output=path.resolve(__dirname,'../outputs/integrated-optimization/batch-b/server');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let value=args[0];if(Array.isArray(value))value=value[0];if(typeof value==='number')value={port:value,host:typeof args[1]==='string'?args[1]:'localhost'};if(value&&typeof value==='object'&&value.port!==undefined)assert.ok(['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].includes(String(value.host||value.hostname||'localhost')),'Sync tests only allow loopback');return connect.apply(this,args);};
test.after(()=>{net.Socket.prototype.connect=connect;});
async function fixture(t,extra={}){
  fs.mkdirSync(output,{recursive:true});const dataDir=extra.dataDir||fs.mkdtempSync(path.join(output,'fixture-'));let seeded;
  function initialState(){const s=S.initial();for(const module of Registry.modules)if(module.settings.some(field=>field.key==='enabled'))s.settings.modules[module.id]={...Registry.values(s,module.id),enabled:false};
    S.apply(s,'role.save',{name:'Alpha'});S.apply(s,'role.save',{name:'Beta'});const [a,b]=s.roles;
    for(let i=0;i<13;i++)S.message(s,i%4===0?b:a,'user','record '+i,'text',{createdAt:Date.now(),status:'sent'});
    s.messages[2].content='find this old needle';s.messages[3].sender='assistant';s.messages[3].content='hello [消息编号：'+s.messages[1].id+'] [媒体ID：private]';
    s.messages[2].meta={quote:S.quote(s,a.id,s.messages[1].id)};
    s.engine.summaries[a.id]={text:'PRIVATE_SUMMARY',coveredUntil:1,updatedAt:2};s.engine.data.execution.fixtureSecret='PRIVATE_EXECUTION';s.engine.data.actions.roleMedia=[{id:randomUUID(),roleId:a.id,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=',prompt:'PRIVATE_ROLE_MEDIA',createdAt:Date.now()}];s.engine.data.memory.vectors={fixture:'PRIVATE_VECTOR'};s.settings.providers.chat.key='PRIVATE_PROVIDER_KEY';
    s.settings.ai.sources.push({id:'sync-probe',name:'Synthetic key only',baseUrl:'http://127.0.0.1:1/v1',key:'PRIVATE_AI_KEY',builtin:false,overrideKey:{destination:'synthetic',key:'PRIVATE_OVERRIDE_KEY'}});
    extra.seed?.(s);
    seeded=s;return s;}
  const app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',initialState,providerUrlAllowlist:['http://127.0.0.1:1/v1'],mediaTimers:false,resetPassword:false,updates:{updateDir:''},fcm:{credentialFile:''},...extra});
  let closed=false;const close=async()=>{if(!closed){closed=true;await app.close();}};t.after(close);await app.listen();const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  function request(route,body,headers={},anonymous=false){return new Promise((resolve,reject)=>{const payload=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body)),req=http.request(origin+route,{method:payload?'POST':'GET',headers:{Connection:'close',...(!anonymous?{Cookie:cookie}:{}),...(payload?{Origin:origin,'Content-Type':'application/json','Content-Length':payload.length,'X-CSRF-Token':csrf}:{}),...headers}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>{try{const bytes=Buffer.concat(chunks),value=String(response.headers['content-type']).includes('application/json')?JSON.parse(bytes):bytes;if(response.headers['set-cookie'])cookie=response.headers['set-cookie'][0].split(';')[0];if(value.csrfToken)csrf=value.csrfToken;resolve({status:response.statusCode,value});}catch(error){reject(error);}});});req.once('error',reject);req.end(payload);});}
  const password='Synthetic-sync-only-2026!';const status=await request('/api/status');assert.equal((await request(status.value.setupRequired?'/api/setup':'/api/login',{password})).status,200);
  const raw=()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  return {app,close,origin,request,dataDir,seeded,raw,action:(type,payload,headers)=>request('/api/action',{type,payload},headers),sync:cursor=>request('/api/sync'+(cursor?'?cursor='+encodeURIComponent(cursor):''))};
}
test('sync bootstrap is authenticated, advertises capabilities and contains only role heads with normal redaction',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/api/sync',undefined,{},true)).status,401);
  const status=(await f.request('/api/status')).value,manifest=(await f.request('/api/android-shell-manifest')).value;
  assert.deepEqual(status.clientProtocol,{name:'pipi-phone',version:1,features:['state-v1','chat-progress-v1','sync-v1','messages-v1','messages-global-search-v1']});assert.deepEqual(manifest.clientProtocol,status.clientProtocol);
  const response=await f.sync();assert.equal(response.status,200);const value=response.value;assert.equal(value.mode,'reset');assert.equal(value.schema,1);assert.equal(value.messageCoverage,'heads');assert.equal(value.state.messages.length,2);
  assert.deepEqual(value.state.messages.map(m=>m.id),f.raw().messages.filter((m,i,all)=>all.findLastIndex(x=>x.roleId===m.roleId)===i).map(m=>m.id));
  const serialized=JSON.stringify(value);for(const secret of ['PRIVATE_PROVIDER_KEY','PRIVATE_SUMMARY','PRIVATE_EXECUTION','PRIVATE_AI_KEY','PRIVATE_OVERRIDE_KEY','PRIVATE_ROLE_MEDIA','PRIVATE_VECTOR'])assert.ok(!serialized.includes(secret));
  fs.writeFileSync(path.join(output,'reset-example.json'),JSON.stringify(value,null,2));
  const legacy=(await f.request('/api/state')).value;assert.equal(legacy.messages.length,13);assert.equal((await f.request('/api/state?since='+legacy.revision)).value.unchanged,true);
});
test('delta settings response preserves legacy replies and carries deletion, recall and detached quotes',async t=>{
  const f=await fixture(t),start=(await f.sync()).value;assert.equal(start.mode,'reset');
  const old=await f.action('profile.save',{name:'first'});assert.ok(old.value.state);assert.equal(old.value.sync,undefined);
  const opted=await f.action('profile.save',{name:'second'},{'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':start.cursor});assert.equal(opted.status,200);assert.equal(opted.value.state,undefined);assert.equal(opted.value.sync.mode,'delta');assert.equal(opted.value.sync.changes.replace.profile.name,'second');assert.equal(opted.value.sync.fromRevision,start.revision);
  fs.writeFileSync(path.join(output,'delta-example.json'),JSON.stringify(opted.value,null,2));fs.writeFileSync(path.join(output,'examples.json'),JSON.stringify({reset:start,delta:opted.value},null,2));
  const messages=f.raw().messages,roleId=messages[1].roleId,source=messages[1],quoted=messages[2];
  await f.action('message.forward',{targetRoleId:roleId,ids:[source.id],mode:'merged'});const beforeRecall=(await f.sync(opted.value.sync.cursor)).value;
  assert.equal(beforeRecall.mode,'delta');assert.equal(beforeRecall.changes.upsertMessages.length,1);
  await f.action('message.recall',{id:source.id});const recalled=(await f.sync(beforeRecall.cursor)).value;
  assert.equal(recalled.changes.upsertMessages.find(m=>m.id===source.id).meta.kind,'recalled');assert.deepEqual(recalled.changes.deleteMessageIds,[]);
  assert.equal(recalled.changes.upsertMessages.find(m=>m.id===quoted.id).meta.quote.unavailable,'recalled');assert.equal(recalled.changes.upsertMessages.find(m=>m.id===quoted.id).meta.quote.messageId,undefined);
  await f.action('message.delete',{id:quoted.id});const deleted=(await f.sync(recalled.cursor)).value;assert.ok(deleted.changes.deleteMessageIds.includes(quoted.id));assert.ok(!deleted.changes.upsertMessages.some(m=>m.id===quoted.id));
  const stable=(await f.sync(deleted.cursor)).value;assert.deepEqual(stable.changes,{upsertMessages:[],deleteMessageIds:[],replace:{}});
});
test('read receipts and favorites change metadata while thumbnail edits still reach other devices',async t=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
  const f=await fixture(t,{seed(s){s.roles[0].unread=4;S.message(s,s.roles[0],'user',image,'image',{status:'sent'});}});
  const roleId=f.raw().roles[0].id,media=f.raw().messages.at(-1),start=(await f.sync()).value;
  const read=await f.action('conversation.read',{roleId},{'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':start.cursor});assert.equal(read.status,200);
  assert.equal(read.value.sync.changes.replace.roles.find(role=>role.id===roleId).unread,0);
  assert.deepEqual(read.value.sync.changes.upsertMessages,[]);assert.deepEqual(read.value.sync.changes.deleteMessageIds,[]);
  const favorite=await f.action('message.favorite',{id:media.id},{'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':read.value.sync.cursor});assert.equal(favorite.status,200);
  assert.equal(favorite.value.sync.changes.replace.favorites.at(-1).messageId,media.id);assert.deepEqual(favorite.value.sync.changes.upsertMessages,[]);
  const thumb=await f.request('/api/chat/media/thumbnail',{messageId:media.id,thumb:image},{'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':favorite.value.sync.cursor});assert.equal(thumb.status,200,JSON.stringify(thumb.value));
  const changes=(await f.sync(favorite.value.sync.cursor)).value.changes;
  assert.deepEqual(changes.upsertMessages.map(message=>message.id),[media.id]);assert.equal(changes.upsertMessages[0].meta.thumb,f.raw().messages.at(-1).meta.thumb);
});
test('message pages preserve equal-time array order, protect roles and support old search and by-id references',async t=>{
  const f=await fixture(t),s=f.raw(),roleId=s.roles[0].id,all=s.messages.filter(m=>m.roleId===roleId),base='/api/messages?roleId='+roleId;
  const first=await f.request(base+'&limit=3');assert.equal(first.status,200);assert.deepEqual(first.value.messages.map(m=>m.id),all.slice(-3).map(m=>m.id));assert.equal(first.value.hasMore,true);
  const second=await f.request(base+'&limit=3&beforeId='+first.value.nextBeforeId);assert.deepEqual(second.value.messages.map(m=>m.id),all.slice(-6,-3).map(m=>m.id));
  const ids=[all[0].id,s.messages[0].id,randomUUID()],lookup=await f.request('/api/messages/by-id?roleId='+roleId+'&ids='+ids.join(','));assert.deepEqual(lookup.value.messages.map(m=>m.id),[all[0].id]);assert.deepEqual(lookup.value.missingIds,ids.slice(1));
  const found=await f.request('/api/messages/search?roleId='+roleId+'&q=old%20needle');assert.equal(found.value.messages.length,1);assert.equal(found.value.messages[0].content,'find this old needle');
  await f.action('message.delete',{id:first.value.nextBeforeId});const gone=await f.request(base+'&beforeId='+first.value.nextBeforeId);assert.equal(gone.status,409);assert.equal(gone.value.code,'MESSAGE_ANCHOR_GONE');
  const pageText=JSON.stringify((await f.request(base+'&limit=100')).value);assert.ok(!pageText.includes('[消息编号'));assert.ok(!pageText.includes('[媒体ID'));
  await f.action('role.save',{id:roleId,permissions:{blocked:true}});assert.equal((await f.request(base)).status,200);
});
test('global search pages across contacts and retains the public message format',async t=>{
  const f=await fixture(t),path='/api/messages/global-search?query=ReCoRd&limit=5';
  assert.equal((await f.request(path,undefined,{},true)).status,401);
  const expected=f.raw().messages.filter(m=>m.content.startsWith('record ')).reverse();
  const first=(await f.request(path)).value,second=(await f.request(path+'&beforeId='+first.nextBeforeId)).value;
  assert.deepEqual([...first.messages,...second.messages].map(m=>m.id),expected.slice(0,10).map(m=>m.id));
  assert.equal(first.hasMore,true);assert.ok(new Set(first.messages.map(m=>m.roleId)).size>1);
  assert.equal((await f.request('/api/messages/global-search?query=old%20needle')).value.messages[0].content,'find this old needle');
  assert.equal((await f.request('/api/messages/global-search?query=')).status,400);
  assert.equal((await f.request(path+'&beforeId='+randomUUID())).status,409);
});
test('paged login and sync report the true message count while older clients receive full login state',async t=>{
  const f=await fixture(t),headers={'X-Pipi-State-Mode':'delta','X-Pipi-Message-Coverage':'pages'},password='Synthetic-sync-only-2026!';
  const old=(await f.request('/api/login',{password})).value,count=old.state.messages.length;
  const login=(await f.request('/api/login',{password},headers)).value;
  assert.equal(login.state,undefined);assert.equal(login.sync.messageCount,count);assert.equal(login.sync.state.messages.length,2);
  await f.action('message.delete',{id:old.state.messages[0].id});
  const sync=(await f.request('/api/sync?cursor='+encodeURIComponent(login.sync.cursor),undefined,headers)).value;
  assert.equal(sync.messageCount,count-1);assert.equal((await f.sync()).value.messageCount,undefined);
});
test('invalid or future cursors reset explicitly and restarting invalidates a previous epoch',async t=>{
  const f=await fixture(t),initial=(await f.sync()).value;assert.equal(initial.mode,'reset');assert.equal((await f.sync('invalid')).value.reason,'invalid');
  const future=Buffer.from(JSON.stringify([initial.epoch,initial.revision+1])).toString('base64url');assert.equal((await f.sync(future)).value.reason,'ahead');
  await f.close();const reopened=await fixture(t,{dataDir:f.dataDir});const reset=(await reopened.sync(initial.cursor)).value;assert.equal(reset.mode,'reset');assert.equal(reset.reason,'epoch');assert.notEqual(reset.epoch,initial.epoch);
});
test('bounded history resets expired cursors, failed/CSRF writes do not advance the cursor, and concurrent writes are all represented',async t=>{
  const f=await fixture(t,{clientSync:{maxEntries:2}}),start=(await f.sync()).value;
  const denied=await f.action('profile.save',{name:'forbidden'},{'X-CSRF-Token':''});assert.equal(denied.status,403);assert.equal((await f.sync(start.cursor)).value.revision,start.revision);
  assert.equal((await f.action('message.delete',{id:randomUUID()})).status,404);assert.equal((await f.sync(start.cursor)).value.revision,start.revision);
  const writes=await Promise.all(['one','two','three'].map(name=>f.action('profile.save',{name})));assert.deepEqual(writes.map(row=>row.status),[200,200,200]);
  const expired=(await f.sync(start.cursor)).value;assert.equal(expired.mode,'reset');assert.equal(expired.reason,'expired');assert.equal(expired.revision,start.revision+3);
  const cursor=expired.cursor;await Promise.all([f.action('memory.save',{roleId:f.raw().roles[0].id,content:'A remembered fact'}),f.action('profile.save',{bio:'simultaneous profile'})]);const delta=(await f.sync(cursor)).value;assert.equal(delta.mode,'delta');assert.equal(delta.changes.replace.memories.length,1);assert.equal(delta.changes.replace.profile.bio,'simultaneous profile');
});
test('successful JSON restore rotates epoch and exposes no old deleted records',async t=>{
  const f=await fixture(t),backup=await f.request('/api/backup');assert.equal(backup.status,200);
  await f.action('message.pat',{roleId:f.raw().roles[0].id,target:'contact'});await f.action('profile.save',{name:'after backup'});const before=(await f.sync()).value,extra=f.raw().messages.at(-1).id;
  const restored=await f.request('/api/restore',{confirm:true,backup:backup.value});assert.equal(restored.status,200,JSON.stringify(restored.value));
  const reset=(await f.sync(before.cursor)).value;assert.equal(reset.mode,'reset');assert.equal(reset.reason,'epoch');assert.notEqual(reset.epoch,before.epoch);assert.ok(!reset.state.messages.some(m=>m.id===extra));assert.equal(reset.state.profile.name,backup.value.state.profile.name);
});
test('delta applied to a complete state converges with the legacy state through append, recall, delete, clear and role deletion',async t=>{
  const f=await fixture(t),base=(await f.sync()).value;let replica=(await f.request('/api/state')).value,cursor=base.cursor;
  const apply=async()=>{const value=(await f.sync(cursor)).value;assert.equal(value.mode,'delta');assert.equal(value.fromRevision,JSON.parse(Buffer.from(cursor,'base64url'))[1]);const deleted=new Set(value.changes.deleteMessageIds),updates=new Map(value.changes.upsertMessages.map(m=>[m.id,m]));replica.messages=replica.messages.filter(m=>!deleted.has(m.id)).map(m=>{const replacement=updates.get(m.id);updates.delete(m.id);return replacement||m;});replica.messages.push(...updates.values());Object.assign(replica,value.changes.replace,{revision:value.revision});cursor=value.cursor;assert.deepEqual(replica,(await f.request('/api/state')).value);};
  const roleId=f.raw().roles[0].id;
  for(const [type,payload] of [['message.pat',{roleId,target:'contact'}],['message.recall',{id:f.raw().messages[1].id}],['message.delete',{id:f.raw().messages[2].id}],['memory.save',{roleId,content:'A synthetic memory'}],['moment.create',{content:'A synthetic moment'}],['conversation.clear',{roleId}],['role.delete',{id:roleId}]]){assert.equal((await f.action(type,payload)).status,200);await apply();}
});
test('paged and bootstrap bytes stay small for long history and Unicode search retains frontend matching',async t=>{
  const f=await fixture(t,{seed(s){s.messages=[];for(let i=0;i<3000;i++)S.message(s,s.roles[i%2],'user','ÉCOLE fixture '+i+' '+'.'.repeat(500),'text',{createdAt:1700000000000,status:'sent'});}}),full=(await f.request('/api/state')).value,reset=(await f.sync()).value;
  const page=(await f.request('/api/messages?roleId='+full.roles[0].id+'&limit=20')).value,search=(await f.request('/api/messages/search?roleId='+full.roles[0].id+'&q=%C3%A9cole&limit=2')).value;
  assert.equal(page.messages.length,20);assert.equal(search.messages.length,2);assert.ok(Buffer.byteLength(JSON.stringify(reset))<Buffer.byteLength(JSON.stringify(full))/10);assert.ok(Buffer.byteLength(JSON.stringify(page))<Buffer.byteLength(JSON.stringify(full))/50);
  fs.writeFileSync(path.join(output,'payload-sizes.json'),JSON.stringify({messages:3000,legacyBytes:Buffer.byteLength(JSON.stringify(full)),resetBytes:Buffer.byteLength(JSON.stringify(reset)),page20Bytes:Buffer.byteLength(JSON.stringify(page)),note:'Synthetic payload sizes; not a runtime RAM or response latency measurement.'},null,2));
});
test('journal resets on message reorder, middle insertion, deleted top-level fields and oversized change sets',()=>{
  function check(change,options={}){const journal=Sync.createJournal(options),state={revision:0,profile:{name:'A'},messages:[{id:'a',content:'A'},{id:'b',content:'B'}]},cursor=journal.describe(undefined,0).cursor,before=journal.capture(state);change(state);state.revision++;journal.commit(before,state);assert.equal(journal.describe(cursor,1).mode,'reset');}
  check(s=>s.messages.reverse());check(s=>s.messages.splice(1,0,{id:'c',content:'C'}));check(s=>{delete s.profile;});check(s=>s.messages.push({id:'x'.repeat(100),content:'large'}),{maxBytes:30});
});
test('automatic status expiry before an unrelated settings write is included in the delta',async t=>{
  const f=await fixture(t);assert.equal((await f.action('status.save',{preset:'happy',description:'Synthetic status'})).status,200);const before=(await f.sync()).value;assert.equal(before.state.profile.status.preset,'happy');
  const future=Date.now()+86400001;t.mock.method(Date,'now',()=>future);assert.equal((await f.action('settings.save',{momentsMinutes:360})).status,200);
  const delta=(await f.sync(before.cursor)).value;assert.equal(delta.mode,'delta');assert.equal(delta.changes.replace.profile.status,null);assert.equal(delta.changes.replace.statusHistory.length,1);assert.deepEqual(delta.changes.upsertMessages,[]);
});
test('successful streaming TAR restore also rotates the epoch',async t=>{
  const f=await fixture(t),prepared=await f.request('/api/backup/prepare',{includeKeys:false,includeMedia:true});assert.equal(prepared.status,200);
  const archive=await f.request('/api/backup/download?token='+prepared.value.token);assert.equal(archive.status,200);assert.ok(Buffer.isBuffer(archive.value));
  await f.action('profile.save',{name:'after TAR backup'});const before=(await f.sync()).value;
  const restored=await f.request('/api/restore/tar',archive.value,{'Content-Type':'application/x-tar'});assert.equal(restored.status,200,JSON.stringify(restored.value));const reset=(await f.sync(before.cursor)).value;assert.equal(reset.mode,'reset');assert.equal(reset.reason,'epoch');assert.notEqual(reset.epoch,before.epoch);
});
test('journal descriptor buffer bytes and entry count remain bounded without storing message bodies',()=>{
  const maxBytes=1024,journal=Sync.createJournal({maxBytes,maxEntries:8}),state={revision:0,messages:Array.from({length:10},()=>({id:randomUUID(),content:'SYNTHETIC_BODY_'.repeat(1000)})),profile:{name:'A'}},cursor=journal.describe(undefined,0).cursor;
  for(let i=0;i<100;i++){const before=journal.capture(state);state.messages.forEach(message=>{message.content+='.';});state.revision++;journal.commit(before,state);const stats=journal.stats();assert.ok(stats.descriptorBytes<=maxBytes);assert.ok(stats.entries<=8);assert.ok(stats.descriptorBytes<Buffer.byteLength(JSON.stringify(state.messages))/100);}
  assert.equal(journal.describe(cursor,state.revision).reason,'expired');fs.writeFileSync(path.join(output,'journal-bound.json'),JSON.stringify({configuredDefault:Sync.createJournal().stats(),stress:journal.stats(),messageBodyBytes:Buffer.byteLength(JSON.stringify(state.messages)),note:'Bound applies to retained Buffer descriptor content plus at most 256 small entry wrappers; per-request parsed state, hashes, SQLite and process RSS are separate.'},null,2));
});
