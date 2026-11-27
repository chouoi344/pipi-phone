'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os');
const {promisify}=require('node:util'),{execFile}=require('node:child_process');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE);
const execute=promisify(execFile), wait=ms=>new Promise(r=>setTimeout(r,ms));
const old='0.14.3',next='0.14.4',image=process.env.GATE_OLD_IMAGE,target=process.env.GATE_NEXT_IMAGE;
const repo='isolated/pipi-phone',digest=target.split('@')[1];
const origin='http://127.0.0.1:18767', contact='升级前的测试好友', message='升级之前留下的旧聊天', displayName='升级前的测试账号';
async function main(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-voice-gate-')), shared=path.join(dir,'shared'), bundle=path.join(dir,'original');
  const composeFile=path.join(dir,'compose.yaml'),feature=path.join(bundle,'compose.updates.yaml');
  const project='pipi-upgrade-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
  const env={...process.env,PIPI_HOST_BIND:'127.0.0.1',PIPI_PORT:'18767',PIPI_INSTALL_IMAGE:image,PIPI_UPDATE_DIR:shared,PIPI_UPDATE_REPOSITORY:repo};
  const docker=async args=>(await execute('docker',args,{env,timeout:240000,maxBuffer:4*1024*1024})).stdout.trim();
  Object.assign(process.env,env);
  const compose=(...args)=>['compose','--project-name',project,'--project-directory',dir,'-f',composeFile,'-f',feature,...args];
  const container=async()=>JSON.parse(await docker(['inspect',await docker(compose('ps','-q','pipi-phone'))]))[0];
  const volume=c=>c.Mounts.find(m=>m.Destination==='/app/data').Name;
  await fs.mkdir(shared);await fs.chmod(shared,0o777);await fs.mkdir(bundle);
  const exporter=await docker(['create',image]);try{await docker(['cp',exporter+':/opt/pipi-install/.',bundle]);}finally{await docker(['rm',exporter]);}
  const originalCompose=await fs.readFile(path.join(bundle,'compose.yaml'),'utf8');
  assert(originalCompose.includes('    volumes:'));
  const launcher=path.resolve(__dirname,'launcher.cjs');
  await fs.writeFile(composeFile,originalCompose.replace('    volumes:',[
    '    command: ["node", "/acceptance-launcher.cjs"]','    volumes:',
    '      - '+JSON.stringify(launcher+':/acceptance-launcher.cjs:ro')
  ].join('\n')).replace('    environment:','    environment:\n      GATE_DIGEST: '+JSON.stringify(digest)));
  await fs.writeFile(path.join(shared,'feed'),old);
  await fs.writeFile(path.join(shared,'status.json'),JSON.stringify({id:'previous-completed',version:old,previousVersion:'0.14.1',phase:'succeeded',message:'已更新到 0.14.3，原资料继续保留',updatedAt:new Date().toISOString()}));
  const {readConfig,createUpdater}=require(path.join(bundle,'scripts/compose-updater.cjs'));
  const worker=createUpdater(readConfig({...env,PIPI_UPDATE_COMPOSE_FILE:composeFile,PIPI_UPDATE_COMPOSE_FEATURE_FILE:feature,PIPI_UPDATE_STATE_DIR:path.join(dir,'host-state'),PIPI_UPDATE_COMPOSE_PROJECT:project,PIPI_UPDATE_HEALTH_ORIGIN:origin,PIPI_UPDATE_HEALTH_TIMEOUT_MS:'45000'}),{
    getRelease:async input=>{
      assert.equal(input.repository,repo);assert.equal(input.version,next);assert.equal(input.expectedImage,'ghcr.io/'+repo+'@'+digest);
      return {version:next,image:target};
    }
  });
  let browser,page;
  try{
    await worker.initialize();
    await docker(compose('up','-d','--no-build','pipi-phone'));
    const before=await container();
    let health;
    for(let i=0;i<80;i++){try{health=await(await fetch(origin+'/api/status')).json();if(health.version===old)break;}catch{}await wait(250);}
    assert.equal(health?.version,old);
    browser=await chromium.launch({executablePath:process.env.PIPI_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
    page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(20000);
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(origin);await page.getByRole('button',{name:'我知道了'}).click();await page.locator('.first-notice').waitFor({state:'detached'});
    for(const [name,value] of Object.entries({displayName,password:'Fixture-Gate-2026!',confirmPassword:'Fixture-Gate-2026!'}))await page.locator('[name='+name+']').fill(value);
    await page.locator('#auth-form [type=submit]').click();
    const chats=page.locator('[data-open-chat]').filter({hasText:contact});
    await chats.waitFor();
    const beforeData=await browserData();
    await chats.click();await page.locator('[data-message]').filter({hasText:message}).first().waitFor();
    await page.goto(origin);await goAbout();
    const status=page.locator('.software-update-status');
    await status.filter({hasText:'更新完成'}).waitFor();assert.equal(await page.locator('.about-logo p').innerText(),'v'+old);
    await fs.writeFile(path.join(shared,'feed'),next);
    const [checked]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/updates/check?refresh=1')),page.locator('[data-update-check]').click()]);
    const check=await checked.json();assert.equal(check.state,'available');assert.equal(check.release.version,next);assert.equal(check.job.phase,'succeeded');assert.equal(check.job.version,old);
    await status.filter({hasText:'发现新版本 v'+next}).waitFor();
    await page.locator('[data-update-install]').click();await page.locator('#alert-confirm').click();await status.filter({hasText:'已排队'}).waitFor();
    const submitted=JSON.parse(await fs.readFile(path.join(shared,'request.json'),'utf8'));
    assert.equal(submitted.previousVersion,old);assert.equal(submitted.version,next);
    const finished=await worker.tick();assert.equal(finished.phase,'succeeded',JSON.stringify(finished));
    const after=await container();assert.notEqual(before.Id,after.Id);assert.notEqual(before.Image,after.Image);assert.equal(volume(before),volume(after));assert.equal(after.Config.Image,target);
    await status.filter({hasText:'更新完成'}).waitFor();await page.locator('[data-update-reload]').click();
    await page.locator('body').waitFor();await page.waitForFunction(()=>!document.querySelector('#auth-form')&&document.querySelector('#view [data-nav=me],#view [data-update-entry],#view [data-action=about]'));
    assert.equal(new URL(page.url()).origin,origin);
    const afterData=await browserData();assert.deepEqual(afterData,beforeData);
    await page.goto(origin);await goAbout();await status.filter({hasText:'更新完成'}).waitFor();assert.equal(await page.locator('.about-logo p').innerText(),'v'+next);
    await page.goto(origin);
    await page.locator('[data-nav=contacts]').click();await page.getByText(contact,{exact:true}).first().waitFor();
    await page.locator('[data-nav=chats]').click();await chats.click();await page.locator('[data-message]').filter({hasText:message}).first().waitFor();
    assert.deepEqual(pageErrors,[]);
    console.log(JSON.stringify({result:'passed',via:'normal web buttons and original v0.14.3 host updater',imageSource:'runner loopback registry pinned by digest',old, next, retained:['address','authenticated session','profile','contact ID and name','message ID and content','original named Docker volume'],beforeContainer:before.Id,afterContainer:after.Id,oldImage:before.Image,newImage:after.Image,job:finished.phase,errors:pageErrors}));
    async function goAbout(){await page.locator('[data-nav=me]').click();await page.locator('[data-action=settings]').click();await page.locator('[data-action=about]').click();await page.locator('[data-update-entry] > summary').click();}
    async function browserData(){
      const snapshot=await page.evaluate(async({contact,message})=>{
        const [status,state]=await Promise.all(['/api/status','/api/state'].map(async u=>(await fetch(u,{cache:'no-store'})).json()));
        const r=state.roles.find(r=>r.name===contact),m=state.messages.find(m=>m.content===message&&m.roleId===r?.id);
        return {authenticated:status.authenticated,scope:status.appSessionScope,installId:status.appearance.installationId,profile:state.profile.name,contactID:r?.id,contact:r?.name,messageID:m?.id,message:m?.content};
      },{contact,message});
      assert.equal(snapshot.authenticated,true);assert.equal(snapshot.profile,displayName);assert.equal(snapshot.contact,contact);assert.equal(snapshot.message,message);
      for(const k of ['scope','installId','contactID','messageID'])assert.ok(snapshot[k],k);
      return snapshot;
    }
  }catch(error){console.error('GATE ERROR',error);if(page)console.error('visible page:',(await page.locator('body').innerText().catch(()=>'' )).slice(0,1300));console.error(await docker(compose('logs','--tail=45','pipi-phone')).catch(()=>''));throw error;}
  finally{if(browser)await browser.close();await worker.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

