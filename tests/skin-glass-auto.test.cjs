// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/skins.js'),'utf8');
function openBrowser(device={}, store=new Map()) {
  const root = {dataset:{}}, events = {}, list = {id:'chat-messages', isConnected:true};
  let raf, now = 50;
  const env={
    navigator:{deviceMemory:8,hardwareConcurrency:8,userAgent:'Chrome/158.0',...device},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
    document:{documentElement:root,querySelectorAll:()=>[],addEventListener:(e,f)=>events[e]=f},
    window:{addEventListener:(e,f)=>events[e]=f},
    performance:{now:()=>now},requestAnimationFrame:f=>{raf=f;}
  };
  vm.runInNewContext(source,env);
  const skins=env.window.PipiSkins;
  skins.configure({waterdropActivated:true}); skins.select('waterdrop');
  return {skins,root,store,events,move(ms,count) {
    for(let i=0;i<count;i++){
      now+=ms;events.scroll({target:list});
      const f=raf;raf=null;if(f) f(now);
    }
  }};
}

test('auto uses each low-end signal independently; desktop Chrome 83 alone keeps full glass',()=>{
  for(const device of [{deviceMemory:4},{hardwareConcurrency:4},{userAgent:'Android; wv) Chrome/83.0'},{userAgent:'Android Chrome/99.0 PipiPhoneAndroid/1.0'}])
    assert.equal(openBrowser(device).root.dataset.glass,'lite');
  assert.equal(openBrowser({userAgent:'Android Chrome/99.0'}).root.dataset.glass,'full');
  assert.equal(openBrowser({userAgent:'Android; wv) Chrome/100.0'}).root.dataset.glass,'full');
  assert.equal(openBrowser({deviceMemory:undefined,hardwareConcurrency:undefined}).root.dataset.glass,'full');
});
test('only sustained slow automatic waterdrop scrolling persists; manual choices override and survive reload',()=>{
  const b=openBrowser();
  b.move(17,38);assert.equal(b.root.dataset.glass,'full');
  b.move(40,17);b.move(17,17);assert.equal(b.root.dataset.glass,'full');
  b.move(40,52);assert.equal(b.root.dataset.glass,'lite');
  assert.equal(openBrowser({},b.store).root.dataset.glass,'lite');
  b.skins.selectGlass('full');b.move(40,90);assert.equal(b.root.dataset.glass,'full');
  assert.equal(openBrowser({},b.store).skins.glassChoice,'full');
  b.skins.selectGlass('auto');assert.equal(b.root.dataset.glass,'lite');
  const classic=openBrowser();classic.skins.select('classic');classic.move(42,70);
  assert.equal(classic.root.dataset.glass,'full');
});
