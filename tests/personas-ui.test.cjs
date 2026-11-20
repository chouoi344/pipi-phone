// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/personas.js'),'utf8');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture(){
  const state={rolePersonas:[{id:'p1',name:'图书管理员',prompt:'  第一行\n第二行\n',folderId:'',createdAt:1}],personaFolders:[{id:'f1',name:'故事'}],roles:[{id:'r1',name:'小甲',rolePersonaId:'p1'},{id:'r2',name:'小乙'}]};
  const nodes=new Map(),calls=[],toasts=[];let actions=[],submit,body='',title='',form,onClose,confirm,dialog,modalOptions;
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',files:[],isConnected:true,classList:new Set(),focus(){},click(){}});return nodes.get(selector);};
  function open(label,html,handler,submitLabel,close,navigation,options){onClose=close;modalOptions=options;if(form)form.isConnected=false;nodes.clear();title=label;body=html;submit=handler;form={isConnected:true,querySelector:node,querySelectorAll:selector=>selector==='[name=roleIds]:checked'?[{value:'r2'}]:[],append(){}};}
  const view={querySelector:selector=>selector==='.rp-library'?{dataset:{folder:''}}:null,querySelectorAll:()=>[]};
  const makeDialog=()=>{const children=new Map(),events={};return {querySelector(selector){if(!children.has(selector))children.set(selector,{});return children.get(selector);},addEventListener(type,handler){events[type]=handler;},remove(){},close(){events.close?.();}};};
  const P={openChildDialog:value=>{dialog=value;return true;},closeChildDialog:()=>dialog.close(),getState:()=>state,esc,icons:{back:''},avatar:()=>'',toast:message=>toasts.push(message),act:async(type,payload)=>{calls.push({type,payload});},openPage:open,openModal:open,closeModal:()=>{form.isConnected=false;},refresh(){},actionSheet:(label,items)=>{actions=items;},confirmDialog:(title,text,handler)=>{confirm=handler;},showView:(...args)=>calls.push({view:args})};
  const scope={window:{Pipi:P},document:{createElement:makeDialog,querySelector:selector=>selector==='#view'?view:selector==='#overlay .modal-form'?form:node(selector)},TextDecoder,Uint8Array};
  vm.runInNewContext(source,scope);
  const ui=scope.window.PipiPersonas;
  function create(folderId=''){view.querySelector=selector=>selector==='.rp-library'?{dataset:{folder:folderId}}:null;view.querySelectorAll=()=>[{dataset:{rpAction:'create'},set onclick(handler){this.click=handler;nodes.set('create',this);}}];ui.bind('role-personas');nodes.get('create').click();}
  function clickCard(action,id='p1'){const target={dataset:{rpAction:action,id}};view.querySelectorAll=()=>[target];ui.bind('role-personas');target.onclick();}
  return {ui,state,calls,toasts,node,create,menu:()=>clickCard('menu'),clickCard,get actions(){return actions;},get form(){return form;},get body(){return body;},get title(){return title;},get dialog(){return dialog;},get modalOptions(){return modalOptions;},requestClose:()=>onClose?.(),discard:()=>confirm(),save:()=>submit(form)};
}
test('AI library has cards, binding names and folders, no example records or skills',()=>{
  const f=fixture(),html=f.ui.render('role-personas');
  assert.match(html,/图书管理员/);assert.match(html,/已绑定：小甲/);assert.match(html,/故事/);assert.doesNotMatch(html,/工具|技能|示例/);
  assert.match(f.ui.render('role-persona-detail','p1'),/创建时间/);
  assert.doesNotMatch(f.ui.render('role-personas','f1'),/rp-card-open/);
  assert.equal(f.ui.render('unrelated'),null);
});
test('create in current folder preserves name and original whitespace through cancellation and saves only on submit',async()=>{
  const f=fixture();f.create('f1');f.node('[name=name]').value='新角色';f.node('[name=name]').oninput();f.node('[name=prompt]').value=' \n正文\n ';f.node('[name=prompt]').oninput();assert.equal(f.calls.length,0);
  f.requestClose();assert.match(f.body,/新角色/);assert.equal(f.node('[name=prompt]').value,' \n正文\n ');await f.save();
  assert.equal(f.calls[0].type,'rolePersona.save');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload)),{name:'新角色',prompt:' \n正文\n ',folderId:'f1'});
});
test('card binding saves only changed choices using the original bindings',async()=>{
  const f=fixture();f.menu();assert.ok(!f.actions.some(action=>action.label.startsWith('绑定')));await f.actions[0].run();assert.equal(f.node('[name=prompt]').value,f.state.rolePersonas[0].prompt);
  assert.match(f.ui.render('role-personas'),/<button[^>]+data-rp-action="bind"[^>]*>已绑定：小甲<\/button>/);
  f.state.roles.push({id:'r3',name:'小丙',rolePersonaId:'p1'});
  f.clickCard('bind');assert.equal(f.title,'绑定好友');assert.ok(f.node('#overlay > .page-editor').classList.has('model-sheet'));assert.match(f.body,/name="roleIds" value="r1" checked/);assert.match(f.body,/保留原来的聊天、共同记忆和生活档案/);assert.equal(f.modalOptions.lockWhileSaving,true);assert.equal(f.calls.length,0);
  f.state.roles[1].rolePersonaId='concurrent';
  f.form.querySelectorAll=()=>[{value:'r2'},{value:'r3'}];await f.save();
  assert.equal(f.calls[0].type,'rolePersona.bind');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload)),{id:'p1',changes:[{roleId:'r1',expectedPersonaId:'p1',selected:false},{roleId:'r2',expectedPersonaId:'',selected:true}]});
});
test('TXT supports UTF8, UTF16 BOM and GB18030, previews without saving',async()=>{
  for(const bytes of [Buffer.from('  第一行\n第二行\n'),Buffer.concat([Buffer.from([255,254]),Buffer.from('  第一行\n第二行\n','utf16le')]),Buffer.from([0x20,0x20,0xd6,0xd0,0xce,0xc4,0x0a])]){
    const f=fixture();f.create();const file=f.node('#rp-file');file.files=[{name:'人物.txt',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}];await file.onchange();assert.ok(f.node('[name=prompt]').value.startsWith('  '));assert.ok(f.node('[name=prompt]').value.endsWith('\n'));assert.equal(f.calls.length,0);assert.match(f.node('#rp-file-status').textContent,/预览/);
  }
});
test('oversized TXT errors keep current draft; pending upload cannot overwrite typing or reopened editor',async()=>{
  const f=fixture();f.create();const file=f.node('#rp-file');file.files=[{name:'人物.txt',size:1024*1024+1}];await file.onchange();assert.match(f.node('#rp-file-error').textContent,/1 MB/);
  let resolve;file.files=[{name:'人物.txt',size:4,arrayBuffer:()=>new Promise(done=>resolve=done)}];const pending=file.onchange();f.node('[name=prompt]').value='刚刚输入';f.node('[name=prompt]').oninput();resolve(Buffer.from('旧文件'));await pending;assert.equal(f.node('[name=prompt]').value,'刚刚输入');assert.match(f.node('#rp-file-status').textContent,/正文已修改/);
  file.files=[{name:'人物.txt',size:4,arrayBuffer:()=>new Promise(done=>resolve=done)}];const old=file.onchange();f.create();resolve(Buffer.from('旧文件'));await old;assert.equal(f.node('[name=prompt]').value,'');
});

test('discard clears canceled edits and reopening reads current server value',async()=>{
  const f=fixture();f.menu();await f.actions[0].run();f.node('[name=prompt]').value='未保存';f.node('[name=prompt]').oninput();f.requestClose();assert.equal(f.node('[name=prompt]').value,'未保存');f.discard();f.state.rolePersonas[0].prompt='服务器新版本';f.menu();await f.actions[0].run();assert.equal(f.node('[name=prompt]').value,'服务器新版本');
});
test('TXT blocks early submit, restores button, fills empty name and rejects NUL',async()=>{
  const f=fixture();f.create();let resolve;const file=f.node('#rp-file');file.files=[{name:'故事.txt',size:8,arrayBuffer:()=>new Promise(done=>resolve=done)}];const pending=file.onchange();assert.equal(f.node('[type=submit]').disabled,true);await assert.rejects(f.save(),/正在读取 TXT/);resolve(Buffer.from('正文'));await pending;assert.equal(f.node('[type=submit]').disabled,false);assert.equal(f.node('[name=name]').value,'故事');
  f.create();const current=f.node('#rp-file');current.files=[{name:'无效.txt',size:2,arrayBuffer:async()=>Buffer.from([65,0])}];await current.onchange();assert.match(f.node('#rp-file-error').textContent,/NUL/);assert.equal(f.node('[type=submit]').disabled,false);
});

test('TXT replacement waiting and cancellation expose settled status and keep the old prompt',async()=>{
  const f=fixture();f.menu();await f.actions[0].run();const original=f.node('[name=prompt]').value,file=f.node('#rp-file');file.files=[{name:'替换.txt',size:6,arrayBuffer:async()=>Buffer.from('新正文')}];await file.onchange();assert.match(f.node('#rp-file-status').textContent,/已读取，请确认/);assert.equal(f.node('[type=submit]').disabled,false);f.dialog.querySelector('[data-cancel]').onclick();assert.equal(f.node('[name=prompt]').value,original);assert.match(f.node('#rp-file-status').textContent,/已取消导入/);assert.doesNotMatch(f.node('#rp-file-status').textContent,/正在读取/);
});

test('root with categorized personas describes its unfiled count and directory empty state',()=>{
  const f=fixture();f.state.rolePersonas[0].folderId='f1';
  const html=f.ui.render('role-personas');
  assert.match(html,/未分类人设 <span>0 份/);
  assert.match(html,/当前目录没有人设/);
  assert.match(html,/故事<\/span><small>1<\/small>/);
  assert.match(html,/data-rp-action="create"/);
  assert.doesNotMatch(html,/全部人设|还没有人设/);
  assert.match(f.ui.render('role-personas','f1'),/rp-card-open/);
  f.state.rolePersonas=[];f.state.personaFolders=[];
  const initial=f.ui.render('role-personas');
  assert.match(initial,/全部人设 <span>0 份/);assert.match(initial,/还没有人设/);
});
