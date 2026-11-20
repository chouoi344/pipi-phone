// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),J=require('../lib/engine/scheduler.cjs'),A=require('../lib/engine/actions.cjs'),Runtime=require('../lib/engine/runtime.cjs');
const E=require('../lib/engine/execution.cjs');
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

function restart(f){
  f.mutate(s=>E.recover(s));
  return Runtime.create({getState:f.getState,mutate:f.mutate,modelApi:f.api,now:f.clock});
}
function retry(f,runtime,id){f.mutate(s=>{const m=S.find(s.messages,id);assert.equal(m.status,'error');m.status='pending';delete m.error;});runtime.enqueue(f.roleId,id);}

test('读卡后归档或关闭总开关，模型迟到的正文和操作都失效',async t=>{
  const store=require('../lib/engine/memory-store.cjs');
  for(const mode of ['archive','disable']){
    const f=fixture({capabilities:['text','tool_use']});t.after(()=>f.runtime.close());
    const card=f.mutate(s=>store.upsertCard(null,s,f.roleId,{content:'隔离花印暗号'})).value;
    let finish;
    f.api.call=async(s,req)=>{
      assert.match(JSON.stringify(req.messages),/隔离花印暗号/);
      return new Promise(resolve=>{finish=resolve;});
    };
    f.send('和我说句话');await until(()=>finish);
    f.mutate(s=>mode==='archive'?store.setCardStatus(null,s,f.roleId,card.id,{status:'archived'}):R.apply(s,'memory',{enabled:false}));
    finish({message:{content:'带暗号的旧回复',...(mode==='archive'?{tool_calls:[{id:'old-call',type:'function',function:{name:'memorize_memory',arguments:JSON.stringify({content:'不该存入的旧决定'})}}]}:{})},model:f.config,modelId:'isolated'});
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.equal(f.state().messages.filter(m=>m.sender==='assistant').length,0);
    assert.equal(E.data(f.state()).actions.length,0);
    assert.match(f.state().messages[0].error,/共同记忆已变更/);
  }
});

test('归档没有出现在提示里的另一张记忆时，正在进行的回复照常发送',async t=>{
  const store=require('../lib/engine/memory-store.cjs'),f=fixture();t.after(()=>f.runtime.close());
  f.mutate(s=>{R.apply(s,'memory',{maxInjectCount:1});store.upsertCard(null,s,f.roleId,{content:'青瓷书签',locked:true});store.upsertCard(null,s,f.roleId,{id:'other-card',content:'室内植物'});});
  let finish;
  f.api.call=async(s,req)=>{
    const prompt=req.messages[0].content;assert.ok(prompt.includes('青瓷书签'));assert.ok(!prompt.includes('室内植物'));
    return new Promise(resolve=>{finish=resolve;});
  };
  f.send('青瓷书签');await until(()=>finish);f.mutate(s=>store.setCardStatus(null,s,f.roleId,'other-card',{status:'archived'}));
  finish({message:{content:'书签在这儿。'},model:f.config,modelId:'isolated'});
  await until(()=>!f.runtime.isBusy(f.roleId));assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['书签在这儿。']);
});

test('本轮按用户要求调用忘掉后，可以发确认，下一次模型请求已清除旧卡',async t=>{
  const store=require('../lib/engine/memory-store.cjs'),f=fixture({capabilities:['text','tool_use']});t.after(()=>f.runtime.close());
  const card=f.mutate(s=>store.upsertCard(null,s,f.roleId,{content:'橙色藏书票'})).value;
  let calls=0;
  f.api.call=async(s,req)=>{
    calls++;
    if(calls===1)return {message:{content:null,tool_calls:[{id:'forget',type:'function',function:{name:'forget_memory',arguments:JSON.stringify({memoryId:card.id})}}]},model:f.config,modelId:'isolated'};
    assert.ok(!JSON.stringify(req.messages).includes('橙色藏书票'));
    return {message:{content:'嗯，已经忘掉了。'},model:f.config,modelId:'isolated'};
  };
  f.send('把之前的那件事忘掉');await until(()=>!f.runtime.isBusy(f.roleId));
  assert.equal(calls,2);
  assert.equal(f.state().messages.at(-1).content,'嗯，已经忘掉了。');
});

test('分段和排队语音在重启前后遇到归档，都保留已发内容并丢弃未发内容',async t=>{
  const store=require('../lib/engine/memory-store.cjs');
  for(const restartBeforeArchive of [false,true]){
    const f=fixture();let rt=f.runtime;t.after(()=>rt.close());
    const card=f.mutate(s=>{R.apply(s,'segments',{minSeconds:.15,maxSeconds:.15});return store.upsertCard(null,s,f.roleId,{content:'紫鹭花纹'});}).value;
    f.api.call=async()=>({message:{content:'第一句。紫鹭花纹。'},model:f.config,modelId:'isolated'});
    const message=f.send('聊一下');await until(()=>f.state().messages.some(m=>m.sender==='assistant'));
    if(restartBeforeArchive)await rt.close();
    f.mutate(s=>{
      const run=Object.values(E.data(s).runs)[0];assert.ok(run.memoryRead);
      run.pendingActionMessages=[{id:'queued-voice',roleId:f.roleId,sender:'assistant',type:'voice',content:'过期录音'}];
      store.setCardStatus(null,s,f.roleId,card.id,{status:'archived'});
    });
    if(restartBeforeArchive){rt=restart(f);retry(f,rt,message.id);}
    await until(()=>!rt.isBusy(f.roleId));
    assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['第一句。']);
    assert.equal(Object.values(E.data(f.state()).runs)[0].pendingActionMessages,undefined);
  }
});

test('分段重启只显式续发剩余片段，已完成动作和模型不重跑',async()=>{
  const f=fixture();R.apply(f.state(),'segments',{minSeconds:.15,maxSeconds:.15,cleanupPattern:'。$'});let calls=0;
  f.api.call=async()=>{calls++;return {message:{content:'第一段。第二段。第三段。'},model:f.config,modelId:'isolated'};};
  const message=f.send('继续回答');await until(()=>f.state().messages.some(m=>m.sender==='assistant'));await f.runtime.close();
  R.apply(f.state(),'segments',{cleanupPattern:''});
  f.mutate(s=>{const run=Object.values(E.data(s).runs)[0];E.data(s).actions.push({id:'finished-action',runId:run.id,roleId:f.roleId,name:'pat_user',status:'completed',result:{ok:true}});const queued=S.message(s,S.role(s,f.roleId),'assistant','缓存动作消息');s.messages.pop();run.pendingActionMessages=[queued];});
  const runtime=restart(f);
  try{
    await sleep(30);assert.equal(calls,1);assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['第一段']);
    retry(f,runtime,message.id);await until(()=>!runtime.isBusy(f.roleId));
    assert.equal(calls,1);assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['第一段','第二段','第三段','缓存动作消息']);assert.equal(E.data(f.state()).actions.length,1);assert.equal(S.find(f.state().messages,message.id).status,'sent');assert.equal(Object.values(E.data(f.state()).runs)[0].status,'completed');
  }finally{await runtime.close();}
});

test('续发旧缓存保留较新pending，完成后正常生成新回复',async()=>{
  const f=fixture();R.apply(f.state(),'segments',{minSeconds:.15,maxSeconds:.15});let calls=0;
  f.api.call=async()=>({message:{content:++calls===1?'旧第一段。旧第二段。':'新的回复'},model:f.config,modelId:'isolated'});
  const old=f.send('旧问题');await until(()=>f.state().messages.some(m=>m.sender==='assistant'));await f.runtime.close();
  const runtime=restart(f),newer=f.mutate(s=>S.message(s,S.role(s,f.roleId),'user','新问题','text',{status:'pending'})).value;
  try{retry(f,runtime,old.id);await until(()=>!runtime.isBusy(f.roleId));assert.equal(calls,2);assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['旧第一段。','旧第二段。','新的回复']);assert.equal(S.find(f.state().messages,newer.id).status,'sent');}finally{await runtime.close();}
});

test('用户新消息主动打断的旧片段不在重启时复活，主动任务也不提供重试',async()=>{
  const f=fixture();R.apply(f.state(),'segments',{minSeconds:.15,maxSeconds:.15});let calls=0;
  f.api.call=async()=>({message:{content:++calls===1?'旧第一段。旧第二段。':'新回复'},model:f.config,modelId:'isolated'});
  const old=f.send('旧问题');await until(()=>f.state().messages.some(m=>m.sender==='assistant'));f.send('主动插话');await until(()=>!f.runtime.isBusy(f.roleId));await f.runtime.close();
  f.mutate(s=>{const d=E.data(s);d.runs.scheduled={id:'scheduled',roleId:f.roleId,kind:'chat',jobId:'scheduled-job',targetId:old.id,status:'running',answer:'任务',segments:['任务'],delivered:0};E.recover(s);});
  assert.equal(S.find(f.state().messages,old.id).status,'sent');assert.ok(!Object.values(E.data(f.state()).runs).some(r=>r.resumeDelivery));assert.deepEqual(f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.content),['旧第一段。','新回复']);
});

const testPhoto='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
const selfieCall=(options={})=>({role:'assistant',content:null,tool_calls:[{
  id:'photo-action',type:'function',function:{name:'send_selfie',arguments:JSON.stringify({prompt:'对着镜头拍照',waitingText:'这就拍给你看。',...options})}
}]});
const replies=f=>f.state().messages.filter(m=>m.sender==='assistant').map(m=>m.type==='image'?'image':m.content);

test('明确要求新图发到聊天时，成图入相册和聊天后即可结束，无需第二次模型调用',async t=>{
  const f=fixture({capabilities:['text','tool_use']});
  f.state().settings.ai.assign.image='test-image';
  let chatCalls=0;
  const generate=t.mock.method(require('../lib/providers.cjs'),'generateImage',async()=>testPhoto);
  f.api.call=async()=>{
    if(++chatCalls!==1)throw new Error('second model request would be unavailable');
    return {message:{role:'assistant',content:null,tool_calls:[{id:'image-once',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:'一颗苹果',sendToChat:true})}}]},model:f.config,modelId:'isolated'};
  };
  try{
    const original=f.send('画一颗苹果发给我');
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.equal(S.find(f.state().messages,original.id).status,'sent');
    assert.equal(generate.mock.callCount(),1);
    assert.equal(chatCalls,1);
    assert.equal(f.state().engine.data.actions.roleMedia.length,1);
    const delivered=f.state().messages.filter(m=>m.type==='image');assert.equal(delivered.length,1);
    assert.equal(delivered[0].content,f.state().engine.data.actions.roleMedia[0].image);
    const action=E.data(f.state()).actions.find(a=>a.name==='generate_image');assert.equal(action.result.messageId,delivered[0].id);
    const again=await A.execute('send_image',{mediaId:action.result.mediaId},{getState:f.getState,mutate:f.mutate,roleId:f.roleId,executionId:action.runId});
    assert.equal(again.messageId,delivered[0].id);assert.equal(f.state().messages.filter(m=>m.type==='image').length,1);
  }finally{await f.runtime.close();}
});

test('拍照等待时继续接收新消息，成图先于确认，完成后再回复插话',async t=>{
  const f=fixture({capabilities:['text','tool_use']});
  f.state().settings.ai.assign.image='test-image';
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const photo=new Promise(resolve=>{release=resolve;});
  t.mock.method(require('../lib/providers.cjs'),'generateImage',(_,__,{signal})=>{
    entered(signal);return photo;
  });
  let calls=0;
  f.api.call=async()=>{
    calls++;
    const message=calls===1?selfieCall():{content:calls===2?'（图片）\n发过去啦！':'再答新问题'};
    if(calls===2){
      assert.deepEqual(replies(f),['这就拍给你看。','image']);
      assert.equal(f.runtime.chatProgress(f.roleId).typing,false);
    }
    return {message,model:f.config,modelId:'isolated'};
  };
  try{
    const first=f.send('拍张照'),signal=await started;
    assert.equal(f.runtime.chatProgress(f.roleId).typing,false);
    const second=f.send('我还想问另一件事');
    assert.deepEqual(replies(f),['这就拍给你看。']);
    assert.equal(signal.aborted,false);
    assert.equal(S.find(f.state().messages,second.id).status,'pending');
    release(testPhoto);
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.deepEqual(replies(f),['这就拍给你看。','image','发过去啦！','再答新问题']);
    for(const m of [first,second])assert.equal(S.find(f.state().messages,m.id).status,'sent');
    assert.equal(calls,3);
  }finally{release(testPhoto);await f.runtime.close();}
});

test('连拍只保留成功照片，失败交给当前人设收尾',async t=>{
  const f=fixture({capabilities:['text','tool_use']});
  f.state().settings.ai.assign.image='test-image';
  let photos=0,chatCalls=0;
  t.mock.method(require('../lib/providers.cjs'),'generateImage',async()=>{
    if(++photos===2)throw new Error('upstream diagnostic text');
    return testPhoto;
  });
  f.api.call=async(_,request)=>{
    if(++chatCalls===1)return {message:selfieCall({count:2}),model:f.config,modelId:'isolated'};
    assert.deepEqual(request.tools,[]);
    assert.equal(request.allowEmptyResponse,false);
    assert.match(request.messages.at(-1).content,/按你自己的人设/);
    assert.doesNotMatch(request.messages.at(-1).content,/upstream diagnostic text/);
    assert.deepEqual(replies(f),['这就拍给你看。','image']);
    return {message:{content:'第二张被我手抖拍糊了'},model:f.config,modelId:'isolated'};
  };
  try{
    const message=f.send('请连拍两张');
    await until(()=>!f.runtime.isBusy(f.roleId));
    assert.equal(S.find(f.state().messages,message.id).status,'sent');
    assert.deepEqual(replies(f),['这就拍给你看。','image','第二张被我手抖拍糊了']);
    const action=E.data(f.state()).actions.find(a=>a.name==='send_selfie');
    assert.equal(action.status,'failed');
    assert.equal(chatCalls,2);
  }finally{await f.runtime.close();}
});
