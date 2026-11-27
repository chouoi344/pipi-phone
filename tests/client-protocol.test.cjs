// SPDX-License-Identifier: AGPL-3.0-only
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/client-protocol.js'),'utf8');
const protocol={name:'pipi-phone',version:1,features:['state-v1','chat-progress-v1','sync-v1']};
function fixture({android=true,token='verified-token',bridge=false,reply=()=>({state:'legacy-audited',legacyAllowed:true})}={}){
  const prompts=[],window={prompt:(...args)=>{prompts.push(args);return JSON.stringify(reply());}};
  vm.runInNewContext(source,{window,document:{querySelector:selector=>selector.includes('pipi-client-compat')?(bridge?{content:'1'}:null):(token?{content:token}:null)},navigator:{userAgent:android?'PipiPhoneAndroid/1.0':'Browser'},setTimeout:fn=>fn()});
  return {validate:window.PipiClientProtocol.validate,prompts};
}
test('known protocol opens independently of the page fingerprint and needs no legacy prompt',async()=>{const f=fixture();await f.validate({clientProtocol:protocol});assert.equal(f.prompts.length,0);});
test('a marked new native shell can recheck an offline connection without reloading the page',async()=>{const f=fixture({bridge:true,reply:()=>({state:'offline'})});await f.validate({clientProtocol:protocol});assert.deepEqual(f.prompts,[['pipi-client-compat:verified-token','get']]);});
test('unknown protocol and missing mandatory capabilities cannot downgrade to legacy',async()=>{
  for(const clientProtocol of [null,{...protocol,version:2},{...protocol,name:'other'},{...protocol,features:['sync-v1']},{...protocol,features:[...protocol.features,null]}]){const f=fixture();await assert.rejects(f.validate({clientProtocol}),/不兼容/);assert.equal(f.prompts.length,0);}
});
test('only native reviewed legacy permission opens a bundled page against an older server',async()=>{
  const f=fixture();await f.validate({});assert.deepEqual(f.prompts,[['pipi-client-compat:verified-token','get']]);
  for(const state of ['unsupported','offline','server-page','protocol-v1'])await assert.rejects(fixture({reply:()=>({state,legacyAllowed:true})}).validate({}),/验证兼容/);
  await assert.rejects(fixture({reply:()=>({state:'legacy-audited',legacyAllowed:false})}).validate({}),/验证兼容/);
});
test('pending native verification waits a bounded time and then either opens or explains',async()=>{
  let reads=0;const f=fixture({reply:()=>++reads<3?{state:'checking'}:{state:'legacy-audited',legacyAllowed:true}});await f.validate({});assert.equal(reads,3);
  const stuck=fixture({reply:()=>({state:'checking'})});await assert.rejects(stuck.validate({}),/验证兼容/);assert.equal(stuck.prompts.length,51);
});
test('ordinary browsers and server-owned legacy pages retain their original API path',async()=>{for(const options of [{android:false},{token:null}]){const f=fixture(options);await f.validate({});assert.equal(f.prompts.length,0);}});

test('App reading snapshot replaces edited text and removes deleted and recalled message bodies',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const capture=app.slice(app.indexOf('  function captureAndroidPage(){'),app.indexOf('  function restoreAndroidPage(){'));
  const role={id:'one',name:'好友'},state={roles:[role,{id:'gone',deleted:true,name:'已删除好友'}],messages:[{id:'edit',roleId:'one',sender:'assistant',type:'text',content:'修改后的文字'},{id:'recalled',roleId:'one',sender:'system',type:'text',content:'已撤回'}]};
  const context={state,route:{name:'contacts'},view:{dataset:{},querySelector:()=>null},navStack:[],drafts:new Map(),composeText:'',chatsReturn:0,contactsReturn:null,roleById:id=>state.roles.find(r=>r.id===id&&!r.deleted),roleName:r=>r.name,androidReadings:new Map([['one',{roleId:'one',name:'旧名字',messages:[{id:'gone',content:'被删除的秘密'},{id:'edit',content:'旧文字'},{id:'recalled',content:'被撤回的秘密'}]}]])};
  vm.runInNewContext(capture+';globalThis.result=captureAndroidPage();',context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result.contacts)),[{roleId:'one',name:'好友'}]);
  assert.equal(context.result.chats[0].messages.length,1);assert.equal(context.result.chats[0].messages[0].content,'修改后的文字');assert.doesNotMatch(JSON.stringify(context.result),/被删除的秘密|被撤回的秘密|旧文字/);
});
test('offline reading keeps evicted pages and removes recalled, deleted or reset text',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/android-page.js'),'utf8');
  const reconcile=vm.runInNewContext(js.slice(js.indexOf('  function updateReadings('),js.indexOf('  function restore()',js.indexOf('  function updateReadings(')))+';updateReadings',{scheduleCheckpoint(){}});
  const chat={roleId:'one',messages:[{id:'saved',sender:'user',content:'之前看过'},{id:'edit',sender:'assistant',content:'旧字'},{id:'gone',sender:'user',content:'删除前的字'},{id:'recall',sender:'assistant',content:'已撤回原文'}]};
  const readings=new Map([['one',chat]]);
  reconcile(readings,{upserts:[{id:'another',sender:'user',type:'text',content:'其他聊天'}],deletedIds:[]});
  assert.equal(readings.get('one'),chat);
  reconcile(readings,{upserts:[{id:'edit',type:'text',sender:'assistant',content:'新字'},{id:'recall',type:'text',sender:'system',content:'已撤回'}],deletedIds:['gone']});
  assert.deepEqual(Array.from(readings.get('one').messages,m=>m.content),['之前看过','新字']);
  reconcile(readings,{reset:true,upserts:[],deletedIds:[]});assert.equal(readings.get('one').messages.length,0);
});
