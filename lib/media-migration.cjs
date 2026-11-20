// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
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

function writeBackup(destination,value){
  const temp=destination+'.'+crypto.randomUUID()+'.tmp';
  let renamed=false;
  const handle=fs.openSync(temp,'wx',0o600);
  try{
    try{
      fs.writeFileSync(handle,value);
      fs.fsyncSync(handle);
    }finally{fs.closeSync(handle);}
    fs.renameSync(temp,destination);
    renamed=true;
  }finally{if(!renamed)fs.unlinkSync(temp);}
}

function migrateLegacy({dataDir,state,previous,readSpace=diskSpace,makeBackup,saveProgress,complete,saveImage,saveAudio,now=Date.now,log=console.log}){
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
  const backupName=previous?.fingerprint===fingerprint?previous.backupName:'before-0.13.0-'+new Date(begun).toISOString().replace(/[:.]/g,'-')+'-'+fingerprint.slice(0,12)+'.json';
  if(!/^before-0\.13\.0-[\dTZ-]+-[a-z0-9]{12}\.json$/.test(backupName))throw new Error('旧媒体备份文件名无效');
  const directory=path.join(dataDir,'backups'),backupPath=path.join(directory,backupName);
  const attempt={version:1,status:'running',startedAt:begun,backupName,fingerprint};
  saveProgress(attempt);
  log('开始整理旧图片和语音，共 '+old.entries.length+' 项。');
  try{
    fs.mkdirSync(directory,{mode:0o700,recursive:true});
    if(!fs.lstatSync(directory).isDirectory())throw new Error('迁移备份目录无效');
    const saved=fs.lstatSync(backupPath,{throwIfNoEntry:false});
    if(saved&&!saved.isFile())throw new Error('迁移备份路径不是文件');
    if(!saved){
      const archive=JSON.stringify(makeBackup(state));
      if(space.available<Buffer.byteLength(archive)+old.size+space.reserve){
        const skipped={...attempt,status:'skipped',detail:'服务器空间不足以写入完整升级备份，已保留原资料。'};
        saveProgress(skipped);
        return skipped;
      }
      writeBackup(backupPath,archive);
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
module.exports={diskSpace,legacyMedia,migrateLegacy};
