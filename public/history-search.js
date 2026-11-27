// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  'use strict';
  let features=[], active=null, timer=0;
  function reset() {
    clearTimeout(timer);
    active?.controller?.abort();
    active=null;
  }
  function configure(status) {
    reset();
    features=status.clientProtocol?.features||[];
  }
  function searchPath({roleId,term,type,date}) {
    const params=new URLSearchParams();
    params.set('limit','50');
    if(!roleId){params.set('query',term);return '/api/messages/global-search?'+params;}
    params.set('roleId',roleId);
    if(term)params.set('q',term);
    if(type!=='all')params.set('type',type);
    if(date){
      const from=new Date(date+'T00:00:00'),to=new Date(from);
      to.setDate(to.getDate()+1);
      params.set('from',String(from.getTime()));params.set('to',String(to.getTime()));
    }
    return '/api/messages/search?'+params;
  }
  function bind(options) {
    const {roleId,area,local,render,jump}=options, path=searchPath(options);
    const supported=features.includes(roleId?'messages-v1':'messages-global-search-v1');
    const remote=supported&&navigator.onLine!==false, key=path+'|'+remote;
    if(active?.key!==key){
      reset();
      active={key,path,items:[],cursor:null,loaded:false,loading:remote,error:'',controller:null};
    }
    const current=active;
    if(remote&&current.loading&&!current.request)timer=setTimeout(()=>load(current),160);
    current.paint=()=>{
      if(!area.isConnected)return;
      const useLocal=!remote||(!current.loaded&&Boolean(current.error));
      const messages=useLocal?local():current.items;
      const scope=useLocal&&(!supported||navigator.onLine===false||current.error)?'<p class="search-empty">仅搜索已加载的聊天记录</p>':'';
      const retry=current.error?'<button type="button" class="search-result" data-history-retry>重新搜索</button>':'';
      const progress=current.loading?'<p class="search-empty" role="status">正在查找…</p>':'';
      const more=current.cursor&&!current.loading&&!current.error?'<button type="button" class="search-result" data-history-more>查看更多结果</button>':'';
      area.innerHTML=scope+render(messages,Boolean(current.loading))+progress+retry+more;
      if(current.error){const notice=document.createElement('p');notice.className='search-empty';notice.textContent=current.error;area.insertBefore(notice,area.querySelector('[data-history-retry]'));}
    };
    current.options=options;
    current.request=options.request;
    current.roleId=roleId;
    area.onclick=event=>{
      const row=event.target.closest('button');
      if(!row||!area.contains(row))return;
      if(row.hasAttribute('data-history-more')||row.hasAttribute('data-history-retry')){void load(current);return;}
      const id=row.dataset.globalMessage||row.dataset.searchMessage;
      if(id)jump(row.dataset.searchRole||roleId,id);
    };
    current.paint();
  }
  async function load(current) {
    if(active!==current||current.controller)return;
    const controller=new AbortController();
    current.controller=controller;current.loading=true;current.error='';current.paint();
    try {
      const result=await current.request(current.path+
        (current.cursor?'&beforeId='+encodeURIComponent(current.cursor):''),controller.signal);
      if(active!==current)return;
      // Global search returns newest first; a role-specific page comes in chronological order.
      if(current.roleId)current.items.unshift(...result.messages);
      else current.items.push(...result.messages);
      current.cursor=result.hasMore?result.nextBeforeId:null;current.loaded=true;
    } catch(error) {
      if(active!==current||error.stale||controller.signal.aborted)return;
      current.error=error.message;
    } finally {
      if(active===current){current.controller=null;current.loading=false;current.paint();}
    }
  }
  function connectionChanged() {
    if(active?.options.area.isConnected)bind(active.options);
  }
  window.addEventListener('online',connectionChanged);
  window.addEventListener('offline',connectionChanged);
  window.PipiHistorySearch={bind,reset,configure};
})();
