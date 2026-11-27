// SPDX-License-Identifier: MIT
'use strict';
// Explicit opt-in synthetic benchmark; deliberately excluded from the normal *.test.cjs suite.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{performance}=require('node:perf_hooks');
const Sync=require('../lib/client-sync.cjs'),S=require('../lib/state.cjs'),Registry=require('../lib/engine/registry.cjs'),{createApp}=require('../server.cjs');
const os=require('node:os');
const output=process.env.PIPI_BENCH_DIR||path.resolve(__dirname,'../outputs/integrated-optimization/batch-b/server');
fs.mkdirSync(output,{recursive:true});
process.env.ALLOW_PRIVATE_PROVIDERS='1'; // The source allowlist and socket guard below still require loopback.
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){let value=args[0];if(Array.isArray(value))value=value[0];if(typeof value==='number')value={port:value,host:typeof args[1]==='string'?args[1]:'localhost'};if(value&&typeof value==='object'&&value.port!==undefined)assert.ok(['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].includes(String(value.host||value.hostname||'localhost')),'Benchmark only permits loopback');return connect.apply(this,args);};
const label=process.argv[2]||'final',count=Number(process.env.PIPI_BENCH_SAMPLES||20),sizes=process.argv.slice(3).map(Number);
if(!sizes.length)sizes.push(1000,10000,50000);
assert.ok(Number.isInteger(count)&&count>=1&&count<=30);
assert.ok(sizes.every(n=>Number.isInteger(n)&&n>=count+3&&n<=50000));
const selected=(process.env.PIPI_BENCH_CASES||'legacy,chat').split(',');
assert.ok(selected.every(kind=>['legacy','chat'].includes(kind)));
const fixedAnswer='固定回复。';
function profile(events){
  const names=[...new Set(events.map(row=>row.name))];
  return Object.fromEntries(names.map(name=>[name,distribution(events.filter(row=>row.name===name).map(row=>row.ms))]));
}
const rounded=value=>Math.round(value*100)/100;
function distribution(values){const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p50Ms:rounded(sorted[Math.ceil(sorted.length*.5)-1]),p95Ms:rounded(sorted[Math.ceil(sorted.length*.95)-1]),maxMs:rounded(sorted.at(-1))};}
const heap=()=>{global.gc?.();return process.memoryUsage();};
async function run(messageCount,save){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-storage-bench-'));
  const results=[],mutations=[];
  let source,events=[],active,blockedResponse,waitingForModel,signalArrival;
  const provider=http.createServer((req,res)=>{
    const chunks=[];req.on('data',part=>chunks.push(part));req.on('end',()=>{
      if(!req.url.endsWith('/chat/completions')||!JSON.parse(Buffer.concat(chunks)).messages.length||!signalArrival){
        res.writeHead(400);res.end('unexpected fixture request');return;
      }
      blockedResponse=res;signalArrival();signalArrival=null;
    });
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const providerUrl='http://127.0.0.1:'+provider.address().port+'/v1';
  function releaseReply(){
    blockedResponse.writeHead(200,{'Content-Type':'application/json'});
    blockedResponse.end(JSON.stringify({model:'fixture',choices:[{message:{role:'assistant',content:fixedAnswer},finish_reason:'stop'}]}));blockedResponse=null;
  }
  function storageProbe(name,ms,kind){
    if(name==='mutate.start'){active=[];return;}
    const row={name,ms};events.push(row);
    if(active)active.push(row);
    if(name==='mutate.total'){
      if(kind)mutations.push({kind,ms,stages:active});
      active=null;
    }
  }
  const initialState=()=>{
    const state=S.initial();
    for(const module of Registry.modules)if(module.settings.some(field=>field.key==='enabled'))state.settings.modules[module.id]={...Registry.values(state,module.id),enabled:false};
    state.settings.ai.sources=[{id:'fixture',name:'Loopback',baseUrl:providerUrl,key:'fixture',builtin:false}];
    state.settings.ai.models=[{id:'fixture',sourceId:'fixture',model:'fixture',kind:'chat',capabilities:['text'],maxContextTokens:128000}];state.settings.ai.assign.chat='fixture';
    S.apply(state,'role.save',{name:'Alpha'});S.apply(state,'role.save',{name:'Beta'});
    state.messages=Array.from({length:messageCount},(_,i)=>({id:randomUUID(),roleId:state.roles[i%2].id,sender:'user',type:'text',content:'Synthetic message '+String(i).padStart(5,'0')+' '+'.'.repeat(190),createdAt:1700000000000,status:'sent'}));
    source=state;return state;
  };
  const app=createApp({dataDir,initialState,storageProbe,host:'127.0.0.1',port:0,trustProxy:'',providerUrlAllowlist:[providerUrl],mediaTimers:false,resetPassword:false,updates:{updateDir:''},fcm:{credentialFile:''}});
  await app.listen();const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  function request(route,body,{headers={},parse=false}={}){return new Promise((resolve,reject)=>{const start=performance.now(),payload=body===undefined?undefined:Buffer.from(JSON.stringify(body)),req=http.request(origin+route,{method:payload?'POST':'GET',headers:{Connection:'close',Cookie:cookie,...(payload?{Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json','Content-Length':payload.length}:{}),...headers}},response=>{let bytes=0;const chunks=[];response.on('data',chunk=>{bytes+=chunk.length;if(parse||response.statusCode!==200)chunks.push(chunk);});response.once('error',reject);response.once('end',()=>{if(response.statusCode!==200){reject(Error('HTTP '+response.statusCode+' '+route+' '+Buffer.concat(chunks).toString().slice(0,300)));return;}let value;if(parse)value=JSON.parse(Buffer.concat(chunks));if(response.headers['set-cookie'])cookie=response.headers['set-cookie'][0].split(';')[0];if(value?.csrfToken)csrf=value.csrfToken;resolve({ms:performance.now()-start,bytes,value});});});req.once('error',reject);req.end(payload);});}
  const report={messageCount,results};
  function record(kind,concurrency,rows,stages,extra={}){
    const result={kind,concurrency,...distribution(rows.map(row=>row.ms)),bodyBytes:rows[0]?.bytes===undefined?null:{min:Math.min(...rows.map(row=>row.bytes)),max:Math.max(...rows.map(row=>row.bytes))},stages:profile(stages),...extra};
    results.push(result);save(report);
    console.log(JSON.stringify({label,messages:messageCount,kind,concurrency,p50Ms:result.p50Ms,p95Ms:result.p95Ms}));
  }
  try{
    await request('/api/setup',{password:'Synthetic-benchmark-only-2026!'},{parse:true,headers:{'X-Pipi-State-Mode':'delta'}});
    const cursor=(await request('/api/sync',undefined,{parse:true})).value.cursor,roleId=source.roles[0].id;
    const headers={'X-Pipi-State-Mode':'delta','X-Pipi-Sync-Cursor':cursor};
    let sequence=0;
    if(selected.includes('legacy')){
      for(const concurrency of [1,4])for(const kind of ['profile-legacy','profile-delta','reset','page-50']){
        events=[];const memoryBefore=heap(),rows=[];
        for(let offset=0;offset<count;offset+=concurrency){
          const batch=Array.from({length:Math.min(concurrency,count-offset)},()=>kind.startsWith('profile')
            ?request('/api/action',{type:'profile.save',payload:{name:'Fixture '+String(++sequence).padStart(5,'0')}},{headers:kind==='profile-delta'?headers:{}})
            :request(kind==='reset'?'/api/sync':'/api/messages?roleId='+roleId+'&limit=50'));
          rows.push(...await Promise.all(batch));
        }
        const memoryAfter=heap();
        record(kind,concurrency,rows,events,{memoryAfterGcDeltaBytes:{heapUsed:memoryAfter.heapUsed-memoryBefore.heapUsed,rss:memoryAfter.rss-memoryBefore.rss,external:memoryAfter.external-memoryBefore.external}});
      }
      for(const messages of [true,false]){
        const times=[];for(let i=0;i<count;i++){const start=performance.now();Sync.capture(source,{messages});times.push(performance.now()-start);}
        report[messages?'fullCapture':'metadataCapture']=distribution(times);
      }
    }
    if(selected.includes('chat')){
      const action=(type,payload)=>request('/api/action',{type,payload},{parse:true,headers});
      const chat=[],read=[],chatEvents=[],readEvents=[];
      // Both user and assistant append exactly N-1 -> N, including at the 50,000 limit.
      // While the model is waiting, drop one old fixture message via the real API.
      await action('message.delete',{id:source.messages.at(-1).id});
      for(let n=0;n<count;n++){
        const current=(await request('/api/sync?cursor='+headers['X-Pipi-Sync-Cursor'],undefined,{parse:true})).value.cursor;
        headers['X-Pipi-Sync-Cursor']=current;
        waitingForModel=new Promise(resolve=>{signalArrival=resolve;});
        events=[];
        const receipt=await request('/api/chat',{roleId,text:'Fixture turn '+n,requestId:randomUUID()},{headers,parse:true});
        assert.ok(receipt.value.accepted&&receipt.value.messageId);chat.push(receipt);chatEvents.push(...events);
        let timer;
        try{await Promise.race([waitingForModel,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture did not receive the real model request')),90000);})]);}finally{clearTimeout(timer);}
        await action('message.delete',{id:source.messages[2*n+1].id});
        releaseReply();
        const until=Date.now()+90000;
        while(true){
          const progress=await request('/api/engine/chat-progress?roleId='+roleId,undefined,{parse:true});
          if(!progress.value.phase&&!progress.value.typing)break;
          assert.ok(Date.now()<until,'role delivery did not finish');
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        const last=(await request('/api/messages?roleId='+roleId+'&limit=1',undefined,{parse:true})).value.messages[0];
        assert.equal(last.sender,'assistant');assert.equal(last.content,fixedAnswer);
        events=[];const marked=await action('conversation.read',{roleId});read.push(marked);readEvents.push(...events);
        assert.equal(marked.value.sync.changes.replace.roles.find(role=>role.id===roleId).unread,0);
        await action('message.delete',{id:last.id});
      }
      record('chat-http',1,chat,chatEvents);record('conversation.read',1,read,readEvents);
      for(const [sender,kind]of [['user','user-append'],['assistant','role-bubble']]){
        const appends=mutations.filter(x=>x.kind===sender);assert.equal(appends.length,count);
        record(kind,1,appends,appends.flatMap(x=>x.stages));
      }
    }
    report.storedJsonBytes=app.db.prepare('SELECT length(CAST(json AS BLOB)) AS n FROM app WHERE id=1').get().n;
    save(report);
  }finally{blockedResponse?.destroy();await app.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
}
(async()=>{
  const files=['server.cjs','lib/state.cjs','lib/client-sync.cjs','tests/client-sync-benchmark.cjs'];
  const report={label,node:process.version,platform:process.platform,date:new Date().toISOString(),samplesPerScenario:count,transport:'Native HTTP loopback; HTTP timings include receipt/body. user-append and role-bubble time only the real synchronous mutate through commit and notification. Model returns a fixed reply. Both appends move N-1 to N; old fixture cleanup and waits are outside append samples.',hashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')])),scales:[]};
  const file=path.join(output,'benchmark-'+label+'.json');
  for(const size of sizes){let index=report.scales.length;await run(size,scale=>{report.scales[index]=scale;fs.writeFileSync(file,JSON.stringify(report,null,2));});}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{net.Socket.prototype.connect=connect;});
