// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const mib=1024*1024;

function diskSpace(dir,statfs=fs.statfsSync){
  const {blocks,bavail,bsize}=statfs(dir,{bigint:true});
  const size=Number(blocks)*Number(bsize),available=Number(bavail)*Number(bsize);
  return {size,available,reserve:Math.max(500*mib,Math.min(2048*mib,Math.ceil(size*.05)))};
}

function legacyMedia(state){
  const entries=[],pending=[state];
  let size=0;
  while(pending.length){
    const row=pending.pop();
    for(const [key,value] of Object.entries(row)){
      if(value&&typeof value==='object'){pending.push(value);continue;}
      if(typeof value!=='string')continue;
      const kind=/^data:(image|audio)\/[^,]+;base64,/i.exec(value);
      if(!kind)continue;
      const encoded=value.length-kind[0].length;
      size+=Math.floor(encoded*3/4)-(value.endsWith('==')?2:value.endsWith('=')?1:0);
      entries.push({row,key,kind:kind[1].toLowerCase()});
    }
  }
  return {entries,size};
}

function writeBackup(destination,write){
  const temp=destination+'.'+crypto.randomUUID()+'.tmp';
  let renamed=false;
  const handle=fs.openSync(temp,'wx',0o600);
  try{
    try{
      write(handle);
      fs.fsyncSync(handle);
    }finally{fs.closeSync(handle);}
    fs.renameSync(temp,destination);
    renamed=true;
  }finally{if(!renamed)fs.unlinkSync(temp);}
}

function fileChunks(filename,buffer,consume){
  const fd=fs.openSync(filename,'r');
  try{
    let read;
    while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)consume(buffer.subarray(0,read));
  }finally{fs.closeSync(fd);}
}

function prepareLargeLegacyBackup(dataDir,payload,appVersion){
  const Media=require('./media-store.cjs'),Tar=require('./tar-stream.cjs');
  const buffer=Buffer.alloc(256*1024),zeros=Buffer.alloc(1024);
  const {state,livingMemory,exportedAt}=payload;
  const media=[...new Set([...Media.backupReferences(state),...Media.backupReferences(livingMemory||{})])].map(name=>{
    const file=Media.describeMediaFile(dataDir,name);
    if(!file)throw new Error('旧资料引用的媒体文件缺失');
    const hash=crypto.createHash('sha256');
    fileChunks(file.path,buffer,chunk=>hash.update(chunk));
    const sha256=hash.digest('hex'),stem=name.split('.')[0];
    if(stem.length===64&&stem.toLowerCase()!==sha256)throw new Error('旧资料中的媒体文件校验失败');
    return {name,size:file.size,sha256,path:file.path};
  });
  const text=JSON.stringify(payload),gzip=zlib.gzipSync(text);
  const manifest=Buffer.from(JSON.stringify({
    format:'pipi-phone-tar',version:1,appVersion,exportedAt,includeKeys:true,includeMedia:true,
    state:{size:gzip.length,sha256:crypto.createHash('sha256').update(gzip).digest('hex'),uncompressedBytes:Buffer.byteLength(text)},
    media:media.map(({name,size,sha256})=>({name,size,sha256}))
  }));
  const entries=[{name:'manifest.json',size:manifest.length,bytes:manifest},{name:'state.json.gz',size:gzip.length,bytes:gzip},
    ...media.map(file=>({...file,name:'media/'+file.name}))];
  return {bytes:Tar.lengthOf(entries),write(handle){
    for(const entry of entries){
      fs.writeFileSync(handle,Tar.header(entry));
      if(entry.bytes)fs.writeFileSync(handle,entry.bytes);
      else{
        let size=0;
        const hash=crypto.createHash('sha256');
        fileChunks(entry.path,buffer,chunk=>{hash.update(chunk);size+=chunk.length;fs.writeFileSync(handle,chunk);});
        if(size!==entry.size||hash.digest('hex')!==entry.sha256)throw new Error('备份时媒体文件发生变化');
      }
      const padding=(512-entry.size%512)%512;
      if(padding)fs.writeFileSync(handle,zeros.subarray(0,padding));
    }
    fs.writeFileSync(handle,zeros);
  }};
}

function migrateLegacy({dataDir,state,previous,readSpace=diskSpace,makeBackup,makeLargeBackup,saveProgress,complete,saveImage,saveAudio,now=Date.now,log=console.log}){
  const old=legacyMedia(state),begun=now();
  const result={version:1,status:'complete',startedAt:begun,completedAt:begun,migratedCount:old.entries.length};
  if(!old.entries.length){
    if(previous?.status==='complete')return previous;
    complete(state,result,false);
    return result;
  }
  let space;
  try{space=readSpace(dataDir);}
  catch(error){
    const skipped={...previous,version:1,status:'skipped',startedAt:begun,detail:'读取服务器硬盘剩余空间失败，已保留旧资料。'};
    saveProgress(skipped);
    log('读取服务器硬盘剩余空间失败',error);
    return skipped;
  }
  if(space.available<old.size*2+space.reserve){
    const skipped={...previous,version:1,status:'skipped',startedAt:begun,detail:'服务器硬盘剩余空间不足，已保留旧资料，下次启动会再检查。'};
    saveProgress(skipped);
    return skipped;
  }
  const original=JSON.stringify(state),fingerprint=crypto.createHash('sha256').update(original).digest('hex');
  let backupName=previous?.fingerprint===fingerprint?previous.backupName:'before-0.13.0-'+new Date(begun).toISOString().replace(/[:.]/g,'-')+'-'+fingerprint.slice(0,12)+'.json';
  if(!/^before-0\.13\.0-[\dTZ-]+-[a-z0-9]{12}\.(json|tar)$/.test(backupName))throw new Error('旧媒体备份文件名无效');
  const directory=path.join(dataDir,'backups');
  const attempt={version:1,status:'running',startedAt:begun,backupName,fingerprint};
  saveProgress(attempt);
  log('开始整理旧图片和语音，共 '+old.entries.length+' 项。');
  try{
    fs.mkdirSync(directory,{mode:0o700,recursive:true});
    if(!fs.lstatSync(directory).isDirectory())throw new Error('迁移备份目录无效');
    const saved=fs.lstatSync(path.join(directory,backupName),{throwIfNoEntry:false});
    if(saved&&!saved.isFile())throw new Error('迁移备份路径不是文件');
    if(!saved){
      let archive;
      try{
        if(backupName.endsWith('.tar'))archive=makeLargeBackup(state);
        else{
          const json=JSON.stringify(makeBackup(state));
          archive={bytes:Buffer.byteLength(json),write:handle=>fs.writeFileSync(handle,json)};
        }
      }catch(error){
        if(error.status!==413||!makeLargeBackup||backupName.endsWith('.tar'))throw error;
        backupName=backupName.replace(/\.json$/,'.tar');
        attempt.backupName=backupName;
        saveProgress(attempt);
        archive=makeLargeBackup(state);
      }
      if(space.available<archive.bytes+old.size+space.reserve){
        const skipped={...attempt,status:'skipped',detail:'服务器空间不足以写入完整升级备份，已保留原资料。'};
        saveProgress(skipped);
        return skipped;
      }
      writeBackup(path.join(directory,backupName),archive.write);
    }
    const beforeBytes=Buffer.byteLength(original);
    let converted=0;
    for(const entry of old.entries){
      const write=entry.kind==='image'?saveImage:saveAudio;
      entry.row[entry.key]=write(dataDir,entry.row[entry.key]);
      if(++converted%100===0)log('已整理 '+converted+' / '+old.entries.length+' 项。');
    }
    Object.assign(result,{completedAt:now(),backupName,beforeBytes,afterBytes:Buffer.byteLength(JSON.stringify(state))});
    complete(state,result,true);
    log('图片和语音整理完成，升级前的备份已保存在资料目录。');
    return result;
  }catch(error){
    const failed={...attempt,status:'failed',detail:error?.userMessage||'旧媒体尚未整理完成，原资料已保留，下次启动会重试。'};
    saveProgress(failed);
    log('旧媒体迁移失败',error);
    return failed;
  }
}
module.exports={diskSpace,legacyMedia,prepareLargeLegacyBackup,migrateLegacy};
