// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
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
test('双方图片和表情在多模态历史及摘要文本中按消息标记区分',()=>{
  const state={wallet:{transactions:[]}},messages=['user','assistant'].flatMap((sender,i)=>[
    m(String(i*2+1),sender,'SAME',{type:'image',meta:{stickerId:'s',caption:'白猫'}}),
    m(String(i*2+2),sender,'SAME',{type:'image',meta:{caption:'白猫'}})
  ]);
  for(const vision of [true,false]){
    const rendered=P.renderHistory(state,messages,vision),texts=rendered.map(m=>Array.isArray(m.content)?m.content[0].text:m.content);
    assert.ok(texts[0].includes('（表情包）'));assert.ok(texts[1].includes('（图片）'));
    assert.ok(texts[2].includes('（表情包）'));assert.ok(texts[3].includes('（图片）'));
    assert.ok(!texts[2].includes('用户发'));assert.equal(rendered[2].role,'assistant');
  }
});
test('转述同图只请求一次，复用视觉内容但保持双方消息各自类型',async()=>{
  const f=fixture({messages:[m('1','user','SAME',{type:'image',meta:{stickerId:'s'}}),m('2','assistant','SAME',{type:'image'})]});
  f.state().settings.ai.models.push({id:'vision',sourceId:'source',kind:'chat',capabilities:['image']});
  f.state().settings.ai.assign.caption='vision';
  let count=0;const call=f.api.call;
  f.api.call=async(s,r)=>{if(r.purpose==='caption'){count++;return {message:{content:'白猫'}};}return call(s,r);};
  await P.run(f.opts);await P.run(f.opts);
  assert.equal(count,1);const history=f.requests.at(-1).messages.filter(m=>['user','assistant'].includes(m.role));
  assert.ok(history[0].content.includes('（表情包）白猫'));assert.ok(history[1].content.includes('（图片）白猫'));
  assert.equal(f.state().messages[1].meta.stickerId,undefined);
});
test('纯文本备用保留表情类型及图片原始地址映射，缓存可复用',async()=>{
  const f=fixture({capabilities:['text','image'],messages:[m('1','assistant','SAME',{type:'image',meta:{stickerId:'s'}}),m('2','user','SAME',{type:'image'})]});
  f.state().settings.ai.assign.caption='chat';
  let count=0,prepared;
  f.api.call=async(s,r)=>{
    if(r.purpose==='caption'){count++;return {message:{content:'白猫'}};}
    prepared=await r.prepareMessages({id:'fallback',capabilities:['text']},r.messages);
    return {message:{content:'收到'},model:f.config,modelId:'chat'};
  };
  await P.run(f.opts);assert.equal(count,1);
  const history=prepared.filter(m=>['user','assistant'].includes(m.role));
  assert.match(history[0].content,/（表情包）白猫/);assert.match(history[1].content,/（图片）白猫/);
  assert.ok(!JSON.stringify(prepared).includes('image_url'));assert.ok(!history[0].content.includes('用户发'));
});
test('无识图模型仍显式区分不可见内容；引用和转发表情保留来源类型',async()=>{
  const f=fixture({messages:[m('1','assistant','SAME',{type:'image',meta:{stickerId:'s'}})]});await P.run(f.opts);
  assert.match(f.requests[0].messages.find(m=>m.role==='assistant').content,/（表情包）内容不可见/);
  const quoted=P.render({wallet:{transactions:[]}},m('2','user','看看',{meta:{quote:{sender:'assistant',type:'image',content:'SAME',meta:{stickerId:'s',caption:'白猫'}}}}),false);
  assert.match(quoted.content,/回复你的「（表情包）白猫」/);
  const forwarded=P.render({},m('3','user','',{type:'forward',meta:{entries:[{senderName:'甲',type:'image',content:'SAME',meta:{stickerId:'s',caption:'白猫'}},{senderName:'乙',type:'image',content:'SAME',meta:{caption:'白猫'}}]}}),false);
  assert.match(forwarded.content,/甲：（表情包）白猫/);assert.match(forwarded.content,/乙：（图片）白猫/);
});

test('真实压缩请求中的旧图片仍有表情与普通图片标签',async()=>{
  const messages=[];for(let i=1;i<=8;i++)messages.push(m(String(i*2-1),'user','旧'.repeat(200)),m(String(i*2),'assistant','答'.repeat(200)));
  messages.unshift(m('0','user','SAME',{type:'image',meta:{stickerId:'s',caption:'白猫'}}),m('00','assistant','SAME',{type:'image',meta:{caption:'白猫'}}));
  messages.push(m('17','user','现在'));
  const f=fixture({capacity:900,messages});await P.run(f.opts);
  const summary=f.requests.find(r=>r.purpose==='compress');assert.ok(summary);
  assert.match(JSON.stringify(summary.messages),/（表情包）白猫/);assert.match(JSON.stringify(summary.messages),/（图片）白猫/);
});
test('表情工具不装入全库列表，提供语义检索入口',()=>{
  const A=require('../lib/engine/actions.cjs'),S=require('../lib/state.cjs'),s=sampleState(),r=s.roles[0];
  r.stickers=[{id:'s',name:'image_123',image:'SAME'}];
  const tools=A.definitions(s,r);assert.ok(tools.some(t=>t.function.name==='search_stickers'));
  assert.ok(!tools.find(t=>t.function.name==='send_sticker').function.description.includes('image_123'));
});

test('文字附带表情或图片在引用与合并转发中保留正文及类型',()=>{
  for(const sticker of [true,false]){
    const meta={image:'SAME',caption:'白猫',...(sticker?{stickerId:'s'}:{})},label=sticker?'（表情包）':'（图片）';
    const quoted=P.render({},m('1','user','看看',{meta:{quote:{sender:'user',type:'text',content:'附文'.repeat(50),image:meta.image,caption:meta.caption,...(sticker?{stickerId:'s'}:{})}}}),false);
    assert.ok(quoted.content.includes('附文'));assert.ok(quoted.content.includes(label+'白猫'));
    const forward=P.render({},m('2','user','',{type:'forward',meta:{entries:[{senderName:'甲',type:'text',content:'附文',meta}]}}),false);
    assert.ok(forward.content.includes('甲：附文 '+label+'白猫'));
  }
});

test('逐条转发沿用已有表情转述',()=>{
  const S=require('../lib/state.cjs'),s=sampleState(),r=s.roles[0];
  const message=S.message(s,r,'user','附文','text',{meta:{image:'SAME',stickerId:'s',caption:'白猫'}});
  S.apply(s,'message.forward',{targetRoleId:r.id,ids:[message.id],mode:'individual'});
  assert.equal(s.messages.at(-1).meta.caption,'白猫');assert.equal(s.messages.at(-1).meta.stickerId,'s');
});

test('语义快照优先旧caption，视觉/文字/引用/转发保留且普通照片保持图片',()=>{
  const semantic={meaning:'委屈求安慰',tags:['委屈'],usage:'向对方撒娇',description:'猫低头',visibleText:'抱抱'};
  const sticker=m('1','user','SAME',{type:'image',meta:{stickerId:'s',caption:'旧白猫',stickerSemantic:semantic}});
  for(const vision of [true,false]){
    const rendered=P.renderHistory({},[sticker,m('2','user','SAME',{type:'image',meta:{caption:'照片'}})],vision);
    assert.match(rendered[0].content,/（表情包）委屈求安慰/);assert.match(rendered[0].content,/抱抱/);assert.ok(!rendered[0].content.includes('旧白猫'));
    const photo=rendered[1].content;assert.ok(JSON.stringify(photo).includes('（图片）'));assert.ok(!JSON.stringify(photo).includes('委屈'));
  }
  const quote=P.render({},m('3','user','好',{meta:{quote:{sender:'user',type:'image',content:'SAME',meta:sticker.meta}}}),false);assert.match(quote.content,/委屈求安慰/);
  const forward=P.render({},m('4','user','',{type:'forward',meta:{entries:[{...sticker,senderName:'甲'}]}}),false);assert.match(forward.content,/委屈求安慰/);
});
test('标注表情不调用转述模型，旧caption不覆盖标注',async()=>{
  for(const capabilities of [['text'],['text','image']]){
    const f=fixture({capabilities,messages:[m('1','user','SAME',{type:'image',meta:{stickerId:'s',caption:'旧caption',stickerSemantic:{meaning:'开心庆祝',tags:['喜悦'],usage:'庆祝'}}})]});
    await P.run(f.opts);assert.equal(f.requests.some(r=>r.purpose==='caption'),false);assert.match(JSON.stringify(f.requests[0].messages),/（表情包）开心庆祝/);
  }
});

test('缺原图的引用优先语义快照，否则使用已有caption或不可见说明',()=>{
  const state={stickerSemantics:{}};
  for(const [meta,expected]of [[{stickerId:'s',stickerSemantic:{meaning:'撒娇',tags:[],usage:''}},'撒娇'],[{stickerId:'s',caption:'白猫'},'白猫'],[{stickerId:'s'},'内容不可见']]){
    const result=P.render(state,m('1','user','看看',{meta:{quote:{sender:'user',type:'image',meta}}}),false);assert.ok(result.content.includes(expected));
  }
});
