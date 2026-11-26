// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  function create({request,getEpoch=()=>0}) {
    let snapshot=null,cursor='',cursorRevision=-1,serverEpoch='',generation=0,tail=Promise.resolve();
    const epochReplacements=new WeakSet();
    const stale=()=>Object.assign(new Error('登录状态已变化，请重新操作'),{stale:true});
    function reset(){generation++;snapshot=null;cursor='';cursorRevision=-1;serverEpoch='';tail=Promise.resolve();}
    function observe(next){if(next&&Array.isArray(next.messages)&&(!snapshot||next.revision>=snapshot.revision))snapshot=next;}
    function replaces(next){return next===snapshot&&epochReplacements.has(next);}
    function headers(){return cursor&&snapshot?{'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':cursor}:{};}
    function enqueue(work){
      const ownGeneration=generation,ownEpoch=getEpoch();
      const active=()=>{if(ownGeneration!==generation||ownEpoch!==getEpoch())throw stale();};
      const fetch=async path=>{active();const result=await request(path);active();return result;};
      const task=tail.then(async()=>{active();const result=await work(fetch,active);active();return result;});
      // The returned task reports failures; this continuation lets the next refresh recover.
      tail=task.catch(()=>{});return task;
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
    async function bootstrap(fetch,initial){
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
    async function refreshNow(fetch){
      if(!cursor||!snapshot)return bootstrap(fetch);
      const delta=envelope(await fetch('/api/sync?cursor='+encodeURIComponent(cursor)));
      if(delta.mode==='reset')return bootstrap(fetch,delta);
      if(delta.epoch!==serverEpoch||delta.fromRevision!==cursorRevision||delta.revision<snapshot.revision)throw new Error('服务器同步起点不一致，请刷新页面重试');
      return apply(delta);
    }
    function refresh(visibleRevision=snapshot?.revision){return enqueue(async fetch=>{const state=await refreshNow(fetch);return {state,revision:state.revision,unchanged:visibleRevision===state.revision&&!replaces(state)};});}
    function accept(result){
      if(!result.sync)return result.state?enqueue(async()=>{observe(result.state);return result;}):Promise.resolve(result);
      return enqueue(async fetch=>{
        const delta=envelope(result.sync);
        if(delta.mode==='reset')await bootstrap(fetch,delta);
        else if(!cursor||!snapshot||delta.epoch!==serverEpoch)await refreshNow(fetch);
        else if(delta.revision<cursorRevision||delta.revision<snapshot.revision)await refreshNow(fetch);
        else if(delta.fromRevision!==cursorRevision)await refreshNow(fetch);
        else apply(delta);
        const {sync,...rest}=result;return {...rest,state:snapshot};
      });
    }
    return {reset,observe,replaces,headers,refresh,accept};
  }
  let sessionScope='';
  const api={create,client:null,configure(status,options){
    const enabled=status.clientProtocol?.features?.includes('sync-v1');
    if(!enabled){api.client?.reset();api.client=null;sessionScope='';return;}
    if(status.authenticated===false||sessionScope&&status.appSessionScope&&sessionScope!==status.appSessionScope){api.client?.reset();api.client=null;}
    api.client??=create(options);sessionScope=status.appSessionScope||sessionScope;
  },observe(state){api.client?.observe(state);},replaces(state){return api.client?.replaces(state)||false;},reset(){api.client?.reset();sessionScope='';}};
  if(typeof module==='object')module.exports=api;else globalThis.PipiStateSync=api;
})();
