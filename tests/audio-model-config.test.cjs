// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const M=require('../lib/engine/models.cjs'),P=require('../lib/providers.cjs'),One=require('../lib/engine/system-one.cjs');
const {builtinSources,builtinModels}=require('../lib/engine/builtin-source.cjs');
process.env.ALLOW_PRIVATE_PROVIDERS='1';
function state(baseUrl='https://model.example/v1'){
  return {roles:[],settings:{ai:{sources:[{id:'custom',name:'自定义',baseUrl,key:'ISOLATED',template:'compatible',builtin:false}],models:[{id:'asr',sourceId:'custom',model:'mimo-v2.5-asr',kind:'stt',capabilities:[],extraBody:{}},{id:'omni',sourceId:'custom',model:'qwen3.8-omni-flash',kind:'stt',capabilities:[],extraBody:{}}],assign:{stt:'asr',chatFallbacks:[]}}}};
}
test('audio assignments migrate only missing values and preserve independent selections on save',()=>{
  const s=state();M.migrate(s);assert.equal(s.settings.ai.assign.voiceUnderstanding,'asr');
  let input=M.sanitize(s.settings.ai);input.assign.voiceUnderstanding='omni';input.models[0].protocol='mimo-asr';M.save(s,input);
  assert.equal(M.resolve(s,'stt').model,'mimo-v2.5-asr');assert.equal(M.resolve(s,'voiceUnderstanding').model,'qwen3.8-omni-flash');
  assert.equal(M.resolve(s,'stt').protocol,'mimo-asr');assert.equal(M.resolve(s,'stt').key,'ISOLATED');
  input=M.sanitize(s.settings.ai);input.assign.voiceUnderstanding='';M.save(s,input);M.migrate(s);
  assert.throws(()=>M.resolve(s,'voiceUnderstanding'),/语音条理解/);assert.equal(M.resolve(s,'stt').id,'asr');
  input=M.sanitize(s.settings.ai);input.models[0].protocol='breezeblue';assert.throws(()=>M.save(s,input),/调用方式/);assert.equal(s.settings.ai.models[0].protocol,'mimo-asr');
});
test('relay API groups and optional voice understanding model are separate from speech synthesis',()=>{
  const sources=builtinSources();assert.deepEqual(sources.find(x=>x.id==='pipi-voice').kinds,['tts']);assert.ok(sources.find(x=>x.id==='pipi-auxiliary').kinds.includes('stt'));
  const old=process.env.PIPI_VOICE_UNDERSTANDING_MODEL;
  try{process.env.PIPI_VOICE_UNDERSTANDING_MODEL='qwen3.8-omni-flash';assert.equal(builtinModels().voiceUnderstanding,'qwen3.8-omni-flash');}
  finally{if(old===undefined)delete process.env.PIPI_VOICE_UNDERSTANDING_MODEL;else process.env.PIPI_VOICE_UNDERSTANDING_MODEL=old;}
});
test('saved compatible Breeze and Jev configurations use their native endpoints, with explicit chat override',async t=>{
  const seen=[],mp3=require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/demo-assets/tone.mp3'));
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push({url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(chunks))});
    if(req.url.includes('text-to-speech')){res.setHeader('content-type','audio/mpeg');res.end(mp3);}
    else{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.endsWith('systemone')?{answers:{complete:{noul:.9}}}:{choices:[{message:{content:'{"probability":0.9}'}}]}));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const s=state('http://127.0.0.1:'+server.address().port+'/v1');
  s.settings.ai.models.push({id:'tts',sourceId:'custom',kind:'tts',model:'breeze-tts-2',voice:'test-voice',extraBody:{},protocol:'auto'},{id:'decision',sourceId:'custom',kind:'decision',model:'jev-latest',extraBody:{},protocol:'auto'});
  Object.assign(s.settings.ai.assign,{tts:'tts',decision:'decision'});
  await P.speak(s,'测试');await One.testConnection(s);
  assert.equal(seen[0].url,'/v1/text-to-speech/test-voice?output_format=mp3&delivery=sync');assert.equal(seen[0].headers['xi-api-key'],'ISOLATED');assert.equal(seen[1].url,'/v1/systemone');
  s.settings.ai.models.find(m=>m.id==='decision').protocol='chat';await One.testConnection(s);assert.equal(seen[2].url,'/v1/chat/completions');
  s.settings.ai.models.find(m=>m.id==='tts').protocol='openai-speech';assert.equal(M.resolve(s,'tts').sourceTemplate,'compatible');
});
