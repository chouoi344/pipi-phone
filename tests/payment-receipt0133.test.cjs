// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const S=require('../lib/state.cjs'),A=require('../lib/engine/actions.cjs'),R=require('../lib/engine/registry.cjs');
const {createDemo}=require('../scripts/demo.cjs');
const wrap=s=>({format:'pipi-phone',version:1,state:S.backupState(s)});
function fixture(){const s=S.initial();S.apply(s,'role.save',{name:'回执好友',momentsAutoEnabled:false});S.apply(s,'role.save',{name:'其他好友',momentsAutoEnabled:false});return s;}
test('user payment receipts settle once, preserve snapshots and never backfill old settlements',()=>{
 const s=fixture(),r=s.roles[0],other=s.roles[1];
 for(const type of ['redpacket','transfer']){
  const before=s.wallet.balanceCents,t=A.transfer(s,r.id,{amountCents:123,type},'assistant',R.values(s,'actions'));
  assert.throws(()=>A.settle(s,t.id,'receive','user',other.id),/只能处理/);
  assert.throws(()=>S.apply(s,'wallet.handle',{id:t.id,action:'receive',roleId:other.id}),/不属于当前会话/);
  S.apply(s,'wallet.handle',{id:t.id,action:'receive',roleId:r.id});
  for(let i=0;i<3;i++)S.apply(s,'wallet.handle',{id:t.id,action:'receive',roleId:r.id});
  assert.equal(s.wallet.balanceCents,before+123);const receipts=s.messages.filter(m=>m.meta?.kind==='payment-receipt'&&m.meta.transactionId===t.id);assert.equal(receipts.length,1);assert.equal(receipts[0].id,t.receiptMessageId);assert.deepEqual(receipts[0].meta,{kind:'payment-receipt',transactionId:t.id,paymentType:type,amountCents:123,actor:'user',action:'receive'});assert.equal(receipts[0].sender,'system');
  const restored=S.validateBackup(wrap(s),s);assert.deepEqual(restored.messages.find(m=>m.id===t.receiptMessageId),receipts[0]);assert.equal(restored.wallet.transactions.find(x=>x.id===t.id).receiptMessageId,t.receiptMessageId);
  s.messages=s.messages.filter(m=>m.id!==t.receiptMessageId);S.apply(s,'wallet.handle',{id:t.id,action:'receive'});assert.equal(s.messages.filter(m=>m.meta?.kind==='payment-receipt'&&m.meta.transactionId===t.id).length,0);
 }
 const old=A.transfer(s,r.id,{amountCents:99,type:'redpacket'},'assistant',R.values(s,'actions'));old.status='received';const count=s.messages.length;assert.throws(()=>S.apply(s,'wallet.handle',{id:old.id,action:'receive'}),/已处理/);assert.equal(s.messages.length,count);
 const t=A.transfer(s,r.id,{amountCents:50,type:'redpacket'},'assistant',R.values(s,'actions'));S.apply(s,'wallet.handle',{id:t.id,action:'receive'});s.messages=s.messages.filter(m=>m.meta?.transactionId!==t.id||m.meta.kind==='payment-receipt');s.wallet.transactions=s.wallet.transactions.filter(x=>x.id!==t.id);assert.ok(S.validateBackup(wrap(s),s).messages.some(m=>m.id===t.receiptMessageId));
});
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
async function until(get,accept){for(let i=0;i<300;i++){const value=await get();if(accept(value))return value;await new Promise(r=>setTimeout(r,20));}assert.fail('isolated payment condition timed out');}
test('real HTTP duplicate receipt commits once, persists on restart and next local model request receives same-role facts',async()=>{
 let demo=await createDemo({host:'127.0.0.1',appPort:0,providerPort:0});
 try{
  ok(await demo.request('/api/engine/modules',{id:'waiting',values:{idleSeconds:0}}));ok(await demo.request('/api/engine/modules',{id:'segments',values:{enabled:false}}));
  const backup=ok(await demo.request('/api/backup')),state=backup.state,r=state.roles[0],other=state.roles[1];
  const transfers=['redpacket','transfer'].map((type,i)=>A.transfer(state,r.id,{amountCents:123+i,type},'assistant',R.values(state,'actions')));
  const otherTx=A.transfer(state,other.id,{amountCents:789,type:'redpacket'},'assistant',R.values(state,'actions'));
  ok(await demo.request('/api/restore',{backup,confirm:true}));
  const requestCount=demo.provider.requests.length,baseBalance=state.wallet.balanceCents;
  for(const t of [...transfers,otherTx]){
   const wrong=await demo.request('/api/action',{type:'wallet.handle',payload:{id:t.id,roleId:t.roleId===r.id?other.id:r.id,action:'receive'}});assert.equal(wrong.status,400);
   const attempts=await Promise.all(Array.from({length:3},()=>demo.request('/api/action',{type:'wallet.handle',payload:{id:t.id,roleId:t.roleId,action:'receive'}})));for(const a of attempts)ok(a);
  }
  let current=ok(await demo.request('/api/state'));assert.equal(current.wallet.balanceCents,baseBalance+123+124+789);for(const t of [...transfers,otherTx])assert.equal(current.messages.filter(m=>m.meta?.kind==='payment-receipt'&&m.meta.transactionId===t.id).length,1);assert.equal(demo.provider.requests.length,requestCount,'receiving must not enqueue a model');
  // Remove the original cards through the normal message-delete operation. Receipt facts remain.
  for(const t of [...transfers,otherTx]){const card=current.messages.find(m=>m.type===t.type&&m.meta?.transactionId===t.id);ok(await demo.request('/api/action',{type:'message.delete',payload:{id:card.id}}));}
  const appPort=new URL(demo.appUrl).port,providerPort=new URL(demo.controlUrl).port,dataDir=demo.dataDir;await demo.close();demo=await createDemo({host:'127.0.0.1',appPort:Number(appPort),providerPort:Number(providerPort),resumeDir:dataDir});
  current=ok(await demo.request('/api/state'));for(const t of transfers){assert.equal(current.wallet.transactions.find(x=>x.id===t.id).status,'received');assert.equal(current.messages.filter(m=>m.meta?.transactionId===t.id).length,1);ok(await demo.request('/api/action',{type:'wallet.handle',payload:{id:t.id,action:'receive'}}));}
  const accepted=ok(await demo.request('/api/chat/send',{roleId:r.id,text:'继续聊',requestId:randomUUID()}));await until(()=>demo.request('/api/state').then(ok),s=>s.messages.find(m=>m.id===accepted.messageId)?.status==='sent');
  const request=demo.provider.requests.filter(req=>req.path==='/v1/chat/completions').at(-1),body=JSON.stringify(request.body.messages);assert.match(body,/用户已领取你发出的红包：1.23元/);assert.match(body,/用户已收款你发出的转账：1.24元/);assert.ok(body.includes(transfers[0].id));assert.ok(body.includes(transfers[1].id));assert.ok(!body.includes(otherTx.id));assert.ok(!body.includes('7.89元'));assert.equal((ok(await demo.request('/api/state'))).messages.filter(m=>m.meta?.kind==='payment-receipt').length,3);
 }finally{await demo.close();}
});
