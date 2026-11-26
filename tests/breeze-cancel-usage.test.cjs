// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:wait,setImmediate:turn}=require('node:timers/promises'),P=require('../lib/providers.cjs');
const mp3=fs.readFileSync(path.join(__dirname,'../scripts/demo-assets/tone.mp3'));
async function until(check){const end=Date.now()+2000;while(Date.now()<end){if(check())return;await wait(2);}throw Error('共享语音隔离HTTP等待超时');}
async function fixture(t){
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const requests=[],usage=[];let transports=0;
  const original=P.request;t.mock.method(P,'request',async(...args)=>{try{return await original(...args);}finally{transports++;}});
  const server=http.createServer(async(req,res)=>{for await(const _chunk of req){}requests.push(res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;});
  const state={roles:[],settings:{ai:{sources:[{id:'fixture',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',key:'synthetic-loopback-only',template:'breezeblue'}],models:[{id:'tts',sourceId:'fixture',model:'breeze-tts-2',kind:'tts',voice:'fixture-voice',extraBody:{},capabilities:[],timeoutSeconds:2}],assign:{tts:'tts',chatFallbacks:[]}}}};
  const speak=(text,signal,onUsage=row=>usage.push(row))=>P.speak(state,text,{signal,onUsage});
  const release=(index,{status=200,body=mp3}={})=>{requests[index].writeHead(status,{'Content-Type':status===200?'audio/mpeg':'application/json'});requests[index].end(body);};
  const settled=async count=>{await until(()=>transports>=count);await turn();};
  return {requests,usage,speak,release,settled};
}
test('首等待者取消，其他等待者收到共享音频，实际一次HTTP仍记录一次用量',async t=>{
  const f=await fixture(t),controller=new AbortController();const first=f.speak('首调用取消',controller.signal);await until(()=>f.requests.length===1);const second=f.speak('首调用取消');
  controller.abort();await assert.rejects(first,{name:'AbortError'});f.release(0);assert.match(await second,/^data:audio\//);await f.settled(1);
  assert.equal(f.requests.length,1);assert.equal(f.usage.length,1);assert.equal(f.usage[0].success,true);
});
test('所有等待者均取消，已经开始的共享合成完成后仍留下实际调用记录',async t=>{
  const f=await fixture(t),a=new AbortController(),b=new AbortController();const first=f.speak('全部取消',a.signal);await until(()=>f.requests.length===1);const second=f.speak('全部取消',b.signal);
  a.abort();b.abort();await Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);f.release(0);await f.settled(1);
  assert.equal(f.requests.length,1);assert.equal(f.usage.length,1);assert.equal(f.usage[0].success,true);
});
test('首等待者取消后底层HTTP失败，其他调用暴露错误且只记一次失败',async t=>{
  const f=await fixture(t),controller=new AbortController();const first=f.speak('共享失败',controller.signal);await until(()=>f.requests.length===1);const second=f.speak('共享失败');
  controller.abort();await assert.rejects(first,{name:'AbortError'});f.release(0,{status:400,body:JSON.stringify({error:'synthetic failure'})});await assert.rejects(second,error=>error.upstreamStatus===400);await f.settled(1);
  assert.equal(f.requests.length,1);assert.equal(f.usage.length,1);assert.equal(f.usage[0].success,false);assert.ok(!f.usage[0].error.includes('synthetic-loopback-only'));
});
test('首调用取消后再加入多个等待者，已有共享合成不重发、不重复记费',async t=>{
  const f=await fixture(t),controller=new AbortController();const first=f.speak('晚加入共享',controller.signal);await until(()=>f.requests.length===1);controller.abort();await assert.rejects(first,{name:'AbortError'});
  const second=f.speak('晚加入共享'),third=f.speak('晚加入共享');f.release(0);const audio=await Promise.all([second,third]);await f.settled(1);
  assert.equal(audio[0],audio[1]);assert.equal(f.requests.length,1);assert.equal(f.usage.length,1);
});
test('排队但尚未开始的合成取消后不发请求、不记作已发生调用',async t=>{
  const f=await fixture(t),first=f.speak('占用一'),second=f.speak('占用二');await until(()=>f.requests.length===2);const controller=new AbortController(),queued=f.speak('未开始即取消',controller.signal);
  controller.abort();await assert.rejects(queued,{name:'AbortError'});f.release(0);f.release(1);await Promise.all([first,second]);await f.settled(2);
  assert.equal(f.requests.length,2);assert.equal(f.usage.length,2);
});
test('迟到用量写入错误对仍在等待的调用可见，不因此再次请求语音服务',async t=>{
  const f=await fixture(t),controller=new AbortController(),storageError=new Error('synthetic usage storage failure');
  const first=f.speak('计量失败',controller.signal,()=>{throw storageError;});await until(()=>f.requests.length===1);const second=f.speak('计量失败');controller.abort();await assert.rejects(first,{name:'AbortError'});f.release(0);
  await assert.rejects(second,error=>error===storageError);assert.equal(f.requests.length,1);
});
for(const failure of ['usage','provider'])test('所有等待者取消后的后台'+failure+'错误留下脱敏日志且不重发',async t=>{
  const f=await fixture(t),controller=new AbortController(),logs=[];
  t.mock.method(console,'error',(...args)=>logs.push(args.join(' ')));
  const storageError=new Error('synthetic-loopback-only should stay private');
  const pending=f.speak('无人等待的失败-'+failure,controller.signal,failure==='usage'?()=>{throw storageError;}:row=>f.usage.push(row));
  await until(()=>f.requests.length===1);controller.abort();await assert.rejects(pending,{name:'AbortError'});
  f.release(0,failure==='provider'?{status:400,body:JSON.stringify({error:'api_key=synthetic-loopback-only'})}:{});await f.settled(1);
  assert.equal(f.requests.length,1);assert.equal(logs.length,1);assert.match(logs[0],/共享语音.*失败/);assert.ok(!logs[0].includes('synthetic-loopback-only'));
});
