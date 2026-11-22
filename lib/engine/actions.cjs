// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../state.cjs');
const {dayKey,format}=require('./time.cjs');
const MomentVisibility=require('../../public/moment-visibility.js');

function creditRole(s,roleId,amountCents,source,now=Date.now()){
  const balance=(s.wallet.roleBalances[roleId]||0)+amountCents;
  S.integer(balance,0,Number.MAX_SAFE_INTEGER);
  s.wallet.roleBalances[roleId]=balance;
  s.wallet.credits.push({id:S.id(),roleId,amountCents,source,createdAt:now});
}
function initializeWallet(s,initialCents){
  s.wallet.initializedRoles??={};s.wallet.credits??=[];
  for(const r of s.roles)if(!s.wallet.initializedRoles[r.id]){
    creditRole(s,r.id,initialCents,'initial');s.wallet.initializedRoles[r.id]=true;
  }
  for(const t of s.wallet.transactions)t.status??='received';
}
function deliverBubble(s,r,m,ctx){
  const run=ctx?.deferChatActions&&ctx?.executionId&&s.engine?.data?.execution?.runs?.[ctx.executionId];
  if(run){(run.pendingActionMessages??=[]).push(m);return m;}
  s.messages.push(m);r.lastActiveAt=m.createdAt;r.hidden=false;
  if(m.sender==='assistant'||m.meta?.kind==='pat')r.unread=Math.min(100000,r.unread+1);
  return m;
}
function transfer(s,roleId,{amountCents,note='',type,requestId,stickerImage,deferMessage=false,executionId=''},sender,settings,now=Date.now()){
  const r=S.role(s,roleId);S.chatAllowed(r);
  const amount=S.integer(amountCents,1,100000000),kind=S.enumOf(type,['redpacket','transfer']),memo=S.text(note,200);
  const sticker=S.redpacketSticker(stickerImage,kind);
  if(requestId){
    const previous=s.wallet.transactions.find(t=>t.requestId===requestId);
    if(previous){
      if(previous.roleId!==roleId||previous.amountCents!==amount||previous.type!==kind||previous.note!==memo||(previous.stickerImage||'')!==sticker||previous.direction!==(sender==='user'?'out':'in'))S.fail('requestId 已用于其他转账',409);
      return previous;
    }
  }
  if(kind==='redpacket'&&amount>settings.redpacketMaxCents)S.fail('单个红包超过金额上限');
  if(sender==='assistant'){
    const today=dayKey(now,s.settings.timezone),count=s.wallet.transactions.filter(t=>t.roleId===roleId&&t.direction==='in'&&t.type===kind&&dayKey(t.createdAt,s.settings.timezone)===today).length;
    if(count>=(kind==='redpacket'?settings.dailyRedpacketLimit:settings.dailyTransferLimit))S.fail('今天的发送次数已用完');
  }
  const balance=sender==='user'?s.wallet.balanceCents:s.wallet.roleBalances[roleId];
  if(balance<amount)S.fail('余额不足');
  if(sender==='user')s.wallet.balanceCents-=amount;else s.wallet.roleBalances[roleId]-=amount;
  const t={id:S.id(),roleId,type:kind,amountCents:amount,note:memo,direction:sender==='user'?'out':'in',status:'pending',createdAt:now,...(sticker?{stickerImage:sticker}:{}),...(requestId?{requestId}:{})};
  s.wallet.transactions.push(t);
  deliverBubble(s,r,{id:S.id(),roleId:r.id,sender,type:kind,content:kind==='redpacket'?'发出虚拟红包':'发出虚拟转账',createdAt:now,status:'sent',meta:{transactionId:t.id,amountCents:amount,note:memo,...(sticker?{stickerImage:sticker}:{})}},{deferChatActions:deferMessage&&sender==='assistant',executionId});
  return t;
}
function settle(s,id,action,actor,roleId,now=Date.now()){
  const t=S.find(s.wallet.transactions,S.text(id,100),'红包或转账');
  if(t.roleId!==roleId||t.direction!==(actor==='user'?'in':'out'))S.fail('只能处理发给自己的红包或转账');
  S.chatAllowed(S.role(s,roleId));S.enumOf(action,['receive','return']);
  if(actor==='user'&&action==='receive'&&t.status==='received'&&t.receiptMessageId)return t;
  if(t.status!=='pending')S.fail('这笔红包或转账已处理');
  if(now-t.createdAt>=require('./registry.cjs').values(s,'actions').refundHours*3600000)S.fail('这笔红包或转账已过期');
  finishPayment(s,t,action==='receive'?'received':'returned',now);
  if(actor==='user'&&action==='receive'){
    const r=S.role(s,roleId),verb=t.type==='redpacket'?'领取':'收款';
    const receipt=S.message(s,r,'system',`你已${verb}${r.remark||r.name}发来的${t.type==='redpacket'?'红包':'转账'} ¥${(t.amountCents/100).toFixed(2)}`,'text',{createdAt:now,meta:{kind:'payment-receipt',transactionId:t.id,paymentType:t.type,amountCents:t.amountCents,actor:'user',action:'receive'}});
    t.receiptMessageId=receipt.id;
  }
  return t;
}
function finishPayment(s,t,status,now){
  const toUser=status==='received'?t.direction==='in':t.direction==='out';
  if(toUser)s.wallet.balanceCents=S.integer(s.wallet.balanceCents+t.amountCents,0,Number.MAX_SAFE_INTEGER);
  else creditRole(s,t.roleId,t.amountCents,status==='received'?'received_payment':'returned_payment',now);
  t.status=status;t.updatedAt=now;
  if(status==='returned')t.returnedAt=now;
}
function returnPending(s,roleId,now){
  const pending=s.wallet.transactions.filter(t=>t.roleId===roleId&&t.status==='pending');
  let outgoing=0,incoming=0;
  for(const t of pending)if(t.direction==='out')outgoing+=t.amountCents;else incoming+=t.amountCents;
  S.integer(s.wallet.balanceCents+outgoing,0,Number.MAX_SAFE_INTEGER);
  S.integer((s.wallet.roleBalances[roleId]||0)+incoming,0,Number.MAX_SAFE_INTEGER);
  for(const t of pending)finishPayment(s,t,'returned',now);
}
function expirePayments(s,now=Date.now()){
  const lifetime=require('./registry.cjs').values(s,'actions').refundHours*3600000;
  for(const t of s.wallet.transactions)if(t.status==='pending'&&now-t.createdAt>=lifetime)finishPayment(s,t,'returned',now);
}

const string=description=>({type:'string',description});
const tool=(name,description,properties,required=Object.keys(properties))=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const paymentFields={amountYuan:{type:'number',minimum:0.01,maximum:1000000,description:'金额，单位为元，最多两位小数，例如 8.88'},note:string('红包祝福或转账说明')};
function paymentToolResult({amountCents,stickerImage,...result}){
  return {...result,amountYuan:amountCents/100};
}
function searchStickers(s,r,query){
  const normalized=query.toLocaleLowerCase().trim();if(!normalized)return [];
  const words=normalized.match(/[\p{Script=Han}]+|[a-z0-9]+/gu)||[];
  const tokens=[...new Set(words.flatMap(word=>/\p{Script=Han}/u.test(word)&&word.length>1?[word,...Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2))]:[word]))];
  const semantics=require('./stickers.cjs');
  return r.stickers.flatMap(sticker=>{
    const semantic=semantics.get(s,sticker.image);if(semantic?.status!=='ready')return [];
    const {meaning,tags,usage}=semantic,haystack=[meaning,...tags,usage,semantic.description,semantic.visibleText].join(' ').toLocaleLowerCase();
    const score=tokens.reduce((sum,token)=>sum+(haystack.includes(token)?token.length:0),0);if(!score)return [];
    const recent=s.messages.filter(m=>m.roleId===r.id&&m.sender==='assistant'&&m.meta?.stickerId===sticker.id).at(-1);
    return [{id:sticker.id,meaning,tags,usage,recentUsed:recent?.createdAt||null,score}];
  }).sort((a,b)=>b.score-a.score||(a.recentUsed||0)-(b.recentUsed||0)).slice(0,6).map(({score,...item})=>item);
}
const actionSettings={
  send_redpacket:'allowPayments',
  send_transfer:'allowPayments',
  handle_payment:'allowPayments',
  pat_user:'allowPat',
  reply_quote:'allowQuote',
  recall_message:'allowRecall',
  search_stickers:'allowStickers',
  send_sticker:'allowStickers',
  future_task:'allowReminders'
};
function withMessageTargets(list){
  const actions=list.map(item=>item.function.name).filter(name=>['reply_quote','recall_message','send_image'].includes(name));
  if(!actions.length)return list;
  return [...list,tool('select_message_targets','仅需引用、撤回或重发聊天图片时查询本会话候选，最近在前，每页 8 条。选中后把 messageId 交给对应工具。',{
    action:{type:'string',enum:actions},
    query:string('可选，按原话片段或图片说明筛选'),
    before:string('可选，继续上一页时传回 nextBefore')
  },['action'])];
}
function ownRecallable(message,roleId){
  return message.sender==='assistant'&&['text','image','voice','forward'].includes(message.type)||
    message.sender==='system'&&message.meta?.kind==='pat'&&message.meta.author===roleId;
}
function visibleTarget(message,ctx){
  return message.status==='sent'||message.status==='pending'&&message.sender==='user'&&
    (message.id===ctx.targetId||ctx.liveRequestIds?.has(message.id));
}
function selectMessageTargets(state,roleId,args,ctx){
  const query=S.text(args.query||'',300).trim().toLocaleLowerCase(),now=Date.now();
  const response=require('./response.cjs'),messageIds=ctx.messageIds||response.conversationMessageIds(state.messages,roleId);
  const before=args.before?state.messages.findIndex(m=>m.roleId===roleId&&m.id===args.before):state.messages.length;
  if(before<0)S.fail('上一页定位的消息已不存在，请重新查询');
  const messages=[];
  for(let i=before-1;i>=0;i--){
    const m=state.messages[i];
    if(m.roleId!==roleId||!visibleTarget(m,ctx)||m.meta?.kind==='recalled')continue;
    if(args.action==='reply_quote'&&m.sender!=='user')continue;
    if(args.action==='recall_message'&&(!ownRecallable(m,roleId)||now-m.createdAt>120000))continue;
    if(args.action==='send_image'&&(require('./model-images.cjs').expired(m,'image')||m.type!=='image'||!['user','assistant'].includes(m.sender)||m.meta?.stickerId&&!ctx.settings.allowStickers))continue;
    let text=m.content;
    if(m.type==='image')text=require('./model-images.cjs').expired(m,'image')?require('./model-images.cjs').imageText(m):m.meta?.caption||m.meta?.stickerSemantic?.meaning||(m.meta?.stickerId?'[表情]':'[图片]');
    if(m.type==='voice')text=m.meta?.transcript||m.content||(require('./model-images.cjs').expired(m,'voice')?'[语音已过期]':'[语音]');
    if(m.sender==='assistant'&&(m.type==='text'||m.type==='voice'))text=response.stripMessageNumbers(text,messageIds);
    if(!text&&m.meta?.image)text=m.meta.caption||'[图片]';
    const index=text.toLocaleLowerCase().indexOf(query);
    if(index<0)continue;
    if(messages.length===8)return {messages,nextBefore:messages.at(-1).messageId};
    const start=Math.max(0,index-32),preview=(start?'…':'')+text.slice(start,start+120)+(text.length>start+120?'…':'');
    messages.push({messageId:m.id,sender:m.sender,type:m.type,time:format(m.createdAt,state.settings.timezone),preview});
  }
  return {messages};
}
function definitions(s,r){
  const registry=require('./registry.cjs');
  const permissions=registry.values(s,'actions');
  const list=[
    tool('send_redpacket','从自己的虚拟零钱发红包给用户',{...paymentFields,stickerImage:string('红包表情图片 Data URL')},['amountYuan','note']),
    tool('send_transfer','从自己的虚拟零钱转账给用户',paymentFields),
    tool('handle_payment','收下或退还用户发给自己的待处理红包/转账',{id:string('交易标识'),action:{type:'string',enum:['receive','return']}}),
    tool('pat_user','拍一拍用户',{}),
    tool('reply_quote','先用 select_message_targets 查找要引用的用户消息，然后发送引用回复',{messageId:string('选中的 messageId'),text:string('回复文字')}),
    tool('recall_message','先用 select_message_targets 查找自己两分钟内发出的消息，再撤回选中的一条',{messageId:string('选中的 messageId')})
  ];
  if(permissions.allowMoments&&!r.permissions.onlyChat){
    list.push(tool('post_moment','发布自己的朋友圈，图片只能引用自己的媒体标识',{text:string('动态正文'),images:{type:'array',items:string('自己的媒体标识'),maxItems:9},visibility:{type:'string',enum:['all']}},['text']),
      tool('like_moment','为自己可见的朋友圈点赞',{momentId:string('动态标识')}),
      tool('comment_moment','评论自己可见的朋友圈',{momentId:string('动态标识'),text:string('评论正文')}));
  }
  if(r.stickers.length)list.push(tool('search_stickers','按当前表达意图检索自己的表情库，最多返回6个已标注候选；用户要求不要图片时不检索或发送；参考recentUsed避免最近重复，没有合适结果时正常用文字回复，不必发送表情',{query:string('想表达的含义、情绪或使用场景')}),tool('send_sticker','发送 search_stickers 返回的合适表情；尊重用户不要图片的要求，避免最近重复，只有确实符合聊天语境才发送',{id:string('检索返回的表情标识')}));
  const voiceMod=registry.get('voice');
  if(voiceMod.canSend(s,r)){
    const sounds=voiceMod.usesBreezeTags(s)?'需要声音效果时，可以在台词开头放一个声音标签（如 [轻笑]、[叹气]、[耳语]）。':'';
    list.push(tool('send_voice','根据你的人设和当前聊天，自己决定用文字还是用语音。选语音时像平时线上聊天一样说完整、简短的台词，省去动作描写。'+sounds+'发送后不要用文字重复这段台词。',{text:string('说给用户听的台词')}));
  }
  if(permissions.allowImages){
    if(s.settings.ai.assign.image)list.push(tool('generate_image','普通画图用 mode=text，例如排风井、猫。用户要求修改引用或本轮图片时用 mode=edit，角色生活照用 send_selfie。图片保存到相册。用户在当前聊天要求画图或改图时设 sendToChat=true，成图会直接发给用户。',{prompt:string('简短的画面描述，程序会单独保留用户原话'),mode:{type:'string',enum:['text','edit'],description:'默认 text 普通画图；edit 修改用户引用或本轮图片'},waitingText:string('生成前先说一句口语等待提示，图片发出前不要说已发'),sendToChat:{type:'boolean',description:'当前用户要求画图或改图时填 true，只存相册时留空'}},['prompt']));
    list.push(tool('send_image','发送自己生成的图片，或用 select_message_targets 选择本会话图片再发',{mediaId:string('自己的媒体标识'),messageId:string('选中的图片 messageId')},[]));
  }
  if(permissions.allowProfile)list.push(tool('update_own_profile','修改自己的展示资料，头像和封面只能引用自己的媒体标识',{name:string('名字'),avatar:string('头像媒体标识'),signature:string('个性签名'),patText:string('拍一拍内容'),cover:string('封面媒体标识')},[]));
  list.push(tool('future_task','安排未来要做的事，或查看、修改、删除自己的提醒。时间按当前配置时区',{action:{type:'string',enum:['create','edit','list','delete']},id:string('修改/删除时的任务标识'),note:string('用户明确要求的提醒：到时原样发出的消息正文。自己安排的提醒：到时要做的事。'),userRequested:{type:'boolean',description:'仅用户明确要求安排时填 true，自己安排填 false'},schedule:{type:'object',description:'一次性 {type:once,at:ISO日期或毫秒}；每天 {type:daily,time:HH:mm}；每周 {type:weekly,weekdays:[0..6],time:HH:mm}；间隔 {type:interval,intervalMs:至少3600000}',additionalProperties:true}},['action']));
  return withMessageTargets(list.filter(t=>permissions[actionSettings[t.function.name]]!==false));
}
function readableMoment(s,r,id){
  S.momentAllowed(r);
  const m=S.find(s.moments,S.text(id,100),'朋友圈');
  if(!MomentVisibility.forRole(m,r))S.fail('这条朋友圈对你不可见');
  return m;
}
function ownMedia(s,roleId,id){
  const media=S.find(s.engine.data.actions.roleMedia||[],S.text(id,100),'图片媒体');
  if(media.roleId!==roleId)S.fail('不能使用其他好友的图片媒体');
  return media.image;
}
function validateArgs(definition,args){
  const schema=definition.function.parameters;
  if(Object.keys(args).some(key=>!Object.hasOwn(schema.properties,key)))S.fail('角色动作包含未知参数');
  if(schema.required.some(key=>args[key]===undefined))S.fail('角色动作缺少必填参数');
  for(const [key,value] of Object.entries(args)){
    const spec=schema.properties[key];
    if(spec.type==='string'&&typeof value!=='string'||spec.type==='boolean'&&typeof value!=='boolean'||spec.type==='number'&&!Number.isFinite(value)||spec.type==='object'&&!S.obj(value)||spec.type==='array'&&(!Array.isArray(value)||value.length>spec.maxItems||value.some(x=>typeof x!=='string')))S.fail('角色动作参数格式无效：'+key);
    if(spec.enum&&!spec.enum.includes(value))S.fail('角色动作参数选项无效：'+key);
  }
}
async function execute(name,args,ctx){
  const {getState,mutate,roleId,signal,onUsage,settings,scheduler}=ctx;
  if(!S.obj(args))S.fail('角色动作参数必须为对象');
  signal?.throwIfAborted();
  const before=getState(),actor=S.role(before,roleId);S.chatAllowed(actor);
  const definition=definitions(before,actor).find(t=>t.function.name===name);
  if(!definition)S.fail('这个角色动作当前不可用');
  const reqKeys=new Set(definition.function.parameters.required||[]),cleanedArgs={};
  for(const [k,v]of Object.entries(args)){if((v===null||v===undefined)&&!reqKeys.has(k))continue;cleanedArgs[k]=v;}
  if((name==='send_redpacket'||name==='send_transfer')&&!Object.hasOwn(cleanedArgs,'amountYuan')&&Object.hasOwn(cleanedArgs,'amountCents')){
    cleanedArgs.amountYuan=S.integer(cleanedArgs.amountCents,1,100000000)/100;
    delete cleanedArgs.amountCents;
  }
  validateArgs(definition,cleanedArgs);
  args=cleanedArgs;
  if(name==='select_message_targets')return selectMessageTargets(before,roleId,args,ctx);
  const textKeys=['text','name','signature','patText','note'].filter(key=>args[key]!==undefined);
  if(textKeys.length){
    const response=require('./response.cjs'),messageIds=ctx.messageIds||response.conversationMessageIds(before.messages,roleId);
    for(const key of textKeys)args[key]=response.visibleText(args[key],messageIds);
  }
  if(name==='generate_image'){
    const rawPrompt=S.text(args.prompt,8000).trim();if(!rawPrompt)S.fail('图片描述不能为空');
    if(args.sendToChat&&!ctx.allowDirectImageDelivery)S.fail('只在当前用户发起的聊天里支持直接发送新图');
    const mode=args.mode||'text',references=[],modelImages={};
    if(mode==='edit'){
      require('./model-images.cjs').assertRequest(before,ctx.imageRequest);
      const source=ctx.imageRequest?.userImage;
      if(!source)S.fail('请先发送或引用一张要修改的图片，再告诉我怎么改。');
      references.push(source);
      if(ctx.imageRequest.userModelImage)modelImages[source]=ctx.imageRequest.userModelImage;
    }
    const userText=ctx.imageRequest?.userText||'';
    const instructions=mode==='edit'?'用途：只修改本轮指定的原图，其余内容保持原样。':'用途：普通画图。';
    const required=S.text(userText?`${instructions}\n用户原始要求（优先遵循）：\n${userText}`:instructions,8000);
    const supplement='\n\n模型补充（只补用户没指定的细节）：\n';
    const remaining=8000-required.length-supplement.length;
    const prompt=rawPrompt===userText.trim()||remaining<=0?required:required+supplement+rawPrompt.slice(0,remaining);
    const waitForImage=()=>{if(mode==='edit')require('./model-images.cjs').assertRequest(getState(),ctx.imageRequest);return ctx.beforeImageGeneration?.(args.waitingText);};
    if(mode==='text')waitForImage();
    const image=S.image(await require('../providers.cjs').generateImage(before,prompt,{signal,onUsage,references,modelImages,requireReference:mode==='edit',beforeRequest:mode==='edit'?waitForImage:undefined,allowSizeStepDown:require('./registry.cjs').isEnabled(before,'selfie'),dataDir:ctx.dataDir}),false);signal?.throwIfAborted();
    return mutate(s=>{
      const r=S.role(s,roleId);S.chatAllowed(r);
      if(!definitions(s,r).some(t=>t.function.name===name))S.fail('这个角色动作当前不可用');
      const media={id:S.id(),roleId,image,prompt,createdAt:Date.now()};
      (s.engine.data.actions.roleMedia??=[]).push(media);
      if(!args.sendToChat)return {mediaId:media.id};
      const msg={id:S.id(),roleId,sender:'assistant',type:'image',content:image,createdAt:media.createdAt,status:'sent'};
      deliverBubble(s,r,msg,ctx);
      return {mediaId:media.id,messageId:msg.id,sentToChat:true};
    }).value;
  }
  if(name==='send_voice'){
    const voiceMod=require('./modules/voice.cjs');
    const {displayText,ttsText,tooLong}=voiceMod.prepareSpeech(S.text(args.text,100000),{allowVoiceTags:voiceMod.usesBreezeTags(before)});
    if(!displayText)S.fail('语音文字不能为空');
    let audio='',error;
    if(!tooLong&&ttsText){
      try{
        audio=S.audio(await require('../providers.cjs').speak(before,ttsText,{signal,onUsage,voice:voiceMod.resolveVoice(before,actor),demoModel:Boolean(ctx.demoModel),dataDir:ctx.dataDir}));
      }catch(err){
        if(err.name==='AbortError'||signal?.aborted)throw err;
        error=err;
      }
    }
    signal?.throwIfAborted();
    return mutate(s=>{
      const r=S.role(s,roleId);S.chatAllowed(r);
      const deliverAudio=Boolean(audio)&&voiceMod.canSend(s,r);
      if(error)s.engine.data.voice.lastError={message:error.message.slice(0,500),at:Date.now()};
      if(!deliverAudio){
        return {delivered:'failed',error:'语音发送失败（当前无法发出语音）。请直接用普通文字自然回复对方，不要提及语音发送失败或技术原因，也不要声称发出了语音。'};
      }
      const meta={audio,transcript:displayText,transcriptSource:'provider',durationMs:require('../provider-native.cjs').estimateAudioDurationMs(audio,displayText,{dataDir:ctx.dataDir})};
      const m={id:S.id(),roleId:r.id,sender:'assistant',type:'voice',content:displayText,createdAt:Date.now(),status:'sent',meta};
      deliverBubble(s,r,m,ctx);
      return {messageId:m.id,delivered:'voice',status:'语音已发送'};
    }).value;
  }
  return mutate(s=>{
    signal?.throwIfAborted();const r=S.role(s,roleId);S.chatAllowed(r);
    const sent=(text,type='text',meta)=>{const m={id:S.id(),roleId:r.id,sender:'assistant',type,content:text,createdAt:Date.now(),status:'sent',...(meta?{meta}:{})};deliverBubble(s,r,m,ctx);return {messageId:m.id};};
    switch(name){
      case 'send_image':{
        if(Boolean(args.mediaId)===Boolean(args.messageId))S.fail('请选择一个媒体标识或图片消息标识');
        if(args.mediaId){
          const image=ownMedia(s,roleId,args.mediaId);
          const sentNow=s.engine.data.execution?.actions.find(row=>row.runId===ctx.executionId&&row.roleId===roleId&&row.name==='generate_image'&&row.status==='completed'&&row.result?.mediaId===args.mediaId&&row.result?.sentToChat);
          if(sentNow)return {messageId:sentNow.result.messageId};
          const meta=require('./model-images.cjs').metadata(s,roleId,image);
          return sent(image,'image',Object.keys(meta).length?meta:undefined);
        }
        const m=S.find(s.messages,S.text(args.messageId,100),'图片消息');
        if(m.roleId!==roleId||m.type!=='image'||!visibleTarget(m,ctx)||!['user','assistant'].includes(m.sender))S.fail('只能使用本会话可见的图片消息');
        if(require('./model-images.cjs').expired(m,'image'))S.fail('图片已过期，不能重发，请重新上传或从相册选择',422,'MEDIA_EXPIRED');
        const {stickerId,stickerSemantic,caption,modelImage,thumb}=m.meta||{};
        if(stickerId&&!settings.allowStickers)S.fail('发送表情已关闭');
        const meta=Object.fromEntries(Object.entries({modelImage,thumb,caption,...(stickerId?{stickerId,stickerSemantic}:{})}).filter(([,value])=>value!==undefined));
        return sent(S.image(m.content,false),'image',Object.keys(meta).length?meta:undefined);
      }
      case 'update_own_profile':{
        if(!Object.keys(args).length)S.fail('请提供要修改的资料');
        const changes={};
        for(const [key,value] of Object.entries(args)){
          if(['avatar','cover'].includes(key))changes[key]=ownMedia(s,roleId,value);
          else {const content=S.text(value,key==='signature'?1000:key==='patText'?100:80).trim();if(key==='name'&&!content)S.fail('名字不能为空');changes[key==='signature'?'bio':key]=content;}
        }
        Object.assign(r,changes);return {updated:Object.keys(args)};
      }
      case 'send_redpacket':case 'send_transfer':{
        const {amountYuan,note,stickerImage}=args,amountCents=Math.round(amountYuan*100);
        if(amountCents<1||amountCents>100000000||amountCents/100!==amountYuan)S.fail('金额须在 0.01 至 1000000 元之间，最多两位小数');
        const type=name==='send_redpacket'?'redpacket':'transfer';
        return paymentToolResult(transfer(s,roleId,{amountCents,note,stickerImage,type,deferMessage:Boolean(ctx.deferChatActions),executionId:ctx.executionId||''},'assistant',settings));
      }
      case 'handle_payment':{
        return paymentToolResult(settle(s,args.id,args.action,'assistant',roleId));
      }
      case 'pat_user':{const m={id:S.id(),roleId:r.id,sender:'system',type:'text',content:`“${r.remark||r.name}”拍了拍我${s.profile.patText?'的'+s.profile.patText:''}`,createdAt:Date.now(),status:'sent',meta:{kind:'pat',author:roleId,target:'self',patText:s.profile.patText||''}};deliverBubble(s,r,m,ctx);return {messageId:m.id};}
      case 'reply_quote':{const content=S.text(args.text,16000).trim();if(!content)S.fail('引用回复不能为空');const target=S.find(s.messages,S.text(args.messageId,100),'引用消息');if(target.sender!=='user'||!visibleTarget(target,ctx))S.fail('只能引用用户已发来的可见消息');return sent(content,'text',{quote:S.quote(s,roleId,target.id)});}
      case 'recall_message':{
        const m=S.find(s.messages,S.text(args.messageId,100),'消息');
        if(m.roleId!==roleId||m.status!=='sent'||!ownRecallable(m,roleId))S.fail('只能撤回自己的消息');
        if(Date.now()-m.createdAt>120000)S.fail('只能撤回两分钟内的消息');
        for(const f of s.favorites)if(f.messageId===m.id)delete f.messageId;
        for(const item of s.messages)if(item.meta?.quote?.messageId===m.id){delete item.meta.quote.messageId;item.meta.quote.unavailable='recalled';}
        Object.assign(m,{sender:'system',type:'text',content:`“${r.remark||r.name}”撤回了一条消息`,meta:{kind:'recalled',author:roleId,recalledType:m.meta?.kind==='pat'?'pat':m.type,recalledAt:Date.now()}});return {messageId:m.id};
      }
      case 'post_moment':{
        S.momentAllowed(r);const content=S.text(args.text,10000).trim(),images=(args.images||[]).map(id=>ownMedia(s,roleId,id));if(!content&&!images.length)S.fail('朋友圈不能为空');
        const m={id:S.id(),authorId:roleId,content,image:images[0]||'',images,location:'',mentions:[],visibility:'all',likes:[],comments:[],createdAt:Date.now()};s.moments.push(m);return {momentId:m.id};
      }
      case 'like_moment':{const m=readableMoment(s,r,args.momentId);if(!m.likes.includes(roleId))m.likes.push(roleId);return {momentId:m.id};}
      case 'comment_moment':{const m=readableMoment(s,r,args.momentId),content=S.text(args.text,2000).trim();if(!content)S.fail('评论不能为空');const c={id:S.id(),authorId:roleId,content,createdAt:Date.now()};m.comments.push(c);return {commentId:c.id};}
      case 'search_stickers':return searchStickers(s,r,S.text(args.query,300));
      case 'send_sticker':{
        const sticker=S.find(r.stickers,S.text(args.id,100),'表情'),semantic=require('./stickers.cjs').get(s,sticker.image);
        if(semantic?.status!=='ready')S.fail('这张表情还没有可用语义，请检索其他表情');
        const {meaning,tags,usage,description,visibleText}=semantic;
        return sent(sticker.image,'image',{stickerId:sticker.id,stickerSemantic:{meaning,tags:[...tags],usage,description,visibleText},caption:require('./stickers.cjs').describe(s,sticker.image)});
      }
      case 'future_task':{
        switch(S.enumOf(args.action,['create','edit','list','delete'])){
          case 'create':return scheduler.add(s,roleId,{note:args.note,userRequested:args.userRequested,schedule:args.schedule});
          case 'edit':return scheduler.edit(s,roleId,args.id,{note:args.note,userRequested:args.userRequested,schedule:args.schedule});
          case 'list':return scheduler.list(s,roleId);
          case 'delete':scheduler.remove(s,roleId,args.id);return {deleted:true};
        }
      }
    }
  }).value;
}
module.exports={creditRole,initializeWallet,transfer,settle,returnPending,expirePayments,definitions,execute,deliverBubble,ownMedia,withMessageTargets};
