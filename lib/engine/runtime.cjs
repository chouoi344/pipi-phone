// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../state.cjs'),AI=require('../providers.cjs'),P=require('./pipeline.cjs'),R=require('./registry.cjs'),T=require('./time.cjs'),D=require('./delivery.cjs'),J=require('./scheduler.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const E=require('./execution.cjs'),SystemOne=require('./system-one.cjs');
const Memory=require('./modules/memory.cjs');
const {stripMessageNumbers,conversationMessageIds}=require('./response.cjs');
const Outreach=require('./modules/outreach.cjs'),LifeMoments=require('./modules/life-moments.cjs'),Voice=require('./modules/voice.cjs');
const Schedule=require('./modules/schedule.cjs');
const ModelImages=require('./model-images.cjs');

function imageRequest(state,roleId,requestIds){
  const requests=state.messages.filter(m=>m.roleId===roleId&&m.sender==='user'&&requestIds.has(m.id));
  const userText=requests.map(m=>m.type==='text'?m.content:m.type==='voice'?m.meta?.transcript:'').filter(Boolean).join('\n');
  const imageOf=m=>ModelImages.source(m).image;
  const quoted=requests.findLast(m=>m.meta?.quote?.image||ModelImages.expired(m.meta?.quote,'image'))?.meta.quote;
  if(quoted){
    const source=!quoted.unavailable&&state.messages.find(m=>m.roleId===roleId&&m.id===quoted.messageId&&m.meta?.kind!=='recalled');
    const imageExpired=ModelImages.expired(quoted,'image')||ModelImages.expired(source,'image');
    return {userText,userImage:imageExpired?'':imageOf(source)||'',userModelImage:imageExpired?'':ModelImages.source(source).modelImage,imageExpired,sourceMessageId:source?.id||''};
  }
  const message=requests.findLast(m=>imageOf(m)||ModelImages.expired(m,'image')),source=ModelImages.source(message);
  return {userText,userImage:source.image,userModelImage:source.modelImage,imageExpired:ModelImages.expired(message,'image'),sourceMessageId:message?.id||''};
}

const personaChanged='好友人设已更新，请重试以使用当前人设回复';

function create({getState,mutate,publish=()=>{},isInitialized=()=>true,externalBusy=()=>0,demoModel=false,modelApi,dataDir,now=Date.now}){
  const roles=new Map(),tasks=new Set();let stopped=false,ticking=false,active=0;
  const isBusy=roleId=>roles.has(roleId);
  // Last stop for background failures: recording one must never become an unhandled rejection itself.
  function report(error){
    if(stopped)return;
    try{mutate(s=>{s.settings.backgroundStatus={lastError:String(error?.message||error).slice(0,1000),lastAttemptAt:now()};});}
    catch(writeError){console.error('后台任务错误无法记录',writeError);}
  }
  function track(promise){tasks.add(promise);promise.finally(()=>tasks.delete(promise)).catch(report);return promise;}
  function runBackground(job){
    return track(new Promise(resolve=>setImmediate(resolve)).then(async()=>{
      if(stopped||!await isInitialized()||stopped)return;
      return job();
    }));
  }
  function onUsage(record){
    if(stopped)return;
    mutate(s=>require('./usage.cjs').record(s,record,now()));
  }
  function progress(roleId){
    const entry=roles.get(roleId);
    return {roleId,typing:Boolean(entry?.delivering),slow:Boolean(entry?.slow)};
  }
  function publishProgress(roleId){publish('typing',progress(roleId));}
  const typingState=()=>[...roles.keys()].map(progress);
  function chatProgress(roleId){
    const entry=roles.get(roleId);
    return {...progress(roleId),startedAt:entry?.startedAt??null};
  }
  function trackRetry(roleId,entry){
    if(roles.get(roleId)!==entry||entry.retryTimer||entry.slow||entry.protectImageDelivery)return;
    const markSlow=()=>{
      if(roles.get(roleId)!==entry||entry.protectImageDelivery)return;
      entry.slow=true;
      publishProgress(roleId);
    };
    const remaining=30000-(now()-entry.startedAt);
    if(remaining<=0)markSlow();
    else{
      entry.retryTimer=setTimeout(markSlow,remaining);
      entry.retryTimer.unref();
    }
  }
  function clearRetry(roleId,entry){
    clearTimeout(entry.retryTimer);
    delete entry.retryTimer;
    const wasSlow=entry.slow;
    delete entry.slow;
    if(wasSlow&&roles.get(roleId)===entry)publishProgress(roleId);
  }
  function cancelSlowChat(roleId){
    const entry=roles.get(roleId);
    if(!entry?.slow||entry.protectImageDelivery)return false;
    cancel(roleId);
    return true;
  }
  function cancel(roleId,{keepPending=false,reason='回复已取消，请重试'}={}){
    const entry=roles.get(roleId);if(!entry)return;
    clearTimeout(entry.timer);clearTimeout(entry.retryTimer);stopDecision(entry);entry.controller?.abort();roles.delete(roleId);publishProgress(roleId);
    if(!stopped)mutate(s=>{
      if(!keepPending)for(const m of s.messages)if(m.roleId===roleId&&m.sender==='user'&&(m.status==='pending'||reason===personaChanged&&m.id===entry.targetId)){m.status='error';m.error=reason;}
      const job=s.engine.jobs.find(j=>j.id===entry.jobId);if(job?.status==='running')job.status='pending';
      const run=entry.executionId&&E.data(s).runs[entry.executionId];if(run){if(run.status==='running')run.status='interrupted';delete run.resumeDelivery;}
      if(entry.outreach)Outreach.errorRelease(s,roleId,entry.outreach,{now:now()});
    });
  }
  function checkChatPersonas(state){
    for(const [roleId,entry] of roles)if(entry.personaRevision!==undefined&&entry.personaRevision!==(S.role(state,roleId).personaRevision||0))cancel(roleId,{reason:personaChanged});
  }
  function schedule(roleId,entry){
    clearTimeout(entry.timer);
    entry.readyAt=D.readyAt(entry,R.values(getState(),'waiting'));
    entry.timer=setTimeout(()=>track(generate(roleId,entry)),Math.max(0,entry.readyAt-now()));entry.timer.unref();
  }
  function stopDecision(entry){
    clearTimeout(entry?.decisionTimer);
    entry?.decisionController?.abort();
  }
  async function judgeBeforeReply(roleId,entry){
    const isWaiting=()=>!stopped&&roles.get(roleId)===entry&&entry.phase==='waiting'&&now()<entry.readyAt;
    if(!isWaiting())return;
    const s=getState(),w=R.values(s,'waiting');
    const pending=s.messages.filter(m=>m.roleId===roleId&&m.sender==='user'&&m.status==='pending');
    if(!pending.length)return;
    const controller=new AbortController();
    entry.decisionController=controller;
    const text=pending.map(m=>ModelImages.expired(m,'image')?ModelImages.imageText(m):m.type==='image'?'':m.meta?.transcript||m.content||(ModelImages.expired(m,'voice')?'[语音已过期]':'')).filter(Boolean).join('\n');
    const images=pending.map(ModelImages.source).filter(source=>source.image);
    try{
      const outcome=await SystemOne.evaluateCompleteness(s,{
        text,images,threshold:w.sendThreshold,signal:controller.signal,dataDir,
        onUsage:record=>{if(record.success||!controller.signal.aborted)onUsage(record);}
      });
      if(!isWaiting()||outcome.skipped)return;
      if(!outcome.complete){entry.incomplete=true;schedule(roleId,entry);}
      mutate(st=>{R.ensure(st);st.engine.data.waiting.lastDecision={roleId,probability:outcome.probability,complete:outcome.complete,at:now()};});
    }catch(err){
      if(err?.name==='AbortError'||!isWaiting())return;
      mutate(st=>{R.ensure(st);st.engine.data.waiting.lastError={message:String(err?.message||err).slice(0,500),at:now()};});
    }finally{
      delete entry.decisionController;
    }
  }
  function enqueue(roleId,messageId){
    const state=getState(),old=roles.get(roleId),w=R.values(state,'waiting');
    if(old&&(old.protectImageDelivery||(old.phase==='generating'||old.phase==='sending')&&old.kind==='chat'&&!old.outreach&&w.enabled!==false&&w.cancelOnNewMessage===false)){
      old.followUpMessageId=messageId;return;
    }
    clearTimeout(old?.timer);clearTimeout(old?.retryTimer);stopDecision(old);old?.controller?.abort();
    if(old?.outreach)mutate(s=>Outreach.errorRelease(s,roleId,old.outreach,{now:now()}));
    if(old?.executionId)mutate(s=>{const run=E.data(s).runs[old.executionId];if(run){if(run.status==='running')run.status='interrupted';delete run.resumeDelivery;}});
    if(old?.jobId)mutate(s=>{
      const job=s.engine.jobs.find(j=>j.id===old.jobId);
      if(job?.status!=='running')return;
      const run=E.data(s).runs[old.executionId];
      if(run?.delivered>0){J.finish(s,job.id,{now:now()});run.status='completed';}
      else job.status='pending';
    });
    if(old?.activity)mutate(s=>Aut.finish(s,roleId,old.activity.entryId,{now:now(),error:'用户开始聊天，活动已停止',acted:E.data(s).actions.some(a=>a.runId===old.executionId&&a.status==='completed'&&a.name!=='search_stickers')}));
    const at=now();
    const firstMessageAt=['waiting','queued'].includes(old?.phase)?old.firstMessageAt??at:at;
    const entry={phase:'waiting',firstMessageAt,lastMessageAt:at,lastTypingAt:at,hasActiveDraft:false,targetId:messageId,jobId:undefined,instruction:'',kind:'chat',executionId:old?.kind==='chat'?old.executionId:undefined};
    const resume=Object.values(E.data(getState()).runs).findLast(r=>r.kind==='chat'&&!r.jobId&&r.roleId===roleId&&r.targetId===messageId&&r.resumeDelivery);
    if(resume){entry.resumeDelivery=true;entry.executionId=resume.id;}
    roles.set(roleId,entry);publishProgress(roleId);schedule(roleId,entry);
    if(!entry.resumeDelivery&&w.enabled&&w.mode==='cloud'&&state.settings?.ai?.assign?.decision&&w.idleSeconds>0){
      // Give quick consecutive sends time to join before calling the judge.
      const delayMs=Math.min(150,w.idleSeconds*250);
      entry.decisionTimer=setTimeout(()=>track(judgeBeforeReply(roleId,entry)),delayMs);
      entry.decisionTimer.unref();
    }
  }
  function userTyping(roleId){
    const entry=roles.get(roleId);if(entry?.phase!=='waiting')return;
    entry.lastTypingAt=now();entry.hasActiveDraft=true;schedule(roleId,entry);
  }
  function userStoppedTyping(roleId){
    const entry=roles.get(roleId);if(entry?.phase!=='waiting')return;
    entry.hasActiveDraft=false;entry.lastTypingAt=entry.lastMessageAt;schedule(roleId,entry);
  }
  function pendingIds(roleId){return getState().messages.filter(m=>m.roleId===roleId&&m.sender==='user'&&m.status==='pending').map(m=>m.id);}
  function flushDeferredActions(s,roleId,executionId,at,imagesOnly=false){
    const run=E.data(s).runs[executionId],queued=run?.pendingActionMessages;
    if(!queued?.length)return 0;
    const r=S.role(s,roleId);S.chatAllowed(r);
    const actions=R.values(s,'actions');
    const retained=[];let delivered=0;
    for(const msg of queued){
      if(!Memory.readStampValid(s,roleId,run.pendingMemoryReads?.[msg.id],dataDir)){
        delete run.pendingMemoryReads[msg.id];continue;
      }
      if(imagesOnly&&(msg.type!=='image'||msg.meta?.stickerId)){retained.push(msg);continue;}
      if(run.pendingMemoryReads)delete run.pendingMemoryReads[msg.id];
      if(msg.type==='voice'&&!Voice.canSend(s,r)){
        msg.type='text';msg.meta={degradedFromVoice:true};
      }
      if(msg.type==='image'&&(msg.meta?.stickerId?!actions.allowStickers:!actions.allowImages))continue;
      if(msg.meta?.kind==='pat'&&!actions.allowPat||msg.meta?.quote&&!actions.allowQuote)continue;
      const quote=msg.meta?.quote;
      if(quote?.messageId){
        const source=s.messages.find(m=>m.roleId===roleId&&m.id===quote.messageId);
        if(!source||source.meta?.kind==='recalled'){
          delete quote.messageId;
          quote.unavailable=source?'recalled':'deleted';
        }
      }
      msg.createdAt=Math.max(msg.createdAt||0,at);
      s.messages.push(msg);r.lastActiveAt=at;r.hidden=false;
      if(msg.sender==='assistant'||msg.meta?.kind==='pat'){r.unread=Math.min(100000,r.unread+1);delivered++;}
    }
    run.pendingActionMessages=retained;
    return delivered;
  }
  async function generate(roleId,entry){
    if(stopped||roles.get(roleId)!==entry)return;
    if(entry.phase==='waiting'){
      stopDecision(entry);entry.phase='queued';
    }
    if(entry.phase!=='queued')return;
    if(active+externalBusy()>=8){entry.timer=setTimeout(()=>track(generate(roleId,entry)),250);entry.timer.unref();return;}
    active++;entry.phase='generating';entry.controller=new AbortController();entry.startedAt=now();
    const signal=entry.controller.signal,snapshot=getState(),ids=snapshot.messages.filter(m=>m.roleId===roleId&&m.sender==='user'&&m.status==='pending'&&(!entry.resumeDelivery||m.id===entry.targetId)).map(m=>m.id);
    const priorMessages=new Set(snapshot.messages.map(m=>m.id));
    const liveChat=entry.kind==='chat'&&entry.targetId&&!entry.outreach&&!entry.jobId;
    if(liveChat)entry.personaRevision=S.role(snapshot,roleId).personaRevision||0;
    const checkPersona=state=>{
      if(liveChat&&entry.personaRevision!==(S.role(state,roleId).personaRevision||0))throw new Error(personaChanged);
      return state;
    };
    const readChat=liveChat?()=>checkPersona(getState()):getState;
    const writeChat=liveChat?fn=>mutate(s=>fn(checkPersona(s))):mutate;
    function setDelivering(value){
      if(roles.get(roleId)!==entry||Boolean(entry.delivering)===value)return;
      entry.delivering=value;publishProgress(roleId);
    }
    let memoryRead=null;
    const writeFromModel=fn=>writeChat(s=>{
      Memory.assertReadStamp(s,roleId,memoryRead,dataDir);
      const run=E.data(s).runs[entry.executionId],prior=run?.pendingActionMessages?.length||0;
      const result=fn(s);
      if(run)run.memoryRead=memoryRead;
      if(memoryRead&&run?.pendingActionMessages?.length>prior){
        run.pendingMemoryReads??={};
        for(const msg of run.pendingActionMessages.slice(prior))run.pendingMemoryReads[msg.id]=memoryRead;
      }
      return result;
    });
    // A ready photo or tool-only reply can go straight to chat, with no segment delay.
    // Keep the title idle while the tool is still working or only updates its own data.
    function deliverNow(write,fn){
      try{
        return write(s=>{
          const before=s.messages.length,result=fn(s);
          if(s.messages.length>before)setDelivering(true);
          return result;
        });
      }finally{setDelivering(false);}
    }
    const writeImmediatePhoto=fn=>deliverNow(writeFromModel,fn);
    const validateContact=()=>{
      if(memoryRead)Memory.assertReadStamp(getState(),roleId,memoryRead,dataDir);
      if(liveChat)readChat();
      if(entry.outreach&&!Outreach.validate(getState(),roleId,entry.outreach,now()))throw Object.assign(new Error('本次联系机会已失效'),{name:'AbortError'});
      if(entry.kind==='moment')LifeMoments.eligible(getState(),roleId);
      if(entry.jobId){
        const s=getState(),job=s.engine.jobs.find(j=>j.id===entry.jobId);
        const recipient=s.roles.find(r=>r.id===roleId),at=now();
        if(job?.status!=='running'||!recipient||recipient.deleted||recipient.permissions?.blocked||!job.userRequested&&J.globalQuietEnd(s,at)>at)throw Object.assign(new Error('提醒暂时无法发送'),{name:'AbortError'});
      }
    };
    const commitContact=()=>{if(entry.outreach)mutate(s=>{const sent=s.messages.filter(m=>m.roleId===roleId&&!priorMessages.has(m.id)&&(m.sender==='assistant'||m.meta?.kind==='pat'));Outreach.commit(s,roleId,entry.outreach,{now:now(),delivered:sent.length>0,text:sent.filter(m=>m.type!=='image').map(m=>m.meta?.transcript||m.content).join('\n'),photoCount:sent.filter(m=>m.type==='image'&&!m.meta?.stickerId).length});});};
    // Retrying an older failed bubble must still include newer pending messages.
    const targetId=entry.resumeDelivery?entry.targetId:snapshot.messages.filter(m=>m.roleId===roleId&&(m.id===entry.targetId||ids.includes(m.id))).at(-1)?.id;
    try{
      validateContact();
      for(const id of ids){
        const s=getState(),m=S.find(s.messages,id);S.chatAllowed(S.role(s,roleId));
        if(m.type==='voice'&&!ModelImages.expired(m,'voice')&&!m.meta?.transcript?.trim()){
          const understanding=await AI.understandVoice(s,m.meta.audio,{signal,onUsage,dataDir});
          const transcript=understanding.text.trim();
          signal.throwIfAborted();if(!transcript)S.fail('语音未识别出文字，请重试',502,'PROVIDER_RESPONSE');
          mutate(latest=>{const current=S.find(latest.messages,id);current.meta={...current.meta,transcript,contentEmotion:understanding.contentEmotion,voiceEmotion:understanding.voiceEmotion,transcriptSource:demoModel?'demo':'provider'};current.content=transcript;});
        }
      }
      const job=entry.jobId&&snapshot.engine.jobs.find(j=>j.id===entry.jobId);
      const previous=targetId&&Object.values(E.data(snapshot).runs).findLast(r=>r.roleId===roleId&&r.targetId===targetId&&r.kind===entry.kind);
      entry.executionId??=job?`job:${job.id}:${job.nextAt}`:previous?.id||`${entry.kind}:${roleId}:${targetId||S.id()}`;
      const run=mutate(s=>{
        checkPersona(s);
        const run=E.start(s,{id:entry.executionId,roleId,kind:entry.kind,jobId:entry.jobId,now:now()});
        if(liveChat){
          if((run.personaRevision||0)!==entry.personaRevision){
            delete run.answer;delete run.segments;delete run.pendingActionMessages;delete run.pendingMemoryReads;delete run.memoryRead;delete run.resumeDelivery;run.delivered=0;
          }
          run.personaRevision=entry.personaRevision;
        }
        if(run.targetId!==targetId){delete run.answer;delete run.segments;delete run.memoryRead;run.delivered=0;delete run.resumeDelivery;run.targetId=targetId;}
        // Older interrupted replies have no record of the facts the model read.
        if(!Object.hasOwn(run,'memoryRead')&&(run.answer!==undefined||run.pendingActionMessages?.length)&&
          (!R.isEnabled(s,'memory')||s.engine?.data?.memory?.readRevision||Memory.listMergedCards(s,roleId,{dataDir,status:'archived',limit:1}).length)){
          delete run.answer;delete run.segments;delete run.pendingActionMessages;delete run.pendingMemoryReads;delete run.resumeDelivery;run.delivered=0;
        }
        run.status='running';return structuredClone(run);
      }).value;
      const deferChatActions=entry.kind!=='moment';
      const liveRequestIds=liveChat?new Set([...ids,targetId]):null;
      let photoWait='',imageFailed=false;
      const beforeImageGeneration=waitingText=>{
        if(!liveChat||photoWait)return false;
        signal.throwIfAborted();
        entry.protectImageDelivery=true;
        const text=D.photoWaitingText(waitingText,conversationMessageIds(getState().messages,roleId));
        writeImmediatePhoto(s=>{
          const r=S.role(s,roleId);S.chatAllowed(r);
          S.message(s,r,'assistant',text);
          r.unread=Math.min(100000,r.unread+1);
        });
        photoWait=text;
        return true;
      };
      const allowedTools=(s,r,c)=>{
        const definitions=R.tools(s,r,c);
        if(entry.kind==='moment'||imageFailed)return [];
        if(entry.outreach){
          const cfg=Outreach.effectiveSettings(s,roleId,require('./modules/schedule.cjs').currentState(s,roleId,now())),names=['search_stickers','send_sticker','pat_user','reply_quote'];
          if(cfg.voiceEnabled)names.push('send_voice');
          if(cfg.photoEnabled&&Outreach.remainingPhotos(s,roleId,now())>0)names.push('send_selfie','send_image');
          return require('./actions.cjs').withMessageTargets(definitions.filter(t=>names.includes(t.function.name)));
        }
        return definitions;
      };
      const perform=(name,args,ctx)=>{
        validateContact();
        if(entry.outreach&&['send_selfie','send_image'].includes(name)){
          const state=getState(),queued=(E.data(state).runs[entry.executionId]?.pendingActionMessages||[]).filter(m=>m.type==='image'&&!m.meta?.stickerId).length;
          const remaining=Outreach.remainingPhotos(state,roleId,now())-queued;
          if(remaining<=0)S.fail('本轮主动照片额度已用完');
          if(name==='send_selfie')args={...args,count:Math.min(args.count||1,remaining)};
        }
        return R.executeTool(name,args,ctx);
      };
      const executeTool=async(name,args,ctx)=>{
        const isImage=name==='generate_image'||name==='send_selfie'&&args.action!=='resend';
        const sendsChatImage=liveChat&&(['send_selfie','send_image'].includes(name)||name==='generate_image'&&args.sendToChat===true);
        const photoInput=liveRequestIds&&(name==='generate_image'||name==='send_selfie')?imageRequest(getState(),roleId,liveRequestIds):undefined;
        const actionContext={...ctx,dataDir,executionId:entry.executionId,demoModel,deferChatActions:deferChatActions&&!sendsChatImage,allowDirectImageDelivery:Boolean(liveChat),imageRequest:photoInput,liveRequestIds,beforeImageGeneration,mutateFromModel:sendsChatImage?writeImmediatePhoto:writeFromModel,mutatePhotoProgress:liveChat?writeImmediatePhoto:undefined};
        try{
          if(name==='select_message_targets'){
            const state=readChat();
            if(!allowedTools(state,S.role(state,roleId),ctx).some(t=>t.function.name===args.action))S.fail('本轮不可查询这个动作的消息');
            return await perform(name,args,actionContext);
          }
          if(isImage&&imageFailed)return {ok:false,error:'本轮拍摄已结束。'};
          return await E.execute(name,args,actionContext,perform);
        }catch(error){
          signal.throwIfAborted();
          if(error.code==='MEMORY_CHANGED')throw error;
          if(!isImage||!entry.protectImageDelivery)throw error;
          imageFailed=true;
          return {ok:false,error:'这次有照片没拍成。接下来按你自己的人设，用一句自然的生活化消息告诉对方。不要说已发出失败的照片，不要提到模型、接口、工具或技术原因，也不要再次拍摄。'};
        }
      };
      let rawAnswer=run.answer;
      let resumedIds;
      if(rawAnswer!==undefined){
        memoryRead=run.memoryRead;validateContact();
        resumedIds=conversationMessageIds(getState().messages,roleId);
        for(const m of run.pendingActionMessages||[])resumedIds.add(m.id.toLowerCase());
        rawAnswer=stripMessageNumbers(rawAnswer,resumedIds);
      }
      let isModelReply=true;
      if(rawAnswer===undefined){
        try{
          rawAnswer=await P.run({getState:readChat,mutate:writeChat,roleId,targetId,executionId:entry.executionId,instruction:(entry.instruction||'')+E.recoveryNote(getState(),entry.executionId),signal,onUsage,modelApi,dataDir,now,tools:allowedTools,onMemoryRead:stamp=>{memoryRead=stamp;},allowToolOnly:()=>!imageFailed,onRetry:liveChat?()=>trackRetry(roleId,entry):undefined,onReply:liveChat?()=>clearRetry(roleId,entry):undefined,executeTool});
        }catch(error){
          signal.throwIfAborted();
          if(!imageFailed||error.name==='AbortError')throw error;
          isModelReply=false;
          rawAnswer='刚才没拍成，改天我再补给你。';
        }
      }
      const skip=rawAnswer.trim()==='[NO_ACTION]';
      if(entry.outreach&&!entry.allowNoAction&&skip)S.fail('自定义联系已到时间，模型未给出可发送的消息',502,'PROVIDER_RESPONSE');
      const answer=(entry.allowNoAction||entry.jobId)&&skip?'':liveChat?D.withoutPhotoPlaceholders(rawAnswer):rawAnswer;
      signal.throwIfAborted();entry.phase='sending';
      validateContact();
      const settings=R.values(getState(),'segments');
      settings.enabled=settings.enabled&&(isModelReply||!settings.onlyLlmResult);
      let segments=run.segments
        ?[...run.segments.slice(0,run.delivered),...run.segments.slice(run.delivered).map(s=>stripMessageNumbers(s,resumedIds).trim()).filter(Boolean)]
        :D.split(answer,settings);
      if(deferChatActions&&!run.segments){
        if(photoWait)segments=segments.filter(segment=>segment.replace(/[。！？!?]+$/u,'')!==photoWait.replace(/[。！？!?]+$/u,''));
        const queuedVoices=(E.data(getState()).runs[entry.executionId]?.pendingActionMessages||[]).filter(m=>m.type==='voice'||m.meta?.degradedFromVoice).map(m=>m.content);
        if(queuedVoices.length&&segments.length){
          const spoken=new Set(queuedVoices.flatMap(text=>[text.trim(),...D.split(text,settings)]));
          segments=segments.filter(segment=>!spoken.has(segment));
        }
      }
      writeFromModel(s=>Object.assign(E.data(s).runs[entry.executionId],{answer,segments,memoryRead,updatedAt:now()}));
      mutate(s=>{for(const m of s.messages)if(ids.includes(m.id)){m.status='sent';delete m.error;}});
      if(entry.kind==='moment'&&run.delivered===0&&answer.trim()){
        mutate(s=>{LifeMoments.eligible(s,roleId);s.moments.push({id:S.id(),authorId:roleId,content:LifeMoments.publicText(answer,10000),image:'',images:[],location:'',mentions:[],visibility:'all',likes:[],comments:[],createdAt:now()});E.data(s).runs[entry.executionId].delivered=1;});
        await R.hooks('afterDeliver',{getState,mutate,roleId,text:answer,kind:'moment',signal,onUsage,dataDir,demoModel,isInitialized,runBackground});
      }else if(deferChatActions){
        if(liveChat&&(E.data(getState()).runs[entry.executionId]?.pendingActionMessages||[]).some(m=>m.type==='image'&&!m.meta?.stickerId)){
          deliverNow(mutate,s=>flushDeferredActions(s,roleId,entry.executionId,now(),true));
        }
        if(!segments.length){
          deliverNow(mutate,s=>{
            const sent=flushDeferredActions(s,roleId,entry.executionId,now());
            if(entry.jobId&&sent)E.data(s).runs[entry.executionId].delivered=sent;
          });
          commitContact();
          if((E.data(getState()).runs[entry.executionId]?.pendingActionMessages||[]).length===0){
            await R.hooks('afterDeliver',{getState,mutate,roleId,text:'',kind:entry.kind,finalTurn:true,signal,onUsage,dataDir,demoModel,isInitialized,runBackground});
          }else{
            await R.hooks('afterDeliver',{getState,mutate,roleId,text:answer,kind:entry.kind,finalTurn:true,signal,onUsage,dataDir,demoModel,isInitialized,runBackground});
          }
        }else{
          for(let i=run.delivered;i<segments.length;i++){
            setDelivering(true);
            if(settings.enabled)await delay(D.delay(segments[i],settings),undefined,{signal});
            signal.throwIfAborted();
            validateContact();
            const isLast=i===segments.length-1;
            mutate(s=>{
              const r=S.role(s,roleId);S.chatAllowed(r);
              S.message(s,r,'assistant',segments[i]);r.unread=Math.min(100000,r.unread+1);
              E.data(s).runs[entry.executionId].delivered=i+1;
              if(isLast)flushDeferredActions(s,roleId,entry.executionId,now());
            });
            if(isLast)setDelivering(false);
            commitContact();
            await R.hooks('afterDeliver',{getState,mutate,roleId,text:segments[i],finalTurn:isLast,signal,onUsage,dataDir,demoModel,isInitialized,runBackground});
          }
        }
      }else{
        deliverNow(mutate,s=>flushDeferredActions(s,roleId,entry.executionId,now()));
        commitContact();
      }
      if(skip&&entry.outreach){validateContact();mutate(s=>Outreach.commit(s,roleId,entry.outreach,{now:now(),skipped:true}));}
      mutate(s=>{
        const run=E.data(s).runs[entry.executionId],error=entry.jobId&&!run.delivered?'没有发送提醒消息':'';
        run.status=error?'failed':'completed';run.updatedAt=now();delete run.error;delete run.resumeDelivery;
        if(error)run.error=error;
        if(entry.jobId)J.finish(s,entry.jobId,{now:now(),error});
      });
    }catch(error){
      entry.contactError=error.name==='AbortError'?'':error.message;
      if(signal.aborted||stopped)return;
      if(error.code==='MEMORY_CHANGED'&&entry.executionId)mutate(s=>{
        const run=E.data(s).runs[entry.executionId];if(!run)return;
        delete run.answer;delete run.segments;delete run.memoryRead;delete run.pendingActionMessages;delete run.pendingMemoryReads;delete run.resumeDelivery;
        run.delivered=0;
      });
      if(entry.outreach&&error.name==='AbortError'){
        if(entry.executionId)mutate(s=>{const run=E.data(s).runs[entry.executionId];if(run){run.status='interrupted';run.error=error.message;run.updatedAt=now();}});
        return;
      }
      if(entry.jobId&&error.name==='AbortError'){
        mutate(s=>{
          const job=s.engine.jobs.find(j=>j.id===entry.jobId);
          const run=entry.executionId&&E.data(s).runs[entry.executionId];
          if(run?.delivered>0){J.finish(s,entry.jobId,{now:now()});run.status='completed';}
          else{
            if(job?.status==='running')job.status='pending';
            if(run)run.status='interrupted';
          }
          if(run)run.updatedAt=now();
        });
        return;
      }
      if(entry.executionId)mutate(s=>{const run=E.data(s).runs[entry.executionId];if(run){
        run.status='failed';run.error=String(error.message).slice(0,1000);run.updatedAt=now();
      }});
      if(ids.length)mutate(s=>{for(const m of s.messages)if(ids.includes(m.id)&&m.sender==='user'&&['pending','sent'].includes(m.status)){m.status='error';m.error=String(error.message).slice(0,1000);}});
      if(entry.jobId)mutate(s=>J.finish(s,entry.jobId,{now:now(),error:error.message}));
      if(!ids.length)report(error);
    }finally{
      clearTimeout(entry.retryTimer);
      if(entry.outreach&&!stopped)mutate(s=>Outreach.errorRelease(s,roleId,entry.outreach,{now:now(),error:entry.contactError||''}));
      active--;
      if(roles.get(roleId)===entry){
        roles.delete(roleId);
        if(entry.delivering||entry.slow)publishProgress(roleId);
        if(!stopped&&(entry.followUpMessageId||entry.resumeDelivery)){
          const next=pendingIds(roleId);
          if(next.length)enqueue(roleId,next.at(-1));
        }
      }
    }
  }
  function initiate(roleId,{instruction,kind='chat',jobId,outreach,allowNoAction=false}){
    if(isBusy(roleId))return false;
    const entry={phase:'waiting',lastMessageAt:now(),lastTypingAt:now(),instruction,kind,jobId,outreach,allowNoAction};roles.set(roleId,entry);track(generate(roleId,entry));return true;
  }
  function cancelJob(id){for(const [roleId,entry]of [...roles])if(entry.jobId===id){cancel(roleId,{keepPending:true});const pending=pendingIds(roleId);if(pending.length)enqueue(roleId,pending.at(-1));}}
  function tick(){
    if(stopped)return Promise.resolve();
    return track((async()=>{
      const initialized=await isInitialized();
      if(stopped||!initialized)return;
      const s=getState(),at=now();
      const context={getState,mutate,isBusy,initiate,now:at,clock:now,dataDir,demoModel,onUsage,modelApi};
      for(const [roleId,entry] of roles)if(entry.outreach&&J.explicitDue(s,roleId,at))cancel(roleId,{keepPending:true});
      if(R.isEnabled(s,'scheduler'))for(const job of R.get('scheduler').jobs)job.run(context);
      if(ticking)return;
      ticking=true;
      try{await R.runJobs(context,{skip:'scheduler'});}
      finally{ticking=false;}
    })());
  }
  const timer=setInterval(tick,1000);timer.unref();
  return {enqueue,userTyping,userStoppedTyping,cancel,cancelJob,checkChatPersonas,isBusy,typingState,chatProgress,cancelSlowChat,onUsage,tick,initiate,get active(){return active;},get backgroundBusy(){return ticking||tasks.size>0||Schedule.backgroundBusy(getState);},async close(){stopped=true;clearInterval(timer);for(const key of roles.keys())cancel(key);await Promise.allSettled([Schedule.close(getState),...tasks]);}};
}
function usage(state){
  const result=new Map(),cutoff=Date.now()-90*86400000;
  for(const row of state.engine.usage||[]){
    if(row.at<cutoff)continue;
    const date=T.dayKey(row.at,state.settings.timezone||'UTC'),key=[date,row.modelId,row.purpose].join(':');
    if(!result.has(key))result.set(key,{date,modelId:row.modelId,model:row.model,purpose:row.purpose,count:0,inputTokens:0,outputTokens:0,failures:0});
    const aggregate=result.get(key);aggregate.count++;aggregate.inputTokens+=row.inputTokens;aggregate.outputTokens+=row.outputTokens;if(!row.success)aggregate.failures++;
  }
  return [...result.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
module.exports={create,usage};
