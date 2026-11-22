// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

const S=require('../lib/state.cjs');
const R=require('../lib/engine/registry.cjs');
const D=require('../lib/engine/delivery.cjs');
const A=require('../lib/engine/actions.cjs');
const M=require('../lib/engine/models.cjs');
const P=require('../lib/providers.cjs');
const Runtime=require('../lib/engine/runtime.cjs');
const ScheduleCore=require('../lib/engine/schedule-core.cjs');
const Schedule=require('../lib/engine/modules/schedule.cjs');
const Voice=require('../lib/engine/modules/voice.cjs');
const PhotoCore=require('../lib/engine/photo-core.cjs');
const Selfie=require('../lib/engine/modules/selfie.cjs');
const Outreach=require('../lib/engine/modules/outreach.cjs');
const MemoryStore=require('../lib/engine/memory-store.cjs');
const Memory=require('../lib/engine/modules/memory.cjs');
const {createApp}=require('../scripts/sample-data.cjs');

const PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=';
const PNG=`data:image/png;base64,${PNG_B64}`;
const PNG_BODY='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MP3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));

test('business memory snapshot preserves all cards and replaces prior side data transactionally',t=>{
  const {DatabaseSync}=require('node:sqlite');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-memory-backup-'));
  const source=path.join(temp,'source'),target=path.join(temp,'target');
  const incoming=sampleState(),roleId=incoming.roles[0].id,now=Date.now();
  for(let i=0;i<55;i++){
    MemoryStore.upsertCard(source,incoming,roleId,{id:'edition-'+i,content:'测试记忆 '+i,createdAt:now-i,locked:i===3},{skipMirrorSync:i!==54});
  }
  MemoryStore.upsertCard(source,incoming,roleId,{
    id:'archived',content:'归档内容',status:'archived',importance:0.9,topics:['展览'],accessCount:6
  },{vector:[0.25,0.75],sourceMessages:['来源记录']});
  MemoryStore.saveProfile(source,incoming,roleId,{basic:{所在地:'苏州'},relationship:{关系:['朋友']}},now);
  assert.equal(incoming.memories.length,50);
  const backup=JSON.parse(JSON.stringify(MemoryStore.exportBackup(source,incoming)));
  assert.equal(backup.cards.length,56);
  const restored=structuredClone(incoming);
  restored.memories.push({id:'archived',roleId,content:'旧镜像',createdAt:now});
  const sideBackup=MemoryStore.validateBackup(backup,restored);
  assert.equal(MemoryStore.validateBackup(undefined,restored),null);
  assert.throws(()=>MemoryStore.validateBackup({...backup,cards:[...backup.cards,backup.cards[0]]},restored),/长期记忆/);
  assert.throws(()=>MemoryStore.validateBackup({...backup,cards:[{...backup.cards[0],role_id:'wrong-role'}]},restored),/长期记忆/);
  MemoryStore.upsertCard(target,structuredClone(incoming),roleId,{id:'old-target',content:'目标实例独有'});
  const app=new DatabaseSync(path.join(target,'pipi.sqlite'));
  t.after(()=>{
    app.close();
    MemoryStore.close(source);
    MemoryStore.close(target);
    fs.rmSync(temp,{recursive:true,force:true});
  });
  app.exec('PRAGMA journal_mode=WAL');
  const detach=MemoryStore.attachBackup(app,target);
  try {
    app.exec('BEGIN IMMEDIATE');
    MemoryStore.restoreAttached(app,sideBackup,structuredClone(restored));
    app.exec('ROLLBACK');
    assert.ok(MemoryStore.getCard(target,null,roleId,'old-target'));
    app.exec('BEGIN IMMEDIATE');
    MemoryStore.restoreAttached(app,sideBackup,restored);
    app.exec('COMMIT');
  }finally{detach();}
  assert.deepEqual(JSON.parse(JSON.stringify(MemoryStore.exportBackup(target,restored))),backup);
  assert.equal(MemoryStore.getCard(target,null,roleId,'old-target'),null);
  assert.deepEqual(MemoryStore.getVectors(target,restored,['archived']).archived,[0.25,0.75]);
  assert.deepEqual(MemoryStore.readSource(target,'archived'),['来源记录']);
  assert.deepEqual(MemoryStore.getProfile(target,restored,roleId).relationship,{关系:['朋友']});
  assert.equal(restored.memories.length,50);
  assert.ok(!restored.memories.some(card=>card.id==='archived'));
});

test('schedule circadian clamp + night lock + online-only sanitizer + mandatory life_rules',()=>{
  const routine=ScheduleCore.computeRoutine({routineWorkday:'凌晨5点睡，下午3点起床',routineRestday:'凌晨4点睡，下午4点醒'});
  assert.ok(routine.wakeMin>=6*60+30&&routine.wakeMin<=10*60,`wake=${routine.wakeHm}`);
  assert.ok(routine.sleepMin>=22*60&&routine.sleepMin<=25*60+30,`sleep=${routine.sleepHm}`);

  const repaired=ScheduleCore.repairSlots([
    {start:'00:00',end:'04:00',activity:'熬夜打游戏然后线下见面',scene:'去你家喝酒',phone:'free'},
    {start:'12:00',end:'15:00',activity:'睡觉补觉',scene:'卧室睡觉',restType:'night_sleep',phone:'offline'}
  ],'见夏',{routine,enforceCircadian:true});
  // 02:00-06:00 locked to night_sleep/offline/sleepwear
  const at3am=repaired.find(sl=>sl.start<='03:00'&&sl.end>='03:00');
  assert.equal(at3am.restType,'night_sleep');
  assert.equal(at3am.phone,'offline');
  // Daytime night_sleep repaired
  const at13pm=repaired.find(sl=>sl.start<='13:00'&&sl.end>'13:00');
  assert.notEqual(at13pm.restType,'night_sleep');
  // Offline romance stripped
  const joined=JSON.stringify(repaired);
  assert.doesNotMatch(joined,/线下见面|去你家/);

  const s=sampleState(),r=s.roles[0];
  R.ensure(s);
  const ctx={getState:()=>s,role:r,roleId:r.id,messages:[{role:'system',content:'base'}]};
  Schedule.hooks.afterAssemble(ctx);
  assert.match(ctx.messages[0].content,/<life_rules>/);
  assert.match(ctx.messages[0].content,/线上聊天/);
});

test('voice dual-track VOICE_TAGS, strip on text bubbles, 503 history recovery, disk cache, and live failure handoff',async t=>{
  const prepared=Voice.prepareSpeech('[轻笑]（轻轻抱住你）早安呀[停顿][耳语]睡得好吗');
  assert.equal(prepared.ttsText,'[轻笑]早安呀睡得好吗');
  assert.equal(prepared.displayText,'早安呀睡得好吗');
  assert.equal(Voice.prepareSpeech('  [轻笑][叹气]我到家了。[耳语]').ttsText,'[轻笑]我到家了。');
  assert.equal(Voice.prepareSpeech('我到了。[耳语]晚安。[轻笑]').ttsText,'我到了。晚安。');

  const bubbles=D.split('[轻笑] 真开心\n【语音】[叹气] 有点困');
  assert.equal(bubbles.length,1);
  assert.deepEqual(bubbles[0].split('\n').map(line=>line.trim()),['真开心','有点困']);

  const oldAllow=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-voice-test-'));
  let failTts=false,ttsHits=0;
  const mock=http.createServer((req,res)=>{
    if(req.url.startsWith('/v1/text-to-speech/')){
      ttsHits++;
      if(failTts){res.statusCode=500;return res.end('boom');}
      if(ttsHits===1){
        res.statusCode=503;
        res.setHeader('history-item-id','hist-99');
        return res.end('busy');
      }
      res.setHeader('content-type','audio/mpeg');return res.end(MP3);
    }
    if(req.url==='/v1/history/hist-99/audio'){
      res.setHeader('content-type','audio/mpeg');return res.end(MP3);
    }
    res.statusCode=404;res.end();
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  t.after(async()=>{
    mock.closeAllConnections();await new Promise(r=>mock.close(r));
    fs.rmSync(dir,{recursive:true,force:true});
    if(oldAllow===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=oldAllow;
  });

  const base='http://127.0.0.1:'+mock.address().port+'/v1';
  const s=sampleState();
  S.apply(s,'role.save',{id:s.roles[0].id,voiceId:'v-sweet'});
  M.save(s,{
    sources:[...M.sanitize(s.settings.ai).sources,{id:'pp',name:'pipi',baseUrl:base,key:'K',template:'pipi',builtin:false,kinds:['tts']}],
    models:[{id:'tts',sourceId:'pp',model:'breeze-tts-2',kind:'tts',capabilities:[],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:5,extraBody:{},voice:'v-def'}],
    assign:{chat:'',chatSelections:[],chatFallbacks:[],compress:'',caption:'',stt:'',tts:'tts',image:'',embedding:'',decision:'',rerank:''}
  });
  R.ensure(s);
  const mutate=fn=>({value:fn(s),state:s});

  // First call hits 503 + history-item-id recovery + writes disk cache
  const a1=await P.speak(s,'[轻笑]早安',{voice:'v-sweet',dataDir:dir});
  assert.match(a1,/^\/api\/media\/[a-f0-9]{64}\.mp3$/);
  assert.deepEqual(require('../lib/media-store.cjs').resolveAudioBytes(dir,a1).buffer,MP3);
  const duration=require('../lib/provider-native.cjs').estimateAudioDurationMs(a1,'早安',{dataDir:dir});
  assert.ok(duration>=1000&&duration<=600000);
  assert.equal(ttsHits,1);

  // Second identical call serves from 7-day disk cache without upstream request
  const a2=await P.speak(s,'[轻笑]早安',{voice:'v-sweet',dataDir:dir});
  assert.equal(a2,a1);
  assert.equal(ttsHits,1);

  // A synthesis failure leaves the next reply to the chat model.
  failTts=true;
  const rid=s.roles[0].id;
  const messageCount=s.messages.length;
  s.engine.data.execution={runs:{'run-1':{id:'run-1',roleId:rid,pendingActionMessages:[]}},actions:[]};
  const failedVoice=await A.execute('send_voice',{text:'晚安好梦'},{getState:()=>s,mutate,roleId:rid,executionId:'run-1',deferChatActions:true,dataDir:dir,settings:R.values(s,'actions')});
  assert.equal(failedVoice.delivered,'failed');
  assert.match(failedVoice.error,/用普通文字自然回复/);
  assert.match(failedVoice.error,/不要声称发出了语音/);
  assert.deepEqual(s.engine.data.execution.runs['run-1'].pendingActionMessages,[]);
  assert.equal(s.messages.length,messageCount);
  assert.equal(ttsHits,2);
  assert.match(s.engine.data.voice.lastError.message,/HTTP 500/);
});

test('photo-core reference selection, applyFaceLock, multipart /images/edits, 4K->2K step-down, resend & media URL',async t=>{
  const s=sampleState(),r=s.roles[0];
  R.ensure(s);
  S.apply(s,'role.save',{id:r.id,appearancePrompt:'黑长直，杏眼',faceReferences:[PNG],bodyReferences:[PNG_BODY]});
  const role=S.role(s,r.id);

  // Close-up excludes bodyReferences; full-body includes both
  const closePlan=Selfie.buildPhotoPlan(s,role,{prompt:'近距离开心眨眼自拍',kind:'selfie'});
  assert.equal(closePlan.references.length,1);
  assert.match(closePlan.prompt,/^严格保持参考图1/);
  assert.match(closePlan.prompt,/再次强调：人物的脸必须与参考图1/);

  const bodyPlan=Selfie.buildPhotoPlan(s,role,{prompt:'站在落地镜前拍一张全身照',kind:'outfit'});
  assert.equal(bodyPlan.references.length,2);

  const oldAllow=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-photo-test-'));
  let reqCount=0,lastSize='',sawMultipart=false;
  const mock=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const raw=Buffer.concat(chunks);
    reqCount++;
    if(req.url.endsWith('/images/edits')){
      sawMultipart=String(req.headers['content-type']||'').startsWith('multipart/form-data')&&raw.includes('name="image[]"');
      const m=raw.toString('utf8').match(/name="size"\r\n\r\n(\d+x\d+)/);
      lastSize=m?.[1]||'';
      res.setHeader('Content-Type','application/json');
      if(lastSize==='2448x3264'){res.statusCode=400;return res.end(JSON.stringify({error:{param:'size',code:'invalid_size',message:'4K size unsupported'}}));}
      return res.end(JSON.stringify({data:[{b64_json:PNG_B64}]}));
    }
    res.statusCode=404;res.end();
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  t.after(async()=>{
    mock.closeAllConnections();await new Promise(r=>mock.close(r));
    fs.rmSync(dir,{recursive:true,force:true});
    if(oldAllow===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=oldAllow;
  });

  M.save(s,{
    sources:[...M.sanitize(s.settings.ai).sources,{id:'imgsrc',name:'img',baseUrl:'http://127.0.0.1:'+mock.address().port+'/v1',key:'K',template:'compatible',builtin:false,kinds:['image']}],
    models:[{id:'imgm',sourceId:'imgsrc',model:'gpt-image-edit',kind:'image',capabilities:[],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:10,extraBody:{},voice:''}],
    assign:{chat:'',chatSelections:[],chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'imgm',embedding:'',decision:'',rerank:''}
  });
  R.apply(s,'selfie',{defaultSize:'3:4 4K'});
  const mutate=fn=>({value:fn(s),state:s});

  // First execute triggers 4K (2448x3264) -> step down to 2K (1536x2048), multipart /images/edits, stored to /api/media/...
  const genRes=await R.executeTool('send_selfie',{prompt:'微笑比耶',kind:'selfie'},{getState:()=>s,mutate,roleId:r.id,dataDir:dir});
  assert.equal(sawMultipart,true);
  assert.equal(lastSize,'1536x2048');
  assert.equal(reqCount,2);
  const storedMsg=s.messages.at(-1);
  assert.match(storedMsg.content,/^\/api\/media\/[a-f0-9]+\.png$/);

  // Resend re-delivers with 0 upstream API calls
  const resendRes=await R.executeTool('send_selfie',{action:'resend',sourcePhotoId:genRes.photoId,prompt:'重发'},{getState:()=>s,mutate,roleId:r.id,dataDir:dir});
  assert.equal(resendRes.resent,true);
  assert.equal(reqCount,2);
  assert.equal(s.messages.at(-1).content,storedMsg.content);
});

test('outreach (主动信息): 1h hold expiry, 5 triggers, night sleep lock, and waitReplyFacts',async()=>{
  assert.equal(Outreach.name,'主动信息');
  assert.equal(R.list().some(m=>m.id==='proactive'),false);

  const s=sampleState(),r=s.roles[0];
  s.settings.timezone='UTC';
  R.ensure(s);
  S.apply(s,'role.save',{id:r.id,outreachEnabled:true,quietStart:'01:00',quietEnd:'07:00'});
  s.settings.ai.sources.push({id:'c',name:'mock',baseUrl:'https://example.invalid/v1',key:'K',template:'compatible',builtin:false});
  s.settings.ai.models.push({id:'m',sourceId:'c',model:'c',kind:'chat',capabilities:['text'],maxContextTokens:128000});
  s.settings.ai.assign.chat='m';
  R.apply(s,'outreach',{enabled:true,quietStart:'01:00',quietEnd:'07:00',holdMinutes:60});
  const mutate=fn=>({value:fn(s),state:s});

  // User says "等我忙完找你"
  const start=Date.UTC(2026,10,16,11,0,0);
  S.message(s,r,'user','先去开会了，等我忙完找你','text',{status:'pending',createdAt:start});
  await Outreach.hooks.afterReceive({getState:()=>s,mutate,roleId:r.id,now:start});
  const hold=s.engine.data.outreach.holds[r.id];
  assert.ok(hold);
  const created=hold.createdAt;
  assert.equal(hold.dueAt-created,60*60000);

  // Before 1h: does not trigger hold
  let initiated=null;
  await Outreach.jobs[0].run({getState:()=>s,mutate,isBusy:()=>false,now:created+45*60000,initiate:(id,opts)=>{initiated={id,opts};return true;}});
  assert.equal(initiated,null);

  // After 1h (and outside quiet hours): hold expires and triggers!
  s.messages[s.messages.length-1].status='sent';
  const fireNow=Date.UTC(2026,10,16,12,0,0);
  hold.createdAt=fireNow-65*60000;
  hold.dueAt=fireNow-5*60000;
  s.roles[0].lastActiveAt=fireNow-65*60000;
  await Outreach.jobs[0].run({getState:()=>s,mutate,isBusy:()=>false,now:fireNow,initiate:(id,opts)=>{initiated={id,opts};return true;}});
  assert.ok(initiated);
  assert.match(initiated.opts.instruction,/等我忙完找你/);
  assert.equal(initiated.opts.outreach.kind,'hold');
  Outreach.commit(s,r.id,initiated.opts.outreach,{text:'忙完想跟我聊聊吗？',now:fireNow});
  Outreach.errorRelease(s,r.id,initiated.opts.outreach,{now:fireNow});

  // User replies -> clears unanswered and injects waitReplyFacts into next system prompt
  S.message(s,r,'user','我忙完回来啦','text',{status:'pending',createdAt:fireNow+60000});
  await Outreach.hooks.afterReceive({getState:()=>s,mutate,roleId:r.id,now:fireNow+60000});
  const ctx={getState:()=>s,role:s.roles[0],messages:[{role:'system',content:'sys'}]};
  await Outreach.hooks.afterAssemble(ctx);
  assert.match(ctx.messages[0].content,/前情衔接/);
});

test('livingmemory SQLite store, tools, decay immunity, and HTTP 128MB import/export',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-mem-test-'));
  const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,demoModel:true});
  await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});

  const port=app.server.address().port,base=`http://127.0.0.1:${port}`,origin=`http://127.0.0.1:${port}`;
  const reqJson=(method,p,body,headers={})=>new Promise((resolve,reject)=>{
    const raw=body===undefined?null:Buffer.isBuffer(body)?body:typeof body==='string'?Buffer.from(body):Buffer.from(JSON.stringify(body));
    const req=http.request(base+p,{method,headers:{...(raw?{'Content-Type':headers['Content-Type']||'application/json','Content-Length':raw.length}:{}),Origin:origin,...headers}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
        const txt=Buffer.concat(chunks).toString('utf8');
        let parsed=txt;try{parsed=JSON.parse(txt);}catch{}
        resolve({status:res.statusCode,headers:res.headers,body:parsed,raw:Buffer.concat(chunks)});
      });
    });
    req.on('error',reject);if(raw)req.end(raw);else req.end();
  });

  // Setup auth
  const setup=await reqJson('POST','/api/setup',{password:'test-password-1234',displayName:'测试'});
  assert.equal(setup.status,200);
  const cookie=setup.headers['set-cookie'][0].split(';')[0];
  const csrf=setup.body.csrfToken;
  const authHeaders={Cookie:cookie,'X-CSRF-Token':csrf};
  const roleId=setup.body.state.roles[0].id;

  // Test media upload + HTTP retrieval + traversal block
  const up=await reqJson('POST','/api/media/upload',{image:PNG},authHeaders);
  assert.equal(up.status,200);
  assert.match(up.body.url,/^\/api\/media\/[a-f0-9]+\.png$/);
  const gotMedia=await reqJson('GET',up.body.url,undefined,{Cookie:cookie});
  assert.equal(gotMedia.status,200);
  assert.equal(gotMedia.headers['x-content-type-options'],'nosniff');

  // Test LivingMemory v1 multi-scope JSON streaming import (preview + execute)
  const lmPayload=JSON.stringify({
    format:'livingmemory',
    schema_version:1,
    memories:[
      {original_id:'lm-1',content:'用户养了一只叫汤圆的橘猫，最喜欢晒太阳',importance:0.9,persona_id:'见夏',session_id:'qq-1',metadata:{memory_type:'FACT',status:'active',topics:['汤圆','橘猫']}},
      {original_id:'lm-2',content:'不吃香菜和折耳根，吃火锅只要微辣番茄锅底',importance:0.8,persona_id:'见夏',session_id:'qq-1',metadata:{memory_type:'PREFERENCE',status:'active'}},
      {original_id:'lm-3',content:'别的分组旧测试记忆',importance:0.5,persona_id:'其他角色',session_id:'qq-2',metadata:{memory_type:'GENERAL',status:'active'}}
    ]
  });
  const previewRes=await reqJson('POST','/api/engine/memory/import?mode=preview&format=json',lmPayload,{...authHeaders,'Content-Type':'application/octet-stream'});
  assert.equal(previewRes.status,200);
  assert.equal(previewRes.body.preview.validCount,3);
  assert.equal(previewRes.body.preview.groups.length,2);

  const jxScope=previewRes.body.preview.groups.find(g=>g.personaId==='见夏').scopeKey;
  const execRes=await reqJson('POST',`/api/engine/memory/import?mode=execute&format=json&roleId=${encodeURIComponent(roleId)}&scopes=${encodeURIComponent(JSON.stringify([jxScope]))}`,lmPayload,{...authHeaders,'Content-Type':'application/octet-stream'});
  assert.equal(execRes.status,200);
  assert.equal(execRes.body.result.importedCount,2);
  assert.equal(execRes.body.result.skippedFilterCount,1);

  // Verify SQLite state & recall + export roundtrip
  const memState=await reqJson('GET',`/api/engine/memory/state?roleId=${encodeURIComponent(roleId)}`,undefined,{Cookie:cookie});
  assert.equal(memState.status,200);
  assert.equal(memState.body.cards.length,2);

  const recallRes=await reqJson('POST','/api/engine/memory',{roleId,action:'recall',query:'汤圆这几天怎么样'},authHeaders);
  assert.equal(recallRes.status,200);
  assert.ok(recallRes.body.cards[0].content.includes('汤圆'));

  const expRes=await reqJson('GET',`/api/engine/memory/export?roleId=${encodeURIComponent(roleId)}`,undefined,{Cookie:cookie});
  assert.equal(expRes.status,200);
  assert.equal(expRes.body.format,'livingmemory');
  assert.equal(expRes.body.memories.length,2);

  // Also check CSV preview/import
  const csvData='id,persona_id,session_id,memory_type,importance,status,content\ncsv-1,见夏,s1,EVENT,0.7,active,去年国庆在杭州看了一场桂花雨\n';
  const csvExec=await reqJson('POST',`/api/engine/memory/import?mode=execute&format=csv&roleId=${encodeURIComponent(roleId)}`,csvData,{...authHeaders,'Content-Type':'text/csv'});
  assert.equal(csvExec.status,200);
  assert.equal(csvExec.body.result.importedCount,1);

  // Check decay immunity for locked cards vs old low-importance cards directly in Memory module
  const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-mem-unit-'));
  try{
    const oldMs=Date.now()-180*86400000;
    const dummyState=sampleState(),dRoleId=dummyState.roles[0].id;
    const lockedCard=MemoryStore.upsertCard(testDir,dummyState,dRoleId,{content:'非常重要核心纪念日',importance:0.9,locked:true,createdAt:oldMs,updatedAt:oldMs});
    const forgettableCard=MemoryStore.upsertCard(testDir,dummyState,dRoleId,{content:'无关路人甲早饭',importance:0.2,locked:false,createdAt:oldMs,updatedAt:oldMs});
    const archivedCount=Memory.consolidateAndDecay(dummyState,dRoleId,{dataDir:testDir,now:Date.now()});
    assert.equal(archivedCount,1);
    const activeCards=MemoryStore.listCards(testDir,dummyState,dRoleId,{status:'active'});
    assert.ok(activeCards.some(c=>c.id===lockedCard.id));
    assert.ok(!activeCards.some(c=>c.id===forgettableCard.id));

    // Tools: forget_memory refuses locked card, allows unlocked card
    const toolCtx={getState:()=>dummyState,mutate:fn=>({value:fn(dummyState),state:dummyState}),roleId:dRoleId,dataDir:testDir};
    const rLocked=await Memory.tools[0].execute('forget_memory',{memoryId:lockedCard.id},toolCtx);
    assert.equal(rLocked.forgotten,false);
    assert.equal(rLocked.locked,true);

    const addedTool=await Memory.tools[0].execute('memorize_memory',{content:'用户不喜欢苦瓜',memoryType:'PREFERENCE',importance:0.75},toolCtx);
    assert.equal(addedTool.saved,true);
    const rUnlock=await Memory.tools[0].execute('forget_memory',{memoryId:addedTool.memoryId},toolCtx);
    assert.equal(rUnlock.forgotten,true);
  }finally{
    MemoryStore.close(testDir);
    fs.rmSync(testDir,{recursive:true,force:true});
  }
});

test('schedule keeps distinct scenes and outreach completes the record after delivery',async()=>{
  const s=sampleState(),r=s.roles[0];
  s.settings.timezone='UTC';
  R.ensure(s);
  S.apply(s,'role.save',{id:r.id,outreachEnabled:true,quietStart:'01:00',quietEnd:'07:00'});
  s.settings.ai.sources.push({id:'c',name:'mock',baseUrl:'https://example.invalid/v1',key:'K',template:'compatible',builtin:false});
  s.settings.ai.models.push({id:'m',sourceId:'c',model:'c',kind:'chat',capabilities:['text'],maxContextTokens:128000});
  s.settings.ai.assign.chat='m';
  R.apply(s,'outreach',{enabled:true,quietStart:'01:00',quietEnd:'07:00',holdMinutes:60});
  const mutate=fn=>({value:fn(s),state:s});

  // 1. Overlapping daytime night_sleep 08:00-14:00 is blocked; adjacent same-activity different-scene slots stay separate
  const repaired=ScheduleCore.repairSlots([
    {start:'00:00',end:'08:00',activity:'夜睡',scene:'卧室',restType:'night_sleep'},
    {start:'08:00',end:'14:00',activity:'补大觉',scene:'卧室',restType:'night_sleep'},
    {start:'14:00',end:'16:00',activity:'工作',scene:'公司',phone:'glance',restType:'none',outfitType:'outdoor'},
    {start:'16:00',end:'23:59',activity:'工作',scene:'书房',phone:'free',restType:'none',outfitType:'home'}
  ],'TA');
  assert.ok(!repaired.some(sl=>sl.start==='08:00'&&sl.end==='14:00'&&sl.restType==='night_sleep'));
  const workSlots=repaired.filter(sl=>sl.activity==='工作');
  assert.equal(workSlots.length,2);
  assert.equal(workSlots[0].scene,'公司');
  assert.equal(workSlots[1].scene,'书房');

  // 2. Hold auto-clears when user resumes normal conversation in a later turn
  const nowMs=Date.UTC(2026,10,16,12,0,0);
  S.message(s,r,'user','等我一小时后再聊','text',{status:'pending',createdAt:nowMs-120*60000});
  await Outreach.hooks.afterReceive({getState:()=>s,mutate,roleId:r.id,now:nowMs-120*60000});
  assert.ok(s.engine.data.outreach.holds[r.id]);
  s.messages.at(-1).status='sent';
  S.message(s,r,'user','今天晚饭吃了牛肉面','text',{status:'pending',createdAt:nowMs-90*60000});
  await Outreach.hooks.afterReceive({getState:()=>s,mutate,roleId:r.id,now:nowMs-90*60000});
  assert.equal(s.engine.data.outreach.holds[r.id],undefined);

  // 3. Schedule-backed promise & care triggers produce real content (no undefined)
  s.messages.at(-1).status='sent';
  const day='2026-11-16';
  Schedule.saveForRole(s,r.id,{
    day,
    slots:[
      {start:'00:00',end:'07:30',activity:'夜间熟睡',scene:'卧室床上',phone:'offline',restType:'night_sleep',outfitType:'sleepwear'},
      {start:'07:30',end:'11:50',activity:'逛画展',scene:'美术馆',phone:'glance',restType:'none',outfitType:'outdoor'},
      {start:'11:50',end:'23:59',activity:'居家休息',scene:'客厅',phone:'free',restType:'none',outfitType:'home'}
    ]
  },nowMs);
  s.engine.data.schedule.promises[r.id]=[{id:'pr-1',type:'tell',content:'给你拍街角那只橘猫',dueHm:'11:55',dueAt:nowMs-5*60000,status:'pending',createdAt:nowMs-3600000}];
  let triggered=null;
  await Outreach.jobs[0].run({getState:()=>s,mutate,isBusy:()=>false,now:nowMs,initiate:(id,opts)=>{triggered=opts;return true;}});
  assert.ok(triggered);
  assert.match(triggered.instruction,/给你拍街角那只橘猫/);
  assert.doesNotMatch(triggered.instruction,/undefined/);
  assert.equal(s.engine.data.schedule.promises[r.id][0].status,'pending');
  Outreach.commit(s,r.id,triggered.outreach,{text:'橘猫在街角晒太阳',now:nowMs});
  Outreach.errorRelease(s,r.id,triggered.outreach,{now:nowMs});
  assert.equal(s.engine.data.schedule.promises[r.id][0].status,'done');

  // Care trigger
  s.engine.data.outreach.records[r.id].lastAt=0;
  s.engine.data.outreach.records[r.id].unanswered=0;
  s.engine.data.schedule.userEvents[r.id]=[{id:'ue-1',content:'下午要去拔智齿',followUpAt:nowMs-10*60000,status:'pending',createdAt:nowMs-7200000}];
  triggered=null;
  await Outreach.jobs[0].run({getState:()=>s,mutate,isBusy:()=>false,now:nowMs+30000,initiate:(id,opts)=>{triggered=opts;return true;}});
  assert.ok(triggered);
  assert.match(triggered.instruction,/拔智齿/);
  assert.doesNotMatch(triggered.instruction,/undefined/);
  assert.equal(s.engine.data.schedule.userEvents[r.id][0].status,'pending');
  Outreach.commit(s,r.id,triggered.outreach,{text:'拔智齿之后还疼吗？',now:nowMs+30000});
  Outreach.errorRelease(s,r.id,triggered.outreach,{now:nowMs+30000});
  assert.equal(s.engine.data.schedule.userEvents[r.id][0].status,'done');

  // Miss-you trigger (trigger 4 uses cur.previousSlot)
  s.engine.data.outreach.records[r.id].lastAt=0;
  s.engine.data.outreach.records[r.id].unanswered=0;
  s.roles[0].lastActiveAt=nowMs-45*60000;
  triggered=null;
  await Outreach.jobs[0].run({getState:()=>s,mutate,isBusy:()=>false,now:nowMs+60000,initiate:(id,opts)=>{triggered=opts;return true;}});
  assert.ok(triggered);
  assert.match(triggered.instruction,/逛画展/);
});
