// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const Media=require('./media-store.cjs'),Tar=require('./tar-stream.cjs');
const metadataLimit=512*1024*1024;
function fail(message,status=400,code='BACKUP_FORMAT'){throw Object.assign(new Error(message),{status,code});}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function digest(){return crypto.createHash('sha256');}
async function hashFile(filename,signal){const hash=digest();for await(const bytes of fs.createReadStream(filename,{signal}))hash.update(bytes);return hash.digest('hex');}
function* encode(value){
  if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield* encode(value[i]??null);}yield ']';}
  else if(object(value)){yield '{';let first=true;for(const [key,item] of Object.entries(value)){if(item===undefined)continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* encode(item);}yield '}';}
  else yield JSON.stringify(value);
}
async function* jsonBytes(value){
  let parts=[],size=0;
  for(const part of encode(value)){parts.push(part);size+=Buffer.byteLength(part);if(size>=65536){yield Buffer.from(parts.join(''));parts=[];size=0;}}
  if(parts.length)yield Buffer.from(parts.join(''));
}
function counter(limit,onBytes){let size=0;return new Transform({transform(chunk,encoding,done){size+=chunk.length;if(size>limit){done(Object.assign(new Error('备份中的资料文件过大'),{status:413,code:'BACKUP_FORMAT'}));return;}onBytes?.(size,chunk.length);done(null,chunk);}});}
async function linkOrCopy(source,target,checkSpace){
  try{await fs.promises.link(source,target);}
  catch(error){if(!['EXDEV','EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS'].includes(error.code))throw error;checkSpace((await fs.promises.stat(source)).size);await fs.promises.copyFile(source,target,fs.constants.COPYFILE_EXCL);}
}
function stagingRoot(dataDir){const root=path.join(path.resolve(dataDir),'.streaming-backup');fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.lstatSync(root).isSymbolicLink())fail('备份临时目录无效');return root;}
async function stage(dataDir,prefix){return fs.promises.mkdtemp(path.join(stagingRoot(dataDir),prefix));}
async function dispose(directory){await fs.promises.rm(directory,{recursive:true,force:true});}
function inlineMedia(dataDir,root,checkSpace){
  const pending=[root];
  while(pending.length){const row=pending.pop();for(const [key,value] of Object.entries(row)){
    if(value&&typeof value==='object')pending.push(value);
    else if(typeof value==='string'&&/^data:(image|audio)\/[^,]+;base64,/i.test(value)){
      checkSpace(Math.ceil(value.length*3/4));row[key]=/^data:image\//i.test(value)?Media.saveImage(dataDir,value):Media.saveAudio(dataDir,value);
    }
  }}
}
function mediaNames(payload){return new Set([...Media.backupReferences(payload.state),...Media.backupReferences(payload.livingMemory||{})]);}
function limitFor(name){return /\.(webm|ogg|mp3|m4a|mp4|wav|aac|flac)$/i.test(name)?Media.MAX_AUDIO_BYTES:/\.gif$/i.test(name)?Media.MAX_ANIMATED_BYTES:Media.MAX_IMAGE_BYTES;}
function validateManifest(value){
  if(!object(value)||value.format!=='pipi-phone-tar'||value.version!==1||typeof value.includeKeys!=='boolean'||typeof value.includeMedia!=='boolean'||!Array.isArray(value.media)||!object(value.state))fail('备份清单格式无效');
  const validFile=file=>object(file)&&Number.isSafeInteger(file.size)&&file.size>=0&&typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256);
  if(!validFile(value.state)||value.state.size>metadataLimit||!Number.isSafeInteger(value.state.uncompressedBytes)||value.state.uncompressedBytes<2||value.state.uncompressedBytes>metadataLimit)fail('备份资料大小或校验值无效');
  const names=new Set();
  for(const file of value.media){
    if(!validFile(file)||typeof file.name!=='string'||!Media.SAFE_MEDIA_FILE_RE.test(file.name)||file.size<1||file.size>limitFor(file.name)||names.has(file.name.toLowerCase()))fail('备份媒体清单无效');
    names.add(file.name.toLowerCase());
    if(file.name.split('.')[0].length===64&&file.name.split('.')[0].toLowerCase()!==file.sha256)fail('备份媒体文件名与校验值不符');
  }
  if(!value.includeMedia&&value.media.length)fail('文字备份不能包含媒体文件');
  return value;
}
async function writeEntry(filename,contents,{size,sha256},signal,checkSpace,scratch){
  const hash=digest();let received=0;
  const verify=new Transform({transform(chunk,encoding,done){received+=chunk.length;if(received>size){done(new Error('备份文件大小不符'));return;}try{checkSpace(chunk.length);hash.update(chunk);if(scratch)chunk.copy(scratch,received-chunk.length);done(null,chunk);}catch(error){done(error);}}});
  await pipeline(Readable.from(contents),verify,fs.createWriteStream(filename,{flags:'wx',mode:0o600}),{signal});
  if(received!==size||sha256&&hash.digest('hex')!==sha256)fail('备份文件大小或 SHA256 校验失败');
}
async function receive(readable,{dataDir,signal,checkSpace=()=>{}}){
  const directory=await stage(dataDir,'restore-'),files=new Map(),seen=new Set();let manifest,listed,scratch;
  await fs.promises.mkdir(path.join(directory,'media'));
  try{
    await Tar.unpack(readable,async(entry,contents)=>{
      if(seen.has(entry.name))fail('备份包含重复文件');seen.add(entry.name);
      if(!manifest){
        if(entry.name!=='manifest.json'||entry.size>metadataLimit)fail('备份清单必须位于文件开头');
        const filename=path.join(directory,'manifest.json');await writeEntry(filename,contents,entry,signal,checkSpace);
        try{manifest=validateManifest(JSON.parse(await fs.promises.readFile(filename,'utf8')));listed=new Map(manifest.media.map(file=>[file.name,file]));}catch(error){if(error.status)throw error;fail('备份清单不是有效 JSON');}
        return;
      }
      let expected,filename;
      if(entry.name==='state.json.gz'){expected=manifest.state;filename=path.join(directory,entry.name);}
      else if(entry.name.startsWith('media/')){
        const name=entry.name.slice(6);expected=listed.get(name);filename=path.join(directory,'media',name);
        if(!expected)fail('备份包含清单以外的媒体');files.set(name,{...expected,path:filename});
      }else fail('备份包含不支持的文件');
      if(entry.size!==expected.size)fail('备份文件大小与清单不符');
      const media=entry.name.startsWith('media/');
      if(media&&(!scratch||scratch.length<expected.size))scratch=Buffer.allocUnsafe(expected.size);
      await writeEntry(filename,contents,expected,signal,checkSpace,media?scratch:undefined);
      if(media){
        const name=entry.name.slice(6),bytes=scratch.subarray(0,expected.size);
        const parsed=Media.SAFE_FILE_RE.test(name)?Media.decodeImageInput(bytes):Media.decodeAudioInput(bytes);
        const extension=path.extname(name).slice(1).toLowerCase(),normalized=extension==='jpeg'?'jpg':extension==='mp4'?'m4a':extension;
        if(parsed.ext!==normalized)fail('备份媒体内容与文件格式不符');
      }
    });
    if(!manifest||!seen.has('state.json.gz')||files.size!==manifest.media.length)fail('备份缺少清单中的文件');
    checkSpace(manifest.state.uncompressedBytes);
    const filename=path.join(directory,'payload.json');let uncompressed=0;
    await pipeline(fs.createReadStream(path.join(directory,'state.json.gz')),zlib.createGunzip(),counter(manifest.state.uncompressedBytes,(total,bytes)=>{uncompressed=total;checkSpace(bytes);}),fs.createWriteStream(filename,{flags:'wx',mode:0o600}),{signal});
    if(uncompressed!==manifest.state.uncompressedBytes)fail('备份资料解压大小与清单不符');
    let payload;try{payload=JSON.parse(await fs.promises.readFile(filename,'utf8'));}catch{fail('备份资料不是有效 JSON');}
    if(!object(payload)||payload.format!=='pipi-phone'||payload.version!==1||!object(payload.state)||payload.media!==undefined||!manifest.includeKeys&&payload.modelKeys!==undefined)fail('备份资料格式无效');
    inlineMedia(directory,payload,checkSpace);
    for(const name of mediaNames(payload))if(!files.has(name)&&Media.describeMediaFile(directory,name))files.set(name,{name,path:path.join(directory,'media',name),size:Media.describeMediaFile(directory,name).size,sha256:await hashFile(path.join(directory,'media',name),signal)});
    return {directory,manifest,payload,files,dispose:()=>dispose(directory)};
  }catch(error){await dispose(directory);if(error.status)throw error;if(error.name==='AbortError')throw error;console.error('读取 TAR 备份失败',error);fail('备份文件无效或没有传输完整');}
}
async function merge(received,dataDir,payload,{checkSpace=()=>{}}={}){
  const selected=[...mediaNames(payload)].filter(name=>received.files.has(name)),created=[];
  checkSpace(0);
  const directory=path.join(path.resolve(dataDir),'media');await fs.promises.mkdir(directory,{recursive:true});if(fs.lstatSync(directory).isSymbolicLink())fail('媒体目录无效');
  const rollback=async()=>{for(const filename of created)await fs.promises.unlink(filename);};
  try{
    for(const name of selected){
      const file=received.files.get(name),target=path.join(directory,name),existing=fs.lstatSync(target,{throwIfNoEntry:false});
      if(existing){if(!existing.isFile()||existing.isSymbolicLink()||await hashFile(target)!==file.sha256)fail('现有同名媒体文件内容不符',409);continue;}
      await linkOrCopy(file.path,target,checkSpace);created.push(target);
    }
    return rollback;
  }catch(error){await rollback();throw error;}
}
function missingMedia(state,available,at){
  const expired=new Map();
  function mark(row,flat=false){
    const meta=flat?row:(row.meta||{}),image=flat?(row.image||(row.type==='image'&&Media.isMediaUrl(row.content)?row.content:'')):row.type==='image'?row.content:meta.image;
    const kind=image&&!available(image)?'image':meta.audio&&!available(meta.audio)?'voice':'';
    if(kind){if(!flat)row.meta??={};const target=flat?row:row.meta;if(row.type==='image')row.content='';delete target.image;delete target.audio;delete target.modelImage;target.expired={kind,at};if(row.id)expired.set(row.id,target.expired);}
    const target=flat?row:row.meta;if(target){for(const key of ['thumb','modelImage'])if(target[key]&&!available(target[key]))delete target[key];}
    if(row.type==='forward')for(const entry of meta.entries||[])mark(entry);
  }
  for(const row of state.messages)mark(row);
  for(const row of state.messages){const q=row.meta?.quote;if(!q)continue;mark(q,true);if(expired.has(q.messageId)){q.expired=expired.get(q.messageId);if(q.type==='image')q.content='';delete q.image;delete q.audio;delete q.modelImage;}}
}
function create({dataDir,version,now=Date.now,checkSpace=()=>{}}){
  const root=stagingRoot(dataDir),tokens=new Map(),preparing=new Set();let closed=false;
  for(const name of fs.readdirSync(root))if(/^(prepare|restore)-[a-zA-Z\d]+$/.test(name))fs.rmSync(path.join(root,name),{recursive:true,force:true});
  async function purge(){for(const [token,item] of tokens)if(item.expires<=now()){tokens.delete(token);await item.dispose();}}
  const timer=setInterval(()=>purge().catch(error=>console.error('清理备份临时文件失败',error)),30000);timer.unref();
  async function prepareSnapshot(payload,{session,includeKeys,includeMedia,signal}){
    await purge();const directory=await stage(dataDir,'prepare-');await fs.promises.mkdir(path.join(directory,'media'));
    try{
      inlineMedia(directory,payload,checkSpace);
      const media=[];
      if(includeMedia)for(const name of mediaNames(payload)){
        signal?.throwIfAborted();let filename=path.join(directory,'media',name);
        if(!fs.existsSync(filename)){const file=Media.describeMediaFile(dataDir,name);if(!file)fail('有媒体原文件缺失，完整备份未生成',409);checkSpace(0);await linkOrCopy(file.path,filename,checkSpace);}
        const size=(await fs.promises.stat(filename)).size;media.push({name,size,sha256:await hashFile(filename,signal)});
      }
      let uncompressedBytes=0;
      const statePath=path.join(directory,'state.json.gz');await pipeline(Readable.from(jsonBytes(payload)),counter(metadataLimit,size=>{uncompressedBytes=size;}),zlib.createGzip(),counter(Infinity,(size,bytes)=>checkSpace(bytes)),fs.createWriteStream(statePath,{flags:'wx',mode:0o600}),{signal});
      const manifest={format:'pipi-phone-tar',version:1,appVersion:version,exportedAt:new Date(now()).toISOString(),includeKeys,includeMedia,state:{size:(await fs.promises.stat(statePath)).size,sha256:await hashFile(statePath,signal),uncompressedBytes},media};
      const manifestBytes=Buffer.from(JSON.stringify(manifest)),entries=[{name:'manifest.json',size:manifestBytes.length,open:()=>Readable.from([manifestBytes])},{name:'state.json.gz',size:manifest.state.size,open:()=>fs.createReadStream(statePath)},...media.map(file=>({name:'media/'+file.name,size:file.size,open:()=>fs.createReadStream(path.join(directory,'media',file.name))}))];
      if(closed)fail('服务器正在关闭，请稍后重试',503,'SERVER_CLOSING');
      const token=crypto.randomBytes(32).toString('hex'),filename='pipi-backup-'+new Date(now()).toISOString().slice(0,10)+'.tar';
      const item={token,session,expires:now()+300000,filename,estimatedBytes:Tar.lengthOf(entries),entries,dispose:()=>dispose(directory)};tokens.set(token,item);
      return {token,estimatedBytes:item.estimatedBytes,filename};
    }catch(error){await dispose(directory);throw error;}
  }
  async function prepare(payload,options){if(closed)fail('服务器正在关闭，请稍后重试',503);const task=prepareSnapshot(payload,options);preparing.add(task);try{return await task;}finally{preparing.delete(task);}}
  function take(token,session){const item=tokens.get(token);if(!item||item.session!==session)fail('备份下载链接无效或已使用',403,'BACKUP_TOKEN');if(item.expires<=now()){tokens.delete(token);item.dispose().catch(error=>console.error('清理过期备份失败',error));fail('备份下载链接已过期，请重新准备',410,'BACKUP_TOKEN_EXPIRED');}tokens.delete(token);return item;}
  return {prepare,take,receive:options=>receive(options.readable,{...options,dataDir,checkSpace}),merge:(received,payload)=>merge(received,dataDir,payload,{checkSpace}),missingMedia,pack:Tar.pack,async close(){closed=true;clearInterval(timer);await Promise.allSettled([...preparing]);await Promise.all([...tokens.values()].map(item=>item.dispose()));tokens.clear();}};
}
module.exports={create,receive,merge,missingMedia};
