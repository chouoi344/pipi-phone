// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/history-search.js'),'utf8');
function setup(){
  let debounce,requests=[];
  const scope={window:{addEventListener(){}},navigator:{onLine:true},setTimeout:f=>{debounce=f;},clearTimeout:()=>{debounce=null;},URLSearchParams,AbortController,
    document:{createElement:()=>({})}};
  vm.runInNewContext(source,scope);
  const search=scope.window.PipiHistorySearch,area={isConnected:true,querySelector:()=>null,insertBefore(){},contains:()=>true};
  search.configure({clientProtocol:{features:['messages-v1','messages-global-search-v1']}});
  const options={area,type:'all',date:'',roleId:'',term:'a',local:()=>[{id:'loaded'}],
    render:rows=>rows.map(row=>row.id).join(','),request:(url,signal)=>new Promise((resolve,reject)=>requests.push({url,signal,resolve,reject}))};
  return {search,scope,area,options,requests,launch:()=>{if(debounce){const f=debounce;debounce=null;f();}},
    click:name=>area.onclick({target:{closest:()=>({hasAttribute:key=>key===name})}})};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('new query, leaving the page and account changes discard old responses',async()=>{
  const t=setup();
  t.search.bind(t.options);t.launch();t.search.bind({...t.options,term:'b'});t.launch();
  assert.equal(t.requests[0].signal.aborted,true);
  t.requests[1].resolve({messages:[{id:'current'}]});await flush();
  t.requests[0].resolve({messages:[{id:'stale'}]});await flush();assert.equal(t.area.innerHTML,'current');
  t.search.bind({...t.options,term:'c'});t.launch();t.search.reset();
  t.requests[2].resolve({messages:[{id:'signed-out'}]});await flush();assert.ok(!t.area.innerHTML.includes('signed-out'));
});
test('global results load more by cursor; offline, old servers and failed requests still find loaded items',async()=>{
  const t=setup();t.search.bind(t.options);t.launch();t.requests[0].resolve({messages:[{id:'recent'}],hasMore:true,nextBeforeId:'id/+1'});await flush();
  t.click('data-history-more');assert.equal(new URL(t.requests[1].url,'http://localhost').searchParams.get('beforeId'),'id/+1');
  t.requests[1].resolve({messages:[{id:'older'}]});await flush();assert.equal(t.area.innerHTML,'recent,older');
  t.search.bind({...t.options,term:'new'});t.launch();t.requests[2].reject(new Error('断网'));await flush();
  assert.match(t.area.innerHTML,/仅搜索已加载/);assert.match(t.area.innerHTML,/loaded/);t.click('data-history-retry');assert.equal(t.requests.length,4);
  t.search.configure({clientProtocol:{features:['messages-v1']}});t.search.bind(t.options);t.launch();assert.equal(t.requests.length,4);
  t.scope.navigator.onLine=false;t.search.bind({...t.options,roleId:'bob'});t.launch();assert.equal(t.requests.length,4);assert.match(t.area.innerHTML,/loaded/);
});
test('single chat filters include local date boundaries, type and the role; older pages precede the newer page',async()=>{
  const t=setup();t.search.bind({...t.options,roleId:'alice',term:'',type:'payment',date:'2026-11-25'});t.launch();
  const url=new URL(t.requests[0].url,'http://localhost');assert.equal(url.pathname,'/api/messages/search');
  assert.equal(url.searchParams.get('roleId'),'alice');assert.equal(url.searchParams.get('type'),'payment');
  assert.equal(Number(url.searchParams.get('from')),new Date(2026,10,25).getTime());assert.equal(Number(url.searchParams.get('to')),new Date(2026,10,26).getTime());
  t.requests[0].resolve({messages:[{id:'new'}],hasMore:true,nextBeforeId:'new'});await flush();t.click('data-history-more');
  t.requests[1].resolve({messages:[{id:'old'}]});await flush();assert.equal(t.area.innerHTML,'old,new');
});
