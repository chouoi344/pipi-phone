// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(file,name,interactive=false){
 const pending=[],calls=[],toasts=[],tabs=['usage','logs'].map(tab=>({dataset:{usageTab:tab}})),page={scrollTop:0},results={},count={},search={value:'',focus(){},setSelectionRange(){}};
 const view={visible:false,html:'',refreshes:0,actions:[],sheet:null};let ui;
 const P={api:url=>{calls.push(url);return new Promise((resolve,reject)=>pending.push({url,resolve,reject}));},esc:String,icons:{back:'',chevron:''},refresh(){if(!interactive||!view.visible)return;view.refreshes++;view.html=ui.render();view.actions=[...view.html.matchAll(/data-usage-action="([^"]+)"/g)].map(match=>({dataset:{usageAction:match[1]}}));search.value=ui.getView().query;ui.bind();},showView(){view.visible=true;P.refresh();},toast:message=>toasts.push(message),actionSheet:(title,items)=>{view.sheet={title,items};}};
 const scope={window:{Pipi:P},document:{querySelector:s=>s==='#view'?{dataset:{route:'account-security'}}:interactive&&view.visible?({'#usage-page':page,'#usage-log-results':results,'#usage-log-count':count,'#usage-search':view.html.includes('id="usage-search"')?search:null}[s]||null):null,querySelectorAll:s=>interactive&&view.visible?(s==='[data-usage-tab]'?tabs:s==='[data-usage-action]'?view.actions:[]):[]},queueMicrotask,Map,Intl,Date};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/'+file),'utf8'),scope);
 ui=scope.window[name];
 return {ui,pending,calls,toasts,view,results,page,refresh:()=>P.refresh(),leave:()=>{view.visible=false;},tab:value=>tabs.find(button=>button.dataset.usageTab===value).onclick(),action:value=>view.actions.find(button=>button.dataset.usageAction===value).onclick(),choose:label=>view.sheet.items.find(item=>item.label===label).run(),search:value=>{search.value=value;search.oninput();}};
}
const usageData=(totalTokens=123,model='first')=>({timezone:'UTC',summary:{totalTokens,inputTokens:100,outputTokens:23,count:1,failures:0},trend:[],models:[],logs:{items:[{at:0,model,purpose:'chat',success:true,durationMs:10,inputTokens:100,outputTokens:23}]}});
test('account re-entry keeps successful devices and reset rejects old response',async()=>{
 const f=fixture('account-ui.js','PipiAccount');f.ui.enter();f.pending.shift().resolve({sessionCount:2,otherSessionCount:1});await turn();f.ui.enter();assert.match(f.ui.render(),/2 个/);assert.match(f.ui.render(),/data-account-revoke disabled/);f.ui.reset();f.pending.shift().resolve({sessionCount:9,otherSessionCount:8});await turn();assert.doesNotMatch(f.ui.render(),/9 个|2 个/);
});
test('usage opens cached range and reset prevents old result entering next login',async()=>{
 const f=fixture('usage-ui.js','PipiUsage'),empty={timezone:'UTC',summary:{totalTokens:123,inputTokens:100,outputTokens:23,count:1,failures:0},trend:[],models:[],logs:{items:[]}};
 f.ui.open();f.pending.shift().resolve(empty);await turn();f.ui.open();assert.match(f.ui.render(),/123/);f.ui.reset();f.pending.shift().resolve({...empty,summary:{...empty.summary,totalTokens:999}});await turn();f.ui.open();assert.doesNotMatch(f.ui.render(),/999|123/);f.pending.shift().reject(new Error('offline'));await turn();assert.match(f.ui.render(),/offline/);assert.doesNotMatch(f.ui.render(),/还没有模型调用记录/);
});
test('usage tabs switch immediately while sharing the initial request',async()=>{
 const f=fixture('usage-ui.js','PipiUsage',true);f.ui.open();
 assert.equal(f.calls.length,1);assert.doesNotMatch(f.view.html,/data-usage-tab="(?:usage|logs)" disabled/);
 const refreshes=f.view.refreshes;f.tab('logs');assert.equal(f.view.refreshes,refreshes+1);assert.match(f.view.html,/aria-selected="true" data-usage-tab="logs"/);assert.match(f.view.html,/正在读取日志/);assert.doesNotMatch(f.view.html,/正在读取用量/);
 f.tab('usage');f.tab('logs');assert.equal(f.calls.length,1);f.pending.shift().resolve(usageData());await turn();assert.match(f.view.html,/first/);
 f.tab('usage');assert.match(f.view.html,/123/);assert.equal(f.calls.length,1);
});
test('usage range and log refresh finish independently without replacing the other panel',async()=>{
 const f=fixture('usage-ui.js','PipiUsage',true);f.ui.open();f.pending.shift().resolve(usageData());await turn();
 f.action('period');f.choose('7天');const range=f.pending.shift();assert.match(range.url,/range=7$/);assert.match(f.view.html,/正在读取用量/);
 f.tab('logs');assert.match(f.view.html,/first/);assert.doesNotMatch(f.view.html,/正在刷新/);f.action('refresh');const logs=f.pending.shift();assert.match(logs.url,/range=all$/);
 range.reject(new Error('range failed'));await turn();assert.deepEqual(f.toasts,[]);assert.doesNotMatch(f.view.html,/range failed/);
 f.search('fresh');f.page.scrollTop=35;logs.resolve(usageData(999,'fresh'));await turn();assert.match(f.view.html,/fresh/);assert.equal(f.ui.getView().query,'fresh');assert.equal(f.page.scrollTop,35);
 f.tab('usage');assert.match(f.view.html,/range failed/);assert.match(f.view.html,/data-usage-action="period" >/);
 f.action('period');f.choose('总用量');assert.match(f.view.html,/999/);assert.equal(f.calls.length,4);f.pending.shift().resolve(usageData(1000,'fresh'));await turn();
});
test('usage failures stay with their category and retry once through refresh',async()=>{
 const f=fixture('usage-ui.js','PipiUsage',true);f.ui.open();f.tab('logs');f.pending.shift().reject(new Error('offline'));await turn();assert.deepEqual(f.toasts,['offline']);assert.match(f.view.html,/offline/);
 f.tab('usage');f.tab('logs');await turn();assert.equal(f.calls.length,1);assert.deepEqual(f.toasts,['offline']);
 f.action('refresh');f.tab('usage');f.tab('logs');assert.equal(f.calls.length,2);assert.match(f.view.html,/正在读取日志/);f.pending.shift().resolve(usageData());await turn();assert.match(f.view.html,/first/);assert.doesNotMatch(f.view.html,/offline/);
});
test('usage ignores responses from the page that was left before re-entry',async()=>{
 const f=fixture('usage-ui.js','PipiUsage',true);f.ui.open();const old=f.pending.shift();f.leave();f.ui.open();const current=f.pending.shift();old.resolve(usageData(888,'old'));await turn();assert.doesNotMatch(f.view.html,/888|old/);assert.match(f.view.html,/正在读取用量/);
 current.resolve(usageData(222,'current'));await turn();assert.match(f.view.html,/222/);
 f.ui.open();const stale=f.pending.shift();f.leave();f.ui.open();f.pending.shift().resolve(usageData(333,'new'));await turn();stale.reject(new Error('stale failure'));await turn();assert.match(f.view.html,/333/);assert.doesNotMatch(f.view.html,/stale failure/);assert.deepEqual(f.toasts,[]);
});
test('restored log view loads all logs first and can immediately open its saved range',async()=>{
 const f=fixture('usage-ui.js','PipiUsage',true);const restoring=f.ui.restoreView({tab:'logs',range:'7',query:'saved',status:'all',purpose:'all',expanded:false});f.view.visible=true;f.refresh();assert.match(f.view.html,/正在读取日志/);assert.equal(f.calls.length,1);
 f.tab('usage');assert.equal(f.calls.length,2);const all=f.pending.shift(),range=f.pending.shift();assert.match(all.url,/range=all$/);assert.match(range.url,/range=7$/);
 all.resolve(usageData(111,'saved logs'));await restoring;await turn();assert.match(f.view.html,/正在读取用量/);range.resolve(usageData(777,'range-only'));await turn();assert.match(f.view.html,/777/);
 f.tab('logs');assert.match(f.view.html,/saved logs/);assert.doesNotMatch(f.view.html,/range-only/);assert.equal(f.calls.length,2);
});
