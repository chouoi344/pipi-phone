// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const Media=require('../media-store.cjs');
const Preparer=require('./model-image-preparer.cjs');

function expired(message,kind){return (message?.meta?.expired||message?.expired)?.kind===kind;}
function imageText(message){const caption=message?.meta?.caption||message?.caption;return '[图片已过期]'+(caption?' '+caption:'');}
function source(message){
  if(expired(message,'image'))return {image:'',modelImage:''};
  return {image:message?.image||(message?.type==='image'?message.content:message?.meta?.image)||'',modelImage:message?.meta?.modelImage||message?.modelImage||''};
}
function dataUrl(dataDir,image,modelImage){
  if(Media.isMediaUrl(image)&&!Media.describeMediaFile(dataDir,image.slice('/api/media/'.length)))return '';
  const prepared=Preparer.cached(dataDir,image);
  return prepared&&Media.toDataUrl(dataDir,prepared.url)||modelImage&&Media.toDataUrl(dataDir,modelImage)||Media.toDataUrl(dataDir,image)||(Media.isMediaUrl(image)?'':image||'');
}
function bytes(dataDir,image,modelImage){
  if(Media.isMediaUrl(image)&&!Media.describeMediaFile(dataDir,image.slice('/api/media/'.length)))return null;
  const prepared=Preparer.cached(dataDir,image);
  return prepared&&Media.resolveImageBytes(dataDir,prepared.url)||modelImage&&Media.resolveImageBytes(dataDir,modelImage)||Media.resolveImageBytes(dataDir,image);
}
function metadata(state,roleId,image){
  const match=state.messages.findLast(message=>message.roleId===roleId&&source(message).image===image&&(message.meta?.modelImage||message.meta?.thumb||message.meta?.caption));
  return Object.fromEntries(['modelImage','thumb','caption'].filter(key=>match?.meta?.[key]!==undefined).map(key=>[key,match.meta[key]]));
}
function assertRequest(state,request){
  if(request?.imageExpired||request?.sourceMessageId&&expired(state.messages.find(message=>message.id===request.sourceMessageId),'image'))require('../state.cjs').fail('图片已过期，请重新发送或引用一张可用的图片',422,'MEDIA_EXPIRED');
}

module.exports={expired,imageText,source,dataUrl,bytes,metadata,assertRequest,...Preparer};
