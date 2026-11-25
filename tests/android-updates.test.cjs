// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {createAndroidUpdateService,MAX_APK_BYTES}=require('../lib/android-updates.cjs'),{createApp}=require('../server.cjs');
const API='https://api.github.com/repos/chouoi344/pipi-phone/releases';
const bytes=Buffer.from('isolated-apk-fixture: never an installable APK'),hash=value=>createHash('sha256').update(value).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function release(code=2,content=bytes){
  const name='pipi-phone-android-0.1.'+code+'-'+code+'.apk',tag='android-v0.1.'+code;
  return {tag_name:tag,draft:false,prerelease:false,assets:[{name,state:'uploaded',size:content.length,digest:'sha256:'+hash(content),browser_download_url:'https://github.com/chouoi344/pipi-phone/releases/download/'+tag+'/'+name}]};
}
function fixture(t,extra={}){
  let value=[release()],content=bytes,at=1000000;
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'manual');
    assert.equal(new Headers(options.headers).get('cookie'),null);
    assert.equal(new Headers(options.headers).get('authorization'),null);
    if(extra.fetchImpl)return extra.fetchImpl(url,options);
    return url.startsWith(API)?Response.json(value):new Response(content);
  };
  const service=createAndroidUpdateService({fetchImpl,now:()=>at});
  t.after(()=>service.close());
  return {service,fetchImpl,calls,set releases(next){value=next;},set bytes(next){content=next;},expire(){at+=5*60*1000;}};
}
async function read(asset){const chunks=[];for await(const chunk of asset.stream)chunks.push(chunk);return Buffer.concat(chunks);}

test('Android release scan skips server-only and preview releases, follows numbered pages and picks the highest version code',async t=>{
  const calls=[];
  const f=fixture(t,{fetchImpl:async(url)=>{
    calls.push(url);
    if(url.endsWith('page=1'))return Response.json([{tag_name:'v0.13.9',draft:false,prerelease:false,assets:[]},{...release(99),prerelease:true},{...release(98),draft:true},release(3)],{headers:{Link:'<https://attacker.example/steal>; rel="next"'}});
    return Response.json([release(7),release(2)]);
  }});
  const result=await f.service.latest();
  assert.equal(result.release.versionCode,7);
  assert.deepEqual(Object.keys(result.release).sort(),['name','sha256','size','versionCode','versionName']);
  assert.deepEqual(calls,[API+'?per_page=30&page=1',API+'?per_page=30&page=2']);
});

test('metadata cache joins concurrent checks, expires in five minutes and retries after a network failure',async t=>{
  let finish,offline=false;
  const f=fixture(t,{fetchImpl:async()=>{if(offline)throw Error('isolated offline');await new Promise(resolve=>{finish=resolve;});return Response.json([release()]);}});
  const first=f.service.latest(),second=f.service.latest();await tick();assert.equal(f.calls.length,1);finish();
  assert.deepEqual(await first,await second);await f.service.latest();assert.equal(f.calls.length,1);
  f.expire();offline=true;await assert.rejects(f.service.latest(),{code:'ANDROID_UPDATE_OFFLINE'});
  offline=false;const retry=f.service.latest();await tick();finish();assert.equal((await retry).release.versionCode,2);assert.equal(f.calls.length,3);
});

test('official combined and Android-only release tags preserve upgrades while preview and unrelated tags are ignored',async t=>{
  const tagged=(code,tag)=>{
    const value=release(code);value.tag_name=tag;
    value.assets[0].browser_download_url=value.assets[0].browser_download_url.replace('android-v0.1.'+code,tag);
    return value;
  };
  const f=fixture(t);
  f.releases=[tagged(20,'notes-only'),tagged(19,'v0.13.20-beta'),tagged(18,'android-v0.1.18-preview'),
    {...tagged(17,'v0.13.17'),prerelease:true},tagged(12,'v0.13.15'),tagged(10,'android-v0.1.9')];
  assert.equal((await f.service.latest()).release.versionCode,12);
  assert.deepEqual(await read(await f.service.open('12')),bytes);
  f.expire();f.releases=[tagged(13,'android-v0.1.11'),tagged(12,'v0.13.15')];
  assert.equal((await f.service.latest()).release.versionCode,13);
});

test('server-only releases return a cacheable null Android release',async t=>{
  const f=fixture(t);f.releases=[{tag_name:'v0.13.9',draft:false,prerelease:false,assets:[]}];
  assert.deepEqual(await f.service.latest(),{release:null});
  await assert.rejects(f.service.open('2'),{status:409,code:'ANDROID_UPDATE_CHANGED'});
  assert.equal(f.calls.length,1);
});

test('an older APK without a GitHub digest does not hide a verifiable newer APK',async t=>{
  const f=fixture(t),older=release(1);delete older.assets[0].digest;f.releases=[older,release(2)];
  assert.equal((await f.service.latest()).release.versionCode,2);
});

test('release metadata rejects missing digests, foreign URLs, oversized files and conflicting version codes',async t=>{
  const changes=[asset=>delete asset.digest,asset=>asset.digest='sha256:bad',asset=>asset.state='new',asset=>asset.size=MAX_APK_BYTES+1,asset=>asset.size=0,asset=>asset.browser_download_url=asset.browser_download_url.replace('chouoi344','attacker'),asset=>asset.browser_download_url+='?token=bad',asset=>asset.browser_download_url=asset.browser_download_url.replace('https://','https://user:secret@'),asset=>asset.name=asset.name.replace('-2.apk','-2147483648.apk')];
  for(const change of changes){const f=fixture(t),r=release();change(r.assets[0]);f.releases=[r];await assert.rejects(f.service.latest(),{code:'ANDROID_UPDATE_INVALID'});}
  const f=fixture(t),other=release();other.assets[0].digest='sha256:'+'f'.repeat(64);f.releases=[release(),other];
  await assert.rejects(f.service.latest(),/多个不同/);
});

test('invalid or excessive publication records and upstream redirects/errors produce explicit failures',async t=>{
  for(const response of [()=>new Response('{bad'),()=>Response.json({}),()=>Response.json([{draft:false,prerelease:false,assets:null}]),()=>new Response('[]',{headers:{'Content-Length':String(4*1024*1024+1)}}),()=>new Response(null,{status:302,headers:{Location:'https://attacker.example'}})]){
    const f=fixture(t,{fetchImpl:async()=>response()});await assert.rejects(f.service.latest(),error=>error.status===503);
  }
  const limited=fixture(t,{fetchImpl:async()=>new Response(null,{status:403,headers:{'X-RateLimit-Remaining':'0'}})});
  await assert.rejects(limited.service.latest(),{code:'ANDROID_UPDATE_RATE_LIMIT'});
});

test('APK downloads are verified on disk, support trusted GitHub redirects and join simultaneous requests',async t=>{
  const requested=Promise.withResolvers(),releaseDownload=Promise.withResolvers();
  const cdn='https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?signature=isolated';
  const f=fixture(t,{fetchImpl:async(url)=>{
    if(url.startsWith(API))return Response.json([release()]);
    if(url.startsWith('https://github.com/')){requested.resolve();await releaseDownload.promise;return new Response(null,{status:302,headers:{Location:cdn}});}
    assert.equal(url,cdn);return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});
  }});
  const one=f.service.open('2'),two=f.service.open('2');await requested.promise;releaseDownload.resolve();
  const a=await one,b=await two,file=a.stream.path;
  assert.equal(a.stream.path,b.stream.path);assert.equal(path.dirname(file).startsWith(path.join(os.tmpdir(),'pipi-android-updates-')),true);
  assert.deepEqual(await Promise.all([read(a),read(b)]),[bytes,bytes]);assert.equal(f.calls.length,3);
  assert.deepEqual(await read(await f.service.open('2')),bytes);assert.equal(f.calls.length,3);
  await f.service.close();await assert.rejects(fs.access(file),{code:'ENOENT'});
});

test('invalid APK content is never returned and failed temporary files allow a clean retry',async t=>{
  for(const mode of ['digest','short','long','declared']){
    let bad=true;
    const f=fixture(t,{fetchImpl:async(url)=>{
      if(url.startsWith(API))return Response.json([release()]);
      if(!bad)return new Response(bytes);
      const body=mode==='digest'?Buffer.alloc(bytes.length):mode==='short'?bytes.subarray(1):mode==='long'?Buffer.concat([bytes,bytes]):bytes;
      return new Response(body,mode==='declared'?{headers:{'Content-Length':'1'}}:{});
    }});
    await assert.rejects(f.service.open('2'),{code:'ANDROID_UPDATE_INVALID'});bad=false;
    assert.deepEqual(await read(await f.service.open('2')),bytes);assert.equal(f.calls.length,3);
  }
});

test('foreign download redirects are rejected before connecting and version input cannot select a URL',async t=>{
  const f=fixture(t,{fetchImpl:async(url)=>url.startsWith(API)?Response.json([release()]):new Response(null,{status:302,headers:{Location:'http://127.0.0.1:18855/secret'}})});
  for(const value of ['https://attacker.example','2/../3','0','2147483648'])await assert.rejects(f.service.open(value),{status:400});
  assert.equal(f.calls.length,0);
  await assert.rejects(f.service.open('2'),/不受信任/);assert.equal(f.calls.length,2);
});

test('cache replacement waits for current readers and keeps one APK file outside user data',async t=>{
  const f=fixture(t),old=await f.service.open('2'),file=old.stream.path;
  const nextBytes=Buffer.from('isolated new APK');f.releases=[release(3,nextBytes)];f.bytes=nextBytes;f.expire();
  const newer=f.service.open('3');await tick();await tick();assert.equal(f.calls.filter(call=>!call.url.startsWith(API)).length,1);
  assert.deepEqual(await read(old),bytes);const replacement=await newer;
  assert.equal(replacement.stream.path,file);assert.deepEqual(await read(replacement),nextBytes);
  assert.deepEqual(await fs.readdir(path.dirname(file)),['verified.apk']);
});

test('closing the service aborts a pending upstream transfer and its queued download',async t=>{
  let downloading;
  const started=new Promise(resolve=>{downloading=resolve;});
  const f=fixture(t,{fetchImpl:async(url,options)=>{
    if(url.startsWith(API))return Response.json([release()]);
    downloading();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  const first=f.service.open('2'),second=f.service.open('2');
  const rejected=Promise.all([assert.rejects(first,{code:'ANDROID_UPDATE_CLOSING'}),assert.rejects(second,{code:'ANDROID_UPDATE_CLOSING'})]);
  await started;await f.service.close();await rejected;
});

test('closing the service releases a reader that has not started consuming its APK',async t=>{
  const f=fixture(t),asset=await f.service.open('2'),file=asset.stream.path;
  await f.service.close();assert.equal(asset.stream.destroyed,true);await assert.rejects(fs.access(file),{code:'ENOENT'});
});

async function httpFixture(t,extra={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-android-update-http-'));
  const f=fixture(t,extra),app=createApp({dataDir:dir,host:'127.0.0.1',port:0,mediaTimers:false,providerUrlAllowlist:[],androidUpdates:{fetchImpl:f.fetchImpl},updates:{fetchImpl:async()=>{throw Error('Web updater is isolated and offline');}}});
  await app.listen();const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await app.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'pipi-android-update-http-')));await fs.rm(dir,{recursive:true,force:true});});
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'Isolated-Android-Update!',displayName:'隔离更新'})});
  assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0],session=await setup.json();
  const request=(route,anonymous=false,headers={})=>fetch(base+route,{headers:{Connection:'close',...(anonymous?{}:{Cookie:cookie}),...headers},redirect:'manual'});
  return {...f,app,dir,base,request,session,cookie};
}

test('HTTP Android update routes require the existing login, ignore external URL input and return binary without redirects',async t=>{
  const f=await httpFixture(t),before=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  for(const route of ['/api/android-updates/latest','/api/android-updates/apk/2'])assert.equal((await f.request(route,true)).status,401);
  assert.equal((await f.request('/api/android-updates/latest',false,{Origin:'https://attacker.example'})).status,403);assert.equal(f.calls.length,0);
  const checked=await f.request('/api/android-updates/latest?url=https://attacker.example');assert.equal(checked.status,200);const meta=await checked.json();assert.equal(meta.release.versionCode,2);assert.equal(JSON.stringify(meta).includes('http'),false);
  const downloaded=await f.request('/api/android-updates/apk/2?url=https://attacker.example');assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('location'),null);assert.equal(downloaded.headers.get('content-type'),'application/vnd.android.package-archive');assert.equal(downloaded.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
  assert.equal((await f.request('/api/android-updates/apk/1')).status,409);assert.equal((await f.request('/api/android-updates/apk/https://attacker.example')).status,400);
  const web=await f.request('/api/updates/check');assert.equal((await web.json()).state,'offline');assert.equal((await f.request('/api/android-updates/latest')).status,200);
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
  assert.equal((await fs.readdir(f.dir)).some(name=>name.includes('apk')||name.includes('android-updates')),false);
});

test('a revoked login cannot receive an APK after the server finishes its upstream download',async t=>{
  let finish,started;
  const wait=new Promise(resolve=>{started=resolve;});
  const f=await httpFixture(t,{fetchImpl:async url=>{
    if(url.startsWith(API))return Response.json([release()]);
    started();await new Promise(resolve=>{finish=resolve;});return new Response(bytes);
  }});
  const download=f.request('/api/android-updates/apk/2');await wait;
  const logout=await fetch(f.base+'/api/logout',{method:'POST',headers:{Connection:'close',Origin:f.base,Cookie:f.cookie,'Content-Type':'application/json','X-CSRF-Token':f.session.csrfToken},body:'{}'});assert.equal(logout.status,200);
  finish();const result=await download;assert.equal(result.status,401);assert.equal((await result.json()).code,'AUTH_REQUIRED');
});
