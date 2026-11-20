// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const Panel=require('../lib/engine/life-panel.cjs'),S=require('../lib/state.cjs'),Photo=require('../lib/engine/modules/selfie.cjs');
function setup(){let state=sampleState();state.messages=[];return {roleId:state.roles[0].id,preview:true,getState:()=>state,mutate:fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state,value};},runtime:{onUsage:()=>{}}};}

test('role panel uses the friend switch and reports the outreach source and current schedule',()=>{
 const ctx=setup(),s=ctx.getState(),id=ctx.roleId;
 s.settings.modules.outreach={mode:'schedule',enabled:false,quietStart:'23:00',quietEnd:'08:00'};
 s.roles[0].outreachEnabled=true;
 const {interaction,interactionFields}=Panel.view(s,id);
 assert.equal(interaction.inheritedMode,true);
 assert.equal(interaction.defaultMode,'schedule');
 assert.equal(interaction.settings.enabled,true);
 assert.equal(interaction.hasCurrentSchedule,false);
 assert.equal(interactionFields.some(field=>field.key.startsWith('quiet')),false);
});
test('standalone draft keeps completed images when a later image fails, without sending chat',async t=>{
 const ctx=setup(),original=Photo.generateRolePhoto;t.after(()=>{Photo.generateRolePhoto=original;});
 Photo.generateRolePhoto=async(_s,_r,opts)=>{await opts.onPhoto({id:'isolated-photo',image:'local-fixture',createdAt:1,prompt:'模拟'});throw Error('第二张失败');};
 await assert.rejects(Panel.act({roleId:ctx.roleId,action:'generatePhoto',prompt:'模拟',count:2},ctx),/第二张失败/);
 const view=Panel.view(ctx.getState(),ctx.roleId,{preview:true});assert.equal(view.photos.length,1);assert.equal(view.messages.length,0);
 assert.equal(Panel.view(ctx.getState(),ctx.getState().roles[1].id,{preview:true}).photos.length,0);
});

test('moments preserves old mode fields, saved references and nonnegative limits',()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),ctx=setup(),s=ctx.getState(),id=ctx.roleId;
 assert.deepEqual(M.view(s,id).settings,{enabled:true,mode:'schedule',dailyMax:2,useChat:true,useMemory:true});
 M.saveRoleSettings(s,id,{enabled:false});assert.equal(M.view(s,id).settings.enabled,false);
 s.engine.data.lifeMoments={roles:{[id]:{enabled:true,dailyMax:1,useChat:false,useMemory:false}}};
 assert.deepEqual(M.view(s,id).settings,{enabled:true,mode:'schedule',dailyMax:1,useChat:false,useMemory:false});
 M.saveRoleSettings(s,id,{mode:'custom',dailyMax:20,useChat:true});M.saveRoleSettings(s,id,{mode:'schedule'});
 assert.deepEqual(M.view(s,id).settings,{enabled:true,mode:'schedule',dailyMax:20,useChat:true,useMemory:false});
 for(const dailyMax of [-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>M.saveRoleSettings(s,id,{dailyMax}));
 assert.throws(()=>M.saveRoleSettings(s,id,{mode:'invalid'}));assert.throws(()=>M.saveRoleSettings(s,id,{useMemory:'true'}));
 assert.equal(M.saveRoleSettings(s,id,{dailyMax:0}).dailyMax,0);
});

test('moments always uses saved cap and references regardless of legacy mode',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),at=Date.parse('2026-11-17T10:00:00Z');
 for(const mode of ['schedule','custom'])for(const useReferences of [false,true])for(const alreadyPosted of [0,2,5]){
  const ctx=setup(),id=ctx.roleId;ctx.mutate(s=>{s.settings.timezone='UTC';s.moments=Array.from({length:alreadyPosted},(_,i)=>({id:'existing-'+i,authorId:id,createdAt:at,visibility:'all',comments:[]}));s.messages=[{id:'chat',roleId:id,sender:'user',type:'text',content:'private context'}];s.memories=[{id:'fact',roleId:id,content:'公开日常分享 memory context',createdAt:at}];M.saveRoleSettings(s,id,{enabled:true,mode,dailyMax:5,useChat:useReferences,useMemory:useReferences});});
  let calls=0;const result=await M.runNow({...ctx,now:at,clock:()=>at,scheduleSnapshot:()=>({day:'2026-11-17',version:'fixed',phone:'free',mood:'平静',currentSlot:{activity:'看花',scene:'公园',restType:'none',endAt:at+60000}}),modelApi:{call:async(_s,request)=>{calls++;const optional=JSON.parse(request.messages[1].content).optional;if(!useReferences)assert.deepEqual(optional,{});else{assert.equal(optional.chat[0].text,'private context');assert(optional.memory.some(x=>x.includes('memory context')));}return {message:{content:JSON.stringify({skip:false,text:'花开了'})}};}},executeAction:async(_name,args,options)=>options.mutate(s=>{s.moments.push({id:'new',authorId:id,content:args.text,createdAt:at,visibility:'all',comments:[]});return {momentId:'new'};}).value});
  assert.equal(result.status,alreadyPosted===5?'daily-limit':'published');assert.equal(calls,alreadyPosted===5?0:1);
 }
});

test('changing moments parameters during generation cancels stale publication',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),ctx=setup(),at=Date.parse('2026-11-17T10:00:00Z');
 ctx.mutate(s=>{s.moments=[];M.saveRoleSettings(s,ctx.roleId,{enabled:true});});let published=false;
 await assert.rejects(M.runNow({...ctx,now:at,clock:()=>at,scheduleSnapshot:()=>({day:'2026-11-17',version:'fixed',phone:'free',currentSlot:{activity:'看花',restType:'none',endAt:at+60000}}),modelApi:{call:async()=>{ctx.mutate(s=>M.saveRoleSettings(s,ctx.roleId,{useChat:false}));return {message:{content:JSON.stringify({skip:false,text:'花开了'})}};}},executeAction:async()=>{published=true;}}),{code:'MOMENT_STALE'});
 assert.equal(published,false);assert.equal(ctx.getState().moments.length,0);
});

test('private references are omitted and a failed friend does not stop the Moments queue',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),ctx=setup(),at=Date.parse('2026-11-17T10:00:00Z');
 const [first,second]=ctx.getState().roles.map(role=>role.id);
 ctx.mutate(s=>{
  s.moments=[];s.settings.timezone='UTC';s.settings.ai.assign.chat='isolated-mock';
  s.messages=[
   {id:'private-input',roleId:second,sender:'user',type:'text',content:'验证码是 123456'},
   {id:'public-input',roleId:second,sender:'user',type:'text',content:'楼下的花开了'},
  ];
  s.memories=[{id:'secret',roleId:second,content:'公开日常分享 家庭住址',createdAt:at},{id:'ordinary',roleId:second,content:'公开日常分享 公园散步',createdAt:at}];
 });
 const visited=[];
 await assert.rejects(M.jobs[0].run({...ctx,now:at,clock:()=>at,scheduleSnapshot:()=>({day:'2026-11-17',version:'fixed',phone:'free',currentSlot:{activity:'看花',restType:'none',endAt:at+60000}}),
  modelApi:{call:async(_s,request)=>{
   visited.push(request.role.id);if(request.role.id===first)throw new Error('第一位好友的模型请求失败');
   const {optional}=JSON.parse(request.messages[1].content);assert.deepEqual(optional.chat,[{speaker:'user',text:'楼下的花开了'}]);assert.deepEqual(optional.memory,['公开日常分享 公园散步']);
   return {message:{content:JSON.stringify({skip:false,text:'花开了'})}};
  }},executeAction:async(_name,args,options)=>options.mutate(s=>{s.moments.push({id:'next',authorId:options.roleId,content:args.text,createdAt:at,visibility:'all',comments:[]});return {momentId:'next'};}).value}),/第一位好友的模型请求失败/);
 assert.deepEqual(visited,[first,second]);
 assert.equal(ctx.getState().moments[0].authorId,second);
 assert.equal(Object.values(ctx.getState().engine.data.lifeMoments.records[first])[0].status,'failed');
});

test('ordinary and preview friends share one moments scheduler with global and friend controls',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),R=require('../lib/engine/registry.cjs'),at=Date.parse('2026-11-17T10:00:00Z');
 for(const [preview,enabled,hasModel,globalEnabled,expected]of [[true,undefined,true,true,1],[true,undefined,false,true,0],[true,false,true,true,0],[false,undefined,true,true,1],[false,true,true,true,1],[false,true,true,false,0]]){
  const base=setup(),id=base.roleId;base.mutate(s=>{s.roles=[s.roles[0]];s.moments=[];s.settings.timezone='UTC';s.settings.ai.assign.chat=hasModel?'isolated-mock':'';s.settings.modules.actions={allowMoments:globalEnabled};if(enabled!==undefined)M.saveRoleSettings(s,id,{enabled});});
  const getState=()=>{const s=base.getState();if(preview)Object.defineProperty(s,Symbol.for('pipi.lifePreview'),{value:true,configurable:true});return s;};
  assert.equal(R.isEnabled(getState(),'life-moments'),true);assert.equal(M.ownsRole(getState(),id),true);
  let calls=0;const ctx={...base,getState,now:at,clock:()=>at,isBusy:()=>false,scheduleSnapshot:()=>({day:'2026-11-17',version:'fixed',phone:'free',currentSlot:{activity:'看花',restType:'none',endAt:at+60000}}),modelApi:{call:async()=>{calls++;return {message:{content:JSON.stringify({skip:false,text:'花开了'})}};}},executeAction:async(_name,args,options)=>options.mutate(s=>{s.moments.push({id:'new',authorId:id,content:args.text,createdAt:at,visibility:'all',comments:[]});return {momentId:'new'};}).value};
  await M.jobs[0].run(ctx);await M.jobs[0].run(ctx);
  assert.equal(calls,expected);assert.equal(getState().moments.length,expected);if(!expected)assert.equal(Object.keys(getState().engine.data.lifeMoments.records||{}).length,0);
 }
});

test('old global random posting no longer runs and saved friend selections take precedence',()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),Scheduler=require('../lib/engine/modules/scheduler.cjs'),ctx=setup();
 assert.deepEqual(Scheduler.jobs.map(job=>job.id),['reminders']);
 ctx.mutate(s=>{s.roles[0].momentsAutoEnabled=false;});
 assert.equal(M.view(ctx.getState(),ctx.roleId).settings.enabled,false);
 ctx.mutate(s=>M.saveRoleSettings(s,ctx.roleId,{enabled:true}));
 assert.equal(M.view(ctx.getState(),ctx.roleId).settings.enabled,true);
});
test('revoking image permission during generation prevents draft storage',async t=>{
 const ctx=setup(),original=Photo.generateRolePhoto;t.after(()=>{Photo.generateRolePhoto=original;});
 Photo.generateRolePhoto=async(_s,_r,opts)=>{ctx.mutate(s=>{s.settings.modules.actions={allowImages:false};});await opts.onPhoto({id:'stale',image:'local-fixture'});};
 await assert.rejects(Panel.act({roleId:ctx.roleId,action:'generatePhoto',prompt:'模拟'},ctx),/关闭图片/);
 assert.equal(Panel.view(ctx.getState(),ctx.roleId,{preview:true}).photos.length,0);
});

test('朋友圈关闭配图仍发文字，生成、写文案和正式发布中途关闭也不写入相册',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),R=require('../lib/engine/registry.cjs'),A=require('../lib/engine/actions.cjs');
 const at=Date.parse('2026-11-17T10:00:00Z'),image='data:image/png;base64,aW1hZ2U=';
 for(const [stage,setting] of [['allowed',''],['before','autoMomentsPhoto'],['before','enabled'],['before','allowImages'],['photo','autoMomentsPhoto'],['caption','enabled'],['publish','allowImages']]){
  const ctx=setup(),id=ctx.roleId;ctx.mutate(s=>{s.moments=[];});
  const disable=()=>ctx.mutate(s=>R.apply(s,setting==='allowImages'?'actions':'selfie',{[setting]:false}));
  if(stage==='before')disable();
  let photos=0,captions=0;
  const options={...ctx,now:at,clock:()=>at,scheduleSnapshot:()=>({day:'2026-11-17',version:'one',phone:'free',currentSlot:{startAt:at-60000,endAt:at+600000,activity:'散步',restType:'none'}}),
   generateRolePhoto:async()=>{photos++;if(stage==='photo')disable();return [{id:'shot',image,prompt:'完整拍摄提示',createdAt:at+777}];},
   modelApi:{call:async(_s,q)=>{
    if(q.purpose==='caption'){captions++;if(stage==='caption')disable();}
    return {message:{content:JSON.stringify(q.purpose==='caption'?{skip:false,text:'图片文案'}:{skip:false,text:'文字发圈',imagePrompt:'拍一朵花'})}};
   }},
   executeAction:(name,args,c)=>{if(stage==='publish'&&args.images.length)disable();return A.execute(name,args,c);}
  };
  await M.runNow(options);await M.runNow(options);
  const s=ctx.getState(),withPhoto=stage==='allowed';
  assert.equal(photos,stage==='before'?0:1);assert.equal(captions,['allowed','caption','publish'].includes(stage)?1:0);
  assert.equal(s.moments.length,1);assert.equal(s.moments[0].content,withPhoto?'图片文案':'文字发圈');
  assert.deepEqual(s.moments[0].images,withPhoto?[image]:[]);assert.equal(Panel.album(s,id).total,withPhoto?1:0);
  assert.equal(s.engine.data.actions.roleMedia?.length||0,withPhoto?1:0);
  assert.equal(Object.values(s.engine.data.lifeMoments.records[id])[0].pendingPhoto,undefined);
 }
});
test('朋友圈写文案失败重试，只生图一次；旧双记录用拍摄身份去重，相同图片可独立拍摄',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),ctx=setup(),id=ctx.roleId,at=Date.parse('2026-11-17T10:00:00Z'),image='data:image/png;base64,aW1hZ2U=';
 let clock=at,photos=0,captions=0;
 ctx.mutate(s=>{s.moments=[];});
 const options={...ctx,clock:()=>clock,scheduleSnapshot:()=>({day:'2026-11-17',version:'one',phone:'free',currentSlot:{startAt:at,endAt:at+3600000,activity:'散步',restType:'none'}}),
  generateRolePhoto:async()=>{photos++;return [{id:'shot',image,prompt:'拍摄细节',createdAt:at+655}];},
  modelApi:{call:async(_s,q)=>{if(q.purpose==='caption'&&++captions===1)throw Error('识图暂时失败');return {message:{content:JSON.stringify({skip:false,text:'散步',imagePrompt:'公园'})}};}}
 };
 await assert.rejects(M.runNow({...options,now:clock}),/识图暂时失败/);
 assert.equal(Panel.album(ctx.getState(),id).total,0);
 clock+=300000;await M.runNow({...options,now:clock});assert.equal(photos,1);assert.equal(captions,2);
 ctx.mutate(s=>{
  const media=s.engine.data.actions.roleMedia[0];delete media.photoId;media.createdAt=at;media.prompt='旧图关键词';
  s.engine.data.actions.roleMedia.push({id:'independent',roleId:id,image,prompt:'拍摄细节',createdAt:at+655});
 });
 assert.equal(Panel.album(ctx.getState(),id).total,2);
 ctx.mutate(s=>{s.engine.data.selfie.photos[id]=[];});
 assert.equal(Panel.album(ctx.getState(),id).total,2);
});

test('发圈起草、生图、配文和发布期间撤销引用的记忆，后续模型不收到旧内容，草稿和图片被丢弃',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),R=require('../lib/engine/registry.cjs'),A=require('../lib/engine/actions.cjs'),Mem=require('../lib/engine/memory-store.cjs');
 const at=Date.parse('2026-11-17T10:00:00Z'),secret='微光绿豆花',image='data:image/png;base64,aW1hZ2U=';
 for(const change of ['archive','disable'])for(const stop of ['起草','生图','配文','发布','重试']){
  const ctx=setup(),id=ctx.roleId,called=[];let clock=at;
  ctx.mutate(s=>{s.moments=[];s.memories=[{id:'used',roleId:id,content:'公开日常分享 '+secret,createdAt:at}];});
  const revoke=()=>ctx.mutate(s=>change==='archive'?Mem.setCardStatus(null,s,id,'used',{status:'archived'}):R.apply(s,'memory',{enabled:false}));
  const options={...ctx,clock:()=>clock,scheduleSnapshot:()=>({day:'one',version:'one',phone:'free',currentSlot:{startAt:at,endAt:at+3600000,activity:'散步',restType:'none'}}),
   modelApi:{call:async(_s,q)=>{
    const point=q.purpose==='chat'?'起草':'配文';called.push(point);
    assert.ok(JSON.stringify(q.messages).includes(secret));q.beforeRequest();
    if(stop===point){revoke();assert.throws(q.beforeRequest,{code:'MOMENT_MEMORY_CHANGED'});}
    if(stop==='重试'&&point==='配文')throw Error('模型暂不可用');
    return {message:{content:JSON.stringify({skip:false,text:secret,imagePrompt:secret})}};
   }},
   generateRolePhoto:async(_s,_r,q)=>{called.push('生图');q.beforeRequest();if(stop==='生图'){revoke();assert.throws(q.beforeRequest,{code:'MOMENT_MEMORY_CHANGED'});}return [{id:'generated',image,prompt:secret,createdAt:at+1}];},
   executeAction:(name,args,c)=>{if(stop==='发布')revoke();return A.execute(name,args,c);}
  };
  if(stop==='重试'){
   await assert.rejects(M.runNow({...options,now:clock}),/模型暂不可用/);
   const draft=Object.values(ctx.getState().engine.data.lifeMoments.records[id])[0];
   assert.ok(draft.pendingPhoto);assert.ok(!JSON.stringify(draft.memoryStamp).includes(secret));
   revoke();clock+=300000;
  }
  assert.equal((await M.runNow({...options,now:clock})).status,'cancelled',change+stop);
  assert.deepEqual(called,['起草','生图','配文'].slice(0,stop==='起草'?1:stop==='生图'?2:3));
  const s=ctx.getState(),draft=Object.values(s.engine.data.lifeMoments.records[id])[0];
  assert.ok(!JSON.stringify(draft).includes(secret));assert.ok(!draft.image);assert.equal(Panel.album(s,id).total,0);assert.equal(s.moments.length,0);
 }
});

test('旧未完成发圈草稿无法核实记忆时取消；禁用参考记忆的草稿和未引用的卡片不影响发圈',async()=>{
 const M=require('../lib/engine/modules/life-moments.cjs'),MStore=require('../lib/engine/memory-store.cjs');
 const at=Date.parse('2026-11-17T10:00:00Z'),image='data:image/png;base64,aW1hZ2U=';
 for(const mode of ['legacy-memory','legacy-no-memory','new-unused']){
  const ctx=setup(),id=ctx.roleId;let clock=at,captions=0;
  ctx.mutate(s=>{s.moments=[];s.memories=[{id:'public',roleId:id,content:'早起看花',createdAt:at},{id:'private',roleId:id,content:'验证码是保密的',createdAt:at}];M.saveRoleSettings(s,id,{useMemory:mode!=='legacy-no-memory'});});
  const options={...ctx,clock:()=>clock,scheduleSnapshot:()=>({day:'one',version:'one',phone:'free',currentSlot:{startAt:at,endAt:at+3600000,activity:'散步',restType:'none'}}),
   modelApi:{call:async(_s,q)=>{if(q.purpose==='caption'&&++captions===1)throw Error('暂时失败');return {message:{content:JSON.stringify({skip:false,text:'花开了',imagePrompt:'春天'})}};}},
   generateRolePhoto:async()=>[{id:'shot',image,prompt:'春天',createdAt:at}]
  };
  await assert.rejects(M.runNow({...options,now:clock}),/暂时失败/);
  ctx.mutate(s=>{
   const draft=Object.values(s.engine.data.lifeMoments.records[id])[0];
   if(mode.startsWith('legacy'))delete draft.memoryStamp;
   else MStore.setCardStatus(null,s,id,'private',{status:'archived'});
   if(mode==='legacy-memory'){
    draft.mediaId='old-media';delete draft.pendingPhoto;
    s.engine.data.selfie.photos={[id]:[{id:'shot',image,prompt:'旧相册已有照片',createdAt:at+1,source:'life-moments'}]};
    s.engine.data.actions.roleMedia=[{id:'old-media',image,roleId:id,prompt:'春天',createdAt:at}];
   }
  });
  clock+=300000;const expected=mode==='legacy-memory'?'cancelled':'published';
  assert.equal((await M.runNow({...options,now:clock})).status,expected);assert.equal(captions,expected==='published'?2:1);
  assert.equal(Panel.album(ctx.getState(),id).total,1);assert.equal(ctx.getState().engine.data.selfie.photos[id][0].id,'shot');
 }
});

test('ordinary startup serves the requested role and a limited moments page, and protects preview actions',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createApp}=require('../scripts/sample-data.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-life-formal-'));
 const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,providerUrlAllowlist:[]});
 t.after(async()=>{
  await app.close();
  if(path.dirname(dir)===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('pipi-life-formal-'))fs.rmSync(dir,{recursive:true,force:true});
 });
 await app.listen();
 const base='http://127.0.0.1:'+app.server.address().port;
 let cookie,csrf;
 async function request(url,body){
  const response=await fetch(base+url,{method:body===undefined?'GET':'POST',
   headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf||''})},
   body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  if(result.csrfToken)csrf=result.csrfToken;
  return {status:response.status,result};
 }
 const endpoint='/api/engine/life';
 assert.equal((await request(endpoint+'?roleId=missing')).status,401);
 const {result:logged}=await request('/api/setup',{password:'Life-formal-local-test_2026!'});
 const [first,second]=logged.state.roles;
 const state=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
 const post=(id,roleId,createdAt)=>({id,authorId:roleId,visibility:'all',content:id,createdAt,images:[],likes:[],comments:[]});
 const newest=Date.parse('2026-11-17T12:00:00Z'),older=Date.parse('2026-10-17T12:00:00Z');
 state.settings.timezone='Asia/Shanghai';
 state.moments=Array.from({length:100},(_,i)=>post('first-'+i,first.id,newest+i*60000));
 state.moments.push(post('old',first.id,older),post('second',second.id,newest));
 app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));

 const {status,result:panel}=await request(endpoint+'?roleId='+encodeURIComponent(second.id));
 assert.equal(status,200);
 assert.equal(panel.role.id,second.id);
 assert.equal(panel.isolated,false);
 assert.equal('feed' in panel,false);
 assert.equal('messages' in panel,false);
 assert.equal('photos' in panel,false);
 assert.equal((await request(endpoint+'?roleId=missing')).status,404);
 assert.equal((await request(endpoint+'/album?roleId='+encodeURIComponent(second.id))).status,200);
 assert.equal((await request(endpoint+'/moments?roleId='+encodeURIComponent(first.id)+'&month=2026-13')).status,400);
 const {result:page}=await request(endpoint+'/moments?roleId='+encodeURIComponent(first.id)+'&page=2');
 assert.deepEqual(page.items.map(({post,dayCount})=>[post.id,dayCount]),[['first-95',100],['first-94',100],['first-93',100],['first-92',100]]);
 assert.deepEqual(page.months,[{month:'2026-10',count:1},{month:'2026-11',count:100}]);
 assert.deepEqual([page.total,page.page,page.pages],[100,2,25]);
 const {result:oct}=await request(endpoint+'/moments?roleId='+encodeURIComponent(first.id)+'&month=2026-10');
 assert.deepEqual(oct.items.map(({post})=>post.id),['old']);
 const {result:other}=await request(endpoint+'/moments?roleId='+encodeURIComponent(second.id));
 assert.deepEqual(other.items.map(({post})=>post.id),['second']);

 assert.equal((await request(endpoint,{roleId:first.id,action:'evaluateContact'})).status,404);
 assert.equal((await request(endpoint,{roleId:first.id,action:'generatePhoto',prompt:'测试'})).status,404);
 const saved=await request(endpoint,{roleId:first.id,action:'saveMoments',values:{enabled:false,dailyMax:1}});
 assert.equal(saved.status,200);
 assert.equal('state' in saved.result,false);
 assert.equal((await request(endpoint+'?roleId='+encodeURIComponent(first.id))).result.moments.settings.enabled,false);
 assert.equal((await request(endpoint+'?roleId='+encodeURIComponent(second.id))).result.moments.settings.enabled,true);
 const invalid=await request(endpoint,{roleId:first.id,action:'saveConfiguration',sections:{basic:{name:'不应保存'},schedule:{city:'临时城市'},moments:{dailyMax:-1}}});
 assert.equal(invalid.status,400);
 assert.equal((await request(endpoint+'?roleId='+first.id)).result.role.name,first.name);
 assert.equal((await request(endpoint+'?roleId='+first.id)).result.schedule.city,first.city||'');
 const updated=await request(endpoint,{roleId:first.id,action:'saveConfiguration',sections:{basic:{name:'新昵称'},schedule:{city:'虚构城',weatherEnabled:false},interaction:{mode:'custom'},moments:{dailyMax:3}}});
 assert.equal(updated.status,200,JSON.stringify(updated.result));
 assert.equal(updated.result.view.role.name,'新昵称');
 assert.equal(updated.result.state.roles.find(r=>r.id===first.id).city,'虚构城');
 const reread=(await request(endpoint+'?roleId='+first.id)).result;
 assert.equal(reread.schedule.settings.weatherEnabled,false);assert.equal(reread.interaction.settings.mode,'custom');assert.equal(reread.moments.settings.dailyMax,3);
 const permission=await request('/api/action',{type:'role.save',payload:{id:first.id,permissions:{hideTheirMoments:true}}});
 assert.equal(permission.status,200);
 const {result:hidden}=await request(endpoint+'/moments?roleId='+encodeURIComponent(first.id));
 assert.equal(hidden.restricted,true);
 assert.deepEqual(hidden.items,[]);
});
