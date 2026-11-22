// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'../android/app/src/main/java/com/pipiphone/app/MainActivity.java'),'utf8');
const program=JSON.parse(main.match(/web\.evaluateJavascript\(("\(function\(\)\{var view=document\.getElementById\('view'\);if\(view&&view\.getAttribute\('data-route'\)==='auth'[^"]*"),result/)[1]);
function state(route,loggedIn){return {document:{getElementById:()=>({getAttribute:()=>route})},window:{Pipi:{getState:()=>loggedIn?{roles:[]}:null}}};}
test('compatible notification waits for authenticated boot and discards a login page instead of crossing into a new login',()=>{
  assert.equal(vm.runInNewContext(program,state('boot',false)),'wait');
  assert.equal(vm.runInNewContext(program,state('auth',false)),'auth');
  assert.equal(vm.runInNewContext(program,state('chats',true)),'ready');
});
test('same-device offline text view can still receive a verified notification target',()=>{
  assert.equal(vm.runInNewContext(program,state('android-offline',false)),'ready');
});
