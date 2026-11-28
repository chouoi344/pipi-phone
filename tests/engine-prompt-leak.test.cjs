// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/engine/response.cjs'),M=require('../lib/engine/models.cjs');
const sample="叫这么急，出了什么事，还是纯粹想讨哄？我在呢。\n今天（2026-11-28）星期六 18:23，小香菜苗发来消息：“（图片）”\n现在你要回复她。\n\n注意当前上下文和生活状态：\n1. 现在是 2026-11-28 18:23 星期六，无锡晴 13.4°C。\n2. 她刚喊了一连串“宝宝宝宝宝宝宝”，你刚回完“叫这么急，出了什么事，还是纯粹想讨哄？我在呢。”，紧接着她发来了一张图片（注意：目前只收到了消息提示但好像没看到具体图片附件，先看看对话里有没有图片或是不是纯文字请求？等等——当前这一轮用户的实际消息就是“（图片）”还是说……如果用户消息没附带真实图片只发了字面上的“（图片）”，就自然调侃一下“图呢，发了个空气？”或者如果前面有没有注意的图？等等，仔细看本轮用户输入，只有下面这句吗？不，系统给我的就是这一轮，先看看下面有没有真图片。没有的话，就是系统在模拟时漏了图片，或者提醒我不要瞎编看不到的图片——对，规则里说了“只使用本次会话提供的信息，不应编造记忆”，如果只看到文字（图片）而看不到实际图片内容，千万不能编造图片内容，可以直接顺着说图没加载出来或者问她发了什么";
const previous=[{role:'assistant',content:'叫这么急，出了什么事，还是纯粹想讨哄？'},{role:'assistant',content:'我在呢。'}];

test('实际泄漏样本截断到最早指纹，截断内容只是上一轮的重复回复',()=>{
  assert.equal(R.leakedReasoning(sample),true);
  assert.equal(R.beforeLeak(sample),'叫这么急，出了什么事，还是纯粹想讨哄？我在呢。');
  assert.equal(R.repeatsRecent(R.beforeLeak(sample),previous),true);
  assert.equal(R.repeatsRecent(R.beforeLeak(sample),[{role:'assistant',content:'吃饭了吗？'}]),false);
});

test('新增思考指纹均能识别，正常台词保持原样',()=>{
  for(const text of ['现在你要回复她','注意当前上下文','规则里说了“线上聊天”','规则里写「线上聊天」','今天(2026-11-28)星期六','18:23，小香菜发来了消息：图片','system_reminder','CHARACTER_LIFE','life_rules'])assert.equal(R.leakedReasoning(text),true,text);
  for(const text of ['怎么突然不开心了？','今天无锡挺冷的，多穿点。','等等，你刚说什么？','不想吃就先不吃，饿了再说。','我妈刚发来消息：“早点睡”','你是一个喜欢吃苹果的外星旅行家']){
    assert.equal(R.leakedReasoning(text),false,text);assert.equal(R.beforeLeak(text),text,text);
  }
});

test('固定规则原文连续12字才算回显，空白不拼接，截断取全部指纹最早位置',()=>{
  for(const text of ['只使用本次会话提供的信息，不应编造记忆','只使用本次会话提供的信息'])assert.equal(R.leakedReasoning(text),true,text);
  for(const text of ['只使用本次会话提供的信','只使用本次会话 提供的信息'])assert.equal(R.leakedReasoning(text),false,text);
  assert.equal(R.beforeLeak('先坐会儿。\n只使用本次会话提供的信息，不应编造记忆。\n现在你要回复她。'),'先坐会儿。');
  assert.equal(R.beforeLeak('先坐会儿。现在你要回复她。\n只使用本次会话提供的信息，不应编造记忆。'),'先坐会儿。');
});

test('本轮提醒完整块和未闭合块都不出现在对话里',()=>{
  assert.equal(R.filterDialogue('你好。<system_reminder>当前时间：18:23\n内部背景</system_reminder>我在。').text,'你好。我在。');
  assert.equal(R.filterDialogue('你好。\n<system_reminder>当前时间：18:23\n内部背景').text,'你好。');
});

test('近期重复只比较最后6条助手文字，所有片段都重复才成立',()=>{
  assert.equal(R.repeatsRecent('叫这么急，出了什么事，还是纯粹想讨哄？\n我在呢。',previous),true);
  assert.equal(R.repeatsRecent('我在呢！刚下班。',previous),false);
  assert.equal(R.repeatsRecent('我在呢。',[{role:'user',content:'我在呢。'}]),false);
  assert.equal(R.repeatsRecent('第零条。',Array.from({length:7},(_,i)=>({role:'assistant',content:i?'另外一条。':'第零条。'}))),false);
  assert.equal(R.repeatsRecent('我在呢。',[{role:'assistant',content:[{type:'text',text:'我在呢。'}]}]),true);
  assert.equal(R.repeatsRecent('。!?~…\n',previous),false);
});

function fixture(t,respond){
  const requests=[],waits=[];
  t.mock.method(require('../lib/engine/model-catalog.cjs'),'resolveCapacity',async()=>({value:10000}));
  t.mock.method(require('../lib/providers.cjs'),'request',async(_config,_path,options)=>{requests.push(options.body);return {choices:[{message:{role:'assistant',content:respond(requests.length)}}]};});
  t.mock.method(require('node:timers/promises'),'setTimeout',async ms=>{waits.push(ms);});
  const state={settings:{ai:{sources:[{id:'isolated',name:'隔离',baseUrl:'https://isolated.invalid',key:'ISOLATED'}],models:[{id:'main',sourceId:'isolated',model:'main',kind:'chat',capabilities:['text'],maxContextTokens:10000,extraBody:{}}],assign:{chat:'main',chatFallbacks:[]}}}};
  return {state,requests,waits};
}

test('模型层使用实际prepared历史识别重复前缀，三次泄漏后返回PROVIDER_EMPTY',async t=>{
  const f=fixture(t,()=>sample),logs=[];
  await assert.rejects(M.call(f.state,{messages:[{role:'user',content:'图片'}],prepareMessages:async()=>[...previous,{role:'user',content:'图片'}],onUsage:entry=>logs.push(entry)}),{code:'PROVIDER_EMPTY'});
  assert.equal(f.requests.length,3);assert.deepEqual(f.waits,[1000,2000]);
  assert.equal(logs.length,3);assert.ok(logs.every(entry=>entry.success===false));
});

test('模型层泄漏后能重试恢复，正常重复回复不受影响',async t=>{
  const f=fixture(t,n=>n===1?sample:'图没加载出来，你再发一次？');
  assert.equal((await M.call(f.state,{messages:[...previous,{role:'user',content:'图片'}]})).message.content,'图没加载出来，你再发一次？');
  assert.equal(f.requests.length,2);assert.deepEqual(f.waits,[1000]);
});

test('保留泄漏前的新台词，普通重复台词不触发新的重试条件',async t=>{
  const f=fixture(t,n=>n===1?'刚下班。\n现在你要回复她。':'我在呢。');
  assert.equal((await M.call(f.state,{messages:previous})).message.content,'刚下班。\n现在你要回复她。');
  assert.equal((await M.call(f.state,{messages:previous})).message.content,'我在呢。');
  assert.equal(f.requests.length,2);assert.deepEqual(f.waits,[]);
});
