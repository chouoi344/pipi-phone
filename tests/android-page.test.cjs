// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/android-page.js'),'utf8'),key='pipi.android-page.v1',scope='a'.repeat(64);
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.parentElement=null;this.properties=new Map();this.classes=new Set();this.scrollTop=0;this.scrollLeft=0;this.style={setProperty:(key,value)=>this.properties.set(key,value),removeProperty:key=>this.properties.delete(key)};this.classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value),contains:value=>this.classes.has(value)};}
  get isConnected(){return this.parentElement!==null;}
  setPointerCapture(id){this.pointerId=id;}
  hasPointerCapture(id){return this.pointerId===id;}
  releasePointerCapture(){delete this.pointerId;}
  addEventListener(type,handler){this['on'+type]=handler;}
  focus(){this.focused=true;}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  before(node){const parent=this.parentElement;node.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  querySelectorAll(){return [];}
  cloneNode(){const clone=new Element(this.tagName);clone.dataset={...this.dataset};clone.className=this.className;return clone;}
}
function fixture(options={}){
  const storage=options.storage||new Map(),events={},shell=new Element(),view=new Element(),messages=[],warnings=[];const listen=(name,fn)=>{const old=events[name];events[name]=old?()=>{old();fn();}:fn;};
  shell.append(view);view.dataset.route='chat';const document={documentElement:{dataset:{}},hidden:false,createElement:tag=>new Element(tag),getElementById:()=>view,querySelector:()=>shell,addEventListener:listen};
  const window={addEventListener:listen};
  let route={name:'chat',arg:'one'},ready=true,clears=0,backs=0,retries=0,canBack=true,covered=false,openAllowed=true;
  let checkpoint={route,stack:[{name:'chats'}],drafts:[{roleId:'one',text:'未发送草稿'}],chats:[{roleId:'one',name:'好友一',top:144,bottom:false,anchor:'old-message',offset:-12,limit:240,messages:[{id:'old-message',sender:'assistant',content:'已经读过的文字'}]}]};
  const timers=new Map();let sequence=0;
  const Clock=options.now?class extends Date {static now(){return options.now;}}:Date;
  const context={window,document,navigator:{userAgent:options.web?'Chrome/120':'Chrome/120 PipiPhoneAndroid/1.0'},location:{href:'http://isolated.test'},localStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key),setItem:(key,value)=>{if(options.full)throw Error('quota');storage.set(key,value);}},console:{warn(){},error(){}},setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},requestAnimationFrame:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),Intl,Date:Clock,Map,Set};
  vm.runInNewContext(source,context);const api=window.PipiAndroidPage;
  const adapter={ready:()=>ready,clear:()=>clears++,capture:()=>checkpoint,warn:message=>warnings.push(message),retry:()=>retries++,route:()=>route,
    visibleChat:roleId=>!covered&&route.name==='chat'&&route.arg===roleId,canBack:()=>canBack,back:()=>backs++,previous:()=>({name:'chats',arg:null}),previewTarget:()=>view,previewPage:()=>new Element(),
    openChat:roleId=>{if(!openAllowed)return false;messages.push(roleId);route={name:'chat',arg:roleId};return true;}};if(api)api.connect(adapter);else window.PipiChatNotice.connect(adapter);
  return {api,notices:window.PipiChatNotice,covered:value=>covered=value,openAllowed:value=>openAllowed=value,storage,document,view,shell,messages,warnings,events,get backs(){return backs;},get clears(){return clears;},get retries(){return retries;},
    route:value=>route=value,canBack:value=>canBack=value,setReady:value=>ready=value,setCheckpoint:value=>checkpoint=value,flush:()=>{const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());}};
}
const parsed=f=>JSON.parse(f.storage.get(key));
test('normal browser gets foreground notices without the Android interface or recovery storage listeners',()=>{const f=fixture({web:true});assert.equal(f.api,undefined);assert.ok(f.notices);assert.equal(f.document.documentElement.dataset.pipiAndroid,undefined);assert.deepEqual(Object.keys(f.events),['visibilitychange']);assert.equal(f.storage.size,0);});
test('cold restart restores whitelisted text and reading anchor once for the same session',()=>{
  const first=fixture();first.api.beginSession(scope);first.api.checkpoint();const second=fixture({storage:first.storage});second.api.beginSession(scope);
  const restored=second.api.restore();assert.equal(restored.drafts[0].text,'未发送草稿');assert.equal(restored.chats[0].anchor,'old-message');assert.equal(restored.chats[0].offset,-12);assert.equal(restored.chats[0].limit,240);assert.equal(second.api.restore(),null);
});
test('a warm reconnect never replaces the active page with a later checkpoint',()=>{
  const f=fixture();f.api.beginSession(scope);assert.equal(f.api.restore(),null);f.api.ready();f.api.checkpoint();f.api.beginSession(scope);assert.equal(f.api.restore(),null);
});
test('persistent input boundary strips secrets, attachments, object routes and limits growth',()=>{
  const f=fixture();f.api.beginSession(scope);f.setCheckpoint({route:{name:'providers',arg:{key:'secret'}},csrf:'secret',state:{models:['secret']},drafts:[{roleId:'one',text:'x'.repeat(25000),image:'secret',quote:'secret'}],chats:[{roleId:'one',name:'safe',messages:[{id:'safe',sender:'assistant',content:'safe',meta:{key:'secret'}}]}]});f.api.checkpoint();
  const value=parsed(f);assert.equal(value.route.name,'chats');assert.equal(value.drafts[0].text.length,20000);assert.equal(value.drafts[0].image,undefined);assert.equal(value.chats[0].messages[0].meta,undefined);assert.doesNotMatch(f.storage.get(key),/secret|csrf|models|image|quote/);
});
test('writing another draft never evicts earlier unsent drafts as ordinary cache',()=>{
  const f=fixture();f.api.beginSession(scope);f.setCheckpoint({drafts:[0,1,2,3,4].map(id=>({roleId:String(id),text:String(id).repeat(20000)}))});f.api.checkpoint();assert.equal(parsed(f).drafts.at(-1).roleId,'4');assert.equal(parsed(f).drafts.length,5);assert.equal(parsed(f).drafts.reduce((size,draft)=>size+draft.text.length,0),100000);
});
test('new session, logout and explicit change-server cleanup remove App recovery data',()=>{
  const f=fixture();f.api.beginSession(scope);f.api.checkpoint();f.api.beginSession('b'.repeat(64));assert.equal(f.api.restore(),null);assert.equal(f.storage.has(key),false);assert.equal(f.clears,1);
  f.api.checkpoint();assert.equal(parsed(f).scope,'b'.repeat(64));f.api.forgetDeviceCache();assert.equal(f.storage.has(key),false);assert.equal(f.clears,2);assert.equal(f.api.showOffline(),false);
});
test('expired reading cache drops history but preserves unsent drafts and storage failure reports once',()=>{
  const f=fixture();f.api.beginSession(scope);f.api.checkpoint();const cache=parsed(f);cache.at=Date.now()-8*86400000;f.storage.set(key,JSON.stringify(cache));const expired=fixture({storage:f.storage});assert.equal(expired.api.showOffline(),true);expired.api.beginSession(scope);const restored=expired.api.restore();assert.equal(restored.chats.length,0);assert.equal(restored.drafts[0].text,'未发送草稿');
  const full=fixture({full:true});full.api.beginSession(scope);full.api.checkpoint();full.api.checkpoint();assert.equal(full.warnings.length,1);
});
test('gesture start and cancel preserve the current page; commit uses the ordinary return action',()=>{
  const f=fixture();assert.equal(f.api.back('start',0,'left'),true);assert.equal(f.backs,0);assert.equal(f.api.back('progress',.4,'left'),true);assert.ok(Math.abs(parseFloat(f.view.properties.get('--android-back-shift'))-36.8)<.1);assert.equal(f.shell.children.length,2);
  f.api.back('cancel');assert.equal(f.backs,0);assert.equal(f.view.properties.has('--android-back-shift'),false);assert.equal(f.shell.children.length,1);
  f.api.back('start');f.api.back('commit');assert.equal(f.backs,1);f.canBack(false);assert.equal(f.api.back('commit'),false);assert.equal(f.backs,1);
});
test('native chat-open queues until login and current chat is handled by the existing opener',()=>{
  const f=fixture();f.setReady(false);assert.equal(f.api.openChat('two'),false);assert.deepEqual(f.messages,[]);f.api.clearSession();f.api.beginSession(scope);f.setReady(true);f.api.ready();assert.deepEqual(f.messages,['two']);assert.equal(f.api.openChat({id:'one'}),false);
});
test('offline chat edits a durable draft and never sends when the network returns',()=>{
  const first=fixture();first.api.beginSession(scope);first.api.checkpoint();const f=fixture({storage:first.storage});assert.equal(f.api.showOffline('offline'),true);assert.equal(f.view.dataset.route,'android-offline');assert.equal(f.api.openChat('one'),true);assert.deepEqual(f.messages,[]);
  const page=f.view.children[0],draft=page.children.find(node=>node.tagName==='TEXTAREA');assert.equal(draft.value,'未发送草稿');assert.notEqual(draft.readOnly,true);draft.value='断网继续写的新草稿';draft.oninput();
  const restarted=fixture({storage:f.storage});restarted.api.beginSession(scope);assert.equal(restarted.api.restore().drafts[0].text,'断网继续写的新草稿');assert.deepEqual(f.messages,[]);f.events.online();assert.equal(f.retries,1);assert.deepEqual(f.messages,[]);assert.equal(f.api.back('commit'),true);assert.equal(f.api.back('commit'),false);
});
test('cached contacts can start a local draft without previously opening their chat',()=>{
  const first=fixture();first.api.beginSession(scope);first.setCheckpoint({contacts:[{roleId:'two',name:'第二位好友',secret:'not-persisted'}],drafts:[],chats:[]});first.api.checkpoint();
  const f=fixture({storage:first.storage});assert.equal(f.api.showOffline(),true);assert.equal(f.api.openChat('two'),true);const draft=f.view.children[0].children.find(node=>node.tagName==='TEXTAREA');draft.value='给好友的草稿';draft.oninput();assert.equal(parsed(f).drafts[0].roleId,'two');assert.doesNotMatch(f.storage.get(key),/not-persisted/);assert.deepEqual(f.messages,[]);
});
test('foreground banner ignores the current friend, muted/blocked friends and background replay',()=>{
  const f=fixture(),roles=[{id:'one',name:'一',unread:1},{id:'two',name:'二',unread:1,muted:true},{id:'three',name:'三',unread:1,permissions:{blocked:true}},{id:'four',name:'四',unread:1}],base={messages:[],roles,settings:{}};
  const next={...base,messages:roles.map(role=>({id:role.id,roleId:role.id,sender:'assistant',status:'sent',createdAt:Date.now(),type:'text',content:'message'}))};f.api.observeState(base,next);let notice=f.shell.children.find(node=>node.className==='android-chat-notice');assert.equal(notice.dataset.roleId,'four');notice.onclick();assert.deepEqual(f.messages,['four']);
  f.api.observeState(next,next);assert.equal(f.shell.children.some(node=>node.className==='android-chat-notice'),false);f.document.hidden=true;f.api.observeState(base,next);assert.equal(f.shell.children.some(node=>node.className==='android-chat-notice'),false);
});
test('global quiet hours cover a midnight range and suppress the foreground banner',()=>{
  const f=fixture({now:Date.parse('2026-11-22T23:30:00Z')});f.route({name:'chats'});const start='22:00',end='07:00';
  const base={messages:[],roles:[{id:'one',name:'一',unread:1}],settings:{timezone:'UTC',modules:{outreach:{quietHoursEnabled:true,quietStart:start,quietEnd:end}}}},next={...base,messages:[{id:'new',roleId:'one',sender:'assistant',status:'sent',createdAt:Date.parse('2026-11-22T23:30:00Z'),type:'text',content:'message'}]};f.api.observeState(base,next);assert.equal(f.shell.children.length,1);
  next.settings.modules.outreach.quietHoursEnabled=false;next.messages[0]={...next.messages[0],id:'new-after-quiet'};f.api.observeState(base,next);assert.equal(f.shell.children.length,2);
});
test('swiping a banner consumes release activation and keeps incoming messages from replacing a held target',()=>{
  const f=fixture();f.route({name:'wallet'});const base={messages:[],roles:[{id:'one',name:'一',unread:1},{id:'two',name:'二',unread:1}],settings:{}};
  const next={...base,messages:[{id:'a',roleId:'one',sender:'assistant',status:'sent',createdAt:Date.now(),type:'text',content:'first'}]};f.api.observeState(base,next);const notice=f.shell.children.at(-1);
  const pointer=(type,x,y)=>({type,pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,preventDefault(){this.prevented=true;}});
  notice.onpointerdown(pointer('pointerdown',120,80));notice.onpointermove(pointer('pointermove',122,38));
  f.api.observeState(next,{...next,messages:[...next.messages,{id:'b',roleId:'two',sender:'assistant',status:'sent',createdAt:Date.now(),type:'text',content:'second'}]});assert.equal(f.shell.children.at(-1),notice);
  f.flush();assert.equal(notice.isConnected,true);
  const up=pointer('pointerup',122,38);notice.onpointerup(up);const click={detail:1,preventDefault(){this.prevented=true;},stopPropagation(){}};notice.onclick(click);
  assert.equal(click.prevented,true);assert.deepEqual(f.messages,[]);assert.equal(notice.isConnected,true);f.flush();assert.equal(notice.isConnected,false);
});
test('cancelled or short banner drags keep the banner and the next ordinary tap still opens its original friend',()=>{
  const f=fixture();f.route({name:'wallet'});const base={messages:[],roles:[{id:'one',name:'一',unread:1}],settings:{}},next={...base,messages:[{id:'a',roleId:'one',sender:'assistant',status:'sent',createdAt:Date.now(),type:'text',content:'first'}]};f.api.observeState(base,next);const notice=f.shell.children.at(-1);
  const event=(type,y)=>({type,pointerId:1,isPrimary:true,button:0,clientX:100,clientY:y,preventDefault(){}});
  notice.onpointerdown(event('pointerdown',100));notice.onpointermove(event('pointermove',80));notice.onpointercancel(event('pointercancel',80));notice.onclick({detail:1,preventDefault(){},stopPropagation(){}});assert.equal(notice.isConnected,true);assert.deepEqual(f.messages,[]);
  notice.onpointerdown(event('pointerdown',100));notice.onpointerup(event('pointerup',100));notice.onclick({detail:1});assert.deepEqual(f.messages,['one']);
});
test('a detached held banner cannot suppress later banners and Escape restores the previous focus',()=>{
  const f=fixture();f.route({name:'wallet'});f.document.activeElement=f.view;const base={messages:[],roles:[{id:'one',name:'一',unread:1},{id:'two',name:'二',unread:1}],settings:{}},next={...base,messages:[{id:'a',roleId:'one',sender:'assistant',status:'sent',createdAt:Date.now(),type:'text',content:'first'}]};f.api.observeState(base,next);const first=f.shell.children.at(-1);
  first.onpointerdown({type:'pointerdown',pointerId:1,isPrimary:true,button:0,clientX:100,clientY:70});f.document.hidden=true;f.events.visibilitychange();assert.equal(first.isConnected,false);
  f.document.hidden=false;f.api.observeState(next,{...next,messages:[...next.messages,{id:'b',roleId:'two',sender:'assistant',status:'sent',createdAt:Date.now(),type:'text',content:'second'}]});const second=f.shell.children.at(-1);assert.notEqual(second,first);assert.equal(second.dataset.roleId,'two');
  f.document.activeElement=second;second.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(second.isConnected,false);assert.equal(f.view.focused,true);assert.deepEqual(f.messages,[]);
});

test('web notices ignore initial history, imports, self messages and undelivered assistant messages',()=>{
  const at=Date.parse('2026-11-22T12:00:00Z'),f=fixture({web:true,now:at});f.route({name:'chats'});
  const incoming=(id,extra={})=>({id,roleId:'one',sender:'assistant',status:'sent',type:'text',content:id,createdAt:at+1,...extra});
  const base={messages:[incoming('initial')],roles:[{id:'one',name:'好友一',unread:1}],settings:{}};
  f.notices.observeState(null,base);assert.equal(f.shell.children.length,1);
  const next={...base,messages:[...base.messages,incoming('old-import',{createdAt:at-1}),incoming('self',{sender:'user'}),incoming('pending',{status:'pending'}),incoming('error',{status:'error'}),incoming('recall',{sender:'system',meta:{kind:'recalled'}})]};
  f.notices.observeState(base,next);assert.equal(f.shell.children.length,1);
  const delivered={...next,messages:[...next.messages,incoming('real-inbound')]};f.notices.observeState(next,delivered);
  assert.equal(f.shell.children.at(-1).children[1].textContent,'real-inbound');
  f.notices.dismiss();f.notices.observeState(delivered,{...delivered,messages:[]});f.notices.observeState({...delivered,messages:[]},delivered);
  assert.equal(f.shell.children.length,1,'reinserted IDs cannot replay an already observed notification');
});

test('a web conversation behind an editor stays eligible and a blocked click keeps its notice',()=>{
  const at=Date.parse('2026-11-22T12:00:00Z'),f=fixture({web:true,now:at});f.covered(true);f.openAllowed(false);
  const base={messages:[],roles:[{id:'one',name:'好友一',unread:1}],settings:{}},next={...base,messages:[{id:'new',roleId:'one',sender:'assistant',status:'sent',type:'text',content:'编辑时的新消息',createdAt:at+1}]};
  f.notices.observeState(base,next);const notice=f.shell.children.at(-1);assert.equal(notice.dataset.roleId,'one');
  notice.onclick({detail:1});assert.equal(notice.isConnected,true);assert.deepEqual(f.messages,[]);
  f.openAllowed(true);notice.onclick({detail:1});assert.equal(notice.isConnected,false);assert.deepEqual(f.messages,['one']);
});

test('web notices include friend pats and media, and respect unread, deleted and quiet states',()=>{
  const at=Date.parse('2026-11-22T12:00:00Z'),f=fixture({web:true,now:at});f.route({name:'chats'});
  let previous={messages:[],roles:[{id:'one',name:'好友一',unread:1}],settings:{}};
  for(const [id,type,sender,meta,label]of [['photo','image','assistant',{},'[图片]'],['voice','voice','assistant',{},'[语音]'],['transfer','transfer','assistant',{},'[转账]'],['gift','redpacket','assistant',{},'[红包]'],['pat','text','system',{kind:'pat',author:'one'},'好友拍了拍我']]){
    const next={...previous,messages:[...previous.messages,{id,roleId:'one',sender,status:'sent',type,meta,content:'好友拍了拍我',createdAt:at+1}]};
    f.notices.observeState(previous,next);assert.equal(f.shell.children.at(-1).children[1].textContent,label);f.notices.dismiss();previous=next;
  }
  for(const role of [{id:'one',name:'一',unread:0},{id:'one',name:'一',unread:1,deleted:true},{id:'one',name:'一',unread:1,muted:true},{id:'one',name:'一',unread:1,permissions:{blocked:true}}]){
    const next={...previous,roles:[role],messages:[...previous.messages,{id:JSON.stringify(role),roleId:'one',sender:'assistant',status:'sent',type:'text',content:'应静默',createdAt:at+1}]};
    f.notices.observeState(previous,next);assert.equal(f.shell.children.length,1);previous=next;
  }
});

test('web hidden delivery is remembered and newly muting a friend removes a visible notice',()=>{
  const at=Date.parse('2026-11-22T12:00:00Z'),f=fixture({web:true,now:at});f.route({name:'chats'});
  const base={messages:[],roles:[{id:'one',name:'好友一',unread:1}],settings:{}},next={...base,messages:[{id:'hidden',roleId:'one',sender:'assistant',status:'sent',type:'text',content:'后台消息',createdAt:at+1}]};
  f.document.hidden=true;f.notices.observeState(base,next);assert.equal(f.shell.children.length,1);
  f.document.hidden=false;f.notices.observeState(base,next);assert.equal(f.shell.children.length,1);
  const shown={...next,messages:[...next.messages,{...next.messages[0],id:'foreground'}]};f.notices.observeState(next,shown);assert.equal(f.shell.children.length,2);
  f.notices.observeState(shown,{...shown,roles:[{...shown.roles[0],muted:true}]});assert.equal(f.shell.children.length,1);
});

test('web delivery uses the server baseline even when the device clock is a day fast',()=>{
  const serverAt=Date.parse('2026-11-22T12:00:00Z'),f=fixture({web:true,now:serverAt+86400000});f.route({name:'chats'});
  const base={messages:[{id:'old',roleId:'one',sender:'assistant',status:'sent',type:'text',content:'历史消息',createdAt:serverAt}],roles:[{id:'one',name:'好友一',unread:1}],settings:{}};
  f.notices.observeState(null,base);const next={...base,messages:[...base.messages,{...base.messages[0],id:'new',content:'真正新消息',createdAt:serverAt+1}]};f.notices.observeState(base,next);
  assert.equal(f.shell.children.at(-1).children[1].textContent,'真正新消息');
});

test('rebasing after backup restore suppresses imported rows and accepts the next live message',()=>{
  const f=fixture({web:true});f.route({name:'chats'});
  const base={messages:[],roles:[{id:'one',name:'好友一',unread:1}],settings:{}},restored={...base,messages:[{id:'imported',roleId:'one',sender:'assistant',status:'sent',type:'text',content:'备份旧消息',createdAt:123}]};
  f.notices.observeState(null,base);f.notices.rebase(restored);f.notices.observeState(base,restored);assert.equal(f.shell.children.length,1);
  f.notices.observeState(restored,{...restored,messages:[...restored.messages,{...restored.messages[0],id:'live',content:'恢复后的新消息',createdAt:124}]});assert.equal(f.shell.children.at(-1).children[1].textContent,'恢复后的新消息');
});
