// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const messageNumber=/(?:([\[［【])[ \t]*)?((?:消息|款项|交易|媒体|朋友圈|动态|任务|提醒|表情|照片|记忆)[ \t]*(?:编号|标识|ID)[ \t]*[:：][ \t]*)?(?<![a-z0-9_-])([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?![a-z0-9_-])(?:[ \t]*([\]］】]))?([^\S\r\n]*)/gi;
function conversationMessageIds(messages,roleId){
  const ids=new Set();
  for(const m of messages)if(m.roleId===roleId)ids.add(m.id.toLowerCase());
  return ids;
}
function internalIds(state,roleId){
  const ids=conversationMessageIds(state.messages,roleId);
  const add=id=>{if(typeof id==='string')ids.add(id.toLowerCase());};
  const role=state.roles?.find(r=>r.id===roleId);
  for(const row of state.wallet?.transactions||[])if(row.roleId===roleId)add(row.id);
  for(const row of state.engine?.data?.actions?.roleMedia||[])if(row.roleId===roleId){add(row.id);add(row.photoId);}
  for(const row of state.engine?.jobs||[])if(row.roleId===roleId)add(row.id);
  for(const row of role?.stickers||[])add(row.id);
  for(const row of state.moments||[])if(role&&require('../../public/moment-visibility.js').forRole(row,role)){add(row.id);for(const comment of row.comments||[])add(comment.id);}
  return ids;
}
let callPattern;
function isToolLine(line){
  if(!callPattern){
    const names=require('./registry.cjs').modules.flatMap(m=>m.tools.flatMap(group=>group.definitions?group.definitions(null,null,null,true):[group])).map(t=>t.function.name);
    const name='(?:'+names.join('|')+')';
    callPattern=new RegExp('(?:\\b'+name+'\\s*[({]|调用\\s*'+name+'\\b|["\\x27]name["\\x27]\\s*:\\s*["\\x27]'+name+'["\\x27])','i');
  }
  return callPattern.test(line)||/[\[【]工具执行记录[\]】]|<\/?(?:tool_call|function_call|tool_result|invoke)\b|^\s*\{\s*"tool_calls"\s*:|^\s*\{\s*"name"\s*:.*"arguments"\s*:/i.test(line);
}
function filterDialogue(value){
  const raw=withoutThoughtTags(rawText(value));let toolEcho=false;
  const dropTool=line=>{if(!isToolLine(line))return false;toolEcho=true;return true;};
  const blocks=raw.replace(/\x60\x60\x60[^\n]*\n[\s\S]*?(?:\x60\x60\x60|$)/g,code=>dropTool(code)||code.split('\n').some(dropTool)?'[工具执行记录]':code)
    .replace(/<(tool_call|function_call|tool_result|invoke)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,block=>{toolEcho=true;return '[工具执行记录]';});
  const lines=blocks.split(/\r?\n/).filter(line=>!dropTool(line)&&!(/[\[【]系统(?:事实|记录)[\]】]|[（(]注：该条仅以普通文字发出，未发送语音[）)]|^\s*(?:内容情绪|声音情绪)[:：]/.test(line)
    ||/(?:你|我|用户)发出(?:红包|转账)[:：]/.test(line)&&/当前状态|款项编号|祝福语|说明[:：]/.test(line)
    ||/^\s*(?:\[合并转发\]|（(?:图片|表情包|语音)）|(?:用户拍了拍(?:你|自己)|你拍了拍用户)(?:的.+)?)\s*$/.test(line)));
  return {text:lines.join('\n').trim(),toolEcho};
}
function dialogueText(value,ids){
  return leakedThought(value)?'':visibleText(filterDialogue(value).text,ids);
}
function stripMessageNumbers(text,messageIds){
  return text.replace(messageNumber,(match,open,label,id,close,trailing)=>{
    // The original, explicitly bracketed marker can also occur in old or imported chats.
    const legacy=open&&close&&label?.startsWith('消息编号');
    if(!legacy&&!messageIds?.has(id.toLowerCase()))return match;
    return (open&&!close?open:'')+(close&&!open?close+trailing:'');
  });
}
function rawText(value){
  const content=typeof value==='string'?value:value?.content;
  return Array.isArray(content)?content.filter(part=>part&&typeof part==='object'&&(part.type==='text'||part.type==='output_text')&&typeof part.text==='string').map(part=>part.text).join('\n'):typeof content==='string'?content:'';
}
const THOUGHT_TAG=/<(?:think(?:ing)?|thoughts?)\b[^>]*(?:>|$)|<\/(?:think(?:ing)?|thoughts?)\s*>/gi;
function withoutThoughtTags(text){
  let visible='',depth=0,cursor=0;
  for(const match of text.matchAll(THOUGHT_TAG)){
    if(match[0].startsWith('</')){
      // An orphan closing tag means the upstream omitted the opening tag; discard leaked thinking before it.
      if(depth===0)visible='';
      else depth--;
    }else{
      if(depth===0)visible+=text.slice(cursor,match.index);
      depth++;
    }
    cursor=match.index+match[0].length;
  }
  if(depth===0)visible+=text.slice(cursor);
  // A response may stop while writing the opening tag itself.
  return visible.replace(/<(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i,'').replace(/<tho(?:u(?:g(?:h(?:t(?:s)?)?)?)?)?$/i,'');
}
// Gemini sometimes returns its reasoning as plain content, starting with a bare "thought" line.
function leakedThought(value){
  const text=withoutThoughtTags(rawText(value)).replace(/^﻿/,'').trimStart();
  return /^_?thoughts?[ \t]*[:：]?[ \t]*(?:\r?\n|$)/i.test(text)||/^_thought\b/i.test(text);
}
// Markers the engine injects into the prompt (media/moment/photo ids). They must never surface in a reply.
const INTERNAL_MARKER=/[\[［【][ \t]*(?:媒体|动态|照片)[ \t]*(?:编号|ID)[ \t]*[:：][^\]］】\r\n]*[\]］】]?/gi;
function stripInternalMarkers(text){return text.replace(INTERNAL_MARKER,'');}
// Fingerprints of reasoning that collapsed into visible content without a thought tag or leading marker.
// Each is something a role never says in chat: an injected id marker, the image-retry instruction, or tool-call syntax.
const REASONING_LEAK=[
  /[\[［【][ \t]*(?:媒体|动态|照片)[ \t]*(?:编号|ID)[ \t]*[:：]/i,
  /不要说已发出失败的照片|不要再次拍摄/,
  /(?:^|[^A-Za-z0-9_])(?:send_selfie|generate_image|send_image|send_voice|send_sticker|select_message_targets)[ \t]*\(/,
  /(?:^|[^A-Za-z0-9_])action[ \t]*[:：][ \t]*["'“”']?(?:resend|continue|generate)(?![A-Za-z0-9_])/i,
  // Echoes of the injected instruction and drafting notes about one's own reply.
  /不要提到模型、接口|[（(]?工具要求[:：]|按你自己的人设|句子设计|气泡断句|去 ?AI ?味/i,
  // Parenthetical meta-auditing of persona or tool constraints leaked into dialogue.
  /[（(][^）)\r\n]{4,}(?:语音已发|不重复(?:内容|台词)|人设(?:是|不|要求)|贴合人设|违反了[“"「]|这轮必须|本轮(?:不|只|必须|无需)|只补一句|改个味儿)[^）)\r\n]*[）)]/,
  // Planning about the other person in the third person; in chat the role says 你.
  /不对[，,][ \t]*(?:她|他)(?:肯定|应该|其实)(?:想|要|会)/,
  /下一?轮(?:她|他|对方|用户)(?:肯定|应该|会)/,
  // Reasoning opens a line by naming "the user"; chat lines rarely start that way.
  /(?:^|\n)[ \t]*(?:用户(?:想要|希望|要求|让我|在问|问我|刚才)|the user (?:wants|asked|is asking|requested)\b)/i,
];
function leakedReasoning(value){
  const text=withoutThoughtTags(rawText(value));
  return REASONING_LEAK.some(re=>re.test(text));
}
// Keep the clean dialogue that came before the first reasoning fingerprint.
// The cut moves back to the last line or sentence end so no half sentence is sent.
function beforeLeak(value){
  const text=withoutThoughtTags(rawText(value));let cut=-1;
  for(const re of REASONING_LEAK){const m=re.exec(text);if(m&&(cut<0||m.index<cut))cut=m.index;}
  if(cut<0)return text;
  const head=text.slice(0,cut),end=Math.max(...['\n','。','！','？','!','?','~','～','…'].map(c=>head.lastIndexOf(c)));
  return end<0?'':head.slice(0,end+1).trim();
}
// Only visible response content is inspected. Request metadata stays untouched.
function visibleText(value,messageIds){
  if(leakedThought(value))return '';
  const text=withoutThoughtTags(rawText(value));
  return stripInternalMarkers(stripMessageNumbers(text.replace(/<\/(?:think(?:ing)?|thoughts?)\s*>/gi,''),messageIds)).trim();
}
module.exports={internalIds,filterDialogue,dialogueText,visibleText,leakedThought,leakedReasoning,beforeLeak,stripMessageNumbers,stripInternalMarkers,conversationMessageIds};
