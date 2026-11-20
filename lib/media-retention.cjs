// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path');
const day=86400000;
const retentionChoices=[7,30,90,'forever'];
const mediaFilename=/^[a-f0-9]{32,64}\.(?:png|jpg|jpeg|webp|gif|webm|ogg|mp3|m4a|mp4|wav|aac|flac)$/i;
const mediaAddress=/\/api\/media\/([a-f0-9]{32,64}\.(?:png|jpg|jpeg|webp|gif|webm|ogg|mp3|m4a|mp4|wav|aac|flac))(?![\w.])/gi;

function mediaReferences(...sources){
  const references=new Map(),pending=sources.filter(Boolean);
  function add(name){const key=name.toLowerCase();references.set(key,(references.get(key)||0)+1);}
  while(pending.length){
    const row=pending.pop();
    for(const value of Object.values(row)){
      if(value&&typeof value==='object'){pending.push(value);continue;}
      if(typeof value!=='string')continue;
      if(mediaFilename.test(value))add(value);
      else for(const match of value.matchAll(mediaAddress))add(match[1]);
    }
  }
  return references;
}

function attachments(message){
  const meta=message.meta||{};
  if(message.status==='pending'||meta.expired||meta.stickerId)return null;
  const image=message.type==='image'?message.content:meta.image;
  if(image)return {kind:'image',files:[image,meta.modelImage,meta.audio].filter(Boolean),hasAudio:Boolean(meta.audio)};
  if(meta.audio)return {kind:'voice',files:[meta.audio]};
  return null;
}

function* chatRows(messages){
  function* rows(message,owner,id){
    yield {message,id,createdAt:owner.createdAt,roleId:owner.roleId,pending:owner.status==='pending'};
    if(message.type==='forward'&&message.meta?.entries){
      let index=0;
      for(const entry of message.meta.entries)yield* rows(entry,owner,id+':'+index++);
    }
  }
  for(const message of messages)yield* rows(message,message,message.id);
}

function candidates(state,{days,startedAt,now,pressure=false}){
  if(!pressure&&days==='forever')return [];
  const cutoff=now-days*day;
  const list=[];
  for(const {message,id,createdAt,roleId,pending} of chatRows(state.messages)){
    if(pending||!pressure&&Math.max(createdAt,startedAt)>cutoff)continue;
    const media=attachments(message);
    if(media)list.push({id,roleId,createdAt,...media});
  }
  return list.sort((left,right)=>left.createdAt-right.createdAt);
}

function storedFilename(ref){
  if(typeof ref!=='string'||!ref.startsWith('/api/media/'))return null;
  const filename=ref.slice('/api/media/'.length);
  return mediaFilename.test(filename)?filename.toLowerCase():null;
}

function affected(items,bytesFor){
  const result={images:0,voices:0,bytes:0},seen=new Set();
  for(const item of items){
    if(item.kind==='image')result.images++;
    if(item.kind==='voice'||item.hasAudio)result.voices++;
    for(const file of item.files){
      if(seen.has(file))continue;
      seen.add(file);
      result.bytes+=bytesFor(file);
    }
  }
  return result;
}

function rolePhotoKey(roleId,image){return `${roleId}\0${image}`;}

function referencedRoleMedia(state,list,rows,chatMeta=new Set()){
  const possible=new Set(rows.flatMap(item=>[item.id,item.photoId]).filter(Boolean));
  const retained=new Set(),pending=[state];
  if(!possible.size)return retained;
  while(pending.length){
    const row=pending.pop();
    for(const [key,value] of Object.entries(row)){
      if(value===list||key==='mediaId'&&chatMeta.has(row))continue;
      if(value&&typeof value==='object')pending.push(value);
      else if(typeof value==='string'&&possible.has(value))retained.add(value);
    }
  }
  return retained;
}

function pressuredCandidates(state,extra,items,bytesFor,deficit){
  const total=mediaReferences(state,extra),eligible=new Map(),filesById=new Map();
  for(const item of items){
    const files=item.files.map(storedFilename).filter(Boolean);
    filesById.set(item.id,files);
  }
  for(const {message} of chatRows(state.messages)){
    const snapshot=message.meta?.quote,files=filesById.get(snapshot?.messageId);
    if(files)for(const ref of [snapshot.image,snapshot.audio,snapshot.modelImage]){
      const filename=storedFilename(ref);
      if(filename)files.push(filename);
    }
  }
  const roleMedia=state.engine.data.actions?.roleMedia;
  if(roleMedia?.length){
    const chats=new Map(),chatMeta=new Set();
    for(const item of items){
      if(item.kind==='image')chats.set(rolePhotoKey(item.roleId,item.files[0]),item.id);
    }
    for(const {message,id} of chatRows(state.messages))if(filesById.has(id)&&message.meta)chatMeta.add(message.meta);
    const rows=roleMedia.filter(row=>chats.has(rolePhotoKey(row.roleId,row.image)));
    const retained=referencedRoleMedia(state,roleMedia,rows,chatMeta);
    for(const row of rows){
      const filename=storedFilename(row.image);
      if(filename&&!retained.has(row.id)&&!retained.has(row.photoId))filesById.get(chats.get(rolePhotoKey(row.roleId,row.image))).push(filename);
    }
  }
  for(const files of filesById.values()){
    for(const filename of files)eligible.set(filename,(eligible.get(filename)||0)+1);
  }
  const available=new Map();
  for(const [name,count] of eligible){
    if(total.get(name)===count){
      const size=bytesFor('/api/media/'+name);
      if(size>0)available.set(name,{remaining:count,size});
    }
  }
  const selected=[];
  let reclaimed=0;
  for(const item of items){
    const files=filesById.get(item.id);
    if(!files.some(name=>available.has(name)))continue;
    selected.push(item);
    for(const filename of files){
      const file=available.get(filename);
      if(file&&--file.remaining===0)reclaimed+=file.size;
    }
    if(reclaimed>=deficit)break;
  }
  return selected;
}

function expire(state,selected,now){
  const expired=new Map(selected.map(item=>[item.id,{kind:item.kind,at:now}]));
  const roleMediaIds=new Set(),expiredPhotos=new Set(),activePhotos=new Set();
  if(!expired.size)return roleMediaIds;
  const sources=new Map(state.messages.filter(message=>expired.has(message.id)).map(message=>[message.id,message]));
  for(const {message,id,roleId} of chatRows(state.messages)){
    const marker=expired.get(id);
    if(marker){
      const meta=message.meta??={};
      if(meta.mediaId)roleMediaIds.add(meta.mediaId);
      if(marker.kind==='image')expiredPhotos.add(rolePhotoKey(roleId,message.type==='image'?message.content:meta.image));
      if(message.type==='image')message.content='';
      delete meta.image;
      delete meta.audio;
      delete meta.modelImage;
      delete meta.mediaId;
      meta.expired=marker;
    }else{
      const image=message.type==='image'?message.content:message.meta?.image;
      if(image)activePhotos.add(rolePhotoKey(roleId,image));
    }
    const quote=message.meta?.quote;
    if(quote&&expired.has(quote.messageId)&&sources.has(quote.messageId)){
      quote.expired=expired.get(quote.messageId);
      const original=sources.get(quote.messageId).meta||{};
      for(const field of ['thumb','caption','transcript','durationMs'])if(quote[field]===undefined&&original[field]!==undefined)quote[field]=original[field];
      if(quote.type==='image')quote.content='';
      delete quote.image;
      delete quote.audio;
      delete quote.modelImage;
    }
  }
  for(const row of state.engine.data.actions?.roleMedia||[]){
    const key=rolePhotoKey(row.roleId,row.image);
    if(expiredPhotos.has(key)&&!activePhotos.has(key))roleMediaIds.add(row.id);
  }
  return roleMediaIds;
}

function pruneRoleMedia(state,cutoff,expiredIds){
  const actions=state.engine.data.actions,list=actions?.roleMedia;
  if(!list?.length)return;
  const discardable=list.filter(item=>item.createdAt<=cutoff||expiredIds.has(item.id));
  if(!discardable.length)return;
  const retained=referencedRoleMedia(state,list,discardable);
  const discardIds=new Set(discardable.filter(item=>!retained.has(item.id)&&!retained.has(item.photoId)).map(item=>item.id));
  actions.roleMedia=list.filter(item=>!discardIds.has(item.id));
}

function removableFiles(dataDir,references,now){
  const dir=path.join(dataDir,'media');
  const directory=fs.lstatSync(dir,{throwIfNoEntry:false});
  if(!directory)return [];
  if(!directory.isDirectory())throw new Error('媒体目录无效');
  const files=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(!entry.isFile()||!mediaFilename.test(entry.name)||references.has(entry.name.toLowerCase()))continue;
    const filename=path.join(dir,entry.name),stat=fs.lstatSync(filename,{throwIfNoEntry:false});
    if(!stat?.isFile()||stat.mtimeMs>now-day)continue;
    files.push({name:entry.name,path:filename,size:stat.size,mtimeMs:stat.mtimeMs,ino:stat.ino,dev:stat.dev});
  }
  return files;
}

function cleanOrphans(dataDir,references,now,log=console.error){
  const removed={count:0,bytes:0};
  for(const file of removableFiles(dataDir,references,now)){
    const last=fs.lstatSync(file.path,{throwIfNoEntry:false});
    if(!last?.isFile()||last.mtimeMs!==file.mtimeMs||last.ino!==file.ino||last.dev!==file.dev)continue;
    try{fs.unlinkSync(file.path);}
    catch(error){
      if(error.code==='ENOENT')continue;
      if(error.code==='EBUSY'||error.code==='EPERM'){log('媒体文件正在使用，稍后再尝试清理',error);continue;}
      throw error;
    }
    removed.count++;
    removed.bytes+=file.size;
  }
  return removed;
}

async function mediaUsage(dataDir){
  const dir=path.join(dataDir,'media');
  const directory=await fs.promises.lstat(dir).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!directory)return 0;
  if(!directory.isDirectory())throw new Error('媒体目录无效');
  let bytes=0;
  for await(const entry of await fs.promises.opendir(dir)){
    if(!entry.isFile()||!mediaFilename.test(entry.name))continue;
    const file=await fs.promises.lstat(path.join(dir,entry.name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(file?.isFile())bytes+=file.size;
  }
  return bytes;
}

module.exports={retentionChoices,attachments,candidates,affected,pressuredCandidates,expire,pruneRoleMedia,mediaReferences,cleanOrphans,storedFilename,mediaUsage,day};
