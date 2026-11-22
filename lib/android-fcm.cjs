// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const S=require('./state.cjs'),Notifications=require('./android-notifications.cjs');
const tokenUrl='https://oauth2.googleapis.com/token';
const scope='https://www.googleapis.com/auth/firebase.messaging';

function identity(file){
  if(!file)return null;
  let value;
  const source=fs.readFileSync(file,'utf8');
  try{value=JSON.parse(source);}catch{throw new Error('FCM 服务身份 JSON 无法解析');}
  if(!value||value.type!=='service_account'||typeof value.project_id!=='string'||!value.project_id||
    typeof value.client_email!=='string'||!value.client_email.endsWith('.iam.gserviceaccount.com')||
    value.token_uri!==tokenUrl||typeof value.private_key!=='string')throw new Error('FCM 服务身份 JSON 无效');
  const privateKey=crypto.createPrivateKey(value.private_key);
  if(privateKey.asymmetricKeyType!=='rsa')throw new Error('FCM 服务身份需要 RSA 私钥');
  return {projectId:value.project_id,email:value.client_email,privateKey};
}

function create({credentialFile,getMeta,setMeta,sessionValid,sessionScope,getState,fetch:request=globalThis.fetch,clock=Date.now,pause,onError=code=>console.warn('FCM 后台投递失败：'+code)}){
  // Only an explicit administrator file enables external network activity.
  // The credential and OAuth token never enter app state, responses or logs.
  const account=identity(credentialFile),pending=new Set(),controller=new AbortController();
  const wait=pause??(milliseconds=>sleep(milliseconds,undefined,{signal:controller.signal}));
  let accessToken=null,tokenPending=null,closed=false,lastDeliveryError='';
  const devices=()=>JSON.parse(getMeta('androidFcmDevices')||'[]');
  const save=value=>setMeta('androidFcmDevices',JSON.stringify(value));
  const available=Boolean(account);
  function prune(){
    const existing=devices(),current=existing.filter(device=>sessionValid(device.session));
    if(existing.length!==current.length)save(current);
    return current;
  }
  function status(auth){
    return {available,...(available?{projectId:account.projectId}:{}),registered:available&&devices().some(device=>device.session===auth.hash&&sessionValid(device.session)),...(lastDeliveryError?{lastDeliveryError}:{})};
  }
  function register(auth,input,origin){
    if(!available)S.fail('管理员尚未配置 FCM 服务身份',409,'FCM_UNAVAILABLE');
    const token=S.text(input.token,4096),installationId=S.text(input.installationId,100),packageName=S.text(input.packageName,200),projectId=S.text(input.projectId,100);
    if(!token||!/^\S+$/.test(token)||!/^[-_A-Za-z0-9]+$/.test(installationId)||!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)||typeof input.foreground!=='boolean')S.fail('FCM 设备资料无效');
    if(projectId!==account.projectId)S.fail('APK 与服务器的 Firebase 项目不一致',409,'FCM_PROJECT_MISMATCH');
    const entries=prune().filter(device=>device.installationId!==installationId&&device.token!==token);
    entries.push({installationId,token,packageName,projectId,session:auth.hash,origin,foreground:input.foreground,updatedAt:clock()});
    save(entries);
    return {registered:true,appSessionScope:sessionScope(auth.hash),cursor:Notifications.view(getState(),null,clock()).cursor};
  }
  function unregister(auth,input){
    const installationId=S.text(input.installationId,100);
    if(!/^[-_A-Za-z0-9]+$/.test(installationId))S.fail('FCM 设备标识无效');
    const existing=devices(),current=existing.filter(device=>device.installationId!==installationId||device.session!==auth.hash);
    if(existing.length!==current.length)save(current);
    return {ok:true};
  }
  function removeSession(hash){
    const existing=devices(),current=existing.filter(device=>device.session!==hash);
    if(existing.length!==current.length)save(current);
  }
  async function oauth(){
    if(accessToken&&accessToken.expiresAt>clock())return accessToken.value;
    if(tokenPending)return tokenPending;
    tokenPending=(async()=>{
      const at=Math.floor(clock()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.email,scope,aud:tokenUrl,iat:at,exp:at+3600});
      const assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),account.privateKey).toString('base64url');
      const response=await request(tokenUrl,{method:'POST',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()});
      if(!response.ok)throw Object.assign(new Error('OAuth HTTP '+response.status),{retryable:response.status===429||response.status>=500});
      const data=await response.json();
      if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=60)throw new Error('OAuth 响应无效');
      accessToken={value:data.access_token,expiresAt:clock()+(data.expires_in-60)*1000};
      return accessToken.value;
    })();
    try{return await tokenPending;}finally{tokenPending=null;}
  }
  function current(device,roleId,messageId){
    if(closed||!sessionValid(device.session)||!devices().some(item=>item.installationId===device.installationId&&item.token===device.token&&item.session===device.session))return false;
    const state=getState(),message=state.messages.find(item=>item.id===messageId);
    if(!message||!Notifications.isIncoming(message)||message.createdAt+60000<=clock())return false;
    const role=Notifications.view(state,null,clock()).conversations.find(item=>item.id===roleId);
    return role&&!role.muted&&role.unread>0;
  }
  async function send(device,message){
    const bearer=await oauth();
    // Recheck after OAuth: a user may have read, muted, logged out or switched
    // servers while the network request was in flight.
    if(!current(device,message.roleId,message.id))return;
    const response=await request('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(account.projectId)+'/messages:send',{
      method:'POST',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),
      headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
      body:JSON.stringify({message:{token:device.token,notification:{title:'小手机',body:'收到好友新消息'},
        data:{roleId:message.roleId,notificationOrigin:device.origin,appSessionScope:sessionScope(device.session)},
        android:{priority:'HIGH',ttl:'60s',restricted_package_name:device.packageName,
          notification:{channel_id:'pipi_chat_messages_v2',tag:'chat:'+message.roleId,visibility:'PRIVATE',notification_priority:'PRIORITY_HIGH',sound:'default'}}}})
    });
    if(response.ok){lastDeliveryError='';return;}
    const failure=await response.json();
    if(failure?.error?.details?.some(detail=>detail.errorCode==='UNREGISTERED')){
      save(devices().filter(item=>item.installationId!==device.installationId||item.token!==device.token||item.session!==device.session));
      return;
    }
    if(response.status===401)accessToken=null;
    const retryAfter=response.headers.get('retry-after');
    const retryAfterMs=retryAfter?(/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-clock())):0;
    throw Object.assign(new Error('发送 HTTP '+response.status),{retryable:response.status===401||response.status===429||response.status>=500,retryAfterMs});
  }
  async function deliver(device,message){
    for(let attempt=0;attempt<4;attempt++){
      if(!current(device,message.roleId,message.id))return;
      try{return await send(device,message);}
      catch(error){
        const retryable=error.retryable??(error.name==='TypeError'||error.name==='TimeoutError');
        const delay=Math.max(1000*2**attempt,error.retryAfterMs||0);
        if(closed||!retryable||attempt===3||clock()+delay>=message.createdAt+60000)throw error;
        await wait(delay);
      }
    }
  }
  function snapshot(state){
    return available&&devices().length?new Set(state.messages.filter(Notifications.isIncoming).map(message=>message.id)):null;
  }
  function publish(previous,state){
    if(!available||closed||!previous)return;
    const now=clock(),allowed=new Set(Notifications.view(state,null,now).conversations.filter(role=>!role.muted&&role.unread>0).map(role=>role.id));
    const latest=new Map();
    for(const message of state.messages)if(!previous.has(message.id)&&Notifications.isIncoming(message)&&allowed.has(message.roleId)&&message.createdAt+60000>now)latest.set(message.roleId,message);
    if(!latest.size)return;
    for(const device of prune())for(const message of latest.values()){
      const task=deliver(device,message).catch(error=>{
        if(!closed){lastDeliveryError=error.name==='AbortError'||error.name==='TimeoutError'?'网络请求超时':/^OAuth HTTP \d+$|^发送 HTTP \d+$|^OAuth 响应无效$/.test(error.message)?error.message:'网络请求失败';onError(lastDeliveryError);}
      });
      pending.add(task);task.finally(()=>pending.delete(task));
    }
  }
  async function flush(){while(pending.size)await Promise.all([...pending]);}
  async function close(){closed=true;controller.abort();await flush();}
  return {status,register,unregister,removeSession,prune,snapshot,publish,flush,close};
}
module.exports={create};
