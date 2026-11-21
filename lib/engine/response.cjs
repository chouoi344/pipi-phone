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
// Only visible response content is inspected. Request metadata stays untouched.
function visibleText(value,messageIds){
  if(leakedThought(value))return '';
  const text=withoutThoughtTags(rawText(value));
  return stripMessageNumbers(text.replace(/<\/(?:think(?:ing)?|thoughts?)\s*>/gi,''),messageIds).trim();
}
module.exports={visibleText,leakedThought,stripMessageNumbers,conversationMessageIds};
