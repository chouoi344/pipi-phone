// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Delivery cancellation belongs to each caller; a started paid synthesis may finish into cache.
function createSynthesisQueue(limit=2){
  const pending=new Map(),queue=[];let active=0;
  const aborted=()=>Object.assign(new Error('语音请求已取消'),{name:'AbortError'});
  function drain(){
    while(active<limit&&queue.length){
      const job=queue.shift();
      if(!job.waiters){job.reject(aborted());pending.delete(job.key);continue;}
      active++;
      Promise.resolve().then(job.run).then(job.resolve,error=>{if(!job.waiters)job.onBackgroundError?.(error);job.reject(error);}).finally(()=>{active--;pending.delete(job.key);drain();});
    }
  }
  return function synthesize(key,run,{signal,onBackgroundError}={}){
    signal?.throwIfAborted();
    let job=pending.get(key);
    if(!job){
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      job={key,run,resolve,reject,promise,waiters:0,onBackgroundError};pending.set(key,job);queue.push(job);
    }
    job.waiters++;
    const promise=new Promise((resolve,reject)=>{
      const abort=()=>{cleanup();reject(aborted());};
      const cleanup=()=>{signal?.removeEventListener('abort',abort);};
      signal?.addEventListener('abort',abort,{once:true});
      job.promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    });
    const result=promise.finally(()=>{job.waiters--;});
    drain();return result;
  };
}
module.exports={createSynthesisQueue};
