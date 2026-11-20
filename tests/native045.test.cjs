// SPDX-License-Identifier: MIT
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createDemo}=require('../scripts/demo.cjs'),S=require('../lib/state.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=';
const AUDIO='data:audio/webm;base64,AQID';
function ok(response){assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
function rejected(response){assert.ok(response.status>=400&&response.status<500,JSON.stringify(response));assert.ok(response.body.error);}
async function fixture(t){
  let demo=await createDemo({appPort:0,providerPort:0});
  t.after(()=>demo.close());
  const request=(route,body)=>demo.request(route,body);
  ok(await request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0,maxWaitSeconds:1}}));
  ok(await request('/api/engine/modules',{id:'segments',values:{enabled:false}}));
  return {request,action:(type,payload)=>request('/api/action',{type,payload}),state:async()=>ok(await request('/api/state')),backup:async()=>ok(await request('/api/backup')),get providerRequests(){return demo.provider.requests.length;},get controlUrl(){return demo.controlUrl;},async restart(){const options={appPort:Number(new URL(demo.appUrl).port),providerPort:Number(new URL(demo.controlUrl).port),resumeDir:demo.dataDir};await demo.close();demo=await createDemo(options);}};
}
async function seed(f){
  const backup=await f.backup(),s=backup.state,[source,target]=s.roles,now=Date.now();
  const make=(content,extra={})=>({id:randomUUID(),roleId:source.id,sender:'assistant',type:'text',content,createdAt:now,status:'sent',...extra});
  const base=make('来源角色的被引用消息'),text=make('带图片和朗读音频的原文',{sender:'user',meta:{image:PNG,audio:AUDIO,durationMs:1000,transcript:'原文的媒体说明',quote:{messageId:base.id,sender:'assistant',type:'text',content:base.content}}}),image=make(PNG,{type:'image'}),other=make('另一个会话的消息',{roleId:target.id});
  const system=make('系统提示',{sender:'system'}),voice=make('语音文字',{sender:'user',type:'voice',meta:{audio:AUDIO,durationMs:1000}}),error=make('失败消息',{sender:'user',status:'error',error:'测试失败'}),demo=make('示例消息',{status:'demo'});
  s.messages=[base,text,image,other,system,voice,error,demo];
  ok(await f.request('/api/restore',{backup,confirm:true}));
  for(const type of ['transfer','redpacket']){
    const before=new Set((await f.state()).messages.map(m=>m.id));
    ok(await f.action('wallet.transfer',{roleId:source.id,amountCents:100,type,requestId:randomUUID(),note:'隔离测试虚拟资金'}));
    const deadline=Date.now()+5000;let replied=false;
    while(Date.now()<deadline){
      const current=await f.state();
      if(current.messages.some(m=>m.roleId===source.id&&m.sender==='assistant'&&!before.has(m.id))){replied=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(replied,true,'financial event finishes its automatic reply before the forwarding/deletion scenario starts');
  }
  return {source:source.id,target:target.id,base,text,image,other,system,voice,error,demo};
}

test('native045 batch deletion detaches retained favorite and quote snapshots without deleting them',async t=>{
  const f=await fixture(t),x=await seed(f);
  ok(await f.action('message.favorite',{id:x.base.id}));ok(await f.action('message.favorite',{id:x.image.id}));const before=await f.state();
  const saved=ok(await f.action('message.deleteMany',{roleId:x.source,ids:[x.base.id,x.image.id]})).state;
  assert.equal(saved.messages.some(m=>[x.base.id,x.image.id].includes(m.id)),false);assert.deepEqual(saved.messages.find(m=>m.id===x.other.id),before.messages.find(m=>m.id===x.other.id));
  assert.equal(saved.favorites.length,2);for(const item of saved.favorites)assert.equal(item.messageId,undefined);assert.equal(saved.favorites[0].content,x.base.content);assert.equal(saved.favorites[1].content,PNG);
  const quote=saved.messages.find(m=>m.id===x.text.id).meta.quote;assert.equal(quote.messageId,undefined);assert.equal(quote.unavailable,'deleted');assert.equal(quote.content,x.base.content);assert.deepEqual(saved.wallet,before.wallet);
  rejected(await f.action('message.deleteMany',{roleId:x.source,ids:[x.base.id]}));assert.deepEqual(await f.state(),saved);
});

test('native045 batch deletion rejects invalid selections and mixed conversations atomically',async t=>{
  const f=await fixture(t),x=await seed(f),before=await f.state();
  for(const ids of [undefined,null,[],{},[x.base.id,x.base.id],['missing'],[x.base.id,'missing'],[x.base.id,x.other.id],[null],[1],[''],Array.from({length:101},(_,i)=>String(i))]){
    rejected(await f.action('message.deleteMany',{roleId:x.source,ids}));assert.deepEqual(await f.state(),before);
  }
  rejected(await f.action('message.deleteMany',{roleId:x.target,ids:[x.base.id]}));assert.deepEqual(await f.state(),before);
  const local=sampleState(),r=local.roles[0],sent=S.message(local,r,'user','sent'),pending=S.message(local,r,'user','pending','text',{status:'pending'}),snapshot=structuredClone(local);
  assert.throws(()=>S.apply(local,'message.deleteMany',{roleId:r.id,ids:[sent.id,pending.id]}),{code:'CHAT_BUSY'});assert.deepEqual(local,snapshot);
});

test('native045 forward preserves media and source quote authors in source order without money or model calls',async t=>{
  const f=await fixture(t),x=await seed(f);ok(await f.action('message.favorite',{id:x.text.id}));ok(await f.action('conversation.hide',{roleId:x.target,hidden:true}));
  const before=await f.state(),calls=f.providerRequests,sourceName=before.roles.find(r=>r.id===x.source).name;
  const result=ok(await f.action('message.forward',{ids:[x.image.id,x.text.id],targetRoleId:x.target})).state,forwarded=result.messages.slice(-2);
  assert.deepEqual(forwarded.map(m=>m.content),[x.text.content,x.image.content]);for(const item of forwarded){assert.equal(item.sender,'user');assert.equal(item.roleId,x.target);assert.equal(item.status,'sent');assert.equal(before.messages.some(m=>m.id===item.id),false);}
  assert.deepEqual(result.messages.slice(0,before.messages.length),before.messages);assert.deepEqual(result.favorites,before.favorites);assert.deepEqual(result.wallet,before.wallet);assert.equal(f.providerRequests,calls);assert.equal(result.roles.find(r=>r.id===x.target).hidden,false);
  assert.equal(forwarded[0].meta.image,PNG);assert.equal(forwarded[0].meta.audio,AUDIO);assert.equal(forwarded[0].meta.durationMs,1000);assert.equal(forwarded[0].meta.transcript,'原文的媒体说明');
  assert.deepEqual(forwarded[0].meta.quote,{sender:'assistant',type:'text',content:x.base.content,senderName:sourceName});assert.equal(forwarded[0].meta.amountCents,undefined);assert.equal(forwarded[0].meta.transactionId,undefined);
  ok(await f.action('role.save',{id:x.source,name:'来源角色已改名'}));
  const again=ok(await f.action('message.forward',{ids:[forwarded[0].id],targetRoleId:x.source})).state.messages.at(-1);assert.equal(again.meta.quote.senderName,sourceName);assert.equal(again.meta.quote.messageId,undefined);
  const backup=await f.backup();ok(await f.request('/api/restore',{backup,confirm:true}));assert.equal((await f.state()).messages.at(-1).meta.quote.senderName,sourceName);
  await f.restart();assert.equal((await f.state()).messages.at(-1).meta.quote.senderName,sourceName);
});

test('native045 forward rejects unsupported messages, cross-source, missing and duplicate IDs atomically',async t=>{
  const f=await fixture(t),x=await seed(f),before=await f.state(),financial=before.messages.filter(m=>['transfer','redpacket'].includes(m.type));
  const invalid=[[],null,[x.base.id,x.base.id],[x.base.id,'missing'],[x.base.id,x.other.id],...[x.system,x.error,x.demo,...financial].map(m=>[x.base.id,m.id]),Array.from({length:101},(_,i)=>String(i))];
  for(const ids of invalid){rejected(await f.action('message.forward',{ids,targetRoleId:x.target}));assert.deepEqual(await f.state(),before);}
  rejected(await f.action('message.forward',{ids:[x.base.id],targetRoleId:'missing'}));assert.deepEqual(await f.state(),before);
  const local=sampleState(),r=local.roles[0],pending=S.message(local,r,'user','pending','text',{status:'pending'}),snapshot=structuredClone(local);
  assert.throws(()=>S.apply(local,'message.forward',{ids:[pending.id],targetRoleId:local.roles[1].id}));assert.deepEqual(local,snapshot);
});

test('native046 individual voice forwarding copies playable media without a model request or money transfer',async t=>{
  const f=await fixture(t),x=await seed(f),before=await f.state(),calls=f.providerRequests;
  const result=ok(await f.action('message.forward',{ids:[x.voice.id],targetRoleId:x.target})).state,forwarded=result.messages.at(-1);
  assert.equal(forwarded.type,'voice');assert.equal(forwarded.roleId,x.target);assert.notEqual(forwarded.id,x.voice.id);
  assert.deepEqual(forwarded.meta,x.voice.meta);assert.deepEqual(result.wallet,before.wallet);assert.equal(f.providerRequests,calls);
  const backup=await f.backup();ok(await f.request('/api/restore',{backup,confirm:true}));assert.deepEqual((await f.state()).messages.at(-1),forwarded);
});

test('native045 favorite batch deletion is atomic and retains original chat records',async t=>{
  const f=await fixture(t),x=await seed(f);for(const message of [x.base,x.text,x.image])ok(await f.action('message.favorite',{id:message.id}));
  const before=await f.state(),ids=before.favorites.map(item=>item.id);
  for(const selection of [[],[ids[0],ids[0]],[ids[0],'missing'],null,Array.from({length:101},(_,i)=>String(i))]){rejected(await f.action('favorite.deleteMany',{ids:selection}));assert.deepEqual(await f.state(),before);}
  const saved=ok(await f.action('favorite.deleteMany',{ids:[ids[2],ids[0]]})).state;assert.deepEqual(saved.favorites,[before.favorites[1]]);assert.deepEqual(saved.messages,before.messages);
  rejected(await f.action('favorite.deleteMany',{ids:[ids[2]]}));assert.deepEqual(await f.state(),saved);
  await f.restart();assert.deepEqual((await f.state()).favorites,saved.favorites);
});

test('native045 chat backgrounds retain partial edits, clear explicitly and survive restore/restart',async t=>{
  const f=await fixture(t),id=(await f.state()).roles[0].id;assert.equal((await f.state()).roles[0].chatBackground,'');
  ok(await f.action('role.save',{id,chatBackground:PNG}));ok(await f.action('role.save',{id,remark:'背景仍保留'}));assert.equal((await f.state()).roles[0].chatBackground,PNG);
  const before=await f.state();for(const chatBackground of [null,{},123,'https://example.invalid/picture.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,AQID']){rejected(await f.action('role.save',{id,chatBackground}));assert.deepEqual(await f.state(),before);}
  const backup=await f.backup();ok(await f.action('role.save',{id,chatBackground:''}));assert.equal((await f.state()).roles[0].chatBackground,'');
  ok(await f.request('/api/restore',{backup,confirm:true}));await f.restart();assert.equal((await f.state()).roles[0].chatBackground,PNG);
  const bad=structuredClone(backup);bad.state.roles[0].chatBackground='https://example.invalid/';const current=await f.state();rejected(await f.request('/api/restore',{backup:bad,confirm:true}));assert.deepEqual(await f.state(),current);
  const legacy=structuredClone(backup);for(const role of legacy.state.roles)delete role.chatBackground;ok(await f.request('/api/restore',{backup:legacy,confirm:true}));assert.equal((await f.state()).roles[0].chatBackground,'');
  const local=sampleState();assert.equal(S.publicState(local).roles[0].chatBackground,'');assert.equal(local.roles[0].chatBackground,undefined);
});

test('native045 accepts exactly 100 selected records and rejects the next count',async t=>{
  const f=await fixture(t),backup=await f.backup(),[source,target]=backup.state.roles;
  backup.state.messages=Array.from({length:100},(_,i)=>({id:randomUUID(),roleId:source.id,sender:'user',type:'text',content:'第'+i+'条',createdAt:Date.now(),status:'sent'}));
  ok(await f.request('/api/restore',{backup,confirm:true}));const ids=backup.state.messages.map(m=>m.id);
  const forwarded=ok(await f.action('message.forward',{ids,targetRoleId:target.id})).state;assert.equal(forwarded.messages.length,200);assert.deepEqual(forwarded.messages.slice(100).map(m=>m.content),backup.state.messages.map(m=>m.content));
  const deleted=ok(await f.action('message.deleteMany',{roleId:source.id,ids})).state;assert.equal(deleted.messages.length,100);assert.ok(deleted.messages.every(m=>m.roleId===target.id));
});

test('native045 batch delete honors the active conversation generation lock through HTTP',async t=>{
  const f=await fixture(t),x=await seed(f);
  ok(await f.request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0,maxWaitSeconds:1}}));
  ok(await f.request('/api/engine/modules',{id:'segments',values:{intervalMode:'random',minSeconds:0,maxSeconds:0}}));
  const response=await fetch(f.controlUrl+'/demo/mode',{method:'POST',headers:{Origin:f.controlUrl,'Content-Type':'application/json'},body:JSON.stringify({mode:'delay'})});assert.equal(response.status,200);
  const calls=f.providerRequests,pending=f.request('/api/chat/send',{roleId:x.source,text:'延迟中的真实请求',requestId:randomUUID()});
  try{
    for(let i=0;i<100&&f.providerRequests===calls;i++)await new Promise(resolve=>setTimeout(resolve,10));
    const before=await f.state(),result=await f.action('message.deleteMany',{roleId:x.source,ids:[x.base.id]});assert.equal(result.status,409);assert.equal(result.body.code,'CHAT_BUSY');assert.deepEqual(await f.state(),before);
  }finally{assert.equal(ok(await pending).accepted,true);}
  const deadline=Date.now()+5000;let deleted=false;
  while(Date.now()<deadline){
    const result=await f.action('message.deleteMany',{roleId:x.source,ids:[x.base.id]});
    if(result.status===200){deleted=true;break;}
    assert.equal(result.status,409);assert.equal(result.body.code,'CHAT_BUSY');await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(deleted,true,'batch deletion resumes after asynchronous reply delivery');assert.equal((await f.state()).messages.some(m=>m.id===x.base.id),false);
});
