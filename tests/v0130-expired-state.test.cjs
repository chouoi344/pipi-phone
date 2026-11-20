// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs');
const original='/api/media/'+'a'.repeat(64)+'.png',thumb='/api/media/'+'b'.repeat(64)+'.jpg',modelImage='/api/media/'+'c'.repeat(64)+'.jpg',audio='/api/media/'+'d'.repeat(64)+'.wav';
const at=Date.UTC(2026,10,20,12);
function fixture(){
  const state=S.initial();S.apply(state,'role.save',{name:'甲'});S.apply(state,'role.save',{name:'乙'});
  const [role,target]=state.roles;
  const image=S.message(state,role,'user',original,'image',{meta:{thumb,modelImage,caption:'旧图片的文字描述'}});
  const text=S.message(state,role,'user','图文消息的正文','text',{meta:{image:original,thumb,modelImage,caption:'图文图片描述'}});
  const voice=S.message(state,role,'user','原语音正文','voice',{meta:{audio,durationMs:2500,transcript:'原语音的转写',transcriptSource:'provider',voiceEmotion:'平静'}});
  S.apply(state,'message.favorite',{id:image.id});S.apply(state,'message.favorite',{id:voice.id});
  const reply=S.message(state,role,'assistant','回复引用','text',{meta:{quote:S.quote(state,role.id,image.id)}});
  for(const message of [image,text]){
    if(message.type==='image')message.content='';delete message.meta.image;delete message.meta.modelImage;message.meta.expired={kind:'image',at};
  }
  delete voice.meta.audio;voice.meta.expired={kind:'voice',at};
  const quote=reply.meta.quote;quote.content='';delete quote.image;delete quote.modelImage;quote.expired={kind:'image',at};
  return {state,role,target,image,text,voice,reply};
}
function restore(state){return S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(state)},S.initial());}
function rejected(state,change){
  const backup={format:'pipi-phone',version:1,state:S.backupState(state)};change(backup.state);
  assert.throws(()=>S.validateBackup(backup,S.initial()),error=>error.code==='VALIDATION'&&error.status===400);
}

test('expired image, text/image and voice backups restore without original files while retaining thumbnails, text and timing',()=>{
  const f=fixture(),restored=restore(f.state),byId=id=>restored.messages.find(m=>m.id===id);
  assert.equal(byId(f.image.id).content,'');assert.deepEqual(byId(f.image.id).meta,{expired:{kind:'image',at},thumb,caption:'旧图片的文字描述'});
  assert.equal(byId(f.text.id).content,'图文消息的正文');assert.equal(byId(f.text.id).meta.thumb,thumb);assert.equal(byId(f.text.id).meta.image,undefined);
  assert.equal(byId(f.voice.id).content,'原语音正文');assert.equal(byId(f.voice.id).meta.audio,undefined);assert.equal(byId(f.voice.id).meta.transcript,'原语音的转写');assert.equal(byId(f.voice.id).meta.durationMs,2500);
  assert.deepEqual(byId(f.reply.id).meta.quote.expired,{kind:'image',at});assert.equal(byId(f.reply.id).meta.quote.image,undefined);assert.equal(byId(f.reply.id).meta.quote.thumb,thumb);
});

test('expired markers reject malformed fields, incompatible message kinds and retained originals or model copies',()=>{
  const {state,image,text,voice}=fixture();
  for(const marker of [null,[],{}, {kind:'audio',at},{kind:'image',at:-1},{kind:'image',at:'1'},{kind:'image',at:1.5},{kind:'image',at:8640000000000001}])rejected(state,s=>{s.messages.find(m=>m.id===image.id).meta.expired=marker;});
  for(const change of [
    s=>{s.messages.find(m=>m.id===image.id).meta.expired.kind='voice';},
    s=>{s.messages.find(m=>m.id===image.id).content=original;},
    s=>{s.messages.find(m=>m.id===text.id).meta.modelImage=modelImage;},
    s=>{s.messages.find(m=>m.id===voice.id).meta.expired.kind='image';},
    s=>{s.messages.find(m=>m.id===voice.id).meta.audio=audio;},
    s=>{s.messages.find(m=>m.id===voice.id).meta.thumb=thumb;},
    s=>{delete s.messages.find(m=>m.id===voice.id).meta.durationMs;}
  ])rejected(state,change);
});

test('quote expiration validates the same marker and preserves new expired-voice transcripts and durations',()=>{
  const f=fixture(),quote=S.quote(f.state,f.role.id,f.voice.id);
  assert.deepEqual(quote.expired,{kind:'voice',at});assert.equal(quote.transcript,'原语音的转写');assert.equal(quote.durationMs,2500);
  f.reply.meta.quote=quote;
  const restored=restore(f.state).messages.find(m=>m.id===f.reply.id).meta.quote;
  assert.equal(restored.transcript,'原语音的转写');assert.equal(restored.durationMs,2500);assert.deepEqual(restored.expired,{kind:'voice',at});
  for(const change of [
    q=>{q.expired.at='bad';},q=>{q.expired.kind='image';},q=>{q.audio=audio;},q=>{q.modelImage=modelImage;},q=>{q.durationMs=600001;}
  ])rejected(f.state,s=>{change(s.messages.find(m=>m.id===f.reply.id).meta.quote);});
  const imageQuote=S.quote(f.state,f.role.id,f.image.id);assert.equal(imageQuote.thumb,thumb);assert.equal(imageQuote.image,undefined);assert.deepEqual(imageQuote.expired,{kind:'image',at});
});

test('new favorites and individual or merged forwards reject expired own media without changing existing favorite snapshots',()=>{
  const f=fixture(),favorites=structuredClone(f.state.favorites),ids=f.state.messages.map(m=>m.id);
  for(const message of [f.image,f.text,f.voice]){
    assert.throws(()=>S.apply(f.state,'message.favorite',{id:message.id}),/已过期.*不能收藏/);
    for(const mode of ['individual','separate','merged'])assert.throws(()=>S.apply(f.state,'message.forward',{targetRoleId:f.target.id,ids:[message.id],mode}),/已过期.*不能转发/);
  }
  assert.deepEqual(f.state.favorites,favorites);assert.deepEqual(f.state.messages.map(m=>m.id),ids);
  const restored=restore(f.state);
  assert.equal(restored.favorites[0].content,original);assert.equal(restored.favorites[0].meta.modelImage,modelImage);assert.equal(restored.favorites[0].meta.expired,undefined);
  assert.equal(restored.favorites[1].meta.audio,audio);assert.equal(restored.favorites[1].meta.expired,undefined);
});

test('text with an expired quote can still be forwarded or favorited, preserving only the expired snapshot',()=>{
  const f=fixture();
  S.apply(f.state,'message.favorite',{id:f.reply.id});
  for(const mode of ['individual','merged'])S.apply(f.state,'message.forward',{targetRoleId:f.target.id,ids:[f.reply.id],mode});
  const restored=restore(f.state),favorite=restored.favorites.find(row=>row.messageId===f.reply.id);
  assert.equal(favorite.content,'回复引用');assert.deepEqual(favorite.meta.quote.expired,{kind:'image',at});assert.equal(favorite.meta.quote.thumb,thumb);
  const forwarded=restored.messages.filter(row=>row.roleId===f.target.id);
  assert.deepEqual(forwarded.find(row=>row.type==='text').meta.quote.expired,{kind:'image',at});assert.equal(forwarded.find(row=>row.type==='forward').meta.entries[0].meta.quote.thumb,thumb);
});

test('existing merged snapshots containing expired media restore but cannot be forwarded or favorited again',()=>{
  const f=fixture(),entries=[
    {senderName:'甲',type:'image',content:'',meta:{expired:{kind:'image',at},thumb,caption:'旧图描述'}},
    {senderName:'甲',type:'voice',content:'语音正文',meta:{expired:{kind:'voice',at},transcript:'保留的转写',durationMs:1200}}
  ];
  const merged=S.message(f.state,f.role,'user','旧合并转发','forward',{meta:{entries}}),restored=restore(f.state),saved=restored.messages.find(row=>row.id===merged.id);
  assert.equal(saved.meta.entries[0].meta.thumb,thumb);assert.equal(saved.meta.entries[1].meta.transcript,'保留的转写');
  assert.throws(()=>S.apply(restored,'message.favorite',{id:saved.id}),/已过期.*不能收藏/);
  assert.throws(()=>S.apply(restored,'message.forward',{targetRoleId:f.target.id,ids:[saved.id],mode:'merged'}),/已过期.*不能转发/);
});

test('retention defaults to seven days, preserves supported backup values and rejects unsupported choices',()=>{
  assert.equal(S.initial().settings.mediaRetentionDays,7);
  const {state}=fixture();
  for(const days of [7,30,90,'forever']){state.settings.mediaRetentionDays=days;assert.equal(restore(state).settings.mediaRetentionDays,days);}
  const old=S.backupState(state);delete old.settings.mediaRetentionDays;const current=S.initial();current.settings.mediaRetentionDays=90;
  assert.equal(S.validateBackup({format:'pipi-phone',version:1,state:old},current).settings.mediaRetentionDays,7);
  for(const days of [0,1,365,'7',null,true,{}])rejected(state,s=>{s.settings.mediaRetentionDays=days;});
});

test('expired speech attached to an existing text message restores with its original text unchanged',()=>{
  const f=fixture(),spoken=S.message(f.state,f.role,'assistant','已朗读的原文字','text',{meta:{expired:{kind:'voice',at},transcript:'已朗读的原文字'}});
  const restored=restore(f.state).messages.find(row=>row.id===spoken.id);
  assert.equal(restored.type,'text');assert.equal(restored.content,'已朗读的原文字');assert.equal(restored.meta.transcript,'已朗读的原文字');assert.deepEqual(restored.meta.expired,{kind:'voice',at});assert.equal(restored.meta.audio,undefined);
});
