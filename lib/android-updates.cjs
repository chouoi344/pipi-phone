// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');

const REPOSITORY='chouoi344/pipi-phone',API='https://api.github.com/repos/'+REPOSITORY+'/releases';
const RELEASE_PATH='/'+REPOSITORY+'/releases/download/',MAX_APK_BYTES=512*1024*1024,CACHE_MS=5*60*1000;
const APK_NAME=/^pipi-phone-android-([0-9]+(?:\.[0-9]+){1,3})-([1-9][0-9]{0,9})\.apk$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const error=(message,code='ANDROID_UPDATE_INVALID',status=503)=>Object.assign(new Error(message),{status,code});
const fail=(...args)=>{throw error(...args);};
const publicRelease=({name,versionName,versionCode,size,sha256})=>({name,versionName,versionCode,size,sha256});

function parseAsset(tag,asset){
  const match=APK_NAME.exec(asset.name),versionCode=Number(match[2]);
  if(versionCode>2147483647)fail('安卓版本编号不正确');
  if(asset.state!=='uploaded'||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX_APK_BYTES)fail('安卓安装包大小或发布状态不正确');
  if(typeof asset.digest!=='string'||!/^sha256:[0-9a-fA-F]{64}$/.test(asset.digest))fail('发布的安卓安装包缺少有效 SHA-256 校验值');
  if(typeof tag!=='string'||!tag||tag.length>200||tag.includes('..')||tag.startsWith('/'))fail('安卓发布标签不正确');
  const url=typeof asset.browser_download_url==='string'?URL.parse(asset.browser_download_url):null;
  let pathname;
  try{pathname=url&&decodeURIComponent(url.pathname);}catch{fail('安卓安装包地址无效');}
  if(!url||url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash||pathname!==RELEASE_PATH+tag+'/'+asset.name)fail('安卓安装包不属于官方仓库的这次发布');
  return {name:asset.name,versionName:match[1],versionCode,size:asset.size,sha256:asset.digest.slice(7).toLowerCase(),url:url.href};
}

function allowedDownload(url,original){
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.hash)return false;
  if(url.hostname==='github.com')return url.pathname===original.pathname&&!url.search;
  return ['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(url.hostname)
    &&(url.pathname.startsWith('/github-production-release-asset/')||url.pathname.startsWith('/github-production-release-asset-2e65be/'));
}

function createAndroidUpdateService({fetchImpl=globalThis.fetch,now=Date.now}={}){
  const controller=new AbortController();
  const readers=new Set();
  let cache,pending,directory,cachedApk,idle,queue=Promise.resolve(),closing=false;
  const check=()=>{if(closing)fail('服务器正在关闭','ANDROID_UPDATE_CLOSING');};
  const networkError=cause=>{
    if(cause.status)return cause;
    return error(closing?'服务器正在关闭':'无法连接安卓更新服务，请稍后重试',closing?'ANDROID_UPDATE_CLOSING':'ANDROID_UPDATE_OFFLINE');
  };
  async function request(url,signal,api){
    return fetchImpl(url,{headers:{Accept:api?'application/vnd.github+json':'application/octet-stream','Accept-Encoding':'identity','User-Agent':'pipi-phone-android-updater',...(api?{'X-GitHub-Api-Version':'2026-03-10'}:{})},redirect:'manual',signal});
  }
  async function responseOk(response){
    if(response.status===200)return;
    await response.body?.cancel();
    const limited=response.status===429||response.status===403&&response.headers.get('x-ratelimit-remaining')==='0';
    fail(limited?'GitHub 暂时限制检查次数，请稍后重试':'安卓更新服务返回 HTTP '+response.status,limited?'ANDROID_UPDATE_RATE_LIMIT':'ANDROID_UPDATE_OFFLINE');
  }
  async function listing(page,scanSignal){
    const signal=AbortSignal.any([controller.signal,scanSignal,AbortSignal.timeout(15000)]);
    const response=await request(API+'?per_page=30&page='+page,signal,true);
    await responseOk(response);
    const limit=4*1024*1024;
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();fail('安卓发布记录过大');}
    const chunks=[];let size=0;
    if(!response.body)fail('安卓更新服务返回空白发布记录');
    for await(const chunk of response.body){
      size+=chunk.byteLength;if(size>limit)fail('安卓发布记录过大');chunks.push(Buffer.from(chunk));
    }
    let releases;
    try{releases=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('安卓发布记录格式不正确');}
    if(!Array.isArray(releases))fail('安卓发布列表格式不正确');
    return {releases,next:/rel="next"/.test(response.headers.get('link')||'')||releases.length===30};
  }
  async function findLatest(){
    const signal=AbortSignal.timeout(45000);
    let newest=null,conflicting=false;
    for(let page=1;page<=30;page++){
      check();const {releases,next}=await listing(page,signal);
      for(const release of releases){
        if(!object(release)||typeof release.draft!=='boolean'||typeof release.prerelease!=='boolean')fail('安卓发布记录格式不正确');
        if(release.draft||release.prerelease)continue;
        if(!Array.isArray(release.assets))fail('安卓发布附件列表格式不正确');
        for(const asset of release.assets){
          if(!object(asset)||typeof asset.name!=='string')fail('安卓发布附件格式不正确');
          const match=APK_NAME.exec(asset.name);if(!match)continue;
          const candidate={tag:release.tag_name,asset,code:Number(match[2])};
          if(!newest||candidate.code>newest.code){newest=candidate;conflicting=false;}
          else if(candidate.code===newest.code){
            const identity=({tag,asset:a})=>JSON.stringify([tag,a.name,a.state,a.size,a.digest,a.browser_download_url]);
            if(identity(candidate)!==identity(newest))conflicting=true;
          }
        }
      }
      if(!next){
        if(conflicting)fail('安卓版本编号对应多个不同的安装包');
        return newest?parseAsset(newest.tag,newest.asset):null;
      }
    }
    fail('安卓发布记录过多，请稍后重试');
  }
  async function latest(){
    check();
    if(cache&&now()-cache.at<CACHE_MS)return cache.value;
    if(!pending)pending=findLatest().then(value=>{cache={at:now(),value};return value;}).catch(cause=>{throw networkError(cause);}).finally(()=>{pending=null;});
    return pending;
  }
  async function download(release,file){
    const original=new URL(release.url),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15*60*1000)]);
    let url=original,response;
    for(let redirects=0;redirects<=5;redirects++){
      if(!allowedDownload(url,original))fail('安卓安装包跳转到了不受信任的地址');
      response=await request(url.href,signal,false);
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location||redirects===5)fail('安卓安装包下载跳转无效');
      try{url=new URL(location,url);}catch{fail('安卓安装包下载跳转无效');}
    }
    await responseOk(response);
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)!==release.size)){await response.body?.cancel();fail('安卓安装包大小与发布记录不一致');}
    if(!response.body)fail('安卓安装包为空');
    const hash=createHash('sha256');let total=0;
    const verify=new Transform({transform(chunk,encoding,done){
      total+=chunk.length;
      if(total>release.size)return done(error('安卓安装包超过发布记录中的大小'));
      hash.update(chunk);done(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body),verify,fs.createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
    if(total!==release.size)fail('安卓安装包没有下载完整');
    if(hash.digest('hex')!==release.sha256)fail('安卓安装包 SHA-256 校验失败，请重新下载');
  }
  function open(version){
    if(typeof version!=='string'||!/^([1-9][0-9]{0,9})$/.test(version)||Number(version)>2147483647)return Promise.reject(error('安卓版本编号不正确','ANDROID_UPDATE_VERSION',400));
    // Serialize cache replacement, then let all readers stream the verified file concurrently.
    const result=queue.then(async()=>{
      check();const release=await latest();
      if(!release||release.versionCode!==Number(version))fail('可用安卓版本已变化，请重新检查更新','ANDROID_UPDATE_CHANGED',409);
      const key=JSON.stringify(publicRelease(release));
      if(cachedApk?.key!==key){
        if(readers.size)await new Promise(resolve=>{idle=resolve;});
        check();
        if(cachedApk){await fsp.unlink(cachedApk.file);cachedApk=null;}
        directory??=await fsp.mkdtemp(path.join(os.tmpdir(),'pipi-android-updates-'));
        const file=path.join(directory,'verified.apk');
        try{await download(release,file);cachedApk={key,file};}
        catch(cause){await fsp.rm(file,{force:true});throw networkError(cause);}
      }
      check();
      const stream=fs.createReadStream(cachedApk.file);readers.add(stream);
      stream.once('close',()=>{readers.delete(stream);if(!readers.size){idle?.();idle=null;}});
      return {release:publicRelease(release),stream};
    });
    queue=result.then(()=>{},()=>{});
    return result;
  }
  return {
    async latest(){const release=await latest();return {release:release?publicRelease(release):null};},open,
    async close(){
      closing=true;controller.abort(error('服务器正在关闭','ANDROID_UPDATE_CLOSING'));
      for(const stream of readers)stream.destroy();
      await Promise.allSettled([pending,queue]);
      if(readers.size)await new Promise(resolve=>{idle=resolve;});
      if(directory)await fsp.rm(directory,{recursive:true,force:true});
    }
  };
}
module.exports={createAndroidUpdateService,MAX_APK_BYTES};
