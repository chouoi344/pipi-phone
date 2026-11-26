// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{setTimeout:wait}=require('node:timers/promises');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),E=require('../lib/engine/execution.cjs');
const {createApp}=require('../server.cjs');
const PASSWORD='Synthetic-dedup-only_2026!';
const first='{"amountYuan":1,"note":"同一收款对象的明确两笔"}';
const reordered='{"note":"同一收款对象的明确两笔","amountYuan":1}';
function transfer(id,args=first){return {id,type:'function',function:{name:'send_transfer',arguments:args}};}
function tools(...calls){return {role:'assistant',content:null,tool_calls:calls};}
function answer(){return {role:'assistant',content:'固定协议测试结束。'};}
async function until(check,label){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){const value=check();if(value)return value;await wait(10);}
  throw new Error('等待隔离产品路径超时：'+label);
}
async function fixture(t,respond){
  const old=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const requests=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));requests.push(body);
    const message=respond(body,requests.length,res);
    if(message!==undefined){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}],usage:{prompt_tokens:10,completion_tokens:5}}));}
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-tool-dedup-'));
  const initialState=()=>{
    const state=S.initial();R.ensure(state);S.apply(state,'role.save',{name:'隔离转账角色'});
    for(const module of R.list())if(module.settings.some(setting=>setting.key==='enabled'))R.apply(state,module.id,{enabled:false});
    R.apply(state,'waiting',{enabled:false,mode:'timer',idleSeconds:0,maxWaitSeconds:1});
    R.apply(state,'segments',{enabled:false,minSeconds:0,maxSeconds:0});
    state.settings.ai.sources=[{id:'fixture',name:'本机固定协议',baseUrl:'http://127.0.0.1:'+upstream.address().port+'/v1',key:'synthetic-loopback-key',builtin:false}];
    state.settings.ai.models=[{id:'fixture',sourceId:'fixture',model:'fixture',kind:'chat',capabilities:['text','tool_use'],maxContextTokens:128000,timeoutSeconds:2,temperature:null,maxTokens:null,extraBody:{}}];
    state.settings.ai.assign={chat:'fixture',chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''};
    return state;
  };
  const app=createApp({dataDir,initialState,host:'127.0.0.1',port:0});await app.listen();
  t.after(async()=>{
    await app.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
    assert.ok(path.dirname(dataDir)===os.tmpdir()&&path.basename(dataDir).startsWith('pipi-tool-dedup-'));
    fs.rmSync(dataDir,{recursive:true,force:true});
    if(old===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=old;
  });
  const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,body){
    const response=await fetch(base+route,{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
    const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
    assert.equal(response.status,200,JSON.stringify(value));return value;
  }
  await request('/api/setup',{password:PASSWORD,displayName:'隔离工具测试'});
  const state=()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json),roleId=state().roles[0].id;
  const runFor=id=>Object.values(state().engine.data.execution?.runs||{}).find(run=>run.targetId===id);
  async function send(){return (await request('/api/chat',{roleId,text:'请按固定协议执行虚拟转账',requestId:randomUUID()})).messageId;}
  async function finish(id,status='completed'){return until(()=>{const run=runFor(id);if(run?.status==='failed'&&status!=='failed')throw new Error(run.error);return run?.status===status&&state();},status);}
  return {request,state,requests,roleId,send,finish,runFor};
}
function observations(state){return {transactions:state.wallet.transactions.map(row=>({id:row.id,amountCents:row.amountCents,roleId:row.roleId})),actions:state.engine.data.execution.actions.map(row=>({id:row.id,callId:row.callId,status:row.status,resultId:row.result?.id}))};}

test('真实产品路径：同批不同callId、参数键序不同的两次明确转账都执行',async t=>{
  const f=await fixture(t,(_,round)=>round===1?tools(transfer('intent-one'),transfer('intent-two',reordered)):answer());
  const state=await f.finish(await f.send());t.diagnostic(JSON.stringify(observations(state)));
  assert.equal(state.wallet.transactions.length,2,'不同键序不应让第二笔明确转账被当成第一笔重放');
  assert.equal(new Set(state.wallet.transactions.map(row=>row.id)).size,2);
  assert.deepEqual(state.engine.data.execution.actions.map(row=>row.callId),['intent-one','intent-two']);
  assert.equal(state.wallet.roleBalances[f.roleId],99800);
});

test('真实产品路径：同批不同callId、相同键序的两次明确转账仍各执行一次',async t=>{
  const f=await fixture(t,(_,round)=>round===1?tools(transfer('same-one'),transfer('same-two')):answer());
  const state=await f.finish(await f.send());
  assert.equal(state.wallet.transactions.length,2);assert.equal(state.wallet.roleBalances[f.roleId],99800);
  assert.deepEqual(state.engine.data.execution.actions.map(row=>row.callId),['same-one','same-two']);
});

test('真实产品路径：下一轮以新callId和不同键序重复同一转账只复用原结果',async t=>{
  const f=await fixture(t,(_,round)=>round===1?tools(transfer('round-one')):round===2?tools(transfer('round-two',reordered)):answer());
  const state=await f.finish(await f.send());
  assert.equal(state.wallet.transactions.length,1);assert.equal(state.wallet.roleBalances[f.roleId],99900);
  const results=f.requests.at(-1).messages.filter(row=>row.role==='tool').map(row=>JSON.parse(row.content));
  assert.equal(results.length,2);assert.equal(results[0].id,results[1].id);
});

test('真实产品路径：动作已提交后模型失败，用户显式重试不再次扣款',async t=>{
  const f=await fixture(t,(_,round,res)=>{
    if(round===1)return tools(transfer('before-failure'));
    if(round===2){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'synthetic nonretryable failure'}}));return;}
    return round===3?tools(transfer('after-user-retry',reordered)):answer();
  });
  const messageId=await f.send();const failed=await f.finish(messageId,'failed'),runId=f.runFor(messageId).id;
  assert.equal(failed.wallet.transactions.length,1);
  await f.request('/api/chat/retry',{messageId});const state=await f.finish(messageId);
  assert.equal(f.runFor(messageId).id,runId);assert.equal(state.wallet.transactions.length,1);
  assert.equal(state.wallet.roleBalances[f.roleId],99900);
});

test('执行账本：重启留下unknown的动作阻止重放，且不假报成功',async()=>{
  let state=S.initial();R.ensure(state);S.apply(state,'role.save',{name:'隔离未知动作'});
  const roleId=state.roles[0].id,executionId='synthetic-unknown';E.start(state,{id:executionId,roleId});
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {value};};
  const ctx={getState,mutate,roleId,executionId,callId:'before-restart',dedupeSeq:0};
  let release;const pending=E.execute('send_transfer',JSON.parse(first),ctx,()=>new Promise(resolve=>{release=resolve;}));
  assert.equal(E.data(state).actions[0].status,'running');E.recover(state);
  let repeated=0;
  await assert.rejects(E.execute('send_transfer',JSON.parse(reordered),{...ctx,callId:'after-restart'},()=>{repeated++;}),{code:'ACTION_UNCERTAIN'});
  assert.equal(repeated,0);assert.equal(E.data(state).actions[0].status,'unknown');
  release({ok:true});await pending;
});
