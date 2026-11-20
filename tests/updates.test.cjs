// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createUpdateService,getRelease,compareVersions}=require('../lib/updates.cjs');
const repository='example/pipi-phone',currentVersion='0.12.0',version='0.12.1';
const image='ghcr.io/'+repository+'@sha256:'+'a'.repeat(64);
const publishedAt='2026-11-20T10:00:00.000Z';
function feed({release={},manifest={},status=200,fetchError}={}){
  const calls=[],metadata={tag_name:'v'+version,draft:false,prerelease:false,html_url:'https://github.com/'+repository+'/releases/tag/v'+version,published_at:publishedAt,body:'更新说明 <script>不会执行</script>',assets:[{name:'update.json',state:'uploaded',browser_download_url:'https://github.com/'+repository+'/releases/download/v'+version+'/update.json'}],...release};
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(fetchError)throw fetchError;
    return Response.json(calls.length%2===1?metadata:{version,image,...manifest},{status:calls.length%2===1?status:200});
  };
  return {fetchImpl,calls,metadata};
}
async function fixture(t,options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-updates-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let clock=Date.parse(publishedAt);
  const write=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value));
  await write('worker-ready.json',{updatedAt:publishedAt});
  const remote=feed(options);
  const config={repository,currentVersion,updateDir:directory,fetchImpl:remote.fetchImpl,now:()=>clock};
  return {directory,write,remote,config,service:createUpdateService(config),advance(ms){clock+=ms;}};
}

test('stable release accepts only its attached canonical digest image and makes unauthenticated fixed-origin requests',async()=>{
  const remote=feed(),release=await getRelease({repository:'Example/Pipi-Phone',fetchImpl:remote.fetchImpl});
  assert.equal(release.version,version);assert.equal(release.image,image);assert.equal(release.notes,'更新说明 <script>不会执行</script>');
  assert.deepEqual(remote.calls.map(x=>x.url),['https://api.github.com/repos/'+repository+'/releases/latest','https://github.com/'+repository+'/releases/download/v'+version+'/update.json']);
  for(const call of remote.calls)assert.equal(call.options.headers.Authorization,undefined);
  const tagged=feed();await getRelease({repository,version,fetchImpl:tagged.fetchImpl});
  assert.equal(tagged.calls[0].url,'https://api.github.com/repos/'+repository+'/releases/tags/v'+version);
  assert.equal(compareVersions('0.12.10','0.12.9'),1);assert.equal(compareVersions('0.12.0','0.12.0'),0);assert.equal(compareVersions('0.9.0','0.12.0'),-1);
});

test('release rejects prereleases, drafts, inconsistent tags, misdirected assets and mismatched manifests',async()=>{
  const examples=[
    {release:{draft:true}},{release:{prerelease:true}},{release:{tag_name:'v0.13.0-beta.1'}},
    {release:{tag_name:'0.12.1'}},{release:{html_url:'https://github.com/other/repository/releases/tag/v'+version}},
    {release:{assets:[]}},{release:{assets:[{name:'update.json',state:'uploaded',browser_download_url:'http://127.0.0.1/private'}]}},
    {manifest:{version:'0.13.0'}},{manifest:{image:'ghcr.io/other/repository@sha256:'+'a'.repeat(64)}},
    {manifest:{image:'ghcr.io/'+repository+':latest'}},{manifest:{image:'ghcr.io/'+repository+'@sha256:'+'A'.repeat(64)}},
    {manifest:{image:image+'; touch /tmp/injection'}},{manifest:{image:'https://'+image}},
  ];
  for(const example of examples){const remote=feed(example);await assert.rejects(getRelease({repository,fetchImpl:remote.fetchImpl}),Error);assert(remote.calls.every(call=>!call.url.includes('127.0.0.1')));}
  await assert.rejects(getRelease({repository:'https://evil.example/repo',fetchImpl:()=>assert.fail('invalid config fetched')}));
  const remote=feed();await assert.rejects(getRelease({repository,version:'0.13.0',fetchImpl:remote.fetchImpl}),/请求版本/);
});

test('missing releases, up-to-date versions, disabled configuration and an offline feed are distinct',async t=>{
  const missing=createUpdateService({repository,currentVersion,updateDir:'',fetchImpl:async()=>new Response('',{status:404})});
  const noRelease=await missing.check();assert.equal(noRelease.state,'ok');assert.equal(noRelease.release,undefined);assert.equal(noRelease.canUpdate,false);
  const latest=createUpdateService({repository,currentVersion:version,updateDir:'',fetchImpl:feed().fetchImpl});assert.equal((await latest.check()).state,'ok');
  const disabled=createUpdateService({repository:'',currentVersion,updateDir:'',fetchImpl:()=>assert.fail('disabled config fetched')});assert.equal((await disabled.check()).state,'disabled');
  const f=await fixture(t,{fetchError:new Error('secret upstream details')});
  const result=await f.service.check();assert.equal(result.state,'offline');assert.equal(result.canUpdate,false);assert(!result.reason.includes('secret'));
});

test('release checks cache results, status polling never fetches, and installing forces a fresh trusted release',async t=>{
  const f=await fixture(t);
  assert.equal((await f.service.check()).state,'available');assert.equal(f.remote.calls.length,2);
  await f.service.check();await f.service.status();assert.equal(f.remote.calls.length,2);
  const submitted=await f.service.request({version});assert.equal(f.remote.calls.length,4);assert.equal(submitted.state,'queued');assert.equal(submitted.job.phase,'queued');
  const request=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));
  assert.deepEqual(Object.keys(request).sort(),['id','previousVersion','version']);assert.equal(request.previousVersion,currentVersion);
  assert.equal((await f.service.status()).job.id,request.id);assert.equal((await f.service.check()).state,'queued');assert.equal(f.remote.calls.length,4);
  await assert.rejects(f.service.request({version}),{status:409,code:'UPDATE_BUSY'});
  await assert.rejects(f.service.request({version,image:'bad'}),{status:400,code:'UPDATE_INVALID'});
});

test('stale worker and unavailable current release cannot queue a request',async t=>{
  const f=await fixture(t);f.advance(61000);
  assert.equal((await f.service.check()).state,'available');assert.equal((await f.service.status()).workerAvailable,false);
  await assert.rejects(f.service.request({version}),{status:503,code:'UPDATE_WORKER_OFFLINE'});
  const changed=await fixture(t,{manifest:{version:'0.13.0'}});await assert.rejects(changed.service.request({version}),{code:'UPDATE_OFFLINE'});
  const f2=await fixture(t);await assert.rejects(f2.service.request({version:'0.11.0'}),{code:'UPDATE_CHANGED'});
  await assert.rejects(fs.access(path.join(f2.directory,'request.json')),{code:'ENOENT'});
});

test('a removed release is rechecked after an earlier available result and never submitted from cache',async t=>{
  const f=await fixture(t);let removed=false;
  const service=createUpdateService({...f.config,fetchImpl:(url,options)=>removed?Promise.resolve(new Response('',{status:404})):f.remote.fetchImpl(url,options)});
  assert.equal((await service.check()).state,'available');removed=true;
  await assert.rejects(service.request({version}),{code:'UPDATE_CHANGED'});
  await assert.rejects(fs.access(path.join(f.directory,'request.json')),{code:'ENOENT'});
});

test('terminal status allows the next request and all phases remain visible without network traffic',async t=>{
  const f=await fixture(t),first=await f.service.request({version}),job=first.job;
  for(const phase of ['checking','downloading','backing-up','installing','verifying','rolling-back','rolled-back']){
    await f.write('status.json',{...job,phase,startedAt:publishedAt,updatedAt:publishedAt,message:'正在更新'});
    const result=await f.service.status();assert.equal(result.job.phase,phase);assert.equal(result.state,phase==='rolled-back'?'ok':'queued');
  }
  const second=await f.service.request({version});assert.notEqual(second.job.id,job.id);assert.equal(second.job.phase,'queued');
  assert.equal((await f.service.status()).job.id,second.job.id);
});

test('parallel app instances submit one complete request and preserve an existing active task',async t=>{
  const f=await fixture(t),other=createUpdateService({...f.config,fetchImpl:feed().fetchImpl});
  const results=await Promise.allSettled([f.service.request({version}),other.request({version})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'UPDATE_BUSY');
  const job=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));
  assert.equal((await f.service.status()).job.id,job.id);
  await assert.rejects(other.request({version}),{code:'UPDATE_BUSY'});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8')),job);
  assert.deepEqual((await fs.readdir(f.directory)).sort(),['request.json','worker-ready.json']);
});

test('separate Node processes cannot replace each other’s active request',async t=>{
  const f=await fixture(t),modulePath=path.resolve(__dirname,'../lib/updates.cjs');
  const source=`const {createUpdateService}=require(process.argv[1]);const config=JSON.parse(process.argv[2]);const release=${JSON.stringify(feed().metadata)};const manifest=${JSON.stringify({version,image})};const service=createUpdateService({...config,now:()=>Date.parse(${JSON.stringify(publishedAt)}),fetchImpl:async url=>Response.json(url.includes('api.github.com')?release:manifest)});service.request({version:${JSON.stringify(version)}}).then(x=>console.log(JSON.stringify({ok:true,id:x.job.id})),e=>console.log(JSON.stringify({ok:false,code:e.code})));`;
  function run(){return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',source,modulePath,JSON.stringify({repository,currentVersion,updateDir:f.directory})],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(new Error(errors)));
  });}
  const results=await Promise.all([run(),run(),run()]);assert.equal(results.filter(r=>r.ok).length,1);assert(results.filter(r=>!r.ok).every(r=>r.code==='UPDATE_BUSY'));
  const request=JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8'));assert.equal(request.id,results.find(r=>r.ok).id);
});

test('malformed shared state fails visibly and never overwrites the request',async t=>{
  const f=await fixture(t);await f.write('request.json',{id:'kept',version:'bad',previousVersion:currentVersion});
  assert.equal((await f.service.check()).state,'offline');await assert.rejects(f.service.request({version}));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'request.json'),'utf8')).id,'kept');
});
