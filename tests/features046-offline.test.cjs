// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/features.js'),'utf8');
const imgA='data:image/png;base64,AAAA',imgB='data:image/jpeg;base64,BBBB';
class Node {
  constructor(){this.children=new Map();this.events=new Map();this.isConnected=true;this.value='';this.hidden=false;this.dataset={};this.scrollTop=0;this.style={};}
  querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Node());return this.children.get(selector);}
  querySelectorAll(){return [];}
  addEventListener(type,listener){this.events.set(type,listener);}
  setAttribute(name,value){this[name]=value;}
  append(){} focus(){} remove(){} pause(){}
}
function fixture(input={},runtime={}){
  const data={profile:{name:'我'},roles:[{id:'a',name:'阿甲',permissions:{}},{id:'b',name:'阿乙',permissions:{}}],moments:[],messages:[],favorites:[],momentNotifications:[],...input};
  const doc=new Node(),form=new Node(),calls=[],entries=[{route:{name:'favorites'}}];let modal=null,index=0;
  form.parentElement={classList:new Set()};
  doc.querySelector=selector=>selector==='.page-editor'?null:selector==='#overlay > .page-editor .modal-form'?form:Node.prototype.querySelector.call(doc,selector);
  const history={get state(){return entries[index];},pushState(value){entries.splice(++index);entries.push(value);},back(){index=Math.max(0,index-1);calls.push(['back']);}};
  const P={getState:()=>data,esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),avatar:(p,size)=>`<span class="avatar">${p.name}</span>`,icons:{},refresh:()=>calls.push(['refresh']),toast:message=>calls.push(['toast',message]),act:async(type,payload)=>{calls.push([type,payload]);},closePage:()=>calls.push(['close']),openPhoto:(...args)=>calls.push(['photo',...args]),showView:(...args)=>calls.push(['view',...args])};
  P.openModal=P.openPage=P.openNestedPage=(title,html,submit)=>{modal={title,html,submit};};
  const context=vm.createContext({window:{Pipi:P,PipiMomentVisibility:require('../public/moment-visibility.js')},document:doc,history,FormData:class{constructor(form){this.form=form;}get(key){return this.form.values?.[key]??null;}getAll(key){return this.form.arrays?.[key]||[];}},AbortController,Date,Map,Set,Math,Promise,crypto:{randomUUID:()=> 'todo-id'},setTimeout,clearTimeout,setInterval,clearInterval,...runtime});
  vm.runInContext(source.replace('  window.PipiFeatures = {','  window.TestFeatures={ui,visibleMoment,momentNotices,renderMomentCard,momentNotifications,selectFavorites,favoriteSelectionBack,editFavorite,bindFarm};\n  window.PipiFeatures = {'),context);
  return {data,P,doc,form,calls,history,ui:context.window.TestFeatures.ui,api:context.window.PipiFeatures,internals:context.window.TestFeatures,modal:()=>modal};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('features046: own feed hides blocked, chat-only and excluded friends but keeps own posts',()=>{
  const f=fixture();for(const permission of ['blocked','onlyChat','hideTheirMoments']){
    f.data.roles[0].permissions={[permission]:true};
    assert.equal(f.internals.visibleMoment({authorId:'a',visibility:'all'}),false,permission);
    assert.equal(f.internals.visibleMoment({authorId:'me',visibility:[]}),true);
    assert.equal(f.internals.visibleMoment({authorId:'b',visibility:'all'}),true);
  }
});
test('features046: role view enforces actual audience and friend permissions',()=>{
  const f=fixture(),post={authorId:'me',visibility:['a']};
  assert.equal(f.internals.visibleMoment(post,'a'),true);assert.equal(f.internals.visibleMoment(post,'b'),false);
  assert.equal(f.internals.visibleMoment({...post,visibility:[]},'a'),false);
  for(const permission of ['hideMyMoments','onlyChat','blocked']){f.data.roles[0].permissions={[permission]:true};assert.equal(f.internals.visibleMoment(post,'a'),false,permission);}
});
test('features046: role perspective does not expose unrelated roles',()=>{
  const f=fixture();f.ui.momentRole='a';f.data.moments=[{id:'1',authorId:'a',content:'甲的内容',visibility:'all',createdAt:1},{id:'2',authorId:'b',content:'乙的内容',visibility:'all',createdAt:2}];
  const html=f.api.render('moments');assert.match(html,/甲的内容/);assert.doesNotMatch(html,/乙的内容/);
});
test('features046: cards preserve ordered multiple media, escaped location and local mentions',()=>{
  const f=fixture(),html=f.internals.renderMomentCard({id:'m',authorId:'me',content:'<script>bad</script>',images:[imgB,imgA],visibility:['a'],location:'<海边>',mentions:['a'],createdAt:1});
  assert.ok(html.indexOf(imgB)<html.indexOf(imgA));assert.match(html,/data-photo-index="1"/);assert.match(html,/&lt;海边&gt;/);assert.match(html,/提醒了 阿甲/);assert.doesNotMatch(html,/<script>/);
});
test('features046: old single-image posts remain viewable',()=>{
  const f=fixture(),html=f.internals.renderMomentCard({id:'old',authorId:'me',content:'旧动态',image:imgA,visibility:'all',createdAt:1});assert.match(html,/single-photo/);assert.match(html,/data:image/);
});
test('features046: personal album renders dated entries instead of the friend feed',()=>{
  const f=fixture({moments:[{id:'own',authorId:'me',content:'个人动态',visibility:[],createdAt:new Date(2026,10,14).getTime()},{id:'other',authorId:'a',content:'其他人动态',visibility:'all',createdAt:1}]});
  const html=f.api.render('moments',{roleId:'me'});assert.match(html,/moment-own-timeline/);assert.match(html,/data-album-moment="own"/);assert.match(html,/moment-publish-public/);assert.match(html,/moment-publish-private/);assert.doesNotMatch(html,/其他人动态/);assert.doesNotMatch(html,/moment-card/);
});
test('features046: message box is empty without actual interactions and suppresses blocked actors',()=>{
  const f=fixture();f.internals.momentNotifications();assert.match(f.modal().html,/暂无消息/);assert.equal(f.calls.length,0);
  f.data.momentNotifications=[{id:'n',actorId:'a',momentId:'m',type:'like',createdAt:1,read:false}];
  for(const permission of ['blocked','onlyChat','hideTheirMoments']){f.data.roles[0].permissions={[permission]:true};assert.equal(f.internals.momentNotices().length,0);}
});
test('features046: opening actual notices marks only shown notices read',async()=>{
  const f=fixture({moments:[{id:'m',authorId:'me',content:'自己的动态',visibility:'all',createdAt:1}],momentNotifications:[{id:'n',actorId:'a',momentId:'m',type:'comment',content:'真实评论',createdAt:1,read:false}]});
  f.internals.momentNotifications();await Promise.resolve();assert.match(f.modal().html,/真实评论/);assert.deepEqual(plain(f.calls[0]),['moment.notifications.read',{ids:['n']}]);
});
test('features046: compose saves ordered images and text labels with the public default',async()=>{
  const f=fixture();f.api.composeMoment({images:[imgB,imgA]});
  await f.modal().submit({values:{content:'今天',location:'海边'},isConnected:true});
  assert.deepEqual(plain(f.calls[0]),['moment.create',{content:'今天',images:[imgB,imgA],visibility:'all',location:'海边',mentions:[]}]);
});
test('features046: public compose entry publishes to all friends',async()=>{
  const f=fixture();f.api.composeMoment({visibility:'all'});await f.modal().submit({values:{content:'今天'}});assert.equal(f.calls[0][1].visibility,'all');
});
test('features046: long-press text composition does not expose photo picker controls',()=>{
  const f=fixture();f.api.composeMoment({textOnly:true});assert.match(f.modal().html,/class="moment-compose-photos" hidden/);
});
test('features046: new note saves text, images and real checklist rows',async()=>{
  const f=fixture();f.internals.editFavorite();
  const row={dataset:{noteTodo:'t'},querySelector:s=>s.includes('checkbox')?{checked:true}:{value:'购物'}};
  await f.modal().submit({values:{content:'周末安排'},querySelectorAll:()=>[row],isConnected:true});
  assert.deepEqual(plain(f.calls[0]),['favorite.save',{content:'周末安排',images:[],todos:[{id:'t',text:'购物',done:true}]}]);
});
test('features046: edit note retains its own images and checklist identity',async()=>{
  const f=fixture({favorites:[{id:'note1',type:'note',content:'旧内容',meta:{images:[imgA],todos:[]},createdAt:1}]});f.internals.editFavorite('note1');
  await f.modal().submit({values:{content:'新内容'},querySelectorAll:()=>[],isConnected:false});assert.deepEqual(plain(f.calls[0]),['favorite.save',{id:'note1',content:'新内容',images:[imgA],todos:[]}]);
});
test('features046: invalid empty note or unfinished checklist never saves',async()=>{
  const f=fixture();f.internals.editFavorite();await assert.rejects(f.modal().submit({values:{content:' '},querySelectorAll:()=>[]}),/添加/);
  const row={dataset:{noteTodo:'t'},querySelector:s=>s.includes('checkbox')?{checked:false}:{value:' '}};await assert.rejects(f.modal().submit({values:{content:'文字'},querySelectorAll:()=>[row]}),/待办/);assert.equal(f.calls.length,0);
});
test('features046: note media and todos appear in searchable favorites with a separate category',()=>{
  const f=fixture({favorites:[{id:'n',type:'note',content:'计划',meta:{images:[imgA],todos:[{id:'t',text:'买草莓',done:true}]},createdAt:1}]});const html=f.api.render('favorites');assert.match(html,/data-favorite-type="note"/);assert.match(html,/买草莓/);assert.match(html,/is-done/);assert.match(html,/data-favorite-kind="note"/);
});
test('features046: selection stays in the filtered original list and Back retains query/type',()=>{
  const f=fixture({favorites:[{id:'n',type:'text',content:'草莓',createdAt:1}]});f.ui.favoriteQuery='草莓';f.ui.favoriteKind='text';f.internals.selectFavorites('n');
  assert.equal(f.history.state.featureSelection,'favorites');assert.equal(f.ui.favoriteSelection.has('n'),true);
  const html=f.api.render('favorites');assert.match(html,/favorite-selection-bar/);assert.match(html,/favorite-check/);assert.doesNotMatch(html,/favorite-selection-list/);
  assert.equal(f.api.handleBack('button'),true);assert.equal(f.api.handleBack('history'),true);assert.equal(f.ui.favoriteSelection,null);assert.equal(f.ui.favoriteQuery,'草莓');assert.equal(f.ui.favoriteKind,'text');
});
test('features046: successful selection deletion consumes its entry without navigating away',()=>{
  const f=fixture();f.internals.selectFavorites();f.history.pushState({...f.history.state,overlay:true},'');f.ui.favoriteSelection=null;f.ui.favoriteSelectionFinished=true;f.history.back();
  assert.equal(f.api.handleBack('history'),true);assert.equal(f.history.state.featureSelection,undefined);assert.equal(f.api.handleBack('history'),true);assert.equal(f.ui.favoriteSelectionFinished,false);
});
test('features046: visiting a friend renders their independent plots and resources',()=>{
  const plots=Array.from({length:6},(_,i)=>({id:String(i+1),crop:null}));const f=fixture({farm:{coins:999,seeds:8,plots,friends:{a:{coins:42,seeds:3,plots:plots.map(p=>p.id==='1'?{...p,crop:'carrot',readyAt:1}:p)}}}});
  const html=f.api.render('farm',{roleId:'a'});assert.match(html,/阿甲的农场/);assert.match(html,/>42</);assert.match(html,/胡萝卜/);assert.match(html,/data-plot="6"/);assert.doesNotMatch(html,/>999</);assert.doesNotMatch(html,/data-water/);
});
test('features046: main farm opens actual friend visits instead of a repeated water button',()=>{
  const f=fixture({farm:{coins:100,seeds:10,plots:[],friends:{a:{plots:[]},b:{plots:[]}}}});const html=f.api.render('farm');assert.match(html,/data-visit-farm="a"/);assert.match(html,/去看看/);assert.doesNotMatch(html,/data-water/);
});

test('features046: more than 100 unread interactions are marked read in legal batches',async()=>{
  const notifications=Array.from({length:205},(_,index)=>({id:'n'+index,actorId:'a',momentId:'m',type:'like',createdAt:1,read:false}));
  const f=fixture({momentNotifications:notifications});f.internals.momentNotifications();await new Promise(resolve=>setImmediate(resolve));
  const reads=f.calls.filter(call=>call[0]==='moment.notifications.read');assert.deepEqual(reads.map(call=>call[1].ids.length),[100,100,5]);assert.equal(new Set(reads.flatMap(call=>call[1].ids)).size,205);
});
test('features046: voice favorites retain the local simulation disclosure',()=>{
  const f=fixture({favorites:[{id:'v',type:'voice',content:'语音',meta:{transcript:'模拟识别',transcriptSource:'demo'},createdAt:1}]});assert.match(f.api.render('favorites'),/演示预设文字，非真实识别结果/);
});

test('features046: photo order and removal controls change the submitted images',async()=>{
  const f=fixture(),move=new Node(),remove=new Node();move.dataset={moveImage:'1',step:'-1'};remove.dataset={removeImage:'1'};
  f.form.querySelectorAll=selector=>selector==='[data-move-image]'?[move]:selector==='[data-remove-image]'?[remove]:[];
  f.api.composeMoment({images:[imgA,imgB]});move.events.get('click')({currentTarget:move});remove.events.get('click')({currentTarget:remove});
  await f.modal().submit({values:{content:'图片顺序',visibility:'all'},arrays:{mentions:[]},isConnected:false});assert.deepEqual(plain(f.calls[0][1].images),[imgB]);
});
test('features046: adding a tenth photo is rejected before any media is read or submitted',async()=>{
  const f=fixture(),input=new Node();input.files=[{name:'extra.png',type:'image/png',size:1}];
  f.form.querySelectorAll=selector=>selector==='#moment-image-input'?[input]:[];
  f.api.composeMoment({images:Array(9).fill(imgA)});await input.events.get('change')({target:input});
  assert.match(f.calls[0][1],/最多 9/);assert.equal(f.calls.some(call=>call[0]==='moment.create'),false);
});

test('features046: friend farm plant and harvest controls send that farm identity',async t=>{
  const plot={id:'1',crop:null},f=fixture({farm:{coins:100,seeds:10,plots:[],friends:{a:{coins:20,seeds:2,plots:[plot]}}}}),button=new Node();button.dataset.plot='1';
  f.doc.querySelectorAll=selector=>selector==='[data-plot]'?[button]:[];t.after(()=>f.api.cleanup());f.internals.bindFarm({roleId:'a'});
  button.events.get('click')({currentTarget:button});await f.modal().submit({values:{crop:'tomato'},isConnected:false});assert.deepEqual(plain(f.calls[0]),['farm.plant',{plotId:'1',crop:'tomato',roleId:'a'}]);
  plot.crop='carrot';plot.readyAt=1;await button.events.get('click')({currentTarget:button});assert.deepEqual(plain(f.calls.find(call=>call[0]==='farm.harvest')),['farm.harvest',{plotId:'1',roleId:'a'}]);
});
test('features046: watering targets the growing friend plot and daily repeated help shows no action',async t=>{
  const plot={id:'2',crop:'carrot',readyAt:Date.now()+300000},f=fixture({farm:{coins:100,seeds:10,plots:[],friends:{a:{coins:20,seeds:2,plots:[plot]}},visits:[]}}),button=new Node();button.dataset.plot='2';let sheet;
  f.P.actionSheet=(caption,actions)=>{sheet={caption,actions};};f.doc.querySelectorAll=selector=>selector==='[data-plot]'?[button]:[];t.after(()=>f.api.cleanup());f.internals.bindFarm({roleId:'a'});
  button.events.get('click')({currentTarget:button});assert.match(sheet.caption,/胡萝卜/);await sheet.actions[0].run();assert.deepEqual(plain(f.calls[0]),['farm.water',{roleId:'a',plotId:'2'}]);
  sheet=null;f.data.farm.visits.push({roleId:'a',date:new Date().toISOString().slice(0,10)});button.events.get('click')({currentTarget:button});assert.equal(sheet,null);assert.match(f.calls.at(-1)[1],/今日已互助/);
});

test('P2-6 farm render and watering action use the configured Shanghai midnight',async t=>{
  let at=Date.parse('2026-11-25T15:59:59Z');class Clock extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}}
  const plot={id:'2',crop:'carrot',readyAt:at+3600000},f=fixture({settings:{timezone:'Asia/Shanghai'},farm:{coins:100,seeds:10,plots:[],friends:{a:{coins:20,seeds:2,plots:[plot]}},visits:[{roleId:'a',date:'2026-11-25'}]}},{Date:Clock}),button=new Node();button.dataset.plot='2';let sheet;
  f.P.actionSheet=(caption,actions)=>{sheet={caption,actions};};f.doc.querySelectorAll=selector=>selector==='[data-plot]'?[button]:[];t.after(()=>f.api.cleanup());f.internals.bindFarm({roleId:'a'});
  button.events.get('click')({currentTarget:button});assert.equal(sheet,undefined);assert.match(f.api.render('farm',{roleId:'a'}),/今日已互助/);
  at+=2000;button.events.get('click')({currentTarget:button});assert.ok(sheet,'local midnight must enable the watering action');assert.doesNotMatch(f.api.render('farm',{roleId:'a'}),/今日已互助/);
  await sheet.actions[0].run();assert.deepEqual(plain(f.calls.find(row=>row[0]==='farm.water')),['farm.water',{roleId:'a',plotId:'2'}]);
});

for(const roleId of [undefined,'a'])test(`features046: ${roleId?'friend':'own'} farm actual interval decodes DOM epoch and refreshes on maturity`,()=>{
  const base=1794696916104,readyAt=base+300000;let now=base,tick;
  class Clock extends Date{static now(){return now;}}
  const plot={id:'1',crop:'carrot',readyAt},farm={coins:100,seeds:9,plots:[plot],friends:{a:{coins:40,seeds:2,plots:[plot]}}};
  const f=fixture({farm},{Date:Clock,setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{}}),arg=roleId?{roleId}:undefined;
  const html=f.api.render('farm',arg),timer=new Node();timer.dataset.readyAt=html.match(/data-ready-at="([0-9]+)"/)[1];
  assert.equal(typeof timer.dataset.readyAt,'string');assert.match(html,/5分0秒/);
  f.doc.querySelectorAll=selector=>selector==='[data-ready-at]'?[timer]:[];f.internals.bindFarm(arg);
  now=base+1000;tick();assert.equal(timer.textContent,'4分59秒');assert.equal(f.calls.some(call=>call[0]==='refresh'),false);
  now=readyAt-1;tick();assert.equal(timer.textContent,'1秒');assert.equal(f.calls.some(call=>call[0]==='refresh'),false);
  now=readyAt;tick();assert.deepEqual(plain(f.calls),[['refresh']]);assert.match(f.api.render('farm',arg),/点击收获/);assert.doesNotMatch(f.api.render('farm',arg),/data-ready-at=/);
  f.api.cleanup();
});

test('features046: farm interval stops when the farm page is no longer mounted',()=>{
  let tick;const cleared=[],f=fixture({farm:{coins:100,seeds:10,plots:[],friends:{}}},{setInterval:callback=>{tick=callback;return 17;},clearInterval:id=>cleared.push(id)});
  f.internals.bindFarm();const query=f.doc.querySelector;f.doc.querySelector=selector=>selector==='.farm-page'?null:query(selector);tick();
  assert.deepEqual(cleared,[17]);assert.equal(f.ui.farmTimer,null);assert.equal(f.calls.length,0);
});
