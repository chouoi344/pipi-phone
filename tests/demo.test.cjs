// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createDemo,PASSWORD}=require('../scripts/demo.cjs'),{KEY}=require('../scripts/demo-provider.cjs');
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
async function until(get,predicate,{timeout=5000,interval=20}={}){const start=Date.now();while(Date.now()-start<timeout){const state=await get();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,interval));}assert.fail('后台操作未在 '+timeout+' 毫秒内完成');}
const assistantCount=state=>state.messages.filter(message=>message.sender==='assistant').length;
async function reply(get,accepted,timeout=5000){const before=assistantCount(accepted.state);return until(get,state=>{const user=state.messages.find(message=>message.id===accepted.messageId);return user?.status==='error'||user?.status==='sent'&&assistantCount(state)>before;},{timeout,interval:timeout>10000?100:20});}
test('local demo uses real app HTTP, isolated persistence and protocol failures',async t=>{
  const timers=require('node:timers/promises'),wait=timers.setTimeout,retryDelays=[];
  t.mock.method(timers,'setTimeout',async(ms,value,options)=>{
    if(![1000,2000,4000,8000].includes(ms))return wait(ms,value,options);
    options?.signal?.throwIfAborted();
    retryDelays.push(ms);
  });
  const demo=await createDemo({host:'127.0.0.1',appPort:0,providerPort:0});let stopped=false;t.after(()=>stopped?undefined:demo.close());
  const state=async()=>ok(await demo.request('/api/state'));
  ok(await demo.request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0}}));
  ok(await demo.request('/api/engine/modules',{id:'segments',values:{enabled:false}}));
  const mode=async value=>{const response=await fetch(demo.controlUrl+'/demo/mode',{method:'POST',headers:{Origin:demo.controlUrl,'Content-Type':'application/json'},body:JSON.stringify({mode:value})});assert.equal(response.status,200);};
  const initial=await state(),roleId=initial.roles[0].id;
  const chat=(patch={})=>demo.request('/api/chat/send',{roleId,text:'演示真实 HTTP 消息',requestId:randomUUID(),...patch});
  const completed=async(patch={},timeout=5000)=>{const accepted=ok(await chat(patch));assert.equal(accepted.accepted,true);return reply(state,accepted,timeout);};
  const receipt='data:image/png;base64,'+(await readFile(path.join(__dirname,'../scripts/demo-assets/receipt.png'))).toString('base64');
  const audio='data:audio/mpeg;base64,'+(await readFile(path.join(__dirname,'../scripts/demo-assets/tone.mp3'))).toString('base64');
  await t.test('preconfigured four capabilities and controls stay separate from real data',async()=>{
    await assert.rejects(createDemo({resumeDir:path.join(__dirname,'..')}),/只能恢复/);assert.match(demo.dataDir,/pipi-local-demo-/);assert.equal(initial.profile.name,'本地模型演示');
    const ai=initial.settings.ai,source=ai.sources.find(item=>item.id==='local-demo');assert.equal(source.keySet,true);assert.equal(source.key,undefined);assert.equal(source.baseUrl,demo.controlUrl+'/v1');for(const purpose of ['chat','caption','stt','tts'])assert.ok(ai.models.some(model=>model.id===ai.assign[purpose]));
    const control=await(await fetch(demo.controlUrl+'/demo/state')).json();assert.equal(control.password,PASSWORD);assert.equal(control.appUrl,demo.appUrl);
    assert.equal((await fetch(demo.controlUrl+'/demo/mode',{method:'POST',headers:{Origin:'http://untrusted.invalid'},body:'{"mode":"http"}'})).status,403);assert.equal((await fetch(demo.controlUrl+'/demo/mode',{method:'POST',headers:{Origin:demo.controlUrl},body:'{"mode":"unknown"}'})).status,400);assert.equal(demo.provider.mode,'success');
    assert.equal((await fetch(demo.controlUrl+'/v1/models')).status,401);assert.equal((await fetch(demo.controlUrl+'/samples/%2e%2e%2fserver.cjs')).status,404);assert.equal((await fetch(demo.controlUrl+'/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:'{}'})).status,404);
    const models=ok(await demo.request('/api/engine/models/list',{sourceId:'local-demo'}));assert.deepEqual(models.models.map(model=>model.id),['local-demo-chat','local-demo-vision','local-demo-tts','local-demo-stt']);assert.equal(ok(await demo.request('/api/engine/models/test',{modelId:ai.assign.chat})).ok,true);
    const before=await state(),external='https://example.invalid/v1',changed=structuredClone(before.settings.ai);changed.sources.find(item=>item.id==='local-demo').baseUrl=external;
    for(const [route,body]of [['/api/engine/models',{ai:changed}],['/api/engine/models/list',{sourceId:'local-demo',baseUrl:external,key:KEY}]]){const result=await demo.request(route,body);assert.equal(result.status,422);assert.equal(result.body.code,'PROVIDER_LOCAL_ONLY');assert.deepEqual(await state(),before);}
    const badBackup=ok(await demo.request('/api/backup'));badBackup.state.settings.ai.sources.find(item=>item.id==='local-demo').baseUrl=external;const restored=await demo.request('/api/restore',{backup:badBackup,confirm:true});assert.equal(restored.status,422);assert.equal(restored.body.code,'PROVIDER_LOCAL_ONLY');assert.deepEqual(await state(),before);
  });
  await t.test('chat success is saved and idempotent; mixed image reaches vision provider',async()=>{
    const payload={text:'可持久保存的演示消息',requestId:randomUUID()},before=demo.provider.requests.length;let result=await completed(payload);assert.match(result.messages.at(-1).content,/^\[本地演示响应\]/);assert.equal(result.messages.at(-2).status,'sent');assert.equal((await state()).messages.at(-1).id,result.messages.at(-1).id);assert.deepEqual(ok(await chat(payload)).state.messages,result.messages);assert.equal(demo.provider.requests.length,before+1);
    result=await completed({text:'请看这张演示图片',image:receipt});assert.equal(demo.provider.requests.at(-1).hasImage,true);assert.match(result.messages.at(-1).content,/不识别图片内容/);assert.equal(result.messages.at(-2).meta.image,receipt);
  });
  await t.test('receipt draft is parsed without writing; explicit save persists actual ledger',async()=>{
    const before=(await state()).ledger.length,result=ok(await demo.request('/api/ledger/recognize',{image:receipt}));assert.equal(result.drafts[0].amountCents,1250);assert.match(result.drafts[0].note,/固定演示草稿/);assert.equal((await state()).ledger.length,before);ok(await demo.request('/api/action',{type:'ledger.save',payload:result.drafts[0]}));assert.equal((await state()).ledger.at(-1).amountCents,1250);
  });
  await t.test('multipart voice transcription and TTS store real playable audio',async()=>{
    const {ai}=ok(await demo.request('/api/engine/config'));
    const speech=ai.models.find(model=>model.id===ai.assign.stt);
    const listener={...speech,id:'local-demo-listener',model:'local-demo-listener'};
    ai.models.push(listener);ai.assign.voiceUnderstanding=listener.id;
    ok(await demo.request('/api/engine/models',{ai}));
    const transcript=ok(await demo.request('/api/voice/transcribe',{audio}));assert.match(transcript.text,/本地演示转写/);assert.equal(demo.provider.requests.at(-1).multipart,true);const sent=await completed({text:'',audio,durationMs:450}),voice=sent.messages.at(-2);assert.equal(voice.type,'voice');assert.equal(voice.meta.audio,audio);assert.match(voice.meta.transcript,/本地演示转写/);const message=sent.messages.at(-1),spoken=ok(await demo.request('/api/voice/speak',{messageId:message.id}));assert.equal(spoken.audio,audio);assert.equal((await state()).messages.find(item=>item.id===message.id).meta.audio,audio);assert.ok(demo.provider.requests.at(-1).inputChars>0);
    const logs=ok(await demo.request('/api/engine/usage?range=all')).logs.items;
    for(const [purpose,name] of [['stt',speech.model],['voiceUnderstanding',listener.model],['tts',ai.models.find(model=>model.id===ai.assign.tts).model]]){
      assert.ok(logs.some(row=>row.purpose===purpose&&row.model===name&&row.success),purpose);
    }
  });
  await t.test('moment generation uses chat provider and survives subsequent state read',async()=>{
    const before=(await state()).moments.length;assert.equal(ok(await demo.request('/api/moments/generate',{roleId})).accepted,true);const result=await until(state,next=>next.moments.length>before);assert.match(result.moments.at(-1).content,/本地演示响应/);assert.match((await state()).moments.at(-1).content,/固定演示文案/);
  });
  await t.test('transient failure automatically recovers; exhausted attempts allow manual retry without duplication',async()=>{
    await mode('retry');
    const beforeAuto=retryDelays.length;
    const automatic=await completed({text:'短暂失败后自动恢复'});
    assert.equal(automatic.messages.at(-2).status,'sent');
    assert.equal(automatic.messages.at(-1).sender,'assistant');
    assert.deepEqual(retryDelays.slice(beforeAuto),[1000]);
    await mode('http');
    const beforeFailure=retryDelays.length;
    const result=await completed({text:'只应有一份的失败消息'}),failed=result.messages.at(-1);
    assert.equal(failed.status,'error');assert.match(failed.error,/503/);
    assert.deepEqual(retryDelays.slice(beforeFailure),[1000,2000,4000,8000]);
    await mode('success');
    const accepted=ok(await demo.request('/api/chat/retry',{messageId:failed.id})),recovered=await reply(state,accepted);
    assert.equal(recovered.messages.find(item=>item.id===failed.id).status,'sent');assert.equal(recovered.messages.filter(item=>item.content==='只应有一份的失败消息').length,1);assert.equal(recovered.messages.at(-1).sender,'assistant');
  });
  await t.test('delayed real HTTP returns promptly and accepts a new same-role message that interrupts the first generation',async()=>{
    await mode('delay');const before=demo.provider.requests.at(-1)?.id||0,assistantBefore=assistantCount(await state()),start=Date.now(),first=ok(await chat({text:'延迟中的消息'}));assert.ok(Date.now()-start<1000);assert.equal(first.accepted,true);await until(async()=>demo.provider.requests,requests=>requests.some(item=>item.id>before));assert.equal((await state()).messages.find(message=>message.id===first.messageId).status,'pending');const second=ok(await chat({text:'延迟中的第二条'}));assert.equal(second.accepted,true);const result=await reply(state,second,7000);assert.equal(result.messages.find(message=>message.id===first.messageId).status,'sent');assert.equal(result.messages.find(message=>message.id===second.messageId).status,'sent');assert.equal(assistantCount(result),assistantBefore+1);
    const delayed=demo.provider.requests.filter(item=>item.id>before&&item.mode==='delay'&&item.path==='/v1/chat/completions');
    assert.ok(delayed.length>=2);
    assert.ok(delayed.some(item=>item.status==='HTTP 200'&&item.elapsedMs>=2900));
  });
  await t.test('HTTP error, invalid JSON, empty result and disconnect never fabricate assistant success',async()=>{
    for(const [scenario,error]of [['http',/503/],['json',/JSON/],['empty',/没有返回文本内容/],['disconnect',/连接|中断|网络/]]){await mode(scenario);const before=assistantCount(await state()),result=await completed({text:'异常场景 '+scenario}),failed=result.messages.at(-1);assert.equal(failed.status,'error');assert.match(failed.error,error);assert.equal(assistantCount(result),before);}
  });
  await t.test('configured request timeout occurs for every attempt and failed message can recover',async()=>{
    const {ai}=ok(await demo.request('/api/engine/config'));
    const chatModel=ai.models.find(model=>model.id===ai.assign.chat);
    assert.equal(chatModel.timeoutSeconds,45);
    chatModel.timeoutSeconds=1;ok(await demo.request('/api/engine/models',{ai}));
    await mode('timeout');
    const before=retryDelays.length,start=Date.now();
    const result=await completed({text:'真实超时演示'},10000),failed=result.messages.at(-1);
    assert.ok(Date.now()-start>=4900);
    assert.deepEqual(retryDelays.slice(before),[1000,2000,4000,8000]);
    assert.equal(failed.status,'error');assert.match(failed.error,/超时/);
    await mode('success');
    chatModel.timeoutSeconds=45;ok(await demo.request('/api/engine/models',{ai}));
    const recovered=await reply(state,ok(await demo.request('/api/chat/retry',{messageId:failed.id})));
    assert.equal(recovered.messages.find(message=>message.id===failed.id).status,'sent');
  });
  await t.test('same-port resume uses real login and retains saved messages, ledger, moments and model path',async()=>{
    const before=await state();await demo.close();stopped=true;
    const restarted=await createDemo({host:'127.0.0.1',appPort:Number(new URL(demo.appUrl).port),providerPort:Number(new URL(demo.controlUrl).port),resumeDir:demo.dataDir});
    try{
      const saved=ok(await restarted.request('/api/state'));
      for(const key of ['messages','ledger','moments'])assert.deepEqual(saved[key],before[key]);
      assert.deepEqual(saved.settings.ai.assign,before.settings.ai.assign);
      const next=await reply(async()=>ok(await restarted.request('/api/state')),ok(await restarted.request('/api/chat/send',{roleId,text:'重启后可用',requestId:randomUUID()})));
      assert.match(next.messages.at(-1).content,/本地演示响应/);
      assert.equal(restarted.provider.requests.at(-1).path,'/v1/chat/completions');
      assert.equal(restarted.provider.requests.at(-1).body.model,before.settings.ai.models.find(model=>model.id===before.settings.ai.assign.chat).model);
    }finally{await restarted.close();}
  });
});
test('demo startup faults restore the private-provider environment before and during app creation',async()=>{
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS,oldTemp=process.env.TEMP;process.env.ALLOW_PRIVATE_PROVIDERS='preexisting-test-value';try{process.env.TEMP=path.join(__dirname,'../scripts/demo-assets/tone.mp3');await assert.rejects(createDemo({appPort:0,providerPort:0}));assert.equal(process.env.ALLOW_PRIVATE_PROVIDERS,'preexisting-test-value');if(oldTemp===undefined)delete process.env.TEMP;else process.env.TEMP=oldTemp;await assert.rejects(createDemo({appPort:-1,providerPort:0}));assert.equal(process.env.ALLOW_PRIVATE_PROVIDERS,'preexisting-test-value');}finally{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;if(oldTemp===undefined)delete process.env.TEMP;else process.env.TEMP=oldTemp;}
});
test('demo resume rejects a persisted external provider before starting app/background calls',async()=>{
  const demo=await createDemo({appPort:0,providerPort:0}),raw=JSON.parse(demo.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);raw.settings.ai.sources.find(source=>source.id==='local-demo').baseUrl='https://example.invalid/v1';raw.settings.momentsAuto=true;raw.settings.momentsLastAttemptAt=1;for(const role of raw.roles){role.proactive=true;role.lastActiveAt=1;}demo.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(raw));await demo.close();const previous=process.env.ALLOW_PRIVATE_PROVIDERS;await assert.rejects(createDemo({appPort:0,providerPort:0,resumeDir:demo.dataDir}),{code:'PROVIDER_LOCAL_ONLY'});assert.equal(process.env.ALLOW_PRIVATE_PROVIDERS,previous);
});
