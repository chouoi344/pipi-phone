'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {setTimeout:wait}=require('node:timers/promises');
const {sampleState}=require('../scripts/sample-data.cjs'),Media=require('../lib/media-store.cjs'),S=require('../lib/state.cjs');
const Pipeline=require('../lib/engine/pipeline.cjs'),Runtime=require('../lib/engine/runtime.cjs'),R=require('../lib/engine/registry.cjs');
const One=require('../lib/engine/system-one.cjs'),Providers=require('../lib/providers.cjs'),Actions=require('../lib/engine/actions.cjs'),Selfie=require('../lib/engine/modules/selfie.cjs');
const ModelImages=require('../lib/engine/model-images.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwCsj7DwADmAHwphbYCgAAAABJRU5ErkJggg==','base64');
function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-model-images-'));t.after(()=>{require('../lib/engine/memory-store.cjs').close(dataDir);fs.rmSync(dataDir,{recursive:true,force:true});});
  const originalBytes=Buffer.concat([png,Buffer.from('ORIGINAL_ONLY')]),copyBytes=Buffer.concat([png,Buffer.from('MODEL_COPY_ONLY')]);
  const original=Media.saveImage(dataDir,originalBytes),copy=Media.saveImage(dataDir,copyBytes),missing='/api/media/'+'0'.repeat(64)+'.png';
  let state=sampleState();state.messages=[];const roleId=state.roles[0].id;
  state.settings.ai.sources.push({id:'isolated',baseUrl:'https://isolated.invalid/v1',key:'ISOLATED'});
  state.settings.ai.models=[{id:'chat',sourceId:'isolated',kind:'chat',model:'chat',capabilities:['text','image','tool_use'],maxContextTokens:100000,timeoutSeconds:2},{id:'caption',sourceId:'isolated',kind:'chat',model:'caption',capabilities:['text','image'],maxContextTokens:100000,timeoutSeconds:2},{id:'image',sourceId:'isolated',kind:'image',model:'image',capabilities:[],extraBody:{},timeoutSeconds:2}];
  Object.assign(state.settings.ai.assign,{chat:'chat',chatSelections:['chat'],chatFallbacks:[],caption:'caption',image:'image'});R.ensure(state);
  const getState=()=>structuredClone(state),mutate=fn=>{const next=getState(),value=fn(next);state=next;return {state:getState(),value};};
  const message=(content=original,meta={modelImage:copy},sender='user')=>({id:S.id(),roleId,sender,type:'image',content,meta,status:'sent',createdAt:Date.now()});
  return {dataDir,originalBytes,copyBytes,original,copy,missing,roleId,getState,mutate,message,state:()=>state,ctx:()=>({getState,mutate,roleId,dataDir,settings:R.values(state,'actions')})};
}
async function until(check){const end=Date.now()+4000;while(!check()){assert(Date.now()<end,'隔离模型操作超时');await wait(5);}}
function api(f,capabilities,requests){const config={id:'chat',capabilities,maxContextTokens:100000};return {resolve:()=>config,call:async(state,request)=>{const messages=request.prepareMessages?await request.prepareMessages(config,request.messages):request.messages;requests.push({purpose:request.purpose,messages});return {message:{role:'assistant',content:request.purpose==='caption'?'副本中的画面':'已看到'},model:config,modelId:'chat',usage:{inputTokens:10}};}};}

test('图片和图文上下文优先可读副本，副本缺失读原图，显示身份保持原图',t=>{
  const f=fixture(t),state=f.state();
  for(const message of [f.message(),{...f.message(),type:'text',content:'配文',meta:{image:f.original,modelImage:f.copy}}]){
    const rendered=Pipeline.render(state,message,true,f.dataDir,new Set());assert.equal(rendered.content.at(-1).image_url.url,Media.toDataUrl(f.dataDir,f.copy));assert.equal(message.type==='image'?message.content:message.meta.image,f.original);
    message.meta.modelImage=f.missing;assert.equal(Pipeline.render(state,message,true,f.dataDir,new Set()).content.at(-1).image_url.url,Media.toDataUrl(f.dataDir,f.original));
  }
  assert.deepEqual(Media.resolveImageBytes(f.dataDir,f.original).buffer,f.originalBytes);
});

test('图片转述用副本，缓存仍按原图复用并写回相同原图消息',async t=>{
  const f=fixture(t),messages=[f.message(),f.message()];f.state().messages=messages;const requests=[],modelApi=api(f,['text'],requests);
  const opts={getState:f.getState,mutate:f.mutate,roleId:f.roleId,dataDir:f.dataDir,modelApi};await Pipeline.run(opts);await Pipeline.run(opts);
  const captions=requests.filter(request=>request.purpose==='caption'),work=ModelImages.cached(f.dataDir,f.original);assert.equal(captions.length,1);assert.equal(captions[0].messages[1].content[0].image_url.url,Media.toDataUrl(f.dataDir,work.url));assert.notEqual(work.url,f.copy);
  assert(f.state().messages.every(message=>message.content===f.original&&message.meta.caption==='副本中的画面'));
});

test('视觉模型转纯文本备用时转述副本，备用只收到文字',async t=>{
  const f=fixture(t);f.state().messages=[f.message()];const requests=[],modelApi=api(f,['text'],requests),resolve=modelApi.resolve;
  modelApi.resolve=()=>({...resolve(),capabilities:['text','image']});await Pipeline.run({getState:f.getState,mutate:f.mutate,roleId:f.roleId,dataDir:f.dataDir,modelApi});
  assert.equal(requests.find(request=>request.purpose==='caption').messages[1].content[0].image_url.url,Media.toDataUrl(f.dataDir,ModelImages.cached(f.dataDir,f.original).url));assert.doesNotMatch(JSON.stringify(requests.find(request=>request.purpose==='chat').messages),/image_url/);assert.equal(f.state().messages[0].content,f.original);
});

test('引用和合并转发保持原有文字上下文行为，不额外向模型附图',t=>{
  const f=fixture(t),quoted={sender:'assistant',type:'image',content:'[图片]',image:f.original,modelImage:f.copy};
  const quote={id:'quote',sender:'user',type:'text',content:'看这张图',meta:{quote:quoted}},forward={id:'forward',sender:'user',type:'forward',content:'聊天记录',meta:{entries:[{senderName:'甲',type:'image',content:f.original,meta:{modelImage:f.copy,caption:'图片内容'}}]}};
  for(const message of [quote,forward])assert.equal(typeof Pipeline.render(f.state(),message,true,f.dataDir,new Set()).content,'string');
});

test('完整性判断读取服务端原图绑定副本；runtime保留两个引用',async t=>{
  const f=fixture(t),captured=[];f.state().settings.ai.models.push({id:'decision',sourceId:'isolated',kind:'decision',model:'jev-test',protocol:'system-one'});f.state().settings.ai.assign.decision='decision';
  t.mock.method(Providers,'request',async(config,route,options)=>{captured.push(options.body);return {answers:{complete:{probability:0.9}}};});
  for(const modelImage of [f.copy,f.missing])await One.evaluateCompleteness(f.state(),{images:[{image:f.original,modelImage}],dataDir:f.dataDir});
  const work=Media.resolveImageBytes(f.dataDir,ModelImages.cached(f.dataDir,f.original).url).buffer;assert.equal(Object.values(captured[0].assets)[0].data_base64,work.toString('base64'));assert.equal(Object.values(captured[1].assets)[0].data_base64,work.toString('base64'));assert.deepEqual(Media.resolveImageBytes(f.dataDir,f.original).buffer,f.originalBytes);
  R.apply(f.state(),'waiting',{mode:'cloud',idleSeconds:0.2,maxWaitSeconds:1});let input;
  t.mock.method(One,'evaluateCompleteness',async(state,options)=>{input=options.images;return {complete:true};});
  const message=f.message();message.status='pending';f.state().messages.push(message);const runtime=Runtime.create({getState:f.getState,mutate:f.mutate,dataDir:f.dataDir});
  try{runtime.enqueue(f.roleId,message.id);await until(()=>input);assert.deepEqual(input,[{image:f.original,modelImage:f.copy}]);}finally{await runtime.close();}
});

test('改图始终发送原图绑定的服务端副本，参考原地址保持不变',async t=>{
  const f=fixture(t),previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});
  const requests=[],server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push(Buffer.concat(chunks));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));f.state().settings.ai.sources.find(source=>source.id==='isolated').baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
  const references=[f.original];for(const copy of [f.copy,f.missing])await Providers.generateImage(f.state(),'背景改蓝',{references,modelImages:{[f.original]:copy},requireReference:true,dataDir:f.dataDir});
  const work=Media.resolveImageBytes(f.dataDir,ModelImages.cached(f.dataDir,f.original).url).buffer;assert(requests[0].includes(work));assert(!requests[0].includes(f.originalBytes));assert(!requests[0].includes(f.copyBytes));assert(requests[1].includes(work));assert.deepEqual(references,[f.original]);
});

test('本轮引用改图保留原图标识并把副本传给生图边界',async t=>{
  const f=fixture(t),quoted=f.message(f.original,{modelImage:f.copy},'assistant');f.state().messages.push(quoted);
  const message={id:S.id(),roleId:f.roleId,sender:'user',type:'text',content:'改成蓝色背景',status:'pending',createdAt:Date.now(),meta:{quote:{messageId:quoted.id,sender:'assistant',type:'image',content:'[图片]',image:f.original,modelImage:f.copy}}};f.state().messages.push(message);
  R.apply(f.state(),'waiting',{idleSeconds:0,maxWaitSeconds:1});R.apply(f.state(),'segments',{enabled:false});let received;
  t.mock.method(Providers,'generateImage',async(state,prompt,options)=>{received=options;return f.original;});
  const config={id:'chat',capabilities:['text','image','tool_use'],maxContextTokens:100000},modelApi={resolve:()=>config,call:async(state,request)=>({message:request.messages.at(-1).role==='tool'?{role:'assistant',content:'改好了'}:{role:'assistant',content:null,tool_calls:[{id:'edit',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:'蓝色背景',mode:'edit',sendToChat:true})}}]},model:config,modelId:'chat'})};
  const runtime=Runtime.create({getState:f.getState,mutate:f.mutate,dataDir:f.dataDir,modelApi});try{runtime.enqueue(f.roleId,message.id);await until(()=>!runtime.isBusy(f.roleId));assert.deepEqual(received.references,[f.original]);assert.equal(received.modelImages[f.original],ModelImages.cached(f.dataDir,f.original).url);}finally{await runtime.close();}
});

test('AI重发图片和相册照片保留原图、缩略图和模型副本',async t=>{
  const f=fixture(t),message=f.message(f.original,{modelImage:f.copy,thumb:f.copy,caption:'原图说明'},'assistant');f.state().messages.push(message);
  f.state().engine.data.actions.roleMedia=[{id:'media',roleId:f.roleId,image:f.original}];f.state().engine.data.selfie.photos={[f.roleId]:[{id:'photo',image:f.original}]};
  for(const args of [{messageId:message.id},{mediaId:'media'}]){const result=await Actions.execute('send_image',args,f.ctx());const sent=f.state().messages.find(item=>item.id===result.messageId);assert.equal(sent.content,f.original);assert.equal(sent.meta.modelImage,f.copy);assert.equal(sent.meta.thumb,f.copy);}
  const result=await Selfie.tools[0].execute('send_selfie',{action:'resend',sourcePhotoId:'photo'},f.ctx()),sent=f.state().messages.find(item=>item.id===result.messageId);assert.equal(sent.content,f.original);assert.equal(sent.meta.modelImage,f.copy);
});

test('续拍保留原参考图和并行副本地址，不改身份快照',async t=>{
  const f=fixture(t),role=f.state().roles[0];role.faceReferences=[];role.bodyReferences=[];
  const identity={faceReferences:[],bodyReferences:[],appearancePrompt:''};f.state().engine.data.selfie.photos={[role.id]:[{id:'photo',image:f.original,kind:'selfie',references:[f.original],referenceModelImages:[f.copy],referenceRoles:['用户身份参考'],identity}]};
  const plan=Selfie.buildPhotoPlan(f.state(),role,{action:'continue',sourcePhotoId:'photo',kind:'selfie',prompt:'再拍一张'});assert.equal(plan.modelImages[f.original],f.copy);assert.deepEqual(plan.identity,identity);assert(plan.references.includes(f.original));
  let options;t.mock.method(Providers,'generateImage',async(state,prompt,request)=>{options=request;return f.original;});const [photo]=await Selfie.generateRolePhoto(f.state(),role,{plan,dataDir:f.dataDir});assert.equal(options.modelImages[f.original],f.copy);assert.deepEqual(photo.references,plan.references);assert.equal(photo.referenceModelImages[photo.references.indexOf(f.original)],f.copy);
});
