// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const TERMINAL=new Set(['succeeded','rolled-back','failed']);
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LABEL='io.pipi.updater';
const publicError=message=>Object.assign(new Error(message),{publicMessage:message});
const publicMessage=error=>error.publicMessage||'操作未完成，请检查宿主机更新日志';
const overlaps=(a,b)=>{if(process.platform==='win32'){a=a.toLowerCase();b=b.toLowerCase();}return a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);};

function readConfig(env=process.env){
  function required(name){const value=env[name]?.trim();if(!value)throw new Error(`${name} 未设置`);return value;}
  function absolute(name,value=required(name)){if(!path.isAbsolute(value))throw new Error(`${name} 必须是宿主机绝对路径`);return path.resolve(value);}
  function number(name,fallback,min,max){const value=Number(env[name]||fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} 超出允许范围`);return value;}
  const updateDir=absolute('PIPI_UPDATE_DIR'),composeFile=absolute('PIPI_UPDATE_COMPOSE_FILE');
  const stateDir=absolute('PIPI_UPDATE_STATE_DIR',env.PIPI_UPDATE_STATE_DIR?.trim()||path.join(path.dirname(composeFile),'.pipi-updater'));
  if(overlaps(stateDir,updateDir))throw new Error('PIPI_UPDATE_STATE_DIR 与网页可写更新目录不能重叠');
  const repository=required('PIPI_UPDATE_REPOSITORY');
  if(!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository))throw new Error('PIPI_UPDATE_REPOSITORY 必须为 owner/repo');
  const project=required('PIPI_UPDATE_COMPOSE_PROJECT');
  if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project))throw new Error('PIPI_UPDATE_COMPOSE_PROJECT 无效');
  if(env.PIPI_UPDATE_COMPOSE_SERVICE&&env.PIPI_UPDATE_COMPOSE_SERVICE!=='pipi-phone')throw new Error('更新器只允许操作 pipi-phone 服务');
  const origin=URL.parse(env.PIPI_UPDATE_HEALTH_ORIGIN||'http://127.0.0.1:18766');
  if(!origin||origin.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('PIPI_UPDATE_HEALTH_ORIGIN 必须是本机 HTTP 地址，例如 http://127.0.0.1:18766');
  return {updateDir,stateDir,composeFile,featureFile:absolute('PIPI_UPDATE_COMPOSE_FEATURE_FILE',env.PIPI_UPDATE_COMPOSE_FEATURE_FILE?.trim()||path.join(path.dirname(composeFile),'compose.updates.yaml')),repository,project,service:'pipi-phone',healthOrigin:origin.origin,pollMs:number('PIPI_UPDATE_POLL_MS',2000,100,60000),healthTimeoutMs:number('PIPI_UPDATE_HEALTH_TIMEOUT_MS',90000,1000,600000),healthPollMs:1000};
}

function validateRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['id','version','previousVersion'].includes(k))||typeof value.id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(value.id)||!VERSION.test(value.version)||!VERSION.test(value.previousVersion))throw new Error('更新请求格式无效');
  const compare=require('../lib/updates.cjs').compareVersions;
  if(compare(value.version,value.previousVersion)<=0)throw new Error('更新版本必须高于当前版本');
  return {id:value.id,version:value.version,previousVersion:value.previousVersion};
}

async function readJson(filename,{optional=false,maxBytes=262144}={}){
  let handle,content;
  try{
    const before=await fs.lstat(filename);
    if(!before.isFile()||before.size>maxBytes)throw new Error(`${path.basename(filename)} 必须是指定大小内的普通文件`);
    const flags=constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK);
    handle=await fs.open(filename,flags);
    const opened=await handle.stat();
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>maxBytes)throw new Error(`${path.basename(filename)} 在读取前已改变`);
    const buffer=Buffer.alloc(maxBytes+1);let size=0,bytesRead;
    do{({bytesRead}=await handle.read(buffer,size,buffer.length-size,null));size+=bytesRead;}while(bytesRead&&size<buffer.length);
    if(size>maxBytes)throw new Error(`${path.basename(filename)} 文件过大`);
    content=buffer.subarray(0,size).toString('utf8');
  }
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  finally{if(handle)await handle.close();}
  try{return JSON.parse(content);}catch(error){throw new Error(`${path.basename(filename)} 不是有效 JSON`,{cause:error});}
}
async function writeJson(filename,value,mode=0o600){
  const temp=filename+'.'+crypto.randomUUID()+'.tmp';
  await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode,flag:'wx'});
  await fs.rename(temp,filename);
}
async function dockerCommand(args){
  try{return (await execute('docker',args,{timeout:600000,maxBuffer:4*1024*1024,windowsHide:true})).stdout.trim();}
  catch(error){console.error('Docker 操作失败：',error.stderr||error);throw publicError('Docker 操作失败，请检查宿主机更新日志');}
}

function createUpdater(config,{docker=dockerCommand,getRelease=(options)=>require('../lib/updates.cjs').getRelease(options),fetchImpl=global.fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.error}={}){
  const currentFile=path.join(config.stateDir,'current.json'),activeFile=path.join(config.stateDir,'active-compose.json');
  const lockFile=path.join(config.stateDir,'worker.lock'),startLockFile=path.join(config.stateDir,'worker-start.lock'),jobsDir=path.join(config.stateDir,'jobs');
  let lockToken=null,heartbeat=null,heartbeatWrite=Promise.resolve(),busy=false,stopping=false;
  const stamp=()=>new Date(now()).toISOString();
  const compose=(...args)=>['compose','--project-name',config.project,'--project-directory',path.dirname(config.composeFile),'-f',config.composeFile,'-f',config.featureFile,'-f',activeFile,...args];
  const baseCompose=(...args)=>['compose','--project-name',config.project,'--project-directory',path.dirname(config.composeFile),'-f',config.composeFile,'-f',config.featureFile,...args];
  const jobFile=id=>path.join(jobsDir,id+'.json');
  const jsonDocker=async args=>JSON.parse(await docker(args));
  async function ready(){await writeJson(path.join(config.updateDir,'worker-ready.json'),{updatedAt:stamp()},0o644);}
  async function save(job,phase,message,stage=job.stage){
    job.stage=stage;
    job.status={...job.status,phase,message:message.slice(0,1000),updatedAt:stamp()};
    await writeJson(currentFile,job);
    if(TERMINAL.has(phase))await writeJson(jobFile(job.status.id),job);
    await writeJson(path.join(config.updateDir,'status.json'),job.status,0o644);
  }
  async function useImage(image,volume){
    await writeJson(activeFile,{services:{'pipi-phone':{image,volumes:[{type:'volume',source:'pipi-update-data',target:'/app/data'}]}},volumes:{'pipi-update-data':{external:true,name:volume}}});
  }
  function assertContainer(container){
    if(container.Config?.Labels?.['com.docker.compose.project']!==config.project||container.Config.Labels['com.docker.compose.service']!==config.service)throw publicError('目标容器不属于已配置的小手机 Compose 服务');
  }
  async function container({active=true}={}){
    const args=active?compose('ps','--all','--quiet',config.service):baseCompose('ps','--all','--quiet',config.service);
    const ids=(await docker(args)).split(/\s+/).filter(Boolean);
    if(ids.length!==1||! /^[a-f0-9]{12,64}$/.test(ids[0]))throw publicError('目标 Compose 服务必须恰好包含一个容器');
    const [result]=await jsonDocker(['inspect','--type','container',ids[0]]);assertContainer(result);return result;
  }
  async function statusVersion(){
    const response=await fetchImpl(config.healthOrigin+'/api/status',{headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(response.status!==200)throw publicError(`小手机状态接口返回 HTTP ${response.status}`);
    const status=await response.json();
    if(!status||!VERSION.test(status.version))throw publicError('小手机状态接口缺少有效版本');
    return status.version;
  }
  async function waitHealthy(version){
    const deadline=now()+config.healthTimeoutMs;let lastError;
    while(now()<deadline){
      const current=await container();
      if(!current.State?.Running)throw publicError('小手机容器未能保持运行');
      if(current.State.Health?.Status==='unhealthy')throw publicError('小手机容器健康检查未通过');
      let actual;
      try{actual=await statusVersion();}catch(error){lastError=error;}
      if(actual){if(actual!==version)throw publicError(`启动后的版本为 ${actual}，预期 ${version}`);if(!current.State.Health||current.State.Health.Status==='healthy')return;}
      await sleep(config.healthPollMs);
    }
    throw publicError(`小手机启动检查超时${lastError?'：'+publicMessage(lastError):''}`);
  }
  async function createVolume(job,role){
    const volume=role==='snapshot'?job.snapshotVolume:job.rollbackVolume;
    await docker(['volume','create','--label',`${LABEL}.project=${config.project}`,'--label',`${LABEL}.job=${job.status.id}`,'--label',`${LABEL}.role=${role}`,volume]);
    const [created]=await jsonDocker(['volume','inspect',volume]);
    if(created.Name!==volume||created.Labels?.[`${LABEL}.project`]!==config.project||created.Labels?.[`${LABEL}.job`]!==job.status.id||created.Labels?.[`${LABEL}.role`]!==role)throw publicError('备份数据卷名称已被其他资料占用');
  }
  function helperName(job,role){return `pipi-update-${crypto.createHash('sha256').update(config.project+'\n'+job.status.id).digest('hex').slice(0,24)}-${role}`;}
  async function existingHelper(job,role){
    const ids=(await docker(['ps','--all','--quiet','--filter',`name=^/${helperName(job,role)}$`])).split(/\s+/).filter(Boolean);
    if(!ids.length)return null;
    if(ids.length!==1)throw publicError('发现重复的更新备份任务');
    const [helper]=await jsonDocker(['inspect','--type','container',ids[0]]);
    if(helper.Config?.Labels?.[`${LABEL}.project`]!==config.project||helper.Config.Labels[`${LABEL}.job`]!==job.status.id||helper.Config.Labels[`${LABEL}.role`]!==role)throw publicError('备份任务名称已被其他容器占用');
    return helper;
  }
  async function settleHelper(job,role){
    const helper=await existingHelper(job,role);if(!helper)return false;
    const code=helper.State.Running?Number(await docker(['wait',helper.Id])):helper.State.ExitCode;
    await docker(['rm',helper.Id]);
    if(code!==0)throw publicError('数据卷备份任务未完成，已保留备份卷供检查');
    return true;
  }
  async function copyVolume(job,role,source,target){
    if(await settleHelper(job,role))return;
    await docker(['run','--name',helperName(job,role),'--label',`${LABEL}.project=${config.project}`,'--label',`${LABEL}.job=${job.status.id}`,'--label',`${LABEL}.role=${role}`,'--network','none','--user','0','--read-only','--mount',`type=volume,src=${source},dst=/source,readonly`,'--mount',`type=volume,src=${target},dst=/target`,'--entrypoint','/bin/sh',job.oldImage,'-c','cp -a /source/. /target/']);
    await settleHelper(job,role);
  }
  async function restoreOriginal(job,reason){
    let helperFailure='';
    try{await settleHelper(job,'snapshot');}catch(error){log(error);helperFailure='；'+publicMessage(error);}
    await useImage(job.oldImage,job.originalVolume);
    await docker(compose('up','-d','--no-build','--no-deps',config.service));
    await waitHealthy(job.status.previousVersion);
    await save(job,'failed',`${reason}；原版本已恢复${helperFailure}`,'done');
  }
  async function rollback(job,reason){
    await save(job,'rolling-back',`${reason}；正在恢复原版本`,'rollback-stopping');
    await docker(compose('stop',config.service));
    if(!job.rollbackCopyComplete){
      await save(job,'rolling-back','正在从更新前备份恢复资料','rollback-copying');
      await createVolume(job,'rollback');
      await copyVolume(job,'rollback',job.snapshotVolume,job.rollbackVolume);
      job.rollbackCopyComplete=true;
    }
    await save(job,'rolling-back','正在启动原版本','rollback-starting');
    await useImage(job.oldImage,job.rollbackVolume);
    await docker(compose('up','-d','--no-build','--no-deps',config.service));
    await save(job,'rolling-back','正在确认原版本与资料已恢复','rollback-verifying');
    await waitHealthy(job.status.previousVersion);
    await save(job,'rolled-back',`${reason}；已恢复到 ${job.status.previousVersion}，更新前备份和失败资料卷均已保留`,'done');
  }
  function validateJournal(job){
    if(!job||job.schema!==1||!job.status||! /^[A-Za-z0-9_-]{1,100}$/.test(job.status.id)||!VERSION.test(job.status.version)||!VERSION.test(job.status.previousVersion)||typeof job.stage!=='string')throw new Error('宿主机更新记录格式无效');
    if(job.oldImage&&! /^sha256:[a-f0-9]{64}$/.test(job.oldImage))throw new Error('宿主机更新记录中的旧镜像无效');
    for(const key of ['originalVolume','snapshotVolume','rollbackVolume'])if(job[key]&&! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(job[key]))throw new Error('宿主机更新记录中的资料卷无效');
    return job;
  }
  async function recover(){
    const job=await readJson(currentFile,{optional:true});if(!job)return;
    validateJournal(job);
    if(TERMINAL.has(job.status.phase)&&job.stage!=='recovery-needed')return;
    try{
      if(job.snapshotComplete&&['switching','verifying','rollback-stopping','rollback-copying','rollback-starting','rollback-verifying','recovery-needed'].includes(job.stage))await rollback(job,'更新进程上次中断');
      else if(job.oldImage&&['stopping','snapshotting','snapshot-ready','recovery-needed'].includes(job.stage))await restoreOriginal(job,'更新进程上次中断');
      else await save(job,'failed','更新进程上次中断，尚未切换运行版本','done');
    }catch(error){log(error);await save(job,'failed',`恢复未完成：${publicMessage(error)}。已保留所有资料卷，请检查宿主机更新日志`,'recovery-needed');throw error;}
  }
  async function processRequest(request){
    const job={schema:1,stage:'checking',status:{...request,phase:'checking',message:'正在核对官方版本与当前安装',startedAt:stamp(),updatedAt:stamp()}};
    await save(job,'checking','正在核对官方版本与当前安装');
    try{
      const release=await getRelease({repository:config.repository,version:request.version});
      if(!release||release.version!==request.version)throw publicError('官方版本的镜像清单无效或已撤回');
      const activeExists=Boolean(await readJson(activeFile,{optional:true}));
      const running=await container({active:activeExists});
      if(!running.State?.Running)throw publicError('当前小手机未运行，请先启动原版本');
      if(! /^sha256:[a-f0-9]{64}$/.test(running.Image))throw publicError('当前镜像标识无效');
      const mount=running.Mounts?.find(item=>item.Destination==='/app/data');
      if(!mount||mount.Type!=='volume'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(mount.Name))throw publicError('当前资料必须使用 /app/data 命名数据卷');
      if(await statusVersion()!==request.previousVersion)throw publicError('当前版本已改变，请刷新后重新检查更新');
      const hash=crypto.createHash('sha256').update(config.project+'\n'+request.id).digest('hex').slice(0,24);
      Object.assign(job,{oldImage:running.Image,originalVolume:mount.Name,snapshotVolume:`pipi-update-${hash}-snapshot`,rollbackVolume:`pipi-update-${hash}-rollback`,targetImage:release.image,snapshotComplete:false,rollbackCopyComplete:false});
      await save(job,'downloading','正在下载官方新版镜像','pulling');
      await docker(['pull',release.image]);
      const imageVersion=(await docker(['run','--rm','--network','none','--read-only','--entrypoint','node',release.image,'-p',"require('./package.json').version"])).trim();
      if(imageVersion!==request.version)throw publicError('下载镜像的程序版本与发布清单不一致');
      await useImage(job.oldImage,job.originalVolume);
      await save(job,'backing-up','正在停止小手机并备份全部资料','stopping');
      await docker(compose('stop',config.service));
      const stopped=await container();
      if(stopped.State.Running)throw publicError('小手机尚未完全停止，未开始备份');
      await save(job,'backing-up','正在保存更新前的完整资料备份','snapshotting');
      await createVolume(job,'snapshot');
      await copyVolume(job,'snapshot',job.originalVolume,job.snapshotVolume);
      job.snapshotComplete=true;
      await save(job,'backing-up','资料备份已完成','snapshot-ready');
      await save(job,'installing','正在安装新版','switching');
      await useImage(release.image,job.originalVolume);
      await docker(compose('up','-d','--no-build','--no-deps',config.service));
      await save(job,'verifying','正在确认新版可以正常访问','verifying');
      await waitHealthy(request.version);
      await save(job,'succeeded',`已更新到 ${request.version}，原资料继续保留`,'done');
    }catch(error){
      log(error);
      if(TERMINAL.has(job.status.phase))throw error;
      const reason=publicMessage(error);
      try{
        if(job.snapshotComplete&&['switching','verifying'].includes(job.stage))await rollback(job,reason);
        else if(job.oldImage&&['stopping','snapshotting','snapshot-ready'].includes(job.stage))await restoreOriginal(job,reason);
        else await save(job,'failed',reason,'done');
      }catch(restoreError){log(restoreError);await save(job,'failed',`${reason}；自动恢复未完成：${publicMessage(restoreError)}。已保留所有资料卷，请检查宿主机更新日志`,'recovery-needed');throw restoreError;}
    }
    return job.status;
  }
  async function tick(){
    if(busy)throw new Error('更新工作进程已经在处理任务');
    busy=true;
    try{
      const raw=await readJson(path.join(config.updateDir,'request.json'),{optional:true,maxBytes:16384});if(!raw)return null;
      const request=validateRequest(raw);
      let existing=await readJson(jobFile(request.id),{optional:true});
      if(!existing){const current=await readJson(currentFile,{optional:true});if(current?.status?.id===request.id)existing=current;}
      if(existing){validateJournal(existing);if(existing.status.version!==request.version||existing.status.previousVersion!==request.previousVersion)throw new Error('更新任务编号已被另一个版本使用');if(!TERMINAL.has(existing.status.phase))throw new Error('未完成任务需要先执行恢复');await writeJson(path.join(config.updateDir,'status.json'),existing.status,0o644);return existing.status;}
      const current=await readJson(currentFile,{optional:true});
      if(current?.stage==='recovery-needed')throw new Error('上次自动恢复尚未完成，请先修复宿主机服务');
      return await processRequest(request);
    }finally{busy=false;}
  }
  async function initialize(){
    for(const filename of [config.composeFile,config.featureFile])if(!(await fs.stat(filename)).isFile())throw new Error('Compose 配置不是有效文件');
    await fs.mkdir(config.updateDir,{recursive:true,mode:0o770});
    await fs.mkdir(config.stateDir,{recursive:true,mode:0o700});
    const [realShared,realState]=await Promise.all([fs.realpath(config.updateDir),fs.realpath(config.stateDir)]);
    if(overlaps(realShared,realState))throw new Error('更新共享目录和宿主机状态目录的真实路径不能重叠');
    await fs.mkdir(jobsDir,{recursive:true,mode:0o700});
    // Serialize stale-owner replacement. This short startup guard is never
    // automatically stolen: a crash during acquisition needs an administrator,
    // rather than risking two privileged workers operating the same data.
    try{await fs.writeFile(startLockFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});}
    catch(error){if(error.code==='EEXIST')throw new Error('另一个更新工作进程正在启动；若上次启动中断，请管理员检查 worker-start.lock');throw error;}
    try{
      const owner=await readJson(lockFile,{optional:true});
      if(owner){
        if(!Number.isInteger(owner.pid)||owner.pid<1)throw new Error('更新器锁文件无效，请由宿主机管理员检查');
        try{process.kill(owner.pid,0);throw new Error('另一个更新工作进程正在运行');}
        catch(probeError){if(probeError.code!=='ESRCH')throw probeError;}
        await fs.unlink(lockFile);
      }
      const token=crypto.randomUUID();
      await fs.writeFile(lockFile,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});
      lockToken=token;
    }finally{await fs.unlink(startLockFile);}
    await recover();
    await ready();
    heartbeat=setInterval(()=>{heartbeatWrite=heartbeatWrite.then(ready).catch(error=>{log(error);stopping=true;});},15000);
    heartbeat.unref();
  }
  async function close(){
    if(heartbeat)clearInterval(heartbeat);
    await heartbeatWrite;
    if(lockToken){const owner=await readJson(lockFile,{optional:true});if(owner?.token===lockToken){await writeJson(path.join(config.updateDir,'worker-ready.json'),{updatedAt:new Date(0).toISOString()},0o644);await fs.unlink(lockFile);}lockToken=null;}
  }
  async function run({once=false}={}){
    try{await initialize();do{await tick();if(once||stopping)break;await sleep(config.pollMs);}while(!stopping);}
    finally{await close();}
  }
  return {initialize,tick,recover,close,run,stop(){stopping=true;}};
}

async function runCli(){
  if(process.argv.slice(2).some(arg=>arg!=='--once'))throw new Error('用法：node scripts/compose-updater.cjs [--once]');
  const updater=createUpdater(readConfig());
  const stop=()=>{console.error('正在等待当前更新或恢复操作结束，然后退出。');updater.stop();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{await updater.run({once:process.argv.includes('--once')});}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(require.main===module)runCli().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={readConfig,validateRequest,createUpdater,runCli};
