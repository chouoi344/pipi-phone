// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {readConfig,validateRequest,createUpdater}=require('../scripts/compose-updater.cjs');
const OLD='sha256:'+'a'.repeat(64),NEW='ghcr.io/example/pipi-phone@sha256:'+'b'.repeat(64),CID='c'.repeat(64);
const BEFORE={sqlite:'original database',media:'original photo',session:'original login'};

async function fixture(t,options={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-compose-updater-'));
  t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(dir).startsWith('pipi-compose-updater-'));await fs.rm(dir,{recursive:true,force:true});});
  const composeFile=path.join(dir,'compose.yaml'),featureFile=path.join(dir,'compose.updates.yaml');
  await fs.writeFile(composeFile,'services: {}\n');await fs.writeFile(featureFile,'services: {}\n');
  const config=readConfig({PIPI_UPDATE_DIR:path.join(dir,'shared'),PIPI_UPDATE_COMPOSE_FILE:composeFile,PIPI_UPDATE_REPOSITORY:'example/pipi-phone',PIPI_UPDATE_COMPOSE_PROJECT:'pipi-isolated-updater-test',PIPI_UPDATE_HEALTH_TIMEOUT_MS:'1000'});
  const request={id:'test-update-job',version:'0.12.1',previousVersion:'0.12.0',...(options.pinned?{expectedImage:NEW}:{})};
  const volumes=new Map([['existing-real-data',{Name:'existing-real-data',Labels:{},data:structuredClone(BEFORE)}]]),helpers=new Map(),commands=[],logs=[];
  let clock=Date.now(),helperIndex=1;
  const running={Id:CID,Image:OLD,State:{Running:true},Mounts:[{Type:'volume',Name:'existing-real-data',Destination:'/app/data'}],Config:{Labels:{'com.docker.compose.project':config.project,'com.docker.compose.service':'pipi-phone'}}};
  const valueAfter=(args,key)=>args[args.indexOf(key)+1];
  const labels=args=>Object.fromEntries(args.flatMap((value,i)=>value==='--label'?[args[i+1].split('=')]:[]));
  async function docker(args){
    commands.push([...args]);
    if(options.onCommand)await options.onCommand(args);
    if(args[0]==='compose'){
      assert.equal(valueAfter(args,'--project-name'),config.project);
      assert.equal(args.at(-1),'pipi-phone');
      assert.ok(args.includes(config.composeFile));assert.ok(args.includes(config.featureFile));
      if(args.includes('ps'))return CID;
      if(args.includes('stop')){running.State={Running:false};return '';}
      if(args.includes('up')){
        assert.ok(args.includes('--no-build'));assert.ok(args.includes('--no-deps'));
        const override=JSON.parse(await fs.readFile(path.join(config.stateDir,'active-compose.json'),'utf8'));
        const image=override.services['pipi-phone'].image,volume=override.volumes['pipi-update-data'].name;
        running.Image=image;running.Mounts[0].Name=volume;running.State={Running:true};
        if(image===NEW){volumes.get(volume).data.sqlite='new version migration';if(options.unhealthy)running.State.Health={Status:'unhealthy'};}
        if(options.onUp)await options.onUp({image,volume,running,volumes});
        return '';
      }
      throw new Error('Unexpected Compose operation: '+args.join(' '));
    }
    if(args[0]==='pull'){if(options.pullFailure)throw new Error('registry temporarily offline');return '';}
    if(args[0]==='inspect'){
      const id=args.at(-1),item=id===CID?running:[...helpers.values()].find(helper=>helper.Id===id);
      assert.ok(item,'inspect identifies only the explicit service or an owned copy helper');return JSON.stringify([item]);
    }
    if(args[0]==='volume'&&args[1]==='create'){
      const name=args.at(-1);if(!volumes.has(name))volumes.set(name,{Name:name,Labels:labels(args),data:{}});return name;
    }
    if(args[0]==='volume'&&args[1]==='inspect')return JSON.stringify([volumes.get(args.at(-1))]);
    if(args[0]==='ps'){
      const name=valueAfter(args,'--filter').slice('name=^/'.length,-1);
      return helpers.get(name)?.Id||'';
    }
    if(args[0]==='run'&&args.includes('--rm'))return options.imageVersion||request.version;
    if(args[0]==='run'){
      assert.equal(valueAfter(args,'--entrypoint'),'/bin/sh');assert.ok(args.includes('--read-only'));assert.equal(valueAfter(args,'--network'),'none');assert.ok(args.includes(OLD));
      const mounts=args.flatMap((value,i)=>value==='--mount'?[args[i+1]]:[]),source=/src=([^,]+)/.exec(mounts[0])[1],target=/src=([^,]+)/.exec(mounts[1])[1];
      assert.ok(mounts[0].endsWith(',readonly'));assert.notEqual(source,target);
      volumes.get(target).data=structuredClone(volumes.get(source).data);
      const helper={Id:(helperIndex++).toString(16).padStart(64,'0'),Config:{Labels:labels(args)},State:{Running:false,ExitCode:options.copyFailure?1:0}};
      helpers.set(valueAfter(args,'--name'),helper);
      if(options.copyFailure)throw new Error('snapshot copy failed');return '';
    }
    if(args[0]==='wait'){const helper=[...helpers.values()].find(item=>item.Id===args[1]);helper.State.Running=false;return String(helper.State.ExitCode);}
    if(args[0]==='rm'){const entry=[...helpers].find(([,helper])=>helper.Id===args[1]);assert.ok(entry);helpers.delete(entry[0]);return args[1];}
    throw new Error('Unexpected Docker operation: '+args.join(' '));
  }
  async function fetchImpl(url,init){
    assert.equal(url,'http://127.0.0.1:18766/api/status');assert.equal(init.redirect,'error');
    if(!running.State.Running)throw new Error('connection refused');
    return {status:200,json:async()=>({version:running.Image===OLD?'0.12.0':options.runtimeVersion||'0.12.1'})};
  }
  const deps={docker,fetchImpl,getRelease:async input=>{assert.deepEqual(input,{repository:config.repository,version:request.version,...(request.expectedImage?{expectedImage:request.expectedImage}:{})});if(options.releaseFetch)return require('../lib/updates.cjs').getRelease({...input,fetchImpl:options.releaseFetch});return options.releaseMissing?null:{version:request.version,image:NEW};},now:()=>clock,sleep:async ms=>{clock+=ms;},log:error=>logs.push(error)};
  const make=()=>createUpdater(config,deps);
  async function submit(value=request){await fs.mkdir(config.updateDir,{recursive:true});await fs.writeFile(path.join(config.updateDir,'request.json'),JSON.stringify(value));}
  async function journal(){return JSON.parse(await fs.readFile(path.join(config.stateDir,'current.json'),'utf8'));}
  async function status(){return JSON.parse(await fs.readFile(path.join(config.updateDir,'status.json'),'utf8'));}
  async function interrupted(stage,{snapshotComplete=false,rollbackCopyComplete=false}={}){
    await fs.mkdir(path.join(config.stateDir,'jobs'),{recursive:true});
    const now=new Date(clock).toISOString(),job={schema:1,stage,status:{...request,phase:'installing',startedAt:now,updatedAt:now,message:'interrupted'},oldImage:OLD,targetImage:NEW,originalVolume:'existing-real-data',snapshotVolume:'test-snapshot-data',rollbackVolume:'test-rollback-data',snapshotComplete,rollbackCopyComplete};
    volumes.set(job.snapshotVolume,{Name:job.snapshotVolume,Labels:{'io.pipi.updater.project':config.project,'io.pipi.updater.job':request.id,'io.pipi.updater.role':'snapshot'},data:structuredClone(BEFORE)});
    await fs.writeFile(path.join(config.stateDir,'current.json'),JSON.stringify(job));
    await fs.writeFile(path.join(config.stateDir,'active-compose.json'),JSON.stringify({services:{'pipi-phone':{image:NEW}},volumes:{'pipi-update-data':{name:job.originalVolume}}}));
    return job;
  }
  return {dir,config,request,volumes,helpers,running,commands,logs,make,submit,journal,status,interrupted,options};
}

test('Compose updater: healthy update retains the original named data volume and a stopped consistent snapshot',async t=>{
  const f=await fixture(t);await f.submit();await f.make().run({once:true});
  const status=await f.status(),job=await f.journal();
  assert.equal(status.phase,'succeeded');assert.equal(status.id,f.request.id);assert.ok(Number.isFinite(Date.parse(status.startedAt)));assert.ok(Number.isFinite(Date.parse(status.updatedAt)));
  assert.equal(f.running.Image,NEW);assert.equal(f.running.Mounts[0].Name,'existing-real-data');
  assert.deepEqual(f.volumes.get(job.snapshotVolume).data,BEFORE);assert.equal(f.volumes.get('existing-real-data').data.sqlite,'new version migration');
  const stop=f.commands.findIndex(args=>args[0]==='compose'&&args.includes('stop')),copy=f.commands.findIndex(args=>args[0]==='run'&&args.includes('/bin/sh')),start=f.commands.findIndex(args=>args[0]==='compose'&&args.includes('up'));
  assert.ok(stop<copy&&copy<start);assert.equal(f.helpers.size,0);
  assert.ok(!f.commands.some(args=>args.includes('down')||args.includes('prune')));
});

test('HTTPS installs preserve the loopback binding and proxy network during update and rollback',async t=>{
  const f=await fixture(t,{unhealthy:true});
  const httpsFile=path.join(f.dir,'compose.https.yaml');
  await fs.copyFile(path.join(__dirname,'../compose.https.yaml'),httpsFile);
  try{await fs.symlink('compose.https.yaml',path.join(f.dir,'compose.override.yaml'),'file');}
  catch(error){if(process.platform==='win32'&&error.code==='EPERM')return t.skip('The Ubuntu installer uses a POSIX symlink');throw error;}
  await f.submit();await f.make().run({once:true});
  assert.equal((await f.status()).phase,'rolled-back');
  const commands=f.commands.filter(args=>args[0]==='compose');
  assert.ok(commands.some(args=>args.includes('up')));
  for(const args of commands){
    assert.equal(args[args.indexOf(httpsFile)-1],'-f');
    assert.ok(args.indexOf(httpsFile)>args.indexOf(f.config.composeFile));
    assert.ok(args.indexOf(httpsFile)<args.indexOf(f.config.featureFile));
  }
});

test('Compose updater: failed migrated version runs the old image on a snapshot clone, preserving both original and snapshot',async t=>{
  const f=await fixture(t,{unhealthy:true});await f.submit();await f.make().run({once:true});
  const status=await f.status(),job=await f.journal();
  assert.equal(status.phase,'rolled-back');assert.equal(f.running.Image,OLD);assert.equal(f.running.Mounts[0].Name,job.rollbackVolume);
  assert.deepEqual(f.volumes.get(job.snapshotVolume).data,BEFORE);assert.deepEqual(f.volumes.get(job.rollbackVolume).data,BEFORE);
  assert.equal(f.volumes.get(job.originalVolume).data.sqlite,'new version migration');assert.equal(f.volumes.size,3);
});

test('Compose updater: runtime version mismatch rolls back before reporting success',async t=>{
  const f=await fixture(t,{runtimeVersion:'0.12.2'});await f.submit();await f.make().run({once:true});
  assert.equal((await f.status()).phase,'rolled-back');assert.match((await f.status()).message,/0\.12\.2/);assert.equal(f.running.Image,OLD);
});

test('Compose updater: a pull failure does not stop the working service or create data volumes',async t=>{
  const f=await fixture(t,{pullFailure:true});await f.submit();await f.make().run({once:true});
  assert.equal((await f.status()).phase,'failed');assert.equal(f.running.Image,OLD);assert.equal(f.running.State.Running,true);assert.equal(f.volumes.size,1);
  assert.ok(!f.commands.some(args=>args[0]==='compose'&&(args.includes('stop')||args.includes('up'))));
});

test('Compose updater: unexpected image package version and withdrawn release leave the running service untouched',async t=>{
  for(const options of [{imageVersion:'99.0.0'},{releaseMissing:true}]){
    const f=await fixture(t,options);await f.submit();await f.make().run({once:true});
    assert.equal((await f.status()).phase,'failed');assert.equal(f.running.Image,OLD);assert.equal(f.running.State.Running,true);assert.equal(f.volumes.size,1);
    assert.ok(!f.commands.some(args=>args[0]==='compose'&&args.includes('stop')));
  }
});

test('Compose updater: queued pinned jobs independently verify their fixed channel record and attachment without Latest or API calls',async t=>{
  const calls=[],record={version:'0.12.1',image:NEW,publishedAt:new Date().toISOString(),notes:'isolated stable release'};
  const f=await fixture(t,{pinned:true,releaseFetch:async url=>{
    calls.push(url);
    if(url==='https://raw.githubusercontent.com/example/pipi-phone/update-channel/versions/v0.12.1.json')return Response.json(record);
    assert.equal(url,'https://github.com/example/pipi-phone/releases/download/v0.12.1/update.json');return Response.json({version:record.version,image:NEW});
  }});
  await f.submit();await f.make().run({once:true});assert.equal((await f.status()).phase,'succeeded');assert.equal(calls.length,2);
  assert.equal((await f.journal()).targetImage,NEW);
});

test('Compose updater: withdrawn records and changed pinned images fail before any Docker command with a readable reason',async t=>{
  for(const withdrawn of [false,true]){
    const f=await fixture(t,{pinned:true,releaseFetch:async url=>{
      if(url.endsWith('/channel.json'))return Response.json({schema:1});
      assert.equal(url,'https://raw.githubusercontent.com/example/pipi-phone/update-channel/versions/v0.12.1.json');
      return withdrawn?new Response('',{status:404}):Response.json({version:'0.12.1',image:'ghcr.io/example/pipi-phone@sha256:'+'d'.repeat(64),publishedAt:new Date().toISOString(),notes:''});
    }});
    await f.submit();await f.make().run({once:true});assert.equal((await f.status()).phase,'failed');assert.equal(f.commands.length,0);
    assert.match((await f.status()).message,withdrawn?/撤回/:/已变化/);
  }
});

test('Compose updater: old jobs without an image pin still independently verify the fixed official release',async t=>{
  const calls=[];
  const f=await fixture(t,{releaseFetch:async url=>{
    calls.push(url);
    if(url.startsWith('https://raw.githubusercontent.com/'))return Response.json({version:'0.12.1',image:NEW,publishedAt:new Date().toISOString(),notes:''});
    assert.equal(url,'https://github.com/example/pipi-phone/releases/download/v0.12.1/update.json');return Response.json({version:'0.12.1',image:NEW});
  }});
  await f.submit();await f.make().run({once:true});assert.equal((await f.status()).phase,'succeeded');assert.equal(calls.length,2);
  assert(!calls.some(url=>url.includes('/latest')||url.includes('api.github.com')));
});

test('Compose updater: checking failures keep their stage and rate-limit reason visible',async t=>{
  const f=await fixture(t,{pinned:true,releaseFetch:async()=>new Response('',{status:429})});
  await f.submit();await f.make().run({once:true});const status=await f.status();
  assert.equal(status.phase,'failed');assert.match(status.message,/核对所选正式版本.*限制.*429/);assert.equal(f.commands.length,0);
});

test('Compose updater: failed snapshot copy restores the old image on the untouched original volume',async t=>{
  const f=await fixture(t,{copyFailure:true});await f.submit();await f.make().run({once:true});
  assert.equal((await f.status()).phase,'failed');assert.equal(f.running.Image,OLD);assert.equal(f.running.State.Running,true);assert.equal(f.running.Mounts[0].Name,'existing-real-data');
  assert.deepEqual(f.volumes.get('existing-real-data').data,BEFORE);assert.equal(f.volumes.size,2);assert.equal(f.helpers.size,0);
});

test('Compose updater: restarting after switching restores the old version and original data from the durable snapshot',async t=>{
  const f=await fixture(t);await f.submit();const job=await f.interrupted('verifying',{snapshotComplete:true});
  f.running.Image=NEW;f.volumes.get(job.originalVolume).data.sqlite='incompatible migration';
  await f.make().run({once:true});
  assert.equal((await f.status()).phase,'rolled-back');assert.equal(f.running.Image,OLD);assert.deepEqual(f.volumes.get(f.running.Mounts[0].Name).data,BEFORE);
  assert.equal(f.volumes.get(job.originalVolume).data.sqlite,'incompatible migration');assert.deepEqual(f.volumes.get(job.snapshotVolume).data,BEFORE);
});

test('Compose updater: restarting before switching starts the original data volume without applying a new image',async t=>{
  const f=await fixture(t);await f.submit();await f.interrupted('snapshotting');f.running.State.Running=false;
  await f.make().run({once:true});
  assert.equal((await f.status()).phase,'failed');assert.equal(f.running.Image,OLD);assert.equal(f.running.Mounts[0].Name,'existing-real-data');assert.deepEqual(f.volumes.get('existing-real-data').data,BEFORE);
  assert.ok(!f.commands.some(args=>args[0]==='pull'));
});

test('Compose updater: a copy helper surviving a worker crash finishes before the rollback image starts',async t=>{
  const f=await fixture(t);await f.submit();const job=await f.interrupted('rollback-copying',{snapshotComplete:true});
  f.running.Image=NEW;f.volumes.get(job.originalVolume).data.sqlite='incompatible migration';
  const labels={'io.pipi.updater.project':f.config.project,'io.pipi.updater.job':f.request.id,'io.pipi.updater.role':'rollback'};
  f.volumes.set(job.rollbackVolume,{Name:job.rollbackVolume,Labels:labels,data:structuredClone(BEFORE)});
  const name='pipi-update-'+crypto.createHash('sha256').update(f.config.project+'\n'+f.request.id).digest('hex').slice(0,24)+'-rollback';
  f.helpers.set(name,{Id:'d'.repeat(64),Config:{Labels:labels},State:{Running:true,ExitCode:0}});
  await f.make().run({once:true});
  assert.equal((await f.status()).phase,'rolled-back');assert.equal(f.running.Image,OLD);assert.deepEqual(f.volumes.get(job.rollbackVolume).data,BEFORE);
  assert.ok(f.commands.some(args=>args[0]==='wait'));assert.ok(!f.commands.some(args=>args[0]==='run'&&args.includes('/bin/sh')));assert.equal(f.helpers.size,0);
});

test('Compose updater: a failed recovery remains durable and is retried safely on the next worker start',async t=>{
  const f=await fixture(t);await f.submit();const job=await f.interrupted('verifying',{snapshotComplete:true});f.running.Image=NEW;
  let unavailable=true;f.options.onCommand=async args=>{if(unavailable&&args[0]==='compose'&&args.includes('stop'))throw new Error('Docker daemon offline');};
  await assert.rejects(f.make().run({once:true}),/Docker daemon offline/);assert.equal((await f.journal()).stage,'recovery-needed');
  unavailable=false;await f.make().run({once:true});
  assert.equal((await f.status()).phase,'rolled-back');assert.equal(f.running.Image,OLD);assert.deepEqual(f.volumes.get(job.snapshotVolume).data,BEFORE);
});

test('Compose updater: completed job IDs never run again across worker restarts',async t=>{
  const f=await fixture(t);await f.submit();await f.make().run({once:true});const count=f.commands.length;
  await f.make().run({once:true});assert.equal(f.commands.length,count);assert.equal((await f.status()).phase,'succeeded');
  await f.submit({...f.request,version:'0.12.2'});await assert.rejects(f.make().run({once:true}),/任务编号已被另一个版本使用/);assert.equal(f.commands.length,count);
});

test('Compose updater: stop requests finish the active transaction before the worker exits',async t=>{
  const f=await fixture(t);await f.submit();const worker=f.make();f.options.onUp=async()=>worker.stop();
  await worker.run();assert.equal((await f.status()).phase,'succeeded');assert.equal(f.running.Image,NEW);
});

test('Compose updater: a second worker refuses a live owner without touching any container',async t=>{
  const f=await fixture(t),first=f.make(),second=f.make();await first.initialize();
  t.after(()=>first.close());await assert.rejects(second.run({once:true}),/另一个更新工作进程/);assert.equal(f.commands.length,0);
  const ready=JSON.parse(await fs.readFile(path.join(f.config.updateDir,'worker-ready.json'),'utf8'));assert.notEqual(ready.updatedAt,new Date(0).toISOString());assert.equal(ready.requestSchema,2);
});

test('Compose updater: a stale worker PID is recovered without sending any termination signal',async t=>{
  const f=await fixture(t);assert.throws(()=>process.kill(2147483647,0),{code:'ESRCH'});
  await fs.mkdir(f.config.stateDir,{recursive:true});await fs.writeFile(path.join(f.config.stateDir,'worker.lock'),JSON.stringify({pid:2147483647,token:'old-crashed-worker'}));
  await f.make().run({once:true});assert.equal(f.commands.length,0);
  await assert.rejects(fs.stat(path.join(f.config.stateDir,'worker.lock')),{code:'ENOENT'});
});

test('Compose updater: inputs cannot select another service, remote health endpoint, local command or host state files',async t=>{
  const f=await fixture(t),base={PIPI_UPDATE_DIR:f.config.updateDir,PIPI_UPDATE_COMPOSE_FILE:f.config.composeFile,PIPI_UPDATE_REPOSITORY:'example/pipi-phone',PIPI_UPDATE_COMPOSE_PROJECT:f.config.project};
  for(const extra of [{PIPI_UPDATE_COMPOSE_SERVICE:'database'},{PIPI_UPDATE_HEALTH_ORIGIN:'https://example.com'},{PIPI_UPDATE_HEALTH_ORIGIN:'http://user:pass@127.0.0.1:18766'},{PIPI_UPDATE_STATE_DIR:path.join(f.config.updateDir,'private')},{PIPI_UPDATE_COMPOSE_PROJECT:'another; shutdown'}])assert.throws(()=>readConfig({...base,...extra}));
  for(const request of [{...f.request,id:'../../escape'},{...f.request,image:'other-image'},{...f.request,command:'docker rm -f user-container'},{...f.request,version:'0.12.0'}])assert.throws(()=>validateRequest(request));
  await f.submit({...f.request,id:'../../escape'});await assert.rejects(f.make().run({once:true}),/请求格式无效/);assert.equal(f.commands.length,0);
});

test('Compose updater: untrusted Docker errors stay in host logs and never enter browser-readable status',async t=>{
  const secret='fake-private-token-DO-NOT-SHARE';
  const f=await fixture(t,{onCommand:async args=>{if(args[0]==='pull')throw new Error('unexpected stderr '+secret);}});
  await f.submit();await f.make().run({once:true});
  assert.equal((await f.status()).phase,'failed');assert.ok(!JSON.stringify(await f.status()).includes(secret));assert.ok(f.logs.some(error=>error.message.includes(secret)));
});

test('Compose updater: oversized requests are rejected without Docker operations',async t=>{
  const f=await fixture(t);await fs.mkdir(f.config.updateDir,{recursive:true});
  await fs.writeFile(path.join(f.config.updateDir,'request.json'),'x'.repeat(16385));
  await assert.rejects(f.make().run({once:true}),/普通文件/);assert.equal(f.commands.length,0);
});

test('Compose updater: request symlinks are rejected without Docker operations',async t=>{
  const f=await fixture(t);await fs.mkdir(f.config.updateDir,{recursive:true});
  const outside=path.join(f.dir,'outside-request.json');await fs.writeFile(outside,JSON.stringify(f.request));
  try{await fs.symlink(outside,path.join(f.config.updateDir,'request.json'));}
  catch(error){if(error.code==='EPERM'){t.skip('Windows symlink permission is unavailable');return;}throw error;}
  await assert.rejects(f.make().run({once:true}),/普通文件/);assert.equal(f.commands.length,0);
});

test('Compose updater: a leftover startup guard is not stolen by competing recovery workers',async t=>{
  const f=await fixture(t);await fs.mkdir(f.config.stateDir,{recursive:true});await fs.writeFile(path.join(f.config.stateDir,'worker-start.lock'),'interrupted startup');
  await assert.rejects(f.make().run({once:true}),/worker-start\.lock/);assert.equal(f.commands.length,0);
});

test('Compose updater: state directory links cannot bypass the separation from the web-writable shared directory',async t=>{
  const f=await fixture(t);await fs.mkdir(f.config.updateDir,{recursive:true});
  const linked=path.join(f.dir,'state-link');
  try{await fs.symlink(f.config.updateDir,linked,process.platform==='win32'?'junction':'dir');}
  catch(error){if(error.code==='EPERM'){t.skip('Directory link permission is unavailable');return;}throw error;}
  f.config.stateDir=linked;await assert.rejects(f.make().run({once:true}),/真实路径不能重叠/);assert.equal(f.commands.length,0);
});
