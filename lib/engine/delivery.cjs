// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const registry=require('./registry.cjs');
function withoutPhotoPlaceholders(text){
  return text.split(/\r?\n/).filter(line=>!/^\s*[（(\[【]\s*(?:图片|照片)\s*[）)\]】][。！？!?]?\s*$/u.test(line)).join('\n').trim();
}
function photoWaitingText(value,messageIds){
  const text=withoutPhotoPlaceholders(require('./response.cjs').visibleText(value,messageIds)).slice(0,120);
  const sent=/发(?:过来|过去|给你)(?:了|啦|喽)|已经(?:发|传)|拍好(?:了|啦)|图(?:到|来)了/u;
  return text&&!sent.test(text)?text:'等我一下，这就拍给你。';
}
function split(text,settings={}){
  const p={...Object.fromEntries(registry.get('segments').settings.map(x=>[x.key,x.default])),...settings};
  const {stripVoiceTags}=require('./modules/voice.cjs');
  const original=[stripVoiceTags(text).trim()].filter(Boolean);
  if(!p.enabled||[...text].length>p.noSplitAbove)return original;
  let chunks;
  if(p.splitMode==='words'){
    const words=p.splitWords.split(/\r?\n/).map(word=>word.trim()).filter(Boolean).sort((a,b)=>b.length-a.length);
    const separators=words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    chunks=words.length?text.match(new RegExp(`.*?(?:${separators})|.+$`,'gsu'))?.map(chunk=>{
      const suffix=words.find(word=>chunk.endsWith(word));
      return (suffix?chunk.slice(0,-suffix.length):chunk).trim();
    }).filter(Boolean):null;
  }else{
    chunks=text.match(new RegExp(p.sentencePattern,'gmsu'));
  }
  if(!chunks?.length)return original;
  // Plain Chinese punctuation lists remove each character; regex syntax keeps its existing meaning.
  const pattern=p.cleanupPattern;
  const cleanup=pattern&&new RegExp(/^[，。！？、；：…—～“”‘’「」『』（）【】《》〈〉〔〕［］｛｝·]+$/u.test(pattern)?`[${pattern}]`:pattern,'gu');
  return chunks.map(chunk=>stripVoiceTags(cleanup?chunk.replace(cleanup,''):chunk).trim()).filter(Boolean);
}
function delay(text,settings={},random=Math.random){
  const p={...Object.fromEntries(registry.get('segments').settings.map(x=>[x.key,x.default])),...settings};
  if(p.intervalMode==='random')return Math.round(1000*(p.minSeconds+random()*(p.maxSeconds-p.minSeconds)));
  // AstrBot counts words for ASCII and only letters and numbers otherwise.
  const count=/^[\x00-\x7f]*$/.test(text)?text.trim().split(/\s+/).filter(Boolean).length:(text.match(/[\p{L}\p{N}]/gu)||[]).length;
  const seconds=Math.log(count+1)/Math.log(p.logBase)+random()*0.5;
  return Math.round(seconds*1000);
}
function readyAt({firstMessageAt,lastMessageAt,lastTypingAt,hasActiveDraft=false,incomplete=false},settings){
  if(settings.enabled===false)return lastMessageAt;
  const idle=settings.idleSeconds??2.5;
  const cap=(firstMessageAt??lastMessageAt)+(settings.maxWaitSeconds??8)*1000;
  const hold=hasActiveDraft?Math.max(idle,settings.draftHoldSeconds??idle):idle;
  const quietUntil=Math.max(lastMessageAt,lastTypingAt??lastMessageAt)+hold*1000;
  const incompleteUntil=lastMessageAt+(incomplete?(settings.incompleteWaitSeconds??3)*1000:0);
  return Math.min(cap,Math.max(quietUntil,incompleteUntil));
}
module.exports={split,delay,readyAt,withoutPhotoPlaceholders,photoWaitingText};
