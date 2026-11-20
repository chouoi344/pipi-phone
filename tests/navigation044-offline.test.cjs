// SPDX-License-Identifier: MIT
'use strict';
// Executes the product navigation functions against an intentionally small,
// asynchronous History/EventTarget model. No browser, network or user data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {getEventListeners}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function productFunction(name){
  const start=source.indexOf('  function '+name+'(');assert.ok(start>=0,name+' exists');
  const end=start+1+source.slice(start+1).search(/\n  (?=(?:async )?function |(?:let|const) |document\.|window\.)/);assert.ok(end>start,name+' boundary exists');
  return source.slice(start,end)+"\n";
}
const popLine=source.match(/window\.addEventListener\('popstate',.*$/m)?.[0];
const navigationContext="const state=null;let bootStale=false,composeImageMeta=null;function persistChatDrafts(){}";
assert.ok(popLine,'product popstate registration exists');
class Dialog extends EventTarget{
  isConnected=true;open=false;shows=0;closes=0;
  showModal(){assert.equal(this.open,false);this.open=true;this.shows++;}
  close(){this.open=false;this.closes++;this.dispatchEvent(new Event('close'));}
  escape(){const event=new Event('cancel',{cancelable:true});this.dispatchEvent(event);if(!event.defaultPrevented)this.close();}
}
function fixture(){
  const window=new EventTarget(),entries=[{pipi:true,route:{name:'chat',arg:'qa'},stack:[]}],jobs=[];let index=0;
  const history={get state(){return entries[index];},get length(){return entries.length;},
    pushState(state){entries.splice(++index);entries.push(structuredClone(state));},
    replaceState(state){entries[index]=structuredClone(state);},back(){this.go(-1);},
    go(delta){jobs.push(()=>{index=Math.max(0,Math.min(entries.length-1,index+delta));const event=new Event('popstate');event.state=history.state;window.dispatchEvent(event);});}};
  const handlers=new Map(),sheet={parentElement:null};
  const overlay={addEventListener:(name,callback)=>handlers.set(name,callback),querySelector:()=>sheet.parentElement?sheet:null,replaceChildren(){sheet.parentElement=null;}};
  const context=vm.createContext({window,history,AbortController,EventTarget,Event,events:[],overlay});
  vm.runInContext(`let modalOpen=true,modalCloseCallback=null,modalSaveInProgress=false,modalReturnFocus=null,overlayBackPending=false,overlayCloseQueued=false,childDialog=null,childDialogSequence=0,queuedView=null,queuedBack=false;const overlayBackWaiters=[],navStack=[];let route={name:'chat',arg:'qa'};
    let chatSelection=null,globalSearchTerm='';function syncVisibleChatRead(){}const restoredRolePage=null;let composeComposing=false,searchComposing=false,recordHeld=false,recordingSession=null,recording=false,composeText='',composeImage='',composeStickerId='',quoteId='',forceBottomRole=null,composerSelection={},composerScroll={input:0,emoji:0},panel='',searchOpen=false,searchTerm='',morePage=0,emojiPage=0,emojiTab='all',emojiSearch='',emojiExpandedHeight=0;
    const drafts=new Map(),chatScrolls=new Map(),view={querySelector:()=>null};
    let composerPanelFrom=null,slowReplyRole="",chatProgressSequence=0,contactsReturn=null,chatsReturn=0;const newChatMessageIds=new Set();function stopSpeech(){}function syncChatProgress(){}function startPageTransition(){}function resetComposerPointerState(){}function roleById(){return null;}function refresh(){events.push({...route});}
    ${navigationContext}
    ${['trackModalHistory','openChildDialog','closeChildDialog','closeModal','bindSheetBackdrop','showView','goBack'].map(productFunction).join('\n')}
    ${popLine}
    trackModalHistory();
    bindSheetBackdrop();
    globalThis.api={openChildDialog,closeChildDialog,closeModal,showView,goBack,
      inspect:()=>({modalOpen,overlayBackPending,child:!!childDialog,queuedBack,queuedView}),
      waiter:()=>overlayBackWaiters.push(()=>events.push('history-settled')),
      callback:()=>{modalCloseCallback=()=>events.push('parent-closed')},
      setSaving:value=>{modalSaveInProgress=value;},
      queueBack:()=>{queuedBack=true}};`,context);
  const flush=()=>{let count=0;while(jobs.length){assert.ok(++count<20,'history settles');jobs.shift()();}};
  return {api:context.api,history,events:context.events,dialog:new Dialog(),flush,index:()=>index,jobs,
    bottomSheet:()=>{sheet.parentElement=overlay;},point:(name,inside=false)=>handlers.get(name)({target:inside?sheet:overlay})};
}
test('bottom-sheet backdrop dismisses only an outside tap and honors the active save lock',()=>{
  const f=fixture();f.bottomSheet();f.api.callback();
  f.point('pointerdown',true);f.point('click');
  f.point('pointerdown');f.point('click',true);
  f.point('pointerdown');f.point('pointercancel');f.point('click');
  assert.equal(f.api.inspect().modalOpen,true);
  f.api.setSaving(true);f.point('pointerdown');f.point('click');assert.equal(f.api.inspect().modalOpen,true);
  f.api.setSaving(false);f.point('pointerdown');f.point('click');f.flush();
  assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.index(),0);
  assert.deepEqual([...f.events],['parent-closed']);
});
test('navigation044 offline: browser Back closes child, next Back closes parent',()=>{
  const f=fixture();f.api.callback();assert.equal(f.api.openChildDialog(f.dialog),true);assert.equal(f.index(),2);
  f.history.back();f.flush();assert.equal(f.dialog.open,false);assert.equal(f.api.inspect().modalOpen,true);assert.equal(f.index(),1);assert.equal(f.events.length,0);
  f.history.back();f.flush();assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.index(),0);assert.deepEqual([...f.events],['parent-closed']);
});
for(const exit of ['Cancel','Escape','Save','native close'])test('navigation044 offline: '+exit+' consumes exactly one child entry',()=>{
  const f=fixture();f.api.openChildDialog(f.dialog);
  if(exit==='Escape')f.dialog.escape();else if(exit==='native close')f.dialog.close();else f.api.closeChildDialog();
  assert.equal(f.dialog.open,false);assert.equal(f.api.inspect().overlayBackPending,true);f.flush();
  assert.equal(f.index(),1);assert.equal(f.api.inspect().modalOpen,true);assert.equal(f.api.inspect().child,false);
  f.history.back();f.flush();assert.equal(f.index(),0);assert.equal(f.api.inspect().modalOpen,false);
});
test('navigation044 offline: repeated reopen truncates forward entries and removes stale listeners',()=>{
  const f=fixture();for(let i=0;i<30;i++){
    assert.equal(f.api.openChildDialog(f.dialog),true);assert.equal(f.api.openChildDialog(f.dialog),false);
    f.dialog.escape();assert.equal(f.api.openChildDialog(f.dialog),false,'cannot reopen during pending history');f.flush();
    assert.equal(f.history.length,3);assert.equal(f.index(),1);assert.equal(f.dialog.closes,i+1);
    assert.equal(getEventListeners(f.dialog,'cancel').length,0);assert.equal(getEventListeners(f.dialog,'close').length,0);
  }
  assert.equal(f.dialog.shows,30);assert.equal(f.jobs.length,0);
});
test('navigation044 offline: forced parent close consumes parent and child without a ghost overlay',()=>{
  const f=fixture();f.api.callback();f.api.openChildDialog(f.dialog);f.api.closeModal();f.flush();
  assert.equal(f.index(),0);assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.api.inspect().child,false);assert.equal(f.dialog.closes,1);assert.deepEqual([...f.events],['parent-closed']);
  assert.equal(f.api.inspect().overlayBackPending,false);assert.equal(f.history.state.overlay,undefined);
});
test('navigation044 offline: parent close during pending child history also consumes the parent entry',()=>{
  const f=fixture();f.api.openChildDialog(f.dialog);f.api.closeChildDialog();f.api.closeModal();f.flush();
  assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.index(),0,'closed parent must not remain as a ghost overlay history entry');assert.equal(f.history.state.overlay,undefined);
});
test('navigation044 offline: queued view during child close closes parent and dispatches requested view',()=>{
  const f=fixture();f.api.openChildDialog(f.dialog);f.api.closeChildDialog();f.api.showView('settings','qa',false);f.flush();
  assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.api.inspect().queuedView,null);assert.equal(f.events.length,1);assert.equal(f.events[0].name,'settings');
  assert.equal(f.index(),1);assert.equal(f.history.length,2);assert.equal(f.history.state.overlay,undefined);
  f.history.back();f.flush();assert.equal(f.index(),0);assert.equal(f.history.state.overlay,undefined);assert.equal(f.events[1].name,'chat');
});
test('navigation044 offline: queued Back during child close also consumes parent entry',()=>{
  const f=fixture();f.api.callback();f.api.openChildDialog(f.dialog);f.api.closeChildDialog();f.api.goBack();f.flush();
  assert.equal(f.index(),0);assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.api.inspect().queuedBack,false);assert.deepEqual([...f.events],['parent-closed']);
});
test('navigation044 offline: parent close plus queued view waits for both traversals and resolves waiters once',()=>{
  const f=fixture();f.api.openChildDialog(f.dialog);f.api.closeChildDialog();f.api.closeModal();f.api.waiter();f.api.showView('settings','qa',false);
  f.jobs.shift()();assert.equal(f.events.length,0,'no view or waiter before the parent traversal');assert.equal(f.jobs.length,1);
  f.flush();assert.equal(f.index(),1);assert.equal(f.history.length,2);assert.equal(f.events[0].name,'settings');assert.equal(f.events[1],'history-settled');assert.equal(f.events.length,2);
});
test('navigation044 offline: invalid dialog never adds a history entry',()=>{
  const f=fixture();f.dialog.isConnected=false;assert.equal(f.api.openChildDialog(f.dialog),false);assert.equal(f.index(),1);assert.equal(f.dialog.shows,0);
});

// Exercise the shipped HTML confirmation handler and preserved parent DOM, not
// only <dialog>: Me -> Favorites -> selection page -> delete confirmation.
function htmlFixture(){
  const window=new EventTarget(),document={activeElement:null},jobs=[],events=[],entries=[{pipi:true,route:{name:'me'},stack:[]}];let index=0;
  const history={get state(){return entries[index];},pushState(value){entries.splice(++index);entries.push(structuredClone(value));},replaceState(value){entries[index]=structuredClone(value);},back(){this.go(-1);},go(delta){jobs.push(()=>{index=Math.max(0,Math.min(entries.length-1,index+delta));const event=new Event('popstate');event.state=history.state;window.dispatchEvent(event);});}};
  const connect=(node,value)=>{node.isConnected=value;for(const child of node.childNodes||[])connect(child,value);};
  const node=(kind,children=[])=>({kind,childNodes:children,isConnected:false,disabled:false,style:{},setAttribute(){},append(...items){this.childNodes.push(...items);for(const item of items)connect(item,this.isConnected);},focus(){document.activeElement=this;},click(){if(!this.disabled)return this.onclick?.({});}});
  const parentInput=node('input');parentInput.checked=true;const parent=node('sheet',[parentInput]);
  const find=(children,kind)=>{for(const child of children){if(child.kind===kind)return child;const nested=find(child.childNodes||[],kind);if(nested)return nested;}return null;};
  const overlay={childNodes:[],replaceChildren(...children){for(const child of this.childNodes)connect(child,false);this.childNodes=children;for(const child of children)connect(child,true);},prepend(child){this.childNodes.unshift(child);connect(child,true);},querySelector(selector){
    if(selector==='.modal-sheet')return find(this.childNodes,'sheet');
    if(selector.includes('#alert-confirm'))return find(this.childNodes.filter(n=>n.kind==='alert'),'confirm');
    if(selector.includes('.modal-error'))return find(this.childNodes.filter(n=>n.kind==='alert'),'error');
    if(selector.includes('[data-close]'))return find(this.childNodes.filter(n=>n.kind==='alert'),'cancel');
    return find(this.childNodes,'input');
  },querySelectorAll(){return [find(this.childNodes,'mask'),find(this.childNodes.filter(n=>n.kind==='alert'),'cancel')].filter(Boolean);}};
  Object.defineProperty(overlay,'innerHTML',{set(){overlay.replaceChildren(node('mask'),node('alert',[node('cancel'),node('confirm'),node('error')]));}});
  document.createElement=()=>node('underlay');
  const context=vm.createContext({window,document,history,overlay,events,AbortController,parentInput});
  vm.runInContext(`let modalOpen=false,modalCloseCallback=null,modalSaveInProgress=false,modalReturnFocus=null,overlayBackPending=false,overlayCloseQueued=false,childDialog=null,childDialogSequence=0,queuedView=null,queuedBack=false,chatSelection=null,globalSearchTerm='';const overlayBackWaiters=[],navStack=[];let route={name:'me'};
    const restoredRolePage=null;let composeComposing=false,searchComposing=false,recordHeld=false,recordingSession=null,recording=false,composeText='',composeImage='',composeStickerId='',quoteId='',forceBottomRole=null,composerSelection={},composerScroll={input:0,emoji:0},panel='',searchOpen=false,searchTerm='',morePage=0,emojiPage=0,emojiTab='all',emojiSearch='',emojiExpandedHeight=0,deleted=0;
    const drafts=new Map(),chatScrolls=new Map(),view={querySelector:()=>null};let composerPanelFrom=null,slowReplyRole="",chatProgressSequence=0,contactsReturn=null,chatsReturn=0;const newChatMessageIds=new Set();function stopSpeech(){}function syncChatProgress(){}function startPageTransition(){}function resetComposerPointerState(){}function roleById(){return null;}function syncVisibleChatRead(){}function refresh(){events.push(route.name);}function esc(value){return value;}function toast(value){events.push(value);}
    ${navigationContext}
    ${['trackModalHistory','openChildDialog','closeChildDialog','closeModal','captureModalParent','mountModalParent','restoreModalParent','confirmDialog','showView','goBack'].map(productFunction).join('\n')}
    ${popLine}
    showView('favorites');events.length=0;
    globalThis.api={closeModal,openChildDialog,goBack,showView,
      openParent(){modalOpen=true;modalCloseCallback=()=>events.push('parent-closed');modalReturnFocus=parentInput;trackModalHistory();},
      confirm(fail=false){confirmDialog('删除收藏','删除选中的1条收藏',async()=>{if(fail)throw new Error('delete failed');deleted++;});},
      inspect:()=>({route:route.name,modalOpen,overlayBackPending,depth:history.state?.overlayDepth,deleted}),waiter:()=>overlayBackWaiters.push(()=>events.push('history-settled'))};`,context);
  overlay.replaceChildren(parent);document.activeElement=parentInput;context.api.openParent();
  const flush=()=>{let count=0;while(jobs.length){assert.ok(++count<30,'HTML history settles');jobs.shift()();}};
  return {api:context.api,history,overlay,parent,parentInput,jobs,events,flush,index:()=>index,confirm:()=>overlay.querySelector(':scope > .alert-dialog #alert-confirm'),cancel:()=>overlay.querySelector('.alert-actions [data-close]')};
}

test('navigation045 HTML: successful nested confirmation discards selection and next Back returns to Me once',async()=>{
  const f=htmlFixture();f.api.confirm();assert.equal(f.index(),3);assert.equal(f.history.state.overlayDepth,2);await f.confirm().click();f.flush();
  assert.equal(f.index(),1);assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.api.inspect().deleted,1);assert.equal(f.history.state.overlay,undefined);f.api.goBack();f.flush();assert.equal(f.index(),0);assert.equal(f.api.inspect().route,'me');
});
for(const exit of ['Cancel','header Back','browser Back'])test('navigation045 HTML: '+exit+' restores the same checked selection parent',()=>{
  const f=htmlFixture();f.api.confirm();if(exit==='Cancel')f.cancel().click();else if(exit==='header Back')f.api.goBack();else f.history.back();f.flush();
  assert.equal(f.index(),2);assert.equal(f.history.state.overlayDepth,1);assert.equal(f.api.inspect().modalOpen,true);assert.equal(f.overlay.querySelector('.modal-sheet'),f.parent);assert.equal(f.parentInput.checked,true);assert.equal(f.parentInput.isConnected,true);assert.equal(f.api.inspect().deleted,0);
  f.api.goBack();f.flush();assert.equal(f.index(),1);assert.equal(f.api.inspect().route,'favorites');f.api.goBack();f.flush();assert.equal(f.api.inspect().route,'me');
});
test('navigation045 HTML: failed confirmation keeps both layers and can be cancelled without deleting',async()=>{
  const f=htmlFixture();f.api.confirm(true);await f.confirm().click();assert.equal(f.index(),3);assert.equal(f.confirm().disabled,false);assert.equal(f.overlay.querySelector(':scope > .alert-dialog .modal-error').textContent,'delete failed');assert.equal(f.api.inspect().deleted,0);
  f.cancel().click();f.flush();assert.equal(f.index(),2);assert.equal(f.overlay.querySelector('.modal-sheet'),f.parent);assert.equal(f.parentInput.checked,true);
});
test('navigation045 HTML: repeated nested confirms retain accurate depth and successful discard clears every HTML layer',async()=>{
  const f=htmlFixture();f.api.confirm();f.api.confirm();assert.equal(f.history.state.overlayDepth,3);await f.confirm().click();f.flush();assert.equal(f.index(),1);assert.equal(f.api.inspect().modalOpen,false);f.api.goBack();f.flush();assert.equal(f.api.inspect().route,'me');
});
test('navigation045 HTML: native child inside nested confirmation is included in discarded depth',()=>{
  const f=htmlFixture(),dialog=new Dialog();f.api.confirm();f.api.openChildDialog(dialog);assert.equal(f.index(),4);f.api.closeModal(false);f.flush();assert.equal(dialog.open,false);assert.equal(f.index(),1);assert.equal(f.api.inspect().modalOpen,false);f.api.goBack();f.flush();assert.equal(f.api.inspect().route,'me');
});
test('navigation045 HTML: discard during pending cancel consumes remaining parent before queued view and waiter',()=>{
  const f=htmlFixture();f.api.confirm();f.cancel().click();f.api.closeModal(false);f.api.waiter();f.api.showView('settings');
  f.jobs.shift()();assert.equal(f.index(),2);assert.deepEqual(f.events,[]);assert.equal(f.jobs.length,1);f.flush();assert.equal(f.api.inspect().route,'settings');assert.deepEqual(f.events,['settings','history-settled']);assert.equal(f.history.state.overlay,undefined);f.history.back();f.flush();assert.equal(f.api.inspect().route,'favorites');assert.equal(f.history.state.overlay,undefined);
});
test('navigation045 HTML: queued Back during pending parent discard reaches Me without another overlay entry',()=>{
  const f=htmlFixture();f.api.confirm();f.cancel().click();f.api.closeModal(false);f.api.goBack();f.flush();assert.equal(f.index(),0);assert.equal(f.api.inspect().route,'me');assert.equal(f.api.inspect().modalOpen,false);assert.equal(f.history.state.overlay,undefined);
});
