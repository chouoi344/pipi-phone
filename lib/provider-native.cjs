// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const crypto=require('node:crypto');
const {fail,audio}=require('./state.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const MediaStore=require('./media-store.cjs');
const sharedSynthesis=require('./synthesis-queue.cjs').createSynthesisQueue(2);
const request=(...args)=>require('./providers.cjs').request(...args);

function isBreezeProtocol(c){
  return c?.sourceTemplate==='breezeblue'||(c?.sourceTemplate==='pipi'&&/^breeze-tts/i.test(c?.model||''));
}

// Download through the same DNS pinning, address checks, limits and redirect refusal.
// Never forward a provider key to a generated media URL.
async function download(url,{signal,timeoutSeconds,maxBytes=8*1024*1024}={}){
  if(typeof url!=='string'||!/^https?:\/\//i.test(url))fail('模型返回媒体地址无效',502,'PROVIDER_RESPONSE');
  return request({baseUrl:url,timeoutSeconds},'',{method:'GET',binary:true,anonymous:true,signal,maxBytes});
}

function isMp3Buffer(b){
  if(!Buffer.isBuffer(b)||b.length<4)return false;
  let offset=0;
  if(b.toString('ascii',0,3)==='ID3'){
    if(b.length<10||![2,3,4].includes(b[3])||[...b.subarray(6,10)].some(v=>v&128))return false;
    offset=10+(((b[6]&127)<<21)|((b[7]&127)<<14)|((b[8]&127)<<7)|(b[9]&127));
    if(b[3]===4&&(b[5]&16))offset+=10;
  }
  if(b.length<offset+4)return false;
  const [first,second,third]=b.subarray(offset,offset+3),version=(second>>3)&3,bitrate=third>>4,rate=(third>>2)&3;
  if(first!==255||(second&224)!==224||version===1||((second>>1)&3)!==1||bitrate===0||bitrate===15||rate===3)return false;
  const rates=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const sample=[44100,48000,32000][rate]/{3:1,2:2,0:4}[version];
  const size=Math.floor((version===3?144000:72000)*rates[bitrate]/sample)+((third>>1)&1);
  return b.length>=offset+size;
}

function audioData(data,{demoModel=false}={}){
  const rawMime=String(data?.contentType||'').split(';')[0].trim().toLowerCase();
  const b=data?.buffer;
  if(!Buffer.isBuffer(b)||!b.length)fail('朗读服务未返回支持的音频',502,'PROVIDER_RESPONSE');
  // BreezeBlue occasionally returns application/octet-stream with valid MP3 bytes
  const mime=(rawMime==='application/octet-stream'&&isMp3Buffer(b))?'audio/mpeg':rawMime;
  if(!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4'].includes(mime))fail('朗读服务未返回支持的音频',502,'PROVIDER_RESPONSE');
  const valid=demoModel?b[0]!==123&&b[0]!==91:['audio/mpeg','audio/mp3'].includes(mime)?isMp3Buffer(b):['audio/wav','audio/x-wav'].includes(mime)?b.length>=44&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE':mime==='audio/ogg'?b.length>=27&&b.toString('ascii',0,4)==='OggS':mime==='audio/webm'?b.length>=4&&b.readUInt32BE(0)===0x1a45dfa3:b.length>=12&&b.toString('ascii',4,8)==='ftyp';
  if(!valid)fail('朗读服务返回的音频内容与格式不符',502,'PROVIDER_RESPONSE');
  return audio(`data:${mime};base64,${b.toString('base64')}`);
}

function estimateAudioDurationMs(audioDataUrl,text=''){
  const fallback=Math.max(1000,Math.min(600000,[...String(text||'')].length*250));
  const m=typeof audioDataUrl==='string'&&audioDataUrl.match(/^data:audio\/([^;]+);base64,(.+)$/);
  if(!m)return fallback;
  try{
    const bytes=Buffer.from(m[2],'base64');
    if(['mpeg','mp3'].includes(m[1].toLowerCase())){
      // Strip ID3 header size roughly; 128kbps ~ 16 bytes/ms
      let offset=0;
      if(bytes.length>=10&&bytes.toString('ascii',0,3)==='ID3'){
        offset=10+(((bytes[6]&0x7f)<<21)|((bytes[7]&0x7f)<<14)|((bytes[8]&0x7f)<<7)|(bytes[9]&0x7f));
      }
      const audioBytes=Math.max(0,bytes.length-offset);
      const est=Math.round(audioBytes/16);
      if(est>=1000&&est<=600000)return est;
    }
  }catch{}
  return fallback;
}

function retryWaitMs(err,attempt){
  const headerVal=err?.resHeaders?.['retry-after'];
  const sec=Number(headerVal);
  if(Number.isFinite(sec)&&sec>=0)return Math.min(15000,Math.max(200,sec*1000));
  return Math.min(15000,1000*Math.pow(2,attempt));
}

async function recoverBreezeHistory(c,historyId,{signal}){
  const path='/history/'+encodeURIComponent(historyId)+'/audio';
  for(let attempt=0;attempt<=3;attempt++){
    try{
      return await request(c,path,{method:'GET',binary:true,maxBytes:16*1024*1024,signal});
    }catch(err){
      if(err?.name==='AbortError'||signal?.aborted)throw err;
      if([425,429,503].includes(err?.upstreamStatus)&&attempt<3){
        await delay(retryWaitMs(err,attempt),undefined,{signal});
        continue;
      }
      throw err;
    }
  }
}

async function speakBreeze(c,content,{signal,demoModel=false,dataDir,account}={}){
  const key=crypto.createHash('sha256').update(JSON.stringify({baseUrl:c.baseUrl,key:c.key,voice:c.voice,model:c.model,timeoutSeconds:c.timeoutSeconds,extra:c.extraBody,content,dataDir,demoModel})).digest('hex');
  return sharedSynthesis(key,()=>synthesizeBreeze(c,content,{demoModel,dataDir,account}),{signal});
}

async function synthesizeBreeze(c,content,{signal,demoModel=false,dataDir,account}={}){
  if(content.length>2000)fail('BreezeBlue 单次朗读最多2000字，普通账户上限1000字');
  const extra=c.extraBody||{};
  const body={
    model_id:c.model||'breeze-tts-2',
    language_code:'zh',
    ...extra,
    text:content,
    voice_settings:{
      speed:1.0,
      guidance_scale:2.0,
      volume:1.0,
      use_speaker_boost:false,
      ...(extra.voice_settings||{})
    }
  };
  let cacheKey='';
  if(dataDir){
    const keyHash=crypto.createHash('sha256').update(String(c.key||'')).digest('hex');
    cacheKey=crypto.createHash('sha256').update(JSON.stringify({baseUrl:c.baseUrl,keyHash,voice:c.voice,body})).digest('hex');
    const cached=MediaStore.audioCacheGet(dataDir,cacheKey);
    if(cached&&isMp3Buffer(Buffer.from(cached.split(',')[1],'base64')))return audio(cached);
  }
  const path='/text-to-speech/'+encodeURIComponent(c.voice)+'?output_format=mp3&delivery=sync';
  const generate=async()=>{
  for(let attempt=0;attempt<=2;attempt++){
    try{
      const res=await request(c,path,{body,signal,binary:true,maxBytes:16*1024*1024});
      const encoded=audioData(res,{demoModel});
      if(dataDir&&cacheKey&&isMp3Buffer(res.buffer)){
        MediaStore.audioCachePut(dataDir,cacheKey,res.buffer);
        MediaStore.cleanupAudioCache(dataDir);
      }
      return encoded;
    }catch(err){
      if(err?.name==='AbortError'||signal?.aborted)throw err;
      const historyId=String(err?.resHeaders?.['history-item-id']||'').trim();
      if([503,504].includes(err?.upstreamStatus)&&historyId){
        const recovered=await recoverBreezeHistory(c,historyId,{signal});
        const encoded=audioData(recovered,{demoModel});
        if(dataDir&&cacheKey&&isMp3Buffer(recovered.buffer)){
          MediaStore.audioCachePut(dataDir,cacheKey,recovered.buffer);
        }
        return encoded;
      }
      const bodyStr=String(err?.rawBody||'');
      const capacityBusy=err?.upstreamStatus===429||(err?.upstreamStatus===503&&/(?:GENERATION_CAPACITY_EXCEEDED|GENERATION_CONCURRENCY_EXCEEDED)/.test(bodyStr));
      if(capacityBusy&&attempt<2){
        await delay(retryWaitMs(err,attempt),undefined,{signal});
        continue;
      }
      throw err;
    }
  }
  };
  return account?account(generate):generate();
}

async function speak(c,content,{signal,demoModel=false,dataDir,account}={}){
  if(!c.voice)fail('请先配置音色 ID',422,'PROVIDER_UNCONFIGURED');
  const extra=c.extraBody||{};
  if(c.sourceTemplate==='minimax'){
    if(content.length>=10000)fail('MiniMax 单次朗读须少于10000字');
    const data=await request(c,'/t2a_v2',{body:{...extra,model:c.model,text:content,stream:false,output_format:'hex',voice_setting:{...extra.voice_setting,voice_id:c.voice},audio_setting:{...extra.audio_setting,format:'mp3'}},signal});
    if(data?.base_resp?.status_code!==0)fail('MiniMax 语音服务返回失败，请检查配置与额度',502,'PROVIDER_ERROR');
    if(typeof data?.data?.audio!=='string'||! /^(?:[\da-f]{2})+$/i.test(data.data.audio))fail('MiniMax 没有返回有效音频',502,'PROVIDER_RESPONSE');
    return audioData({buffer:Buffer.from(data.data.audio,'hex'),contentType:'audio/mpeg'},{demoModel});
  }
  if(isBreezeProtocol(c))return speakBreeze(c,content,{signal,demoModel,dataDir,account});
  if(content.length>600)fail('Qwen 单次朗读最多600字');
  const data=await request(c,'/services/aigc/multimodal-generation/generation',{body:{...extra,model:c.model,input:{...extra.input,text:content,voice:c.voice}},signal});
  if(data.code||data.status_code&&data.status_code!==200)fail('Qwen 语音服务返回失败，请检查配置与额度',502,'PROVIDER_ERROR');
  const result=data?.output?.audio;
  if(typeof result?.data==='string'&&result.data){
    const bytes=Buffer.from(result.data,'base64');
    if(bytes.toString('base64')!==result.data)fail('Qwen 音频 Base64 无效',502,'PROVIDER_RESPONSE');
    return audioData({buffer:bytes,contentType:'audio/wav'},{demoModel});
  }
  return audioData(await download(result?.url,{signal,timeoutSeconds:c.timeoutSeconds}),{demoModel});
}

async function listVoices(c,{voiceType='all',search='',signal}={}){
  if(!c?.baseUrl||!c?.key)fail('请先配置语音服务地址与密钥',422,'PROVIDER_UNCONFIGURED');
  const seenTokens=new Set();
  const byId=new Map();
  let page=1,nextToken='';
  for(let guard=0;guard<10;guard++){
    const params=new URLSearchParams({voice_type:voiceType,page:String(page),page_size:'100'});
    if(search.trim())params.set('search',search.trim());
    if(nextToken)params.set('next_page_token',nextToken);
    const data=await request(c,'/voices?'+params.toString(),{method:'GET',headers:{'xi-api-key':c.key},maxBytes:2*1024*1024,signal});
    const list=Array.isArray(data?.voices)?data.voices:[];
    for(const v of list){
      const id=String(v?.voice_id||v?.id||'').trim();
      if(!id)continue;
      byId.set(id,{
        voice_id:id,
        name:String(v?.name||id).slice(0,120),
        category:String(v?.category||voiceType||'').slice(0,40),
        description:String(v?.description||'').slice(0,240),
        preview_url:typeof v?.preview_url==='string'?v.preview_url:''
      });
    }
    const token=typeof data?.next_page_token==='string'?data.next_page_token.trim():'';
    if(!data?.has_more||!list.length||(token&&seenTokens.has(token)))break;
    if(token){seenTokens.add(token);nextToken=token;}
    page++;
  }
  return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN'));
}

async function transcribe(c,src,{signal}={}){
  audio(src);
  const data=await request(c,'/chat/completions',{body:{...c.extraBody,model:c.model,messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:src}}]}],stream:false},signal});
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim()||text.length>60000)fail('Qwen 没有返回转写文本',502,'PROVIDER_RESPONSE');
  return text;
}

module.exports={isBreezeProtocol,speak,listVoices,transcribe,download,audioData,estimateAudioDurationMs};
