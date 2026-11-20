// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function productFunction(name){
  const start=source.indexOf('  function '+name+'('),end=start+1+source.slice(start+1).search(/\n  (?=(?:async )?function |(?:let|const) |document\.|window\.)/);assert.ok(start>=0&&end>start,name);
  return source.slice(start,end)+"\n";
}
const popLine=source.match(/window\.addEventListener\('popstate',.*$/m)?.[0];
function fixture(){
  const window=new EventTarget(),entries=[{pipi:true,route:{name:'me',arg:null},stack:[]}],jobs=[],settingsContent={scrollTop:0};let index=0;
  const history={get state(){return entries[index];},replaceState:next=>entries[index]=structuredClone(next),
    pushState(next){entries.splice(++index);entries.push(structuredClone(next));},back(){this.go(-1);},
    go(delta){jobs.push(()=>{index=Math.max(0,Math.min(entries.length-1,index+delta));const event=new Event('popstate');event.state=history.state;window.dispatchEvent(event);});}};
  const scope=vm.createContext({window,history,settingsContent,view:{querySelector:selector=>selector==='.settings-content'?settingsContent:null}});
  vm.runInContext(`let state={roles:[]},bootStale=false;const sessionStorage={setItem(){},removeItem(){}};${source.match(/^  const roleRoutes=.*$/m)[0]}let route={name:'me',arg:null},modalOpen=false,modalCloseCallback=null,modalReturnFocus=null,overlayBackPending=false,overlayCloseQueued=false,childDialog=null,childDialogSequence=0,queuedView=null,queuedBack=false;
    const overlayBackWaiters=[],navStack=[],drafts=new Map(),chatScrolls=new Map();
    let chatSelection=null,globalSearchTerm='',composeComposing=false,searchComposing=false,recordHeld=false,recordingSession=null,recording=false,composeText='',composeImage='',quoteId='',forceBottomRole=null,composerSelection={},composerScroll={input:0,emoji:0},panel='',searchOpen=false,searchTerm='',morePage=0,emojiPage=0,emojiTab='all',emojiSearch='',emojiExpandedHeight=0;
    let modalSaveInProgress=false;function closeModal(){}let composerPanelFrom=null,slowReplyRole="",chatProgressSequence=0,contactsReturn=null,chatsReturn=0,composeStickerId="";const newChatMessageIds=new Set();function stopSpeech(){}function syncChatProgress(){}function startPageTransition(){}function resetComposerPointerState(){}function syncVisibleChatRead(){}
    function refresh(){if(route.name==='settings')settingsContent.scrollTop=route.scrollTop||0;}
    ${productFunction('persistChatDrafts')}${productFunction('showView')}${productFunction('goBack')}${popLine}
    globalThis.ui={showView,goBack,route:()=>route};`,scope);
  return {ui:scope.ui,history,settingsContent,flush(){let count=0;while(jobs.length){assert.ok(++count<20,'history settles');jobs.shift()();}}};
}
test('settings child Back restores the position from which it was opened',()=>{
  const f=fixture();f.ui.showView('settings');f.settingsContent.scrollTop=430;f.ui.showView('about');f.ui.goBack();f.flush();
  assert.equal(f.ui.route().name,'settings');assert.equal(f.settingsContent.scrollTop,430);
});
test('Back from settings leaves the destination Me history entry intact',()=>{
  const f=fixture();f.ui.showView('settings');f.settingsContent.scrollTop=430;f.ui.goBack();f.flush();
  assert.equal(f.ui.route().name,'me');assert.equal(f.history.state.route.name,'me');
});
test('repeated visits to settings each return to Me with one Back',()=>{
  const f=fixture();for(let visit=0;visit<3;visit++){
    f.ui.showView('settings');f.settingsContent.scrollTop=430;f.ui.goBack();f.flush();assert.equal(f.ui.route().name,'me','visit '+visit);
  }
});
