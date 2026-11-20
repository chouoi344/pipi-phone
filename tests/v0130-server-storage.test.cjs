// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const S=require('../lib/state.cjs'),P=require('../lib/providers.cjs'),Media=require('../lib/media-store.cjs');
const Stickers=require('../lib/engine/stickers.cjs');
const {createApp}=require('../server.cjs');
const serverSource=fs.readFileSync(path.join(__dirname,'../server.cjs'),'utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';

function directory(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-v0130-storage-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function stateWithRoles(){
  const s=S.initial();
  S.apply(s,'role.save',{name:'甲'});S.apply(s,'role.save',{name:'乙'});
  return s;
}
async function fixture(t,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-v0130-storage-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[],...options});
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  let cookie='',csrf='';
  async function request(route,body,{anonymous=false,headers={}}={}){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(anonymous?{}:{Cookie:cookie}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,value};
  }
  const setup=await request('/api/setup',{password:'Isolated-v0130-Password!',displayName:'隔离测试'});
  assert.equal(setup.status,200,JSON.stringify(setup.value));
  return {app,dataDir,request,state:setup.value.state};
}
function captureErrors(t){
  const errors=[],original=console.error;
  console.error=(...args)=>errors.push(args);
  t.after(()=>{console.error=original;});
  return errors;
}

test('L1: over-limit message counts allow shrink and error updates but reject further growth in Chinese',()=>{
  const s=S.initial();s.messages=Array.from({length:20001},()=>({status:'pending'}));
  S.limitBaseline(s,Buffer.byteLength(JSON.stringify(s)));
  s.messages[0].status='error';s.messages[0].error='请求失败';
  assert.doesNotThrow(()=>S.limit(s));
  s.messages.pop();assert.doesNotThrow(()=>S.limit(s));
  s.messages.push({},{ });
  assert.throws(()=>S.limit(s),error=>error.status===413&&error.code==='LIMIT'&&error.message==='消息已达数量上限');
  assert.equal(JSON.stringify(s).includes('pipi.limitBaseline'),false);
  assert.throws(()=>S.limit({...s}),/消息已达数量上限/);
});

test('L1: documents already over 64 MB can remain unchanged or shrink, but cannot exceed their stored baseline',()=>{
  const s=S.initial();s.engine.data.large='x'.repeat(64*1024*1024);
  S.limitBaseline(s,Buffer.byteLength(JSON.stringify(s)));
  assert.doesNotThrow(()=>S.limit(s));
  s.engine.data.large=s.engine.data.large.slice(0,-1024);assert.doesNotThrow(()=>S.limit(s));
  s.engine.data.large+='x'.repeat(2048);
  assert.throws(()=>S.limit(s),error=>error.status===413&&error.message==='数据总量超过 64 MB');
});

test('L1: sticker byte baselines are snapshots even when a sticker is edited in place',()=>{
  const s=S.initial();s.stickers=[{image:'x'.repeat(16*1024*1024+1)}];
  S.limitBaseline(s,Buffer.byteLength(JSON.stringify(s)));
  assert.doesNotThrow(()=>S.limit(s));
  s.stickers[0].image+='x';
  assert.throws(()=>S.limit(s),/收藏表情总大小不能超过 16 MB/);
});

for(const type of ['conversation.clear','conversation.delete'])test('L2/L3: '+type+' clears chat-specific execution, outreach and extraction state, retaining resumable reminders and long-term memory',()=>{
  const s=stateWithRoles(),[a,b]=s.roles;
  S.message(s,a,'user','旧聊天');S.message(s,b,'user','另一段聊天');
  s.engine.summaries[a.id]={text:'旧摘要'};
  const execution=s.engine.data.execution={runs:{},actions:[]};
  for(const [id,roleId,jobId,status] of [['chat',a.id,'','running'],['completed-reminder',a.id,'job','completed'],['running-reminder',a.id,'job','running'],['interrupted-reminder',a.id,'job','interrupted'],['other',b.id,'','completed']]){
    execution.runs[id]={id,roleId,jobId,status};execution.actions.push({id:'action-'+id,runId:id,roleId});
  }
  s.engine.data.outreach={records:{[a.id]:{unanswered:3,unansweredMsgs:['old']},[b.id]:{unanswered:1}},replyFacts:{[a.id]:{text:'忙完再聊'},[b.id]:{}},holds:{[a.id]:{},[b.id]:{}}};
  const memory=s.engine.data.memory;
  for(const key of ['lastExtracted','lastExtractedAt','cursors'])memory[key]={[a.id]:99,[b.id]:7};
  memory.profiles={[a.id]:{preferences:{爱好:'看书'}}};
  s.memories.push({id:'long-memory',roleId:a.id,content:'长期记忆'});
  S.apply(s,type,{roleId:a.id});
  assert.equal(s.messages.some(m=>m.roleId===a.id),false);assert.equal(s.messages.length,1);
  assert.equal(s.engine.summaries[a.id],undefined);
  assert.deepEqual(Object.keys(execution.runs),['running-reminder','interrupted-reminder','other']);
  assert.deepEqual(execution.actions.map(x=>x.runId),['running-reminder','interrupted-reminder','other']);
  assert.deepEqual(s.engine.data.outreach.records[a.id],{unanswered:0,unansweredMsgs:[]});
  for(const key of ['replyFacts','holds'])assert.equal(s.engine.data.outreach[key][a.id],undefined);
  for(const key of ['lastExtracted','lastExtractedAt','cursors']){assert.equal(memory[key][a.id],undefined);assert.equal(memory[key][b.id],7);}
  assert.deepEqual(memory.profiles[a.id],{preferences:{爱好:'看书'}});assert.equal(s.memories.length,1);
  assert.equal(s.engine.data.outreach.records[b.id].unanswered,1);
  if(type==='conversation.delete')assert.equal(a.hidden,true);
});

test('S3: distinct sources evict the oldest windows while the current source still has its own rate limit',()=>{
  const buckets=new Map(),clock={now:()=>1000};
  const source=serverSource.match(/  function rate\([\s\S]*?(?=\n  function session\()/)[0];
  const rate=vm.runInNewContext('('+source+')',{buckets,Date:clock,S});
  for(let i=0;i<5002;i++)rate('source-'+i);
  assert.equal(buckets.has('source-0'),false);assert.equal(buckets.has('source-5001'),true);
  assert.doesNotThrow(()=>rate('owner',1));
  assert.throws(()=>rate('owner',1),error=>error.status===429);
  buckets.clear();buckets.set('old',{n:9,until:999});buckets.set('newer',{n:1,until:2000});
  rate('old');assert.deepEqual([...buckets.keys()],['newer','old']);
});

test('S4: an error after response headers were sent ends the response without writing a second header',()=>{
  const json=vm.runInNewContext('('+serverSource.match(/^  function json\([\s\S]*?(?=\n  function )/m)[0]+')');
  let ended=0;
  json({headersSent:true,writeHead(){assert.fail('headers already sent');},end(){ended++;}},500,{error:'失败'});
  assert.equal(ended,1);
});

test('S5: an already consumed empty setup token cannot authorize remote setup after the password row disappears',async t=>{
  const f=await fixture(t);
  f.app.db.prepare("DELETE FROM meta WHERE key='password'").run();
  const result=await f.request('/api/setup',{password:'Replacement-Password!',setupToken:''},{anonymous:true,headers:{'X-Forwarded-For':'198.51.100.8'}});
  assert.equal(result.status,403);assert.equal(result.value.code,'SETUP_TOKEN');
  assert.equal(f.app.db.prepare("SELECT value FROM meta WHERE key='password'").get(),undefined);
});

test('S1/S6/S10: since responses skip unchanged documents, changed revisions return full state and upload timeout is 15 minutes',async t=>{
  const f=await fixture(t),revision=f.state.revision;
  assert.deepEqual(await f.request('/api/state?since='+revision),{status:200,value:{revision,unchanged:true}});
  const changed=await f.request('/api/action',{type:'profile.save',payload:{name:'已更改'}});assert.equal(changed.status,200);
  const full=await f.request('/api/state?since='+revision);assert.equal(full.value.profile.name,'已更改');
  assert.equal((await f.request('/api/state')).value.revision,full.value.revision);
  assert.equal((await f.request('/api/state?since=invalid')).value.profile.name,'已更改');
  assert.equal((await f.request('/api/state',undefined,{anonymous:true})).status,401);
  assert.equal(f.app.server.requestTimeout,15*60*1000);assert.equal(f.app.server.headersTimeout,15000);
  f.app.db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify({revision:88,profile:null}));
  assert.deepEqual((await f.request('/api/state?since=88')).value,{revision:88,unchanged:true});
});

test('S1/L1: server mutations can update and shrink an existing document above its message-count limit',async t=>{
  const f=await fixture(t,{initialState:()=>{
    const s=stateWithRoles();
    s.messages=Array.from({length:20002},(_,i)=>({id:'old-'+i,roleId:s.roles[0].id,sender:'user',type:'text',status:'sent',content:'旧消息',createdAt:i+1}));
    return s;
  }});
  const saved=await f.request('/api/action',{type:'profile.save',payload:{name:'仍能修改'}});
  assert.equal(saved.status,200);assert.equal(saved.value.state.messages.length,20002);
  const deleted=await f.request('/api/action',{type:'message.delete',payload:{id:'old-0'}});
  assert.equal(deleted.status,200);assert.equal(deleted.value.state.messages.length,20001);
});

test('S7: an impossible moments invitation fails immediately before a background model request can be accepted',async t=>{
  const f=await fixture(t,{initialState:stateWithRoles}),id=f.state.roles[0].id;
  const missing=await f.request('/api/moments/generate',{roleId:id});
  assert.equal(missing.status,422);assert.equal(missing.value.code,'PROVIDER_UNCONFIGURED');assert.match(missing.value.error,/聊天模型/);
  assert.equal((await f.request('/api/action',{type:'role.save',payload:{id,permissions:{hideTheirMoments:true}}})).status,200);
  const hidden=await f.request('/api/moments/generate',{roleId:id});assert.equal(hidden.status,403);
});

test('S7: synchronous model validation can select a configured fallback without a network capacity lookup',()=>{
  const Models=require('../lib/engine/models.cjs'),state=stateWithRoles();
  state.settings.ai={sources:[{id:'source',name:'隔离服务',baseUrl:'https://isolated.invalid/v1',key:'ISOLATED'}],models:[
    {id:'primary',sourceId:'source',kind:'chat',model:'primary',enabled:false,capabilities:['text']},
    {id:'fallback',sourceId:'source',kind:'chat',model:'fallback',enabled:true,capabilities:['text']}
  ],assign:{chat:'primary',chatFallbacks:['fallback']}};
  const chatModel=vm.runInNewContext('('+serverSource.match(/  function chatModel\([\s\S]*?(?=\n  function transaction\()/)[0]+')',{Models});
  assert.equal(chatModel(state,state.roles[0]).id,'fallback');
});

test('S2/S11: failed recovery writes are logged and do not prevent startup',async t=>{
  const errors=captureErrors(t),originalLimit=S.limit,originalCreate=Stickers.create;
  const initial=stateWithRoles();S.message(initial,initial.roles[0],'user','请求中','text',{status:'pending'});
  S.limit=()=>{throw new Error('isolated full-store write failure');};
  Stickers.create=options=>({...originalCreate(options),recover(){throw new Error('isolated sticker recovery failure');}});
  t.after(()=>{S.limit=originalLimit;Stickers.create=originalCreate;});
  const f=await fixture(t,{initialState:()=>initial});
  S.limit=originalLimit;Stickers.create=originalCreate;
  assert.equal((await f.request('/api/status')).status,200);
  assert.ok(errors.some(args=>String(args[0]).includes('Unable to mark interrupted messages')));
  assert.ok(errors.some(args=>String(args[0]).includes('Unable to resume sticker analysis during startup')));
});

test('S8: restoring a backup resumes sticker analysis after the successful restore',async t=>{
  let recover=0,idle=0,failRecover=false,failIdle=false;const original=Stickers.create,errors=captureErrors(t);
  Stickers.create=()=>({recover(){recover++;if(failRecover)throw new Error('isolated restore recovery failure');},idle(){idle++;return failIdle?Promise.reject(new Error('isolated restored queue failure')):Promise.resolve();},async close(){}});
  t.after(()=>{Stickers.create=original;});
  const f=await fixture(t),backup=await f.request('/api/backup');
  assert.equal(recover,1);
  const restored=await f.request('/api/restore',{confirm:true,backup:backup.value});
  assert.equal(restored.status,200);assert.equal(recover,2);assert.equal(idle,1);
  failRecover=true;
  assert.equal((await f.request('/api/restore',{confirm:true,backup:backup.value})).status,200);
  assert.ok(errors.some(args=>String(args[0]).includes('Unable to resume sticker analysis after restore')));
  failRecover=false;failIdle=true;
  assert.equal((await f.request('/api/restore',{confirm:true,backup:backup.value})).status,200);
  assert.ok(errors.some(args=>String(args[0]).includes('Sticker analysis failed after restore')));
});

test('S9: unexpected route failures leave method, path and stack in logs while the response stays readable',async t=>{
  const f=await fixture(t),errors=captureErrors(t),original=S.publicState;
  S.publicState=()=>{throw new Error('isolated route bug');};
  t.after(()=>{S.publicState=original;});
  const response=await f.request('/api/state?private=never-log-this');
  S.publicState=original;
  assert.deepEqual(response,{status:500,value:{error:'服务器处理失败',code:'SERVER_ERROR'}});
  const log=errors.find(args=>args[0]==='Unexpected server error:');
  assert.equal(log[1],'GET');assert.equal(log[2],'/api/state');assert.match(log[3].stack,/isolated route bug/);
  S.publicState=()=>{throw null;};
  assert.deepEqual(await f.request('/api/state'),{status:500,value:{error:'服务器处理失败',code:'SERVER_ERROR'}});
  S.publicState=original;
  assert.equal(errors.at(-1)[3],null);
});

test('S12/S13: command-line startup registers a background rejection logger and reports occupied ports in one line',async()=>{
  const logs=[],handlers={},proc={on(name,handler){handlers[name]=handler;},exitCode:0};
  const main=serverSource.slice(serverSource.indexOf('if(require.main===module){'));
  const module={};
  vm.runInNewContext(main,{require:{main:module},module,process:proc,console:{error:(...args)=>logs.push(args.join(' ')),log(){}},VERSION:'isolated',createApp:()=>({listen:()=>Promise.reject(Object.assign(new Error('stack must stay hidden'),{code:'EADDRINUSE',port:18766})),close:async()=>{}})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(logs,['Port 18766 is already in use by another program.']);assert.equal(proc.exitCode,1);
  assert.equal(typeof handlers.unhandledRejection,'function');assert.equal(typeof handlers.SIGTERM,'function');
  handlers.unhandledRejection(new Error('isolated background rejection'));assert.match(logs[1],/Unhandled background error:.*isolated background rejection/s);
});

test('M1: unreferenced backup files are ignored, while missing referenced files still fail without writing media',t=>{
  const source=directory(t),target=directory(t),missingTarget=directory(t);
  const url=Media.saveImage(source,Buffer.from(png.split(',')[1],'base64'));
  const state={profile:{avatar:url}},files=Media.backupImages(source,state,1024*1024);
  files['../unreferenced-invalid.png']={base64:'garbage'};
  assert.doesNotThrow(()=>Media.restoreImages(target,state,files));
  assert.equal(Media.toDataUrl(target,url),png);assert.deepEqual(fs.readdirSync(path.join(target,'media')),Object.keys(files).slice(0,1));
  assert.throws(()=>Media.restoreImages(missingTarget,state,{'unused.png':{}}),/备份图片与资料中的引用不完整/);
  assert.equal(fs.existsSync(path.join(missingTarget,'media')),false);
});

test('P1/P2: invalid API headers fail clearly; bill recognition normalizes valid entries and skips malformed rows',async t=>{
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  t.after(()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});
  const valid={amountCents:'1234',type:'expense',category:null,merchant:null,date:'2026-11-20',note:null};
  let calls=0;
  const server=http.createServer((req,res)=>{calls++;req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify([null,7,'bad',valid,{...valid,amountCents:'bad'},{...valid,type:'unknown'},{...valid,amountCents:50,note:'第二条'}])}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base='http://127.0.0.1:'+server.address().port;
  for(const key of ['bad\nkey','密钥'])await assert.rejects(P.request({baseUrl:base,key},'/test'),error=>error.status===422&&error.message==='API Key 含有非法字符，请重新粘贴');
  await assert.rejects(P.request({baseUrl:base,key:'ISOLATED'},'/test',{headers:{'X-Extra':'bad\nheader'}}),error=>error.status===422);
  assert.equal(calls,0);
  const state={settings:{timezone:'UTC',preset:{},providers:{vision:{mode:'custom',baseUrl:base,model:'isolated',key:'ISOLATED',timeoutSeconds:2}}}};
  const result=await P.recognize(state,png);
  assert.deepEqual(result,[{amountCents:1234,type:'expense',category:'',merchant:'',date:'2026-11-20',note:''},{amountCents:50,type:'expense',category:'',merchant:'',date:'2026-11-20',note:'第二条'}]);
  assert.equal(calls,1);
});

test('start.cmd uses Windows CRLF line endings',()=>{
  const bytes=fs.readFileSync(path.join(__dirname,'../start.cmd'));
  assert.equal(bytes.includes(Buffer.from('\r\n')),true);
  assert.equal(bytes.toString().replaceAll('\r\n','').includes('\n'),false);
});
