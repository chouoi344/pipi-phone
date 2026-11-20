// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const S=require('../lib/state.cjs'),AI=require('../lib/providers.cjs'),P=require('../lib/engine/pipeline.cjs'),R=require('../lib/engine/registry.cjs'),Runtime=require('../lib/engine/runtime.cjs');
const {createApp}=require('../scripts/sample-data.cjs');
const audio='data:audio/wav;base64,UklGRg==',understanding={text:'好吧',contentEmotion:'接受',voiceEmotion:'委屈'};
function voice(s){return S.message(s,s.roles[0],'user','','voice',{meta:{audio,durationMs:500},status:'sent'});}
const backup=s=>({format:'pipi-phone',version:1,state:S.backupState(s)});
test('voice metadata survives backup, individual/merged forwarding and model context',()=>{
  const s=sampleState(),m=voice(s);Object.assign(m.meta,{transcript:understanding.text,contentEmotion:understanding.contentEmotion,voiceEmotion:understanding.voiceEmotion});
  const restored=S.validateBackup(backup(s),s),saved=S.find(restored.messages,m.id);assert.deepEqual(saved.meta,m.meta);
  for(const mode of ['individual','merged']){S.apply(restored,'message.forward',{ids:[m.id],targetRoleId:restored.roles[1].id,mode});const forwarded=restored.messages.at(-1),meta=mode==='merged'?forwarded.meta.entries[0].meta:forwarded.meta;assert.equal(meta.voiceEmotion,'委屈');assert.equal(meta.contentEmotion,'接受');const rendered=P.render(restored,forwarded,false);assert.match(rendered.content,/内容情绪：接受/);assert.match(rendered.content,/声音情绪：委屈/);}
  const invalid=backup(s);invalid.state.messages.find(x=>x.id===m.id).meta.voiceEmotion='长'.repeat(201);assert.throws(()=>S.validateBackup(invalid,s),/200/);
});
test('saved voice route uses understanding while input dictation and cached messages do not',async t=>{
  const original={transcribe:AI.transcribe,understandVoice:AI.understandVoice},calls=[];
  AI.transcribe=async()=>{calls.push('transcribe');return '输入框原话';};AI.understandVoice=async()=>{calls.push('understand');return understanding;};t.after(()=>Object.assign(AI,original));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-voice-understanding-')),app=createApp({dataDir:dir,host:'127.0.0.1',port:0});await app.listen();t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  async function request(route,body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'X-CSRF-Token':csrf,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;assert.equal(response.status,200,JSON.stringify(value));return value;}
  await request('/api/setup',{password:'Voice-Isolated-Test-123!'});const s=(await request('/api/backup')).state,m=voice(s);await request('/api/restore',{backup:{format:'pipi-phone',version:1,state:s},confirm:true});
  assert.equal((await request('/api/voice/transcribe',{audio})).text,'输入框原话');assert.deepEqual(calls,['transcribe']);
  const result=await request('/api/voice/transcribe',{messageId:m.id}),saved=result.state.messages.find(x=>x.id===m.id);assert.equal(saved.meta.transcript,'好吧');assert.equal(saved.meta.contentEmotion,'接受');assert.equal(saved.meta.voiceEmotion,'委屈');
  await request('/api/voice/transcribe',{messageId:m.id});assert.deepEqual(calls,['transcribe','understand']);
  const b=await request('/api/backup');delete b.state.messages.find(x=>x.id===m.id).meta.voiceEmotion;delete b.state.messages.find(x=>x.id===m.id).meta.contentEmotion;await request('/api/restore',{backup:b,confirm:true});await request('/api/voice/transcribe',{messageId:m.id});assert.deepEqual(calls,['transcribe','understand'],'legacy cache must not trigger new analysis');
});
test('runtime saves voice understanding before passing separate emotions to chat model',async t=>{
  const original=AI.understandVoice;let calls=0;AI.understandVoice=async()=>{calls++;return understanding;};t.after(()=>{AI.understandVoice=original;});
  let s=sampleState();s.messages=[];const roleId=s.roles[0].id;R.apply(s,'waiting',{idleSeconds:0,maxWaitSeconds:1});R.apply(s,'segments',{minSeconds:0,maxSeconds:0});
  const config={id:'mock',kind:'chat',capabilities:['text'],maxContextTokens:128000};s.settings.ai.sources.push({id:'mock',baseUrl:'https://mock.invalid',key:'ISOLATED'});s.settings.ai.models.push({...config,sourceId:'mock',model:'mock'});s.settings.ai.assign.chat='mock';s.settings.ai.assign.chatSelections=['mock'];
  const requests=[],getState=()=>structuredClone(s),mutate=fn=>{const next=getState(),value=fn(next);s=next;return {state:getState(),value};};
  const modelApi={resolve:()=>config,call:async(_,req)=>{requests.push(req);return {message:{content:'听到了'},model:config,modelId:'mock'};}};
  const runtime=Runtime.create({getState,mutate,modelApi});t.after(()=>runtime.close());const m=voice(s);m.status='pending';runtime.enqueue(roleId,m.id);
  for(let i=0;i<300&&runtime.isBusy(roleId);i++)await new Promise(r=>setTimeout(r,5));assert.equal(runtime.isBusy(roleId),false);const saved=S.find(s.messages,m.id);assert.equal(saved.status,'sent',saved.error);assert.equal(saved.meta.voiceEmotion,'委屈');assert.equal(calls,1);assert.match(JSON.stringify(requests),/内容情绪：接受/);assert.match(JSON.stringify(requests),/声音情绪：委屈/);
});
