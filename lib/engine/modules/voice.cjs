// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const VOICE_TAGS=[
  '[笑]','[轻笑]','[咯咯笑]','[哭声]','[抽泣]','[呜咽]','[呻吟]','[哀号]','[叹气]',
  '[惊呼]','[吸气]','[呼气]','[喘息]','[耳语]','[喊叫]','[惨叫]','[唱歌]','[哼歌]',
  '[结巴]','[停顿]','[清嗓]','[咳嗽]','[吸鼻子]','[咂嘴]','[啧嘴]','[打哈欠]',
  '[打喷嚏]','[打嗝]','[打饱嗝]','[吞咽]','[干呕]','[闷哼]','[冷笑]','[哼鼻子]'
];

const VOICE_TAG_RE=new RegExp(VOICE_TAGS.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
const LEGACY_VOICE_PREFIX_RE=/^(?:[^\S\r\n]*【语音】)+[ \t]*/gm;
const MEDIA_MARKER_RE=/^(?:\s*(?:\[|【|\()(?:语音|照片|图片|发来语音|发来\s*\d*\s*张照片|引用消息)(?:\]|】|\)))+[ \t]*/;
const COMPARISON_TAG_LIMIT=2;
const MAX_TTS_LENGTH=1000;

const ACTION_ALIASES=Object.freeze({
  ...Object.fromEntries(VOICE_TAGS.map(t=>[t.slice(1,-1),t])),
  '笑了笑':'[笑]','笑了一下':'[笑]','笑出声':'[笑]','轻笑一声':'[轻笑]','轻轻笑':'[轻笑]','轻轻地笑':'[轻笑]',
  '咯咯地笑':'[咯咯笑]','叹了口气':'[叹气]','叹了一口气':'[叹气]','轻叹':'[叹气]','吸了吸鼻子':'[吸鼻子]',
  '打了个哈欠':'[打哈欠]','打了一个哈欠':'[打哈欠]','清了清嗓子':'[清嗓]','咳了一声':'[咳嗽]',
  '哼了一声':'[哼鼻子]','低声':'[耳语]','小声说':'[耳语]','哭':'[哭声]','哭泣':'[哭声]'
});

const ACTION_DESCRIPTIONS=new Set(['看着手机','看着屏幕','拿起手机','低头看手机','点头','摇头','眨眼','轻轻抱住你']);

function stripVoiceTags(text){
  if(typeof text!=='string')return String(text??'');
  return text.replace(LEGACY_VOICE_PREFIX_RE,'').replace(VOICE_TAG_RE,'').replace(/\n?（以上是你发的一条语音）/g,'');
}

function stripMediaMarkers(text){
  if(typeof text!=='string')return String(text??'');
  return text.replace(MEDIA_MARKER_RE,'');
}

function actionTag(content){
  const key=String(content||'').replace(/^[ \t\r\n]+|[ \t\r\n。.!！]+$/g,'');
  return ACTION_ALIASES[key]||'';
}

function replaceParentheses(text){
  const pairs={'(':')','（':'）'};
  let out='',i=0;
  while(i<text.length){
    if(!pairs[text[i]]){out+=text[i++];continue;}
    const start=i,stack=[pairs[text[i]]];i++;
    while(i<text.length&&stack.length){
      const ch=text[i];
      if(pairs[ch])stack.push(pairs[ch]);
      else if(ch===stack[stack.length-1])stack.pop();
      i++;
    }
    const raw=text.slice(start,i);
    if(stack.length){out+=raw;continue;}
    const inner=replaceParentheses(raw.slice(1,-1));
    const tag=actionTag(inner);
    if(tag){out+=tag;continue;}
    const trimmed=inner.replace(/^[ \t\r\n]+|[ \t\r\n。.!！]+$/g,'');
    if(ACTION_DESCRIPTIONS.has(trimmed))continue;
    out+=raw;
  }
  return out;
}

function stripEmojiAndSymbols(text){
  let out='';
  for(const ch of text){
    const cp=ch.codePointAt(0);
    if(
      (cp>=0x1F000&&cp<=0x1FAFF)||
      (cp>=0x2600&&cp<=0x27BF)||
      (cp>=0x2300&&cp<=0x23FF)||
      (cp>=0xFE00&&cp<=0xFE0F)||
      (cp>=0xE0020&&cp<=0xE007F)||
      cp===0x200D||cp===0x20E3||
      [0x00A9,0x00AE,0x203C,0x2049,0x2122,0x2139,0x3030,0x303D,0x3297,0x3299].includes(cp)
    )continue;
    out+=ch;
  }
  return out.replace(/\p{Cc}|\p{Cf}/gu,ch=>ch==='\n'||ch==='\t'?ch:'');
}

function prepareSpeech(text,{allowVoiceTags=true,openingTagOnly=true}={}){
  const raw=String(text??'');
  let t=raw.replace(LEGACY_VOICE_PREFIX_RE,'').replace(MEDIA_MARKER_RE,'');
  t=replaceParentheses(t);
  t=t.replace(/\*([^*\n]+)\*/g,(match,inner)=>{
    const tag=actionTag(inner);
    if(tag)return tag;
    return ACTION_DESCRIPTIONS.has(inner.trim())?'':match;
  });
  const displayText=stripVoiceTags(t).trim();
  t=t.replace(/!?\[([^\[\]]+)\]\([^\n)]*\)/g,'$1');
  t=t.replace(/```[^\n`]*\n?([\s\S]*?)```/g,'$1');
  t=t.replace(/(\*\*|__|~~)([\s\S]+?)\1/g,'$2');
  t=t.replace(/https?:\/\/[^\s<>()（）【】\[\]，。！？、；：…]+/g,'');
  t=t.replace(/(?:[oO]?\([\^╥〒ಥT；;´｀><＞＜・ω▽﹏益Дд◕♥♡°￣_\s]+\)[oO]?|[:;=8xX][-^']?[)DdpP(/\\]|[>＞][_.﹏＿-][<＜]|[TtQq][_.＿-][TtQq]|\^{2,}|[囧ಠಥ]{1,3})/g,'');
  t=t.replace(/(?<![A-Za-z0-9_])(?:QAQ|QwQ|QvQ|TwT|TAT)(?![A-Za-z0-9_])|[=＝]?[￣＾^][ω▽﹏益Дд][￣＾^][=＝]?/g,'');
  t=stripEmojiAndSymbols(t);
  t=t.replace(/^\s*(?:#{1,6}\s*|>\s*|[-+*]\s+|\d+[.)]\s+)/gm,'');
  t=t.replace(/<[^>]*>/g,'').replace(/[`*_#]/g,'').replace(/~{2,}/g,'').replace(/～/g,'~').replace(/。{3,}/g,'……');
  t=t.replace(/\s+/g,' ').trim();

  let tagCount=0;
  const ttsText=t.replace(VOICE_TAG_RE,(match,offset)=>{
    if(!allowVoiceTags)return '';
    if(openingTagOnly)return offset===0?match:'';
    tagCount++;
    return tagCount<=COMPARISON_TAG_LIMIT?match:'';
  }).replace(/\s+/g,' ').trim();
  return {
    displayText,
    ttsText:/[\p{L}\p{N}]/u.test(stripVoiceTags(ttsText))?ttsText:'',
    tooLong:displayText.length>MAX_TTS_LENGTH||ttsText.length>MAX_TTS_LENGTH
  };
}

function cleanSpeechText(text){
  return prepareSpeech(text,{allowVoiceTags:false}).ttsText||String(text??'').trim();
}

function speechModel(state){
  try{
    const model=require('../models.cjs').resolve(state,'tts');
    return model.kind==='tts'?model:null;
  }catch(error){
    if(['PROVIDER_UNCONFIGURED','PROVIDER_PROTOCOL_UNSUPPORTED'].includes(error.code))return null;
    throw error;
  }
}

function availability(state){
  const modelReady=Boolean(speechModel(state));
  return {modelReady,enabled:modelReady&&require('../registry.cjs').values(state,'voice').enabled};
}

function friendEnabled(state,role){
  const mode=role.voiceMode||'global';
  return mode!=='off'&&(mode!=='global'||state.settings.modules?.voice?.defaultMode!=='off');
}

function canSend(state,role){
  return friendEnabled(state,role)&&availability(state).enabled;
}

function usesBreezeTags(state){
  const model=speechModel(state);
  return Boolean(model&&require('../../provider-native.cjs').isBreezeProtocol(model));
}

function resolveVoice(state,role){
  return role?.voiceId?.trim()||undefined;
}

async function previewVoice(state,role,{text,signal,onUsage,dataDir}={}){
  const prepared=prepareSpeech(text,{allowVoiceTags:usesBreezeTags(state)});
  if(!prepared.displayText)require('../../state.cjs').fail('语音文字不能为空');
  if(prepared.tooLong||!prepared.ttsText)require('../../state.cjs').fail('请输入适合朗读的短句');
  const audio=await require('../../providers.cjs').speak(state,prepared.ttsText,{signal,onUsage,voice:resolveVoice(state,role),dataDir});
  signal?.throwIfAborted();
  return {audio,displayText:prepared.displayText,durationMs:require('../../provider-native.cjs').estimateAudioDurationMs(audio,prepared.displayText,{dataDir})};
}

module.exports={
  id:'voice',
  name:'发语音',
  isolated:true,
  settings:[{key:'enabled',label:'开启发语音功能',type:'boolean',default:true}],
  legacySettings:[
    {key:'defaultMode',label:'TA 平时多爱发语音',type:'select',default:'emotional',options:[
      {value:'often',label:'经常发语音'},
      {value:'emotional',label:'开心/撒娇/关心时发语音'},
      {value:'only_tool',label:'只在我要求或特别合适时发'},
      {value:'off',label:'暂时不发语音'}
    ]},
    {key:'stripBrackets',label:'朗读前自动去掉括号里的动作描写',type:'boolean',default:true,advanced:true}
  ],
  tools:[],
  jobs:[],
  data:'voice',
  page:null,
  previewVoice,
  VOICE_TAGS,
  stripVoiceTags,
  stripMediaMarkers,
  prepareSpeech,
  cleanSpeechText,
  usesBreezeTags,
  resolveVoice,
  availability,
  friendEnabled,
  canSend
};
