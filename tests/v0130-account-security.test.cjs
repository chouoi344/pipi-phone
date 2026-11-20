// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createApp}=require('../server.cjs'),Proxy=require('../lib/trusted-proxy.cjs');
const PASSWORD='Original-password-0130',NEW_PASSWORD='Changed-password-0130';
async function fixture(t,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-account-0130-'));let app,origin;
  async function start(extra={}){app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',resetPassword:false,providerUrlAllowlist:[],...options,...extra});await app.listen();origin='http://127.0.0.1:'+app.server.address().port;}
  await start();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  function device(){
    const d={cookie:'',csrf:''};
    d.request=async(route,body,headers={})=>{
      const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Cookie:d.cookie,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':d.csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value=await response.json();
      if(response.headers.has('set-cookie'))d.cookie=response.headers.get('set-cookie').split(';')[0];
      if(value.csrfToken)d.csrf=value.csrfToken;
      return {status:response.status,value,headers:response.headers};
    };
    return d;
  }
  return {device,get app(){return app;},get origin(){return origin;},dataDir,token:()=>fs.readFileSync(path.join(dataDir,'setup-token.txt'),'utf8').trim(),async restart(extra={}){await app.close();await start(extra);}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
const pw=(currentPassword=PASSWORD,newPassword=NEW_PASSWORD,confirmPassword=newPassword)=>({currentPassword,newPassword,confirmPassword});

test('proxy address resolution trusts only the immediate peer, then walks the chain right to left',()=>{
  const req=(peer,headers={},encrypted=false)=>({socket:{remoteAddress:peer,encrypted},headers});
  const disabled=Proxy.create();
  assert.deepEqual(disabled.context(req('127.0.0.1',{'x-forwarded-for':'8.8.8.8','x-forwarded-proto':'https'})),{client:'127.0.0.1',secure:false});
  const p=Proxy.create('loopback,10.0.0.0/8,2001:db8:1::/48');
  assert.equal(p.context(req('203.0.113.7',{'x-forwarded-for':'1.2.3.4','x-forwarded-proto':'https'})).client,'203.0.113.7');
  assert.equal(p.context(req('203.0.113.7',{'x-forwarded-proto':'https'})).secure,false);
  assert.equal(p.context(req('::ffff:127.0.0.1',{'x-forwarded-for':'6.6.6.6, 198.51.100.2, 10.4.3.2'})).client,'198.51.100.2');
  assert.equal(p.context(req('::1',{forwarded:'for=6.6.6.6, for="[2001:db8:2::5]:443";proto=https, for="[2001:db8:1::2]"'})).client,'2001:db8:2::5');
  assert.equal(p.context(req('127.0.0.1',{'x-forwarded-for':'6.6.6.6, unknown, 10.4.3.2'})).client,'10.4.3.2');
  assert.equal(p.context(req('127.0.0.1',{'x-forwarded-for':'8.8.8.8',forwarded:'for=9.9.9.9','x-forwarded-proto':'https'})).secure,true);
  assert.equal(p.context(req('127.0.0.1',{'x-forwarded-for':'8.8.8.8',forwarded:'for=9.9.9.9'})).client,'8.8.8.8');
  assert.equal(Proxy.address('[2001:0DB8:0:0::5]:443'),'2001:db8::5');
  assert.equal(Proxy.address('fe80::1%eth0'),null);
  for(const invalid of ['yes','10.0.0.0/33','::1/129','1.2.3.4/not-a-prefix'])assert.throws(()=>Proxy.create(invalid),/TRUST_PROXY/);
});

test('trusted proxy setup requires its token and HTTPS cookies; status publishes account capabilities',async t=>{
  const f=await fixture(t,{trustProxy:'loopback'}),a=f.device();
  const status=ok(await a.request('/api/status'));
  assert.equal(status.setupTokenRequired,true);for(const key of ['accountSecurity','momentExclusions'])assert.equal(status[key],true);assert.equal(status.messageLimit,50000);
  assert.equal((await a.request('/api/setup',{password:PASSWORD})).status,403);
  const setup=await a.request('/api/setup',{password:PASSWORD,setupToken:f.token()},{'X-Forwarded-Proto':'https','X-Forwarded-For':'198.51.100.2'});
  ok(setup);assert.match(setup.headers.get('set-cookie'),/; Secure$/);assert.match(setup.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const logout=await a.request('/api/logout',{}, {'X-Forwarded-Proto':'https'});ok(logout);assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
});

test('forwarding headers cannot set a Secure cookie when TRUST_PROXY is disabled',async t=>{
  const f=await fixture(t),a=f.device();ok(await a.request('/api/setup',{password:PASSWORD}));
  const login=await a.request('/api/login',{password:PASSWORD},{'X-Forwarded-For':'8.8.8.8','X-Forwarded-Proto':'https'});ok(login);assert.doesNotMatch(login.headers.get('set-cookie'),/Secure/);
});

test('trusted client address separates login and API rate windows from spoofed leftmost addresses',async t=>{
  const f=await fixture(t,{trustProxy:'loopback'}),a=f.device(),bad={'X-Forwarded-For':'198.51.100.10'};
  ok(await a.request('/api/setup',{password:PASSWORD,setupToken:f.token()},{'X-Forwarded-For':'198.51.100.1'}));
  for(let i=0;i<10;i++)assert.equal((await a.request('/api/login',{password:'wrong'},bad)).status,401);
  assert.equal((await a.request('/api/login',{password:PASSWORD},{'X-Forwarded-For':'6.6.6.6,198.51.100.10'})).status,429);
  assert.equal((await a.request('/api/account/password',pw(),bad)).status,429);
  ok(await a.request('/api/login',{password:PASSWORD},{'X-Forwarded-For':'198.51.100.11'}));
  const api={'X-Forwarded-For':'198.51.100.20'};
  for(let i=0;i<180;i++)ok(await a.request('/api/account/sessions/revoke',{},api));
  assert.equal((await a.request('/api/account/sessions/revoke',{},api)).status,429);
  ok(await a.request('/api/account/sessions/revoke',{}, {'X-Forwarded-For':'198.51.100.11'}));
});

test('password change keeps this device and its CSRF, invalidates others, and enforces current password',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();ok(await a.request('/api/setup',{password:PASSWORD}));ok(await b.request('/api/login',{password:PASSWORD}));
  assert.deepEqual(ok(await a.request('/api/account')),{sessionCount:2,otherSessionCount:1});
  const cookie=a.cookie,csrf=a.csrf;
  assert.equal((await a.request('/api/account/password',pw(),{'X-CSRF-Token':''})).status,403);
  assert.equal((await a.request('/api/account/password',pw('wrong'))).status,401);
  assert.equal((await a.request('/api/account/password',pw(PASSWORD,'short'))).status,400);
  assert.equal((await a.request('/api/account/password',pw(PASSWORD,NEW_PASSWORD,'mismatch'))).status,400);
  const changed=ok(await a.request('/api/account/password',pw()));assert.equal(changed.sessionCount,1);assert.equal(changed.otherSessionCount,0);assert.equal(changed.message,'密码已修改，其他设备需要重新登录');
  assert.equal(a.cookie,cookie);assert.equal(a.csrf,csrf);ok(await a.request('/api/state'));assert.equal((await b.request('/api/state')).status,401);
  assert.equal((await b.request('/api/login',{password:PASSWORD})).status,401);ok(await b.request('/api/login',{password:NEW_PASSWORD}));
  const stored=JSON.parse(f.app.db.prepare("SELECT value FROM meta WHERE key='password'").get().value);assert.match(stored.salt,/^[a-f0-9]{48}$/);assert.match(stored.hash,/^[a-f0-9]{128}$/);assert.equal(JSON.stringify(stored).includes(NEW_PASSWORD),false);
});

test('revoke excludes expired sessions and ends other devices realtime connections',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();ok(await a.request('/api/setup',{password:PASSWORD}));ok(await b.request('/api/login',{password:PASSWORD}));
  f.app.db.prepare('INSERT INTO sessions(hash,csrf,expires) VALUES(?,?,?)').run('expired','expired',1);
  const stream=await fetch(f.origin+'/api/events',{headers:{Cookie:b.cookie}});assert.equal(stream.status,200);const reader=stream.body.getReader();await reader.read();
  assert.equal(ok(await a.request('/api/account')).sessionCount,2);
  assert.deepEqual(ok(await a.request('/api/account/sessions/revoke',{})),{ok:true,sessionCount:1,otherSessionCount:0,message:'已退出其他设备'});
  assert.equal((await reader.read()).done,true);assert.equal((await b.request('/api/account')).status,401);ok(await a.request('/api/account'));
});

test('a previously authorized slow request cannot write after its session is revoked',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();ok(await a.request('/api/setup',{password:PASSWORD}));ok(await b.request('/api/login',{password:PASSWORD}));
  const data=JSON.stringify({type:'profile.save',payload:{name:'SHOULD_NOT_WRITE'}});
  let finish;const result=new Promise((resolve,reject)=>{
    const req=http.request(f.origin+'/api/action',{method:'POST',headers:{Cookie:b.cookie,Origin:f.origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'X-CSRF-Token':b.csrf}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(data.slice(0,8));finish=()=>req.end(data.slice(8));
  });
  await new Promise(resolve=>setImmediate(resolve));ok(await a.request('/api/account/sessions/revoke',{}));finish();assert.equal(await result,401);assert.notEqual(ok(await a.request('/api/state')).profile.name,'SHOULD_NOT_WRITE');
});

test('simultaneous password updates cannot overwrite a newer password',async t=>{
  const f=await fixture(t),a=f.device();ok(await a.request('/api/setup',{password:PASSWORD}));
  const outcomes=await Promise.all([a.request('/api/account/password',pw()),a.request('/api/account/password',pw(PASSWORD,'Other-password-0130'))]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  const winner=outcomes[0].status===200?NEW_PASSWORD:'Other-password-0130';ok(await a.request('/api/login',{password:winner}));
});

test('logging out during a slow TAR restore prevents the old session from replacing current data',async t=>{
  const f=await fixture(t),a=f.device();ok(await a.request('/api/setup',{password:PASSWORD,displayName:'原名称'}));
  const prepared=ok(await a.request('/api/backup/prepare',{includeKeys:false,includeMedia:false}));
  const download=await fetch(f.origin+'/api/backup/download?token='+prepared.token,{headers:{Cookie:a.cookie}});assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());
  ok(await a.request('/api/action',{type:'profile.save',payload:{name:'当前名称'}}));const before=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  let upload;const result=new Promise((resolve,reject)=>{
    upload=http.request(f.origin+'/api/restore/tar',{method:'POST',headers:{Cookie:a.cookie,Origin:f.origin,'Content-Type':'application/x-tar','Content-Length':bytes.length,'X-CSRF-Token':a.csrf}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});upload.on('error',reject);upload.write(bytes.subarray(0,512));
  });
  await new Promise(resolve=>setTimeout(resolve,20));ok(await a.request('/api/logout',{}));upload.end(bytes.subarray(512));assert.equal(await result,401);
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);assert.deepEqual(fs.readdirSync(path.join(f.dataDir,'.streaming-backup')),[]);
});

test('RESET_PASSWORD preserves app JSON, requires a persisted one-time token, and cannot reset again on restart',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();ok(await a.request('/api/setup',{password:PASSWORD,displayName:'原来的名字'}));
  ok(await a.request('/api/action',{type:'role.save',payload:{name:'保留好友'}}));ok(await b.request('/api/login',{password:PASSWORD}));
  const before=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  const output=[],original=console.log;console.log=(...args)=>output.push(args.join(' '));
  try{await f.restart({resetPassword:true});}finally{console.log=original;}
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  const token=f.token();assert.match(token,/^[a-f0-9]{48}$/);assert.ok(output.some(line=>line.includes(token)));
  assert.equal((await a.request('/api/state')).status,401);assert.equal(ok(await a.request('/api/status')).setupTokenRequired,true);
  assert.equal((await a.request('/api/setup',{password:NEW_PASSWORD})).status,403);
  await f.restart({resetPassword:true});assert.equal(f.token(),token);
  ok(await a.request('/api/setup',{password:NEW_PASSWORD,setupToken:token,displayName:'不得覆盖原名'}));
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);assert.equal(fs.existsSync(path.join(f.dataDir,'setup-token.txt')),false);
  assert.equal((await b.request('/api/setup',{password:PASSWORD,setupToken:token})).status,409);
  await f.restart({resetPassword:true});assert.equal(ok(await a.request('/api/status')).setupRequired,false);ok(await a.request('/api/login',{password:NEW_PASSWORD}));
  assert.equal((await b.request('/api/login',{password:PASSWORD})).status,401);
  await f.restart({resetPassword:false});
  console.log=()=>{};try{await f.restart({resetPassword:true});}finally{console.log=original;}
  assert.notEqual(f.token(),token);assert.equal(ok(await a.request('/api/status')).setupRequired,true);
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
});

test('a token-file write failure cannot clear the existing password, sessions or reset latch',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-reset-write-failure-'));let app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',resetPassword:false});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  let origin='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD})});assert.equal(setup.status,200);await setup.arrayBuffer();const cookie=setup.headers.get('set-cookie').split(';')[0];
  const before=app.db.prepare('SELECT json FROM app WHERE id=1').get().json;await app.close();
  const write=fs.writeFileSync;fs.writeFileSync=(file,...args)=>{if(String(file).startsWith(path.join(dataDir,'.setup-token-reset-')))throw Object.assign(new Error('isolated write failure'),{code:'EACCES'});return write(file,...args);};
  try{assert.throws(()=>createApp({dataDir,trustProxy:'',resetPassword:true}),error=>error.code==='EACCES');}finally{fs.writeFileSync=write;}
  app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',resetPassword:false});await app.listen();origin='http://127.0.0.1:'+app.server.address().port;
  assert.equal(app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);assert.equal(app.db.prepare("SELECT value FROM meta WHERE key='resetPasswordConsumed'").get(),undefined);
  const state=await fetch(origin+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);await state.arrayBuffer();
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD})});assert.equal(login.status,200);await login.arrayBuffer();
  assert.equal(fs.readdirSync(dataDir).some(name=>name.includes('setup-token')),false);
});

test('a reset transaction failure rolls back account rows and restores the previous token file',async t=>{
  const f=await fixture(t),a=f.device();ok(await a.request('/api/setup',{password:PASSWORD}));
  const db=f.app.db,getMeta=key=>db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value,setMeta=(key,value)=>db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key,value);
  const stored=getMeta('password'),tokenFile=path.join(f.dataDir,'setup-token.txt');fs.writeFileSync(tokenFile,'PREVIOUS-TOKEN\n');
  assert.throws(()=>require('../lib/password-reset.cjs').apply({requested:true,dataDir:f.dataDir,db,getMeta,setMeta,transaction(fn){db.exec('BEGIN IMMEDIATE');try{fn();throw new Error('isolated commit failure');}catch(error){db.exec('ROLLBACK');throw error;}}}),/isolated commit failure/);
  assert.equal(getMeta('password'),stored);assert.equal(getMeta('resetPasswordConsumed'),undefined);assert.equal(fs.readFileSync(tokenFile,'utf8'),'PREVIOUS-TOKEN\n');assert.equal(fs.readdirSync(f.dataDir).some(name=>name.startsWith('.setup-token-reset-')),false);ok(await a.request('/api/state'));
});
