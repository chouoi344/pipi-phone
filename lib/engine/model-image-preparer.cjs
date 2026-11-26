// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Independent Node implementation. Original media stays untouched; only model
// work copies are resized and encoded on libvips worker threads.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const Media=require('../media-store.cjs');
const MAX_EDGE=1280,MAX_BYTES=512*1024,MAX_PIXELS=100000000,VERSION='node-v1-1280-512k-grid9';
const MONTAGE_NOTICE='这是同一动图的均匀采样帧，请按从左到右、从上到下的时间顺序阅读；空白格不属于图片内容。';
const pending=new Map();
const key=ref=>crypto.createHash('sha256').update(ref).digest('hex');
function manifestPath(dataDir,ref){return path.join(path.resolve(dataDir),'model-images',VERSION+'-'+key(ref)+'.json');}
function cached(dataDir,ref){
  if(!dataDir||!ref)return null;
  if(Media.isMediaUrl(ref)&&!Media.describeMediaFile(dataDir,ref.slice('/api/media/'.length)))return null;
  const file=manifestPath(dataDir,ref);if(!fs.existsSync(file))return null;
  const record=JSON.parse(fs.readFileSync(file,'utf8'));
  if(record.version!==VERSION||record.sourceKey!==key(ref)||!Media.isMediaUrl(record.url)||!Media.describeMediaFile(dataDir,record.url.slice('/api/media/'.length)))return null;
  return record;
}
function sourceBytes(dataDir,ref){
  if(Media.isMediaUrl(ref)){const file=Media.readImageFile(dataDir,ref.slice('/api/media/'.length));if(!file)throw Object.assign(new Error('图片原文件不可用，请重新发送图片'),{status:409,code:'MEDIA_UNAVAILABLE'});return file.buffer;}
  return Media.decodeImageInput(ref).buffer;
}
function available(dataDir,ref){return Media.isMediaUrl(ref)?Boolean(Media.describeMediaFile(dataDir,ref.slice('/api/media/'.length))):Boolean(ref);}
async function encode(image,{alpha=false}={}){
  let prepared=image;
  for(;;){
    const {data,info}=await (alpha?prepared.clone().png():prepared.clone().flatten({background:'#ffffff'}).jpeg({quality:85,mozjpeg:true})).toBuffer({resolveWithObject:true});
    if(data.length<MAX_BYTES)return {buffer:data,width:info.width,height:info.height};
    if(info.width===1&&info.height===1)throw Error('Model image cannot fit its byte budget');
    const scale=Math.min(0.85,Math.sqrt((MAX_BYTES-1)/data.length)*0.95);
    prepared=sharp(data).resize(Math.max(1,Math.floor(info.width*scale)),Math.max(1,Math.floor(info.height*scale)),{fit:'inside',withoutEnlargement:true});
  }
}
async function convert(buffer){
  const options={failOn:'error',limitInputPixels:MAX_PIXELS,animated:false},image=sharp(buffer,options),metadata=await image.metadata(),pages=metadata.pages||1;
  if(pages===1)return {...await encode(image.autoOrient().resize(MAX_EDGE,MAX_EDGE,{fit:'inside',withoutEnlargement:true}),{alpha:metadata.hasAlpha}),montage:false};
  const rotated=metadata.orientation>=5&&metadata.orientation<=8,sourceWidth=rotated?(metadata.pageHeight||metadata.height):metadata.width,sourceHeight=rotated?metadata.width:(metadata.pageHeight||metadata.height);
  const scale=Math.min(1,MAX_EDGE/(Math.max(sourceWidth,sourceHeight)*3)),width=Math.max(1,Math.floor(sourceWidth*scale)),height=Math.max(1,Math.floor(sourceHeight*scale)),count=Math.min(9,pages),parts=[];
  for(let i=0;i<count;i++){
    const page=count===1?0:Math.round(i*(pages-1)/(count-1));
    const frame=await sharp(buffer,{...options,page,pages:1}).autoOrient().resize(width,height,{fit:'fill',withoutEnlargement:true}).png().toBuffer();
    parts.push({input:frame,left:(i%3)*width,top:Math.floor(i/3)*height});
  }
  return {...await encode(sharp({create:{width:width*3,height:height*3,channels:3,background:'#ffffff'}}).composite(parts)),montage:true};
}
async function prepare(dataDir,ref,{signal}={}){
  signal?.throwIfAborted();if(!ref)return null;
  const found=cached(dataDir,ref);if(found)return found;
  const identity=(dataDir||'inline')+':'+key(ref);
  if(pending.has(identity)){const result=await pending.get(identity);signal?.throwIfAborted();return result;}
  const operation=(async()=>{
    let buffer,converted;
    try{buffer=sourceBytes(dataDir,ref);converted=await convert(buffer);}catch(error){if(error.code==='MEDIA_UNAVAILABLE')throw error;throw Object.assign(new Error('图片无法解码或像素过大，请换一张可正常打开的图片'),{status:422,code:'MODEL_IMAGE_INVALID',cause:error});}
    const url=Media.saveImage(dataDir,converted.buffer),record={version:VERSION,sourceKey:key(ref),url,sourceBytes:buffer.length,bytes:converted.buffer.length,width:converted.width,height:converted.height,montage:converted.montage};
    if(dataDir){const file=manifestPath(dataDir,ref),dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true});if(fs.lstatSync(dir).isSymbolicLink())throw Error('Invalid model image cache directory');const temporary=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record),{flag:'wx'});fs.renameSync(temporary,file);}
    return record;
  })();pending.set(identity,operation);
  try{const result=await operation;signal?.throwIfAborted();return result;}finally{pending.delete(identity);}
}
async function prepareReferences(dataDir,references,{signal,skipMissing=false}={}){const copies=new Map();for(const ref of new Set(references.filter(Boolean))){signal?.throwIfAborted();if(skipMissing&&!available(dataDir,ref))continue;copies.set(ref,await prepare(dataDir,ref,{signal}));}return copies;}
async function prepareMessageParts(messages,{signal}={}){
  const seen=new Map();
  for(const message of messages)for(const part of Array.isArray(message.content)?[...message.content]:[]){
    if(part.type!=='image_url'||!/^data:image\//i.test(part.image_url?.url||''))continue;
    const source=part.image_url.url;signal?.throwIfAborted();
    if(!seen.has(source)){
      const buffer=Media.decodeImageInput(source).buffer;let direct=false;
      if(buffer.length<MAX_BYTES){
        try{const image=sharp(buffer,{failOn:'error',limitInputPixels:MAX_PIXELS}),info=await image.metadata();direct=(info.pages||1)===1&&Math.max(info.width,info.height)<=MAX_EDGE&&(!info.orientation||info.orientation===1);if(direct)await image.raw().toBuffer();}
        catch(error){throw Object.assign(new Error('图片无法解码，请重新上传可正常打开的图片'),{status:422,code:'MODEL_IMAGE_INVALID',cause:error});}
      }
      seen.set(source,direct?{url:source,montage:false}:await prepare(undefined,source,{signal}));
    }
    const prepared=seen.get(source);part.image_url.url=prepared.url;
    if(prepared.montage)message.content.splice(message.content.indexOf(part),0,{type:'text',text:MONTAGE_NOTICE});
  }
  signal?.throwIfAborted();return messages;
}
module.exports={prepare,prepareReferences,prepareMessageParts,cached,available,MAX_EDGE,MAX_BYTES,VERSION,MONTAGE_NOTICE};
