// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../lib/state.cjs'),{createApp}=require('../scripts/sample-data.cjs');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=','base64');
const image=n=>'data:image/png;base64,'+Buffer.concat([PNG,Buffer.from(String(n))]).toString('base64');
test('library selection preserves old records, names, independent copies and backup/forward metadata',()=>{
 const s=sampleState(),r=s.roles[0],old={id:'old-sticker',image:image(0),createdAt:1};s.stickers=[old];
 S.apply(s,'sticker.add',{images:[image(1),image(2),image(1)],names:['开心.png','晚安.gif','重复']});
 S.apply(s,'role.stickers.add',{roleId:r.id,stickerIds:s.stickers.map(x=>x.id)});
 S.apply(s,'role.stickers.add',{roleId:r.id,stickerIds:[old.id,old.id]});
 assert.equal(r.stickers.length,3);assert.equal(r.stickers[0].name,'表情 1');assert.equal(r.stickers[1].name,'开心.png');assert.deepEqual(s.stickers[0],old);
 r.stickers.shift();assert.equal(s.stickers.length,3);
 const hash=require('node:crypto').createHash('sha256').update(Buffer.from(image(1).split(',')[1],'base64')).digest('hex');
 S.addRoleStickers(s,r,[{image:'/api/media/'+hash+'.png',name:'同一图片'}]);assert.equal(r.stickers.length,2);
 const prior=structuredClone(r.stickers);assert.throws(()=>S.addRoleStickers(s,r,[{name:'超量',image:'x'.repeat(16*1024*1024)}]),/16 MB/);assert.deepEqual(r.stickers,prior);
 const semantic={meaning:'晚安道别',tags:['温柔'],usage:'睡前',description:'猫咪盖被子',visibleText:'晚安'};
 const m=S.message(s,r,'user',image(1),'image',{meta:{stickerId:s.stickers[1].id,stickerSemantic:semantic}});const q=S.quote(s,r.id,m.id);assert.equal(q.stickerId,m.meta.stickerId);assert.deepEqual(q.stickerSemantic,semantic);
 const reply=S.message(s,r,'user','收到','text',{meta:{quote:q}});
 S.apply(s,'message.forward',{targetRoleId:s.roles[1].id,ids:[m.id,reply.id],mode:'merged'});
 assert.equal(s.messages.at(-1).meta.entries[0].meta.stickerId,m.meta.stickerId);
 assert.deepEqual(s.messages.at(-1).meta.entries[0].meta.stickerSemantic,semantic);
 S.apply(s,'message.forward',{targetRoleId:s.roles[1].id,ids:[m.id,reply.id],mode:'individual'});
 assert.equal(s.messages.at(-2).meta.stickerId,m.meta.stickerId);assert.equal(s.messages.at(-1).meta.quote.stickerId,m.meta.stickerId);
 assert.deepEqual(s.messages.at(-2).meta.stickerSemantic,semantic);assert.deepEqual(s.messages.at(-1).meta.quote.stickerSemantic,semantic);
 const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(s)},s);assert.deepEqual(restored.stickers,s.stickers);assert.equal(restored.messages.find(x=>x.id===m.id).meta.stickerId,m.meta.stickerId);
 assert.deepEqual(restored.messages.find(x=>x.id===m.id).meta.stickerSemantic,semantic);
});


test('role manual selection and saving share the 200-sticker capacity',()=>{
 const s=sampleState(),r=s.roles[0];
 const all=Array.from({length:201},(_,i)=>({id:'capacity-'+i,name:'表情 '+i,image:image(i),createdAt:1}));
 const selected=all.slice(0,200);s.stickers=selected;
 S.apply(s,'role.stickers.add',{roleId:r.id,stickerIds:selected.map(x=>x.id)});assert.equal(r.stickers.length,200);
 assert.throws(()=>S.apply(s,'role.stickers.add',{roleId:r.id,stickerIds:all.map(x=>x.id)}),/200/);
 assert.throws(()=>S.addRoleStickers(s,r,[all[200]]),/200/);assert.equal(r.stickers.length,200);
 assert.doesNotThrow(()=>S.apply(s,'role.save',{...r,stickers:selected}));
 assert.throws(()=>S.apply(s,'role.save',{...r,stickers:all}),/200/);
});

test('sticker budgets count decoded image bytes and retain the 16 MB limit',()=>{
 const size=4*1024*1024;
 const large=(n,extra=0)=>{const bytes=Buffer.alloc(size+extra,n);PNG.copy(bytes);return 'data:image/png;base64,'+bytes.toString('base64');};
 const stickers=Array.from({length:4},(_,i)=>({id:'large-'+i,name:'大图 '+i,image:large(i),createdAt:1}));
 const s=sampleState(),r=s.roles[0];s.stickers=stickers;
 assert.ok(stickers.reduce((total,x)=>total+Buffer.byteLength(x.image),0)>16*1024*1024);
 assert.doesNotThrow(()=>S.limit(s));
 assert.doesNotThrow(()=>S.apply(s,'role.save',{...r,stickers}));
 r.stickers=[];assert.doesNotThrow(()=>S.addRoleStickers(s,r,stickers));assert.equal(r.stickers.length,4);
 const overflow=[...stickers.slice(0,3),{...stickers[3],image:large(4,1)}];
 s.stickers=overflow;assert.throws(()=>S.limit(s),/16 MB/);
 assert.throws(()=>S.apply(s,'role.save',{...r,stickers:overflow}),/16 MB/);
 const previous=structuredClone(r.stickers);assert.throws(()=>S.addRoleStickers(s,r,[{image:image(9),name:'超量'}]),/16 MB/);assert.deepEqual(r.stickers,previous);
});

test('chat distinguishes stickers, validates source and retries without auto-collection',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-sticker-library-')),app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();
 t.after(async()=>{await app.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('pipi-sticker-library-'));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 async function request(route,body){const res=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await res.json();if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:res.status,value};}
 const ok=x=>{assert.equal(x.status,200,JSON.stringify(x.value));return x.value;},action=(type,payload)=>request('/api/action',{type,payload});
 ok(await request('/api/setup',{password:'Sticker-library-test-2026!'}));let state=ok(await request('/api/state'));const roleId=state.roles[0].id;
 state=ok(await action('sticker.add',{images:[image(0),image(1)],names:['微笑.png','晚安.png']})).state;const [a,b]=state.stickers;
 state=ok(await request('/api/stickers/analyze',{ids:[a.id]})).state;assert.equal(state.stickers[0].semantic.status,'pending');assert.match(state.stickers[0].semantic.error,/配置/);
 state=ok(await action('sticker.semantic.save',{id:a.id,meaning:'开心打招呼',tags:['开心'],usage:'见面问好'})).state;assert.equal(state.stickers[0].semantic.manual,true);
 const ordinary={roleId,image:a.image,requestId:'ordinary-image-001'};state=ok(await request('/api/chat',ordinary)).state;assert.equal(state.roles[0].stickers.length,0);
 assert.equal((await request('/api/chat',{roleId,image:b.image,stickerId:a.id,requestId:'wrong-sticker-001'})).status,400);
 const body={roleId,image:a.image,stickerId:a.id,requestId:'selected-sticker-001'};let result=ok(await request('/api/chat',body));assert.equal(result.notice,undefined);assert.equal(result.state.roles[0].stickers.length,0);assert.equal(result.state.messages.find(m=>m.id===result.messageId).meta.stickerId,a.id);
 assert.deepEqual(result.state.messages.find(m=>m.id===result.messageId).meta.stickerSemantic,{meaning:'开心打招呼',tags:['开心'],usage:'见面问好'});
 ok(await action('sticker.delete',{id:a.id}));result=ok(await request('/api/chat',body));assert.equal(result.state.roles[0].stickers.length,0);
 assert.equal((await request('/api/chat',{...body,stickerId:b.id})).status,409);
 const full=Array.from({length:200},(_,i)=>({id:'full-'+i,name:'已有 '+i,image:image(i+10)}));
 ok(await action('role.save',{...result.state.roles[0],stickers:full}));
 result=ok(await request('/api/chat',{roleId,image:b.image,stickerId:b.id,requestId:'full-sticker-001'}));assert.equal(result.notice,undefined);assert.equal(result.state.roles[0].stickers.length,200);assert.ok(result.messageId);
 assert.equal((await request('/api/chat',{roleId,image:b.image,stickerId:b.id,requestId:'full-sticker-001'})).value.notice,undefined);
});
