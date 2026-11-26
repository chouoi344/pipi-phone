// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const code=app.slice(app.indexOf('  function chatProgressLabel('),app.indexOf('  async function syncChatProgress('));
function fixture(){
  let typing=false,at=100000,timer=0;const timers=new Map(),title={textContent:''},text={textContent:''},cancel={hidden:true},status={hidden:true,querySelector:selector=>selector==='[data-chat-progress-text]'?text:cancel};
  const view={querySelector:selector=>selector==='[data-chat-title]'?title:selector==='.chat-retry-status'?status:{classList:{toggle(){}}}};
  const scope=vm.createContext({Date:{now:()=>at},view,document:{hidden:false},window:{PipiEngine:{isTyping:()=>typing}},roleById:()=>({name:'保留好友名字'}),roleName:role=>role.name,setInterval:fn=>{const id=++timer;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)});
  vm.runInContext(`let route={name:'chat',arg:'alice'},slowReplyRole='',chatProgressSequence=0,activeChatProgress=null,chatProgressTimer=0;${code}globalThis.ui={updateTyping,label:chatProgressLabel,leave:()=>route={name:'chats'},role:id=>route={name:'chat',arg:id}};`,scope);
  return {scope,ui:scope.ui,title,text,cancel,status,timers,setTyping:value=>{typing=value;},tick:()=>{at+=1000;for(const fn of [...timers.values()])fn();}};
}
test('真实顶部函数显示业务阶段和真实耗时，模型/工具等待保留好友名字且没有假百分比',()=>{
  const f=fixture();f.ui.updateTyping('alice',false,{phase:'model',startedAt:90000});assert.equal(f.title.textContent,'保留好友名字');assert.equal(f.text.textContent,'正在生成回复 · 10秒');assert.equal(f.cancel.hidden,true);assert.equal(f.status.hidden,false);
  f.tick();assert.equal(f.text.textContent,'正在生成回复 · 11秒');
  f.ui.updateTyping('alice',false,{phase:'tool',startedAt:90000,toolName:'send_transfer',args:{private:'不进文案'}});assert.match(f.text.textContent,/正在处理操作/);assert.doesNotMatch(f.text.textContent,/send_transfer|private|%/);
});
test('媒体语音阶段不冒充输入中，投递保留原typing，失败/取消后状态和本地计时都清空',()=>{
  const f=fixture();f.ui.updateTyping('alice',false,{phase:'media',operation:'voice',startedAt:80000});assert.equal(f.text.textContent,'正在生成语音 · 20秒');assert.equal(f.title.textContent,'保留好友名字');
  f.setTyping(true);f.ui.updateTyping('alice',false,{phase:'delivering',startedAt:80000});assert.equal(f.title.textContent,'对方正在输入');
  f.setTyping(false);f.ui.updateTyping('alice',false,{phase:null});assert.equal(f.title.textContent,'保留好友名字');assert.equal(f.status.hidden,true);assert.equal(f.timers.size,0);
});
test('旧slow重试文案与取消权限保留，无slow的业务进度不添加取消按钮',()=>{
  const f=fixture();f.ui.updateTyping('alice',true,{phase:'model',startedAt:90000});assert.equal(f.text.textContent,'网络较慢，正在重试…');assert.equal(f.cancel.hidden,false);
  f.ui.updateTyping('alice',false,{phase:'model',startedAt:90000});assert.equal(f.cancel.hidden,true);
  f.ui.updateTyping('alice',true,{typing:false,slow:true});assert.equal(f.text.textContent,'网络较慢，正在重试…');assert.equal(f.cancel.hidden,false);
});
test('排队耗时来自enqueuedAt；离开聊天停止本地计时，不新发网络请求',()=>{
  const f=fixture();f.ui.updateTyping('alice',false,{phase:'queued',enqueuedAt:95000,startedAt:null});assert.equal(f.text.textContent,'正在等待回复 · 5秒');
  f.ui.leave();f.tick();assert.equal(f.timers.size,0);
});
test('离开会话后收到该角色完成事件，返回时不复活旧阶段或计时',()=>{
  const f=fixture();f.ui.updateTyping('alice',false,{roleId:'alice',phase:'model',startedAt:90000});f.ui.leave();
  f.ui.updateTyping('alice',false,{roleId:'alice',phase:null});f.ui.role('alice');f.ui.updateTyping('alice');
  assert.equal(f.status.hidden,true);assert.equal(f.timers.size,0);
});
test('其他角色的结束事件不清掉当前会话进度',()=>{
  const f=fixture();f.ui.updateTyping('alice',false,{roleId:'alice',phase:'model',startedAt:90000});f.ui.updateTyping('bob',false,{roleId:'bob',phase:null});
  assert.equal(f.status.hidden,false);assert.equal(f.text.textContent,'正在生成回复 · 10秒');assert.equal(f.timers.size,1);
});
test('真实SSE error/stop清除未知阶段，open查询后才恢复服务器阶段',()=>{
  const f=fixture(),streams=[];
  class Events{constructor(){this.listeners=new Map();streams.push(this);}addEventListener(name,callback){this.listeners.set(name,callback);}emit(name,status){this.listeners.get(name)?.({data:JSON.stringify(status)});}close(){this.closed=true;}}
  f.scope.EventSource=Events;f.scope.window.EventSource=Events;
  const engine=fs.readFileSync(path.join(__dirname,'../public/engine-ui.js'),'utf8'),start=engine.indexOf('  function setChatProgress('),end=engine.indexOf('  function activity(',start);
  vm.runInContext(`const ui={typing:new Set(),started:false,memCache:new Map(),memRecallResults:new Map(),activity:new Map()};let progressQueries=0;const scheduleDraftKey='',voiceDraftKey='',outreachDraftKey='';const P=()=>({getState:()=>({}),updateTyping:globalThis.ui.updateTyping,syncChatProgress(){progressQueries++;setChatProgress({roleId:'alice',typing:false,slow:false,phase:'tool',startedAt:95000});}});function task(work){work();}async function load(){return {timezone:'UTC'};}function sync(){}function removeSessionKey(){}window.PipiEngine={isTyping:id=>ui.typing.has(id)};${engine.slice(start,end)}globalThis.engine={start,stop,setChatProgress,queries:()=>progressQueries};`,f.scope);
  f.scope.engine.start();const stream=streams[0];stream.emit('typing',{roleId:'alice',typing:false,slow:false,phase:'model',startedAt:90000});assert.equal(f.status.hidden,false);assert.equal(f.timers.size,1);
  stream.emit('error');assert.equal(f.status.hidden,true);assert.equal(f.timers.size,0);
  stream.emit('open');assert.equal(f.scope.engine.queries(),1);assert.equal(f.text.textContent,'正在处理操作 · 5秒');assert.equal(f.status.hidden,false);
  f.scope.engine.stop();assert.equal(f.status.hidden,true);assert.equal(f.timers.size,0);assert.equal(stream.closed,true);
});
test('断线前已发出的GET进度晚到不复活旧阶段，重连新查询能恢复',async()=>{
  const f=fixture();let release;
  f.scope.api=()=>new Promise(resolve=>{release=resolve;});f.scope.window.PipiEngine.setChatProgress=progress=>f.ui.updateTyping(progress.roleId,progress.slow,progress);
  const start=app.indexOf('  async function syncChatProgress('),end=app.indexOf('  async function cancelChatReply(',start);
  vm.runInContext(app.slice(start,end)+'globalThis.pollProgress=syncChatProgress;',f.scope);
  f.ui.updateTyping('alice',false,{phase:'model',startedAt:90000});const pending=f.scope.pollProgress();f.ui.updateTyping(undefined,false,null);
  release({phase:'model',startedAt:90000,typing:false,slow:false});await pending;assert.equal(f.status.hidden,true);assert.equal(f.timers.size,0);
  f.scope.api=async()=>({phase:'media',operation:'image',startedAt:99000,typing:false,slow:false});await f.scope.pollProgress();assert.equal(f.text.textContent,'正在生成图片 · 1秒');assert.equal(f.status.hidden,false);
});
