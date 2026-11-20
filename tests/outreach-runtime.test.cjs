'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Runtime=require('../lib/engine/runtime.cjs'),O=require('../lib/engine/modules/outreach.cjs'),Schedule=require('../lib/engine/modules/schedule.cjs');
const at=Date.parse('2026-11-17T10:00:00Z');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const limit=Date.now()+2500;while(!check()){if(Date.now()>limit)throw Error('isolated contact runtime timeout');await sleep(5);}}
function fixture(){let state=sampleState();state.messages=[];state.settings.timezone='UTC';const roleId=state.roles[0].id;state.roles[0].outreachEnabled=true;state.roles[0].lastActiveAt=at-120*60000;
 R.apply(state,'segments',{intervalMode:'random',minSeconds:.01,maxSeconds:.01});
 Schedule.saveForRole(state,roleId,{slots:[{start:'00:00',end:'08:00',activity:'夜间熟睡',restType:'night_sleep'},{start:'08:00',end:'23:59',activity:'自由阅读',phone:'free',restType:'none'}]},at);
 state.engine.data.outreach={records:{[roleId]:{day:'2026-11-17',count:0,photos:0,unanswered:0,firedKeys:[],nextDueAt:at-1}}};
 const getState=()=>structuredClone(state),mutate=fn=>{const copy=structuredClone(state),value=fn(copy);state=copy;return {value,state:getState()};};
 const config={id:'isolated',capabilities:['text'],maxContextTokens:128000},api={resolve:()=>config,call:async()=>({message:{content:'刚读完这章。挺有意思'},model:config,modelId:'isolated'})};
 const runtime=Runtime.create({getState,mutate,modelApi:api,now:()=>at,demoModel:true});
 const start=()=>O.jobs[0].run({getState,mutate,isBusy:runtime.isBusy,initiate:runtime.initiate,now:at});
 return {getState,mutate,roleId,api,config,runtime,start};
}
test('a proactive sticker leaves room for a genuine photo in the same turn and only that photo spends the quota',async t=>{
 const image='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4),Buffer.from('IHDR'),Buffer.alloc(8)]).toString('base64');
 for(const withPhoto of [false,true])await t.test(withPhoto?'sticker and photo':'sticker only',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());f.config.capabilities.push('tool_use');
  f.mutate(s=>{
   S.role(s,f.roleId).stickers=[{id:'s1',name:'笑',image}];
   s.stickerSemantics={[require('../lib/engine/stickers.cjs').key(image)]:{status:'ready',meaning:'微笑',tags:['笑'],usage:'开心',description:'抿嘴笑',visibleText:''}};
   (s.engine.data.actions??={}).roleMedia=[{id:'pic',roleId:f.roleId,image,createdAt:at}];
   s.settings.modules.outreach={dailyPhotoMax:1};
  });
  const requests=[['send_sticker',{id:'s1'}],...(withPhoto?[['send_image',{mediaId:'pic'}]]:[])];
  let i=0;f.api.call=async()=>{
   const item=requests[i++];return {model:f.config,modelId:'isolated',message:item?
    {role:'assistant',content:null,tool_calls:[{id:'call-'+i,type:'function',function:{name:item[0],arguments:JSON.stringify(item[1])}}]}:
    {role:'assistant',content:withPhoto?'给你看。':'[NO_ACTION]'}};
  };
  await f.start();await until(()=>!f.runtime.isBusy(f.roleId));
  const s=f.getState(),sent=s.messages.filter(m=>m.sender==='assistant'&&m.type==='image');
  assert.equal(sent.length,withPhoto?2:1);assert.equal(sent[0].meta.stickerId,'s1');
  if(!withPhoto)assert.equal(s.messages.filter(m=>m.sender==='assistant').length,1);
  assert.equal(O.view(s,f.roleId,at).count,1);assert.equal(O.remainingPhotos(s,f.roleId,at),withPhoto?0:1);
 });
});
test('the scheduled outreach job follows only the friend switch even with an old global off value',async()=>{
 const f=fixture();
 try{
  f.mutate(s=>{
   s.settings.modules.outreach={enabled:false};
   s.settings.modules.schedule={autoGenerate:false};
   s.roles=s.roles.filter(role=>role.id===f.roleId);
   s.roles[0].momentsAutoEnabled=false;
   O.saveRoleSettings(s,f.roleId,{enabled:false},at);
  });
  await f.runtime.tick();
  assert.equal(f.runtime.isBusy(f.roleId),false);
  assert.equal(f.getState().messages.length,0);
  f.mutate(s=>O.saveRoleSettings(s,f.roleId,{enabled:true},at));
  assert.ok(O.view(f.getState(),f.roleId,at).nextDueAt>at);
  await f.runtime.tick();assert.equal(O.view(f.getState(),f.roleId,at).count,0);
  f.mutate(s=>{s.engine.data.outreach.records[f.roleId].nextDueAt=at-1;});
  await f.runtime.tick();
  await until(()=>!f.runtime.isBusy(f.roleId));
  assert.equal(O.view(f.getState(),f.roleId,at).count,1);
  assert.equal(f.getState().settings.modules.outreach.enabled,false);
 }finally{await f.runtime.close();}
});
test('real runtime counts an intentional skip once without counting an unanswered contact',async()=>{for(const skip of [false,true]){const f=fixture();try{f.api.call=async()=>{assert.equal(O.view(f.getState(),f.roleId,at).count,0);return {message:{content:skip?'[NO_ACTION]':'刚读完这章。挺有意思'},model:f.config,modelId:'isolated'};};await f.start();await until(()=>!f.runtime.isBusy(f.roleId));const s=f.getState(),v=O.view(s,f.roleId,at);assert.equal(v.count,1);assert.equal(v.unanswered,skip?0:1);assert.equal(v.pending,null);assert.equal(s.messages.filter(m=>m.sender==='assistant').length,skip?0:2);}finally{await f.runtime.close();}}});
test('runtime invalidation during generation cancels delivery and releases quietly',async()=>{const f=fixture();try{f.api.call=async()=>{f.mutate(s=>{S.role(s,f.roleId).prompt='改变后的身份';});return {message:{content:'不应发出的旧身份消息'},model:f.config,modelId:'isolated'};};await f.start();await until(()=>!f.runtime.isBusy(f.roleId));const s=f.getState(),v=O.view(s,f.roleId,at);assert.equal(v.count,0);assert.equal(v.pending,null);assert.equal(s.messages.length,0);assert(!s.settings.backgroundStatus?.lastError);assert.equal(Object.values(s.engine.data.execution.runs)[0].status,'interrupted');}finally{await f.runtime.close();}});
test('manual cancellation releases reserved contact while model request is running',async()=>{const f=fixture();let started=false;try{f.api.call=async(s,req)=>{started=true;return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));};await f.start();await until(()=>started);f.runtime.cancel(f.roleId,{keepPending:true});await until(()=>!f.runtime.active);const v=O.view(f.getState(),f.roleId,at);assert.equal(v.count,0);assert.equal(v.pending,null);}finally{await f.runtime.close();}});
