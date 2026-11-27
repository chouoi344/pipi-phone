// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  function create({request,getEpoch=()=>0,paged=false,pageSize=60,budget=3000}) {
    const pages=paged?(typeof module==='object'?require('./message-pages.js'):globalThis.PipiMessagePages).create({pageSize,budget}):null;
    const coverage={'X-Pipi-Message-Coverage':'pages'},pageUpdates=new WeakMap();
    let count=null;
    let snapshot=null,cursor='',cursorRevision=-1,serverEpoch='',generation=0,resetVersion=0,tail=Promise.resolve();
    const epochReplacements=new WeakSet();
    const controllers=new Set();
    const stale=()=>Object.assign(new Error('登录状态已变化，请重新操作'),{stale:true});
    function interrupt(){generation++;for(const controller of controllers)controller.abort();controllers.clear();tail=Promise.resolve();}
    function reset(){resetVersion++;interrupt();pages?.clear();pages?.setActive(null);count=null;snapshot=null;cursor='';cursorRevision=-1;serverEpoch='';}
    function observe(next){if(!pages&&next&&Array.isArray(next.messages)&&(!snapshot||next.revision>=snapshot.revision))snapshot=next;}
    function replaces(next){return next===snapshot&&epochReplacements.has(next);}
    function headers(){
      if(pages)return {...coverage,'X-Pipi-State-Mode':'delta',...(cursor&&snapshot?{'X-Pipi-Sync-Cursor':cursor}:{})};
      return cursor&&snapshot?{'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':cursor}:{};
    }
    function enqueue(work,retryInterrupted=false){
      const ownGeneration=generation,ownEpoch=getEpoch(),ownReset=resetVersion;
      const active=()=>{if(ownGeneration!==generation||ownEpoch!==getEpoch())throw stale();};
      const controller=new AbortController();
      const fetch=async path=>{active();const result=await request(path,{signal:controller.signal,...(pages?{headers:coverage}:{})});active();return result;};
      fetch.assertActive=active;
      const task=tail.then(async()=>{active();controllers.add(controller);try{const result=await work(fetch,active);active();return result;}finally{controllers.delete(controller);}});
      // The returned task reports failures; this continuation lets the next refresh recover.
      tail=task.catch(()=>{});return retryInterrupted?task.catch(error=>{if(ownReset===resetVersion&&ownEpoch===getEpoch()&&ownGeneration!==generation)return enqueue(work,true);throw error;}):task;
    }
    function envelope(value){
      if(!value||value.schema!==1||!['reset','delta'].includes(value.mode)||typeof value.epoch!=='string'||!value.epoch||typeof value.cursor!=='string'||!value.cursor||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('服务器同步协议无效，请刷新页面重试');
      if(value.mode==='delta'){
        const changes=value.changes;
        if(!Number.isSafeInteger(value.fromRevision)||value.fromRevision<0||!changes||!Array.isArray(changes.upsertMessages)||!Array.isArray(changes.deleteMessageIds)||!changes.replace||typeof changes.replace!=='object'||Array.isArray(changes.replace)||Object.hasOwn(changes.replace,'messages')||Object.hasOwn(changes.replace,'revision')||changes.upsertMessages.some(message=>!message||typeof message.id!=='string')||changes.deleteMessageIds.some(id=>typeof id!=='string'))throw new Error('服务器增量数据无效，请刷新页面重试');
      }
      return value;
    }
    function apply(delta){
      let messages=snapshot.messages;
      if(delta.changes.deleteMessageIds.length||delta.changes.upsertMessages.length){
        const deleted=new Set(delta.changes.deleteMessageIds),upserts=new Map(delta.changes.upsertMessages.map(message=>[message.id,message]));
        messages=[];
        for(const message of snapshot.messages){
          if(deleted.has(message.id))continue;
          messages.push(upserts.get(message.id)||message);upserts.delete(message.id);
        }
        messages.push(...upserts.values());
      }
      snapshot={...snapshot,...delta.changes.replace,messages,revision:delta.revision};
      cursor=delta.cursor;cursorRevision=delta.revision;serverEpoch=delta.epoch;
      return snapshot;
    }
    function sameRevision(page,envelope){return page.epoch===envelope.epoch&&page.revision===envelope.revision;}
    function mark(state,history,fresh=[],upserts=[],deletedIds=[],reset=false){
      pageUpdates.set(state,{history,fresh,upserts,deletedIds,reset});
      return state;
    }
    function promote(envelope){
      cursor=envelope.cursor;cursorRevision=envelope.revision;serverEpoch=envelope.epoch;
      count=Number.isSafeInteger(envelope.messageCount)?envelope.messageCount:null;
    }
    function tooBusy(){return new Error('聊天记录正在变动，请稍后重试');}
    async function resetPages(fetch,initial,attempt=0){
      if(attempt>3)throw tooBusy();
      const start=envelope(initial||await fetch('/api/sync'));
      if(start.mode!=='reset'||start.messageCoverage!=='heads'||!Array.isArray(start.state?.messages))throw new Error('服务器没有返回会话列表');
      if(start.epoch===serverEpoch&&snapshot&&start.revision<snapshot.revision){
        if(initial)return resetPages(fetch,null,attempt+1);
        throw new Error('同步数据已落后于当前页面，请重试');
      }
      const id=pages.active;
      let page=null;
      if(id&&start.state.roles?.some(role=>role.id===id)){
        page=await pages.read(fetch,id);
        if(!sameRevision(page,start))return resetPages(fetch,null,attempt+1);
      }
      fetch.assertActive();
      pages.heads(start.state.messages);if(page)pages.latest(id,page);
      snapshot=mark({...start.state,messages:pages.flatten(id),revision:start.revision},true,[],[],[],true);
      epochReplacements.add(snapshot);promote(start);return snapshot;
    }
    async function applyPages(fetch,delta,attempt=0){
      if(attempt>3)throw tooBusy();
      const changes=delta.changes,tails=new Map(),removed=new Set(changes.deleteMessageIds);
      for(const id of pages.needed(changes)){
        let response;
        try{response=await pages.readTail(fetch,id,removed);}
        catch(error){if(error.code==='MESSAGE_ANCHOR_GONE'||error.status===404)return refreshNow(fetch,attempt+1);throw error;}
        if(!sameRevision(response,delta))return refreshNow(fetch,attempt+1);
        tails.set(id,response);
      }
      fetch.assertActive();
      let messages=snapshot.messages,fresh=[];
      if(changes.upsertMessages.length||changes.deleteMessageIds.length||changes.replace.roles){
        fresh=pages.merge(changes,tails);messages=pages.flatten(pages.active);
      }
      snapshot=mark({...snapshot,...changes.replace,messages,revision:delta.revision},false,fresh,changes.upsertMessages,changes.deleteMessageIds);
      promote(delta);return snapshot;
    }
    async function bootstrap(fetch,initial){
      if(pages)return resetPages(fetch,initial);
      // Reset messages are only heads. They must never replace the complete local history.
      const start=envelope(initial||await fetch('/api/sync'));
      if(start.mode!=='reset')throw new Error('服务器没有返回完整同步起点，请刷新页面重试');
      const full=await fetch('/api/state'),state=full.state||full;
      if(!Array.isArray(state.messages)||!Number.isSafeInteger(state.revision))throw new Error('服务器没有返回完整聊天记录');
      const delta=envelope(await fetch('/api/sync?cursor='+encodeURIComponent(start.cursor)));
      if(delta.mode!=='delta'||delta.epoch!==start.epoch||delta.fromRevision!==start.revision||delta.revision<state.revision)throw new Error('同步期间服务器状态已改变，请重试');
      if(start.epoch===serverEpoch&&snapshot&&delta.revision<snapshot.revision)throw new Error('同步数据已落后于当前页面，请重试');
      const changedEpoch=serverEpoch&&start.epoch!==serverEpoch;
      snapshot=state;const next=apply(delta);if(changedEpoch)epochReplacements.add(next);return next;
    }
    async function refreshNow(fetch,attempt=0){
      if(!cursor||!snapshot)return bootstrap(fetch);
      const delta=envelope(await fetch('/api/sync?cursor='+encodeURIComponent(cursor)));
      if(delta.mode==='reset')return bootstrap(fetch,delta);
      if(delta.epoch!==serverEpoch||delta.fromRevision!==cursorRevision||delta.revision<snapshot.revision)throw new Error('服务器同步起点不一致，请刷新页面重试');
      return pages?applyPages(fetch,delta,attempt):apply(delta);
    }
    function refresh(visibleRevision=snapshot?.revision){return enqueue(async fetch=>{const state=await refreshNow(fetch);return {state,revision:state.revision,unchanged:visibleRevision===state.revision&&!replaces(state)};});}
    function accept(result){
      // Legacy JSON exports contain the entire archive, including records outside the browser cache.
      if(result.format==='pipi-phone')return Promise.resolve(result);
      if(pages&&!result.sync&&result.state)return enqueue(async fetch=>({...result,state:await refreshNow(fetch)}),true);
      if(!result.sync)return result.state?enqueue(async()=>{observe(result.state);return result;},true):Promise.resolve(result);
      return enqueue(async fetch=>{
        const delta=envelope(result.sync);
        if(delta.mode==='reset')await bootstrap(fetch,pages&&cursor&&delta.epoch!==serverEpoch?null:delta);
        else if(!cursor||!snapshot||delta.epoch!==serverEpoch)await refreshNow(fetch);
        else if(delta.revision<cursorRevision||delta.revision<snapshot.revision)await refreshNow(fetch);
        else if(delta.fromRevision!==cursorRevision)await refreshNow(fetch);
        else if(pages)await applyPages(fetch,delta);
        else apply(delta);
        const {sync,...rest}=result;return {...rest,state:snapshot};
      },true);
    }
    function resume(visibleRevision=snapshot?.revision){interrupt();return refresh(visibleRevision);}
    function loadPage(kind,id,messageId){
      return enqueue(async fetch=>{
        if(!snapshot||!cursor)await refreshNow(fetch);
        for(let attempt=0;attempt<4;attempt++){
          const info=pages.info(id),revision={epoch:serverEpoch,revision:cursorRevision};
          if(kind==='enter'&&info.loaded||kind==='older'&&info.loaded&&!info.hasMore||kind==='around'&&pages.rows(id).some(m=>m.id===messageId))return mark({...snapshot},true);
          let target=null,page;
          try{
            if(kind==='around'){
              const found=pages.valid(await fetch('/api/messages/by-id?roleId='+encodeURIComponent(id)+'&ids='+encodeURIComponent(messageId)),id);
              if(!sameRevision(found,revision)){await refreshNow(fetch);continue;}
              target=found.messages.find(m=>m.id===messageId);if(!target)throw Object.assign(new Error('这条消息已删除'),{code:'MESSAGE_NOT_FOUND'});
            }
            page=await pages.read(fetch,id,target?.id||(kind==='older'&&info.loaded?info.firstId:''));
          }catch(error){
            if(error.code!=='MESSAGE_ANCHOR_GONE')throw error;
            await refreshNow(fetch);continue;
          }
          if(!sameRevision(page,revision)){await refreshNow(fetch);continue;}
          fetch.assertActive();
          if(target)pages.around(id,page,target);
          else if(kind==='older'&&info.loaded)pages.prepend(id,page);
          else pages.latest(id,page);
          snapshot=mark({...snapshot,messages:pages.flatten(id,kind)},true);
          return snapshot;
        }
        throw tooBusy();
      });
    }
    const paging=pages?{
      enter:id=>loadPage('enter',id),older:id=>loadPage('older',id),around:(id,messageId)=>loadPage('around',id,messageId),
      latest:id=>loadPage('latest',id),info:pages.info,rows:pages.rows,setActive:pages.setActive,totalCount:()=>count,
      delta:state=>pageUpdates.get(state)||null
    }:null;
    return {reset,observe,replaces,headers,refresh,accept,resume,paging};
  }
  let sessionScope='';
  const api={create,client:null,configure(status,options){
    const enabled=status.clientProtocol?.features?.includes('sync-v1');
    if(!enabled){api.client?.reset();api.client=null;sessionScope='';return;}
    if(status.authenticated===false||sessionScope&&status.appSessionScope&&sessionScope!==status.appSessionScope){api.client?.reset();api.client=null;}
    const paged=status.clientProtocol.features.includes('messages-v1');
    if(api.client&&Boolean(api.client.paging)!==paged){api.client.reset();api.client=null;}
    if(!api.client)api.client=create({...options,paged});
    sessionScope=status.appSessionScope||sessionScope;
  },isHistory(state){return !!api.client?.paging?.delta(state)?.history;},
  newMessages(state){return api.client?.paging?.delta(state)?.fresh||null;},observe(state){api.client?.observe(state);},replaces(state){return api.client?.replaces(state)||false;},reset(){api.client?.reset();sessionScope='';}};
  if(typeof module==='object')module.exports=api;else globalThis.PipiStateSync=api;
})();
