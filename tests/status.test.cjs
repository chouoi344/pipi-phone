// SPDX-License-Identifier: MIT
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createApp}=require('../server.cjs');
const S=require('../lib/state.cjs');
const PASSWORD='Status-test-isolated_2026!';
const DAY=86400000;

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-status-'));
  let app,base,cookie='',csrf='';
  const start=async()=>{app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();base='http://127.0.0.1:'+app.server.address().port;};
  await start();
  t.after(async()=>{await app.close();const target=path.resolve(dir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('pipi-status-'));await fs.rm(target,{recursive:true,force:true});});
  async function request(route,body){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    const json=await response.json(),setCookie=response.headers.get('set-cookie');
    if(setCookie)cookie=setCookie.split(';')[0];if(json.csrfToken)csrf=json.csrfToken;
    return {status:response.status,json};
  }
  ok(await request('/api/setup',{password:PASSWORD,displayName:'Status QA'}));
  return {request,action:(type,payload)=>request('/api/action',{type,payload}),state:async()=>ok(await request('/api/state')),backup:async()=>ok(await request('/api/backup')),restart:async()=>{await app.close();await start();ok(await request('/api/login',{password:PASSWORD}));}};
}
function ok(response){assert.equal(response.status,200,JSON.stringify(response.json));return response.json;}
function rejected(response){assert.ok(response.status>=400&&response.status<500,JSON.stringify(response));assert.ok(response.json.error);}

test('status: server timestamps, partial profile edits, sessions, restart and backup retain current status',async t=>{
  const f=await fixture(t);assert.equal((await f.state()).profile.status,null);
  const before=Date.now();ok(await f.action('status.save',{preset:'happy',description:'  今天也不错 🐱  ',startedAt:1,expiresAt:2}));
  const saved=(await f.state()).profile.status;
  assert.equal(saved.preset,'happy');assert.equal(saved.description,'今天也不错 🐱');assert.ok(saved.startedAt>=before&&saved.startedAt<=Date.now());assert.equal(saved.expiresAt-saved.startedAt,DAY);
  ok(await f.action('profile.save',{name:'Changed name',status:null}));assert.deepEqual((await f.state()).profile.status,saved);
  ok(await f.request('/api/login',{password:PASSWORD}));assert.deepEqual((await f.state()).profile.status,saved,'new login shares server state');
  await f.restart();assert.deepEqual((await f.state()).profile.status,saved);
  const backup=await f.backup();ok(await f.action('status.end',{}));assert.equal((await f.state()).profile.status,null);
  ok(await f.request('/api/restore',{backup,confirm:true}));assert.deepEqual((await f.state()).profile.status,saved);
  ok(await f.action('status.end',{}));ok(await f.action('status.end',{}));assert.equal((await f.state()).profile.status,null,'ending is idempotent');
});

test('status: whitelist, Unicode length, plain strings and hostile payloads validate atomically',async t=>{
  const f=await fixture(t);
  for(const preset of ['happy','daze','busy','focus','fish','work','travel','exercise','coffee','rest','music','game','sleep','other'])ok(await f.action('status.save',{preset,description:''}));
  const literal='<img src=x onerror="alert(1)"> & "quoted"';
  ok(await f.action('status.save',{preset:'other',description:literal}));assert.equal((await f.state()).profile.status.description,literal);
  ok(await f.action('status.save',{preset:'focus',description:'🐱'.repeat(60)}));assert.equal([...(await f.state()).profile.status.description].length,60);
  const before=await f.state();
  for(const payload of [null,[],{}, {preset:null},{preset:{}},{preset:['happy']},{preset:'__proto__'},{preset:'constructor'},{preset:'<script>'},{preset:'not-real'},{preset:'happy',description:12},{preset:'happy',description:{}},{preset:'happy',description:null},{preset:'happy',description:'x'.repeat(61)},{preset:'happy',description:'🐱'.repeat(61)},{preset:'happy',description:'line\nbreak'},{preset:'happy',description:'bad\u0000data'},{preset:'happy',description:'bad\u2028data'},{preset:'happy',description:'bad\uD800data'}]){
    rejected(await f.action('status.save',payload));assert.deepEqual(await f.state(),before,'invalid status must not modify state or revision');
  }
  ok(await f.action('status.save',{preset:'rest',description:'   '}));assert.equal((await f.state()).profile.status.description,'');
});

test('status: corrupt restore is atomic, fields rebuild safely and old backups reset status',async t=>{
  const f=await fixture(t);ok(await f.action('status.save',{preset:'busy',description:'Keep this'}));const saved=await f.backup(),before=await f.state();
  for(const corrupt of [b=>{b.state.profile.status=[];},b=>{b.state.profile.status='busy';},b=>{b.state.profile.status.preset='unsafe';},b=>{b.state.profile.status.description='x'.repeat(61);},b=>{delete b.state.profile.status.startedAt;},b=>{b.state.profile.status.startedAt=-1;},b=>{b.state.profile.status.expiresAt='tomorrow';},b=>{b.state.profile.status.expiresAt++;},b=>{b.state.profile.status.expiresAt=Number.MAX_SAFE_INTEGER;}]){
    const bad=structuredClone(saved);corrupt(bad);rejected(await f.request('/api/restore',{backup:bad,confirm:true}));assert.deepEqual(await f.state(),before);
  }
  const extras=structuredClone(saved);extras.state.profile.status.fakeFriends=['Someone'];extras.state.profile.status.html='<script>';
  ok(await f.request('/api/restore',{backup:extras,confirm:true}));assert.deepEqual((await f.state()).profile.status,before.profile.status);
  const legacy=structuredClone(saved);delete legacy.state.profile.status;ok(await f.request('/api/restore',{backup:legacy,confirm:true}));assert.equal((await f.state()).profile.status,null);
  const empty=structuredClone(saved);empty.state.profile.status=null;ok(await f.request('/api/restore',{backup:empty,confirm:true}));assert.equal((await f.state()).profile.status,null);
});

test('status: expiry uses server projection without extending a restored status',async t=>{
  const f=await fixture(t);ok(await f.action('status.save',{preset:'rest',description:'Expired'}));const expired=await f.backup();
  expired.state.profile.status.startedAt=Date.now()-DAY-1000;expired.state.profile.status.expiresAt=expired.state.profile.status.startedAt+DAY;
  ok(await f.request('/api/restore',{backup:expired,confirm:true}));assert.equal((await f.state()).profile.status,null);assert.equal((await f.backup()).state.profile.status,null);
  const legacy=sampleState();delete legacy.profile.status;assert.equal(S.publicState(legacy).profile.status,null);assert.equal(legacy.profile.status,undefined,'public projection must not mutate stored data');
});
