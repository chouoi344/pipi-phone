// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const dns=require('node:dns');
const https=require('node:https');
const tls=require('node:tls');
const {Readable}=require('node:stream');

const PHASES=Object.freeze(['queued','checking','downloading','backing-up','installing','verifying','rolling-back','succeeded','rolled-back','failed']);
const TERMINAL_PHASES=Object.freeze(['succeeded','rolled-back','failed']);
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CACHE_MS=5*60*1000,WORKER_MAX_AGE_MS=60*1000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,status=400,code='UPDATE_INVALID')=>{throw Object.assign(new Error(message),{status,code,publicMessage:message});};

function normalizeRepository(value){
  if(typeof value!=='string'||value.length>140||!/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_][A-Za-z0-9_.-]{0,99})$/.test(value))fail('更新仓库必须填写 owner/repository',500,'UPDATE_CONFIG');
  return value.toLowerCase();
}
function validateVersion(value){
  if(typeof value!=='string'||value.length>32||!VERSION.test(value)||value.split('.').some(part=>!Number.isSafeInteger(Number(part))))fail('更新版本号无效');
  return value;
}
function compareVersions(a,b){
  const aa=validateVersion(a).split('.').map(Number),bb=validateVersion(b).split('.').map(Number);
  for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;
  return 0;
}
function timestamp(value){
  return typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
}
async function textResponse(response,maxBytes){
  if(!response.ok){
    if(response.status===429||response.status===403&&response.headers.get('x-ratelimit-remaining')==='0'){
      const retry=response.headers.get('retry-after'),reset=response.headers.get('x-ratelimit-reset');
      const wait=retry&&/^\d{1,6}$/.test(retry)?'，请在 '+retry+' 秒后重试':reset&&/^\d{1,12}$/.test(reset)&&Number.isFinite(new Date(Number(reset)*1000).getTime())?'，预计 '+new Date(Number(reset)*1000).toISOString()+' 恢复':'';
      fail('GitHub 暂时限制请求（HTTP '+response.status+'）'+wait,503,'UPDATE_RATE_LIMIT');
    }
    fail('更新服务器返回 HTTP '+response.status,503,'UPDATE_OFFLINE');
  }
  const length=Number(response.headers.get('content-length'));
  if(length>maxBytes){
    await response.body?.cancel();
    fail('更新资料超过大小限制',503,'UPDATE_INVALID_FEED');
  }
  const chunks=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.byteLength;
    if(size>maxBytes)fail('更新资料超过大小限制',503,'UPDATE_INVALID_FEED');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function jsonResponse(response,maxBytes){
  const content=await textResponse(response,maxBytes);
  try{return JSON.parse(content);}
  catch{fail('更新服务器返回的 JSON 无效',503,'UPDATE_INVALID_FEED');}
}

// Race verified TLS handshakes, not TCP connects: a reset can arrive after TCP succeeds.
function connectUpdateTls({host,port},signal,callback){
  const sockets=new Set();
  let timer,finished=false;
  function finish(error,winner){
    if(finished)return;
    finished=true;
    clearTimeout(timer);
    signal.removeEventListener('abort',abort);
    for(const socket of sockets)if(socket!==winner)socket.destroy();
    callback(error,winner);
  }
  function abort(){finish(signal.reason);}
  if(signal.aborted)return abort();
  signal.addEventListener('abort',abort,{once:true});
  dns.lookup(host,{all:true},(error,records)=>{
    if(finished)return;
    if(error)return finish(error);
    const addresses=[...new Set(records.map(record=>record.address))];
    if(!addresses.length)return finish(new Error('更新域名没有可用地址'));
    let index=0;
    function next(){
      clearTimeout(timer);
      const socket=tls.connect({host:addresses[index++],port,servername:host,rejectUnauthorized:true});
      sockets.add(socket);
      function failed(error){
        sockets.delete(socket);
        socket.destroy();
        if(finished)return;
        if(index<addresses.length)next();
        else if(!sockets.size)finish(error);
      }
      socket.once('error',failed);
      socket.once('secureConnect',()=>{
        socket.removeListener('error',failed);
        finish(null,socket);
      });
      if(index<addresses.length)timer=setTimeout(next,250);
    }
    next();
  });
}

function fetchUpdateMetadata(url,options){
  // An explicitly enabled Node proxy owns DNS and routing for these requests.
  if(https.globalAgent.options.proxyEnv || process.env.NODE_USE_ENV_PROXY==='1' ||
      process.execArgv.includes('--use-env-proxy') || /(?:^|\s)--use-env-proxy(?:\s|$)/.test(process.env.NODE_OPTIONS||'')){
    return fetch(url,options);
  }
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{
      defaultPort:443,headers:options.headers,signal:options.signal,
      createConnection:(target,cb)=>connectUpdateTls(target,options.signal,cb)
    },incoming=>{
      const status=incoming.statusCode;
      const headers=new Headers();
      for(const [key,value] of Object.entries(incoming.headers))headers.set(key,String(value));
      if(status<200||status>=300 || [204,205].includes(status)){
        incoming.destroy();
        if(status>=300&&status<400&&options.redirect==='error')return reject(new Error('更新地址发生重定向'));
        return resolve(new Response(null,{status,headers}));
      }
      resolve(new Response(Readable.toWeb(incoming),{status,headers}));
    });
    request.once('error',reject);
  });
}

async function stage(name,operation){
  try{return await operation();}
  catch(error){
    if(error.stage)throw error;
    const reason=error.publicMessage||'无法连接 GitHub，请稍后重试';
    throw Object.assign(new Error(name+'：'+reason,{cause:error}),{status:error.status||503,code:error.code||'UPDATE_OFFLINE',stage:name,publicMessage:name+'：'+reason});
  }
}

// Legacy repositories without an update-channel branch retain the original JSON
// metadata lookup. Fixed-version confirmation never uses the Latest endpoint.
async function legacyRelease({repository,version,fetchImpl}){
  return stage(version===undefined?'发现旧仓库版本':'核对旧仓库所选版本',async()=>{
    const api='https://api.github.com/repos/'+repository+'/releases';
    const options={headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'pipi-phone-updater'},redirect:'error',signal:AbortSignal.timeout(15000)};
    const response=await fetchImpl(api+'/'+(version?'tags/v'+version:'latest'),options);
    if(response.status===404&&version!==undefined)return null;
    let release=response.status===404?null:await jsonResponse(response,1024*1024);
    if(version===undefined&&(response.status===404||typeof release?.tag_name==='string'&&release.tag_name.startsWith('android-'))){
      for(let page=1;;page++){
        const listing=await fetchImpl(api+'?per_page=20&page='+page,options),releases=await jsonResponse(listing,2*1024*1024);
        if(!Array.isArray(releases))fail('更新服务器返回的发布列表无效',503,'UPDATE_INVALID_FEED');
        release=releases.find(item=>item?.draft===false&&item.prerelease===false&&typeof item.tag_name==='string'&&item.tag_name.startsWith('v')&&VERSION.test(item.tag_name.slice(1)));
        if(release)break;
        if(!/rel="next"/.test(listing.headers.get('link')||''))return null;
      }
    }
    if(!object(release)||release.draft!==false||release.prerelease!==false||typeof release.tag_name!=='string'||!release.tag_name.startsWith('v'))fail('更新资料不是正式发布版本',503,'UPDATE_INVALID_FEED');
    const releaseVersion=validateVersion(release.tag_name.slice(1));
    if(version!==undefined&&version!==releaseVersion)fail('发布标签与请求版本不一致',503,'UPDATE_INVALID_FEED');
    const tag='v'+releaseVersion,url='https://github.com/'+repository+'/releases/tag/'+tag;
    if(typeof release.html_url!=='string'||release.html_url.toLowerCase()!==url.toLowerCase()||!timestamp(release.published_at)||!Array.isArray(release.assets))fail('发布来源或时间无效',503,'UPDATE_INVALID_FEED');
    const assets=release.assets.filter(asset=>object(asset)&&asset.name==='update.json'),assetUrl='https://github.com/'+repository+'/releases/download/'+tag+'/update.json';
    if(assets.length!==1||typeof assets[0].browser_download_url!=='string'||assets[0].browser_download_url.toLowerCase()!==assetUrl.toLowerCase()||assets[0].state!=='uploaded')fail('正式发布缺少有效的 update.json',503,'UPDATE_INVALID_FEED');
    return {version:releaseVersion,tag,url,publishedAt:release.published_at,notes:typeof release.body==='string'?release.body.slice(0,12000):''};
  });
}

// All addresses are derived from the configured repository. Client input never
// supplies a URL or image. A permanent channel marker prevents fallback after withdrawal.
async function getRelease({repository,version,expectedImage,fetchImpl=fetchUpdateMetadata}){
  repository=normalizeRepository(repository);
  if(version!==undefined)validateVersion(version);
  const channel='https://raw.githubusercontent.com/'+repository+'/update-channel/';
  const imagePrefix='ghcr.io/'+repository+'@sha256:';
  const validImage=image=>typeof image==='string'&&image.startsWith(imagePrefix)&&/^[a-f0-9]{64}$/.test(image.slice(imagePrefix.length));
  let release=await stage(version===undefined?'发现更新版本':'核对所选正式版本',async()=>{
    const response=await fetchImpl(channel+(version===undefined?'latest.json':'versions/v'+version+'.json'),{headers:{Accept:'application/json','User-Agent':'pipi-phone-updater'},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(response.status===404)return null;
    const record=await jsonResponse(response,64*1024);
    if(!object(record)||typeof record.version!=='string'||!VERSION.test(record.version)||record.version.split('.').some(part=>!Number.isSafeInteger(Number(part)))||version!==undefined&&record.version!==version||!validImage(record.image)||!timestamp(record.publishedAt)||typeof record.notes!=='string')fail('官方正式版本记录的版本、镜像或发布时间无效',503,'UPDATE_INVALID_FEED');
    return {version:record.version,image:record.image,publishedAt:record.publishedAt,notes:record.notes.slice(0,12000),tag:'v'+record.version,url:'https://github.com/'+repository+'/releases/tag/v'+record.version};
  });
  if(!release){
    const channelExists=await stage('核对正式更新渠道',async()=>{
      const response=await fetchImpl(channel+'channel.json',{headers:{Accept:'application/json','User-Agent':'pipi-phone-updater'},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(response.status===404)return false;
      const marker=await jsonResponse(response,1024);
      if(!object(marker)||marker.schema!==1)fail('官方正式更新渠道标记无效',503,'UPDATE_INVALID_FEED');
      return true;
    });
    if(channelExists)return null;
    release=await legacyRelease({repository,version,fetchImpl});
  }
  if(!release)return null;
  if(expectedImage!==undefined&&release.image!==undefined&&release.image!==expectedImage)fail('所选版本的镜像清单已变化，请重新检查更新',409,'UPDATE_CHANGED');
  version=release.version;
  const base='https://github.com/'+repository+'/releases';
  const assetUrl=base+'/download/v'+version+'/update.json';
  const manifest=await stage('下载所选版本清单',async()=>{
    let manifestResponse,downloadUrl=new URL(assetUrl);
    const downloadSignal=AbortSignal.timeout(15000);
    for(let redirects=0;redirects<=5;redirects++){
      const allowedHost=['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(downloadUrl.hostname);
      const allowedPath=downloadUrl.pathname.startsWith('/github-production-release-asset/')||downloadUrl.pathname.startsWith('/github-production-release-asset-2e65be/');
      if(downloadUrl.protocol!=='https:'||downloadUrl.port&&downloadUrl.port!=='443'||downloadUrl.username||downloadUrl.password||downloadUrl.hash||
        !(downloadUrl.href===assetUrl||allowedHost&&allowedPath))fail('更新清单跳转到了不受信任的地址',503,'UPDATE_INVALID_FEED');
      manifestResponse=await fetchImpl(downloadUrl.href,{headers:{Accept:'application/json','User-Agent':'pipi-phone-updater'},redirect:'manual',signal:downloadSignal});
      if(![301,302,303,307,308].includes(manifestResponse.status))break;
      const location=manifestResponse.headers.get('location');await manifestResponse.body?.cancel();
      if(!location||redirects===5)fail('更新清单下载跳转无效',503,'UPDATE_INVALID_FEED');
      try{downloadUrl=new URL(location,downloadUrl);}catch{fail('更新清单下载跳转无效',503,'UPDATE_INVALID_FEED');}
    }
    return jsonResponse(manifestResponse,64*1024);
  });
  if(!object(manifest)||manifest.version!==version||!validImage(manifest.image)||release.image!==undefined&&manifest.image!==release.image)fail('所选版本清单的版本或镜像来源不匹配',503,'UPDATE_INVALID_FEED');
  if(expectedImage!==undefined&&manifest.image!==expectedImage)fail('所选版本的镜像清单已变化，请重新检查更新',409,'UPDATE_CHANGED');
  return {...release,image:manifest.image};
}

async function readJson(filename){
  let text;
  try{text=await fs.readFile(filename,'utf8');}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(Buffer.byteLength(text)>64*1024)fail('更新服务状态文件过大',503,'UPDATE_STATE');
  try{return JSON.parse(text);}
  catch{fail('更新服务状态文件无效',503,'UPDATE_STATE');}
}
function readJob(value,status=false){
  if(!object(value)||typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.id))fail('更新任务编号无效',503,'UPDATE_STATE');
  const job={id:value.id,version:validateVersion(value.version),previousVersion:validateVersion(value.previousVersion)};
  if(!status)return job;
  if(!PHASES.includes(value.phase)||!timestamp(value.updatedAt)||value.startedAt!==undefined&&!timestamp(value.startedAt)||value.message!==undefined&&(typeof value.message!=='string'||value.message.length>1000))fail('更新任务状态无效',503,'UPDATE_STATE');
  return {...job,phase:value.phase,updatedAt:value.updatedAt,...(value.startedAt===undefined?{}:{startedAt:value.startedAt}),...(value.message===undefined?{}:{message:value.message})};
}

function createUpdateService({repository=process.env.PIPI_UPDATE_REPOSITORY||'chouoi344/pipi-phone',currentVersion=require('../package.json').version,updateDir=process.env.PIPI_UPDATE_DIR||'',fetchImpl=fetchUpdateMetadata,now=Date.now}={}){
  repository=repository?normalizeRepository(repository):'';
  validateVersion(currentVersion);
  if(typeof updateDir!=='string'||updateDir&& !path.isAbsolute(updateDir))fail('PIPI_UPDATE_DIR 必须是共享更新目录的绝对路径',500,'UPDATE_CONFIG');
  let cache=null,pending=null;
  const discovered=new Map();
  async function latest(force){
    if(!force&&cache&&now()-cache.at<CACHE_MS)return cache.value;
    if(!pending)pending=getRelease({repository,fetchImpl}).then(value=>{cache={value,at:now()};if(value)discovered.set(value.version,value);return value;}).finally(()=>{pending=null;});
    return pending;
  }
  async function status(){
    const base={configured:!!repository,repository,currentVersion,workerAvailable:false,canUpdate:false};
    if(!repository)return {...base,state:'disabled',reason:'尚未配置公开更新仓库'};
    if(!updateDir)return {...base,state:'ok',reason:'未启用一键更新，请使用部署说明更新'};
    const [ready,request,rawStatus]=await Promise.all(['worker-ready.json','request.json','status.json'].map(name=>readJson(path.join(updateDir,name))));
    if(ready!==null&&(!object(ready)||!timestamp(ready.updatedAt)||ready.requestSchema!==undefined&&ready.requestSchema!==2))fail('更新服务心跳无效',503,'UPDATE_STATE');
    const age=ready?now()-Date.parse(ready.updatedAt):Infinity;
    const workerAvailable=age>=-5000&&age<=WORKER_MAX_AGE_MS;
    const submitted=request===null?null:readJob(request),reported=rawStatus===null?null:readJob(rawStatus,true);
    if(submitted&&reported?.id===submitted.id&&(reported.version!==submitted.version||reported.previousVersion!==submitted.previousVersion))fail('更新任务状态与请求不一致',503,'UPDATE_STATE');
    const job=submitted?(reported?.id===submitted.id?reported:{...submitted,phase:'queued'}):reported;
    const active=!!job&&!TERMINAL_PHASES.includes(job.phase);
    return {...base,workerAvailable,workerRequestSchema:ready?.requestSchema===2?2:1,canUpdate:workerAvailable&&!active,state:active?'queued':'ok',...(job?{job}:{}),...(!workerAvailable?{reason:'更新服务离线，请检查宿主机更新服务'}:{})};
  }
  async function check({force=false}={}){
    let snapshot;
    try{snapshot=await status();}
    catch(error){return {configured:!!repository,repository,currentVersion,workerAvailable:false,canUpdate:false,state:'offline',reason:error.message};}
    if(snapshot.state==='disabled'||snapshot.state==='queued')return snapshot;
    try{
      const release=await latest(force);
      const available=!!release&&compareVersions(release.version,currentVersion)>0;
      return {...snapshot,state:!release?'no-release':available?'available':'ok',canUpdate:available&&snapshot.canUpdate,...(release?{release}:{}),checkedAt:new Date(now()).toISOString()};
    }catch(error){return {...snapshot,state:'offline',canUpdate:false,reason:error.publicMessage||'无法连接更新服务器，请稍后重试',...(error.stage?{stage:error.stage}:{}),...(error.code?{code:error.code}:{}),checkedAt:new Date(now()).toISOString()};}
  }
  async function request(input){
    if(!object(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'version'))fail('更新请求只接受版本号');
    const version=validateVersion(input.version);
    let snapshot=await status();
    if(!snapshot.configured||!updateDir)fail(snapshot.reason,503,'UPDATE_DISABLED');
    if(snapshot.state==='queued')fail('已有更新任务正在进行',409,'UPDATE_BUSY');
    if(!snapshot.workerAvailable)fail(snapshot.reason,503,'UPDATE_WORKER_OFFLINE');
    const selected=discovered.get(version);
    if(compareVersions(version,currentVersion)<=0)fail('更新版本必须高于当前版本',409,'UPDATE_CHANGED');
    // A different app process may handle installation. The official fixed record
    // and attachment recover its target; an available earlier selection also pins its digest.
    const expectedImage=selected?.image;
    const release=await getRelease({repository,version,expectedImage,fetchImpl});
    if(!release)fail('所选正式版本已撤回，请重新检查更新',409,'UPDATE_CHANGED');
    const lock=path.join(updateDir,'request.lock');
    try{await fs.mkdir(lock);}
    catch(error){if(error.code==='EEXIST')fail('已有更新请求正在提交',409,'UPDATE_BUSY');throw error;}
    const temporary=path.join(updateDir,'.request-'+randomUUID()+'.tmp');
    try{
      // Re-read under the filesystem lock: separate app processes must never replace an active request.
      snapshot=await status();
      if(snapshot.state==='queued')fail('已有更新任务正在进行',409,'UPDATE_BUSY');
      if(!snapshot.workerAvailable)fail(snapshot.reason,503,'UPDATE_WORKER_OFFLINE');
      // Old host workers reject unknown fields. Only advertise the digest pin to
      // workers whose heartbeat explicitly accepts the new request schema.
      const job={id:randomUUID(),version,previousVersion:currentVersion,...(snapshot.workerRequestSchema===2?{expectedImage:release.image}:{})};
      await fs.writeFile(temporary,JSON.stringify(job)+'\n',{flag:'wx',mode:0o600});
      await fs.rename(temporary,path.join(updateDir,'request.json'));
      return {...snapshot,state:'queued',canUpdate:false,job:{...job,phase:'queued'}};
    }finally{
      await fs.rm(temporary,{force:true});
      await fs.rmdir(lock);
    }
  }
  return {status,check,request};
}

module.exports={createUpdateService,getRelease,compareVersions,normalizeRepository,PHASES,TERMINAL_PHASES};
