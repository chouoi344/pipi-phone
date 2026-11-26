// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const S=require('../lib/state.cjs'),Media=require('../lib/media-store.cjs'),ModelImages=require('../lib/engine/model-images.cjs'),{createApp}=require('../server.cjs');
function png(color){
  const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(zlib.crc32(Buffer.concat([name,data])),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,color,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-image-variants-')),app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[]});
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,body,{anonymous=false,headers={}}={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(anonymous?{}:{Cookie:cookie}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return {status:response.status,value};
  }
  async function json(route,body){const r=await request(route,body);assert.equal(r.status,200,JSON.stringify(r.value));return r.value;}
  await json('/api/setup',{password:'Image-Variants-Isolated!'});
  const role=(await json('/api/action',{type:'role.save',payload:{name:'甲'}})).state.roles[0];
  const images=[1,2,3,4].map(value=>Media.saveImage(dataDir,png(value)));
  return {dataDir,app,request,json,roleId:role.id,images,read:()=>JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json),write:state=>app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state)),async send(fields={}){return json('/api/chat/send',{roleId:role.id,requestId:crypto.randomUUID(),...fields});}};
}

test('chat variants are stored on pure image and image/text messages; original content and requestId replay remain intact',async t=>{
  const f=await fixture(t),[image,thumb,modelImage,other]=f.images;
  assert.equal((await f.json('/api/status')).imageVariants,true);
  const body={roleId:f.roleId,image,thumb,modelImage,requestId:crypto.randomUUID()};
  const first=await f.json('/api/chat/send',body),message=first.state.messages.find(m=>m.id===first.messageId);
  const generated=ModelImages.cached(f.dataDir,image).url;assert.notEqual(generated,modelImage);assert.equal(message.type,'image');assert.equal(message.content,image);assert.deepEqual({thumb:message.meta.thumb,modelImage:message.meta.modelImage},{thumb,modelImage:generated});assert.deepEqual(Media.resolveImageBytes(f.dataDir,image).buffer,png(1));
  await f.json('/api/chat',body);assert.equal(f.read().messages.filter(m=>m.content===image).length,1);
  assert.equal((await f.request('/api/chat',{...body,modelImage:other})).status,409);
  const text=await f.send({text:'这张图',image,thumb,modelImage});const withText=text.state.messages.find(m=>m.id===text.messageId);
  assert.equal(withText.type,'text');assert.equal(withText.content,'这张图');assert.deepEqual({image:withText.meta.image,thumb:withText.meta.thumb,modelImage:withText.meta.modelImage},{image,thumb,modelImage:generated});
});

test('legacy inline variants are externalized, while pure text, voice and non-chat image inputs cannot attach variants',async t=>{
  const f=await fixture(t),[image,thumb]=f.images,inline=value=>'data:image/png;base64,'+png(value).toString('base64');
  const result=await f.send({image:inline(1),thumb:inline(2),modelImage:inline(3)}),m=result.state.messages.find(row=>row.id===result.messageId);
  assert.equal(m.content,image);assert.equal(m.meta.thumb,thumb);assert.equal(JSON.stringify(f.read()).includes('data:image/'),false);
  for(const fields of [{text:'无图',thumb},{text:'无图',modelImage:thumb},{image,thumb:'/api/media/'+'f'.repeat(64)+'.wav'}])assert.equal((await f.request('/api/chat/send',{roleId:f.roleId,requestId:crypto.randomUUID(),...fields})).status,400);
  for(const [type,payload] of [['role.save',{id:f.roleId,avatar:image,thumb}],['moment.create',{content:'朋友圈',image,modelImage:thumb}],['favorite.save',{content:'笔记',images:[image],thumb}]])assert.equal((await f.request('/api/action',{type,payload})).status,400);
});

test('thumbnail backfill checks auth and original identity, patches the latest state and never overwrites an existing thumbnail',async t=>{
  const f=await fixture(t),[image,thumb,other]=f.images,created=await f.send({image}),messageId=created.messageId;
  const body={messageId,thumb,originalImage:image};
  assert.equal((await f.request('/api/chat/media/thumbnail',body,{anonymous:true})).status,401);
  assert.equal((await f.request('/api/chat/media/thumbnail',body,{headers:{'X-CSRF-Token':''}})).status,403);
  assert.equal((await f.request('/api/chat/media/thumbnail',{...body,originalImage:other})).status,409);
  await f.json('/api/action',{type:'profile.save',payload:{name:'更新后的资料'}});
  const result=await f.json('/api/chat/media/thumbnail',body);
  assert.equal(result.state.profile.name,'更新后的资料');assert.equal(result.state.messages.find(m=>m.id===messageId).meta.thumb,thumb);
  const revision=result.state.revision,replayed=await f.json('/api/chat/media/thumbnail',{messageId,thumb:other});
  assert.equal(replayed.state.messages.find(m=>m.id===messageId).meta.thumb,thumb);assert.equal(replayed.state.revision,revision);
});

test('thumbnail backfill rejects deleted, recalled, non-image or physically missing originals',async t=>{
  const f=await fixture(t),[image,thumb]=f.images;
  const text=await f.send({text:'文字'});assert.equal((await f.request('/api/chat/media/thumbnail',{messageId:text.messageId,thumb})).status,409);
  const s=f.read(),r=S.role(s,f.roleId),recalled=S.message(s,r,'user',image,'image'),missing=S.message(s,r,'user',image,'image');
  S.apply(s,'message.recall',{id:recalled.id});f.write(s);
  assert.equal((await f.request('/api/chat/media/thumbnail',{messageId:recalled.id,thumb})).status,409);
  assert.equal((await f.request('/api/chat/media/thumbnail',{messageId:'deleted',thumb})).status,404);
  fs.unlinkSync(path.join(f.dataDir,'media',image.split('/').at(-1)));
  assert.equal((await f.request('/api/chat/media/thumbnail',{messageId:missing.id,thumb})).status,409);
});

test('legacy inline originals can receive a thumbnail without migration or original-quality changes',async t=>{
  const f=await fixture(t),s=f.read(),original='data:image/png;base64,'+png(1).toString('base64');
  const m=S.message(s,S.role(s,f.roleId),'assistant',original,'image');f.write(s);
  const result=await f.json('/api/chat/media/thumbnail',{messageId:m.id,thumb:f.images[1],originalImage:original});
  const current=result.state.messages.find(row=>row.id===m.id);assert.equal(current.content,original);assert.equal(current.meta.thumb,f.images[1]);
});

test('derived files survive quotes, forwards, favorites and backup/restore with reference collection',async t=>{
  const f=await fixture(t),target=await fixture(t),[image,thumb,untrustedModelImage]=f.images;
  const created=await f.send({image,thumb,modelImage:untrustedModelImage}),s=f.read(),m=s.messages.find(row=>row.id===created.messageId),modelImage=m.meta.modelImage;assert.equal(modelImage,ModelImages.cached(f.dataDir,image).url);assert.notEqual(modelImage,untrustedModelImage);m.status='sent';f.write(s);
  const quoted=await f.send({text:'引用',quoteId:m.id});const q=quoted.state.messages.find(row=>row.id===quoted.messageId).meta.quote;assert.equal(q.thumb,thumb);assert.equal(q.modelImage,modelImage);
  await f.json('/api/action',{type:'message.favorite',payload:{id:m.id}});
  const second=(await f.json('/api/action',{type:'role.save',payload:{name:'乙'}})).state.roles[1].id;
  for(const mode of ['individual','merged'])await f.json('/api/action',{type:'message.forward',payload:{roleId:f.roleId,targetRoleId:second,ids:[m.id],mode}});
  const backup=await f.json('/api/backup');
  for(const url of [image,thumb,modelImage])assert.ok(backup.media[url.split('/').at(-1)]);
  const restored=(await target.json('/api/restore',{backup,confirm:true})).state;
  const favorite=restored.favorites.find(row=>row.messageId===m.id);assert.equal(favorite.meta.thumb,thumb);assert.equal(favorite.meta.modelImage,modelImage);
  const forwarded=restored.messages.filter(row=>row.roleId===second);
  assert.equal(forwarded.find(row=>row.type==='image').meta.modelImage,modelImage);assert.equal(forwarded.find(row=>row.type==='forward').meta.entries[0].meta.thumb,thumb);
  assert.equal(restored.messages.find(row=>row.id===quoted.messageId).meta.quote.modelImage,modelImage);
  assert.deepEqual(Media.readImageFile(target.dataDir,thumb.split('/').at(-1)).buffer,png(2));
  const malformed=structuredClone(backup);const plain=malformed.state.messages.find(row=>row.id===quoted.messageId);plain.meta.modelImage=modelImage;
  assert.equal((await target.request('/api/restore',{backup:malformed,confirm:true})).status,400);
});
