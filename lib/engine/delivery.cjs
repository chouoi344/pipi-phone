// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const registry=require('./registry.cjs');
function withoutPhotoPlaceholders(text){
  return text.split(/\r?\n/).filter(line=>!/^\s*[（(\[【]\s*(?:图片|照片)\s*[）)\]】][。！？!?]?\s*$/u.test(line)).join('\n').trim();
}
function photoReplyText(text,{photoDelivered=false,waitingText=''}={}){
  if(!photoDelivered)return text.trim();
  const quotes=value=>[...value.matchAll(/“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|‘[^’]*(?:’|$)|"(?:\\.|[^"\\])*(?:"|$)|(?<![\p{L}\p{N}])'(?:\\.|[^'\\])*(?:'|$)|`[^`]*(?:`|$)/gu)].map(match=>[match.index,match.index+match[0].length]);
  const overlaps=(ranges,start,end)=>ranges.some(([from,to])=>start<to&&end>from);
  const literalLabel=/(?:这个词|这几个字|两个字|字样|字眼|标签|标记|占位符|字符串|界面|提示词|文案|括号|举例|示例|引用|原文|原句|写作|读作|代表什么|什么意思)/u;
  let prepared=text.replace(/\r\n/g,'\n'),ranges=quotes(prepared),offset=0;
  prepared=prepared.split('\n').map(line=>{
    const start=offset;offset+=line.length+1;
    return line.replace(/(^[ \t]*|[。！？!?][ \t]*)[（(\[【]\s*(?:图片|照片)\s*[）)\]】][ \t]*/gu,(match,lead,index)=>{
      const marker=start+index+lead.length,rest=line.slice(index+match.length);
      // Explicit discussion/quotation of the label remains ordinary dialogue.
      if(overlaps(ranges,marker,start+index+match.length)||literalLabel.test(rest.split(/[。！？!?]/u,1)[0]))return match;
      return lead;
    });
  }).join('\n');
  const units=[...new Set((waitingText.match(/[^。！？!?\r\n]+[。！？!?]*/gu)||[]).map(unit=>unit.trim().replace(/[。！？!?]+$/u,'')).filter(Boolean))];
  const patterns=units.map(unit=>new RegExp(unit.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:[。！？!?]+|$)','gu'));
  ranges=quotes(prepared);offset=0;
  return prepared.split('\n').map(line=>{
    const start=offset;offset+=line.length+1;const removed=[];
    for(const pattern of patterns)for(const match of line.matchAll(pattern)){
      const prefix=line.slice(0,match.index),previous=prefix.trimEnd().at(-1);
      if(previous&&!/[。！？!?，,；;]/u.test(previous))continue;
      if(overlaps(ranges,start+match.index,start+match.index+match[0].length))continue;
      if(/(?:你|我|他|她|对方)(?:刚才|刚刚|之前)?(?:说|写|提到)[，,；; \t]*$/u.test(prefix)||/(?:引用|复述|举例|原话|原句|这句话)[，,；; \t]*$/u.test(prefix))continue;
      removed.push([match.index,match.index+match[0].length]);
    }
    const merged=[];
    for(const span of removed.sort((a,b)=>a[0]-b[0])){const last=merged.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push(span);}
    for(const [from,to]of merged.reverse())line=line.slice(0,from)+line.slice(to);
    if(removed.length&&line.trim())line=line.replace(/[，,；;][ \t]*$/u,'。');
    return removed.length&&!line.trim()?null:line;
  }).filter(line=>line!==null).join('\n').trim();
}
function photoWaitingText(value,messageIds){
  const text=withoutPhotoPlaceholders(require('./response.cjs').dialogueText(value,messageIds)).slice(0,120);
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
module.exports={split,delay,readyAt,withoutPhotoPlaceholders,photoWaitingText,photoReplyText};
