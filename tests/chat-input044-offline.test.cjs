// SPDX-License-Identifier: MIT
'use strict';
// Run shipped navigation and event handlers against a small DOM/History model.
// Rendering, browser caret defaults and the system keyboard are checked separately.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function productFunction(name){
  const pattern=new RegExp('^  (?:async )?function '+name+'\\(','m'),match=pattern.exec(source);
  assert.ok(match,name+' exists');
  const rest=source.slice(match.index+match[0].length),end=/\n  (?:async )?function /.exec(rest);
  assert.ok(end,name+' boundary exists');
  return source.slice(match.index,match.index+match[0].length+end.index);
}
const popLine=source.split(/\r?\n/).find(line=>line.includes("window.addEventListener('popstate',"));
const roleRoutesSource=source.match(/^  const roleRoutes=.*$/m)[0];
function fixture(initialBubbles=[]){
  const jobs=[],window=new EventTarget(),document=Object.assign(new EventTarget(),{activeElement:null});
  const entries=[{pipi:true,route:{name:'chat',arg:'alice'},stack:[]}];let index=0,nodes={},focuses=0,updates=0,menus=0,payments=0;
  const history={get state(){return entries[index];},pushState(value){entries.splice(++index);entries.push(structuredClone(value));},replaceState(value){entries[index]=structuredClone(value);},back(){this.go(-1);},go(delta){jobs.push(()=>{index=Math.max(0,Math.min(entries.length-1,index+delta));const event=new Event('popstate');event.state=history.state;window.dispatchEvent(event);});}};
  function node(properties={}){return {isConnected:true,scrollTop:0,style:{},dataset:{},listeners:new Map(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(name,callback){this.listeners.set(name,callback);},closest:()=>null,focus(){focuses++;document.activeElement?.blur();document.activeElement=this;},blur(){if(document.activeElement===this)document.activeElement=null;this.onblur?.();},...properties};}
  function buildComposer(model){
    const old=nodes.footer;if(old){if(old.contains(document.activeElement))document.activeElement?.blur();for(const item of old.children)item.isConnected=false;old.isConnected=false;}
    const form=node(),input=model.panel==='voice'?null:node({id:'compose-text',text:model.text,inputMode:model.panel==='emoji'?'none':'text',scrollHeight:160,hasSelection:false}),emoji=model.panel==='emoji'?node():null;
    if(input)Object.defineProperty(input,'innerHTML',{get(){return this.text;},set(value){this.text=value;}});
    const footer=node({children:[form,input,emoji].filter(Boolean),querySelector(selector){return selector==='#compose-text'?input:selector==='.emoji-scroll'?emoji:null;},contains(item){return this.children.includes(item);}});
    for(const child of footer.children)child.closest=selector=>selector==='.chat-composer'?footer:null;
    Object.defineProperty(footer,'outerHTML',{set(value){updates++;buildComposer(value);}});
    Object.assign(nodes,{form,input,emoji,footer});
  }
  const view={querySelector(selector){return {'#compose-form':nodes.form,'#compose-text':nodes.input,'.chat-composer':nodes.footer,'.emoji-scroll':nodes.emoji,'#chat-messages':nodes.list}[selector]||null;},querySelectorAll(selector){return selector==='[data-bubble]'?(nodes.bubbles||[]):[];}};
  document.getElementById=id=>view.querySelector('#'+id);
  const context=vm.createContext({window,history,document,view,Event,AbortController,console,setTimeout:callback=>{jobs.push(callback);return callback;},clearTimeout:callback=>{const i=jobs.indexOf(callback);if(i>=0)jobs.splice(i,1);},requestAnimationFrame:callback=>{jobs.push(callback);return jobs.length;},cancelAnimationFrame(){},overlay:{replaceChildren(){}},buildComposer,
    buildScreen(name,model){if(name==='chat'){nodes.list=node({scrollHeight:3000,clientHeight:600,querySelectorAll:()=>[]});nodes.bubbles=initialBubbles;if(model.selecting){if(nodes.footer){nodes.footer.isConnected=false;for(const child of nodes.footer.children)child.isConnected=false;}Object.assign(nodes,{form:null,input:null,emoji:null,footer:null});}else buildComposer(model);}else{if(nodes.footer?.contains(document.activeElement))document.activeElement?.blur();nodes={};}},
    showMenu(){menus++;},showPayment(){payments++;}});
  vm.runInContext(`
    let route={name:'chat',arg:'alice'},modalOpen=false,modalCloseCallback=null,modalSaveInProgress=false,modalReturnFocus=null,overlayBackPending=false,overlayCloseQueued=false,childDialog=null,childDialogSequence=0,queuedView=null,queuedBack=false;
    const navStack=[],drafts=new Map(),chatScrolls=new Map(),overlayBackWaiters=[],composerHistories=new Map(),pressTimers=new Set();
    const chatDraftKey='pipi.chat-drafts',storage=new Map(),sessionStorage={setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
    let bootStale=false;
    ${roleRoutesSource}
    function scheduleRender(){}function flushRender(){}
    const newChatMessageIds=new Set();let speechSession=null,slowReplyRole='',chatProgressSequence=0,composerPanelFrom=null,chatsReturn=0,contactsReturn=null;
    function stopSpeech(){}function syncChatProgress(){}function startPageTransition(){}function animateComposerPanel(){}
    let composeText='',composeImage='',composeStickerId='',quoteId='',panel='',composerSelection={start:0,end:0},composerScroll={input:0,emoji:0},morePage=0,emojiPage=0,emojiTab='all',emojiSearch='',emojiExpandedHeight=0;
    let chatSelection=null,globalSearchTerm='';function syncVisibleChatRead(){}let composeComposing=false,searchComposing=false,deferredComposerUpdate=false,pointerComposerUpdatePending=false,recordHeld=false,recordingSession=null,recording=false,sending=false,dictationBusy=false,forceBottomRole='',focusMessageId='',searchOpen=false,searchTerm='';
    const state={messages:[],settings:{}};const afterOverlayBack=()=>overlayBackPending?new Promise(resolve=>overlayBackWaiters.push(resolve)):Promise.resolve();
    function resetComposerPointerState(){}function composerPointerBusy(){return false;}function roleById(id){return {id};}function bindActionButtons(){}function syncComposerControls(){}function stopRecording(){}
    function readComposerText(input){return input.text;}function readComposerSelection(input){return input.hasSelection?{...input.caret}:{...composerSelection};}
    function setComposerSelection(input,start,end=start){composerSelection={start,end};input.caret={start,end};input.hasSelection=true;}
    function richText(text){return text;}function rememberComposerEdit(){}function sendMessage(){}function messageMenu(){showMenu();}function safeImage(){return false;}function toast(){}
    function renderComposer(){return {text:composeText,panel,selecting:!!chatSelection};}
    function refresh(){buildScreen(route.name,renderComposer());if(route.name==='chat'){bindChat();scrollChat();}}
    window.PipiFeatures={walletTransaction:showPayment};
    ${['trackModalHistory','openChildDialog','closeChildDialog','closeModal','showView','goBack','captureChatLayout','restoreChatLayout','persistChatDrafts','pressTimer','resizeComposeInput','paintComposer','syncComposerDraft','updateComposer','changeComposerMode','insertComposerText','scrollChat','startMessageSelection','finishMessageSelection','toggleSelectedMessage','handleAction','bindChat','bindComposer'].map(productFunction).join('\n')}
    ${popLine}
    refresh();
    globalThis.api={showView,goBack,handleAction,changeComposerMode,bindChat,startMessageSelection,finishMessageSelection,toggleSelectedMessage,selected:()=>chatSelection?[...chatSelection.ids]:null,setGlobalSearch:value=>{globalSearchTerm=value;},globalSearch:()=>globalSearchTerm,
      edit(value){if('text'in value){composeText=value.text;const input=view.querySelector('#compose-text');if(input)input.text=value.text;}if(value.selection){composerSelection={...value.selection};const input=view.querySelector('#compose-text');if(input){input.caret={...value.selection};input.hasSelection=true;}}if('image'in value)composeImage=value.image;if('quote'in value)quoteId=value.quote;
        if('panel'in value)panel=value.panel;if('morePage'in value)morePage=value.morePage;if('emojiPage'in value)emojiPage=value.emojiPage;if('emojiTab'in value)emojiTab=value.emojiTab;if('emojiSearch'in value)emojiSearch=value.emojiSearch;if('emojiExpandedHeight'in value)emojiExpandedHeight=value.emojiExpandedHeight;},
      inspect:()=>({route:{...route},text:composeText,image:composeImage,quote:quoteId,panel,selection:{...composerSelection},scroll:{...composerScroll},morePage,emojiPage,emojiTab,emojiSearch,emojiExpandedHeight,forceBottomRole}),
      openWallet(mode){showView('wallet',{roleId:route.arg,mode});modalOpen=true;modalCloseCallback=()=>goBack();trackModalHistory();},
      cancel:()=>closeModal(),draft:id=>drafts.get(id),addMessage:message=>state.messages.push(message)};
  `,context);
  const flush=()=>{let count=0;while(jobs.length){assert.ok(++count<100,'queued work settles');jobs.shift()();}};flush();
  const result=value=>JSON.parse(JSON.stringify(value));
  return {api:context.api,context,document,history,view,flush,result,get nodes(){return nodes;},get focuses(){return focuses;},get updates(){return updates;},get menus(){return menus;},get payments(){return payments;}};
}

for(const mode of ['redpacket','transfer'])for(const exit of ['cancel','top-back','browser-back'])test(`chat input: ${mode} ${exit} keeps the plus panel and restores the draft without keyboard focus`,()=>{
  const f=fixture();f.api.edit({text:'甲[色]乙\n草稿',selection:{start:1,end:4},image:'draft-image',quote:'quoted',panel:'more',morePage:1});
  f.nodes.input.scrollTop=64;f.nodes.list.scrollTop=277;
  f.api.openWallet(mode);if(exit==='browser-back')f.history.back();else f.api.cancel();f.flush();
  assert.deepEqual(f.result(f.api.inspect()),{route:{name:'chat',arg:'alice'},text:'甲[色]乙\n草稿',image:'draft-image',quote:'quoted',panel:'more',selection:{start:1,end:4},scroll:{input:64,emoji:0},morePage:1,emojiPage:0,emojiTab:'all',emojiSearch:'',emojiExpandedHeight:0,forceBottomRole:''});
  assert.equal(f.nodes.input.value,'甲[色]乙\n草稿');assert.equal(f.nodes.input.scrollTop,64);assert.equal(f.nodes.list.scrollTop,277);assert.equal(f.document.activeElement,null);assert.equal(f.focuses,0);
});

test('chat input: same-role details/search return restores the draft with the panel closed',()=>{
  const f=fixture();f.api.edit({text:'A[微笑]B',selection:{start:1,end:5},panel:'emoji',emojiTab:'search',emojiSearch:'微笑',emojiPage:1,emojiExpandedHeight:320});
  f.api.changeComposerMode('emoji');f.nodes.emoji.scrollTop=91;f.nodes.list.scrollTop=410;
  f.api.showView('chat-info','alice');f.history.back();f.flush();
  const restored=f.result(f.api.inspect());assert.equal(restored.text,'A[微笑]B');assert.equal(restored.panel,'');assert.deepEqual(restored.selection,{start:1,end:5});assert.equal(restored.emojiTab,'search');assert.equal(restored.emojiSearch,'微笑');assert.equal(restored.emojiPage,1);assert.equal(restored.emojiExpandedHeight,320);assert.equal(restored.scroll.emoji,91);assert.equal(f.nodes.list.scrollTop,410);assert.equal(f.focuses,0);
  f.api.showView('chat-search','alice');f.api.showView('chat','alice');f.flush();assert.equal(f.api.inspect().text,'A[微笑]B');assert.equal(f.api.inspect().panel,'');
});

test('chat input: two conversations isolate drafts, caret, panels and panel scroll',()=>{
  const f=fixture();f.api.edit({text:'Alice',selection:{start:2,end:3},panel:'more',morePage:1});f.nodes.list.scrollTop=123;
  f.api.showView('chat','bob');f.flush();assert.equal(f.api.inspect().panel,'');assert.equal(f.api.inspect().text,'');assert.equal(f.api.inspect().morePage,0);
  f.api.edit({text:'Bob',selection:{start:1,end:1},panel:'emoji',emojiTab:'favorites'});f.api.changeComposerMode('emoji');f.nodes.emoji.scrollTop=47;f.nodes.list.scrollTop=456;
  f.api.showView('chat','alice');f.flush();assert.equal(f.api.inspect().text,'Alice');assert.equal(f.api.inspect().panel,'');assert.equal(f.api.inspect().morePage,1);assert.deepEqual(f.result(f.api.inspect().selection),{start:2,end:3});assert.equal(f.nodes.list.scrollTop,123);
  f.api.showView('chat','bob');f.flush();assert.equal(f.api.inspect().text,'Bob');assert.equal(f.api.inspect().panel,'');assert.equal(f.api.inspect().emojiTab,'favorites');assert.equal(f.api.inspect().scroll.emoji,47);assert.equal(f.nodes.list.scrollTop,456);assert.equal(f.focuses,0);
});

test('chat input: mode buttons blur the keyboard and switch exclusively; keyboard buttons restore the caret',async()=>{
  const f=fixture();f.api.edit({text:'甲乙丙',selection:{start:1,end:2}});f.nodes.input.focus();
  await f.api.handleAction('toggle-panel');assert.equal(f.api.inspect().panel,'more');assert.equal(f.document.activeElement,null);
  await f.api.handleAction('toggle-emoji');assert.equal(f.api.inspect().panel,'emoji');assert.equal(f.document.activeElement,null);
  await f.api.handleAction('toggle-voice');assert.equal(f.api.inspect().panel,'voice');assert.equal(f.nodes.input,null);
  await f.api.handleAction('toggle-voice');assert.equal(f.api.inspect().panel,'');assert.equal(f.document.activeElement,f.nodes.input);assert.deepEqual(f.result(f.api.inspect().selection),{start:1,end:2});
  await f.api.handleAction('toggle-emoji');assert.equal(f.document.activeElement,null);await f.api.handleAction('toggle-emoji');assert.equal(f.document.activeElement,f.nodes.input);assert.equal(f.api.inspect().panel,'');
});

test('chat input: restoring focus leaves the panel; clicking the editor switches to keyboard',()=>{
  const f=fixture();f.api.edit({text:'draft',panel:'emoji'});f.api.changeComposerMode('emoji');f.nodes.input.focus();assert.equal(f.api.inspect().panel,'emoji');
  vm.runInContext('updateComposer()',f.context);assert.equal(f.api.inspect().panel,'emoji');assert.equal(f.document.activeElement,f.nodes.input);
  f.nodes.input.onpointerdown({});assert.equal(f.api.inspect().panel,'');assert.equal(f.nodes.input.inputMode,'text');
});

test('chat input: keyboard entry without a pointer closes panels after accepting the character',()=>{
  const f=fixture();f.api.edit({text:'AB',selection:{start:1,end:1}});f.api.changeComposerMode('more');const input=f.nodes.input;input.focus();
  input.listeners.get('beforeinput')({cancelable:true,inputType:'insertText'});assert.equal(input.isConnected,true,'keep the browser edit target until its input event');
  input.text='AxB';input.caret={start:2,end:2};input.hasSelection=true;input.oninput({});f.flush();
  assert.equal(f.api.inspect().panel,'');assert.equal(f.nodes.input.value,'AxB');assert.deepEqual(f.result(f.api.inspect().selection),{start:2,end:2});assert.equal(f.document.activeElement,f.nodes.input);
});

test('chat input: input-only browser edits and IME commit switch modes without losing content',()=>{
  const f=fixture();f.api.changeComposerMode('emoji');let input=f.nodes.input;input.focus();input.text='自动填入';input.caret={start:4,end:4};input.hasSelection=true;input.oninput({});
  assert.equal(f.api.inspect().panel,'');assert.equal(f.nodes.input.value,'自动填入');
  f.api.changeComposerMode('more');input=f.nodes.input;input.focus();input.listeners.get('compositionstart')();input.text='自动填入中文';input.caret={start:6,end:6};input.hasSelection=true;input.oninput({isComposing:true});
  assert.equal(input.isConnected,true,'composition retains its editor');input.listeners.get('compositionend')();f.flush();
  assert.equal(f.api.inspect().panel,'');assert.equal(f.nodes.input.value,'自动填入中文');assert.deepEqual(f.result(f.api.inspect().selection),{start:6,end:6});
});

for(const edit of ['paste','drop','cut','newline'])test(`chat input: custom ${edit} edit closes the panel while emoji-button insertion keeps it`,()=>{
  const f=fixture();f.api.edit({text:'AB',selection:edit==='cut'?{start:0,end:1}:{start:1,end:1}});f.api.changeComposerMode('more');const input=f.nodes.input;input.focus();
  const event={preventDefault(){},clipboardData:{getData:()=> '粘贴',setData(){}},dataTransfer:{getData:()=> '拖入'},key:'Enter',shiftKey:true};
  if(edit==='newline')input.onkeydown(event);else input.listeners.get(edit)(event);
  assert.equal(input.isConnected,true);f.flush();
  assert.equal(f.api.inspect().panel,'');assert.equal(f.nodes.input.value,{paste:'A粘贴B',drop:'A拖入B',cut:'B',newline:'A\nB'}[edit]);assert.equal(f.document.activeElement,f.nodes.input);
  f.api.changeComposerMode('emoji');vm.runInContext("insertComposerText('[色]')",f.context);assert.equal(f.api.inspect().panel,'emoji');assert.ok(f.api.inspect().text.includes('[色]'));
});

test('chat input: blank taps dismiss more/emoji/keyboard but preserve voice mode and draft',()=>{
  const f=fixture(),blank={closest:()=>null};f.api.edit({text:'草稿',selection:{start:1,end:1}});
  for(const mode of ['more','emoji']){f.api.changeComposerMode(mode);f.nodes.list.onclick({target:blank});assert.equal(f.api.inspect().panel,'');assert.equal(f.document.activeElement,null);assert.equal(f.api.inspect().text,'草稿');}
  f.nodes.input.focus();f.nodes.list.onclick({target:blank});assert.equal(f.document.activeElement,null);
  f.api.changeComposerMode('voice');f.nodes.list.onclick({target:blank});assert.equal(f.api.inspect().panel,'voice');
});

test('chat input: card/avatar controls, dragged blank and cancelled gestures do not dismiss panels',()=>{
  const f=fixture(),blank={closest:()=>null};f.api.changeComposerMode('more');
  for(const selector of ['button','a','[data-nav]','[data-bubble]','[data-retry]'])f.nodes.list.onclick({target:{closest:selectors=>selectors.includes(selector)?{}:null}});
  assert.equal(f.api.inspect().panel,'more');
  f.nodes.list.onpointerdown({clientX:10,clientY:20});f.nodes.list.onpointermove({clientX:12,clientY:80});f.nodes.list.onclick({target:blank});assert.equal(f.api.inspect().panel,'more');
  f.nodes.list.onpointerdown({clientX:10,clientY:20});f.nodes.list.onpointercancel();f.nodes.list.onclick({target:blank});assert.equal(f.api.inspect().panel,'more');
  f.nodes.list.onpointerdown({clientX:10,clientY:20});f.nodes.list.onclick({target:blank});assert.equal(f.api.inspect().panel,'');
});

test('chat input: payment card still opens once; long press suppresses its following click',()=>{
  const card={dataset:{bubble:'payment'},classList:{contains:()=>true},closest:()=>card},f=fixture([card]);
  f.api.addMessage({id:'payment',type:'transfer',meta:{transactionId:'tx'}});f.api.changeComposerMode('more');
  card.onclick();f.nodes.list.onclick({target:card});assert.equal(f.payments,1);assert.equal(f.api.inspect().panel,'more');
  card.onpointerdown({button:0,clientX:10,clientY:10});f.flush();card.onpointerup();card.onclick();f.nodes.list.onclick({target:card});assert.equal(f.menus,1);assert.equal(f.payments,1);assert.equal(f.api.inspect().panel,'more');
});

test('chat input: composer re-render preserves editor scroll and message scroll while changing mode',()=>{
  const f=fixture();f.api.edit({text:'line\n'.repeat(20),selection:{start:2,end:2}});f.nodes.input.scrollTop=73;f.nodes.list.scrollTop=305;
  f.api.changeComposerMode('more');assert.equal(f.nodes.input.scrollTop,73);assert.equal(f.nodes.list.scrollTop,305);
  f.api.changeComposerMode('emoji');f.nodes.emoji.scrollTop=88;f.api.changeComposerMode('emoji');assert.equal(f.nodes.emoji.scrollTop,88);assert.equal(f.nodes.input.scrollTop,73);assert.equal(f.nodes.list.scrollTop,305);
});

for(const exit of ['header','browser'])test('message selection: '+exit+' Back exits only selection and restores the composer draft',async()=>{
  const f=fixture();f.api.edit({text:'草稿[微笑]',image:'draft-image',quote:'quote',selection:{start:1,end:5},panel:'more',morePage:1});f.nodes.input.scrollTop=64;
  await f.api.startMessageSelection('message-1');assert.deepEqual(f.result(f.api.selected()),['message-1']);assert.equal(f.nodes.input,null);assert.equal(f.history.state.chatSelection,true);
  f.api.toggleSelectedMessage('message-2');assert.deepEqual(f.result(f.api.selected()),['message-1','message-2']);
  if(exit==='header')f.api.goBack();else f.history.back();f.flush();
  assert.equal(f.api.selected(),null);assert.equal(f.history.state.chatSelection,undefined);assert.equal(f.api.inspect().route.name,'chat');assert.equal(f.api.inspect().text,'草稿[微笑]');assert.equal(f.api.inspect().image,'draft-image');assert.equal(f.api.inspect().quote,'quote');assert.equal(f.api.inspect().panel,'more');assert.equal(f.api.inspect().morePage,1);assert.equal(f.nodes.input.scrollTop,64);assert.equal(f.document.activeElement,null);
});

test('message selection: navigation consumes the selection entry before opening another page',async()=>{
  const f=fixture();f.api.edit({text:'draft',panel:'emoji'});await f.api.startMessageSelection('message-1');f.api.showView('role','alice');f.flush();
  assert.equal(f.api.selected(),null);assert.equal(f.api.inspect().route.name,'role');f.history.back();f.flush();assert.equal(f.api.inspect().route.name,'chat');assert.equal(f.api.selected(),null);assert.equal(f.history.state.chatSelection,undefined);assert.equal(f.api.inspect().text,'draft');assert.equal(f.api.inspect().panel,'');
});

test('global search: returning from a message preserves the term; switching main tabs clears it',()=>{
  const f=fixture();f.api.showView('chats');f.api.setGlobalSearch('old needle');f.api.showView('chat','alice');f.history.back();f.flush();assert.equal(f.api.inspect().route.name,'chats');assert.equal(f.api.globalSearch(),'old needle');f.api.showView('contacts');assert.equal(f.api.globalSearch(),'');
});
