// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const restoreWhenIdle=require('./fixtures/restore-when-idle.cjs');
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const S=require('../lib/state.cjs'),A=require('../lib/engine/actions.cjs'),R=require('../lib/engine/registry.cjs'),Pipeline=require('../lib/engine/pipeline.cjs'),{createApp}=require('../scripts/sample-data.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const GIF='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function state(){const s=sampleState();s.messages=[];return s;}
function payment(s,args,sender='user'){return A.transfer(s,s.roles[0].id,{amountCents:1234,type:'redpacket',note:'今天开心',...args},sender,R.values(s,'actions'));}
test('redpacket attachment is snapshotted onto its transaction and message and included in the request fingerprint',()=>{
  const s=state(),args={stickerImage:PNG,requestId:'attachment-once'},before=s.wallet.balanceCents;
  const tx=payment(s,args);assert.equal(tx.stickerImage,PNG);assert.equal(s.messages[0].meta.stickerImage,PNG);
  assert.equal(payment(s,args).id,tx.id);assert.equal(s.wallet.balanceCents,before-1234);assert.equal(s.messages.length,1);
  for(const stickerImage of [GIF,'',undefined])assert.throws(()=>payment(s,{...args,stickerImage}),/requestId 已用于其他转账/);
  assert.equal(s.wallet.transactions.length,1);assert.equal(s.wallet.balanceCents,before-1234);
});
test('empty and old packets omit the attachment and transfer never accepts the redpacket-only field',()=>{
  const s=state();const plain=payment(s,{}),empty=payment(s,{stickerImage:''});
  assert.equal(Object.hasOwn(plain,'stickerImage'),false);assert.equal(Object.hasOwn(empty,'stickerImage'),false);
  assert.equal(s.messages.some(m=>Object.hasOwn(m.meta,'stickerImage')),false);
  for(const stickerImage of [PNG,'',null])assert.throws(()=>payment(s,{type:'transfer',stickerImage}),/只有红包支持添加表情/);
  for(const stickerImage of [null,123,'https://example.invalid/sticker.png','data:image/png;base64,PHNjcmlwdD4='])assert.throws(()=>payment(s,{stickerImage}));
  assert.equal(s.wallet.transactions.length,2);
});
test('settlement retains the attachment while model history and payment tool results exclude image bytes',async()=>{
  const s=state(),roleId=s.roles[0].id,before=s.wallet.balanceCents,tx=payment(s,{stickerImage:PNG});
  const context={roleId,settings:R.values(s,'actions'),getState:()=>structuredClone(s),mutate:fn=>({value:fn(s),state:structuredClone(s)})};
  for(const canSeeImage of [false,true]){
    const rendered=JSON.stringify(Pipeline.render(s,s.messages[0],canSeeImage));
    assert.match(rendered,/附有红包表情/);assert.doesNotMatch(rendered,/base64|image_url/);assert.equal(rendered.includes(PNG),false);
  }
  const received=await A.execute('handle_payment',{id:tx.id,action:'receive'},context);
  assert.equal(tx.status,'received');assert.equal(tx.stickerImage,PNG);assert.equal(received.stickerImage,undefined);assert.equal(JSON.stringify(received).includes(PNG),false);
  const sent=await A.execute('send_redpacket',{amountCents:100,note:'回礼',stickerImage:GIF},context);
  assert.equal(sent.stickerImage,undefined);assert.equal(s.wallet.transactions.at(-1).stickerImage,GIF);
  assert.equal(s.wallet.balanceCents,before-1234);A.settle(s,s.wallet.transactions.at(-1).id,'return','user',roleId);
  assert.equal(s.wallet.transactions.at(-1).stickerImage,GIF);assert.equal(s.wallet.transactions.at(-1).status,'returned');
});
test('a packet attachment stays visible in its card and is absent from plain packets and transfers',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),start=source.indexOf('  function renderChat('),end=source.indexOf('\n  function ',start+1);
  const scope=vm.createContext({PNG,slowReplyRole:null,window:{PipiEngine:{isTyping:()=>false}}});
  vm.runInContext(`const state={profile:{},roles:[{id:'alice',name:'小甲'}],messages:[{id:'m',roleId:'alice',type:'redpacket',sender:'user',createdAt:0,content:'红包',meta:{amountCents:1234,transactionId:'tx',stickerImage:PNG}}],wallet:{transactions:[{id:'tx',status:'pending',stickerImage:PNG}]}};const route={arg:'alice'},chatHistoryPageSize=120,chatHistoryWindows=new Map(),chatScrolls=new Map();let focusMessageId='',forceBottomRole='',chatSelection=null,outgoing=null;const esc=value=>String(value??''),richText=esc,safeImage=value=>typeof value==='string'&&value.startsWith('data:image/'),header=title=>title,roleName=r=>r.name,roleById=id=>state.roles.find(r=>r.id===id),shortTime=()=>'',avatar=()=>'',icons={},transferCardMark='',redpacketCardMark='',iconButton=()=>'',renderComposer=()=>'';
    ${source.slice(start,end)}globalThis.ui={renderChat,plain(){delete state.messages[0].meta.stickerImage;delete state.wallet.transactions[0].stickerImage;},transfer(){state.messages[0].type='transfer';state.messages[0].meta.stickerImage=PNG;}};`,scope);
  assert.match(scope.ui.renderChat(),/class="redpacket-card-sticker"[^>]+alt="红包表情"/);
  scope.ui.plain();assert.doesNotMatch(scope.ui.renderChat(),/redpacket-card-sticker/);
  scope.ui.transfer();assert.doesNotMatch(scope.ui.renderChat(),/redpacket-card-sticker/);
});
test('isolated HTTP packet keeps its image after favorite deletion, restart, backup and restore and rejects malformed inputs atomically',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-redpacket-sticker-')),password='Isolated-redpacket-2026!';let app,base,cookie='',csrf='';
  async function start(){app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();base='http://127.0.0.1:'+app.server.address().port;}
  async function request(route,body){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})}),value=await response.json();
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,value};
  }
  const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.value));return response.value;},read=async()=>ok(await request('/api/state'));
  const action=async(type,payload)=>request('/api/action',{type,payload});
  t.after(async()=>{await app.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('pipi-redpacket-sticker-'));fs.rmSync(dir,{recursive:true,force:true});});
  await start();ok(await request('/api/setup',{password}));const initial=await read(),roleId=initial.roles[0].id;
  ok(await action('sticker.add',{image:PNG}));const payload={roleId,amountCents:1234,type:'redpacket',note:'随红包保存',requestId:randomUUID(),stickerImage:PNG};
  let saved=ok(await action('wallet.transfer',payload)).state;const txId=saved.wallet.transactions.at(-1).id,messageId=saved.messages.find(m=>m.meta?.transactionId===txId).id;
  const mediaUrl=saved.wallet.transactions.at(-1).stickerImage;assert.match(mediaUrl,/^\/api\/media\/[a-f0-9]{64}\.png$/);const imageResponse=await fetch(base+mediaUrl,{headers:{Cookie:cookie}});assert.equal(imageResponse.status,200);assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()),Buffer.from(PNG.split(',')[1],'base64'));assert.equal((await fetch(base+mediaUrl)).status,401);
  assert.equal(saved.wallet.balanceCents,initial.wallet.balanceCents-1234);assert.equal(saved.wallet.transactions.at(-1).stickerImage,mediaUrl);assert.equal(saved.messages.find(m=>m.id===messageId).meta.stickerImage,mediaUrl);
  const repeated=ok(await action('wallet.transfer',payload)).state;assert.equal(repeated.wallet.balanceCents,saved.wallet.balanceCents);assert.equal(repeated.wallet.transactions.length,saved.wallet.transactions.length);
  for(const stickerImage of [GIF,undefined])assert.equal((await action('wallet.transfer',{...payload,stickerImage})).status,409);
  ok(await action('sticker.delete',{id:saved.stickers[0].id}));saved=await read();assert.equal(saved.stickers.length,0);assert.equal(saved.wallet.transactions.at(-1).stickerImage,mediaUrl);
  for(const bad of [{stickerImage:null},{stickerImage:123},{stickerImage:'https://example.invalid/private.png'},{stickerImage:'data:image/png;base64,PHNjcmlwdD4='},{type:'transfer',stickerImage:PNG},{type:'transfer',stickerImage:''},{amountCents:20001}]){
    assert.equal((await action('wallet.transfer',{...payload,requestId:randomUUID(),...bad})).status,400);assert.deepEqual(await read(),saved);
  }
  await app.close();await start();ok(await request('/api/login',{password}));saved=await read();
  assert.equal(saved.wallet.transactions.find(tx=>tx.id===txId).stickerImage,mediaUrl);assert.equal(saved.messages.find(m=>m.id===messageId).meta.stickerImage,mediaUrl);
  const backup=ok(await request('/api/backup'));
  for(const change of [b=>delete b.state.wallet.transactions.find(tx=>tx.id===txId).stickerImage,b=>delete b.state.messages.find(m=>m.id===messageId).meta.stickerImage,b=>b.state.wallet.transactions.find(tx=>tx.id===txId).stickerImage=GIF,b=>b.state.messages.find(m=>m.id===messageId).meta.stickerImage='https://example.invalid/image',b=>b.state.wallet.transactions.find(tx=>tx.id===txId).type='transfer']){
    const invalid=structuredClone(backup);change(invalid);assert.equal((await restoreWhenIdle(()=>request('/api/restore',{confirm:true,backup:invalid}))).status,400);assert.deepEqual(await read(),saved);
  }
  ok(await action('conversation.clear',{roleId}));assert.equal((await read()).messages.some(m=>m.id===messageId),false);
  ok(await restoreWhenIdle(()=>request('/api/restore',{confirm:true,backup:backup})));saved=await read();assert.equal(saved.wallet.transactions.find(tx=>tx.id===txId).stickerImage,mediaUrl);assert.equal(saved.messages.find(m=>m.id===messageId).meta.stickerImage,mediaUrl);
  const legacy=structuredClone(backup);delete legacy.state.wallet.transactions.find(tx=>tx.id===txId).stickerImage;delete legacy.state.messages.find(m=>m.id===messageId).meta.stickerImage;
  ok(await restoreWhenIdle(()=>request('/api/restore',{confirm:true,backup:legacy})));assert.equal(Object.hasOwn((await read()).wallet.transactions.find(tx=>tx.id===txId),'stickerImage'),false);
});
