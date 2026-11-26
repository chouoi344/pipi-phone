'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const Images=require('../lib/engine/model-images.cjs'),Media=require('../lib/media-store.cjs'),Models=require('../lib/engine/models.cjs'),Providers=require('../lib/providers.cjs'),S=require('../lib/state.cjs'),Wardrobe=require('../lib/engine/schedule-wardrobe.cjs'),Stickers=require('../lib/engine/stickers.cjs');
const Pipeline=require('../lib/engine/pipeline.cjs');
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-standalone-images-'));t.after(()=>{require('../lib/engine/memory-store.cjs').close(dir);fs.rmSync(dir,{recursive:true,force:true});});return dir;}
async function noise(width=1448,height=1448){return sharp(crypto.randomBytes(width*height*3),{raw:{width,height,channels:3}}).png().toBuffer();}
async function small(){return Buffer.concat([await sharp({create:{width:24,height:16,channels:4,background:{r:20,g:80,b:140,alpha:0.5}}}).png().toBuffer(),Buffer.from('ORIGINAL_TRAILER')]);}
async function peer(t,content){
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});
  const requests=[],server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),body=JSON.parse(bytes);requests.push({bytes:bytes.length,body});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:content(body)}}],usage:{prompt_tokens:30,completion_tokens:12,total_tokens:42}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const state=S.initial();state.settings.ai.sources.push({id:'local-fixture',name:'Synthetic HTTP only',template:'compatible',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',key:'SYNTHETIC_NOT_A_REAL_KEY'});state.settings.ai.models=[{id:'caption-fixture',sourceId:'local-fixture',kind:'chat',model:'caption-fixture',capabilities:['text','image'],maxContextTokens:128000,timeoutSeconds:2,temperature:null,maxTokens:null,extraBody:{}}];Object.assign(state.settings.ai.assign,{chat:'caption-fixture',caption:'caption-fixture',chatFallbacks:[]});
  return {state,requests};
}
function imageParts(body){return body.messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(part=>part.type==='image_url'):[]);}
test('server model copy is bounded, tied to the original, and preserves original bytes',async t=>{
  const dir=directory(t),original=await noise(),ref=Media.saveImage(dir,original),copy=await Images.prepare(dir,ref),file=Media.resolveImageBytes(dir,copy.url),info=await sharp(file.buffer).metadata();
  assert(original.length>6*1024*1024);assert(file.buffer.length<512*1024);assert(Math.max(info.width,info.height)<=1280);assert.deepEqual(Media.resolveImageBytes(dir,ref).buffer,original);
  const untrusted=Media.saveImage(dir,await small());assert.deepEqual(Images.bytes(dir,ref,untrusted).buffer,file.buffer);assert.equal(Images.dataUrl(dir,ref,untrusted),file.dataUrl);assert.deepEqual(await Images.prepare(dir,ref),copy);
});
test('transparent images retain alpha and EXIF orientation is applied to the model view',async t=>{
  const dir=directory(t),rgba=Media.saveImage(dir,await small()),alpha=await Images.prepare(dir,rgba);assert.equal((await sharp(Media.resolveImageBytes(dir,alpha.url).buffer).metadata()).hasAlpha,true);
  const bytes=await sharp({create:{width:40,height:20,channels:3,background:'#99aa33'}}).jpeg().withMetadata({orientation:6}).toBuffer(),ref=Media.saveImage(dir,bytes),view=await Images.prepare(dir,ref),metadata=await sharp(Media.resolveImageBytes(dir,view.url).buffer).metadata();assert.equal(metadata.width,20);assert.equal(metadata.height,40);assert.equal(metadata.orientation,undefined);assert.deepEqual(Media.resolveImageBytes(dir,ref).buffer,bytes);
});
test('animated GIF work copy samples frames in order while the original remains animated',async t=>{
  const dir=directory(t),width=16,height=16,raw=Buffer.alloc(width*height*3*3);for(let frame=0;frame<3;frame++)for(let pixel=0;pixel<width*height;pixel++)raw[(frame*width*height+pixel)*3+frame]=255;
  const gif=await sharp(raw,{raw:{width,height:height*3,channels:3,pageHeight:height}}).gif({delay:[100,100,100],loop:0}).toBuffer(),ref=Media.saveImage(dir,gif),view=await Images.prepare(dir,ref);assert.equal(view.montage,true);assert.equal((await sharp(gif).metadata()).pages,3);assert.deepEqual(Media.resolveImageBytes(dir,ref).buffer,gif);
  const {data,info}=await sharp(Media.resolveImageBytes(dir,view.url).buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,48);assert.equal(info.height,48);for(let frame=0;frame<3;frame++){const index=(8*info.width+frame*16+8)*info.channels;assert(data[index+frame]>200);}
  const messages=[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/gif;base64,'+gif.toString('base64')}}]}];await Images.prepareMessageParts(messages);assert.equal(messages[0].content[0].type,'text');assert.match(messages[0].content[0].text,/同一动图.*从左到右.*从上到下/);assert.match(messages[0].content[1].image_url.url,/^data:image\/jpeg;base64,/);
});
test('cache rebuilds after work-copy GC and cannot resurrect a physically removed original',async t=>{
  const dir=directory(t),original=await small(),ref=Media.saveImage(dir,original),copy=await Images.prepare(dir,ref),workPath=Media.describeMediaFile(dir,copy.url.slice('/api/media/'.length)).path;
  fs.unlinkSync(workPath);assert.equal(Images.cached(dir,ref),null);const rebuilt=await Images.prepare(dir,ref);assert.equal(rebuilt.url,copy.url);
  fs.unlinkSync(Media.describeMediaFile(dir,ref.slice('/api/media/'.length)).path);assert.equal(Images.cached(dir,ref),null);assert.equal(Images.dataUrl(dir,ref,rebuilt.url),'');assert.equal(Images.bytes(dir,ref,rebuilt.url),null);await assert.rejects(Images.prepare(dir,ref),{code:'MEDIA_UNAVAILABLE'});
});
test('backup model-image references restore without needing the disposable manifest',async t=>{
  const dir=directory(t),restored=directory(t),original=await small(),ref=Media.saveImage(dir,original),copy=await Images.prepare(dir,ref),root={messages:[{type:'image',content:ref,meta:{modelImage:copy.url}}]},backup=Media.backupImages(dir,root);
  assert(backup[ref.split('/').at(-1)]);assert(backup[copy.url.split('/').at(-1)]);Media.restoreImages(restored,root,backup);assert.equal(Images.cached(restored,ref),null);assert.equal((await Images.prepare(restored,ref)).url,copy.url);assert.deepEqual(Media.resolveImageBytes(restored,ref).buffer,original);
});
test('a cancelled duplicate preparation does not cancel another role sharing the same image',async t=>{
  const dir=directory(t),ref=Media.saveImage(dir,await noise(1000,1000)),cancelled=new AbortController(),first=Images.prepare(dir,ref,{signal:cancelled.signal}),other=Images.prepare(dir,ref);cancelled.abort();await assert.rejects(first,{name:'AbortError'});assert((await other).bytes<512*1024);
});
test('unreadable historical images are explicit projection facts while current uploads remain strict',async t=>{
  const dir=directory(t),f=await peer(t,()=> 'Fixed text response'),broken=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=','base64'),ref=Media.saveImage(dir,broken),missing='/api/media/'+'f'.repeat(64)+'.png';
  S.apply(f.state,'role.save',{name:'Historical image role'});const role=f.state.roles[0];
  const prior=S.message(f.state,role,'user',ref,'image',{status:'sent'});S.message(f.state,role,'assistant','Prior text','text',{status:'sent'});S.message(f.state,role,'user',missing,'image',{status:'sent'});S.message(f.state,role,'assistant','Another prior text','text',{status:'sent'});
  const current=S.message(f.state,role,'user','Current valid text','text',{status:'pending'}),options={getState:()=>structuredClone(f.state),mutate:fn=>({value:fn(f.state),state:structuredClone(f.state)}),roleId:role.id,targetId:current.id,dataDir:dir};
  assert.equal(await Pipeline.run(options),'Fixed text response');assert.equal(f.requests.length,1);assert.match(JSON.stringify(f.requests[0].body),/历史图片当前无法读取/);assert.equal(imageParts(f.requests[0].body).length,0);assert.equal(f.state.messages.find(message=>message.id===prior.id).content,ref);assert.deepEqual(Media.resolveImageBytes(dir,ref).buffer,broken);
  const upload=S.message(f.state,role,'user',ref,'image',{status:'pending'});await assert.rejects(Pipeline.run({...options,targetId:upload.id}),{code:'MODEL_IMAGE_INVALID'});assert.equal(f.requests.length,1);
});
test('shared Models.call preprocessing bounds receipt OCR, wardrobe and sticker analysis without changing media',async t=>{
  const dir=directory(t),original=await noise(),ref=Media.saveImage(dir,original),f=await peer(t,body=>{const prompt=body.messages[0].content;return prompt.includes('账单')?'[]':JSON.stringify({meaning:'固定协议表情含义',tags:['平静'],usage:'测试',description:'固定描述',visibleText:''});});
  // Each real domain entry still controls its own parsing and product semantics.
  assert.deepEqual(await Providers.recognize(f.state,ref,{dataDir:dir}),[]);
  const clothing=await peer(t,()=>JSON.stringify({description:'固定协议蓝外套',category:'外出',seasons:['春']}));const draft=await Wardrobe.identifyImage(clothing.state,{dataUri:ref,dataDir:dir});assert.equal(draft.image,ref);assert.equal(draft.description,'固定协议蓝外套');
  S.apply(f.state,'sticker.add',{names:['Synthetic sticker'],image:ref});const queue=Stickers.create({dataDir:dir,getState:()=>structuredClone(f.state),mutate:fn=>({value:fn(f.state),state:structuredClone(f.state)})});t.after(()=>queue.close());queue.enqueue({ids:[f.state.stickers.at(-1).id]});await queue.idle();assert.equal(Stickers.get(f.state,ref).status,'ready');
  for(const request of [...f.requests,...clothing.requests]){assert(request.bytes<1024*1024);const parts=imageParts(request.body);assert.equal(parts.length,1);assert(Buffer.from(parts[0].image_url.url.split(',')[1],'base64').length<512*1024);}assert.deepEqual(Media.resolveImageBytes(dir,ref).buffer,original);
});
test('default transport sends 20 MiB plus one byte without a local request cap',async t=>{
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});const received=[];
  const server=http.createServer(async(req,res)=>{let bytes=0;for await(const chunk of req)bytes+=chunk.length;received.push(bytes);res.setHeader('Content-Type','application/json');res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));const config={baseUrl:'http://127.0.0.1:'+server.address().port,key:'SYNTHETIC',timeoutSeconds:2};
  await Providers.request(config,'/boundary',{body:Buffer.alloc(20*1024*1024+1)});assert.deepEqual(received,[20*1024*1024+1]);
});
