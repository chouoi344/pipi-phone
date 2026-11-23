// SPDX-License-Identifier: MIT
'use strict';
// Execute the shipped controller against a minimal DOM. No CSS/layout emulation.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/phone-frame.js'),'utf8');
function fixture({touchPoints=1,fine=false}={}){
 const created=[],events=[],observers=[],resizeObservers=[],frames=[],listeners=new Map();
 const node=()=>{const classes=new Set();return {classes,classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}},style:{values:new Map(),setProperty(k,v){this.values.set(k,v);}},querySelector(){return null;},querySelectorAll(){return [];},setAttribute(){},getAttribute(){return null;}};};
 const shell=node(),view=node(),overlay=node(),root=node(),bottomBar=node();let owner='.bottom-tabs',preserved=0;
 bottomBar.parentElement=view;view.parentElement=shell;bottomBar.backgroundColor='rgb(247, 247, 247)';
 view.querySelector=selector=>owner&&selector.split(',').some(part=>part.trim()===':scope > '+owner)?bottomBar:null;
 const document={activeElement:null,addEventListener(name,fn){listeners.set('document:'+name,fn);},querySelector:()=>shell,getElementById:id=>id==='view'?view:overlay,documentElement:root,body:{append(e){created.push(e);}},createElement:tag=>({...node(),tag})};
 const insets={top:0,right:0,bottom:0,left:0};
 const pointer={matches:fine,addEventListener(name,fn){listeners.set('pointer:'+name,fn);}};
 const navigator={maxTouchPoints:touchPoints};
 const window={innerHeight:844,innerWidth:390,matchMedia:()=>pointer,Pipi:{preserveChatLayout(update){preserved++;update();}},addEventListener(name,fn){listeners.set(name,fn);},dispatchEvent(event){events.push(event.type);},visualViewport:{height:844,offsetTop:0,scale:1,addEventListener(name,fn){listeners.set('visual:'+name,fn);}}};
 const ResizeObserver=class{constructor(callback){this.callback=callback;resizeObservers.push(this);}observe(target,options){this.target=target;this.options=options;}};
 window.ResizeObserver=ResizeObserver;
 vm.runInNewContext(source,{document,window,navigator,getComputedStyle:e=>e.className==='phone-safe-probe'?Object.fromEntries(Object.entries(insets).map(([side,value])=>['padding'+side[0].toUpperCase()+side.slice(1),value+'px'])):{backgroundColor:e.backgroundColor||'transparent'},MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}},ResizeObserver,requestAnimationFrame:fn=>frames.push(fn),CustomEvent:class{constructor(type){this.type=type;}}});
 return {shell,view,created,events,classes:view.classes,listeners,observers,resizeObservers,insets,window,frames,pointer,navigator,setOwner(value){owner=value===true?'.bottom-tabs':value;},focus(properties={}){document.activeElement={...node(),tagName:'INPUT',type:'text',...properties};},blur(){document.activeElement=null;},get preserved(){return preserved;},flush(){while(frames.length)frames.shift()();}};
}
test('044 controller transfers changed real four-edge values and clears all edges to zero',()=>{
 const f=fixture();assert.deepEqual([...f.shell.style.values],['top','right','bottom','left'].map(side=>['--safe-'+side,'0px']));
 Object.assign(f.insets,{top:23,right:11,bottom:37,left:17});f.window.PipiPhoneFrame.refresh();
 for(const [side,value] of Object.entries(f.insets))assert.equal(f.shell.style.values.get('--safe-'+side),value+'px');
 const count=f.events.length,held=f.preserved;f.window.PipiPhoneFrame.refresh();assert.equal(f.events.length,count);assert.equal(f.preserved,held);
 Object.assign(f.insets,{top:0,right:47,bottom:21,left:47});f.listeners.get('resize')();f.listeners.get('visual:resize')();assert.equal(f.frames.length,1);f.flush();
 for(const [side,value] of Object.entries(f.insets))assert.equal(f.shell.style.values.get('--safe-'+side),value+'px');
 for(const side of Object.keys(f.insets))f.insets[side]=0;f.observers.at(-1).callback();f.flush();
 for(const side of Object.keys(f.insets))assert.equal(f.shell.style.values.get('--safe-'+side),'0px');
 assert.ok(f.events.every(type=>type==='pipi:phone-frame'));
});
test('044 controller switches leaf ownership and only creates a hidden safe-area probe',()=>{
 const f=fixture();assert.equal(f.classes.has('phone-frame-leaf'),false);
 f.setOwner(false);f.window.PipiPhoneFrame.refresh();assert.equal(f.classes.has('phone-frame-leaf'),true);
 f.setOwner(true);f.window.PipiPhoneFrame.refresh();assert.equal(f.classes.has('phone-frame-leaf'),false);
 assert.deepEqual(f.created.map(e=>[e.tag,e.className]),[['span','phone-safe-probe']]);
 assert.equal(f.resizeObservers[0].target,f.created[0]);assert.equal(f.resizeObservers[0].options.box,'border-box');
});

test('045 message selection toolbar owns the bottom inset without adding leaf padding',()=>{
 const f=fixture();f.insets.bottom=34;f.setOwner('.chat-composer');f.window.PipiPhoneFrame.refresh();
 assert.equal(f.classes.has('phone-frame-leaf'),false);
 f.setOwner('.message-selection-toolbar');f.window.PipiPhoneFrame.refresh();
 assert.equal(f.shell.style.values.get('--safe-bottom'),'34px');
 assert.equal(f.classes.has('phone-frame-leaf'),false,'the toolbar already consumes the safe bottom');
 assert.equal(f.view.style.values.get('--frame-bottom-bg'),'rgb(247, 247, 247)');
 f.setOwner(false);f.window.PipiPhoneFrame.refresh();assert.equal(f.classes.has('phone-frame-leaf'),true);
});

test('044 desktop preview reserves empty 47/34 only for a mouse-only desktop with zero real insets',()=>{
 const f=fixture({touchPoints:0,fine:true});
 assert.equal(f.shell.classes.has('phone-desktop-preview'),true);
 assert.equal(f.shell.style.values.get('--safe-top'),'47px');assert.equal(f.shell.style.values.get('--safe-bottom'),'34px');
 // One nonzero device edge is enough to use the whole real inset set.
 f.insets.bottom=21;f.resizeObservers[0].callback();f.flush();
 assert.equal(f.shell.classes.has('phone-desktop-preview'),false);
 assert.equal(f.shell.style.values.get('--safe-top'),'0px');assert.equal(f.shell.style.values.get('--safe-bottom'),'21px');
 f.insets.bottom=0;f.resizeObservers[0].callback();f.flush();assert.equal(f.shell.style.values.get('--safe-top'),'47px');
 f.pointer.matches=false;f.listeners.get('pointer:change')();f.flush();
 assert.equal(f.shell.style.values.get('--safe-top'),'0px');assert.equal(f.shell.style.values.get('--safe-bottom'),'0px');
 assert.deepEqual(f.created.map(e=>e.className),['phone-safe-probe']);
});

test('044 touch devices retain zero insets in landscape and with a fine mouse pointer',()=>{
 for(const fine of [false,true]){
  const f=fixture({touchPoints:5,fine});f.window.innerWidth=844;f.window.innerHeight=390;f.window.visualViewport.height=390;f.listeners.get('resize')();f.flush();
  assert.equal(f.shell.classes.has('phone-desktop-preview'),false);
  for(const side of ['top','bottom','left','right'])assert.equal(f.shell.style.values.get('--safe-'+side),'0px');
 }
});

test('044 keyboard removes only the covered bottom inset through blur and restores it when viewport recovers',()=>{
 const f=fixture();Object.assign(f.insets,{top:47,bottom:34,left:17,right:11});f.focus();
 Object.assign(f.window.visualViewport,{height:400,offsetTop:400});f.listeners.get('visual:resize')();f.flush();
 for(const [side,value] of Object.entries({top:47,bottom:0,left:17,right:11}))assert.equal(f.shell.style.values.get('--safe-'+side),value+'px');
 f.blur();f.listeners.get('document:focusout')();f.flush();assert.equal(f.shell.style.values.get('--safe-bottom'),'0px');
 Object.assign(f.window.visualViewport,{height:844,offsetTop:0});f.listeners.get('visual:resize')();f.flush();assert.equal(f.shell.style.values.get('--safe-bottom'),'34px');
});

test('044 viewport zoom, readonly controls and non-text controls cannot open keyboard state',()=>{
 for(const properties of [{readOnly:true},{disabled:true},{type:'checkbox'},{tagName:'BUTTON'},{getAttribute(){return 'true';}}]){
  const f=fixture();f.insets.bottom=34;f.focus(properties);f.window.visualViewport.height=400;f.window.PipiPhoneFrame.refresh();assert.equal(f.shell.style.values.get('--safe-bottom'),'34px');
 }
 const f=fixture();f.insets.bottom=34;f.focus();Object.assign(f.window.visualViewport,{height:400,scale:2});f.window.PipiPhoneFrame.refresh();assert.equal(f.shell.style.values.get('--safe-bottom'),'34px');
});

test('044 editable chat and Android resizes-content zero inset keep the bottom usable',()=>{
 const f=fixture();f.insets.bottom=34;f.focus({tagName:'DIV',isContentEditable:true});f.window.visualViewport.height=400;f.window.PipiPhoneFrame.refresh();assert.equal(f.shell.style.values.get('--safe-bottom'),'0px');
 f.insets.bottom=0;f.window.innerHeight=400;f.window.visualViewport.height=400;f.window.PipiPhoneFrame.refresh();assert.equal(f.shell.style.values.get('--safe-bottom'),'0px');
});

test('keyboard inset remains correct when typing and dismissing while zoomed',()=>{
 const f=fixture();f.insets.bottom=34;f.focus({tagName:'DIV',isContentEditable:true});
 Object.assign(f.window.visualViewport,{height:422,scale:2});f.window.PipiPhoneFrame.refresh();
 assert.equal(f.shell.style.values.get('--safe-bottom'),'34px','pinch zoom alone leaves the inset');
 f.window.visualViewport.height=220;f.listeners.get('visual:resize')();f.flush();
 assert.equal(f.shell.style.values.get('--safe-bottom'),'0px','keyboard covers the inset even at non-unit scale');
 f.blur();f.listeners.get('document:focusout')();f.flush();
 assert.equal(f.shell.style.values.get('--safe-bottom'),'0px','dismiss animation retains the covered state');
 f.window.visualViewport.height=422;f.listeners.get('visual:resize')();f.flush();
 assert.equal(f.shell.style.values.get('--safe-bottom'),'34px','dismissal restores the inset while zoom remains');
});
