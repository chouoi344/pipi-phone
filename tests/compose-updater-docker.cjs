// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Opt-in Linux/Docker release gate. All containers, volumes and data are isolated.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),{readConfig,createUpdater}=require('../scripts/compose-updater.cjs');
const root=path.resolve(__dirname,'..'),project='pipi-updater-smoke-'+crypto.randomBytes(6).toString('hex');
const images={old:project+':old',next:project+':next',broken:project+':broken'};
const versions={old:'0.0.1',next:'0.0.2',broken:'0.0.3'},password='Isolated-Compose-Smoke-2026!';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

async function main(){
  if(process.platform!=='linux')throw new Error('Run this opt-in smoke on a Linux Docker host.');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-updater-docker-')),shared=path.join(dir,'shared');
  const composeFile=path.join(dir,'compose.yaml'),featureFile=path.join(root,'compose.updates.yaml');
  const port=await availablePort(),origin='http://127.0.0.1:'+port;
  const env={...process.env,PIPI_HOST_BIND:'127.0.0.1',PIPI_PORT:String(port),PIPI_UPDATE_DIR:shared,PIPI_UPDATE_REPOSITORY:'example/isolated-smoke'};
  async function docker(args){return (await execute('docker',args,{env,timeout:600000,maxBuffer:8*1024*1024})).stdout.trim();}
  const compose=(...args)=>['compose','--project-name',project,'--project-directory',dir,'-f',composeFile,'-f',featureFile,...args];
  let cookie='',csrf='',worker,stage='build isolated images';
  async function api(route,body){
    const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(result.csrfToken)csrf=result.csrfToken;return result;
  }
  async function currentContainer(){const ids=await docker(compose('ps','--all','--quiet','pipi-phone'));assert.match(ids,/^[0-9a-f]{12,64}$/);return JSON.parse(await docker(['inspect','--type','container',ids]))[0];}
  async function fileInVolume(volume,filename){return docker(['run','--rm','--network','none','--read-only','--mount',`type=volume,src=${volume},dst=/source,readonly`,'--entrypoint','node',images.old,'-e',`process.stdout.write(require('node:fs').readFileSync('/source/${filename}','utf8'))`]);}
  async function assertRetained(){const state=await api('/api/state');assert.equal(state.profile.name,'CI persistent profile');const c=await currentContainer(),volume=c.Mounts.find(m=>m.Destination==='/app/data').Name;assert.equal(await fileInVolume(volume,'media/smoke.txt'),'CI_PERSISTENT_MEDIA');return {container:c,volume};}
  try{
    await docker(['version']);await docker(['compose','version']);await fs.mkdir(shared,{mode:0o777});await fs.chmod(shared,0o777);
    for(const kind of Object.keys(images)){
      const context=path.join(dir,kind);await fs.mkdir(context);
      for(const item of ['package.json','server.cjs','LICENSE','LICENSE-MIT.txt','THIRD_PARTY_NOTICES.md','lib','public'])await fs.cp(path.join(root,item),path.join(context,item),{recursive:true});
      const pkg=JSON.parse(await fs.readFile(path.join(context,'package.json'),'utf8'));pkg.version=versions[kind];await fs.writeFile(path.join(context,'package.json'),JSON.stringify(pkg));
      let dockerfile=await fs.readFile(path.join(root,'Dockerfile'),'utf8');
      if(kind==='broken'){
        await fs.writeFile(path.join(context,'smoke-broken.cjs'),"const fs=require('node:fs');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/pipi.sqlite');const state=JSON.parse(db.prepare('SELECT json FROM app WHERE id=1').get().json);state.profile.name='BROKEN_MIGRATION';db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));db.close();fs.writeFileSync('/app/data/media/smoke.txt','BROKEN_MIGRATION');process.exit(1);\n");
        dockerfile+='\nCOPY --chown=node:node smoke-broken.cjs ./\nCMD ["node", "smoke-broken.cjs"]\n';
      }
      await fs.writeFile(path.join(context,'Dockerfile'),dockerfile);await docker(['build','--tag',images[kind],context]);
    }
    // The host updater needs the loopback-published port. Docker ignores port
    // mappings on containers attached only to an internal bridge network.
    stage='start original container on the project bridge';
    // Start from the shipped configuration, retaining its real security,
    // environment and named-volume settings. Only select the isolated fixture
    // image and disable automatic restart for the deliberately broken version.
    const shippedCompose=await fs.readFile(path.join(root,'compose.yaml'),'utf8');
    assert.match(shippedCompose,/    build: \./);assert.match(shippedCompose,/    restart: unless-stopped/);
    await fs.writeFile(composeFile,shippedCompose.replace('    build: .','    image: '+images.old).replace('    restart: unless-stopped','    restart: "no"'));
    // A fresh network must work even when the application starts before the gateway.
    const httpsFile = path.join(dir, 'compose.https.yaml');
    await fs.copyFile(path.join(root, 'compose.https.yaml'), httpsFile);
    await fs.writeFile(path.join(dir, '.env.https'), 'PIPI_PUBLIC_IP=192.0.2.1\nPIPI_HTTPS_HOST=192.0.2.1\n');
    const {services} = JSON.parse(await docker(compose('-f', httpsFile, 'config', '--format', 'json')));
    const application = services['pipi-phone'];
    const appAddress = application.networks['https-edge'].ipv4_address;
    const gatewayAddress = services['pipi-https'].networks['https-edge'].ipv4_address;
    assert.ok(appAddress && gatewayAddress, 'Reserve both addresses independently of start order');
    assert.notEqual(appAddress, gatewayAddress);
    assert.equal(application.environment.TRUST_PROXY, gatewayAddress);
    await docker(compose('up','-d','--no-build','pipi-phone'));
    const initial=await currentContainer();
    assert.equal(initial.NetworkSettings.Ports['8000/tcp']?.[0]?.HostPort,String(port),'Docker must publish the application port on the host');
    const deadline=Date.now()+30000;
    while(true){try{assert.equal((await api('/api/status')).version,versions.old);break;}catch(error){if(Date.now()>deadline)throw error;await wait(250);}}
    stage='create profile, session and media fixture';
    await api('/api/setup',{password,displayName:'CI persistent profile'});
    await docker(['exec',initial.Id,'node','-e',"const fs=require('node:fs');fs.mkdirSync('/app/data/media',{recursive:true});fs.writeFileSync('/app/data/media/smoke.txt','CI_PERSISTENT_MEDIA')"]);
    const before=await assertRetained();
    const config=readConfig({PIPI_UPDATE_DIR:shared,PIPI_UPDATE_STATE_DIR:path.join(dir,'host-state'),PIPI_UPDATE_COMPOSE_FILE:composeFile,PIPI_UPDATE_COMPOSE_FEATURE_FILE:featureFile,PIPI_UPDATE_REPOSITORY:env.PIPI_UPDATE_REPOSITORY,PIPI_UPDATE_COMPOSE_PROJECT:project,PIPI_UPDATE_HEALTH_ORIGIN:origin,PIPI_UPDATE_HEALTH_TIMEOUT_MS:'15000'});
    const releaseImages=new Map([[versions.next,images.next],[versions.broken,images.broken]]);
    const pulls=[];
    const dependencies={docker:async args=>{if(args[0]==='pull'){assert.equal(args.length,2);assert.ok([...releaseImages.values()].includes(args[1]));await docker(['image','inspect',args[1]]);pulls.push(args[1]);return args[1];}return docker(args);},getRelease:async({repository,version})=>{assert.equal(repository,config.repository);assert.ok(releaseImages.has(version));return {version,image:releaseImages.get(version)};},log:error=>console.error('Expected failing-version diagnostics:',error.message)};
    worker=createUpdater(config,dependencies);await worker.initialize();
    async function update(id,version,previousVersion){await fs.writeFile(path.join(shared,'request.json'),JSON.stringify({id,version,previousVersion}));return worker.tick();}
    stage='upgrade and verify retained data';
    const upgrade=await update('upgrade',versions.next,versions.old);
    assert.equal(upgrade.phase,'succeeded',upgrade.message);assert.equal((await api('/api/status')).version,versions.next);
    const upgraded=await assertRetained();assert.equal(upgraded.volume,before.volume);assert.notEqual(upgraded.container.Image,before.container.Image);
    stage='break the new container and verify snapshot recovery';
    const failedUpgrade=await update('failure',versions.broken,versions.next);
    assert.equal(failedUpgrade.phase,'rolled-back',failedUpgrade.message);assert.equal((await api('/api/status')).version,versions.next);
    const restored=await assertRetained(),journal=JSON.parse(await fs.readFile(path.join(config.stateDir,'current.json'),'utf8'));
    assert.equal(restored.container.Image,upgraded.container.Image);assert.equal(restored.volume,journal.rollbackVolume);assert.notEqual(restored.volume,journal.originalVolume);
    assert.equal(await fileInVolume(journal.snapshotVolume,'media/smoke.txt'),'CI_PERSISTENT_MEDIA');assert.equal(await fileInVolume(journal.originalVolume,'media/smoke.txt'),'BROKEN_MIGRATION');
    assert.deepEqual(pulls,[images.next,images.broken]);
    console.log(JSON.stringify({result:'passed',upgrade:'real Compose image replacement',rollback:'real failed container and snapshot-clone recovery',retained:['SQLite profile','login session','media bytes'],externalModels:'none',project}));
  }catch(error){
    throw new Error('Compose acceptance failed while attempting to '+stage,{cause:error});
  }finally{
    if(worker)await worker.close();
    if(await fs.stat(composeFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))await docker(compose('down','--volumes','--remove-orphans'));
    for(const volume of (await docker(['volume','ls','--quiet','--filter',`label=io.pipi.updater.project=${project}`])).split(/\s+/).filter(Boolean)){
      const [owned]=JSON.parse(await docker(['volume','inspect',volume]));assert.equal(owned.Labels['io.pipi.updater.project'],project);await docker(['volume','rm',volume]);
    }
    for(const image of Object.values(images))await docker(['image','rm',image]).catch(error=>{if(!error.stderr?.includes('No such image'))throw error;});
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-updater-docker-'));await fs.rm(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
