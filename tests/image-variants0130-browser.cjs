// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');const S=require('../lib/state.cjs'),Media=require('../lib/media-store.cjs'),{createApp}=require('../server.cjs');
const out=path.resolve(__dirname,'../.codex/validation/image-variants0130'),results=[];let browser;
async function seedChatImages(page, dataDir, initial) {
 const samples=await page.evaluate(()=>{
  function picture(background, mime='image/png', right=''){
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
   const ctx=canvas.getContext('2d');
   if(background){ctx.fillStyle=background;ctx.fillRect(0,0,64,32);}
   if(right){ctx.fillStyle=right;ctx.fillRect(32,0,32,32);}
   return canvas.toDataURL(mime).split(',')[1];
  }
  return {transparentColor:picture('', 'image/png', '#00cc66'),black:picture('#000','image/jpeg'),
   transparent:picture('','image/webp'),good:picture('#1580af','image/jpeg'),
   red:picture('#dd2020'),orange:picture('#ef8020'),purple:picture('#c02da3'),blue:picture('#2252b2')};
 });
 const urls=Object.fromEntries(Object.entries(samples).map(([key,base64])=>[key,Media.saveImage(dataDir,Buffer.from(base64,'base64'))]));
 const old=S.message(initial,initial.roles[0],'assistant',urls.transparentColor,'image');
 const previews={};
 const missing='/api/media/'+'3'.repeat(64)+'.jpg';
 for(const [kind,thumb,original] of [['black',urls.black,urls.red],['transparent',urls.transparent,urls.orange],['missing',missing,urls.purple],['good',urls.good,urls.blue]]){
  const message=S.message(initial,initial.roles[1],'assistant',original,'image',{meta:{thumb}});
  previews[kind]={id:message.id,thumb,original};
 }
 return {old,previews};
}
async function run(width,height,mode='new'){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-variants-0130-')),dataDir=path.join(temp,'data'),initial=S.initial();S.apply(initial,'role.save',{name:'图片隔离甲',momentsAutoEnabled:false});S.apply(initial,'role.save',{name:'图片隔离乙',momentsAutoEnabled:false});const roleId=initial.roles[0].id,otherId=initial.roles[1].id;
 const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
 const {old,previews}=await seedChatImages(page,dataDir,initial);
 const oldGif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),oldUrl=old.content;
 const app=createApp({host:'127.0.0.1',port:0,dataDir,initialState:()=>initial});await app.listen();const base='http://127.0.0.1:'+app.server.address().port,errors=[],uploads=[],backfills=[],sends=[],mediaGets=[];
 page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{const p=new URL(req.url()).pathname;if(req.method()==='GET'&&p.startsWith('/api/media/'))mediaGets.push(p);if(p==='/api/media/upload')uploads.push(req.headers()['content-type']);if(p==='/api/chat/media/thumbnail')backfills.push(req.postDataJSON());if(p==='/api/chat')sends.push(req.postDataJSON());});
 const check=async(name,fn)=>{await fn();results.push({width,mode,name,passed:true});console.log('PASS '+width+' '+mode+' '+name);};
 const imageInfo=src=>page.evaluate(async src=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return {width:c.width,height:c.height,pixel:[...ctx.getImageData(0,0,1,1).data],right:[...ctx.getImageData(Math.floor(c.width*.75),0,1,1).data]};},src);
 try{
 if(mode!=='new')await page.route('**/api/status',async route=>{const response=await route.fetch(),json=await response.json();delete json.imageVariants;if(mode==='legacy')delete json.binaryMedia;await route.fulfill({response,json});});
 await page.goto(base);
 await page.locator('#dismiss-notice').click();
 await page.locator('.first-notice').waitFor({state:'detached'});
 await page.locator('[name=displayName]').fill('图片副本隔离');
 await page.locator('[name=password]').fill('Isolated-Variants-0130');
 await page.locator('[name=confirmPassword]').fill('Isolated-Variants-0130');
 await page.locator('#auth-form [type=submit]').click();
 await page.locator('#view[data-route=chats]').waitFor();
 const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=3200;c.height=1000;const x=c.getContext('2d');x.fillStyle='#1d7650';x.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];}),bytes=Buffer.from(encoded,'base64'),file={name:'wide-original.png',mimeType:'image/png',buffer:bytes};
 await page.evaluate(id=>window.Pipi.showView('chat',id),roleId);await page.locator('#compose-text').fill('保留大图草稿');
 if(mode!=='new'){
 await check('older capability keeps the original image path and omits derivative fields',async()=>{await page.locator('#chat-image-file').setInputFiles(file);await page.locator('.compose-image-preview img').waitFor();await page.route('**/api/chat',async route=>{const state=await page.evaluate(()=>window.Pipi.getState());state.revision++;await route.fulfill({json:{state}});});await page.locator('#compose-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('.compose-image-preview')===null);assert.equal(sends.length,1);assert.equal(sends[0].thumb,undefined);assert.equal(sends[0].modelImage,undefined);assert.equal(backfills.length,0);assert.equal(uploads.length,mode==='legacy'?0:1);assert.match(sends[0].image,mode==='legacy'?/^data:image\/png;base64,/:/^\/api\/media\//);});return;
 }
 await check('backfilled AI photo retains its transparent region and its visible green region',async()=>{
  await page.waitForFunction(id=>!!window.Pipi.getState().messages.find(m=>m.id===id)?.meta?.thumb,old.id);
  assert.equal(backfills.length,1);assert.equal(backfills[0].originalImage,oldUrl);
  const saved=await page.evaluate(id=>window.Pipi.getState().messages.find(m=>m.id===id),old.id);
  assert.equal(saved.content,oldUrl);const info=await imageInfo(saved.meta.thumb);
  assert.ok(info.width<=320&&info.height<=320);assert.equal(info.pixel[3],0,'transparent pixels became opaque');
  assert.ok(info.right[1]>160&&info.right[0]<40&&info.right[3]===255,'green region was lost');
  for(let i=0;i<3;i++)await page.evaluate(()=>window.Pipi.refresh());assert.equal(backfills.length,1);
 });
 await check('old black, empty and missing previews show the original; a good preview never fetches the original',async()=>{
  await page.evaluate(id=>window.Pipi.showView('chat',id),otherId);
  for(const [kind,item] of Object.entries(previews)){
   const src=kind==='good'?item.thumb:item.original;
   const photo=page.locator('#view [data-bubble="'+item.id+'"] img.chat-photo');
   await photo.scrollIntoViewIfNeeded();
   await page.waitForFunction(({id,src})=>{const img=document.querySelector('#view [data-bubble="'+id+'"] .chat-photo');return img?.getAttribute('src')===src&&img.complete&&img.naturalWidth>0;},{id:item.id,src});
   const visible=await photo.evaluate(img=>{const c=document.createElement('canvas'),ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(0,0,1,1).data];});
   assert.ok(visible[3]===255&&Math.max(...visible.slice(0,3))>100,kind+' produced a blank bubble');
  }
  assert.equal(mediaGets.includes(previews.good.original),false);
  const urlsAfterRedraw=await page.evaluate(items=>{
   window.Pipi.refresh();
   return Object.fromEntries(Object.entries(items).map(([kind,item])=>[kind,document.querySelector('#view [data-bubble="'+item.id+'"] .chat-photo')?.getAttribute('src')]));
  },previews);
  for(const [kind,item] of Object.entries(previews))assert.equal(urlsAfterRedraw[kind],kind==='good'?item.thumb:item.original,kind+' flashed back to its previous source');
  assert.equal(mediaGets.includes(previews.good.original),false);
  await page.evaluate(id=>window.Pipi.showView('chat',id),roleId);
 });
 await check('selection survives switching chats; failed send retains both derivative URLs for retry',async()=>{
 await page.locator('#chat-image-file').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('.compose-image-preview img')?.getAttribute('src')?.startsWith('/api/media/'));const original=await page.locator('.compose-image-preview img').getAttribute('src');await page.evaluate(({a,b})=>{window.Pipi.showView('chat',b);window.Pipi.showView('chat',a);},{a:roleId,b:otherId});await page.route('**/api/chat',route=>route.abort());await page.locator('#compose-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#compose-text')?.value==='保留大图草稿');assert.equal(sends.length,1);const first=sends[0];assert.equal(first.image,original);assert.match(first.thumb,/^\/api\/media\/.+\.jpg$/);assert.match(first.modelImage,/^\/api\/media\/.+\.jpg$/);const thumb=await imageInfo(first.thumb),model=await imageInfo(first.modelImage);assert.equal(Math.max(thumb.width,thumb.height),320);assert.equal(Math.max(model.width,model.height),2048);const response=await context.request.get(base+original);assert.equal(createHash('sha256').update(await response.body()).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 await page.unroute('**/api/chat');await page.locator('#compose-form [type=submit]').click();await page.waitForFunction(id=>window.Pipi.getState().messages.some(m=>m.type==='text'&&m.meta?.image===id||m.type==='image'&&m.content===id),original);assert.equal(sends[1].requestId,first.requestId);assert.equal(sends[1].thumb,first.thumb);assert.equal(sends[1].modelImage,first.modelImage);await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'original-'+width+'.png')});
 });
 await check('fully transparent GIF stays available without a black thumbnail',async()=>{
  await page.locator('#compose-text').fill('透明 GIF');
  await page.locator('#chat-image-file').setInputFiles({name:'transparent.gif',mimeType:'image/gif',buffer:oldGif});
  await page.locator('.compose-image-preview img').waitFor();
  await page.route('**/api/chat',async route=>{const state=await page.evaluate(()=>window.Pipi.getState());state.revision++;await route.fulfill({json:{state}});});
  const sent=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/chat');
  await page.locator('#compose-form [type=submit]').click();const body=(await sent).postDataJSON();
  assert.equal(body.thumb,undefined);assert.equal((await imageInfo(body.image)).pixel[3],0);
  const response=await context.request.get(base+body.image);assert.deepEqual(await response.body(),oldGif);
  await page.unroute('**/api/chat');
 });
 await check('animated GIF retains its original bytes and first-frame model copy',async()=>{const first=Buffer.from(oldGif);first[22]=0;first[23]=50;const second=Buffer.from(first.subarray(27,first.length-1));second[second.length-2]=0x4c;const gif=Buffer.alloc(4*1024*1024+1);Buffer.concat([first.subarray(0,first.length-1),second,Buffer.from([0x3b])]).copy(gif);await page.locator('#compose-text').fill('GIF原图');await page.locator('#chat-image-file').setInputFiles({name:'two-frames.gif',mimeType:'image/gif',buffer:gif});await page.locator('.compose-image-preview img').waitFor();await page.route('**/api/chat',async route=>{const state=await page.evaluate(()=>window.Pipi.getState());state.revision++;await route.fulfill({json:{state}});});await page.locator('#compose-form [type=submit]').click();await page.waitForTimeout(150);const body=sends.at(-1);assert.match(body.image,/\.gif$/);assert.ok(body.modelImage);const info=await imageInfo(body.modelImage);assert.ok(info.pixel[0]<80&&info.pixel[1]<80&&info.pixel[2]<80);const response=await context.request.get(base+body.image);assert.deepEqual(await response.body(),gif);await page.unroute('**/api/chat');});
 await check('failed derivative decoding still sends the untouched selected original',async()=>{await page.evaluate(()=>{window.__nativeBitmap=window.createImageBitmap;window.createImageBitmap=async()=>{throw new Error('isolated decoder failure');};});await page.locator('#compose-text').fill('副本失败保留原图');await page.locator('#chat-image-file').setInputFiles(file);await page.locator('.compose-image-preview img').waitFor();await page.route('**/api/chat',async route=>{const state=await page.evaluate(()=>window.Pipi.getState());state.revision++;await route.fulfill({json:{state}});});await page.locator('#compose-form [type=submit]').click();await page.waitForTimeout(100);const body=sends.at(-1);assert.match(body.image,/^\/api\/media\//);assert.equal(body.thumb,undefined);assert.equal(body.modelImage,undefined);await page.evaluate(()=>window.createImageBitmap=window.__nativeBitmap);});
 assert.deepEqual(errors,[]);
 }catch(error){await page.screenshot({path:path.join(out,'failure-'+width+'-'+mode+'.png')});console.error((await page.locator('body').innerText()).slice(-800));throw error;}finally{await context.close();await app.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));}}
(async()=>{await fs.mkdir(out,{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});for(const size of [[390,844],[1280,900]])await run(...size);await run(390,844,'legacy');await run(1280,900,'binary-only');console.log(JSON.stringify({passed:results.length,out}));})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
