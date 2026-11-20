// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDemoProvider,KEY}=require('../scripts/demo-provider.cjs');
async function fixture(t){
  const provider=createDemoProvider();await provider.listen();t.after(()=>provider.close());
  const base='http://127.0.0.1:'+provider.server.address().port;
  const chat=async body=>{const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(body||{model:'local-demo-chat',messages:[{role:'user',content:'你好'}]})});return {response,status:response.status,body:await response.json()};};
  return {provider,base,chat};
}
test('engine demo provider: queued failures and completions expose request snapshots without credentials',async t=>{
  const {provider,chat,base}=await fixture(t),result={id:'queued',choices:[{message:{role:'assistant',content:'接管成功'}}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}};
  provider.setScenario({responses:[{status:503,body:{error:{message:'受控故障'}}},{status:429,body:{error:{message:'受控限流'}}},{status:200,body:result}]});
  assert.equal((await chat()).status,503);assert.equal((await chat()).status,429);
  const tools=[{type:'function',function:{name:'pat_user',parameters:{type:'object',properties:{}}}}],messages=[{role:'system',content:'只在隔离目录验证。'},{role:'user',content:'拍我一下'}];
  const success=await chat({model:'local-demo-chat',tools,messages,key:'do-not-record',extra:{Authorization:'do-not-record-either',api_key:'hidden',safe:true}});
  assert.equal(success.status,200);assert.deepEqual(success.body,result);const saved=provider.requests.at(-1);assert.deepEqual(saved.body.tools,tools);assert.deepEqual(saved.body.messages,messages);assert.equal(saved.body.model,'local-demo-chat');assert.deepEqual(saved.body.extra,{safe:true});assert.equal(saved.body.key,undefined);assert.equal(saved.headers,undefined);
  const publicState=await(await fetch(base+'/demo/state')).json();assert.doesNotMatch(JSON.stringify(publicState.requests),/do-not-record|Authorization|api_key/);assert.equal(publicState.requests.length,3);
});
test('engine demo provider: tools mode calls the supplied pat tool once and accepts its result before a normal reply',async t=>{
  const {provider,chat}=await fixture(t);provider.setScenario({mode:'tools'});
  const tools=[{type:'function',function:{name:'pat_user',description:'拍用户',parameters:{type:'object',properties:{}}}}],messages=[{role:'user',content:'拍拍我'}];
  const first=await chat({model:'local-demo-chat',messages,tools}),message=first.body.choices[0].message;
  assert.equal(message.tool_calls.length,1);assert.equal(message.tool_calls[0].function.name,'pat_user');assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments),{});assert.equal(first.body.choices[0].finish_reason,'tool_calls');assert.equal(first.body.usage.total_tokens,43);
  const toolMessage={role:'tool',tool_call_id:message.tool_calls[0].id,content:'已拍一拍用户'};
  const second=await chat({model:'local-demo-chat',messages:[...messages,message,toolMessage],tools});
  assert.equal(second.body.choices[0].finish_reason,'stop');assert.equal(second.body.choices[0].message.tool_calls,undefined);assert.match(second.body.choices[0].message.content,/动作已完成/);assert.deepEqual(provider.requests[1].body.messages.at(-1),toolMessage);
});
test('engine demo provider: queued delay applies to one response and later requests resume ordinary success',async t=>{
  const {provider,chat}=await fixture(t);provider.enqueueResponses([{status:200,body:{choices:[],marker:'first-only'},delayMs:30}]);const started=Date.now(),first=await chat();assert.ok(Date.now()-started>=25);assert.equal(first.body.marker,'first-only');const second=await chat();assert.match(second.body.choices[0].message.content,/本地演示响应/);assert.equal(provider.requests[0].scenario,true);assert.equal(provider.requests[1].scenario,undefined);
});
test('engine demo provider: existing retry mode still fails its first request and then succeeds; model listing stays unchanged',async t=>{
  const {provider,chat,base}=await fixture(t);provider.setScenario({mode:'retry'});assert.equal((await chat()).status,503);assert.equal((await chat()).status,200);provider.setScenario();const list=await(await fetch(base+'/v1/models',{headers:{Authorization:'Bearer '+KEY}})).json();assert.deepEqual(list.data.map(model=>model.id),['local-demo-chat','local-demo-vision','local-demo-tts','local-demo-stt']);
});
test('engine demo provider: invalid scenarios are rejected without replacing an existing queue',async t=>{
  const {provider,chat}=await fixture(t);provider.enqueueResponses([{status:409,body:{marker:'retained'}}]);for(const responses of [[{status:200},{status:999}],null,[{delayMs:-1}],['invalid']])assert.throws(()=>provider.setScenario({mode:'tools',responses}),TypeError);assert.equal(provider.mode,'success');const retained=await chat();assert.equal(retained.status,409);assert.equal(retained.body.marker,'retained');assert.throws(()=>provider.setScenario({mode:'unknown'}),TypeError);
});
