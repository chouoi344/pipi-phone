// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const messageNumber=/(?:([\[［【])[ \t]*)?(消息[ \t]*(?:编号|ID)[ \t]*[:：][ \t]*)?(?<![a-z0-9_-])([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?![a-z0-9_-])(?:[ \t]*([\]］】]))?([^\S\r\n]*)/gi;
function conversationMessageIds(messages,roleId){
  const ids=new Set();
  for(const m of messages)if(m.roleId===roleId)ids.add(m.id.toLowerCase());
  return ids;
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
  return Array.isArray(content)?content.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n'):typeof content==='string'?content:'';
}
const THOUGHT_TAG=/<(?:think(?:ing)?|thoughts?)\b[^>]*(?:>|$)|<\/(?:think(?:ing)?|thoughts?)\s*>/gi;
function withoutThoughtTags(text){
  let visible='',depth=0,cursor=0;
  for(const match of text.matchAll(THOUGHT_TAG)){
    if(depth===0)visible+=text.slice(cursor,match.index);
    if(match[0].startsWith('</'))depth=Math.max(0,depth-1);else depth++;
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
  const text=rawText(value);
  return REASONING_LEAK.some(re=>re.test(text));
}
// Keep the clean dialogue that came before the first reasoning fingerprint.
// The cut moves back to the last line or sentence end so no half sentence is sent.
function beforeLeak(value){
  const text=rawText(value);let cut=-1;
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
module.exports={visibleText,leakedThought,leakedReasoning,beforeLeak,stripMessageNumbers,stripInternalMarkers,conversationMessageIds};
