// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const java=fs.readFileSync(path.join(__dirname,'../android/app/src/main/java/com/pipiphone/app/WebViewRequirements.java'),'utf8');
const features=JSON.parse(java.match(/FEATURES = ("(?:[^"\\]|\\.)*");/)[1]);
const syntax=JSON.parse(java.match(/SYNTAX = ("(?:[^"\\]|\\.)*");/)[1]);
function browser(setup=''){
  const context=vm.createContext({ResizeObserver:function(){},AbortController:function(){},fetch:function(){},URL:function(){},FormData:function(){},navigator:{userAgent:'Chrome/101.0.4951.61'},CSS:{supports:()=>false}});
  if(setup)vm.runInContext(setup,context);
  return context;
}

test('bundled probes allow the modern APIs present in WebView 101 without requiring CSS :has or a newer user agent',()=>{
  const context=browser();
  assert.equal(vm.runInContext(features,context),true);
  assert.equal(vm.runInContext(syntax,context),true);
});

test('actual missing APIs used by the page are detected before its scripts can fail',()=>{
  for(const missing of ['Object.fromEntries','Object.hasOwn','Array.prototype.at','Array.prototype.findLast','ResizeObserver','AbortController','fetch','URL','FormData']){
    const context=browser(missing+'=undefined');
    assert.equal(vm.runInContext(features,context),false,missing);
  }
});

test('capability checks and modern syntax probes work without eval or Function, as required by the page CSP',()=>{
  const context=browser("eval=function(){throw new Error('CSP blocked eval')};Function=function(){throw new Error('CSP blocked Function')};");
  assert.equal(vm.runInContext(features,context),true);
  assert.equal(vm.runInContext(syntax,context),true);
});
