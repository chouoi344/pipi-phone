// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const java=fs.readFileSync(path.join(__dirname,'../android/app/src/main/java/com/pipiphone/app/WebViewRequirements.java'),'utf8');
const features=JSON.parse(java.match(/FEATURES = ("(?:[^"\\]|\\.)*");/)[1]);
const syntax=JSON.parse(java.match(/SYNTAX = ("(?:[^"\\]|\\.)*");/)[1]);
const pageStarted=JSON.parse(java.match(/PAGE_STARTED = ("(?:[^"\\]|\\.)*");/)[1]);
function browser(setup=''){
  const context=vm.createContext({fetch:function(){},URL:function(){},URLSearchParams:function(){},FormData:function(){},AbortController:function(){},document:{getElementById:()=>null},navigator:{userAgent:'Chrome/83.0.4103.106'},CSS:{supports:()=>false}});
  if(setup)vm.runInContext(setup,context);
  return context;
}

test('WebView 83 core capabilities pass without newer helpers, skin observers, recording or CSS :has',()=>{
  const context=browser('Object.hasOwn=undefined;Array.prototype.at=undefined;Array.prototype.findLast=undefined;');
  assert.deepEqual(Array.from(vm.runInContext(features,context)),[]);
  assert.equal(vm.runInContext(syntax,context),true);
  assert.doesNotMatch(syntax,/&&=|\|\|=|\?\?=/);
});

test('missing core APIs are named so the Android dialog can explain the actual requirement',()=>{
  for(const missing of ['Object.fromEntries','fetch','URL','URLSearchParams','FormData','Promise','AbortController']){
    const context=browser(missing+'=undefined');
    assert.deepEqual(Array.from(vm.runInContext(features,context)),[missing]);
  }
  assert.deepEqual(Array.from(vm.runInContext(features,browser('fetch=undefined;FormData=undefined;'))),['fetch','FormData']);
});

test('capability checks and modern syntax probes work without eval or Function, as required by the page CSP',()=>{
  const context=browser("eval=function(){throw new Error('CSP blocked eval')};Function=function(){throw new Error('CSP blocked Function')};");
  assert.deepEqual(Array.from(vm.runInContext(features,context)),[]);
  assert.equal(vm.runInContext(syntax,context),true);
});

test('modern WebView capabilities keep passing the same core probes',()=>{
  const context=browser('navigator.userAgent="Chrome/143.0.0.0";');
  assert.deepEqual(Array.from(vm.runInContext(features,context)),[]);
  assert.equal(vm.runInContext(syntax,context),true);
});

test('startup detection accepts a running main script while its first network response is still pending',()=>{
  const context=browser('window={Pipi:{getState:function(){return null;}},PipiAndroidPage:{connect:function(){}}};');
  assert.equal(vm.runInContext(pageStarted,context),true);
});

test('startup detection reports an unparsed main script without treating a boot placeholder as rendered UI',()=>{
  for(const setup of ['window={};','window={PipiAndroidPage:{connect:function(){}}};','window={Pipi:{getState:function(){}}};'])
    assert.equal(vm.runInContext(pageStarted,browser(setup)),false);
});

test('an older server with a rendered core page can work without the newer Android integration',()=>{
  const context=browser('window={};document.getElementById=function(){return {getAttribute:function(name){return name==="data-route"?"auth":null;}}};');
  assert.equal(vm.runInContext(pageStarted,context),true);
});

const protocolJdk=process.env.PIPI_ANDROID_TEST_JDK||process.env.JAVA_HOME||'C:/Program Files/Eclipse Adoptium/jdk-17.0.21.10002-hotspot';
const protocolJar=process.env.PIPI_ANDROID_TEST_JSON_JAR||'C:/Users/34483/.codex/standalone-android/json-20240303.jar';
const protocolTools=fs.existsSync(path.join(protocolJdk,'bin','javac'+(process.platform==='win32'?'.exe':'')))&&fs.existsSync(protocolJar);
test('real native protocol contracts allow new protocol bundles while retaining the exact audited legacy gate',{
  skip:protocolTools?false:'JDK17 and org.json are required; run tests/android-protocol.cjs in the Android checks',
},()=>{
  const output=execFileSync(process.execPath,[path.join(__dirname,'android-protocol.cjs')],{encoding:'utf8',env:{...process.env,PIPI_ANDROID_TEST_JDK:protocolJdk,PIPI_ANDROID_TEST_JSON_JAR:protocolJar},windowsHide:true});
  const result=output.match(/Android protocol contracts: (\d+) passed, 0 failed/);
  assert.ok(result,output);assert.ok(Number(result[1])>=9,output);
});
