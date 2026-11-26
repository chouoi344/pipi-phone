// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createUpdateService,getRelease,compareVersions}=require('../lib/updates.cjs');
const repository='example/pipi-phone',currentVersion='0.12.0',version='0.12.1';
const image='ghcr.io/'+repository+'@sha256:'+'a'.repeat(64),publishedAt='2026-11-20T10:00:00.000Z';
const channel='https://raw.githubusercontent.com/'+repository+'/update-channel/';
const assetUrl='https://github.com/'+repository+'/releases/download/v'+version+'/update.json';
const record={version,image,publishedAt,notes:'更新说明 <script>不会执行</script>'};
function feed({release={},manifest={},status=200,fetchError}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});if(fetchError)throw fetchError;
    assert(!url.includes('api.github.com'),'updates must not consume the anonymous API allowance');
    if(url===channel+'channel.json')return Response.json({schema:1});
    return Response.json(url.startsWith(channel)?{...record,...release}:{version,image,...manifest},{status:url.startsWith(channel)?status:200});
  };
  return {fetchImpl,calls};
}
function legacyMetadata(overrides={}){
  return {tag_name:'v'+version,draft:false,prerelease:false,html_url:'https://github.com/'+repository+'/releases/tag/v'+version,published_at:publishedAt,body:record.notes,assets:[{name:'update.json',state:'uploaded',browser_download_url:assetUrl}],...overrides};
}
// Frozen request contract from the v0.13.20 host worker. Existing installs run
// this strict three-field validator until the host files are updated.
function validateV01320Request(value){
  const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['id','version','previousVersion'].includes(k))||typeof value.id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(value.id)||!VERSION.test(value.version)||!VERSION.test(value.previousVersion))throw new Error('更新请求格式无效');
  if(compareVersions(value.version,value.previousVersion)<=0)throw new Error('更新版本必须高于当前版本');
  return {id:value.id,version:value.version,previousVersion:value.previousVersion};
}
async function fixture(t,options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-updates-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let clock=Date.parse(publishedAt);
  const write=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value));
  await write('worker-ready.json',{updatedAt:publishedAt,...(options.workerSchema===1?{}:{requestSchema:2})});
  const remote=feed(options),config={repository,currentVersion,updateDir:directory,fetchImpl:remote.fetchImpl,now:()=>clock};
  return {directory,write,remote,config,service:createUpdateService(config),advance(ms){clock+=ms;}};
}

test('official stable channel and canonical attachment accept only a digest image without anonymous API calls',async()=>{
  const remote=feed(),release=await getRelease({repository:'Example/Pipi-Phone',fetchImpl:remote.fetchImpl});
  assert.deepEqual(release,{...record,tag:'v'+version,url:'https://github.com/'+repository+'/releases/tag/v'+version});
  assert.deepEqual(remote.calls.map(x=>x.url),[channel+'latest.json',assetUrl]);
  for(const call of remote.calls){assert.equal(call.options.headers.Authorization,undefined);assert.equal(call.options.headers.Cookie,undefined);}
  const tagged=feed();await getRelease({repository,version,expectedImage:image,fetchImpl:tagged.fetchImpl});
  assert.deepEqual(tagged.calls.map(x=>x.url),[channel+'versions/v'+version+'.json',assetUrl]);
  assert.equal(compareVersions('0.12.10','0.12.9'),1);assert.equal(compareVersions(version,version),0);assert.equal(compareVersions('0.9.0',currentVersion),-1);
});

test('web update tries current DNS addresses until TLS succeeds and sends each GET once',async t=>{
  const net=require('node:net'),http=require('node:http'),tls=require('node:tls'),dns=require('node:dns');
  const urls=[],attempts=[],sockets=[];
  const server=http.createServer((req,res)=>{
    urls.push(req.url);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url.endsWith('latest.json')?record:{version,image}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const ips=['192.0.2.1','192.0.2.2','192.0.2.3','192.0.2.4'];
  t.mock.method(dns,'lookup',(host,options,cb)=>queueMicrotask(()=>cb(null,
    (host==='raw.githubusercontent.com'?ips:[ips[3]]).map(address=>({address,family:4})))));
  t.mock.method(tls,'connect',options=>{
    attempts.push([options.servername,options.host]);
    assert.equal(options.rejectUnauthorized,true);
    assert.equal(Number(options.port),443);
    let socket;
    if(options.host===ips[3]){
      socket=net.connect(server.address().port,'127.0.0.1',()=>socket.emit('secureConnect'));
    }else{
      socket=new net.Socket();
      // The first connection stalls after TCP; the next two reset before TLS.
      if(options.host!==ips[0])queueMicrotask(()=>socket.destroy(new Error('ECONNRESET')));
    }
    sockets.push(socket);
    return socket;
  });
  const result=await getRelease({repository});
  assert.equal(result.version,version);
  assert.deepEqual(attempts.slice(0,4),ips.map(ip=>['raw.githubusercontent.com',ip]));
  assert.deepEqual(urls,['/'+repository+'/update-channel/latest.json','/'+repository+'/releases/download/v'+version+'/update.json']);
  assert.ok(sockets.slice(0,3).every(s=>s.destroyed));
});

test('an update handshake deadline closes stalled sockets and reports the failing stage',async t=>{
  const dns=require('node:dns'),tls=require('node:tls'),net=require('node:net'),sockets=[];
  t.mock.method(dns,'lookup',(_host,_options,cb)=>queueMicrotask(()=>cb(null,[{address:'192.0.2.1',family:4}])));
  t.mock.method(tls,'connect',()=>{const socket=new net.Socket();sockets.push(socket);return socket;});
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',()=>timeout(20));
  const keepAlive=setInterval(()=>{},100);
  t.after(()=>clearInterval(keepAlive));
  const state=await createUpdateService({repository,currentVersion,updateDir:''}).check();
  assert.equal(state.state,'offline');
  assert.equal(state.stage,'发现更新版本');
  assert.equal(sockets.length,1);
  assert.equal(sockets[0].destroyed,true);
});

test('install keeps the checked version if Latest changes and writes the server-discovered image pin',async t=>{
  const f=await fixture(t);let latestCalls=0;
  const service=createUpdateService({...f.config,fetchImpl:async(url,options)=>{
    if(url===channel+'latest.json'&&++latestCalls>1)throw new Error('Latest is unavailable after selection');
    return f.remote.fetchImpl(url,options);
  }});
  assert.equal((await service.check()).state,'available');await service.check();await service.status();assert.equal(f.remote.calls.length,2);
  const submitted=await service.request({version});assert.equal(submitted.state,'queued');assert.equal(latestCalls,1);
  assert.deepEqual(f.remote.calls.map(call=>call.url),[channel+'latest.json',assetUrl,channel+'versions/v'+version+'.json',assetUrl]);
  const job=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));
  assert.deepEqual(Object.keys(job).sort(),['expectedImage','id','previousVersion','version']);assert.equal(job.expectedImage,image);assert.equal(job.previousVersion,currentVersion);
  assert.equal((await service.status()).job.id,job.id);assert.equal((await service.check()).state,'queued');assert.equal(f.remote.calls.length,4);
  await assert.rejects(service.request({version}),{code:'UPDATE_BUSY'});
  await assert.rejects(service.request({version,image:'evil'}),{code:'UPDATE_INVALID'});
});

test('new web code with a v0.13.20 host writes the exact old request accepted by its strict validator',async t=>{
  const f=await fixture(t,{workerSchema:1});await f.service.check();assert.equal((await f.service.status()).workerRequestSchema,1);
  await f.service.request({version});const job=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));
  assert.deepEqual(Object.keys(job).sort(),['id','previousVersion','version']);assert.deepEqual(validateV01320Request(job),job);
  assert.throws(()=>validateV01320Request({...job,expectedImage:image}),/格式无效/);
  assert.deepEqual(f.remote.calls.slice(2).map(call=>call.url),[channel+'versions/v'+version+'.json',assetUrl]);
});

test('request format follows the latest locked worker heartbeat if the host changes during confirmation',async t=>{
  const f=await fixture(t);await f.service.check();const service=createUpdateService({...f.config,fetchImpl:async(url,options)=>{
    const response=await f.remote.fetchImpl(url,options);
    if(url===assetUrl)await f.write('worker-ready.json',{updatedAt:publishedAt});
    return response;
  }});
  const submitted=await service.request({version}),job=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));assert.equal(submitted.job.expectedImage,undefined);assert.deepEqual(validateV01320Request(job),{id:submitted.job.id,version,previousVersion:currentVersion});
});

test('unknown or withdrawn versions cannot queue and missing channel records never enable legacy fallback',async t=>{
  const f=await fixture(t),unknown=createUpdateService({...f.config,fetchImpl:async url=>url.endsWith('channel.json')?Response.json({schema:1}):new Response('',{status:404})});
  await assert.rejects(unknown.request({version:'9.0.0'}),{code:'UPDATE_CHANGED'});
  let removed=false;
  const service=createUpdateService({...f.config,fetchImpl:async(url,options)=>{
    if(removed&&url===channel+'versions/v'+version+'.json')return new Response('',{status:404});
    assert(url.startsWith(channel)||url===assetUrl,'withdrawal must not enable legacy fallback');
    return f.remote.fetchImpl(url,options);
  }});
  await service.check();removed=true;
  await assert.rejects(service.request({version}),{code:'UPDATE_CHANGED'});
  await assert.rejects(fs.access(path.join(f.directory,'request.json')),{code:'ENOENT'});
});

test('a replaced attachment or channel digest cannot change a selected image',async t=>{
  for(const replaceRecord of [false,true]){
    const f=await fixture(t);let changed=false;const next='ghcr.io/'+repository+'@sha256:'+'b'.repeat(64);
    const service=createUpdateService({...f.config,fetchImpl:async(url,options)=>{
      if(changed&&url===assetUrl)return Response.json({version,image:next});
      if(changed&&replaceRecord&&url===channel+'versions/v'+version+'.json')return Response.json({...record,image:next});
      return f.remote.fetchImpl(url,options);
    }});
    await service.check();changed=true;
    await assert.rejects(service.request({version}),error=>['UPDATE_CHANGED','UPDATE_INVALID_FEED'].includes(error.code));
    await assert.rejects(fs.access(path.join(f.directory,'request.json')),{code:'ENOENT'});
  }
});

test('a different app process safely recovers the fixed official target without a prior local selection',async t=>{
  const f=await fixture(t);await f.service.check();const remote=feed(),other=createUpdateService({...f.config,fetchImpl:remote.fetchImpl});
  const submitted=await other.request({version});assert.equal(submitted.job.expectedImage,image);
  assert.deepEqual(remote.calls.map(call=>call.url),[channel+'versions/v'+version+'.json',assetUrl]);
  for(const input of [{version,expectedImage:image},{version,url:assetUrl}])await assert.rejects(other.request(input),{code:'UPDATE_INVALID'});
});

test('canonical attachment redirects allow GitHub assets and reject foreign destinations before connecting',async()=>{
  for(const target of ['https://release-assets.githubusercontent.com/github-production-release-asset/123/update.json?signature=public','https://objects.githubusercontent.com/github-production-release-asset-2e65be/123/update.json?signature=public']){
    const remote=feed(),calls=[];
    const release=await getRelease({repository,version,fetchImpl:async(url,options)=>{
      calls.push({url,options});if(url===assetUrl)return new Response(null,{status:302,headers:{Location:target}});
      return url===target?Response.json({version,image}):remote.fetchImpl(url,options);
    }});
    assert.equal(release.image,image);assert.equal(calls.length,3);assert.equal(calls[1].options.redirect,'manual');
  }
  for(const target of ['http://127.0.0.1/private','https://attacker.example/update.json','https://release-assets.githubusercontent.com/untrusted/update.json','https://user:secret@objects.githubusercontent.com/github-production-release-asset/123/update.json','https://github.com/other/repository/releases/download/v0.12.1/update.json']){
    const remote=feed(),calls=[];
    await assert.rejects(getRelease({repository,version,fetchImpl:async(url,options)=>{
      calls.push(url);return url===assetUrl?new Response(null,{status:302,headers:{Location:target}}):remote.fetchImpl(url,options);
    }}),{code:'UPDATE_INVALID_FEED'});assert.equal(calls.length,2);
  }
  const remote=feed();let redirects=0;
  await assert.rejects(getRelease({repository,version,fetchImpl:(url,options)=>url===assetUrl?(redirects++,Promise.resolve(new Response(null,{status:302,headers:{Location:assetUrl}}))):remote.fetchImpl(url,options)}),{code:'UPDATE_INVALID_FEED'});
  assert.equal(redirects,6);
});

test('channel rejects nonstable tags, invalid records, untrusted images and attachment mismatches',async()=>{
  const examples=[{release:{version:'0.13.0-beta.1'}},{release:{version:'v'+version}},{release:{publishedAt:'invalid'}},{release:{notes:3}},{release:{image:'ghcr.io/other/repository@sha256:'+'a'.repeat(64)}},{manifest:{version:'0.13.0'}},{manifest:{image:'ghcr.io/'+repository+':latest'}},{manifest:{image:image.toUpperCase()}},{manifest:{image:image+'; touch /tmp/injection'}}];
  for(const example of examples)await assert.rejects(getRelease({repository,fetchImpl:feed(example).fetchImpl}),{code:'UPDATE_INVALID_FEED'});
  await assert.rejects(getRelease({repository:'https://evil.example/repo',fetchImpl:()=>assert.fail('invalid config fetched')}));
  await assert.rejects(getRelease({repository,version:'0.13.0',fetchImpl:feed().fetchImpl}),{code:'UPDATE_INVALID_FEED'});
});

test('legacy repositories use fixed trusted JSON metadata and reject drafts, prereleases or inconsistent assets',async()=>{
  for(const overrides of [{},{draft:true},{prerelease:true},{tag_name:'v0.12.2'},{html_url:'https://github.com/other/repo/releases/tag/v'+version},{assets:[]}]){
    const calls=[],run=getRelease({repository,version,fetchImpl:async url=>{
      calls.push(url);if(url.startsWith(channel))return new Response('',{status:404});
      if(url===assetUrl)return Response.json({version,image});
      assert.equal(url,'https://api.github.com/repos/'+repository+'/releases/tags/v'+version);return Response.json(legacyMetadata(overrides));
    }});
    if(Object.keys(overrides).length)await assert.rejects(run,{code:'UPDATE_INVALID_FEED'});else assert.equal((await run).image,image);
    assert(!calls.some(url=>url.endsWith('/latest')));
  }
});

test('legacy Android Latest falls back to stable server JSON releases and skips prereleases',async()=>{
  const base='https://api.github.com/repos/'+repository+'/releases',calls=[],android={tag_name:'android-v0.1.2',draft:false,prerelease:false};
  const release=await getRelease({repository,fetchImpl:async url=>{
    calls.push(url);if(url.startsWith(channel))return new Response('',{status:404});
    if(url===base+'/latest')return Response.json(android);
    if(url===base+'?per_page=20&page=1')return Response.json([android],{headers:{Link:'<https://api.github.com/>; rel="next"'}});
    if(url===base+'?per_page=20&page=2')return Response.json([legacyMetadata({tag_name:'v0.12.2',prerelease:true}),legacyMetadata()]);
    assert.equal(url,assetUrl);return Response.json({version,image});
  }});
  assert.equal(release.version,version);assert.equal(calls.length,6);
});

test('missing release, current version, disabled source and stage-specific rate limits remain distinct',async t=>{
  const missing=createUpdateService({repository,currentVersion,updateDir:'',fetchImpl:async url=>url.endsWith('channel.json')?Response.json({schema:1}):new Response('',{status:404})});
  assert.equal((await missing.check()).state,'no-release');
  assert.equal((await createUpdateService({repository,currentVersion:version,fetchImpl:feed().fetchImpl}).check()).state,'ok');
  assert.equal((await createUpdateService({repository:'',currentVersion,fetchImpl:()=>assert.fail('disabled config fetched')}).check()).state,'disabled');
  const f=await fixture(t,{fetchError:new Error('secret upstream details')}),offline=await f.service.check();
  assert.equal(offline.state,'offline');assert.match(offline.reason,/发现更新版本/);assert(!offline.reason.includes('secret'));
  const limited=await createUpdateService({repository,currentVersion,fetchImpl:async()=>new Response('',{status:403,headers:{'X-RateLimit-Remaining':'0'}})}).check();
  assert.equal(limited.code,'UPDATE_RATE_LIMIT');assert.match(limited.reason,/发现更新版本.*限制.*403/);
  const old=await createUpdateService({repository,currentVersion,fetchImpl:async url=>url.startsWith(channel)?new Response('',{status:404}):new Response('',{status:429,headers:{'Retry-After':'90'}})}).check();
  assert.equal(old.code,'UPDATE_RATE_LIMIT');assert.match(old.reason,/发现旧仓库版本.*429.*90 秒/);
});

test('stale workers cannot queue and polling preserves every phase without network traffic',async t=>{
  const stale=await fixture(t);await stale.service.check();stale.advance(61000);
  await assert.rejects(stale.service.request({version}),{code:'UPDATE_WORKER_OFFLINE'});
  const f=await fixture(t);await f.service.check();const first=await f.service.request({version}),job=first.job,before=f.remote.calls.length;
  for(const phase of ['checking','downloading','backing-up','installing','verifying','rolling-back','rolled-back']){
    await f.write('status.json',{...job,phase,startedAt:publishedAt,updatedAt:publishedAt,message:'正在更新'});
    const result=await f.service.status();assert.equal(result.job.phase,phase);assert.equal(result.state,phase==='rolled-back'?'ok':'queued');
  }
  assert.equal(f.remote.calls.length,before);assert.notEqual((await f.service.request({version})).job.id,job.id);
});

test('parallel app instances preserve one complete active request',async t=>{
  const f=await fixture(t),other=createUpdateService({...f.config,fetchImpl:feed().fetchImpl});await Promise.all([f.service.check(),other.check()]);
  const results=await Promise.allSettled([f.service.request({version}),other.request({version})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'UPDATE_BUSY');
  const job=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));
  await assert.rejects(other.request({version}),{code:'UPDATE_BUSY'});assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8')),job);
  assert.deepEqual((await fs.readdir(f.directory)).sort(),['request.json','worker-ready.json']);
});

test('separate Node processes cannot overwrite a queued fixed-version request',async t=>{
  const f=await fixture(t),modulePath=path.resolve(__dirname,'../lib/updates.cjs');
  const source="const {createUpdateService}=require(process.argv[1]);const config=JSON.parse(process.argv[2]);const record="+JSON.stringify(record)+";const service=createUpdateService({...config,now:()=>Date.parse("+JSON.stringify(publishedAt)+"),fetchImpl:async url=>Response.json(url.startsWith('https://raw.githubusercontent.com/')?record:{version:record.version,image:record.image})});service.check().then(()=>service.request({version:record.version})).then(x=>console.log(JSON.stringify({ok:true,id:x.job.id})),e=>console.log(JSON.stringify({ok:false,code:e.code})));";
  function run(){return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',source,modulePath,JSON.stringify({repository,currentVersion,updateDir:f.directory})],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(new Error(errors)));
  });}
  const results=await Promise.all([run(),run(),run()]);assert.equal(results.filter(r=>r.ok).length,1);assert(results.filter(r=>!r.ok).every(r=>r.code==='UPDATE_BUSY'));
});

test('malformed shared state fails visibly without overwriting the request',async t=>{
  const f=await fixture(t);await f.write('request.json',{id:'kept',version:'bad',previousVersion:currentVersion});
  assert.equal((await f.service.check()).state,'offline');await assert.rejects(f.service.request({version}));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8')).id,'kept');
});

test('official default and host readiness remain separate from release availability',async()=>{
  const result=await createUpdateService({currentVersion,updateDir:'',fetchImpl:async url=>{
    if(url.includes('.personal.cr.aliyuncs.com/'))return new Response(null,{status:404});
    assert(url.startsWith('https://raw.githubusercontent.com/chouoi344/pipi-phone/update-channel/'));
    return url.endsWith('channel.json')?Response.json({schema:1}):new Response('',{status:404});
  }}).check();
  assert.equal(result.repository,'chouoi344/pipi-phone');assert.equal(result.state,'no-release');assert.equal(result.canUpdate,false);
  const available=await createUpdateService({repository,currentVersion,updateDir:'',fetchImpl:feed().fetchImpl}).check();
  assert.equal(available.state,'available');assert.equal(available.canUpdate,false);assert.match(available.reason,/未启用一键更新/);
});
