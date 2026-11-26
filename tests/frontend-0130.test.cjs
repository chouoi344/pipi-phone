// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const app=read('app.js'),features=read('features.js');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function context(code,values={}){const scope=vm.createContext({console,Map,Set,JSON,Number,Math,Date,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,...values});vm.runInContext(code,scope);return scope;}
const image='data:image/png;base64,aGVsbG8=';

test('F1: repeated photo avatars share one short key and the source map stays bounded',()=>{
 const f=context(section(app,'  function avatarKey','  new MutationObserver')+section(app,'  function avatar(entity','  function toast'),{state:null,avatarKeys:new Map(),avatarSources:new Map(),avatarSequence:0,safeImage:s=>s?.startsWith('data:image/'),esc:escape,assetIcon:()=>'<i></i>'});
 const one=f.avatar({name:'照片好友',avatar:image});assert.match(one,/data-avatar-key="1"/);assert.ok(!one.includes(image));assert.equal(f.avatarKey(image),'1');
 for(let i=0;i<600;i++)f.avatarKey(image+i);assert.equal(f.avatarKeys.size,512);assert.equal(f.avatarSources.size,512);assert.ok(!f.avatarKeys.has(image));
 const key=f.avatarKey(image),node={nodeType:1,dataset:{avatarKey:key},matches:()=>true,hasAttribute:()=>false};f.paintAvatars(node);assert.equal(node.src,image);
});

test('F2: queued chat redraw preserves a nonempty draft, selection and focus; IME defers it',()=>{
 let draws=0,restores=0;const input={text:'未发出的草稿',scrollTop:17,isContentEditable:true,focus(){document.activeElement=this;}};
 const document={activeElement:input},view={querySelector:()=>input};
 const f=context(section(app,'  function flushRender','  function updateTyping'),{pendingRender:true,state:{},modalOpen:false,composeComposing:true,searchComposing:false,recordingSession:null,route:{name:'chat',arg:'a'},document,view,roleRoutes:new Set(['chat']),roleById:()=>({id:'a'}),captureChatLayout:()=>({top:20}),readComposerText:e=>e.text,readComposerSelection:()=>({start:2,end:5}),composerScroll:{},refresh:()=>{draws++;f.pendingRender=false;},restoreChatLayout:()=>restores++,syncVisibleChatRead(){},setComposerSelection:(node,start,end)=>{node.selection=[start,end];}});
 f.flushRender(true);assert.equal(draws,0);assert.equal(f.pendingRender,true);f.composeComposing=false;f.flushRender(true);assert.equal(draws,1);assert.equal(restores,1);assert.equal(f.composeText,'未发出的草稿');assert.equal(f.composerScroll.input,17);assert.deepEqual(input.selection,[2,5]);assert.equal(document.activeElement,input);
});

test('F4: JSON and binary network failures both show a Chinese error',async()=>{
 const code=section(app,'  async function api(path','  async function act(');
 const f=context(code,{authEpoch:1,csrf:'',window:{PipiNetwork:{request:async()=>{throw new TypeError('Failed to fetch');}}}});
 await assert.rejects(f.api('/api/test'),/网络连接失败，请检查网络后重试/);await assert.rejects(f.apiRaw('/api/test','bytes'),/网络连接失败，请检查网络后重试/);
});

test('F5: session drafts restore only existing friends and survive a disconnected login page',()=>{
 const saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const f=context(section(app,'  function persistChatDrafts','  async function restoreBrowserPage'),{state:{},drafts:new Map([['b',{text:'另一个好友',quote:'quote'}]]),route:{name:'chat',arg:'a'},composeText:'当前草稿',quoteId:'q1',chatDraftKey:'pipi.chat-drafts',sessionStorage:storage,roleById:id=>['a','b'].includes(id)});
 f.persistChatDrafts();f.state=null;f.persistChatDrafts();assert.ok(saved.get('pipi.chat-drafts'));f.state={};f.drafts.clear();f.composeText='';f.quoteId='';f.restoreChatDrafts();assert.equal(f.composeText,'当前草稿');assert.equal(f.quoteId,'q1');assert.equal(f.drafts.get('b').text,'另一个好友');
});

function sendFixture(api){const ready=section(app,'  function canSendComposerDraft(','  function syncComposerControls(');const f=context(ready+section(app,'  async function sendMessage(','  async function retryMessage('),{sending:false,imageVariants:false,composeImageMeta:null,composeComposing:false,recordingSession:null,composeText:'失败文字',composeImage:'',composeStickerId:'',quoteId:'',composerSelection:{start:0,end:0},panel:'',route:{name:'chat',arg:'a'},roleById:()=>({id:'a'}),quotedMessage:()=>null,failedSends:new Map(),drafts:new Map(),composerHistories:new Map(),chatScrolls:new Map(),window:{PipiEngine:{resetActivity(){}}},updateComposer(){},api,receiveState(){},toast(){},refresh(){},persistChatDrafts(){},rememberComposerEdit(){},syncComposerDraft(){},view:{querySelector:()=>null},document:{activeElement:null},uploadImageData:async image=>image});return f;}

test('F6: a lost response restores before newer input and retry reuses its request ID',async()=>{
 const calls=[];let reject;const f=sendFixture((route,body)=>{calls.push(body);return calls.length===1?new Promise((_,r)=>reject=r):Promise.resolve({state:{}});});
 const first=f.sendMessage();f.composeText='新输入';f.composerSelection={start:2,end:2};reject(new Error('断网'));await first;assert.equal(f.composeText,'失败文字\n新输入');
 f.composeText='失败文字';await f.sendMessage();assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(f.failedSends.size,0);
});

test('F6: failure while another chat is active restores only the original friend draft',async()=>{
 let reject;const f=sendFixture(()=>new Promise((_,r)=>reject=r));const pending=f.sendMessage();f.route={name:'chat',arg:'b'};f.composeText='小乙草稿';f.drafts.set('a',{text:'小甲新草稿'});reject(new Error('断网'));await pending;assert.equal(f.composeText,'小乙草稿');assert.equal(f.drafts.get('a').text,'失败文字\n小甲新草稿');
});

test('F7: tapping a sticker sends no draft text and preserves the draft image and quote',async()=>{
 let body;const f=sendFixture(async(_,next)=>{body=next;return {state:{}};});f.composeText='还没发送';f.composeImage=image;f.quoteId='draft-quote';await f.sendSticker({id:'s1',image});assert.equal(body.text,'');assert.equal(body.stickerId,'s1');assert.equal(f.composeText,'还没发送');assert.equal(f.composeImage,image);assert.equal(f.quoteId,'draft-quote');
});

test('F8: deleted, recalled and other-conversation quotes are rejected',()=>{
 const f=context(section(app,'  function quotedMessage','  function renderComposer'),{route:{arg:'a'},state:{messages:[{id:'ok',roleId:'a'},{id:'recalled',roleId:'a',meta:{kind:'recalled'}},{id:'other',roleId:'b'}]}});
 assert.equal(f.quotedMessage('ok').id,'ok');for(const id of ['gone','recalled','other'])assert.equal(f.quotedMessage(id),null);
});

test('F13: duplicate pictures consume no additional sticker slots',async()=>{
 let sent=0,message='';const state={stickers:Array.from({length:199},(_,i)=>({id:'s'+i,image:'img'+i}))};const files=[{name:'old.png',data:'img1'},{name:'new.png',data:'new'}];
 const route={name:'other'},epoch=1;
 const f=context(section(app,'  async function uploadStickers','  function paintSpeech'),{state,route,authEpoch:epoch,stickerUploadEpoch:-1,uploadImage:async file=>file.data,act:async(_,payload)=>{sent++;assert.equal(payload.images.length,2);state.stickers.push({id:'new',image:'new'});},toast:text=>message=text,refresh(){},updateComposer(){}});
 await f.uploadStickers(files,route,epoch);assert.equal(sent,1);assert.match(message,/已添加 1 个表情，1 个重复/);await f.uploadStickers([{name:'new2.png',data:'new2'}],route,epoch);assert.equal(sent,1);assert.match(message,/还能添加 0 张/);
});

function featureFixture(initial={}){let current={roles:[{id:'a',name:'小甲'}],profile:{name:'我'},ledger:[],favorites:[],wallet:{balanceCents:100,transactions:[]},...initial};let timer;
 const document={querySelector:()=>null,querySelectorAll:()=>[]};const P={getState:()=>current,esc:escape,icons:{},avatar:()=>'',api(){throw new Error('wallet watcher must not request the server');}};
 const exposed='window.__features={ui,syncMomentRole,renderLedger,walletBillRows,watchWallet,favoriteBody};';const code=features.slice(0,features.lastIndexOf('})();'))+exposed+features.slice(features.lastIndexOf('})();'));
 const scope=context(code,{window:{Pipi:P},document,setInterval:fn=>(timer=fn,1),clearInterval(){}});return {f:scope.window.__features,set:next=>current=next,get:()=>current,tick:()=>timer()};}

test('F16: deleting the selected moment friend restores the default viewpoint',()=>{const {f}=featureFixture();f.ui.momentRole='deleted';f.syncMomentRole();assert.equal(f.ui.momentRole,'all');});
test('F19: an obsolete custom ledger category resets to all',()=>{const {f}=featureFixture();f.ui.category='不再存在';const html=f.renderLedger();assert.equal(f.ui.category,'all');assert.match(html,/全部分类/);});
test('F20: wallet overlays repaint only changed local data, without a network call',()=>{const x=featureFixture();let painted=0;const root={isConnected:true,closest:()=>false};x.f.watchWallet(root,()=>x.get().wallet.balanceCents,()=>painted++);x.tick();assert.equal(painted,0);x.set({...x.get(),wallet:{balanceCents:200}});x.tick();assert.equal(painted,1);x.tick();assert.equal(painted,1);});
test('F21: pending and returned incoming payments have labels and no income color',()=>{const {f}=featureFixture({wallet:{transactions:[{id:'pending',direction:'in',status:'pending',createdAt:1,amountCents:100},{id:'returned',direction:'in',status:'returned',createdAt:2,amountCents:200},{id:'received',direction:'in',status:'received',createdAt:3,amountCents:300}]}});const html=f.walletBillRows();assert.match(html,/待领取/);assert.match(html,/已退还/);assert.equal((html.match(/class="income"/g)||[]).length,1);assert.equal((html.match(/color:var\(--muted\)/g)||[]).length,2);});
test('F22: a saved text-plus-photo message displays both content and its attachment',()=>{const {f}=featureFixture();const html=f.favoriteBody({type:'text',content:'照片说明',meta:{image}});assert.match(html,/照片说明/);assert.match(html,/favorite-image-button/);assert.ok(html.includes(image));});
test('F23: a reminder editor uses the configured interval for both default and minimum',()=>{
 const source=read('reminder-ui.js');let html;const sentinel=new Error('captured');const scope=context(section(source,'  function openEditor','  function bind(roleId)'),{P:()=>({getState:()=>({settings:{modules:{scheduler:{minIntervalHours:6}}}}),openModal:(_,body)=>{html=body;throw sentinel;}}),localParts:()=>({year:'2026',month:'11',day:'20',hour:'12',minute:'00'}),esc:escape,scheduleTypes:{once:'仅一次',interval:'固定间隔'},weekdays:['周日'],timezone:()=> 'Asia/Shanghai'});
 assert.throws(()=>scope.openEditor('a'),e=>e===sentinel);assert.match(html,/name="hours"[^>]+value="6"[^>]+min="6"/);
});

test('F20: a payment under an active child dialog waits until that dialog closes',()=>{const x=featureFixture();let blocked=true,painted=0;const root={isConnected:true,closest:()=>blocked};x.f.watchWallet(root,()=>x.get().wallet.balanceCents,()=>painted++);x.set({...x.get(),wallet:{balanceCents:200}});x.tick();assert.equal(painted,0);blocked=false;x.tick();assert.equal(painted,1);});

test('F23: a new installation without saved scheduler overrides keeps the one-hour default',()=>{
 const source=read('reminder-ui.js');let html;const sentinel=new Error('captured');const scope=context(section(source,'  function openEditor','  function bind(roleId)'),{P:()=>({getState:()=>({settings:{modules:{}}}),openModal:(_,body)=>{html=body;throw sentinel;}}),localParts:()=>({year:'2026',month:'11',day:'20',hour:'12',minute:'00'}),esc:escape,scheduleTypes:{once:'仅一次'},weekdays:['周日'],timezone:()=> 'Asia/Shanghai'});assert.throws(()=>scope.openEditor('a'),e=>e===sentinel);assert.match(html,/name="hours"[^>]+value="1"[^>]+min="1"/);
});
