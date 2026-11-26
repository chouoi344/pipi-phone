// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const draftFunctions=app.slice(app.indexOf('  function persistChatDrafts('),app.indexOf('  function captureAndroidPage('));
const restore=app.slice(app.indexOf('  function restoreAndroidPage('),app.indexOf('  function restoreAndroidAnchor('));
for(const [name,text]of [['离线已清空',''],['离线已修改','离线后来写的新草稿']])test(name+'：真实恢复链覆盖旧sessionStorage，随后常规恢复不复活旧文字',()=>{
  const cache={drafts:text?[{roleId:'alpha',text}]:[],chats:[],chatsTop:0,contactsTop:0,route:{name:'chat',arg:'alpha'},stack:[]};
  const storage=new Map([['drafts',JSON.stringify({alpha:{text:'离线前的旧草稿',quote:'old-quote'}})]]);
  const scope=vm.createContext({state:{roles:[{id:'alpha'}]},drafts:new Map(),composeText:'',quoteId:'',route:{name:'chat',arg:'alpha'},window:{PipiAndroidPage:{restore:()=>cache}},roleById:id=>id==='alpha',androidReadings:new Map(),chatScrolls:new Map(),chatHistoryWindows:new Map(),restoredPage:true,androidInboxEntry:false,chatDraftKey:'drafts',sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  vm.runInContext(draftFunctions+restore+'restoreAndroidPage();restoreChatDrafts();',scope);
  assert.equal(scope.composeText,text);assert.equal(scope.quoteId,'');
  if(text)assert.equal(JSON.parse(storage.get('drafts')).alpha.text,text);else assert.equal(storage.has('drafts'),false);
});
