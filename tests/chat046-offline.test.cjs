// SPDX-License-Identifier: MIT
'use strict';
// Execute the shipped UI functions with isolated state. Browser layout, native
// gestures, audio playback and downloads are verified separately in the UI.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const engineSource=fs.readFileSync(path.join(__dirname,'../public/engine-ui.js'),'utf8');
function productFunction(name){
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert.ok(match,name);
  const rest=source.slice(match.index+match[0].length),end=/\n  (?:async )?function /.exec(rest);assert.ok(end,name+' boundary');
  return source.slice(match.index,match.index+match[0].length+end.index);
}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const image='data:image/png;base64,aGVsbG8=';
test('late older HTTP state cannot undo a newer deletion, recall or permission update',()=>{
  const scope=vm.createContext({});vm.runInContext(`let state=null,reads=0;function trackNewChatMessages(){}function syncVisibleChatRead(){reads++;}${productFunction('setState')}globalThis.ui={setState,state:()=>state,reads:()=>reads};`,scope);
  scope.ui.setState({revision:10,messages:[],roles:[{id:'alice',permissions:{blocked:true}}]});
  scope.ui.setState({revision:9,messages:[{id:'recalled',content:'旧文字'}],roles:[{id:'alice',permissions:{blocked:false}}]});
  assert.equal(scope.ui.state().revision,10);assert.deepEqual(Array.from(scope.ui.state().messages),[]);assert.equal(scope.ui.state().roles[0].permissions.blocked,true);assert.equal(scope.ui.reads(),1);
  scope.ui.setState({revision:11,messages:[],roles:[]});assert.equal(scope.ui.state().revision,11);assert.equal(scope.ui.reads(),2);
});
function quoteFixture(messages=[]){
  const scope=vm.createContext({messages,escape});vm.runInContext(`const state={messages,profile:{name:'我'}};function esc(value){return escape(value);}function richText(value){return esc(value);}function roleName(r){return r.name||'联系人';}function safeImage(src){return typeof src==='string'&&/^data:image\\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(src);}${productFunction('renderMessageQuote')}globalThis.render=quote=>renderMessageQuote(quote,{name:'朋友'});`,scope);return scope.render;
}
test('image quote retains a safe thumbnail and sender snapshot and locates the original',()=>{
  const html=quoteFixture([{id:'original',type:'image'}])({messageId:'original',type:'image',content:'[图片]',image,senderName:'原发送人'});
  assert.match(html,/data-quote-message="original"/);assert.match(html,/class="quote-image"/);assert.match(html,/原发送人：/);assert.ok(html.includes(image));assert.doesNotMatch(html,/ disabled/);
});
test('quote snapshots preserve text and image after original deletion or recall',()=>{
  for(const messages of [[],[{id:'gone',meta:{kind:'recalled'}}]]){
    const html=quoteFixture(messages)({messageId:'gone',type:'text',content:'<private> https://example.test/a',image,senderName:'Old Name'});
    assert.match(html,/ disabled/);assert.match(html,/data-quote-message=""/);assert.match(html,/&lt;private&gt;/);assert.match(html,/Old Name/);assert.ok(html.includes(image));
  }
});
test('quote rejects unsafe image URLs and escapes both sender and quoted content',()=>{
  const html=quoteFixture()({type:'text',content:'<script>x</script>',image:'javascript:alert(1)',senderName:'<img onerror=x>'});
  assert.doesNotMatch(html,/<img|<script|javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img onerror=x&gt;/);
});
test('detached quotes show confirmed deletion or recall while old snapshots remain neutral',()=>{
  const render=quoteFixture();for(const [unavailable,label]of [['deleted','原消息已删除'],['recalled','原消息已撤回']]){const html=render({type:'image',content:'[图片]',image,senderName:'朋友',unavailable});assert.match(html,new RegExp('class="quote-unavailable-note">'+label));assert.ok(html.includes(image));assert.match(html,/ disabled/);}
  const old=render({type:'text',content:'旧快照',senderName:'朋友'});assert.doesNotMatch(old,/原消息已删除|原消息已撤回/);assert.match(old,/引用快照/);
});
function transcriptFixture({transcript='',keySet=true,response,error}={}){
  const calls=[],notices=[],pending=[],scope=vm.createContext({calls,notices,pending,response,error,escape});
  vm.runInContext(`let state={messages:[{id:'voice',roleId:'alice',type:'voice',meta:{audio:'stored',transcript:${JSON.stringify(transcript)}}}],settings:{ai:{sources:[{id:'source',baseUrl:'https://voice.example.test',keySet:${keySet}}],models:[{id:'speech',model:'sample-asr',sourceId:'source',kind:'stt'}],assign:{stt:'speech',voiceUnderstanding:'speech'}}}},route={name:'chat',arg:'alice'};const window={Pipi:{getState:()=>state}};${engineSource}const transcriptViews=new Map();let refreshes=0;function afterOverlayBack(){return Promise.resolve();}function paintTranscript(){refreshes++;}function setState(next){state=next;}function api(url,body){calls.push({url,body});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}function esc(x){return escape(x);}${productFunction('transcribeMessage')}${productFunction('renderVoiceTranscript')}globalThis.ui={run:(expanded=true)=>transcribeMessage('voice',expanded),render:()=>renderVoiceTranscript(state.messages[0]),entry:()=>transcriptViews.get('voice'),refreshes:()=>refreshes};`,scope);
  return {scope,ui:scope.ui,calls,pending};
}
test('already stored voice text expands immediately without a transcription request',async()=>{
  const f=transcriptFixture({transcript:'已保存的转写'});assert.equal(f.ui.render(),'');await f.ui.run();assert.deepEqual(f.calls,[]);assert.match(f.ui.render(),/已保存的转写/);assert.doesNotMatch(f.ui.render(),/收起文字|展开文字/);await f.ui.run(false);assert.equal(f.ui.render(),'');
});
test('missing voice-understanding configuration is explicit and makes no model request',async()=>{
  const f=transcriptFixture({keySet:false});await f.ui.run();assert.deepEqual(f.calls,[]);assert.match(f.ui.render(),/选择语音条理解模型/);assert.match(f.ui.render(),/重试/);
});
test('voice conversion exposes progress, deduplicates clicks and labels demo results',async()=>{
  const f=transcriptFixture();const request=f.ui.run();await Promise.resolve();assert.match(f.ui.render(),/正在识别/);await f.ui.run();assert.equal(f.calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{url:'/api/voice/transcribe',body:{messageId:'voice'}});
  f.pending[0].resolve({demo:true,state:{messages:[{id:'voice',roleId:'alice',type:'voice',meta:{transcript:'固定预设',transcriptSource:'demo'}}]}});await request;assert.match(f.ui.render(),/固定预设/);assert.match(f.ui.render(),/演示预设文字，非真实识别结果/);
});
test('conversion errors remain visible and the retry sends a new request',async()=>{
  const f=transcriptFixture();const request=f.ui.run();await Promise.resolve();f.pending[0].reject(new Error('服务暂不可用'));await request;assert.match(f.ui.render(),/服务暂不可用/);assert.match(f.ui.render(),/重试/);
  const retry=f.ui.run();await Promise.resolve();assert.equal(f.calls.length,2);f.pending[1].reject(new Error('仍不可用'));await retry;assert.match(f.ui.render(),/仍不可用/);
});
test('opening a just-sent voice waits for chat recognition without another request',async()=>{
  const f=transcriptFixture();
  vm.runInContext("Object.assign(state.messages[0],{sender:'user',status:'pending'});",f.scope);
  await f.ui.run();assert.match(f.ui.render(),/正在识别/);assert.equal(f.calls.length,0);
  vm.runInContext("Object.assign(state.messages[0].meta,{transcript:'已由聊天识别'});",f.scope);
  assert.match(f.ui.render(),/已由聊天识别/);await f.ui.run(false);assert.equal(f.ui.render(),'');
});
test('a collapsed transcript stays hidden when an earlier recognition finishes',async()=>{
  const f=transcriptFixture();const request=f.ui.run();await Promise.resolve();await f.ui.run(false);assert.equal(f.ui.render(),'');
  f.pending[0].resolve({state:{messages:[{id:'voice',roleId:'alice',type:'voice',meta:{transcript:'只在展开后显示'}}]}});await request;assert.equal(f.ui.render(),'');await f.ui.run();assert.match(f.ui.render(),/只在展开后显示/);assert.equal(f.calls.length,1);
});
function rangeFixture(messages,anchor='b',selected=['b']){
  const notices=[],scope=vm.createContext({messages,notices});vm.runInContext(`const state={messages};let chatSelection={roleId:'alice',anchorId:${JSON.stringify(anchor)},ids:new Set(${JSON.stringify(selected)})};let refreshes=0;function toast(text){notices.push(text);}function refresh(){refreshes++;}${productFunction('selectMessageRange')}globalThis.ui={select:selectMessageRange,ids:()=>[...chatSelection.ids],refreshes:()=>refreshes};`,scope);return {ui:scope.ui,notices};
}
test('range selection works forward and backward and excludes other conversations and system notices',()=>{
  const messages=[{id:'a',roleId:'alice',sender:'user'},{id:'system',roleId:'alice',sender:'system'},{id:'b',roleId:'alice',sender:'assistant'},{id:'other',roleId:'bob',sender:'user'},{id:'c',roleId:'alice',sender:'user'}];
  const f=rangeFixture(messages);f.ui.select('c');assert.deepEqual(Array.from(f.ui.ids()),['b','c']);f.ui.select('a');assert.deepEqual(Array.from(f.ui.ids()),['b','c','a']);assert.equal(f.ui.refreshes(),2);
});
test('range overflow rejects the whole extension and retains the previous selection',()=>{
  const messages=Array.from({length:101},(_,i)=>({id:'m'+i,roleId:'alice',sender:'user'})),f=rangeFixture(messages,'m0',['m0']);f.ui.select('m100');assert.deepEqual(Array.from(f.ui.ids()),['m0']);assert.equal(f.ui.refreshes(),0);assert.match(f.notices[0],/100/);
});
function menuLabels(message,{expanded=false,playing=false}={}){
  const anchor={getBoundingClientRect:()=>({left:0,top:200,bottom:250,width:100})},menu={style:{setProperty(){}},dataset:{},scrollHeight:40,clientHeight:40,getBoundingClientRect:()=>({height:40}),querySelector:()=>({focus(){}})},button={};
  const scope=vm.createContext({message,anchor,menu,button,expanded,playing});vm.runInContext(`const transcriptViews=new Map([[message.id,{expanded}]]),speechSession=playing?{id:message.id,voice:true}:null;const state={messages:[message]},icons={},route={name:'chat'},overlay={innerHTML:'',querySelector:selector=>selector==='.bubble-menu'?menu:button,querySelectorAll:()=>[]},document={querySelector:()=>({getBoundingClientRect:()=>({width:390,height:844,left:0,top:0})})};let modalReturnFocus=null,modalOpen=false,pressActive=false;const bubbleMenuIcons={};function esc(v){return String(v);}function trackModalHistory(){}function measureSafeInsets(){return {top:47,bottom:34,left:0,right:0};}function closeModal(){}${productFunction('messageMenu')}messageMenu(message.id,anchor);globalThis.html=overlay.innerHTML;`,scope);return [...scope.html.matchAll(/data-bubble-action="\d+"><svg[^>]*><\/svg><span>([^<]+)</g)].map(match=>match[1]);
}
test('voice and payment menus never copy internal audio or transaction values',()=>{
  const now=Date.now();for(const type of ['voice','transfer','redpacket']){const labels=menuLabels({id:type,type,sender:'user',status:'sent',createdAt:now,content:'internal-value',meta:{audio:'stored'}});assert.ok(!labels.includes('复制'));if(type==='voice'){assert.ok(labels.includes('转文字'));assert.ok(labels.includes('收藏'));}else{assert.ok(!labels.includes('收藏'));assert.ok(!labels.includes('转发'));}}
});
test('voice menu keeps existing actions beside playback and transcript controls',()=>{
  const message={id:'voice',type:'voice',sender:'user',status:'sent',createdAt:Date.now(),meta:{audio:'stored',transcript:'已保存'}};
  const labels=menuLabels(message);assert.deepEqual(labels.slice(0,2),['播放语音','转文字']);
  assert.deepEqual(menuLabels(message,{playing:true,expanded:true}).slice(0,2),['停止播放','收起文字']);
  for(const existing of ['转发','收藏','删除','多选','引用','撤回'])assert.ok(labels.includes(existing),existing);
});
test('recall is offered only for recent owned messages and explicitly owned pats',()=>{
  const now=Date.now();for(const type of ['text','image','voice','forward'])assert.ok(menuLabels({id:type,type,sender:'user',status:'sent',createdAt:now,meta:{}}).includes('撤回'));
  for(const message of [{sender:'assistant',type:'text'},{sender:'user',type:'text',createdAt:now-121000},{sender:'system',type:'text',meta:{kind:'pat'}},{sender:'user',type:'text',status:'error'}])assert.ok(!menuLabels({id:'m',status:'sent',createdAt:now,...message}).includes('撤回'));
  assert.ok(menuLabels({id:'pat',sender:'system',type:'text',createdAt:now,meta:{kind:'pat',author:'me'}}).includes('撤回'));
});
test('all shared icon URLs generated by the app exist as local SVG assets',()=>{
  const scope=vm.createContext({document:{body:{dataset:{}}},history:{state:null}});const begin=source.indexOf('  const iconVersion'),end=source.indexOf('  let state');vm.runInContext(source.slice(begin,end)+'globalThis.iconMarkup=Object.values(icons).join("");',scope);
  const urls=[...scope.iconMarkup.matchAll(/(?:src="|url\(')(\/[^"')]+)/g)].map(match=>match[1].split('?')[0]);assert.ok(urls.length>55);
  for(const url of urls){const file=path.join(__dirname,'../public',url);assert.ok(fs.existsSync(file),url);if(url.endsWith('.svg')){const svg=fs.readFileSync(file,'utf8');assert.match(svg,/<svg\b/,url);assert.doesNotMatch(svg,/<script\b|\bonload=/i,url);}}
});
function galleryFixture(options){
  const elements=new Map(),events=new Map(),tracks=[],mounted=[],downloads=[],blobs=[],revoked=[],timers=[],links=[],node=()=>({style:{},focus(){this.focused=true;},setAttribute(name,value){this[name]=value;}}),stage=node();
  let img;
  const imageNode=()=>({...node(),complete:true,naturalWidth:1,replaceWith(next){img=next;}});
  img=imageNode();stage.append=()=>{};
  const stageClasses=new Set();
  stage.querySelector=selector=>selector==='img'?img:null;stage.classList={toggle:(name,enabled)=>enabled?stageClasses.add(name):stageClasses.delete(name),contains:name=>stageClasses.has(name),remove:name=>stageClasses.delete(name)};stage.addEventListener=(name,callback)=>events.set(name,callback);stage.setPointerCapture=()=>{};
  stage.matches=selector=>selector.split(',').some(name=>stageClasses.has(name.slice(1)));
  elements.set('.image-stage',stage);for(const selector of ['[data-image-reset]','.image-save','.image-counter','[data-image-prev]','[data-image-next]','[data-image-in]','[data-image-out]','.lightbox-close','.image-actions','.image-more','[data-image-forward]','[data-image-favorite]','[data-image-menu-cancel]'])elements.set(selector,node());
  elements.get('.image-actions').querySelector=()=>['[data-image-forward]','[data-image-favorite]','.image-save'].map(selector=>elements.get(selector)).find(el=>!el.hidden);
  const box={isConnected:true,querySelector:selector=>elements.get(selector),querySelectorAll:()=>[]},scope=vm.createContext({box,options,tracks,mounted,escape,downloads,blobs,revoked,timers,links,Blob,atob,node,imageNode});
  vm.runInContext(`const overlay={innerHTML:'',querySelector:()=>box},state={messages:options.messages||[]},document={activeElement:{},body:{append(link){link.attached=true;}},createElement(tag){if(tag==="img")return imageNode();if(tag==="span")return node();const link={tag,click(){downloads.push({href:this.href,download:this.download});},remove(){this.removed=true;}};links.push(link);return link;}},URL={createObjectURL(blob){blobs.push(blob);return 'blob:test-'+blobs.length;},revokeObjectURL(url){revoked.push(url);}},icons={close:'',more:''};function setTimeout(callback,delay){timers.push({callback,delay});}let modalCloseCallback=null,modalReturnFocus=null,modalOpen=false;function esc(x){return escape(x);}function safeImage(x){return typeof x==='string'&&/^data:image\\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(x);}function captureModalParent(){return null;}function mountModalParent(parent){mounted.push(parent);}function trackModalHistory(nested){tracks.push(nested);}function closeModal(){}${productFunction('lightbox')}lightbox(options.src,'测试图片',options);`,scope);
  return {box,stage,get img(){return img;},elements,events,tracks,downloads,blobs,revoked,timers,links};
}
test('image gallery saves the exact repeated image through a temporary Blob URL and releases it',async()=>{
  const second='data:image/jpeg;base64,b3RoZXI=',f=galleryFixture({src:image,images:[image,second,image],index:2});
  assert.equal(f.elements.get('.image-counter').textContent,'3 / 3');assert.equal(f.elements.get('[data-image-next]').disabled,true);assert.equal(f.blobs.length,0);
  f.elements.get('.image-save').onclick();assert.equal(f.downloads[0].href,'blob:test-1');assert.equal(f.downloads[0].download,'pipi-image-3.png');assert.equal(f.blobs[0].type,'image/png');assert.equal(await f.blobs[0].text(),'hello');assert.equal(f.links[0].attached,true);assert.equal(f.links[0].removed,true);assert.equal(f.revoked.length,0);assert.equal(f.timers[0].delay,1000);f.timers[0].callback();assert.deepEqual(f.revoked,['blob:test-1']);
  f.elements.get('[data-image-prev]').onclick();assert.equal(f.img.src,second);assert.equal(f.blobs.length,1);f.elements.get('.image-save').onclick();assert.equal(f.downloads[1].download,'pipi-image-2.jpg');assert.equal(f.blobs[1].type,'image/jpeg');assert.equal(await f.blobs[1].text(),'other');f.timers[1].callback();assert.deepEqual(f.revoked,['blob:test-1','blob:test-2']);
});
test('gallery zoom, reset, keyboard navigation and swipe operate on the visible image',()=>{
  const second='data:image/jpeg;base64,b3RoZXI=',f=galleryFixture({src:image,images:[image,second]});
  f.elements.get('[data-image-in]').onclick();assert.match(f.img.style.transform,/scale\(1.5\)/);f.elements.get('[data-image-reset]').onclick();assert.match(f.img.style.transform,/scale\(1\)/);
  f.stage.onpointerdown({button:0,pointerId:1,clientX:200,clientY:100});f.stage.onpointerup({pointerId:1,clientX:100,clientY:100});assert.equal(f.img.src,second);
  f.box.onkeydown({key:'ArrowLeft',preventDefault(){}});assert.equal(f.img.src,image);f.stage.ondblclick();assert.match(f.img.style.transform,/scale\(2\)/);f.stage.ondblclick();assert.match(f.img.style.transform,/scale\(1\)/);
});
test('merged voice snapshots retain the explicit demo label after forwarding',()=>{
  const captures=[],scope=vm.createContext({captures,escape});vm.runInContext(`const root={querySelectorAll:()=>[]},overlay={querySelector:()=>root},icons={voiceWave:''},state={messages:[]},forwardDetails=new Map();function esc(x){return escape(x);}function richText(x){return esc(x);}function safeImage(){return false;}function openNestedPage(title,html){captures.push(html);}${productFunction('forwardEntries')}${productFunction('renderForwardEntries')}${productFunction('bindForwardDetails')}${productFunction('openForwardDetails')}globalThis.render=source=>openForwardDetails({meta:{entries:[{type:'voice',senderName:'朋友',content:'',meta:{transcript:'固定预设',transcriptSource:source}}]}});`,scope);
  scope.render('demo');assert.match(captures[0],/演示预设文字，非真实识别结果/);scope.render('provider');assert.doesNotMatch(captures[1],/演示预设/);
});
test('nested page Back restores the same parent nodes before optional close work',()=>{
  const events=[],parent={nodes:[{id:'draft'}]},scope=vm.createContext({events,parent});vm.runInContext(`let callback;function captureModalParent(){return parent;}function restoreModalParent(value){events.push(value.nodes[0].id);}function openPage(title,html,submit,label,back){callback=back;events.push(title);}function trackModalHistory(nested){events.push(nested);}function mountModalParent(value){events.push(value===parent?'mounted':'wrong');}${productFunction('openNestedPage')}openNestedPage('子页','',null,'',()=>events.push('after-restore'));callback();`,scope);
  assert.deepEqual(events,['子页',true,'mounted','draft','after-restore']);
});
