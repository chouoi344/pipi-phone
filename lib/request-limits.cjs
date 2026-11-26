// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {isIPv6}=require('node:net');
function clientKey(clientAddr){
  const addr=String(clientAddr||'').split('%')[0];
  if(!isIPv6(addr)||addr.includes('.'))return clientAddr;
  const [head,tail='']=addr.toLowerCase().split('::'),left=head?head.split(':'):[],right=addr.includes('::')&&tail?tail.split(':'):[];
  const groups=addr.includes('::')?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  return groups.slice(0,4).map(g=>parseInt(g,16).toString(16)).join(':')+'::/64';
}
function create({now=Date.now}={}){
  const buckets=new Map(),active=new Map();
  function blocked(retryAfter){return Object.assign(new Error(`请求过多，请 ${retryAfter} 秒后重试`),{status:429,code:'RATE_LIMIT',retryAfter});}
  function current(key){
    const item=buckets.get(key);
    if(item&&item.until<=now()){buckets.delete(key);return;}
    return item;
  }
  function check(key,max){
    const item=current(key);
    if(item&&item.n>=max){
      const retryAfter=Math.max(1,Math.ceil((item.until-now())/1000));
      throw blocked(retryAfter);
    }
  }
  function record(key,window){
    const item=current(key);
    if(item){item.n++;return;}
    if(buckets.size>=5000){
      for(const [k,v]of buckets)if(v.until<=now())buckets.delete(k);
      if(buckets.size>=5000)buckets.delete(buckets.keys().next().value);
    }
    buckets.set(key,{n:1,until:now()+window});
  }
  function consume(key,max=15,window=60000){check(key,max);record(key,window);}
  async function attempt(key,max,operation){
    check(key,max);
    const running=active.get(key)||0;
    if((current(key)?.n||0)+running>=max)throw blocked(1);
    active.set(key,running+1);
    try{return await operation();}
    finally{const remaining=active.get(key)-1;if(remaining)active.set(key,remaining);else active.delete(key);}
  }
  return {consume,check,record,attempt,clear:key=>buckets.delete(key)};
}
module.exports={create,clientKey};
