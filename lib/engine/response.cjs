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
// Only visible response content is inspected. Request metadata stays untouched.
function visibleText(value,messageIds){
  const content=typeof value==='string'?value:value?.content;
  let text=Array.isArray(content)?content.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n'):typeof content==='string'?content:'';
  let visible='',depth=0,cursor=0;
  for(const match of text.matchAll(/<think(?:ing)?\b[^>]*(?:>|$)|<\/think(?:ing)?\s*>/gi)){
    if(depth===0)visible+=text.slice(cursor,match.index);
    if(match[0].startsWith('</'))depth=Math.max(0,depth-1);else depth++;
    cursor=match.index+match[0].length;
  }
  if(depth===0)visible+=text.slice(cursor);
  text=visible;
  // A response may stop while writing the opening tag itself.
  text=text.replace(/<(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i,'');
  return stripMessageNumbers(text.replace(/<\/think(?:ing)?\s*>/gi,''),messageIds).trim();
}
module.exports={visibleText,stripMessageNumbers,conversationMessageIds};
