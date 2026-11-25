// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {BASE_URL,CHAT_PRESETS,builtinSources,builtinModels}=require('./builtin-source.cjs');
const {lookup,capacity}=require('./model-catalog.cjs');
const purposes=['chat','compress','caption','stt','voiceUnderstanding','tts','image','embedding','decision','rerank'];
const kinds=['chat','stt','tts','image','embedding','decision','rerank'];
const protocols={stt:['auto','transcription','mimo-asr','qwen-omni','audio-chat'],tts:['auto','openai-speech','breezeblue','minimax','qwen-tts'],decision:['auto','chat','system-one']};
const capabilities=['text','image','audio','tool_use'];
const fail=(message,status=400,code='VALIDATION')=>{throw Object.assign(new Error(message),{status,code});};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const timeoutByKind={chat:120,stt:45,tts:20,image:120,embedding:20,decision:5,rerank:20};
function ttsTemplate(model,source){
  return ({'openai-speech':'compatible',breezeblue:'breezeblue',minimax:'minimax','qwen-tts':'qwen'})[model.protocol]
    || (/^breeze-tts/i.test(model.model)?'breezeblue':source.template);
}
function defaultTimeoutSeconds(model,source={}){
  if(!kinds.includes(model.kind))fail('模型类型无效');
  if(!(protocols[model.kind]||['auto']).includes(model.protocol??'auto'))fail('模型调用方式无效');
  if(model.kind==='stt'){
    const protocol=require('../provider-audio.cjs').speechProtocol({...model,sourceTemplate:source.template});
    if(protocol==='mimo-asr')return 20;
    if(protocol==='transcription')return 600; // Whisper delegates to the OpenAI SDK.
  }
  if(model.kind==='tts'){
    const template=ttsTemplate(model,source);
    if(template==='minimax')return 60; // AstrBot's active adapter uses 60 seconds.
    if(template==='breezeblue')return 45;
  }
  return timeoutByKind[model.kind];
}
function string(value,max,label,{empty=true}={}){
  if(typeof value!=='string'||value.length>max||!empty&&!value.trim())fail(label+'无效');
  return value;
}
function identifier(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))fail('配置编号无效');
  return value;
}
function baseUrl(value){
  string(value,2048,'服务地址');
  if(!value)return '';
  let url;
  try{url=new URL(value);}catch{fail('服务地址无效');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)fail('服务地址须为无凭据的 HTTP(S) 地址');
  return value.replace(/\/+$/,'');
}
function key(value){
  string(value,4096,'密钥');
  // Pasted keys often carry spaces, a line break or invisible characters at the ends; none belong to a real key.
  const clean=value.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim();
  if(/[\r\n]/.test(clean))fail('密钥格式无效');
  return clean;
}
// Older stored sources start at the same baseline until their first credential change.
const keyRevision=source=>source.keyRevision??'initial';
function checkKeyRevisions(sources,expected){
  const conflicts=sources.filter(source=>keyRevision(source)!==expected?.[source.id]);
  if(conflicts.length)throw Object.assign(new Error('服务商密钥已变更，请重新确认后再保存'),{
    status:409,code:'PROVIDER_KEY_CHANGED',keyRevisions:Object.fromEntries(conflicts.map(source=>[source.id,keyRevision(source)]))
  });
}
function retainKeyRevisions(previous,sources){
  const originals=new Map(previous.map(source=>[source.id,source]));
  for(const source of sources){
    const old=originals.get(source.id);
    if(!old||baseUrl(old.baseUrl)!==baseUrl(source.baseUrl)||(old.key||'')!==(source.key||'')||!isDeepStrictEqual(old.overrideKey,source.overrideKey))source.keyRevision=randomUUID();
    else if(old.keyRevision)source.keyRevision=old.keyRevision;
  }
}
function emptyAssign(){return {chat:'',chatFallbacks:[],compress:'',caption:'',stt:'',voiceUnderstanding:'',tts:'',image:'',embedding:'',decision:'',rerank:'',chatSelections:[]};}
function migrate(s){
  const existing=s.settings.ai;
  const builtins=builtinSources(existing?.sources,{runtime:false}).map(source=>{
    const old=existing?.sources.find(x=>x.id===source.id);
    return {...old,...source,baseUrl:baseUrl(source.baseUrl),key:old?.key||''};
  });
  if(existing){
    if(existing.imageTimeoutDefault===undefined){
      // Older releases stored the 45-second default as an explicit value.
      for(const model of existing.models)if(model.kind==='image'&&model.timeoutSeconds===45)model.timeoutSeconds=null;
      existing.imageTimeoutDefault=timeoutByKind.image;
    }
    existing.sources=[builtins[0],...existing.sources.filter(x=>!builtins.some(b=>b.id===x.id)),...builtins.slice(1)];
    existing.assign.chatSelections??=existing.assign.chat?[existing.assign.chat]:[];
    existing.assign.voiceUnderstanding??=existing.assign.stt||'';
    return existing;
  }
  const ai={sources:builtins,models:[],assign:emptyAssign(),imageTimeoutDefault:timeoutByKind.image},preset=s.settings.preset||{};
  const legacy=Object.entries(s.settings.providers||{});
  for(const [cap,p]of legacy){
    const url=p.mode==='preset'?preset.baseUrl||'':p.baseUrl||'';
    const model=p.mode==='preset'?p.model||preset.model||'':p.model||'';
    if(!url&&!p.key&&!model)continue;
    let source=ai.sources.find(x=>!x.builtin&&x.baseUrl===url&&x.key===(p.key||''));
    if(!source){
      source={id:'legacy-'+cap,name:p.mode==='preset'?preset.label||'原模型服务商':'原'+({chat:'聊天',vision:'识图',tts:'朗读',stt:'转写'}[cap]||cap)+'服务',baseUrl:url,key:p.key||'',builtin:false};
      ai.sources.push(source);
    }
    if(!model)continue;
    const hints=lookup(model),kind=cap==='vision'?'chat':cap;
    const entry={id:'legacy-'+cap,sourceId:source.id,model,kind,capabilities:kind==='chat'?[...new Set([...hints.capabilities,...(cap==='vision'?['image']:[])])]:[],maxContextTokens:hints.maxContextTokens,temperature:null,maxTokens:cap==='chat'?1500:null,timeoutSeconds:kind==='image'?null:45,extraBody:{},voice:p.voice||'alloy'};
    ai.models.push(entry);
    ai.assign[cap==='vision'?'caption':cap]=entry.id;
  }
  ai.assign.chatSelections=ai.assign.chat?[ai.assign.chat]:[];
  ai.assign.voiceUnderstanding=ai.assign.stt;
  s.settings.ai=ai;
  return ai;
}
const destination=url=>createHash('sha256').update(url).digest('hex');
function effectiveSources(ai){
  const builtins=builtinSources(ai.sources);
  return ai.sources.map(source=>{
    const active=builtins.find(item=>item.id===source.id);
    if(!active)return source;
    const {overrideKey,...stored}=source;
    const url=baseUrl(active.baseUrl);
    if(url===stored.baseUrl)return stored;
    // Keep each credential bound to the address it was entered for.
    return {...stored,baseUrl:url,key:overrideKey?.destination===destination(url)?overrideKey.key:''};
  });
}
function sanitize(ai,{runtime=true}={}){
  const out=structuredClone(ai);
  out.assign.chatSelections??=out.assign.chat?[out.assign.chat]:[];
  out.assign.voiceUnderstanding??=out.assign.stt||'';
  for(const model of out.models)model.enabled??=true;
  out.sources=(runtime?effectiveSources(out):out.sources).map(source=>{
    const {key:secret,overrideKey,...rest}=source;
    return {...rest,keyRevision:keyRevision(source),keySet:Boolean(secret)};
  });
  return out;
}
function backupKeys(ai){
  const active=new Map(effectiveSources(ai).map(source=>[source.id,source]));
  const entries=[];
  for(const source of ai.sources){
    const sourceId=source.id,url=baseUrl(source.baseUrl),runtime=active.get(sourceId),runtimeUrl=baseUrl(runtime.baseUrl);
    if(url&&source.key)entries.push({sourceId,baseUrl:url,key:source.key});
    if(runtimeUrl&&runtimeUrl!==url&&runtime.key)entries.push({sourceId,baseUrl:runtimeUrl,key:runtime.key});
  }
  return entries;
}
function restoreBackupKeys(ai,input){
  let restoredModelKeys=0,skippedModelKeys=0;
  if(input===undefined)input=[];
  if(!Array.isArray(input)||input.length>104)fail('模型密钥备份格式无效');
  const seen=new Set();
  const entries=input.map(entry=>{
    if(!object(entry))fail('模型密钥备份格式无效');
    const sourceId=identifier(entry.sourceId),url=baseUrl(entry.baseUrl),secret=key(entry.key);
    const pair=sourceId+'\n'+url;
    if(!url||!secret||seen.has(pair))fail('模型密钥备份格式无效或有重复记录');
    seen.add(pair);
    return {sourceId,url,secret};
  });
  const sources=new Map(ai.sources.map(source=>[source.id,source]));
  const active=new Map(effectiveSources(ai).map(source=>[source.id,source]));
  for(const {sourceId,url,secret} of entries){
    const source=sources.get(sourceId);
    if(source&&baseUrl(source.baseUrl)===url)source.key=secret;
    else if(source?.builtin&&active.get(sourceId).baseUrl===url)source.overrideKey={destination:destination(url),key:secret};
    else {skippedModelKeys++;continue;}
    restoredModelKeys++;
  }
  // An imported snapshot must never revalidate a draft from before the restore.
  for(const source of ai.sources)source.keyRevision=randomUUID();
  return {restoredModelKeys,skippedModelKeys};
}
function optionalNumber(value,min,max,label,{integer=false}={}){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isSafeInteger(value))fail(label+'超出允许范围');
  return value;
}
function save(s,input,{stationPreset=false,autoAssignTo=()=>true,checkSubmittedKeys=false}={}){
  if(!object(input)||!Array.isArray(input.sources)||input.sources.length>100||!Array.isArray(input.models)||input.models.length>1000||!object(input.assign))fail('模型配置格式无效');
  const previous=s.settings.ai||{sources:[]},builtins=builtinSources(previous.sources,{runtime:false});
  const previousModels=new Map((previous.models||[]).map(model=>[model.id,model]));
  const activeBuiltins=builtinSources(previous.sources),sourceIds=new Set(),modelIds=new Set();
  if(!input.sources.some(x=>x?.id==='pipi'))fail('内置服务商不能删除');
  const sources=input.sources.map(raw=>{
    if(!object(raw))fail('服务商格式无效');
    const id=identifier(raw.id);
    if(sourceIds.has(id))fail('服务商编号重复');
    sourceIds.add(id);
    const old=previous.sources.find(x=>x.id===id),builtin=builtins.find(x=>x.id===id),isBuiltin=Boolean(builtin);
    const url=isBuiltin?baseUrl(builtin.baseUrl):baseUrl(raw.baseUrl);
    const activeUrl=isBuiltin?baseUrl(activeBuiltins.find(source=>source.id===id).baseUrl):url;
    if(isBuiltin&&(raw.builtin!==true||raw.baseUrl!==activeUrl||raw.name!==builtin.name)||!isBuiltin&&raw.builtin)fail('内置服务商不能修改');
    let secret=old&&baseUrl(old.baseUrl)===url?old.key||'':'',overrideKey=isBuiltin?old?.overrideKey:undefined;
    if(raw.clearKey!==undefined&&typeof raw.clearKey!=='boolean')fail('清除密钥选项无效');
    const supplied=raw.key===undefined?'':key(raw.key);
    if(checkSubmittedKeys&&old&&(supplied||raw.clearKey||url!==baseUrl(old.baseUrl)))checkKeyRevisions([old],{[id]:raw.keyRevision});
    if(activeUrl===url){
      if(raw.clearKey||supplied)secret=supplied;
    }else{
      const target=destination(activeUrl);
      if(supplied)overrideKey={destination:target,key:supplied};
      else if(raw.clearKey&&overrideKey?.destination===target)overrideKey=undefined;
    }
    const template=string(raw.template??old?.template??'',100,'服务商类型');
    const supported=raw.kinds??old?.kinds;
    if(supported!==undefined&&(!Array.isArray(supported)||supported.some(x=>!kinds.includes(x))))fail('服务商支持类型无效');
    return {id,name:isBuiltin?builtin.name:string(raw.name,100,'服务商名称',{empty:false}),baseUrl:url,key:secret,builtin:isBuiltin,...(overrideKey?{overrideKey}:{}),...(template?{template}:{}),...(supported?{kinds:[...new Set(supported)]}:{})};
  }).sort((a,b)=>Number(b.builtin)-Number(a.builtin));
  if(checkSubmittedKeys&&previous.sources.some(source=>!source.builtin&&source.key&&!sourceIds.has(source.id)))fail('服务商列表已变更，请刷新后在服务商菜单删除',409,'PROVIDER_CONFIG_CHANGED');
  for(const builtin of builtins)if(!sourceIds.has(builtin.id)){
    const old=previous.sources.find(x=>x.id===builtin.id);
    sources.push({...old,...builtin,baseUrl:baseUrl(builtin.baseUrl),key:old?.key||''});sourceIds.add(builtin.id);
  }
  const models=input.models.map(raw=>{
    if(!object(raw))fail('模型格式无效');
    const id=identifier(raw.id),sourceId=identifier(raw.sourceId);
    if(modelIds.has(id))fail('模型编号重复');
    modelIds.add(id);
    if(!sourceIds.has(sourceId)||!kinds.includes(raw.kind))fail('模型来源或类型无效');
    const model=string(raw.model,200,'模型名称',{empty:false});
    if(raw.enabled!==undefined&&typeof raw.enabled!=='boolean')fail('模型启用状态无效');
    const enabled=raw.enabled??previousModels.get(id)?.enabled??true;
    if(!Array.isArray(raw.capabilities)||raw.capabilities.some(x=>!capabilities.includes(x)))fail('模型能力无效');
    const caps=raw.kind==='chat'?[...new Set(raw.capabilities)]:[];
    if(raw.kind==='chat'&&!caps.includes('text'))fail('聊天模型需要文本能力');
    const maxContextTokens=optionalNumber(raw.maxContextTokens??0,0,100000000,'对话容量',{integer:true});
    const temperature=optionalNumber(raw.temperature,0,2,'温度'),maxTokens=optionalNumber(raw.maxTokens,1,10000000,'最大回复长度',{integer:true});
    let extraBody=raw.extraBody??{};
    if(typeof extraBody==='string'){try{extraBody=JSON.parse(string(extraBody,32768,'额外参数'));}catch{fail('额外参数须为 JSON 对象');}}
    if(!object(extraBody)||JSON.stringify(extraBody).length>32768)fail('额外参数须为 JSON 对象');
    const protocol=raw.protocol??'auto';
    const savedTimeout=raw.timeoutSeconds===undefined?previousModels.get(id)?.timeoutSeconds:raw.timeoutSeconds;
    const defaultTimeout=defaultTimeoutSeconds({kind:raw.kind,model,protocol},sources.find(source=>source.id===sourceId));
    // Keep an empty image timeout tied to the default across future upgrades.
    const timeoutSeconds=optionalNumber(savedTimeout,1,600,'超时')??(raw.kind==='image'?null:defaultTimeout);
    return {id,sourceId,model,kind:raw.kind,enabled,protocol,capabilities:caps,maxContextTokens,temperature,maxTokens,timeoutSeconds,extraBody:structuredClone(extraBody),voice:string(raw.voice??'',100,'声音')};
  });
  const assign=emptyAssign();
  function reference(value,purpose){
    if(value===undefined||value==='')return '';
    identifier(value);
    const model=models.find(x=>x.id===value),kind=['compress','caption'].includes(purpose)?'chat':purpose==='voiceUnderstanding'?'stt':purpose;
    if(!model||model.kind!==kind||purpose==='caption'&&!model.capabilities.includes('image'))fail('用途指定的模型不存在或能力不符');
    return value;
  }
  for(const purpose of purposes)assign[purpose]=reference(input.assign[purpose]??previous.assign?.[purpose],purpose);
  if(input.assign.voiceUnderstanding===undefined&&previous.assign?.voiceUnderstanding===undefined)assign.voiceUnderstanding=assign.stt;
  const audio=require('../provider-audio.cjs'),purposeFor=model=>model.kind==='stt'?audio.defaultPurpose(model):model.kind;
  const readyIds=ai=>new Set(effectiveSources(ai).filter(source=>source.baseUrl&&source.key).map(source=>source.id));
  const readySources=readyIds({sources}),previousReadySources=readyIds(previous);
  for(const model of models){
    const purpose=purposeFor(model);
    if(!model.enabled||!['stt','voiceUnderstanding','tts','image','decision','embedding','rerank'].includes(purpose)||assign[purpose]||!readySources.has(model.sourceId)||!autoAssignTo(model))continue;
    const before=previousModels.get(model.id);
    if(before&&previousReadySources.has(before.sourceId)&&purposeFor(before)===purpose)continue;
    assign[purpose]=model.id;
  }
  const explicitSelections=input.assign.chatSelections!==undefined;
  let selections=input.assign.chatSelections??previous.assign?.chatSelections??(assign.chat?[assign.chat]:[]);
  if(!Array.isArray(selections)||selections.length>4)fail('聊天模型最多选择4个');
  selections=selections.map(x=>reference(x,'chat'));
  if(selections.some(x=>!x)||new Set(selections).size!==selections.length)fail('聊天模型不能重复或留空');
  if(assign.chat&&!selections.includes(assign.chat)){
    if(explicitSelections&&selections.length>0)fail('主聊天模型必须在已选择模型中');
    selections=[assign.chat,...selections.filter(x=>x!==previous.assign?.chat)].slice(0,4);
  }
  assign.chatSelections=selections;
  if(!Array.isArray(input.assign.chatFallbacks)||input.assign.chatFallbacks.length>20)fail('备用模型列表无效');
  assign.chatFallbacks=input.assign.chatFallbacks.map(x=>reference(x,'chat'));
  if(assign.chatFallbacks.some(x=>!x)||new Set(assign.chatFallbacks).size!==assign.chatFallbacks.length)fail('备用模型不能重复或留空');
  const next={sources,models,assign,imageTimeoutDefault:timeoutByKind.image};
  retainKeyRevisions(previous.sources,sources);
  if(stationPreset)addBuiltinChatPresets(next);
  s.settings.ai=next;
  return next;
}
function pruneReferences(assign,removed){
  return Object.fromEntries(Object.entries(assign).map(([purpose,value])=>[purpose,Array.isArray(value)?value.filter(id=>!removed.has(id)):removed.has(value)?'':value]));
}
function saveCard(s,{source,kind,updates,assign,expectedExisting,expectedBaseUrl,expectedKeyRevision,expectedModels}){
  if(!object(source)||!kinds.includes(kind)||!Array.isArray(updates)||updates.length>1000||!object(assign)||typeof expectedExisting!=='boolean')fail('服务商面板配置无效');
  const sourceId=identifier(source.id),ai=sanitize(s.settings.ai),sources=new Map(ai.sources.map(item=>[item.id,item])),models=new Map(ai.models.map(item=>[item.id,item]));
  const currentSource=sources.get(sourceId);
  if(expectedExisting!==Boolean(currentSource))fail('服务商已在其他页面变更，请刷新后再保存',409,'PROVIDER_CONFIG_CHANGED');
  if(currentSource&&['baseUrl','key','clearKey'].some(field=>Object.hasOwn(source,field))){
    if(expectedBaseUrl===undefined)fail('缺少原接口地址，请刷新后再保存',409,'PROVIDER_CONFIG_CHANGED');
    if(baseUrl(currentSource.baseUrl)!==baseUrl(expectedBaseUrl))fail('接口地址已在其他页面更改，请刷新后重新填写密钥',409,'PROVIDER_CONFIG_CHANGED');
    if(source.key||source.clearKey||(source.baseUrl!==undefined&&baseUrl(source.baseUrl)!==baseUrl(currentSource.baseUrl)))checkKeyRevisions([currentSource],{[sourceId]:expectedKeyRevision});
  }
  if(currentSource){
    const fields=Object.fromEntries(Object.entries(source).filter(([field])=>['name','baseUrl','key','clearKey'].includes(field)));
    sources.set(sourceId,{...currentSource,...fields});
  }else{
    if(!source.baseUrl||source.builtin)fail('请填写服务商接口地址');
    sources.set(sourceId,{...source,builtin:false,kinds:[kind]});
  }
  const currentModels=new Map(models),changes=new Map(),removed=new Set(),scoped=model=>model.sourceId===sourceId&&model.kind===kind;
  for(const entry of updates){
    if(!Array.isArray(entry)||entry.length!==2)fail('模型修改格式无效');
    const [id,model]=entry;
    identifier(id);
    if(changes.has(id))fail('模型编号重复');
    const current=currentModels.get(id);
    if(current&&!scoped(current)||model!==null&&(!object(model)||id!==model.id||!scoped(model)))fail('模型与当前服务商或分类不匹配');
    changes.set(id,model);
    if(model)models.set(id,model);
    else{models.delete(id);removed.add(id);}
  }
  if(expectedModels!==undefined){
    if(!Array.isArray(expectedModels)||expectedModels.length!==changes.size)fail('模型修改版本格式无效');
    const seen=new Set();
    for(const entry of expectedModels){
      if(!Array.isArray(entry)||entry.length!==2||!changes.has(entry[0])||seen.has(entry[0]))fail('模型修改版本格式无效');
      const [id,expected]=entry;
      seen.add(id);
      if(!isDeepStrictEqual(currentModels.get(id)??null,expected))fail('模型已在其他页面变更，请刷新后再保存',409,'PROVIDER_CONFIG_CHANGED');
    }
  }
  const nextModels=[...models.values()];
  for(const [id,model] of changes){
    if(model&&model.model!==currentModels.get(id)?.model&&nextModels.some(other=>other.id!==id&&scoped(other)&&other.model===model.model))fail('这个型号已经添加');
  }
  const allowed=kind==='chat'?[]:kind==='stt'?['stt','voiceUnderstanding']:[kind];
  for(const [purpose,id] of Object.entries(assign)){
    const target=models.get(id);
    if(!allowed.includes(purpose)||!target||!scoped(target)||target.enabled===false)fail('用途指定的模型不在当前配置中或已停用');
  }
  return save(s,{sources:[...sources.values()],models:nextModels,assign:pruneReferences({...ai.assign,...assign},removed)},{autoAssignTo:scoped});
}
function saveAssignments(s,assign){
  if(!object(assign)||Object.keys(assign).some(purpose=>!['chat','caption','compress','chatFallbacks','stt','tts'].includes(purpose)))fail('用途配置格式无效');
  const ai=sanitize(s.settings.ai);
  for(const purpose of ['stt','tts'])if(ai.models.find(model=>model.id===assign[purpose])?.enabled===false)fail('所选模型已停用，请启用或更换模型');
  Object.assign(ai.assign,assign);
  if(assign.chat&&!ai.assign.chatSelections.includes(assign.chat))ai.assign.chatSelections=[assign.chat,...ai.assign.chatSelections].slice(0,4);
  return save(s,ai,{autoAssignTo:()=>false});
}
function configureStation(s,keys,{unconfiguredGroups=[],expectedKeyRevisions}={}){
  if(!object(keys))fail('请填写站点分组的 API Key');
  const input=sanitize(s.settings.ai),stations=input.sources.filter(source=>source.builtin);
  const updated=[];
  for(const [id,value] of Object.entries(keys)){
    const source=stations.find(item=>item.id===id);
    if(!source)fail('未知的站点分组');
    if(typeof value!=='string')fail('密钥格式无效');
    const secret=value.trim();
    if(!secret)continue;
    source.key=secret;
    updated.push(source);
  }
  if(!updated.length){
    if(!stations.some(source=>source.keySet))fail('请至少填写一组 API Key');
    return s.settings.ai;
  }
  if(expectedKeyRevisions!==undefined)checkKeyRevisions(updated,expectedKeyRevisions);
  const presets=Object.entries(builtinModels(updated)).filter(([purpose])=>purpose!=='chat');
  for(const source of updated){
    if(source.id==='pipi')continue;
    const supported=presets.filter(([purpose])=>source.kinds.includes(purpose==='voiceUnderstanding'?'stt':purpose));
    if(supported.some(([,name])=>!name))unconfiguredGroups.push(source.id);
    for(const [purpose,name] of supported){
      if(!name)continue;
      const kind=purpose==='voiceUnderstanding'?'stt':purpose;
      let model=input.models.find(item=>item.sourceId===source.id&&item.kind===kind&&item.model===name);
      if(!model){
        model={id:randomUUID(),sourceId:source.id,model:name,kind,capabilities:[]};
        input.models.push(model);
      }
      if(model.enabled!==false)input.assign[purpose]||=model.id;
    }
  }
  return save(s,input,{autoAssignTo:()=>false});
}
function removeSource(s,sourceId,{expectedKeyRevisions}={}){
  const id=identifier(sourceId),ai=s.settings.ai;
  const source=ai.sources.find(item=>item.id===id);
  if(!source)fail('找不到服务商',404,'NOT_FOUND');
  if(expectedKeyRevisions!==undefined)checkKeyRevisions([source],expectedKeyRevisions);
  const removed=new Set(ai.models.filter(model=>model.sourceId===id).map(model=>model.id));
  if(source.builtin){
    if(source.key||source.overrideKey)source.keyRevision=randomUUID();
    source.key='';
    delete source.overrideKey;
  }else ai.sources=ai.sources.filter(item=>item.id!==id);
  ai.models=ai.models.filter(model=>model.sourceId!==id);
  ai.assign=pruneReferences(ai.assign,removed);
}
function addBuiltinChatPresets(ai){
  const source=effectiveSources(ai).find(item=>item.id==='pipi'&&item.builtin);
  if(!source?.key||source.baseUrl!==BASE_URL)return;
  const models=[...ai.models];
  const ids=Object.entries(CHAT_PRESETS).map(([name,capabilities])=>{
    const existing=models.find(model=>model.sourceId===source.id&&model.kind==='chat'&&model.model===name);
    if(existing)return existing.id;
    if(models.length>=1000)fail('模型数量已达上限');
    const id=randomUUID();
    models.push({id,sourceId:source.id,model:name,kind:'chat',enabled:true,protocol:'auto',
      capabilities:[...capabilities],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:timeoutByKind.chat,extraBody:{},voice:''});
    return id;
  });
  ai.models=models;
  const assign=ai.assign;
  assign.chatSelections=[...new Set([...assign.chatSelections,...ids])].slice(0,4);
}
function resolve(s,purpose='chat',{role,modelId}={}){
  if(purpose==='vision')purpose='caption';
  if(!purposes.includes(purpose))fail('模型用途无效');
  const ai=migrate(s),chosen=modelId||ai.assign[purpose]||(purpose==='compress'?ai.assign.chat:'');
  const model=ai.models.find(x=>x.id===chosen);
  if(!model)fail('请先配置'+({chat:'聊天',compress:'长对话整理',caption:'图片转述',stt:'输入框转文字',voiceUnderstanding:'语音条理解',tts:'语音朗读',image:'图片生成',decision:'判断',embedding:'嵌入',rerank:'重排序'}[purpose]||purpose)+'模型',422,'PROVIDER_UNCONFIGURED');
  if(model.enabled===false)fail('所选模型已停用，请启用或更换模型',422,'PROVIDER_UNCONFIGURED');
  if(purpose==='caption'&&(model.kind!=='chat'||!model.capabilities.includes('image')))fail('图片转述模型需要图片能力',422,'PROVIDER_PROTOCOL_UNSUPPORTED');
  const source=effectiveSources(ai).find(x=>x.id===model.sourceId);
  if(!source?.baseUrl||!source.key||!model.model)fail('请先配置模型服务地址、密钥与模型',422,'PROVIDER_UNCONFIGURED');
  if((model.kind==='rerank'&&purpose!=='rerank')||source.template==='minimax'&&!['chat','tts'].includes(model.kind)||source.template==='breezeblue'&&model.kind!=='tts')fail('此模型类型尚无应用调用入口，可保存配置',422,'PROVIDER_PROTOCOL_UNSUPPORTED');
  const sourceTemplate=model.kind==='tts'?ttsTemplate(model,source):source.template;
  return {...model,timeoutSeconds:model.timeoutSeconds??defaultTimeoutSeconds(model,source),baseUrl:source.baseUrl,key:source.key,sourceName:source.name,sourceTemplate,rawSourceTemplate:source.template||'',sourceKinds:source.kinds,maxContextTokens:capacity(model)};
}
function hasReadyChatModel(s,{skipMock=false}={}){
  const ai=s?.settings?.ai;
  if(!ai||!Array.isArray(ai.sources)||!Array.isArray(ai.models))return false;
  const sources=new Map(effectiveSources(ai).map(source=>[source.id,source]));
  const ids=[...new Set([ai.assign?.chat,...(ai.assign?.chatFallbacks||[])])].filter(Boolean);
  return ids.some(id=>{
    const model=ai.models.find(item=>item.id===id&&(!item.kind||item.kind==='chat')&&item.enabled!==false);
    const source=model&&sources.get(model.sourceId);
    return Boolean(source?.baseUrl&&source?.key&&(!skipMock||!/^https?:\/\/(?:isolated|mock)\./i.test(source.baseUrl)));
  });
}
function isReasoningModel(name){
  return /(?:^|\/)(?:o1|o3|o4|gpt-5)(?:[-.]|$)/i.test(String(name||''));
}
const graphemeSegmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function visionIds(ai){
  const model=ai.models.find(model=>model.id===ai.assign.caption&&model.enabled!==false&&model.kind==='chat'&&model.capabilities.includes('image'));
  return model&&effectiveSources(ai).some(source=>source.id===model.sourceId&&source.baseUrl&&source.key)?[model.id]:[];
}
function nativeProtocol(source,kind){
  const systemOneTemplates=['system-one','typesafe-system-one','vercel-system-one'];
  return source.template==='breezeblue'||source.template==='minimax'&&kind!=='chat'||source.template==='qwen'&&['tts','stt'].includes(kind)||systemOneTemplates.includes(source.template)&&kind==='decision';
}
async function resolveChat(s,purpose='chat',options={}){
  if(purpose==='chat'&&!options.modelId){
    const ai=migrate(s);
    if(!ai.assign.chat)return resolve(s,purpose,options);
    const ids=[...new Set([ai.assign.chat,...ai.assign.chatFallbacks])].filter(Boolean);
    let last;
    for(const modelId of ids){
      try{
        return await resolveChat(s,purpose,{...options,modelId});
      }
      catch(error){
        if(!['PROVIDER_UNCONFIGURED','PROVIDER_PROTOCOL_UNSUPPORTED'].includes(error.code))throw error;
        last=error;
      }
    }
    throw last;
  }
  const config=resolve(s,purpose,options);
  if(config.kind!=='chat')return config;
  const model=s.settings.ai.models.find(model=>model.id===config.id);
  const capacity=await require('./model-catalog.cjs').resolveCapacity(model,{baseUrl:config.baseUrl});
  return {...config,maxContextTokens:capacity.value,capacity};
}
async function list(s,input,allowedUrls){
  if(!object(input))fail('服务商配置格式无效');
  const ai=s.settings.ai,source=ai&&effectiveSources(ai).find(x=>x.id===(input.sourceId||input.id));
  const builtin=builtinSources(ai?.sources).find(x=>x.id===(input.sourceId||input.id));
  const url=baseUrl(builtin?builtin.baseUrl:input.baseUrl??source?.baseUrl??'');
  if(url&&allowedUrls&&!allowedUrls.has(url))fail('本地测试只允许指定模拟服务',422,'PROVIDER_LOCAL_ONLY');
  const template=input.template??source?.template??'',kind=input.kind??source?.kinds?.[0]??'chat';
  if(!kinds.includes(kind))fail('模型类型无效');
  if(template==='breezeblue'&&kind!=='tts')fail('BreezeBlue 仅支持语音合成模型',422,'PROVIDER_PROTOCOL_UNSUPPORTED');
  if(template!=='breezeblue'&&nativeProtocol({template},kind))fail('此原生接口暂不支持获取模型列表，请手动填写模型名',422,'PROVIDER_MODELS_UNAVAILABLE');
  const supplied=key(input.key??'');
  if(input.clearKey!==undefined&&typeof input.clearKey!=='boolean')fail('清除密钥选项无效');
  const secret=supplied||(!input.clearKey&&source&&baseUrl(source.baseUrl)===url?source.key:'');
  if(!url||!secret)fail('请先填写服务地址和密钥',422,'PROVIDER_UNCONFIGURED');
  let data;
  try{data=await require('../providers.cjs').request({baseUrl:url,key:secret,timeoutSeconds:45,sourceTemplate:template},'/models',{method:'GET',signal:input.signal,maxBytes:10*1024*1024});}
  catch(error){if([404,405,501].includes(error.upstreamStatus))fail('这个服务商没有提供模型列表，请手动填写模型名',422,'PROVIDER_MODELS_UNAVAILABLE');throw error;}
  const entries=template==='breezeblue'?(Array.isArray(data)?data:data?.models):(Array.isArray(data)?data:data?.data||data?.models);
  if(!Array.isArray(entries))fail('这个服务商没有提供模型列表，请手动填写模型名',422,'PROVIDER_MODELS_UNAVAILABLE');
  if(!entries.length)return [];
  const names=[...new Set(entries.slice(0,1000).map(x=>template==='breezeblue'?(x?.model_id||x?.id):x?.id).filter(x=>typeof x==='string'&&x.length>0&&x.length<=200))];
  if(!names.length)fail('这个服务商没有提供模型列表，请手动填写模型名',422,'PROVIDER_MODELS_UNAVAILABLE');
  const recommended=builtin?builtinModels([builtin])[kind]:'';
  return Promise.all(names.sort((a,b)=>Number(b===recommended)-Number(a===recommended)).map(async model=>({id:model,model,kind,...(kind!=='chat'?{capabilities:[],maxContextTokens:0}:await require('./model-catalog.cjs').metadata(model,{baseUrl:url})),recommended:model===recommended})));
}
function estimate(value){
  if(Array.isArray(value))return value.reduce((sum,x)=>sum+estimate(x),0);
  if(object(value)){
    if(value.type==='image_url')return 765;
    if(value.type==='input_audio')return 500;
    return Object.entries(value).reduce((sum,[k,x])=>sum+(['content','text','arguments','tool_calls','function'].includes(k)?estimate(x):0),0);
  }
  if(typeof value!=='string')return 0;
  let total=0;
  for(const {segment}of graphemeSegmenter.segment(value)){
    if(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment))total+=2;
    else for(const char of segment)total+=/\p{Script=Han}/u.test(char)?.6:.3;
  }
  return total;
}
function usageRecord(c,purpose,messages,response,{success=true,inputEstimate,outputEstimate,durationMs=null,error}={}){
  const usage=response?.usage||response?.usageMetadata;
  const rawInput=usage?.prompt_tokens??usage?.input_tokens??usage?.promptTokenCount;
  const rawOutput=usage?.completion_tokens??usage?.output_tokens??usage?.candidatesTokenCount;
  const hasInput=Number.isFinite(rawInput),hasOutput=Number.isFinite(rawOutput);
  return {at:Date.now(),modelId:c.id||'',model:c.model,sourceName:c.sourceName||'',purpose,durationMs,error:success?'':require('./usage.cjs').safeError(error,c.key),inputTokens:Math.ceil(hasInput?Math.max(0,rawInput):inputEstimate??estimate(messages)),outputTokens:Math.ceil(hasOutput?Math.max(0,rawOutput):outputEstimate??estimate(response?.choices?.[0]?.message||response?.text||'')),inputEstimated:!hasInput,estimated:!hasInput||!hasOutput,success};
}
async function report(onUsage,c,purpose,messages,response,options){
  const usage=usageRecord(c,purpose,messages,response,options);
  if(onUsage)await onUsage(usage);
  return usage;
}
function retryable(error){
  return error.name!=='AbortError'&&([408,409,429].includes(error.upstreamStatus)||error.upstreamStatus>=500&&error.upstreamStatus<=599||['PROVIDER_NETWORK','PROVIDER_TIMEOUT','PROVIDER_EMPTY'].includes(error.code));
}
// AstrBot request_retry.py at d49cbd93: five total attempts, exponential 1s..30s.
const REQUEST_ATTEMPTS=5,EMPTY_OUTPUT_ATTEMPTS=3;
async function call(s,{purpose='chat',role,modelId,messages,tools,signal,onUsage,onRetry,beforeRequest,prepareMessages,validateResponse,allowEmptyResponse=false,retry=true}={}){
  const ai=migrate(s),first=modelId||ai.assign[purpose]||(purpose==='compress'?ai.assign.chat:'');
  if(!first){
    const usage={chat:'对话',caption:'图片转述'}[purpose];
    fail(usage?`请先选择${usage}模型`:'请先配置模型',422,'PROVIDER_UNCONFIGURED');
  }
  const ids=[...new Set([first,...(purpose==='chat'?ai.assign.chatFallbacks:[])])].filter(Boolean);
  let last;
  for(const id of ids){
    signal?.throwIfAborted();
    let c,prepared;
    try{
      c=await resolveChat(s,purpose,{role,modelId:id});
      signal?.throwIfAborted();
      prepared=prepareMessages?await prepareMessages(c,messages):messages;
      signal?.throwIfAborted();
    }catch(error){
      signal?.throwIfAborted();
      // A configured candidate can become unavailable or too small; try the next one.
      if(!['PROVIDER_UNCONFIGURED','PROVIDER_PROTOCOL_UNSUPPORTED','CONTEXT_LIMIT'].includes(error.code))throw error;
      last=error;continue;
    }
    const body={...c.extraBody,model:c.model,messages:prepared,stream:false};
    const reasoning=isReasoningModel(c.model);
    if(c.temperature!==null&&c.temperature!==undefined&&(!reasoning||c.temperature===1))body.temperature=c.temperature;
    if(c.maxTokens!==null&&c.maxTokens!==undefined){
      if(reasoning||body.max_completion_tokens!==undefined){body.max_completion_tokens=c.maxTokens;delete body.max_tokens;}
      else body.max_tokens=c.maxTokens;
    }else if(body.max_completion_tokens!==undefined)delete body.max_tokens;
    if(tools?.length&&c.capabilities.includes('tool_use'))body.tools=tools;
    else{delete body.tools;delete body.tool_choice;delete body.parallel_tool_calls;}
    // Summary failure falls back to trimming in the caller, without delaying chat.
    const attempts=!retry||purpose==='compress'?1:REQUEST_ATTEMPTS;
    let emptyOutputs=0;
    for(let attempt=0;attempt<attempts;attempt++){
      signal?.throwIfAborted();
      beforeRequest?.();
      const started=Date.now();
      let data,error,parsed,invalidContent=false;
      try{
        data=await require('../providers.cjs').request(c,'/chat/completions',{body,signal});
        const choice=data?.choices?.[0],message=choice?.message;
        const responseMod=require('./response.cjs');
        const visible=responseMod.visibleText(message);
        const rawToolCalls=message?.tool_calls;
        if(rawToolCalls!==undefined&&rawToolCalls!==null){
          if(!Array.isArray(rawToolCalls)||rawToolCalls.length>100)fail('模型服务返回动作格式无效',502,'PROVIDER_RESPONSE');
          for(const t of rawToolCalls){
            if(!object(t)||typeof t.id!=='string'||(t.type!==undefined&&t.type!=='function')||!object(t.function)||typeof t.function.name!=='string')fail('模型服务返回动作格式无效',502,'PROVIDER_RESPONSE');
            if(t.type===undefined)t.type='function';
            if(object(t.function.arguments))t.function.arguments=JSON.stringify(t.function.arguments);
            if(typeof t.function.arguments!=='string')fail('模型服务返回动作格式无效',502,'PROVIDER_RESPONSE');
          }
        }
        const hasTools=Array.isArray(rawToolCalls)&&rawToolCalls.length>0;
        if(!object(message)||!allowEmptyResponse&&!visible.trim()&&!hasTools){
          if(choice?.finish_reason==='length'&&(message?.reasoning_content||message?.reasoning||(typeof message?.content==='string'&&/<(?:think|thought)/i.test(message.content)))){
            invalidContent=true;
            fail('模型思考耗尽了最大回复长度，请调大最大回复长度或留空',502,'PROVIDER_RESPONSE');
          }
          fail('模型服务没有返回文本内容',502,'PROVIDER_EMPTY');
        }
        // Leaked reasoning is never a reply, even where an empty tool-only turn is allowed.
        if((responseMod.leakedThought(message)||purpose==='chat'&&responseMod.leakedReasoning(message)&&!responseMod.beforeLeak(message))&&!hasTools)fail('模型把思考过程当成了回复',502,'PROVIDER_EMPTY');
        if(message.content!==null&&message.content!==undefined&&(typeof message.content!=='string'&&!Array.isArray(message.content)||visible.length>60000||JSON.stringify(message.content).length>262144))fail('模型服务返回文本格式无效',502,'PROVIDER_RESPONSE');
        if(validateResponse){
          try{parsed=await validateResponse(message,c);}
          catch(e){invalidContent=e.code==='PROVIDER_RESPONSE';throw e;}
        }
      }catch(e){error=e;}
      const usage=await report(onUsage,c,purpose,prepared,data,{success:!error,error,durationMs:Date.now()-started});
      if(!error)return {message:data.choices[0].message,usage,modelId:c.id,model:c,...(validateResponse?{parsed}:{})};
      signal?.throwIfAborted();
      if(invalidContent){last=error;break;}
      if(purpose==='caption'&&!modelId&&[400,404,422].includes(error.upstreamStatus)){last=error;break;}
      if(purpose==='chat'&&ids.length>1&&(error.upstreamStatus===402||error.code==='PROVIDER_RESPONSE')){last=error;break;}
      if(!retryable(error))throw error;
      last=error;
      if(error.code==='PROVIDER_EMPTY'&&++emptyOutputs>=EMPTY_OUTPUT_ATTEMPTS)break;
      if(attempt+1<attempts){
        onRetry?.();
        await require('node:timers/promises').setTimeout(Math.min(1000*2**attempt,30000),undefined,{signal});
      }
    }
  }
  throw last;
}
async function embed(s,input,{signal,onUsage}={}){
  const texts=Array.isArray(input)?input:[input];
  if(!texts.length)return [];
  const c=resolve(s,'embedding');
  const started=Date.now();
    let data,error;
  try{
    data=await require('../providers.cjs').request(c,'/embeddings',{body:{...c.extraBody,model:c.model,input:texts},signal});
    if(!Array.isArray(data?.data)||data.data.some(item=>!Array.isArray(item?.embedding)||item.embedding.some(v=>typeof v!=='number'||!Number.isFinite(v))))fail('嵌入模型返回向量格式无效',502,'PROVIDER_RESPONSE');
  }catch(e){error=e;}
  await report(onUsage,c,'embedding',texts,data,{success:!error,error,durationMs:Date.now()-started,outputEstimate:0});
  if(error)throw error;
  const vectors=data.data.map(item=>item.embedding);
  return Array.isArray(input)?vectors:vectors[0];
}
async function rerank(s,query,documents,{topN=12,signal,onUsage}={}){
  if(!Array.isArray(documents)||!documents.length)return [];
  const c=resolve(s,'rerank');
  const started=Date.now();
    let data,error;
  try{
    data=await require('../providers.cjs').request(c,'/rerank',{body:{...c.extraBody,model:c.model,query:String(query||''),documents,top_n:Math.min(topN,documents.length)},signal});
    if(!Array.isArray(data?.results))fail('重排序模型返回格式无效',502,'PROVIDER_RESPONSE');
  }catch(e){error=e;}
  await report(onUsage,c,'rerank',[query,...documents],data,{success:!error,error,durationMs:Date.now()-started,outputEstimate:0});
  if(error)throw error;
  return data.results.filter(r=>Number.isInteger(r?.index)&&r.index>=0&&r.index<documents.length).map(r=>({index:r.index,score:Number(r.relevance_score??r.score??0)||0}));
}
module.exports={migrate,effectiveSources,sanitize,backupKeys,restoreBackupKeys,retainKeyRevisions,save,saveCard,saveAssignments,configureStation,removeSource,addBuiltinChatPresets,resolve,resolveChat,visionIds,hasReadyChatModel,isReasoningModel,list,call,embed,rerank,lookup,capacity,estimate,usageRecord,report,defaultTimeoutSeconds,providerBaseUrl:baseUrl};
