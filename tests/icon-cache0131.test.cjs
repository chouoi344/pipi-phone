// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {createApp}=require('../server.cjs');
const shortHash=bytes=>createHash('sha256').update(bytes).digest('hex').slice(0,16);
const revalidate='public, max-age=0, must-revalidate',immutable='public, max-age=31536000, immutable';

async function start(t,publicDir){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-static-cache-'));
  const app=createApp({dataDir,publicDir,host:'127.0.0.1',port:0,mediaTimers:false});
  t.after(async()=>{await app.close();await fs.rm(dataDir,{recursive:true,force:true});});
  await app.listen();
  return 'http://127.0.0.1:'+app.server.address().port;
}

test('the served index fingerprints every local reference, including legacy CSS, while the Android template is unchanged',async t=>{
  const root=path.join(__dirname,'../public'),base=await start(t);
  const template=await fs.readFile(path.join(root,'index.html'),'utf8');
  const response=await fetch(base+'/'),page=await response.text();
  assert.equal(response.headers.get('cache-control'),revalidate);
  const urlPattern=/(?:href|src)="(\/[^"]+)"/g;
  const original=[...template.matchAll(urlPattern)],served=[...page.matchAll(urlPattern)];
  assert.equal(served.length,original.length);
  assert.ok(served.length>70);
  for(const [i,match] of served.entries()){
    const url=new URL(match[1],base);
    assert.equal(url.pathname,new URL(original[i][1],base).pathname);
    assert.equal(url.searchParams.get('v'),shortHash(await fs.readFile(path.join(root,url.pathname))));
  }
  assert.match(page,/data-href="\/webview83\.css\?v=[a-f\d]{16}"/);
  const oldIconVersion=template.match(/people-filled\.svg\?v=([^"]+)/)[1];
  const icon='/vendor/fake-world/masks/people-filled.svg';
  for(const suffix of ['', '?v=old', '?v='+oldIconVersion]){
    const res=await fetch(base+icon+suffix,{method:'HEAD'});
    assert.equal(res.status,200);
    assert.equal(res.headers.get('cache-control'),suffix==='?v='+oldIconVersion?'public, max-age=604800, immutable':revalidate);
  }
  assert.equal(await fetch(base+'/index.html').then(r=>r.text()),page);
  assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),template);
});

test('asset change on restart invalidates the served HTML and file ETags even when their byte lengths stay equal',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-static-release-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const template='<link rel="stylesheet" href="/theme.css?v=manual"><script src="./test.js"></script>';
  const css=path.join(root,'theme.css'),old='a{color:red}',next='a{color:tan}';
  await fs.writeFile(path.join(root,'index.html'),template);
  await fs.writeFile(path.join(root,'test.js'),'void 0');
  await fs.writeFile(css,old);
  const before=await start(t,root),html=await fetch(before+'/index.html');
  const href='/theme.css?v='+shortHash(old);
  assert.ok((await html.text()).includes(href));
  const cached=await fetch(before+href);
  assert.equal(cached.headers.get('cache-control'),immutable);assert.equal(await cached.text(),old);
  const headers={'If-None-Match':cached.headers.get('etag')};
  const valid=await fetch(before+href,{headers});assert.equal(valid.status,304);assert.equal(valid.headers.get('cache-control'),immutable);
  await fs.writeFile(css,next);
  const after=await start(t,root),updated=await fetch(after+'/',{headers:{'If-None-Match':html.headers.get('etag')}});
  assert.equal(updated.status,200);assert.equal(updated.headers.get('cache-control'),revalidate);
  assert.ok((await updated.text()).includes('/theme.css?v='+shortHash(next)));
  const stale=await fetch(after+href,{headers});
  assert.equal(stale.status,200);assert.equal(stale.headers.get('cache-control'),revalidate);assert.equal(await stale.text(),next);
  assert.equal((await fetch(after+'/theme.css?v='+shortHash(next),{method:'HEAD'})).headers.get('cache-control'),immutable);
  assert.equal((await fetch(after+'/api/status')).headers.get('cache-control'),'no-store');
});
