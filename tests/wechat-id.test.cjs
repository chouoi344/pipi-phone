// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const S=require('../lib/state.cjs'),{createApp}=require('../scripts/sample-data.cjs');
test('only changing a WeChat ID rejects Han characters while existing IDs and Chinese names are preserved',()=>{
  const s=sampleState(),r=s.roles[0];s.profile.wechatId='旧微信号';r.wechatId='旧朋友号';
  S.apply(s,'profile.save',{name:'中文昵称',wechatId:'旧微信号'});S.apply(s,'role.save',{id:r.id,name:'中文名字',remark:'中文备注',wechatId:'旧朋友号'});
  assert.equal(s.profile.wechatId,'旧微信号');assert.equal(r.wechatId,'旧朋友号');assert.equal(r.remark,'中文备注');
  S.apply(s,'profile.save',{bio:'中文签名'});S.apply(s,'role.save',{id:r.id,bio:'中文签名'});
  for(const wechatId of ['新微信号','wx中123','𠀀_id']){
    assert.throws(()=>S.apply(s,'profile.save',{wechatId}),/微信号不能包含中文/);assert.throws(()=>S.apply(s,'role.save',{id:r.id,wechatId}),/微信号不能包含中文/);assert.throws(()=>S.apply(s,'role.save',{name:'新朋友',wechatId}),/微信号不能包含中文/);
  }
  for(const wechatId of ['Abc123','wx_name-123','a']){S.apply(s,'profile.save',{wechatId});S.apply(s,'role.save',{id:r.id,wechatId});assert.equal(s.profile.wechatId,wechatId);assert.equal(r.wechatId,wechatId);}
});
test('old backups retain their original Chinese IDs and remain editable in unrelated fields',()=>{
  const old=sampleState();old.profile.wechatId='原自己号';old.roles[0].wechatId='原好友号';
  const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(old)},sampleState());
  assert.equal(restored.profile.wechatId,'原自己号');assert.equal(restored.roles[0].wechatId,'原好友号');
  S.apply(restored,'profile.save',{name:'改昵称'});S.apply(restored,'role.save',{id:restored.roles[0].id,remark:'改备注'});
  assert.equal(restored.profile.wechatId,'原自己号');assert.equal(restored.roles[0].wechatId,'原好友号');
});
test('WeChat ID fields show their restriction and client validation permits unchanged old IDs',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  function productFunction(name){const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start);return source.slice(start,end);}
  const scope=vm.createContext({});vm.runInContext(`const esc=value=>String(value??'');${productFunction('field')}${productFunction('checkWechatId')}globalThis.ui={field,checkWechatId};`,scope);
  assert.match(scope.ui.field('微信号','wechatId','abc'),/不支持中文/);assert.match(scope.ui.field('微信号','wechatId','abc'),/autocapitalize="none" spellcheck="false"/);
  assert.doesNotMatch(scope.ui.field('名字','name','中文名字'),/不支持中文/);
  assert.throws(()=>scope.ui.checkWechatId('中文新号','old'),/微信号不能包含中文/);scope.ui.checkWechatId('原中文号','原中文号');scope.ui.checkWechatId('wx_123-name','old');
});
test('isolated HTTP rejects Chinese ID updates atomically and accepts English, digits, underscore and hyphen',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-wechat-id-')),app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})}),value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};}
  const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.value));return response.value;},read=async()=>ok(await request('/api/state')),action=(type,payload)=>request('/api/action',{type,payload});
  t.after(async()=>{await app.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('pipi-wechat-id-'));fs.rmSync(dir,{recursive:true,force:true});});
  ok(await request('/api/setup',{password:'Wechat-id-isolated-2026!'}));let saved=await read();const id=saved.roles[0].id;
  for(const [type,payload]of [['profile.save',{wechatId:'测试中文'}],['role.save',{id,wechatId:'含中文123'}],['role.save',{name:'中文名字',wechatId:'新朋友'}]]){
    assert.equal((await action(type,payload)).status,400);assert.deepEqual(await read(),saved);
  }
  ok(await action('profile.save',{wechatId:'Me_123-ID'}));ok(await action('role.save',{id,wechatId:'Friend_456-ID',name:'中文名字',remark:'中文备注'}));saved=await read();assert.equal(saved.profile.wechatId,'Me_123-ID');assert.equal(saved.roles[0].wechatId,'Friend_456-ID');
  const backup=ok(await request('/api/backup'));backup.state.profile.wechatId='旧自己号';backup.state.roles[0].wechatId='旧好友号';ok(await request('/api/restore',{backup,confirm:true}));
  ok(await action('profile.save',{name:'修改昵称',wechatId:'旧自己号'}));ok(await action('role.save',{id,bio:'仅修改签名',wechatId:'旧好友号'}));saved=await read();assert.equal(saved.profile.wechatId,'旧自己号');assert.equal(saved.roles[0].wechatId,'旧好友号');
});
