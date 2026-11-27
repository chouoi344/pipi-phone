// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Set PIPI_LEGACY_SERVER_ROOT to the extracted v0.13.28 release, then run with node --test.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process'),{once}=require('node:events'),{DatabaseSync}=require('node:sqlite');
const current=path.resolve(__dirname,'..'),old=process.env.PIPI_LEGACY_SERVER_ROOT;
const password='Atomic-test-local-only-2026',requestId='storage-crash-request-01';

function seed(){
  const S=require('../lib/state.cjs'),registry=require('../lib/engine/registry.cjs'),state=S.initial();
  for(const module of registry.modules)if(module.settings.some(field=>field.key==='enabled'))state.settings.modules[module.id]={...registry.values(state,module.id),enabled:false};
  S.apply(state,'role.save',{name:'测试好友'});
  for(let i=0;i<16;i++)S.message(state,state.roles[0],'assistant','合成消息 '+i);
  return state;
}
async function open(root,dir,options={}){
  const {createApp}=require(path.join(root,'server.cjs'));
  const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,initialState:seed,providerUrlAllowlist:[],mediaTimers:false,resetPassword:false,updates:{updateDir:''},fcm:{credentialFile:''},...options});
  await app.listen();return {app,origin:'http://127.0.0.1:'+app.server.address().port};
}
function client(origin){
  let cookie='',csrf='';
  return async (route,body)=>{
    const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});
    const value=await response.json();
    assert.equal(response.status,200,value.error||route);
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(value.csrfToken)csrf=value.csrfToken;
    return value;
  };
}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-atomic-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
async function initialize(dir){
  const {app,origin}=await open(current,dir),call=client(origin);
  try{await call('/api/setup',{password});return await call('/api/state');}finally{await app.close();}
}
function disk(dir){
  const db=new DatabaseSync(path.join(dir,'pipi.sqlite'));
  try{
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row=>row.integrity_check),['ok']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const state=JSON.parse(db.prepare('SELECT json FROM app WHERE id=1').get().json);
    const pending=db.prepare('SELECT COUNT(*) AS n FROM requests WHERE id=?').get(requestId).n;
    return {state,pending};
  }finally{db.close();}
}
async function writer(){
  let stopAt;
  const {origin}=await open(current,process.argv[3],{storageProbe(phase){
    if(phase!==stopAt)return;
    process.send(phase);
    // Hold exactly after SQLite's UPDATE and before COMMIT, or after COMMIT and before the HTTP reply.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  }});
  process.on('message',phase=>{stopAt=phase;process.send('armed');});
  process.send(origin);
}
function register(){
  const test=require('node:test');
  test('four simultaneous HTTP writes match the sequential state, rows and revisions',async t=>{
    const root=fixture(t),first=path.join(root,'sequential'),parallel=path.join(root,'concurrent');
    const before=await initialize(first);fs.cpSync(first,parallel,{recursive:true});
    const roleId=before.roles[0].id,operations=[
      {type:'message.delete',payload:{id:before.messages[2].id}},
      {type:'conversation.pin',payload:{roleId,pinned:true}},
      {type:'message.delete',payload:{id:before.messages[9].id}},
      {type:'conversation.read',payload:{roleId}}
    ];
    async function execute(dir,concurrent){
      const {app,origin}=await open(current,dir),call=client(origin);
      try{
        await call('/api/login',{password});
        const revisions=[];
        const send=async operation=>revisions.push((await call('/api/action',operation)).state.revision);
        if(concurrent)await Promise.all(operations.map(send));else for(const operation of operations)await send(operation);
        assert.deepEqual(revisions.sort((a,b)=>a-b),[1,2,3,4].map(n=>before.revision+n));
        return await call('/api/state');
      }finally{await app.close();}
    }
    const a=await execute(first,false),b=await execute(parallel,true);
    assert.deepEqual(b,a);assert.equal(b.revision,before.revision+4);assert.equal(b.roles[0].unread,0);assert.equal(b.roles[0].pinned,true);
    assert.deepEqual(b.messages,before.messages.filter((_,i)=>i!==2&&i!==9));assert.deepEqual(disk(parallel),disk(first));
  });
  for(const phase of ['write','journal.after'])test('forced process termination at '+phase+' survives reopening on current and old releases',{timeout:30000},async t=>{
    assert.ok(old,'Set PIPI_LEGACY_SERVER_ROOT to the extracted 0.13.x release');
    assert.match(require(path.join(old,'package.json')).version,/^0\.13\./);
    const dir=fixture(t),before=await initialize(dir),initialDisk=disk(dir),roleId=before.roles[0].id;
    const child=fork(__filename,['--crash-writer',dir],{stdio:['ignore','inherit','inherit','ipc']});
    const exited=once(child,'exit');t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
    const receive=async()=>{const [value]=await once(child,'message',{signal:AbortSignal.timeout(10000)});return value;};
    const origin=await receive(),call=client(origin);await call('/api/login',{password});
    let next=receive();child.send(phase);assert.equal(await next,'armed');
    next=receive();
    const sending=phase==='write'?call('/api/chat',{roleId,text:'Uncommitted synthetic message',requestId}):call('/api/action',{type:'message.delete',payload:{id:before.messages[4].id}});
    const interrupted=assert.rejects(sending);assert.equal(await next,phase);
    assert.equal(child.kill('SIGKILL'),true);await exited;await interrupted;
    const stored=disk(dir),expected=structuredClone(before),expectedRaw=initialDisk.state;
    if(phase==='journal.after'){
      expected.messages.splice(4,1);expected.revision++;
      expectedRaw.messages.splice(4,1);expectedRaw.revision++;
    }
    assert.equal(stored.pending,0);assert.deepEqual(stored.state,expectedRaw);
    for(const version of [current,old]){
      const {app,origin}=await open(version,dir);
      try{const call=client(origin);await call('/api/login',{password});assert.deepEqual(await call('/api/state'),expected);}
      finally{await app.close();}
      assert.deepEqual(disk(dir),stored);
    }
  });
}
if(process.argv[2]==='--crash-writer')writer().catch(error=>{console.error(error);process.exit(1);});
else register();
