// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Sync=require('../public/state-sync.js');
const msg=(role,n)=>({id:role+n,roleId:role,createdAt:n,content:'消息 '+n});
function fixture(length=130,options={}){
  let revision=1,epoch='A',changes={upsertMessages:[],deleteMessageIds:[],replace:{}},gate=null;
  const rows={a:Array.from({length},(_,i)=>msg('a',i+1)),b:Array.from({length:100},(_,i)=>msg('b',i+1))},calls=[];
  const cursor=()=>epoch+'-'+revision,meta=()=>({schema:1,epoch,revision,cursor:cursor(),...(options.old?{}:{messageCount:rows.a.length+rows.b.length})});
  function base(){return {revision,roles:Object.keys(rows).map(id=>({id})),messages:Object.values(rows).filter(r=>r.length).map(r=>r.at(-1))};}
  async function request(path,{headers}){
    calls.push(path);assert.equal(headers['X-Pipi-Message-Coverage'],'pages');
    const url=new URL(path,'http://test'),query=url.searchParams,id=query.get('roleId');
    if(path.startsWith('/api/sync')){
      const token=query.get('cursor');
      if(!token||!token.startsWith(epoch+'-'))return {...meta(),mode:'reset',state:base(),messageCoverage:'heads'};
      const fromRevision=Number(token.split('-')[1]);
      return {...meta(),mode:'delta',fromRevision,changes:fromRevision===revision?{upsertMessages:[],deleteMessageIds:[],replace:{}}:changes};
    }
    const r=rows[id];
    if(url.pathname==='/api/messages/by-id'){
      const messages=r.filter(row=>row.id===query.get('ids'));
      return {...meta(),roleId:id,messages,missingIds:messages.length?[]:[query.get('ids')]};
    }
    assert.equal(url.pathname,'/api/messages');
    const limit=Number(query.get('limit')),before=query.get('beforeId'),end=before?r.findIndex(m=>m.id===before):r.length;
    if(end<0)throw Object.assign(Error('Message anchor was deleted'),{code:'MESSAGE_ANCHOR_GONE'});
    const page={...meta(),roleId:id,messages:r.slice(Math.max(0,end-limit),end),hasMore:end>limit};
    if(gate){const hold=gate;gate=null;hold.start();await hold.wait;}
    return page;
  }
  const client=Sync.create({paged:true,request,...options});
  function change(upsertMessages=[],deleteMessageIds=[]){
    for(const [id,r] of Object.entries(rows))rows[id]=r.filter(m=>!deleteMessageIds.includes(m.id)).map(m=>upsertMessages.find(u=>u.id===m.id)||m);
    for(const m of upsertMessages)if(!rows[m.roleId].some(r=>r.id===m.id))rows[m.roleId].push(m);
    changes={upsertMessages,deleteMessageIds,replace:{}};revision++;
  }
  return {client,request,calls,rows,change,reboot(){epoch+='R';revision=0;},hold(){const done=Promise.withResolvers(),started=Promise.withResolvers();gate={wait:done.promise,start:started.resolve};return {release:done.resolve,started:started.promise};}};
}

test('head-only bootstrap negotiates without a cursor, loads just the visited role and paginates v0.13.28 by-id targets',async()=>{
  const {client,rows,calls}=fixture(130,{old:true}),p=client.paging;
  assert.deepEqual(client.headers(),{'X-Pipi-Message-Coverage':'pages','X-Pipi-State-Mode':'delta'});
  const {state}=await client.refresh();assert.deepEqual(state.messages, [rows.a.at(-1),rows.b.at(-1)]);
  assert.deepEqual(calls,['/api/sync']);assert.equal(p.totalCount(),null);assert.equal(p.delta(state).history,true);
  p.setActive('a');const recent=await p.enter('a');assert.equal(recent.messages.length,61);assert.deepEqual(p.rows('a'),rows.a.slice(-60));
  const old=await p.older('a');assert.equal(p.info('a').firstId,'a11');assert.equal(p.delta(old).history,true);
  const jumped=await p.around('a','a3');assert.equal(p.info('a').endId,'a3');assert.deepEqual(p.rows('a'),rows.a.slice(0,3));
  assert.deepEqual(jumped.messages.filter(m=>m.roleId==='a').map(m=>m.id),['a1','a2','a3','a130']);
  await assert.rejects(p.around('a','deleted'),{code:'MESSAGE_NOT_FOUND'});
  await p.latest('a');assert.deepEqual(p.rows('a'),rows.a.slice(-60));
  assert.ok(!calls.includes('/api/state'));
});

test('unopened edits never replace the head or notify; deleting a head restores its actual predecessor',async()=>{
  const {client,change,rows}=fixture(),p=client.paging;
  await client.refresh();assert.equal(p.totalCount(),230);
  change([{...rows.b[5],content:'历史更正'}]);let result=(await client.refresh()).state;
  assert.equal(result.messages.find(m=>m.roleId==='b').id,'b100');assert.deepEqual(p.delta(result).fresh,[]);
  change([msg('b',101),msg('b',102)]);result=(await client.refresh()).state;
  assert.deepEqual(result.messages.filter(m=>m.roleId==='b').map(m=>m.id),['b102']);assert.deepEqual(p.delta(result).fresh.map(m=>m.id),['b102']);
  change([{...rows.b[100],content:'历史更正'}],['b102']);result=(await client.refresh()).state;
  assert.equal(result.messages.find(m=>m.roleId==='b').id,'b101');assert.deepEqual(p.delta(result).fresh,[]);assert.deepEqual(p.delta(result).deletedIds,['b102']);
});

test('loaded delta retains contiguous pages and exact new IDs across a burst; epoch reset discards all pages then reloads only the active chat',async()=>{
  const {client,change,rows,reboot,calls}=fixture(),p=client.paging;
  await client.refresh();await p.enter('b');await p.enter('a');p.setActive('a');await p.older('a');
  const inserted=Array.from({length:130},(_,i)=>msg('a',131+i));
  change([{...rows.a[1],content:'older edit'},...inserted],['a11']);
  let result=(await client.refresh()).state;
  assert.deepEqual(p.delta(result).fresh.map(m=>m.id),inserted.map(m=>m.id));assert.deepEqual(p.rows('a'),rows.a.slice(10));
  reboot();result=(await client.refresh()).state;
  assert.equal(client.replaces(result),true);assert.equal(p.delta(result).reset,true);
  assert.equal(p.info('b').loaded,false);assert.deepEqual(p.rows('a'),rows.a.slice(-60));
  assert.equal(result.messages.length,61);assert.ok(!calls.includes('/api/state'));
});

test('scrolling through 4200 records never drops the preceding viewport or joins separate ranges, while loaded state stays below 3000',async()=>{
  const {client}=fixture(4200),p=client.paging;await client.refresh();await p.enter('b');p.setActive('a');await p.enter('a');
  let first=4201-60;
  while(p.info('a').hasMore){
    const anchor=p.rows('a')[0].id,state=await p.older('a'),window=p.rows('a'),ids=window.map(m=>Number(m.id.slice(1)));
    assert.ok(window.some(m=>m.id===anchor));
    first=Math.max(1,first-60);assert.equal(ids[0],first);
    assert.equal(ids.at(-1)-ids[0]+1,ids.length);assert.ok(state.messages.length<=3000);
  }
  assert.equal(first,1);assert.ok(p.info('a').endId);assert.equal(p.info('b').loaded,false);
  const current=await p.latest('a');assert.equal(p.info('a').endId,'');assert.equal(current.messages.filter(m=>m.roleId==='a').at(-1).id,'a4200');
});

test('old account page result cannot repopulate a reset client; failed reads leave the current window usable',async()=>{
  const f=fixture(),p=f.client.paging;await f.client.refresh();
  const hold=f.hold(),pending=p.enter('a');await hold.started;f.client.reset();hold.release();
  await assert.rejects(pending,{stale:true});assert.equal(p.info('a').loaded,false);assert.equal(p.totalCount(),null);
  await f.client.refresh();await p.enter('a');const old=p.rows('a');await assert.rejects(p.around('a','missing'),{code:'MESSAGE_NOT_FOUND'});assert.deepEqual(p.rows('a'),old);
});

test('paging requires both features, a full reply from an older login becomes heads without a second full read',async()=>{
  const f=fixture(3,{old:true}),configure=features=>Sync.configure({authenticated:true,appSessionScope:'test',clientProtocol:{features}},{request:f.request});
  try{
    configure(['messages-v1']);assert.equal(Sync.client,null);
    configure(['sync-v1']);assert.equal(Sync.client.paging,null);assert.deepEqual(Sync.client.headers(),{});
    configure(['sync-v1','messages-v1']);assert.ok(Sync.client.paging);
    const result=await Sync.client.accept({csrfToken:'session',state:{revision:1,messages:[...f.rows.a,...f.rows.b]}});
    assert.equal(result.csrfToken,'session');assert.equal(result.state.messages.length,2);
    assert.deepEqual(f.calls,['/api/sync']);assert.ok(Sync.isHistory(result.state));assert.deepEqual(Sync.newMessages(result.state),[]);
  }finally{configure([]);}
});

test('update checks keep the new release alongside an older completed job without requesting chat data',async()=>{
  const response={
    currentVersion:'0.14.1',state:'available',release:{version:'0.14.2'},
    job:{phase:'succeeded',message:'已更新到 0.14.1，原资料继续保留'}
  };
  for(const paged of [true,false]){
    const {client,calls}=fixture(3,{paged});
    assert.strictEqual(await client.accept(response),response);
    assert.deepEqual(calls,[]);
  }
});

test('JSON backup remains complete when the browser has loaded only heads; restoring refreshes the paged state separately',async()=>{
  const f=fixture();await f.client.refresh();
  const archive={format:'pipi-phone',version:1,state:{messages:[...f.rows.a,...f.rows.b]}};
  const saved=await f.client.accept(archive);assert.equal(saved,archive);assert.equal(saved.state.messages.length,230);
  assert.deepEqual(f.calls,['/api/sync']);f.reboot();const result=await f.client.accept({state:archive.state,restoredModelKeys:0});
  assert.equal(result.state.messages.length,2);assert.equal(result.restoredModelKeys,0);assert.ok(f.client.replaces(result.state));
});
