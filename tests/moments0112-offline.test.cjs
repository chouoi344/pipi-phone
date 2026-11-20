// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/features.js'),'utf8');
const image='data:image/png;base64,AAAA';
const plain=value=>JSON.parse(JSON.stringify(value));
class Element {
  constructor(attrs={}){
    this.attrs=attrs;this.dataset={};this.events={};this.nodes=new Map();this.html='';this.textContent='';this.value='';this.checked=false;this.hidden=false;this.isConnected=true;
    this.classList={add(){},remove(){}};
    for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  }
  set innerHTML(html){this.html=html;this.parsed=null;}
  get innerHTML(){return this.html;}
  elements(){
    if(!this.parsed)this.parsed=[...this.html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map(match=>{
      const attrs={tag:match[1]};for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g))attrs[attr[1]]=attr[2];return new Element(attrs);
    });
    return this.parsed;
  }
  querySelectorAll(selector){
    if(selector.includes(' '))return [];
    const matches=node=>selector[0]==='#'?node.attrs.id===selector.slice(1):selector[0]==='.'?(node.attrs.class||'').split(' ').includes(selector.slice(1)):selector[0]==='['?(()=>{const [,key,value]=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector)||[];return key in node.attrs&&(value===undefined||node.attrs[key]===value);})():node.attrs.tag===selector;
    return this.elements().filter(matches).concat([...this.nodes.values()].flatMap(node=>node.querySelectorAll(selector)));
  }
  querySelector(selector){
    const actual=this.querySelectorAll(selector)[0];if(actual)return actual;
    if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);
  }
  addEventListener(type,callback){this.events[type]=callback;}
  setAttribute(key,value){this.attrs[key]=value;}
  focus(){}
}
function fixture(extra={}){
  const state={profile:{name:'我'},roles:[{id:'a',name:'甲',tags:['同学','朋友']},{id:'b',name:'乙',tags:['同学']},{id:'c',name:'丙',tags:['家人']}],moments:[],statusHistory:[],...extra};
  const pages=[],calls=[],toasts=[];
  const open=(title,html,submit,label)=>{
    const form=new Element();form.innerHTML=html;const section=new Element();section.querySelector=selector=>selector==='.modal-form'?form:Element.prototype.querySelector.call(section,selector);
    pages.push({title,html,submit,label,form,section});
  };
  const P={getState:()=>state,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),avatar:person=>`<span class="avatar">${person.name}</span>`,icons:{chevron:'<svg></svg>',camera:'<svg></svg>',search:'<svg></svg>',more:'<svg></svg>'},openModal:open,openNestedPage:open,openPage:open,closePage:()=>pages.pop(),act:async(type,payload)=>calls.push([type,payload]),refresh(){},toast:message=>toasts.push(message),openPhoto:(...args)=>calls.push(['photo',...args]),showView:(...args)=>calls.push(['view',...args])};
  const document={querySelector:selector=>selector==='#overlay > .page-editor'?pages.at(-1).section:selector==='#overlay > .page-editor .modal-form'?pages.at(-1).form:null,querySelectorAll:()=>[]};
  const context=vm.createContext({window:{Pipi:P},document,Date,Map,Set,Math,Promise,AbortController,FormData:class{constructor(form){this.form=form;}get(key){return this.form.values?.[key]||'';}},setTimeout,clearTimeout,setInterval,clearInterval});
  vm.runInContext(source.replace('  window.PipiFeatures = {','  window.Probe={momentVisibility,momentFriends,momentTagGroups,pickMomentPrivacy,pickMomentFriends,pickMomentTags,ui};\n  window.PipiFeatures = {'),context);
  const page=()=>pages.at(-1);
  const fire=(selector,type='click',value)=>{const node=page().form.querySelector(selector);if(value!==undefined)node[type==='change'?'checked':'value']=value;assert.ok(node.events[type],`${selector} ${type}`);return node.events[type]({currentTarget:node});};
  return {state,P,pages,page,calls,toasts,fire,api:context.window.PipiFeatures,probe:context.window.Probe};
}

test('0112 privacy modes use the existing stored audience model and permission-filtered friends',()=>{
  const f=fixture();f.state.roles.push({id:'d',name:'隐藏',tags:['同学'],permissions:{hideMyMoments:true}});
  assert.deepEqual(plain(f.probe.momentVisibility({mode:'self'})),[]);
  assert.equal(f.probe.momentVisibility({mode:'all'}),'all');
  assert.deepEqual(plain(f.probe.momentVisibility({mode:'some',some:['a','d']})),['a']);
  assert.deepEqual(plain(f.probe.momentVisibility({mode:'exclude',exclude:['b']})),['a','c']);
  assert.throws(()=>f.probe.momentVisibility({mode:'some',some:[]}),/至少/);
  assert.deepEqual(plain(f.probe.momentTagGroups(f.probe.momentFriends())),[['家人',['c']],['朋友',['a']],['同学',['a','b']]]);
});

test('0112 privacy Cancel discards nested contact and tag choices until outer Done',async()=>{
  const f=fixture();let saved=null;
  const initial={mode:'self',some:[],exclude:[]};f.probe.pickMomentPrivacy(initial,next=>{saved=next;});
  f.fire('[data-moment-privacy="some"]');f.fire('#moment-privacy-contacts');
  f.fire('[data-moment-choice="a"]','change',true);await f.page().submit();
  assert.match(f.page().form.querySelector('#moment-privacy-summary').textContent,/甲/);
  f.P.closePage();assert.equal(saved,null);assert.deepEqual(initial,{mode:'self',some:[],exclude:[]});
  f.probe.pickMomentPrivacy(initial,next=>{saved=next;});f.fire('[data-moment-privacy="exclude"]');f.fire('#moment-privacy-tags');
  const index=f.probe.momentTagGroups(f.probe.momentFriends()).findIndex(([name])=>name==='同学');
  f.fire(`[data-moment-tag="${index}"]`,'change',true);await f.page().submit();await f.page().submit();
  assert.equal(saved.mode,'exclude');assert.deepEqual(plain(saved.exclude),['a','b']);
});

test('0112 nested tag Back retains the contact draft without committing the tag changes',async()=>{
  const f=fixture();let saved=null;f.probe.pickMomentFriends('提醒谁看',f.state.roles,['a'],ids=>{saved=ids;});
  f.fire('#moment-picker-tags');f.fire('[data-moment-tag="0"]','change',true);f.P.closePage();
  assert.equal(f.page().form.querySelector('[data-moment-choice="a"]').checked,true);
  assert.equal(f.page().form.querySelector('[data-moment-choice="c"]').checked,false);
  await f.page().submit();assert.deepEqual(plain(saved),['a']);
});

test('0112 contact search filters by names and tags without changing selections',async()=>{
  const f=fixture();let saved;f.probe.pickMomentFriends('朋友',f.state.roles,['a'],ids=>{saved=ids;});
  f.fire('#moment-picker-query','input','家人');
  assert.equal(f.page().form.querySelector('[data-moment-friend="a"]').hidden,true);
  assert.equal(f.page().form.querySelector('[data-moment-friend="c"]').hidden,false);
  await f.page().submit();assert.deepEqual(plain(saved),['a']);
  const css=fs.readFileSync(path.join(__dirname,'../public/features.css'),'utf8');assert.match(css,/\.moment-selection \[hidden\]\{display:none!important\}/);
});

test('0112 publishing keeps text, location, images and tag audience across the child pages',async()=>{
  const f=fixture();f.api.composeMoment({images:[image]});const compose=f.page();
  compose.form.values={content:'正文草稿',location:'海边'};
  assert.doesNotMatch(compose.html,/<select|moment-audience/);
  f.fire('#moment-visibility');f.fire('[data-moment-privacy="some"]');f.fire('#moment-privacy-tags');
  const index=f.probe.momentTagGroups(f.probe.momentFriends()).findIndex(([name])=>name==='同学');
  f.fire(`[data-moment-tag="${index}"]`,'change',true);await f.page().submit();await f.page().submit();
  assert.equal(f.page(),compose);f.fire('#moment-mention');assert.doesNotMatch(f.page().html,/data-moment-choice="c"/);
  f.fire('[data-moment-choice="a"]','change',true);await f.page().submit();await compose.submit(compose.form);
  assert.deepEqual(plain(f.calls[0]),['moment.create',{content:'正文草稿',images:[image],visibility:['a','b'],location:'海边',mentions:['a']}]);
});

test('0112 privacy changes remove hidden reminders only after Done',async()=>{
  const f=fixture();f.api.composeMoment({visibility:'all'});const compose=f.page();compose.form.values={content:'今日'};
  assert.match(compose.html,/<small>公开<\/small>/);
  f.fire('#moment-mention');f.fire('[data-moment-choice="a"]','change',true);await f.page().submit();
  f.fire('#moment-visibility');f.fire('[data-moment-privacy="self"]');f.P.closePage();
  assert.equal(compose.form.querySelector('#moment-mention small').textContent,'甲');
  assert.equal(compose.form.querySelector('#moment-mention').hidden,false);
  f.fire('#moment-visibility');f.fire('[data-moment-privacy="self"]');await f.page().submit();
  assert.equal(compose.form.querySelector('#moment-mention small').textContent,'未选择');assert.match(f.toasts.at(-1),/移除/);
  assert.equal(compose.form.querySelector('#moment-mention').hidden,true);
  await compose.submit(compose.form);assert.deepEqual(plain(f.calls[0][1].visibility),[]);assert.deepEqual(plain(f.calls[0][1].mentions),[]);
});

test('private drafts hide reminders; public reminders commit on Done and keep the compose draft on Cancel',async()=>{
  const f=fixture();f.api.composeMoment({visibility:'self',images:[image]});const compose=f.page();
  compose.form.values={content:'保留正文',location:'保留地点'};
  assert.equal(compose.form.querySelector('#moment-mention').hidden,true);
  f.fire('#moment-visibility');f.fire('[data-moment-privacy="all"]');await f.page().submit();
  assert.equal(compose.form.querySelector('#moment-mention').hidden,false);
  f.fire('#moment-mention');f.fire('[data-moment-choice="a"]','change',true);await f.page().submit();
  f.fire('#moment-mention');assert.equal(f.page().form.querySelector('[data-moment-choice="a"]').checked,true);
  f.fire('[data-moment-choice="b"]','change',true);f.P.closePage();
  assert.equal(f.page(),compose);assert.equal(compose.form.querySelector('#moment-mention small').textContent,'甲');
  f.fire('#moment-mention');assert.equal(f.page().form.querySelector('[data-moment-choice="b"]').checked,false);f.P.closePage();
  await compose.submit(compose.form);
  assert.deepEqual(plain(f.calls[0][1]),{content:'保留正文',images:[image],visibility:'all',location:'保留地点',mentions:['a']});
});

test('ordinary Moments composition defaults to public with reminders available',async()=>{
  const f=fixture();f.api.composeMoment({images:[image]});
  const compose=f.page();compose.form.values={content:'今日'};
  assert.equal(compose.form.querySelector('#moment-mention').hidden,false);
  await compose.submit(compose.form);
  assert.equal(f.calls[0][1].visibility,'all');
});

test('excluded friends cannot be reminded while visible friends remain selectable',async()=>{
  const f=fixture();f.api.composeMoment();
  f.fire('#moment-visibility');f.fire('[data-moment-privacy="exclude"]');f.fire('#moment-privacy-contacts');
  f.fire('[data-moment-choice="b"]','change',true);await f.page().submit();await f.page().submit();
  assert.equal(f.page().form.querySelector('#moment-mention').hidden,false);
  f.fire('#moment-mention');
  assert.match(f.page().html,/data-moment-choice="a"/);assert.match(f.page().html,/data-moment-choice="c"/);
  assert.doesNotMatch(f.page().html,/data-moment-choice="b"/);
});

test('0112 friend and tag selection enforce the backend 200-person limit',()=>{
  const friends=Array.from({length:201},(_,i)=>({id:'r'+i,name:'好友'+i,tags:['全部']}));const f=fixture({roles:friends});
  f.probe.pickMomentFriends('朋友',friends,friends.slice(0,200).map(friend=>friend.id),()=>{});
  f.fire('[data-moment-choice="r200"]','change',true);assert.equal(f.page().form.querySelector('[data-moment-choice="r200"]').checked,false);assert.match(f.toasts.at(-1),/200/);
  f.probe.pickMomentTags(friends,[],()=>{});f.fire('[data-moment-tag="0"]','change',true);assert.equal(f.page().form.querySelector('[data-moment-tag="0"]').checked,false);
});

test('0112 photo album uses own real photos while text posts remain in the timeline',()=>{
  const f=fixture({moments:[{id:'text',authorId:'me',content:'纯文字',visibility:[],createdAt:1},{id:'other',authorId:'a',images:[image],visibility:'all',createdAt:1}]});
  let album=f.api.render('moment-album');assert.match(album,/暂无视频和图片/);assert.doesNotMatch(album,/data-album-photo/);
  const timeline=f.api.render('moments',{roleId:'me'});assert.match(timeline,/纯文字/);assert.match(timeline,/moment-publish-public/);assert.match(timeline,/moment-publish-private/);
  f.state.moments.push({id:'photo',authorId:'me',content:'照片',images:[image],visibility:[],createdAt:2});album=f.api.render('moment-album');assert.match(album,/data-album-photo="photo"/);assert.doesNotMatch(album,/data-album-photo="other"/);
  f.probe.ui.albumTab='status';assert.match(f.api.render('moment-album'),/暂无状态/);
  f.state.profile.status={description:'已到期状态',expiresAt:Date.now()-1};assert.doesNotMatch(f.api.render('moment-album'),/moment-current-status|已到期状态/);
  f.state.profile.status={description:'当前有效状态',expiresAt:Date.now()+60000};assert.match(f.api.render('moment-album'),/当前有效状态/);
  f.state.profile.status=null;
  f.state.statusHistory.push({id:'old',startedAt:1});assert.match(f.api.render('moment-album'),/历史状态/);
});
