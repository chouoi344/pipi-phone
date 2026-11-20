// SPDX-License-Identifier: MIT
'use strict';
// Run: node tests/headless-ui-clear043.cjs --out=<isolated-artifacts>
module.exports=async function clear043(t){
 const {assert,evaluate,wait,click,capture,check,command,delay,metrics}=t;
 await check('clear043 confirmed conversation clear preserves role memory and unrelated messages through reload',async()=>{
  let id;
  try{
   await evaluate("Pipi.act('role.save',{name:'CLEAR043 disposable fixture',prompt:'No provider calls'})");
   id=await evaluate("Pipi.getState().roles.find(r=>r.name==='CLEAR043 disposable fixture').id");
   await evaluate('(async()=>{const b=await Pipi.api("/api/backup");b.state.messages.push({id:"clear043-message",roleId:'+JSON.stringify(id)+',sender:"assistant",type:"text",content:"CLEAR043 visible sentinel",status:"sent",createdAt:Date.now()});const r=await Pipi.api("/api/restore",{backup:b,confirm:true});Pipi.setState(r.state);await Pipi.act("memory.save",{roleId:'+JSON.stringify(id)+',content:"CLEAR043 memory must survive"});})()');
   const before=await evaluate('({role:Pipi.getState().roles.find(r=>r.id==='+JSON.stringify(id)+'),memory:Pipi.getState().memories.filter(r=>r.roleId==='+JSON.stringify(id)+'),unrelated:Pipi.getState().messages.filter(r=>r.roleId!=='+JSON.stringify(id)+')})');
   assert.ok(before.memory.length>0);await click('[data-nav=chats]');await click('[data-open-chat="'+id+'"]');await wait('document.querySelector("#chat-messages").textContent.includes("CLEAR043 visible sentinel")');await click('[data-action=chat-details]');await click('[data-action=clear-conversation]');await wait('!!document.querySelector("#alert-confirm")');await capture('clear043-before-confirm');await click('#alert-confirm');await wait('!Pipi.getState().messages.some(m=>m.roleId==='+JSON.stringify(id)+')');await wait('!document.querySelector("#alert-confirm")');
   const stateExpr='({role:Pipi.getState().roles.find(r=>r.id==='+JSON.stringify(id)+'),memory:Pipi.getState().memories.filter(r=>r.roleId==='+JSON.stringify(id)+'),unrelated:Pipi.getState().messages.filter(r=>r.roleId!=='+JSON.stringify(id)+')})';assert.deepEqual(await evaluate(stateExpr),before);
   await command('Page.reload');await wait('!!document.querySelector(".bottom-tabs")');assert.deepEqual(await evaluate(stateExpr),before);assert.equal(await evaluate('Pipi.getState().messages.filter(m=>m.roleId==='+JSON.stringify(id)+').length'),0);await click('[data-nav=chats]');await click('[data-open-chat="'+id+'"]');assert.equal(await evaluate('document.querySelectorAll("[data-bubble]").length'),0);await capture('clear043-after-reload');metrics.push({kind:'clear043-confirm',actualVisibleConfirmation:true,messagesAfter:0,roleExactRetained:true,memoryExactRetained:true,unrelatedMessagesExactRetained:true,reload:true});
  }catch(error){await capture('clear043-failure').catch(()=>{});throw error;}finally{if(id)await evaluate('Pipi.act("role.delete",{id:'+JSON.stringify(id)+'})');}
 });
};
