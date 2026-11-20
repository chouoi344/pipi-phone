// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(file,name){
 const pending=[];const P={api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),esc:String,icons:{back:'',chevron:''},refresh(){},showView(){},toast(){}};
 const scope={window:{Pipi:P},document:{querySelector:s=>s==='#view'?{dataset:{route:'account-security'}}:null,querySelectorAll:()=>[]},queueMicrotask,Map,Intl,Date};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/'+file),'utf8'),scope);
 return {ui:scope.window[name],pending};
}
test('account re-entry keeps successful devices and reset rejects old response',async()=>{
 const f=fixture('account-ui.js','PipiAccount');f.ui.enter();f.pending.shift().resolve({sessionCount:2,otherSessionCount:1});await turn();f.ui.enter();assert.match(f.ui.render(),/2 个/);assert.match(f.ui.render(),/data-account-revoke disabled/);f.ui.reset();f.pending.shift().resolve({sessionCount:9,otherSessionCount:8});await turn();assert.doesNotMatch(f.ui.render(),/9 个|2 个/);
});
test('usage opens cached range and reset prevents old result entering next login',async()=>{
 const f=fixture('usage-ui.js','PipiUsage'),empty={timezone:'UTC',summary:{totalTokens:123,inputTokens:100,outputTokens:23,count:1,failures:0},trend:[],models:[],logs:{items:[]}};
 f.ui.open();f.pending.shift().resolve(empty);await turn();f.ui.open();assert.match(f.ui.render(),/123/);f.ui.reset();f.pending.shift().resolve({...empty,summary:{...empty.summary,totalTokens:999}});await turn();f.ui.open();assert.doesNotMatch(f.ui.render(),/999|123/);f.pending.shift().reject(new Error('offline'));await turn();assert.match(f.ui.render(),/offline/);assert.doesNotMatch(f.ui.render(),/还没有模型调用记录/);
});
