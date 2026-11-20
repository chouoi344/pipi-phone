// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {fail,text}=require('../state.cjs');
const Models=require('./models.cjs'),AI=require('../providers.cjs');
const {visibleText}=require('./response.cjs');

async function testConnection(state,modelId,{signal,onUsage}={}){
  modelId=text(modelId,100);
  const draft=structuredClone(state),ai=Models.migrate(draft);
  const model=ai.models.find(model=>model.id===modelId);
  if(!model)fail('找不到要测试的模型',404,'NOT_FOUND');
  const kind=model.kind;
  if(kind==='image')fail('图片生成模型请通过实际生图验证',422,'UNSUPPORTED_TEST');
  // These assignments exist only in this request's copy. Each adapter must use
  // the selected model, including models that are not currently assigned a use.
  model.enabled=true;
  ai.assign[kind]=modelId;
  ai.assign.chatFallbacks=[];
  const records=[],options={signal,onUsage:record=>{records.push(record);}};
  let successful=false,failure;
  const started=Date.now();
  try{
    const result={kind,modelId,ok:true};
    switch(kind){
      case 'chat':{
        const response=await Models.call(draft,{...options,modelId,retry:false,messages:[{role:'user',content:'Reply with OK.'}]});
        const answer=visibleText(response.message).trim();
        if(!answer)fail('模型服务没有返回测试文本',502,'PROVIDER_RESPONSE');
        result.detail=answer.slice(0,400);
        break;
      }
      case 'stt':{
        const sample=fs.readFileSync(path.join(__dirname,'assets/model-test.wav'));
        const answer=await AI.transcribe(draft,'data:audio/wav;base64,'+sample.toString('base64'),options);
        if(!answer.trim())fail('语音服务没有返回测试转写',502,'PROVIDER_RESPONSE');
        result.detail=answer.slice(0,400);
        break;
      }
      case 'tts':{
        const speech=Models.resolve(draft,'tts',{modelId});
        let voice=speech.voice;
        if(!voice&&['breezeblue','minimax','qwen'].includes(speech.sourceTemplate)){
          const {voices}=await AI.listSpeechVoices(draft,{signal});
          voice=voices.find(item=>item.category==='default')?.voice_id||voices[0]?.voice_id;
          if(!voice)fail('这个语音模型没有可用的试听音色',422,'PROVIDER_UNCONFIGURED');
        }
        result.detail='你好，这是语音连接测试。';
        result.audio=await AI.speak(draft,result.detail,{...options,modelId,voice});
        break;
      }
      case 'decision':{
        const answer=await require('./system-one.cjs').testConnection(draft,{...options,modelId});
        result.detail=`返回完整度评分 ${answer.probability}`;
        break;
      }
      case 'embedding':{
        const vector=await Models.embed(draft,'这是一条模型连接测试。',options);
        if(!vector?.length)fail('嵌入模型没有返回非空向量',502,'PROVIDER_RESPONSE');
        result.detail=`返回 ${vector.length} 维向量`;
        break;
      }
      case 'rerank':{
        const order=await Models.rerank(draft,'水果',['苹果是一种水果。','火车是一种交通工具。'],{...options,topN:2});
        if(!order.length)fail('重排序模型没有返回有效顺序',502,'PROVIDER_RESPONSE');
        result.detail='返回顺序：'+order.map(item=>item.index+1).join('、');
        break;
      }
      default:fail('此模型类型不支持连接测试',422,'UNSUPPORTED_TEST');
    }
    successful=true;
    return result;
  }catch(error){failure=error;throw error;}finally{
    for(const record of records)if(onUsage)await onUsage({...record,success:record.success&&successful,error:record.success&&!successful?require('./usage.cjs').safeError(failure):record.error,durationMs:Date.now()-started});
  }
}

module.exports={testConnection};
