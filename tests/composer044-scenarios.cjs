// SPDX-License-Identifier: MIT
'use strict';
module.exports=async function composer044(t){
  const {assert,command,evaluate,wait,click,fill,check,delay,capture}=t;
  const val=()=>evaluate('document.querySelector("#compose-text").value');
  const select=async(a,b=a)=>evaluate(`(()=>{const e=document.querySelector('#compose-text');e.focus();e.setSelectionRange(${a},${b});e.dispatchEvent(new Event('select'));})()`);
  const key=async(k,extra={})=>{
    const virtualKey={Backspace:8,Delete:46}[k],options={key:k,code:k,...(virtualKey?{windowsVirtualKeyCode:virtualKey}:{}),...extra};
    await command('Input.dispatchKeyEvent',{type:'keyDown',...options});
    await command('Input.dispatchKeyEvent',{type:'keyUp',...options});
  };
  const chat=async()=>{await evaluate("Pipi.showView('chats')");await click('[data-open-chat]');await wait('!!document.querySelector("#compose-text")');};
  const open=async()=>{if(!await evaluate('!!document.querySelector(".emoji-pages")'))await click('[data-action=toggle-emoji]');};
  const emoji='[data-emoji="[色]"]';
  await check('composer044 image mixed text middle insertion and atomic backward forward deletion',async()=>{
    await chat();await fill('#compose-text','甲乙');await select(1);await open();await click(emoji);await delay(250);assert.equal(await val(),'甲[色]乙');
    assert.deepEqual(await evaluate(`(()=>{const e=document.querySelector('#compose-text'),s=e.querySelector('[data-compose-token]');return {count:e.querySelectorAll('[data-compose-token]').length,text:e.textContent,atomic:s?.contentEditable,background:getComputedStyle(s).backgroundImage};})()`),{count:1,text:'甲乙',atomic:'false',background:'url("'+await evaluate('location.origin')+'/vendor/fake-world/emoji-sprite.png")'});
    await capture('composer044-inline-image');await select(4);await key('Backspace');assert.equal(await val(),'甲乙');
    await fill('#compose-text','甲[色]乙');await select(1);await key('Delete');assert.equal(await val(),'甲乙');
  });
  await check('composer044 selection replacement and consecutive actual pointer emoji clicks',async()=>{
    await chat();await fill('#compose-text','甲[色]乙丙');await select(1,5);await open();await click(emoji);await delay(200);assert.equal(await val(),'甲[色]丙');
    await click(emoji);await click(emoji);await delay(250);assert.equal(await val(),'甲[色][色][色]丙');
  });
  await check('composer044 real browser typing keeps caret between emoji and following text',async()=>{
    await chat();await fill('#compose-text','甲[色]乙');await select(4);await command('Input.insertText',{text:'中文'});assert.equal(await val(),'甲[色]中文乙');assert.equal(await evaluate('document.querySelector("#compose-text").selectionStart'),6);
  });
  await check('composer044 browser IME composition commits Chinese alongside image without sending',async()=>{
    await chat();await fill('#compose-text','甲[色]乙');await select(4);const before=await evaluate('JSON.stringify(Pipi.getState().messages)');
    await command('Input.imeSetComposition',{text:'zhong',selectionStart:5,selectionEnd:5});await command('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});await command('Input.insertText',{text:'中文'});await delay(120);assert.equal(await val(),'甲[色]中文乙');assert.equal(await evaluate('JSON.stringify(Pipi.getState().messages)'),before);
    await open();await click(emoji);await delay(200);assert.equal(await val(),'甲[色]中文[色]乙');
  });
  await check('composer044 route roundtrip restores image draft and mixed multiline content',async()=>{
    await chat();await fill('#compose-text','甲[色]\n乙[微笑]');await click('[data-action=back]');await click('[data-open-chat]');assert.equal(await val(),'甲[色]\n乙[微笑]');assert.equal(await evaluate('document.querySelectorAll("#compose-text [data-compose-token]").length'),2);
  });
  await check('composer044 paste replaces selection with plain text and emoji images',async()=>{
    await chat();await fill('#compose-text','甲[色]乙');await select(1,4);await evaluate(`(()=>{const d=new DataTransfer();d.setData('text/plain','中[微笑]文');document.querySelector('#compose-text').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));})()`);assert.equal(await val(),'甲中[微笑]文乙');
  });
  await check('composer044 Ctrl Z undoes browser typed text after emoji repaint',async()=>{
    await chat();await fill('#compose-text','甲');await select(1);await command('Input.insertText',{text:'乙'});assert.equal(await val(),'甲乙');await key('z',{code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});assert.equal(await val(),'甲');
  });
};

// Standalone execution reuses the existing isolated harness without editing it.
if(require.main===module&&process.argv.includes('--offline')){
  (async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
  const take=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  const scope=vm.createContext({Node:{TEXT_NODE:3,ELEMENT_NODE:1},Intl,console,window:{PipiEmoji:[{token:'[色]'},{token:'[微笑]'}]}});
  vm.runInContext(`let composeText='',composerSelection={start:0,end:0},composeComposing=false,sending=false;const route={name:'chat',arg:'isolated'},composerHistories=new Map();const emojiEntries=()=>window.PipiEmoji;const syncComposerDraft=()=>{};`+take('  let emojiSource,emojiLookup;','  function richText(')+take('  function composerDOM(input){','  function readComposerSelection')+take('  function rememberComposerEdit(','  const roleById')+take('  function insertComposerText(','  function scrollChat('),scope);
  const run=(name,code,expected)=>{assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(code,scope))),expected);console.log('PASS offline '+name);};
  run('middle insert and selection replace',`composeText='甲乙丙';composerSelection={start:1,end:2};insertComposerText('[色]');({text:composeText,cursor:composerSelection.start})`,{text:'甲[色]丙',cursor:4});
  run('atomic token deletion',`deleteComposerText();composeText`,'甲丙');
  run('grapheme family deletion',`composeText='甲👩‍👩‍👦';composerSelection={start:composeText.length,end:composeText.length};deleteComposerText();composeText`,'甲');
  run('composition blocks emoji mutation',`composeText='中文';composerSelection={start:2,end:2};composeComposing=true;insertComposerText('[色]');composeComposing=false;composeText`,'中文');
  run('DOM serialization preserves tokens and line breaks',`(()=>{const text=s=>({nodeType:3,data:s}),el=(tag,children=[],dataset={})=>{const e={nodeType:1,tagName:tag,childNodes:children,dataset};children.forEach(c=>c.parentNode=e);return e;};const root=el('DIV',[text('甲'),el('SPAN',[],{composeToken:'[色]'}),el('BR'),text('乙')]);const m=composerDOM(root);return {text:m.text,tokenEnd:m.offset(root,2),after:m.point(4)[1]};})()`,{text:'甲[色]\n乙',tokenEnd:4,after:2});
  const before=take("      input.addEventListener('beforeinput',event=>{","      input.addEventListener('paste'");
  const recorded={};scope.input={addEventListener:(name,fn)=>recorded[name]=fn};scope.rememberSelection=()=>{};scope.sendMessage=()=>{};scope.useKeyboard=()=>{};
  vm.runInContext(before,scope);
  vm.runInContext("composeText='甲';composerSelection={start:1,end:1};insertComposerText('[色]');",scope);
  let failed=0;
  const regression=(name,fn)=>{try{fn();console.log('PASS offline '+name);}catch(e){failed++;console.log('FAIL offline '+name+': '+e.message);}};
  const dispatch=inputType=>{let prevented=false;recorded.beforeinput({inputType,cancelable:true,preventDefault(){prevented=true;}});return prevented;};
  regression('historyUndo emoji restores text and caret',()=>{assert.equal(dispatch('historyUndo'),true);assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify({text:composeText,selection:composerSelection})',scope)),{text:'甲',selection:{start:1,end:1}});});
  regression('historyRedo emoji restores text and caret',()=>{assert.equal(dispatch('historyRedo'),true);assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify({text:composeText,selection:composerSelection})',scope)),{text:'甲[色]',selection:{start:4,end:4}});});
  regression('ordinary insertText beforeinput captures undo state',()=>{
    vm.runInContext("composerHistories.clear();composeText='甲[色]乙';composerSelection={start:4,end:4};",scope);dispatch('insertText');
    assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(composerHistories.get(route.arg)?.undo||[])",scope)),[{text:'甲[色]乙',selection:{start:4,end:4}}]);
    // Mimic the browser's edit plus app input acceptance after beforeinput.
    vm.runInContext("composeText='甲[色]中乙';composerSelection={start:5,end:5};",scope);dispatch('historyUndo');
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify({text:composeText,selection:composerSelection})',scope)),{text:'甲[色]乙',selection:{start:4,end:4}});
    dispatch('historyRedo');assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify({text:composeText,selection:composerSelection})',scope)),{text:'甲[色]中乙',selection:{start:5,end:5}});
  });
  regression('composition callbacks create one undo unit and preserve redo caret',()=>{
    scope.syncComposerControls=()=>{};scope.resizeComposeInput=()=>{};scope.requestAnimationFrame=fn=>fn();scope.acceptInput=()=>{};scope.readComposerText=()=>scope.input.text;
    vm.runInContext('let recordingSession=null,deferredComposerUpdate=false;',scope);
    const at=source.indexOf("      input.addEventListener('compositionstart'");
    vm.runInContext(source.slice(at,source.indexOf('      input.onkeydown',at)),scope);
    vm.runInContext("composerHistories.clear();composeText='甲[色]乙';composerSelection={start:4,end:4};",scope);
    recorded.compositionstart();dispatch('insertCompositionText');scope.input.isConnected=true;scope.input.text='甲[色]中文乙';vm.runInContext('composerSelection={start:6,end:6};',scope);recorded.compositionend();
    assert.equal(vm.runInContext('composerHistories.get(route.arg).undo.length',scope),1);dispatch('historyUndo');
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify({text:composeText,selection:composerSelection})',scope)),{text:'甲[色]乙',selection:{start:4,end:4}});
    dispatch('historyRedo');assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify({text:composeText,selection:composerSelection})',scope)),{text:'甲[色]中文乙',selection:{start:6,end:6}});
  });
  regression('new edit after undo invalidates redo',()=>{
    dispatch('historyUndo');vm.runInContext("insertComposerText('[微笑]');",scope);const current=vm.runInContext('composeText',scope);dispatch('historyRedo');assert.equal(vm.runInContext('composeText',scope),current);assert.equal(vm.runInContext('composerHistories.get(route.arg).redo.length',scope),0);
  });
  regression('history belongs to role and cannot restore while sending',()=>{
    vm.runInContext("route.arg='other';composeText='other';composerSelection={start:5,end:5};",scope);dispatch('historyUndo');assert.equal(vm.runInContext('composeText',scope),'other');
    vm.runInContext("insertComposerText('!');sending=true;",scope);dispatch('historyUndo');assert.equal(vm.runInContext('composeText',scope),'other!');vm.runInContext('sending=false;',scope);dispatch('historyUndo');assert.equal(vm.runInContext('composeText',scope),'other');
  });
  const sendFixture=()=>{
    let sequence=0;const requests=[];
    const context=vm.createContext({crypto:{randomUUID:()=> 'isolated-request-'+(++sequence)},api:()=>new Promise((accept,reject)=>requests.push({accept,reject}))});
    vm.runInContext(`const window={},state={messages:[]},route={name:'chat',arg:'sent'},drafts=new Map([['sent',{text:'old'}],['other',{text:'other'}]]),composerHistories=new Map([['sent',{undo:[{text:'old'}]}],['other',{undo:[{text:'other'}]}]]),pendingDraftSends=new Map(),chatScrolls=new Map();let composeComposing=false,recordingSession=null,composeText='old',composeImage='',composeStickerId='',quoteId='',composerSelection={start:3,end:3},panel='',forceBottomRole='';function roleById(id){return {id};}function updateComposer(){}function receiveState(){}function toast(){}function refresh(){};`+take('  async function sendMessage(','  async function retryMessage('),context);
    return {context,accept:(index=0)=>requests[index].accept({state:{messages:[]}}),reject:(index=0)=>requests[index].reject(new Error('本机拒绝请求')),run:()=>vm.runInContext('sendMessage()',context),read:expression=>{const value=vm.runInContext('JSON.stringify('+expression+')',context);return value===undefined?undefined:JSON.parse(value);}};
  };
  const sendRegression=async(name,fn)=>{try{await fn();console.log('PASS offline '+name);}catch(error){failed++;console.log('FAIL offline '+name+': '+error.message);}};
  await sendRegression('successful send clears its matching draft and history, preserving another friend',async()=>{
    const f=sendFixture(),pending=f.run();f.accept();await pending;
    assert.equal(f.read("drafts.has('sent')"),false);assert.equal(f.read("composerHistories.has('sent')"),false);
    assert.deepEqual(f.read("drafts.get('other')"),{text:'other'});assert.deepEqual(f.read("composerHistories.get('other')"),{undo:[{text:'other'}]});
  });
  await sendRegression('late successful send preserves the newer active draft and its undo history',async()=>{
    const f=sendFixture(),pending=f.run();
    vm.runInContext("composeText='new';drafts.set('sent',{text:'new'});composerHistories.set('sent',{undo:[{text:'new'}]});",f.context);
    f.accept();await pending;assert.equal(f.read('composeText'),'new');assert.deepEqual(f.read("drafts.get('sent')"),{text:'new'});assert.deepEqual(f.read("composerHistories.get('sent')"),{undo:[{text:'new'}]});
  });
  await sendRegression('late successful send after changing friends preserves both updated drafts',async()=>{
    const f=sendFixture(),pending=f.run();
    vm.runInContext("route.arg='other';composeText='other new';drafts.set('sent',{text:'new'});composerHistories.set('sent',{undo:[{text:'new'}]});drafts.set('other',{text:'other new'});",f.context);
    f.accept();await pending;assert.equal(f.read('composeText'),'other new');assert.deepEqual(f.read("drafts.get('sent')"),{text:'new'});assert.deepEqual(f.read("drafts.get('other')"),{text:'other new'});assert.deepEqual(f.read("composerHistories.get('sent')"),{undo:[{text:'new'}]});
  });
  await sendRegression('failed send restores the matching draft and preserves its undo history',async()=>{
    const f=sendFixture(),pending=f.run();f.reject();await pending;
    assert.equal(f.read('composeText'),'old');assert.deepEqual(f.read("composerHistories.get('sent')"),{undo:[{text:'old'}]});assert.deepEqual(f.read("composerHistories.get('other')"),{undo:[{text:'other'}]});
  });
  await sendRegression('request preparation failure also restores the draft and undo history',async()=>{
    const f=sendFixture();vm.runInContext("crypto.randomUUID=()=>{throw new Error('本机模拟请求准备失败');};",f.context);await f.run();
    assert.equal(f.read('composeText'),'old');assert.deepEqual(f.read("composerHistories.get('sent')"),{undo:[{text:'old'}]});assert.equal(f.read('pendingDraftSends.size'),0);
  });
  await sendRegression('failed send after changing friends restores only the original empty saved draft',async()=>{
    const f=sendFixture(),pending=f.run();
    vm.runInContext("route.arg='other';composeText='other new';drafts.set('sent',{text:'',image:'',panel:'more'});",f.context);
    f.reject();await pending;assert.equal(f.read('composeText'),'other new');assert.equal(f.read("drafts.get('sent').text"),'old');assert.equal(f.read("drafts.get('sent').panel"),'more');assert.deepEqual(f.read("composerHistories.get('sent')"),{undo:[{text:'old'}]});assert.deepEqual(f.read("composerHistories.get('other')"),{undo:[{text:'other'}]});
  });
  for(const text of ['new',''])await sendRegression('late failed send preserves newer '+(text?'text':'cleared input')+' and history',async()=>{
    const f=sendFixture(),pending=f.run();
    vm.runInContext(`composeText=${JSON.stringify(text)};composerHistories.set('sent',{undo:[{text:'new'}]});`,f.context);
    f.reject();await pending;assert.equal(f.read('composeText'),text);assert.deepEqual(f.read("composerHistories.get('sent')"),{undo:[{text:'new'}]});
  });
  for(const secondCompleted of [false,true])await sendRegression('old failed request cannot restore a draft after a newer send '+(secondCompleted?'completed':'started'),async()=>{
    const f=sendFixture(),first=f.run();
    vm.runInContext("composeText='new';composerHistories.set('sent',{undo:[{text:'new'}]});",f.context);const second=f.run();
    if(secondCompleted){f.accept(1);await second;}
    f.reject();await first;assert.equal(f.read('composeText'),'');assert.equal(f.read("drafts.has('sent')"),false);assert.equal(f.read("composerHistories.has('sent')"),false);
    if(!secondCompleted){f.accept(1);await second;}
    assert.equal(f.read('pendingDraftSends.size'),0);
  });
  process.exitCode=failed?1:0;
  console.log('Offline scope: actual extracted app functions + minimal DOM nodes; no rendering, browser editing, OS IME, or persistence proof.');
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else if(require.main===module){
  const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
  process.argv.push('--only=composer044');
  let source=fs.readFileSync(path.join(__dirname,'headless-ui.cjs'),'utf8');
  source=source.replace(/  await require\('\.\/(?!native-scenarios)[^']+-scenarios\.cjs'\)\([^\n]+\);/g,'');
  source=source.replace("  await command('DOM.enable');await command('CSS.enable');", "  await require('./composer044-scenarios.cjs')({assert,command,evaluate,wait,click,fill,capture,check,delay,metrics,deviceScaleFactor,onCDP,out});\n  await command('DOM.enable');await command('CSS.enable');");
  const m=new Module(path.join(__dirname,'headless-ui.cjs'),module);m.filename=path.join(__dirname,'headless-ui.cjs');m.paths=module.paths;m._compile(source,m.filename);
}
