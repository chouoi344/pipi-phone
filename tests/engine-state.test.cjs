// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs'),M=require('../lib/engine/models.cjs'),R=require('../lib/engine/registry.cjs'),A=require('../lib/engine/actions.cjs'),J=require('../lib/engine/scheduler.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZkAAAAASUVORK5CYII=';
const wrap=s=>({format:'pipi-phone',version:1,state:S.backupState(s)});
function configured(){
  const s=sampleState();M.save(s,{sources:[...M.sanitize(s.settings.ai).sources,{id:'custom',name:'隔离模型',baseUrl:'https://isolated.example/v1',key:'LOCAL_KEY',builtin:false}],models:[{id:'chat-model',sourceId:'custom',model:'fake-isolated-model',kind:'chat',capabilities:['text','image','tool_use'],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:45,extraBody:{},voice:''}],assign:{chat:'chat-model',chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''}});return s;
}
test('old state migrates model assignments and grants every existing friend initial money once',()=>{
  const s=sampleState(),roleId=s.roles[0].id;s.wallet.roleBalances[roleId]=500;delete s.wallet.initializedRoles;delete s.wallet.credits;delete s.settings.ai;delete s.engine;delete s.settings.modules;delete s.settings.timezone;
  s.settings.providers.chat={mode:'custom',baseUrl:'https://old.example/v1',key:'OLD_KEY',model:'old-model'};
  S.defaults(s);assert.equal(s.settings.ai.assign.chat,'legacy-chat');assert.equal(s.wallet.roleBalances[roleId],100500);assert.equal(s.wallet.initializedRoles[roleId],true);assert.equal(s.settings.timezone,'');
  const before=JSON.stringify(s.wallet);S.defaults(s);assert.equal(JSON.stringify(s.wallet),before);assert.ok(s.engine.data.compression);
});
test('friend model and private sticker library validate and survive partial saves',()=>{
  const s=configured(),role=s.roles[0];S.apply(s,'role.save',{id:role.id,modelId:'chat-model',stickers:[{id:'wave',name:'挥手',image:PNG}]});S.apply(s,'role.save',{id:role.id,bio:'更新简介'});
  assert.equal(role.modelId,'chat-model');assert.equal(role.stickers[0].name,'挥手');assert.equal(s.roles[1].stickers.length,0);
  const legacy=structuredClone(s);S.apply(legacy,'role.save',{id:role.id,modelId:'retired-model'});assert.equal(legacy.roles.find(r=>r.id===role.id).modelId,'retired-model');
  assert.throws(()=>S.apply(structuredClone(s),'role.save',{id:role.id,stickers:[{id:'a',name:'',image:PNG}]}));
  assert.throws(()=>S.apply(structuredClone(s),'role.save',{id:role.id,stickers:[{id:'a',name:'a',image:PNG},{id:'a',name:'b',image:PNG}]}));
  const result=S.validateBackup(wrap(s),s);assert.equal(result.roles[0].modelId,'chat-model');assert.deepEqual(result.roles[0].stickers,role.stickers);
});
test('new friend receives configured initial balance at creation without regranting others',()=>{
  const s=sampleState();R.apply(s,'actions',{initialBalanceCents:23456});const before=s.wallet.roleBalances[s.roles[0].id];S.apply(s,'role.save',{name:'新好友'});const role=s.roles.at(-1);
  assert.equal(s.wallet.roleBalances[role.id],23456);assert.equal(s.wallet.roleBalances[s.roles[0].id],before);assert.equal(s.wallet.credits.filter(x=>x.roleId===role.id).length,1);
});
test('public state hides summaries and both credential formats; backup keeps summaries and module data',()=>{
  const s=configured(),role=s.roles[0];s.settings.providers.chat.key='LEGACY_SECRET';s.engine.summaries[role.id]={text:'HIDDEN_SUMMARY_SENTINEL',coveredUntil:1,updatedAt:2};s.engine.data.caption={marker:'MODULE_DATA'};
  const pub=S.publicState(s),backup=S.backupState(s);assert.equal('summaries'in pub.engine,false);assert.equal(JSON.stringify(pub).includes('HIDDEN_SUMMARY_SENTINEL'),false);assert.equal(backup.engine.summaries[role.id].text,'HIDDEN_SUMMARY_SENTINEL');assert.equal(backup.engine.data.caption.marker,'MODULE_DATA');
  for(const output of [pub,backup]){assert.equal(JSON.stringify(output).includes('LOCAL_KEY'),false);assert.equal(JSON.stringify(output).includes('LEGACY_SECRET'),false);assert.equal(output.settings.ai.sources[1].keySet,true);assert.equal('key'in output.settings.providers.chat,false);}
});
test('new backup restores summary, usage, jobs, timezone and module parameters without duplicating money',()=>{
  const s=configured(),role=s.roles[0],now=Date.now(),m=S.message(s,role,'user','旧对话');s.engine.summaries[role.id]={text:'隐蔽记录',coveredUntil:m.createdAt,coveredMessageId:m.id,updatedAt:now};s.settings.timezone='Asia/Shanghai';R.apply(s,'waiting',{idleSeconds:4});s.engine.data.caption={nested:{values:[1,true,null,'测试']}};
  J.add(s,role.id,{note:'喝水',userRequested:true,schedule:{type:'once',at:now+3600000}},now);s.engine.jobs[0].status='running';s.engine.usage.push({at:now,modelId:'chat-model',model:'fake-isolated-model',purpose:'chat',inputTokens:12,outputTokens:4,estimated:false,inputEstimated:false,success:true});
  const restored=S.validateBackup(wrap(s),s);assert.deepEqual(restored.engine.summaries,s.engine.summaries);assert.deepEqual(restored.engine.data.caption,s.engine.data.caption);assert.equal(restored.engine.jobs[0].status,'pending');assert.equal(restored.settings.modules.waiting.idleSeconds,4);assert.equal(restored.settings.timezone,'Asia/Shanghai');assert.equal(restored.engine.usage.length,1);assert.deepEqual(restored.wallet,s.wallet);
});
test('旧主动消息和时间间隔备份参数及数据保持兼容，恢复后功能仍未登记',()=>{
  const s=configured();s.roles[0].proactive=true;s.settings.modules.proactive={enabled:true};s.settings.modules.timeGaps={enabled:true,thresholdHours:4};s.engine.data.proactive={legacy:true};s.engine.data.timeGaps={legacy:'保留'};
  const restored=S.validateBackup(wrap(s),s);assert.equal(restored.roles[0].proactive,true);assert.deepEqual(restored.settings.modules.proactive,{enabled:true});assert.deepEqual(restored.settings.modules.timeGaps,{enabled:true,thresholdHours:4});assert.deepEqual(restored.engine.data.proactive,{legacy:true});assert.deepEqual(restored.engine.data.timeGaps,{legacy:'保留'});
  assert.equal(R.list().some(m=>['proactive','timeGaps'].includes(m.id)),false);assert.equal(R.modules.some(m=>m.jobs.some(job=>job.id==='proactive-chat')),false);
});
test('旧消息防抖超时随备份保留，但当前设置只接受现用参数',()=>{
  const s=configured();s.settings.modules.waiting={decisionTimeoutSeconds:12};
  const restored=S.validateBackup(wrap(s),s);
  assert.equal(restored.settings.modules.waiting.decisionTimeoutSeconds,12);
  assert.equal(R.get('waiting').settings.some(setting=>setting.key==='decisionTimeoutSeconds'),false);
  assert.throws(()=>R.apply(restored,'waiting',{decisionTimeoutSeconds:25}),/未知/);
  assert.equal(R.apply(restored,'waiting',{idleSeconds:3}).decisionTimeoutSeconds,12);
});

test('旧分段备份迁移官方默认，保留自定义阈值和间隔',()=>{
  const s=configured();
  const legacy={intervalMode:'length',logBase:2.6,cleanupPattern:'。$',maxSegments:6,lengthJitterSeconds:0.5,noSplitAbove:180};
  s.settings.modules.segments=legacy;
  const current=R.values(s,'segments');
  assert.equal(current.intervalMode,'random');
  assert.equal(current.cleanupPattern,'');
  assert.equal(current.noSplitAbove,180);
  assert.equal(current.maxSegments,undefined);
  assert.equal(legacy.maxSegments,6);
  const restored=S.validateBackup(wrap(s),s);
  assert.deepEqual(R.values(restored,'segments'),current);
  legacy.logBase=3;
  assert.equal(R.values(S.validateBackup(wrap(s),s),'segments').intervalMode,'length');
});

test('backup restores only local keys for unchanged source IDs and destinations',()=>{
  const s=configured(),backup=wrap(s);backup.state.settings.ai.sources[1].key='ATTACKER_BACKUP_KEY';let restored=S.validateBackup(backup,s);assert.equal(restored.settings.ai.sources[1].key,'LOCAL_KEY');
  backup.state.settings.ai.sources[1].baseUrl='https://different.example/v1';restored=S.validateBackup(backup,s);assert.equal(restored.settings.ai.sources[1].key,'');
  backup.state.settings.ai.sources[1].id='different-id';backup.state.settings.ai.models[0].sourceId='different-id';backup.state.settings.ai.sources[1].baseUrl='https://isolated.example/v1';restored=S.validateBackup(backup,s);assert.equal(restored.settings.ai.sources[1].key,'');
});
test('opted-in model keys migrate only to their original service and address',t=>{
  const env='PIPI_SOURCE_URL',before=process.env[env];
  t.after(()=>{if(before===undefined)delete process.env[env];else process.env[env]=before;});
  const source=configured(),station=source.settings.ai.sources.find(item=>item.id==='pipi');
  station.key='ISOLATED_BASE_KEY';
  process.env[env]='https://original-override.example/v1/';
  function saveRuntimeKey(state,value){
    const ai=M.sanitize(state.settings.ai);
    M.save(state,{...ai,sources:ai.sources.map(item=>item.id==='pipi'?{...item,key:value}:item)});
  }
  saveRuntimeKey(source,'ISOLATED_OVERRIDE_KEY');
  const backup=wrap(source),keys=M.backupKeys(source.settings.ai);
  assert.deepEqual(keys.filter(item=>item.sourceId==='pipi'),[
    {sourceId:'pipi',baseUrl:station.baseUrl,key:'ISOLATED_BASE_KEY'},
    {sourceId:'pipi',baseUrl:'https://original-override.example/v1',key:'ISOLATED_OVERRIDE_KEY'}
  ]);
  assert.deepEqual(keys.find(item=>item.sourceId==='custom'),{sourceId:'custom',baseUrl:'https://isolated.example/v1',key:'LOCAL_KEY'});
  const restored=S.validateBackup(backup,S.initial());
  const matched=M.restoreBackupKeys(restored.settings.ai,keys.map(item=>({...item,baseUrl:item.baseUrl+'/'})));
  assert.deepEqual(matched,{restoredModelKeys:3,skippedModelKeys:0});
  assert.equal(M.effectiveSources(restored.settings.ai).find(item=>item.id==='pipi').key,'ISOLATED_OVERRIDE_KEY');
  assert.doesNotMatch(JSON.stringify(S.publicState(restored)),/ISOLATED_BASE_KEY|ISOLATED_OVERRIDE_KEY|LOCAL_KEY/);
  process.env[env]='https://other-override.example/v1';
  const target=S.initial();saveRuntimeKey(target,'ISOLATED_TARGET_KEY');
  const changed=S.validateBackup(backup,target);
  assert.deepEqual(M.restoreBackupKeys(changed.settings.ai,keys),{restoredModelKeys:2,skippedModelKeys:1});
  assert.equal(M.effectiveSources(changed.settings.ai).find(item=>item.id==='pipi').key,'ISOLATED_TARGET_KEY');
  delete process.env[env];
  assert.equal(M.effectiveSources(changed.settings.ai).find(item=>item.id==='pipi').key,'ISOLATED_BASE_KEY');
});
test('older backups with blank station URLs use this installation’s built-in URLs and keys',()=>{
  const s=configured(),voice=s.settings.ai.sources.find(item=>item.id==='pipi-voice');
  Object.assign(voice,{baseUrl:'https://saved-voice.example/v1',key:'ISOLATED_VOICE_KEY'});
  const backup=wrap(s);
  for(const source of backup.state.settings.ai.sources.filter(item=>item.builtin)){
    source.baseUrl='';
    source.key='IGNORED_BACKUP_KEY';
  }
  const restored=S.validateBackup(backup,s);
  assert.equal(restored.settings.ai.sources.find(item=>item.id==='pipi').baseUrl,'https://choupi.tech/v1');
  const restoredVoice=restored.settings.ai.sources.find(item=>item.id===voice.id);
  assert.equal(restoredVoice.baseUrl,voice.baseUrl);
  assert.equal(restoredVoice.key,voice.key);
});
test('malformed engine, model, reminder and money backups reject without mutating current state',()=>{
  const s=configured(),before=JSON.stringify(s),roleId=s.roles[0].id;
  const corruptions=[b=>b.engine.summaries={missing:{text:'x',coveredUntil:1,updatedAt:2}},b=>b.engine.summaries={[roleId]:{text:'x',coveredUntil:-1,updatedAt:2}},b=>b.settings.modules.waiting={idleSeconds:999999},b=>b.settings.timezone='Invalid/Zone',b=>b.settings.ai.assign.chat='missing',b=>b.engine.data.unknown={},b=>b.engine.usage=[{at:1,model:'x',modelId:'x',purpose:'chat',inputTokens:-1,outputTokens:1}],b=>b.engine.jobs=[{id:'job',roleId,note:'bad',userRequested:true,schedule:{type:'interval',intervalMs:1000},nextAt:1,status:'pending',createdAt:0}],b=>b.wallet.initializedRoles[roleId]=false,b=>b.wallet.credits[0].amountCents=-1];
  for(const corrupt of corruptions){const input=wrap(s);corrupt(input.state);assert.throws(()=>S.validateBackup(input,s));assert.equal(JSON.stringify(s),before);}
});
test('old backup without model/engine markers migrates once and ignores backup keys',()=>{
  const s=sampleState(),input=wrap(s),roleId=s.roles[0].id;delete input.state.settings.ai;delete input.state.settings.modules;delete input.state.engine;delete input.state.wallet.initializedRoles;delete input.state.wallet.credits;
  input.state.wallet.roleBalances[roleId]=100;input.state.settings.providers.chat={mode:'custom',baseUrl:'https://legacy.example/v1',model:'old-model',key:'NEVER_IMPORT'};
  const restored=S.validateBackup(input,s);assert.equal(restored.wallet.roleBalances[roleId],100100);assert.equal(restored.settings.ai.models[0].model,'old-model');assert.equal(restored.settings.ai.sources[1].key,'');const money=restored.wallet.roleBalances[roleId];S.defaults(restored);assert.equal(restored.wallet.roleBalances[roleId],money);
});
test('outgoing money waits for friend acceptance and user can settle only incoming payments',()=>{
  const s=sampleState(),role=s.roles[0],roleBalance=s.wallet.roleBalances[role.id],balance=s.wallet.balanceCents;
  S.apply(s,'wallet.transfer',{roleId:role.id,amountCents:1000,type:'transfer',note:'测试',requestId:'isolated-pay-1'});assert.equal(s.wallet.balanceCents,balance-1000);assert.equal(s.wallet.roleBalances[role.id],roleBalance);const outgoing=s.wallet.transactions[0];assert.equal(outgoing.status,'pending');assert.throws(()=>S.apply(s,'wallet.handle',{id:outgoing.id,action:'receive'}));
  A.settle(s,outgoing.id,'receive','assistant',role.id);assert.equal(s.wallet.roleBalances[role.id],roleBalance+1000);assert.throws(()=>A.settle(s,outgoing.id,'receive','assistant',role.id));
  const incoming=A.transfer(s,role.id,{amountCents:500,type:'redpacket'},'assistant',R.values(s,'actions'));assert.equal(s.wallet.balanceCents,balance-1000);S.apply(s,'wallet.handle',{id:incoming.id,action:'receive'});assert.equal(s.wallet.balanceCents,balance-500);
  assert.deepEqual(S.validateBackup(wrap(s),s).wallet,s.wallet);
});
test('restoring historical transactions without status does not credit them again',()=>{
  const s=sampleState(),role=s.roles[0];S.apply(s,'wallet.transfer',{roleId:role.id,amountCents:1234,type:'transfer',requestId:'legacy-pay'});A.settle(s,s.wallet.transactions[0].id,'receive','assistant',role.id);const before=s.wallet.roleBalances[role.id],input=wrap(s);delete input.state.wallet.transactions[0].status;
  const restored=S.validateBackup(input,s);assert.equal(restored.wallet.transactions[0].status,'received');assert.equal(restored.wallet.roleBalances[role.id],before);
});
test('friend-generated pat, recall, caption and sticker metadata survive backup validation',()=>{
  const s=sampleState(),role=s.roles[0];S.message(s,role,'system','好友拍了拍我','text',{meta:{kind:'pat',author:role.id,target:'self'}});S.message(s,role,'system','好友撤回了一条消息','text',{meta:{kind:'recalled',author:role.id,recalledType:'text',recalledAt:Date.now()}});S.message(s,role,'assistant',PNG,'image',{meta:{stickerId:'old-removed-sticker',caption:'图片的文字转述'}});
  const restored=S.validateBackup(wrap(s),s);assert.equal(restored.messages.at(-3).meta.author,role.id);assert.equal(restored.messages.at(-2).meta.author,role.id);assert.equal(restored.messages.at(-1).meta.caption,'图片的文字转述');assert.equal(restored.messages.at(-1).meta.stickerId,'old-removed-sticker');
});
test('clearing conversations removes summaries and deleting friend removes all owned engine records',()=>{
  const s=sampleState(),role=s.roles[0];s.engine.summaries[role.id]={text:'旧记录',coveredUntil:1,updatedAt:2};S.apply(s,'conversation.clear',{roleId:role.id});assert.equal(s.engine.summaries[role.id],undefined);
  s.engine.summaries[role.id]={text:'新记录',coveredUntil:1,updatedAt:2};J.add(s,role.id,{note:'提醒',userRequested:true,schedule:{type:'once',at:Date.now()+100000}});s.engine.data.compression.estimates={[role.id]:{ratio:1}};S.apply(s,'role.delete',{id:role.id});
  assert.equal(s.engine.summaries[role.id],undefined);assert.equal(s.engine.jobs.some(x=>x.roleId===role.id),false);assert.equal(s.wallet.credits.some(x=>x.roleId===role.id),false);assert.equal(s.wallet.initializedRoles[role.id],undefined);assert.equal(s.engine.data.compression.estimates[role.id],undefined);
});
test('summary coverage rejects another friend and tolerates deleted covered messages',()=>{
  const s=sampleState(),role=s.roles[0],other=s.messages[0];s.engine.summaries[role.id]={text:'记录',coveredUntil:1,coveredMessageId:other.id,updatedAt:2};let input=wrap(s);input.state.engine.summaries[role.id].coveredMessageId='already-deleted';let restored=S.validateBackup(input,s);assert.equal(restored.engine.summaries[role.id].coveredMessageId,undefined);
  input=wrap(s);input.state.engine.summaries[s.roles[1].id]={text:'跨角色',coveredUntil:1,coveredMessageId:other.id,updatedAt:2};assert.throws(()=>S.validateBackup(input,s),/其他会话/);
});
test('deleting a friend refunds only their pending user payments and restored backup cannot refund them twice',()=>{
  const s=sampleState(),[role,other]=s.roles,p=R.values(s,'actions');
  const outgoing=(amount,type='transfer')=>A.transfer(s,role.id,{amountCents:amount,type},'user',p);
  outgoing(1000);outgoing(2000,'redpacket');
  A.settle(s,outgoing(3000).id,'receive','assistant',role.id);
  A.settle(s,outgoing(4000).id,'return','assistant',role.id);
  A.transfer(s,role.id,{amountCents:500,type:'transfer'},'assistant',p);
  A.settle(s,A.transfer(s,role.id,{amountCents:600,type:'transfer'},'assistant',p).id,'receive','user',role.id);
  A.settle(s,A.transfer(s,role.id,{amountCents:700,type:'redpacket'},'assistant',p).id,'return','user',role.id);
  const otherPending=A.transfer(s,other.id,{amountCents:800,type:'transfer'},'user',p),before=s.wallet.balanceCents;
  assert.equal(before,93800);S.apply(s,'role.delete',{id:role.id});assert.equal(s.wallet.balanceCents,96800);assert.equal(s.wallet.balanceCents,before+3000);assert.equal(s.wallet.transactions.some(t=>t.roleId===role.id),false);assert.equal(s.wallet.transactions[0].id,otherPending.id);
  const restored=S.validateBackup(wrap(s),s);assert.deepEqual(restored.wallet,s.wallet);S.defaults(restored);assert.equal(restored.wallet.balanceCents,96800);
  A.expirePayments(restored,Date.now()+25*3600000);assert.equal(restored.wallet.balanceCents,97600);A.expirePayments(restored,Date.now()+26*3600000);assert.equal(restored.wallet.balanceCents,97600);
});
test('clearing or deleting payment messages preserves pending transactions and balances',()=>{
  const s=sampleState(),role=s.roles[0],p=R.values(s,'actions');
  const outgoing=A.transfer(s,role.id,{amountCents:1000,type:'transfer'},'user',p),incoming=A.transfer(s,role.id,{amountCents:500,type:'redpacket'},'assistant',p),before=structuredClone(s.wallet);
  S.apply(s,'message.delete',{id:s.messages.at(-1).id});assert.deepEqual(s.wallet,before);
  S.apply(s,'conversation.clear',{roleId:role.id});assert.deepEqual(s.wallet,before);assert.equal(s.messages.some(m=>m.roleId===role.id),false);
  const restored=S.validateBackup(wrap(s),s);assert.deepEqual(restored.wallet,before);
  A.settle(restored,outgoing.id,'receive','assistant',role.id);A.settle(restored,incoming.id,'receive','user',role.id);assert.equal(restored.wallet.balanceCents,99500);assert.equal(restored.wallet.roleBalances[role.id],100500);
});
test('friend deletion rejects an unsafe refund total before removing any records',()=>{
  const s=sampleState(),role=s.roles[0];A.transfer(s,role.id,{amountCents:1,type:'transfer'},'user',R.values(s,'actions'));s.wallet.balanceCents=Number.MAX_SAFE_INTEGER;const before=JSON.stringify(s);
  assert.throws(()=>S.apply(s,'role.delete',{id:role.id}),/数值超出允许范围/);assert.equal(JSON.stringify(s),before);
});

test('retired friend model IDs survive profile save and backup with global chat active',()=>{
  const s=configured(),role=s.roles[0];role.modelId='retired-model';
  S.apply(s,'role.save',{id:role.id,bio:'资料更新'});
  const restored=S.validateBackup(wrap(s),s);
  assert.equal(role.modelId,'retired-model');assert.equal(restored.roles[0].modelId,'retired-model');assert.equal(restored.roles[0].bio,'资料更新');
  assert.equal(M.resolve(restored,'chat',{role:restored.roles[0]}).id,'chat-model');
});
