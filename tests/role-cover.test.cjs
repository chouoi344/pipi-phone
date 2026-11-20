// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../scripts/sample-data.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('friend cover is isolated, survives restart and backup, and rejects invalid images atomically',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-role-cover-')),password='Cover-isolated-check-2026!';
  let app,base,cookie='',csrf='';
  async function start(){app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();base='http://127.0.0.1:'+app.server.address().port;}
  async function request(route,body){
    const res=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await res.json();if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
    return {status:res.status,value};
  }
  async function assertImage(url){assert.match(url,/^\/api\/media\/[a-f0-9]{64}\.png$/);const response=await fetch(base+url,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(PNG.split(',')[1],'base64'));assert.equal((await fetch(base+url)).status,401);}
  t.after(async()=>{await app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-role-cover-'));fs.rmSync(dir,{recursive:true,force:true});});
  await start();assert.equal((await request('/api/setup',{password})).status,200);
  const before=(await request('/api/state')).value,friend=before.roles[0];
  assert.equal((await request('/api/action',{type:'role.save',payload:{id:friend.id,cover:PNG}})).status,200);
  assert.equal((await request('/api/action',{type:'role.save',payload:{id:friend.id,remark:'保留封面'}})).status,200);
  let saved=(await request('/api/state')).value;
  await assertImage(saved.roles[0].cover);assert.equal(saved.profile.cover,before.profile.cover);assert.deepEqual(saved.roles[1],before.roles[1]);assert.equal(saved.roles[0].prompt,friend.prompt);
  for(const cover of ['https://example.invalid/private.png','data:image/png;base64,PHNjcmlwdD4=']){
    assert.equal((await request('/api/action',{type:'role.save',payload:{id:friend.id,cover}})).status,400);
    assert.deepEqual((await request('/api/state')).value,saved);
  }
  await app.close();await start();assert.equal((await request('/api/login',{password})).status,200);
  await assertImage((await request('/api/state')).value.roles[0].cover);
  const backup=(await request('/api/backup')).value;
  assert.equal((await request('/api/action',{type:'role.save',payload:{id:friend.id,cover:''}})).status,200);
  assert.equal((await request('/api/restore',{backup,confirm:true})).status,200);
  await assertImage((await request('/api/state')).value.roles[0].cover);
});
