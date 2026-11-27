// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/engine/registry.cjs'),S=require('../lib/state.cjs'),P=require('../lib/engine/pipeline.cjs');
const E=require('../lib/engine/execution.cjs'),H=require('../lib/engine/tool-history.cjs');
const {filterDialogue,dialogueText,internalIds}=require('../lib/engine/response.cjs');
const {toolResultForModel}=require('../lib/engine/tool-receipt.cjs');
const {sampleState}=require('../scripts/sample-data.cjs');
const id='a4c97c51-6109-4d94-9235-d290f1751d17';
test('完整保留泄漏行前后的正常对白，每个实际工具的文字调用都被识别',()=>{
  const refs=R.modules.flatMap(m=>m.tools.flatMap(g=>g.definitions?g.definitions(null,null,null,true):[g])).map(d=>d.function.name);
  assert.ok(refs.length>=22);
  const lines=['你发出转账：1.00元；说明：最后的全部家当了；当前状态：已领取；款项编号：'+id,
    '[系统事实] 已收款','[系统记录] 已发出','[工具执行记录]','（注：该条仅以普通文字发出，未发送语音）','[合并转发]','（图片）','（表情包）','（语音）',
    '用户拍了拍你','用户拍了拍自己的头','你拍了拍用户','内容情绪：快乐','声音情绪：平静',
    '{"tool_calls":[{}]}','{"name":"anything","arguments":{}}',
    '<tool_call>\n{"arguments":{}}\n</tool_call>','<function_call>{}</function_call>','<tool_result>已发送</tool_result>',
    '<invoke name="send_voice">abc</invoke>','\x60\x60\x60json\n{"name":"pat_user","arguments":{}}\n\x60\x60\x60',
    ...refs.flatMap(name=>[name+'(',name+' {}','调用 '+name,'{"name":"'+name+'"}'])];
  for(const raw of lines){
    assert.equal(dialogueText('今晚吃面\n'+raw+'\n明天出门'), '今晚吃面\n明天出门',raw);
  }
  for(const text of ['我刚给你转账了，记得收','你拍了拍我是想干嘛','这个功能要调用摄像头','\x60\x60\x60js\nconsole.log("hello")\n\x60\x60\x60']){
    assert.equal(dialogueText(text),text);
  }
  assert.equal(filterDialogue('pat_user()').toolEcho,true);
  assert.equal(filterDialogue('红包记得收').toolEcho,false);
});
test('自有交易、媒体、动态、任务和表情的编号及其标签一同剔除',()=>{
  const state=sampleState(),role=state.roles[0];R.ensure(state);
  const tx=id,media=id.replace(/^a/,'b'),moment=id.replace(/^a/,'c'),task=id.replace(/^a/,'d'),sticker=id.replace(/^a/,'e');
  state.wallet.transactions.push({id:tx,roleId:role.id});
  (state.engine.data.actions.roleMedia??=[]).push({id:media,roleId:role.id});
  state.moments.push({id:moment,authorId:role.id,visibility:'all'});
  (state.engine.jobs??=[]).push({id:task,roleId:role.id});
  role.stickers.push({id:sticker});
  const ids=internalIds(state,role.id),external='b4c97c51-6109-4d94-9235-d290f1751d19';
  for(const [label,value] of [['款项编号',tx],['交易标识',tx],['媒体编号',media],['动态编号',moment],['任务编号',task],['表情标识',sticker]]){
    assert.equal(dialogueText('看看【'+label+'：'+value+'】吧',ids),'看看吧');
  }
  assert.equal(dialogueText(external,ids),external);
});
test('旧工具历史、重试和本轮回执使用相同事实，原始交易仍留在账本',()=>{
  const s=sampleState(),r=s.roles[0];R.ensure(s);const target=S.message(s,r,'user','红包呢？');
  const raw={id,amountYuan:1,note:'夜宵',direction:'out',status:'pending',createdAt:1,roleId:r.id,requestId:'request'};
  const receipt=toolResultForModel('send_redpacket',raw);
  assert.equal(receipt.amountYuan,1);assert.equal(receipt.note,'夜宵');assert.equal(receipt.ok,true);
  for(const key of ['id','direction','createdAt','roleId','requestId','status'])assert.ok(!Object.hasOwn(receipt,key));
  E.start(s,{id:'run',roleId:r.id});
  const call={id:'call',type:'function',function:{name:'send_redpacket',arguments:'{}'}};
  const index=H.begin(s,r.id,target.id,'run',{content:null,tool_calls:[call]});
  H.result(s,target.id,index,{role:'tool',tool_call_id:'call',content:JSON.stringify(raw)});
  const row={name:'send_redpacket',runId:'run',result:raw,status:'completed'};E.data(s).actions.push(row);
  assert.deepEqual(JSON.parse(H.messages(s,target)[1].content),receipt);
  assert.match(E.recoveryNote(s,'run'),/已发出红包/);assert.doesNotMatch(E.recoveryNote(s,'run'),/send_redpacket|pending|requestId|\{/);
  assert.deepEqual(row.result,raw);
  row.status='unknown';assert.match(E.recoveryNote(s,'run'),/不要声称成功/);
  const msg=S.message(s,r,'assistant','红包','redpacket',{meta:{amountCents:100,note:'夜宵',transactionId:id,status:'pending'}});
  s.wallet.transactions.push({id,roleId:r.id,status:'refunded',note:'夜宵'});
  const rendered=P.render(s,msg,false);assert.notEqual(rendered.role,'assistant');
  assert.match(rendered.content,/已退还/);assert.doesNotMatch(rendered.content,/待领取|a4c97c51/);
  msg.sender='user';s.wallet.transactions.at(-1).status='pending';
  assert.match(P.render(s,msg,false).content,/交易标识：a4c97c51/);
});
test('文本供给历史前剔除旧回声，用户原记录仍完整',()=>{
  const s=sampleState(),r=s.roles[0];R.ensure(s);
  const m=S.message(s,r,'assistant','早点吃饭\n[系统记录] 我发了一张图片\n晚上见');
  const allEcho=S.message(s,r,'assistant','（图片）');
  assert.deepEqual(P.renderHistory(s,[m,allEcho],false).map(m=>m.content),['早点吃饭\n晚上见']);
  assert.match(m.content,/\[系统记录\]/);assert.equal(allEcho.content,'（图片）');
});
