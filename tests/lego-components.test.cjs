// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const S=require('../lib/state.cjs');
const R=require('../lib/engine/registry.cjs');
const D=require('../lib/engine/delivery.cjs');
const A=require('../lib/engine/actions.cjs');
const M=require('../lib/engine/models.cjs');
const Runtime=require('../lib/engine/runtime.cjs');
const SystemOne=require('../lib/engine/system-one.cjs');
const Schedule=require('../lib/engine/modules/schedule.cjs');
const Voice=require('../lib/engine/modules/voice.cjs');
const Selfie=require('../lib/engine/modules/selfie.cjs');
const Memory=require('../lib/engine/modules/memory.cjs');
const {createApp}=require('../scripts/sample-data.cjs');

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=';
const MP3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,timeout=3000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw new Error('timeout waiting for condition');await sleep(10);}}

test('registry: isolated module faults degrade gracefully and toggle disables hooks/tools/jobs',async()=>{
  const s=sampleState();
  let jobRan=false,hookRan=false;
  const iso={
    id:'iso-test',name:'故障隔离测试',description:'',isolated:true,
    settings:[{key:'enabled',label:'启用',type:'boolean',default:true}],
    hooks:{async beforeReceive(){hookRan=true;throw new Error('hook boom');}},
    tools:[],
    jobs:[{id:'iso-job',async run(){jobRan=true;throw new Error('job boom');}}],
    data:'iso-test',page:null
  };
  R.modules.push(iso);R.ensure(s);
  const mutate=fn=>({value:fn(s),state:s});
  try{
    await R.hooks('beforeReceive',{getState:()=>s,mutate});
    await R.runJobs({getState:()=>s,mutate});
    assert.equal(hookRan,true);assert.equal(jobRan,true);
    assert.equal(s.engine.data['iso-test'].lastError.message,'job boom');
    hookRan=false;jobRan=false;
    R.apply(s,'iso-test',{enabled:false});
    await R.hooks('beforeReceive',{getState:()=>s,mutate});
    await R.runJobs({getState:()=>s,mutate});
    assert.equal(hookRan,false);assert.equal(jobRan,false);
  }finally{R.modules.pop();}
});

test('system-one & cloud debounce: evaluates OpenRouter/TypeSafe Jev, holds incomplete sentences, merges burst, and supports stopActivity unlock',async t=>{
  const oldAllow=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const requests=[];
  let stallDecision=false;
  const mock=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    requests.push({url:req.url,headers:req.headers,body});
    res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/systemone')){
      if(stallDecision)return;
      const msg=body.state?.message||'';
      const noul=msg.includes('爬山')||msg.includes('火锅')?0.94:0.22;
      return res.end(JSON.stringify({answers:{complete:{type:'noul',noul}}}));
    }
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'好的，走起！'}}]}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  t.after(async()=>{mock.closeAllConnections();await new Promise(r=>mock.close(r));if(oldAllow===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=oldAllow;});

  const base='http://127.0.0.1:'+mock.address().port+'/v1';
  let state=sampleState();state.messages=[];state.settings.timezone='UTC';
  M.save(state,{
    sources:[
      ...M.sanitize(state.settings.ai).sources,
      {id:'chat-src',name:'Chat',baseUrl:base,key:'CHAT_KEY',template:'compatible',builtin:false,kinds:['chat']},
      {id:'jev-src',name:'TypeSafe System One',baseUrl:base,key:'JEV_KEY',template:'typesafe-system-one',builtin:false,kinds:['decision']}
    ],
    models:[
      {id:'chat-m',sourceId:'chat-src',model:'mock-chat',kind:'chat',capabilities:['text'],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:''},
      {id:'jev-m',sourceId:'jev-src',model:'jev-1.14',kind:'decision',capabilities:[],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:''}
    ],
    assign:{chat:'chat-m',chatSelections:['chat-m'],chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:'',decision:'jev-m',rerank:''}
  });
  const orState=structuredClone(state);
  orState.settings.ai.sources[1].key='OR_KEY';
  orState.settings.ai.sources[1].baseUrl=base;
  const resNative=await SystemOne.evaluateCompleteness(state,{text:'明天去吃火锅',images:[PNG]});
  assert.equal(resNative.complete,true);assert.equal(resNative.probability,0.94);
  assert.equal(requests.at(-1).url,'/v1/systemone');
  assert.equal(requests.at(-1).headers['typesafe-danger-zone-images'],'true');
  assert.equal(Object.keys(requests.at(-1).body.assets).length,1);

  R.apply(state,'waiting',{enabled:true,mode:'cloud',sendThreshold:0.8,idleSeconds:0.03,draftHoldSeconds:0.25,incompleteWaitSeconds:2,maxWaitSeconds:4});
  R.apply(state,'segments',{intervalMode:'random',minSeconds:0,maxSeconds:0});
  const roleId=state.roles[0].id;
  const mutate=fn=>{const v=fn(state);return {state:structuredClone(state),value:v};};
  const runtime=Runtime.create({getState:()=>structuredClone(state),mutate,now:Date.now});
  try{
    const m1=mutate(s=>S.message(s,S.role(s,roleId),'user','如果明天不下雨','text',{status:'pending'})).value;
    runtime.enqueue(roleId,m1.id);
    await until(()=>requests.some(r=>r.url==='/v1/systemone'));
    await sleep(60);
    assert.equal(requests.filter(r=>r.url.endsWith('/chat/completions')).length,0);
    runtime.userTyping(roleId);
    const m2=mutate(s=>S.message(s,S.role(s,roleId),'user','我们去爬山吧','text',{status:'pending'})).value;
    runtime.enqueue(roleId,m2.id);
    runtime.userTyping(roleId);
    runtime.userStoppedTyping(roleId);
    await until(()=>!runtime.isBusy(roleId));
    assert.equal(requests.filter(r=>r.url.endsWith('/chat/completions')).length,1);
    const promptStr=JSON.stringify(requests.at(-1).body.messages);
    assert.ok(promptStr.includes('如果明天不下雨'));
    assert.ok(promptStr.includes('我们去爬山吧'));

    stallDecision=true;
    state.settings.ai.models.find(m=>m.id==='jev-m').timeoutSeconds=1;
    state.settings.modules.waiting.decisionTimeoutSeconds=30;
    const m3=mutate(s=>S.message(s,S.role(s,roleId),'user','刚才的问题我说完了','text',{status:'pending'})).value;
    runtime.enqueue(roleId,m3.id);
    await until(()=>!runtime.isBusy(roleId));
    assert.equal(state.engine.data.waiting.lastError,undefined);
    assert.equal(requests.filter(r=>r.url.endsWith('/chat/completions')).length,2);
    await assert.rejects(SystemOne.testConnection(state,{modelId:'jev-m'}),{code:'PROVIDER_TIMEOUT'});
  }finally{await runtime.close();}
});

test('chat delivery order: text segments deliver before assistant actions (redpacket & pat)',async()=>{
  let state=sampleState();state.messages=[];state.settings.timezone='UTC';
  state.settings.ai.sources.push({id:'iso',name:'iso',baseUrl:'http://isolated.invalid',key:'k',builtin:false});
  state.settings.ai.models.push({id:'iso',sourceId:'iso',model:'iso',kind:'chat',capabilities:['text','tool_use'],maxContextTokens:128000});
  state.settings.ai.assign.chat='iso';
  R.apply(state,'waiting',{idleSeconds:0.01,maxWaitSeconds:1});
  R.apply(state,'segments',{intervalMode:'random',minSeconds:0,maxSeconds:0});
  const roleId=state.roles[0].id;
  let calls=0;
  const api={resolve:()=>({id:'iso',capabilities:['text','tool_use'],maxContextTokens:128000}),call:async()=>{
    calls++;
    if(calls===1)return {message:{role:'assistant',content:null,tool_calls:[
      {id:'rp',type:'function',function:{name:'send_redpacket',arguments:JSON.stringify({amountCents:100,note:'恭喜'})}},
      {id:'pt',type:'function',function:{name:'pat_user',arguments:'{}'}}
    ]},model:{capabilities:['text','tool_use']},modelId:'iso'};
    return {message:{content:'先说第一句。\n再说第二句！'},model:{capabilities:['text','tool_use']},modelId:'iso'};
  }};
  const mutate=fn=>{const v=fn(state);return {state:structuredClone(state),value:v};};
  const runtime=Runtime.create({getState:()=>structuredClone(state),mutate,modelApi:api});
  try{
    const m=mutate(s=>S.message(s,S.role(s,roleId),'user','发个红包看看','text',{status:'pending'})).value;
    runtime.enqueue(roleId,m.id);
    await until(()=>!runtime.isBusy(roleId));
    const ordered=state.messages.slice(1).map(x=>x.meta?.kind==='pat'?'pat':x.type==='redpacket'?'redpacket':x.content);
    assert.deepEqual(ordered,['先说第一句。','再说第二句！','redpacket','pat'],JSON.stringify(state.messages));
  }finally{await runtime.close();}
});

test('schedule + voice + selfie + outreach + memory components collaborate cleanly',async t=>{
  const oldAllow=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const reqs=[];
  const mock=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    reqs.push({url:req.url,body});
    if(req.url.endsWith('/audio/speech')){res.setHeader('Content-Type','audio/mpeg');return res.end(MP3);}
    res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/images/generations'))return res.end(JSON.stringify({data:[{b64_json:PNG.split(',')[1]}]}));
    const sys=body.messages?.[0]?.content||'';
    if(sys.includes('生活档案'))return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(Object.fromEntries(require('../lib/engine/schedule-data.cjs').PROFILE_FIELDS.map(k=>[k,'画师的日常'])) )}}]}));
    if(sys.includes('日常生活策划')){
      const slots=Array.from({length:12},(_,i)=>({
        start:String(i*2).padStart(2,'0')+':00',
        end:i===11?'23:59':String((i+1)*2).padStart(2,'0')+':00',
        activity:'在街角咖啡馆画草图',scene:'靠窗木桌，一杯冰美式',phone:'free',outfitType:'outdoor'
      }));
      return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({outfit:'米白色针织开衫配浅蓝牛仔裤',mood:'惬意',slots})}}]}));
    }
    if(sys.includes('长期记忆提炼'))return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({memories:['用户对花生严重过敏','约定周六去植物园']})}}]}));
    res.end(JSON.stringify({choices:[{message:{content:'主动找你聊一句'}}]}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  t.after(async()=>{mock.closeAllConnections();await new Promise(r=>mock.close(r));if(oldAllow===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=oldAllow;});

  const base='http://127.0.0.1:'+mock.address().port+'/v1';
  const s=sampleState(),r=s.roles[0];
  s.settings.timezone='UTC';
  S.apply(s,'role.save',{id:r.id,appearancePrompt:'黑长直，杏眼',voiceId:'sweet-voice-01',voiceMode:'often',schedulePrompt:'画师',outreachEnabled:true});
  M.save(s,{
    sources:[...M.sanitize(s.settings.ai).sources,{id:'c',name:'mock',baseUrl:base,key:'K',template:'compatible',builtin:false}],
    models:[
      {id:'chat',sourceId:'c',model:'mock-chat',kind:'chat',capabilities:['text','tool_use'],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:''},
      {id:'tts',sourceId:'c',model:'mock-tts',kind:'tts',capabilities:[],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:'alloy'},
      {id:'img',sourceId:'c',model:'mock-img',kind:'image',capabilities:[],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:''}
    ],
    assign:{chat:'chat',chatSelections:['chat'],chatFallbacks:[],compress:'',caption:'',stt:'',tts:'tts',image:'img',embedding:'',decision:'',rerank:''}
  });
  const mutate=fn=>({value:fn(s),state:s});

  // 1. Schedule generation + currentState
  const nowMs=Date.parse('2026-11-16T12:00:00Z');
  Schedule.saveSettings(s,r.id,{weatherEnabled:false,surpriseProbability:0});
  const plan=await Schedule.generateForRole(s,{mutate,roleId:r.id,now:()=>nowMs});
  assert.equal(plan.outfit,'米白色针织开衫配浅蓝牛仔裤');
  assert.equal(Schedule.currentState(s,r.id,nowMs).scene,'靠窗木桌，一杯冰美式');

  // 2. Voice bracket cleaning + per-role voice override
  assert.equal(Voice.cleanSpeechText('（轻轻抱住你）早安呀'),'早安呀');
  await A.execute('send_voice',{text:'（眨眼）早安'},{getState:()=>s,mutate,roleId:r.id,settings:R.values(s,'actions')});
  assert.equal(reqs.find(x=>x.url.endsWith('/audio/speech')).body.voice,'sweet-voice-01');
  assert.equal(reqs.find(x=>x.url.endsWith('/audio/speech')).body.input,'早安');

  // 3. Selfie stitched prompt (appearance + outfit + scene + raw prompt)
  await R.executeTool('send_selfie',{kind:'selfie',prompt:'对着镜头比耶'},{getState:()=>s,mutate,roleId:r.id,now:()=>nowMs});
  const imgPrompt=reqs.find(x=>x.url.endsWith('/images/generations')).body.prompt;
  assert.ok(imgPrompt.includes('黑长直'));assert.ok(imgPrompt.includes('米白色针织开衫'));assert.ok(imgPrompt.includes('靠窗木桌'));assert.ok(imgPrompt.includes('比耶'));

  // 4. Memory extraction & deduplication + retrieval
  S.message(s,r,'user','我对花生严重过敏，周六一起去植物园吧','text',{status:'sent',createdAt:nowMs-3*3600000});
  S.message(s,r,'assistant','记住了，周六植物园见','text',{status:'sent',createdAt:nowMs-3*3600000});
  const added=await Memory.extractForRole({getState:()=>s,mutate,roleId:r.id,manual:true});
  assert.equal(added.length,2);
  for(let i=0;i<15;i++)s.memories.push({id:S.id(),roleId:r.id,content:'无关日常记录'+i,createdAt:i+1});
  const picked=Memory.selectForPrompt(s,r.id,'周六去植物园需要注意花生吗');
  assert.ok(picked.some(m=>m.content.includes('花生')));
  assert.ok(picked.some(m=>m.content.includes('植物园')));

  // 5. Outreach job triggers only when outside quiet hours and idle
  s.roles[0].lastActiveAt=nowMs-3*3600000;
  s.roles[0].quietStart='01:00';s.roles[0].quietEnd='07:00';
  R.apply(s,'outreach',{enabled:true,minIdleMinutes:60,quietStart:'01:00',quietEnd:'07:00'});
  s.engine.data.outreach.records={[r.id]:{day:'2026-11-16',count:0,unanswered:0,nextDueAt:nowMs-1,firedKeys:[]}};
  let initiated=null;
  await require('../lib/engine/modules/outreach.cjs').jobs[0].run({
    getState:()=>s,mutate,isBusy:()=>false,now:nowMs,
    initiate:(roleId,opts)=>{initiated={roleId,opts};return true;}
  });
  assert.equal(initiated.roleId,r.id);
  assert.ok(initiated.opts.instruction.includes('米白色针织开衫'));
  assert.equal(s.engine.data.outreach.records[r.id].count,0);
  require('../lib/engine/modules/outreach.cjs').commit(s,r.id,initiated.opts.outreach,{now:nowMs,text:'在画画时顺手想起你'});
  assert.equal(s.engine.data.outreach.records[r.id].count,1);
});

test('public IP access: HOST=0.0.0.0 accepts public IP Host header while still rejecting foreign domains',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-ip-test-'));
  const app=createApp({dataDir:dir,host:'0.0.0.0',port:0});
  await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const port=app.server.address().port;
  const reqHost=hostHeader=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/api/status',method:'GET',headers:{Host:hostHeader}},res=>{
      let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));
    });
    req.on('error',reject);req.end();
  });
  const ipRes=await reqHost(`203.0.113.88:${port}`);
  assert.equal(ipRes.status,200);
  const badDomainRes=await reqHost(`attacker.invalid:${port}`);
  assert.equal(badDomainRes.status,403);
});
