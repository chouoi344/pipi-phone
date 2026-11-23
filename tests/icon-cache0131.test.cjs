// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('only the icon version shipped by the page gets immutable cache headers',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-icon-cache-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,mediaTimers:false});await app.listen();
  t.after(async()=>{await app.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port,icon='/vendor/fake-world/masks/people-filled.svg';
  const page=await fetch(base+'/').then(response=>response.text());
  const version=page.match(/href="\/vendor\/fake-world\/masks\/people-filled\.svg\?v=([^"]+)"/)[1];
  for(const suffix of ['', '?v=old']){const response=await fetch(base+icon+suffix);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=0, must-revalidate');await response.arrayBuffer();}
  const response=await fetch(base+icon+'?v='+version);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=604800, immutable');await response.arrayBuffer();
  const notModified=await fetch(base+icon+'?v='+version,{headers:{'If-None-Match':response.headers.get('etag')}});assert.equal(notModified.status,304);assert.match(notModified.headers.get('cache-control'),/immutable/);
  const script=await fetch(base+'/app.js?v='+version);assert.equal(script.headers.get('cache-control'),'public, max-age=0, must-revalidate');const text=await script.text();assert.ok(text.includes("const iconVersion = '"+version+"'"));
});
