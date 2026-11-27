// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  function policy(path){
    const route=String(path).split('?')[0];
    if(/^\/api\/(?:media(?:\/|$)|backup(?:\/|$)|restore(?:\/|$)|engine\/memory\/(?:import|export)(?:\/|$))/.test(route))return {ms:60000,idle:true};
    if(/^\/api\/(?:engine\/(?:schedule|life|memory)(?:\/|$)|engine\/models\/(?:test|list)$|voice\/|ledger\/recognize$|providers(?:\/|$))/.test(route))return {ms:180000,idle:false};
    if(route==='/api/chat')return {ms:60000,idle:false};
    return {ms:20000,idle:false};
  }
  function create({fetch:send=globalThis.fetch,XHR=globalThis.XMLHttpRequest,Controller=globalThis.AbortController,setTimer=setTimeout,clearTimer=clearTimeout}={}){
    const syncing=new Set();
    async function request(path,options={}){
      const rule=policy(path),controller=new Controller();let timer,settled=false,rejectCancellation,abortReason;
      const cancelled=new Promise((_,reject)=>{rejectCancellation=reject;});
      const cancel=reason=>{abortReason=reason;controller.abort();};
      const external=()=>cancel(options.signal.reason||Object.assign(new Error('请求已取消'),{name:'AbortError'}));
      const dispose=()=>{clearTimer(timer);syncing.delete(controller);options.signal?.removeEventListener('abort',external);};
      const reason=()=>abortReason||Object.assign(new Error('请求已取消'),{name:'AbortError'});
      const abort=()=>rejectCancellation(reason());
      controller.signal.addEventListener('abort',abort,{once:true});
      const arm=()=>{clearTimer(timer);timer=setTimer(()=>cancel(Object.assign(new Error('网络超时，请重试'),{code:'NETWORK_TIMEOUT'})),rule.ms);};
      if(options.signal?.aborted)external();else options.signal?.addEventListener('abort',external,{once:true});
      const finish=()=>{if(settled)return;settled=true;dispose();controller.signal.removeEventListener('abort',abort);};
      const race=operation=>Promise.race([operation,cancelled]);
      if(/^\/api\/(?:state|sync)(?:\?|$)/.test(String(path)))syncing.add(controller);
      arm();
      if(rule.idle&&XHR){
        const xhr=new XHR(),stop=()=>xhr.abort();controller.signal.addEventListener('abort',stop,{once:true});
        try{return await race(new Promise((resolve,reject)=>{
          xhr.open(options.method||'GET',path,true);xhr.withCredentials=options.credentials==='include';
          if(options.responseType==='blob')xhr.responseType='blob';
          for(const [key,value]of Object.entries(options.headers||{}))xhr.setRequestHeader(key,value);
          xhr.onprogress=arm;if(xhr.upload)xhr.upload.onprogress=arm;
          xhr.onload=()=>resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,headers:{get:name=>xhr.getResponseHeader(name),has:name=>xhr.getResponseHeader(name)!==null},json:async()=>JSON.parse(xhr.responseText),blob:async()=>xhr.response});
          xhr.onerror=()=>reject(new TypeError('Failed to fetch'));xhr.onabort=()=>reject(reason());
          if(controller.signal.aborted){reject(reason());return;}xhr.send(options.body??null);
        }));}finally{controller.signal.removeEventListener('abort',stop);finish();}
      }
      try{
        const response=await race(send(path,{...options,signal:controller.signal}));
        const consume=async kind=>{
          try{
            if(rule.idle&&response.body?.getReader){
              const reader=response.body.getReader(),decoder=new TextDecoder(),chunks=[];let text='';
              try{for(;;){const part=await race(reader.read());if(part.done)break;arm();if(kind==='blob')chunks.push(part.value);else text+=decoder.decode(part.value,{stream:true});}if(kind==='blob')return new Blob(chunks,{type:response.headers.get('Content-Type')||''});text+=decoder.decode();return JSON.parse(text);}
              finally{reader.releaseLock();}
            }
            return await race(response[kind]());
          }finally{finish();}
        };
        return {ok:response.ok,status:response.status,headers:response.headers,json:()=>consume('json'),blob:()=>consume('blob')};
      }catch(error){finish();throw error;}
    }
    const abortSync=()=>{for(const controller of syncing)controller.abort();};
    return {request,abortSync};
  }
  const api={create,policy,...create()};
  if(typeof module==='object')module.exports=api;else globalThis.PipiNetwork=api;
})();
