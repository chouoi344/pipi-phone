// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=','base64');
const image=n=>'data:image/png;base64,'+Buffer.concat([PNG,Buffer.from(String(n))]).toString('base64');
test('sticker batch saves all unique files once; invalid or over-limit batches preserve state',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-sticker-batch-')),app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();
  t.after(async()=>{await app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-sticker-batch-'));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'Sticker-batch-test-2026!'})});assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0],csrf=(await setup.json()).csrfToken;
  const state=async()=>await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
  const add=payload=>fetch(base+'/api/action',{method:'POST',headers:{Cookie:cookie,Origin:base,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({type:'sticker.add',payload})});
  assert.equal((await add({image:image(0)})).status,200);
  assert.equal((await add({images:[image(0),image(1),image(1),image(2)]})).status,200);
  const saved=await state(),sources=[image(0),image(1),image(2)];assert.deepEqual(saved.stickers.map(s=>s.image),sources.map(source=>'/api/media/'+require('node:crypto').createHash('sha256').update(Buffer.from(source.split(',')[1],'base64')).digest('hex')+'.png'));
  for(const [i,sticker]of saved.stickers.entries()){const response=await fetch(base+sticker.image,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(sources[i].split(',')[1],'base64'));assert.equal((await fetch(base+sticker.image)).status,401);}
  for(const images of [[],null,'wrong',[image(3),'data:image/png;base64,PHNjcmlwdD4='],Array(201).fill(image(4))]){
    assert.equal((await add({images})).status,400);assert.deepEqual(await state(),saved);
  }
  assert.equal((await add({images:Array.from({length:197},(_,i)=>image(i+3))})).status,200);
  const full=await state();assert.equal(full.stickers.length,200);
  assert.notEqual((await add({images:[image(200),image(201)]})).status,200);assert.deepEqual(await state(),full);
});
