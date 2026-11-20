// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
const start=source.indexOf('  function refresh('),end=source.indexOf('  function renderView(',start);
function fixture(name='engine-home',arg=null){
  let content;
  function build(){
    let top=0;const details=[{open:false}],menu={open:false};
    content={scrollLeft:0,menu,expandedMoments:[],querySelector:selector=>{assert.equal(selector,'.caption-prompt-details');return null;},querySelectorAll:selector=>{if(selector===undefined)return details;assert.equal(selector,'details.engine-details,details.model-context-details');return details;},get scrollTop(){return top;},set scrollTop(value){top=Math.min(value,details[0].open||this.expandedMoments.length?900:200);}};
  }
  build();const route={name,arg},view={dataset:{pageKey:JSON.stringify([name,arg])},querySelector:()=>content};
  const PipiFeatures={captureMomentExpansion:root=>[...root.expandedMoments],restoreMomentExpansion:(root,ids)=>{root.expandedMoments=[...ids];}};
  const ctx=vm.createContext({route,view,renderView:build,window:{PipiFeatures}});
  vm.runInContext(source.slice(start,end)+'\nglobalThis.run=refresh;',ctx);
  return {route,refresh:ctx.run,get content(){return content;}};
}
test('same-page save/query refresh keeps scroll and restores expanded content before scrolling',()=>{
  for(const page of ['engine-home','providers','role-personas','role-references','moments']){
    const f=fixture(page);f.content.querySelectorAll()[0].open=true;f.content.scrollTop=650;f.content.scrollLeft=12;f.content.menu.open=true;
    f.refresh();assert.equal(f.content.menu.open,false,'transient action menu stays closed');assert.equal(f.content.scrollTop,650,page);assert.equal(f.content.scrollLeft,12);assert.equal(f.content.querySelectorAll()[0].open,true);
    f.refresh();assert.equal(f.content.scrollTop,650,'repeated asynchronous refresh');
  }
});
test('a different page or role starts at its own top',()=>{
  for(const change of [f=>f.route.name='providers',f=>f.route.arg='bob']){
    const f=fixture('role-references','alice');f.content.querySelectorAll()[0].open=true;f.content.scrollTop=650;
    change(f);f.refresh();assert.equal(f.content.scrollTop,0);assert.equal(f.content.querySelectorAll()[0].open,false);
  }
});
test('same-view Moments refresh restores expanded posts before scroll; separate feeds start fresh',()=>{
  const f=fixture('moments',{roleId:'alice'});
  f.content.expandedMoments=['long-post'];f.content.scrollTop=600;
  f.refresh();assert.deepEqual(f.content.expandedMoments,['long-post']);assert.equal(f.content.scrollTop,600);
  f.route.arg={roleId:'bob'};f.refresh();
  assert.deepEqual(f.content.expandedMoments,[]);assert.equal(f.content.scrollTop,0);
});
test('explicit category change resets position and collapsed sections',()=>{
  const f=fixture('providers');f.content.querySelectorAll()[0].open=true;f.content.scrollTop=650;
  f.refresh({resetScroll:true});assert.equal(f.content.scrollTop,0);assert.equal(f.content.querySelectorAll()[0].open,false);
});
test('pages that manage their own position are left to their renderer',()=>{
  for(const page of ['chat','contacts','settings','role-config','life-workbench']){
    const f=fixture(page);f.content.scrollTop=180;f.refresh();assert.equal(f.content.scrollTop,0,page);
  }
});
