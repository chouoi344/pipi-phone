// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs'),A=require('../lib/engine/actions.cjs'),R=require('../lib/engine/registry.cjs'),J=require('../lib/engine/scheduler.cjs');
function fixture(){
  let state=sampleState();state.messages=[];state.settings.timezone='Asia/Shanghai';const [a,b]=state.roles.map(r=>r.id);
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state:getState(),value};};
  const ctx=roleId=>({getState,mutate,roleId,settings:R.values(state,'actions'),scheduler:J});
  return {getState,mutate,ctx,a,b,state:()=>state};
}
test('发现页的全局开关统一限制角色工具可见性与执行，重新开启保留能力',async()=>{
  const f=fixture();
  const toggles={allowPat:'pat_user',allowQuote:'reply_quote',allowRecall:'recall_message',allowStickers:'search_stickers'};
  f.mutate(s=>{s.roles[0].stickers=[{id:'one',name:'微笑',image:'data:image/png;base64,AA=='}];});
  const names=()=>R.tools(f.state(),f.state().roles[0]).map(tool=>tool.function.name);
  for(const name of Object.values(toggles))assert.ok(names().includes(name),name);
  f.mutate(s=>R.apply(s,'actions',Object.fromEntries(Object.keys(toggles).map(key=>[key,false]))));
  for(const name of Object.values(toggles)){
    assert.ok(!names().includes(name),name);
    await assert.rejects(A.execute(name,{},f.ctx(f.a)),/当前不可用/);
  }
  assert.equal(f.state().roles[0].stickers[0].id,'one');
  assert.equal(f.state().messages.length,0);
  f.mutate(s=>R.apply(s,'actions',{allowPat:true}));
  assert.ok(names().includes('pat_user'));
  assert.ok((await A.execute('pat_user',{},f.ctx(f.a))).messageId);
});
test('好友初始1000元一次性补发，升级已有余额保留，新好友按设置发放',()=>{
  const f=fixture(),s=f.state();assert.equal(s.wallet.roleBalances[f.a],100000);
  s.wallet.roleBalances[f.a]=5000;s.wallet.initializedRoles={};s.wallet.credits=[];A.initializeWallet(s,100000);assert.equal(s.wallet.roleBalances[f.a],105000);A.initializeWallet(s,100000);assert.equal(s.wallet.roleBalances[f.a],105000);
  s.roles.push({...s.roles[0],id:'new-role'});A.initializeWallet(s,50000);assert.equal(s.wallet.roleBalances['new-role'],50000);assert.equal(s.wallet.credits.filter(x=>x.roleId==='new-role')[0].source,'initial');
});
test('用户发来的款项先待处理，角色领取后才入账',()=>{
  const f=fixture(),s=f.state(),p=R.values(s,'actions'),before=s.wallet.roleBalances[f.a];
  const tx=A.transfer(s,f.a,{amountCents:1234,note:'给你',type:'transfer'},'user',p);assert.equal(tx.status,'pending');assert.equal(s.wallet.balanceCents,98766);assert.equal(s.wallet.roleBalances[f.a],before);
  A.settle(s,tx.id,'receive','assistant',f.a);assert.equal(s.wallet.roleBalances[f.a],before+1234);assert.equal(tx.status,'received');assert.throws(()=>A.settle(s,tx.id,'receive','assistant',f.a),/已处理/);
});
test('角色发给用户的红包点开领取后才入账，退还回到发出方',()=>{
  const f=fixture(),s=f.state(),p=R.values(s,'actions');
  const tx=A.transfer(s,f.a,{amountCents:1234,type:'redpacket'},'assistant',p);assert.equal(s.wallet.balanceCents,100000);assert.equal(s.wallet.roleBalances[f.a],98766);A.settle(s,tx.id,'receive','user',f.a);assert.equal(s.wallet.balanceCents,101234);
  const returned=A.transfer(s,f.a,{amountCents:2000,type:'transfer'},'assistant',p);A.settle(s,returned.id,'return','user',f.a);assert.equal(returned.status,'returned');assert.equal(s.wallet.roleBalances[f.a],98766);
  const outgoing=A.transfer(s,f.a,{amountCents:2000,type:'transfer'},'user',p);A.settle(s,outgoing.id,'return','assistant',f.a);assert.equal(s.wallet.balanceCents,101234);
});
test('红包200元上限、余额不足与跨好友处理均被拒绝',()=>{
  const f=fixture(),s=f.state(),p=R.values(s,'actions');assert.throws(()=>A.transfer(s,f.a,{amountCents:20001,type:'redpacket'},'assistant',p),/上限/);assert.throws(()=>A.transfer(s,f.a,{amountCents:100001,type:'transfer'},'assistant',p),/余额不足/);assert.equal(s.wallet.roleBalances[f.a],100000);
  const tx=A.transfer(s,f.a,{amountCents:100,type:'transfer'},'user',p);assert.throws(()=>A.settle(s,tx.id,'receive','assistant',f.b),/自己/);assert.throws(()=>A.settle(s,tx.id,'receive','user',f.a),/自己/);assert.equal(tx.status,'pending');
});
test('工具收发按元报告金额，旧参数仍可用，多余小数位不扣款',async()=>{
  const f=fixture(),before=f.getState();
  await assert.rejects(A.execute('send_redpacket',{amountYuan:8.888,note:'测试'},f.ctx(f.a)),/最多两位小数/);
  assert.deepEqual(f.getState(),before);
  const sent=await A.execute('send_transfer',{amountYuan:12.34,note:'转账'},f.ctx(f.a));
  assert.equal(sent.amountYuan,12.34);assert.equal(sent.amountCents,undefined);
  assert.equal(f.state().wallet.transactions.at(-1).amountCents,1234);
  const legacy=await A.execute('send_redpacket',{amountCents:88,note:'测试旧参数'},f.ctx(f.a));
  assert.equal(legacy.amountYuan,0.88);
  const tx=f.mutate(s=>A.transfer(s,f.a,{amountCents:888,type:'redpacket'},'user',R.values(s,'actions'))).value;
  const received=await A.execute('handle_payment',{id:tx.id,action:'receive'},f.ctx(f.a));
  assert.equal(received.amountYuan,8.88);assert.equal(received.status,'received');
});
test('红包和转账每天各五次，统一时区跨日后重置',()=>{
  const f=fixture(),s=f.state(),p=R.values(s,'actions'),now=Date.parse('2026-11-15T15:59:00Z');
  for(const type of ['redpacket','transfer']){for(let i=0;i<5;i++)A.transfer(s,f.a,{amountCents:1,type},'assistant',p,now);assert.throws(()=>A.transfer(s,f.a,{amountCents:1,type},'assistant',p,now),/次数/);A.transfer(s,f.a,{amountCents:1,type},'assistant',p,now+60000);}
  assert.equal(s.wallet.transactions.length,12);
});
test('待处理满24小时自动退还，两种方向都只退一次',()=>{
  const f=fixture(),s=f.state(),p=R.values(s,'actions'),now=Date.now();
  const outgoing=A.transfer(s,f.a,{amountCents:100,type:'transfer'},'user',p,now),incoming=A.transfer(s,f.a,{amountCents:200,type:'redpacket'},'assistant',p,now);
  A.expirePayments(s,now+24*3600000-1);assert.equal(outgoing.status,'pending');A.expirePayments(s,now+24*3600000);assert.equal(outgoing.status,'returned');assert.equal(incoming.status,'returned');assert.equal(s.wallet.balanceCents,100000);assert.equal(s.wallet.roleBalances[f.a],100000);
  A.expirePayments(s,now+25*3600000);assert.equal(s.wallet.balanceCents,100000);assert.equal(s.wallet.roleBalances[f.a],100000);
});
test('款项去重不重复扣钱，重复编号不同内容被拒绝',()=>{
  const f=fixture(),s=f.state(),p=R.values(s,'actions'),args={amountCents:100,type:'transfer',requestId:'once'};
  const first=A.transfer(s,f.a,args,'user',p),second=A.transfer(s,f.a,args,'user',p);assert.equal(first.id,second.id);assert.equal(s.messages.length,1);assert.equal(s.wallet.balanceCents,99900);assert.throws(()=>A.transfer(s,f.b,args,'user',p),/其他转账/);
});
test('角色只能引用自己会话中的用户消息，不能引用另一个好友或自己的消息',async()=>{
  const f=fixture(),s=f.state(),r=S.role(s,f.a),other=S.role(s,f.b),own=S.message(s,r,'user','用户原话'),cross=S.message(s,other,'user','另一好友原话'),assistant=S.message(s,r,'assistant','角色原话');
  const result=await A.execute('reply_quote',{messageId:own.id,text:'引用回复'},f.ctx(f.a));assert.equal(S.find(f.state().messages,result.messageId).meta.quote.messageId,own.id);
  await assert.rejects(A.execute('reply_quote',{messageId:cross.id,text:'跨会话'},f.ctx(f.a)),/跨会话/);await assert.rejects(A.execute('reply_quote',{messageId:assistant.id,text:'引用自己'},f.ctx(f.a)),/用户/);
});
test('按需选引用能查旧原话和本轮连发，按页返回，不夹带其他好友或失败消息',async()=>{
  const f=fixture(),s=f.state(),r=S.role(s,f.a),recent=[];
  const older=S.message(s,r,'user','周一答应一起去看展','text',{createdAt:Date.now()-86400000});
  for(let i=0;i<9;i++)recent.push(S.message(s,r,'user','今天的记录 '+i));
  const pending=S.message(s,r,'user','我刚发的第一句','text',{status:'pending'});
  const target=S.message(s,r,'user','我刚发的第二句','text',{status:'pending'});
  S.message(s,r,'user','尚未交给本轮的新消息','text',{status:'pending'});
  S.message(s,r,'user','发送失败','text',{status:'error'});
  S.message(s,r,'assistant','角色自己说的');
  S.message(s,S.role(s,f.b),'user','另一位好友也说看展');
  const ctx={...f.ctx(f.a),targetId:target.id,liveRequestIds:new Set([pending.id,target.id])};
  const select=(args={})=>R.executeTool('select_message_targets',{action:'reply_quote',...args},ctx);
  const first=await select(),second=await select({before:first.nextBefore});
  assert.deepEqual(first.messages.slice(0,2).map(m=>m.preview),['我刚发的第二句','我刚发的第一句']);
  const all=[...first.messages,...second.messages];
  assert.deepEqual(all.map(m=>m.messageId),[target.id,pending.id,...recent.toReversed().map(m=>m.id),older.id]);
  assert.equal(first.messages.length,8);assert.equal(second.nextBefore,undefined);
  const found=await select({query:'看展'});assert.equal(found.messages.length,1);
  assert.equal(found.messages[0].messageId,older.id);assert.match(found.messages[0].time,/\d{4}-\d{2}-\d{2}/);
  for(const id of [older.id,pending.id]){
    const reply=await R.executeTool('reply_quote',{messageId:id,text:'记得'},ctx);
    assert.equal(S.find(f.state().messages,reply.messageId).meta.quote.messageId,id);
  }
});
test('按需选撤回只返回自己两分钟内的消息与拍一拍，执行时再次检查',async()=>{
  const f=fixture(),s=f.state(),r=S.role(s,f.a);
  S.message(s,r,'assistant','两分钟前的旧回复','text',{createdAt:Date.now()-120001});
  S.message(s,r,'user','自己不能撤回用户消息');
  S.message(s,S.role(s,f.b),'assistant','另一个会话');
  const own=S.message(s,r,'assistant','刚发的回复');
  const pat=await A.execute('pat_user',{},f.ctx(f.a));
  const selected=await R.executeTool('select_message_targets',{action:'recall_message'},f.ctx(f.a));
  assert.deepEqual(selected.messages.map(m=>m.messageId),[pat.messageId,own.id]);
  await R.executeTool('recall_message',{messageId:selected.messages[0].messageId},f.ctx(f.a));
  f.mutate(s=>{S.find(s.messages,own.id).createdAt-=121000;});
  await assert.rejects(R.executeTool('recall_message',{messageId:selected.messages[1].messageId},f.ctx(f.a)),/两分钟/);
  assert.deepEqual((await R.executeTool('select_message_targets',{action:'recall_message'},f.ctx(f.a))).messages,[]);
});
test('选图只返回说明和标识，允许重发当前图片，查找随对应动作权限一起关闭',async()=>{
  const f=fixture(),s=f.state(),r=S.role(s,f.a);
  S.message(s,r,'user',testImage,'image',{meta:{stickerId:'s',caption:'不可重发的表情'}});
  const image=S.message(s,r,'user',testImage,'image',{status:'pending',meta:{caption:'窗外的山'}});
  R.apply(s,'actions',{allowQuote:false,allowRecall:false,allowStickers:false});
  const ctx={...f.ctx(f.a),targetId:image.id};
  const select=R.tools(s,r,{}).find(t=>t.function.name==='select_message_targets');
  assert.deepEqual(select.function.parameters.properties.action.enum,['send_image']);
  await assert.rejects(R.executeTool('select_message_targets',{action:'reply_quote'},ctx),/选项无效/);
  const selected=await R.executeTool('select_message_targets',{action:'send_image'},ctx);
  assert.deepEqual(selected.messages.map(m=>m.preview),['窗外的山']);assert.ok(!JSON.stringify(selected).includes('base64'));
  const result=await R.executeTool('send_image',{messageId:selected.messages[0].messageId},ctx);
  assert.equal(S.find(f.state().messages,result.messageId).content,testImage);
  R.apply(f.state(),'actions',{allowImages:false});
  assert.ok(!R.tools(f.state(),S.role(f.state(),f.a),{}).some(t=>t.function.name==='select_message_targets'));
});
test('角色只能撤回自己的两分钟内消息和拍一拍，撤回会清掉正文与引用',async()=>{
  const f=fixture(),s=f.state(),r=S.role(s,f.a),own=S.message(s,r,'assistant','待撤回正文'),quote=S.message(s,r,'user','引用过','text',{meta:{quote:{messageId:own.id,sender:'assistant',type:'text',content:'待撤回正文'}}});
  const old=S.message(s,r,'assistant','旧消息','text',{createdAt:Date.now()-120001}),user=S.message(s,r,'user','用户消息'),cross=S.message(s,S.role(s,f.b),'assistant','别的好友');
  await assert.rejects(A.execute('recall_message',{messageId:old.id},f.ctx(f.a)),/两分钟/);await assert.rejects(A.execute('recall_message',{messageId:user.id},f.ctx(f.a)),/自己/);await assert.rejects(A.execute('recall_message',{messageId:cross.id},f.ctx(f.a)),/自己/);
  await A.execute('recall_message',{messageId:own.id},f.ctx(f.a));const recalled=S.find(f.state().messages,own.id);assert.equal(recalled.meta.kind,'recalled');assert.equal(recalled.meta.author,f.a);assert.ok(!JSON.stringify(recalled).includes('待撤回正文'));assert.equal(S.find(f.state().messages,quote.id).meta.quote.unavailable,'recalled');
  const pat=await A.execute('pat_user',{},f.ctx(f.a));await A.execute('recall_message',{messageId:pat.messageId},f.ctx(f.a));assert.equal(S.find(f.state().messages,pat.messageId).meta.recalledType,'pat');
});
test('朋友圈发布、点赞、评论保存，权限与可见范围约束有效',async()=>{
  const f=fixture(),s=f.state();s.moments.push({id:'mine',authorId:'me',content:'给甲看',visibility:[f.a],likes:[],comments:[],mentions:[],createdAt:Date.now()});
  await A.execute('like_moment',{momentId:'mine'},f.ctx(f.a));await A.execute('comment_moment',{momentId:'mine',text:'看到了'},f.ctx(f.a));assert.ok(f.state().moments[0].likes.includes(f.a));assert.equal(f.state().moments[0].comments[0].content,'看到了');
  await assert.rejects(A.execute('like_moment',{momentId:'mine'},f.ctx(f.b)),/不可见/);const post=await A.execute('post_moment',{text:'自己的朋友圈'},f.ctx(f.a));assert.equal(S.find(f.state().moments,post.momentId).authorId,f.a);
  f.state().roles[0].permissions.onlyChat=true;await assert.rejects(A.execute('post_moment',{text:'不应发布'},f.ctx(f.a)),/不可用/);
});
test('表情库按好友隔离，语音工具仅在配置后出现',async()=>{
  const f=fixture(),s=f.state();s.roles[0].stickers=[{id:'a-sticker',name:'开心',image:'ISOLATED_IMAGE'}];s.roles[1].stickers=[{id:'b-sticker',name:'秘密',image:'OTHER_IMAGE'}];s.stickerSemantics={[require('../lib/engine/stickers.cjs').key('ISOLATED_IMAGE')]:{status:'ready',meaning:'开心',tags:['快乐'],usage:'庆祝'}};
  const names=A.definitions(s,s.roles[0]).map(t=>t.function.name);assert.ok(names.includes('send_sticker'));assert.ok(!names.includes('send_voice'));
  s.settings.ai.assign.tts='missing-tts';assert.ok(!A.definitions(s,s.roles[0]).some(t=>t.function.name==='send_voice'));
  addVoiceModel(s);
  assert.ok(A.definitions(s,s.roles[0]).some(t=>t.function.name==='send_voice'));
  await assert.rejects(A.execute('send_sticker',{id:'b-sticker'},f.ctx(f.a)),/不存在/);const result=await A.execute('send_sticker',{id:'a-sticker'},f.ctx(f.a));assert.equal(S.find(f.state().messages,result.messageId).content,'ISOLATED_IMAGE');
});
test('未来事项只列出和修改自己的提醒，已取消动作不落盘',async()=>{
  const f=fixture(),job=await A.execute('future_task',{action:'create',note:'将来喝水',userRequested:true,schedule:{type:'once',at:Date.now()+60000}},f.ctx(f.a));
  assert.equal((await A.execute('future_task',{action:'list'},f.ctx(f.b))).length,0);await assert.rejects(A.execute('future_task',{action:'delete',id:job.id},f.ctx(f.b)),/不存在/);
  const controller=new AbortController();controller.abort();await assert.rejects(A.execute('pat_user',{}, {...f.ctx(f.a),signal:controller.signal}),{name:'AbortError'});assert.equal(f.state().messages.length,0);
});

const testImage='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4),Buffer.from('IHDR'),Buffer.alloc(8)]).toString('base64');
function addVoiceModel(s){
  const ai=s.settings.ai;
  ai.sources.push({id:'tts-test-provider',baseUrl:'https://isolated.example/v1',key:'test'});
  ai.models.push({id:'test-tts',sourceId:'tts-test-provider',kind:'tts',model:'test-tts'});
  ai.assign.tts='test-tts';
}
function addMedia(f,roleId=f.a){const m={id:S.id(),roleId,image:testImage,createdAt:Date.now()};(f.state().engine.data.actions.roleMedia??=[]).push(m);return m.id;}
test('图片只允许本角色媒体或本会话可见图片，不能引用外链或其他好友',async()=>{
  const f=fixture(),id=addMedia(f),other=addMedia(f,f.b);
  const sent=await A.execute('send_image',{mediaId:id},f.ctx(f.a));assert.equal(S.find(f.state().messages,sent.messageId).content,testImage);
  const user=S.message(f.state(),S.role(f.state(),f.a),'user',testImage,'image');
  await A.execute('send_image',{messageId:user.id},f.ctx(f.a));
  await assert.rejects(A.execute('send_image',{mediaId:other},f.ctx(f.a)),/其他好友/);
  await assert.rejects(A.execute('send_image',{messageId:user.id},f.ctx(f.b)),/本会话/);
  await assert.rejects(A.execute('send_image',{mediaId:'https://example.com/image.png'},f.ctx(f.a)),/不存在/);
  await assert.rejects(A.execute('send_image',{mediaId:id,messageId:user.id},f.ctx(f.a)),/一个/);
});
test('重发表情保留表情标识，并遵守发送表情开关',async()=>{
  const f=fixture();
  const original=f.mutate(s=>S.message(s,S.role(s,f.a),'user',testImage,'image',{meta:{stickerId:'test-sticker'}})).value;
  const sent=await A.execute('send_image',{messageId:original.id},f.ctx(f.a));
  assert.equal(S.find(f.state().messages,sent.messageId).meta.stickerId,'test-sticker');
  f.mutate(s=>R.apply(s,'actions',{allowStickers:false}));
  for(const messageId of [original.id,sent.messageId])await assert.rejects(A.execute('send_image',{messageId},f.ctx(f.a)),/发送表情已关闭/);
  assert.equal(f.state().messages.length,2);
});
test('好友仅更新展示资料，头像封面引用本角色媒体，敏感字段整次拒绝',async()=>{
  const f=fixture(),id=addMedia(f),other=addMedia(f,f.b),original=f.getState();
  await assert.rejects(A.execute('update_own_profile',{name:'污染',prompt:'覆盖人设'},f.ctx(f.a)),/未知参数/);
  assert.deepEqual(f.getState(),original);
  await assert.rejects(A.execute('update_own_profile',{avatar:other},f.ctx(f.a)),/其他好友/);
  await A.execute('update_own_profile',{name:'新名字',signature:'新签名',patText:'肩膀',avatar:id,cover:id},f.ctx(f.a));
  const role=S.role(f.state(),f.a);assert.equal(role.name,'新名字');assert.equal(role.bio,'新签名');assert.equal(role.avatar,testImage);assert.equal(role.cover,testImage);assert.equal(role.patText,'肩膀');assert.equal(role.prompt,S.role(original,f.a).prompt);assert.deepEqual(f.state().profile,original.profile);
});
test('朋友圈仅接受本角色媒体且公开范围明确，关闭权限后不能执行',async()=>{
  const f=fixture(),id=addMedia(f),other=addMedia(f,f.b);
  const result=await A.execute('post_moment',{text:'',images:[id],visibility:'all'},f.ctx(f.a)),m=S.find(f.state().moments,result.momentId);
  assert.equal(m.visibility,'all');assert.deepEqual(m.images,[testImage]);
  await assert.rejects(A.execute('post_moment',{text:'串角色',images:[other]},f.ctx(f.a)),/其他好友/);
  await assert.rejects(A.execute('post_moment',{text:'外链',images:['https://example.com']},f.ctx(f.a)),/不存在/);
  await assert.rejects(A.execute('post_moment',{text:'错误范围',visibility:'some'},f.ctx(f.a)),/选项/);
  R.apply(f.state(),'actions',{allowMoments:false,allowImages:false,allowProfile:false});
  for(const [name,args] of [['post_moment',{text:'拒绝'}],['send_image',{mediaId:id}],['update_own_profile',{name:'拒绝'}]])await assert.rejects(A.execute(name,args,f.ctx(f.a)),/不可用/);
});
test('生图存受控媒体，语音保存真实音频；异步期间取消不落盘',async()=>{
  const f=fixture(),providers=require('../lib/providers.cjs'),imageOriginal=providers.generateImage,speakOriginal=providers.speak;
  f.state().settings.ai.assign.image='test-image';addVoiceModel(f.state());
  const audio='data:audio/wav;base64,AQID';
  try{
    providers.generateImage=async()=>testImage;providers.speak=async()=>audio;
    await assert.rejects(A.execute('generate_image',{prompt:'一朵花',sendToChat:true},f.ctx(f.a)),/用户发起的聊天/);
    const generated=await A.execute('generate_image',{prompt:'一朵花'},f.ctx(f.a));assert.equal(f.state().engine.data.actions.roleMedia[0].id,generated.mediaId);
    assert.equal(f.state().messages.length,0);
    const voice=await A.execute('send_voice',{text:'你好'},f.ctx(f.a));assert.equal(S.find(f.state().messages,voice.messageId).meta.audio,audio);
    const before=f.getState(),controller=new AbortController();providers.generateImage=async()=>{controller.abort();return testImage;};
    await assert.rejects(A.execute('generate_image',{prompt:'取消'}, {...f.ctx(f.a),signal:controller.signal}),{name:'AbortError'});assert.deepEqual(f.getState(),before);
    providers.generateImage=async()=>{R.apply(f.state(),'actions',{allowImages:false});return testImage;};
    await assert.rejects(A.execute('generate_image',{prompt:'权限已关'},f.ctx(f.a)),/不可用/);assert.equal(f.state().engine.data.actions.roleMedia.length,1);
  }finally{providers.generateImage=imageOriginal;providers.speak=speakOriginal;}
});

test('工具展示文字清除思考内容，正常提及 think 的文字保留',async()=>{
  const f=fixture();await A.execute('update_own_profile',{name:'<think>隐藏</think>小明',signature:'我在 think about tomorrow'},f.ctx(f.a));
  assert.equal(S.role(f.state(),f.a).name,'小明');assert.equal(S.role(f.state(),f.a).bio,'我在 think about tomorrow');
  const post=await A.execute('post_moment',{text:'<thinking>隐藏推理</thinking>今天晴朗'},f.ctx(f.a));assert.equal(S.find(f.state().moments,post.momentId).content,'今天晴朗');
  await assert.rejects(A.execute('post_moment',{text:'<think>只有推理</think>'},f.ctx(f.a)),/不能为空/);
});

test('语义检索仅本角色已标注候选，限6项且无匹配不随机发送',async()=>{
  const f=fixture(),s=f.state(),r=s.roles[0],K=require('../lib/engine/stickers.cjs');
  r.stickers=Array.from({length:8},(_,i)=>({id:'s'+i,name:'文件名',image:'IMAGE'+i}));
  s.stickerSemantics={};for(const [i,sticker]of r.stickers.entries())s.stickerSemantics[K.key(sticker.image)]={status:i===7?'pending':'ready',meaning:'开心庆祝',tags:['喜悦'],usage:'收到好消息',description:'猫举手',visibleText:'好耶'};
  s.roles[1].stickers=[{id:'secret',image:'SECRET'}];s.stickerSemantics[K.key('SECRET')]={status:'ready',meaning:'开心',tags:[],usage:''};
  s.messages.push({roleId:r.id,sender:'assistant',meta:{stickerId:'s0'},createdAt:123});
  const found=await A.execute('search_stickers',{query:'开心'},f.ctx(r.id));assert.equal(found.length,6);assert.equal(found.some(x=>['s7','secret'].includes(x.id)),false);assert.ok(found.every(x=>x.meaning==='开心庆祝'));assert.ok(found.every(x=>'recentUsed' in x));
  assert.deepEqual(await A.execute('search_stickers',{query:'生气愤怒'},f.ctx(r.id)),[]);
  await assert.rejects(A.execute('send_sticker',{id:'s7'},f.ctx(r.id)),/没有可用语义/);
  const sent=await A.execute('send_sticker',{id:'s1'},f.ctx(r.id));const message=S.find(f.state().messages,sent.messageId);assert.equal(message.meta.stickerSemantic.visibleText,'好耶');assert.match(message.meta.caption,/开心庆祝/);
  f.state().stickerSemantics={};assert.equal(message.meta.stickerSemantic.meaning,'开心庆祝');
});

test('默认registry可检索表情且工具说明遵守不发图与最近重复约束',async()=>{
  const f=fixture(),s=f.state(),r=s.roles[0],K=require('../lib/engine/stickers.cjs');r.stickers=[{id:'s',image:'IMG'}];s.stickerSemantics={[K.key('IMG')]:{status:'ready',meaning:'开心',tags:[],usage:''}};
  const definitions=R.tools(s,r,{});for(const name of ['search_stickers','send_sticker']){const description=definitions.find(t=>t.function.name===name).function.description;assert.match(description,/不要图片/);assert.match(description,/最近重复/);}
  const found=await R.executeTool('search_stickers',{query:'开心'},f.ctx(r.id));assert.equal(found[0].id,'s');
});

test('普通画图不带自拍素材，编辑只用可信本轮素材且保留用户原话',async()=>{
  const f=fixture(),providers=require('../lib/providers.cjs'),original=providers.generateImage,calls=[];
  f.state().settings.ai.assign.image='isolated-image';
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  providers.generateImage=async(s,prompt,options)=>{calls.push({prompt,options});return testImage;};
  try{
    await A.execute('generate_image',{prompt:'画一只猫'}, {...f.ctx(f.a),imageRequest:{userText:'给我画一只蓝猫，背景纯白',userImage:image}});
    assert.deepEqual(calls[0].options.references,[]);assert.ok(calls[0].prompt.includes('给我画一只蓝猫，背景纯白'));assert.ok(calls[0].prompt.includes('普通画图'));
    await A.execute('generate_image',{prompt:'改成蓝猫',mode:'edit'}, {...f.ctx(f.a),imageRequest:{userText:'只把猫改成蓝色，背景不要动',userImage:image}});
    assert.deepEqual(calls[1].options.references,[image]);assert.equal(calls[1].options.requireReference,true);assert.ok(calls[1].prompt.includes('只把猫改成蓝色，背景不要动'));assert.ok(calls[1].prompt.includes('其余内容保持原样'));
    let waiting=0;const ctx={...f.ctx(f.a),beforeImageGeneration:()=>waiting++};
    await assert.rejects(A.execute('generate_image',{prompt:'修改',mode:'edit'},ctx),/发送或引用/);
    assert.equal(waiting,0);assert.equal(calls.length,2);
    const userText='画出左边的树。'.repeat(600);
    await A.execute('generate_image',{prompt:'加入右边的花草。'.repeat(600)},{...f.ctx(f.a),imageRequest:{userText}});
    assert.ok(calls[2].prompt.includes(userText));assert.ok(calls[2].prompt.length<=8000);
  }finally{providers.generateImage=original;}
});
