// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{setTimeout:wait}=require('node:timers/promises');
const {createApp}=require('../scripts/sample-data.cjs');
const KEY='ENGINE_ISOLATED_HTTP_KEY',PASSWORD='Engine-isolated-password_2026!';
async function fixture(t,respond,{disableAutomaticSchedules=false}={}){
  const old=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const requests=[],mock=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks),contentType=req.headers['content-type']||'';
    const multipart=contentType.startsWith('multipart/form-data');
    const body=raw.length&&!multipart?JSON.parse(raw):{};
    requests.push({url:req.url,body,...(multipart?{multipart:raw,contentType}:{})});
    res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'isolated-chat'}]}));return;}
    if(respond)return respond(body,res,requests);
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'第一句。\n第二句！'}}],usage:{prompt_tokens:10,completion_tokens:6}}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-engine-integration-'));
  let app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();
  let base='http://127.0.0.1:'+app.server.address().port,cookie='',csrf='';
  async function request(route,body,{anonymous=false,headers={}}={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(anonymous?{}:{Cookie:cookie} ),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,body:value};
  }
  const setup=await request('/api/setup',{password:PASSWORD,displayName:'隔离引擎验收'});assert.equal(setup.status,200);
  const source='http://127.0.0.1:'+mock.address().port+'/v1',state=setup.body.state;
  if(disableAutomaticSchedules){
    for(const role of state.roles){
      const result=await request('/api/engine/schedule',{action:'saveSettings',roleId:role.id,settings:{autoGenerate:false}});
      assert.equal(result.status,200);
    }
  }
  const ai={...state.settings.ai,sources:[...state.settings.ai.sources,{id:'test',name:'隔离模拟',baseUrl:source,key:KEY,builtin:false}],models:[{id:'main',sourceId:'test',model:'isolated-chat',kind:'chat',capabilities:['text','tool_use'],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:'alloy'}],assign:{chat:'main',chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''}};
  assert.equal((await request('/api/engine/models',{ai})).status,200);
  assert.equal((await request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0.05,maxWaitSeconds:1}})).status,200);
  assert.equal((await request('/api/engine/modules',{id:'segments',values:{intervalMode:'random',minSeconds:0,maxSeconds:0}})).status,200);
  const read=async()=>(await request('/api/state')).body;
  const f={request,read,requests,source,roleId:state.roles[0].id,get app(){return app;},get base(){return base;},get cookie(){return cookie;},async restart(){await app.close();app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();base='http://127.0.0.1:'+app.server.address().port;await request('/api/login',{password:PASSWORD});}};
  t.after(async()=>{await app.close();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-engine-integration-'));fs.rmSync(dir,{recursive:true,force:true});if(old===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=old;});
  return f;
}
async function until(fn,label){const deadline=Date.now()+7000;while(Date.now()<deadline){const result=await fn();if(result)return result;await wait(20);}throw new Error('等待超时：'+label);}

test('换绑后旧模型不能投递，原消息可以按新身份重试',async t=>{
  let release;
  const f=await fixture(t,(body,res)=>{
    if(body.messages[0].content.includes('只回答旧身份蓝')){
      release=()=>res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'我是蓝'}}]}));
    }else{
      assert.match(body.messages[0].content,/只回答新身份橙/);
      res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'我是橙'}}]}));
    }
  },{disableAutomaticSchedules:true});
  const action=async(type,payload)=>{
    const result=await f.request('/api/action',{type,payload});
    assert.equal(result.status,200);
    return result.body.state;
  };
  const add=async(name,prompt)=>(await action('rolePersona.save',{name,prompt})).rolePersonas.find(p=>p.name===name).id;
  const blue=await add('蓝','只回答旧身份蓝'),orange=await add('橙','只回答新身份橙');
  const bind=(id,expectedPersonaId)=>action('rolePersona.bind',{id,changes:[{roleId:f.roleId,selected:true,expectedPersonaId}]});
  await bind(blue,'');
  const sent=await f.request('/api/chat',{roleId:f.roleId,text:'现在是谁？',requestId:randomUUID()});
  await until(()=>release,'蓝的请求已开始');
  await bind(orange,blue);
  release();
  const id=sent.body.messageId;
  assert.match((await f.read()).messages.find(m=>m.id===id).error,/人设已更新/);
  assert.equal((await f.request('/api/chat/retry',{messageId:id})).status,200);
  await until(async()=>(await f.read()).messages.some(m=>m.content==='我是橙'),'新身份回复');
  assert.ok(!(await f.read()).messages.some(m=>m.content==='我是蓝'));
});

test('聊天HTTP按需选择引用和撤回，下一轮舍弃候选；只查询后仍须给用户回复',async t=>{
  const ask='明天下午三点面试',quoted='我记住你的时间了。';
  let phase='first',retried=false,chosen=null;
  function tool(name,args,suffix){
    return {role:'assistant',content:null,tool_calls:[{id:phase+'-'+suffix,type:'function',function:{name,arguments:JSON.stringify(args)}}]};
  }
  const f=await fixture(t,(body,res)=>{
    const last=body.messages.at(-1);
    const say=content=>({role:'assistant',content});
    let message;
    if(phase==='first')message=say('好。');
    else if(last.tool_call_id===phase+'-pick'){
      if(phase==='lookup'&&!retried){retried=true;message=say('');}
      else if(phase==='lookup')message=say('找到了。');
      else{
        chosen=JSON.parse(last.content).messages?.[0];
        message=chosen
          ?phase==='quote'?tool('reply_quote',{messageId:chosen.messageId,text:'[消息ID：'+chosen.messageId+'] '+quoted},'act'):tool('recall_message',{messageId:chosen.messageId},'act')
          :say('没有匹配的消息。');
      }
    }else if(last.tool_call_id===phase+'-act')message=say(phase==='quote'?'':'已经撤回。');
    else message=tool('select_message_targets',phase==='recall'?{action:'recall_message',query:quoted}:{action:'reply_quote',query:ask},'pick');
    res.end(JSON.stringify({choices:[{message}]}));
  });
  async function send(nextPhase,text){
    phase=nextPhase;
    const start=f.requests.length;
    const sent=await f.request('/api/chat',{roleId:f.roleId,text,requestId:randomUUID()});
    assert.equal(sent.status,200);
    await until(()=>{
      const state=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
      const run=Object.values(state.engine.data.execution.runs).find(r=>r.targetId===sent.body.messageId);
      if(run?.status==='failed')throw Error(run.error);
      return run?.status==='completed';
    },text);
    return {id:sent.body.messageId,state:await f.read(),calls:f.requests.slice(start).map(r=>r.body)};
  }
  // This upstream only simulates chat. Keep the appointment example out of the schedule worker.
  assert.equal((await f.request('/api/engine/modules',{id:'schedule',values:{chatChangeEnabled:false}})).status,200);
  const first=await send('first',ask);
  const quotedTurn=await send('quote','请引用我刚才说的面试时间。');
  const ordinary=quotedTurn.calls[0].messages.filter(m=>['user','assistant'].includes(m.role)).map(m=>m.content);
  assert.ok(ordinary.includes(ask));
  assert.ok(ordinary.includes('好。'));
  assert.ok(ordinary.every(content=>typeof content==='string'&&!content.includes(first.id)));
  assert.equal(chosen.messageId,first.id);
  const quote=quotedTurn.state.messages.find(m=>m.meta?.quote?.messageId===first.id);
  assert.ok(quote);assert.equal(quote.content,quoted);assert.equal(quote.meta.quote.content,ask);

  const recall=await send('recall','撤回你刚才那条引用回复。');
  assert.ok(!recall.calls[0].messages.some(m=>m.tool_call_id==='quote-pick'||m.tool_calls?.some(c=>c.function.name==='select_message_targets')));
  assert.equal(chosen.messageId,quote.id);
  assert.equal(recall.state.messages.find(m=>m.id===quote.id).meta.kind,'recalled');
  assert.equal(recall.state.messages.find(m=>m.id===first.id).content,ask);
  assert.equal(recall.state.messages.at(-1).content,'已经撤回。');

  const lookup=await send('lookup','之前那句话你找到了吗？');
  assert.ok(!lookup.calls[0].messages.some(m=>m.tool_call_id==='recall-pick'||m.tool_calls?.some(c=>c.function.name==='select_message_targets')));
  assert.ok(retried);
  assert.equal(lookup.calls.filter(body=>body.messages.at(-1).tool_call_id==='lookup-pick').length,2);
  assert.equal(lookup.state.messages.at(-1).content,'找到了。');
});

test('聊天HTTP重启后重试旧分段只续发未送达正文，原来的消息关联保留',async t=>{
  const f=await fixture(t),S=require('../lib/state.cjs'),E=require('../lib/engine/execution.cjs');
  const isolated=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  const friend=S.role(isolated,f.roleId);
  const user=S.message(isolated,friend,'user','继续刚才的话。','text',{status:'pending'});
  const first=S.message(isolated,friend,'assistant','我在。');
  const run=E.start(isolated,{id:'previous-build',roleId:f.roleId});
  Object.assign(run,{targetId:user.id,memoryRead:null,answer:'我在。\n'+user.id+' 慢慢说。',segments:['我在。',user.id+' 慢慢说。'],delivered:1});
  f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(isolated));
  await f.restart();
  assert.equal((await f.read()).messages.find(m=>m.id===user.id).status,'error');
  const response=await f.request('/api/chat/retry',{messageId:user.id});
  assert.equal(response.status,200);
  const state=await until(async()=>{
    const state=await f.read();
    return state.messages.some(m=>m.roleId===f.roleId&&m.content.includes('慢慢说。'))&&state;
  },'恢复未送达的第二句');
  assert.deepEqual(state.messages.filter(m=>m.sender==='assistant'&&m.roleId===f.roleId&&m.status==='sent').map(m=>m.content),['我在。','慢慢说。']);
  assert.equal(state.messages.find(m=>m.id===first.id).content,'我在。');
  assert.equal(state.messages.find(m=>m.id===user.id).status,'sent');
  const saved=(await f.request('/api/backup')).body.state.messages;
  assert.equal(saved.find(m=>m.id===state.messages.at(-1).id).content,'慢慢说。');
  assert.equal(f.requests.length,0);
});

test('image HTTP modes: plain drawing, exact quoted edits and wardrobe portraits reach the right upstream inputs',async t=>{
  const S=require('../lib/state.cjs');
  const {SELFIE_STYLE,LEGACY_SELFIE_STYLE}=require('../lib/engine/photo-core.cjs');
  const fixtures=names=>names.map(name=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../public/vendor/model-brands',`${name}.png`)).toString('base64'));
  const [quoteImage,latestImage,faceImage,outfitImage]=fixtures(['openai','minimax','siliconflow','qwen']);
  const png=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/receipt.png')).toString('base64');
  let tool,toolReply;
  const f=await fixture(t,(body,res,requests)=>{
    if(requests.at(-1).url.includes('/images/')){res.end(JSON.stringify({data:[{b64_json:png}]}));return;}
    if(body.messages.at(-1).role==='tool')toolReply=JSON.parse(body.messages.at(-1).content);
    const message=body.messages.at(-1).role==='tool'
      ?{role:'assistant',content:toolReply.error?'请引用一下那张原图。':'给你。'}
      :{role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]};
    res.end(JSON.stringify({choices:[{message}]}));
  });
  const ai=(await f.read()).settings.ai;
  ai.models.push({id:'test-image',sourceId:'test',model:'isolated-image',kind:'image',capabilities:[],extraBody:{image:'预设图片',reference_images:['预设参考图'],mask:'预设蒙版',quality:'standard'}});
  ai.assign.image='test-image';
  assert.equal((await f.request('/api/engine/models',{ai})).status,200);
  const state=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json),role=S.role(state,f.roleId);
  const identityImages=[faceImage,quoteImage,latestImage];
  role.faceReferences=identityImages;
  state.settings.timezone='UTC';
  state.settings.modules.schedule={...state.settings.modules.schedule,enabled:true,autoGenerate:false};
  state.settings.modules.selfie={...state.settings.modules.selfie,enabled:true,stylePrompt:LEGACY_SELFIE_STYLE};
  state.engine.data.schedule.days={[role.id]:{day:new Date().toISOString().slice(0,10),outfits:{outdoor:{description:'验收灰外套',image:outfitImage}},slots:[{start:'00:00',end:'23:59',restType:'none',activity:'看窗外',scene:'验收窗边',outfitType:'outdoor'}]}};
  const quoted=S.message(state,role,'assistant',quoteImage,'image');
  S.message(state,role,'user',latestImage,'image');
  const unavailable=S.message(state,role,'assistant','/api/media/'+'d'.repeat(64)+'.png','image');
  f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
  assert.equal((await f.request('/api/engine/config')).body.settings.selfie.stylePrompt,SELFIE_STYLE);

  async function send(text,name,args,media={}){
    const initial=f.requests.length;
    tool={name,args};toolReply=null;
    const result=await f.request('/api/chat',{roleId:role.id,requestId:randomUUID(),text,...media});
    assert.equal(result.status,200);
    await until(()=>{
      const latest=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
      const run=Object.values(latest.engine.data.execution.runs).find(row=>row.targetId===result.body.messageId);
      if(run?.status==='failed')throw new Error(run.error);
      return run?.status==='completed';
    },text);
    return f.requests.slice(initial).filter(request=>request.url.includes('/images/'));
  }
  async function editParts(request){
    assert.equal(request.url,'/v1/images/edits');
    const form=await new Response(request.multipart,{headers:{'Content-Type':request.contentType}}).formData();
    assert.ok(!form.has('image')&&!form.has('reference_images')&&!form.has('mask'));
    assert.equal(form.get('quality'),'standard');
    return {prompt:form.get('prompt'),images:await Promise.all(form.getAll('image[]').map(async file=>'data:'+file.type+';base64,'+Buffer.from(await file.arrayBuffer()).toString('base64')))};
  }
  function assertSnapshotPrompt(prompt){
    assert.ok(prompt.includes(SELFIE_STYLE));
    assert.equal(prompt.split(SELFIE_STYLE).length,2);
    assert.equal(prompt.match(/^参考图[1-3]：角色身份/gm)?.length,3);
    assert.match(prompt,/三视图只用来认长相/);
    assert.match(prompt,/参考图2、3只补主参考图看不到的脸部角度和遮挡细节/);
    assert.doesNotMatch(prompt,/延续主参考图的画风和质感|画风沿用原图|手机前置随手拍质感|棚拍柔光|磨皮拉满|电影感光效|45\s*[度°]|回眸/);
    const aiDetails=prompt.split('\n').filter(line=>line.startsWith('具体画面（模型补充）')||line.startsWith('本张具体拍摄方案')).join('\n');
    assert.doesNotMatch(aiDetails,/固定机位|固定姿势/);
  }
  const drawText='给我画个排风井，不要人物。';
  const [draw]=await send(drawText,'generate_image',{prompt:'通风设施的线稿',mode:'text',sendToChat:true},{quoteId:quoted.id});
  assert.equal(draw.url,'/v1/images/generations');
  assert.ok(draw.body.prompt.includes(drawText));
  assert.doesNotMatch(draw.body.prompt,/验收窗边|验收灰外套/);
  assert.equal(draw.multipart,undefined);
  assert.ok(!Object.hasOwn(draw.body,'image')&&!Object.hasOwn(draw.body,'reference_images')&&!Object.hasOwn(draw.body,'mask'));
  assert.equal(draw.body.quality,'standard');

  const editText='把这张自拍的背景改蓝，只改背景。';
  const [quotedEdit]=await send(editText,'generate_image',{prompt:'换蓝色背景',mode:'edit',sendToChat:true},{quoteId:quoted.id,image:latestImage});
  const edited=await editParts(quotedEdit);
  assert.deepEqual(edited.images,[quoteImage]);
  assert.ok(edited.prompt.includes(editText));
  assert.doesNotMatch(edited.prompt,/验收窗边|验收灰外套/);
  const [uploadEdit]=await send('把这张刚发的图改成黑白。','generate_image',{prompt:'黑白',mode:'edit',sendToChat:true},{image:latestImage});
  assert.deepEqual((await editParts(uploadEdit)).images,[latestImage]);
  assert.deepEqual(await send('改一下图片','generate_image',{prompt:'背景改红',mode:'edit',sendToChat:true}),[]);
  assert.match(toolReply.error,/发送或引用/);
  const missingWaiting='我先找一下那张原图。';
  assert.deepEqual(await send('把这张图换背景','generate_image',{prompt:'背景改红',mode:'edit',sendToChat:true,waitingText:missingWaiting},{quoteId:unavailable.id}),[]);
  assert.match(toolReply.error,/原文件暂时无法读取.*重新发送或引用/);
  assert.ok(!(await f.read()).messages.some(m=>m.content===missingWaiting));

  const selfieText='拍一张今天的穿搭，别露牙。';
  const [portrait]=await send(selfieText,'send_selfie',{prompt:'在窗边拍，露齿大笑',kind:'outfit',shotPlan:[{angle:'侧面',expression:'露齿大笑'}]});
  const selfie=await editParts(portrait);
  assert.deepEqual(selfie.images,[...identityImages,outfitImage]);
  assert.ok(selfie.prompt.includes(selfieText));
  assert.match(selfie.prompt,/只参考衣服|仅参考.*服装/);
  assert.match(selfie.prompt,/侧面/);
  assert.doesNotMatch(selfie.prompt,/露齿大笑/);

  const singleText='拍一张你在窗边的自拍，随手拍就好。';
  const [single]=await send(singleText,'send_selfie',{kind:'selfie',prompt:'坐在窗边，棚拍柔光，磨皮拉满，电影感光效',shotPlan:[{angle:'眼平，固定45度机位',action:'整理袖口，每张都回眸'}]});
  const singleParts=await editParts(single);
  assertSnapshotPrompt(singleParts.prompt);
  assert.ok(singleParts.prompt.includes(singleText));
  assert.match(singleParts.prompt,/眼平/);
  assert.match(singleParts.prompt,/整理袖口/);
  assert.deepEqual(singleParts.images,[...identityImages,outfitImage]);

  const groupText='就现在随手拍两张自拍。';
  const checkGroup=async args=>{
    const sent=await send(groupText,'send_selfie',{kind:'selfie',count:2,...args});
    assert.equal(sent.length,2);
    const group=await Promise.all(sent.map(editParts));
    for(const {prompt} of group){
      assertSnapshotPrompt(prompt);
      assert.ok(prompt.includes(groupText));
      assert.match(prompt,/同一套衣服和同一个场景/);
    }
    assert.deepEqual(group[0].images,[...identityImages,outfitImage]);
    assert.deepEqual(group[1].images,[...identityImages,outfitImage,'data:image/png;base64,'+png]);
    return group;
  };
  await checkGroup({prompt:'坐在窗边随手拍'});
  const planned=await checkGroup({prompt:'坐在窗边，电影感光效',shotPlan:[{angle:'眼平，固定机位',action:'合上书，固定45°回眸'},{action:'看向窗外，棚拍柔光，固定姿势',expression:'神情放松，磨皮拉满'}]});
  assert.match(planned[0].prompt,/合上书/);
  assert.match(planned[1].prompt,/看向窗外/);

  const scenery=await send('给我两张你窗外现在的风景。','send_selfie',{prompt:'拍给我看，窗外实景',kind:'scene',count:2});
  assert.deepEqual(scenery.map(request=>request.url),['/v1/images/generations','/v1/images/generations']);
  assert.ok(scenery.every(request=>request.body.prompt.includes('验收窗边')));
  const [vertical]=await send('拍一张 9:16 的窗外风景，不要人物。','send_selfie',{prompt:'窗外实景',kind:'scene'});
  assert.equal(vertical.body.size,'1152x2048');
});

test('旧自主活动接口停用，日程、主动信息、自动发圈和提醒仍在功能配置中',async t=>{
  const f=await fixture(t);
  const before=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  for(const path of ['autonomy','autonomy/preview','autonomy/policy']){
    assert.equal((await f.request('/api/engine/'+path,{roleId:f.roleId,routine:'午后休息',enabled:true})).status,404);
  }
  const config=await f.request('/api/engine/config');
  assert.equal(config.status,200);
  const modules=config.body.modules.map(m=>m.id);
  assert.ok(!modules.includes('autonomy'));
  assert.ok(!Object.hasOwn(config.body,'autonomy'));
  for(const moduleId of ['schedule','outreach','life-moments','scheduler'])assert.ok(modules.includes(moduleId));
  assert.equal(f.requests.length,0);
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
});

test('engine API: unsaved model discovery does not persist credentials; config/backup redact keys and modules validate',async t=>{
  const f=await fixture(t),before=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  const listed=await f.request('/api/engine/models/list',{baseUrl:f.source,key:'TEMP_LOOKUP_ONLY'});assert.equal(listed.status,200);assert.equal(listed.body.models[0].id,'isolated-chat');
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
  for(const route of ['/api/engine/config','/api/state','/api/backup']){const response=await f.request(route);assert.equal(response.status,200);assert.ok(!JSON.stringify(response.body).includes(KEY));}
  assert.equal((await f.request('/api/engine/modules',{id:'waiting',values:{idleSeconds:31,maxWaitSeconds:2}})).status,400);
  assert.equal(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);
  const config=(await f.request('/api/engine/config')).body;assert.equal(config.timezone,'');assert.equal(config.settings.waiting.idleSeconds,0.05);assert.ok(config.catalog['gpt-4o']);
  assert.equal((await f.request('/api/engine/timezone',{timezone:'Asia/Shanghai'})).status,200);
  assert.equal((await f.request('/api/engine/config')).body.timezone,'Asia/Shanghai');
});

test('engine HTTP: send returns before generation, burst combines, usage and backup survive restart',async t=>{
  const f=await fixture(t);const before=f.requests.length;
  assert.equal((await f.request('/api/engine/modules',{id:'waiting',values:{idleSeconds:1,maxWaitSeconds:6}})).status,200);
  const ids=[];
  for(const text of ['一','二','三']){
    const r=await f.request('/api/chat',{roleId:f.roleId,text,requestId:randomUUID()});assert.equal(r.status,200);assert.equal(r.body.accepted,true);ids.push(r.body.messageId);assert.equal(r.body.state.messages.find(m=>m.id===r.body.messageId).status,'pending');
  }
  const sent=await until(async()=>{const s=await f.read();return ids.every(id=>s.messages.find(m=>m.id===id).status==='sent')&&s.messages.some(m=>m.content==='第二句！')&&s;},'三条合并回复');
  assert.equal(f.requests.length-before,1);assert.equal(sent.messages.filter(m=>m.sender==='assistant'&&m.status==='sent').length,2);
  const payload=JSON.stringify(f.requests.at(-1).body);for(const text of ['一','二','三'])assert.ok(payload.includes(text));
  const usage=(await f.request('/api/engine/config')).body.usage;assert.equal(usage.length,1);assert.equal(usage[0].count,1);assert.equal(usage[0].inputTokens,10);
  await f.restart();assert.equal((await f.read()).messages.filter(m=>ids.includes(m.id)).length,3);assert.deepEqual((await f.request('/api/engine/config')).body.usage,usage);
});

test('engine events: login required, revisions and typing delivered, logout closes the stream',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/events',undefined,{anonymous:true})).status,401);
  const controller=new AbortController(),response=await fetch(f.base+'/api/events',{headers:{Cookie:f.cookie},signal:controller.signal});
  assert.equal(response.headers.get('content-type'),'text/event-stream; charset=utf-8');
  const reader=response.body.getReader();let events='';
  const consume=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;events+=new TextDecoder().decode(value);}})();
  const r=await f.request('/api/chat',{roleId:f.roleId,text:'实时送达',requestId:randomUUID()});assert.equal(r.status,200);
  await until(()=>events.includes('"typing":true')&&events.includes('"typing":false'),'typing与revision');
  assert.ok(events.includes('event: revision'));assert.ok(events.includes('event: typing'));
  assert.equal((await f.request('/api/logout',{})).status,200);await consume;assert.equal((await f.request('/api/state')).status,401);
});

test('engine tools HTTP: received redpacket, pat and final reply persist without exposing intermediate calls',async t=>{
  const f=await fixture(t,(body,res)=>{
    const message=body.messages.some(m=>m.role==='tool')?{role:'assistant',content:'已经收到了，谢谢你！'}:{role:'assistant',content:null,tool_calls:[{id:'pay',type:'function',function:{name:'handle_payment',arguments:JSON.stringify({id:transactionId,action:'receive'})}},{id:'pat',type:'function',function:{name:'pat_user',arguments:'{}'}}]};
    res.end(JSON.stringify({choices:[{message}]}));
  });
  let transactionId;
  const sent=await f.request('/api/action',{type:'wallet.transfer',payload:{roleId:f.roleId,type:'redpacket',amountCents:100,note:'给你的',requestId:randomUUID()}});
  assert.equal(sent.status,200);transactionId=sent.body.state.wallet.transactions.at(-1).id;assert.equal(sent.body.state.wallet.transactions.at(-1).status,'pending');
  await f.request('/api/chat',{roleId:f.roleId,text:'收一下红包',requestId:randomUUID()});
  const state=await until(async()=>{const s=await f.read();return s.messages.some(m=>m.content==='已经收到了，谢谢你！')&&s;},'收红包工具');
  assert.equal(state.wallet.transactions.at(-1).status,'received');assert.equal(state.wallet.roleBalances[f.roleId],100100);assert.ok(state.messages.some(m=>m.meta?.kind==='pat'&&m.meta.author===f.roleId));assert.ok(!state.messages.some(m=>m.type==='tool'));
});

test('engine tools HTTP: permission gates reach provider, yuan payment executes, disabled and unsupported tools stay absent',async t=>{
  let phase='enabled';
  const f=await fixture(t,(body,res)=>{
    const message=phase==='enabled'&&!body.messages.some(m=>m.role==='tool')
      ?{role:'assistant',content:null,tool_calls:[{id:'yuan-payment',type:'function',function:{name:'send_redpacket',arguments:JSON.stringify({amountYuan:8.88,note:'八块八毛八'})}},{id:'permission-pat',type:'function',function:{name:'pat_user',arguments:'{}'}}]}
      :{role:'assistant',content:phase==='enabled'?'权限开启完成。':phase==='disabled'?'权限关闭完成。':'无工具能力完成。'};
    res.end(JSON.stringify({choices:[{message}]}));
  });
  // Only this fixture's temporary database is prepared; no production state or external providers.
  const edit=fn=>{const state=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);fn(state);f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));};
  edit(state=>{
    const role=state.roles.find(r=>r.id===f.roleId);role.permissions.onlyChat=false;role.voiceMode='emotional';
    role.stickers=[{id:'isolated-sticker',name:'隔离表情',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII='}];
    const template=state.settings.ai.models.find(m=>m.id==='main');
    state.settings.ai.models.push({...template,id:'isolated-tts',kind:'tts',capabilities:[]},{...template,id:'isolated-image',kind:'image',capabilities:[]});
    state.settings.ai.assign.tts='isolated-tts';state.settings.ai.assign.image='isolated-image';
    state.settings.modules.voice={...state.settings.modules.voice,enabled:true};state.settings.modules.selfie={...state.settings.modules.selfie,enabled:true};
  });
  const gates=['allowImages','allowStickers','allowQuote','allowRecall','allowPat','allowMoments','allowProfile','allowPayments','allowReminders'];
  const expected=['send_voice','generate_image','send_image','send_selfie','search_stickers','send_sticker','reply_quote','recall_message','pat_user','post_moment','like_moment','comment_moment','update_own_profile','send_redpacket','send_transfer','handle_payment','future_task'];
  const names=body=>(body.tools||[]).map(tool=>tool.function.name);
  const send=async(text,answer)=>{const result=await f.request('/api/chat',{roleId:f.roleId,text,requestId:randomUUID()});assert.equal(result.status,200);return until(async()=>{const state=await f.read();return state.messages.some(m=>m.sender==='assistant'&&m.content===answer)&&state;},answer);};
  assert.equal((await f.request('/api/engine/modules',{id:'actions',values:Object.fromEntries(gates.map(key=>[key,true]))})).status,200);
  const initial=f.requests.length,state=await send('请给我8.88元红包并拍一拍','权限开启完成。');
  const enabled=f.requests.slice(initial);assert.equal(enabled.length,2);for(const name of expected)assert.ok(names(enabled[0].body).includes(name),name);
  const payment=state.wallet.transactions.find(row=>row.note==='八块八毛八');assert.ok(payment,JSON.stringify(enabled[1].body.messages.filter(m=>m.role==='tool')));assert.equal(payment.amountCents,888);assert.equal(payment.direction,'in');
  const bubble=state.messages.find(m=>m.meta?.transactionId===payment.id);assert.equal(bubble.sender,'assistant');assert.equal(bubble.meta.amountCents,888);
  assert.ok(state.messages.some(m=>m.meta?.kind==='pat'&&m.meta.author===f.roleId));
  const paymentReply=enabled[1].body.messages.find(m=>m.role==='tool'&&m.tool_call_id==='yuan-payment');assert.ok(paymentReply);assert.equal(JSON.parse(paymentReply.content).amountYuan,8.88);
  phase='disabled';assert.equal((await f.request('/api/engine/modules',{id:'actions',values:Object.fromEntries(gates.map(key=>[key,false]))})).status,200);
  edit(s=>{s.settings.modules.actions.allowVoice=false;});
  const disabledStart=f.requests.length;await send('只用文字回应','权限关闭完成。');for(const name of expected)assert.ok(!names(f.requests[disabledStart].body).includes(name),name);
  phase='unsupported';assert.equal((await f.request('/api/engine/modules',{id:'actions',values:Object.fromEntries(gates.map(key=>[key,true]))})).status,200);
  edit(s=>{s.settings.ai.models.find(m=>m.id==='main').capabilities=['text'];});
  const unsupportedStart=f.requests.length;await send('没有工具能力也请回应','无工具能力完成。');assert.equal(f.requests[unsupportedStart].body.tools,undefined);
});

test('voice tool uses the friend voice, ends on success and requests a text reply on failure',async t=>{
  const say='今天下午三点（北京时间）再聊。';
  const middle='听我说。我今天想早点睡。';
  const long='这段约定要完整发出去。'.repeat(90)+'\n最后一句也保留。';
  const recovery={long:'我先把约定的重点写给你。',failure:'刚想到你，就发条消息问问。',offDuringTts:'我打字告诉你。'};
  const queuedVoiceCases=['offSame','offOnly','offDifferent'];
  let mode='text',releaseReply;
  const f=await fixture(t,(body,res,requests)=>{
    if(requests.at(-1).url.includes('/text-to-speech/')){
      if(mode==='failure'){res.statusCode=422;res.end('{}');return;}
      res.setHeader('Content-Type','audio/mpeg');
      const sendAudio=()=>res.end(fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3')));
      if(mode==='offDuringTts')releaseReply=sendAudio;else sendAudio();
      return;
    }
    const spoken=mode==='short'?say:mode==='long'?long:mode==='middle'?middle:mode==='singleWithText'?'周六我在书店等你。':mode==='offDuringTts'?'合成时关闭语音也能收到这句。':'我想念你（今天尤其想）。';
    const authored=mode==='middle'?'听我说。[耳语]我今天想早点睡。[轻笑]':'[轻笑][停顿][耳语]'+spoken;
    const tool=body.tools?.some(t=>t.function.name==='send_voice');
    const afterTool=body.messages.at(-1).role==='tool';
    const message=mode!=='text'&&tool&&!afterTool
      ?{role:'assistant',content:mode==='singleWithText'?'周日我在车站等你。':null,tool_calls:[{id:'voice',type:'function',function:{name:'send_voice',arguments:JSON.stringify({text:authored})}}]}
      :{role:'assistant',content:mode==='text'?'普通的文字回复。':recovery[mode]||spoken};
    // A second, read-only tool keeps these queued-voice tests in a live turn.
    if(message.tool_calls&&queuedVoiceCases.includes(mode)){
      message.tool_calls.push({id:'lookup',type:'function',function:{name:'select_message_targets',arguments:JSON.stringify({action:'reply_quote'})}});
    }
    if(afterTool&&queuedVoiceCases.includes(mode)){
      if(mode==='offOnly')message.content='';
      if(mode==='offDifferent')message.content='我明天再问你。';
      releaseReply=()=>res.end(JSON.stringify({choices:[{message}]}));
    }else res.end(JSON.stringify({choices:[{message}]}));
  },{disableAutomaticSchedules:true});
  const panel=async()=>(await f.request('/api/engine/life?roleId='+f.roleId)).body;
  const available={modelReady:true,enabled:true,friendEnabled:true};
  assert.deepEqual((await panel()).voiceAvailability,{...available,modelReady:false,enabled:false});
  const setGlobal=enabled=>f.request('/api/engine/modules',{id:'voice',values:{enabled}});
  assert.equal((await setGlobal(true)).status,400);
  const config=(await f.request('/api/engine/config')).body;
  assert.deepEqual(config.modules.find(m=>m.id==='voice').settings.map(s=>s.key),['enabled']);
  assert.ok(!config.modules.find(m=>m.id==='actions').settings.some(s=>s.key==='allowVoice'));
  const ai=(await f.read()).settings.ai;
  ai.sources.push({id:'voice-provider',name:'隔离语音',baseUrl:f.source,key:KEY,template:'breezeblue'});
  ai.models.push({...ai.models[0],id:'voice-model',sourceId:'voice-provider',kind:'tts',model:'breeze-tts-2',capabilities:[],voice:'default-voice'});
  ai.models.push({...ai.models.at(-1),id:'voice-alternative',model:'isolated-speech-alternative'});
  ai.assign.tts='voice-model';
  assert.equal((await f.request('/api/engine/models',{ai})).status,200);
  assert.equal((await f.request('/api/action',{type:'role.save',payload:{id:f.roleId,voiceId:'friend-voice',voiceMode:'on'}})).status,200);
  assert.deepEqual((await panel()).voiceAvailability,available);
  const saveVoice=(tts,enabled)=>f.request('/api/engine/modules',{id:'voice',tts,values:{enabled}});
  assert.equal((await saveVoice('main',false)).status,400);
  assert.equal((await saveVoice('',true)).status,400);
  assert.equal((await f.read()).settings.ai.assign.tts,'voice-model');
  assert.deepEqual((await panel()).voiceAvailability,available);
  const switched=await saveVoice('voice-alternative',true);
  assert.equal(switched.status,200);
  assert.equal(switched.body.state.settings.ai.assign.tts,'voice-alternative');
  assert.equal(switched.body.state.settings.ai.assign.chat,'main');
  assert.equal(switched.body.state.settings.ai.sources.find(source=>source.id==='voice-provider').keySet,true);
  const syntheses=()=>f.requests.filter(r=>r.url.includes('/text-to-speech/'));
  const waitCompleted=targetId=>until(()=>{
    const data=JSON.parse(f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
    return Object.values(data.engine.data.execution.runs).some(run=>run.targetId===targetId&&run.status==='completed');
  },'语音测试回合完成');
  const assertModelRecovery=(requestFrom,message)=>{
    assert.equal(message.type,'text');
    assert.ok(!message.meta?.audio&&!message.meta?.degradedFromVoice);
    const replies=f.requests.slice(requestFrom).map(r=>r.body.messages?.at(-1)).filter(m=>m?.role==='tool'&&m.tool_call_id==='voice');
    assert.equal(replies.length,1);
    const result=JSON.parse(replies[0].content);
    assert.equal(result.delivered,'failed');
    assert.match(result.error,/普通文字/);
  };
  const send=async(phase,expected)=>{
    mode=phase;
    const before=(await f.read()).messages.filter(m=>m.sender==='assistant'&&m.status==='sent').length;
    const sent=await f.request('/api/chat',{roleId:f.roleId,text:'测试 '+phase,requestId:randomUUID()});
    assert.equal(sent.status,200);
    await waitCompleted(sent.body.messageId);
    const answer=(await f.read()).messages.filter(m=>m.sender==='assistant'&&m.status==='sent').slice(before);
    assert.equal(answer.length,1);
    assert.equal(answer[0].content,expected);
    return answer[0];
  };
  assert.equal((await send('text','普通的文字回复。')).type,'text');
  assert.equal(syntheses().length,0);
  const voice=await send('short',say);
  assert.equal(voice.type,'voice');
  assert.equal(voice.meta.transcript,say);
  assert.match(syntheses()[0].url,/friend-voice/);
  assert.equal(syntheses()[0].body.model_id,'isolated-speech-alternative');
  assert.equal(syntheses()[0].body.text,'[轻笑]'+say);
  assert.equal((await send('middle',middle)).type,'voice');
  assert.equal(syntheses()[1].body.text,middle);
  let requestFrom=f.requests.length;
  assertModelRecovery(requestFrom,await send('long',recovery.long));
  assert.equal(syntheses().length,2);
  requestFrom=f.requests.length;
  assertModelRecovery(requestFrom,await send('failure',recovery.failure));
  assert.ok(syntheses().length>2);
  requestFrom=f.requests.length;
  assert.equal((await send('singleWithText','周六我在书店等你。')).type,'voice');
  const singleVoiceRequests=f.requests.slice(requestFrom).map(r=>r.body.messages?.at(-1));
  assert.equal(singleVoiceRequests.filter(m=>m?.role==='user').length,1);
  assert.ok(!singleVoiceRequests.some(m=>m?.role==='tool'&&m.tool_call_id==='voice'));
  for(const phase of [...queuedVoiceCases,'offDuringTts']){
    mode=phase;releaseReply=undefined;
    requestFrom=f.requests.length;
    const previous=(await f.read()).messages.length;
    const sent=await f.request('/api/chat',{roleId:f.roleId,text:'在途关闭 '+phase,requestId:randomUUID()});
    assert.equal(sent.status,200);
    await until(()=>releaseReply,'等待关闭语音的时机 '+phase);
    assert.equal((await setGlobal(false)).status,200);
    releaseReply();
    await waitCompleted(sent.body.messageId);
    const received=(await f.read()).messages.slice(previous).filter(m=>m.sender==='assistant');
    const texts=phase==='offDifferent'?['我想念你（今天尤其想）。','我明天再问你。']:phase==='offDuringTts'?[recovery.offDuringTts]:['我想念你（今天尤其想）。'];
    assert.deepEqual(received.map(m=>m.content).sort(),texts.sort(),phase);
    assert.ok(received.every(m=>m.type==='text'&&!m.meta?.audio));
    if(phase==='offDuringTts')assertModelRecovery(requestFrom,received[0]);
    assert.equal((await setGlobal(true)).status,200);
  }
  assert.equal((await f.request('/api/action',{type:'role.save',payload:{id:f.roleId,voiceMode:'off'}})).status,200);
  assert.deepEqual((await panel()).voiceAvailability,{...available,friendEnabled:false});
  const before=f.requests.length;
  await send('text','普通的文字回复。');
  assert.ok(!f.requests[before].body.tools.some(t=>t.function.name==='send_voice'));
  await f.restart();
  const oldRole=(await panel()).role;
  assert.equal(oldRole.voiceId,'friend-voice');
  assert.equal(oldRole.voiceMode,'off');

  const db=f.app.db;
  const saved=JSON.parse(db.prepare('SELECT json FROM app WHERE id=1').get().json);
  saved.settings.modules.voice={enabled:false,defaultMode:'often',stripBrackets:true};
  saved.settings.modules.actions={...saved.settings.modules.actions,allowVoice:false};
  saved.roles.find(r=>r.id===f.roleId).voiceMode='often';
  db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(saved));
  assert.deepEqual((await panel()).voiceAvailability,{...available,enabled:false});
  const S=require('../lib/state.cjs');
  const backup={format:'pipi-phone',version:1,state:S.backupState(saved)};
  assert.equal(S.validateBackup(backup,saved).settings.modules.actions.allowVoice,false);
  assert.equal((await f.request('/api/action',{type:'role.save',payload:{id:f.roleId,voiceMode:'on'}})).status,200);
  assert.deepEqual((await panel()).voiceAvailability,{...available,enabled:false});
  const legacyOff=f.requests.length;
  await send('text','普通的文字回复。');
  assert.ok(!f.requests[legacyOff].body.tools.some(t=>t.function.name==='send_voice'));
  assert.equal((await setGlobal(true)).status,200);
  assert.deepEqual((await panel()).voiceAvailability,available);
  const reopened=f.requests.length;
  await send('text','普通的文字回复。');
  assert.ok(f.requests[reopened].body.tools.some(t=>t.function.name==='send_voice'));
  assert.equal((await setGlobal(false)).status,200);
  await f.restart();
  const disabled=await panel();
  assert.deepEqual(disabled.voiceAvailability,{...available,enabled:false});
  assert.equal(disabled.role.voiceId,'friend-voice');
  assert.equal(disabled.role.voiceMode,'on');
});

test('engine error: upstream failure is reported on the accepted message and retry succeeds',async t=>{
  const timers=require('node:timers/promises'),waits=[];
  t.mock.method(timers,'setTimeout',async(ms,value,options)=>{
    if(![1000,2000,4000,8000].includes(ms))return wait(ms,value,options);
    options?.signal?.throwIfAborted();
    waits.push(ms);
  });
  let fail=true;const f=await fixture(t,(_,res)=>{if(fail){res.statusCode=503;res.end('{}');}else res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'重试成功'}}]}));});
  const r=await f.request('/api/chat',{roleId:f.roleId,text:'失败后重试',requestId:randomUUID()});assert.equal(r.status,200);
  const failed=await until(async()=>{const m=(await f.read()).messages.find(x=>x.id===r.body.messageId);return m.status==='error'&&m;},'错误状态');assert.match(failed.error,/503/);
  assert.deepEqual(waits,[1000,2000,4000,8000]);
  fail=false;assert.equal((await f.request('/api/chat/retry',{messageId:failed.id})).status,200);
  await until(async()=>(await f.read()).messages.some(m=>m.content==='重试成功'),'重试送达');
});
