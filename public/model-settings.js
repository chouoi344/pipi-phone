// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P=()=>window.Pipi, E=()=>window.PipiEngine;
  const esc=value=>P().esc(value);
  let config,category='chat';
  const testing=new Set();
  const ai=()=>config.ai;
  const categories=[{id:'chat',label:'对话',use:'聊天模型',note:'聊天、识图和角色动作'},{id:'stt',label:'语音转文字',use:'语音转文字模型',note:'录完后转文字与语音条理解，分别选择模型'},{id:'tts',label:'文字转语音',use:'文字转语音模型',note:'把角色回复合成为语音'},{id:'image',label:'生成图片',use:'图片生成模型',note:'生成图片使用的模型'},{id:'decision',label:'判断',use:'判断模型',note:'为具体功能做选择或评分'},{id:'embedding',label:'嵌入',use:'嵌入模型',note:'查找相近的记忆或资料'},{id:'rerank',label:'重排序',use:'重排序模型',note:'把检索结果按相关程度排序'}];
  const paths={decision:'<path d="M12 3v18M6 21h12M4 7h16M6 7l-4 8h8L6 7ZM18 7l-4 8h8l-4-8Z"/>',site:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 18h2"/>',connection:'<path d="m10 13 4-4M8 15l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M13 17a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1"/>'};
  Object.assign(paths,{plug:'<g transform="rotate(45 12 12)" fill="currentColor" stroke="none"><path d="M11 1h2v3h3v3a4 4 0 0 1-8 0V4h3V1ZM8 18a4 4 0 0 1 8 0v2h-3v3h-2v-3H8v-2Z"/><path d="M9 10h2v3H9zm4 0h2v3h-2z"/></g>',settings:'<path d="m10 3-.6 2.3-2 .9-2.1-.7-2 3.4L5 10.5v3l-1.7 1.6 2 3.4 2.1-.7 2 .9L10 21h4l.6-2.3 2-.9 2.1.7 2-3.4-1.7-1.6v-3l1.7-1.6-2-3.4-2.1.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>'});
  const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  const templates=[
 {id:'compatible',name:'OpenAI 兼容',logo:'openai.svg',desc:'自定义服务',kinds:['chat','stt','tts','image','embedding']},
 {id:'choupi',name:'屁屁云站 (choupi.tech)',icon:'site',desc:'一站式对话·生图·BreezeBlue 语音',base:'https://choupi.tech/v1',defaultModelsByKind:{tts:['breeze-tts-2']},kinds:['chat','stt','tts','image','embedding','decision','rerank']},
 {id:'deepseek',name:'DeepSeek',logo:'deepseek.svg',desc:'对话模型',base:'https://api.deepseek.com/v1',kinds:['chat']},
 {id:'openai',name:'OpenAI',logo:'openai.svg',desc:'官方服务',base:'https://api.openai.com/v1',kinds:['chat','stt','tts','image','embedding']},
 {id:'gemini',name:'Gemini',logo:'gemini.svg',desc:'Google',base:'https://generativelanguage.googleapis.com/v1beta/openai/',kinds:['chat']},
 {id:'qwen',name:'通义千问',logo:'qwen.png',desc:'阿里云百炼',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',bases:{tts:'https://dashscope.aliyuncs.com/api/v1'},region:'中国内地（北京）',kinds:['chat','stt','tts','embedding']},
 {id:'mimo',name:'小米 MiMo',wordmark:'MiMo',desc:'官方语音识别',base:'https://api.xiaomimimo.com/v1',defaultModels:['mimo-v2.5-asr'],kinds:['stt']},
 {id:'silicon',name:'硅基流动',logo:'siliconflow.png',desc:'模型服务平台',base:'https://api.siliconflow.cn/v1',region:'中国站',kinds:['chat','stt','tts','embedding','rerank']},
 {id:'minimax',name:'MiniMax',logo:'minimax.png',desc:'原生语音合成',base:'https://api.minimax.cn/v1',region:'中国站',kinds:['tts']},
 {id:'breezeblue',name:'breezeblue',logo:'breezeblue.webp',desc:'原生语音合成（默认 breeze-tts-2）',base:'https://api.breeze.blue/v1',defaultModels:['breeze-tts-2'],kinds:['tts']},
 {id:'openrouter-system-one',name:'OpenRouter System One',icon:'decision',desc:'typesafe/jev-1.14（推荐）',base:'https://openrouter.ai/api/v1',defaultModels:['typesafe/jev-1.14','typesafe/jev-latest'],kinds:['decision']},
 {id:'typesafe-system-one',name:'TypeSafe System One',icon:'decision',desc:'官方 jev-1.14',base:'https://api.typesafe.ai/v1',defaultModels:['jev-1.14','jev-latest'],kinds:['decision']},
 {id:'vercel-system-one',name:'Vercel System One',icon:'decision',desc:'Vercel AI 网关',base:'https://ai-gateway.vercel.sh/typesafe/v1',defaultModels:['jev-1.14'],kinds:['decision']},
 {id:'system-one',name:'Custom System One',icon:'decision',desc:'自定义 /systemone 服务',defaultModels:['jev-1.14','typesafe/jev-1.14'],kinds:['decision']},
 {id:'decision-api',name:'OpenAI 兼容',logo:'openai.svg',desc:'用中转站轻量模型做判断',kinds:['decision']},
 {id:'rerank-api',name:'自定义重排序',icon:'connection',desc:'自定义服务',kinds:['rerank']}
];

  paths.down='<path d="m6 9 6 6 6-6"/>';
  paths.remove='<path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/>';
  const groups=[{id:'pipi',label:'对话模型 API'},{id:'pipi-voice',label:'语音模型 API'},{id:'pipi-image',label:'画图分组 API'},{id:'pipi-auxiliary',label:'辅助模型 API'}];
  const cat=()=>categories.find(item=>item.id===category);
  const sourceFor=id=>ai().sources.find(item=>item.id===id);
  const brand=source=>templates.find(item=>item.id===source.template)||templates.find(item=>item.base===source.baseUrl)||templates[0];
  const mark=template=>`<span class="source-mark">${template.logo?`<img src="/vendor/model-brands/${template.logo}" alt="">`:template.wordmark?esc(template.wordmark):icon(template.icon||'connection')}</span>`;
  const input=(label,name,value='',placeholder='',type='text',mode='')=>`<label class="edit-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="${type==='password'?'new-password':'off'}" spellcheck="false" ${mode}></label>`;
  const modelId=()=>crypto.randomUUID();
  async function run(work){try{await work();}catch(error){P().toast(error.message);}}
  async function updateModels(path,body){
    const result=await P().api('/api/engine/models/'+path,body);
    config=E().acceptConfig(result);
    return result;
  }
  function confirmKeyChange(names,label,onConfirm){
    P().actionSheet(`「${names.join('、')}」的密钥已在其他窗口修改。本次修改尚未保存。`,[{label,run:onConfirm}]);
  }
  function checkKeySavingAvailable(source){
    if(source&&source.keyRevision===undefined)throw new Error('后台仍在运行旧版本。请重启小手机后台并刷新页面后再修改密钥。');
  }
  function sheet(title,html,submit,label='完成'){
    P().openModal(title,html,submit,label,undefined,'cancel',{lockWhileSaving:Boolean(submit)});
    document.querySelector('#overlay > .page-editor').classList.add('model-sheet','model-ui');
  }
  function singleChoiceSheet(title,choices,current,onChoose,{name='choice',note='',selectImmediately=false}={}){
    const selector=`[name="${name}"]`;
    const markup=(options,message)=>options.map(({value,label,detail})=>`<label class="choice-row assignment-option"><span>${esc(label)}${detail?`<small>${esc(detail)}</small>`:''}</span><input type="radio" name="${name}" value="${esc(value)}" ${current===value?'checked':''}></label>`).join('')+(message?`<p class="small-note" role="status">${esc(message)}</p>`:'');
    const bindImmediate=body=>body.querySelectorAll(selector).forEach(input=>input.onclick=()=>{
      onChoose(input.value);
      P().closePage();
    });
    if(typeof choices==='function'){
      sheet(title,markup([],note));
      const body=document.querySelector('#overlay > .model-sheet .modal-body');
      return choices().then(result=>{
        if(!body.isConnected)return;
        body.innerHTML=markup(result.choices,result.note);
        bindImmediate(body);
      });
    }
    const submit=!selectImmediately&&choices.length?form=>onChoose(form.querySelector(selector+':checked')?.value,form):undefined;
    sheet(title,markup(choices,note),submit);
    if(selectImmediately)bindImmediate(document.querySelector('#overlay > .model-sheet'));
  }
  let expanded='';
  const drafts=new Map();
  const pageSize=20;
  const capLabels={text:'文本',image:'识图',audio:'音频',tool_use:'工具使用'};
  const draftKey=(id,kind=category)=>`${kind}/${id}`;
  function draftFor(source){
    const key=draftKey(source.id);
    if(!drafts.has(key))drafts.set(key,{source,kind:category,isNew:!sourceFor(source.id),fields:{},updates:new Map(),expectedModels:new Map(),assign:{},catalog:null,query:'',status:'',advanced:false,pages:{configured:0,available:0}});
    return drafts.get(key);
  }
  const cardSource=draft=>({...draft.source,...sourceFor(draft.source.id),...draft.fields});
  const sourceTitle=(source,value)=>value.name.trim()||source.name;
  function cardModels(draft){
    const models=new Map(ai().models.filter(model=>model.sourceId===draft.source.id&&model.kind===draft.kind).map(model=>[model.id,model]));
    for(const [id,model] of draft.updates){if(model)models.set(id,model);else models.delete(id);}
    return [...models.values()];
  }
  function checkedSource(draft){
    const source=cardSource(draft),name=source.name.trim(),baseUrl=source.baseUrl.trim();
    if(!name||!baseUrl)throw new Error('请填写服务商名称和接口地址');
    if(draft.fields.key&&draft.fields.baseUrl===undefined&&source.baseUrl!==draft.source.baseUrl)throw new Error('接口地址已在别处更新，请核对地址后重新填写 API Key');
    if(source.keySet&&baseUrl.replace(/\/+$/,'')!==sourceFor(source.id)?.baseUrl?.replace(/\/+$/,'')&&!source.key?.trim()&&!source.clearKey)throw new Error('接口地址已修改，请填入新地址的 API Key，或明确清除原密钥');
    return {...source,name,baseUrl};
  }
  function changeModel(draft,id,model){
    if(!draft.expectedModels.has(id))draft.expectedModels.set(id,ai().models.find(item=>item.id===id)||null);
    if(model===null&&draft.expectedModels.get(id)===null){draft.updates.delete(id);draft.expectedModels.delete(id);}
    else draft.updates.set(id,model);
  }
  function pageOf(draft,key,title,list){
    const count=Math.max(1,Math.ceil(list.length/pageSize));
    const page=draft.pages[key]=Math.min(draft.pages[key],count-1);
    const button=(step,label,disabled)=>`<button type="button" data-model-page="${key}" data-page-step="${step}" ${disabled?'disabled':''}>${label}</button>`;
    return {items:list.slice(page*pageSize,(page+1)*pageSize),nav:count>1?`<nav class="model-pagination" aria-label="${title}分页">${button(-1,'上页',page===0)}<span>${page+1} / ${count} 页</span>${button(1,'下页',page===count-1)}</nav>`:''};
  }
  const tool=(attribute,model,label,symbol,disabled=false)=>`<button type="button" class="model-action" ${attribute}="${esc(model.id)}" aria-label="${label}：${esc(model.model)}" title="${label}" ${disabled?'disabled':''}>${symbol}</button>`;
  function rows(draft){
    const models=cardModels(draft),assign={...ai().assign,...draft.assign};
    const match=model=>model.toLowerCase().includes(draft.query.trim().toLowerCase());
    const names=new Set(models.map(model=>model.model));
    const available=(draft.catalog||[]).filter(item=>!names.has(item.model));
    const configuredPage=pageOf(draft,'configured','已配置的模型',models.filter(model=>match(model.model)));
    const availablePage=pageOf(draft,'available','可用模型',available.filter(item=>match(item.model)));
    return `<div class="demo-heading"><span>已配置的模型<span class="model-count">${models.length}</span></span></div><div class="model-list">${configuredPage.items.map(model=>{
      const paused=model.enabled===false;
      const usage=draft.kind==='stt'?[assign.stt===model.id?'录完后转文字':'',assign.voiceUnderstanding===model.id?'语音条理解':''].filter(Boolean).join(' · '):assign[draft.kind]===model.id?(paused?'已选为默认':'当前使用'):'';
      const details=[usage,paused?'已停用':'',...model.capabilities.map(cap=>capLabels[cap])].filter(Boolean).join(' · ');
      return `<div class="model-item inline-model-item configured-model-item"><span class="model-copy"><strong title="${esc(model.model)}">${esc(model.model)}</strong>${details?`<small>${esc(details)}</small>`:''}${draft.kind!=='chat'&&!paused&&(!usage||draft.kind==='stt')?`<button type="button" class="model-use" data-card-model-use="${esc(model.id)}">设为使用</button>`:''}</span>
        <span class="model-actions"><button type="button" role="switch" class="inline-model-switch" data-card-model-enabled="${esc(model.id)}" aria-label="启用 ${esc(model.model)}" aria-checked="${model.enabled!==false}"></button>
        ${draft.kind==='image'?'':tool('data-card-model-test',model,'测试连接',icon('plug'),testing.has(model.id))}
        ${tool('data-card-model-edit',model,'模型参数',icon('settings'))}${tool('data-card-model-remove',model,'移除模型',icon('remove'))}</span></div>`;
    }).join('')||`<div class="empty-state">${draft.query?'没有匹配的已配置模型':'还没有配置模型'}</div>`}${configuredPage.nav}</div>
    <div class="demo-heading"><span>可用模型<span class="model-count">${available.length}</span></span></div><div class="model-list">${availablePage.items.map(item=>`<div class="model-item inline-model-item"><span class="model-copy"><strong title="${esc(item.model)}">${esc(item.model)}</strong></span><button type="button" class="model-action add-candidate" aria-label="添加 ${esc(item.model)}" data-provider-candidate="${esc(item.model)}">＋</button></div>`).join('')||`<div class="empty-state">${draft.catalog===null?'获取模型列表后在这里选择':draft.query?'没有匹配的可用模型':'未找到可添加的模型'}</div>`}${availablePage.nav}</div>`;
  }
  function sourceCard(source){
    const open=source.id===expanded,draft=open?draftFor(source):drafts.get(draftKey(source.id)),value=draft?cardSource(draft):source;
    const name=sourceTitle(source,value),address=value.baseUrl.trim();
    const id=esc(source.id),mode=source.builtin?'readonly':'required';
    return `<section class="source-card" data-provider-card="${id}">
      <div class="source-top"><button type="button" class="source-toggle" data-provider-toggle="${id}" aria-expanded="${open}" aria-controls="provider-body-${id}">${mark(source.builtin?{icon:'site'}:brand(source))}<span class="source-copy"><strong>${esc(name)}</strong><small ${address?'':'hidden'}>${esc(address)}</small></span>${icon('down')}</button><button type="button" class="more-btn" aria-label="${esc(name)}更多操作" data-provider-menu="${id}">···</button></div>
      ${open?`<form id="provider-body-${id}" class="inline-provider-form" data-provider-form="${id}" autocomplete="off"><fieldset class="inline-provider-fields" ${draft.saving?'disabled':''}>
        <div class="form-block"><div class="demo-heading"><span>配置</span></div>${input('名称','name',value.name,'','text',mode)}${input('接口地址','baseUrl',value.baseUrl,'填写服务商地址','url',mode)}${input('API Key','key',value.key||'',value.keySet?'已保存，留空保留':'填写 API Key','password')}
        <p class="provider-key-note" data-provider-key-note ${draft.needsKey?'':'hidden'}>要继续保存刷新前输入的密钥，请重新填写 API Key。</p>
        ${value.keySet?`<details class="inline-provider-options" ${draft.advanced?'open':''}><summary>高级配置</summary><label class="check-row"><input type="checkbox" name="clearKey" ${value.clearKey?'checked':''}>清除已保存的密钥</label></details>`:''}</div>
        <div class="inline-provider-models"><div class="demo-heading"><span>模型</span></div>
        <div class="model-tools"><button type="button" data-provider-fetch ${draft.pending?'disabled':''}>${draft.pending?'正在获取…':'获取模型列表'}</button><button type="button" data-provider-manual>自定义模型</button></div>
        <div class="search-wrap"><input type="search" aria-label="搜索模型" placeholder="搜索模型" data-provider-query value="${esc(draft.query)}"></div>
        <p class="small-note" data-provider-status role="status" ${draft.status?'':'hidden'}>${esc(draft.status)}</p><div data-provider-models-body>${rows(draft)}</div></div>
        <p class="inline-provider-error" data-provider-error role="alert" ${draft.error?'':'hidden'}>${esc(draft.error||'')}</p><div class="button-area inline-provider-save"><button type="button" class="provider-reset" data-provider-reset ${draft.conflict?'':'hidden'}>放弃草稿并读取最新配置</button><button type="submit" class="primary">保存</button></div></fieldset></form>`:''}</section>`;
  }
  function render(current){
    config=current;
    const heading=cat().label+'服务商';
    const list=ai().sources.filter(source=>{
      const hasModels=ai().models.some(model=>model.sourceId===source.id&&model.kind===category);
      if(source.builtin)return hasModels||source.keySet&&source.kinds?.includes(category);
      return hasModels||source.kinds?.includes(category)||!source.kinds?.length&&category==='chat';
    });
    list.push(...[...drafts.values()].filter(draft=>draft.kind===category&&draft.isNew&&!sourceFor(draft.source.id)).map(draft=>draft.source));
    const tabs=items=>items.map(item=>`<button type="button" class="category-tab ${category===item.id?'active':''}" aria-pressed="${category===item.id}" data-model-category="${item.id}">${item.label}</button>`).join('');
    return `<header class="topbar"><div class="header-leading"><button class="back-btn" data-action="back" aria-label="返回">${P().icons.back}</button></div><h2 class="title-centered">模型</h2><div class="header-actions"></div></header><div class="content page-content model-ui home-content">
      <button class="relay-card" id="model-relay" type="button"><span class="relay-heading"><span class="relay-symbol">${icon('site')}</span><span class="relay-copy"><strong>屁屁自己的站</strong><small>对话 · 语音 · 画图 · 辅助</small></span></span><span class="relay-action">一键配置 ${P().icons.chevron}</span></button>
      <nav class="category-tabs" aria-label="模型分类"><div class="main-categories">${tabs(categories.slice(0,4))}</div><div class="aux-categories">${tabs(categories.slice(4))}</div></nav><p class="category-note">${cat().note}</p>
      <div class="demo-heading"><span>${heading}${list.length?' · '+list.length:''}</span><button type="button" data-provider-add>添加服务商</button></div><section class="model-source-group" aria-label="${heading}">${list.map(sourceCard).join('')||`<div class="empty-state">还没有添加${heading}</div>`}</section></div>`;
  }
  function showSource(id,reveal=false){
    expanded=id;P().refresh();
    if(reveal)document.querySelector(`[data-provider-card="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest'});
  }
  function bind(){
    const view=document.querySelector('#view');
    view.querySelectorAll('[data-model-category]').forEach(button=>button.onclick=()=>{
      if(category!==button.dataset.modelCategory){category=button.dataset.modelCategory;expanded='';P().refresh({resetScroll:true});}
    });
    view.querySelector('[data-provider-add]').onclick=chooseProvider;
    view.querySelectorAll('[data-provider-toggle]').forEach(button=>button.onclick=()=>showSource(expanded===button.dataset.providerToggle?'':button.dataset.providerToggle));
    view.querySelectorAll('[data-provider-menu]').forEach(button=>button.onclick=()=>{
      const id=button.dataset.providerMenu,draft=drafts.get(draftKey(id)),source=sourceFor(id)||draft.source;
      const name=sourceTitle(source,draft?cardSource(draft):source);
      P().actionSheet(name,[{label:'删除服务商',danger:true,run:()=>removeSource({...source,name})}]);
    });
    const form=view.querySelector('[data-provider-form]');
    if(form)bindCard(form,drafts.get(draftKey(form.dataset.providerForm)));
    view.querySelector('#model-relay').onclick=editRelay;
  }
  function chooseProvider(){
    const list=templates.filter(item=>item.id!=='choupi'&&item.kinds.includes(category));
    sheet('添加'+cat().label+'服务商',`<div class="search-wrap"><input type="search" id="model-provider-search" placeholder="搜索服务商" aria-label="搜索服务商"></div><div class="provider-grid">${list.map(item=>`<button type="button" class="provider-choice" data-template="${item.id}" data-name="${esc(item.name.toLowerCase())}">${mark(item)}<span><strong>${esc(item.name)}</strong><small>${esc(item.desc)}</small></span></button>`).join('')}</div>`);
    const root=document.querySelector('#overlay > .page-editor');
    root.querySelector('#model-provider-search').oninput=event=>root.querySelectorAll('[data-template]').forEach(button=>button.hidden=!button.dataset.name.includes(event.target.value.toLowerCase()));
    root.querySelectorAll('[data-template]').forEach(button=>button.onclick=()=>{
      const template=templates.find(item=>item.id===button.dataset.template);
      const source={id:modelId(),name:template.name,baseUrl:template.bases?.[category]||template.base||'',builtin:false,template:template.id,kinds:[category],keySet:false};
      draftFor(source);P().closePage();showSource(source.id,true);
    });
  }
  function removeSource(source){
    const saved=sourceFor(source.id);
    const kinds=categories.filter(({id})=>source.kinds?.includes(id)||ai().models.some(model=>model.sourceId===source.id&&model.kind===id));
    const scope=kinds.length>1?`涉及${kinds.map(kind=>kind.label).join('、')}。`:'';
    const detail=saved?`将删除「${source.name}」的密钥、模型及相关用途选择。${scope}${source.builtin?'可从顶部的「一键配置」重新添加。':''}`:`将丢弃「${source.name}」尚未保存的配置。`;
    let expectedKeyRevision=saved?.keyRevision;
    P().confirmDialog('删除服务商？',detail,async()=>{
      if(saved){
        checkKeySavingAvailable(saved);
        try{await updateModels('source/delete',{sourceId:source.id,expectedKeyRevision});}
        catch(error){
          if(error.code!=='PROVIDER_KEY_CHANGED')throw error;
          expectedKeyRevision=error.keyRevisions[source.id];
          throw new Error('密钥已在其他窗口修改。若仍要删除该服务商及其新密钥，请再次点删除。');
        }
      }
      for(const [key,draft] of drafts)if(draft.source.id===source.id)drafts.delete(key);
      if(expanded===source.id)expanded='';
      P().toast('服务商已删除');
    },'删除');
  }
  function editCardModel(draft,model,candidate){
    const source=cardSource(draft),next=model||E().newModel(source.id,candidate?.model||'',{...candidate,kind:draft.kind});
    E().editModel(model?.id,{draftModel:next,source,fixedName:Boolean(candidate),onConfirm:updated=>{
      if(cardModels(draft).some(item=>item.id!==updated.id&&item.model===updated.model))throw new Error('这个型号已经添加');
      if(updated.kind==='chat'&&!updated.capabilities.includes('text'))throw new Error('聊天模型需要文本能力');
      changeModel(draft,updated.id,updated);
    }});
  }
  async function testCardModel(draft,model,control){
    const {id}=model;
    if(testing.has(id))return;
    testing.add(id);control.disabled=true;
    try{
      P().toast('正在测试连接…',true);
      const started=performance.now(),result=await P().api('/api/engine/models/test',{modelId:id,source:checkedSource(draft),model});
      P().toast(`模型 ${model.model} 测试通过，耗时 ${Math.round(performance.now()-started)} ms`,true);
      if(result.audio&&document.querySelector('#view').dataset.route==='providers'&&category===draft.kind&&expanded===draft.source.id&&!document.querySelector('#overlay').childElementCount)sheet('连接测试',`<p class="small-note">语音合成成功，可试听下面的测试音频。</p><audio class="model-test-audio" controls src="${esc(result.audio)}"></audio>`);
    }finally{
      testing.delete(id);
      document.querySelectorAll('[data-card-model-test]').forEach(button=>{if(button.dataset.cardModelTest===id)button.disabled=false;});
    }
  }
  function bindCard(form,draft){
    const body=form.querySelector('[data-provider-models-body]'),search=form.querySelector('[data-provider-query]'),status=form.querySelector('[data-provider-status]'),fetchButton=form.querySelector('[data-provider-fetch]'),errorBox=form.querySelector('[data-provider-error]');
    const discard=form.querySelector('[data-provider-reset]'),keyNote=form.querySelector('[data-provider-key-note]');
    const header=form.previousElementSibling,heading=header.querySelector('.source-copy strong'),subtitle=header.querySelector('.source-copy small');
    const paint=()=>{body.innerHTML=rows(draft);};
    const refresh=()=>{if(document.querySelector('#view').dataset.route==='providers'&&category===draft.kind&&expanded===draft.source.id)P().refresh();};
    const showStatus=()=>{status.textContent=draft.status;status.hidden=!draft.status;};
    discard.onclick=()=>P().confirmDialog('放弃本次修改？','将丢弃此卡片尚未保存的更改，并读取最新配置。',async()=>{
      config=await E().refreshConfig();
      drafts.delete(draftKey(draft.source.id,draft.kind));
      refresh();
    },'放弃修改');
    form.querySelector('.inline-provider-options')?.addEventListener('toggle',event=>{draft.advanced=event.target.open;});
    form.oninput=event=>{
      const control=event.target;
      if(control===search){draft.query=control.value;draft.pages={configured:0,available:0};paint();return;}
      if(!control.name)return;
      draft.fields[control.name]=control.type==='checkbox'?control.checked:control.value;
      if(control.name==='key'){draft.needsKey=false;keyNote.hidden=true;}
      if(control.name==='name'||control.name==='baseUrl'){
        const value=cardSource(draft),name=sourceTitle(draft.source,value),address=value.baseUrl.trim();
        heading.textContent=name;subtitle.textContent=address;subtitle.hidden=!address;
        header.querySelector('[data-provider-menu]').setAttribute('aria-label',name+'更多操作');
      }
      if(control.name!=='name'){draft.catalog=null;draft.pages.available=0;draft.status='';draft.pending=null;fetchButton.disabled=false;fetchButton.textContent='获取模型列表';paint();showStatus();}
      if(!draft.conflict){draft.error='';errorBox.hidden=true;}
    };
    fetchButton.onclick=async()=>{
      if(draft.pending)return;
      const request={};draft.pending=request;draft.status='正在获取模型…';showStatus();fetchButton.disabled=true;fetchButton.textContent='正在获取…';
      try{
        const {id,baseUrl,key,clearKey,template}=checkedSource(draft);
        const result=await P().api('/api/engine/models/list',{sourceId:id,kind:draft.kind,baseUrl,key,clearKey,template});
        if(draft.pending!==request)return;
        draft.catalog=result.models;draft.pages.available=0;draft.status=`获取到 ${result.models.length} 个模型`;
      }catch(error){if(draft.pending===request){draft.catalog=null;draft.status=error.message;}}
      finally{if(draft.pending===request){
        draft.pending=null;
        if(form.isConnected){fetchButton.disabled=false;fetchButton.textContent='获取模型列表';paint();showStatus();}
        else refresh();
      }}
    };
    form.querySelector('[data-provider-manual]').onclick=()=>editCardModel(draft);
    body.onclick=event=>{
      const button=event.target.closest('button');if(!button)return;
      const data=button.dataset;
      if(data.modelPage){
        draft.pages[data.modelPage]+=Number(data.pageStep);paint();
        const pagination=body.querySelector(`[data-model-page="${data.modelPage}"]`)?.parentElement;
        (pagination?.querySelector(`[data-page-step="${data.pageStep}"]:enabled`)||pagination?.querySelector('button:enabled'))?.focus({preventScroll:true});
        return;
      }
      if(data.providerCandidate){editCardModel(draft,null,draft.catalog.find(item=>item.model===data.providerCandidate));return;}
      const model=cardModels(draft).find(item=>[data.cardModelEdit,data.cardModelEnabled,data.cardModelRemove,data.cardModelTest,data.cardModelUse].includes(item.id));
      if(!model)return;
      if(data.cardModelEdit){editCardModel(draft,model);return;}
      if(data.cardModelEnabled){
        changeModel(draft,model.id,{...model,enabled:model.enabled===false});paint();
        body.querySelector(`[data-card-model-enabled="${CSS.escape(model.id)}"]`)?.focus({preventScroll:true});
        return;
      }
      if(data.cardModelTest){run(()=>testCardModel(draft,model,button));return;}
      if(data.cardModelUse){
        if(draft.kind==='stt')P().actionSheet('设为使用',Object.entries({stt:'录完后转文字',voiceUnderstanding:'语音条理解'}).map(([purpose,label])=>({label,run:()=>{draft.assign[purpose]=model.id;refresh();}})));
        else{draft.assign[draft.kind]=model.id;paint();}
        return;
      }
      P().confirmDialog('移除模型？',`保存后将移除 ${model.model} 及对它的用途选择。`,()=>{
        changeModel(draft,model.id,null);
        for(const purpose of Object.keys(draft.assign))if(draft.assign[purpose]===model.id)delete draft.assign[purpose];
        paint();
      },'移除');
    };
    async function saveCard(expectedKeyRevision=draft.source.keyRevision){
      if(draft.saving)return;
      draft.saving=true;form.querySelector('fieldset').disabled=true;
      try{
        const {id,name,baseUrl}=checkedSource(draft);
        const source=draft.isNew?{...draft.source,...draft.fields,name,baseUrl}:{id,...draft.fields};
        if(source.key?.trim()||source.clearKey||source.baseUrl!==undefined&&baseUrl!==draft.source.baseUrl)checkKeySavingAvailable(sourceFor(id));
        if(Object.hasOwn(source,'name'))source.name=name;
        if(Object.hasOwn(source,'baseUrl'))source.baseUrl=baseUrl;
        await updateModels('card',{source,kind:draft.kind,expectedExisting:!draft.isNew,expectedBaseUrl:draft.source.baseUrl,expectedKeyRevision,updates:[...draft.updates],expectedModels:[...draft.expectedModels],assign:draft.assign});
        Object.assign(draft,{source:sourceFor(id)||draft.source,isNew:false,fields:{},assign:{},needsKey:false,error:'',conflict:false});
        draft.updates.clear();draft.expectedModels.clear();
        draft.saving=false;refresh();
        P().toast('配置已保存');
      }catch(error){
        draft.error=error.message;draft.conflict=error.status===409;
        if(error.code==='PROVIDER_KEY_CHANGED'&&form.isConnected){
          const source=cardSource(draft);
          const clearing=!draft.fields.key?.trim();
          confirmKeyChange([source.name],clearing?'确认清除密钥':'确认使用本次密钥',()=>{
            if(form.isConnected)return saveCard(error.keyRevisions[source.id]);
          });
        }
      }
      finally{
        draft.saving=false;form.querySelector('fieldset').disabled=false;
        if(draft.error){errorBox.textContent=draft.error;errorBox.hidden=false;discard.hidden=!draft.conflict;if(!form.isConnected)refresh();}
      }
    }
    form.onsubmit=event=>{event.preventDefault();return saveCard();};
  }
  let preferencesExpanded=false,captionSaving=false;
  const captionDraftKey='pipi.caption-prompt-draft';
  const emptyCaptionPrompt='点击填写转述要求';
  const modelPreferences={
    chat:{label:'对话模型',kind:'chat'},
    caption:{label:'图片转述模型',kind:'chat',empty:'未选择'},
    tts:{label:'语音模型',kind:'tts'},
    compress:{label:'压缩模型',kind:'chat',empty:'跟随对话模型'}
  };
  const chatModels=()=>ai().models.filter(model=>model.kind==='chat');
  const modelLabel=id=>{const model=ai().models.find(model=>model.id===id);return model?sourceFor(model.sourceId).name+' · '+model.model+(model.enabled===false?'（已停用）':''):'';};
  function preferenceRow(label,key,value,hint=''){
    return `<button type="button" class="model-preference-row" data-model-pref="${key}"><span class="preference-copy"><strong>${esc(label)}</strong>${hint?`<small>${esc(hint)}</small>`:''}</span><span class="preference-value" title="${esc(value)}">${esc(value)}</span>${P().icons.chevron}</button>`;
  }
  function modelPreferenceRow(purpose,hint){
    const {label,empty}=modelPreferences[purpose];
    return preferenceRow(label,purpose,modelLabel(ai().assign[purpose])||empty||'未选择',hint);
  }
  function ttsModels(current){return current.ai.models.filter(model=>model.kind==='tts'&&model.enabled!==false&&model.model&&current.ai.sources.some(source=>source.id===model.sourceId&&source.enabled!==false&&source.baseUrl&&source.keySet));}
  function ttsModelRow(current,id){
    const model=current.ai.models.find(item=>item.id===id),source=model&&current.ai.sources.find(item=>item.id===model.sourceId);
    return preferenceRow('语音模型','voice-model',model?`${source?.name||''} · ${model.model}${model.enabled===false?'（已停用）':''}`:'未选择');
  }
  function chooseTtsModel(current,id,onChoose){
    const models=ttsModels(current);
    singleChoiceSheet('语音模型',models.map(model=>({value:model.id,label:model.model,detail:current.ai.sources.find(source=>source.id===model.sourceId).name})),id,onChoose,{name:'voice-model',selectImmediately:true,note:models.length?'':'请先在模型设置中添加并启用语音合成模型，填写服务地址和 API Key。'});
  }
  function compressionSettings(){return {...Object.fromEntries(config.modules.find(module=>module.id==='compression')?.settings.map(setting=>[setting.key,setting.default])||[]),...config.settings?.compression};}
  function renderCaptionPrompt(){
    const setting=config.modules.find(module=>module.id==='caption').settings.find(setting=>setting.key==='prompt');
    const saved=config.settings.caption.prompt;
    const value=sessionStorage.getItem(captionDraftKey)??saved;
    return `<form id="caption-preferences-form" class="form-block caption-preferences-form">
      <details class="caption-prompt-details">
        <summary><span id="caption-prompt-label">${esc(setting.label)}</span><span class="caption-prompt-preview">${esc(value||emptyCaptionPrompt)}</span></summary>
        <textarea id="caption-prompt" aria-labelledby="caption-prompt-label" name="prompt" rows="2" maxlength="${setting.maxLength}" ${captionSaving?'readonly':''}>\n${esc(value)}</textarea>
        <button type="submit" class="link-action" ${captionSaving||value===saved?'disabled':''}>保存</button>
      </details>
    </form>`;
  }
  function renderPreferences(current){
    config=current;const settings=compressionSettings(),summarize=settings.strategy!=='truncate';
    return `<div class="model-ui model-preferences"><h3 class="section-title settings-group-title" id="model-chat-heading">对话设置</h3><section class="model-preference-group" aria-labelledby="model-chat-heading">
      ${modelPreferenceRow('chat')}
      ${preferenceRow('回退模型','fallbacks',ai().assign.chatFallbacks.length?'已选择 '+ai().assign.chatFallbacks.length+' 个':'未设置','主模型请求失败时，按顺序尝试')}
      ${modelPreferenceRow('caption','将图片内容转成文字')}
      ${renderCaptionPrompt()}
      ${modelPreferenceRow('tts')}
      </section><h3 class="section-title settings-group-title" id="model-context-heading">上下文管理</h3><section class="model-preference-group" aria-labelledby="model-context-heading">
      ${preferenceRow('处理方式','strategy',summarize?'总结较早聊天':'按轮次裁剪')}
      ${summarize?modelPreferenceRow('compress'):''}
      ${preferenceRow('触发比例','triggerRatio',Math.round(settings.triggerRatio*100)+'%','达到上下文容量的这个比例时处理')}
      ${summarize?preferenceRow('保留最近原话','keepRecentRatio',Math.round(settings.keepRecentRatio*100)+'%','按当前聊天长度计算，保留完整轮次'):''}
      <details class="model-context-details" ${preferencesExpanded?'open':''}><summary>更多参数</summary>
      ${preferenceRow('最多历史轮数','maxTurns',settings.maxTurns===-1?'不限':settings.maxTurns+' 轮')}
      ${preferenceRow('每次裁剪轮数','dropTurns',settings.dropTurns+' 轮')}
      ${summarize?preferenceRow('整理要求','prompt',settings.prompt?'已自定义':'默认'):''}</details></section></div>`;
  }
  async function saveCompression(values){
    const result=await P().api('/api/engine/modules',{id:'compression',values});P().setState(result.state);config=await E().refreshConfig();P().closePage(false);P().refresh();P().toast('设置已保存');
  }
  function choosePreferenceModel(purpose){
    const {label,kind,empty}=modelPreferences[purpose];
    const models=ai().models.filter(model=>model.kind===kind&&model.enabled!==false&&(purpose!=='caption'||model.capabilities.includes('image')));
    const options=[...(empty?[{value:'',label:empty}]:[]),...models.map(model=>({value:model.id,label:model.model,detail:sourceFor(model.sourceId).name}))];
    const needed=purpose==='caption'?'支持识图的对话模型':kind==='chat'?'对话模型':label;
    singleChoiceSheet(label,options,ai().assign[purpose],async (value,form)=>{
      if(value===undefined)throw new Error('请选择模型');
      await updateModels('assign',{assign:{[purpose]:value}});
      if(form.isConnected)P().closePage(false);P().refresh();
    },{name:'preference-model',note:models.length?'':`请先到模型页启用${needed}。`});
  }
  function chooseFallbacks(){
    let selected=[...ai().assign.chatFallbacks];const models=chatModels().filter(model=>model.enabled!==false||selected.includes(model.id));
    sheet('回退模型','<p class="small-note">主模型请求失败时，按已选顺序尝试。</p><div id="model-fallback-choices"></div>',async form=>{await updateModels('assign',{assign:{chatFallbacks:selected}});if(form.isConnected)P().closePage(false);P().refresh();});
    const root=document.querySelector('#model-fallback-choices');
    const paint=()=>{
      const ordered=[...selected.map(id=>models.find(model=>model.id===id)).filter(Boolean),...models.filter(model=>model.enabled!==false&&!selected.includes(model.id))];
      root.innerHTML=ordered.map(model=>{const index=selected.indexOf(model.id);return `<div class="fallback-choice"><label class="choice-row assignment-option"><span>${index>=0?`${index+1}. `:''}${esc(model.model)}<small>${esc(sourceFor(model.sourceId).name)}</small></span><input type="checkbox" data-fallback-choice="${esc(model.id)}" ${index>=0?'checked':''}></label>${index>=0?`<span class="fallback-order"><button type="button" data-fallback-move="${index}" data-direction="-1" aria-label="上移 ${esc(model.model)}" ${index===0?'disabled':''}>↑</button><button type="button" data-fallback-move="${index}" data-direction="1" aria-label="下移 ${esc(model.model)}" ${index===selected.length-1?'disabled':''}>↓</button></span>`:''}</div>`;}).join('')||'<p class="small-note">请先添加对话模型。</p>';
      root.querySelectorAll('[data-fallback-choice]').forEach(input=>input.onchange=()=>{if(input.checked){if(selected.length===20){input.checked=false;P().toast('最多选择 20 个回退模型');return;}selected.push(input.dataset.fallbackChoice);}else selected=selected.filter(id=>id!==input.dataset.fallbackChoice);paint();});
      root.querySelectorAll('[data-fallback-move]').forEach(control=>control.onclick=()=>{const from=Number(control.dataset.fallbackMove),to=from+Number(control.dataset.direction);[selected[from],selected[to]]=[selected[to],selected[from]];paint();});
    };paint();
  }
  function editCompression(key){
    const settings=compressionSettings();
    if(key==='strategy'){
      singleChoiceSheet('上下文处理方式',[
        {value:'summary',label:'总结较早聊天',detail:'将较早内容整理成摘要，保留最近原话'},
        {value:'truncate',label:'按轮次裁剪',detail:'不生成摘要，减少发送给模型的早期轮次'}
      ],settings.strategy||'summary',strategy=>saveCompression({strategy}),{name:'strategy'});
      return;
    }
    const setting=config.modules.find(module=>module.id==='compression').settings.find(item=>item.key===key),percent=['triggerRatio','keepRecentRatio'].includes(key),value=percent?Math.round(settings[key]*100):settings[key];
    const controls=key==='prompt'?`<label class="edit-field"><span>整理要求</span><textarea name="value" maxlength="16000" placeholder="留空使用默认整理要求">${esc(value)}</textarea></label>`:`<label class="edit-field"><span>${esc(setting.label)}${percent?'（%）':''}</span><input name="value" type="number" value="${esc(value)}" min="${percent?setting.min*100:setting.min}" max="${percent?setting.max*100:setting.max}" step="1" required></label>`;
    sheet(setting.label,`<div class="form-block">${controls}</div>${setting.hint?`<p class="small-note">${esc(setting.hint)}</p>`:''}`,form=>saveCompression({[key]:key==='prompt'?form.elements.value.value:Number(form.elements.value.value)/(percent?100:1)}));
  }
  function bindPreferences(){
    const details=document.querySelector('.model-context-details');if(details)details.ontoggle=()=>{preferencesExpanded=details.open;};
    document.querySelectorAll('[data-model-pref]').forEach(control=>control.onclick=()=>{const key=control.dataset.modelPref;if(Object.hasOwn(modelPreferences,key))choosePreferenceModel(key);else if(key==='fallbacks')chooseFallbacks();else editCompression(key);});
    const form=document.querySelector('#caption-preferences-form');
    if(!form)return;
    const input=form.elements.prompt,button=form.querySelector('[type="submit"]');
    const captionDetails=form.querySelector('details'),preview=form.querySelector('.caption-prompt-preview');
    form.querySelector('summary').onclick=event=>{
      if(captionDetails.open)return;
      event.preventDefault();
      captionDetails.open=true;
      input.focus({preventScroll:true});
    };
    input.oninput=()=>{
      const changed=input.value!==config.settings.caption.prompt;
      if(changed)sessionStorage.setItem(captionDraftKey,input.value);
      else sessionStorage.removeItem(captionDraftKey);
      preview.textContent=input.value||emptyCaptionPrompt;
      button.disabled=!changed;
    };
    form.onsubmit=event=>{
      event.preventDefault();
      if(captionSaving||button.disabled)return;
      return run(async()=>{
        const prompt=input.value;
        captionSaving=true;
        button.disabled=true;
        input.readOnly=true;
        try{
          const result=await P().api('/api/engine/modules',{id:'caption',values:{prompt}});
          P().setState(result.state);
          config=await E().refreshConfig();
          sessionStorage.removeItem(captionDraftKey);
          const openCaption=document.querySelector('#caption-preferences-form details[open]');
          if(openCaption)openCaption.open=false;
          P().toast('转述要求已保存');
        }finally{
          captionSaving=false;
          if(document.querySelector('#caption-preferences-form'))P().refresh();
        }
      });
    };
  }
  function editRelay(){
    let expectedKeyRevisions=Object.fromEntries(groups.map(({id})=>[id,sourceFor(id).keyRevision]));
    const fields=groups.map(group=>{
      const source=sourceFor(group.id);
      return input(group.label,group.id,'',source.keySet?'已保存，留空保留':'填写该分组 API Key','password');
    }).join('');
    sheet('屁屁自己的站',`<p class="relay-intro">填写要配置的分组密钥。对话模型接入后手动获取，其他已填写的分组自动添加默认模型。</p><div class="form-block">${fields}</div><div class="button-area relay-submit"></div>`,async form=>{
      const keys=Object.fromEntries(groups.map(({id})=>[id,form.elements[id].value.trim()]));
      for(const {id} of groups)if(keys[id])checkKeySavingAvailable(sourceFor(id));
      let result;
      try{result=await updateModels('station',{keys,expectedKeyRevisions});}
      catch(error){
        if(error.code!=='PROVIDER_KEY_CHANGED'||!form.isConnected)throw error;
        const names=groups.filter(({id})=>Object.hasOwn(error.keyRevisions,id)).map(group=>group.label);
        confirmKeyChange(names,'确认使用本次密钥',()=>{
          if(!form.isConnected)return;
          expectedKeyRevisions={...expectedKeyRevisions,...error.keyRevisions};
          form.requestSubmit();
        });
        return;
      }
      const {unconfiguredGroups}=result;
      if(form.isConnected)P().closePage(false);P().refresh();
      const missing=groups.filter(group=>unconfiguredGroups?.includes(group.id)).map(group=>group.label);
      P().toast(missing.length?`密钥已保存。${missing.join('、')}有模型需要手动配置。`:'一键配置完成');
    },'一键配置');
    const root=document.querySelector('#overlay > .page-editor'),button=root.querySelector('.modal-submit');
    button.id='relay-auto';button.classList.add('primary');
    root.querySelector('.relay-submit').append(button);
    root.querySelector('.modal-header').append(document.createElement('span'));
  }
  function captureDrafts(){
    return [...drafts.values()].map(draft=>{
      const {id,name,baseUrl,builtin,template,kinds,keySet,keyRevision}=draft.source;
      const {name:editedName,baseUrl:editedUrl,clearKey,key}=draft.fields;
      const needsKey=Boolean(key||draft.needsKey);
      const visible=draft.kind===category&&id===expanded;
      return {source:{id,name,baseUrl,builtin,template,kinds,keySet,keyRevision},kind:draft.kind,isNew:draft.isNew,
        fields:{name:editedName,baseUrl:editedUrl,clearKey:needsKey?undefined:clearKey},
        updates:[...draft.updates],expectedModels:[...draft.expectedModels],assign:draft.assign,needsKey,
        catalog:visible?draft.catalog?.map(({model,capabilities})=>({model,capabilities}))??null:null,
        query:draft.query,status:visible&&draft.catalog?draft.status:'',advanced:draft.advanced,pages:draft.pages};
    });
  }
  function restoreDrafts(saved){
    const sources=P().getState().settings.ai.sources;
    for(const draft of saved){
      const pendingKeyEdit=draft.needsKey||draft.fields.clearKey||draft.fields.baseUrl!==undefined;
      const current=!draft.isNew&&!pendingKeyEdit&&sources.find(source=>source.id===draft.source.id);
      drafts.set(draftKey(draft.source.id,draft.kind),{...draft,source:current||draft.source,updates:new Map(draft.updates),expectedModels:new Map(draft.expectedModels)});
    }
  }
  function restoreCategory(value,id){if(categories.some(item=>item.id===value))category=value;expanded=id||'';}
  function reset(){drafts.clear();testing.clear();expanded='';category='chat';sessionStorage.removeItem(captionDraftKey);}
  window.PipiModels={ttsModels,ttsModelRow,chooseTtsModel,render,bind,renderPreferences,bindPreferences,singleChoiceSheet,getCategory:()=>category,getExpanded:()=>expanded,captureDrafts,restoreDrafts,restoreCategory,reset};
})();
