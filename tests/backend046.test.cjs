// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdtemp,rm}=require('node:fs/promises');
const os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createApp}=require('../scripts/sample-data.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=';
const WAV=Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000','hex');
const AUDIO='data:audio/wav;base64,'+WAV.toString('base64'),PASSWORD='Backend-046-local-test!';
function imageBytes(dataUrl){return Buffer.from(dataUrl.split(',')[1],'base64');}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const reject=r=>assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));
const msg=(roleId,content,type='text',extra={})=>({id:randomUUID(),roleId,sender:'user',type,content,status:'sent',createdAt:Date.now(),...extra});
async function fixture(t,{demoModel=false}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'pipi-backend046-'));
  let app,base,cookie='',csrf='';
  async function start(){app=createApp({dataDir:dir,host:'127.0.0.1',port:0,demoModel});await app.listen();base='http://127.0.0.1:'+app.server.address().port;}
  await start();
  async function request(route,body){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'X-CSRF-Token':csrf,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,body:value};
  }
  async function checkImage(reference,expected){
    assert.match(reference,/^\/api\/media\/[a-f0-9]{64}\.png$/);
    const response=await fetch(base+reference,{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),imageBytes(expected));
  }
  const f={request,checkImage,action:(type,payload={})=>request('/api/action',{type,payload}),state:async()=>ok(await request('/api/state')),backup:async()=>ok(await request('/api/backup')),restore:async backup=>ok(await request('/api/restore',{backup,confirm:true})),async restart(){await app.close();await start();ok(await request('/api/login',{password:PASSWORD}));}};
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  ok(await request('/api/setup',{password:PASSWORD}));
  ok(await request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0,maxWaitSeconds:1}}));
  ok(await request('/api/engine/modules',{id:'segments',values:{intervalMode:'random',minSeconds:0,maxSeconds:0}}));
  ok(await request('/api/engine/modules',{id:'schedule',values:{autoGenerate:false}}));
  return f;
}
async function mock(t){
  const before=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const requests=[];let mode='ok';
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    let body;try{body=JSON.parse(raw);}catch{body=raw;}
    requests.push({url:req.url,body});
    res.writeHead(mode==='error'?503:200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(req.url.endsWith('/audio/transcriptions')?{text:'LOCAL_TRANSCRIPT_046'}:{choices:[{message:{content:'LOCAL_REPLY_046'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(before===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=before;});
  return {requests,url:'http://127.0.0.1:'+server.address().port+'/v1',setMode(value){mode=value;}};
}
async function configure(f,m,capabilities=['chat']){ok(await f.action('settings.save',{providers:Object.fromEntries(capabilities.map(key=>[key,{mode:'custom',baseUrl:m.url,model:'local-test',key:'NOT_A_REAL_KEY'}]))}));}
async function unchanged(f,operation){const before=await f.state();reject(await operation());assert.deepEqual(await f.state(),before);}
async function chat(f,route,payload){
  const response=await f.request(route,payload),accepted=ok(response);assert.equal(accepted.accepted,true);
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const state=await f.state(),message=state.messages.find(x=>x.id===accepted.messageId);
    if(message?.status==='sent')return response;
    if(message?.status==='error')assert.fail(message.error);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('accepted message did not finish');
}

test('046 recall: owned sent types and pats retain notices, detach favorites and never erase AI replies',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);
  const b=await f.backup(),[a,z]=b.state.roles;
  const text=msg(a.id,'RECALLED_PRIVATE_TEXT'),image=msg(a.id,PNG,'image'),voice=msg(a.id,'','voice',{meta:{audio:AUDIO,durationMs:450}}),forward=msg(a.id,'聊天记录','forward',{meta:{entries:[{senderName:'源作者',type:'text',content:'snapshot'}]}}),assistant=msg(a.id,'既有AI回复','text',{sender:'assistant'}),old=msg(a.id,'已过期','text',{createdAt:Date.now()-121000}),system=msg(a.id,'你拍了拍朋友','text',{sender:'system'}),pending=msg(a.id,'失败消息','text',{status:'error'});
  b.state.messages.push(text,image,voice,forward,assistant,old,system,pending);await f.restore(b);
  ok(await f.action('message.favorite',{id:text.id}));
  ok(await f.action('message.recall',{id:text.id}));
  let s=await f.state(),notice=s.messages.find(x=>x.id===text.id);
  assert.equal(notice.sender,'system');assert.equal(notice.meta.recalledText,'RECALLED_PRIVATE_TEXT');assert.equal(notice.content,'你撤回了一条消息');
  assert.equal(s.favorites.at(-1).content,'RECALLED_PRIVATE_TEXT');assert.equal(s.favorites.at(-1).messageId,undefined);assert.ok(s.messages.some(x=>x.id===assistant.id));
  for(const id of [image.id,voice.id,forward.id]){ok(await f.action('message.recall',{id}));assert.equal((await f.state()).messages.find(x=>x.id===id).meta.recalledText,undefined);}
  for(const target of ['self','contact']){ok(await f.action('message.pat',{roleId:a.id,target}));ok(await f.action('message.recall',{id:(await f.state()).messages.at(-1).id}));}
  const previousMessages=new Set((await f.state()).messages.map(message=>message.id)),requestId=randomUUID();
  const payment=ok(await f.action('wallet.transfer',{roleId:a.id,amountCents:1,type:'transfer',requestId})).state,transaction=payment.wallet.transactions.find(transaction=>transaction.requestId===requestId),moneyId=payment.messages.find(message=>message.meta?.transactionId===transaction.id).id;
  const deadline=Date.now()+15000;let paymentReplied=false;
  while(Date.now()<deadline){
    if((await f.state()).messages.some(message=>message.roleId===a.id&&message.sender==='assistant'&&!previousMessages.has(message.id))){paymentReplied=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(paymentReplied,true,'the automatic payment reply finishes before recall checks');
  for(const id of [text.id,assistant.id,old.id,system.id,pending.id,moneyId,'missing'])await unchanged(f,()=>f.action('message.recall',{id}));
  ok(await chat(f,'/api/chat/send',{roleId:a.id,text:'下条普通消息',requestId:randomUUID()}));
  assert.equal(JSON.stringify(m.requests.at(-1).body).includes('RECALLED_PRIVATE_TEXT'),false);
  const saved=await f.backup();await f.restart();await f.restore(saved);s=await f.state();assert.equal(s.messages.find(x=>x.id===text.id).meta.recalledText,text.content);assert.ok(s.roles.some(x=>x.id===z.id));
});

test('备份恢复保留原消息编号、旧正文、有效引用和已撤回状态',async t=>{
  const source=await fixture(t),target=await fixture(t);
  const seed=await source.backup(),roleId=seed.state.roles[0].id;
  const original=msg(roleId,'我明天要去面试');
  const oldReply=msg(roleId,`[消息编号：${original.id}] 面试加油。`,'text',{sender:'assistant'});
  const withdrawn=msg(roleId,'这句要撤回');
  seed.state.messages=[original,oldReply,withdrawn];
  const {quote}=require('../lib/state.cjs');
  oldReply.meta={quote:quote(seed.state,roleId,original.id)};
  const quoteOfOld=msg(roleId,'谢谢你','text',{meta:{quote:quote(seed.state,roleId,oldReply.id)}});
  const quoteOfWithdrawn=msg(roleId,'已读到','text',{sender:'assistant',meta:{quote:quote(seed.state,roleId,withdrawn.id)}});
  seed.state.messages.push(quoteOfOld,quoteOfWithdrawn);
  await source.restore(seed);
  ok(await source.action('message.recall',{id:withdrawn.id}));
  const saved=await source.backup();
  assert.equal(saved.state.messages.find(m=>m.id===oldReply.id).content,oldReply.content);

  await target.restore(saved);
  await target.restart();
  const publicMessages=(await target.state()).messages;
  const lookup=id=>publicMessages.find(m=>m.id===id);
  assert.equal(lookup(oldReply.id).content,'面试加油。');
  assert.deepEqual(lookup(oldReply.id).meta.quote,oldReply.meta.quote);
  assert.equal(lookup(quoteOfOld.id).meta.quote.messageId,oldReply.id);
  assert.equal(lookup(quoteOfOld.id).meta.quote.content,'面试加油。');
  assert.equal(lookup(withdrawn.id).meta.recalledText,withdrawn.content);
  assert.equal(lookup(quoteOfWithdrawn.id).meta.quote.unavailable,'recalled');
  assert.equal(lookup(quoteOfWithdrawn.id).meta.quote.messageId,undefined);
  assert.deepEqual((await target.backup()).state.messages,saved.state.messages);
});

test('046 merged forwarding: immutable author/media snapshots, atomic selection limits and bounded nesting',async t=>{
  const f=await fixture(t),b=await f.backup(),[a,z]=b.state.roles;
  const a1=msg(a.id,'first','text',{createdAt:Date.now()-1000}),a2=msg(a.id,PNG,'image'),a3=msg(z.id,'other'),payment=msg(a.id,'红包','redpacket',{meta:{amountCents:9}});
  b.state.messages.push(a1,a2,a3,payment);await f.restore(b);const coins=(await f.state()).wallet;
  ok(await f.action('message.forward',{ids:[a2.id,a1.id],targetRoleId:z.id,mode:'merged'}));
  let s=await f.state(),card=s.messages.at(-1);assert.equal(card.type,'forward');assert.deepEqual(card.meta.entries.map(x=>x.type),['text','image']);assert.equal(card.meta.entries[0].senderName,s.profile.name);assert.deepEqual(s.wallet,coins);
  ok(await f.action('profile.save',{name:'新名'}));assert.equal((await f.state()).messages.find(x=>x.id===card.id).meta.entries[0].senderName,card.meta.entries[0].senderName);
  for(const ids of [[a1.id,a1.id],[a1.id,a3.id],[a1.id,payment.id]])await unchanged(f,()=>f.action('message.forward',{ids,targetRoleId:z.id,mode:'merged'}));
  ok(await f.action('message.favorite',{id:card.id}));
  for(let depth=2;depth<=3;depth++){ok(await f.action('message.forward',{ids:[card.id],targetRoleId:z.id,mode:'merged'}));card=(await f.state()).messages.at(-1);}
  await unchanged(f,()=>f.action('message.forward',{ids:[card.id],targetRoleId:z.id,mode:'merged'}));
  const saved=await f.backup();await f.restore(saved);assert.deepEqual((await f.state()).favorites.at(-1).meta.entries,saved.state.favorites.at(-1).meta.entries);
  const bad=structuredClone(saved);bad.state.messages.find(x=>x.type==='forward').meta.entries[0].type='transfer';await unchanged(f,()=>f.request('/api/restore',{backup:bad,confirm:true}));
});

test('046 quote: safe image and original author survive rename, delete, recall, forward and restore',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m);const b=await f.backup(),[a,z]=b.state.roles;
  const source=msg(a.id,PNG,'image');b.state.messages.push(source);await f.restore(b);
  ok(await chat(f,'/api/chat/send',{roleId:a.id,text:'引用图片',quoteId:source.id,requestId:randomUUID()}));
  let s=await f.state(),quoted=s.messages.find(x=>x.content==='引用图片');const photo=quoted.meta.quote.image;await f.checkImage(photo,PNG);assert.equal(quoted.meta.quote.senderName,s.profile.name);
  ok(await f.action('message.forward',{ids:[quoted.id],targetRoleId:z.id,mode:'merged'}));assert.equal((await f.state()).messages.at(-1).meta.entries[0].meta.quote.image,photo);
  ok(await f.action('profile.save',{name:'改名后'}));ok(await f.action('message.recall',{id:source.id}));
  quoted=(await f.state()).messages.find(x=>x.id===quoted.id);assert.equal(quoted.meta.quote.messageId,undefined);assert.equal(quoted.meta.quote.unavailable,'recalled');assert.equal(quoted.meta.quote.image,photo);assert.notEqual(quoted.meta.quote.senderName,'改名后');
  const saved=await f.backup();await f.restore(saved);assert.deepEqual((await f.state()).messages.find(x=>x.id===quoted.id).meta.quote,quoted.meta.quote);
  for(const mode of ['individual','merged']){
    ok(await f.action('message.forward',{ids:[quoted.id],targetRoleId:z.id,mode}));
    const forwarded=(await f.state()).messages.at(-1),snapshot=mode==='merged'?forwarded.meta.entries[0].meta.quote:forwarded.meta.quote;
    assert.equal(snapshot.unavailable,'recalled');assert.equal(snapshot.image,photo);
  }
  const forwardedBackup=await f.backup();await f.restore(forwardedBackup);assert.equal((await f.state()).messages.at(-1).meta.entries[0].meta.quote.unavailable,'recalled');
  const bad=structuredClone(saved);bad.state.messages.find(x=>x.id===quoted.id).meta.quote.image='https://bad.invalid/x';await unchanged(f,()=>f.request('/api/restore',{backup:bad,confirm:true}));
});

test('046 permissions: chat, retries, voice and moments block before provider; visible contexts isolate roles and ledger',async t=>{
  const f=await fixture(t),m=await mock(t);await configure(f,m,['chat','stt','tts']);let s=await f.state();const [a,z]=s.roles;
  ok(await f.action('moment.create',{content:'VISIBLE_TO_A',visibility:[a.id]}));ok(await f.action('moment.create',{content:'ONLY_Z_PRIVATE',visibility:[z.id]}));
  const b=await f.backup(),error=msg(a.id,'failed','text',{status:'error'}),voice=msg(a.id,'','voice',{meta:{audio:AUDIO,durationMs:450}});
  b.state.messages.push(error,voice);b.state.moments.push({id:randomUUID(),authorId:z.id,content:'Z_POST_PRIVATE',image:'',visibility:'all',likes:[],comments:[],createdAt:Date.now()});await f.restore(b);
  ok(await chat(f,'/api/chat/send',{roleId:a.id,text:'context',requestId:randomUUID()}));let sent=JSON.stringify(m.requests.at(-1).body);assert.ok(sent.includes('VISIBLE_TO_A'));for(const marker of ['ONLY_Z_PRIVATE','Z_POST_PRIVATE'])assert.equal(sent.includes(marker),false);
  ok(await f.action('role.save',{id:a.id,permissions:{hideMyMoments:true}}));ok(await chat(f,'/api/chat/send',{roleId:a.id,text:'hidden context',requestId:randomUUID()}));assert.equal(JSON.stringify(m.requests.at(-1).body).includes('VISIBLE_TO_A'),false);
  ok(await f.action('role.save',{id:a.id,permissions:{onlyChat:true}}));await unchanged(f,()=>f.request('/api/moments/generate',{roleId:a.id}));
  ok(await f.action('role.save',{id:a.id,permissions:{blocked:true}}));const count=m.requests.length;
  for(const [route,payload]of [['/api/chat/send',{roleId:a.id,text:'blocked',requestId:randomUUID()}],['/api/chat/retry',{messageId:error.id}],['/api/voice/transcribe',{messageId:voice.id}],['/api/voice/speak',{messageId:error.id}],['/api/moments/generate',{roleId:a.id}]])await unchanged(f,()=>f.request(route,payload));
  for(const type of ['transfer','redpacket'])await unchanged(f,()=>f.action('wallet.transfer',{roleId:a.id,type,amountCents:1,requestId:randomUUID()}));
  assert.equal(m.requests.length,count);s=await f.state();assert.deepEqual(s.roles.find(r=>r.id===a.id).permissions,{blocked:true,onlyChat:true,hideMyMoments:true,hideTheirMoments:false});assert.ok(s.messages.some(x=>x.id===error.id));
  ok(await f.action('role.save',{id:a.id,permissions:{blocked:false}}));ok(await chat(f,'/api/chat/send',{roleId:a.id,text:'仅聊天正常',requestId:randomUUID()}));assert.equal(JSON.stringify(m.requests.at(-1).body).includes('VISIBLE_TO_A'),false);
  const saved=await f.backup();await f.restart();await f.restore(saved);assert.deepEqual((await f.state()).roles.find(r=>r.id===a.id).permissions,saved.state.roles.find(r=>r.id===a.id).permissions);
});

test('046 profile: gender and status history preserve partial updates, end, expiration and old backups',async t=>{
  const f=await fixture(t);ok(await f.action('profile.save',{gender:'female'}));ok(await f.action('profile.save',{bio:'partial'}));assert.equal((await f.state()).profile.gender,'female');
  ok(await f.action('status.save',{preset:'happy',description:'第一条'}));ok(await f.action('status.save',{preset:'busy',description:'第二条'}));ok(await f.action('status.end'));
  let s=await f.state();assert.equal(s.profile.status,null);assert.deepEqual(s.statusHistory.map(x=>x.description),['第一条','第二条']);assert.ok(s.statusHistory.every(x=>x.endedAt>=x.startedAt));
  const b=await f.backup(),now=Date.now();b.state.profile.status={preset:'sleep',description:'已到期',startedAt:now-86400001,expiresAt:now-1};await f.restore(b);s=await f.state();assert.equal(s.profile.status,null);assert.equal(s.statusHistory.at(-1).description,'已到期');assert.equal((await f.state()).statusHistory.length,3);
  await f.restart();assert.deepEqual((await f.state()).statusHistory,s.statusHistory);await unchanged(f,()=>f.action('profile.save',{gender:'other'}));
  const legacy=await f.backup();delete legacy.state.profile.gender;delete legacy.state.statusHistory;await f.restore(legacy);assert.equal((await f.state()).profile.gender,'unset');assert.deepEqual((await f.state()).statusHistory,[]);
});

test('046 moments: nine safe photos, literal location, targeted mentions and notifications backed by real events',async t=>{
  const f=await fixture(t),[a,z]=(await f.state()).roles;
  ok(await f.action('moment.create',{content:'本地相册',images:Array(9).fill(PNG),location:'公园',mentions:[a.id],visibility:[a.id]}));let s=await f.state(),moment=s.moments.at(-1);assert.equal(moment.images.length,9);await f.checkImage(moment.image,PNG);assert.deepEqual(s.momentNotifications,[]);
  for(const payload of [{images:Array(10).fill(PNG)},{images:['https://bad.invalid/a']},{location:'line\nbreak',content:'x'},{mentions:[z.id],visibility:[a.id],content:'x'},{mentions:['missing'],content:'x'}])await unchanged(f,()=>f.action('moment.create',payload));
  ok(await f.action('moment.like',{id:moment.id}));ok(await f.action('moment.comment',{id:moment.id,content:'自己的评论'}));assert.deepEqual((await f.state()).momentNotifications,[]);
  const b=await f.backup(),comment={id:randomUUID(),authorId:a.id,content:'真实存档的角色评论',createdAt:Date.now()};b.state.moments.at(-1).likes.push(a.id);b.state.moments.at(-1).comments.push(comment);await f.restore(b);s=await f.state();assert.deepEqual(s.momentNotifications.map(n=>n.type),['like','comment']);assert.equal(s.momentNotifications[1].content,comment.content);
  ok(await f.action('moment.notifications.read',{ids:[s.momentNotifications[1].id]}));await f.restart();s=await f.state();assert.equal(s.momentNotifications[1].read,true);assert.equal(s.momentNotifications[0].read,false);
  const saved=await f.backup();await f.restore(saved);assert.deepEqual((await f.state()).momentNotifications,s.momentNotifications);
  const fake=structuredClone(saved);fake.state.momentNotifications.push({id:'invented',createdAt:Date.now(),read:false});await unchanged(f,()=>f.request('/api/restore',{backup:fake,confirm:true}));
  const self=s.moments.at(-1).comments.find(c=>c.authorId==='me');ok(await f.action('moment.comment.delete',{id:moment.id,commentId:self.id}));await unchanged(f,()=>f.action('moment.comment.delete',{id:moment.id,commentId:comment.id}));
});

test('046 notes: text, photos and todos persist; edits retain IDs and malformed saves reject atomically',async t=>{
  const f=await fixture(t);ok(await f.action('favorite.save',{content:'采购',images:[PNG],todos:[{text:'番茄',done:false},{text:'胡萝卜',done:true}]}));let note=(await f.state()).favorites.at(-1);assert.equal(note.type,'note');await f.checkImage(note.meta.images[0],PNG);
  const todos=note.meta.todos.map(x=>({...x,done:true}));ok(await f.action('favorite.save',{id:note.id,todos}));note=(await f.state()).favorites.at(-1);assert.equal(note.content,'采购');assert.deepEqual(note.meta.todos,todos);
  for(const payload of [{content:'',images:[],todos:[]},{images:['javascript:bad']},{todos:[{id:'same',text:'a'},{id:'same',text:'b'}]},{todos:[{text:'',done:true}]},{todos:[{text:'a',done:'true'}]}])await unchanged(f,()=>f.action('favorite.save',{id:note.id,...payload}));
  const saved=await f.backup();await f.restart();await f.restore(saved);assert.deepEqual((await f.state()).favorites.at(-1),note);
});

test('046 farms: empty visits cannot mint coins, friends own real plots, watering accelerates once and harvest persists',async t=>{
  const f=await fixture(t);let s=await f.state();const [a,z]=s.roles;
  await unchanged(f,()=>f.action('farm.water',{roleId:a.id}));ok(await f.action('farm.plant',{roleId:a.id,plotId:'1',crop:'carrot'}));s=await f.state();const ready=s.farm.friends[a.id].plots[0].readyAt;assert.equal(s.farm.friends[a.id].seeds,9);assert.equal(s.farm.friends[z.id].seeds,10);assert.equal(s.farm.plots[0].crop,null);
  ok(await f.action('farm.water',{roleId:a.id,plotId:'1'}));s=await f.state();assert.equal(s.farm.friends[a.id].plots[0].readyAt,ready-60000);assert.equal(s.farm.coins,105);await unchanged(f,()=>f.action('farm.water',{roleId:a.id,plotId:'1'}));await unchanged(f,()=>f.action('farm.harvest',{roleId:a.id,plotId:'1'}));
  const b=await f.backup();Object.assign(b.state.farm.friends[a.id].plots[0],{plantedAt:Date.now()-300001,readyAt:Date.now()-1});await f.restore(b);ok(await f.action('farm.harvest',{roleId:a.id,plotId:'1'}));s=await f.state();assert.equal(s.farm.friends[a.id].coins,120);assert.equal(s.farm.friends[a.id].seeds,11);assert.equal(s.farm.coins,105);await unchanged(f,()=>f.action('farm.harvest',{roleId:a.id,plotId:'1'}));
  await f.restart();assert.deepEqual((await f.state()).farm,s.farm);const saved=await f.backup(),bad=structuredClone(saved);bad.state.farm.friends.missing=bad.state.farm.friends[a.id];await unchanged(f,()=>f.request('/api/restore',{backup:bad,confirm:true}));
  delete saved.state.farm.friends;delete saved.state.farm.visits[0].plotId;await f.restore(saved);assert.ok((await f.state()).farm.friends[a.id].plots.every(p=>p.crop===null));
});

test('046 message transcription: clear demo provenance, durable transcript, cached replay and unconfigured state',async t=>{
  const f=await fixture(t,{demoModel:true}),m=await mock(t);const b=await f.backup(),a=b.state.roles[0],voice=msg(a.id,'','voice',{meta:{audio:AUDIO,durationMs:450}});b.state.messages.push(voice);await f.restore(b);
  await unchanged(f,()=>f.request('/api/voice/transcribe',{messageId:voice.id}));await configure(f,m,['stt']);const result=ok(await f.request('/api/voice/transcribe',{messageId:voice.id}));assert.equal(result.text,'LOCAL_TRANSCRIPT_046');assert.equal(result.demo,true);assert.equal(result.state.messages.find(x=>x.id===voice.id).meta.transcriptSource,'demo');const calls=m.requests.length;
  ok(await f.request('/api/voice/transcribe',{messageId:voice.id}));assert.equal(m.requests.length,calls);await f.restart();ok(await f.request('/api/voice/transcribe',{messageId:voice.id}));assert.equal(m.requests.length,calls);
  const saved=await f.backup();await f.restore(saved);assert.equal((await f.state()).messages.find(x=>x.id===voice.id).meta.transcript,'LOCAL_TRANSCRIPT_046');
  await unchanged(f,()=>f.request('/api/voice/transcribe',{messageId:voice.id,audio:AUDIO}));await unchanged(f,()=>f.request('/api/voice/transcribe',{messageId:saved.state.messages[0].id}));
  ok(await f.action('message.forward',{ids:[voice.id],targetRoleId:a.id,mode:'merged'}));
  const card=(await f.state()).messages.at(-1);assert.equal(card.meta.entries[0].meta.transcriptSource,'demo');
  const mergedBackup=await f.backup();await f.restore(mergedBackup);assert.equal((await f.state()).messages.at(-1).meta.entries[0].meta.transcriptSource,'demo');
});

test('046 independent voice races: restore is blocked in flight; deletion, recall and block reject stale transcription',async t=>{
  const f=await fixture(t,{demoModel:true}),before=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  let started,release;
  const server=http.createServer(async(req,res)=>{
    for await(const chunk of req)void chunk;
    release=()=>{res.writeHead(200,{'Content-Type':req.url.endsWith('/speech')?'audio/wav':'application/json'});res.end(req.url.endsWith('/speech')?WAV:JSON.stringify({text:'LATE_TRANSCRIPT'}));};
    started();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(before===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=before;});
  await configure(f,{url:'http://127.0.0.1:'+server.address().port+'/v1'},['stt','tts']);
  const b=await f.backup(),a=b.state.roles[0],voice=msg(a.id,'','voice',{meta:{audio:AUDIO,durationMs:500}}),spoken=msg(a.id,'要朗读的文字','text',{sender:'assistant'});b.state.messages.push(voice,spoken);await f.restore(b);
  for(const [route,messageId]of [['/api/voice/transcribe',voice.id],['/api/voice/speak',spoken.id]]){
    const ready=new Promise(resolve=>{started=resolve;}),pending=f.request(route,{messageId});await ready;
    try{const response=await f.request('/api/restore',{backup:b,confirm:true});assert.equal(response.status,409);assert.equal(response.body.code,'BUSY');}finally{release();}
    ok(await pending);await f.restore(b);
  }
  for(const action of ['message.delete','message.recall','role.save']){
    const ready=new Promise(resolve=>{started=resolve;}),pending=f.request('/api/voice/transcribe',{messageId:voice.id});await ready;
    try{ok(await f.action(action,action==='role.save'?{id:a.id,permissions:{blocked:true}}:{id:voice.id}));}finally{release();}
    reject(await pending);const latest=await f.state();assert.equal(latest.messages.find(m=>m.id===voice.id)?.meta?.transcript,undefined);
    await f.restore(b);
  }
});

test('046 independent image payload: a nine-photo action above 32 MB saves while the chat JSON route rejects it',async t=>{
  const f=await fixture(t),largePng='data:image/png;base64,'+Buffer.concat([imageBytes(PNG),Buffer.alloc(3*1024*1024)]).toString('base64');
  const payload={content:'九张本地测试图片',images:Array(9).fill(largePng),visibility:[]};
  assert.ok(Buffer.byteLength(JSON.stringify(payload))>32*1024*1024);
  const before=await f.state(),chat=await f.request('/api/chat/send',payload);assert.equal(chat.status,413);assert.deepEqual(await f.state(),before);
  const result=ok(await f.action('moment.create',payload)),images=result.state.moments.at(-1).images;
  assert.equal(images.length,9);await f.checkImage(images[8],largePng);
  await f.restart();assert.equal((await f.state()).moments.at(-1).images[8],images[8]);await f.checkImage(images[8],largePng);
});
