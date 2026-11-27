// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// LEGACY_ANDROID_ASSETS points to assets/phone extracted from the signed 0.1.15 APK.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');
const current=path.resolve(__dirname,'..'),legacy=process.env.PIPI_LEGACY_SERVER_ROOT,oldAssets=process.env.PIPI_LEGACY_ANDROID_ASSETS;
async function check(browser,serverDir,assets,paged,provider){
  const {createApp}=require(path.join(serverDir,'server.cjs')),S=require(path.join(serverDir,'lib/state.cjs')),R=require(path.join(serverDir,'lib/engine/registry.cjs'));
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-cross-version-')),state=S.initial();
  R.ensure(state);for(const mod of R.list())if(mod.settings.some(s=>s.key==='enabled'))R.apply(state,mod.id,{enabled:false});
  state.settings.ai.sources=[{id:'fixture',name:'隔离固定回复',baseUrl:provider,key:'fixture',builtin:false}];
  state.settings.ai.models=[{id:'fixture',sourceId:'fixture',model:'fixture',kind:'chat',capabilities:['text'],maxContextTokens:128000}];state.settings.ai.assign.chat='fixture';
  for(const name of ['甲','乙']){
    S.apply(state,'role.save',{name});const role=state.roles.at(-1);
    for(let i=0;i<150;i++)S.message(state,role,'user',name+'历史'+i,'text',{status:'sent'});
  }
  const app=createApp({dataDir,host:'127.0.0.1',port:0,initialState:()=>state,mediaTimers:false,providerUrlAllowlist:[provider]});
  const context=await browser.newContext({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 Chrome/140.0 PipiPhoneAndroid/1.0',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],requests=[];
  try{
    await app.listen();const origin='http://127.0.0.1:'+app.server.address().port;
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname.startsWith('/api/')){requests.push(url.pathname);return route.continue();}
      const file=path.join(assets,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));
      try{await route.fulfill({path:file});}catch(err){if(err.code!=='ENOENT')throw err;await route.fulfill({status:404,body:''});}
    });
    await page.goto(origin);await page.locator('#dismiss-notice').click();
    await page.locator('[name=displayName]').fill('兼容测试');await page.locator('[name=password]').fill('Isolated-cross-version!');await page.locator('[name=confirmPassword]').fill('Isolated-cross-version!');
    await page.locator('#auth-form [type=submit]').click();await page.locator('#view[data-route=chats]').waitFor();
    assert.equal(await page.evaluate(()=>Pipi.getState().messages.length),paged?2:300);
    const roleId=state.roles[0].id;await page.locator('[data-open-chat="'+roleId+'"]').click();
    await page.locator('#chat-messages [data-message]').first().waitFor();
    if(paged){
      await page.waitForFunction(id=>PipiStateSync.client.paging.rows(id).length===60,roleId);
      await page.locator('[data-chat-older]').click();await page.waitForFunction(id=>PipiStateSync.client.paging.rows(id).length===120,roleId);
      assert.equal(await page.evaluate(()=>PipiStateSync.client.paging.totalCount()),null);
    }
    const input=page.locator('#compose-text');await input.fill('新旧版本聊天验证');
    const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat');
    await input.press('Enter');assert.equal((await receipt).status(),200);
    await page.waitForFunction(()=>Pipi.getState().messages.some(m=>m.sender==='assistant'&&m.content==='收到兼容测试。'),null,{timeout:30000});
    await page.reload();await page.locator('#view[data-route]').waitFor();if(await page.locator('.bottom-tabs').isVisible())await page.locator('[data-open-chat="'+roleId+'"]').click();
    await page.locator('#chat-messages').getByText('收到兼容测试。',{exact:true}).waitFor();
    assert.equal(requests.includes('/api/state'),!paged);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({server:require(path.join(serverDir,'package.json')).version,client:paged?'phase-3 assets':'signed Android 0.1.15 assets',initial:paged?2:300,history:paged?120:300,fullStateRequested:requests.includes('/api/state'),sent:true,receivedFixtureReply:true,reload:true}));
  }finally{await context.close();await app.close();await fs.rm(dataDir,{recursive:true,force:true});}
}
(async()=>{
  // This test process uses only the fixed loopback provider below.
  process.env.ALLOW_PRIVATE_PROVIDERS='1';
  assert.ok(legacy&&oldAssets,'Set PIPI_LEGACY_SERVER_ROOT and PIPI_LEGACY_ANDROID_ASSETS to the extracted release files');
  const provider=http.createServer((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:'fixture',choices:[{message:{role:'assistant',content:'收到兼容测试。'},finish_reason:'stop'}]}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+provider.address().port+'/v1';
  const browser=await chromium.launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});
  try{await check(browser,legacy,process.env.PIPI_CURRENT_ANDROID_ASSETS||path.join(current,'public'),true,url);await check(browser,current,oldAssets,false,url);}
  finally{await browser.close();await new Promise(resolve=>provider.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;});
