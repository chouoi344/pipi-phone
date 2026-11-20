// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function fresh(){const path=require.resolve('../lib/engine/model-catalog.cjs');delete require.cache[path];return require(path);}
const response=data=>({ok:true,json:async()=>data});
const directory={example:{models:{image:{id:'example-image',modalities:{input:['text','image']},tool_call:true,limit:{context:32000}},audio:{id:'example-audio',modalities:{input:['audio']},tool_call:false,limit:{context:0}}}}};

test('local catalog and relay evidence work offline and keep legacy APIs unchanged',async()=>{
  const M=fresh(),offline=()=>{throw new Error('must stay offline');};
  assert.equal((await M.metadata('gpt-4o',{fetchImpl:offline})).source,'local-catalog');
  const relay=await M.metadata('gemini-3.8-flash-按次',{baseUrl:'https://choupi.tech/v1/',fetchImpl:offline});
  assert.deepEqual(relay.capabilities,['text','image','audio','tool_use']);assert.equal(relay.maxContextTokens,0);
  assert.deepEqual((await M.metadata('gemini-4-hydrogen-按次',{baseUrl:'https://choupi.tech/v1',fetchImpl:offline})).capabilities,['text','image','tool_use']);
  relay.capabilities.length=0;
  assert.equal((await M.metadata('gemini-3.8-flash-按次',{baseUrl:'https://choupi.tech/v1',fetchImpl:offline})).capabilities.length,4);
  assert.deepEqual(M.lookup('gemini-3.8-flash-按次'),{capabilities:['text','image','audio','tool_use'],maxContextTokens:0});
  assert.equal(M.capacity({model:'unknown',maxContextTokens:0}),128000);
});

test('public metadata matches full IDs, shares concurrent downloads and never sends user configuration',async()=>{
  const M=fresh(),requests=[];
  const fetchImpl=async(url,options)=>{requests.push({url,options});return response(directory);};
  const [image,audio,unknown]=await Promise.all([M.metadata('example-image',{baseUrl:'https://private.example/v1',fetchImpl}),M.metadata('example-audio',{fetchImpl}),M.metadata('example-image-suffix',{fetchImpl})]);
  assert.equal(requests.length,1);assert.equal(requests[0].url,'https://models.dev/api.json');
  assert.deepEqual(Object.keys(requests[0].options),['signal']);
  assert.deepEqual(image,{known:true,capabilities:['text','image','tool_use'],maxContextTokens:32000,source:'public-catalog',matchedModel:'example-image',capacity:{value:32000,source:'metadata',recognized:true}});
  assert.deepEqual(audio.capabilities,['text','audio']);assert.equal(audio.maxContextTokens,0);
  assert.deepEqual(unknown,{known:false,capabilities:['text','image','audio','tool_use'],maxContextTokens:0,source:'unknown',capacity:{value:128000,source:'fallback',recognized:false}});
  image.capabilities.length=0;assert.equal((await M.metadata('example-image',{fetchImpl})).capabilities.length,3);
  assert.equal((await M.metadata('gemini-3.8-flash-按次',{baseUrl:'https://another.example/v1',fetchImpl})).known,false);
  assert.equal(requests.length,1);
});

test('public directory falls back to the second fixed endpoint',async()=>{
  const M=fresh(),urls=[];
  const result=await M.metadata('example-image',{fetchImpl:async url=>{urls.push(url);return urls.length===1?{ok:false}:response(directory);}});
  assert.equal(result.known,true);assert.deepEqual(urls,['https://models.dev/api.json','https://models.opencode.ai/api.json']);
});

test('unavailable or invalid directories return a visible warning and cache failures briefly',async()=>{
  const M=fresh();let calls=0;
  const fetchImpl=async()=>{calls++;return response([]);};
  const result=await M.metadata('unknown',{fetchImpl});assert.equal(result.known,false);assert.match(result.warning,/无法读取/);
  await M.metadata('another-unknown',{fetchImpl});assert.equal(calls,2);
});

test('successful metadata expires after 24 hours and failed requests retry after one minute',async()=>{
  const M=fresh(),realNow=Date.now;let now=100000,calls=0,available=false;
  Date.now=()=>now;
  try{
    const fetchImpl=async()=>{calls++;if(!available)throw new Error('offline');return response(directory);};
    await M.metadata('example-image',{fetchImpl});assert.equal(calls,2);
    now+=59999;await M.metadata('example-image',{fetchImpl});assert.equal(calls,2);
    now++;available=true;assert.equal((await M.metadata('example-image',{fetchImpl})).known,true);assert.equal(calls,3);
    now+=24*60*60*1000-1;await M.metadata('example-image',{fetchImpl});assert.equal(calls,3);
    now++;await M.metadata('example-image',{fetchImpl});assert.equal(calls,4);
  }finally{Date.now=realNow;}
});

test('capacity zero resolves public metadata while a manual value takes precedence without a download',async()=>{
  const M=fresh(),requests=[],fetchImpl=async url=>{requests.push(url);return response(directory);};
  assert.deepEqual(await M.resolveCapacity({model:'example-image',maxContextTokens:64000},{fetchImpl}),{value:64000,source:'manual',recognized:false});
  assert.equal(requests.length,0);
  assert.deepEqual(await M.resolveCapacity({model:'example-image',maxContextTokens:0},{fetchImpl}),{value:32000,source:'metadata',recognized:true});
  assert.deepEqual(await M.resolveCapacity({model:'missing',maxContextTokens:0},{fetchImpl}),{value:128000,source:'fallback',recognized:false});
  assert.deepEqual(await M.resolveCapacity({model:'example-audio',maxContextTokens:0},{fetchImpl}),{value:128000,source:'fallback',recognized:false});
  assert.equal(requests.length,1);
  assert.deepEqual((await M.metadata('example-image',{maxContextTokens:70000,fetchImpl})).capacity,{value:70000,source:'manual',recognized:false});
});

test('verified relay capabilities do not claim an unknown context limit or hide an exact public match',async()=>{
  const M=fresh(),name='gemini-4-hydrogen-按次',fetchImpl=async()=>response({relay:{models:{exact:{id:name,modalities:{input:['audio']},limit:{context:64000}}}}});
  const result=await M.metadata(name,{baseUrl:'https://choupi.tech/v1',fetchImpl});
  assert.deepEqual(result.capabilities,['text','image','tool_use']);
  assert.deepEqual(result.capacity,{value:64000,source:'metadata',recognized:true});
  const unknown=await M.metadata('gemini-3.8-flash-按次',{baseUrl:'https://choupi.tech/v1',fetchImpl});
  assert.equal(unknown.known,true);assert.deepEqual(unknown.capacity,{value:128000,source:'fallback',recognized:false});
});

test('capacity and capabilities share flexible matching and prefer original vendor records over relay duplicates',async()=>{
  const M=fresh(),entry=(id,context,input=['text','image','audio'],tool_call=true)=>({id,limit:{context},modalities:{input},tool_call});
  const models={flash:entry('gemini-3.5-flash',1048576),lite:entry('gemini-3.5-flash-lite',1048576,['text','image'],false),other:entry('gemini-3.8-flash',1048576),hydrogen:entry('gemini-4-hydrogen',1048576)};
  const fetchImpl=async()=>response({aaa:{models:{flash:entry('gemini-3.5-flash',200000)}},google:{models},zzz:{models:{flash:entry('gemini-3.5-flash',1000000)}}});
  for(const [name,matched] of [['gemini-3.5-flash-按次','gemini-3.5-flash'],['XXX Gemini 3.5 Flash','gemini-3.5-flash'],['GEMINI_3.5_FLASH_LITE-按次','gemini-3.5-flash-lite'],['Gemini 3.5 Flash (Lite)','gemini-3.5-flash-lite'],['XXX Gemini 3.5 Flash（Lite）-按次','gemini-3.5-flash-lite'],['gemini-3.8-flash-按次','gemini-3.8-flash'],['gemini-4-hydrogen-按次','gemini-4-hydrogen']]){
    const result=await M.metadata(name,{baseUrl:'https://choupi.tech/v1',fetchImpl});
    assert.equal(result.matchedModel,matched);assert.equal(result.capacity.value,1048576);assert.equal(result.capacity.recognized,true);
    if(matched.endsWith('lite'))assert.deepEqual(result.capabilities,['text','image']);
    if(matched.endsWith('hydrogen'))assert.deepEqual(result.capabilities,['text','image','tool_use']);
  }
  const abbreviated=await M.metadata('xxx Gemini3.5',{fetchImpl});
  assert.equal(abbreviated.known,false);assert.equal(abbreviated.needsChoice,true);assert.deepEqual(abbreviated.candidates,['gemini-3.5-flash','gemini-3.5-flash-lite']);assert.equal(abbreviated.capacity.recognized,false);
  const pro=await M.metadata('gemini-3.5-pro',{fetchImpl});assert.equal(pro.known,false);assert.equal(pro.matchedModel,undefined);
  const unknownLite=await M.metadata('gemini-3.8-flash-lite',{fetchImpl});assert.equal(unknownLite.known,false);assert.equal(unknownLite.matchedModel,undefined);
  for(const name of ['gemini-3.5-flash.preview','Gemini 3.5 Flash (Preview)','XXX Gemini 3.8 Flash（Lite）-按次']){
    const result=await M.metadata(name,{fetchImpl});assert.equal(result.known,false,name);assert.equal(result.matchedModel,undefined,name);assert.equal(result.capacity.recognized,false,name);
  }
});
