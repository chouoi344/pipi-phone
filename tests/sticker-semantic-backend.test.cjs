// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs'),T=require('../lib/engine/stickers.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const meaning={meaning:'开心欢迎',tags:['开心','欢迎'],usage:'欢迎朋友',description:'小猫挥手',visibleText:'你好'};
function fixture(configured=true,call=async()=>({message:{content:JSON.stringify(meaning)}})){
  let state=sampleState();S.apply(state,'sticker.add',{image:PNG});S.defaults(state);
  if(configured){state.settings.ai.sources.push({id:'stub',name:'隔离测试',builtin:false,baseUrl:'https://isolated.invalid/v1',key:'isolated'});state.settings.ai.models.push({id:'vision',sourceId:'stub',model:'vision',kind:'chat',capabilities:['text','image'],temperature:null,maxTokens:null});state.settings.ai.assign.caption='vision';}
  let calls=0;
  const queue=T.create({getState:()=>structuredClone(state),mutate:fn=>{const value=fn(state);return {state:structuredClone(state),value};},modelApi:{call:async(...args)=>{calls++;return call(...args);}}});
  return {get state(){return state;},queue,get calls(){return calls;},input:()=>({ids:[state.stickers[0].id]})};
}
test('shared hash annotation, private fields, manual edit and backup roundtrip',async()=>{
  const f=fixture();f.queue.enqueue(f.input());await f.queue.idle();assert.equal(f.calls,1);
  assert.equal(T.get(f.state,PNG).meaning,meaning.meaning);
  f.queue.enqueue(f.input());await f.queue.idle();assert.equal(f.calls,1);
  const publicState=S.publicState(f.state);assert.equal(publicState.stickerSemantics,undefined);assert.equal(publicState.stickers[0].semantic.description,undefined);
  S.apply(f.state,'sticker.semantic.save',{id:f.state.stickers[0].id,meaning:'打招呼',tags:['友好'],usage:'见面'});
  assert.equal(T.get(f.state,PNG).description,'小猫挥手');
  const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(f.state)},f.state);
  assert.equal(T.get(restored,PNG).manual,true);assert.equal(T.get(restored,PNG).meaning,'打招呼');assert.equal(T.get(restored,PNG).visibleText,'你好');
  await f.queue.close();
});
test('unconfigured stays pending with reason and no request',async()=>{
  const f=fixture(false);f.queue.enqueue(f.input());await f.queue.idle();assert.equal(f.calls,0);assert.equal(T.get(f.state,PNG).status,'pending');assert.match(T.get(f.state,PNG).error,/配置/);await f.queue.close();
});
test('failed provider response stays visible until an explicit retry',async()=>{
  const f=fixture(true,async()=>({message:{content:'{"meaning":123}'}}));f.queue.enqueue(f.input());await f.queue.idle();assert.equal(T.get(f.state,PNG).status,'failed');assert.equal(f.calls,1);
  await f.queue.idle();assert.equal(f.calls,1);f.queue.enqueue(f.input());await f.queue.idle();assert.equal(f.calls,2);await f.queue.close();
});
test('in-flight model response cannot overwrite manual correction',async()=>{
  let finish;const response=new Promise(resolve=>{finish=resolve;});
  const f=fixture(true,async()=>response);f.queue.enqueue(f.input());
  S.apply(f.state,'sticker.semantic.save',{id:f.state.stickers[0].id,meaning:'人工纠正',tags:[],usage:''});
  finish({message:{content:JSON.stringify(meaning)}});await f.queue.idle();assert.equal(T.get(f.state,PNG).meaning,'人工纠正');await f.queue.close();
});
test('queued jobs recover but old pending images never start automatically',async()=>{
  const f=fixture();f.queue.recover();await f.queue.idle();assert.equal(f.calls,0);
  T.get(f.state,PNG).status='analyzing';f.queue.recover();await f.queue.idle();assert.equal(f.calls,1);assert.equal(T.get(f.state,PNG).status,'ready');await f.queue.close();
});
test('animation frame requirements and single-frame GIF detection',async()=>{
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');assert.equal(T.animated(gif),false);
  const f=fixture();assert.throws(()=>f.queue.enqueue({...f.input(),frames:{[f.state.stickers[0].id]:Array(6).fill(PNG)}}),/1至5/);
  f.queue.enqueue({...f.input(),frames:{[f.state.stickers[0].id]:[PNG]}});await f.queue.idle();assert.equal(f.calls,1);await f.queue.close();
});
test('animated GIF needs multiple frames and failed jobs accept explicit retry',async()=>{
  const single=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const frame=single.subarray(27,single.length-1),animation=Buffer.concat([single.subarray(0,single.length-1),frame,Buffer.from([0x3b])]);
  assert.equal(T.animated(animation),true);
  const f=fixture();f.state.stickers[0].image='data:image/gif;base64,'+animation.toString('base64');T.ensure(f.state);
  f.queue.enqueue(f.input());await f.queue.idle();assert.equal(T.get(f.state,f.state.stickers[0].image).status,'failed');assert.equal(f.calls,0);
  f.queue.enqueue({...f.input(),frames:{[f.state.stickers[0].id]:[PNG,PNG]}});await f.queue.idle();assert.equal(f.calls,1);assert.equal(T.get(f.state,f.state.stickers[0].image).status,'ready');await f.queue.close();
});
test('persisted analysis frames use media references and survive queue restart',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-semantic-frames-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dataDir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dataDir).startsWith('pipi-semantic-frames-'));fs.rmSync(dataDir,{recursive:true,force:true});});
  const f=fixture(false);await f.queue.close();let state=f.state;
  const mutate=fn=>{const value=fn(state);return {state:structuredClone(state),value};};
  const queue=T.create({getState:()=>structuredClone(state),mutate,dataDir});
  assert.throws(()=>queue.enqueue({...f.input(),frames:{[state.stickers[0].id]:[PNG,'bad-frame']}}),/图片格式无效/);assert.equal(fs.existsSync(path.join(dataDir,'media')),false);
  queue.enqueue({...f.input(),frames:{[state.stickers[0].id]:[PNG,PNG]}});await queue.idle();
  const saved=T.get(state,PNG);assert.equal(saved.frames.length,2);assert.ok(saved.frames.every(ref=>/^\/api\/media\/[a-f0-9]{64}\.png$/.test(ref)));
  await queue.close();fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify(state));state=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'));
  const configured=fixture();state.settings.ai=configured.state.settings.ai;await configured.queue.close();T.get(state,PNG).status='queued';let calls=0;
  const resumed=T.create({getState:()=>structuredClone(state),mutate,dataDir,modelApi:{async call(s,input){calls++;assert.deepEqual(input.messages[1].content.map(part=>part.image_url.url),[PNG,PNG]);return {message:{content:JSON.stringify(meaning)}};}}});
  resumed.recover();await resumed.idle();assert.equal(calls,1);assert.equal(T.get(state,PNG).status,'ready');await resumed.close();
});
