// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Media=require('../lib/media-store.cjs'),S=require('../lib/state.cjs'),{createApp}=require('../server.cjs');
const png=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/receipt.png'));
function wav(size=204){
  const b=Buffer.alloc(size);b.write('RIFF');b.writeUInt32LE(size-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size-44,40);return b;
}
function sizedPng(size){
  const text=Buffer.alloc(size-png.length-12,120);text.write('padding\0');
  const type=Buffer.from('tEXt'),chunk=Buffer.alloc(text.length+12);chunk.writeUInt32BE(text.length);type.copy(chunk,4);text.copy(chunk,8);chunk.writeUInt32BE(require('node:zlib').crc32(Buffer.concat([type,text])),chunk.length-4);
  return Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
}
async function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-v0130-media-http-')),app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[]});
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,{body,method=body===undefined?'GET':'POST',binary=false,anonymous=false,headers={}}={}){
    return fetch(base+route,{method,...(binary?{duplex:'half'}:{}),headers:{Connection:'close',...(anonymous?{}:{Cookie:cookie}),...(body===undefined?{}:{Origin:base,'X-CSRF-Token':csrf,'Content-Type':binary?'application/octet-stream':'application/json'}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  }
  async function json(route,body){const r=await request(route,{body}),value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
  const login=await request('/api/setup',{body:{password:'Isolated-media-Password!'}});cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrfToken;
  return {app,dataDir,base,request,json,async upload(bytes,mime='application/octet-stream'){const r=await request('/api/media/upload',{body:bytes,binary:true,headers:{'Content-Type':mime}}),value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value.url;}};
}

test('binary upload retains bytes, requires login/CSRF and serves authenticated GET/HEAD/Range with ETag',async t=>{
  const f=await fixture(t);
  assert.equal((await f.json('/api/status')).binaryMedia,true);
  for(const options of [{anonymous:true},{headers:{'X-CSRF-Token':''}},{headers:{Origin:'https://other.invalid'}}]){
    const r=await f.request('/api/media/upload',{body:png,binary:true,...options});assert.ok([401,403].includes(r.status));
  }
  const url=await f.upload(png,'image/png');assert.match(url,/^\/api\/media\/[a-f0-9]{64}\.png$/);
  assert.equal((await f.request(url,{anonymous:true})).status,401);
  const full=await f.request(url);assert.equal(full.headers.get('content-type'),'image/png');assert.equal(full.headers.get('x-content-type-options'),'nosniff');assert.equal(full.headers.get('accept-ranges'),'bytes');assert.deepEqual(Buffer.from(await full.arrayBuffer()),png);
  const etag=full.headers.get('etag'),head=await f.request(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(png.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=2-',2,png.length-1],['bytes=-2',png.length-2,png.length-1]]){
    const r=await f.request(url,{headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/${png.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),png.subarray(start,end+1));
  }
  for(const range of ['bytes=999999999-','bytes=2-1','bytes=-0','bytes=0-1,3-4','invalid']){
    const r=await f.request(url,{headers:{Range:range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */'+png.length);
  }
  assert.equal((await f.request(url,{headers:{'If-None-Match':etag}})).status,304);
  assert.equal((await f.request(url,{headers:{Range:'bytes=0-1','If-Range':'"old"'}})).status,200);
  const filename=path.join(f.dataDir,'media',url.split('/').at(-1));fs.utimesSync(filename,new Date(0),new Date(0));
  assert.equal(await f.upload(png),url);assert.ok(fs.statSync(filename).mtimeMs>Date.now()-10000);
  const bad=await f.request('/api/media/upload',{body:Buffer.from('<svg></svg>'),binary:true,headers:{'Content-Type':'image/svg+xml'}});assert.equal(bad.status,415);
  assert.equal(fs.readdirSync(path.join(f.dataDir,'media')).some(name=>name.endsWith('.tmp')),false);
});

test('20MB original images and 8MB audio retain exact bytes; limits reject oversized and forged content',async t=>{
  const f=await fixture(t),image=sizedPng(20*1024*1024),audio=wav(8*1024*1024);
  for(const [bytes,mime,ext] of [[image,'image/png','png'],[audio,'audio/wav','wav']]){
    const url=await f.upload(bytes,mime),response=await f.request(url);assert.equal(url.endsWith('.'+ext),true);
    const restored=Buffer.from(await response.arrayBuffer());assert.equal(crypto.createHash('sha256').update(restored).digest('hex'),crypto.createHash('sha256').update(bytes).digest('hex'));
    if(ext==='wav'){
      const ranged=await f.request(url,{headers:{Range:'bytes=0-1'}});assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),Buffer.from('RI'));
    }
  }
  for(const [bytes,mime] of [[Buffer.alloc(20*1024*1024+1),'image/png'],[Buffer.alloc(10*1024*1024+1),'image/gif'],[Buffer.alloc(8*1024*1024+1),'audio/wav']]){
    const r=await f.request('/api/media/upload',{body:bytes,binary:true,headers:{'Content-Type':mime}});assert.equal(r.status,413);
  }
  for(const bytes of [Buffer.from('RIFF'),Buffer.from('not an audio file')])assert.equal((await f.request('/api/media/upload',{body:bytes,binary:true})).status,400);
  assert.equal(fs.readdirSync(path.join(f.dataDir,'media')).some(name=>name.endsWith('.tmp')),false);
});

test('chunked audio over 8MB is rejected during upload and temporary bytes are removed',async t=>{
  const f=await fixture(t);
  const file=wav(8*1024*1024+2);
  // Use the fixture's authenticated transport with a real chunked stream.
  const stream=require('node:stream').Readable.from([file.subarray(0,44),file.subarray(44)]);
  const r=await f.request('/api/media/upload',{body:stream,binary:true,headers:{'Content-Type':'audio/wav'}});
  assert.equal(r.status,413);assert.equal(fs.readdirSync(path.join(f.dataDir,'media')).length,0);
});

test('legacy JSON entries externalize image/audio fields while preserving profile compatibility, duration validation and untouched historical fields',async t=>{
  const f=await fixture(t),inline='data:image/png;base64,'+png.toString('base64'),sound='data:audio/wav;base64,'+wav().toString('base64');
  const uploaded=await f.json('/api/media/upload',{image:inline});assert.match(uploaded.url,/\/api\/media\//);
  let result=await f.json('/api/action',{type:'role.save',payload:{name:'甲',avatar:inline,faceReferences:[inline]}}),id=result.state.roles[0].id;
  assert.equal(result.state.roles[0].avatar,uploaded.url);
  const state=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);state.profile.avatar=inline;
  f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
  await f.json('/api/action',{type:'profile.save',payload:{bio:'普通文字'}});
  assert.equal(JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json).profile.avatar,inline);
  for(const durationMs of [0,600001]){
    const r=await f.request('/api/chat/send',{body:{roleId:id,audio:sound,durationMs,requestId:crypto.randomUUID()}});assert.equal(r.status,400);
  }
  result=await f.json('/api/chat/send',{roleId:id,audio:sound,durationMs:600000,requestId:crypto.randomUUID()});
  const message=result.state.messages.find(m=>m.type==='voice');assert.match(message.meta.audio,/\.wav$/);assert.equal(message.meta.durationMs,600000);
  const stored=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);assert.equal(stored.messages.some(m=>m.meta?.audio?.startsWith('data:audio/')),false);
  const badUrl=await f.request('/api/chat/send',{body:{roleId:id,audio:uploaded.url,durationMs:2,requestId:crypto.randomUUID()}});assert.equal(badUrl.status,400);
});

test('audio files survive complete backup/restore and sticker limits count actual stored bytes',async t=>{
  const f=await fixture(t),target=await fixture(t),audio=await f.upload(wav(),'audio/wav');
  const s=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);S.apply(s,'role.save',{name:'甲'});S.message(s,s.roles[0],'user','','voice',{meta:{audio,durationMs:2}});f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(s));
  const backup=await f.json('/api/backup');assert.ok(backup.media[audio.split('/').at(-1)]);
  await target.json('/api/restore',{backup,confirm:true});assert.deepEqual(Buffer.from(await (await target.request(audio)).arrayBuffer()),wav());
  const large=await f.upload(sizedPng(9*1024*1024),'image/png');
  const first=await f.json('/api/action',{type:'sticker.add',payload:{image:large,name:'大图'}});assert.equal(first.state.stickers.length,1);
  const otherBytes=sizedPng(9*1024*1024);otherBytes[otherBytes.length-20]^=1;
  const other=await f.upload(otherBytes,'image/png');
  const rejected=await f.request('/api/action',{body:{type:'sticker.add',payload:{image:other,name:'第二张'}}});assert.equal(rejected.status,413);
  const friend=await f.request('/api/action',{body:{type:'role.save',payload:{id:s.roles[0].id,stickers:[{id:'a',name:'a',image:large},{id:'b',name:'b',image:other}]}}});assert.equal(friend.status,413);
});

test('quoting an existing missing image keeps its snapshot, while submitting a new missing media URL fails',async t=>{
  const f=await fixture(t),s=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  S.apply(s,'role.save',{name:'甲'});const roleId=s.roles[0].id,url='/api/media/'+'0'.repeat(64)+'.png';
  const old=S.message(s,s.roles[0],'user',url,'image');f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(s));
  const accepted=await f.json('/api/chat/send',{roleId,text:'引用旧图',quoteId:old.id,requestId:crypto.randomUUID()});
  assert.equal(accepted.state.messages.at(-1).meta.quote.image,url);
  const fresh=await f.request('/api/chat/send',{body:{roleId,image:url,requestId:crypto.randomUUID()}});assert.equal(fresh.status,404);
});
