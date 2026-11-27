// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Sync=require('../public/state-sync.js'),{createApp}=require('../server.cjs');
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-sync-client-http-'));
  const initialState=()=>{const state=S.initial();R.ensure(state);for(const module of R.list())if(module.settings.some(setting=>setting.key==='enabled'))R.apply(state,module.id,{enabled:false});S.apply(state,'role.save',{name:'甲'});S.apply(state,'role.save',{name:'乙'});for(let i=0;i<15;i++)S.message(state,state.roles[i%2],'user','合成记录 '+i,'text',{status:'sent'});return state;};
  let app,base,cookie='',csrf='';
  async function start(){app=createApp({dataDir:dir,initialState,host:'127.0.0.1',port:0,trustProxy:'',providerUrlAllowlist:[],mediaTimers:false,resetPassword:false,updates:{updateDir:''},fcm:{credentialFile:''}});await app.listen();base='http://127.0.0.1:'+app.server.address().port;}
  await start();
  t.after(async()=>{await app.close();assert.ok(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('pipi-sync-client-http-'));fs.rmSync(dir,{recursive:true,force:true});});
  async function request(route,body,headers={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Connection:'close',...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(result.csrfToken)csrf=result.csrfToken;assert.equal(response.status,200,JSON.stringify(result));return result;
  }
  const password='Synthetic-sync-client-2026!';await request('/api/setup',{password});
  return {request,action:(type,payload,headers)=>request('/api/action',{type,payload},headers),async restart(){await app.close();await start();await request('/api/login',{password});}};
}
test('真实服务器与真实客户端：完整snapshot期间并发变更补齐，动作/删除后的结果与旧全量接口一致',async t=>{
  const f=await fixture(t),seed=await f.request('/api/state');let inject=true;
  const client=Sync.create({request:async route=>{
    const value=await f.request(route);
    if(route==='/api/state'&&inject){inject=false;await f.action('profile.save',{name:'snapshot期间更新'});await f.action('message.forward',{targetRoleId:seed.roles[0].id,ids:[seed.messages[0].id],mode:'merged'});}
    return value;
  }});
  const initial=await client.refresh();assert.equal(initial.state.messages.length,16);assert.equal(initial.state.profile.name,'snapshot期间更新');assert.deepEqual(initial.state,await f.request('/api/state'));
  const updated=await client.accept(await f.action('profile.save',{name:'协商动作'},client.headers()));assert.equal(updated.sync,undefined);assert.deepEqual(updated.state,await f.request('/api/state'));
  const removed=await client.accept(await f.action('message.delete',{id:seed.messages[2].id},client.headers()));assert.ok(!removed.state.messages.some(message=>message.id===seed.messages[2].id));assert.deepEqual(removed.state,await f.request('/api/state'));
  const unchanged=await client.refresh();assert.equal(unchanged.unchanged,true);assert.equal(unchanged.state.messages.length,15);
});
test('真实服务器重启：旧cursor触发新epoch完整重置，普通旧snapshot不获替换标记',async t=>{
  const f=await fixture(t),client=Sync.create({request:route=>f.request(route)});const before=await client.refresh();await f.restart();const after=await client.refresh();
  assert.equal(client.replaces(after.state),true);assert.deepEqual(after.state,await f.request('/api/state'));assert.equal(client.replaces(before.state),false);
});

test('真实分页客户端以各好友预览启动，已读页应用增量，删除预览后自动确定前一条',async t=>{
  const f=await fixture(t),paths=[],client=Sync.create({paged:true,pageSize:3,request:(route,{headers})=>{
    paths.push(route);return f.request(route,undefined,headers);
  }});
  const login=await client.accept(await f.request('/api/login',{password:'Synthetic-sync-client-2026!'},client.headers()));
  assert.equal(typeof login.csrfToken,'string');assert.equal(login.state.messages.length,2);
  const [a,b]=login.state.roles,p=client.paging;
  assert.equal(p.totalCount(),15);p.setActive(a.id);await p.enter(a.id);assert.equal(p.rows(a.id).length,3);
  await p.older(a.id);assert.equal(p.rows(a.id).length,6);
  const oldHead=login.state.messages.find(m=>m.roleId===b.id);
  const removed=await client.accept(await f.action('message.delete',{id:oldHead.id},client.headers()));
  assert.ok(removed.state.messages.some(m=>m.roleId===b.id&&m.id!==oldHead.id));
  assert.equal(removed.state.messages.filter(m=>m.roleId===b.id).length,1);assert.equal(p.totalCount(),14);
  assert.ok(p.delta(removed.state).deletedIds.includes(oldHead.id));assert.equal(p.delta(removed.state).fresh.length,0);
  await f.restart();const result=await client.refresh();assert.ok(p.delta(result.state).reset);
  assert.equal(p.rows(a.id).length,3);assert.equal(p.info(b.id).loaded,false);
  assert.ok(!paths.some(route=>route.startsWith('/api/state')));
});
