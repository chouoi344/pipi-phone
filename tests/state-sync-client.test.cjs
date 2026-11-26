// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Sync=require('../public/state-sync.js');
const message=(id,content=id)=>({id,roleId:'alice',sender:'user',type:'text',content});
const state=(revision,messages,extra={})=>({revision,messages,roles:[{id:'alice'}],settings:{theme:'before'},...extra});
const reset=(revision,epoch='server-a')=>({schema:1,mode:'reset',epoch,revision,cursor:epoch+':'+revision,messageCoverage:'heads',state:state(revision,[message('head-only')]),reason:'initial'});
const delta=(fromRevision,revision,{upsertMessages=[],deleteMessageIds=[],replace={}}={},epoch='server-a')=>({schema:1,mode:'delta',epoch,fromRevision,revision,cursor:epoch+':'+revision,changes:{upsertMessages,deleteMessageIds,replace}});
function fixture(responses){
  const calls=[],client=Sync.create({request:async route=>{calls.push(route);assert.ok(responses.length,'unexpected '+route);const next=responses.shift();return typeof next==='function'?next(route):next;}});
  return {client,calls,responses};
}
async function initialized(){const f=fixture([reset(1),state(1,[message('old'),message('current')]),delta(1,1)]);await f.client.refresh();return f;}

test('完整同步起点：heads仅提供游标，保留全量旧记录并补齐取snapshot期间的新消息',async()=>{
  const f=fixture([reset(1),state(2,[message('old'),message('current')]),delta(1,3,{upsertMessages:[message('current','updated'),message('new')]})]);
  const result=await f.client.refresh();
  assert.deepEqual(result.state.messages.map(row=>[row.id,row.content]),[['old','old'],['current','updated'],['new','new']]);
  assert.equal(result.state.revision,3);assert.deepEqual(f.calls,['/api/sync','/api/state','/api/sync?cursor=server-a%3A1']);
  assert.equal(f.client.headers()['X-Pipi-Sync-Cursor'],'server-a:3');
});
test('增量修改/删除与公开顶层字段一起合并，完整messages始终保留',async()=>{
  const f=await initialized();f.responses.push(delta(1,4,{upsertMessages:[message('current','已撤回'),message('new')],deleteMessageIds:['old'],replace:{settings:{theme:'after'},wallet:{balanceCents:123}}}));
  const result=await f.client.refresh();assert.deepEqual(result.state.messages.map(row=>row.id),['current','new']);
  assert.equal(result.state.messages[0].content,'已撤回');assert.deepEqual(result.state.settings,{theme:'after'});assert.equal(result.state.wallet.balanceCents,123);
});
test('无变化只取空delta，旧聊天不被heads或空数组覆盖',async()=>{
  const f=await initialized();f.responses.push(delta(1,1));const result=await f.client.refresh();
  assert.equal(result.unchanged,true);assert.equal(result.state.messages.length,2);assert.equal(f.calls.filter(route=>route==='/api/state').length,1);
});
test('删除/过期reset重新取完整snapshot，不混入旧服务器副本',async()=>{
  const f=await initialized();f.responses.push({...reset(8),reason:'expired'},state(8,[message('only-survivor')]),delta(8,8));
  const result=await f.client.refresh();assert.deepEqual(result.state.messages.map(row=>row.id),['only-survivor']);assert.equal(f.calls.filter(route=>route==='/api/state').length,2);
});
test('服务器重启epoch变化允许较低revision的完整新状态',async()=>{
  const f=await initialized();f.responses.push({...reset(0,'server-b'),reason:'epoch'},state(0,[message('restored')]),delta(0,0,{},'server-b'));
  const result=await f.client.refresh();assert.equal(result.state.revision,0);assert.deepEqual(result.state.messages.map(row=>row.id),['restored']);
});
test('服务器换epoch但revision相等仍通知页面替换，不标unchanged',async()=>{
  const f=await initialized();f.responses.push(reset(1,'server-b'),state(1,[message('different-content')]),delta(1,1,{},'server-b'));
  const result=await f.client.refresh();assert.equal(result.unchanged,false);assert.equal(f.client.replaces(result.state),true);assert.equal(result.state.messages[0].id,'different-content');
});
test('动作sync翻译成原result.state，额外结果字段保留且不输出heads',async()=>{
  const f=await initialized();const result=await f.client.accept({messageId:'new',notice:'saved',sync:delta(1,2,{upsertMessages:[message('new')]})});
  assert.equal(result.messageId,'new');assert.equal(result.notice,'saved');assert.equal(result.sync,undefined);assert.deepEqual(result.state.messages.map(row=>row.id),['old','current','new']);
});
test('两个并发动作从相同cursor发出，错基底响应按当前cursor重新取delta',async()=>{
  const f=await initialized();f.responses.push(delta(2,3,{upsertMessages:[message('b')]}));
  const [a,b]=await Promise.all([f.client.accept({sync:delta(1,2,{upsertMessages:[message('a')]})}),f.client.accept({sync:delta(1,3,{upsertMessages:[message('a'),message('b')]})})]);
  assert.equal(a.state.revision,2);assert.equal(b.state.revision,3);assert.deepEqual(b.state.messages.map(row=>row.id),['old','current','a','b']);assert.equal(f.calls.at(-1),'/api/sync?cursor=server-a%3A2');
});
test('较旧动作响应不会回退较新的state/游标',async()=>{
  const f=await initialized();await f.client.accept({sync:delta(1,3,{upsertMessages:[message('new','fresh')]})});f.responses.push(delta(3,3));
  const result=await f.client.accept({sync:delta(1,2,{upsertMessages:[message('new','stale')]})});
  assert.equal(result.state.messages.at(-1).content,'fresh');assert.equal(result.state.revision,3);
});
test('仍返回完整state的旧动作响应与同步队列串行归并',async()=>{
  let release;const f=fixture([reset(1),()=>new Promise(resolve=>{release=resolve;}),delta(1,1)]);
  const pending=f.client.refresh();while(!release)await Promise.resolve();
  const accepted=f.client.accept({state:state(2,[message('old'),message('after-action')])});release(state(1,[message('old')]));await pending;await accepted;
  f.responses.push(delta(1,2,{upsertMessages:[message('after-action')]}));const result=await f.client.refresh();assert.equal(result.state.messages.at(-1).id,'after-action');
});
test('退出登录后迟到的同步结果被拒绝，旧游标清空',async()=>{
  let release,epoch=1;const client=Sync.create({getEpoch:()=>epoch,request:()=>new Promise(resolve=>{release=resolve;})});
  const pending=client.refresh();while(!release)await Promise.resolve();epoch++;client.reset();release(reset(1));
  await assert.rejects(pending,error=>error.stale===true);assert.deepEqual(client.headers(),{});
});
test('退出/换账号重置队列后新会话不用等旧fetch释放，旧响应仍stale',async()=>{
  let release,first=true;const responses=[reset(0,'new-session'),state(0,[message('new-account')]),delta(0,0,{},'new-session')];
  const client=Sync.create({request:()=>first?(first=false,new Promise(resolve=>{release=resolve;})):Promise.resolve(responses.shift())});
  const old=client.refresh();while(!release)await Promise.resolve();client.reset();
  const fresh=await Promise.race([client.refresh(),new Promise((_,reject)=>setTimeout(()=>reject(Error('新会话被旧fetch阻塞')),100))]);
  assert.equal(fresh.state.messages[0].id,'new-account');release(reset(9,'old-session'));await assert.rejects(old,error=>error.stale===true);
  assert.equal(client.headers()['X-Pipi-Sync-Cursor'],'new-session:0');
});
test('错误的协议包明确失败，不以不完整messages继续运行',async()=>{
  const f=await initialized();f.responses.push({...delta(1,2),changes:{upsertMessages:[],deleteMessageIds:[],replace:{messages:[]}}});
  await assert.rejects(f.client.refresh(),/增量数据无效/);assert.equal(f.client.headers()['X-Pipi-Sync-Cursor'],'server-a:1');
});

const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const apiSource=app.slice(app.indexOf('  async function api(path'),app.indexOf('  function readBlobData('));
function apiFixture(respond,{enabled=true}={}){
  const calls=[],scope=vm.createContext({console,fetch:async(route,options)=>{calls.push({route,...options});const result=await respond(route,options);return {status:result.status||200,ok:(result.status||200)<400,json:async()=>result.body};}});
  vm.runInContext(`let authEpoch=1,csrf='csrf-current',state=null;globalThis.window={PipiEngine:{stop(){}}};function setState(next){state=next;}function closeModal(){}function renderAuth(){authEpoch++;state=null;}${apiSource}globalThis.testAPI={api,apiRaw,getState:()=>state,getCSRF:()=>csrf};`,scope);
  const client=enabled?Sync.create({request:(route)=>scope.testAPI.api(route,undefined,'GET',true),getEpoch:()=>vm.runInContext('authEpoch',scope)}):null;
  scope.window.PipiStateSync={client,reset(){client?.reset();}};return {scope,calls,api:scope.testAPI,client};
}
test('真实api包装：协商后的GET状态走sync，动作保留CSRF并返回原state形状',async()=>{
  const f=apiFixture(route=>({body:route==='/api/sync'?reset(1):route==='/api/state'?state(1,[message('old')]):route.includes('/api/sync?')?delta(1,1):{accepted:true,csrfToken:'csrf-next',sync:delta(1,2,{upsertMessages:[message('new')]})}}));
  const full=await f.api.api('/api/state');assert.equal(full.state.messages.length,1);
  const action=await f.api.api('/api/action',{type:'test'});assert.equal(action.state.messages.length,2);assert.equal(action.accepted,true);
  assert.equal(f.calls.at(-1).headers['X-CSRF-Token'],'csrf-current');assert.equal(f.calls.at(-1).headers['X-Pipi-State-Mode'],'delta');assert.equal(f.api.getCSRF(),'csrf-next');
});
test('真实apiRaw包装：二进制提交也归并sync，401清除游标并保留错误码',async()=>{
  let denied=false;const f=apiFixture(route=>({status:denied?401:200,body:denied?{error:'请登录',code:'AUTH'}:route==='/api/sync'?reset(1):route==='/api/state'?state(1,[message('old')]):route.includes('/api/sync?')?delta(1,1):{url:'/api/media/synthetic.png',sync:delta(1,2)}}));
  await f.api.api('/api/state');const saved=await f.api.apiRaw('/api/media/upload','bytes');assert.equal(saved.state.messages.length,1);assert.equal(f.calls.at(-1).headers['X-Pipi-Sync-Cursor'],'server-a:1');
  denied=true;await assert.rejects(f.api.api('/api/test',{}),error=>error.status===401&&error.code==='AUTH');assert.deepEqual(f.client.headers(),{});
});
test('真实api包装：旧服务器能力关闭时保留原state接口和原始响应',async()=>{
  const original=state(9,[message('legacy')]),f=apiFixture(()=>({body:original}),{enabled:false});
  const result=await f.api.api('/api/state?since=8');assert.equal(result,original);assert.equal(f.calls[0].route,'/api/state?since=8');assert.equal(f.calls[0].headers['X-Pipi-State-Mode'],undefined);
});
test('真实api包装：调用者忽略动作state时，下一次poll仍将新状态交给页面',async()=>{
  let round=0;const f=apiFixture(route=>({body:route==='/api/sync'?reset(1):route==='/api/state'?state(1,[message('old')]):route.includes('/api/sync?')?++round===1?delta(1,1):delta(2,2):{sync:delta(1,2,{upsertMessages:[message('new')]})}}));
  const initial=await f.api.api('/api/state');f.scope.initial=initial.state;vm.runInContext('setState(initial)',f.scope);
  await f.api.api('/api/action',{});const next=await f.api.api('/api/state?since=1');
  assert.equal(next.unchanged,false);assert.equal(next.state.revision,2);assert.equal(next.state.messages.at(-1).id,'new');
});
test('先未登录status再登录：完整登录state保留，第一次同步仍建立权威cursor',async()=>{
  const calls=[],responses=[reset(4),state(4,[message('older'),message('after-login')]),delta(4,4)];
  Sync.configure({authenticated:false,clientProtocol:{features:['sync-v1']}},{request:async route=>{calls.push(route);return responses.shift();}});
  const login=await Sync.client.accept({state:state(4,[message('older'),message('after-login')]),csrfToken:'login-csrf'});
  Sync.observe(login.state);assert.deepEqual(Sync.client.headers(),{});
  const result=await Sync.client.refresh();assert.equal(result.state.messages.length,2);assert.equal(Sync.client.headers()['X-Pipi-Sync-Cursor'],'server-a:4');assert.equal(calls[0],'/api/sync');
  Sync.configure({clientProtocol:{features:[]}},{request:async()=>{throw Error('must not run');}});assert.equal(Sync.client,null);
});
test('同一epoch的过期reset不能回退已经观察到的较新完整state',async()=>{
  const f=await initialized();f.client.observe(state(5,[message('latest')]));f.responses.push(reset(2),state(2,[message('stale')]),delta(2,2));
  await assert.rejects(f.client.refresh(),/落后于当前页面/);
});
test('真实setState/receiveState：新epoch低revision可以替换，随后迟到的旧reset不覆盖新内容',async()=>{
  const f=await initialized();f.responses.push(reset(0,'server-b'),state(0,[message('restored')]),delta(0,0,{},'server-b'));
  const replaced=(await f.client.refresh()).state;
  const start=app.indexOf('  function setState('),end=app.indexOf('  // A revision gap',start),scope=vm.createContext({initial:state(10,[message('old-installation')])});
  scope.sync={observe:f.client.observe,replaces:f.client.replaces};
  vm.runInContext(`let state=initial,pendingRender=false;const view={};globalThis.window={PipiStateSync:sync};function trackNewChatMessages(){}function syncVisibleChatRead(){}function scheduleRender(){}function flushRender(){}${app.slice(start,end)}globalThis.ui={setState,receiveState,get:()=>state};`,scope);
  scope.ui.receiveState(replaced);assert.equal(scope.ui.get().revision,0);assert.equal(scope.ui.get().messages[0].id,'restored');
  const next=await f.client.accept({sync:delta(0,2,{upsertMessages:[message('new')]},'server-b')});scope.ui.receiveState(next.state);
  scope.ui.receiveState(replaced);assert.equal(scope.ui.get().revision,2);assert.equal(scope.ui.get().messages.at(-1).id,'new');assert.equal(f.client.replaces(next.state),false);
});
test('真实api包装：退出或换账号后旧动作响应被丢弃，不写入新登录页面',async()=>{
  let release;const f=apiFixture(route=>route==='/api/held'?new Promise(resolve=>{release=()=>resolve({body:{state:state(99,[message('private-old-account')])}});}):{body:{}});
  const pending=f.api.api('/api/held',{});while(!release)await Promise.resolve();vm.runInContext('authEpoch++',f.scope);f.client.reset();release();
  await assert.rejects(pending,error=>error.stale===true);assert.equal(f.api.getState(),null);assert.deepEqual(f.client.headers(),{});
});
test('五万消息的无变化和非消息字段delta复用messages数组，单条消息更新仍保留全部历史',async t=>{
  const many=Array.from({length:50000},(_,index)=>message('m'+index,'合成历史'.repeat(20)));
  const f=fixture([reset(1),state(1,many),delta(1,1),delta(1,1),delta(1,2,{replace:{settings:{only:'new-field'}}}),delta(2,3,{upsertMessages:[message('m49999','updated')]})]);
  const first=await f.client.refresh(),at=performance.now(),empty=await f.client.refresh(),changed=await f.client.refresh(),last=await f.client.refresh();
  assert.equal(empty.state.messages,first.state.messages);assert.equal(changed.state.messages,first.state.messages);assert.deepEqual(changed.state.settings,{only:'new-field'});
  assert.equal(last.state.messages.length,50000);assert.equal(last.state.messages.at(-1).content,'updated');
  t.diagnostic(JSON.stringify({messages:50000,threeDeltasMs:performance.now()-at,scope:'Node中实际客户端合并逻辑，非手机渲染或线上速度验收'}));
});
