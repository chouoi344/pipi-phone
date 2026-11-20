// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs'),MS=require('../lib/engine/memory-store.cjs');
async function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-memory-http-0130-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',resetPassword:false,initialState:()=>{const state=S.initial();S.apply(state,'role.save',{name:'隔离好友'});return state;}});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'Memory-http-test-password'})});assert.equal(setup.status,200);const body=await setup.json(),roleId=body.state.roles[0].id;
  const headers={Cookie:setup.headers.get('set-cookie').split(';')[0],Origin:origin,'Content-Type':'application/json','X-CSRF-Token':body.csrfToken};
  async function request(route,body){const response=await fetch(origin+route,{headers,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
  return {app,dataDir,roleId,request,state:()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json),save:state=>app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state))};
}
test('archived mentions form the first cross-month paginated group; other months and active order remain available',async t=>{
  const f=await fixture(t),state=f.state();
  for(const [id,date,mentioned,status]of [['jan','2026-01-02',300,'archived'],['mar','2026-03-02',200,'archived'],['nov','2026-11-02',0,'archived'],['oct','2026-10-02',0,'archived'],['active','2026-11-04',0,'active']])MS.upsertCard(f.dataDir,state,f.roleId,{id,content:'searchable '+id,createdAt:Date.parse(date),lastMentionedAt:mentioned,status},{skipMirrorSync:true});f.save(state);
  const get=query=>f.request('/api/engine/memory/state?roleId='+f.roleId+'&status=archived&'+query);
  const first=await get('group=month&limit=1');assert.equal(first.month,'recent');assert.deepEqual(first.months,[{month:'recent',count:2,label:'最近聊到过'},{month:'2026-11',count:1},{month:'2026-10',count:1}]);assert.deepEqual(first.cards.map(card=>card.id),['jan']);assert.equal(first.total,2);assert.equal(first.nextOffset,1);
  const second=await get('group=month&month=recent&limit=1&offset=1');assert.deepEqual(second.cards.map(card=>card.id),['mar']);assert.equal(second.nextOffset,null);
  assert.deepEqual((await get('group=month&month=2026-11')).cards.map(card=>card.id),['nov']);
  const search=await get('group=month&q=searchable&limit=2');assert.equal(search.month,null);assert.equal(search.total,4);assert.deepEqual(search.cards.map(card=>card.id),['jan','mar']);assert.equal(search.nextOffset,2);
  assert.deepEqual((await get('limit=3')).cards.map(card=>card.id),['jan','mar','nov']);assert.deepEqual((await f.request('/api/engine/memory/state?roleId='+f.roleId+'&status=active&group=month')).cards.map(card=>card.id),['active']);
});
test('legacy memory.delete clears both the stored card and its sourced profile fact',async t=>{
  const f=await fixture(t),state=f.state();
  const card=MS.upsertCard(f.dataDir,state,f.roleId,{id:'delete-card',content:'喜欢咖啡',createdAt:1});
  MS.applyProfileUpdates(f.dataDir,state,f.roleId,[{section:'preferences',field:'饮品',value:'咖啡',memoryIds:[card.id]}]);f.save(state);
  assert.ok(MS.getCard(f.dataDir,state,f.roleId,card.id));assert.deepEqual(MS.getProfile(f.dataDir,state,f.roleId).preferences['饮品'],['咖啡']);
  await f.request('/api/action',{type:'memory.delete',payload:{id:card.id}});
  const after=f.state();assert.equal(after.memories.some(item=>item.id===card.id),false);assert.equal(MS.getCard(f.dataDir,after,f.roleId,card.id),null);assert.equal(MS.getProfile(f.dataDir,after,f.roleId).preferences['饮品'],undefined);
});
