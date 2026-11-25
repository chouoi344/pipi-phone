// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {BASE_URL,CHAT_PRESETS}=require('./builtin-source.cjs');
// Official model specifications, checked 2026-11-15. These are hints, not a model list.
const catalog={
  'gpt-4.1':{maxContextTokens:1047576,capabilities:['text','image','tool_use']},
  'gpt-4.1-mini':{maxContextTokens:1047576,capabilities:['text','image','tool_use']},
  'gpt-4o':{maxContextTokens:128000,capabilities:['text','image','tool_use']},
  'gpt-4o-mini':{maxContextTokens:128000,capabilities:['text','image','tool_use']},
  'gemini-2.5-pro':{maxContextTokens:1048576,capabilities:['text','image','audio','tool_use']},
  'gemini-2.5-flash':{maxContextTokens:1048576,capabilities:['text','image','audio','tool_use']},
  'claude-fable-5-2':{maxContextTokens:1000000,capabilities:['text','image','tool_use']},
  'claude-opus-5-5':{maxContextTokens:1000000,capabilities:['text','image','tool_use']},
  'claude-sonnet-5-5':{maxContextTokens:1000000,capabilities:['text','image','tool_use']},
  'claude-haiku-5-5':{maxContextTokens:1000000,capabilities:['text','image','tool_use']},
  'deepseek-flash':{maxContextTokens:1000000,capabilities:['text','image','tool_use']},
  'deepseek-v4-pro':{maxContextTokens:1000000,capabilities:['text','tool_use']}
};
function lookup(name){
  return structuredClone(Object.hasOwn(catalog,name)?catalog[name]:{maxContextTokens:0,capabilities:['text','image','audio','tool_use']});
}
function capacity(model){
  return model.maxContextTokens||lookup(model.model).maxContextTokens||128000;
}
function capacityInfo(manual,context){
  if(manual>0)return {value:manual,source:'manual',recognized:false};
  return context>0?{value:context,source:'metadata',recognized:true}:{value:128000,source:'fallback',recognized:false};
}
// These aliases were checked against this relay, not inferred from their names.
const metadataUrls=['https://models.dev/api.json','https://models.opencode.ai/api.json'];
let publicCache=null,expiresAt=0,inFlight=null;
function readPublicCatalog(data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('模型能力目录格式无效');
  const models=new Map();
  for(const [providerId,provider] of Object.entries(data).sort(([a],[b])=>a.localeCompare(b))){
    for(const model of Object.values(provider?.models||{})){
      if(typeof model?.id!=='string'||!model.id)continue;
      const inputs=Array.isArray(model.modalities?.input)?model.modalities.input:[];
      const capabilities=['text',...['image','audio'].filter(kind=>inputs.includes(kind)),...(model.tool_call===true?['tool_use']:[])];
      const context=model.limit?.context;
      const owner=/^gemini/i.test(model.id)?'google':/^(?:gpt-|chatgpt-|o\d)/i.test(model.id)?'openai':/^claude/i.test(model.id)?'anthropic':/^deepseek/i.test(model.id)?'deepseek':'';
      if(!models.has(model.id)||providerId===owner)models.set(model.id,{known:true,capabilities,maxContextTokens:Number.isSafeInteger(context)&&context>0?context:0,source:'public-catalog'});
    }
  }
  if(!models.size)throw new Error('模型能力目录为空');
  return models;
}
const compact=name=>name.toLowerCase().replace(/[\s_()\[\]{}（）【】\-]+/g,'').replace(/(?<!\d)\.|\.(?!\d)/g,'');
function matchPublicModel(models,name,compactIndex){
  if(models.has(name))return {model:models.get(name),matchedModel:name};
  const query=compact(name),matches=[];
  for(const [id,model] of models){
    const normalized=compactIndex?compactIndex.get(id):compact(id),at=query.indexOf(normalized);
    if(at>=0&&!/[a-z0-9]/.test(query[at+normalized.length]||''))matches.push({id,model,length:normalized.length});
  }
  if(matches.length){
    const length=Math.max(...matches.map(match=>match.length)),best=matches.filter(match=>match.length===length);
    if(best.length===1)return {model:best[0].model,matchedModel:best[0].id};
    return {needsChoice:true,candidates:best.map(match=>match.id)};
  }
  const family=query.match(/(?:gemini|gpt|claude|deepseek)\d+(?:\.\d+)?/);
  const candidates=family?[...models.keys()].filter(id=>(compactIndex?compactIndex.get(id):compact(id)).startsWith(family[0])):[];
  return candidates.length>1?{needsChoice:true,candidates}:{};
}
async function loadPublicCatalog(fetchImpl){
  if(publicCache&&Date.now()<expiresAt)return publicCache;
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    for(const url of metadataUrls){
      try{
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(3000)});
        if(!response.ok)throw new Error('模型能力目录请求失败');
        const models=readPublicCatalog(await response.json());
        const compactIndex=new Map([...models.keys()].map(id=>[id,compact(id)]));
        publicCache={models,compactIndex};expiresAt=Date.now()+24*60*60*1000;
        return publicCache;
      }catch{
        // The second public endpoint is the recovery path; model listing stays usable.
      }
    }
    publicCache={models:new Map(),compactIndex:new Map(),warning:'暂时无法读取公开模型能力目录，未识别型号按设置默认启用全部能力，尚未验证实际支持情况'};
    expiresAt=Date.now()+60*1000;
    return publicCache;
  })();
  try{return await inFlight;}finally{inFlight=null;}
}
async function metadata(name,{baseUrl='',maxContextTokens=0,fetchImpl=globalThis.fetch}={}){
  if(Object.hasOwn(catalog,name)){
    const model=lookup(name);return {known:true,...model,source:'local-catalog',matchedModel:name,capacity:capacityInfo(maxContextTokens,model.maxContextTokens)};
  }
  const relay=baseUrl.replace(/\/+$/,'')===BASE_URL?CHAT_PRESETS:null;
  const result=await loadPublicCatalog(fetchImpl),{model,...match}=matchPublicModel(result.models,name,result.compactIndex);
  const details=relay&&Object.hasOwn(relay,name)?{known:true,capabilities:[...relay[name]],maxContextTokens:model?.maxContextTokens||0,source:'verified-relay'}:model?structuredClone(model):{known:false,capabilities:['text','image','audio','tool_use'],maxContextTokens:0,source:'unknown'};
  return {...details,...match,capacity:capacityInfo(maxContextTokens,details.maxContextTokens),...(result.warning?{warning:result.warning}:{})};
}
async function resolveCapacity(model,{baseUrl='',fetchImpl=globalThis.fetch}={}){
  if(model.maxContextTokens>0)return capacityInfo(model.maxContextTokens,0);
  return (await metadata(model.model,{baseUrl,fetchImpl})).capacity;
}
module.exports={catalog,lookup,capacity,metadata,resolveCapacity};
