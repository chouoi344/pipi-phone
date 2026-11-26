// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdtemp,rm,readFile}=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createApp}=require('../scripts/sample-data.cjs');
const PASSWORD='Adversarial-only-Password_2026!';
const SECRET='TEST_ONLY_NEVER_A_REAL_PROVIDER_KEY_9f2c';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwCsj7DwADmAHwphbYCgAAAABJRU5ErkJggg==';
function wavFixture(sample=0){
  const payload=Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000','hex');
  payload.writeInt16LE(sample,44);
  return 'data:audio/wav;base64,'+payload.toString('base64');
}

test('local fonts: correct MIME and conditional caching without caching private state',async t=>{
  const f=await fixture(t);
  for(const name of ['InterVariable.woff2','NotoSansSC-common.woff2','NotoSansSC-extended.woff2']){
    const response=await f.request('/fonts/'+name,undefined,{method:'HEAD'});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');
    assert.ok(Number(response.headers.get('content-length'))>100000);
    const etag=response.headers.get('etag');assert.ok(etag);
    const cached=await f.request('/fonts/'+name,undefined,{headers:{'If-None-Match':etag}});
    assert.equal(cached.status,304);assert.equal(cached.text,'');
    assert.equal(cached.headers.get('cache-control'),'public, max-age=0, must-revalidate');
  }
  assert.equal((await f.request('/api/state')).headers.get('cache-control'),'no-store');
});

test('native profile: avatar pats distinguish self/contact; star and pat settings survive partial saves and restart',async t=>{
  const f=await fixture(t),initial=await f.state(),roleId=initial.roles[0].id,otherId=initial.roles[1].id;
  ok(await f.action('message.pat',{roleId}));
  assert.equal((await f.state()).messages.at(-1).content,`我拍了拍“${initial.roles[0].name}”`);
  ok(await f.action('profile.save',{patText:'肩膀'}));
  ok(await f.action('profile.save',{bio:'保留拍一拍设置'}));
  ok(await f.action('role.save',{id:roleId,starred:true}));
  ok(await f.action('role.save',{id:roleId,remark:'星标朋友'}));
  ok(await f.action('message.pat',{roleId,target:'self'}));
  let s=await f.state();assert.equal(s.messages.at(-1).content,'我拍了拍自己的肩膀');assert.equal(s.messages.at(-1).sender,'system');assert.equal(s.messages.at(-1).roleId,roleId);
  assert.equal(s.roles.find(r=>r.id===roleId).starred,true);assert.equal(s.roles.find(r=>r.id===otherId).starred,false);
  ok(await f.action('message.pat',{roleId,target:'contact'}));assert.equal((await f.state()).messages.at(-1).content,'我拍了拍“星标朋友”');
  const before=await f.state();for(const payload of [{roleId,target:'other'},{roleId:'missing',target:'self'}]){rejected(await f.action('message.pat',payload));assert.deepEqual(await f.state(),before);}
  rejected(await f.action('role.save',{id:roleId,starred:'true'}));rejected(await f.action('profile.save',{patText:'x'.repeat(101)}));assert.deepEqual(await f.state(),before);
  await f.restart();ok(await f.request('/api/login',{password:PASSWORD}));assert.deepEqual(await f.state(),before);
  const saved=await backup(f);ok(await f.action('profile.save',{patText:''}));ok(await f.action('role.save',{id:roleId,starred:false}));ok(await f.request('/api/restore',{backup:saved,confirm:true}));
  s=await f.state();assert.equal(s.profile.patText,'肩膀');assert.equal(s.roles.find(r=>r.id===roleId).starred,true);
});

test('stickers: safe images deduplicate, persist across restart/restore and delete without touching favorites',async t=>{
  const f=await fixture(t);const favorites=(await f.state()).favorites;
  ok(await f.action('sticker.add',{image:PNG}));let s=await f.state();const first=s.stickers.at(-1);
  await checkMedia(f,first.image,PNG,'png');assert.ok(first.id);assert.ok(first.createdAt);
  ok(await f.action('sticker.add',{image:PNG}));assert.equal((await f.state()).stickers.length,s.stickers.length,'same image must not duplicate');
  await f.restart();ok(await f.request('/api/login',{password:PASSWORD}));assert.deepEqual((await f.state()).stickers,s.stickers);
  const saved=await backup(f);ok(await f.action('sticker.delete',{id:first.id}));assert.deepEqual((await f.state()).favorites,favorites);
  assert.equal((await f.state()).stickers.some(x=>x.id===first.id),false);ok(await f.request('/api/restore',{backup:saved,confirm:true}));assert.deepEqual((await f.state()).stickers,s.stickers);
  const before=await f.state();rejected(await f.action('sticker.delete',{id:'missing-sticker'}));assert.deepEqual(await f.state(),before);
});

test('stickers: hostile inputs and corrupt backups reject atomically; old backups migrate empty',async t=>{
  const f=await fixture(t);ok(await f.action('sticker.add',{image:PNG}));const before=await f.state(),saved=await backup(f);
  for(const image of [null,{},[],123,'https://attacker.invalid/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,PGh0bWw+','data:image/png;base64,%%%','data:text/html;base64,PGgxPng8L2gxPg==']){
    rejected(await f.action('sticker.add',{image}),String(image));assert.deepEqual(await f.state(),before);
  }
  const corruptions=[b=>{b.state.stickers={};},b=>{b.state.stickers=[null];},b=>{b.state.stickers[0].image='https://attacker.invalid/a.png';},b=>{b.state.stickers.push({...b.state.stickers[0]});},b=>{b.state.stickers=Array.from({length:201},(_,i)=>({...b.state.stickers[0],id:randomUUID(),image:PNG.slice(0,-4)+Buffer.from(String(i)).toString('base64')}));}];
  for(const corrupt of corruptions){const bad=structuredClone(saved);corrupt(bad);rejected(await f.request('/api/restore',{backup:bad,confirm:true}));assert.deepEqual(await f.state(),before);}
  const legacy=structuredClone(saved);delete legacy.state.stickers;delete legacy.state.emojiRecents;for(const role of legacy.state.roles)for(const key of ['tags','description','phone'])delete role[key];
  ok(await f.request('/api/restore',{backup:legacy,confirm:true}));const migrated=await f.state();assert.deepEqual(migrated.stickers,[]);assert.deepEqual(migrated.emojiRecents,[]);for(const role of migrated.roles){assert.deepEqual(role.tags,[]);assert.equal(role.description,'');assert.equal(role.phone,'');}
});

test('role native contact fields: trim, deduplicate, retain on partial saves and reject invalid data atomically',async t=>{
  const f=await fixture(t),id=(await f.state()).roles[0].id;
  ok(await f.action('role.save',{id,tags:[' Friend ','','Friend','QA'],description:'Internal QA description',phone:'+86 000 TEST'}));
  let role=(await f.state()).roles.find(x=>x.id===id);assert.deepEqual(role.tags,['Friend','QA']);assert.equal(role.description,'Internal QA description');assert.equal(role.phone,'+86 000 TEST');
  ok(await f.action('role.save',{id,remark:'Partial name edit'}));role=(await f.state()).roles.find(x=>x.id===id);assert.deepEqual(role.tags,['Friend','QA']);assert.equal(role.description,'Internal QA description');assert.equal(role.phone,'+86 000 TEST');
  const before=await f.state();for(const payload of [{tags:'one'},{tags:[null]},{tags:[1]},{tags:Array.from({length:11},(_,i)=>String(i))},{tags:['x'.repeat(31)]},{description:'x'.repeat(501)},{phone:'x'.repeat(81)}]){rejected(await f.action('role.save',{id,...payload}));assert.deepEqual(await f.state(),before);}
  const saved=await backup(f);ok(await f.request('/api/restore',{backup:saved,confirm:true}));assert.deepEqual((await f.state()).roles,withPersonaRevisions(before.roles));
});

test('stickers: count and total-byte caps reject without revision or partial changes',async t=>{
  const f=await fixture(t),base=await backup(f),pixels=Buffer.from(PNG.split(',')[1],'base64');
  async function restoreWhenIdle(backup){
    const deadline=Date.now()+5000;
    for(;;){
      const result=await f.request('/api/restore',{backup,confirm:true});
      if(result.status!==409||result.json?.code!=='BUSY'||Date.now()>=deadline){ok(result);return;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  const image=i=>'data:image/png;base64,'+Buffer.concat([pixels,Buffer.from(String(i))]).toString('base64');
  base.state.stickers=Array.from({length:200},(_,i)=>({id:randomUUID(),image:image(i),createdAt:Date.now()}));
  await restoreWhenIdle(base);let before=await f.state();rejected(await f.action('sticker.add',{image:image('extra')}));assert.deepEqual(await f.state(),before);
  const large=await backup(f),largeImage=i=>'data:image/png;base64,'+Buffer.concat([pixels,Buffer.alloc(4*1024*1024,i)]).toString('base64');
  large.state.stickers=[0,1,2].map(i=>({id:randomUUID(),image:largeImage(i),createdAt:Date.now()}));await restoreWhenIdle(large);before=await f.state();
  rejected(await f.action('sticker.add',{image:largeImage(3)}));assert.deepEqual(await f.state(),before);
});

test('emoji recents: exact token whitelist, bounded MRU and durable migration',async t=>{
  const f=await fixture(t);const source=await readFile(path.join(__dirname,'../public/emoji.js'),'utf8');const tokens=JSON.parse(source.match(/Object\.freeze\((\[[\s\S]*?\])\)/)[1]).map(x=>x.token);
  assert.equal(tokens.length,109);for(const token of tokens.slice(0,26))ok(await f.action('emoji.use',{token}));let s=await f.state();assert.deepEqual(s.emojiRecents,tokens.slice(2,26).reverse());
  ok(await f.action('emoji.use',{token:tokens[10]}));s=await f.state();assert.equal(s.emojiRecents[0],tokens[10]);assert.equal(new Set(s.emojiRecents).size,24);
  const before=await f.state();for(const token of [null,'','😂','[NOT_A_REAL_TOKEN]','<img src=x>',{},[]]){rejected(await f.action('emoji.use',{token}));assert.deepEqual(await f.state(),before);}
  await f.restart();ok(await f.request('/api/login',{password:PASSWORD}));assert.deepEqual((await f.state()).emojiRecents,before.emojiRecents);
  const saved=await backup(f);for(const [label,mutate] of [['unknown token',b=>{b.state.emojiRecents=['<script>'];}],['25 tokens',b=>{b.state.emojiRecents=tokens.slice(0,25);}]]){const bad=structuredClone(saved);mutate(bad);const state=await f.state();rejected(await f.request('/api/restore',{backup:bad,confirm:true}),label);assert.deepEqual(await f.state(),state);}
  const duplicates=structuredClone(saved);duplicates.state.emojiRecents=[tokens[2],tokens[0],tokens[2],tokens[1],tokens[0]];ok(await f.request('/api/restore',{backup:duplicates,confirm:true}));assert.deepEqual((await f.state()).emojiRecents,[tokens[2],tokens[0],tokens[1]],'MRU backup normalization retains first occurrence order');
  ok(await f.request('/api/restore',{backup:saved,confirm:true}));assert.deepEqual((await f.state()).emojiRecents,before.emojiRecents);
});

async function fixture(t,{privateProviders=true,setup=true,password=PASSWORD,requireSetupToken=false,allowedHosts}={}) {
  const old=process.env.ALLOW_PRIVATE_PROVIDERS;
  if(privateProviders)process.env.ALLOW_PRIVATE_PROVIDERS='1';else delete process.env.ALLOW_PRIVATE_PROVIDERS;
  const dir=await mkdtemp(path.join(os.tmpdir(),'pipi-adversarial-'));
  let app;
  try{app=createApp({dataDir:dir,host:'127.0.0.1',port:0,requireSetupToken,allowedHosts});await app.listen();}catch(e){await rm(dir,{recursive:true,force:true});throw e;}
  let base=`http://127.0.0.1:${app.server.address().port}`;
  let cookie='',csrf='';
  async function request(route,body,options={}) {
    const method=options.method||(body===undefined?'GET':'POST');
    const headers={...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})}),...options.headers};
    if(options.anonymous){delete headers.Cookie;delete headers['X-CSRF-Token'];}
    const res=await fetch(base+route,{method,headers,body:body===undefined?undefined:(options.raw?body:JSON.stringify(body)),redirect:'manual',signal:AbortSignal.timeout(15000)});
    const text=await res.text();let json;try{json=JSON.parse(text);}catch{}
    const set=res.headers.get('set-cookie');if(set&&!options.anonymous)cookie=set.split(';')[0];
    if(json?.csrfToken&&!options.anonymous)csrf=json.csrfToken;
    return {status:res.status,json,text,headers:res.headers};
  }
  const f={get app(){return app;},get base(){return base;},dir,restart:async()=>{await app.close();app=createApp({dataDir:dir,host:"127.0.0.1",port:0,requireSetupToken,allowedHosts});await app.listen();base=`http://127.0.0.1:${app.server.address().port}`;},request,action:(type,payload={})=>request('/api/action',{type,payload}),state:async()=>{const r=await request('/api/state');ok(r);return r.json;},get cookie(){return cookie;},get csrf(){return csrf;}};
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=old;});
  if(setup){
    const r=await request('/api/setup',{password,displayName:'Test only'});ok(r);
    ok(await request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0,maxWaitSeconds:1}}));
    ok(await request('/api/engine/modules',{id:'segments',values:{intervalMode:'random',minSeconds:0,maxSeconds:0}}));
    f.initial=await f.state();
  }
  return f;
}
function ok(r){assert.equal(r.status>=200&&r.status<300,true,`${r.status}: ${r.text?.slice(0,600)}`);assert.ok(r.json,'JSON response required');return r.json;}
function rejected(r,context=''){assert.equal(r.status>=400&&r.status<500,true,`${context} ${r.status}: ${r.text?.slice(0,600)}`);assert.ok(r.json?.error,'structured error required');}
async function checkMedia(f,reference,expected,extension){
  assert.match(reference,new RegExp('^/api/media/[a-f0-9]{64}\\.'+extension+'$'));
  const response=await fetch(f.base+reference,{headers:{Cookie:f.cookie}});
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(expected.split(',')[1],'base64'));
}
const withPersonaRevisions=roles=>roles.map(role=>({...role,personaRevision:role.personaRevision??0}));
async function settled(f,messageId,status='sent',timeout=5000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    const s=await f.state(),m=s.messages.find(x=>x.id===messageId);
    if(m?.status===status)return s;
    if(m?.status==='error'&&status!=='error')assert.fail(m.error);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(`message ${messageId} did not become ${status}`);
}
async function chat(f,route,payload){const result=await f.request(route,payload);ok(result);assert.equal(result.json.accepted,true);await settled(f,result.json.messageId);return result;}
async function mock(t){
  const requests=[];let mode='normal',reply='MOCK_ASSISTANT_OK',release=null,enteredResolve;
  let entered=new Promise(r=>enteredResolve=r);
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    let body;try{body=JSON.parse(raw);}catch{body=raw;}
    requests.push({url:req.url,headers:req.headers,body});enteredResolve();
    if(mode==='delay')await new Promise(r=>release=r);
    if(mode==='http-error'){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Mock upstream failure '+SECRET}}));return;}
    if(mode==='bad-json'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"broken":');return;}
    if(mode==='empty'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[]}));return;}
    if(mode==='redirect'){res.writeHead(302,{Location:`http://127.0.0.1:${server.address().port}/redirect-trap`});res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url.endsWith('/audio/transcriptions'))res.end(JSON.stringify({text:'MOCK_VOICE_TRANSCRIPT'}));
    else if(req.url.endsWith('/models'))res.end(JSON.stringify({data:[{id:'mock-chat'}]}));
    else res.end(JSON.stringify({id:'mock-response',choices:[{message:{role:'assistant',content:reply}}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{release?.();server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {requests,url:`http://127.0.0.1:${server.address().port}/v1`,setMode(x){mode=x;entered=new Promise(r=>enteredResolve=r);},setReply(x){reply=x;},wait:()=>Promise.race([entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('mock was not called')),5000);timer.unref();})]),release(){release?.();}};
}
async function configure(f,m,capability='chat'){ok(await f.action('settings.save',{providers:{[capability]:{mode:'custom',baseUrl:m.url,model:'mock-chat',key:SECRET}}}));}
async function backup(f){return ok(await f.request('/api/backup'));}
async function rawRequest(f,target,headers={},body){
  const payload=body===undefined?undefined:JSON.stringify(body);
  return new Promise((resolve,reject)=>{const req=http.request(f.base+'/', {path:target,method:payload===undefined?'GET':'POST',headers:{Host:new URL(f.base).host,Cookie:f.cookie,...(payload===undefined?{}:{Origin:f.base,'X-CSRF-Token':f.csrf,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}),...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode,text,json,headers:res.headers});});});req.on('error',reject);req.end(payload);});
}

test('authentication: setup, weak password, login, session revocation and protected routes',async t=>{
  const f=await fixture(t,{setup:false});
  assert.equal(ok(await f.request('/api/status')).setupRequired,true);
  for(const route of ['/api/state','/api/backup'])assert.equal((await f.request(route,undefined,{anonymous:true})).status,401,route);
  for(const route of ['/api/action','/api/chat','/api/chat/retry','/api/restore','/api/providers/test','/api/providers/models','/api/moments/generate','/api/ledger/recognize','/api/voice/transcribe','/api/voice/speak'])assert.equal((await f.request(route,{}, {anonymous:true})).status,401,route);
  rejected(await f.request('/api/setup',{password:'123'}));
  const r=await f.request('/api/setup',{password:PASSWORD});ok(r);
  assert.match(r.headers.get('set-cookie'),/HttpOnly/i);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/i);
  rejected(await f.request('/api/setup',{password:'Replacement-only-password!'}));
  rejected(await f.request('/api/login',{password:'WRONG_PASSWORD'}));
  ok(await f.request('/api/login',{password:PASSWORD}));
  const stolenCookie=f.cookie;
  ok(await f.request('/api/logout',{}));
  assert.equal((await f.request('/api/state',undefined,{headers:{Cookie:stolenCookie}})).status,401);
  ok(await f.request('/api/login',{password:PASSWORD}));
  assert.equal(ok(await f.request('/api/status')).authenticated,true);
});

test('request boundary: CSRF, foreign Origin and Host are rejected without state changes',async t=>{
  const f=await fixture(t,{allowedHosts:'app.example.com'});const before=await f.state();
  const body={type:'profile.save',payload:{name:'ATTACK_CHANGED'}};
  assert.equal((await rawRequest(f,'/api/status',{Host:'app.example.com'})).status,200);
  const refused=await rawRequest(f,'/',{Host:'other.example.com'});
  assert.equal(refused.status,403);assert.match(refused.headers['content-type'],/text\/html/);
  for(const headers of [{'X-CSRF-Token':''},{'X-CSRF-Token':'forged'},{Origin:'https://attacker.invalid'},{Origin:'null'},{Host:'attacker.invalid'},{Origin:''}])rejected(headers.Host?await rawRequest(f,'/api/action',headers,body):await f.request('/api/action',body,{headers}),JSON.stringify(headers));
  assert.deepEqual(await f.state(),before);
  rejected(await rawRequest(f,'/api/status',{Host:'attacker.invalid'}),'foreign Host GET');
});

test('secrets: public responses and backup redact keys; empty key keeps, clearKey removes',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);
  assert.equal((await f.state()).settings.providers.chat.keySet,true);
  for(const r of [await f.request('/api/state'),await f.request('/api/backup'),await f.request('/api/status'),await f.request('/api/providers/test',{capability:'chat'}),await f.request('/api/providers/models',{capability:'chat'})]){ok(r);assert.equal(r.text.includes(SECRET),false);assert.equal(/passwordHash|"sessions"|"passwordSalt"/.test(r.text),false);}
  assert.ok(m.requests.some(x=>x.headers.authorization==='Bearer '+SECRET),'real provider Authorization header');
  ok(await f.action('settings.save',{providers:{chat:{key:''}}}));assert.equal((await f.state()).settings.providers.chat.keySet,true);
  ok(await f.action('settings.save',{providers:{chat:{clearKey:true}}}));assert.equal((await f.state()).settings.providers.chat.keySet,false);
});

test('model context: role history, explicit memory and personas isolate; ledger stays private',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);
  let s=await f.state();const [a,b]=s.roles;
  ok(await f.action('persona.save',{name:'Persona A',prompt:'PERSONA_A_PRIVATE'}));s=await f.state();const persona=s.personas.at(-1);
  ok(await f.action('role.save',{id:a.id,prompt:'ROLE_A_ONLY',personaId:persona.id}));
  ok(await f.action('role.save',{id:b.id,prompt:'ROLE_B_ONLY'}));
  ok(await f.action('memory.save',{roleId:a.id,content:'MEMORY_A_ONLY'}));
  ok(await f.action('memory.save',{roleId:b.id,content:'MEMORY_B_PRIVATE'}));
  ok(await f.action('ledger.save',{amountCents:765432,type:'expense',category:'private',merchant:'LEDGER_MERCHANT_SECRET',date:'2026-11-14',note:'LEDGER_NOTE_SECRET'}));
  ok(await chat(f,'/api/chat',{roleId:b.id,text:'HISTORY_B_PRIVATE',requestId:randomUUID()}));
  ok(await chat(f,'/api/chat',{roleId:a.id,text:'HISTORY_A_ONLY',requestId:randomUUID()}));
  const beforeCurrent=m.requests.length;
  ok(await chat(f,'/api/chat',{roleId:a.id,text:'CURRENT_A_ONLY',requestId:randomUUID()}));
  const request=m.requests.slice(beforeCurrent).find(r=>r.url.endsWith('/chat/completions')&&r.body.messages?.some(message=>message.role==='user'&&JSON.stringify(message.content).includes('CURRENT_A_ONLY')));
  assert.ok(request,'the current chat reached the provider');
  const sent=JSON.stringify(request.body);
  for(const value of ['ROLE_A_ONLY','PERSONA_A_PRIVATE','MEMORY_A_ONLY','HISTORY_A_ONLY','CURRENT_A_ONLY'])assert.ok(sent.includes(value),value);
  for(const value of ['ROLE_B_ONLY','MEMORY_B_PRIVATE','HISTORY_B_PRIVATE','LEDGER_MERCHANT_SECRET','LEDGER_NOTE_SECRET'])assert.equal(sent.includes(value),false,value);
  for(const r of m.requests)assert.doesNotMatch(JSON.stringify(r.body),/LEDGER_MERCHANT_SECRET|LEDGER_NOTE_SECRET/);
  const mem=(await f.state()).memories.find(x=>x.roleId===a.id);
  rejected(await f.action('memory.save',{id:mem.id,roleId:b.id,content:'move across roles'}));
});

test('model failures retain error message, redact upstream secrets and support explicit retry',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);const roleId=f.initial.roles[0].id;
  for(const mode of ['http-error','bad-json','empty']){
    m.setMode(mode);const text='FAILED_USER_'+mode;const before=(await f.state()).messages.filter(x=>x.sender==='assistant'&&x.status!=='demo').length;
    const r=await f.request('/api/chat',{roleId,text,requestId:randomUUID()});
    ok(r);assert.equal(r.json.accepted,true,'HTTP accepts the message before model completion');
    assert.equal(r.text.includes(SECRET),false,'upstream error must not echo bearer secret');
    const s=await settled(f,r.json.messageId,'error',20000),user=s.messages.find(x=>x.content===text&&x.sender==='user');
    assert.ok(user,'user message retained');assert.equal(user.status,'error');assert.ok(user.error);
    assert.equal(s.messages.filter(x=>x.sender==='assistant'&&x.status!=='demo').length,before,'failure cannot create assistant reply');
    assert.equal(JSON.stringify(s).includes(SECRET),false,'message error must redact secret');
    m.setMode('normal');ok(await chat(f,'/api/chat/retry',{messageId:user.id}));
    rejected(await f.request('/api/chat/retry',{messageId:user.id}));
  }
});

test('chat idempotency, conflicting replay and in-flight edits survive async model completion',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);const roleId=f.initial.roles[0].id,requestId=randomUUID();
  m.setMode('delay');const first=await f.request('/api/chat',{roleId,text:'IDEMPOTENT_CHAT',requestId});ok(first);assert.equal(first.json.accepted,true);await m.wait();
  const duplicate=await f.request('/api/chat',{roleId,text:'IDEMPOTENT_CHAT',requestId});ok(duplicate);
  assert.equal((await f.request('/api/chat',{roleId,text:'CONFLICTING_IN_FLIGHT',requestId})).status,409);
  assert.equal((await f.action('message.delete',{id:first.json.messageId,roleId:f.initial.roles[1].id})).status,409,'redundant roleId cannot bypass busy check for the actual message');
  ok(await f.action('profile.save',{bio:'DURING_ASYNC_CHAT_BIO'}));
  ok(await f.action('memory.save',{roleId,content:'DURING_ASYNC_CHAT_MEMORY'}));
  m.setMode('normal');
  try{ok(await chat(f,'/api/chat',{roleId,text:'OTHER_IN_FLIGHT',requestId:randomUUID()}));}finally{m.release();}
  ok(await f.request('/api/chat',{roleId,text:'IDEMPOTENT_CHAT',requestId}));
  rejected(await f.request('/api/chat',{roleId,text:'CONFLICTING_REPLAY',requestId}));
  const s=await f.state();assert.equal(s.messages.filter(x=>x.content==='IDEMPOTENT_CHAT').length,1);assert.equal(s.messages.filter(x=>x.content==='OTHER_IN_FLIGHT').length,1);assert.equal(m.requests.length,2);
  assert.ok(JSON.stringify(m.requests[1].body).includes('IDEMPOTENT_CHAT'));assert.ok(JSON.stringify(m.requests[1].body).includes('OTHER_IN_FLIGHT'));
  assert.equal(s.profile.bio,'DURING_ASYNC_CHAT_BIO');assert.ok(s.memories.some(x=>x.content==='DURING_ASYNC_CHAT_MEMORY'));
});

test('money: malformed and oversized amounts reject atomically; duplicate transfer debits once',async t=>{
  const f=await fixture(t);const roleId=f.initial.roles[0].id,before=await f.state();
  for(const amountCents of [-1,0,1.5,'100','NaN',null,1e30,Number.MAX_SAFE_INTEGER]){
    rejected(await f.action('wallet.transfer',{roleId,amountCents,type:'transfer',requestId:randomUUID()}));
    rejected(await f.action('ledger.save',{amountCents,type:'expense',date:'2026-11-14'}));
  }
  rejected(await f.action('wallet.transfer',{roleId,amountCents:before.wallet.balanceCents+1,type:'transfer',requestId:randomUUID()}));
  assert.deepEqual(await f.state(),before);
  const payload={roleId,amountCents:1234,type:'redpacket',requestId:randomUUID(),note:'PERSISTED_RED_PACKET_NOTE'};
  const results=await Promise.all([f.action('wallet.transfer',payload),f.action('wallet.transfer',payload)]);results.forEach(ok);
  rejected(await f.action('wallet.transfer',{...payload,amountCents:1235}));
  assert.equal((await f.action('wallet.transfer',{...payload,note:'DIFFERENT_NOTE'})).status,409);
  const after=await f.state();assert.equal(after.wallet.balanceCents,before.wallet.balanceCents-1234);assert.equal(after.wallet.transactions.length,before.wallet.transactions.length+1);
  assert.equal(after.messages.filter(x=>x.meta?.amountCents===1234).length,1);
  assert.equal(after.wallet.transactions.at(-1).note,payload.note);assert.equal(after.messages.find(x=>x.meta?.amountCents===1234).meta.note,payload.note);
  rejected(await f.action('wallet.transfer',{...payload,note:'x'.repeat(201),requestId:randomUUID()}));assert.deepEqual(await f.state(),after);
  const saved=await backup(f);ok(await f.request('/api/restore',{backup:saved,confirm:true}));assert.equal((await f.state()).wallet.transactions.at(-1).note,payload.note);
});

test('farm: immature harvest rejects, mature plot harvest succeeds once and repeat watering rejects',async t=>{
  const f=await fixture(t);let s=await f.state();const plotId=s.farm.plots[0].id;
  ok(await f.action('farm.plant',{plotId,crop:'carrot'}));const planted=await f.state();
  rejected(await f.action('farm.harvest',{plotId}));rejected(await f.action('farm.plant',{plotId,crop:'tomato'}));assert.deepEqual(await f.state(),planted);
  const b=await backup(f),plot=b.state.farm.plots.find(x=>x.id===plotId);plot.plantedAt=Date.now()-600000;plot.readyAt=Date.now()-300000;
  ok(await f.request('/api/restore',{backup:b,confirm:true}));s=await f.state();
  const results=await Promise.all([f.action('farm.harvest',{plotId}),f.action('farm.harvest',{plotId})]);assert.equal(results.filter(x=>x.status===200).length,1);results.filter(x=>x.status!==200).forEach(rejected);
  const after=await f.state();assert.equal(after.farm.coins,s.farm.coins+20);assert.equal(after.farm.plots[0].crop,null);
  const roleId=s.roles[0].id;rejected(await f.action('farm.water',{roleId}));ok(await f.action('farm.plant',{roleId,plotId:'1',crop:'carrot'}));ok(await f.action('farm.water',{roleId}));rejected(await f.action('farm.water',{roleId}));
});

test('vision bill recognition returns drafts and never creates ledger entries',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m,'vision');
  m.setReply(JSON.stringify([{amountCents:1299,type:'expense',category:'food',merchant:'MOCK_BILL_SHOP',date:'2026-11-14',note:'draft only'}]));
  const before=(await f.state()).ledger;
  const r=await f.request('/api/ledger/recognize',{image:PNG});ok(r);assert.ok(Array.isArray(r.json.drafts));assert.equal(r.json.drafts[0].amountCents,1299);
  assert.deepEqual((await f.state()).ledger,before);assert.ok(JSON.stringify(m.requests.at(-1).body).includes('data:image/png;base64,'));
});

test('backup: invalid schema and dangling references leave state intact; restore across instances retains local credentials and keys',async t=>{
  const a=await fixture(t),m=await mock(t);await configure(a,m);ok(await a.action('profile.save',{name:'MIGRATION_MARKER',avatar:PNG}));
  const sourceRole=a.initial.roles[0].id;
  ok(await a.action('memory.save',{roleId:sourceRole,content:'MIGRATION_MEMORY'}));
  ok(await a.action('ledger.save',{amountCents:4567,type:'expense',category:'migration',merchant:'MIGRATION_SHOP',date:'2026-11-14',note:'MIGRATION_NOTE'}));
  const previousMessages=new Set((await a.state()).messages.map(message=>message.id));
  ok(await a.action('wallet.transfer',{roleId:sourceRole,amountCents:4321,type:'transfer',requestId:randomUUID()}));
  const deadline=Date.now()+5000;let paymentReplied=false;
  while(Date.now()<deadline){
    if((await a.state()).messages.some(message=>message.roleId===sourceRole&&message.sender==='assistant'&&!previousMessages.has(message.id))){paymentReplied=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(paymentReplied,true,'the automatic payment reply finishes before backup migration');
  ok(await a.action('farm.plant',{plotId:a.initial.farm.plots[0].id,crop:'carrot'}));
  ok(await a.action('moment.create',{content:'MIGRATION_MOMENT',image:PNG,visibility:[sourceRole]}));
  ok(await a.action('message.favorite',{id:a.initial.messages[0].id}));
  const exported=await backup(a);assert.equal(JSON.stringify(exported).includes(SECRET),false);
  const localPassword='SECOND_INSTANCE_ONLY_PASSWORD_2026!';
  const b=await fixture(t,{password:localPassword});const localSecret='SECOND_INSTANCE_TEST_KEY';ok(await b.action('settings.save',{providers:{chat:{mode:'custom',baseUrl:m.url,model:'mock-chat',key:localSecret}}}));
  const original=await b.state();
  const corruptions=[x=>x.version=999,x=>x.state.ledger.push({id:randomUUID(),amountCents:-1,type:'expense',date:'2026-11-14'}),x=>x.state.messages.push({...x.state.messages[0],id:randomUUID(),roleId:'orphan-role'}),x=>x.state.wallet.roleBalances['orphan-role']=1,x=>x.state.farm.visits.push({roleId:'orphan-role',date:'2026-11-14'}),x=>x.state.favorites.push({id:randomUUID(),messageId:'orphan-message',content:'bad',type:'text',createdAt:Date.now()})];
  for(const key of ['personas','roles','messages','memories','moments','ledger','favorites'])corruptions.push(x=>x.state[key].push(null));
  corruptions.push(x=>x.state.wallet.transactions.push(null),x=>x.state.farm.plots[0]=null,x=>x.state.farm.visits.push(null),x=>x.state.settings.providers=null,x=>x.state.settings.providers.chat=null,x=>x.state.settings.preset=null);
  for(const corrupt of corruptions){const bad=structuredClone(exported);corrupt(bad);rejected(await b.request('/api/restore',{backup:bad,confirm:true}));assert.deepEqual(await b.state(),original);}
  rejected(await b.request('/api/restore',{backup:exported,confirm:false}));assert.deepEqual(await b.state(),original);
  ok(await b.request('/api/restore',{backup:exported,confirm:true}));const restored=await b.state();assert.equal(restored.profile.name,'MIGRATION_MARKER');
  for(const key of ['profile','personas','messages','memories','moments','ledger','wallet','farm','favorites'])assert.deepEqual(restored[key],exported.state[key],key+' migration');
  assert.deepEqual(restored.roles,withPersonaRevisions(exported.state.roles),'roles migration');
  assert.equal(restored.settings.providers.chat.keySet,true);
  ok(await b.request('/api/providers/test',{capability:'chat'}));assert.equal(m.requests.at(-1).headers.authorization,'Bearer '+localSecret);
  ok(await b.request('/api/logout',{}));rejected(await b.request('/api/login',{password:PASSWORD}));ok(await b.request('/api/login',{password:localPassword}));
});

test('input/static boundary: malformed JSON, oversized body, traversal and source/data disclosure',async t=>{
  const f=await fixture(t);const before=await f.state();
  for(const raw of ['{','null','[]','{"type":','{"type":"profile.save","payload":null}'])rejected(await f.request('/api/action',raw,{raw:true}));
  rejected(await f.request('/api/action','{"type":"profile.save","payload":{"bio":"'+ 'x'.repeat(21*1024*1024)+'"}}',{raw:true}));
  assert.deepEqual(await f.state(),before);
  for(const target of ['/server.cjs','/lib/state.cjs','/data/phone.sqlite','/.env','/.git/config','/../server.cjs','/%2e%2e/server.cjs','/..%2fserver.cjs','/%2e%2e%5cserver.cjs','/public/../../server.cjs']){
    const r=await rawRequest(f,target);assert.ok(r.status===400||r.status===403||r.status===404,`${target}: ${r.status}`);assert.equal(/SPDX-License-Identifier|module\.exports|SQLite format/.test(r.text),false,target);
  }
  const index=await f.request('/');assert.equal(index.status,200);
});

test('SSRF default: loopback provider denied without test-only override; no mock connection',async t=>{
  const f=await fixture(t,{privateProviders:false}),m=await mock(t);
  for(const baseUrl of [m.url,'http://localhost:9/v1','http://[::1]:9/v1','http://[::ffff:127.0.0.1]:9/v1','http://169.254.169.254/v1','http://2130706433:9/v1','http://10.0.0.1/v1']){
    const save=await f.action('settings.save',{providers:{chat:{mode:'custom',baseUrl,model:'mock-chat',key:SECRET}}});
    if(save.status>=400){rejected(save);continue;}
    const r=await f.request('/api/providers/test',{capability:'chat'});assert.equal(r.status,422,`${baseUrl}: ${r.status}: ${r.text}`);assert.equal(r.json?.code,'PROVIDER_SSRF',baseUrl);assert.equal(m.requests.length,0);
  }
});

test('provider redirect is rejected instead of forwarding Authorization to redirect destination',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);m.setMode('redirect');
  const r=await f.request('/api/providers/test',{capability:'chat'});assert.equal(r.status,502,`${r.status}: ${r.text}`);assert.equal(r.json?.code,'PROVIDER_REDIRECT');assert.equal(m.requests.length,1);assert.equal(m.requests[0].url,'/v1/chat/completions');
});

test('restoring old backups with changed provider destination clears local keys, including inherited preset URL',async t=>{
  const f=await fixture(t),m=await mock(t),other=await mock(t);
  for(const capability of ['chat','vision','tts','stt'])await configure(f,m,capability);
  const changed=await backup(f);delete changed.state.settings.ai;changed.state.settings.providers.chat.baseUrl=other.url;
  ok(await f.request('/api/restore',{backup:changed,confirm:true}));
  let s=await f.state();assert.equal(s.settings.providers.chat.keySet,false);for(const capability of ['vision','tts','stt'])assert.equal(s.settings.providers[capability].keySet,true);
  rejected(await f.request('/api/providers/test',{capability:'chat'}));assert.equal(other.requests.length,0,'new destination cannot receive old bearer key');
  ok(await f.action('settings.save',{preset:{baseUrl:m.url,model:'mock-chat'},providers:Object.fromEntries(['chat','vision','tts','stt'].map(k=>[k,{mode:'preset',key:SECRET}]))}));
  const changedPreset=await backup(f);delete changedPreset.state.settings.ai;changedPreset.state.settings.preset.baseUrl=other.url;
  ok(await f.request('/api/restore',{backup:changedPreset,confirm:true}));s=await f.state();
  for(const capability of ['chat','vision','tts','stt'])assert.equal(s.settings.providers[capability].keySet,false,capability);
  rejected(await f.request('/api/providers/test',{capability:'chat'}));assert.equal(other.requests.length,0);
});

test('restoring a changed AI source clears its key and legacy fields cannot override AI routing',async t=>{
  const f=await fixture(t),m=await mock(t),other=await mock(t);await configure(f,m);
  const saved=await backup(f),source=saved.state.settings.ai.sources.find(x=>x.id!=='pipi');
  saved.state.settings.providers.chat.baseUrl=other.url;
  ok(await f.request('/api/restore',{backup:saved,confirm:true}));
  ok(await f.request('/api/providers/test',{capability:'chat'}));assert.equal(other.requests.length,0);assert.equal(m.requests.at(-1).headers.authorization,'Bearer '+SECRET);
  source.baseUrl=other.url;source.key='BACKUP_KEY_MUST_NOT_IMPORT';
  ok(await f.request('/api/restore',{backup:saved,confirm:true}));
  const state=await f.state();assert.equal(state.settings.ai.sources.find(x=>x.id===source.id).keySet,false);
  rejected(await f.request('/api/providers/test',{capability:'chat'}));assert.equal(other.requests.length,0,'changed source cannot receive an earlier bearer key');
});

test('hidden summaries remain internal across ordinary APIs and failed engine restore stays atomic',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);
  ok(await f.request('/api/engine/modules',{id:'schedule',values:{autoGenerate:false}}));
  const saved=await backup(f),roleId=saved.state.roles[0].id,marker='PRIVATE_SUMMARY_ONLY_IN_BACKUP';
  saved.state.engine.summaries[roleId]={text:marker,coveredUntil:0,updatedAt:Date.now()};
  const restored=await f.request('/api/restore',{backup:saved,confirm:true});ok(restored);assert.equal(restored.text.includes(marker),false);
  for(const response of [await f.request('/api/state'),await f.request('/api/engine/config'),await f.request('/api/engine/jobs?roleId='+roleId),await f.request('/api/status'),await f.request('/api/providers/models',{capability:'chat'}),await f.request('/api/providers/test',{capability:'chat'}),await f.action('profile.save',{bio:'PUBLIC_CHANGE'}),await f.request('/api/login',{password:PASSWORD})]){
    ok(response);assert.equal(response.text.includes(marker),false);assert.equal(response.text.includes(SECRET),false);
  }
  ok(await chat(f,'/api/chat',{roleId,text:'继续聊天',requestId:randomUUID()}));assert.ok(JSON.stringify(m.requests.at(-1).body).includes(marker),'only the model receives the hidden summary');
  const exported=await backup(f);assert.equal(exported.state.engine.summaries[roleId].text,marker);assert.equal(JSON.stringify(exported).includes(SECRET),false);
  const before=await f.state();
  for(const corrupt of [state=>state.engine.summaries.missing={text:'bad',coveredUntil:0,updatedAt:0},state=>state.settings.modules.waiting={idleSeconds:500},state=>state.engine.usage[0].inputTokens=-1]){
    const invalid=structuredClone(exported);corrupt(invalid.state);rejected(await f.request('/api/restore',{backup:invalid,confirm:true}));assert.deepEqual(await f.state(),before);assert.deepEqual((await backup(f)).state,exported.state);
  }
});

test('explicitly protected first setup behind forwarded headers requires one-time token and consumes it',async t=>{
  const f=await fixture(t,{setup:false,requireSetupToken:true});
  const headers={'X-Forwarded-For':'203.0.113.10'};
  rejected(await f.request('/api/setup',{password:PASSWORD},{headers}));
  rejected(await f.request('/api/setup',{password:PASSWORD,setupToken:'invalid'},{headers}));
  const setupToken=(await readFile(path.join(f.dir,'setup-token.txt'),'utf8')).trim();
  ok(await f.request('/api/setup',{password:PASSWORD,setupToken},{headers}));
  await assert.rejects(readFile(path.join(f.dir,'setup-token.txt'),'utf8'),{code:'ENOENT'});
  rejected(await f.request('/api/setup',{password:PASSWORD,setupToken},{headers}));
});

test('native conversation deletion clears chat, returns open payments and keeps unrelated data through restore',async t=>{
  const f=await fixture(t),roleId=f.initial.roles[0].id;
  ok(await f.action('memory.save',{roleId,content:'DELETE_KEEP_MEMORY'}));
  ok(await f.action('message.favorite',{id:f.initial.messages.find(x=>x.roleId===roleId).id}));
  ok(await f.action('wallet.transfer',{roleId,amountCents:100,type:'transfer',requestId:randomUUID()}));
  ok(await f.action('conversation.mute',{roleId,muted:true}));
  const before=await f.state();
  ok(await f.action('conversation.delete',{roleId}));
  let after=await f.state();
  assert.equal(after.messages.some(x=>x.roleId===roleId),false);
  const role=after.roles.find(x=>x.id===roleId);assert.ok(role);assert.equal(role.hidden,true);assert.equal(role.unread,0);assert.equal(role.muted,true);
  const returned=after.wallet.transactions.at(-1);
  assert.equal(returned.id,before.wallet.transactions.at(-1).id);assert.equal(returned.status,'returned');
  assert.ok(returned.returnedAt>=returned.createdAt);
  assert.equal(after.wallet.balanceCents,before.wallet.balanceCents+100);
  assert.deepEqual(after.wallet.roleBalances,before.wallet.roleBalances);assert.deepEqual(after.memories,before.memories);
  assert.equal(after.favorites.length,before.favorites.length);assert.equal(after.favorites[0].content,before.favorites[0].content);
  assert.equal(after.favorites.some(x=>x.messageId&&before.messages.some(m=>m.roleId===roleId&&m.id===x.messageId)),false);
  const saved=await backup(f);ok(await f.request('/api/restore',{backup:saved,confirm:true}));after=await f.state();assert.equal(after.roles.find(x=>x.id===roleId).muted,true);
  assert.deepEqual(after.wallet.transactions.at(-1),returned);
  rejected(await f.action('conversation.mute',{roleId,muted:'true'}));
});

test('cover images and comment reply targets validate atomically and persist',async t=>{
  const f=await fixture(t);
  ok(await f.action('profile.save',{cover:PNG}));await checkMedia(f,(await f.state()).profile.cover,PNG,'png');
  const profileBefore=(await f.state()).profile;
  for(const cover of ['data:image/png;base64,PHNjcmlwdD4=', 'https://remote.invalid/a.png','data:image/png;base64,@@@']){
    rejected(await f.action('profile.save',{cover}));assert.deepEqual((await f.state()).profile,profileBefore);
  }
  ok(await f.action('moment.create',{content:'REPLY_TARGET',visibility:[]}));let s=await f.state();const id=s.moments.at(-1).id;
  ok(await f.action('moment.comment',{id,content:'FIRST_COMMENT'}));s=await f.state();const comment=s.moments.find(x=>x.id===id).comments.at(-1);
  ok(await f.action('moment.comment',{id,content:'REPLY_COMMENT',replyTo:comment.id}));s=await f.state();const reply=s.moments.find(x=>x.id===id).comments.at(-1);assert.equal(reply.replyTo,comment.id);assert.equal(reply.replyToAuthorId,comment.authorId);
  ok(await f.action('moment.create',{content:'OTHER_MOMENT',visibility:[]}));s=await f.state();const other=s.moments.at(-1).id;
  rejected(await f.action('moment.comment',{id:other,content:'CROSS_MOMENT_REPLY',replyTo:comment.id}));
  const corrupt=await backup(f);corrupt.state.moments.find(x=>x.id===other).comments.push({...reply,id:randomUUID()});const before=await f.state();rejected(await f.request('/api/restore',{backup:corrupt,confirm:true}));assert.deepEqual(await f.state(),before);
  const saved=await backup(f);ok(await f.request('/api/restore',{backup:saved,confirm:true}));assert.equal((await f.state()).profile.cover,profileBefore.cover);await checkMedia(f,profileBefore.cover,PNG,'png');
});

test('voice failure retains playable source and explicit retry sends transcript exactly once',async t=>{
  const f=await fixture(t),m=await mock(t),roleId=f.initial.roles[0].id,audio=wavFixture();
  const payload={roleId,audio,durationMs:1200,requestId:randomUUID()};
  const assistantBefore=(await f.state()).messages.filter(x=>x.sender==='assistant').length;
  const failed=await f.request('/api/chat',payload);ok(failed);assert.equal(failed.json.accepted,true);
  let s=await settled(f,failed.json.messageId,'error'),voice=s.messages.find(x=>x.id===failed.json.messageId);const reference=voice.meta.audio;
  await checkMedia(f,reference,audio,'wav');assert.equal(voice.type,'voice');assert.equal(voice.status,'error');assert.equal(voice.meta.durationMs,1200);assert.equal(s.messages.filter(x=>x.sender==='assistant').length,assistantBefore);
  await configure(f,m,'stt');await configure(f,m,'chat');ok(await chat(f,'/api/chat/retry',{messageId:voice.id}));
  s=await f.state();voice=s.messages.find(x=>x.id===voice.id);assert.equal(voice.meta.audio,reference);assert.equal(voice.meta.transcript,'MOCK_VOICE_TRANSCRIPT');assert.equal(voice.status,'sent');
  assert.equal(m.requests.filter(x=>x.url.endsWith('/audio/transcriptions')).length,1);assert.ok(JSON.stringify(m.requests.find(x=>x.url.endsWith('/chat/completions')).body).includes('MOCK_VOICE_TRANSCRIPT'));
  rejected(await f.request('/api/chat/retry',{messageId:voice.id}));assert.equal(m.requests.filter(x=>x.url.endsWith('/audio/transcriptions')).length,1);
  const before=await f.state();for(const patch of [{durationMs:0},{durationMs:1.2},{durationMs:600001},{audio:'data:audio/webm;base64,@@@@'},{audio:'data:text/html;base64,AQID'},{text:'must not mix'}])rejected(await f.request('/api/chat',{...payload,...patch,requestId:randomUUID()}));assert.deepEqual(await f.state(),before);
});

test('voice idempotency includes source audio and ordinary message deletion stays rejected while busy',async t=>{
  const f=await fixture(t),m=await mock(t),roleId=f.initial.roles[0].id;await configure(f,m,'stt');await configure(f,m,'chat');
  const payload={roleId,audio:wavFixture(),durationMs:1000,requestId:randomUUID()};
  m.setMode('delay');const pending=await f.request('/api/chat',payload);ok(pending);await m.wait();
  try{assert.equal((await f.action('message.delete',{id:pending.json.messageId})).status,409);assert.equal((await f.request('/api/chat',{...payload,audio:wavFixture(42)})).status,409);}finally{m.release();}
  // Subsequent chat request must not wait behind a second artificial delayed stage.
  m.setMode('normal');await settled(f,pending.json.messageId);ok(await f.request('/api/chat',payload));
  const s=await f.state(),voices=s.messages.filter(x=>x.roleId===roleId&&x.type==='voice');assert.equal(voices.length,1);await checkMedia(f,voices[0].meta.audio,payload.audio,'wav');assert.equal(m.requests.filter(x=>x.url.endsWith('/audio/transcriptions')).length,1);
});

test('quoted messages reject cross-role references and preserve detached snapshots',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);
  const roleId=f.initial.roles[0].id,otherId=f.initial.roles[1].id;
  const target=f.initial.messages.find(x=>x.roleId===roleId);
  ok(await chat(f,'/api/chat',{roleId:otherId,text:'OTHER_ROLE_QUOTE_SOURCE',requestId:randomUUID()}));
  const before=await f.state(),other=before.messages.find(x=>x.roleId===otherId);
  for(const quoteId of [other.id,'missing-message'])rejected(await f.request('/api/chat',{roleId,text:'INVALID_QUOTE',quoteId,requestId:randomUUID()}));
  assert.deepEqual(await f.state(),before);
  ok(await chat(f,'/api/chat',{roleId,text:'QUOTING_MESSAGE',quoteId:target.id,requestId:randomUUID()}));
  let s=await f.state(),quoted=s.messages.find(x=>x.content==='QUOTING_MESSAGE');assert.equal(quoted.meta.quote.messageId,target.id);assert.equal(quoted.meta.quote.content,target.content);
  ok(await f.action('message.delete',{id:target.id}));s=await f.state();quoted=s.messages.find(x=>x.id===quoted.id);assert.ok(!quoted.meta.quote.messageId);assert.equal(quoted.meta.quote.content,target.content);
  const saved=await backup(f);ok(await f.request('/api/restore',{backup:saved,confirm:true}));
  assert.equal((await f.state()).messages.find(x=>x.id===quoted.id).meta.quote.content,target.content);
});

test('favorited voice keeps source across conversation deletion, backup and replay',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m,'stt');await configure(f,m,'chat');const roleId=f.initial.roles[0].id;
  const payload={roleId,audio:wavFixture(),durationMs:900,requestId:randomUUID()};ok(await chat(f,'/api/chat',payload));
  let s=await f.state();const voice=s.messages.find(x=>x.roleId===roleId&&x.type==='voice'),reference=voice.meta.audio;ok(await f.action('message.favorite',{id:voice.id}));
  ok(await f.action('conversation.delete',{roleId}));s=await f.state();const favorite=s.favorites.find(x=>x.meta?.audio===reference);assert.ok(favorite);assert.ok(!favorite.messageId);assert.equal(favorite.meta.transcript,'MOCK_VOICE_TRANSCRIPT');await checkMedia(f,reference,payload.audio,'wav');
  ok(await f.request('/api/chat',payload));assert.equal((await f.state()).messages.some(x=>x.roleId===roleId),false,'replay cannot resurrect deleted conversation');
  assert.equal((await f.request('/api/chat',{...payload,audio:wavFixture(42)})).status,409);
  const saved=await backup(f);ok(await f.request('/api/restore',{backup:saved,confirm:true}));assert.equal((await f.state()).favorites.find(x=>x.id===favorite.id).meta.audio,reference);await checkMedia(f,reference,payload.audio,'wav');
});
