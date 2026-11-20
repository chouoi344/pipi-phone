const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../lib/engine/models.cjs'),P=require('../lib/providers.cjs'),C=require('../lib/engine/model-catalog.cjs'),timers=require('node:timers/promises');
function state(){return {settings:{ai:{sources:[{id:'isolated',name:'隔离',baseUrl:'https://isolated.invalid',key:'ISOLATED'}],models:['main','backup','third'].map(id=>({id,sourceId:'isolated',model:id,kind:'chat',capabilities:['text'],maxContextTokens:10000,extraBody:{}})),assign:{chat:'main',chatFallbacks:['backup','third']}}}};}
const answer=()=>({choices:[{message:{role:'assistant',content:'好'}}]});
const failure=(code,upstreamStatus)=>Object.assign(new Error(code),{code,upstreamStatus});
function setup(t,request){t.mock.method(C,'resolveCapacity',async()=>({value:10000}));t.mock.method(P,'request',request);const waits=[];t.mock.method(timers,'setTimeout',async ms=>{waits.push(ms);});return waits;}
test('bounded retry recovers on same model with exponential waits and unchanged configuration',async t=>{
 const calls=[],waits=setup(t,async c=>{calls.push(c.id);if(calls.length<5)throw failure('PROVIDER_NETWORK');return answer();}),s=state(),before=JSON.stringify(s.settings.ai.models);
 assert.equal((await M.call(s,{messages:[]})).modelId,'main');assert.deepEqual(calls,Array(5).fill('main'));assert.deepEqual(waits,[1000,2000,4000,8000]);assert.equal(JSON.stringify(s.settings.ai.models),before);
});
test('network timeout 429 5xx and empty responses exhaust each configured candidate in order',async t=>{
 const calls=[];setup(t,async c=>{calls.push(c.id);const n=calls.length;if(n<=5)throw failure(n%2?'PROVIDER_TIMEOUT':'PROVIDER_ERROR',n%2?undefined:429);if(n<=8)return {choices:[{message:{content:''}}]};return answer();});
 assert.equal((await M.call(state(),{messages:[]})).modelId,'third');assert.deepEqual(calls,[...Array(5).fill('main'),...Array(3).fill('backup'),'third']);
});
test('all exhausted returns final upstream error, not an invented success',async t=>{
 const last=failure('PROVIDER_ERROR',503);let calls=0;setup(t,async()=>{calls++;throw last;});await assert.rejects(M.call(state(),{messages:[]}),e=>e===last);assert.equal(calls,15);
});
test('auth and parameter failures stop after one attempt',async t=>{
 for(const status of [400,401,403,422]){let calls=0;setup(t,async()=>{calls++;throw failure('PROVIDER_ERROR',status);});await assert.rejects(M.call(state(),{messages:[]}),e=>e.upstreamStatus===status);assert.equal(calls,1);t.mock.restoreAll();}
});
test('cancellation during retry delay stops without backup and clears real delay',async t=>{
 const controller=new AbortController();let calls=0;setup(t,async()=>{calls++;throw failure('PROVIDER_NETWORK');});t.mock.restoreAll();t.mock.method(C,'resolveCapacity',async()=>({value:10000}));t.mock.method(P,'request',async()=>{calls++;throw failure('PROVIDER_NETWORK');});
 const pending=M.call(state(),{messages:[],signal:controller.signal});setImmediate(()=>controller.abort());await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('usage storage failure never repeats a successful or failed model request',async t=>{
 for(const succeeds of [true,false]){let calls=0;setup(t,async()=>{calls++;if(!succeeds)throw failure('PROVIDER_NETWORK');return answer();});const storage=new Error('usage write failed');await assert.rejects(M.call(state(),{messages:[],onUsage:()=>{throw storage;}}),e=>e===storage);assert.equal(calls,1);t.mock.restoreAll();}
});
test('invalid or undersized candidates fall through once; unknown preparation errors remain visible',async t=>{
 const calls=[];setup(t,async c=>{calls.push(c.id);return answer();});const s=state();s.settings.ai.models[0].sourceId='missing';const prepared=[];
 const result=await M.call(s,{messages:[],prepareMessages:c=>{prepared.push(c.id);if(c.id==='backup')throw failure('CONTEXT_LIMIT');return [];}});assert.equal(result.modelId,'third');assert.deepEqual(prepared,['backup','third']);assert.deepEqual(calls,['third']);
 await assert.rejects(M.call(state(),{messages:[],prepareMessages:()=>{throw new TypeError('bug');}}),{name:'TypeError',message:'bug'});assert.deepEqual(calls,['third']);
});
test('cancellation before preparation never starts an upstream request',async t=>{let calls=0;setup(t,async()=>{calls++;return answer();});const controller=new AbortController();controller.abort();await assert.rejects(M.call(state(),{messages:[],signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);});
test('initial chat configuration skips unavailable primary but explicit selection still reports it',async t=>{
 setup(t,async()=>answer());const s=state();s.settings.ai.models[0].sourceId='missing';assert.equal((await M.resolveChat(s)).id,'backup');await assert.rejects(M.resolveChat(s,'chat',{modelId:'main'}),{code:'PROVIDER_UNCONFIGURED'});
 s.settings.ai.models=s.settings.ai.models.slice(0,1);await assert.rejects(M.resolveChat(s),{code:'PROVIDER_UNCONFIGURED'});
});

test('mixed transient and empty errors share five total requests with at most three empty results',async t=>{
 const calls=[];setup(t,async c=>{calls.push(c.id);if(c.id!=='main')return answer();if(calls.length%2)throw failure('PROVIDER_NETWORK');return {choices:[{message:{content:''}}]};});
 assert.equal((await M.call(state(),{messages:[]})).modelId,'backup');assert.deepEqual(calls,[...Array(5).fill('main'),'backup']);
});

test('missing primary reports configuration without using configured fallback models',async t=>{
 const calls=[];setup(t,async c=>{calls.push(c.id);throw failure('PROVIDER_NETWORK');});const s=state();s.settings.ai.assign.chat='';
 await assert.rejects(M.call(s,{messages:[]}),{code:'PROVIDER_UNCONFIGURED'});assert.deepEqual(calls,[]);
 s.settings.ai.assign.chat='main';s.settings.ai.models[0].sourceId='missing';
 await assert.rejects(M.call(s,{messages:[]}),{code:'PROVIDER_NETWORK'});assert.deepEqual(calls,[...Array(5).fill('backup'),...Array(5).fill('third')]);
 s.settings.ai.assign.chatFallbacks=[];await assert.rejects(M.call(s,{messages:[]}),{code:'PROVIDER_UNCONFIGURED'});assert.equal(calls.length,10);
});

test('summary failure makes one request without retry delay or chat fallbacks',async t=>{
 const calls=[],waits=setup(t,async c=>{calls.push(c.id);throw failure('PROVIDER_NETWORK');}),s=state();s.settings.ai.assign.compress='main';
 await assert.rejects(M.call(s,{purpose:'compress',messages:[]}),{code:'PROVIDER_NETWORK'});assert.deepEqual(calls,['main']);assert.deepEqual(waits,[]);
});
