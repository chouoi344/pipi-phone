// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium,webkit}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');
const {createApp}=require('../server.cjs');

async function measure(browser,label,app){
  const page=await browser.newPage(),base='http://127.0.0.1:'+app.server.address().port;
  const requests=[];
  const record=req=>requests.push(new URL(req.url,base).pathname);
  app.server.on('request',record);
  try{
    // Ordinary navigation through a blank page avoids Reload's forced revalidation and the Back cache.
    for(const visit of ['cold','warm']){
      await page.goto('about:blank');
      requests.length=0;
      await page.goto(base+'/');
      await page.waitForSelector('#auth-form');
      assert.ok(requests.includes('/')&&requests.includes('/api/status'));
      const css=requests.filter(url=>url.endsWith('.css')),js=requests.filter(url=>url.endsWith('.js'));
      console.log(label,visit,{css:css.length,js:js.length,html:requests.filter(url=>url==='/').length});
      if(visit==='cold'){
        assert.ok(css.length>=40&&js.length>=35);
        if(label==='Chromium 83')assert.ok(css.includes('/webview83.css'));
      }else{
        assert.deepEqual(css,[]);assert.deepEqual(js,[]);
      }
    }
  }finally{app.server.off('request',record);await browser.close();}
}

(async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-cache-browser-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,mediaTimers:false});
  try{
    await app.listen();
    await measure(await chromium.launch({executablePath:process.env.PIPI_CHROME,headless:true}),'Chromium',app);
    await measure(await webkit.launch(),'WebKit',app);
    const puppeteer=require(process.env.PIPI_LEGACY_PUPPETEER||'puppeteer-core');
    await measure(await puppeteer.launch({executablePath:process.env.PIPI_CHROMIUM83,headless:true,args:['--no-sandbox']}),'Chromium 83',app);
  }finally{await app.close();await fs.rm(dataDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
