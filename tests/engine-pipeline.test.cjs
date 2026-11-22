// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../lib/engine/pipeline.cjs'),R=require('../lib/engine/registry.cjs'),D=require('../lib/engine/delivery.cjs');
function fixture({capacity=100000,capabilities=['text'],messages=[]}={}){
  let state={settings:{timezone:'Asia/Shanghai',modules:{},ai:{sources:[{id:'source',baseUrl:'http://isolated.invalid',key:'isolated'}],models:[{id:'chat',sourceId:'source',kind:'chat',capabilities}],assign:{chat:'chat',caption:''}}},roles:[{id:'r',name:'甲',prompt:'只知道甲',relationship:'朋友',personaId:'p',permissions:{},quietStart:'22:00',quietEnd:'08:00'},{id:'other',name:'乙',prompt:'SECRET_OTHER_ROLE'}],personas:[{id:'p',name:'我的身份',prompt:'本会话人设'},{id:'otherp',name:'SECRET_OTHER_PERSONA',prompt:'SECRET_OTHER_PERSONA'}],profile:{name:'用户'},messages,memories:[{roleId:'r',content:'一起去过公园'},{roleId:'other',content:'SECRET_OTHER_MEMORY'}],moments:[],wallet:{transactions:[]},ledger:[{note:'SECRET_LEDGER'}]};
  R.ensure(state);const requests=[];
  const config={id:'chat',capabilities,maxContextTokens:capacity};
  const api={resolve:(s,purpose)=>purpose==='compress'?{...config,maxContextTokens:100000}:config,call:async(s,request)=>{requests.push(structuredClone({...request,signal:undefined,onUsage:undefined,prepareMessages:undefined,beforeRequest:undefined}));return {message:{role:'assistant',content:request.purpose==='compress'?'保留的旧事':'你好。\n今天好吗？'},usage:{inputTokens:20,estimated:false,inputEstimated:false},modelId:'chat',model:config};}};
  const opts={getState:()=>structuredClone(state),mutate:fn=>{const value=fn(state);return {state:structuredClone(state),value};},roleId:'r',modelApi:api,now:()=>Date.parse('2026-11-15T09:00:00Z')};
  return {opts,requests,api,state:()=>state,config};
}
function m(id,sender,content,extra={}){return {id,roleId:'r',sender,content,type:'text',status:'sent',createdAt:Number(id.replace(/\D/g,''))*1000,...extra};}
test('估算按中文、emoji字素、图片和语音的规定计数',()=>{
  assert.ok(Math.abs(P.estimate('你好abc')-2.1)<.0001);
  assert.equal(P.estimate('👨‍👩‍👧‍👦👍🏽🇨🇳'),6);
  assert.equal(P.estimate({type:'image_url',image_url:{url:'x'}}),765);
  assert.equal(P.estimate({type:'input_audio'}),500);
});
test('回复超过150字保留一条，短回复按官方标点拆分且保留标点',()=>{
  assert.deepEqual(D.split('你好。\n今天好吗？'),['你好。','今天好吗？']);
  const text='一'.repeat(76)+'。\n'+'二'.repeat(76)+'。';assert.equal(D.split(text).length,1);
  assert.equal(D.split('一。二。三。四。五。六。七。').length,7);
  assert.equal(D.split('一。二。三。四。五。六。七。').at(-1),'七。');
});
test('官方分段全文匹配保留内部换行，150字边界按Unicode码点计算',()=>{
  assert.deepEqual(D.split('第一行\n第二行。下一句！'),['第一行\n第二行。','下一句！']);
  const atLimit='😀'.repeat(148)+'。！';assert.equal([...atLimit].length,150);assert.deepEqual(D.split(atLimit),['😀'.repeat(148)+'。！']);
  const splitLimit='😀'.repeat(147)+'。好。';assert.equal([...splitLimit].length,150);assert.equal(D.split(splitLimit).length,2);
  const overLimit='😀'+splitLimit;assert.deepEqual(D.split(overLimit),[overLimit]);
});
test('分段词模式去掉分隔词，清理规则只处理实际分段的短文本',()=>{
  assert.deepEqual(D.split('你好。还好吗？！最后一句',{splitMode:'words',splitWords:'。\n？！'}),['你好','还好吗','最后一句']);
  assert.deepEqual(D.split('你好。再见。',{cleanupPattern:'[。]'}),['你好','再见']);
  const long='一'.repeat(151)+'。';assert.deepEqual(D.split(long,{cleanupPattern:'[。]'}),[long]);
  assert.deepEqual(D.split('你好。再见。',{enabled:false,cleanupPattern:'[。]'}),['你好。再见。']);
});
test('内容清理直接填写中文标点时逐个删除，按原文断句且丢弃清空的片段',()=>{
  const f=fixture();R.apply(f.state(),'segments',{cleanupPattern:'，。'});
  const saved=R.values(f.state(),'segments');
  assert.equal(saved.cleanupPattern,'，。');
  assert.deepEqual(D.split('你好，来了。还好吗？',saved),['你好来了','还好吗？']);
  assert.deepEqual(D.split('，。你好，来了。 。还好吗？',saved),['你好来了','还好吗？']);
  assert.deepEqual(D.split('你好，来了。还好吗？',{...saved,splitMode:'words',splitWords:'。'}),['你好来了','还好吗？']);
  assert.deepEqual(D.split('等一下；我来了！真的？',{cleanupPattern:'；！'}),['等一下我来了','真的？']);
  assert.deepEqual(D.split('「你好」，来了。',{cleanupPattern:'「」，。'}),['你好来了']);
});
test('内容清理保留自定义正则、留空、关闭、字数上限与无匹配时的原文语义',()=>{
  const f=fixture(),text='你好，来了。还好吗？';
  for(const cleanupPattern of ['[，。]','，|。']){
    R.apply(f.state(),'segments',{cleanupPattern});
    assert.deepEqual(D.split(text,R.values(f.state(),'segments')),['你好来了','还好吗？']);
  }
  assert.deepEqual(D.split(text,{cleanupPattern:'。$'}),['你好，来了','还好吗？']);
  assert.deepEqual(D.split('a? b. 好？',{cleanupPattern:'\\?'}),['a b. 好？']);
  assert.deepEqual(D.split('a? b. 好？',{cleanupPattern:'[?.]'}),['a b 好？']);
  assert.deepEqual(D.split(text,{cleanupPattern:'.'}),[]);
  assert.deepEqual(D.split(text,{cleanupPattern:''}),['你好，来了。','还好吗？']);
  assert.deepEqual(D.split(text,{enabled:false,cleanupPattern:'，。'}),[text]);
  assert.deepEqual(D.split(text,{noSplitAbove:5,cleanupPattern:'，。'}),[text]);
  assert.deepEqual(D.split(text,{sentencePattern:'unmatched',cleanupPattern:'，。'}),[text]);
  assert.deepEqual(D.split('，。',{cleanupPattern:'，。'}),[]);
  assert.throws(()=>R.apply(f.state(),'segments',{cleanupPattern:'['}),/正则表达式无效/);
});
test('分段间隔和等待上限按声明计算',()=>{
  assert.equal(D.delay('abc',{intervalMode:'random',minSeconds:1.5,maxSeconds:3.5},()=>0),1500);
  assert.equal(D.delay('abc',{intervalMode:'random',minSeconds:1.5,maxSeconds:3.5},()=>1),3500);
  assert.equal(D.delay('one two three',{intervalMode:'length',logBase:2},()=>0),2000);
  assert.equal(D.delay('one two three',{intervalMode:'length',logBase:2},()=>1),2500);
  assert.equal(D.delay('你好a！😀',{intervalMode:'length',logBase:2},()=>0),2000);
  assert.equal(D.readyAt({lastMessageAt:1000,lastTypingAt:4000},{idleSeconds:3,maxWaitSeconds:30}),7000);
  assert.equal(D.readyAt({lastMessageAt:1000,lastTypingAt:50000},{idleSeconds:3,maxWaitSeconds:30}),31000);
});
test('所有角色事件可见，现实账本和其他好友人设不可见',async()=>{
  const f=fixture({messages:[m('1','user','早上好'),m('2','assistant','早'),m('3','system','pat',{createdAt:8*3600000,meta:{kind:'pat',author:'me',target:'role'}}),m('4','user','红包',{type:'redpacket',createdAt:8*3600000+1000,meta:{amountCents:1234,note:'开心',transactionId:'t'}}),m('5','user','',{type:'voice',createdAt:8*3600000+2000,meta:{transcript:'语音正文'}}),m('6','system','secret recalled',{createdAt:8*3600000+3000,meta:{kind:'recalled',recalledText:'SECRET_RECALLED'}}),m('7','user','回复',{createdAt:8*3600000+4000,meta:{quote:{sender:'assistant',content:'引'.repeat(90)}}}),m('8','user','IMAGE_DATA',{type:'image',createdAt:8*3600000+5000}),m('9','user','SECRET_OTHER_MESSAGE',{roleId:'other',createdAt:8*3600000+6000})]});
  f.state().wallet.transactions.push({id:'t',status:'refunded'});
  await P.run(f.opts);const text=JSON.stringify(f.requests[0].messages);
  for(const value of ['用户拍了拍你','12.34元','已退还','（语音）','用户撤回了一条消息','当前时间：2026-11-15 星期日 17:00','用户发了一张图片，你看不到内容','本会话人设','款项编号：t'])assert.ok(text.includes(value),value);
  assert.ok(!text.includes('[消息编号：'));
  for(const value of ['SECRET_OTHER_ROLE','SECRET_OTHER_PERSONA','SECRET_OTHER_MEMORY','SECRET_OTHER_MESSAGE','SECRET_LEDGER','SECRET_RECALLED','IMAGE_DATA','引'.repeat(61)])assert.ok(!text.includes(value),value);
});
test('停用时间间隔提示后，旧开启设置不会向角色追加间隔提示词',async()=>{
  const f=fixture({messages:[m('1','user','上次消息'),m('2','assistant','上次回复'),m('3','user','今天回来',{createdAt:48*3600000})]});
  f.state().settings.modules.timeGaps={enabled:true,thresholdHours:0};await P.run(f.opts);
  const text=JSON.stringify(f.requests[0].messages);assert.ok(text.includes('今天回来'));assert.ok(text.includes('当前时间：'));assert.ok(!text.includes('距上一条消息过了'));assert.equal(R.list().some(m=>m.id==='timeGaps'),false);assert.throws(()=>R.apply(f.state(),'timeGaps',{enabled:true}),/功能不存在/);
});

test('长对话整轮压缩，摘要写独立空间且聊天记录不变',async()=>{
  const messages=[];for(let i=1;i<=8;i++)messages.push(m(String(i*2-1),'user','甲'.repeat(200)),m(String(i*2),'assistant','乙'.repeat(200)));
  messages.push(m('17','user','当前问题'));
  const f=fixture({capacity:900,messages});const before=structuredClone(f.state().messages);
  await P.run(f.opts);assert.equal(f.requests[0].purpose,'compress');assert.equal(f.requests[1].purpose,'chat');
  assert.equal(f.state().engine.summaries.r.text,'保留的旧事');assert.deepEqual(f.state().messages,before);
  assert.ok(JSON.stringify(f.requests[1].messages).includes('当前问题'));
  assert.ok(f.requests[1].messages.length<messages.length);
});
test('保留比例分母是当前请求长度，保留最近整轮并缓存摘要边界',async()=>{
  const f=fixture({capacity:1500,messages:[m('1','user','旧'.repeat(1000)),m('2','assistant','旧'.repeat(1000)),m('3','user','近'.repeat(20)),m('4','assistant','近答'.repeat(20)),m('5','user','当前问题')]});
  await P.run(f.opts);const summary=f.state().engine.summaries.r;
  assert.ok(summary);assert.equal(summary.coveredMessageId,'2');
  const second=JSON.stringify(f.requests.at(-1).messages);assert.ok(second.includes('近'.repeat(20)));assert.ok(second.includes('当前问题'));
});
test('摘要失败按整轮丢弃，最后一轮原文超限仍完整交给模型',async()=>{
  const f=fixture({capacity:500,messages:[m('1','user','旧'.repeat(500)),m('2','assistant','旧答'.repeat(500)),m('3','user','最新'.repeat(1500))]});
  const call=f.api.call;f.api.call=async(s,r)=>{if(r.purpose==='compress')throw new Error('isolated compression failure');return call(s,r);};
  const before=structuredClone(f.state().messages);
  assert.equal(await P.run(f.opts),'你好。\n今天好吗？');
  assert.equal(f.state().engine.summaries.r,undefined);assert.equal(f.requests.length,1);
  const sent=f.requests[0].messages;
  assert.ok(P.estimate(sent)>f.config.maxContextTokens);
  assert.ok(sent.some(m=>m.content==='最新'.repeat(1500)));
  assert.ok(!JSON.stringify(sent).includes('旧答'));
  assert.deepEqual(f.state().messages,before);
  assert.equal(f.state().engine.data.compression.lastError.message,'isolated compression failure');
});
test('maxTurns先截断，连发用户消息作为同一未回答轮保留',async()=>{
  const f=fixture({messages:[m('1','user','较旧'),m('2','assistant','旧答'),m('3','user','第一条'),m('4','user','第二条'),m('5','user','第三条')]});
  R.apply(f.state(),'compression',{maxTurns:1});await P.run(f.opts);
  const text=JSON.stringify(f.requests[0].messages);assert.ok(!text.includes('较旧'));for(const x of ['第一条','第二条','第三条'])assert.ok(text.includes(x));
});
test('真实输入用量校正下一次长度估算',async()=>{
  const f=fixture({messages:[m('1','user','你好')]});await P.run(f.opts);
  const saved=f.state().engine.data.compression.estimates.r;assert.equal(saved.promptTokens,20);assert.ok(saved.ratio>0);assert.equal(saved.modelId,'chat');
});
test('图片转述缓存同一消息后只调用一次',async()=>{
  const f=fixture({messages:[m('1','user','FAKE_IMAGE',{type:'image'})]});
  f.state().settings.ai.models.push({id:'vision',sourceId:'source',kind:'chat',capabilities:['text','image']});
  f.state().settings.ai.assign.caption='vision';const call=f.api.call;
  f.api.call=async(s,r)=>{if(r.purpose==='caption'){f.requests.push({purpose:'caption'});return {message:{content:'一只白猫'}};}return call(s,r);};
  await P.run(f.opts);await P.run(f.opts);
  assert.equal(f.requests.filter(r=>r.purpose==='caption').length,1);assert.equal(f.state().messages[0].meta.caption,'一只白猫');assert.ok(JSON.stringify(f.requests.at(-1).messages).includes('一只白猫'));
});
test('识图主模型切到纯文本备用时转述并缓存，备用请求不含图片',async()=>{
  const f=fixture({capabilities:['text','image'],messages:[m('1','user','ISOLATED_IMAGE',{type:'image'})]});
  f.state().settings.ai.assign.caption='chat';
  let captionCalls=0,prepared;
  f.api.call=async(s,r)=>{
    if(r.purpose==='caption'){captionCalls++;return {message:{content:'备用模型看到的白猫'}};}
    prepared=await r.prepareMessages({id:'fallback',capabilities:['text']},r.messages);
    return {message:{content:'白猫很可爱'},model:{id:'fallback',capabilities:['text'],maxContextTokens:100000},modelId:'fallback'};
  };
  await P.run(f.opts);assert.equal(captionCalls,1);assert.ok(JSON.stringify(prepared).includes('备用模型看到的白猫'));assert.ok(!JSON.stringify(prepared).includes('image_url'));assert.ok(!JSON.stringify(prepared).includes('ISOLATED_IMAGE'));assert.equal(f.state().messages[0].meta.caption,'备用模型看到的白猫');
});
test('未选图片转述时，纯文本主模型只收到占位，识图主模型仍收到原图',async()=>{
  const image='data:image/png;base64,AAAA';
  for(const capabilities of [['text'],['text','image']]){
    const f=fixture({capabilities,messages:[m('1','user',image,{type:'image'})]});
    f.state().settings.ai.models.push({id:'unused-vision',sourceId:'source',kind:'chat',capabilities:['text','image']});
    await P.run(f.opts);
    assert.equal(f.requests.length,1);
    assert.equal(f.requests[0].purpose,'chat');
    const request=JSON.stringify(f.requests[0].messages);
    assert.equal(request.includes(image),capabilities.includes('image'));
    assert.equal(request.includes('你看不到内容'),!capabilities.includes('image'));
  }
});
test('再次发送相同图片时复用描述并缓存到新消息，角色仍看得到内容',async()=>{
  const f=fixture({messages:[m('1','user','SAME_IMAGE',{type:'image',meta:{caption:'同一只白猫'}}),m('2','user','SAME_IMAGE',{type:'image'})]});
  await P.run(f.opts);assert.equal(f.state().messages[1].meta.caption,'同一只白猫');const body=JSON.stringify(f.requests[0].messages);assert.equal(body.split('同一只白猫').length-1,2);assert.ok(!body.includes('你看不到内容'));assert.equal(f.requests.filter(r=>r.purpose==='caption').length,0);
});
test('工具结果只回模型，失败原因可见，达到步数后不提供工具',async()=>{
  const f=fixture({capabilities:['text','tool_use'],messages:[m('1','user','做件事')]});R.apply(f.state(),'actions',{maxSteps:1});let calls=0,executed=0;
  f.api.call=async(s,r)=>{f.requests.push(structuredClone({messages:r.messages,tools:r.tools}));calls++;return {message:calls===1?{role:'assistant',content:null,tool_calls:[{id:'tool1',type:'function',function:{name:'test_action',arguments:'{}'}}]}:{content:'已说明'},model:f.config,modelId:'chat'};};
  const result=await P.run({...f.opts,tools:[{type:'function',function:{name:'test_action',parameters:{type:'object'}}}],executeTool:async()=>{executed++;throw new Error('余额不足');}});
  assert.equal(result,'已说明');assert.equal(executed,1);assert.equal(f.requests[0].tools.length,1);assert.equal(f.requests[1].tools.length,0);assert.ok(f.requests[1].messages.some(m=>m.role==='tool'&&m.content.includes('余额不足')));assert.equal(f.state().messages.length,1);
});
test('每阶段钩子顺序固定，打断后不保存摘要或执行动作',async()=>{
  const events=[],names=['beforeReceive','afterReceive','beforePreprocess','afterPreprocess','beforeAssemble','afterAssemble','beforeCompress','afterCompress','beforeModel','afterModel','beforeDeliver'];
  const module={id:'test-only',name:'隔离测试',description:'',settings:[],hooks:Object.fromEntries(names.map(name=>[name,()=>events.push(name)])),tools:[],jobs:[],data:'test-only',page:null};R.modules.push(module);
  try{const f=fixture();await P.run(f.opts);assert.deepEqual(events,names);
    const controller=new AbortController();controller.abort();await assert.rejects(P.run({...f.opts,signal:controller.signal}),{name:'AbortError'});
  }finally{R.modules.pop();}
});
test('压缩与压缩失败回退保留组装钩子注入的消息和最近原话修改',async()=>{
  const module={id:'compression-hooks-test',name:'隔离钩子',description:'',settings:[],hooks:{afterAssemble(ctx){ctx.messages.push({role:'system',content:'AFTER_ASSEMBLE_INJECTION'});const current=ctx.messages.find(m=>typeof m.content==='string'&&m.content.includes('当前问题'));current.content+='|HOOK_EDIT';},beforeCompress(ctx){ctx.messages.push({role:'system',content:'BEFORE_COMPRESS_INJECTION'});}},tools:[],jobs:[],data:'compression-hooks-test',page:null};R.modules.push(module);
  try{for(const failCompression of [false,true]){
    const f=fixture({capacity:500,messages:[m('1','user','旧'.repeat(1000)),m('2','assistant','旧答'.repeat(1000)),m('3','user','当前问题')]}),call=f.api.call;
    if(failCompression)f.api.call=async(s,r)=>{if(r.purpose==='compress')throw new Error('isolated failure');return call(s,r);};
    await P.run(f.opts);const body=JSON.stringify(f.requests.at(-1).messages);for(const text of ['AFTER_ASSEMBLE_INJECTION','BEFORE_COMPRESS_INJECTION','当前问题|HOOK_EDIT'])assert.ok(body.includes(text),text);
  }}finally{R.modules.pop();}
});
test('声明新增模块可直接列出、保存，错误类型与范围被拒绝',()=>{
  const f=fixture(),example={id:'example',name:'示例',description:'',settings:[{key:'size',label:'大小',type:'number',default:2,min:1,max:5}],hooks:{},tools:[],jobs:[],data:'example',page:null};R.modules.push(example);
  try{assert.ok(R.list().some(m=>m.id==='example'));R.apply(f.state(),'example',{size:4});assert.equal(R.values(f.state(),'example').size,4);assert.throws(()=>R.apply(f.state(),'example',{size:6}));assert.throws(()=>R.apply(f.state(),'example',{size:'2'}));assert.throws(()=>R.apply(f.state(),'segments',{sentencePattern:'['}));assert.throws(()=>R.apply(f.state(),'waiting',{idleSeconds:40,maxWaitSeconds:30}));}
  finally{R.modules.pop();}
});


test('统一正文过滤独立推理、完整和截断标签，同时保留metadata',()=>{
  const {visibleText}=require('../lib/engine/response.cjs');
  const message={content:'<think>内部计划</think>你好<thinking>未完成推理',reasoning_content:'秘密',tool_calls:[{extra_content:{google:{thought_signature:'signature'}}}]};
  const before=structuredClone(message);
  assert.equal(visibleText(message),'你好');assert.deepEqual(message,before);
  assert.equal(visibleText('<think>a<think>b</think>c</think>hello'),'hello');
  assert.equal(visibleText('正文<THINKING>a<think>b</think>c</THINKING>结尾'),'正文结尾');
  assert.equal(visibleText('正文<think>a<thinking>b</thinking>未闭合'),'正文');
  assert.equal(visibleText({content:[{type:'text',text:'正文'},{type:'reasoning',text:'秘密'}]}),'正文');
  for(const tag of ['<','<t','<thi','<think','<thinking','<think data-test='])assert.equal(visibleText('你好'+tag),'你好');
});

test('Gemini 以 thought 开头漏出的推理不当作回复，正文里的 thought 一词照常保留',()=>{
  const {visibleText,leakedThought}=require('../lib/engine/response.cjs');
  for(const text of ['thought\nThe user wants a selfie. The tool failed.','  Thought:\n分析一下','_thought\nplan','_thought The user...','THOUGHTS\n...','thought'])assert.equal(leakedThought(text),true,text),assert.equal(visibleText(text),'',text);
  assert.equal(visibleText('<thought>内部计划</thought>好呀'),'好呀');
  assert.equal(visibleText('好呀<thoughts>未闭合'),'好呀');
  assert.equal(visibleText('好呀<thou'),'好呀');
  for(const text of ['thought you were busy','I thought so','thoughtful 的礼物','我在想thought这个词'])assert.equal(leakedThought(text),false,text),assert.equal(visibleText(text),text,text);
});

test('中途垮成推理的回复被识别，内部令牌不出现在可见正文',()=>{
  const {visibleText,leakedReasoning}=require('../lib/engine/response.cjs');
  const leaked='等着，这次不欠你了。\n不对，她肯定想要现在这张！而且系统有 `[媒体编号：11111111-2222-4333-8444-555555555555]`，但我不能再次拍摄或发图了（工具要求：接下来按你自己的人设，用一句自然的生活化消息告诉对方。不要说已发出失败的照片，不要提到模型、接口、工具或技术原因，也不要再次拍摄）。\n到时候我再用 `send_selfie(action: "resend")`。';
  assert.equal(leakedReasoning(leaked),true);
  for(const marker of ['[媒体编号：11111111-2222-4333-8444-555555555555]','不要说已发出失败的照片','不要再次拍摄','send_selfie(action: "resend")','action: "continue"','send_image('])assert.equal(leakedReasoning(marker),true,marker);
  assert.equal(leakedReasoning('主卧这会儿只留了盏阅读灯，刚拍出来背光黑了一半。'),false);
  assert.equal(visibleText('好的，编号是 [媒体编号：11111111-2222-4333-8444-555555555555] 哦'),'好的，编号是  哦');
  assert.equal(visibleText('动态见 [动态编号：abc] 和【照片编号：p-1】'),'动态见  和');
});

test('中途垮成推理时只保留前面完整的台词，正常台词不受影响',()=>{
  const {leakedReasoning,beforeLeak}=require('../lib/engine/response.cjs');
  const leaked='等着，这次不欠你了。刚才灯闪黑了。\n\n先别急，等会儿再试试？\n\n不对，她肯定想要现在这张！（工具要求：不要再次拍摄）\n\n句子设计：\n灯太暗了。';
  assert.equal(beforeLeak(leaked),'等着，这次不欠你了。刚才灯闪黑了。\n\n先别急，等会儿再试试？');
  assert.equal(beforeLeak('用户想要一张自拍，但工具失败了。\n抱歉'),'');
  assert.equal(beforeLeak('半句话没说完send_image('),'');
  for(const text of ['句子设计','检查气泡断句','The user wants a selfie.','下轮她肯定会问','按你自己的人设回应'])assert.equal(leakedReasoning(text),true,text);
  for(const text of ['不对，是我记错了，今天周四。','不对，他应该是周三走的。','我们产品的用户想要更简单的界面。','你自己的人设别崩哈','下轮你请我吃饭。','The user is always right.','按你说的做，明早八点叫你。']){
    assert.equal(leakedReasoning(text),false,text);assert.equal(beforeLeak(text),text,text);
  }
});

test('历史里的旧泄漏消息不回传给模型',async()=>{
  const f=fixture({messages:[m('1','user','拍张自拍'),m('2','assistant','thought\nThe user wants a selfie. The tool returned ok:false.'),m('3','user','怎么了')]});
  await P.run(f.opts);
  const sent=f.requests.at(-1).messages.map(x=>typeof x.content==='string'?x.content:JSON.stringify(x.content)).join('\n');
  assert.doesNotMatch(sent,/The user wants a selfie/);assert.match(sent,/拍张自拍/);assert.match(sent,/怎么了/);
});

test('模型返回泄漏推理时按空回复重试，重试后的正常回复才送达',async t=>{
  t.mock.method(require('node:timers/promises'),'setTimeout',async()=>{});
  const models=require('../lib/engine/models.cjs'),providers=require('../lib/providers.cjs');
  let calls=0;
  t.mock.method(providers,'request',async()=>({choices:[{message:{role:'assistant',content:++calls===1?'thought\nI should apologize.':'抱歉，刚才没拍好'}}]}));
  const state={settings:{preset:{},providers:{}},roles:[]};models.migrate(state);
  // A known capacity skips the public model catalog, so this test cannot cache it for the others.
  models.save(state,{sources:[...models.sanitize(state.settings.ai).sources,{id:'custom',name:'隔离测试',baseUrl:'https://example.invalid/v1',key:'k',builtin:false}],models:[{id:'g',sourceId:'custom',model:'gemini-3-flash',kind:'chat',capabilities:['text'],maxContextTokens:8000,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{},voice:'alloy'}],assign:{chat:'g',chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''}});
  const result=await models.call(state,{purpose:'chat',messages:[{role:'user',content:'hi'}],modelId:'g'});
  assert.equal(result.message.content,'抱歉，刚才没拍好');assert.equal(calls,2);
});

test('模型回显的消息编号不进入回复，原消息 ID 和用户原话保留',async()=>{
  const S=require('../lib/state.cjs');
  const id='90d98e57-a309-444a-895d-db9c2cfc97ff',tag=`[消息编号：${id}] `;
  const assistant=m(id,'assistant',tag+'之前回复');
  const user=m('7','user',tag+'用户原话',{meta:{quote:{messageId:id,sender:'assistant',type:'text',content:assistant.content}}});
  const f=fixture({messages:[assistant,user]});
  f.api.call=async(s,request)=>{f.requests.push(request);return {message:{content:`${tag}真的？\n【消息编号: ${id}】 我也想你。`},model:f.config,modelId:'chat'};};
  assert.equal(await P.run(f.opts),'真的？\n我也想你。');
  assert.equal(f.requests[0].messages.find(item=>item.role==='assistant').content,'之前回复');
  assert.ok(f.requests[0].messages.find(item=>item.role==='user').content.endsWith(user.content));
  const state=S.initial();state.messages=[assistant,user];
  const stored=S.publicState(state).messages;
  assert.equal(stored[0].id,id);assert.equal(stored[0].content,'之前回复');
  assert.equal(stored[1].content,user.content);assert.equal(stored[1].meta.quote.content,'之前回复');
  assert.equal(state.messages[0].content,tag+'之前回复');
  assert.equal(S.backupState(state).messages[0].content,tag+'之前回复');
});

const toolDefinition={type:'function',function:{name:'test_action',parameters:{type:'object'}}};
test('普通回复清理本会话旧标签、改写和裸编号，保留用户的订单号和外部 UUID',async()=>{
  const first='90d98e57-a309-444a-895d-db9c2cfc97ff',second='6ad6e6a1-a4fc-4876-aa3c-fe51794b15c9';
  const order='f2222cce-affe-484b-8be4-8e31977ac0e0';
  const userText='订单 SF123456789，外部单号 '+order;
  const f=fixture({messages:[m(first,'assistant','在呢。'),m(second,'user',userText)]});
  const modelText=[
    '[消息编号：'+first+'] 怎么突然这么黏人？',
    '［消息编号: '+second+'］ 遇到什么事了？',
    '消息编号：'+first+' 我在听。',
    '【 消息 ID: '+second.toUpperCase()+' 】 你慢慢说。',
    '嗯，'+first+'我记下了。',
    userText
  ];
  f.api.call=async(s,request)=>{
    assert.equal(request.messages.find(m=>m.role==='assistant').content,'在呢。');
    assert.equal(request.messages.find(m=>m.role==='user').content,userText);
    for(const id of [first,second])assert.ok(!JSON.stringify(request.messages).includes(id));
    return {message:{content:modelText.join('\n')},model:f.config,modelId:'chat'};
  };
  assert.deepEqual((await P.run(f.opts)).split('\n'),['怎么突然这么黏人？','遇到什么事了？','我在听。','你慢慢说。','嗯，我记下了。',userText]);
});
function toolCall(id){return {id,type:'function',function:{name:'test_action',arguments:'{}'},extra_content:{google:{thought_signature:'preserved'}}};}
test('每次请求按备用容量整轮裁剪，工具调用结果和最新连发原文保留',async()=>{
  const f=fixture({capabilities:['text','tool_use'],messages:[m('1','user','旧'.repeat(500)),m('2','assistant','旧答'.repeat(500)),m('3','user','最新甲'),m('4','user','最新乙')]});
  let count=0,prepared;
  f.api.call=async(s,r)=>{
    const config=count?{...f.config,id:'small',maxContextTokens:650}:f.config;
    prepared=await r.prepareMessages(config,r.messages);
    return {message:count++?{content:'<think>秘密</think>完成'}:{content:'',tool_calls:[toolCall('receipt')]},model:config,modelId:config.id};
  };
  let context;const result=await P.run({...f.opts,tools:[toolDefinition],executeTool:async(name,args,ctx)=>{context={id:ctx.callId,step:ctx.step};return '成功';}});
  assert.equal(result,'完成');assert.deepEqual(context,{id:'receipt',step:0});
  const body=JSON.stringify(prepared);assert.ok(!body.includes('旧答'));assert.ok(body.includes('最新甲'));assert.ok(body.includes('最新乙'));
  assert.equal(prepared.filter(m=>m.role==='tool').length,1);assert.equal(prepared.find(m=>m.tool_calls).tool_calls[0].extra_content.google.thought_signature,'preserved');
});

test('工具总数和超大结果有明确错误，超限调用不执行',async()=>{
  for(const oversized of [false,true]){
    const f=fixture({capabilities:['text','tool_use']});let executed=0;
    f.api.call=async()=>({message:{content:'',tool_calls:oversized?[toolCall('1')]:Array.from({length:9},(_,i)=>toolCall(String(i)))},model:f.config,modelId:'chat'});
    await assert.rejects(P.run({...f.opts,tools:[toolDefinition],executeTool:async()=>{executed++;return '一'.repeat(32769);}}),{code:oversized?'TOOL_RESULT_LIMIT':'TOOL_LIMIT'});
    assert.equal(executed,oversized?1:0);
  }
});

test('达到单次回复的八次工具调用上限后，只请求模型完成回复',async()=>{
  const f=fixture({capabilities:['text','tool_use']});
  let requests=0,executed=0;
  f.api.call=async(s,req)=>{
    const first=++requests===1;
    assert.equal(req.tools.length,first?1:0);
    const message=first?{content:'',tool_calls:Array.from({length:8},(_,i)=>toolCall(String(i)))}:{content:'完成'};
    return {message,model:f.config,modelId:'chat'};
  };
  assert.equal(await P.run({...f.opts,tools:[toolDefinition],executeTool:async()=>{executed++;return '成功';}}),'完成');
  assert.equal(executed,8);
});

test('仅允许已执行动作的自主活动无正文结束，空推理不能冒充聊天回复',async()=>{
  const f=fixture({capabilities:['text','tool_use']});let count=0;
  f.api.call=async()=>({message:count++?{content:'<think>结束</think>'}:{content:'',tool_calls:[toolCall('1')]},model:f.config,modelId:'chat'});
  assert.equal(await P.run({...f.opts,allowToolOnly:true,tools:[toolDefinition],executeTool:async()=>({ok:true})}),'');
  f.api.call=async()=>({message:{content:'<think>只有推理</think>'},model:f.config,modelId:'chat'});
  await assert.rejects(P.run({...f.opts,allowToolOnly:true}),{code:'PROVIDER_EMPTY'});
});


test('整理模型自身容量不足时记录失败并截断历史，不发送超限摘要请求',async()=>{
  const f=fixture({capacity:650,messages:[m('1','user','旧'.repeat(1500)),m('2','assistant','旧答'.repeat(1500)),m('3','user','当前问题')]});
  f.api.resolve=()=>f.config;
  await P.run(f.opts);
  assert.equal(f.requests.some(r=>r.purpose==='compress'),false);
  assert.equal(f.state().engine.summaries.r,undefined);
  assert.match(f.state().engine.data.compression.lastError.message,/对话容量/);
  assert.ok(JSON.stringify(f.requests[0].messages).includes('当前问题'));
});

test('自动识别容量在首轮压缩、整理预算和实际聊天请求中一致生效',async t=>{
  const Models=require('../lib/engine/models.cjs'),Providers=require('../lib/providers.cjs');
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'https://models.dev/api.json');
    return {ok:true,json:async()=>({isolated:{models:{chat:{id:'auto-pipeline-chat',limit:{context:650}},summary:{id:'auto-pipeline-summary',limit:{context:300}}}}})};
  });
  const requests=[];
  t.mock.method(Providers,'request',async(config,path,{body})=>{
    requests.push({config,body});return {choices:[{message:{role:'assistant',content:'已回复'}}]};
  });
  const f=fixture({messages:[m('1','user','旧'.repeat(1500)),m('2','assistant','旧答'.repeat(1500)),m('3','user','当前问题')]}),state=f.state();
  state.settings.ai.models=['chat','summary'].map(id=>({id,sourceId:'source',kind:'chat',model:'auto-pipeline-'+id,capabilities:['text'],maxContextTokens:0,extraBody:{}}));
  state.settings.ai.assign.compress='summary';state.settings.ai.assign.chatFallbacks=[];
  const savedModels=structuredClone(state.settings.ai.models);
  assert.equal(await P.run({...f.opts,modelApi:Models}),'已回复');
  assert.equal(requests.length,1);assert.equal(requests[0].config.maxContextTokens,650);assert.equal(requests[0].config.capacity.source,'metadata');
  assert.ok(P.estimate(requests[0].body.messages)<=650*R.values(state,'compression').triggerRatio);
  assert.ok(JSON.stringify(requests[0].body.messages).includes('当前问题'));assert.ok(!JSON.stringify(requests[0].body.messages).includes('旧答'));
  assert.match(state.engine.data.compression.lastError.message,/对话容量/);assert.equal(state.engine.summaries.r,undefined);
  assert.deepEqual(state.settings.ai.models,savedModels);
});

test('工具结果超出估算容量仍保留当前轮的完整调用与结果',async()=>{
  const f=fixture({capacity:650,capabilities:['text','tool_use'],messages:[m('1','user','做件事')]});let requests=0;
  let prepared,executed=0;
  f.api.call=async(s,r)=>{
    prepared=await r.prepareMessages(f.config,r.messages);
    return {message:requests++?{content:'完成'}:{content:'',tool_calls:[toolCall('1')]},model:f.config,modelId:'chat'};
  };
  assert.equal(await P.run({...f.opts,tools:[toolDefinition],executeTool:async()=>{executed++;return '结果'.repeat(1000);}}),'完成');
  assert.equal(requests,2);assert.equal(executed,1);assert.ok(P.estimate(prepared)>f.config.maxContextTokens);
  assert.equal(prepared.find(m=>m.tool_calls).tool_calls[0].id,'1');
  assert.equal(prepared.find(m=>m.role==='tool').tool_call_id,'1');
  assert.equal(prepared.find(m=>m.role==='tool').content,'结果'.repeat(1000));
});

test('最新轮超过估算容量时不吞掉模型实际返回的容量错误',async()=>{
  const f=fixture({capacity:500,messages:[m('1','user','当前原话'.repeat(1000))]});
  const expected=Object.assign(new Error('上游模型拒绝超出容量的请求'),{code:'PROVIDER_ERROR',upstreamStatus:400});
  let requests=0;
  f.api.call=async(s,r)=>{
    const sent=await r.prepareMessages(f.config,r.messages);requests++;
    assert.ok(sent.some(m=>m.content==='当前原话'.repeat(1000)));
    throw expected;
  };
  await assert.rejects(P.run(f.opts),error=>error===expected);assert.equal(requests,1);
});


test('跨轮媒体清单只列自己图片标识与描述，模型能看到已修改的当前资料',()=>{
 const f=fixture(),state=f.state(),role=state.roles[0];Object.assign(role,{name:'当前名字',bio:'修改后的签名',patText:'肩膀',avatar:'data:image/png;base64,PRIVATE_AVATAR',cover:'data:image/png;base64,PRIVATE_COVER'});
 state.engine.data.actions.roleMedia=[{id:'OWN_MEDIA',roleId:'r',prompt:'海边日落',image:'data:image/png;base64,PRIVATE_IMAGE'},{id:'OTHER_MEDIA',roleId:'other',prompt:'OTHER_DESCRIPTION',image:'data:image/png;base64,OTHER_IMAGE'}];
 const content=P.system(state,role).content;
 for(const text of ['当前名字','修改后的签名','肩膀','头像：已设置','封面：已设置','OWN_MEDIA','海边日落'])assert.ok(content.includes(text),text);
 for(const text of ['PRIVATE_AVATAR','PRIVATE_COVER','PRIVATE_IMAGE','OTHER_MEDIA','OTHER_DESCRIPTION','OTHER_IMAGE'])assert.ok(!content.includes(text),text);
});


test('整理方式默认总结且只接受总结或整轮裁剪',()=>{
  const f=fixture();
  assert.equal(R.values(f.state(),'compression').strategy,'summary');
  assert.equal(R.validate('compression',{}).strategy,'summary');
  assert.equal(R.apply(f.state(),'compression',{strategy:'truncate'}).strategy,'truncate');
  assert.throws(()=>R.apply(f.state(),'compression',{strategy:'other'}),/选项无效/);
});

test('按轮次裁剪超限只移除早期整轮，不请求总结且保留聊天与摘要记录',async()=>{
  const messages=[];
  for(let i=1;i<=4;i++)messages.push(m(String(i*2-1),'user',i+'旧问'.repeat(250)),m(String(i*2),'assistant',i+'旧答'.repeat(250)));
  messages.push(m('9','user','最新甲'),m('10','user','最新乙'));
  const f=fixture({capacity:900,messages});R.apply(f.state(),'compression',{strategy:'truncate',dropTurns:2,keepRecentRatio:0});
  f.state().engine.summaries.r={text:'原摘要保留',coveredUntil:2000,coveredMessageId:'2',updatedAt:3};
  const beforeMessages=structuredClone(f.state().messages),beforeSummary=structuredClone(f.state().engine.summaries);
  f.api.resolve=(state,purpose)=>{assert.notEqual(purpose,'compress');return f.config;};
  await P.run(f.opts);
  assert.deepEqual(f.requests.map(r=>r.purpose),['chat']);
  const sent=f.requests[0].messages,body=JSON.stringify(sent);
  assert.ok(P.estimate(sent)<=900*R.values(f.state(),'compression').triggerRatio);
  assert.ok(body.includes('最新甲'));assert.ok(body.includes('最新乙'));assert.ok(!body.includes('原摘要保留'));
  const has=id=>sent.some(message=>message.content===messages[Number(id)-1].content);
  let dropped=0;
  for(let i=1;i<=4;i++){assert.equal(has(String(i*2-1)),has(String(i*2)));if(!has(String(i*2)))dropped++;}
  assert.ok(dropped>0);assert.equal(dropped%2,0);
  assert.ok(body.includes('角色设定：只知道甲'));assert.ok(body.includes('当前时间：'));
  assert.deepEqual(f.state().messages,beforeMessages);assert.deepEqual(f.state().engine.summaries,beforeSummary);
});

test('切到裁剪从原文取历史，切回总结恢复原摘要与覆盖边界',async()=>{
  const f=fixture({messages:[m('1','user','已总结的旧问'),m('2','assistant','已总结的旧答'),m('3','user','当前问题')]});
  f.state().engine.summaries.r={text:'持久旧摘要',coveredUntil:2000,coveredMessageId:'2',updatedAt:3};
  const messages=structuredClone(f.state().messages),summary=structuredClone(f.state().engine.summaries);
  R.apply(f.state(),'compression',{strategy:'truncate'});await P.run(f.opts);
  const truncated=JSON.stringify(f.requests.at(-1).messages);
  for(const text of ['已总结的旧问','已总结的旧答','当前问题'])assert.ok(truncated.includes(text));
  assert.ok(!truncated.includes('持久旧摘要'));
  R.apply(f.state(),'compression',{strategy:'summary'});await P.run(f.opts);
  const summarized=JSON.stringify(f.requests.at(-1).messages);
  assert.ok(summarized.includes('持久旧摘要'));assert.ok(summarized.includes('当前问题'));
  assert.ok(!summarized.includes('已总结的旧问'));assert.ok(!summarized.includes('已总结的旧答'));
  assert.deepEqual(f.state().messages,messages);assert.deepEqual(f.state().engine.summaries,summary);
  assert.equal(f.requests.some(r=>r.purpose==='compress'),false);
});

test('裁剪方式在备用预算保留最新连发、系统设定和完整工具历史',async()=>{
  const f=fixture({capabilities:['text','tool_use'],messages:[m('1','user','旧问'.repeat(500)),m('2','assistant','旧答'.repeat(500)),m('3','user','最新甲'),m('4','user','最新乙')]});
  R.apply(f.state(),'compression',{strategy:'truncate'});
  const messages=structuredClone(f.state().messages),prepared=[];
  f.api.resolve=(state,purpose)=>{assert.notEqual(purpose,'compress');return f.config;};
  f.api.call=async(state,request)=>{
    assert.equal(request.purpose,'chat');
    const config={...f.config,id:'small',maxContextTokens:650};
    prepared.push(await request.prepareMessages(config,request.messages));
    return {message:prepared.length===1?{content:'',tool_calls:[toolCall('truncate-tool')]}:{content:'完成'},model:config,modelId:config.id};
  };
  assert.equal(await P.run({...f.opts,tools:[toolDefinition],executeTool:async()=>'裁剪动作结果'}),'完成');
  for(const sent of prepared){
    const body=JSON.stringify(sent);
    assert.ok(!body.includes('旧问'));assert.ok(!body.includes('旧答'));
    for(const text of ['最新甲','最新乙','角色设定：只知道甲','当前时间：'])assert.ok(body.includes(text));
    assert.ok(P.estimate(sent)<=650*R.values(f.state(),'compression').triggerRatio);
  }
  const second=prepared[1];assert.equal(second.find(m=>m.role==='tool').content,'裁剪动作结果');
  assert.equal(second.find(m=>m.tool_calls).tool_calls[0].extra_content.google.thought_signature,'preserved');
  assert.deepEqual(f.state().messages,messages);assert.deepEqual(f.state().engine.summaries,{});
});
