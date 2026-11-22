// SPDX-License-Identifier: MIT
'use strict';
// Execute the shipped gesture handlers with a controlled clock; this does not
// claim to test native tap delivery, layout or browser selection behaviour.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function productFunction(name){
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert.ok(match,name);
  const rest=source.slice(match.index+match[0].length),end=/\n  (?:async )?function /.exec(rest);assert.ok(end,name+' boundary');
  return source.slice(match.index,match.index+match[0].length+end.index);
}
function fixture(messages=[]){
  let now=1000,sequence=0,refreshes=0,menus=0,payments=0;const jobs=new Map(),calls=[],requests=[],navigation=[],readers=[],toasts=[];
  const tokenList=()=>({tokens:new Set(),add(value){this.tokens.add(value);},contains(value){return this.tokens.has(value);}});
  const node=dataset=>({dataset,isConnected:true,classList:tokenList(),closest(){return null;}});
  const avatars=['self','contact'].map((target,i)=>{const el=node({chatAvatar:target}),row=node({message:'message-'+i});row.querySelector=()=>el;el.closest=()=>row;el.row=row;return el;});
  const bubbles=messages.map(m=>{const el=node({bubble:m.id});if(m.imageBubble)el.classList.add('image-bubble');return el;});
  const list={},reader=node({}),sheet=node({});
  const view={querySelector:selector=>selector==='#chat-messages'?list:null,querySelectorAll:selector=>({'[data-chat-avatar]':avatars,'[data-message]':avatars.map(el=>el.row),'[data-bubble]':bubbles}[selector]||[])};
  const scope=vm.createContext({view,overlay:{querySelector:selector=>selector==='.page-editor'?sheet:reader},document:{activeElement:null},Date:{now:()=>now},
    setTimeout(callback,delay){const id=++sequence;jobs.set(id,{at:now+delay,callback});return id;},clearTimeout:id=>jobs.delete(id),
    sendAction(type,payload){calls.push({type,payload:JSON.parse(JSON.stringify(payload))});return new Promise((resolve,reject)=>requests.push({resolve,reject}));},
    changeView(name,arg){navigation.push({name,arg});for(const el of avatars)el.isConnected=false;},countRefresh(){refreshes++;},countMenu(){menus++;},countPayment(){payments++;},
    captureReader(title,html){readers.push({title,html});},captureToast:text=>toasts.push(text)});
  vm.runInContext(`let imageVariants=false,composeImageMeta=null;let route={name:'chat',arg:'alice'},modalOpen=false,panel='',chatSelection=null,speechSession=null;const patRequests=new Set(),avatarTaps=new Map(),pressTimers=new Set(),state={messages:${JSON.stringify(messages)}};
    function bindComposer(){}function refresh(){countRefresh();}function showView(name,arg){route={name,arg};changeView(name,arg);}
    function act(type,payload){return sendAction(type,payload);}function toast(text){captureToast(text);}function messageMenu(){modalOpen=true;countMenu();}
    function safeImage(){return false;}function lightbox(){}function playAudio(){}function speakMessage(){}function changeComposerMode(){}
    function richText(text){return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    function openPage(title,html){modalOpen=true;captureReader(title,html);}function closeModal(){modalOpen=false;}
    const window={PipiFeatures:{walletTransaction(){countPayment();}}};
    ${['patChat','readTextMessage','cancelAvatarTaps','pressTimer','bindChatThumbnails','bindChat'].map(productFunction).join('\n')}
    bindChat();globalThis.api={patChat,bindChat,cancelAvatarTaps,route:()=>route,modal:()=>modalOpen,closeModal};`,scope);
  const advance=ms=>{now+=ms;for(const [id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.callback();}};
  const event=(extra={})=>({button:0,clientX:20,clientY:20,detail:1,preventDefault(){this.prevented=true;},...extra});
  const tap=(el,detail=1)=>{el.onpointerdown(event());advance(40);el.onpointerup(event());el.onclick(event({detail}));};
  const settle=async(index=0,error)=>{if(error)requests[index].reject(new Error(error));else requests[index].resolve({});await Promise.resolve();await Promise.resolve();await Promise.resolve();};
  return {scope,api:scope.api,avatars,bubbles,list,reader,sheet,calls,requests,navigation,readers,toasts,advance,event,tap,settle,get refreshes(){return refreshes;},get menus(){return menus;},get payments(){return payments;}};
}
for(const [index,name,arg]of [[0,'profile',undefined],[1,'role','alice']])test('avatar single tap opens '+name+' after the double-tap window',()=>{
  const f=fixture();f.tap(f.avatars[index]);f.advance(279);assert.deepEqual(f.navigation,[]);f.advance(1);assert.deepEqual(f.navigation,[{name,arg}]);assert.deepEqual(f.calls,[]);
});
for(const [index,target]of [[0,'self'],[1,'contact']])test('avatar double tap persists '+target+' once and never navigates',async()=>{
  const f=fixture(),el=f.avatars[index];f.tap(el);f.advance(100);f.tap(el,2);el.ondblclick(f.event({detail:2}));f.advance(1000);
  assert.deepEqual(f.calls,[{type:'message.pat',payload:{roleId:'alice',target}}]);assert.deepEqual(f.navigation,[]);await f.settle();assert.equal(f.refreshes,1);assert.ok(el.classList.contains('avatar-patting'));
});
test('triple tap and repeated double taps while a request is in flight cannot repeat the action',async()=>{
  const f=fixture(),el=f.avatars[1];f.tap(el);f.tap(el,2);f.tap(el,3);f.advance(700);f.tap(el);f.tap(el,2);assert.equal(f.calls.length,1);assert.deepEqual(f.navigation,[]);
  await f.settle();f.tap(el);f.tap(el,2);assert.equal(f.calls.length,2);await f.settle(1);
});
test('a failed pat exposes the error and releases the in-flight lock for retry',async()=>{
  const f=fixture(),el=f.avatars[1];f.tap(el);f.tap(el,2);await f.settle(0,'server rejected');assert.deepEqual(f.toasts,['server rejected']);assert.equal(f.refreshes,0);
  f.tap(el);f.tap(el,2);assert.equal(f.calls.length,2);await f.settle(1);
});
for(const gesture of ['hold','drag','cancel','contextmenu'])test('avatar '+gesture+' cannot pat or navigate',()=>{
  const f=fixture(),el=f.avatars[1];el.onpointerdown(f.event());
  if(gesture==='hold')f.advance(600);if(gesture==='drag')el.onpointermove(f.event({clientX:50}));if(gesture==='cancel')el.onpointercancel();if(gesture==='contextmenu')el.oncontextmenu(f.event());
  el.onpointerup(f.event());el.onclick(f.event());el.ondblclick(f.event({detail:2}));f.advance(1000);assert.deepEqual(f.calls,[]);assert.deepEqual(f.navigation,[]);
});
test('holding the second tap cancels a pending single navigation',()=>{
  const f=fixture(),el=f.avatars[0];f.tap(el);f.advance(100);el.onpointerdown(f.event());f.advance(600);el.onpointerup(f.event());el.onclick(f.event({detail:2}));f.advance(1000);assert.deepEqual(f.calls,[]);assert.deepEqual(f.navigation,[]);
});
test('keyboard activation opens avatar details immediately without patting',()=>{
  const f=fixture();f.avatars[0].onclick(f.event({detail:0}));assert.deepEqual(f.navigation,[{name:'profile',arg:undefined}]);assert.deepEqual(f.calls,[]);
});
test('an already focused composer does not block avatar details',()=>{
  const f=fixture();f.scope.document.activeElement={closest:()=>true};f.tap(f.avatars[1]);f.advance(280);assert.deepEqual(f.navigation,[{name:'role',arg:'alice'}]);
});
test('a pending avatar single tap survives a same-page refresh',()=>{
  const f=fixture(),old=f.avatars[1],next={...old,isConnected:true};next.row={...old.row};next.closest=()=>next.row;next.row.querySelector=()=>next;
  f.tap(old);old.isConnected=false;f.avatars[1]=next;f.api.bindChat();f.advance(280);assert.deepEqual(f.navigation,[{name:'role',arg:'alice'}]);
});
test('touch-style clicks with detail 1 can double tap across a refresh',async()=>{
  const f=fixture(),old=f.avatars[1],next={...old,isConnected:true};next.row={...old.row};next.closest=()=>next.row;next.row.querySelector=()=>next;
  f.tap(old);old.isConnected=false;f.avatars[1]=next;f.api.bindChat();f.advance(80);f.tap(next,1);f.advance(280);
  assert.equal(f.calls.length,1);assert.deepEqual(f.navigation,[]);await f.settle();
});
test('the same contact can be double tapped on different message avatars',async()=>{
  const f=fixture(),original=f.avatars[1],next={...original};next.row={...original.row,dataset:{message:'other'}};next.closest=()=>next.row;next.row.querySelector=()=>next;f.avatars.push(next);f.api.bindChat();
  f.tap(original);f.advance(80);f.tap(next);f.advance(280);assert.equal(f.calls.length,1);assert.deepEqual(f.navigation,[]);await f.settle();
});
test('switching avatar targets opens the last chosen target only',()=>{
  const f=fixture();f.tap(f.avatars[1]);f.advance(80);f.tap(f.avatars[0]);f.advance(280);assert.deepEqual(f.navigation,[{name:'profile',arg:undefined}]);assert.deepEqual(f.calls,[]);
});
test('a cancelled first click cannot be revived by browser click detail 2',()=>{
  const f=fixture();f.tap(f.avatars[1]);f.api.cancelAvatarTaps();f.advance(80);f.tap(f.avatars[1],2);assert.deepEqual(f.calls,[]);f.advance(280);assert.deepEqual(f.navigation,[{name:'role',arg:'alice'}]);
});
test('leaving chat before a pat resolves does not refresh the new page',async()=>{
  const f=fixture();const request=f.api.patChat('alice','contact');vm.runInContext("route={name:'contacts'}",f.scope);await f.settle();await request;assert.equal(f.refreshes,0);
});
for(const interrupt of ['modal','panel','selection','typing'])test('pending avatar navigation yields to '+interrupt,()=>{
  const f=fixture();f.tap(f.avatars[1]);
  if(interrupt==='modal')vm.runInContext('modalOpen=true;',f.scope);
  if(interrupt==='panel')vm.runInContext("panel='more';",f.scope);
  if(interrupt==='selection')vm.runInContext("chatSelection={roleId:'alice',ids:new Set(['text'])};",f.scope);
  if(interrupt==='typing')f.api.cancelAvatarTaps();
  f.advance(600);assert.deepEqual(f.navigation,[]);
});
test('selection mode keyboard toggles a bubble and blocks message menus and text reader',()=>{
  const f=fixture([{id:'text',type:'text',content:'hello'}]);const toggles=[];f.scope.captureToggle=id=>toggles.push(id);
  vm.runInContext("chatSelection={roleId:'alice',ids:new Set()};function toggleSelectedMessage(id){captureToggle(id);}",f.scope);
  for(const key of ['Enter',' '])f.bubbles[0].onkeydown(f.event({key}));
  for(const event of [{key:'ContextMenu'},{key:'F10',shiftKey:true}])f.bubbles[0].onkeydown(f.event(event));
  f.bubbles[0].ondblclick(f.event());assert.deepEqual(toggles,['text','text']);assert.equal(f.menus,0);assert.deepEqual(f.readers,[]);
});
test('text double click opens escaped large-text reader and tapping the text closes it',()=>{
  const f=fixture([{id:'text',type:'text',content:'<script>hello</script>'}]);f.bubbles[0].ondblclick(f.event());assert.equal(f.readers.length,1);assert.match(f.readers[0].html,/&lt;script&gt;hello/);assert.ok(f.sheet.classList.contains('text-reader-page'));assert.equal(f.api.modal(),true);f.reader.onclick();assert.equal(f.api.modal(),false);
});
for(const message of [{id:'image',type:'image'},{id:'voice',type:'voice'},{id:'transfer',type:'transfer'},{id:'redpacket',type:'redpacket'},{id:'attachment',type:'text',imageBubble:true}])test(message.id+' double click never opens a text reader',()=>{
  const f=fixture([{...message,content:'test'}]);f.bubbles[0].ondblclick(f.event());assert.deepEqual(f.readers,[]);
});
test('text long press and context menu keep their own interaction',()=>{
  const f=fixture([{id:'text',type:'text',content:'hello'}]),el=f.bubbles[0];el.onpointerdown(f.event());f.advance(500);el.onpointerup();el.onclick();el.ondblclick(f.event());assert.equal(f.menus,1);assert.deepEqual(f.readers,[]);
  f.api.closeModal();el.oncontextmenu(f.event());el.ondblclick(f.event());assert.equal(f.menus,2);assert.deepEqual(f.readers,[]);
});
test('dragging and cancelling payment cards cannot open a transaction',()=>{
  for(const gesture of ['drag','cancel']){const f=fixture([{id:'payment',type:'redpacket',content:'packet',meta:{transactionId:'tx'}}]),el=f.bubbles[0];el.onpointerdown(f.event());if(gesture==='drag')el.onpointermove(f.event({clientX:55}));else el.onpointercancel();el.onpointerup();el.onclick();assert.equal(f.payments,0);}
});

function searchFixture(){
  const messages=[
    {id:'photo',roleId:'alice',sender:'assistant',type:'image',content:'photo',createdAt:new Date(2026,10,12,14).getTime()},
    {id:'attached',roleId:'alice',sender:'user',type:'text',content:'holiday',meta:{image:'safe'},createdAt:new Date(2026,10,13,14).getTime()},
    {id:'transfer',roleId:'alice',sender:'user',type:'transfer',content:'holiday transfer',createdAt:new Date(2026,10,13,15).getTime()},
    {id:'packet',roleId:'alice',sender:'assistant',type:'redpacket',content:'packet',createdAt:new Date(2026,10,12,15).getTime()},
    {id:'other',roleId:'bob',sender:'user',type:'image',content:'holiday',createdAt:new Date(2026,10,13,14).getTime()},
  ];
  const scope=vm.createContext({messages});
  vm.runInContext(`const state={messages,profile:{name:'me'}},route={arg:'alice'},icons={search:''};let chatSearch='',chatSearchFilter='all',chatSearchDate='';
    function roleById(id){return {id,name:'Alice'};}function roleName(r){return r.name;}function header(){return '';}function avatar(){return '';}function esc(value){return String(value);}function richText(value){return value;}function preview(m){return m.content;}function shortTime(){return '';}function safeImage(value){return value==='safe';}
    ${productFunction('renderChatSearch')}
    globalThis.render=(term,filter,date)=>{chatSearch=term;chatSearchFilter=filter;chatSearchDate=date;return renderChatSearch();};`,scope);
  return (...values)=>[...scope.render(...values).matchAll(/data-search-message="([^"]+)"/g)].map(m=>m[1]);
}
test('chat search starts empty and keeps keywords inside the current conversation',()=>{
  const search=searchFixture();assert.deepEqual(search('','all',''),[]);assert.deepEqual(search('HOLIDAY','all',''),['attached','transfer']);
});
test('chat search image category includes attached photos and combines date with keywords',()=>{
  const search=searchFixture();assert.deepEqual(search('','image',''),['photo','attached']);assert.deepEqual(search('holiday','image','2026-11-13'),['attached']);assert.deepEqual(search('holiday','image','2026-11-12'),[]);
});
test('chat search payment category includes both transaction types and date alone returns the selected day',()=>{
  const search=searchFixture();assert.deepEqual(search('','payment',''),['transfer','packet']);assert.deepEqual(search('','payment','2026-11-12'),['packet']);assert.deepEqual(search('','all','2026-11-13'),['attached','transfer']);
});

test('global search includes older hidden-conversation text and preserves contact matching separately',()=>{
  const scope=vm.createContext({});vm.runInContext(`const state={profile:{name:'me'},roles:[{id:'alice',name:'Alice',hidden:true}],messages:[{id:'old',roleId:'alice',sender:'assistant',type:'text',content:'old needle',createdAt:1},{id:'latest',roleId:'alice',sender:'user',type:'text',content:'new message',createdAt:2}]};let globalSearchTerm='needle';
    const icons={search:''};function roleById(id){return state.roles.find(r=>r.id===id);}function roleName(r){return r.name;}function avatar(){return '';}function shortTime(){return '';}function richText(x){return x;}function esc(x){return String(x);}function preview(m){return m.content;}function header(){return '';}function iconButton(){return '';}function tabbar(){return '';}
    ${productFunction('renderGlobalSearch')}
    globalThis.render=renderGlobalSearch;`,scope);
  const html=scope.render();assert.match(html,/data-global-message="old"/);assert.doesNotMatch(html,/data-global-message="latest"/);assert.match(html,/联系人/);assert.match(html,/聊天记录/);assert.match(html,/cancel-global-search/);assert.doesNotMatch(html,/bottom-tabs|nav-title|new-menu/);
});

function readFixture(hidden=false,name='chat'){
  const calls=[],pending=[],toasts=[],document={hidden},scope=vm.createContext({document,calls,pending,toasts});
  vm.runInContext(`let state=null,route={name:${JSON.stringify(name)},arg:'alice'},modalOpen=false,childDialog=null,pendingRender=false,refreshes=0;const readRequests=new Set();function trackNewChatMessages(){}function roleById(id){return state?.roles.find(r=>r.id===id);}function refresh(){refreshes++;}
    function toast(text){toasts.push(text);}function act(type,payload){calls.push({type,...payload});return new Promise((resolve,reject)=>pending.push({resolve:()=>{state.roles.find(r=>r.id===payload.roleId).unread=0;resolve();},reject}));}
    let composeComposing=false,searchComposing=false,recordingSession=null;
    const view={querySelector:()=>null};function captureChatLayout(){}function restoreChatLayout(){}
    ${source.match(/^  const roleRoutes=.*$/m)[0]}
    ${productFunction('setState')}${productFunction('syncVisibleChatRead')}${productFunction('flushRender')}
    globalThis.api={setState,syncVisibleChatRead,state:()=>state,refreshes:()=>refreshes,pending:()=>pendingRender};`,scope);
  const deliver=()=>scope.api.setState({roles:[{id:'alice',unread:2},{id:'bob',unread:3}]});
  const settle=async(error)=>{if(error)pending.at(-1).reject(new Error(error));else pending.at(-1).resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();};
  return {scope,document,calls,pending,toasts,deliver,settle,api:scope.api};
}
test('new state marks only the visible current conversation read and deduplicates in-flight calls',async()=>{
  const f=readFixture();f.deliver();f.deliver();assert.equal(f.calls.length,1);assert.equal(f.calls[0].roleId,'alice');await f.settle();assert.equal(f.api.state().roles[0].unread,0);assert.equal(f.api.state().roles[1].unread,3);assert.deepEqual(f.toasts,[]);
});
test('hidden and non-chat pages keep unread counts; becoming visible can sync without re-rendering',async()=>{
  const f=readFixture(true);f.deliver();assert.equal(f.calls.length,0);f.document.hidden=false;f.api.syncVisibleChatRead();assert.equal(f.calls.length,1);await f.settle();
  const other=readFixture(false,'chats');other.deliver();assert.equal(other.calls.length,0);
});

test('an editor covering a conversation preserves unread until that conversation becomes visible',async()=>{
  const f=readFixture();vm.runInContext('modalOpen=true',f.scope);f.deliver();assert.equal(f.calls.length,0);assert.equal(f.api.state().roles[0].unread,2);
  vm.runInContext('modalOpen=false',f.scope);f.api.syncVisibleChatRead();assert.equal(f.calls.length,1);await f.settle();assert.equal(f.api.state().roles[0].unread,0);
});
test('failed read sync exposes the error, keeps unread counts and permits the next state update retry',async()=>{
  const f=readFixture();f.deliver();await f.settle('read failed');assert.deepEqual(f.toasts,['read failed']);assert.equal(f.api.state().roles[0].unread,2);f.deliver();assert.equal(f.calls.length,2);await f.settle();
});
test('a delayed read updates root badges after leaving chat without repainting an active editor',async()=>{
  const f=readFixture();f.deliver();vm.runInContext("route={name:'chats'}",f.scope);await f.settle();assert.equal(f.api.refreshes(),1);assert.deepEqual(f.toasts,[]);
  const editing=readFixture();editing.deliver();vm.runInContext("route={name:'chats'}",editing.scope);editing.document.activeElement={tagName:'INPUT'};await editing.settle();assert.equal(editing.api.refreshes(),0);assert.equal(editing.api.pending(),true);assert.deepEqual(editing.toasts,[]);
});
