// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const BASE_URL='https://choupi.tech/v1',RECOMMENDED_CHAT_MODEL='gemini-3.8-flash-按次';
const CHAT_PRESETS={
  [RECOMMENDED_CHAT_MODEL]:['text','image','audio','tool_use'],
  'gemini-4-hydrogen-按次':['text','image','tool_use'],
  'gemini-3.5-flash-按次':['text','image','audio','tool_use'],
  'gemini-3.1-flash-按次':['text','image','audio','tool_use']
};
const defaultModels={
  chat:RECOMMENDED_CHAT_MODEL,
  tts:'breeze-tts-2',
  image:'gpt-image-2.5-sunburst',
  stt:'mimo-v2.5-asr',
  voiceUnderstanding:'qwen3.8-omni-flash',
  decision:'jev-latest',
  embedding:'Qwen/Qwen3-VL-Embedding-8B',
  rerank:'Qwen/Qwen3-VL-Reranker-8B'
};
function builtinSources(savedSources=[],{runtime=true}={}){
  return [
    {id:'pipi',name:'屁屁自己的站',env:'PIPI_SOURCE_URL',kinds:['chat']},
    {id:'pipi-voice',name:'屁屁自己的站 · 语音',env:'PIPI_VOICE_SOURCE_URL',kinds:['tts']},
    {id:'pipi-image',name:'屁屁自己的站 · 图片',env:'PIPI_IMAGE_SOURCE_URL',kinds:['image']},
    {id:'pipi-auxiliary',name:'屁屁自己的站 · 辅助',env:'PIPI_AUXILIARY_SOURCE_URL',kinds:['stt','embedding','decision','rerank']}
  ].map(({env,...source})=>({
    ...source,
    baseUrl:(runtime&&process.env[env])||savedSources.find(saved=>saved.id===source.id)?.baseUrl||BASE_URL,
    template:'pipi',builtin:true
  }));
}
function builtinModels(sources=builtinSources()){
  const stationKinds=sources.filter(source=>source.builtin&&source.baseUrl.replace(/\/+$/,'')===BASE_URL).flatMap(source=>source.kinds);
  return Object.fromEntries(Object.entries(defaultModels).map(([purpose,model])=>{
    const kind=purpose==='voiceUnderstanding'?'stt':purpose;
    const env=purpose==='voiceUnderstanding'?'PIPI_VOICE_UNDERSTANDING_MODEL':'PIPI_'+kind.toUpperCase()+'_MODEL';
    return [purpose,process.env[env]||(stationKinds.includes(kind)?model:'')];
  }));
}
function builtinSource(){return builtinSources()[0];}
module.exports={BASE_URL,RECOMMENDED_CHAT_MODEL,CHAT_PRESETS,builtinSource,builtinSources,builtinModels};
