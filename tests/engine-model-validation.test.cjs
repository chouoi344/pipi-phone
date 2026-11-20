const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../lib/engine/models.cjs'),P=require('../lib/providers.cjs'),C=require('../lib/engine/model-catalog.cjs');
function state(){return {settings:{ai:{sources:[{id:'isolated',name:'隔离',baseUrl:'https://isolated.invalid',key:'ISOLATED'}],models:['main','backup'].map(id=>({id,sourceId:'isolated',model:id,kind:'chat',capabilities:['text'],maxContextTokens:10000,extraBody:{}})),assign:{chat:'main',chatFallbacks:['backup']}}}};}
test('structured schedule response failure uses existing fallback once and records both attempts',async t=>{
  const calls=[],usage=[];t.mock.method(C,'resolveCapacity',async()=>({value:10000}));
  t.mock.method(P,'request',async c=>{calls.push(c.id);return {choices:[{message:{role:'assistant',content:c.id==='main'?'bad':'{"valid":true}'}}]};});
  const s=state();M.migrate(s);const before=JSON.stringify(s.settings.ai);
  const result=await M.call(s,{messages:[],onUsage:x=>usage.push(x),validateResponse:message=>{
    try{return JSON.parse(message.content);}catch{throw Object.assign(new Error('日程格式错误'),{code:'PROVIDER_RESPONSE'});}
  }});
  assert.deepEqual(calls,['main','backup']);assert.deepEqual(result.parsed,{valid:true});assert.deepEqual(usage.map(x=>x.success),[false,true]);
  assert.deepEqual(s.settings.ai.assign,JSON.parse(before).assign);
});
test('unknown parser bugs and usage write failures do not call another model',async t=>{
  t.mock.method(C,'resolveCapacity',async()=>({value:10000}));let calls=0;
  t.mock.method(P,'request',async()=>{calls++;return {choices:[{message:{content:'ok'}}]};});
  await assert.rejects(M.call(state(),{messages:[],validateResponse:()=>{throw new TypeError('parser bug');}}),{message:'parser bug'});assert.equal(calls,1);
  calls=0;await assert.rejects(M.call(state(),{messages:[],validateResponse:()=>({}),onUsage:()=>{throw new Error('storage failed');}}),{message:'storage failed'});assert.equal(calls,1);
});
