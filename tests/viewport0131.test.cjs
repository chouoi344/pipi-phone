// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
test('viewport batches keyboard resize events, skips unchanged sizes and preserves pinch zoom',()=>{
  const writes=[],frames=[],events={},viewport={height:844,offsetTop:0,scale:1,addEventListener(name,fn){events[name]=fn;}};
  let captures=0,restores=0;
  const document={documentElement:{style:{setProperty:(name,value)=>writes.push([name,value])}},addEventListener(name,fn){events['document:'+name]=fn;}};
  const context={window:{visualViewport:viewport,addEventListener(name,fn){events['window:'+name]=fn;}},document,innerHeight:844,requestAnimationFrame:fn=>frames.push(fn),captureChatLayout(){captures++;return {};},restoreChatLayout(){restores++;}};
  vm.runInNewContext(source.slice(source.indexOf('  const viewport=window.visualViewport;'),source.indexOf('sizeViewport();',source.indexOf('  const viewport=window.visualViewport;'))+'sizeViewport();'.length),context);
  assert.equal(writes.length,2);
  viewport.height=460;events.resize();events.scroll();events['window:resize']();assert.equal(frames.length,1);
  frames.shift()();assert.deepEqual(writes.slice(-2),[['--app-height','460px'],['--viewport-top','0px']]);
  events.resize();frames.shift()();assert.equal(writes.length,4);
  viewport.scale=2;viewport.height=230;viewport.offsetTop=90;events.resize();frames.shift()();assert.equal(writes.length,4);
  // Dismissal must restore the shell even while Safari retains a non-1 scale.
  viewport.height=422;events.resize();frames.shift()();
  assert.deepEqual(writes.slice(-2),[['--app-height','844px'],['--viewport-top','0px']]);
  viewport.height=230;events['document:focusin']();frames.shift()();
  assert.deepEqual(writes.slice(-2),[['--app-height','460px'],['--viewport-top','0px']]);
  // Restoring the page from browser history must also refresh a stale height.
  viewport.height=422;events['window:pageshow']();frames.shift()();
  assert.deepEqual(writes.slice(-2),[['--app-height','844px'],['--viewport-top','0px']]);
  viewport.scale=1;viewport.height=844;viewport.offsetTop=0;events['document:focusout']();frames.shift()();
  assert.deepEqual(writes.slice(-2),[['--app-height','844px'],['--viewport-top','0px']]);assert.equal(captures,5);assert.equal(restores,5);
});
