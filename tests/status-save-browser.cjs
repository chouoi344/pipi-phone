// SPDX-License-Identifier: MIT
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');
const {createApp}=require('../server.cjs');

async function exercise(browser,width){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-status-save-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,mediaTimers:false});
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
  let release;
  try{
    await app.listen();
    await page.goto('http://127.0.0.1:'+app.server.address().port);
    await page.locator('#dismiss-notice').click();
    await page.locator('[name=displayName]').fill('状态测试');
    await page.locator('[name=password]').fill('Test-status-save-only!');
    await page.locator('[name=confirmPassword]').fill('Test-status-save-only!');
    await page.locator('#auth-form [type=submit]').click();
    await page.locator('.bottom-tabs [data-nav=me]').click();
    await page.locator('[data-action=open-status]').click();
    await page.locator('[data-status-preset=happy]').click();
    const text=page.locator('#status-form [name=description]'),save=page.locator('.status-save');
    for(const leave of [false,true]){
      if(leave){
        await page.locator('[data-action=open-status]').click();
        await page.locator('[data-action=edit-status]').click();
      }
      const description=leave?'保存途中返回':'林青 <雨天> & 晴';
      await text.fill(description);
      const started=Promise.withResolvers(),pending=Promise.withResolvers();release=pending.resolve;
      await page.route('**/api/action',async route=>{
        if(route.request().postDataJSON().type!=='status.save')return route.continue();
        started.resolve();await pending.promise;await route.continue();
      });
      await save.click();await started.promise;
      if(leave){
        await page.goBack();await page.locator('#view[data-route=status]').waitFor();
        await page.locator('[data-action=edit-status]').click();
        assert.equal(await text.inputValue(),'林青 <雨天> & 晴');
      }else{
        const replaced=await page.evaluate(()=>{
          const previous=document.querySelector('#status-form');Pipi.refresh();
          return !previous.isConnected&&Boolean(document.querySelector('#status-form'));
        });
        assert.equal(replaced,true);
      }
      release();
      await page.waitForFunction(value=>Pipi.getState().profile.status?.description===value,description);
      if(leave){
        await page.waitForFunction(()=>!document.querySelector('#status-form .status-save')?.disabled);
        assert.equal(await page.locator('#view').getAttribute('data-route'),'status-editor');
        assert.equal(await text.inputValue(),'林青 <雨天> & 晴');
        await text.fill('新草稿');
        assert.equal(await text.inputValue(),'新草稿');
      }else{
        await page.locator('#view[data-route=me]').waitFor();
        assert.equal(await page.locator('.me-status-description').textContent(),description);
      }
      await page.unroute('**/api/action');
    }
    console.log(width+'px: a redrawn editor returned to Me; leaving and reopening retained the newer draft');
  }finally{release?.();await page.close();await app.close();await fs.rm(dataDir,{recursive:true,force:true});}
}

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PIPI_CHROME,headless:true});
  try{for(const width of [320,1280])await exercise(browser,width);}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
