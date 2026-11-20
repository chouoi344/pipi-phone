// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../scripts/sample-data.cjs');
test('legacy memories remain searchable in the active memory list',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-legacy-search-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const setupResponse=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'local-test-password-123',displayName:'隔离测试'})});
  assert.equal(setupResponse.status,200);
  const setup=await setupResponse.json(),roleId=setup.state.roles[0].id;
  const headers={Origin:origin,Cookie:setupResponse.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.csrfToken,'Content-Type':'application/json'};
  for(const content of ['喜欢喝 Latte 和热牛奶','喜欢周末散步']){
    const saved=await fetch(origin+'/api/action',{method:'POST',headers,body:JSON.stringify({type:'memory.save',payload:{roleId,content}})});assert.equal(saved.status,200);
  }
  const list=async q=>{
    const response=await fetch(origin+`/api/engine/memory/state?roleId=${roleId}&status=active&q=${encodeURIComponent(q)}`,{headers});assert.equal(response.status,200);return (await response.json()).cards;
  };
  assert.equal((await list('')).length,2);
  const cards=await list('latte');assert.deepEqual(cards.map(c=>c.content),['喜欢喝 Latte 和热牛奶']);
});

test('a user can edit an archived memory without making it available, and explicitly restore it',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-memory-restore-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const setupResponse=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'local-test-password-123',displayName:'隔离验证'})});
  const setup=await setupResponse.json(),roleId=setup.state.roles[0].id;
  const headers={Origin:origin,Cookie:setupResponse.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.csrfToken,'Content-Type':'application/json'};
  const action=async(action,details={})=>{
    const response=await fetch(origin+'/api/engine/memory',{method:'POST',headers,body:JSON.stringify({action,roleId,...details})});
    assert.equal(response.status,200);return response.json();
  };
  const {card:{id}}=await action('add',{content:'收藏旧邮票'});
  await action('delete',{id,archive:true});
  const edited=await action('update',{id,content:'收藏纪念邮票'});
  assert.equal(edited.card.status,'archived');
  const response=await fetch(origin+'/api/engine/memory/state?group=month&status=archived&roleId='+roleId,{headers});
  assert.deepEqual((await response.json()).cards.map(c=>c.id),[id]);
  assert.deepEqual((await action('recall',{query:'邮票'})).cards,[]);
  await action('restore',{id});
  assert.deepEqual((await action('recall',{query:'邮票'})).cards.map(c=>c.content),['收藏纪念邮票']);
});

test('month browsing uses phone timezone, stable chronological pages and cross-month search',async t=>{
  const MS=require('../lib/engine/memory-store.cjs');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-memory-months-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const response=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'local-month-test-123',displayName:'month QA'})});
  assert.equal(response.status,200);const setup=await response.json(),roleId=setup.state.roles[0].id;
  const headers={Origin:origin,Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.csrfToken,'Content-Type':'application/json'};
  const state=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);state.settings.timezone='America/Los_Angeles';
  state.memories=[{id:'legacy-undated',roleId,content:'searchable unknown legacy'},{id:'nov-a',roleId,content:'duplicate mirror',createdAt:1},{id:'archive',roleId,content:'archived mirror',createdAt:1}];
  const put=(id,createdAt,extra={})=>MS.upsertCard(dataDir,state,roleId,{id,createdAt:Date.parse(createdAt),updatedAt:1,content:'searchable '+id,...extra},{skipMirrorSync:true});
  put('nov-b','2026-11-15T12:00:00Z',{importance:0.9});put('nov-a','2026-11-15T12:00:00Z',{importance:0.1});
  put('nov-old','2026-11-01T12:00:00Z',{locked:true});
  put('utc-nov-local-oct','2026-11-01T01:00:00Z',{topics:['topicneedle'],keyFacts:['factneedle']});
  put('archive','2026-12-01T12:00:00Z',{status:'archived'});
  MS.saveProfile(dataDir,state,roleId,{basic:{name:'PROFILE_ONLY'}});
  app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
  const get=async query=>{const r=await fetch(origin+'/api/engine/memory/state?roleId='+roleId+'&group=month&limit=2&'+query,{headers});assert.equal(r.status,200);return r.json();};
  const first=await get('');assert.deepEqual(first.months,[{month:'2026-11',count:3},{month:'2026-10',count:1},{month:'unknown',count:1}]);assert.equal(first.month,'2026-11');assert.equal(first.total,3);assert.equal(first.nextOffset,2);assert.deepEqual(first.cards.map(c=>c.id),['nov-a','nov-b']);assert.equal(first.profile.basic.name,'PROFILE_ONLY');
  const last=await get('month=2026-11&offset=2');assert.deepEqual(last.cards.map(c=>c.id),['nov-old']);assert.equal(last.nextOffset,null);
  assert.equal((await get('month=2026-10')).cards[0].id,'utc-nov-local-oct');
  assert.equal((await get('month=unknown')).cards[0].id,'legacy-undated');
  assert.equal((await get('month=2020-01')).month,'2026-11');
  const search=await get('month=2026-10&q=searchable');assert.equal(search.month,null);assert.equal(search.total,5);assert.deepEqual(search.months,first.months);assert.deepEqual(search.cards.map(c=>c.id),['nov-a','nov-b']);
  assert.deepEqual((await get('q=searchable&offset=2')).cards.map(c=>c.id),['nov-old','utc-nov-local-oct']);assert.deepEqual((await get('q=searchable&offset=4')).cards.map(c=>c.id),['legacy-undated']);
  for(const q of ['topicneedle','factneedle'])assert.equal((await get('q='+q)).cards[0].id,'utc-nov-local-oct');
  const empty=await get('q=NOT_FOUND');assert.equal(empty.total,0);assert.equal(empty.month,null);assert.equal(empty.nextOffset,null);assert.deepEqual(empty.months,first.months);
  const archived=await get('status=archived');assert.deepEqual(archived.months,[{month:'2026-12',count:1}]);assert.equal(archived.month,'2026-12');assert.equal(archived.total,1);
  assert.equal((await get('status=all')).months[0].month,'2026-12');
  state.settings.timezone='Asia/Shanghai';app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
  assert.deepEqual((await get('')).months,[{month:'2026-11',count:4},{month:'unknown',count:1}]);
  const emptyRole=setup.state.roles[1].id,r=await fetch(origin+'/api/engine/memory/state?roleId='+emptyRole+'&group=month&limit=30',{headers}),data=await r.json();assert.equal(data.month,null);assert.deepEqual(data.months,[]);assert.equal(data.total,0);
});

test('memory pagination searches the whole store and locks late cards without losing legacy data',async t=>{
  const MS=require('../lib/engine/memory-store.cjs');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-memory-pages-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const response=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'local-page-test-123',displayName:'pagination QA'})});
  assert.equal(response.status,200);const setup=await response.json(),roleId=setup.state.roles[0].id;
  const headers={Origin:origin,Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.csrfToken,'Content-Type':'application/json'};
  const state=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  state.settings.modules.memory={...state.settings.modules.memory,enabled:false};
  state.memories=[{id:'legacy',roleId,content:'legacy marker',createdAt:1},{id:'card-000',roleId,content:'duplicate mirror',createdAt:1},{id:'archived',roleId,content:'archived mirror',createdAt:1}];
  for(let i=0;i<455;i++)MS.upsertCard(dataDir,state,roleId,{id:'card-'+String(i).padStart(3,'0'),content:i===454?'late marker':'card '+i,topics:i===453?['topic marker']:[],keyFacts:i===452?['fact marker']:[],importance:0.6,createdAt:100,updatedAt:100},{skipMirrorSync:true});
  MS.upsertCard(dataDir,state,roleId,{id:'archived',content:'archived marker',status:'archived'},{skipMirrorSync:true});
  app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
  const get=async query=>{const r=await fetch(origin+'/api/engine/memory/state?roleId='+roleId+'&'+query,{headers});assert.equal(r.status,200);return r.json();};
  const ids=[];let offset=0;
  do{const page=await get('limit=40&offset='+offset);assert.equal(page.total,456);ids.push(...page.cards.map(c=>c.id));offset=page.nextOffset;}while(offset!==null);
  assert.equal(ids.length,456);assert.equal(new Set(ids).size,456);assert.equal(ids[454],'card-454');assert.equal(ids[455],'legacy');assert(!ids.includes('archived'));
  assert.deepEqual((await get('limit=40')).cards.map(c=>c.id),ids.slice(0,40));
  assert.equal((await get('')).cards.length,300);assert.equal((await get('')).total,undefined);
  for(const [query,id]of [['late','card-454'],['topic','card-453'],['fact','card-452'],['legacy','legacy']]){const found=await get('limit=40&q='+query);assert.equal(found.total,1);assert.equal(found.cards[0].id,id);assert.equal(found.nextOffset,null);}
  assert.equal((await get('q=late')).cards[0].id,'card-454');
  assert.equal((await get('status=archived&limit=40')).total,1);assert.equal((await get('status=all&limit=40')).total,457);
  assert.deepEqual((await get('limit=40&offset=1000')).cards,[]);assert.equal((await get('limit=40&offset=1000')).nextOffset,null);
  for(const query of ['limit=0','limit=101','limit=1.5','limit=no','limit=40&offset=-1','limit=40&offset=0.5'])assert.equal((await fetch(origin+'/api/engine/memory/state?roleId='+roleId+'&'+query,{headers})).status,400,query);
  const lock=async id=>{const r=await fetch(origin+'/api/engine/memory',{method:'POST',headers,body:JSON.stringify({roleId,action:'toggleLock',id})});assert.equal(r.status,200);return r.json();};
  assert.equal((await lock('card-454')).card.locked,true);assert.equal((await lock('card-454')).card.locked,false);
  assert.equal((await get('limit=40&q=legacy')).total,1);
  assert.equal((await lock('legacy')).card.locked,true);assert.equal((await lock('legacy')).card.locked,false);
  assert.equal((await get('limit=40&q=legacy')).total,1);assert.equal((await get('status=all&limit=40')).total,457);
});
