// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const PHASES=Object.freeze(['queued','checking','downloading','backing-up','installing','verifying','rolling-back','succeeded','rolled-back','failed']);
const TERMINAL_PHASES=Object.freeze(['succeeded','rolled-back','failed']);
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CACHE_MS=5*60*1000,WORKER_MAX_AGE_MS=60*1000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,status=400,code='UPDATE_INVALID')=>{throw Object.assign(new Error(message),{status,code});};

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
async function jsonResponse(response,maxBytes){
  if(!response.ok)fail('更新服务器返回 HTTP '+response.status,503,'UPDATE_OFFLINE');
  const length=Number(response.headers.get('content-length'));
  if(length>maxBytes)fail('更新资料超过大小限制',503,'UPDATE_INVALID_FEED');
  const chunks=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.byteLength;
    if(size>maxBytes)fail('更新资料超过大小限制',503,'UPDATE_INVALID_FEED');
    chunks.push(Buffer.from(chunk));
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{fail('更新服务器返回的 JSON 无效',503,'UPDATE_INVALID_FEED');}
}

// All addresses are derived from the administrator's repository; callers cannot supply a download URL.
async function getRelease({repository,version,fetchImpl=globalThis.fetch}){
  repository=normalizeRepository(repository);
  if(version!==undefined)validateVersion(version);
  const api='https://api.github.com/repos/'+repository+'/releases';
  const options={headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'pipi-phone-updater'},redirect:'error',signal:AbortSignal.timeout(15000)};
  const response=await fetchImpl(api+'/'+(version?'tags/v'+version:'latest'),options);
  if(response.status===404 && version!==undefined)return null;
  let release=response.status===404?null:await jsonResponse(response,1024*1024);
  // An Android-only release can legitimately own GitHub's "latest" badge.
  if(version===undefined && (response.status===404 || typeof release?.tag_name==='string' && release.tag_name.startsWith('android-'))){
    let page=1;
    do {
      const listing=await fetchImpl(api+'?per_page=20&page='+page++,options);
      const releases=await jsonResponse(listing,2*1024*1024);
      if(!Array.isArray(releases))fail('更新服务器返回的发布列表无效',503,'UPDATE_INVALID_FEED');
      release=releases.find(item=>item?.draft===false && item.prerelease===false &&
        typeof item.tag_name==='string' && item.tag_name.startsWith('v') && VERSION.test(item.tag_name.slice(1)));
      if(release)break;
      if(!/rel="next"/.test(listing.headers.get('link')||''))return null;
    } while(true);
  }
  if(!object(release)||release.draft!==false||release.prerelease!==false||typeof release.tag_name!=='string'||!release.tag_name.startsWith('v'))fail('更新资料不是正式发布版本',503,'UPDATE_INVALID_FEED');
  const releaseVersion=validateVersion(release.tag_name.slice(1));
  if(version!==undefined&&releaseVersion!==version)fail('发布标签与请求版本不一致',503,'UPDATE_INVALID_FEED');
  const tag='v'+releaseVersion,url='https://github.com/'+repository+'/releases/tag/'+tag;
  if(typeof release.html_url!=='string'||release.html_url.toLowerCase()!==url.toLowerCase()||!timestamp(release.published_at)||!Array.isArray(release.assets))fail('发布来源或时间无效',503,'UPDATE_INVALID_FEED');
  const assets=release.assets.filter(asset=>object(asset)&&asset.name==='update.json');
  const assetUrl='https://github.com/'+repository+'/releases/download/'+tag+'/update.json';
  if(assets.length!==1||typeof assets[0].browser_download_url!=='string'||assets[0].browser_download_url.toLowerCase()!==assetUrl.toLowerCase()||assets[0].state!=='uploaded')fail('正式发布缺少有效的 update.json',503,'UPDATE_INVALID_FEED');
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
  const manifest=await jsonResponse(manifestResponse,64*1024);
  const imagePrefix='ghcr.io/'+repository+'@sha256:';
  if(!object(manifest)||manifest.version!==releaseVersion||typeof manifest.image!=='string'||!manifest.image.startsWith(imagePrefix)||!/^[a-f0-9]{64}$/.test(manifest.image.slice(imagePrefix.length)))fail('更新清单版本或镜像来源不匹配',503,'UPDATE_INVALID_FEED');
  return {version:releaseVersion,tag,image:manifest.image,publishedAt:release.published_at,notes:typeof release.body==='string'?release.body.slice(0,12000):'',url};
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

function createUpdateService({repository=process.env.PIPI_UPDATE_REPOSITORY||'chouoi344/pipi-phone',currentVersion=require('../package.json').version,updateDir=process.env.PIPI_UPDATE_DIR||'',fetchImpl=globalThis.fetch,now=Date.now}={}){
  repository=repository?normalizeRepository(repository):'';
  validateVersion(currentVersion);
  if(typeof updateDir!=='string'||updateDir&& !path.isAbsolute(updateDir))fail('PIPI_UPDATE_DIR 必须是共享更新目录的绝对路径',500,'UPDATE_CONFIG');
  let cache=null,pending=null;
  async function latest(force){
    if(!force&&cache&&now()-cache.at<CACHE_MS)return cache.value;
    if(!pending)pending=getRelease({repository,fetchImpl}).then(value=>{cache={value,at:now()};return value;}).finally(()=>{pending=null;});
    return pending;
  }
  async function status(){
    const base={configured:!!repository,repository,currentVersion,workerAvailable:false,canUpdate:false};
    if(!repository)return {...base,state:'disabled',reason:'尚未配置公开更新仓库'};
    if(!updateDir)return {...base,state:'ok',reason:'未启用一键更新，请使用部署说明更新'};
    const [ready,request,rawStatus]=await Promise.all(['worker-ready.json','request.json','status.json'].map(name=>readJson(path.join(updateDir,name))));
    if(ready!==null&&(!object(ready)||!timestamp(ready.updatedAt)))fail('更新服务心跳无效',503,'UPDATE_STATE');
    const age=ready?now()-Date.parse(ready.updatedAt):Infinity;
    const workerAvailable=age>=-5000&&age<=WORKER_MAX_AGE_MS;
    const submitted=request===null?null:readJob(request),reported=rawStatus===null?null:readJob(rawStatus,true);
    if(submitted&&reported?.id===submitted.id&&(reported.version!==submitted.version||reported.previousVersion!==submitted.previousVersion))fail('更新任务状态与请求不一致',503,'UPDATE_STATE');
    const job=submitted?(reported?.id===submitted.id?reported:{...submitted,phase:'queued'}):reported;
    const active=!!job&&!TERMINAL_PHASES.includes(job.phase);
    return {...base,workerAvailable,canUpdate:workerAvailable&&!active,state:active?'queued':'ok',...(job?{job}:{}),...(!workerAvailable?{reason:'更新服务离线，请检查宿主机更新服务'}:{})};
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
    }catch(error){return {...snapshot,state:'offline',canUpdate:false,reason:error.code==='UPDATE_INVALID_FEED'?error.message:'无法连接更新服务器，请稍后重试',checkedAt:new Date(now()).toISOString()};}
  }
  async function request(input){
    if(!object(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'version'))fail('更新请求只接受版本号');
    const version=validateVersion(input.version);
    let snapshot=await status();
    if(!snapshot.configured||!updateDir)fail(snapshot.reason,503,'UPDATE_DISABLED');
    if(snapshot.state==='queued')fail('已有更新任务正在进行',409,'UPDATE_BUSY');
    if(!snapshot.workerAvailable)fail(snapshot.reason,503,'UPDATE_WORKER_OFFLINE');
    let release;
    try{release=await latest(true);}
    catch{fail('无法重新确认发布版本，请稍后重试',503,'UPDATE_OFFLINE');}
    if(!release||release.version!==version||compareVersions(version,currentVersion)<=0)fail('可用版本已变化，请重新检查更新',409,'UPDATE_CHANGED');
    const lock=path.join(updateDir,'request.lock');
    try{await fs.mkdir(lock);}
    catch(error){if(error.code==='EEXIST')fail('已有更新请求正在提交',409,'UPDATE_BUSY');throw error;}
    const temporary=path.join(updateDir,'.request-'+randomUUID()+'.tmp');
    try{
      // Re-read under the filesystem lock: separate app processes must never replace an active request.
      snapshot=await status();
      if(snapshot.state==='queued')fail('已有更新任务正在进行',409,'UPDATE_BUSY');
      if(!snapshot.workerAvailable)fail(snapshot.reason,503,'UPDATE_WORKER_OFFLINE');
      const job={id:randomUUID(),version,previousVersion:currentVersion};
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
