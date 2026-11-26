// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createAndroidUpdateService}=require('../lib/android-updates.cjs');
const {ACR_REPOSITORY}=require('../lib/updates.cjs');
const host=ACR_REPOSITORY.split('/')[0];
const base='https://'+host+'/v2/chouoi344/pipi-phone/';
const bytes=Buffer.from('isolated android download');
const sha256=createHash('sha256').update(bytes).digest('hex');
const apk={name:'pipi-phone-android-0.1.14-16.apk',versionName:'0.1.14',versionCode:16,size:bytes.length,sha256};
const blob=base+'blobs/sha256:'+sha256;
const latest=base+'manifests/android-channel-latest',fixed=base+'manifests/android-apk-16';
const auth='https://dockerauth.cn-hangzhou.aliyuncs.com/auth';
const challenge='Bearer realm="'+auth+'",service="registry.aliyuncs.com:cn-hangzhou:26842",scope="repository:chouoi344/pipi-phone:pull"';
const storage='https://aliregistry.oss-cn-hangzhou.aliyuncs.com/docker/registry/v2/blobs/sha256/'+sha256.slice(0,2)+'/'+sha256+'/data?Signature=fake';
const githubApk='https://github.com/chouoi344/pipi-phone/releases/download/android-v0.1.14/'+apk.name;
const github=[{tag_name:'android-v0.1.14',draft:false,prerelease:false,assets:[{name:apk.name,digest:'sha256:'+sha256,state:'uploaded',size:bytes.length,browser_download_url:githubApk}]}];
function manifest(record=apk,layers=[{size:record.size,digest:'sha256:'+record.sha256}]){
  return Response.json({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',layers,annotations:{'io.pipi-phone.android':JSON.stringify(record)}});
}
function service(t,impl){
  const android=createAndroidUpdateService({fetchImpl:impl});
  t.after(()=>android.close());
  return android;
}
async function contents(opened){
  const chunks=[];for await(const data of opened.stream)chunks.push(data);
  return Buffer.concat(chunks);
}
test('Android ACR latest and immutable tag agree, signed blob streams only after full verification without forwarding registry credentials',async t=>{
  const log=t.mock.method(console,'info',()=>{});
  const urls=[];
  const app=service(t,async(url,opts)=>{
    urls.push(url);assert.equal(opts.redirect,'manual');
    if(url.startsWith(auth+'?')){assert.equal(opts.headers.Authorization,undefined);return Response.json({token:'test-token'});}
    if(url===storage){assert.equal(opts.headers.Authorization,undefined);return new Response(bytes);}
    if(!opts.headers.Authorization)return new Response(null,{status:401,headers:{'www-authenticate':challenge}});
    assert.equal(opts.headers.Authorization,'Bearer test-token');
    if(url===latest||url===fixed)return manifest();
    assert.equal(url,blob);
    return new Response(null,{status:307,headers:{Location:storage}});
  });
  assert.deepEqual(await app.latest(),{release:apk});
  assert.deepEqual(await contents(await app.open('16')),bytes);
  assert.deepEqual(await contents(await app.open('16')),bytes);
  assert.deepEqual(log.mock.calls.map(call=>call.arguments),[[`安卓安装包已下载并校验 来源=阿里云杭州 文件=${apk.name} 字节数=${bytes.length}`]]);
  assert.deepEqual(urls.map(u=>u.startsWith(auth)?auth:u),[latest,auth,latest,fixed,blob,storage]);
});
test('ACR APK rejects altered fixed version, layer digest, size, name or duplicate layers without switching to GitHub',async t=>{
  for(const invalid of [
    ()=>manifest({...apk,sha256:'a'.repeat(64)}),()=>manifest({...apk,size:apk.size+1}),
    ()=>manifest({...apk,versionCode:17}),()=>manifest({...apk,versionName:'0.1.15'}),
    ()=>manifest(apk,[{size:apk.size,digest:'sha256:'+'0'.repeat(64)}]),
    ()=>manifest(apk,[{size:apk.size+1,digest:'sha256:'+sha256}]),()=>manifest(apk,[{},{}]),
    ()=>new Response(null,{status:404})
  ]){
    const calls=[];
    const app=service(t,async url=>{calls.push(url);return url===latest?manifest():invalid();});
    await assert.rejects(app.latest(),{code:'ANDROID_UPDATE_INVALID'});
    assert.deepEqual(calls,[latest,fixed]);
  }
});
test('ACR APK rejects wrong bytes and untrusted storage redirects without requesting them',async t=>{
  const log=t.mock.method(console,'info',()=>{});
  for(const response of [()=>new Response(Buffer.alloc(bytes.length)),()=>new Response(bytes.subarray(1)),
    ...[storage.replace(sha256,'a'.repeat(64)),storage.replace('aliregistry.','other.'),storage.replace('https://','http://'),storage.replace('https://','https://user@')].map(url=>()=>new Response(null,{status:307,headers:{Location:url}}))
  ]){
    const calls=[];
    const app=service(t,async url=>{calls.push(url);return url===blob?response():manifest();});
    await assert.rejects(app.open('16'),{code:'ANDROID_UPDATE_INVALID'});
    assert.deepEqual(calls,[latest,fixed,blob]);
  }
  assert.equal(log.mock.callCount(),0);
});
test('unavailable ACR APK may use the verified GitHub attachment only if it matches the entire selected record',async t=>{
  const log=t.mock.method(console,'info',()=>{});
  for(const changed of [false,true]){
    const calls=[];
    const gh=structuredClone(github);if(changed)gh[0].assets[0].digest='sha256:'+'a'.repeat(64);
    const app=service(t,async url=>{
      calls.push(url);
      if(url===latest||url===fixed)return manifest();
      if(url===blob)return new Response(null,{status:503});
      if(url.startsWith('https://api.github.com/'))return Response.json(gh);
      assert.equal(url,githubApk);return new Response(bytes);
    });
    if(changed){await assert.rejects(app.open('16'),{code:'ANDROID_UPDATE_CHANGED'});assert.ok(!calls.includes(githubApk));}
    else assert.deepEqual(await contents(await app.open('16')),bytes);
  }
  assert.deepEqual(log.mock.calls.map(call=>call.arguments),[[`安卓安装包已下载并校验 来源=GitHub 文件=${apk.name} 字节数=${bytes.length}`]]);
});
