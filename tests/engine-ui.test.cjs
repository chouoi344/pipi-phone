// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/engine-ui.js'),'utf8');
const modelSettings=fs.readFileSync(path.join(__dirname,'../public/model-settings.js'),'utf8');
const caption=require('../lib/engine/modules/caption.cjs');
const compression=require('../lib/engine/modules/compression.cjs');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(overrides={}) {
  const calls=[],nodes=new Map(),groups=new Map(),events=[],toasts=[];
  const ai={sources:[{id:'pipi',name:'屁屁自己的站',baseUrl:'',builtin:true,keySet:false},{id:'custom',name:'我的服务',baseUrl:'https://saved.invalid/v1',keySet:true}],models:[],assign:{chat:'',chatFallbacks:[],compress:'',caption:'',stt:'',tts:'',image:'',embedding:''}};
  const config={ai,builtinModels:{},catalog:{},modules:[caption,compression],settings:{caption:{prompt:caption.settings[0].default},compression:Object.fromEntries(compression.settings.map(setting=>[setting.key,setting.default]))},timezone:'Asia/Shanghai',usage:[],...overrides};
  let state={revision:1,settings:{ai:config.ai,timezone:config.timezone},roles:[{id:'alice',name:'小甲',stickers:[]}]},refreshes=0;
  const document={querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>groups.get(selector)||[]};
  nodes.set('#view',{dataset:{route:'providers'},querySelector:document.querySelector,querySelectorAll:document.querySelectorAll});
  class Events {constructor(url){this.url=url;this.listeners=new Map();events.push(this);}addEventListener(name,callback){this.listeners.set(name,callback);}close(){this.closed=true;}emit(name,data){this.listeners.get(name)?.({data:JSON.stringify(data)});}}
  const P={esc:escape,getState:()=>state,icons:{back:'←',chevron:'›',add:'+'},toast:text=>toasts.push(text),refresh:()=>refreshes++,setState:next=>{state=next;},receiveState:next=>{state=next;},updateTyping:id=>calls.push({typing:id}),showView:(name,arg)=>calls.push({view:name,arg}),
    api:async(route,body)=>{calls.push({route,body});if(route==='/api/engine/config')return structuredClone(config);if(route==='/api/engine/models/metadata'){const info=config.catalog?.[body.model]||{known:false,capabilities:['text','image','audio','tool_use'],maxContextTokens:0};return {timeoutSeconds:120,...info,capacity:{value:body.maxContextTokens||info.maxContextTokens||128000,source:body.maxContextTokens?'manual':info.maxContextTokens?'metadata':'fallback',recognized:!body.maxContextTokens&&!!info.maxContextTokens}};}if(route==='/api/engine/models/list')return {models:[{id:'unknown-chat',model:'unknown-chat',capabilities:['text'],maxContextTokens:0},{id:'gpt-4.1',model:'gpt-4.1',capabilities:['text','image','tool_use'],maxContextTokens:1047576,recommended:true}]};if(route==='/api/engine/models')config.ai=structuredClone(body.ai);
      if(route==='/api/engine/models/card'){
        const next=structuredClone(config.ai),index=next.sources.findIndex(source=>source.id===body.source.id);
        if(index<0)next.sources.push(structuredClone(body.source));else Object.assign(next.sources[index],structuredClone(body.source));
        const models=new Map(next.models.map(model=>[model.id,model]));
        for(const [id,model] of body.updates)if(model)models.set(id,structuredClone(model));else models.delete(id);
        next.models=[...models.values()];Object.assign(next.assign,structuredClone(body.assign));config.ai=next;
      }
      if(route==='/api/engine/models/assign')config.ai={...config.ai,assign:{...config.ai.assign,...structuredClone(body.assign)}};
      if(route.startsWith('/api/engine/models')&&route!=='/api/engine/models/metadata')state={...state,revision:state.revision+1,settings:{...state.settings,ai:config.ai}};
      if(route==='/api/engine/modules')config.settings[body.id]={...config.settings[body.id],...structuredClone(body.values)};return {state};}};
  let clock=10000;class Clock extends Date {static now(){return clock;}}
  const session=new Map(),sessionStorage={getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)};
  const window={Pipi:P,EventSource:Events},context=vm.createContext({window,document,sessionStorage,EventSource:Events,console,Intl,Date:Clock,performance:{now:()=>clock},CSS:{escape:value=>value},crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,FormData:class{constructor(form){this.entries=Object.entries(form.values||{});}*[Symbol.iterator](){yield* this.entries;}getAll(key){return this.entries.filter(([name])=>name===key).flatMap(([,value])=>value);}}});
  vm.runInContext(modelSettings,context);vm.runInContext(source,context);await window.PipiEngine.refreshConfig();
  return {engine:window.PipiEngine,models:window.PipiModels,P,config,calls,nodes,groups,events,toasts,document,advance:ms=>clock+=ms,get state(){return state;},get refreshes(){return refreshes;}};
}
function editorHarness(f){
  const nodes=new Map([['#model-capacity-status',{}],['[name="model"]',{value:''}],['[name="timeoutSeconds"]',{}]]),groups=new Map();
  const root={isConnected:true,classList:{add(){}},querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>groups.get(selector)||[]};
  f.nodes.set('#overlay > .page-editor',root);f.nodes.set('.page-editor',root);
  let current,closed=0;
  f.P.openPage=f.P.openModal=f.P.openNestedPage=(title,html,save,label)=>{current={title,html,save,label};};
  f.P.closePage=()=>closed++;
  return {root,nodes,groups,get current(){return current;},get closed(){return closed;}};
}
function modelEntry(id,overrides={}){return {id,sourceId:'custom',model:id,kind:'chat',capabilities:['text'],maxContextTokens:32000,temperature:.7,maxTokens:800,timeoutSeconds:60,extraBody:{seed:9},voice:'',...overrides};}
function chatModelEditor(f){
  const editor=editorHarness(f);
  editor.nodes.set('[name="model"]',{value:'edited'});
  editor.nodes.set('[name="maxContextTokens"]',{value:'0'});
  editor.nodes.set('.modal-error',{before(){}});
  f.nodes.set('#overlay',{});
  f.document.createElement=()=>({append(){}});
  return editor;
}
function chatModelForm(overrides={}){
  return {isConnected:true,values:{model:'edited',maxContextTokens:'0',temperature:'',maxTokens:'',timeoutSeconds:'',extraBody:'{}',...overrides},querySelectorAll:()=>[{value:'text'}]};
}
test('model confirmation validates numeric ranges and JSON size before updating the draft',async()=>{
  const f=await fixture(),editor=chatModelEditor(f),confirmed=[];
  f.engine.editModel('edited',{draftModel:modelEntry('edited'),onConfirm:model=>confirmed.push(model)});
  const invalid=[
    [{temperature:'2.01'},/温度/],
    [{maxTokens:'1.5'},/最大回复长度/],
    [{maxTokens:'10000001'},/最大回复长度/],
    [{maxContextTokens:'-1'},/上下文容量/],
    [{maxContextTokens:'100000001'},/上下文容量/],
    [{timeoutSeconds:'601'},/超时/],
    [{extraBody:'[]'},/JSON 对象/],
    [{extraBody:JSON.stringify({long:'a'.repeat(32768)})},/32768 字符/]
  ];
  for(const [values,expected] of invalid)await assert.rejects(editor.current.save(chatModelForm(values)),expected);
  assert.equal(confirmed.length,0);assert.equal(editor.closed,0);
  await editor.current.save(chatModelForm({maxContextTokens:''}));
  assert.equal(confirmed.length,1);assert.equal(editor.closed,1);
  assert.equal(confirmed[0].maxContextTokens,0);assert.equal(confirmed[0].temperature,null);
  assert.equal(confirmed[0].maxTokens,null);assert.equal(confirmed[0].timeoutSeconds,null);
});
test('model confirmation discards the old submit after cancel or opening a different modal during metadata lookup',async()=>{
  for(const cancel of [true,false]){
    const f=await fixture(),editor=chatModelEditor(f),confirmed=[];
    let resolveMetadata;
    f.P.api=()=>new Promise(resolve=>{resolveMetadata=resolve;});
    f.engine.editModel('edited',{draftModel:modelEntry('edited'),onConfirm:model=>confirmed.push(model)});
    const form=chatModelForm(),pending=editor.current.save(form);
    if(cancel){form.isConnected=false;editor.root.isConnected=false;}
    else f.nodes.set('#overlay > .page-editor',{isConnected:true});
    resolveMetadata({timeoutSeconds:120,capabilities:['text'],capacity:{value:128000,source:'fallback',recognized:false}});
    await pending;
    assert.equal(confirmed.length,0);assert.equal(editor.closed,0);assert.equal(f.refreshes,0);
  }
});
test('model saves accept sanitized settings from the response without a second read',async()=>{
  const f=await fixture(),next=structuredClone(f.config.ai);
  next.models.push(modelEntry('saved'));
  f.calls.length=0;
  const updated=await f.engine.saveModels(next);
  assert.deepEqual(f.calls.map(call=>call.route),['/api/engine/models']);
  assert.equal(updated.ai.models[0].id,'saved');
  assert.equal(f.engine.serviceReady('tts'),false);
  const setting=structuredClone(f.state);
  setting.settings.ai.models[0].kind='tts';setting.settings.ai.assign.tts='saved';
  assert.equal(f.engine.acceptConfig({state:setting}).ai.assign.tts,'saved');
  assert.equal(f.engine.serviceReady('tts'),true);
  setting.settings.ai.models[0].enabled=false;
  assert.equal(f.engine.serviceReady('tts'),false);
  setting.settings.ai.models[0].enabled=true;setting.settings.ai.sources[1].baseUrl='';
  assert.equal(f.engine.serviceReady('tts'),false);
  setting.settings.ai.sources[1].baseUrl='https://saved.invalid/v1';setting.settings.ai.sources[1].keySet=false;
  assert.equal(f.engine.serviceReady('tts'),false);
});
test('a configuration read started before saving cannot replace the accepted model settings',async()=>{
  const f=await fixture(),previous=structuredClone(f.config),next=structuredClone(f.config.ai),api=f.P.api;
  let completeRead;
  f.P.api=(route,body)=>route==='/api/engine/config'?new Promise(resolve=>{completeRead=resolve;}):api(route,body);
  const pending=f.engine.refreshConfig();
  next.models.push(modelEntry('new-speech',{kind:'tts'}));next.assign.tts='new-speech';
  await f.engine.saveModels(next);
  completeRead(previous);
  const updated=await pending;
  assert.equal(updated.ai.assign.tts,'new-speech');
  assert.equal(f.engine.serviceReady('tts'),true);
});
function providerControls(f){
  for(const selector of ['[data-provider-add]','#model-relay'])f.nodes.set(selector,{});
}
function providerCardHarness(f,kind='chat',sourceId='custom'){
  const editor=chatModelEditor(f),controls=new Map(),body={innerHTML:'',querySelector:()=>null};
  const header={querySelector:selector=>controls.get(selector)},form={dataset:{providerForm:sourceId},isConnected:true,previousElementSibling:header,querySelector:selector=>controls.get(selector)||null};
  for(const selector of ['.source-copy strong','.source-copy small','[data-provider-menu]','[data-provider-status]','[data-provider-fetch]','[data-provider-error]','[data-provider-reset]','[data-provider-key-note]','[data-provider-manual]','fieldset'])controls.set(selector,{setAttribute(){}});
  controls.set('[data-provider-query]',{value:''});controls.set('[data-provider-models-body]',body);
  const categories=['chat','stt','tts','image','decision','embedding','rerank'].map(modelCategory=>({dataset:{modelCategory}}));
  f.groups.set('[data-model-category]',categories);providerControls(f);
  let html='';
  function render(){
    html=f.engine.render('providers');
    f.groups.set('[data-provider-toggle]',[...html.matchAll(/data-provider-toggle="([^"]+)"/g)].map(([,providerToggle])=>({dataset:{providerToggle}})));
    const id=html.match(/data-provider-form="([^"]+)"/)?.[1];
    if(id){form.dataset.providerForm=id;f.nodes.set('[data-provider-form]',form);}else f.nodes.delete('[data-provider-form]');
    f.engine.bind('providers');return html;
  }
  f.P.refresh=render;render();categories.find(tab=>tab.dataset.modelCategory===kind).onclick();
  function toggle(id){f.groups.get('[data-provider-toggle]').find(button=>button.dataset.providerToggle===id).onclick();}
  toggle(sourceId);
  return {editor,body,form,controls,render,toggle,get html(){return html;},
    input(name,value,type='text'){form.oninput({target:{name,value,type}});},
    action(dataset){body.onclick({target:{closest:()=>({dataset})}});},
    fetch:()=>controls.get('[data-provider-fetch]').onclick(),
    save:()=>form.onsubmit({preventDefault(){}}),
    addCandidate(name){this.action({providerCandidate:name});editor.nodes.get('[name="model"]').value=name;},
    confirm:async function(values={},capabilities=['text']){const modelForm=chatModelForm({model:editor.nodes.get('[name="model"]').value,...values});modelForm.querySelectorAll=()=>capabilities.map(value=>({value}));await editor.current.save(modelForm);render();}
  };
}
function stationEditor(f){
  const editor=editorHarness(f);
  editor.nodes.set('.modal-submit',{classList:{add(){}}});
  editor.nodes.set('.relay-submit',{append(){}});editor.nodes.set('.modal-header',{append(){}});
  f.document.createElement=()=>({});providerControls(f);f.engine.render('providers');f.engine.bind('providers');
  editor.open=()=>f.nodes.get('#model-relay').onclick();return editor;
}

test('engine UI memory: read failure remains visible and retry loads cards',async()=>{
  const f=await fixture();let fail=true,reads=0;
  f.P.api=async()=>{reads++;if(fail)throw new Error('记忆读取失败');return {cards:[{id:'one',content:'喜欢喝热茶',memoryType:'PREFERENCE',locked:true}],profile:{basic:{nickname:'保留的画像'}}};};
  assert.match(f.engine.render('memories','alice'),/正在读取记忆/);await turn();
  assert.match(f.engine.render('memories','alice'),/记忆读取失败/);await turn();assert.equal(reads,1);
  const retry={};f.nodes.set('#lm-retry',retry);f.engine.bind('memories','alice');fail=false;retry.onclick();
  f.engine.render('memories','alice');await turn();assert.match(f.engine.render('memories','alice'),/喜欢喝热茶/);assert.equal(reads,2);
});

test('engine UI memory: recall results and query belong to each friend',async()=>{
  const f=await fixture();f.state.roles.push({id:'bob',name:'小乙'});
  f.P.api=async()=>({cards:[{id:'tea',content:'小甲记得喝茶的约定',memoryType:'PLAN'}]});
  const tab={dataset:{memTab:'recall'}},form={elements:{query:{value:'还记得喝茶吗'}}};
  f.groups.set('[data-mem-tab]',[tab]);f.nodes.set('#lm-recall-form',form);f.engine.bind('memories','alice');tab.onclick();
  form.onsubmit({preventDefault(){}});await turn();
  assert.match(f.engine.render('memories','alice'),/小甲记得喝茶的约定/);
  assert.doesNotMatch(f.engine.render('memories','bob'),/小甲记得喝茶的约定|value="还记得喝茶吗"/);
  assert.match(f.engine.render('memories','alice'),/value="还记得喝茶吗"/);
});
test('engine UI models: provider categories and home preferences expose one settings entry per purpose',async()=>{
  const f=await fixture(),html=f.engine.render('providers');providerControls(f);f.engine.bind('providers');
  assert.match(html,/屁屁自己的站/);assert.match(html,/语音转文字/);assert.match(html,/重排序/);assert.equal((html.match(/data-model-category=/g)||[]).length,7);assert.doesNotMatch(html,/name="temperature"/);
  assert.doesNotMatch(html,/id="engine-model-extras"|id="model-advanced"|name="chat"|name="stt"|name="tts"/);
  const home=f.engine.render('engine-home');
  for(const key of ['chat','fallbacks','caption','strategy','compress','triggerRatio','keepRecentRatio','maxTurns','dropTurns','prompt'])assert.equal((home.match(new RegExp('data-model-pref="'+key+'"','g'))||[]).length,1,key);
  assert.doesNotMatch(home,/主动消息|朋友圈|更多设置|NaN/);assert.doesNotMatch(f.engine.render('engine-functions'),/长对话整理/);
});
test('图片转述要求在模型选择下方编辑，旧入口显示同一设置页',async()=>{
  const f=await fixture(),home=f.engine.render('engine-home');
  assert.match(home,/data-model-pref="caption"[\s\S]*?<\/button>\s*<form id="caption-preferences-form"/);
  assert.equal(f.engine.render('engine-module','caption'),home);
  assert.doesNotMatch(f.engine.render('engine-functions'),/data-module="caption"/);
  const prompt={value:'只转述图片文字',focus(){}},button={disabled:true},details={open:false},summary={},preview={};
  const form={elements:{prompt},querySelector:selector=>({'[type="submit"]':button,details,summary,'.caption-prompt-preview':preview})[selector]};
  f.nodes.set('#caption-preferences-form details[open]',details);
  f.nodes.set('#caption-preferences-form',form);
  f.engine.bind('engine-home');summary.onclick({preventDefault(){}});prompt.oninput();
  assert.equal(details.open,true);
  assert.equal(preview.textContent,prompt.value);
  assert.equal(button.disabled,false);
  await form.onsubmit({preventDefault(){}});
  assert.equal(details.open,false);
  assert.equal(f.config.settings.caption.prompt,prompt.value);
  assert.match(f.engine.render('engine-home'),/只转述图片文字<\/textarea>/);
  assert.equal(f.calls.filter(call=>call.route==='/api/engine/modules').length,1);
});
test('engine UI models: adding provider edits an inline draft and sends the actual values only on card save',async()=>{
  const f=await fixture(),card=providerCardHarness(f),editor=card.editor;
  const choice={dataset:{template:'compatible'}},search={};editor.nodes.set('#model-provider-search',search);editor.groups.set('[data-template]',[choice]);
  f.nodes.get('[data-provider-add]').onclick();assert.equal(editor.current.title,'添加对话服务商');
  assert.equal(f.calls.some(c=>c.route==='/api/engine/models/card'),false);
  f.P.closePage();assert.equal(f.config.ai.sources.length,2);
  f.nodes.get('[data-provider-add]').onclick();choice.onclick();
  assert.match(card.html,/data-provider-form=/);assert.match(card.html,/name="key" type="password"/);
  assert.equal(f.calls.some(c=>c.route==='/api/engine/models/card'),false);
  card.input('name','另一服务');card.input('baseUrl','https://new.invalid/v1');card.input('key','ISOLATED_KEY');
  assert.match(card.render(),/另一服务/);await card.save();
  const saved=f.calls.find(c=>c.route==='/api/engine/models/card').body;
  assert.equal(saved.source.name,'另一服务');assert.equal(saved.source.template,'compatible');assert.equal(saved.source.key,'ISOLATED_KEY');
  assert.equal(saved.expectedExisting,false);assert.equal(f.config.ai.sources[1].baseUrl,'https://saved.invalid/v1');assert.equal(f.config.ai.sources.length,3);
});

test('engine UI models: fetching and confirming candidates preserves existing parameters and fallbacks until card save',async()=>{
  const f=await fixture(),old=modelEntry('old');f.config.ai.models=[old];f.config.ai.assign={...f.config.ai.assign,chat:'old',chatSelections:['old'],chatFallbacks:['old']};await f.engine.refreshConfig();
  const card=providerCardHarness(f);await card.fetch();
  assert.equal(f.calls.find(c=>c.route==='/api/engine/models/list').body.sourceId,'custom');
  assert.doesNotMatch(card.body.innerHTML,/data-provider-candidate="old"/);card.addCandidate('gpt-4.1');
  assert.equal(card.editor.current.title,'添加模型');await card.confirm({},['text','image','tool_use']);
  assert.equal(f.config.ai.models.length,1);assert.equal(f.calls.some(c=>c.route==='/api/engine/models/card'),false);
  await card.save();const saved=f.config.ai;
  assert.deepEqual(saved.models[0],old);assert.equal(saved.models.length,2);assert.deepEqual(saved.assign.chatFallbacks,['old']);assert.equal(saved.assign.chatSelections.length,1);
  assert.equal(saved.assign.chat,'old');assert.equal(saved.models[1].model,'gpt-4.1');assert.deepEqual(saved.models[1].capabilities,['text','image','tool_use']);assert.equal(saved.sources[1].keySet,true);
});

test('engine UI models: home primary and caption choices preserve other assignments and saved providers',async()=>{
  const f=await fixture();f.config.ai.models=['one','two','three','four','five'].map(id=>modelEntry(id));
  f.config.ai.models[4].capabilities=['text','image'];f.config.ai.sources[1].key='ISOLATED_KEY';
  f.config.ai.models.push(modelEntry('paused',{enabled:false}));
  f.config.ai.assign={...f.config.ai.assign,chat:'one',chatSelections:['one','two','three','four'],chatFallbacks:['two'],compress:'three',voiceUnderstanding:'voice'};await f.engine.refreshConfig();
  const original=structuredClone(f.config.ai),editor=editorHarness(f),control={dataset:{modelPref:'chat'}};
  f.groups.set('[data-model-pref]',[control]);f.engine.render('engine-home');f.engine.bind('engine-home');control.onclick();
  assert.match(editor.current.html,/name="preference-model" value="four"/);assert.match(editor.current.html,/value="five"/);assert.doesNotMatch(editor.current.html,/type="checkbox"|value="paused"/);
  assert.equal(f.calls.some(call=>call.route==='/api/engine/models'),false);
  const choice=value=>({isConnected:true,querySelector:selector=>selector==='[name="preference-model"]:checked'?{value}:null});
  await editor.current.save(choice('two'));
  assert.deepEqual(structuredClone(f.config.ai),{...original,assign:{...original.assign,chat:'two'}});
  f.engine.render('engine-home');control.dataset.modelPref='caption';f.engine.bind('engine-home');control.onclick();
  assert.match(editor.current.html,/value="five"/);assert.doesNotMatch(editor.current.html,/value="one"/);await editor.current.save(choice('five'));
  assert.deepEqual(structuredClone(f.config.ai),{...original,assign:{...original.assign,chat:'two',caption:'five'}});
  assert.equal(editor.closed,2);assert.equal(f.calls.some(call=>call.route==='/api/engine/models/test'),false);
});

test('engine UI models: fallback edits stay local on cancel and save in the chosen order',async()=>{
  const f=await fixture(),editor=editorHarness(f),control={dataset:{modelPref:'fallbacks'}};
  f.config.ai.models=['one','two','three'].map(id=>modelEntry(id));f.config.ai.assign.chat='one';f.config.ai.assign.chatFallbacks=['two','one'];await f.engine.refreshConfig();
  const before=structuredClone(f.config.ai),checks=f.config.ai.models.map(model=>({checked:false,dataset:{fallbackChoice:model.id}}));
  const move={dataset:{fallbackMove:'1',direction:'-1'}},root={innerHTML:'',querySelectorAll:selector=>selector==='[data-fallback-choice]'?checks:selector==='[data-fallback-move]'?[move]:[]};
  f.nodes.set('#model-fallback-choices',root);f.groups.set('[data-model-pref]',[control]);f.engine.render('engine-home');f.engine.bind('engine-home');control.onclick();
  checks[2].checked=true;checks[2].onchange();move.onclick();assert.deepEqual(f.config.ai,before);assert.equal(f.calls.some(call=>call.route==='/api/engine/models'),false);
  // Closing the sheet discards its local selection; opening it again starts from saved values.
  f.P.closePage();control.onclick();assert.doesNotMatch(root.innerHTML,/3\. three/);
  checks[2].checked=true;checks[2].onchange();move.onclick();checks[1].checked=false;checks[1].onchange();await editor.current.save({isConnected:true});
  assert.deepEqual(structuredClone(f.config.ai),{...before,assign:{...before.assign,chatFallbacks:['one','three']}});
});

test('engine UI models: context strategy and parameters save only the selected field',async()=>{
  const f=await fixture(),editor=editorHarness(f),control={dataset:{modelPref:'strategy'}};
  f.config.settings.memory={enabled:false};f.config.settings.compression.prompt='原整理要求';await f.engine.refreshConfig();
  const before=structuredClone(f.config.settings),aiBefore=structuredClone(f.config.ai);
  f.groups.set('[data-model-pref]',[control]);f.engine.render('engine-home');f.engine.bind('engine-home');control.onclick();
  assert.match(editor.current.html,/value="summary" checked/);assert.match(editor.current.html,/value="truncate"/);
  assert.equal(f.calls.some(call=>call.route==='/api/engine/modules'),false);
  await editor.current.save({querySelector:selector=>selector==='[name="strategy"]:checked'?{value:'truncate'}:null});
  assert.deepEqual(structuredClone(f.calls.find(call=>call.route==='/api/engine/modules').body),{id:'compression',values:{strategy:'truncate'}});
  assert.deepEqual(f.config.settings,{...before,compression:{...before.compression,strategy:'truncate'}});
  const cropped=f.engine.render('engine-home');assert.match(cropped,/按轮次裁剪/);assert.doesNotMatch(cropped,/data-model-pref="compress"|data-model-pref="keepRecentRatio"|data-model-pref="prompt"/);
  for(const [key,input,value]of [['triggerRatio','90',.9],['maxTurns','12',12],['dropTurns','2',2]]){
    control.dataset.modelPref=key;f.engine.bind('engine-home');control.onclick();await editor.current.save({elements:{value:{value:input}}});
    assert.deepEqual(structuredClone(f.calls.filter(call=>call.route==='/api/engine/modules').at(-1).body),{id:'compression',values:{[key]:value}});
  }
  control.dataset.modelPref='strategy';f.engine.bind('engine-home');control.onclick();await editor.current.save({querySelector:()=>({value:'summary'})});
  for(const [key,input,value]of [['keepRecentRatio','20',.2],['prompt','新的整理要求','新的整理要求']]){
    control.dataset.modelPref=key;f.engine.bind('engine-home');control.onclick();await editor.current.save({elements:{value:{value:input}}});
    assert.deepEqual(structuredClone(f.calls.filter(call=>call.route==='/api/engine/modules').at(-1).body),{id:'compression',values:{[key]:value}});
  }
  assert.deepEqual(f.config.settings,{...before,compression:{...before.compression,strategy:'summary',triggerRatio:.9,maxTurns:12,dropTurns:2,keepRecentRatio:.2,prompt:'新的整理要求'}});
  assert.deepEqual(f.config.ai,aiBefore);assert.equal(f.calls.some(call=>call.route==='/api/engine/models'),false);
});

test('engine UI models: expanded rows offer test and parameter actions for six kinds while image omits test',async()=>{
  for(const kind of ['chat','stt','tts','image','decision','embedding','rerank']){
    const f=await fixture(),model=modelEntry('saved-'+kind,{kind});f.config.ai.models=[model];f.config.ai.assign[kind]=model.id;await f.engine.refreshConfig();
    const card=providerCardHarness(f,kind);assert.match(card.html,new RegExp('data-card-model-edit="'+model.id+'"'));
    if(kind==='image'){assert.doesNotMatch(card.html,/data-card-model-test=/);continue;}
    assert.match(card.html,new RegExp('data-card-model-test="'+model.id+'"'));assert.equal(f.calls.some(c=>c.route==='/api/engine/models/test'),false);
    card.action({cardModelTest:model.id});await turn();
    const request=f.calls.find(c=>c.route==='/api/engine/models/test').body;
    assert.equal(request.modelId,model.id);assert.deepEqual(structuredClone(request.model),model);assert.equal(request.source.id,'custom');assert.equal(f.toasts.at(-1),`模型 ${model.model} 测试通过，耗时 0 ms`);
    let edited;f.engine.editModel=(id,options)=>edited={id,model:options.draftModel};card.action({cardModelEdit:model.id});assert.equal(edited.id,model.id);assert.deepEqual(edited.model,model);
  }
});

test('engine UI models: adding the first chat model leaves the primary for the user to choose',async()=>{
  const f=await fixture(),editor=editorHarness(f);f.config.ai.assign.chatSelections=[];await f.engine.refreshConfig();
  const capabilities=['text','image','audio','tool_use'].map(value=>({value,checked:value==='text'}));
  editor.nodes.set('[name="capabilities"][value="tool_use"]',capabilities[3]);editor.nodes.set('[name="maxContextTokens"]',{});editor.nodes.set('#engine-tool-hint',{});
  f.engine.editModel();
  await editor.current.save({isConnected:true,values:{sourceId:'custom',model:'new-chat',kind:'chat',maxContextTokens:'0',temperature:'',maxTokens:'',timeoutSeconds:'45',extraBody:'{}',voice:''},querySelectorAll:()=>capabilities.filter(input=>input.checked)});
  const saved=f.calls.find(c=>c.route==='/api/engine/models').body.ai;
  assert.equal(saved.models[0].sourceId,'pipi');assert.equal(saved.models[0].kind,'chat');assert.equal(saved.models[0].model,'new-chat');assert.equal(saved.assign.chat,'');assert.deepEqual([...saved.assign.chatSelections],[]);assert.deepEqual(saved.assign.chatFallbacks,[]);
});

test('engine UI models: ownstation submits four key groups once and accepts the server result without fetching a catalog',async()=>{
  const f=await fixture(),kindGroups={pipi:['chat'],'pipi-voice':['tts'],'pipi-image':['image'],'pipi-auxiliary':['stt','decision','embedding','rerank']};
  f.config.ai.sources=[...Object.entries(kindGroups).map(([id,kinds])=>({id,name:id,kinds,template:'pipi',builtin:true,baseUrl:'https://'+id+'.invalid/v1',keySet:false,keyRevision:'revision-'+id})),f.config.ai.sources[1]];
  const old=modelEntry('old');f.config.ai.models=[old];f.config.ai.assign={...f.config.ai.assign,chat:old.id,chatFallbacks:[old.id]};await f.engine.refreshConfig();
  const editor=stationEditor(f);editor.open();
  for(const id of Object.keys(kindGroups))assert.match(editor.current.html,new RegExp('name="'+id+'" type="password"'));
  assert.equal(editor.current.label,'一键配置');assert.equal(f.calls.some(c=>c.route==='/api/engine/models/station'),false);
  const form={isConnected:true,elements:Object.fromEntries(Object.keys(kindGroups).map((id,index)=>[id,{value:' ISOLATED_GROUP_'+index+' '}]))};
  await editor.current.save(form);
  const request=f.calls.find(c=>c.route==='/api/engine/models/station').body;
  for(const [index,id]of Object.keys(kindGroups).entries()){assert.equal(request.keys[id],'ISOLATED_GROUP_'+index);assert.equal(request.expectedKeyRevisions[id],'revision-'+id);}
  assert.deepEqual(f.config.ai.models,[old]);assert.equal(f.config.ai.assign.chat,old.id);assert.deepEqual(f.config.ai.assign.chatFallbacks,[old.id]);
  assert.equal(f.calls.filter(c=>c.route==='/api/engine/models/list').length,0);assert.equal(f.calls.filter(c=>c.route==='/api/engine/models/station').length,1);assert.equal(editor.closed,1);
});

test('engine UI: a declared module renders and saves typed controls while the functions list keeps its fixed entries',async()=>{
  const declaration={id:'example',name:'声明示例',description:'只用声明生成。',settings:[{key:'enabled',label:'启用',type:'boolean',default:true},{key:'limit',label:'条数',type:'number',default:4,min:1,max:8,integer:true},{key:'mode',label:'模式',type:'select',default:'daily',options:[{value:'daily',label:'每天'}]},{key:'prompt',label:'内容',type:'textarea',default:'',advanced:true}]};
  const f=await fixture({modules:[declaration],settings:{example:{limit:6}}});
  assert.doesNotMatch(f.engine.render('engine-functions'),/声明示例/);const html=f.engine.render('engine-module','example');assert.match(html,/name="enabled" checked/);assert.match(html,/name="limit"[^>]*value="6"[^>]*min="1"[^>]*max="8"/);assert.match(html,/<details/);assert.match(html,/<textarea name="prompt"/);
  const form={dataset:{module:'example'},elements:{enabled:{checked:false},limit:{value:'7'},mode:{value:'daily'},prompt:{value:'晚安'}}};f.nodes.set('#engine-module-form',form);f.engine.bind('engine-module','example');form.onsubmit({preventDefault(){}});await turn();const values=f.calls.find(item=>item.route==='/api/engine/modules').body.values;assert.equal(values.enabled,false);assert.equal(values.limit,7);assert.equal(values.mode,'daily');assert.equal(values.prompt,'晚安');
});
test('engine UI: collapsed providers hide model rows and expanded cards show saved models with their capabilities',async()=>{
  const f=await fixture();f.config.ai.models=[{id:'chat',sourceId:'custom',model:'text-only',kind:'chat',capabilities:['text']},{id:'tts',sourceId:'custom',model:'speech',kind:'tts',capabilities:[]}];f.state.settings.ai=f.config.ai;f.config.ai.assign.chat='chat';await f.engine.refreshConfig();
  assert.doesNotMatch(f.engine.render('providers'),/text-only/);const card=providerCardHarness(f);
  assert.match(card.html,/text-only/);assert.match(card.html,/当前使用/);assert.match(card.html,/文本/);assert.doesNotMatch(card.html,/speech|data-card-model-use=/);
});

test('engine UI: input activity is throttled per role and never uploads the draft; typing events are independent of revisions',async()=>{
  const f=await fixture();f.engine.activity('alice');f.engine.activity('alice');f.engine.activity('bob');f.advance(2000);f.engine.activity('alice');
  f.engine.resetActivity('alice');f.engine.activity('alice');
  const reports=f.calls.filter(item=>item.route==='/api/engine/typing');assert.equal(reports.length,4);for(const report of reports)assert.deepEqual(Object.keys(report.body),['roleId']);
  f.engine.start();await turn();assert.equal(f.events.length,1);assert.equal(f.events[0].url,'/api/events');f.events[0].emit('typing',{roleId:'alice',typing:true});assert.equal(f.engine.isTyping('alice'),true);f.events[0].emit('typing',{roleId:'alice',typing:false});assert.equal(f.engine.isTyping('alice'),false);f.engine.stop();assert.equal(f.events[0].closed,true);
});
test('好友标题区分慢重试与准备发送，断线和重连采用当前发送状态',async()=>{
  const f=await fixture(),updates=[];
  f.P.updateTyping=(roleId,slow)=>updates.push({roleId,slow});
  f.engine.start();await turn();
  try{
    const stream=f.events[0];
    stream.emit('typing',{roleId:'alice',typing:false,slow:true});
    assert.equal(f.engine.isTyping('alice'),false);
    assert.deepEqual(updates.at(-1),{roleId:'alice',slow:true});
    stream.emit('typing',{roleId:'alice',typing:true,slow:false});
    assert.equal(f.engine.isTyping('alice'),true);
    stream.emit('error');assert.equal(f.engine.isTyping('alice'),false);
    stream.emit('open');stream.emit('typing',{roleId:'alice',typing:true,slow:false});
    assert.equal(f.engine.isTyping('alice'),true);
    stream.emit('typing',{roleId:'alice',typing:false,slow:false});assert.equal(f.engine.isTyping('alice'),false);
  }finally{f.engine.stop();}
});
test('engine UI: timezone defaults to the browser once and preserves a saved selection',async()=>{
  const f=await fixture({timezone:''});f.engine.start();await turn();const calls=f.calls.filter(item=>item.route==='/api/engine/timezone');assert.equal(calls.length,1);assert.equal(calls[0].body.timezone,Intl.DateTimeFormat().resolvedOptions().timeZone);f.engine.start();await turn();assert.equal(f.calls.filter(item=>item.route==='/api/engine/timezone').length,1);
  const saved=await fixture({timezone:'Asia/Tokyo'});saved.engine.start();await turn();assert.equal(saved.calls.filter(item=>item.route==='/api/engine/timezone').length,0);assert.match(saved.engine.render('engine-home'),/日本（东京）/);
});
test('engine UI: timezone opens directly, saves on selection and leaves the existing choice unchanged on cancel',async()=>{
  const f=await fixture(),control={dataset:{engineAction:'timezone'}};let choices;
  f.P.actionSheet=(caption,actions)=>{assert.equal(caption,'选择时区');choices=actions;};
  f.nodes.set('#overlay > .sheet-actions',{classList:{add(){}},setAttribute(){},querySelectorAll:()=>[],querySelector:()=>({after(){}})});f.document.createElement=()=>({});
  f.groups.set('[data-engine-action]',[control]);f.engine.bind('engine-home');await control.onclick();
  assert.equal(choices.length,10);assert.equal(f.calls.some(call=>call.view),false);assert.equal(f.calls.some(call=>call.route==='/api/engine/timezone'),false);
  await choices.find(item=>item.label==='中国（北京时间）').run();assert.equal(f.calls.some(call=>call.route==='/api/engine/timezone'),false);
  const request=f.P.api;f.P.api=(route,body)=>{if(route==='/api/engine/timezone')f.config.timezone=body.timezone;return request(route,body);};
  await choices.find(item=>item.label==='日本（东京）').run();assert.equal(f.calls.find(call=>call.route==='/api/engine/timezone').body.timezone,'Asia/Tokyo');assert.match(f.engine.render('engine-home'),/日本（东京）/);assert.equal(f.refreshes,1);
  f.config.timezone='Asia/Kolkata';await f.engine.refreshConfig();await control.onclick();assert.equal(choices.length,11);assert.ok(choices.some(item=>item.label.includes('印度')));
});
function productFunction(name){const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(app);assert.ok(match,name);const end=/\n  (?:async )?function /.exec(app.slice(match.index+match[0].length));return app.slice(match.index,match.index+match[0].length+end.index);}
test('engine UI: three sends can be accepted concurrently while the composer keeps the new unsent draft',async()=>{
  const pending=[],requests=[],activityResets=[];
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,console,pending,requests,window:{PipiEngine:{resetActivity:id=>activityResets.push(id)}}});
  vm.runInContext(`let imageVariants=false,composeImageMeta=null,composeComposing=false,recordingSession=null,composeText='第一条',composeImage='',composeStickerId='',quoteId='',route={name:'chat',arg:'alice'},panel='',forceBottomRole='',composerSelection={};const state={messages:[]},drafts=new Map(),composerHistories=new Map(),failedSends=new Map(),chatScrolls=new Map();function roleById(id){return {id};}function updateComposer(){}function receiveState(){}function toast(){}function refresh(){}function api(path,body){requests.push({path,body});return new Promise(resolve=>pending.push(()=>resolve({state:{revision:requests.length}})));}
    ${productFunction('quotedMessage')}
    ${productFunction('sendMessage')}
    globalThis.ui={sendMessage,text:value=>composeText=value,get:()=>composeText};`,context);
  const first=context.ui.sendMessage();assert.equal(context.ui.get(),'');context.ui.text('第二条');const second=context.ui.sendMessage();context.ui.text('第三条');const third=context.ui.sendMessage();assert.equal(requests.length,3);assert.deepEqual(requests.map(item=>item.body.text),['第一条','第二条','第三条']);assert.deepEqual(activityResets,['alice','alice','alice']);context.ui.text('还没有发出的草稿');pending.forEach(resolve=>resolve());await Promise.all([first,second,third]);assert.equal(context.ui.get(),'还没有发出的草稿');
  assert.equal(vm.runInContext('failedSends.size',context),0);
});
test('engine UI: incoming pending payments show receive and return controls and update their status after handling',async()=>{
  const featureSource=fs.readFileSync(path.join(__dirname,'../public/features.js'),'utf8'),transactions=[{id:'tx',roleId:'alice',direction:'in',type:'transfer',status:'pending',amountCents:3200,note:'买杯奶茶',createdAt:Date.now()}],calls=[],controls=[{dataset:{paymentHandle:'receive'},isConnected:true,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;}},{dataset:{paymentHandle:'return'},isConnected:true,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;}}];let html='';
  const P={getState:()=>({profile:{name:'我'},roles:[{id:'alice',name:'小甲'}],wallet:{transactions}}),esc:escape,icons:{transfer:'',chevron:''},avatar:()=>'',openPage:(title,body)=>html=body,refresh(){},toast:message=>{throw new Error(message);},act:async(type,payload)=>{calls.push({type,payload});transactions[0].status=payload.action==='receive'?'received':'returned';}};
  const window={Pipi:P},document={querySelectorAll:selector=>selector==='[data-payment-handle]'?controls:[],querySelector:()=>null};vm.runInNewContext(featureSource,{window,document,console,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},Date});
  window.PipiFeatures.walletTransaction('tx',undefined,{fromChat:true});assert.match(html,/待领取/);assert.match(html,/data-payment-handle="receive"/);assert.match(html,/data-payment-handle="return"/);await controls[0].listeners.click({currentTarget:controls[0]});assert.equal(calls[0].type,'wallet.handle');assert.equal(calls[0].payload.id,'tx');assert.equal(calls[0].payload.action,'receive');assert.match(html,/已收款/);assert.doesNotMatch(html,/data-payment-handle=/);
  transactions[0].status='returned';window.PipiFeatures.walletTransaction('tx',undefined,{fromChat:true});assert.match(html,/已退还/);assert.doesNotMatch(html,/data-payment-handle=/);
});
test('engine UI: payment chat cards use persisted transaction state and resolved styling',()=>{
  const scope=vm.createContext({window:{PipiEngine:{isTyping:()=>false}}});
  vm.runInContext(`const state={profile:{},roles:[{id:'alice',name:'小甲'}],messages:[{id:'m',roleId:'alice',type:'transfer',sender:'assistant',createdAt:0,content:'转账',meta:{amountCents:1000,transactionId:'tx'}}],wallet:{transactions:[{id:'tx',status:'pending'}]}};const route={arg:'alice'};let chatSelection=null,outgoing=null,slowReplyRole='';const esc=value=>String(value??''),richText=esc,safeImage=()=>false,header=title=>title,roleName=r=>r.name,roleById=id=>state.roles.find(r=>r.id===id),shortTime=()=>'',avatar=()=>'',icons={},transferCardMark='',redpacketCardMark='',iconButton=()=>'',renderComposer=()=>'';${productFunction('renderChat')}globalThis.ui={renderChat,setStatus:status=>state.wallet.transactions[0].status=status};`,scope);
  assert.match(scope.ui.renderChat(),/请收款/);assert.doesNotMatch(scope.ui.renderChat(),/payment-resolved/);scope.ui.setStatus('received');assert.match(scope.ui.renderChat(),/已收款/);assert.match(scope.ui.renderChat(),/payment-resolved/);scope.ui.setStatus('returned');assert.match(scope.ui.renderChat(),/已退还/);
});
test('engine UI metadata: aliases select capabilities while zero stays automatic and existing settings stay intact',async()=>{
  const f=await fixture(),editor=editorHarness(f),inputs=['text','image','audio','tool_use'].map(value=>({value,checked:true})),name={value:''},capacity={value:0};
  editor.nodes.set('[name="model"]',name);editor.nodes.set('[name="maxContextTokens"]',capacity);editor.groups.set('[name="capabilities"]',inputs);
  f.P.api=async(route,body)=>({timeoutSeconds:120,capabilities:body.model==='known-alias'?['text','image','tool_use']:['text','image','audio','tool_use'],matchedModel:body.model==='known-alias'?'known-model':'',capacity:{value:body.maxContextTokens||256000,source:body.maxContextTokens?'manual':'metadata',recognized:!body.maxContextTokens}});
  f.engine.editModel();assert.doesNotMatch(editor.current.html,/角色动作|不支持角色动作|name="sourceId"|name="kind"/);assert.match(editor.current.html,/工具使用/);
  name.value='known-alias';await name.onchange();assert.equal(capacity.value,0);assert.deepEqual(inputs.filter(input=>input.checked).map(input=>input.value),['text','image','tool_use']);assert.match(editor.nodes.get('#model-capacity-status').textContent,/known-model.*256,000/);
  assert.equal(editor.nodes.get('[name="timeoutSeconds"]').placeholder,'默认 120 秒');
  capacity.value=9000;await capacity.oninput();assert.equal(capacity.value,9000);assert.match(editor.nodes.get('#model-capacity-status').textContent,/9,000.*手动/);
});

test('engine UI metadata: pending metadata respects manual capabilities and cannot replace a newer model or capacity',async()=>{
  const f=await fixture(),editor=editorHarness(f),inputs=['text','image','audio','tool_use'].map(value=>({value,checked:true})),name={value:''},capacity={value:0};
  editor.nodes.set('[name="model"]',name);editor.nodes.set('[name="maxContextTokens"]',capacity);editor.groups.set('[name="capabilities"]',inputs);
  const resolvers=[],api=f.P.api;f.P.api=(route,body)=>body.model?new Promise(resolve=>resolvers.push(resolve)):api(route,body);f.engine.editModel();
  name.value='first';const first=name.onchange();name.value='second';const second=name.onchange();
  inputs[3].checked=false;inputs[3].onchange();capacity.value=999;const manual=capacity.oninput();
  resolvers[2]({timeoutSeconds:120,capabilities:['text','image','audio','tool_use'],capacity:{value:999,source:'manual',recognized:false}});await manual;
  for(const resolve of resolvers.slice(0,2))resolve({timeoutSeconds:120,capabilities:['text'],capacity:{value:200,source:'metadata',recognized:true}});await first;await second;
  assert.deepEqual(inputs.filter(input=>input.checked).map(input=>input.value),['text','image','audio']);assert.equal(capacity.value,999);assert.match(editor.nodes.get('#model-capacity-status').textContent,/999.*手动/);
});
test('engine UI metadata: capacity input during lookup still applies the new model capabilities',async()=>{
  const f=await fixture(),editor=editorHarness(f),inputs=['text','image','audio','tool_use'].map(value=>({value,checked:true})),name={value:''},capacity={value:0};
  editor.nodes.set('[name="model"]',name);editor.nodes.set('[name="maxContextTokens"]',capacity);editor.groups.set('[name="capabilities"]',inputs);
  const resolvers=[],api=f.P.api;f.P.api=(route,body)=>body.model?new Promise(resolve=>resolvers.push(resolve)):api(route,body);f.engine.editModel();
  name.value='new-model';const first=name.onchange();capacity.value=10000;const second=capacity.oninput();
  resolvers[1]({timeoutSeconds:120,capabilities:['text'],capacity:{value:10000,source:'manual',recognized:false}});await second;
  resolvers[0]({timeoutSeconds:120,capabilities:['text'],capacity:{value:256000,source:'metadata',recognized:true}});await first;
  assert.deepEqual(inputs.filter(input=>input.checked).map(input=>input.value),['text']);assert.equal(capacity.value,10000);
});

// SPDX-License-Identifier: AGPL-3.0-only

test('engine UI: role stickers are selected from the global library and saved together',async()=>{
  const f=await fixture(),control={dataset:{engineAction:'add-role-sticker'}},submit={};
  const form={isConnected:true,values:{stickerIds:['mine1','mine2']},querySelector:()=>submit,querySelectorAll:()=>['mine1','mine2'],addEventListener(){}};
  const onePixel='data:image/png;base64,AAAA';
  f.state.stickers=[{id:'mine1',name:'开心',image:onePixel},{id:'mine2',name:'抱抱',image:'data:image/gif;base64,AAAA'}];
  f.groups.set('[data-engine-action]',[control]);f.nodes.set('#overlay .modal-form',form);
  let editor,closed=0;
  f.P.openPage=(title,html,save,label)=>{editor={title,html,save,label};};
  f.P.closePage=()=>closed++;
  f.P.act=async(type,payload)=>f.calls.push({type,payload});
  f.engine.bind('role-stickers','alice');
  assert.match(f.engine.render('role-stickers','alice'),/从我的表情包库添加/);
  await control.onclick();
  assert.equal(editor.label,'添加');assert.match(editor.html,/开心/);assert.match(editor.html,/抱抱/);
  assert.equal(f.calls.some(c=>c.type==='role.stickers.add'),false);
  await editor.save(form);
  const saved=f.calls.find(c=>c.type==='role.stickers.add');
  assert.equal(saved.payload.roleId,'alice');assert.deepEqual(Array.from(saved.payload.stickerIds),['mine1','mine2']);assert.equal(closed,1);
});

test('engine UI models: recording transcription and voice understanding select independently from a model row',async()=>{
  const f=await fixture();f.config.ai.models=[modelEntry('mimo',{kind:'stt',model:'mimo-v2.5-asr'}),modelEntry('omni',{kind:'stt',model:'qwen3.8-omni-flash'})];
  f.config.ai.assign.stt='mimo';f.config.ai.assign.voiceUnderstanding='omni';await f.engine.refreshConfig();
  const card=providerCardHarness(f,'stt');let actions;f.P.actionSheet=(title,choices)=>{assert.equal(title,'设为使用');actions=choices;};
  assert.match(card.html,/录完后转文字/);assert.match(card.html,/语音条理解/);card.action({cardModelUse:'mimo'});actions[1].run();
  assert.equal(f.config.ai.assign.voiceUnderstanding,'omni');await card.save();assert.equal(f.config.ai.assign.stt,'mimo');assert.equal(f.config.ai.assign.voiceUnderstanding,'mimo');
  card.action({cardModelUse:'omni'});actions[0].run();await card.save();assert.equal(f.config.ai.assign.stt,'omni');assert.equal(f.config.ai.assign.voiceUnderstanding,'mimo');
});

test('engine UI models: audio candidates are confirmed one by one and preserve both purpose assignments on save',async()=>{
  const f=await fixture(),old=modelEntry('streaming',{kind:'stt'});f.config.ai.models=[old];f.config.ai.assign.stt=old.id;await f.engine.refreshConfig();
  const assignment=structuredClone(f.config.ai.assign),card=providerCardHarness(f,'stt'),names=['mimo-v2.5-asr','qwen3.8-omni-flash','third'],api=f.P.api;
  f.P.api=(route,body)=>route==='/api/engine/models/list'?Promise.resolve({models:names.map(model=>({model,kind:'stt',capabilities:[]}))}):api(route,body);
  await card.fetch();assert.doesNotMatch(card.body.innerHTML,/type="checkbox"|type="radio"/);
  for(const name of names){card.addCandidate(name);await card.confirm();}
  assert.equal(f.config.ai.models.length,1);await card.save();
  assert.deepEqual(f.config.ai.models.map(model=>model.model),['streaming',...names]);assert.deepEqual(f.config.ai.assign,assignment);
  for(const name of names)assert.doesNotMatch(card.html,new RegExp('data-provider-candidate="'+name+'"'));
  await card.save();assert.deepEqual(f.config.ai.assign,assignment);assert.equal(f.config.ai.models.length,4);
});

test('engine UI models: failed and empty fetch clear stale candidates while preserving saved models',async()=>{
  const f=await fixture();f.config.ai.sources[1].template='breezeblue';f.config.ai.models=[modelEntry('saved-voice',{kind:'tts'})];f.config.ai.assign.tts='saved-voice';await f.engine.refreshConfig();
  const before=structuredClone(f.config.ai),card=providerCardHarness(f,'tts');await card.fetch();assert.match(card.body.innerHTML,/data-provider-candidate="gpt-4.1"/);
  f.P.api=async()=>{throw new Error('获取失败');};await card.fetch();assert.equal(card.controls.get('[data-provider-status]').textContent,'获取失败');
  assert.match(card.body.innerHTML,/saved-voice/);assert.doesNotMatch(card.body.innerHTML,/data-provider-candidate=/);assert.deepEqual(f.config.ai,before);
  f.P.api=async()=>({models:[]});await card.fetch();assert.match(card.body.innerHTML,/saved-voice/);assert.doesNotMatch(card.body.innerHTML,/data-provider-candidate=|breeze-tts-2/);assert.equal(card.controls.get('[data-provider-status]').textContent,'获取到 0 个模型');assert.deepEqual(f.config.ai,before);
});

for(const kind of ['chat','stt','tts','image','decision','embedding','rerank'])test(`engine UI catalog: ${kind} confirms multiple models without changing current assignments`,async()=>{
  const f=await fixture(),old=modelEntry('previous',{kind});f.config.ai.models=[old];f.config.ai.assign[kind]=old.id;if(kind==='chat')f.config.ai.assign.chatSelections=[old.id];await f.engine.refreshConfig();
  const assignment=structuredClone(f.config.ai.assign),card=providerCardHarness(f,kind),names=Array.from({length:5},(_,i)=>`candidate-${i}`),api=f.P.api;
  f.P.api=(route,body)=>route==='/api/engine/models/list'?Promise.resolve({models:names.map(model=>({model,kind,capabilities:kind==='chat'?['text']:[]}))}):api(route,body);
  await card.fetch();for(const name of names){card.addCandidate(name);await card.confirm();}
  assert.equal(f.config.ai.models.length,1);assert.deepEqual(f.config.ai.assign,assignment);await card.save();
  assert.equal(f.config.ai.models.length,6);assert.deepEqual(f.config.ai.models[0],old);assert.deepEqual(f.config.ai.assign,assignment);
  for(const name of names)assert.doesNotMatch(card.html,new RegExp('data-provider-candidate="'+name+'"'));
  await card.save();assert.equal(f.config.ai.models.length,6);assert.deepEqual(f.config.ai.assign,assignment);
});

test('engine UI models: model editor offers saved protocol overrides and new models default to auto',async()=>{
  const f=await fixture(),editor=editorHarness(f);
  f.config.ai.models=[modelEntry('speech',{kind:'stt',protocol:'mimo-asr'})];await f.engine.refreshConfig();
  editor.nodes.set('[name="capabilities"][value="tool_use"]',{});
  editor.nodes.set('[name="model"]',{value:'speech'});
  editor.nodes.set('[name="maxContextTokens"]',{});
  f.engine.editModel('speech');assert.match(editor.current.html,/调用方式/);assert.match(editor.current.html,/value="mimo-asr" selected/);assert.match(editor.current.html,/value="qwen-omni"/);
  assert.equal(f.engine.newModel('custom','mimo-v2.5-asr',{kind:'stt'}).protocol,'auto');
});


test('engine UI models: ownstation keeps blank groups blank and accepts missing-preset feedback from the server',async()=>{
  const f=await fixture(),groups=['pipi','pipi-voice','pipi-image','pipi-auxiliary'];
  f.config.ai.sources=groups.map(id=>({id,name:id,kinds:id==='pipi'?['chat']:['tts'],builtin:true,baseUrl:'https://'+id+'.invalid/v1',keySet:true,keyRevision:'saved-revision'}));
  const old=modelEntry('old-voice',{sourceId:'pipi-auxiliary',kind:'stt'});f.config.ai.models=[old];f.config.ai.assign.voiceUnderstanding=old.id;await f.engine.refreshConfig();
  const before=structuredClone(f.config.ai),editor=stationEditor(f),api=f.P.api;
  f.P.api=async(route,body)=>{const result=await api(route,body);return route==='/api/engine/models/station'?{...result,unconfiguredGroups:['pipi-auxiliary']}:result;};
  editor.open();await editor.current.save({isConnected:true,elements:Object.fromEntries(groups.map(id=>[id,{value:id==='pipi-auxiliary'?'NEW_AUX_KEY':''}]))});
  const request=f.calls.find(c=>c.route==='/api/engine/models/station').body;
  assert.deepEqual(structuredClone(request.keys),{pipi:'','pipi-voice':'','pipi-image':'','pipi-auxiliary':'NEW_AUX_KEY'});
  assert.deepEqual(f.config.ai,before);assert.match(f.toasts.at(-1),/辅助模型 API有模型需要手动配置/);assert.equal(f.calls.filter(c=>c.route==='/api/engine/models/list').length,0);
});

test('engine UI models: hidden fields retain saved values for every non-chat category',async()=>{
  for(const kind of ['stt','tts','image','decision','embedding','rerank']){
    const f=await fixture(),editor=editorHarness(f),old=modelEntry('saved',{kind,capabilities:[],voice:'keep-voice',protocol:kind==='stt'?'mimo-asr':'auto'});
    f.config.ai.models=[old];await f.engine.refreshConfig();f.engine.editModel(old.id);
    assert.doesNotMatch(editor.current.html,/name="sourceId"|name="kind"|name="capabilities"|name="temperature"|name="maxTokens"|name="maxContextTokens"/);
    assert.doesNotMatch(editor.current.html,/name="voice"/);assert.match(editor.current.html,/name="timeoutSeconds"/);
    assert.match(editor.current.html,/<details class="engine-details model-parameters"><summary>更多参数<\/summary>/);
    const values={model:old.model,extraBody:JSON.stringify(old.extraBody),timeoutSeconds:String(old.timeoutSeconds)};
    if(['stt','tts','decision'].includes(kind))values.protocol=old.protocol;
    await editor.current.save({isConnected:true,values});const saved=f.calls.find(c=>c.route==='/api/engine/models').body.ai;
    assert.deepEqual(structuredClone(saved.models[0]),old);assert.deepEqual(structuredClone(saved.sources),f.config.ai.sources);
  }
});

 test('engine UI models: new catalog entries keep automatic capacity despite recognized metadata',async()=>{
  const f=await fixture(),entry=f.engine.newModel('custom','model-name',{kind:'chat',maxContextTokens:1000000,capabilities:['text','image']});
  assert.equal(entry.maxContextTokens,0);assert.deepEqual([...entry.capabilities],['text','image']);
});
