// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),zlib=require('node:zlib'),{randomUUID}=require('node:crypto'),{setTimeout:wait}=require('node:timers/promises');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs'),Registry=require('../lib/engine/registry.cjs'),Images=require('../lib/engine/model-images.cjs');
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let input=args[0];if(Array.isArray(input))input=input[0];if(typeof input==='number')input={port:input,host:typeof args[1]==='string'?args[1]:'localhost'};if(input&&typeof input==='object'&&input.port!==undefined)assert.ok(['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].includes(String(input.host||input.hostname||'localhost')),'Chat await tests permit only loopback sockets');return originalConnect.apply(this,args);};
test.after(()=>{net.Socket.prototype.connect=originalConnect;});
function png(){const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(zlib.crc32(Buffer.concat([name,data])),out.length-4);return out;};const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,60,20,90,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
async function until(check){const end=Date.now()+5000;while(Date.now()<end){if(check())return;await wait(5);}throw Error('Image preparation gate was not entered');}
async function fixture(t){
  const root=path.resolve(__dirname,'../outputs/standalone-batch1');fs.mkdirSync(root,{recursive:true});const dataDir=fs.mkdtempSync(path.join(root,'chat-await-fixture-'));
  function initialState(){const state=S.initial();for(const module of Registry.modules)if(module.settings.some(field=>field.key==='enabled'))state.settings.modules[module.id]={...Registry.values(state,module.id),enabled:false};return state;}
  const app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',initialState,providerUrlAllowlist:[],mediaTimers:false,resetPassword:false,updates:{updateDir:''},fcm:{credentialFile:''}});
  const prepare=Images.prepare;let release;const held={entered:0,promise:new Promise(resolve=>{release=resolve;})};
  t.mock.method(Images,'prepare',async(...args)=>{held.entered++;await held.promise;return prepare(...args);});
  t.after(async()=>{release();await app.close();});
  await app.listen();const origin='http://127.0.0.1:'+app.server.address().port;
  function device(){let cookie='',csrf='';return async(route,body)=>{const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Connection:'close',...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};};}
  const owner=device(),other=device(),password='Chat-await-synthetic-only-2026!';assert.equal((await owner('/api/setup',{password})).status,200);assert.equal((await other('/api/login',{password})).status,200);
  const role=await owner('/api/action',{type:'role.save',payload:{name:'Image preparation fixture'}});assert.equal(role.status,200);const roleId=role.value.state.roles[0].id;
  const raw=()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json),requestRows=id=>app.db.prepare('SELECT count(*) AS n FROM requests WHERE id=?').get(id).n,userMessages=()=>raw().messages.filter(message=>message.roleId===roleId&&message.sender==='user');
  return {app,owner,other,roleId,release,held,requestRows,userMessages,body:()=>({roleId,text:'A synthetic image awaits preparation',image:png(),requestId:randomUUID()})};
}
test('revoking a session while real image preparation is held prevents its message and request receipt from committing',async t=>{
  const f=await fixture(t),body=f.body(),pending=f.other('/api/chat',body);await until(()=>f.held.entered===1);
  assert.equal((await f.owner('/api/account/sessions/revoke',{})).status,200);f.release();const response=await pending;
  assert.equal(response.status,401);assert.equal(f.userMessages().length,0);assert.equal(f.requestRows(body.requestId),0);
});
test('two identical request IDs finishing concurrent real image preparation commit one message and one receipt',async t=>{
  const f=await fixture(t),body=f.body(),first=f.owner('/api/chat',body),second=f.owner('/api/chat',body);await until(()=>f.held.entered===2);f.release();
  const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(response=>response.status),[200,200]);assert.equal(f.userMessages().length,1);assert.equal(f.requestRows(body.requestId),1);
  const message=f.userMessages()[0];assert.ok(message.meta.modelImage.startsWith('/api/media/'));assert.ok(message.meta.image.startsWith('/api/media/'));
});
test('blocking a role while real image preparation is held rejects the stale permission before any message commit',async t=>{
  const f=await fixture(t),body=f.body(),pending=f.owner('/api/chat',body);await until(()=>f.held.entered===1);
  const blocked=await f.owner('/api/action',{type:'role.save',payload:{id:f.roleId,permissions:{blocked:true}}});assert.equal(blocked.status,200);f.release();const response=await pending;
  assert.equal(response.status,403);assert.equal(response.value.code,'CONTACT_BLOCKED');assert.equal(f.userMessages().length,0);assert.equal(f.requestRows(body.requestId),0);
});
