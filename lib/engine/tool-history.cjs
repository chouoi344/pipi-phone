// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../state.cjs');
const UNKNOWN='动作被中断，结果尚未确认。不要声称成功，也不要自动重复操作。';

function begin(state,roleId,targetId,runId,assistant){
  const execution=state.engine.data.execution;
  // A deleted or recalled message must not be reintroduced by an in-flight task.
  if(!state.messages.some(m=>m.id===targetId&&m.roleId===roleId&&m.sender==='user'&&m.meta?.kind!=='recalled'))return null;
  const calls=assistant.tool_calls.filter(call=>call.function.name!=='select_message_targets');
  if(!calls.length)return null;
  execution.history??={};
  const turn=execution.history[targetId]??={roleId,blocks:[]};
  turn.blocks.push({runId,at:Date.now(),assistant:structuredClone({...assistant,tool_calls:calls}),results:[]});
  return turn.blocks.length-1;
}
function result(state,targetId,index,message){
  const block=state.engine.data.execution.history?.[targetId]?.blocks[index];
  if(block?.assistant.tool_calls.some(call=>call.id===message.tool_call_id))block.results.push(structuredClone(message));
}
function has(state,id){return Boolean(state?.engine?.data?.execution?.history?.[id]?.blocks.length);}
function historyResult(value){
  return JSON.stringify(value,(key,item)=>key==='messageId'||key==='messageIds'?undefined:item);
}
function messages(state,item){
  const execution=state.engine?.data?.execution,turn=execution?.history?.[item.id];
  if(!turn||turn.roleId!==item.roleId||item.meta?.kind==='recalled')return [];
  return turn.blocks.flatMap(block=>{
    // Current memories are retrieved for this turn. Old tool snapshots can contain forgotten facts.
    const calls=block.assistant.tool_calls.filter(({function:fn})=>!require('./modules/memory.cjs').isMemoryTool(fn.name)
      &&!['select_message_targets','reply_quote','recall_message'].includes(fn.name)
      &&!(fn.name==='send_image'&&fn.arguments.includes('"messageId"')));
    if(!calls.length)return [];
    return [structuredClone({...block.assistant,role:'assistant',tool_calls:calls}),
    ...calls.map(call=>{
      const saved=block.results.find(r=>r.tool_call_id===call.id);
      const action=execution.actions.findLast(a=>a.runId===block.runId&&a.callId===call.id&&a.name===call.function.name&&a.at>=block.at);
      let value;
      if(saved){
        try{value=JSON.parse(saved.content);}catch(error){if(!(error instanceof SyntaxError))throw error;value=saved.content;}
      }else value=action?.status==='completed'?action.result??{ok:true}:{error:action?.error||UNKNOWN};
      const receipt=require('./tool-receipt.cjs').toolResultForModel(call.function.name,value);
      let content=typeof receipt==='string'?receipt:historyResult(receipt);
      if(content.length>32768)content=JSON.stringify({error:'动作已执行，但结果过长，未载入完整结果。不要重复执行。'});
      return {role:'tool',tool_call_id:call.id,content};
    })];
  });
}
function remove(state,ids){
  const history=state.engine?.data?.execution?.history;
  if(history)for(const id of ids)delete history[id];
}
function validate(state){
  const execution=state.engine.data.execution,history=execution.history;
  if(history===undefined)return;
  if(!S.obj(history))S.fail('工具历史备份无效');
  for(const [id,turn]of Object.entries(history)){
    if(!S.obj(turn)||!state.messages.some(m=>m.id===id&&m.roleId===turn.roleId&&m.sender==='user')||!Array.isArray(turn.blocks))S.fail('工具历史所属会话无效');
    for(const block of turn.blocks){
      const message=block?.assistant,calls=message?.tool_calls;
      if(!S.obj(block)||execution.runs[block.runId]?.roleId!==turn.roleId||!Number.isFinite(block.at)||!S.obj(message)||!Array.isArray(calls)||!calls.length||calls.length>8||!Array.isArray(block.results))S.fail('工具历史记录无效');
      const ids=new Set();
      for(const call of calls){
        if(!S.obj(call)||typeof call.id!=='string'||!call.id||ids.has(call.id)||call.type!=='function'||!S.obj(call.function)||typeof call.function.name!=='string'||typeof call.function.arguments!=='string')S.fail('工具历史调用无效');
        ids.add(call.id);
      }
      const results=new Set();
      for(const reply of block.results){
        if(!S.obj(reply)||reply.role!=='tool'||!ids.has(reply.tool_call_id)||results.has(reply.tool_call_id)||typeof reply.content!=='string'||reply.content.length>32768)S.fail('工具历史结果无效');
        results.add(reply.tool_call_id);
      }
    }
  }
}
module.exports={begin,result,has,messages,remove,validate,historyResult};
