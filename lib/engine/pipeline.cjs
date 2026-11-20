// SPDX-License-Identifier: AGPL-3.0-only
// Independently implemented from the published feature specification. No
// third-party source code is included in this module.
'use strict';
const S=require('../state.cjs'),R=require('./registry.cjs'),T=require('./time.cjs');
const defaultModels=require('./models.cjs');
const ModelImages=require('./model-images.cjs');
const {visibleText,stripMessageNumbers,conversationMessageIds}=require('./response.cjs');
const H=require('./tool-history.cjs');
const MAX_TOOL_CALLS=8,MAX_TOOL_RESULT_CHARS=32768;
function checkBudget(config,messages){if(estimate(messages)>config.maxContextTokens)S.fail('请求超过当前模型的对话容量',422,'CONTEXT_LIMIT');return messages;}
const SUMMARY_PROMPT=`请把上面这段聊天整理成一份简洁的记录，供你之后继续和对方聊天时回忆使用。
1. 对方提到的个人情况：身份、习惯、喜好、正在经历的事、在意的人和事。
2. 你们之间发生过的重要的事，以及说好的约定和还没做完的事。
3. 你们的关系和相处方式有什么变化，对方对你的称呼和态度。
4. 最近在聊的话题，以及对方当时的情绪。
只写聊天里真实出现过的内容，不要推测和补充。已有的旧记录里仍然成立的内容要保留。
用对方使用的语言书写，只输出记录本身。`;
const graphemes=new Intl.Segmenter('zh',{granularity:'grapheme'}),weights=new WeakMap(),recordIds=new WeakMap(),imageSources=new WeakMap();
function estimate(value){
  if(Array.isArray(value))return value.reduce((sum,item)=>sum+estimate(item),0);
  if(value&&typeof value==='object'){
    if(weights.has(value))return weights.get(value);
    if(value.type==='image_url')return 765;
    if(value.type==='input_audio')return 500;
    return estimate(value.content??value.text??value.function?.arguments??'')+(value.tool_calls?estimate(JSON.stringify(value.tool_calls)):0);
  }
  if(typeof value!=='string')return 0;
  let total=0;
  for(const {segment}of graphemes.segment(value)){
    if(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(segment))total+=2;
    else for(const char of segment)total+=/\p{Script=Han}/u.test(char)?0.6:0.3;
  }
  return total;
}
function system(state,role,queryText='',{dataDir,recalledMemories,includeMemory=true}={}){
  const rolePersona=state.rolePersonas?.find(p=>p.id===role.rolePersonaId);
  const persona=rolePersona?null:state.personas.find(p=>p.id===role.personaId);
  const picked=includeMemory&&R.isEnabled(state,'memory')?(recalledMemories||require('./modules/memory.cjs').selectForPrompt(state,role.id,queryText,{dataDir})):[];
  const moments=role.permissions?.onlyChat?[]:state.moments.filter(m=>m.authorId===role.id||m.authorId==='me'&&!role.permissions?.hideMyMoments&&(m.visibility==='all'||m.visibility.includes(role.id))).slice(-10);
  const visible=moments.map(m=>`[动态编号：${m.id}] ${m.authorId==='me'?'用户':role.name}：${m.content}${m.location?'（'+m.location+'）':''}${m.images?.length?' [图片 '+m.images.length+' 张]':''}${m.comments.filter(c=>c.authorId==='me'||c.authorId===role.id).map(c=>'\n'+(c.authorId==='me'?'用户':role.name)+'评论：'+c.content).join('')}`).join('\n').slice(0,12000);
  const media=(state.engine?.data.actions?.roleMedia||[]).filter(m=>m.roleId===role.id).slice(-8).map(m=>`[媒体编号：${m.id}] ${visibleText(m.prompt||'未记录生成描述').slice(0,500)}`).join('\n');
  return {role:'system',content:`这是私人虚构线上聊天应用。遵守纯线上关系边界（不发生也不约线下见面、同居或现实实时通话），不声称完成现实操作。只使用本次会话提供的信息，不应编造记忆。
角色设定：${rolePersona?rolePersona.prompt:role.prompt||role.name}
用户身份：${persona?persona.name+'\n'+persona.prompt:state.profile.name}${rolePersona?'':'\n关系：'+role.relationship}
你当前的展示资料：名字：${role.name}；签名：${role.bio||'未填写'}；拍一拍：${role.patText||'未填写'}；头像：${role.avatar?'已设置':'未设置'}；封面：${role.cover?'已设置':'未设置'}。
你最近生成且可用于发送、头像、封面或朋友圈的图片媒体：\n${media||'无'}
${picked.length?memoryText(picked)+'\n':''}此角色可见的朋友圈与本人互动：\n${visible||'无'}
你的虚拟零钱余额：${((state.wallet.roleBalances?.[role.id]||0)/100).toFixed(2)}元。红包、转账和其他角色动作只发生在本应用内。需要引用、撤回或重发聊天图片时，先用 select_message_targets 挑选本会话的消息，再调用对应工具。款项和朋友圈使用各自提供的标识。
像发微信一样，一条消息只说一件事，多条之间用换行分开。只输出角色对话，不输出内部推理、分析或工具计划。消息编号只用于调用工具，不写进回复正文。需要角色动作时正常调用可用工具。`};
}
function memoryText(cards){return '用户明确保存的此角色记忆：\n'+cards.map(m=>m.memoryType&&m.memoryType!=='GENERAL'?`[${m.memoryType}] ${m.content}`:m.content).join('\n').slice(0,24000);}
function records(state,roleId,targetId){
  const targetIndex=targetId?state.messages.findIndex(m=>m.id===targetId):state.messages.length-1;
  if(targetId&&targetIndex<0)S.fail('消息不存在',404,'NOT_FOUND');
  return state.messages.slice(0,targetIndex+1).filter(m=>m.roleId===roleId&&(m.status==='sent'||m.sender==='user'&&(m.status==='pending'||m.status==='error'&&H.has(state,m.id))));
}
function afterSummary(items,summary){
  if(!summary)return items;
  if(summary.coveredMessageId){const index=items.findIndex(m=>m.id===summary.coveredMessageId);if(index>=0)return items.slice(index+1);}
  return items.filter(m=>m.createdAt>summary.coveredUntil);
}
function imageOf(m){return m.type==='image'?m.content:m.meta?.image;}
function imageLabel(m){return m.meta?.stickerId?'（表情包）':'（图片）';}
function stickerDescription(state,m){
  if(!m.meta?.stickerId)return '';
  let snapshot=m.meta.stickerSemantic;
  if(!snapshot){const image=imageOf(m);if(!image)return '';const current=require('./stickers.cjs').get(state,image);if(current?.status==='ready')snapshot=current;}
  if(snapshot)return [snapshot.meaning,snapshot.tags?.length?'标签：'+snapshot.tags.join('、'):'',snapshot.usage?'场景：'+snapshot.usage:'',snapshot.description,snapshot.visibleText?'图中文字：'+snapshot.visibleText:''].filter(Boolean).join('；');
  return '';
}
function imageDescription(m,state){return imageLabel(m)+(stickerDescription(state,m)||m.meta?.caption||(m.sender==='user'&&!m.meta?.stickerId?'用户发了一张图片，你看不到内容':'内容不可见'));}
function voiceDescription(m){
  return `${m.meta?.transcript||m.content||'未转写的语音'}（语音）${m.meta?.contentEmotion?'\n内容情绪：'+m.meta.contentEmotion:''}${m.meta?.voiceEmotion?'\n声音情绪：'+m.meta.voiceEmotion:''}`;
}
function quoteText(m,state,messageIds){
  const q=m.meta?.quote;if(!q)return '';
  if(q.unavailable)return '（引用的消息已'+(q.unavailable==='recalled'?'撤回':'删除')+'）\n';
  let content=q.type==='image'?'':[...(q.sender==='assistant'?stripMessageNumbers(q.content,messageIds):q.content)].slice(0,60).join('');
  if(q.type==='image'||q.image)content+=(content?' ':'')+[...imageDescription({...q,meta:q.meta||{stickerId:q.stickerId,caption:q.caption,stickerSemantic:q.stickerSemantic}},state)].slice(0,60).join('');
  return `（回复${q.sender==='user'?'用户':q.sender==='assistant'?'你':'系统'}的「${content}」）\n`;
}
function render(state,m,canSeeImage,dataDir,messageIds){
  const who=m.sender==='assistant'?'你':'用户';let content;
  if(m.meta?.kind==='recalled')content=(m.meta.recalledBy==='assistant'||m.meta.author==='assistant'||m.meta.author===m.roleId?'你':'用户')+'撤回了一条消息';
  else if(m.meta?.kind==='pat')content=(m.meta.author==='me'?(m.meta.target==='self'?'用户拍了拍自己':'用户拍了拍你'):'你拍了拍用户')+(m.meta.patText?'的'+m.meta.patText:'');
  else if(['redpacket','transfer'].includes(m.type)){
    const tx=state.wallet.transactions.find(t=>t.id===m.meta?.transactionId),status=tx?.status||m.meta?.status||'pending';
    const statusText=['received','accepted','claimed','completed'].includes(status)?'已领取':status==='refunded'||status==='returned'?'已退还':'待领取';
    content=`${who}发出${m.type==='redpacket'?'红包':'转账'}：${((m.meta?.amountCents??tx?.amountCents??0)/100).toFixed(2)}元；${m.type==='redpacket'?'祝福语':'说明'}：${m.meta?.note||tx?.note||'无'}；当前状态：${statusText}${m.meta?.transactionId?'；款项编号：'+m.meta.transactionId:''}`;
    if(m.type==='redpacket'&&(m.meta?.stickerImage||tx?.stickerImage))content+='；附有红包表情';
  }
  else if(m.type==='voice')content=m.sender==='assistant'?stripMessageNumbers(voiceDescription(m),messageIds):voiceDescription(m);
  else if(m.type==='forward')content='[合并转发]\n'+m.meta.entries.map(e=>`${e.senderName}：${e.type==='image'?imageDescription(e,state):e.type==='voice'?voiceDescription(e):e.type==='forward'?'[合并转发]':e.content+(e.meta?.image?' '+imageDescription(e,state):'')}`).join('\n');
  else content=m.type==='image'?'':m.sender==='assistant'?stripMessageNumbers(m.content,messageIds):m.content;
  const image=imageOf(m),prefix=quoteText(m,state,messageIds);
  const resolved=image&&canSeeImage?ModelImages.dataUrl(dataDir,image,m.meta?.modelImage):image;
  const semantic=stickerDescription(state,m);
  if(image&&semantic)content=prefix+(content?content+'\n':'')+imageLabel(m)+semantic;
  else if(resolved&&canSeeImage){const part={type:'image_url',image_url:{url:resolved}};imageSources.set(part,{image,modelImage:m.meta?.modelImage,label:imageLabel(m)});content=[{type:'text',text:prefix+(content?content+'\n':'')+imageLabel(m)},part];}
  else if(image)content=prefix+(content?content+'\n':'')+imageDescription(m,state);
  else content=prefix+content;
  const result={role:m.sender==='assistant'?'assistant':'user',content};
  recordIds.set(result,m.id);
  if(m.type==='voice')weights.set(result,500);
  return result;
}
function rounds(items,state){
  const result=[];
  for(const item of items){
    const current=result.at(-1);
    if(!current||item.sender==='user'&&current.some(m=>m.sender==='assistant'||H.has(state,m.id)))result.push([item]);else current.push(item);
  }
  return result;
}
function renderHistory(state,items,canSeeImage,dataDir,messageIds){return items.flatMap(m=>[render(state,m,canSeeImage,dataDir,messageIds),...H.messages(state,m).map(message=>{
  if(message.role==='assistant'&&typeof message.content==='string')message.content=stripMessageNumbers(message.content,messageIds);
  recordIds.set(message,m.id);return message;
})]);}
function assertActive(signal){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new DOMException('回复已被新消息打断','AbortError');}
async function run({getState,mutate,roleId,targetId,executionId,instruction='',purpose='chat',signal,tools=[],executeTool,onUsage,onRetry,onReply,onMemoryRead,modelApi=defaultModels,now=Date.now,allowToolOnly=false,dataDir}){
  const ctx={getState,mutate,roleId,targetId,instruction,purpose,signal,onUsage,dataDir,modelApi};
  const hook=async name=>{assertActive(signal);await R.hooks(name,ctx);assertActive(signal);};
  await hook('beforeReceive');
  let state=getState(),role=S.role(state,roleId);S.chatAllowed(role);R.ensure(state);
  const messageIds=conversationMessageIds(state.messages,roleId);
  ctx.messageIds=messageIds;
  await hook('afterReceive');
  await hook('beforePreprocess');
  const firstConfig=await (modelApi.resolveChat||modelApi.resolve)(state,'chat',{role}),canSeeImage=firstConfig.capabilities.includes('image');
  const compression=R.values(state,'compression');
  // Truncation uses original history; saved summaries resume when switching back.
  const summary=compression.strategy==='summary'?state.engine.summaries[roleId]:undefined;let items=afterSummary(records(state,roleId,targetId),summary);
  async function captionImage(image,modelImage){
    const latest=getState(),sourceMessages=latest.messages.filter(m=>m.roleId===roleId&&imageOf(m)===image);
    const cache=caption=>{if(sourceMessages.some(m=>!m.meta?.caption))mutate(currentState=>{for(const current of currentState.messages)if(current.roleId===roleId&&imageOf(current)===image&&!current.meta?.caption){current.meta??={};current.meta.caption=caption;}});return caption;};
    const cached=sourceMessages.find(m=>m.meta?.caption)?.meta.caption;if(cached)return cache(cached);
    if(!defaultModels.visionIds(latest.settings.ai).length)return '';
    const imgUrl=ModelImages.dataUrl(dataDir,image,modelImage||sourceMessages.find(m=>m.meta?.modelImage)?.meta.modelImage);
    if(!imgUrl)return '';
    const result=await modelApi.call(latest,{purpose:'caption',role,signal,onUsage,prepareMessages:async(config,messages)=>checkBudget(config,messages),messages:[{role:'system',content:R.values(latest,'caption').prompt},{role:'user',content:[{type:'image_url',image_url:{url:imgUrl}}]}]});
    assertActive(signal);const caption=visibleText(result.message);if(!caption)S.fail('图片转述没有返回文字',502,'PROVIDER_EMPTY');
    return cache(caption);
  }
  const memoryPolicy=require('./modules/memory.cjs');
  let memoryRead=null;
  const checkMemory=()=>memoryPolicy.assertReadStamp(getState(),roleId,memoryRead,dataDir);
  function refreshMemoryContext(messages){
    const latest=getState(),memory=require('./modules/memory.cjs'),store=require('./memory-store.cjs');
    const enabled=R.isEnabled(latest,'memory');
    const cards=enabled?(ctx.recalledMemories||[]).map(c=>store.getCard(dataDir,latest,roleId,c.id)).filter(c=>c?.status==='active'):[];
    const visibleProfile=enabled?memory.profileForAI(dataDir,latest,roleId):null;
    const profile=store.formatProfileText(visibleProfile);
    messages[0].content=systemWithoutMemory+(cards.length?'\n'+memoryText(cards):'')+(profile?'\n【TA 眼中的用户画像】\n'+profile:'');
    const calls=new Map();
    const usedCards=[];
    let chars=0;
    for(const card of cards){
      if(chars>=24000)break;
      usedCards.push(card);chars+=card.content.length+(card.memoryType&&card.memoryType!=='GENERAL'?card.memoryType.length+3:0)+1;
    }
    const recalledByTool=new Map();
    for(const message of messages){
      for(const call of message.tool_calls||[]){
        if(memory.isMemoryTool(call.function.name)){calls.set(call.id,call.function.name);call.function.arguments='{}';}
      }
      const name=message.role==='tool'&&calls.get(message.tool_call_id);
      if(name){
        const receipt=memory.toolResultForAI(name,JSON.parse(message.content),latest,roleId,dataDir);
        if(receipt?.memories)recalledByTool.set(message.tool_call_id,receipt.memories);
        message.content=JSON.stringify(receipt);
      }
    }
    return {latest,usedCards,profile,visibleProfile,recalledByTool};
  }
  async function prepareMessages(config,messages){
    const prepared=[];
    for(const message of messages){
      if(config.capabilities.includes('image')||!Array.isArray(message.content)){prepared.push(message);continue;}
      const chunks=[];
      for(const part of message.content){
        if(part.type==='text')chunks.push(part.text);
        else if(part.type==='image_url'){const source=imageSources.get(part),caption=await captionImage(source?.image||part.image_url.url,source?.modelImage);chunks.push((source?.label||'（图片）')+(caption||'内容不可见'));}
      }
      const converted={...message,content:chunks.join('\n')};if(recordIds.has(message))recordIds.set(converted,recordIds.get(message));prepared.push(converted);
    }
    const exposure=refreshMemoryContext(prepared);
    const toolIds=new Map();
    if(!config.capabilities.includes('tool_use')){
      const lookups=new Set();
      for(let i=0;i<prepared.length;i++){
        const message=prepared[i];if(!message.tool_calls&&message.role!=='tool')continue;
        for(const call of message.tool_calls||[])if(call.function.name==='select_message_targets')lookups.add(call.id);
        const calls=message.tool_calls?.filter(call=>!lookups.has(call.id));
        if((calls&&!calls.length)||lookups.has(message.tool_call_id)){prepared.splice(i--,1);continue;}
        const receipt=H.description(calls?{...message,tool_calls:calls}:message);
        const converted={role:'assistant',content:'[工具执行记录]\n'+stripMessageNumbers(receipt,messageIds)};
        if(recordIds.has(message))recordIds.set(converted,recordIds.get(message));
        if(message.tool_call_id)toolIds.set(converted,message.tool_call_id);
        prepared[i]=converted;
      }
    }
    const adjustment=getState().engine.data.compression.estimates?.[roleId];
    const ratio=adjustment&&adjustment.modelId===config.id?adjustment.ratio:1;
    const limit=config.maxContextTokens*R.values(getState(),'compression').triggerRatio;
    if(Number.isFinite(limit)){
      const groups=rounds(items,state),latestIds=new Set(groups.at(-1)?.map(m=>m.id)||[]);
      while(estimate(prepared)*ratio>limit){
        const first=prepared.find(m=>recordIds.has(m)&&!latestIds.has(recordIds.get(m)));
        if(!first)break;
        const index=groups.findIndex(g=>g.some(m=>m.id===recordIds.get(first)));
        const count=compression.strategy==='truncate'?compression.dropTurns:1;
        const ids=new Set(groups.slice(index,Math.min(index+count,groups.length-1)).flat().map(m=>m.id));
        for(let i=prepared.length-1;i>=0;i--)if(ids.has(recordIds.get(prepared[i])))prepared.splice(i,1);
      }
      // Like AstrBot's context manager, keep the latest round intact even when
      // it alone exceeds the estimate; the provider reports any actual limit.
    }
    for(const message of prepared){
      const cards=exposure.recalledByTool.get(message.tool_call_id||toolIds.get(message));
      if(cards)exposure.usedCards.push(...cards);
    }
    memoryRead=memoryPolicy.createReadStamp(exposure.latest,roleId,exposure.usedCards,exposure.profile,exposure.visibleProfile);
    onMemoryRead?.(memoryRead);
    ctx.sentMessages=prepared;return prepared;
  }
  if(!canSeeImage){
    for(const item of items){
      const image=imageOf(item);if(!image||stickerDescription(state,item)||item.meta?.caption)continue;
      await captionImage(image,item.meta?.modelImage);
    }
    state=getState();items=afterSummary(records(state,roleId,targetId),summary);
  }
  await hook('afterPreprocess');await hook('beforeAssemble');
  let kept=rounds(items,state),summaryText=stripMessageNumbers(summary?.text||'',messageIds);
  if(compression.maxTurns!==-1)while(kept.length>compression.maxTurns)kept.splice(0,Math.min(compression.dropTurns,kept.length-compression.maxTurns));
  const lastUserText=kept.at(-1)?.filter(m=>m.sender==='user').map(m=>m.meta?.transcript||m.content||'').join('\n')||'';
  const base=system(state,role,lastUserText,{dataDir,includeMemory:false}),clock={role:'system',content:'当前时间：'+T.format(now(),state.settings.timezone||'UTC')};
  let summaryMessage=summaryText?{role:'system',content:'之前聊天的整理记录：\n'+summaryText}:null;
  ctx.messages=[base,...(summaryMessage?[summaryMessage]:[]),...renderHistory(state,kept.flat(),canSeeImage,dataDir,messageIds),clock,...(instruction?[{role:'user',content:instruction}]:[])];
  ctx.role=role;await hook('afterAssemble');await hook('beforeCompress');
  const systemWithoutMemory=base.content;
  refreshMemoryContext(ctx.messages);
  const pruneHistory=()=>{const retained=new Set(kept.flat().map(m=>m.id));ctx.messages=ctx.messages.filter(m=>!recordIds.has(m)||retained.has(recordIds.get(m)));};
  const correction=state.engine.data.compression.estimates?.[roleId],ratio=correction&&correction.modelId===firstConfig.id?correction.ratio:1,limit=firstConfig.maxContextTokens*compression.triggerRatio;
  if(estimate(ctx.messages)*ratio>limit&&kept.length){
    if(compression.strategy==='summary'){
      const budget=Math.floor(estimate(ctx.messages)*compression.keepRecentRatio);let recentStart=kept.length,used=0;
      if(compression.keepRecentRatio>0)for(let i=kept.length-1;i>=0;i--){const cost=estimate(renderHistory(state,kept[i],canSeeImage,dataDir,messageIds));if(used>0&&used+cost>budget)break;used+=cost;recentStart=i;}
      // An unanswered user round remains exact, including a burst of messages.
      if(kept.at(-1).some(m=>m.sender==='user')&&kept.at(-1).at(-1).sender!=='assistant')recentStart=Math.min(recentStart,kept.length-1);
      const old=kept.slice(0,recentStart).flat();
      if(old.length){
        try{
          const plain=renderHistory(state,old,false,dataDir,messageIds).map(m=>(m.role==='assistant'?'你':m.role==='tool'?'工具结果':'用户')+'：'+H.description(m)).join('\n');
          const summaryMessages=[{role:'system',content:compression.prompt||SUMMARY_PROMPT},{role:'user',content:(summaryText?'已有记录：\n'+summaryText+'\n\n':'')+'聊天：\n'+plain}];
          const summaryConfig=await (modelApi.resolveChat||modelApi.resolve)(getState(),'compress',{role});checkBudget(summaryConfig,summaryMessages);
          const result=await modelApi.call(getState(),{purpose:'compress',role,signal,onUsage,prepareMessages:async(config,messages)=>checkBudget(config,messages),messages:summaryMessages});
          assertActive(signal);const text=visibleText(result.message,messageIds);if(!text)throw new Error('长对话整理没有返回文字');
          const last=old.at(-1),updatedAt=now();
          mutate(latest=>{
            if(!latest.roles.some(r=>r.id===roleId)||!latest.messages.some(m=>m.id===last.id&&m.roleId===roleId))return;
            R.ensure(latest);latest.engine.summaries[roleId]={text,coveredUntil:last.createdAt,coveredMessageId:last.id,updatedAt};
          });
          summaryText=text;kept=kept.slice(recentStart);
          const summaryIndex=ctx.messages.indexOf(summaryMessage);summaryMessage={role:'system',content:'之前聊天的整理记录：\n'+summaryText};
          if(summaryIndex>=0)ctx.messages.splice(summaryIndex,1,summaryMessage);else ctx.messages.splice(1,0,summaryMessage);
          pruneHistory();
        }catch(error){assertActive(signal);ctx.compressionError=error.message;mutate(latest=>{R.ensure(latest);latest.engine.data.compression.lastError={roleId,message:error.message,updatedAt:now()};});}
      }
    }
    while(estimate(ctx.messages)*ratio>limit&&kept.length>1){kept.splice(0,Math.min(compression.dropTurns,kept.length-1));pruneHistory();}
  }
  await hook('afterCompress');
  let activeConfig=firstConfig,modelId,step=0,toolCount=0,executedTools=0;
  for(;;){
    state=getState();role=S.role(state,roleId);S.chatAllowed(role);
    ctx.role=role;ctx.step=step;
    const maxSteps=R.values(state,'actions').maxSteps;
    const definitions=typeof tools==='function'?tools(state,role,activeConfig):tools;
    // The model adapter applies capabilities separately for each fallback model.
    const available=step<maxSteps&&toolCount<MAX_TOOL_CALLS?definitions:[];
    await hook('beforeModel');await prepareMessages(activeConfig,ctx.messages);
    const allowEmptyResponse=executedTools>0&&(typeof allowToolOnly==='function'?allowToolOnly():allowToolOnly);
    const result=await modelApi.call(state,{purpose,role,modelId,messages:ctx.messages,tools:available,signal,onUsage,onRetry,prepareMessages,beforeRequest:checkMemory,allowEmptyResponse});
    checkMemory();
    onReply?.();
    assertActive(signal);ctx.result=result;await hook('afterModel');
    activeConfig=result.model;modelId=result.modelId;
    const rawEstimate=estimate(ctx.sentMessages);
    if(result.usage&&(result.usage.inputEstimated===false||result.usage.estimated===false)&&rawEstimate>0){
      mutate(latest=>{if(!latest.roles.some(r=>r.id===roleId))return;R.ensure(latest);const data=latest.engine.data.compression;data.estimates??={};data.estimates[roleId]={ratio:result.usage.inputTokens/rawEstimate,modelId:result.modelId,promptTokens:result.usage.inputTokens,estimatedTokens:rawEstimate,updatedAt:now()};});
    }
    const calls=result.message.tool_calls;
    if(!calls?.length){
      ctx.text=visibleText(result.message,messageIds);if(!ctx.text&&!allowEmptyResponse)S.fail('模型没有返回可见文字',502,'PROVIDER_EMPTY');await hook('beforeDeliver');
      return ctx.text;
    }
    if(!activeConfig.capabilities.includes('tool_use')||!available.length||step>=maxSteps)S.fail('模型在未提供角色动作时仍返回了动作，请检查模型能力配置',502,'PROVIDER_RESPONSE');
    if(toolCount+calls.length>MAX_TOOL_CALLS)S.fail('单轮角色动作超过8次上限',502,'TOOL_LIMIT');
    toolCount+=calls.length;
    const hasAction=calls.some(call=>call.function.name!=='select_message_targets');
    const block=hasAction&&executionId&&targetId?mutate(latest=>H.begin(latest,roleId,targetId,executionId,result.message)).value:null;
    const assistantStep={...result.message,role:'assistant'};ctx.messages.push(assistantStep);
    const seenCalls=new Map();let forgotThisStep=false;
    for(const call of calls){
      assertActive(signal);let outcome;
      try{
        if(forgotThisStep)throw new Error('共同记忆刚已更新，请根据最新上下文重新判断这个动作');
        checkMemory();
        if(!available.some(t=>t.function.name===call.function.name))throw new Error('该动作当前不可用');
        let args;try{args=JSON.parse(call.function.arguments);}catch{throw new Error('动作参数不是有效 JSON');}
        if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('动作参数须为对象');
        const sig=call.function.name+':'+JSON.stringify(args),seq=seenCalls.get(sig)||0;seenCalls.set(sig,seq+1);
        ctx.callId=call.id;ctx.dedupeSeq=seq;
        outcome=await executeTool(call.function.name,args,ctx);
        if(call.function.name==='select_message_targets')for(const target of outcome?.messages||[])messageIds.add(target.messageId.toLowerCase());
        if(outcome?.messageId)messageIds.add(outcome.messageId.toLowerCase());
        if(!['search_stickers','select_message_targets'].includes(call.function.name))executedTools++;
        if(call.function.name==='forget_memory'&&outcome?.forgotten){
          forgotThisStep=true;assistantStep.content=null;
          assistantStep.tool_calls=calls.map(c=>({...c,function:{...c.function,arguments:'{}'}}));
        }
      }catch(error){assertActive(signal);if(error.code==='MEMORY_CHANGED')throw error;outcome={error:error.message};}
      const content=typeof outcome==='string'?outcome:JSON.stringify(outcome);
      if(content.length>MAX_TOOL_RESULT_CHARS)S.fail('角色动作结果超过32768字符上限',502,'TOOL_RESULT_LIMIT');
      const reply={role:'tool',tool_call_id:call.id,content};
      if(block!==null)mutate(latest=>H.result(latest,targetId,block,reply));
      ctx.messages.push(reply);
      if(calls.length===1&&call.function.name==='generate_image'&&outcome?.sentToChat===true){
        ctx.text=visibleText(result.message,messageIds);await hook('beforeDeliver');return ctx.text;
      }
    }
    if(hasAction)step++;
  }
}
function create(options){return {run:input=>run({...options,...input})};}
module.exports={run,create,estimate,system,records,render,rounds,renderHistory,SUMMARY_PROMPT};
