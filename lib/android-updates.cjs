// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {createAcrPull}=require('./updates.cjs');

const REPOSITORY='chouoi344/pipi-phone',API='https://api.github.com/repos/'+REPOSITORY+'/releases';
const RELEASE_PATH='/'+REPOSITORY+'/releases/download/',MAX_APK_BYTES=512*1024*1024,CACHE_MS=5*60*1000;
const APK_NAME=/^pipi-phone-android-([0-9]+(?:\.[0-9]+){1,3})-([1-9][0-9]{0,9})\.apk$/;
const RELEASE_TAG=/^(?:v[0-9]+\.[0-9]+\.[0-9]+|android-v[0-9]+(?:\.[0-9]+){1,3})$/;
const OCI_MANIFEST='application/vnd.oci.image.manifest.v1+json';
const REDIRECTS=[301,302,303,307,308];
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

function apkFromManifest(manifest){
  const annotation=manifest?.annotations?.['io.pipi-phone.android'];
  if(manifest?.schemaVersion!==2||manifest.mediaType!==OCI_MANIFEST||typeof annotation!=='string'||!Array.isArray(manifest.layers)||manifest.layers.length!==1)fail('国内安卓安装包清单无效');
  let apk;
  try{apk=JSON.parse(annotation);}catch{fail('国内安卓安装包版本记录格式不正确');}
  const name=typeof apk?.name==='string'&&APK_NAME.exec(apk.name);
  const layer=manifest.layers[0];
  if(!name||apk.versionName!==name[1]||apk.versionCode!==Number(name[2])||apk.versionCode>2147483647||
      !Number.isSafeInteger(apk.size)||apk.size<=0||apk.size>MAX_APK_BYTES||typeof apk.sha256!=='string'||!/^[a-f0-9]{64}$/.test(apk.sha256)||
      layer?.digest!=='sha256:'+apk.sha256||layer.size!==apk.size)fail('国内安卓安装包的文件名、版本、大小或校验值无效');
  return {...publicRelease(apk),source:'acr'};
}

const unavailable=cause=>!cause.status||['UPDATE_OFFLINE','UPDATE_RATE_LIMIT','ANDROID_UPDATE_OFFLINE','ANDROID_UPDATE_RATE_LIMIT'].includes(cause.code);

function createAndroidUpdateService({fetchImpl=globalThis.fetch,now=Date.now}={}){
  const controller=new AbortController();
  const registry=createAcrPull(fetchImpl);
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
  async function readJson(response,limit){
    await responseOk(response);
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();fail('安卓发布记录过大');}
    const chunks=[];let size=0;
    if(!response.body)fail('安卓更新服务返回空白发布记录');
    for await(const chunk of response.body){
      size+=chunk.byteLength;if(size>limit)fail('安卓发布记录过大');chunks.push(Buffer.from(chunk));
    }
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('安卓发布记录格式不正确');}
  }
  async function listing(page,scanSignal){
    const signal=AbortSignal.any([controller.signal,scanSignal,AbortSignal.timeout(15000)]);
    const response=await request(API+'?per_page=30&page='+page,signal,true);
    const releases=await readJson(response,4*1024*1024);
    if(!Array.isArray(releases))fail('安卓发布列表格式不正确');
    return {releases,next:/rel="next"/.test(response.headers.get('link')||'')||releases.length===30};
  }
  async function githubLatest(){
    const signal=AbortSignal.timeout(45000);
    let newest=null,conflicting=false;
    for(let page=1;page<=30;page++){
      check();const {releases,next}=await listing(page,signal);
      for(const release of releases){
        if(!object(release)||typeof release.draft!=='boolean'||typeof release.prerelease!=='boolean')fail('安卓发布记录格式不正确');
        if(release.draft||release.prerelease)continue;
        if(typeof release.tag_name!=='string')fail('安卓发布标签不正确');
        if(!RELEASE_TAG.test(release.tag_name))continue;
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
  async function findLatest(){
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]);
    try{
      const response=await registry('manifests/android-channel-latest',OCI_MANIFEST,signal);
      if(response.status!==404){
        const release=apkFromManifest(await readJson(response,64*1024));
        const fixedResponse=await registry('manifests/android-apk-'+release.versionCode,OCI_MANIFEST,signal);
        if(fixedResponse.status===404){await fixedResponse.body?.cancel();fail('国内安卓安装包缺少固定版本清单');}
        const fixed=apkFromManifest(await readJson(fixedResponse,64*1024));
        if(JSON.stringify(release)!==JSON.stringify(fixed))fail('国内安卓版本与固定安装包不一致');
        return fixed;
      }
      await response.body?.cancel();
    }catch(cause){
      check();
      if(!unavailable(cause))throw cause;
    }
    return githubLatest();
  }
  async function latest(){
    check();
    if(cache&&now()-cache.at<CACHE_MS)return cache.value;
    if(!pending)pending=findLatest().then(value=>{cache={at:now(),value};return value;}).catch(cause=>{throw networkError(cause);}).finally(()=>{pending=null;});
    return pending;
  }
  async function githubApk(release,signal){
    const original=new URL(release.url);
    let url=original,response;
    for(let redirects=0;redirects<=5;redirects++){
      if(!allowedDownload(url,original))fail('安卓安装包跳转到了不受信任的地址');
      response=await request(url.href,signal,false);
      if(!REDIRECTS.includes(response.status))break;
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location||redirects===5)fail('安卓安装包下载跳转无效');
      try{url=new URL(location,url);}catch{fail('安卓安装包下载跳转无效');}
    }
    return response;
  }
  async function download(release,file){
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15*60*1000)]);
    let source='GitHub';
    let response;
    if(release.source==='acr'){
      try{
        response=await registry('blobs/sha256:'+release.sha256,'application/octet-stream',signal);
        if(REDIRECTS.includes(response.status)){
          const target=URL.parse(response.headers.get('location')||'');
          await response.body?.cancel();
          const path='/docker/registry/v2/blobs/sha256/'+release.sha256.slice(0,2)+'/'+release.sha256+'/data';
          if(!target||target.origin!=='https://aliregistry.oss-cn-hangzhou.aliyuncs.com'||target.username||target.password||target.hash||target.pathname!==path)fail('安卓安装包跳转到了不受信任的国内存储地址');
          // The signed storage URL carries its own access parameters. Never forward the registry token.
          response=await request(target.href,signal,false);
          if(REDIRECTS.includes(response.status)){await response.body?.cancel();fail('国内存储的安卓安装包下载跳转无效');}
        }
        await responseOk(response);
        source='阿里云杭州';
      }catch(cause){
        check();
        if(!unavailable(cause))throw cause;
        const official=await githubLatest();
        if(!official||JSON.stringify(publicRelease(official))!==JSON.stringify(publicRelease(release)))fail('可用安卓安装包已变化，请重新检查更新','ANDROID_UPDATE_CHANGED',409);
        response=await githubApk(official,signal);
      }
    }else{
      response=await githubApk(release,signal);
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
    console.info(`安卓安装包已下载并校验 来源=${source} 文件=${release.name} 字节数=${total}`);
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
