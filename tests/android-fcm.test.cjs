// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {setTimeout:wait}=require('node:timers/promises');
const FCM=require('../lib/android-fcm.cjs'),S=require('../lib/state.cjs'),{createApp}=require('../server.cjs');
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const account={type:'service_account',project_id:'isolated-fcm-project',client_email:'sender@isolated-fcm-project.iam.gserviceaccount.com',token_uri:'https://oauth2.googleapis.com/token',private_key:keys.privateKey.export({format:'pem',type:'pkcs8'})};
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-fcm-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function credentials(t,override={}){const file=path.join(directory(t),'identity.json');fs.writeFileSync(file,JSON.stringify({...account,...override}));return file;}
function initial(){const state=S.initial();S.apply(state,'role.save',{name:'不应发给 Firebase 的姓名'});state.roles[0].unread=1;state.settings.modules.outreach={quietHoursEnabled:false,quietStart:'22:00',quietEnd:'08:00'};return state;}
function fixture(t,override={}){
  let state=initial(),at=Date.now();const meta=new Map(),sessions=new Set(['session-a']),requests=[],errors=[];
  const service=FCM.create({credentialFile:credentials(t),getMeta:key=>meta.get(key),setMeta:(key,value)=>meta.set(key,value),sessionValid:hash=>sessions.has(hash),sessionScope:hash=>'scope-'+hash,getState:()=>state,clock:()=>at,
    fetch:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.includes('oauth2.googleapis.com')?{access_token:'ISOLATED-OAUTH-TOKEN',expires_in:3600}:{name:'projects/isolated/messages/1'}),{status:200});},onError:error=>errors.push(error),...override});
  t.after(()=>service.close());
  const auth={hash:'session-a'},registration={token:'ISOLATED-DEVICE-TOKEN',installationId:'installation-a',packageName:'com.pipiphone.app.qa',projectId:account.project_id,foreground:false};
  const register=()=>service.register(auth,registration,'https://isolated.example');
  function incoming(extra={}){const message={id:crypto.randomUUID(),roleId:state.roles[0].id,sender:'assistant',status:'sent',type:'text',content:'不能发给 Firebase 的聊天正文',createdAt:at,...extra};state.messages.push(message);return message;}
  return {service,requests,errors,meta,sessions,auth,registration,register,incoming,get state(){return state;},set state(value){state=value;},get at(){return at;},set at(value){at=value;}};
}

test('FCM is inert without administrator credentials, and rejects alternate credential token hosts',t=>{
  let network=0;
  const service=FCM.create({getMeta:()=>undefined,setMeta(){},sessionValid:()=>true,sessionScope:()=>'',getState:initial,fetch:async()=>{network++;}});
  assert.equal(service.status({hash:'a'}).available,false);
  assert.equal(service.snapshot(initial()),null);service.publish(new Set(),initial());
  assert.throws(()=>service.register({hash:'a'},{},'https://isolated.example'),error=>error.code==='FCM_UNAVAILABLE');
  assert.equal(network,0);
  assert.throws(()=>FCM.create({credentialFile:credentials(t,{token_uri:'https://attacker.invalid/token'})}),/FCM 服务身份 JSON 无效/);
});

test('official OAuth JWT is signed, token is cached, and committed messages produce only private generic notifications',async t=>{
  const f=fixture(t);f.register();const before=f.service.snapshot(f.state);const message=f.incoming();
  f.service.publish(before,f.state);await f.service.flush();
  assert.equal(f.requests.length,2);
  const oauth=f.requests[0],form=new URLSearchParams(oauth.options.body),assertion=form.get('assertion'),[head,body,signature]=assertion.split('.');
  const claims=JSON.parse(Buffer.from(body,'base64url'));
  assert.equal(oauth.url,'https://oauth2.googleapis.com/token');
  assert.equal(claims.aud,oauth.url);assert.equal(claims.iss,account.client_email);
  assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.exp-claims.iat,3600);
  assert.equal(crypto.verify('RSA-SHA256',Buffer.from(head+'.'+body),keys.publicKey,Buffer.from(signature,'base64url')),true);
  const sent=JSON.parse(f.requests[1].options.body).message;
  assert.deepEqual(sent.notification,{title:'小手机',body:'收到好友新消息'});
  assert.deepEqual(sent.data,{roleId:message.roleId,notificationOrigin:'https://isolated.example',appSessionScope:'scope-session-a'});
  assert.equal(sent.android.notification.tag,'chat:'+message.roleId);
  assert.equal(sent.android.notification.channel_id,'pipi_chat_messages_v2');
  assert.equal(sent.android.ttl,'60s');assert.equal(sent.android.priority,'HIGH');
  assert.equal(f.requests[1].options.redirect,'error');
  assert.equal(f.requests[1].options.body.includes(f.state.roles[0].name),false);
  assert.equal(f.requests[1].options.body.includes(message.content),false);
  const second=f.service.snapshot(f.state);f.incoming();f.service.publish(second,f.state);await f.service.flush();
  assert.equal(f.requests.filter(item=>item.url.includes('oauth2.googleapis.com')).length,1);
  assert.equal(f.errors.length,0);
});

test('unchanged, pending, outgoing, read, muted and quiet messages do not trigger Firebase requests',async t=>{
  const f=fixture(t);f.register();
  let before=f.service.snapshot(f.state);f.incoming({sender:'user'});f.incoming({status:'pending'});
  f.service.publish(before,f.state);await f.service.flush();assert.equal(f.requests.length,0);
  for(const setting of ['read','mute','quiet']){
    f.state.roles[0].unread=setting==='read'?0:1;f.state.roles[0].muted=setting==='mute';
    f.state.settings.modules.outreach.quietHoursEnabled=setting==='quiet';
    if(setting==='quiet')f.at=Date.parse('2026-11-22T23:00:00Z');
    before=f.service.snapshot(f.state);f.incoming();f.service.publish(before,f.state);await f.service.flush();
    assert.equal(f.requests.length,0,setting);
  }
});

test('logout and read changes during OAuth cancel queued notification sends',async t=>{
  for(const change of ['logout','read']){
    let release;
    const requests=[],f=fixture(t,{fetch:async(url,options)=>{requests.push(url);return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({access_token:'LOCAL',expires_in:3600}),{status:200}));});}});
    f.register();const before=f.service.snapshot(f.state);f.incoming();f.service.publish(before,f.state);
    assert.equal(typeof release,'function');
    if(change==='logout'){f.sessions.delete(f.auth.hash);f.service.removeSession(f.auth.hash);}else f.state.roles[0].unread=0;
    release();await f.service.flush();
    assert.deepEqual(requests,['https://oauth2.googleapis.com/token']);
  }
});

test('unregistered Firebase tokens are removed without exposing them in errors',async t=>{
  const f=fixture(t,{fetch:async url=>new Response(JSON.stringify(url.includes('oauth2.googleapis.com')?{access_token:'LOCAL',expires_in:3600}:{error:{details:[{errorCode:'UNREGISTERED'}]}}),{status:url.includes('oauth2.googleapis.com')?200:404})});
  f.register();const before=f.service.snapshot(f.state);f.incoming();f.service.publish(before,f.state);await f.service.flush();
  assert.equal(f.service.status(f.auth).registered,false);assert.equal(f.errors.length,0);
});

test('temporary FCM errors retry within the short TTL and respect Retry-After',async t=>{
  let sends=0;const delays=[];
  const f=fixture(t,{pause:async milliseconds=>{delays.push(milliseconds);},fetch:async url=>{
    if(url.includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'LOCAL',expires_in:3600}),{status:200});
    sends++;return new Response(JSON.stringify(sends===1?{error:{status:'UNAVAILABLE'}}:{name:'accepted'}),{status:sends===1?503:200,headers:sends===1?{'Retry-After':'2'}:{}});
  }});
  f.register();const before=f.service.snapshot(f.state);f.incoming();f.service.publish(before,f.state);await f.service.flush();
  assert.equal(sends,2);assert.deepEqual(delays,[2000]);assert.deepEqual(f.errors,[]);
});

test('FCM HTTP registration requires login and CSRF; normal chat commit sends and logout removes binding',async t=>{
  const old=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  t.after(()=>{if(old===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=old;});
  const model=http.createServer((req,res)=>{req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/models')?{data:[{id:'isolated-chat'}]}:{choices:[{message:{role:'assistant',content:'这条回复只能进入隔离聊天'}}]}));});
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  t.after(()=>{model.closeAllConnections();return new Promise(resolve=>model.close(resolve));});
  const source='http://127.0.0.1:'+model.address().port+'/v1',outgoing=[];
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-fcm-test-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,initialState:initial,providerUrlAllowlist:[source],fcm:{credentialFile:credentials(t),fetch:async(url,options)=>{
    outgoing.push({url,options});return new Response(JSON.stringify(url.includes('oauth2.googleapis.com')?{access_token:'LOCAL',expires_in:3600}:{name:'projects/isolated/messages/1'}),{status:200});
  }}});
  t.after(async()=>{await app.close();assert.ok(dataDir.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dataDir,{recursive:true,force:true});});
  await app.listen();const base='http://127.0.0.1:'+app.server.address().port;
  let cookie='',csrf='';
  async function request(route,body,headers={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};
  }
  const setup=await request('/api/setup',{password:'Isolated-FCM-password-2026!',displayName:'FCM隔离'});assert.equal(setup.status,200);
  const roleId=setup.value.state.roles[0].id,registration={token:'LOCAL-HTTP-TOKEN',installationId:'local-http-installation',packageName:'com.pipiphone.app.qa',projectId:account.project_id,foreground:false};
  assert.equal((await request('/api/android/fcm',undefined,{Cookie:''})).status,401);
  assert.equal((await request('/api/android/fcm/register',registration,{'X-CSRF-Token':''})).status,403);
  assert.equal((await request('/api/android/fcm/register',{...registration,projectId:'wrong-project'})).status,409);
  const bound=await request('/api/android/fcm/register',registration);assert.equal(bound.status,200);
  assert.equal(typeof bound.value.cursor,'string');assert.equal(bound.value.appSessionScope,setup.value.appSessionScope);
  const status=await request('/api/android/fcm');assert.equal(status.value.registered,true);
  assert.equal(JSON.stringify(status).includes(registration.token),false);assert.equal(JSON.stringify(status).includes('private_key'),false);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'Isolated-FCM-password-2026!'})});
  const otherCookie=login.headers.get('set-cookie').split(';')[0],otherSession=await login.json();
  const otherRegistration=await fetch(base+'/api/android/fcm/register',{method:'POST',headers:{Origin:base,Cookie:otherCookie,'Content-Type':'application/json','X-CSRF-Token':otherSession.csrfToken},body:JSON.stringify({...registration,token:'OTHER-LOCAL-TOKEN',installationId:'other-installation'})});
  assert.equal(otherRegistration.status,200);await otherRegistration.json();
  assert.equal(JSON.parse(app.db.prepare("SELECT value FROM meta WHERE key='androidFcmDevices'").get().value).length,2);
  assert.equal((await request('/api/account/sessions/revoke',{})).status,200);
  assert.equal(JSON.parse(app.db.prepare("SELECT value FROM meta WHERE key='androidFcmDevices'").get().value).length,1);
  assert.equal((await request('/api/android/fcm',undefined,{Cookie:otherCookie})).status,401);
  const ai={...setup.value.state.settings.ai,sources:[...setup.value.state.settings.ai.sources,{id:'local-fcm',name:'隔离模型',baseUrl:source,key:'LOCAL-MODEL-KEY',builtin:false}],models:[{id:'local-chat',sourceId:'local-fcm',model:'isolated-chat',kind:'chat',capabilities:['text'],timeoutSeconds:5}],assign:{chat:'local-chat',chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''}};
  assert.equal((await request('/api/engine/models',{ai})).status,200);
  assert.equal((await request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0.05,maxWaitSeconds:1}})).status,200);
  assert.equal((await request('/api/engine/modules',{id:'segments',values:{enabled:false}})).status,200);
  assert.equal((await request('/api/chat',{roleId,text:'隔离测试，请回复',requestId:crypto.randomUUID()})).status,200);
  const deadline=Date.now()+7000;
  while(!outgoing.some(item=>item.url.includes('fcm.googleapis.com'))&&Date.now()<deadline)await wait(20);
  assert.equal(outgoing.filter(item=>item.url.includes('fcm.googleapis.com')).length,1);
  const sent=JSON.parse(outgoing.find(item=>item.url.includes('fcm.googleapis.com')).options.body).message;
  assert.equal(sent.data.roleId,roleId);assert.equal(sent.data.notificationOrigin,base);assert.equal(sent.data.appSessionScope,setup.value.appSessionScope);
  assert.equal((await request('/api/android/fcm/unregister',{installationId:registration.installationId})).status,200);
  assert.equal((await request('/api/android/fcm')).value.registered,false);
  assert.equal((await request('/api/android/fcm/register',registration)).status,200);
  assert.equal((await request('/api/logout',{})).status,200);
  assert.deepEqual(JSON.parse(app.db.prepare("SELECT value FROM meta WHERE key='androidFcmDevices'").get().value),[]);
});
