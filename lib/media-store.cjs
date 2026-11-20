// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const MEDIA_URL_RE=/^\/api\/media\/([a-f0-9]{32,64}\.(png|jpg|jpeg|webp|gif))$/i;
const SAFE_FILE_RE=/^[a-f0-9]{32,64}\.(png|jpg|jpeg|webp|gif)$/i;
const SAFE_AUDIO_RE=/^[a-f0-9]{64}\.mp3$/i;
const AUDIO_MEDIA_URL_RE=/^\/api\/media\/([a-f0-9]{64}\.(webm|ogg|mp3|m4a|mp4|wav|aac|flac))$/i;
const SAFE_MEDIA_FILE_RE=/^(?:[a-f0-9]{32,64}\.(?:png|jpg|jpeg|webp|gif)|[a-f0-9]{64}\.(?:webm|ogg|mp3|m4a|mp4|wav|aac|flac))$/i;
const MAX_IMAGE_BYTES=20*1024*1024;
const MAX_ANIMATED_BYTES=10*1024*1024,MAX_AUDIO_BYTES=8*1024*1024;
const MIME_TO_EXT={png:'png',jpeg:'jpg',jpg:'jpg',webp:'webp',gif:'gif'};
const EXT_TO_MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
const AUDIO_MIMES={webm:'audio/webm',ogg:'audio/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',aac:'audio/aac',flac:'audio/flac'};
const IMAGE_FIELDS=new Set(['avatar','cover','chatBackground','bodyReferences','faceReferences','image','images','thumb','modelImage','stickerImage','frames','references','referenceModelImages','outfitImage']);

function isMediaUrl(value){
  return typeof value==='string'&&MEDIA_URL_RE.test(value.trim());
}
function isAudioMediaUrl(value){return typeof value==='string'&&AUDIO_MEDIA_URL_RE.test(value.trim());}
function invalid(message,status=400){throw Object.assign(new Error(message),{status,code:'VALIDATION'});}
function imageLimit(buffer,mime){
  if(mime==='gif')return MAX_ANIMATED_BYTES;
  if(mime==='png'||mime==='webp')for(let at=mime==='png'?8:12;at+8<=buffer.length;){
    const size=mime==='png'?buffer.readUInt32BE(at):buffer.readUInt32LE(at+4),name=buffer.toString('ascii',at+(mime==='png'?4:0),at+(mime==='png'?8:4));
    if(mime==='png'&&name==='acTL'||mime==='webp'&&['ANIM','ANMF'].includes(name))return MAX_ANIMATED_BYTES;
    at+=size+(mime==='png'?12:8+(size%2));
  }
  return MAX_IMAGE_BYTES;
}
function sniffAudio(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<4||buffer.length>MAX_AUDIO_BYTES)return null;
  const ascii=(start,end)=>buffer.toString('ascii',start,end);
  if(buffer.length>=44&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE'){
    let format=false,data=false;
    for(let at=12;at+8<=buffer.length;){
      const size=buffer.readUInt32LE(at+4),end=at+8+size;
      if(end>buffer.length)return null;
      if(ascii(at,at+4)==='fmt '&&size>=16)format=buffer.readUInt16LE(at+10)>0&&buffer.readUInt32LE(at+12)>0;
      if(ascii(at,at+4)==='data'&&size>0)data=true;
      at=end+(size%2);
    }
    return format&&data?'wav':null;
  }
  if(buffer.length>=27&&ascii(0,4)==='OggS'&&buffer[4]===0){
    const start=27+buffer[26];
    if(start<=buffer.length&&(buffer.subarray(start,start+8).toString()==='OpusHead'||buffer.subarray(start,start+7).equals(Buffer.from('\x01vorbis'))||buffer.subarray(start,start+5).equals(Buffer.from('\x7fFLAC'))))return 'ogg';
    return null;
  }
  if(buffer.readUInt32BE(0)===0x1a45dfa3&&buffer.includes(Buffer.from('webm'))&&['A_OPUS','A_VORBIS','A_FLAC','A_PCM'].some(codec=>buffer.includes(Buffer.from(codec))))return 'webm';
  if(buffer.length>=20&&ascii(4,8)==='ftyp'&&buffer.includes(Buffer.from('soun'))&&buffer.includes(Buffer.from('mdat')))return 'm4a';
  if(buffer.length>=42&&ascii(0,4)==='fLaC'&&(buffer[4]&127)===0&&buffer.readUIntBE(5,3)===34&&(buffer.readUIntBE(18,3)>>>4)>0)return 'flac';
  let offset=0;
  if(ascii(0,3)==='ID3'){
    if(buffer.length<10||![2,3,4].includes(buffer[3])||[...buffer.subarray(6,10)].some(value=>value&128))return null;
    offset=10+(((buffer[6]&127)<<21)|((buffer[7]&127)<<14)|((buffer[8]&127)<<7)|(buffer[9]&127));
    if(buffer[3]===4&&(buffer[5]&16))offset+=10;
  }
  if(offset+4<=buffer.length){
    const [a,b,c]=buffer.subarray(offset,offset+3),version=(b>>3)&3,bitrate=c>>4,rate=(c>>2)&3;
    if(a===255&&(b&224)===224&&version!==1&&((b>>1)&3)===1&&bitrate>0&&bitrate<15&&rate!==3){
      const rates=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
      const sample=[44100,48000,32000][rate]/{3:1,2:2,0:4}[version];
      if(buffer.length>=offset+Math.floor((version===3?144000:72000)*rates[bitrate]/sample)+((c>>1)&1))return 'mp3';
    }
  }
  if(buffer.length>=7&&buffer[0]===255&&(buffer[1]&246)===240&&((buffer[2]>>2)&15)<13){
    const length=((buffer[3]&3)<<11)|(buffer[4]<<3)|(buffer[5]>>5);
    if(length>=7&&length<=buffer.length)return 'aac';
  }
  return null;
}
function decodeAudioInput(input){
  let buffer=input;
  if(typeof input==='string'){
    const match=input.trim().match(/^data:audio\/(webm|ogg|mpeg|mp3|m4a|mp4|wav|x-wav|aac|flac)(?:;codecs=[a-z\d.,-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/i);
    if(!match)invalid('音频格式无效');
    buffer=Buffer.from(match[2],'base64');
    if(buffer.toString('base64')!==match[2])invalid('音频编码无效');
  }
  if(!Buffer.isBuffer(buffer)||!buffer.length)invalid('音频内容为空');
  if(buffer.length>MAX_AUDIO_BYTES)invalid('音频不能超过 8MB',413);
  const ext=sniffAudio(buffer);
  if(!ext)invalid('音频内容与格式不符');
  return {buffer,mime:AUDIO_MIMES[ext],ext};
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
    if(input.length>maxBytes)invalid('图片不能超过 20MB',413);
    if(!mime)invalid('图片格式无效');
    if(input.length>imageLimit(input,mime))invalid('动图不能超过 10MB',413);
    return {buffer:input,mime,ext:MIME_TO_EXT[mime]};
  }
  if(typeof input==='string'){
    const match=input.trim().match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i);
    if(!match)throw Object.assign(new Error('图片格式无效'),{status:400,code:'VALIDATION'});
    const declared=match[1].toLowerCase(),bytes=Buffer.from(match[2],'base64');
    if(bytes.length>maxBytes)invalid('图片不能超过 20MB',413);
    if(!bytes.length||bytes.toString('base64')!==match[2])invalid('图片编码无效');
    const actual=sniffImage(bytes);
    if(!actual||actual!==declared)throw Object.assign(new Error('图片内容与格式不符'),{status:400,code:'VALIDATION'});
    if(bytes.length>imageLimit(bytes,actual))invalid('动图不能超过 10MB',413);
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

const spaceChecks=new Map();
function installSpaceCheck(dataDir,check){
  const key=path.resolve(dataDir);
  spaceChecks.set(key,check);
  return ()=>{if(spaceChecks.get(key)===check)spaceChecks.delete(key);};
}
function checkSpace(dataDir,bytes){spaceChecks.get(path.resolve(dataDir))?.(bytes);}
function imageDigest(buffer){return crypto.createHash('sha256').update(buffer).digest('hex');}
function writeImageFile(mediaDir,filename,buffer){
  checkSpace(path.dirname(mediaDir),buffer.length);
  const tmp=path.join(mediaDir,`.${filename}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try{
    fs.writeFileSync(tmp,buffer,{flag:'wx'});
    fs.renameSync(tmp,path.join(mediaDir,filename));
  }catch(error){
    if(error.code!=='EEXIST')fs.rmSync(tmp,{force:true});
    throw error;
  }
}
function saveImage(dataDir,input,{maxBytes=MAX_IMAGE_BYTES}={}){
  const {buffer,mime,ext}=decodeImageInput(input,{maxBytes});
  return saveFile(dataDir,{buffer,mime:'image/'+mime,ext});
}
function saveAudio(dataDir,input){return saveFile(dataDir,decodeAudioInput(input));}
function saveFile(dataDir,{buffer,mime,ext}){
  if(!dataDir){
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
  const mediaDir=ensureDir(path.join(path.resolve(dataDir),'media'));
  const hash=imageDigest(buffer);
  const filename=`${hash}.${ext}`;
  const target=path.join(mediaDir,filename);
  if(!fs.existsSync(target))writeImageFile(mediaDir,filename,buffer);
  else{if(!describeMediaFile(dataDir,filename))invalid('已有媒体文件无法读取',409);const now=new Date();fs.utimesSync(target,now,now);}
  return `/api/media/${filename}`;
}
function describeMediaFile(dataDir,filename){
  if(!dataDir||!SAFE_MEDIA_FILE_RE.test(filename))return null;
  const mediaDir=path.join(path.resolve(dataDir),'media');
  if(!fs.existsSync(mediaDir))return null;
  const directory=fs.lstatSync(mediaDir);if(directory.isSymbolicLink()||!directory.isDirectory())return null;
  const target=path.join(mediaDir,path.basename(filename));
  let stat;
  try{stat=fs.lstatSync(target);}catch{return null;}
  if(stat.isSymbolicLink()||!stat.isFile()||!stat.size)return null;
  const ext=path.extname(filename).slice(1).toLowerCase();
  const mime=EXT_TO_MIME[ext]||AUDIO_MIMES[ext],max=AUDIO_MIMES[ext]?MAX_AUDIO_BYTES:ext==='gif'?MAX_ANIMATED_BYTES:MAX_IMAGE_BYTES;
  if(!mime||stat.size>max)return null;
  return {path:target,mime,ext,filename,size:stat.size,mtimeMs:stat.mtimeMs,etag:'"'+filename+'"'};
}
function readMediaFile(dataDir,filename){const file=describeMediaFile(dataDir,filename);return file?{...file,buffer:fs.readFileSync(file.path)}:null;}
function readImageFile(dataDir,filename){return SAFE_FILE_RE.test(filename)?readMediaFile(dataDir,filename):null;}
function readAudioFile(dataDir,filename){return AUDIO_MEDIA_URL_RE.test('/api/media/'+filename)?readMediaFile(dataDir,filename):null;}
function resolveAudioBytes(dataDir,ref){
  if(typeof ref!=='string'||!ref.trim())return null;
  if(isAudioMediaUrl(ref)){
    const file=readAudioFile(dataDir,ref.trim().slice('/api/media/'.length));
    return file?{buffer:file.buffer,mime:file.mime,ext:file.ext,dataUrl:`data:${file.mime};base64,${file.buffer.toString('base64')}`}:null;
  }
  return /^data:audio\//i.test(ref.trim())?{...decodeAudioInput(ref),dataUrl:ref.trim()}:null;
}
function toAudioDataUrl(dataDir,ref){return resolveAudioBytes(dataDir,ref)?.dataUrl||'';}

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
function visitMedia(root,visit){
  const pending=[{item:root,path:''}];
  while(pending.length){
    const {item,path}=pending.pop();
    for(const [key,value] of Object.entries(item)){
      const location=path+'/'+(Array.isArray(item)&&value?.id?'#'+value.id:key);
      const kind=key==='audio'?'audio':IMAGE_FIELDS.has(key)||key==='content'&&item.type==='image'?'image':'';
      if(kind){
        if(Array.isArray(value)){for(let i=0;i<value.length;i++)if(typeof value[i]==='string')visit(value,i,kind,key,location+'/'+i);}
        else if(typeof value==='string')visit(item,key,kind,key,location);
      }
      if(value&&typeof value==='object')pending.push({item:value,path:location});
    }
  }
}
function mediaSnapshot(root){
  const previous=new Map();
  visitMedia(root,(item,key,kind,field,location)=>previous.set(location,item[key]));
  return previous;
}
function externalize(dataDir,root,{previous,image}={}){
  const inherited=previous&&new Set(previous.values());
  visitMedia(root,(item,key,kind,field,location)=>{
    let value=item[key];
    if(!value||previous?.get(location)===value)return;
    if(kind==='image'&&/^data:image\//i.test(value)){
      if(image)value=image(value,field);
      item[key]=saveImage(dataDir,value);
    }else if(kind==='audio'&&/^data:audio\//i.test(value))item[key]=saveAudio(dataDir,value);
    else if(value.startsWith('/api/media/')){
      if(!(kind==='image'?isMediaUrl(value):isAudioMediaUrl(value)))invalid('媒体类型与填写位置不符');
      if(!describeMediaFile(dataDir,value.trim().slice('/api/media/'.length))&&!inherited?.has(value.trim()))invalid('媒体文件不存在或超过大小限制',404);
      item[key]=value.trim();
    }
  });
  return root;
}
async function receiveUpload(dataDir,req){
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(type!=='application/octet-stream'&&!['image/png','image/jpeg','image/webp','image/gif',...Object.values(AUDIO_MIMES),'audio/mp3','audio/x-wav','audio/m4a'].includes(type))invalid('不支持的媒体格式',415);
  let max=type.startsWith('audio/')?MAX_AUDIO_BYTES:type==='image/gif'?MAX_ANIMATED_BYTES:MAX_IMAGE_BYTES;
  const tooLarge=()=>invalid(max===MAX_AUDIO_BYTES?'音频不能超过 8MB':max===MAX_ANIMATED_BYTES?'动图不能超过 10MB':'图片不能超过 20MB',413);
  async function discard(){
    if(req.readableEnded)return;
    await new Promise((resolve,reject)=>{req.once('end',resolve);req.once('error',reject);req.resume();});
  }
  async function guardWrite(bytes){
    try{checkSpace(dataDir,bytes);}
    catch(error){await discard();throw error;}
  }
  const incomingSize=Number(req.headers['content-length']||0);
  if(incomingSize>max){await discard();tooLarge();}
  await guardWrite(incomingSize);
  const mediaDir=ensureDir(path.join(path.resolve(dataDir),'media')),tmp=path.join(mediaDir,'.upload-'+crypto.randomBytes(12).toString('hex')+'.tmp');
  const file=await fs.promises.open(tmp,'wx',0o600),hash=crypto.createHash('sha256');
  let size=0,prefix=Buffer.alloc(0);
  try{
    try{
      for await(const chunk of req.iterator({destroyOnReturn:false})){
        size+=chunk.length;
        if(prefix.length<65536)prefix=Buffer.concat([prefix,chunk.subarray(0,65536-prefix.length)]);
        if(prefix.length>=12){
          const head=prefix.toString('ascii',0,4);
          if(head==='GIF8')max=MAX_ANIMATED_BYTES;
          else if(head==='OggS'||head==='fLaC'||head==='RIFF'&&prefix.toString('ascii',8,12)==='WAVE'||prefix.readUInt32BE(0)===0x1a45dfa3||head.slice(0,3)==='ID3'||prefix[0]===255&&(prefix[1]&224)===224||prefix.toString('ascii',4,8)==='ftyp')max=MAX_AUDIO_BYTES;
          else{const image=sniffImage(prefix);if(image&&imageLimit(prefix,image)===MAX_ANIMATED_BYTES)max=MAX_ANIMATED_BYTES;}
        }
        if(size>max){await discard();tooLarge();}
        await guardWrite(chunk.length);
        hash.update(chunk);await file.writeFile(chunk);
      }
    }finally{await file.close();}
    const bytes=await fs.promises.readFile(tmp),imageType=sniffImage(bytes);
    const {ext}=imageType?decodeImageInput(bytes):decodeAudioInput(bytes);
    const filename=hash.digest('hex')+'.'+ext,target=path.join(mediaDir,filename);
    if(fs.existsSync(target)){
      if(!describeMediaFile(dataDir,filename))invalid('已有媒体文件无法读取',409);
      const now=new Date();await fs.promises.utimes(target,now,now);
    }else await fs.promises.rename(tmp,target);
    return '/api/media/'+filename;
  }finally{await fs.promises.rm(tmp,{force:true});}
}

function backupReferences(state){
  const refs=new Set();
  visitMedia(state,(item,key,kind)=>{const value=item[key];if((kind==='image'?isMediaUrl(value):isAudioMediaUrl(value)))refs.add(value.trim().slice('/api/media/'.length));});
  return refs;
}
function failMedia(message,status=400){throw Object.assign(new Error(message),{status,code:'BACKUP_MEDIA'});}
function checkedImage(filename,buffer,expected){
  const ext=path.extname(filename).slice(1).toLowerCase();
  const sha256=imageDigest(buffer),address=filename.slice(0,filename.indexOf('.'));
  const actual=EXT_TO_MIME[ext]?'image/'+sniffImage(buffer):AUDIO_MIMES[sniffAudio(buffer)];
  if((EXT_TO_MIME[ext]||AUDIO_MIMES[ext])!==actual||EXT_TO_MIME[ext]&&buffer.length>imageLimit(buffer,sniffImage(buffer))||expected!==undefined&&sha256!==expected||address.length===64&&address.toLowerCase()!==sha256){
    failMedia('备份图片的内容与文件名或校验值不一致');
  }
  return sha256;
}
function backupImages(dataDir,state,maxBytes){
  let bytes=2;
  const files={};
  for(const filename of backupReferences(state)){
    const image=readMediaFile(dataDir,filename);
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
  const expected=backupReferences(state),pending=[];
  // Files that no restored record references (such as transient sticker frames in older exports) are skipped, never written.
  if([...expected].some(filename=>!Object.hasOwn(files,filename)))failMedia('备份图片与资料中的引用不完整');
  for(const filename of expected){
    const entry=files[filename];
    if(!SAFE_MEDIA_FILE_RE.test(filename)||!entry||typeof entry!=='object'||Array.isArray(entry))failMedia('备份含未引用或无效的图片');
    const {base64,sha256}=entry;
    if(typeof base64!=='string'||base64.length>4*Math.ceil(MAX_IMAGE_BYTES/3)||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)){
      failMedia('备份图片的编码或大小无效');
    }
    const buffer=Buffer.from(base64,'base64');
    if(buffer.length>MAX_IMAGE_BYTES||buffer.toString('base64')!==base64)failMedia('备份图片的编码或大小无效');
    checkedImage(filename,buffer,sha256);
    const existing=readMediaFile(dataDir,filename);
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

module.exports={MEDIA_URL_RE,SAFE_FILE_RE,AUDIO_MEDIA_URL_RE,SAFE_MEDIA_FILE_RE,MAX_IMAGE_BYTES,MAX_AUDIO_BYTES,MAX_ANIMATED_BYTES,isMediaUrl,isAudioMediaUrl,sniffImage,sniffAudio,decodeImageInput,decodeAudioInput,saveImage,saveAudio,describeMediaFile,readMediaFile,readImageFile,readAudioFile,resolveImageBytes,resolveAudioBytes,toDataUrl,toAudioDataUrl,mediaSnapshot,externalize,receiveUpload,backupImages,restoreImages,audioCacheGet,audioCachePut,cleanupAudioCache,installSpaceCheck,checkSpace};
