// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const MEDIA_URL_RE=/^\/api\/media\/([a-f0-9]{32,64}\.(png|jpg|jpeg|webp|gif))$/i;
const SAFE_FILE_RE=/^[a-f0-9]{32,64}\.(png|jpg|jpeg|webp|gif)$/i;
const SAFE_AUDIO_RE=/^[a-f0-9]{64}\.mp3$/i;
const MAX_IMAGE_BYTES=20*1024*1024;
const MIME_TO_EXT={png:'png',jpeg:'jpg',jpg:'jpg',webp:'webp',gif:'gif'};
const EXT_TO_MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
const IMAGE_FIELDS=new Set(['avatar','cover','chatBackground','bodyReferences','faceReferences','image','images','stickerImage','frames','references','outfitImage']);

function isMediaUrl(value){
  return typeof value==='string'&&MEDIA_URL_RE.test(value.trim());
}

function sniffImage(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<12||buffer.length>MAX_IMAGE_BYTES)return null;
  if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&buffer.subarray(12,16).toString('ascii')==='IHDR')return 'png';
  if(buffer[0]===255&&buffer[1]===216&&buffer[buffer.length-2]===255&&buffer[buffer.length-1]===217)return 'jpeg';
  if(buffer.length>=13&&['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii')))return 'gif';
  if(buffer.length>=16&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP')return 'webp';
  return null;
}

function decodeImageInput(input,{maxBytes=MAX_IMAGE_BYTES}={}){
  if(Buffer.isBuffer(input)){
    const mime=sniffImage(input);
    if(!mime||input.length>maxBytes)throw Object.assign(new Error('图片格式无效或超过大小限制'),{status:400,code:'VALIDATION'});
    return {buffer:input,mime,ext:MIME_TO_EXT[mime]};
  }
  if(typeof input==='string'){
    const match=input.trim().match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i);
    if(!match)throw Object.assign(new Error('图片格式无效'),{status:400,code:'VALIDATION'});
    const declared=match[1].toLowerCase(),bytes=Buffer.from(match[2],'base64');
    if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64')!==match[2])throw Object.assign(new Error('图片编码无效或过大'),{status:400,code:'VALIDATION'});
    const actual=sniffImage(bytes);
    if(!actual||actual!==declared)throw Object.assign(new Error('图片内容与格式不符'),{status:400,code:'VALIDATION'});
    return {buffer:bytes,mime:actual,ext:MIME_TO_EXT[actual]};
  }
  throw Object.assign(new Error('图片格式无效'),{status:400,code:'VALIDATION'});
}

function ensureDir(dir){
  fs.mkdirSync(dir,{recursive:true});
  const st=fs.lstatSync(dir);
  if(st.isSymbolicLink()||!st.isDirectory())throw new Error('媒体目录无效');
  return dir;
}

function imageDigest(buffer){return crypto.createHash('sha256').update(buffer).digest('hex');}
function writeImageFile(mediaDir,filename,buffer){
  const tmp=path.join(mediaDir,`.${filename}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp,buffer);
  fs.renameSync(tmp,path.join(mediaDir,filename));
}
function saveImage(dataDir,input,{maxBytes=MAX_IMAGE_BYTES}={}){
  const {buffer,mime,ext}=decodeImageInput(input,{maxBytes});
  if(!dataDir){
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  }
  const mediaDir=ensureDir(path.join(path.resolve(dataDir),'media'));
  const hash=imageDigest(buffer);
  const filename=`${hash}.${ext}`;
  const target=path.join(mediaDir,filename);
  if(!fs.existsSync(target))writeImageFile(mediaDir,filename,buffer);
  return `/api/media/${filename}`;
}

function readImageFile(dataDir,filename){
  if(!dataDir||!SAFE_FILE_RE.test(filename))return null;
  const mediaDir=path.join(path.resolve(dataDir),'media');
  if(!fs.existsSync(mediaDir))return null;
  const target=path.join(mediaDir,path.basename(filename));
  let stat;
  try{stat=fs.lstatSync(target);}catch{return null;}
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_IMAGE_BYTES)return null;
  const ext=path.extname(filename).slice(1).toLowerCase();
  const mime=EXT_TO_MIME[ext];
  if(!mime)return null;
  const buffer=fs.readFileSync(target);
  return {buffer,mime,ext,filename,size:stat.size};
}

function resolveImageBytes(dataDir,ref){
  if(typeof ref!=='string'||!ref.trim())return null;
  const match=ref.trim().match(MEDIA_URL_RE);
  if(match){
    const file=readImageFile(dataDir,match[1]);
    if(!file)return null;
    return {buffer:file.buffer,mime:file.mime,ext:file.ext,dataUrl:`data:${file.mime};base64,${file.buffer.toString('base64')}`};
  }
  if(/^data:image\//i.test(ref.trim())){
    const parsed=decodeImageInput(ref);
    return {buffer:parsed.buffer,mime:`image/${parsed.mime}`,ext:parsed.ext,dataUrl:ref.trim()};
  }
  return null;
}

function toDataUrl(dataDir,ref){
  if(typeof ref!=='string'||!ref.trim())return ref||'';
  if(/^data:image\//i.test(ref.trim()))return ref.trim();
  const resolved=resolveImageBytes(dataDir,ref);
  return resolved?resolved.dataUrl:'';
}

function backupReferences(state){
  const refs=new Set(),pending=[state];
  while(pending.length){
    const item=pending.pop();
    for(const [key,value] of Object.entries(item)){
      const isImage=IMAGE_FIELDS.has(key)||key==='content'&&item.type==='image';
      for(const entry of Array.isArray(value)?value:[value]){
        if(entry&&typeof entry==='object')pending.push(entry);
        else if(isImage&&isMediaUrl(entry))refs.add(entry.trim().match(MEDIA_URL_RE)[1]);
      }
    }
  }
  return refs;
}
function failMedia(message,status=400){throw Object.assign(new Error(message),{status,code:'BACKUP_MEDIA'});}
function checkedImage(filename,buffer,expected){
  const ext=path.extname(filename).slice(1).toLowerCase();
  const sha256=imageDigest(buffer),address=filename.slice(0,filename.indexOf('.'));
  if(EXT_TO_MIME[ext]!=='image/'+sniffImage(buffer)||expected!==undefined&&sha256!==expected||address.length===64&&address.toLowerCase()!==sha256){
    failMedia('备份图片的内容与文件名或校验值不一致');
  }
  return sha256;
}
function backupImages(dataDir,state,maxBytes){
  let bytes=2;
  const files={};
  for(const filename of backupReferences(state)){
    const image=readImageFile(dataDir,filename);
    if(!image)failMedia('找不到一张已引用的图片，完整备份未生成',409);
    const sha256=checkedImage(filename,image.buffer);
    // Count JSON keys, the digest, and the padded base64 length before allocating the entry.
    bytes+=filename.length+128+4*Math.ceil(image.buffer.length/3);
    if(bytes>maxBytes)failMedia('媒体和资料合计超过完整备份的大小限制',413);
    files[filename]={sha256,base64:image.buffer.toString('base64')};
  }
  return files;
}
function restoreImages(dataDir,state,files){
  if(!files||typeof files!=='object'||Array.isArray(files))failMedia('备份媒体索引无效');
  const expected=backupReferences(state),entries=Object.entries(files),pending=[];
  if(entries.length!==expected.size)failMedia('备份图片与资料中的引用不完整');
  for(const [filename,entry] of entries){
    if(!expected.has(filename)||!SAFE_FILE_RE.test(filename)||!entry||typeof entry!=='object'||Array.isArray(entry))failMedia('备份含未引用或无效的图片');
    const {base64,sha256}=entry;
    if(typeof base64!=='string'||base64.length>4*Math.ceil(MAX_IMAGE_BYTES/3)||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)){
      failMedia('备份图片的编码或大小无效');
    }
    const buffer=Buffer.from(base64,'base64');
    if(buffer.length>MAX_IMAGE_BYTES||buffer.toString('base64')!==base64)failMedia('备份图片的编码或大小无效');
    checkedImage(filename,buffer,sha256);
    const existing=readImageFile(dataDir,filename);
    if(existing&&!existing.buffer.equals(buffer))failMedia('目标资料目录已有内容不同的同名图片',409);
    if(!existing)pending.push({filename,buffer});
  }
  if(!pending.length)return;
  const mediaDir=ensureDir(path.join(path.resolve(dataDir),'media'));
  if(pending.some(({filename})=>fs.existsSync(path.join(mediaDir,filename))))failMedia('目标资料目录已有不可读取的同名图片',409);
  for(const {filename,buffer} of pending)writeImageFile(mediaDir,filename,buffer);
}

function audioCacheGet(dataDir,key){
  if(!dataDir||!SAFE_AUDIO_RE.test(`${key}.mp3`))return null;
  const target=path.join(path.resolve(dataDir),'audio-cache',`${key}.mp3`);
  let stat;
  try{stat=fs.lstatSync(target);}catch{return null;}
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size<10)return null;
  const buffer=fs.readFileSync(target);
  if(!buffer.length)return null;
  return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
}

function audioCachePut(dataDir,key,mp3Buffer){
  if(!dataDir||!SAFE_AUDIO_RE.test(`${key}.mp3`)||!Buffer.isBuffer(mp3Buffer)||!mp3Buffer.length)return false;
  try{
    const dir=ensureDir(path.join(path.resolve(dataDir),'audio-cache'));
    const target=path.join(dir,`${key}.mp3`);
    const tmp=path.join(dir,`.${key}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp,mp3Buffer);
    fs.renameSync(tmp,target);
    return true;
  }catch{return false;}
}

function cleanupAudioCache(dataDir,maxAgeDays=7){
  if(!dataDir)return 0;
  const dir=path.join(path.resolve(dataDir),'audio-cache');
  if(!fs.existsSync(dir))return 0;
  const cutoff=Date.now()-Math.max(1,maxAgeDays)*86400000;
  let removed=0;
  for(const name of fs.readdirSync(dir)){
    if(!SAFE_AUDIO_RE.test(name))continue;
    const p=path.join(dir,name);
    try{
      const st=fs.lstatSync(p);
      if(st.isFile()&&st.mtimeMs<cutoff){fs.unlinkSync(p);removed++;}
    }catch{}
  }
  return removed;
}

module.exports={MEDIA_URL_RE,SAFE_FILE_RE,MAX_IMAGE_BYTES,isMediaUrl,sniffImage,decodeImageInput,saveImage,readImageFile,resolveImageBytes,toDataUrl,backupImages,restoreImages,audioCacheGet,audioCachePut,cleanupAudioCache};
