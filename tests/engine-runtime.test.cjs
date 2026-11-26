// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),J=require('../lib/engine/scheduler.cjs'),A=require('../lib/engine/actions.cjs'),Runtime=require('../lib/engine/runtime.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=2500){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw new Error('isolated runtime condition timeout');await sleep(5);}}
function fixture({capabilities=['text'],clock=Date.now(),idleSeconds=.02}={}){
  let state=sampleState(),at=clock;state.messages=[];state.settings.timezone='UTC';state.settings.ai.sources.push({id:'isolated',name:'隔离假模型',baseUrl:'http://isolated.invalid',key:'never-sent',builtin:false});state.settings.ai.models.push({id:'isolated',sourceId:'isolated',model:'isolated',kind:'chat',capabilities,maxContextTokens:128000});state.settings.ai.assign.chat='isolated';
  R.apply(state,'waiting',{idleSeconds,maxWaitSeconds:1});R.apply(state,'segments',{intervalMode:'random',minSeconds:.02,maxSeconds:.02});const roleId=state.roles[0].id,events=[],requests=[];
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state:getState(),value};};
  const config={id:'isolated',capabilities,maxContextTokens:128000},api={resolve:()=>config,call:async(s,req)=>{requests.push(req);return {message:{content:'模拟回复'},model:config,modelId:'isolated'};}};
  const runtime=Runtime.create({getState,mutate,publish:(event,payload)=>events.push({event,...payload}),modelApi:api,now:()=>at});
  const send=text=>{const message=mutate(s=>S.message(s,S.role(s,roleId),'user',text,'text',{status:'pending',createdAt:at})).value;runtime.enqueue(roleId,message.id);return message;};
  return {runtime,api,config,getState,mutate,roleId,requests,events,send,state:()=>state,setClock:value=>{at=value;},clock:()=>at};
}
test('服务重启后换绑，重试会丢弃旧人设的待发分段和语音',async()=>{
  const f=fixture();
  try{
    const message=f.mutate(s=>{
      const friend=S.role(s,f.roleId),m=S.message(s,friend,'user','继续回复','text',{status:'error'});
      const e=require('../lib/engine/execution.cjs');
      const run=e.start(s,{id:'old-run',roleId:friend.id});
      Object.assign(run,{status:'interrupted',targetId:m.id,answer:'旧人设答案',segments:['旧人设答案'],resumeDelivery:true,pendingActionMessages:[{id:'old-voice',roleId:friend.id,sender:'assistant',type:'voice',content:'旧人设的语音'}]});
      S.apply(s,'rolePersona.save',{name:'新角色',prompt:'只按新的身份回答'});
      S.apply(s,'rolePersona.bind',{id:s.rolePersonas.at(-1).id,changes:[{roleId:friend.id,expectedPersonaId:friend.rolePersonaId,selected:true}]});
      m.status='pending';return m;
    }).value;
    f.runtime.enqueue(f.roleId,message.id);
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.match(JSON.stringify(f.requests[0].messages),/只按新的身份回答/);
    assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['模拟回复']);
  }finally{await f.runtime.close();}
});
test('连发三条只生成一轮，三条消息都送给角色且正在输入恢复',async()=>{
  const f=fixture();try{f.send('第一条');f.send('第二条');f.send('第三条');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);const request=JSON.stringify(f.requests[0].messages);for(const text of ['第一条','第二条','第三条'])assert.ok(request.includes(text));assert.equal(f.state().messages.filter(m=>m.sender==='assistant').length,1);assert.ok(f.state().messages.filter(m=>m.sender==='user').every(m=>m.status==='sent'));assert.ok(f.events.some(e=>e.event==='typing'&&e.typing));assert.equal(f.events.at(-1).typing,false);}finally{await f.runtime.close();}
});
test('慢速重试提示在30秒后出现，用户可取消并再次发送',async()=>{
  const f=fixture();
  let attempt;
  f.api.call=async(s,req)=>new Promise((resolve,reject)=>{
    attempt=req;
    req.signal.addEventListener('abort',()=>reject(req.signal.reason),{once:true});
  });
  try{
    const message=f.send('等待重试');
    await until(()=>attempt);
    assert.equal(f.runtime.cancelSlowChat(f.roleId),false);
    f.setClock(f.clock()+30001);
    attempt.onRetry();
    assert.equal(f.runtime.chatProgress(f.roleId).slow,true);
    assert.ok(f.events.some(event=>event.typing===false&&event.slow));
    assert.equal(f.runtime.cancelSlowChat(f.roleId),true);
    assert.equal(attempt.signal.aborted,true);
    assert.equal(f.runtime.chatProgress(f.roleId).slow,false);
    assert.equal(S.find(f.state().messages,message.id).status,'error');
    f.api.call=async()=>({message:{content:'新的回复'},model:f.config,modelId:'isolated'});
    f.send('继续');
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.ok(f.state().messages.some(item=>item.content==='新的回复'));
  }finally{await f.runtime.close();}
});
test('识别语音和生成回答时保持好友名，只在分段送达期间显示输入中',async t=>{
  const f=fixture(),AI=require('../lib/providers.cjs');
  let acceptVoice,answer,unblockAfterLast;
  t.mock.method(AI,'understandVoice',()=>new Promise(resolve=>{acceptVoice=resolve;}));
  f.api.call=()=>new Promise(resolve=>{answer=resolve;});
  const hooks=R.hooks;
  t.mock.method(R,'hooks',async(name,ctx)=>{
    if(name==='afterDeliver'&&ctx.finalTurn)await new Promise(resolve=>{unblockAfterLast=resolve;});
    return hooks(name,ctx);
  });
  R.apply(f.state(),'segments',{splitMode:'regex',sentencePattern:'.+?[。]',intervalMode:'random',minSeconds:.25,maxSeconds:.25});
  const live=()=>f.runtime.chatProgress(f.roleId).typing;
  const snapshot=()=>f.runtime.typingState().find(x=>x.roleId===f.roleId)?.typing;
  const count=()=>f.state().messages.filter(m=>m.sender==='assistant').length;
  try{
    const voice=f.mutate(s=>S.message(s,S.role(s,f.roleId),'user','[语音]','voice',{status:'pending',meta:{audio:'sample'}})).value;
    f.runtime.enqueue(f.roleId,voice.id);
    assert.equal(live(),false);
    await until(()=>acceptVoice);
    assert.equal(snapshot(),false);
    acceptVoice({text:'我刚到楼下。'});
    await until(()=>answer);
    assert.equal(live(),false);assert.equal(snapshot(),false);
    assert.equal(f.events.some(e=>e.typing),false);
    answer({message:{content:'好。一会见。'},model:f.config,modelId:'isolated'});
    await until(live);
    assert.equal(snapshot(),true);assert.equal(count(),1);
    assert.equal(live(),true);
    await until(()=>unblockAfterLast);
    assert.equal(count(),2);assert.equal(live(),false);assert.equal(snapshot(),false);
    assert.deepEqual(f.events.filter(e=>e.event==='typing').map(e=>e.typing).filter((value,index,values)=>index===0||value!==values[index-1]),[false,true,false]);
  }finally{
    acceptVoice?.({text:'结束测试'});
    answer?.({message:{content:''},model:f.config,modelId:'isolated'});
    unblockAfterLast?.();
    await f.runtime.close();
  }
});
test('语音工具等待合成时不显示输入中，纯语音答复实际送达才切换',async t=>{
  const f=fixture({capabilities:['text','tool_use']});
  const ai=f.state().settings.ai;
  ai.models.push({id:'test-tts',sourceId:'isolated',kind:'tts',model:'test-tts'});ai.assign.tts='test-tts';
  let finishSpeech,calls=0;
  t.mock.method(require('../lib/providers.cjs'),'speak',()=>new Promise(resolve=>{finishSpeech=resolve;}));
  f.api.call=async()=>({model:f.config,modelId:'isolated',message:++calls===1
    ?{content:null,tool_calls:[{id:'v',type:'function',function:{name:'send_voice',arguments:'{"text":"到楼下了。"}'}}]}
    :{content:'到楼下了。'}});
  try{
    f.send('说句话');
    await until(()=>finishSpeech);
    assert.equal(f.runtime.chatProgress(f.roleId).typing,false);
    assert.equal(f.events.some(e=>e.typing),false);
    finishSpeech('data:audio/wav;base64,UklGRg==');
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.type),['voice']);
    assert.deepEqual(f.events.filter(e=>e.event==='typing').map(e=>e.typing).filter((value,index,values)=>index===0||value!==values[index-1]),[false,true,false]);
  }finally{finishSpeech?.('data:audio/wav;base64,UklGRg==');await f.runtime.close();}
});
test('近期输入持续推迟回复，停止输入后按设定等待再回',async()=>{
  const f=fixture({idleSeconds:.06});try{f.send('说到一半');for(let i=0;i<4;i++){f.setClock(f.clock()+20);f.runtime.userTyping(f.roleId);await sleep(15);assert.equal(f.requests.length,0);}await until(()=>f.requests.length===1);await until(()=>!f.runtime.isBusy(f.roleId));}finally{await f.runtime.close();}
});
test('持续输入到等待上限时仍开始生成，草稿不会进入请求',async()=>{
  const f=fixture({idleSeconds:.2});try{f.send('已经发送');for(let i=0;i<5;i++){f.setClock(f.clock()+200);f.runtime.userTyping(f.roleId);await sleep(5);}await until(()=>f.requests.length===1);assert.ok(JSON.stringify(f.requests[0].messages).includes('已经发送'));assert.equal(f.state().messages.filter(m=>m.sender==='user').length,1);}finally{await f.runtime.close();}
});
test('生成中插话会取消旧请求，带上新消息重新生成',async()=>{
  const f=fixture();let started=false,aborted=false,count=0;
  f.api.call=async(s,req)=>{f.requests.push(req);count++;if(count===1){started=true;return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('interrupted','AbortError'));},{once:true}));}return {message:{content:'第二轮回复'},model:f.config,modelId:'isolated'};};
  try{f.send('先发');await until(()=>started);f.send('补充');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(aborted,true);assert.equal(f.requests.length,2);const second=JSON.stringify(f.requests[1].messages);assert.ok(second.includes('先发'));assert.ok(second.includes('补充'));assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['第二轮回复']);}finally{await f.runtime.close();}
});
test('分段中插话取消未发送段，已发第一段保留并进入下一轮',async()=>{
  const f=fixture();R.apply(f.state(),'segments',{minSeconds:.15,maxSeconds:.15});let count=0;
  f.api.call=async(s,req)=>{f.requests.push(req);return {message:{content:++count===1?'第一段。第二段。第三段。':'新的回复'},model:f.config,modelId:'isolated'};};
  try{f.send('开始');await until(()=>f.state().messages.some(m=>m.sender==='assistant'));f.send('插话');await until(()=>!f.runtime.isBusy(f.roleId));await sleep(180);assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['第一段。','新的回复']);const second=JSON.stringify(f.requests[1].messages);assert.ok(second.includes('第一段。'));assert.ok(!second.includes('第二段'));}finally{await f.runtime.close();}
});
test('模型失败时把已发送的用户消息标为错误，可再次入队重试',async()=>{
  const f=fixture();f.api.call=async()=>{throw new Error('隔离模拟失败');};try{const message=f.send('请回答');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(S.find(f.state().messages,message.id).status,'error');assert.equal(S.find(f.state().messages,message.id).error,'隔离模拟失败');f.mutate(s=>{S.find(s.messages,message.id).status='pending';});f.api.call=async()=>({message:{content:'重试成功'},model:f.config,modelId:'isolated'});f.runtime.enqueue(f.roleId,message.id);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(S.find(f.state().messages,message.id).status,'sent');assert.ok(f.state().messages.some(m=>m.content==='重试成功'));}finally{await f.runtime.close();}
});
test('同好友同时到期的两条明确提醒均直接发送，聊天忙时也不会等待或重复',async()=>{
  const f=fixture({idleSeconds:.9}),at=f.clock();J.add(f.state(),f.roleId,{note:'第一件事',userRequested:true,schedule:{type:'once',at:at+1000}},at);J.add(f.state(),f.roleId,{note:'第二件事',userRequested:true,schedule:{type:'once',at:at+1000}},at);
  try{
    f.send('正在聊天');assert.equal(f.runtime.isBusy(f.roleId),true);
    f.setClock(at+1000);await f.runtime.tick();
    assert.equal(f.requests.length,0);
    assert.equal(J.list(f.state(),f.roleId).length,0);
    assert.deepEqual(J.list(f.state(),f.roleId,{includeHistory:true}).map(job=>job.status),['completed','completed']);
    await f.runtime.tick();
    assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['第一件事','第二件事']);
  }finally{await f.runtime.close();}
});
test('AI 自己安排的提醒到点走模型工具循环，可以发红包和聊天',async()=>{
  const f=fixture({capabilities:['text','tool_use']}),at=f.clock();
  f.state().roles[0].outreachEnabled=true;
  R.apply(f.state(),'outreach',{quietHoursEnabled:false});
  J.add(f.state(),f.roleId,{note:'提醒并发红包',userRequested:false,schedule:{type:'once',at:at+1}},at);let count=0;
  f.api.call=async(s,req)=>{f.requests.push(req);return {message:++count===1?{role:'assistant',content:null,tool_calls:[{id:'payment-tool',type:'function',function:{name:'send_redpacket',arguments:JSON.stringify({amountCents:100,note:'提醒你'})}}]}:{content:'记得喝水'},model:f.config,modelId:'isolated'};};
  try{f.setClock(at+1);await f.runtime.tick();await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.state().wallet.transactions.length,1);assert.equal(f.state().wallet.transactions[0].status,'pending');assert.equal(f.state().wallet.roleBalances[f.roleId],99900);assert.ok(f.state().messages.some(m=>m.type==='redpacket'));assert.ok(f.state().messages.some(m=>m.content==='记得喝水'));assert.equal(f.state().engine.jobs[0].status,'completed');}finally{await f.runtime.close();}
});
test('停用主动消息后，旧总开关与好友开关都不会触发聊天',async()=>{
  const at=Date.parse('2026-11-15T12:00:00Z'),f=fixture({clock:at});f.state().roles[0].proactive=true;f.state().roles[0].lastActiveAt=at-2*3600000;f.state().settings.modules.proactive={enabled:true};
  try{await f.runtime.tick();f.setClock(at+24*3600000);await f.runtime.tick();assert.equal(f.requests.length,0);assert.equal(f.state().roles[0].lastActiveAt,at-2*3600000);assert.equal(R.list().some(m=>m.id==='proactive'),false);assert.throws(()=>R.apply(f.state(),'proactive',{enabled:true}),/功能不存在/);}finally{await f.runtime.close();}
});

test('停用主动私聊后，朋友圈只在有日程且好友和全局开关开启时发布一次',async()=>{
  const at=Date.parse('2026-11-15T12:00:00Z'),f=fixture({clock:at});
  const Schedule=require('../lib/engine/modules/schedule.cjs'),Moments=require('../lib/engine/modules/life-moments.cjs');
  const before=f.state().moments.length;
  f.state().settings.momentsAuto=true;
  f.api.call=async(s,req)=>{
    f.requests.push(req);
    return {message:{content:'{"skip":false,"text":"今天在美术馆布展。"}'},model:f.config,modelId:'isolated'};
  };
  try{
    await f.runtime.tick();
    assert.equal(f.requests.length,0);
    Schedule.saveForRole(f.state(),f.roleId,{slots:[{start:'00:00',end:'23:59',activity:'布展',scene:'美术馆',phone:'free',restType:'none'}]},at);
    Moments.saveRoleSettings(f.state(),f.roleId,{enabled:false});
    await f.runtime.tick();
    assert.equal(f.requests.length,0);
    Moments.saveRoleSettings(f.state(),f.roleId,{enabled:true});
    R.apply(f.state(),'actions',{allowMoments:false});
    await f.runtime.tick();
    assert.equal(f.requests.length,0);
    R.apply(f.state(),'actions',{allowMoments:true});
    await f.runtime.tick();
    assert.equal(f.requests.length,1);
    assert.equal(f.state().moments.length,before+1);
    assert.equal(f.state().moments.at(-1).authorId,f.roleId);
    assert.equal(f.state().messages.length,0);
    await f.runtime.tick();
    assert.equal(f.requests.length,1);
  }finally{await f.runtime.close();}
});
test('手动提醒在睡眠中准时发一次，关闭 AI 安排提醒仍可送达',async()=>{
  const at=Date.parse('2026-11-15T05:00:00Z'),f=fixture({clock:at});
  const Schedule=require('../lib/engine/modules/schedule.cjs');
  Schedule.saveForRole(f.state(),f.roleId,{slots:[{start:'00:00',end:'08:00',activity:'睡觉',restType:'night_sleep'}]},at);
  const job=J.add(f.state(),f.roleId,{note:'出门记得带伞',userRequested:true,schedule:{type:'once',at:at+5000}},at);
  try{
    f.setClock(at+5000);
    R.apply(f.state(),'actions',{allowReminders:false});
    await f.runtime.tick();
    assert.equal(f.state().engine.jobs.find(j=>j.id===job.id).status,'completed');
    assert.equal(f.requests.length,0);
    assert.equal(A.definitions(f.state(),f.state().roles[0]).some(tool=>tool.function.name==='future_task'),false);
    await f.runtime.tick();
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.equal(f.requests.length,0);
    assert.equal(f.state().engine.jobs.find(j=>j.id===job.id).status,'completed');
    assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['出门记得带伞']);
  }finally{await f.runtime.close();}
});
test('已安排的 AI 提醒只按全局免打扰延期，好友关闭主动信息后仍发送一次',async()=>{
  const at=Date.parse('2026-11-15T05:00:00Z'),f=fixture({clock:at});
  const job=J.add(f.state(),f.roleId,{note:'聊聊晨读',userRequested:false,schedule:{type:'once',at:at+1000}},at);
  f.state().roles[0].outreachEnabled=false;
  R.apply(f.state(),'outreach',{quietHoursEnabled:true,quietStart:'01:00',quietEnd:'07:00'});
  R.apply(f.state(),'actions',{allowReminders:false});
  try{
    f.setClock(at+1000);await f.runtime.tick();
    const waiting=f.state().engine.jobs.find(j=>j.id===job.id);
    assert.equal(waiting.status,'pending');assert.equal(waiting.deferredUntil,at+2*3600000);
    f.setClock(waiting.deferredUntil);await f.runtime.tick();
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.equal(f.state().engine.jobs.find(j=>j.id===job.id).status,'completed');
    await f.runtime.tick();
    assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['模拟回复']);
  }finally{await f.runtime.close();}
});
test('删除正在运行的提醒后，已合并的用户消息仍会作为普通聊天回答',async()=>{
  const f=fixture(),at=f.clock();
  f.state().roles[0].outreachEnabled=true;
  R.apply(f.state(),'outreach',{quietHoursEnabled:false});
  const job=J.add(f.state(),f.roleId,{note:'待删除提醒',userRequested:false,schedule:{type:'once',at:at+1}},at);let started=false,calls=0;
  f.api.call=async(s,req)=>{f.requests.push(req);if(++calls===1){started=true;return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}return {message:{content:'普通聊天回复'},model:f.config,modelId:'isolated'};};
  try{f.setClock(at+1);await f.runtime.tick();await until(()=>started);const user=f.send('这条仍要回复');f.mutate(s=>J.remove(s,f.roleId,job.id));f.runtime.cancelJob(job.id);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(S.find(f.state().messages,user.id).status,'sent');assert.ok(f.state().messages.some(m=>m.content==='普通聊天回复'));assert.ok(!JSON.stringify(f.requests.at(-1).messages).includes('待删除提醒'));assert.equal(f.state().engine.jobs.length,0);}finally{await f.runtime.close();}
});
test('AI 提醒没有发出消息时显示失败，重复提醒保留下次安排',async()=>{
  const f=fixture(),at=f.clock(),hour=3600000;
  f.state().roles[0].outreachEnabled=true;
  R.apply(f.state(),'outreach',{quietHoursEnabled:false});
  J.add(f.state(),f.roleId,{note:'稍后提醒',userRequested:false,schedule:{type:'interval',intervalMs:hour}},at);
  f.api.call=async()=>({message:{content:'[NO_ACTION]'},model:f.config,modelId:'isolated'});
  try{
    f.setClock(at+hour);await f.runtime.tick();await until(()=>!f.runtime.isBusy(f.roleId));
    const [job]=J.list(f.state(),f.roleId);
    assert.equal(job.lastStatus,'failed');
    assert.equal(job.lastFinishedAt,at+hour);
    assert.equal(job.nextAt,at+2*hour);
    assert.equal(job.status,'pending');
    assert.equal(f.state().messages.length,0);
  }finally{await f.runtime.close();}
});
test('拉黑时取消等待和生成，用户消息标为可重试的错误',async()=>{
  const f=fixture({idleSeconds:.1});try{const user=f.send('等待中');f.mutate(s=>{S.role(s,f.roleId).permissions.blocked=true;});f.runtime.cancel(f.roleId);assert.equal(f.runtime.isBusy(f.roleId),false);assert.equal(S.find(f.state().messages,user.id).status,'error');assert.equal(f.requests.length,0);}finally{await f.runtime.close();}
});
test('回复前权限发生变化导致发送失败时，已保存用户消息仍显示错误',async()=>{
  const f=fixture();f.api.call=async()=>{f.mutate(s=>{S.role(s,f.roleId).permissions.blocked=true;});return {message:{content:'不应发出'},model:f.config,modelId:'isolated'};};
  try{const user=f.send('请回复');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(S.find(f.state().messages,user.id).status,'error');assert.equal(f.state().messages.filter(m=>m.sender==='assistant').length,0);}finally{await f.runtime.close();}
});
test('声明登记的动作和定时工作会被runtime自动加载执行',async()=>{
  const f=fixture({capabilities:['text','tool_use']}),m={id:'registered-test',name:'隔离声明',description:'',settings:[],hooks:{},tools:[{definitions:()=>[{type:'function',function:{name:'registered_action',description:'隔离动作',parameters:{type:'object'}}}],execute:async(name,args,ctx)=>ctx.mutate(s=>{s.profile.bio='声明动作已执行';return {ok:true};}).value}],jobs:[{id:'registered-job',run:ctx=>ctx.mutate(s=>{s.profile.region='声明定时工作已执行';})}],data:'registered-test',page:null};
  R.modules.push(m);let calls=0;f.api.call=async(s,req)=>{f.requests.push(req);return {message:++calls===1?{role:'assistant',content:null,tool_calls:[{id:'registered',type:'function',function:{name:'registered_action',arguments:'{}'}}]}:{content:'声明执行完成'},model:f.config,modelId:'isolated'};};
  try{await f.runtime.tick();assert.equal(f.state().profile.region,'声明定时工作已执行');f.send('运行登记动作');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.state().profile.bio,'声明动作已执行');assert.ok(f.requests[0].tools.some(t=>t.function.name==='registered_action'));}finally{await f.runtime.close();R.modules.pop();}
});
test('单独发送转账也能走工具循环由角色领取，不需要附加文字',async()=>{
  const f=fixture({capabilities:['text','tool_use']}),before=f.state().wallet.roleBalances[f.roleId];
  const tx=f.mutate(s=>A.transfer(s,f.roleId,{amountCents:2345,type:'transfer'},'user',R.values(s,'actions'))).value,message=f.state().messages.at(-1);let count=0;
  f.api.call=async(s,req)=>{f.requests.push(req);return {message:++count===1?{role:'assistant',content:null,tool_calls:[{id:'receive',type:'function',function:{name:'handle_payment',arguments:JSON.stringify({id:tx.id,action:'receive'})}}]}:{content:'收到你的转账了'},model:f.config,modelId:'isolated'};};
  try{f.runtime.enqueue(f.roleId,message.id);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.state().wallet.transactions[0].status,'received');assert.equal(f.state().wallet.roleBalances[f.roleId],before+2345);assert.equal(f.state().messages[0].status,'sent');assert.ok(JSON.stringify(f.requests[0].messages).includes(tx.id));}finally{await f.runtime.close();}
});
test('连发两笔财务事件合成一轮请求，失败保留卡片并记录错误',async()=>{
  const f=fixture();f.api.call=async(s,req)=>{f.requests.push(req);throw new Error('财务事件模型失败');};
  try{for(let i=0;i<2;i++){f.mutate(s=>A.transfer(s,f.roleId,{amountCents:100,type:'transfer'},'user',R.values(s,'actions')));f.runtime.enqueue(f.roleId,f.state().messages.at(-1).id);}await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);assert.ok(f.state().messages.every(m=>m.status==='sent'));assert.ok(f.state().wallet.transactions.every(t=>t.status==='pending'));assert.equal(f.state().settings.backgroundStatus.lastError,'财务事件模型失败');const body=JSON.stringify(f.requests[0].messages);for(const tx of f.state().wallet.transactions)assert.ok(body.includes(tx.id));}finally{await f.runtime.close();}
});
test('财务动作已领取后追加文字，中断重组会记得已领取且不会重复入账',async()=>{
  const f=fixture({capabilities:['text','tool_use']}),before=f.state().wallet.roleBalances[f.roleId],tx=f.mutate(s=>A.transfer(s,f.roleId,{amountCents:100,type:'transfer'},'user',R.values(s,'actions'))).value;let count=0,waiting=false;
  f.api.call=async(s,req)=>{
    f.requests.push(req);count++;
    if(count===1)return {message:{role:'assistant',content:null,tool_calls:[{id:'receive',type:'function',function:{name:'handle_payment',arguments:JSON.stringify({id:tx.id,action:'receive'})}}]},model:f.config,modelId:'isolated'};
    if(count===2){waiting=true;return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(new DOMException('interrupted','AbortError')),{once:true}));}
    return {message:{content:'也看到了你的新消息'},model:f.config,modelId:'isolated'};
  };
  try{f.runtime.enqueue(f.roleId,f.state().messages.at(-1).id);await until(()=>waiting);f.send('再补一句');await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.state().wallet.roleBalances[f.roleId],before+100);assert.equal(f.state().wallet.credits.filter(c=>c.source==='received_payment').length,1);const request=JSON.stringify(f.requests.at(-1).messages);assert.ok(request.includes('已领取'));assert.ok(request.includes('再补一句'));}finally{await f.runtime.close();}
});
test('重试旧失败消息时仍包含更晚的待回复消息，不会把未送模型的消息标成功',async()=>{
  const f=fixture(),old=f.mutate(s=>S.message(s,S.role(s,f.roleId),'user','旧失败消息','text',{status:'error'})).value;
  try{const recent=f.send('新待回复消息');f.mutate(s=>{S.find(s.messages,old.id).status='pending';});f.runtime.enqueue(f.roleId,old.id);await until(()=>!f.runtime.isBusy(f.roleId));assert.equal(f.requests.length,1);const request=JSON.stringify(f.requests[0].messages);assert.ok(request.includes('旧失败消息'));assert.ok(request.includes('新待回复消息'));assert.equal(S.find(f.state().messages,old.id).status,'sent');assert.equal(S.find(f.state().messages,recent.id).status,'sent');}finally{await f.runtime.close();}
});

test('追加消息重组回复时，本轮已完成的待发动作保留并只投递一次',async()=>{
  const f=fixture({capabilities:['text','tool_use']});let calls=0,waiting=false;
  f.mutate(s=>R.apply(s,'memory',{enabled:false}));
  f.api.call=async(state,request)=>{
    const turn=++calls;
    if(turn===2){waiting=true;await new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}
    const message=turn===1||turn===3?{tool_calls:[{id:'pat-'+turn,type:'function',function:{name:'pat_user',arguments:'{}'}}]}:{content:'补充的话也收到了。'};
    return {message,model:f.config,modelId:'isolated'};
  };
  try{
    f.send('第一句');await until(()=>waiting);f.send('补充一句');await until(()=>!f.runtime.isBusy(f.roleId));
    assert.equal(f.state().messages.filter(message=>message.meta?.kind==='pat').length,1);
    assert.equal(require('../lib/engine/execution.cjs').data(f.state()).actions.filter(action=>action.name==='pat_user'&&action.status==='completed').length,1);
    assert.ok(f.state().messages.filter(message=>message.sender==='user').every(message=>message.status==='sent'));
  }finally{await f.runtime.close();}
});

test('角色允许跳过发消息时，检索表情后仍可不发消息',async()=>{
  const f=fixture({capabilities:['text','tool_use']}),s=f.state(),r=S.role(s,f.roleId),K=require('../lib/engine/stickers.cjs');
  r.stickers=[{id:'s',image:'IMG'}];s.stickerSemantics={[K.key('IMG')]:{status:'ready',meaning:'开心',tags:[],usage:''}};
  let count=0;
  f.api.call=async(state,request)=>{f.requests.push(request);assert.ok(request.tools.some(t=>t.function.name==='search_stickers'));return {message:++count===1?{tool_calls:[{id:'find',type:'function',function:{name:'search_stickers',arguments:'{"query":"开心"}'}}]}:{content:'[NO_ACTION]'},model:f.config,modelId:'isolated'};};
  try{f.runtime.initiate(r.id,{instruction:'按需聊天',allowNoAction:true});await until(()=>!f.runtime.isBusy(r.id));assert.equal(f.state().messages.length,0);assert.equal(count,2);}finally{await f.runtime.close();}
});

for(const [mutation,unavailable] of [['message.delete','deleted'],['message.recall','recalled']]){
  test('引用排队期间用户处理原消息仍可送达并恢复备份 '+mutation,async()=>{
    const f=fixture({capabilities:['text','tool_use']});
    const original=f.mutate(s=>S.message(s,S.role(s,f.roleId),'user','稍后会处理这条原话')).value;
    let done,turn=0;
    f.api.call=async()=>{
      if(++turn===1)return {model:f.config,modelId:'isolated',message:{tool_calls:[{id:'q',type:'function',function:{name:'reply_quote',arguments:JSON.stringify({messageId:original.id,text:'已经看到了。'})}}]}};
      await new Promise(resolve=>{done=resolve;});
      return {model:f.config,modelId:'isolated',message:{content:'好。'}};
    };
    try{
      f.send('收到吗');
      await until(()=>done);
      f.mutate(s=>S.apply(s,mutation,{id:original.id}));
      done();await until(()=>!f.runtime.isBusy(f.roleId));
      const reply=f.state().messages.find(m=>m.content==='已经看到了。');
      assert.equal(reply.meta.quote.unavailable,unavailable);
      assert.equal(reply.meta.quote.messageId,undefined);
      const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(f.state())},S.initial());
      assert.equal(S.find(restored.messages,reply.id).meta.quote.unavailable,unavailable);
    }finally{done?.();await f.runtime.close();}
  });
}

for(const action of ['reply_quote','recall_message']){
  test('实际聊天设为最多一次动作仍可先选目标再执行 '+action,async()=>{
    const f=fixture({capabilities:['text','tool_use']});
    let targetId='',turn=0;
    f.mutate(s=>R.apply(s,'actions',{maxSteps:1}));
    if(action==='recall_message')targetId=f.mutate(s=>S.message(s,S.role(s,f.roleId),'assistant','选中的旧话')).value.id;
    const call=(name,args)=>({tool_calls:[{id:'tool-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    f.api.call=async(state,request)=>{
      const toolNames=request.tools.map(t=>t.function.name);
      const messages=request.messages;
      let message;
      switch(++turn){
        case 1:
          assert.ok(toolNames.includes('select_message_targets'));
          assert.ok(!JSON.stringify(messages).includes(targetId));
          message=call('select_message_targets',{action,query:'选中的'});
          break;
        case 2:{
          assert.ok(toolNames.includes(action));
          const {messages:candidates}=JSON.parse(messages.findLast(m=>m.role==='tool').content);
          assert.deepEqual(candidates.map(m=>m.messageId),[targetId]);
          message=call(action,action==='reply_quote'?{messageId:candidates[0].messageId,text:'记得。'}:{messageId:candidates[0].messageId});
          break;
        }
        default:message={content:'好的。'};
      }
      return {message,model:f.config,modelId:'isolated'};
    };
    try{
      const incoming=f.send(action==='reply_quote'?'这是选中的原话':'把刚才那句撤回来');
      if(action==='reply_quote')targetId=incoming.id;
      await until(()=>!f.runtime.isBusy(f.roleId));
      const state=f.state();
      assert.equal(S.find(state.messages,incoming.id).status,'sent',S.find(state.messages,incoming.id).error);
      assert.equal(turn,3);
      if(action==='reply_quote')assert.equal(state.messages.find(m=>m.meta?.quote)?.meta.quote.messageId,targetId);
      else assert.equal(S.find(state.messages,targetId).meta.kind,'recalled');
      assert.deepEqual(state.engine.data.execution.actions.map(a=>a.name),[action]);
    }finally{await f.runtime.close();}
  });
}
