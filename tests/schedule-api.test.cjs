'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../scripts/sample-data.cjs'),Schedule=require('../lib/engine/modules/schedule.cjs'),D=require('../lib/engine/schedule-data.cjs');
test('schedule panel API saves isolated friend data, generates through fallback, and preserves it on failure and restart',async t=>{
 const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
 const calls=[];let failAll=false;
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);calls.push(b.model);const profile=Object.fromEntries(D.PROFILE_FIELDS.map(k=>[k,'隔离生活资料']));const plan={outfit:'蓝色外套',mood:'平静',daySummary:'规律生活',dayType:'工作日',dayTypeReason:'按人设安排',slots:Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:'日常安排'+i}))};const result=failAll||b.model==='primary'?'invalid json':JSON.stringify(b.messages[0].content.includes('10个字段')?profile:plan);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:result}}],usage:{prompt_tokens:10,completion_tokens:10}}));});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-schedule-api-'));let app,base,cookie='',csrf='';
 async function start(){app=createApp({dataDir:dir,host:'127.0.0.1',port:0,demoModel:true});await app.listen();base='http://127.0.0.1:'+app.server.address().port;}
 async function request(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await r.json();if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(json.csrfToken)csrf=json.csrfToken;return {status:r.status,body:json};}
 const ok=async promise=>{const r=await promise;assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 t.after(async()=>{await app?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;if(path.dirname(dir)===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('pipi-schedule-api-'))fs.rmSync(dir,{recursive:true,force:true});});
 await start();const setup=await ok(request('/api/setup',{password:'Schedule-isolated-test_2026!',displayName:'隔离日程验证'}));const [r1,r2]=setup.state.roles.map(r=>r.id),endpoint='/api/engine/schedule';
 // Emulate an old locally stored timezone. New invalid configuration must still be rejected.
 app.db.prepare("UPDATE app SET json=json_set(json, '$.settings.timezone', ?) WHERE id=1").run('Invalid/Zone');
 const legacyView=await ok(request(endpoint+'?roleId='+r1));
 assert.equal(legacyView.view.timezone,'UTC');
 assert.equal((await request('/api/engine/timezone',{timezone:'Invalid/Zone'})).status,400);
 const action=(roleId,action,fields={})=>ok(request(endpoint,{roleId,action,...fields}));
 const ai={...setup.state.settings.ai,sources:[...setup.state.settings.ai.sources,{id:'isolated',name:'隔离模拟服务',baseUrl:'http://127.0.0.1:'+mock.address().port+'/v1',key:'ISOLATED_SCHEDULE_KEY',builtin:false}],models:['primary','backup'].map(model=>({id:model,sourceId:'isolated',model,kind:'chat',capabilities:['text'],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{}})),assign:{...setup.state.settings.ai.assign,chat:'primary',chatFallbacks:['backup'],chatSelections:['primary','backup']}};
 await ok(request('/api/engine/models',{ai}));await action(r1,'saveSettings',{settings:{weatherEnabled:false,city:'',autoGenerate:false,surpriseProbability:0}});
 const global={boundary:'07:00',routineJitterMinutes:10,surpriseProbability:0,chatChangeEnabled:false,outfitNoRepeatDays:5,referenceHistoryDays:4};
 assert.equal((await request('/api/engine/modules',{id:'schedule',values:{boundary:'24:00'}})).status,400);
 assert.equal((await request('/api/engine/modules',{id:'schedule',values:{referenceHistoryDays:0}})).status,400);
 await ok(request('/api/engine/modules',{id:'schedule',values:global}));
 const settings=(await ok(request('/api/engine/config'))).settings.schedule;
 for(const [key,value] of Object.entries(global))assert.equal(settings[key],value);
 const profile=Object.fromEntries(D.PROFILE_FIELDS.map(k=>[k,'手写生活资料']));await action(r1,'saveProfile',{profile});
 const other=await ok(request(endpoint+'?roleId='+r2));assert.deepEqual(other.view.profile,{});
 const item=(await action(r1,'addWardrobe',{item:{description:'蓝色棉质外套与长裤',category:'外出',seasons:['秋','冬']}})).result;
 await action(r1,'updateWardrobe',{itemId:item.id,item:{description:'深蓝色棉质外套与长裤',category:'外出',seasons:['秋','冬']}});
 const promise=(await action(r1,'savePromise',{promise:{content:'做拉伸',date:'2026-12-01',time:'09:00',type:'do'}})).result;
 const updated=(await action(r1,'savePromise',{promise:{id:promise.id,content:'做拉伸',date:'2026-12-02',time:'10:00',type:'do'}})).result;assert.notEqual(updated.dueAt,promise.dueAt);
 await action(r1,'cancelPromise',{id:promise.id});const event=(await action(r1,'saveEvent',{event:{content:'学习计划',startDate:'2026-12-01',endDate:'2026-12-03'}})).result;await action(r1,'completeEvent',{id:event.id});
 const generated=await action(r1,'generate');assert.deepEqual(calls,['primary','backup']);assert.equal(generated.view.generation.status,'ready');assert.ok(generated.view.plan.originalSlots.length);assert.ok(generated.view.history.length);assert.equal(generated.view.promises[0].status,'cancelled');
 assert.deepEqual((await ok(request(endpoint+'?roleId='+r2))).view.wardrobe,[]);
 const before=structuredClone(generated.view.plan);failAll=true;const failed=await request(endpoint,{roleId:r1,action:'generate'});assert.equal(failed.status,502);const after=await ok(request(endpoint+'?roleId='+r1));assert.deepEqual(after.view.plan,before);assert.equal(after.view.generation.status,'failed');
 const stored=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);assert.equal(stored.settings.ai.sources.find(s=>s.id==='isolated').key,'ISOLATED_SCHEDULE_KEY');assert.equal(stored.messages.length,setup.state.messages.length);Schedule.validateRestore(stored);
 await app.close();await start();await ok(request('/api/login',{password:'Schedule-isolated-test_2026!'}));const restored=await ok(request(endpoint+'?roleId='+r1));assert.deepEqual(restored.view.plan,before);assert.deepEqual(restored.view.profile,profile);assert.equal(restored.view.events[0].status,'done');
});
