'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../lib/engine/modules/life-moments.cjs'),S=require('../lib/state.cjs');
function setup(){const s=S.initial();s.roles=[{id:'r',name:'测试',prompt:'独立生活',permissions:{},stickers:[]}];s.moments=[];s.messages=[];require('../lib/engine/registry.cjs').defaults(s);const at=Date.now();const cur={day:'2026-11-17',version:'v1',phone:'free',currentSlot:{startAt:at-60000,endAt:at+3600000,activity:'散步',scene:'公园',restType:'none'},mood:'平静'};const ctx={getState:()=>s,mutate:fn=>({value:fn(s)}),roleId:'r',now:at,clock:()=>at,scheduleSnapshot:()=>cur,modelApi:{call:async()=>({message:JSON.stringify({skip:false,text:'出来走走。'})})}};return {s,ctx,cur};}
test('独立开关默认开启，保存关闭后不发布，并校验每日上限',async()=>{
 const {s,ctx}=setup();
 assert.deepEqual(M.view(s,'r').settings,{enabled:true,mode:'schedule',dailyMax:2,useChat:true,useMemory:true});
 assert.throws(()=>M.saveRoleSettings(s,'r',{dailyMax:-1}));
 M.saveRoleSettings(s,'r',{enabled:false});
 assert.equal((await M.runNow(ctx)).status,'disabled');
 assert.equal(M.view(s,'r').settings.enabled,false);
 assert.equal(s.moments.length,0);
});
test('一次机会只发布一次，聊天和记忆默认参考且可以分别关掉',async()=>{
 for(const [useChat,useMemory] of [[true,true],[true,false],[false,true],[false,false]]){
  const {s,ctx}=setup();
  S.message(s,s.roles[0],'user','CHAT_MARKER','text');
  s.memories=[{id:'sample',roleId:'r',content:'MEMORY_MARKER'}];
  if(!useChat||!useMemory)M.saveRoleSettings(s,'r',{useChat,useMemory});
  ctx.modelApi.call=async(_s,req)=>{
   const text=JSON.stringify(req.messages);
   assert.equal(text.includes('CHAT_MARKER'),useChat);
   assert.equal(text.includes('MEMORY_MARKER'),useMemory);
   return {message:'{"skip":false,"text":"出来走走。"}'};
  };
  assert.equal((await M.runNow(ctx)).status,'published');
  await M.runNow(ctx);
  assert.equal(s.moments.length,1);
  assert.equal(Object.values(s.engine.data.lifeMoments.records.r)[0].momentId,s.moments[0].id);
 }
});
test('模型可跳过，日程版本变更阻止发布',async()=>{const a=setup();a.ctx.modelApi.call=async()=>({message:'{"skip":true}'});assert.equal((await M.runNow(a.ctx)).status,'skipped');assert.equal(a.s.moments.length,0);const b=setup();b.ctx.modelApi.call=async()=>{b.cur.version='v2';return {message:'{"skip":false,"text":"散步"}'};};await assert.rejects(M.runNow(b.ctx),/失效/);assert.equal(b.s.moments.length,0);});
test('生成图缓存，识图失败恢复不重复生图，失败最多三次',async()=>{const {s,ctx}=setup();let photo=0,calls=0;ctx.generateRolePhoto=async()=>{photo++;return [{image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='}];};ctx.modelApi.call=async()=>{calls++;if(calls===1)return {message:'{"skip":false,"text":"散步","imagePrompt":"公园树木"}'};if(calls===2)throw Error('识图失败');return {message:'{"skip":false,"text":"树荫下走走。"}'};};await assert.rejects(M.runNow(ctx),/识图失败/);ctx.now+=300001;ctx.clock=()=>ctx.now;assert.equal((await M.runNow(ctx)).status,'published');assert.equal(photo,1);assert.equal(s.moments.length,1);const saved=s.engine.data.selfie.photos.r[0];assert.equal(require('../lib/engine/modules/selfie.cjs').selectPhoto(s,'r',{sourcePhotoId:saved.id}).image,s.moments[0].image);assert.equal(s.messages.length,0);const b=setup();b.ctx.modelApi.call=async()=>{throw Error('失败');};for(let i=0;i<3;i++){b.ctx.now+=300001;await assert.rejects(M.runNow(b.ctx));}assert.equal((await M.runNow({...b.ctx,now:b.ctx.now+300001})).status,'failed');assert.equal(Object.values(b.s.engine.data.lifeMoments.records.r)[0].attempts,3);});
test('发布前好友权限变更阻止发出',async()=>{const {s,ctx}=setup();ctx.modelApi.call=async()=>{s.roles[0].permissions.onlyChat=true;return {message:'{"skip":false,"text":"散步"}'};};await assert.rejects(M.runNow(ctx),/仅聊天/);assert.equal(s.moments.length,0);});
test('禁用生图时只发表文字，隐藏好友动态时不调用模型',async()=>{
 const a=setup();a.s.settings.modules.actions={allowImages:false};
 a.ctx.modelApi.call=async()=>({message:'{"skip":false,"text":"散步","imagePrompt":"树木"}'});
 let images=0;a.ctx.generateRolePhoto=async()=>{images++;return [];};
 assert.equal((await M.runNow(a.ctx)).status,'published');
 assert.equal(images,0);
 assert.deepEqual(a.s.moments.map(m=>[m.content,m.images]),[['散步',[]]]);
 const b=setup();b.s.roles[0].permissions.hideTheirMoments=true;
 b.ctx.modelApi.call=async()=>assert.fail('不应调用模型');
 await assert.rejects(M.runNow(b.ctx),/不可发布/);
});
test('用户评论按ID去重，每空闲段最多两次自主回应',async()=>{const {s,ctx}=setup();s.moments=[{id:'m',authorId:'r',content:'散步',visibility:'all',createdAt:ctx.now,images:[],likes:[],comments:[1,2,3].map(i=>({id:'c'+i,authorId:'me',content:'真好'+i}))}];ctx.modelApi.call=async()=>({message:'{"skip":false,"text":"嗯，今天很舒服。"}'});await M.respondComments(ctx);await M.respondComments(ctx);await M.respondComments(ctx);assert.equal(s.moments[0].comments.filter(x=>x.authorId==='r').length,2);assert.equal(Object.keys(s.engine.data.lifeMoments.comments.r).length,2);});

test('绑定人设用于分享和评论，人设切换与私聊选材关闭取消旧机会',async()=>{const a=setup();a.s.rolePersonas=[{id:'persona',prompt:'BOUND_PERSONA'}];a.s.roles[0].rolePersonaId='persona';a.s.roles[0].prompt='OBSOLETE_PERSONA';a.ctx.modelApi.call=async(_s,req)=>{const text=JSON.stringify(req.messages);assert.ok(text.includes('BOUND_PERSONA'));assert.ok(!text.includes('OBSOLETE_PERSONA'));assert.equal(req.purpose,'chat');return {message:'{"skip":false,"text":"散步。"}'};};await M.runNow(a.ctx);a.s.moments[0].comments.push({id:'c',authorId:'me',content:'好天气'});await M.respondComments(a.ctx);assert.equal(a.s.moments[0].comments.length,2);const b=setup();b.ctx.modelApi.call=async()=>{b.s.roles[0].prompt='新的人设';return {message:'{"skip":false,"text":"散步。"}'};};await assert.rejects(M.runNow(b.ctx),/失效/);const c=setup();M.saveRoleSettings(c.s,'r',{useChat:true});c.ctx.modelApi.call=async()=>{M.saveRoleSettings(c.s,'r',{useChat:false});return {message:'{"skip":false,"text":"散步。"}'};};await assert.rejects(M.runNow(c.ctx),/失效/);});
test('分享及评论实际走全局主模型及fallback，忽略好友旧modelId',async t=>{const http=require('node:http'),Models=require('../lib/engine/models.cjs'),{s,ctx}=setup(),requests=[];const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push(body.model);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:body.model==='main'?'invalid JSON':'{"skip":false,"text":"天气不错。"}'}}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));Models.migrate(s);Models.save(s,{sources:[...Models.sanitize(s.settings.ai).sources,{id:'isolated',name:'隔离',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',key:'ISOLATED_TEST_ONLY',builtin:false}],models:['main','backup'].map(id=>({id,sourceId:'isolated',model:id,kind:'chat',capabilities:['text'],maxContextTokens:32000,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{}})),assign:{chat:'main',chatFallbacks:['backup']}});s.roles[0].modelId='OBSOLETE_MODEL';delete ctx.modelApi;const usages=[];ctx.onUsage=u=>usages.push(u);assert.equal((await M.runNow(ctx)).status,'published');s.moments[0].comments.push({id:'comment',authorId:'me',content:'看起来真好'});await M.respondComments(ctx);assert.deepEqual(requests,['main','backup','main','backup']);assert.equal(s.moments[0].comments.length,2);assert.equal(usages.length,4);});
