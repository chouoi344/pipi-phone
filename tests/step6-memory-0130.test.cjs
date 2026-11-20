// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sampleState}=require('../scripts/sample-data.cjs'),S=require('../lib/state.cjs'),Store=require('../lib/engine/memory-store.cjs'),Memory=require('../lib/engine/modules/memory.cjs'),R=require('../lib/engine/registry.cjs');
const AT=Date.parse('2026-11-20T10:00:00Z');
function fixture(t,{disk=true}={}){
  const dataDir=disk?fs.mkdtempSync(path.join(os.tmpdir(),'pipi-step6-memory-')):undefined;
  if(dataDir)t.after(()=>{Store.close(dataDir);assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dataDir).startsWith('pipi-step6-memory-'));fs.rmSync(dataDir,{recursive:true,force:true});});
  const state=sampleState();state.messages=[];state.memories=[];state.settings.timezone='UTC';state.engine.data.memory={meta:{},profiles:{},vectors:{},lastExtracted:{},cursors:{}};R.apply(state,'memory',{enabled:true,useEmbedding:false});
  const roleId=state.roles[0].id;return {state,roleId,dataDir,getState:()=>state,mutate:fn=>({value:fn(state),state})};
}
const add=(f,content,options={})=>Store.upsertCard(f.dataDir,f.state,f.roleId,{content,...options});
const profile=f=>Store.getProfile(f.dataDir,f.state,f.roleId);
const execute=(f,name,args)=>Memory.tools[0].execute(name,args,f);

test('明确忘掉按来源去除画像，永久删卡清理老条目，无关画像和另一个好友保留',async t=>{
  for(const disk of [true,false])await t.test(disk?'SQLite':'旧内存状态',async t=>{
    const f=fixture(t,{disk}),first=add(f,'用户喜欢吃香菜'),other=add(f,'用户喜欢听民谣');
    Store.saveProfile(f.dataDir,f.state,f.roleId,{preferences:{饮食:['香菜','番茄'],音乐:['民谣']},sources:[{section:'preferences',field:'饮食',value:'香菜',memoryIds:[first.id],messageIds:[]},{section:'preferences',field:'音乐',value:'民谣',memoryIds:[other.id],messageIds:[]}]});
    const otherRole=f.state.roles[1].id;Store.saveProfile(f.dataDir,f.state,otherRole,{preferences:{饮食:['香菜']}});
    assert.equal((await execute(f,'forget_memory',{memoryId:first.id})).forgotten,true);assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,first.id).status,'forgotten');
    assert.deepEqual(profile(f).preferences,{饮食:['番茄'],音乐:['民谣']});assert.equal(JSON.stringify(profile(f)).includes('香菜'),false);
    assert.deepEqual(Store.getProfile(f.dataDir,f.state,otherRole).preferences,{饮食:['香菜']});
    const old=add(f,'用户喜欢吃香菜');Store.saveProfile(f.dataDir,f.state,f.roleId,{preferences:{饮食:['喜欢吃香菜','番茄','用户喜欢吃番茄'],音乐:['民谣']}});
    assert.equal(Store.deleteCard(f.dataDir,f.state,f.roleId,old.id),true);assert.deepEqual(profile(f).preferences,{饮食:['番茄','用户喜欢吃番茄'],音乐:['民谣']});
    assert.equal(Memory.profileForAI(f.dataDir,f.state,f.roleId).preferences.饮食.includes('喜欢吃香菜'),false);
  });
});
test('普通归档只暂时停止注入画像，显式恢复后原画像重新可用',t=>{
  const f=fixture(t),card=add(f,'用户喜欢香菜');Store.saveProfile(f.dataDir,f.state,f.roleId,{preferences:{饮食:['香菜','番茄']}});
  Store.setCardStatus(f.dataDir,f.state,f.roleId,card.id,{status:'archived'});assert.deepEqual(profile(f).preferences.饮食,['香菜','番茄']);assert.deepEqual(Memory.profileForAI(f.dataDir,f.state,f.roleId).preferences.饮食,['番茄']);
  Store.setCardStatus(f.dataDir,f.state,f.roleId,card.id,{status:'active'});assert.deepEqual(Memory.profileForAI(f.dataDir,f.state,f.roleId).preferences.饮食,['香菜','番茄']);
});
test('来源消息也能关联画像，其他来源的同词条目和跨好友记录不会被误删',async t=>{
  const f=fixture(t),card=Store.upsertCard(f.dataDir,f.state,f.roleId,{content:'用户喜欢香菜'},{sourceMessages:[{id:'u1',content:'喜欢香菜'}]});
  Store.saveProfile(f.dataDir,f.state,f.roleId,{preferences:{饮食:['独特口味'],保留:['香菜']},sources:[{section:'preferences',field:'饮食',value:'独特口味',memoryIds:[],messageIds:['u1']},{section:'preferences',field:'保留',value:'香菜',memoryIds:['another-card'],messageIds:['u2']}]});
  const foreign=Store.upsertCard(f.dataDir,f.state,f.state.roles[1].id,{content:'用户喜欢香菜'});const before=JSON.stringify(profile(f));
  assert.equal((await execute(f,'forget_memory',{memoryId:foreign.id})).forgotten,false);assert.equal(Store.deleteCard(f.dataDir,f.state,f.roleId,foreign.id),false);assert.equal(JSON.stringify(profile(f)),before);
  Store.deleteCard(f.dataDir,f.state,f.roleId,card.id);assert.deepEqual(profile(f).preferences,{保留:['香菜']});assert.equal(Store.getCard(f.dataDir,f.state,f.state.roles[1].id,foreign.id).content,'用户喜欢香菜');
});
test('聊天仅关键词命中归档卡片才记录最近提及，不恢复、不注入、不额外调用模型',async t=>{
  t.mock.timers.enable({apis:['Date'],now:AT});const f=fixture(t),card=add(f,'用户喜欢香菜'),unrelated=add(f,'用户练习陶艺'),foreign=Store.upsertCard(f.dataDir,f.state,f.state.roles[1].id,{content:'香菜'});
  for(const own of [card,unrelated])Store.setCardStatus(f.dataDir,f.state,f.roleId,own.id,{status:'archived'});Store.setCardStatus(f.dataDir,f.state,f.state.roles[1].id,foreign.id,{status:'archived'});
  let calls=0;const modelApi={call:()=>{calls++;throw Error('不应额外调用模型');},embed:()=>{calls++;throw Error('不应调用嵌入模型');},rerank:()=>{calls++;throw Error('不应调用排序模型');}};
  const result=await Memory.recallForPrompt(f.state,f.roleId,'香菜今天吃完了',{...f,modelApi});assert.equal(calls,0);assert.deepEqual(result.cards,[]);assert.equal(result.profileText,'');
  assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,card.id).lastMentionedAt,AT);assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,card.id).status,'archived');assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,unrelated.id).lastMentionedAt,0);assert.equal(Store.getCard(f.dataDir,f.state,f.state.roles[1].id,foreign.id).lastMentionedAt,0);
  assert.equal((await execute(f,'memorize_memory',{content:'用户喜欢香菜'})).archived,true);assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,card.id).status,'archived');
  t.mock.timers.tick(1000);const recalled=await execute(f,'recall_memory',{query:'陶艺'});assert.deepEqual(recalled.memories,[]);assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,unrelated.id).lastMentionedAt,AT+1000);
  R.apply(f.state,'memory',{enabled:false});await assert.rejects(execute(f,'recall_memory',{query:'香菜'}),/长期记忆已关闭/);assert.equal(Store.getCard(f.dataDir,f.state,f.roleId,card.id).lastMentionedAt,AT);
});
test('自动提炼提示携带实际消息ID，画像来源只取本好友且遗忘后不再进入模型画像',async t=>{
  const f=fixture(t);S.message(f.state,S.role(f.state,f.roleId),'user','我喜欢吃香菜','text',{id:'own-message',status:'sent',createdAt:AT});const ownId=f.state.messages[0].id;let calls=0;
  const added=await Memory.extractForRole({...f,manual:true,now:()=>AT,modelApi:{call:async(s,request)=>{
    calls++;assert.match(request.messages[0].content,/sourceMessageIds/);assert.ok(request.messages[1].content.includes(ownId));
    return {message:{content:JSON.stringify({memories:[{content:'用户喜欢吃香菜',memoryType:'PREFERENCE',importance:0.7}],profileUpdates:[{section:'preferences',field:'饮食',op:'add',value:'香菜',sourceMessageIds:['foreign-message']}]})}};
  }}});
  assert.equal(calls,1);assert.equal(added.length,1);assert.deepEqual(profile(f).sources[0].memoryIds,[added[0].id]);assert.deepEqual(profile(f).sources[0].messageIds,[ownId]);assert.equal(Store.readSource(f.dataDir,added[0].id)[0].id,ownId);
  await execute(f,'forget_memory',{memoryId:added[0].id});assert.equal(Memory.profileForAI(f.dataDir,f.state,f.roleId).preferences.饮食,undefined);
});
test('遗忘或删除期间迟到的提炼结果不能重建旧卡片和旧画像',async t=>{
  for(const action of ['forget','delete'])await t.test(action,async t=>{
    const f=fixture(t),card=add(f,'用户喜欢香菜');S.message(f.state,S.role(f.state,f.roleId),'user','我喜欢香菜','text',{status:'sent',createdAt:AT});let finish;
    const task=Memory.extractForRole({...f,manual:true,modelApi:{call:()=>new Promise(resolve=>{finish=resolve;})}});
    if(action==='forget')await execute(f,'forget_memory',{memoryId:card.id});else Store.deleteCard(f.dataDir,f.state,f.roleId,card.id);
    finish({message:{content:JSON.stringify({memories:['用户喜欢香菜'],profileUpdates:[{section:'preferences',field:'饮食',value:'香菜'}]})}});assert.deepEqual(await task,[]);assert.equal(profile(f).preferences.饮食,undefined);
    assert.equal(Store.listCards(f.dataDir,f.state,f.roleId).some(item=>item.content.includes('香菜')),false);
  });
});
test('新版来源和最近提及随备份保留，旧备份缺字段补默认值，坏元数据在入口拒绝',t=>{
  const f=fixture(t),card=add(f,'用户喜欢香菜');Store.saveProfile(f.dataDir,f.state,f.roleId,{preferences:{饮食:['香菜']},sources:[{section:'preferences',field:'饮食',value:'香菜',memoryIds:[card.id],messageIds:['m1']}]});Store.setCardStatus(f.dataDir,f.state,f.roleId,card.id,{status:'archived'});Store.markMentioned(f.dataDir,f.state,f.roleId,[card.id],AT);
  const snapshot=Store.exportBackup(f.dataDir,f.state),validated=Store.validateBackup(snapshot,f.state);assert.equal(validated.cards[0].last_mentioned_at,AT);assert.deepEqual(JSON.parse(validated.profiles[0].sources_json)[0].memoryIds,[card.id]);
  const old=structuredClone(snapshot);delete old.cards[0].last_mentioned_at;delete old.profiles[0].sources_json;const restored=Store.validateBackup(old,f.state);assert.equal(restored.cards[0].last_mentioned_at,0);assert.equal(restored.profiles[0].sources_json,'[]');
  const bad=structuredClone(snapshot);bad.profiles[0].sources_json='[{"section":"preferences","field":"饮食","value":"香菜","memoryIds":{},"messageIds":[]}]';assert.throws(()=>Store.validateBackup(bad,f.state),/长期记忆备份格式无效/);
});
