// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const Media=require('../media-store.cjs');

function source(message){
  return {image:message?.image||(message?.type==='image'?message.content:message?.meta?.image)||'',modelImage:message?.meta?.modelImage||message?.modelImage||''};
}
function dataUrl(dataDir,image,modelImage){
  return modelImage&&Media.toDataUrl(dataDir,modelImage)||Media.toDataUrl(dataDir,image)||(Media.isMediaUrl(image)?'':image||'');
}
function bytes(dataDir,image,modelImage){
  return modelImage&&Media.resolveImageBytes(dataDir,modelImage)||Media.resolveImageBytes(dataDir,image);
}
function metadata(state,roleId,image){
  const match=state.messages.findLast(message=>message.roleId===roleId&&source(message).image===image&&(message.meta?.modelImage||message.meta?.thumb||message.meta?.caption));
  return Object.fromEntries(['modelImage','thumb','caption'].filter(key=>match?.meta?.[key]!==undefined).map(key=>[key,match.meta[key]]));
}

module.exports={source,dataUrl,bytes,metadata};
