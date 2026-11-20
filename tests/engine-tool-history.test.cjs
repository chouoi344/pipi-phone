// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs'),P=require('../lib/engine/pipeline.cjs'),E=require('../lib/engine/execution.cjs'),H=require('../lib/engine/tool-history.cjs'),R=require('../lib/engine/registry.cjs');
const tool={type:'function',function:{name:'remember_action',parameters:{type:'object'}}};
const call={id:'call-history',type:'function',function:{name:'remember_action',arguments:'{"value":"已完成的事"}'},extra_content:{google:{thought_signature:'test-signature'}}};
function fixture(){
  let state=sampleState();state.messages=[];state.settings.modules.memory={enabled:false};
  const roleId=state.roles[0].id,requests=[];
  const config={id:'isolated',capabilities:['text','tool_use'],maxContextTokens:128000};
  const opts={getState:()=>structuredClone(state),mutate:fn=>{const next=structuredClone(state),value=fn(next);state=next;return {value};},roleId,
    modelApi:{resolve:()=>config,call:async(s,r)=>{const messages=await r.prepareMessages(config,r.messages);requests.push(structuredClone(messages));return {message:{content:'后续回答'},model:config,modelId:config.id};}}};
  function user(text,role=roleId){return S.message(state,S.role(state,role),'user',text);}
  async function act(execute){
    const target=user('执行一件事'),run=E.start(state,{id:S.id(),roleId});run.targetId=target.id;
    const previous=opts.modelApi.call;let count=0;
    opts.modelApi.call=async(s,r)=>{
      const messages=await r.prepareMessages(config,r.messages);requests.push(structuredClone(messages));
      return {message:count++?{content:'已办好'}:{content:null,tool_calls:[call]},model:config,modelId:config.id};
    };
    try{
      await P.run({...opts,targetId:target.id,executionId:run.id,tools:[tool],executeTool:(name,args,ctx)=>E.execute(name,args,{...ctx,executionId:run.id},execute||((n,a,c)=>c.mutate(()=>({done:'已完成的事'})).value))});
      S.message(state,S.role(state,roleId),'assistant','已办好');
    }finally{opts.modelApi.call=previous;}
    return {target,run};
  }
  return {opts,config,requests,roleId,user,act,state:()=>state,replace:s=>{state=s;}};
}

test('下一轮收到持久化的完整工具调用和结果，网页状态不暴露协议历史',async()=>{
  const f=fixture();await f.act();const next=f.user('刚才办好了吗？');
  // Simulate reloading persisted JSON rather than reusing in-memory objects.
  f.replace(JSON.parse(JSON.stringify(f.state())));
  await P.run({...f.opts,targetId:next.id});const sent=f.requests.at(-1);
  assert.equal(sent.filter(m=>m.tool_calls).length,1);
  assert.deepEqual(sent.find(m=>m.tool_calls).tool_calls[0],call);
  assert.equal(sent.find(m=>m.role==='tool').content,'{"done":"已完成的事"}');
  assert.equal(sent.find(m=>m.role==='tool').tool_call_id,call.id);
  assert.ok(sent.findIndex(m=>m.tool_calls)<sent.findIndex(m=>m.content?.includes('刚才办好了吗')));
  assert.equal(S.publicState(f.state()).engine.data.execution,undefined);
});

test('工具历史按好友隔离，按轮数裁剪时调用和结果一起退出',async()=>{
  const f=fixture();await f.act();
  const other=f.state().roles[1].id,otherQuestion=f.user('另一位好友',other);
  await P.run({...f.opts,roleId:other,targetId:otherQuestion.id});
  assert.ok(!JSON.stringify(f.requests.at(-1)).includes(call.id));
  R.apply(f.state(),'compression',{maxTurns:1});
  await P.run({...f.opts,targetId:f.user('只看最新一轮').id});
  assert.ok(!f.requests.at(-1).some(m=>m.tool_calls||m.role==='tool'));
  assert.ok(Object.keys(f.state().engine.data.execution.history).length>0);
});

test('不支持工具的模型读取文字形式的历史，不收到工具协议字段',async()=>{
  const f=fixture();await f.act();f.config.capabilities=['text'];
  await P.run({...f.opts,targetId:f.user('回顾一下').id});const sent=f.requests.at(-1);
  assert.ok(!sent.some(m=>m.tool_calls||m.role==='tool'));
  assert.ok(JSON.stringify(sent).includes('已完成的事'));
  assert.ok(JSON.stringify(sent).includes('remember_action'));
});

test('总结输入包含工具请求和结果，摘要边界后不重复注入旧工具历史',async()=>{
  const f=fixture();const {target}=await f.act();
  f.state().messages.find(m=>m.id===target.id).content='旧聊天'.repeat(1000);
  f.config.maxContextTokens=700;
  f.opts.modelApi.resolve=(s,purpose)=>purpose==='compress'?{...f.config,maxContextTokens:128000}:f.config;
  let summaryInput;
  const previous=f.opts.modelApi.call;
  f.opts.modelApi.call=async(s,r)=>{if(r.purpose==='compress'){summaryInput=JSON.stringify(r.messages);return {message:{content:'已经办好一件事'},model:f.config,modelId:f.config.id};}return previous(s,r);};
  await P.run({...f.opts,targetId:f.user('新问题').id});
  assert.ok(summaryInput.includes('remember_action'));
  assert.ok(summaryInput.includes('已完成的事'));
  assert.ok(!f.requests.at(-1).some(m=>m.tool_calls||m.role==='tool'));
  assert.ok(f.state().engine.summaries[f.roleId]);
});

test('工具副作用提交后中断，后续历史使用执行账本结果而不重跑动作',async()=>{
  const f=fixture(),controller=new AbortController();f.opts.signal=controller.signal;let effects=0;
  await assert.rejects(f.act((name,args,ctx)=>{
    ctx.mutate(()=>{effects++;return {done:'真实已执行'};});
    controller.abort();throw controller.signal.reason;
  }),{name:'AbortError'});
  assert.equal(effects,1);delete f.opts.signal;f.state().messages[0].status='error';
  await P.run({...f.opts,targetId:f.user('继续').id});
  assert.equal(f.requests.at(-1).find(m=>m.role==='tool').content,'{"done":"真实已执行"}');
  assert.equal(effects,1);
});

test('未确认的中断动作补齐未知结果，保留工具配对且不假定成功',async()=>{
  const f=fixture(),target=f.user('执行前中断'),run=E.start(f.state(),{id:S.id(),roleId:f.roleId});
  H.begin(f.state(),f.roleId,target.id,run.id,{content:null,tool_calls:[call]});
  await P.run({...f.opts,targetId:f.user('继续聊').id});const sent=f.requests.at(-1);
  assert.equal(sent.find(m=>m.role==='tool').tool_call_id,call.id);
  assert.match(sent.find(m=>m.role==='tool').content,/结果尚未确认/);
  assert.equal(f.state().engine.data.execution.actions.length,0);
});

test('工具历史随备份恢复，删除和清空聊天后不再保留关联历史',async()=>{
  const f=fixture();const {target}=await f.act();
  const backup={format:'pipi-phone',version:1,state:S.backupState(f.state())};
  const restored=S.validateBackup(backup,f.state());
  assert.deepEqual(restored.engine.data.execution.history,f.state().engine.data.execution.history);
  const invalid=structuredClone(backup);invalid.state.engine.data.execution.history[target.id].roleId=f.state().roles[1].id;
  assert.throws(()=>S.validateBackup(invalid,f.state()),/工具历史/);
  S.apply(restored,'message.delete',{id:target.id});assert.equal(H.has(restored,target.id),false);
  const recalled=S.validateBackup(backup,f.state());S.apply(recalled,'message.recall',{id:target.id});
  assert.equal(H.has(recalled,target.id),false);
  assert.doesNotThrow(()=>S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(recalled)},f.state()));
  S.apply(f.state(),'conversation.clear',{roleId:f.roleId});
  assert.equal(Object.keys(f.state().engine.data.execution.history).length,0);
});
