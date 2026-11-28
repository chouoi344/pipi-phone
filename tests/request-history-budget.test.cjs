// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Pipeline=require('../lib/engine/pipeline.cjs');
const MiB=1024*1024,OLD_LIMIT=20*MiB;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Every synthetic text message fits /api/chat's existing 16,000-character
// validator. No image preparation is bypassed and no provider is contacted.
function fixture({large=false,maxTurns=-1,capacity=128000}={}){
  const state=S.initial();R.ensure(state);S.apply(state,'role.save',{name:'历史字节预算隔离角色'});
  for(const module of R.list())if(module.settings.some(setting=>setting.key==='enabled'))R.apply(state,module.id,{enabled:false});
  R.apply(state,'compression',{strategy:'truncate',triggerRatio:1,maxTurns,dropTurns:1});
  const roleId=state.roles[0].id;
  const config={id:'synthetic-text',capabilities:['text'],maxContextTokens:capacity};
  state.settings.ai.sources=[{id:'synthetic',name:'只调用生产prepareMessages的本机测试',baseUrl:'http://127.0.0.1:1',key:'synthetic-not-used',builtin:false}];
  state.settings.ai.models=[{...config,sourceId:'synthetic',model:'synthetic-text',kind:'chat'}];
  state.settings.ai.assign={chat:config.id,chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''};
  const messages=[],roundCount=large?260:3,payload='历史对话文本。'.repeat(2000);
  for(let round=1;round<=roundCount;round++){
    messages.push({id:'historical-user-'+round,roleId,sender:'user',type:'text',content:S.text('旧问题'+round+(large?payload:'甲'.repeat(180)),16000),status:'sent',createdAt:round*2000});
    messages.push({id:'historical-answer-'+round,roleId,sender:'assistant',type:'text',content:S.text('OLDER_ROUND_'+round+(large?payload:'乙'.repeat(180)),16000),status:'sent',createdAt:round*2000+1});
  }
  const current={id:'current-user',roleId,sender:'user',type:'text',content:'CURRENT_QUESTION_保留当前问题',status:'sent',createdAt:(roundCount+1)*2000};
  messages.push(current);state.messages=messages;
  const requests=[],mutations=[];
  const options={getState:()=>structuredClone(state),mutate:fn=>{mutations.push(true);const value=fn(state);return {state:structuredClone(state),value};},roleId,targetId:current.id,now:()=>Date.parse('2026-11-25T12:00:00Z'),modelApi:{
    resolve:()=>config,
    async call(_state,request){
      assert.equal(request.purpose,'chat','truncate must not invoke a summarizer');
      // Invoke the real production projection hook just as the model adapter
      // does. This verifies context projection, not model/transport quality.
      const projected=await request.prepareMessages(config,request.messages);
      request.beforeRequest?.();requests.push(projected);
      return {message:{role:'assistant',content:'固定协议的测试回复。'},modelId:config.id,model:config};
    }
  }};
  return {state,options,requests,mutations,config,roundCount};
}

for(const maxTurns of [-1,1000])test('生产Pipeline在token充足、maxTurns='+maxTurns+'时保留超过旧20MiB的全部纯文本历史投影',async t=>{
  const f=fixture({large:true,maxTurns,capacity:100000000}),before=hash(f.state);
  assert.equal(await Pipeline.run(f.options),'固定协议的测试回复。');assert.equal(f.requests.length,1);
  const sent=f.requests[0],encodedBytes=Buffer.byteLength(JSON.stringify(sent));
  assert.equal(sent.at(-1).role,'user');assert.ok(sent.at(-1).content.startsWith('<system_reminder>'));
  const history=sent.slice(0,-1).filter(message=>message.role==='user'||message.role==='assistant');
  t.diagnostic(JSON.stringify({maxTurns,encodedBytes,oldLimitBytes:OLD_LIMIT,estimatedTokens:Pipeline.estimate(sent),capacity:f.config.maxContextTokens,retainedHistoryMessages:history.length,originalHistoryMessages:f.state.messages.length,maxMessageCharacters:Math.max(...f.state.messages.map(message=>message.content.length))}));
  assert.equal(hash(f.state),before,'projection must not change authoritative state');assert.equal(f.mutations.length,0);
  assert.ok(Pipeline.estimate(sent)<f.config.maxContextTokens,'fixture must fit the model token capacity');
  assert.equal(hash(history.map(message=>({role:message.role,content:message.content}))),hash(f.state.messages.map(message=>({role:message.sender,content:message.content}))),'旧20MiB预算不得删除或改写任何较早轮次（逐条角色/全文摘要必须完全相同）');
  assert.ok(encodedBytes>OLD_LIMIT,'all >20MiB history must reach the production prepareMessages boundary');
  assert.ok(sent.some(message=>message.content==='CURRENT_QUESTION_保留当前问题'));
});

test('生产Pipeline仍按真实token容量整轮裁剪，保留最新轮且不改原状态',async t=>{
  const f=fixture({capacity:800}),before=hash(f.state);await Pipeline.run(f.options);
  const sent=f.requests[0],text=JSON.stringify(sent),older=sent.filter(message=>typeof message.content==='string'&&message.content.startsWith('OLDER_ROUND_'));
  t.diagnostic(JSON.stringify({capacity:f.config.maxContextTokens,estimatedTokens:Pipeline.estimate(sent),retainedHistoricalRounds:older.length}));
  assert.ok(older.length<3,'insufficient tokens must still trim historical rounds');
  assert.ok(text.includes('CURRENT_QUESTION_保留当前问题'));assert.equal(hash(f.state),before);assert.equal(f.mutations.length,0);
  assert.ok(Pipeline.estimate(sent)<=f.config.maxContextTokens,'small current round should fit after trimming');
});

test('显式maxTurns仍生效，去除默认字节限额不等于取消用户轮数设置',async()=>{
  const f=fixture({maxTurns:2}),before=hash(f.state);await Pipeline.run(f.options);
  const text=JSON.stringify(f.requests[0]);assert.ok(!text.includes('OLDER_ROUND_1'));assert.ok(!text.includes('OLDER_ROUND_2'));assert.ok(text.includes('OLDER_ROUND_3'));assert.ok(text.includes('CURRENT_QUESTION_保留当前问题'));assert.equal(hash(f.state),before);
});
