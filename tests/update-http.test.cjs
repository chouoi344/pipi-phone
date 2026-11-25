// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const repository='isolated/pipi-phone',password='Isolated-update-HTTP-2026!';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-update-http-')),dataDir=path.join(root,'data'),updateDir=path.join(root,'updates');
  await fs.mkdir(updateDir);
  const calls=[];let latestVersion='0.12.1',networkFailed=false,app,base,cookie='',csrf='',port=0;
  async function write(name,value){const filename=path.join(updateDir,name),tmp=filename+'.tmp';await fs.writeFile(tmp,JSON.stringify(value));await fs.rename(tmp,filename);}
  const fetchImpl=async(url)=>{
    calls.push(url);if(networkFailed)throw new Error('Isolated GitHub connection failure');
    assert(!url.includes('api.github.com'));
    const selected=/\/(?:versions\/|download\/)v(\d+\.\d+\.\d+)(?:\.json|\/update\.json)$/.exec(url)?.[1]||latestVersion;
    return Response.json({version:selected,image:'ghcr.io/'+repository+'@sha256:'+'b'.repeat(64),...(url.startsWith('https://raw.githubusercontent.com/')?{publishedAt:new Date().toISOString(),notes:'隔离更新说明 '+selected}:{})});
  };
  async function start(currentVersion='0.12.0'){
    app=createApp({dataDir,host:'127.0.0.1',port,providerUrlAllowlist:[],updates:{repository,currentVersion,updateDir,fetchImpl}});await app.listen();port=app.server.address().port;base='http://127.0.0.1:'+port;
  }
  async function request(route,body,{anonymous=false,headers={}}={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(anonymous?{}:{Cookie:cookie}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json',...(!anonymous&&csrf?{'X-CSRF-Token':csrf}:{})}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,value};
  }
  await write('worker-ready.json',{updatedAt:new Date().toISOString(),requestSchema:2});await start();
  t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
  const setup=await request('/api/setup',{password,displayName:'隔离HTTP更新验收'});assert.equal(setup.status,200,JSON.stringify(setup.value));
  return {request,calls,write,updateDir,get app(){return app;},set latest(version){latestVersion=version;},set offline(value){networkFailed=value;},async phase(job,phase){await write('status.json',{...job,phase,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),message:phase==='rolled-back'?'新版验证未通过，已恢复旧版':'隔离阶段 '+phase});},async restart(version){await app.close();await start(version);}};
}

test('update HTTP routes require login and same-origin CSRF before any request is written',async t=>{
  const f=await fixture(t);
  for(const route of ['/api/updates/check','/api/updates/status'])assert.equal((await f.request(route,undefined,{anonymous:true})).status,401);
  assert.equal((await f.request('/api/updates/install',{version:'0.12.1'},{anonymous:true})).status,401);
  const csrf=await f.request('/api/updates/install',{version:'0.12.1'},{headers:{'X-CSRF-Token':''}});assert.equal(csrf.status,403);assert.equal(csrf.value.code,'CSRF');
  assert.equal((await f.request('/api/updates/install',{version:'0.12.1'},{headers:{Origin:'https://other.example'}})).status,403);
  await assert.rejects(fs.access(path.join(f.updateDir,'request.json')),{code:'ENOENT'});assert.equal(f.calls.length,0);
});

test('available release queues once and HTTP status polling returns structured current phases without GitHub calls',async t=>{
  const f=await fixture(t),available=await f.request('/api/updates/check');assert.equal(available.status,200);assert.equal(available.value.state,'available');
  const install=await f.request('/api/updates/install',{version:'0.12.1'});assert.equal(install.status,202);assert.equal(install.value.job.phase,'queued');
  assert.equal((await f.request('/api/updates/install',{version:'0.12.1'})).status,409);
  const before=f.calls.length;
  for(const phase of ['checking','downloading','backing-up','installing','verifying','succeeded']){
    await f.phase(install.value.job,phase);const status=await f.request('/api/updates/status');assert.equal(status.status,200);assert.equal(status.value.job?.phase,phase,JSON.stringify(status.value));
  }
  assert.equal(f.calls.length,before);
});

test('backup, install, verification and rollback block business writes while reads continue and downloads permit writes',async t=>{
  const f=await fixture(t);await f.request('/api/updates/check');const install=await f.request('/api/updates/install',{version:'0.12.1'}),job=install.value.job;
  await f.phase(job,'downloading');assert.equal((await f.request('/api/action',{type:'profile.save',payload:{name:'下载时保存成功'}})).status,200);
  const before=(await f.request('/api/state')).value;
  for(const phase of ['backing-up','installing','verifying','rolling-back']){
    await f.phase(job,phase);
    const save=await f.request('/api/action',{type:'profile.save',payload:{name:'不应写入'}});assert.equal(save.status,503);assert.equal(save.value.code,'UPDATE_IN_PROGRESS');
    const state=await f.request('/api/state');assert.equal(state.status,200);assert.equal(state.value.profile.name,before.profile.name);
  }
  await f.phase(job,'rolled-back');assert.equal((await f.request('/api/action',{type:'profile.save',payload:{name:'恢复后保存成功'}})).status,200);
});

test('fixed-version install survives Latest changing while offline requests and client-selected images stay blocked',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/api/updates/check')).value.state,'available');
  f.offline=true;const failed=await f.request('/api/updates/check?refresh=1');assert.equal(failed.status,200);assert.equal(failed.value.state,'offline');
  assert.equal((await f.request('/api/updates/install',{version:'0.12.1'})).status,503);
  f.offline=false;f.latest='0.12.2';const start=f.calls.length;assert.equal((await f.request('/api/updates/install',{version:'0.12.1'})).status,202);
  assert(f.calls.slice(start).every(url=>!url.endsWith('latest.json')));
  assert.equal((await f.request('/api/updates/install',{version:'0.12.2',image:'evil'})).status,400);
  const job=JSON.parse(await fs.readFile(path.join(f.updateDir,'request.json'),'utf8'));assert.equal(job.version,'0.12.1');assert.match(job.expectedImage,/@sha256:[b]{64}$/);
});

test('app restart retains session, queued task and terminal result across versions without changing saved profile',async t=>{
  const f=await fixture(t);await f.request('/api/action',{type:'profile.save',payload:{name:'重启后保留的资料'}});
  await f.request('/api/updates/check');
  const install=await f.request('/api/updates/install',{version:'0.12.1'});assert.equal(install.status,202);
  await f.restart('0.12.0');let result=await f.request('/api/updates/status');assert.equal(result.status,200);assert.equal(result.value.job?.id,install.value.job.id);
  await f.phase(install.value.job,'succeeded');await f.restart('0.12.1');result=await f.request('/api/updates/status');assert.equal(result.value.job.phase,'succeeded');assert.equal(result.value.currentVersion,'0.12.1');
  assert.equal((await f.request('/api/state')).value.profile.name,'重启后保留的资料');
  f.latest='0.12.2';await f.request('/api/updates/check?refresh=1');const second=await f.request('/api/updates/install',{version:'0.12.2'});assert.equal(second.status,202);assert.equal(second.value.job.previousVersion,'0.12.1');
  await f.phase(second.value.job,'rolled-back');await f.restart('0.12.1');result=await f.request('/api/updates/status');assert.equal(result.value.job.phase,'rolled-back');assert.match(result.value.job.message,/已恢复旧版/);
});
