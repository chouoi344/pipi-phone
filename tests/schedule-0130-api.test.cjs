'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../scripts/sample-data.cjs');

test('好友配置入口保存三种作息，刷新与进程重启后仍保留，非法作息不落库',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-sleep-profile-api-'));
  let app,base,cookie='',csrf='';
  async function start(){app=createApp({dataDir,host:'127.0.0.1',port:0,demoModel:true});await app.listen();base='http://127.0.0.1:'+app.server.address().port;}
  async function request(route,body){
    const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const json=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(json.csrfToken)csrf=json.csrfToken;
    return {status:response.status,json};
  }
  async function ok(route,body){const result=await request(route,body);assert.equal(result.status,200,JSON.stringify(result.json));return result.json;}
  t.after(async()=>{await app?.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  await start();const setup=await ok('/api/setup',{password:'Sleep-profile-isolated-2026!',displayName:'隔离作息测试'}),roleId=setup.state.roles[0].id;
  const body=sleepProfile=>({roleId,action:'saveConfiguration',sections:{schedule:{sleepProfile}}});
  for(const sleepProfile of ['day_normal','night_owl','free']){
    const result=await ok('/api/engine/life',body(sleepProfile));assert.equal(result.view.schedule.settings.sleepProfile,sleepProfile);
    const refreshed=await ok('/api/engine/life?roleId='+roleId);assert.equal(refreshed.schedule.settings.sleepProfile,sleepProfile);
    const stored=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);assert.equal(stored.engine.data.schedule.roleSettings[roleId].sleepProfile,sleepProfile);
  }
  assert.equal((await request('/api/engine/life',body('bad-mode'))).status,400);
  await app.close();await start();cookie='';csrf='';await ok('/api/login',{password:'Sleep-profile-isolated-2026!'});
  assert.equal((await ok('/api/engine/life?roleId='+roleId)).schedule.settings.sleepProfile,'free');
});
