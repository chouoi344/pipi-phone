'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const timers=require('node:timers/promises'),{sampleState}=require('../scripts/sample-data.cjs');
const Media=require('../lib/media-store.cjs'),S=require('../lib/state.cjs'),Providers=require('../lib/providers.cjs');
const Pipeline=require('../lib/engine/pipeline.cjs'),Runtime=require('../lib/engine/runtime.cjs'),R=require('../lib/engine/registry.cjs'),History=require('../lib/engine/tool-history.cjs');
const Actions=require('../lib/engine/actions.cjs'),Selfie=require('../lib/engine/modules/selfie.cjs'),One=require('../lib/engine/system-one.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=','base64');
function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-model-expiry-'));t.after(()=>{require('../lib/engine/memory-store.cjs').close(dataDir);fs.rmSync(dataDir,{recursive:true,force:true});});
  const original=Media.saveImage(dataDir,png),copy=Media.saveImage(dataDir,Buffer.concat([png,Buffer.from('model copy')]));
  let state=sampleState(),clock=Date.parse('2026-11-20T10:00:00Z');state.messages=[];state.settings.timezone='UTC';const roleId=state.roles[0].id;
  state.settings.ai.sources.push({id:'isolated',baseUrl:'https://isolated.invalid/v1',key:'ISOLATED'});
  state.settings.ai.models=[{id:'chat',sourceId:'isolated',kind:'chat',model:'expiry-chat',capabilities:['text','image','tool_use'],maxContextTokens:100000,timeoutSeconds:2,extraBody:{}},{id:'caption',sourceId:'isolated',kind:'chat',model:'expiry-caption',capabilities:['text','image'],maxContextTokens:100000,timeoutSeconds:2,extraBody:{}},{id:'image',sourceId:'isolated',kind:'image',model:'expiry-image',capabilities:[],timeoutSeconds:2,extraBody:{size:'3072x4096'}}];
  Object.assign(state.settings.ai.assign,{chat:'chat',chatSelections:['chat'],chatFallbacks:[],caption:'caption',image:'image'});R.ensure(state);R.apply(state,'waiting',{idleSeconds:0,maxWaitSeconds:1});R.apply(state,'segments',{enabled:false});
  const getState=()=>structuredClone(state),mutate=fn=>{const next=getState(),value=fn(next);state=next;return {state:getState(),value};};
  const message=(type='image',meta={},content=type==='image'?original:'')=>({id:S.id(),roleId,sender:'user',type,content,meta:{...(type==='image'?{modelImage:copy}:{}),...meta},status:'sent',createdAt:clock});
  const expire=(id,kind)=>{clock+=7*86400000;mutate(s=>{const m=s.messages.find(item=>item.id===id);m.meta.expired={kind,at:clock};delete m.meta.image;delete m.meta.modelImage;delete m.meta.audio;if(m.type==='image')m.content='';});};
  return {dataDir,original,copy,roleId,getState,mutate,message,expire,now:()=>clock,state:()=>state,ctx:()=>({getState,mutate,roleId,dataDir,settings:R.values(state,'actions')})};
}
function succeed(){return {choices:[{message:{role:'assistant',content:'正常文字回复'}}],usage:{prompt_tokens:10,completion_tokens:2}};}
function retryError(){return Object.assign(new Error('模拟暂时失败'),{code:'PROVIDER_ERROR',upstreamStatus:500});}
async function until(check){const end=Date.now()+4000;while(!check()){assert(Date.now()<end,'隔离模型操作超时');await new Promise(resolve=>setTimeout(resolve,5));}}
function runtimeApi(captured){const config={id:'chat',capabilities:['text','image','tool_use'],maxContextTokens:100000};return {resolve:()=>config,call:async(state,request)=>{const messages=await request.prepareMessages(config,request.messages);request.beforeRequest?.();captured.push(structuredClone(messages));return {message:{role:'assistant',content:'听到了'},model:config,modelId:'chat'};}};}

test('过期纯图和图文输出统一标记与描述，物理文件仍在也不读取',t=>{
  const f=fixture(t);t.mock.method(Media,'toDataUrl',()=>assert.fail('过期聊天图片不应读取文件'));
  for(const m of [f.message('image',{expired:{kind:'image',at:f.now()},caption:'蓝色风景'}),f.message('text',{image:f.original,modelImage:f.copy,expired:{kind:'image',at:f.now()},caption:'蓝色风景'},'原有配文')]){
    const rendered=Pipeline.render(f.state(),m,true,f.dataDir,new Set());assert.match(rendered.content,/\[图片已过期\] 蓝色风景/);assert.doesNotMatch(JSON.stringify(rendered),/image_url|base64|\/api\/media\//);if(m.type==='text')assert.match(rendered.content,/原有配文/);
  }
  assert(Media.resolveImageBytes(f.dataDir,f.original));
});

test('过期语音保留转写，缺少转写时使用明确标记；引用和转发保持描述',t=>{
  const f=fixture(t),expiry={kind:'voice',at:f.now()};
  const voice=f.message('voice',{expired:expiry,transcript:'保存的原话'},'旧正文');assert.match(Pipeline.render(f.state(),voice,false,f.dataDir,new Set()).content,/保存的原话/);
  const empty=f.message('voice',{expired:expiry},'');assert.match(Pipeline.render(f.state(),empty,false,f.dataDir,new Set()).content,/\[语音已过期\]/);
  const quote=f.message('text',{quote:{sender:'assistant',type:'image',content:'[图片]',expired:{kind:'image',at:f.now()},caption:'引用的蓝天'}},'引用问题');
  assert.match(Pipeline.render(f.state(),quote,true,f.dataDir,new Set()).content,/\[图片已过期\] 引用的蓝天/);
  quote.meta.quote={sender:'assistant',type:'voice',content:'[语音]',expired:expiry,transcript:'引用转写'};assert.match(Pipeline.render(f.state(),quote,true,f.dataDir,new Set()).content,/引用转写/);
  const forward=f.message('forward',{entries:[{senderName:'甲',type:'image',content:'',meta:{expired:{kind:'image',at:f.now()},caption:'转发描述'}},{senderName:'乙',type:'voice',content:'',meta:{expired:expiry,transcript:'转发原话'}}]},'聊天记录');
  const text=Pipeline.render(f.state(),forward,true,f.dataDir,new Set()).content;assert.match(text,/\[图片已过期\] 转发描述/);assert.match(text,/转发原话/);
});

test('同一模型自动重试刷新已缓存图像正文，保留同消息的工具历史',async t=>{
  const f=fixture(t),message=f.message();f.state().messages.push(message);
  const index=History.begin(f.state(),f.roleId,message.id,'old-run',{role:'assistant',content:null,tool_calls:[{id:'old-pat',type:'function',function:{name:'pat_user',arguments:'{}'}}]});History.result(f.state(),message.id,index,{role:'tool',tool_call_id:'old-pat',content:'{"ok":true,"tag":"KEEP_TOOL_RESULT"}'});
  const requests=[];t.mock.method(Providers,'request',async(config,route,options)=>{requests.push(structuredClone(options.body.messages));if(requests.length===1)throw retryError();return succeed();});
  t.mock.method(timers,'setTimeout',async()=>{f.expire(message.id,'image');});
  await Pipeline.run({getState:f.getState,mutate:f.mutate,roleId:f.roleId,dataDir:f.dataDir,now:f.now});
  assert.match(JSON.stringify(requests[0]),/image_url/);assert.match(JSON.stringify(requests[1]),/\[图片已过期\]/);assert.doesNotMatch(JSON.stringify(requests[1]),/image_url|base64/);
  assert.equal(requests[1].find(m=>m.role==='tool').content,'{"ok":true,"tag":"KEEP_TOOL_RESULT"}');assert.equal(requests.length,2);assert(Media.resolveImageBytes(f.dataDir,f.original));
});

test('转述模型重试遇到过期即停止发图，聊天改用过期标记',async t=>{
  const f=fixture(t),message=f.message();f.state().messages.push(message);f.state().settings.ai.models.find(m=>m.id==='chat').capabilities=['text','tool_use'];
  const requests=[];t.mock.method(Providers,'request',async(config,route,options)=>{requests.push({model:config.model,messages:structuredClone(options.body.messages)});if(config.model==='expiry-caption')throw retryError();return succeed();});
  t.mock.method(timers,'setTimeout',async()=>{f.expire(message.id,'image');});
  await Pipeline.run({getState:f.getState,mutate:f.mutate,roleId:f.roleId,dataDir:f.dataDir,now:f.now});
  assert.equal(requests.filter(r=>r.model==='expiry-caption').length,1);const chat=requests.find(r=>r.model==='expiry-chat');assert.match(JSON.stringify(chat.messages),/\[图片已过期\]/);assert.doesNotMatch(JSON.stringify(chat.messages),/image_url|base64/);
});

test('旧聊天接口重试使用当前状态移除已组装的图片附件',async t=>{
  const f=fixture(t),message=f.message();f.state().messages.push(message);const requests=[];
  t.mock.method(Providers,'request',async(config,route,options)=>{requests.push(structuredClone(options.body.messages));if(requests.length===1)throw retryError();return succeed();});
  t.mock.method(timers,'setTimeout',async()=>{f.expire(message.id,'image');});
  await Providers.completion(f.state(),f.state().roles[0],{targetId:message.id,dataDir:f.dataDir,getState:f.getState});
  assert.match(JSON.stringify(requests[0]),/image_url/);assert.match(JSON.stringify(requests[1]),/\[图片已过期\]/);assert.doesNotMatch(JSON.stringify(requests[1]),/image_url|base64/);
});

test('过期语音重试不会调用识别服务，有无转写都能形成文字上下文',async t=>{
  for(const transcript of ['原来保存的转写','']){
    const f=fixture(t),message=f.message('voice',{expired:{kind:'voice',at:f.now()},...(transcript?{transcript}:{})});message.status='pending';f.state().messages.push(message);
    t.mock.method(Providers,'understandVoice',()=>assert.fail('过期语音不应调用识别服务'));const captured=[],runtime=Runtime.create({getState:f.getState,mutate:f.mutate,dataDir:f.dataDir,now:f.now,modelApi:runtimeApi(captured)});
    try{runtime.enqueue(f.roleId,message.id);await until(()=>!runtime.isBusy(f.roleId));assert.equal(f.state().messages.find(m=>m.id===message.id).status,'sent');assert.match(JSON.stringify(captured),transcript?/原来保存的转写/:/\[语音已过期\]/);}finally{await runtime.close();}
  }
});

test('显式过期引用不会改用本轮另一张图片，且不开始生图或发送等待提示',async t=>{
  const f=fixture(t),source=f.message('image',{expired:{kind:'image',at:f.now()}},'');source.sender='assistant';f.state().messages.push(source);
  const message=f.message('text',{image:f.original,modelImage:f.copy,quote:{messageId:source.id,sender:'assistant',type:'image',content:'[图片]',expired:{kind:'image',at:f.now()}}},'修改我引用的图');message.status='pending';f.state().messages.push(message);
  t.mock.method(Providers,'generateImage',()=>assert.fail('不能改用另一张图片'));const config={id:'chat',capabilities:['text','image','tool_use'],maxContextTokens:100000};let receipt;
  const modelApi={resolve:()=>config,call:async(state,request)=>{const last=request.messages.at(-1);if(last.role==='tool')receipt=JSON.parse(last.content);return {message:last.role==='tool'?{role:'assistant',content:'请重新发送图片'}:{role:'assistant',content:null,tool_calls:[{id:'edit',type:'function',function:{name:'generate_image',arguments:'{"prompt":"背景变蓝","mode":"edit","waitingText":"开始修改"}'}}]},model:config,modelId:'chat'};}};
  const runtime=Runtime.create({getState:f.getState,mutate:f.mutate,dataDir:f.dataDir,now:f.now,modelApi});try{runtime.enqueue(f.roleId,message.id);await until(()=>!runtime.isBusy(f.roleId));assert.match(receipt.error,/图片已过期/);assert(!f.state().messages.some(m=>m.content==='开始修改'));}finally{await runtime.close();}
});

test('改图调整尺寸重试前复查来源，过期后不再次发送缓存图片',async t=>{
  const f=fixture(t),source=f.message();f.state().messages.push(source);let hits=0;
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});
  const server=http.createServer(async(req,res)=>{for await(const chunk of req){}hits++;f.expire(source.id,'image');res.statusCode=422;res.end('{"error":{"param":"size","code":"invalid_size","message":"invalid size"}}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  f.state().settings.ai.sources.find(s=>s.id==='isolated').baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
  await assert.rejects(Actions.execute('generate_image',{prompt:'背景变蓝',mode:'edit'},{...f.ctx(),imageRequest:{userImage:f.original,userModelImage:f.copy,sourceMessageId:source.id}}),{code:'MEDIA_EXPIRED'});assert.equal(hits,1);assert(Media.resolveImageBytes(f.dataDir,f.original));
});

test('AI不能检索或重发已过期聊天图，相册保存的同文件仍可重发',async t=>{
  const f=fixture(t),source=f.message('image',{expired:{kind:'image',at:f.now()},caption:'旧图片'},f.original);f.state().messages.push(source);f.state().engine.data.actions.roleMedia=[{id:'keep',roleId:f.roleId,image:f.original}];f.state().engine.data.selfie.photos={[f.roleId]:[{id:'album',image:f.original}]};
  const found=await Actions.execute('select_message_targets',{action:'send_image'},f.ctx());assert.deepEqual(found.messages,[]);await assert.rejects(Actions.execute('send_image',{messageId:source.id},f.ctx()),{code:'MEDIA_EXPIRED'});
  const image=await Actions.execute('send_image',{mediaId:'keep'},f.ctx());assert.equal(f.state().messages.find(m=>m.id===image.messageId).content,f.original);const photo=await Selfie.tools[0].execute('send_selfie',{action:'resend',sourcePhotoId:'album'},f.ctx());assert.equal(f.state().messages.find(m=>m.id===photo.messageId).content,f.original);
});

test('判断模型和旧上下文只接收过期文字及转写，不读取附件',async t=>{
  const f=fixture(t),image=f.message('image',{expired:{kind:'image',at:f.now()},caption:'旧图描述'},f.original),voice=f.message('voice',{expired:{kind:'voice',at:f.now()},transcript:'保留语音转写'});f.state().messages.push(image,voice);
  t.mock.method(Media,'toDataUrl',()=>assert.fail('已过期上下文不读取图片'));const legacy=Providers.history(f.state(),f.state().roles[0],voice.id,{dataDir:f.dataDir});assert.match(JSON.stringify(legacy),/\[图片已过期\] 旧图描述/);assert.match(JSON.stringify(legacy),/保留语音转写/);
  R.apply(f.state(),'waiting',{mode:'cloud',idleSeconds:0.2,maxWaitSeconds:1});f.state().settings.ai.assign.decision='decision';image.status='pending';let decision;
  t.mock.method(One,'evaluateCompleteness',async(state,options)=>{decision=options;return {complete:true};});const runtime=Runtime.create({getState:f.getState,mutate:f.mutate,dataDir:f.dataDir,now:f.now});try{runtime.enqueue(f.roleId,image.id);await until(()=>decision);assert.deepEqual(decision.images,[]);assert.match(decision.text,/\[图片已过期\] 旧图描述/);}finally{await runtime.close();}
});

test('判断模型入口忽略携带过期标记的图片对象',async t=>{
  const f=fixture(t);f.state().settings.ai.models.push({id:'decision',sourceId:'isolated',kind:'decision',model:'jev-test',protocol:'system-one'});f.state().settings.ai.assign.decision='decision';
  t.mock.method(Media,'toDataUrl',()=>assert.fail('判断模型不读取已过期图片'));let body;
  t.mock.method(Providers,'request',async(config,route,options)=>{body=options.body;return {answers:{complete:{probability:0.9}}};});
  await One.evaluateCompleteness(f.state(),{text:'[图片已过期]',images:[{image:f.original,modelImage:f.copy,expired:{kind:'image',at:f.now()}}],dataDir:f.dataDir});assert.equal(body.assets,undefined);assert.equal(body.state.message,'[图片已过期]');
});
